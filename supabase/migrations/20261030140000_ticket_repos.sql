-- A ticket can touch several repos. The base branch stays on the repo.

create table public.ticket_repos (
  company_id uuid not null,
  ticket_id uuid not null,
  repo_id uuid not null,
  primary key (ticket_id, repo_id),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade,
  foreign key (company_id, repo_id) references public.repos (company_id, id) on delete cascade
);

insert into public.ticket_repos (company_id, ticket_id, repo_id)
select company_id, id, repo_id
from public.tickets
where repo_id is not null;

alter table public.ticket_repos enable row level security;
alter table public.ticket_repos force row level security;

revoke all on public.ticket_repos from public, anon, authenticated;
grant select, insert, delete on public.ticket_repos to authenticated;

create policy ticket_repos_select on public.ticket_repos
for select to authenticated
using ((select private.is_member(company_id)));

create policy ticket_repos_insert on public.ticket_repos
for insert to authenticated
with check ((select private.is_member(company_id)));

create policy ticket_repos_delete on public.ticket_repos
for delete to authenticated
using ((select private.is_member(company_id)));

drop view public.ticket_rows;

alter table public.tickets drop column repo_id;

create view public.ticket_rows
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
  private.ticket_progress(t.id) as progress
from public.tickets t
join public.statuses s on s.id = t.status_id;

grant select on public.ticket_rows to authenticated;

create or replace function public.agent_recommend(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  policy jsonb;
  auto_on boolean;
  max_estimate text;
  want_autonomy text;
  result jsonb;
begin
  select * into ctx from private.agent_context(p_token);
  select c.policy into policy from public.companies c where c.id = ctx.company_id;
  auto_on := coalesce((policy -> 'autoExecute' ->> 'enabled')::boolean, false);
  max_estimate := coalesce(policy -> 'autoExecute' ->> 'maxEstimate', 'xs');
  want_autonomy := coalesce(policy -> 'autoExecute' ->> 'autonomy', 'pull');

  with ranked as (
    select
      t.id,
      t.public_number,
      t.title,
      t.body,
      t.priority,
      t.estimate,
      t.autonomy,
      t.created_at,
      s.name as status_name,
      private.measure_progress(t.id) as progress,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'repo', r.github_full_name,
          'baseBranch', r.default_branch
        ) order by r.github_full_name)
        from public.ticket_repos tr
        join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
        where tr.ticket_id = t.id
      ), '[]'::jsonb) as repos,
      exists (
        select 1 from public.sprints sp
        where sp.id = t.sprint_id
          and pg_catalog.current_date between sp.starts_on and sp.ends_on
      ) as in_sprint
    from public.tickets t
    join public.statuses s on s.id = t.status_id
    where t.company_id = ctx.company_id
      and s.kind = 'work'
      and (t.agent_lease_until is null or t.agent_lease_until <= pg_catalog.now())
    order by in_sprint desc, t.priority asc, t.created_at asc
    limit 20
  ),
  numbered as (
    select
      ranked.*,
      row_number() over (
        order by in_sprint desc, priority asc, created_at asc
      ) as ordinal
    from ranked
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'number', n.public_number,
      'title', n.title,
      'body', n.body,
      'priority', n.priority,
      'estimate', n.estimate,
      'autonomy', n.autonomy,
      'status', n.status_name,
      'progress', n.progress,
      'repos', n.repos,
      'action', case
        when n.ordinal = 1
          and auto_on
          and n.estimate = max_estimate
          and n.autonomy = want_autonomy
          and jsonb_array_length(n.repos) > 0
        then 'ejecutar'
        else 'sugerir'
      end,
      'reason', case
        when n.ordinal = 1
          and auto_on
          and n.estimate = max_estimate
          and n.autonomy = want_autonomy
          and jsonb_array_length(n.repos) > 0
        then 'Cumple la política automática: tamaño permitido, autonomía de pull y repos asignados.'
        when n.ordinal = 1 and n.in_sprint then 'Es el primero del sprint activo.'
        when n.ordinal = 1 then 'Es el primero de la cola.'
        else 'Sigue en la cola.'
      end
    )
    order by n.ordinal
  ), '[]'::jsonb) into result
  from numbered n;

  return result;
end;
$$;
