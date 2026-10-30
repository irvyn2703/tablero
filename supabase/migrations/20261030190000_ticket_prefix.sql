-- Company ticket prefix. The number stays an integer. The key is what people and the agent use.

alter table public.companies
  add column ticket_prefix text not null default '';

alter table public.companies
  add constraint companies_ticket_prefix_check
  check (ticket_prefix = '' or ticket_prefix ~ '^[A-Z][A-Z0-9]{0,9}$');

grant select (ticket_prefix) on public.companies to authenticated;
grant update (ticket_prefix) on public.companies to authenticated;

create or replace function private.ticket_key(p_company uuid, p_number int)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when btrim(coalesce(c.ticket_prefix, '')) = '' then p_number::text
    else c.ticket_prefix || '-' || p_number::text
  end
  from public.companies c
  where c.id = p_company;
$$;

revoke all on function private.ticket_key(uuid, int) from public, anon, authenticated;

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

create or replace function public.agent_claim(p_token text, p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  claimed uuid;
  rec public.tickets;
begin
  select * into ctx from private.agent_context(p_token);

  update public.tickets t
    set agent_token_id = ctx.token_id,
        agent_lease_until = pg_catalog.now() + interval '2 hours'
  where t.id = p_ticket_id
    and t.company_id = ctx.company_id
    and exists (
      select 1 from public.statuses s
      where s.id = t.status_id and s.kind = 'work'
    )
    and (
      t.agent_lease_until is null
      or t.agent_lease_until <= pg_catalog.now()
      or t.agent_token_id = ctx.token_id
    )
  returning t.id into claimed;

  if claimed is null then
    raise exception 'el ticket no está disponible';
  end if;

  select * into rec from public.tickets where id = claimed;
  return jsonb_build_object(
    'id', rec.id,
    'number', rec.public_number,
    'key', private.ticket_key(rec.company_id, rec.public_number),
    'title', rec.title,
    'leaseUntil', rec.agent_lease_until
  );
end;
$$;

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
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
