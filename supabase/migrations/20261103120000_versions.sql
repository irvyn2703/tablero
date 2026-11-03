-- A version is a container for the tickets resolved in that delivery.
-- A ticket belongs to one version at a time.

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create unique index versions_company_name_idx
  on public.versions (company_id, lower(btrim(name)));

alter table public.tickets
  add column version_id uuid;

alter table public.tickets
  add constraint tickets_version_fk
  foreign key (company_id, version_id)
  references public.versions (company_id, id);

create index tickets_company_version_idx
  on public.tickets (company_id, version_id);

alter table public.versions enable row level security;
alter table public.versions force row level security;

grant select, insert, update, delete on public.versions to authenticated;
grant select (version_id) on public.tickets to authenticated;
grant update (version_id) on public.tickets to authenticated;

create policy versions_select on public.versions
for select to authenticated
using ((select private.is_member(company_id)));

create policy versions_insert on public.versions
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy versions_update on public.versions
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

create policy versions_delete on public.versions
for delete to authenticated
using ((select private.can_edit(company_id)));

create or replace view public.ticket_rows
with (security_invoker = true) as
select
  t.id,
  t.company_id,
  t.public_number,
  t.title,
  t.body,
  t.contact_email,
  t.status_id,
  t.resume_status_id,
  t.local_percent,
  t.priority,
  t.estimate,
  t.autonomy,
  t.sprint_id,
  t.assignee_id,
  t.agent_lease_until,
  t.created_at,
  t.updated_at,
  s.name as status_name,
  s.kind as status_kind,
  s.position as status_position,
  private.ticket_progress(t.id) as progress,
  t.rank,
  t.version_id
from public.tickets t
join public.statuses s on s.id = t.status_id;

notify pgrst, 'reload schema';
