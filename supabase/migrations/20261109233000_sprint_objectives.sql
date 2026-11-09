-- An objective outlives one fortnight. A ticket keeps a stay on every sprint
-- it passed through, so a closed fortnight still shows what was counted.

create table public.objectives (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, category_id) references public.categories (company_id, id) on delete set null (category_id)
);

create unique index objectives_company_name_idx
  on public.objectives (company_id, lower(btrim(name)));

alter table public.sprints
  add column objective_id uuid;

alter table public.sprints
  add constraint sprints_objective_fk
  foreign key (company_id, objective_id)
  references public.objectives (company_id, id) on delete set null (objective_id);

create table public.ticket_sprint_stays (
  company_id uuid not null,
  ticket_id uuid not null,
  sprint_id uuid not null,
  outcome text not null check (outcome in ('open', 'done', 'carried')),
  primary key (ticket_id, sprint_id),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade,
  foreign key (company_id, sprint_id) references public.sprints (company_id, id) on delete cascade
);

create unique index ticket_sprint_stays_one_open
  on public.ticket_sprint_stays (ticket_id)
  where outcome = 'open';

create index ticket_sprint_stays_sprint_idx
  on public.ticket_sprint_stays (company_id, sprint_id);

alter table public.objectives enable row level security;
alter table public.objectives force row level security;
alter table public.ticket_sprint_stays enable row level security;
alter table public.ticket_sprint_stays force row level security;

revoke all on public.objectives from public, anon, authenticated;
revoke all on public.ticket_sprint_stays from public, anon, authenticated;
grant select, insert, update, delete on public.objectives to authenticated;
grant select on public.ticket_sprint_stays to authenticated;

create policy objectives_select on public.objectives
for select to authenticated
using ((select private.is_member(company_id)));

create policy objectives_insert on public.objectives
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy objectives_update on public.objectives
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

create policy objectives_delete on public.objectives
for delete to authenticated
using ((select private.can_edit(company_id)));

create policy ticket_sprint_stays_select on public.ticket_sprint_stays
for select to authenticated
using ((select private.is_member(company_id)));

create or replace function private.ticket_finished(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.tickets t
      join public.statuses s on s.id = t.status_id
      where t.id = p_ticket_id
        and s.kind = 'close'
    );
$$;

revoke all on function private.ticket_finished(uuid) from public, anon, authenticated;

create or replace function private.sync_sprint_stay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished boolean;
  leaving uuid;
  arriving uuid;
begin
  if tg_op = 'UPDATE'
    and new.sprint_id is not distinct from old.sprint_id
    and new.status_id is not distinct from old.status_id
    and new.local_percent is not distinct from old.local_percent
  then
    return null;
  end if;

  finished := private.ticket_finished(new.id);
  arriving := new.sprint_id;
  leaving := case when tg_op = 'UPDATE' then old.sprint_id else null end;

  if leaving is not null and leaving is distinct from arriving then
    insert into public.ticket_sprint_stays (company_id, ticket_id, sprint_id, outcome)
    values (
      new.company_id,
      new.id,
      leaving,
      case when finished then 'done' else 'carried' end
    )
    on conflict (ticket_id, sprint_id) do update
      set outcome = case
        when public.ticket_sprint_stays.outcome = 'done' then 'done'
        else excluded.outcome
      end;
  end if;

  if arriving is not null then
    insert into public.ticket_sprint_stays (company_id, ticket_id, sprint_id, outcome)
    values (
      new.company_id,
      new.id,
      arriving,
      case when finished then 'done' else 'open' end
    )
    on conflict (ticket_id, sprint_id) do update
      set outcome = excluded.outcome;
  end if;

  return null;
end;
$$;

revoke all on function private.sync_sprint_stay() from public, anon, authenticated;

create trigger tickets_sprint_stay
after insert or update of sprint_id, status_id, local_percent on public.tickets
for each row execute function private.sync_sprint_stay();

insert into public.ticket_sprint_stays (company_id, ticket_id, sprint_id, outcome)
select
  t.company_id,
  t.id,
  t.sprint_id,
  case when private.ticket_finished(t.id) then 'done' else 'open' end
from public.tickets t
where t.sprint_id is not null
on conflict (ticket_id, sprint_id) do nothing;

notify pgrst, 'reload schema';
