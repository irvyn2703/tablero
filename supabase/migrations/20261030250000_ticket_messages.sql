-- A short thread on the ticket. The team writes from the board.
-- The person who reported replies with the same link they use to follow progress.

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ticket_id uuid not null,
  side text not null check (side in ('equipo', 'reporte')),
  author_id uuid references auth.users (id) on delete set null,
  author_label text not null default '' check (char_length(author_label) <= 40),
  body text not null check (char_length(body) between 1 and 800),
  created_at timestamptz not null default now(),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade,
  check (side <> 'reporte' or author_id is null)
);

create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);

alter table public.ticket_messages enable row level security;
alter table public.ticket_messages force row level security;

revoke all on public.ticket_messages from public, anon, authenticated;
grant select (id, company_id, ticket_id, side, author_label, body, created_at)
  on public.ticket_messages to authenticated;

create policy ticket_messages_select on public.ticket_messages
for select to authenticated
using ((select private.is_member(company_id)));

create or replace function private.allow_message(p_ticket_id uuid, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.ticket_messages
    where ticket_id = p_ticket_id
  ) >= 200 then
    raise exception 'este ticket ya tiene muchos mensajes';
  end if;

  if p_side = 'reporte' and (
    select count(*)
    from public.ticket_messages
    where ticket_id = p_ticket_id
      and side = 'reporte'
      and created_at > pg_catalog.now() - interval '1 minute'
  ) >= 4 then
    raise exception 'espera un momento para enviar otro mensaje';
  end if;
end;
$$;

revoke all on function private.allow_message(uuid, text) from public, anon, authenticated;
grant execute on function private.allow_message(uuid, text) to postgres;

create or replace function public.post_ticket_message(p_ticket_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  label text;
  clean text := btrim(coalesce(p_body, ''));
  mid uuid;
begin
  if char_length(clean) < 1 or char_length(clean) > 800 then
    raise exception 'el mensaje tiene que ir de 1 a 800 caracteres';
  end if;

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform private.allow_message(rec.id, 'equipo');

  select m.alias into label
  from public.company_members m
  where m.company_id = rec.company_id
    and m.user_id = (select auth.uid());

  insert into public.ticket_messages (company_id, ticket_id, side, author_id, author_label, body)
  values (rec.company_id, rec.id, 'equipo', (select auth.uid()), coalesce(label, ''), clean)
  returning id into mid;

  return mid;
end;
$$;

revoke all on function public.post_ticket_message(uuid, text) from public, anon;
grant execute on function public.post_ticket_message(uuid, text) to authenticated;

create or replace function public.post_public_message(p_token text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  clean text := btrim(coalesce(p_body, ''));
  mid uuid;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 800 then
    raise exception 'el mensaje tiene que ir de 1 a 800 caracteres';
  end if;

  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);

  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;

  perform private.allow_message(rec.id, 'reporte');

  insert into public.ticket_messages (company_id, ticket_id, side, body)
  values (rec.company_id, rec.id, 'reporte', clean)
  returning id into mid;

  return mid;
end;
$$;

revoke all on function public.post_public_message(text, text) from public;
grant execute on function public.post_public_message(text, text) to anon, authenticated;

create or replace function public.read_public_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  status_name text;
  company_name text;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;

  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);

  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;

  select s.name into status_name from public.statuses s where s.id = rec.status_id;
  select c.name into company_name from public.companies c where c.id = rec.company_id;

  return jsonb_build_object(
    'number', rec.public_number,
    'key', private.ticket_key(rec.company_id, rec.public_number),
    'title', rec.title,
    'companyName', company_name,
    'status', status_name,
    'progress', private.measure_progress(rec.id),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('body', e.body, 'at', e.created_at)
        order by e.created_at
      )
      from public.ticket_events e
      where e.ticket_id = rec.id
        and e.visibility = 'public'
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'side', m.side,
          'name', m.author_label,
          'body', m.body,
          'at', m.created_at
        )
        order by m.created_at
      )
      from public.ticket_messages m
      where m.ticket_id = rec.id
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
