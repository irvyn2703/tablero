-- One place in the queue. Every status column sorts by it.
-- Moving a ticket to another status does not change its place.

alter table public.tickets
  add column rank int;

with ordered as (
  select
    id,
    row_number() over (
      partition by company_id
      order by public_number desc
    ) as ord
  from public.tickets
)
update public.tickets as ticket
set rank = ordered.ord
from ordered
where ticket.id = ordered.id;

alter table public.tickets
  alter column rank set not null;

alter table public.tickets
  add constraint tickets_rank_unique unique (company_id, rank);

create or replace function private.assign_ticket_rank()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rank is null then
    select coalesce(min(ticket.rank), 1) - 1 into new.rank
    from public.tickets as ticket
    where ticket.company_id = new.company_id;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_ticket_rank() from public, anon, authenticated;

create trigger tickets_assign_rank
  before insert on public.tickets
  for each row
  execute function private.assign_ticket_rank();

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
  t.rank
from public.tickets t
join public.statuses s on s.id = t.status_id;

grant select (rank) on public.tickets to authenticated;

create or replace function public.move_ticket(p_ticket_id uuid, p_direction int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  neighbor public.tickets;
begin
  if p_direction not in (-1, 1) then
    raise exception 'movimiento inválido';
  end if;

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rec.company_id::text));

  select * into rec from public.tickets where id = p_ticket_id;

  select * into neighbor
  from public.tickets
  where company_id = rec.company_id
    and status_id = rec.status_id
    and case
      when p_direction = -1 then rank < rec.rank
      else rank > rec.rank
    end
  order by case when p_direction = -1 then rank end desc,
           case when p_direction = 1 then rank end asc
  limit 1;

  if neighbor.id is null then
    return;
  end if;

  update public.tickets
  set rank = case id
    when rec.id then neighbor.rank
    else rec.rank
  end
  where id in (rec.id, neighbor.id);
end;
$$;

revoke all on function public.move_ticket(uuid, int) from public, anon;
grant execute on function public.move_ticket(uuid, int) to authenticated;

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
      t.rank,
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
    order by t.rank asc, in_sprint desc, t.priority asc, t.created_at asc
    limit 20
  ),
  numbered as (
    select
      ranked.*,
      row_number() over (
        order by rank asc, in_sprint desc, priority asc, created_at asc
      ) as ordinal
    from ranked
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'number', n.public_number,
      'key', private.ticket_key(ctx.company_id, n.public_number),
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
        when n.ordinal = 1 and n.in_sprint then 'Es el primero de la cola y está en el sprint.'
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

notify pgrst, 'reload schema';
