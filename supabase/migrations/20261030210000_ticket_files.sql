-- Images, Excel and Word attached to a ticket. The path is reserved first.
-- The browser uploads only to that path, then the file is marked ready.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-files',
  'ticket-files',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.ticket_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ticket_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  mime text not null,
  byte_size int not null check (byte_size between 1 and 10485760),
  object_path text not null unique,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade
);

alter table public.ticket_files enable row level security;
alter table public.ticket_files force row level security;

revoke all on public.ticket_files from public, anon, authenticated;
grant select (id, company_id, ticket_id, name, mime, byte_size, object_path, created_at)
  on public.ticket_files to authenticated;

create policy ticket_files_select on public.ticket_files
for select to authenticated
using (ready and (select private.is_member(company_id)));

create or replace function private.file_mime(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case ext
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'gif' then 'image/gif'
    when 'webp' then 'image/webp'
    when 'xls' then 'application/vnd.ms-excel'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    else null
  end
  from (
    select lower(btrim(coalesce(p_name, ''))) as name
  ) raw
  cross join lateral (
    select reverse(split_part(reverse(raw.name), '.', 1)) as ext
  ) parts
  where raw.name ~ '^[^/\\]+[.](jpg|jpeg|png|gif|webp|xls|xlsx|doc|docx)$';
$$;

revoke all on function private.file_mime(text) from public, anon, authenticated;

create or replace function private.file_label(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text;
begin
  clean := regexp_replace(btrim(coalesce(p_name, '')), E'[\\x00-\\x1f/\\\\]', '', 'g');
  clean := right(clean, 120);
  if private.file_mime(clean) is null then
    raise exception 'solo imágenes, Excel o Word';
  end if;
  return clean;
end;
$$;

revoke all on function private.file_label(text) from public, anon, authenticated;

create or replace function private.pending_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ticket_files
    where object_path = p_name
      and not ready
      and created_at > pg_catalog.now() - interval '30 minutes'
  );
$$;

revoke all on function private.pending_file(text) from public;
grant execute on function private.pending_file(text) to anon, authenticated;

create or replace function private.reserve_file(
  p_company uuid,
  p_ticket uuid,
  p_name text,
  p_bytes int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  label text;
  mime text;
  file_id uuid := extensions.gen_random_uuid();
  path text;
  taken int;
begin
  if p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then
    raise exception 'cada archivo puede pesar hasta 10 MB';
  end if;
  label := private.file_label(p_name);
  mime := private.file_mime(label);

  select count(*) into taken
  from public.ticket_files
  where ticket_id = p_ticket
    and (ready or created_at > pg_catalog.now() - interval '30 minutes');

  if taken >= 8 then
    raise exception 'son hasta 8 archivos';
  end if;

  path := p_company::text || '/' || p_ticket::text || '/' || file_id::text;
  insert into public.ticket_files (id, company_id, ticket_id, name, mime, byte_size, object_path)
  values (file_id, p_company, p_ticket, label, mime, p_bytes, path);

  return jsonb_build_object('id', file_id, 'path', path, 'mime', mime);
end;
$$;

revoke all on function private.reserve_file(uuid, uuid, text, int) from public, anon, authenticated;

create or replace function private.mark_file_ready(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.ticket_files;
  marked uuid;
begin
  select * into rec from public.ticket_files where id = p_file_id;
  if rec.id is null then
    raise exception 'archivo no encontrado';
  end if;
  if rec.ready then
    return;
  end if;
  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'ticket-files'
      and name = rec.object_path
  ) then
    raise exception 'el archivo no llegó';
  end if;

  update public.ticket_files
  set ready = true
  where id = rec.id
    and not ready
  returning id into marked;

  if marked is null then
    return;
  end if;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (rec.company_id, rec.ticket_id, 'public', left('Se adjuntó ' || rec.name, 2000));
end;
$$;

revoke all on function private.mark_file_ready(uuid) from public, anon, authenticated;

create or replace function public.reserve_ticket_file(p_ticket_id uuid, p_name text, p_bytes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select company_id into company from public.tickets where id = p_ticket_id;
  if company is null or not private.can_edit(company) then
    raise exception 'ticket no encontrado';
  end if;
  return private.reserve_file(company, p_ticket_id, p_name, p_bytes);
end;
$$;

create or replace function public.reserve_intake_file(p_token text, p_name text, p_bytes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;
  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);
  if rec.id is null or rec.created_at < pg_catalog.now() - interval '30 minutes' then
    raise exception 'ya no se pueden adjuntar archivos a este ticket';
  end if;
  return private.reserve_file(rec.company_id, rec.id, p_name, p_bytes);
end;
$$;

create or replace function public.confirm_ticket_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select company_id into company from public.ticket_files where id = p_file_id;
  if company is null or not private.can_edit(company) then
    raise exception 'archivo no encontrado';
  end if;
  perform private.mark_file_ready(p_file_id);
end;
$$;

create or replace function public.confirm_intake_file(p_token text, p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  file_ticket uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;
  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);
  select ticket_id into file_ticket from public.ticket_files where id = p_file_id;
  if rec.id is null
    or file_ticket is distinct from rec.id
    or rec.created_at < pg_catalog.now() - interval '30 minutes' then
    raise exception 'archivo no encontrado';
  end if;
  perform private.mark_file_ready(p_file_id);
end;
$$;

create or replace function public.remove_ticket_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.ticket_files;
begin
  select * into rec from public.ticket_files where id = p_file_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'archivo no encontrado';
  end if;
  delete from public.ticket_files where id = rec.id;
  if rec.ready then
    insert into public.ticket_events (company_id, ticket_id, visibility, body)
    values (rec.company_id, rec.ticket_id, 'public', left('Se quitó ' || rec.name, 2000));
  end if;
end;
$$;

revoke all on function public.reserve_ticket_file(uuid, text, int) from public, anon;
revoke all on function public.reserve_intake_file(text, text, int) from public;
revoke all on function public.confirm_ticket_file(uuid) from public, anon;
revoke all on function public.confirm_intake_file(text, uuid) from public;
revoke all on function public.remove_ticket_file(uuid) from public, anon;

grant execute on function public.reserve_ticket_file(uuid, text, int) to authenticated;
grant execute on function public.reserve_intake_file(text, text, int) to anon, authenticated;
grant execute on function public.confirm_ticket_file(uuid) to authenticated;
grant execute on function public.confirm_intake_file(text, uuid) to anon, authenticated;
grant execute on function public.remove_ticket_file(uuid) to authenticated;

create policy ticket_files_upload on storage.objects
for insert to anon, authenticated
with check (
  bucket_id = 'ticket-files'
  and private.pending_file(name)
);

create policy ticket_files_read on storage.objects
for select to authenticated
using (
  bucket_id = 'ticket-files'
  and private.is_member(((storage.foldername(name))[1])::uuid)
);

create policy ticket_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'ticket-files'
  and private.can_edit(((storage.foldername(name))[1])::uuid)
);

notify pgrst, 'reload schema';
