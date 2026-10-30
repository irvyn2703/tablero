-- Observer can read the board and the calendar. Writes stay with owner, admin, and dev.

create or replace function private.can_edit(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'dev')
  );
$$;

revoke all on function private.can_edit(uuid) from public, anon, authenticated;
grant execute on function private.can_edit(uuid) to authenticated;

do $$
declare
  cons name;
begin
  select c.conname into cons
  from pg_constraint c
  where c.conrelid = 'public.company_members'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%role%';
  execute format('alter table public.company_members drop constraint %I', cons);

  select c.conname into cons
  from pg_constraint c
  where c.conrelid = 'public.company_invites'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%role%';
  execute format('alter table public.company_invites drop constraint %I', cons);
end $$;

alter table public.company_members
  add constraint company_members_role_check
  check (role in ('owner', 'admin', 'dev', 'observer'));

alter table public.company_invites
  add constraint company_invites_role_check
  check (role in ('admin', 'dev', 'observer'));

drop policy members_update on public.company_members;
create policy members_update on public.company_members
for update to authenticated
using ((select private.is_owner(company_id)))
with check (
  (select private.is_owner(company_id))
  and role in ('owner', 'admin', 'dev', 'observer')
);

drop policy sprints_all on public.sprints;
create policy sprints_select on public.sprints
for select to authenticated
using ((select private.is_member(company_id)));

create policy sprints_insert on public.sprints
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy sprints_update on public.sprints
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

create policy sprints_delete on public.sprints
for delete to authenticated
using ((select private.can_edit(company_id)));

drop policy tickets_update on public.tickets;
create policy tickets_update on public.tickets
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

drop policy ticket_repos_insert on public.ticket_repos;
create policy ticket_repos_insert on public.ticket_repos
for insert to authenticated
with check ((select private.can_edit(company_id)));

drop policy ticket_repos_delete on public.ticket_repos;
create policy ticket_repos_delete on public.ticket_repos
for delete to authenticated
using ((select private.can_edit(company_id)));

create or replace function public.create_ticket(
  p_company_id uuid,
  p_title text,
  p_body text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit(p_company_id) then
    raise exception 'no autorizado';
  end if;
  return private.insert_ticket(p_company_id, p_title, p_body, null, null);
end;
$$;

create or replace function public.set_ticket_progress(
  p_ticket_id uuid,
  p_status_id uuid,
  p_local int
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select t.company_id into company from public.tickets t where t.id = p_ticket_id;
  if company is null or not private.can_edit(company) then
    raise exception 'ticket no encontrado';
  end if;
  perform private.apply_progress(p_ticket_id, p_status_id, p_local);
  return private.measure_progress(p_ticket_id);
end;
$$;

create or replace function public.create_invite(
  p_company_id uuid,
  p_email text,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  clean text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.is_admin(p_company_id) then
    raise exception 'no autorizado';
  end if;
  if p_role not in ('admin', 'dev', 'observer') then
    raise exception 'ese rol no se invita';
  end if;
  if clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'el correo no es válido';
  end if;

  secret := private.new_secret();
  insert into public.company_invites (company_id, email, role, token_hash, expires_at)
  values (p_company_id, clean, p_role, private.sha256_hex(secret), pg_catalog.now() + interval '14 days');
  return secret;
end;
$$;

create or replace function public.set_member_alias(
  p_company_id uuid,
  p_user_id uuid,
  p_alias text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(p_alias, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'no autorizado';
  end if;
  if not private.is_admin(p_company_id)
    and (
      p_user_id is distinct from (select auth.uid())
      or not private.can_edit(p_company_id)
    ) then
    raise exception 'no autorizado';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 40 then
    raise exception 'el alias necesita entre 1 y 40 caracteres';
  end if;

  update public.company_members
    set alias = clean
  where company_id = p_company_id
    and user_id = p_user_id;

  if not found then
    raise exception 'miembro no encontrado';
  end if;
end;
$$;

notify pgrst, 'reload schema';
