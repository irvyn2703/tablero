alter table public.repos
  add column source_branch text not null default 'main'
  check (char_length(btrim(source_branch)) between 1 and 120);

create or replace function private.repo_card(p_repo text, p_from text, p_pull text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'repo', p_repo,
    'fromBranch', p_from,
    'pullBranch', p_pull
  );
$$;

create or replace function public.agent_inbox(p_token text, p_status text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  chosen public.statuses;
  tickets jsonb;
  catalog jsonb;
begin
  select * into ctx from private.agent_context(p_token);
  chosen := private.agent_status(ctx.company_id, p_status);

  select coalesce(jsonb_agg(
    private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
    order by r.github_full_name
  ), '[]'::jsonb) into catalog
  from public.repos r
  where r.company_id = ctx.company_id;

  with waiting as (
    select t.*
    from public.tickets t
    where t.company_id = ctx.company_id
      and t.status_id = chosen.id
    order by t.rank
    limit 30
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'key', private.ticket_key(ctx.company_id, t.public_number),
      'title', t.title,
      'body', t.body,
      'type', private.report_type(t.body),
      'status', chosen.name,
      'priority', t.priority,
      'estimate', t.estimate,
      'autonomy', t.autonomy,
      'leased', t.agent_lease_until is not null and t.agent_lease_until > pg_catalog.now(),
      'repos', coalesce((
        select jsonb_agg(
          private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
          order by r.github_full_name
        )
        from public.ticket_repos tr
        join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
        where tr.ticket_id = t.id
      ), '[]'::jsonb),
      'files', coalesce((
        select jsonb_agg(f.name order by f.created_at)
        from public.ticket_files f
        where f.ticket_id = t.id
          and f.ready
      ), '[]'::jsonb)
    )
    order by t.rank
  ), '[]'::jsonb) into tickets
  from waiting t;

  return jsonb_build_object('catalog', catalog, 'tickets', tickets);
end;
$$;

create or replace function public.agent_assign_repos(
  p_token text,
  p_ticket_id uuid,
  p_repos text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  rec public.tickets;
  wanted text[];
  ids uuid[];
  linked jsonb;
  names text;
  event_body text;
  inserted int;
begin
  if p_repos is null then
    raise exception 'indica los repos';
  end if;

  select * into ctx from private.agent_context(p_token);

  select * into rec
  from public.tickets t
  where t.id = p_ticket_id
    and t.company_id = ctx.company_id
  for update;

  if rec.id is null or not exists (
    select 1
    from public.statuses s
    where s.id = rec.status_id
      and s.kind = 'work'
  ) then
    raise exception 'el ticket no está en trabajo';
  end if;

  if exists (
    select 1
    from unnest(p_repos) as item
    where btrim(coalesce(item, '')) = ''
  ) then
    raise exception 'repo no encontrado';
  end if;

  select coalesce(array_agg(distinct name), '{}'::text[]) into wanted
  from (
    select btrim(item) as name
    from unnest(p_repos) as item
  ) clean
  where name <> '';

  select coalesce(array_agg(r.id), '{}'::uuid[]) into ids
  from public.repos r
  where r.company_id = ctx.company_id
    and r.github_full_name = any (wanted);

  if pg_catalog.cardinality(ids) is distinct from pg_catalog.cardinality(wanted) then
    raise exception 'repo no encontrado';
  end if;

  delete from public.ticket_repos
  where company_id = ctx.company_id
    and ticket_id = rec.id;

  insert into public.ticket_repos (company_id, ticket_id, repo_id)
  select ctx.company_id, rec.id, r.id
  from public.repos r
  where r.company_id = ctx.company_id
    and r.id = any (ids);
  get diagnostics inserted = row_count;

  if inserted is distinct from pg_catalog.cardinality(wanted) then
    raise exception 'repo no encontrado';
  end if;

  select coalesce(jsonb_agg(
    private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
    order by r.github_full_name
  ), '[]'::jsonb) into linked
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id;

  select string_agg(item ->> 'repo', ', ' order by item ->> 'repo') into names
  from jsonb_array_elements(linked) as item;

  event_body := case
    when names is null then 'Repos: ninguno.'
    else 'Repos: ' || names || '.'
  end;
  if char_length(event_body) > 2000 then
    event_body := 'Repos: ' || jsonb_array_length(linked) || '.';
  end if;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (ctx.company_id, rec.id, 'internal', event_body);

  return jsonb_build_object(
    'id', rec.id,
    'key', private.ticket_key(ctx.company_id, rec.public_number),
    'repos', linked
  );
end;
$$;

create or replace function public.agent_suggest(
  p_token text,
  p_ticket_id uuid,
  p_priority int,
  p_estimate text,
  p_autonomy text,
  p_note text default null
)
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
  repos jsonb;
  rec public.tickets;
  note text;
  event_body text;
  priority_name text;
  estimate_name text;
  autonomy_name text;
  next_step text;
  reason text;
  born text;
  lands text;
  variety int;
begin
  if p_priority is null or p_priority not between 1 and 4 then
    raise exception 'la prioridad va de 1 a 4';
  end if;
  if private.estimate_rank(p_estimate) is null then
    raise exception 'el tamaño tiene que ser xs, s, m o l';
  end if;
  if p_autonomy not in ('suggest', 'pull', 'human') then
    raise exception 'la autonomía tiene que ser suggest, pull o human';
  end if;

  select * into ctx from private.agent_context(p_token);

  update public.tickets t
  set priority = p_priority,
      estimate = p_estimate,
      autonomy = p_autonomy,
      updated_at = pg_catalog.now()
  where t.id = p_ticket_id
    and t.company_id = ctx.company_id
    and exists (
      select 1
      from public.statuses s
      where s.id = t.status_id
        and s.kind = 'work'
    )
  returning * into rec;

  if rec.id is null then
    raise exception 'el ticket no está en trabajo';
  end if;

  priority_name := case p_priority
    when 1 then 'Urgente'
    when 2 then 'Alta'
    when 3 then 'Normal'
    else 'Baja'
  end;
  estimate_name := case p_estimate
    when 'xs' then 'Muy simple'
    when 's' then 'Simple'
    when 'm' then 'Mediano'
    else 'Grande'
  end;
  autonomy_name := case p_autonomy
    when 'pull' then 'Abrir pull'
    when 'human' then 'Solo humano'
    else 'Sugerir'
  end;

  note := nullif(btrim(coalesce(p_note, '')), '');
  event_body := format(
    'Sugerencia: prioridad %s, tamaño %s, autonomía %s.',
    priority_name,
    estimate_name,
    autonomy_name
  );
  if note is not null then
    event_body := event_body || ' ' || note;
  end if;
  if char_length(event_body) > 2000 then
    raise exception 'la nota es demasiado larga';
  end if;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (ctx.company_id, rec.id, 'internal', event_body);

  select coalesce(jsonb_agg(
    private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
    order by r.github_full_name
  ), '[]'::jsonb) into repos
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id;

  select count(distinct (r.source_branch, r.default_branch))
  into variety
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id;

  select r.source_branch, r.default_branch
  into born, lands
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id
  order by r.github_full_name
  limit 1;

  select c.policy into policy from public.companies c where c.id = ctx.company_id;
  auto_on := coalesce((policy -> 'autoExecute' ->> 'enabled')::boolean, false);
  max_estimate := coalesce(policy -> 'autoExecute' ->> 'maxEstimate', 'xs');

  if p_autonomy = 'human' then
    next_step := 'solo sugerir';
    reason := 'Quedó para una persona.';
  elsif p_autonomy <> 'pull' then
    next_step := 'solo sugerir';
    reason := 'Quedó como sugerencia, sin abrir un pull.';
  elsif not auto_on then
    next_step := 'solo sugerir';
    reason := 'La política no permite abrir el pull solo.';
  elsif private.estimate_rank(p_estimate) > private.estimate_rank(max_estimate) then
    next_step := 'solo sugerir';
    reason := 'Pasa el tamaño que la política permite.';
  elsif jsonb_array_length(repos) = 0 then
    next_step := 'solo sugerir';
    reason := 'Falta asignar el repo.';
  elsif variety > 1 then
    next_step := 'abrir pull';
    reason := 'Cabe en la política. En cada repo la rama nace de fromBranch y el pull apunta a pullBranch. Reserva el ticket, abre la rama con su clave desde fromBranch, crea el pull hacia pullBranch, regístralo y al final pasa thermos. No lo mezcles.';
  else
    next_step := 'abrir pull';
    reason := format(
      'Cabe en la política. La rama nace de %s y el pull apunta a %s. Reserva el ticket, abre la rama con su clave desde %s, crea el pull hacia %s, regístralo y al final pasa thermos. No lo mezcles.',
      born,
      lands,
      born,
      lands
    );
  end if;

  return jsonb_build_object(
    'id', rec.id,
    'key', private.ticket_key(ctx.company_id, rec.public_number),
    'title', rec.title,
    'priority', rec.priority,
    'estimate', rec.estimate,
    'autonomy', rec.autonomy,
    'repos', repos,
    'next', next_step,
    'reason', reason
  );
end;
$$;

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
        select jsonb_agg(
          private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
          order by r.github_full_name
        )
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
        then 'Cumple la política automática. La rama nace de fromBranch y el pull apunta a pullBranch.'
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

revoke all on function private.repo_card(text, text, text) from public, anon, authenticated;
grant execute on function private.repo_card(text, text, text) to postgres;

notify pgrst, 'reload schema';
