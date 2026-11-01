-- The agent reads the first work status, saves a triage suggestion, and learns
-- whether the company policy allows it to open a pull.

create or replace function private.report_type(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_body like 'Tipo' || chr(10) || 'Requerimiento%' then 'Requerimiento'
    when p_body like 'Tipo' || chr(10) || 'Ticket%' then 'Ticket'
    else null
  end;
$$;

create or replace function private.estimate_rank(p_estimate text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_estimate
    when 'xs' then 1
    when 's' then 2
    when 'm' then 3
    when 'l' then 4
    else null
  end;
$$;

revoke all on function private.report_type(text) from public, anon, authenticated;
revoke all on function private.estimate_rank(text) from public, anon, authenticated;
grant execute on function private.report_type(text) to postgres;
grant execute on function private.estimate_rank(text) to postgres;

create or replace function public.agent_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  company_name text;
begin
  select * into ctx from private.agent_context(p_token);
  select c.name into company_name from public.companies c where c.id = ctx.company_id;
  return jsonb_build_object('company', company_name);
end;
$$;

create or replace function public.agent_inbox(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  sid uuid;
  status_name text;
  result jsonb;
begin
  select * into ctx from private.agent_context(p_token);

  select s.id, s.name into sid, status_name
  from public.statuses s
  where s.company_id = ctx.company_id
    and s.kind = 'work'
  order by s.position
  limit 1;

  if sid is null then
    raise exception 'la empresa no tiene estados de trabajo';
  end if;

  with waiting as (
    select t.*
    from public.tickets t
    where t.company_id = ctx.company_id
      and t.status_id = sid
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
      'status', status_name,
      'priority', t.priority,
      'estimate', t.estimate,
      'autonomy', t.autonomy,
      'leased', t.agent_lease_until is not null and t.agent_lease_until > pg_catalog.now(),
      'repos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'repo', r.github_full_name,
          'baseBranch', r.default_branch
        ) order by r.github_full_name)
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
  ), '[]'::jsonb) into result
  from waiting t;

  return result;
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
  sid uuid;
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

  select s.id into sid
  from public.statuses s
  where s.company_id = ctx.company_id
    and s.kind = 'work'
  order by s.position
  limit 1;

  update public.tickets t
  set priority = p_priority,
      estimate = p_estimate,
      autonomy = p_autonomy,
      updated_at = pg_catalog.now()
  where t.id = p_ticket_id
    and t.company_id = ctx.company_id
    and t.status_id = sid
  returning * into rec;

  if rec.id is null then
    raise exception 'el ticket ya no está en el estado inicial';
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'repo', r.github_full_name,
    'baseBranch', r.default_branch
  ) order by r.github_full_name), '[]'::jsonb) into repos
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id;

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
  else
    next_step := 'abrir pull';
    reason := 'Cabe en la política. Reserva el ticket, abre la rama con su clave y registra el pull. No lo mezcles.';
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

revoke all on function public.agent_session(text) from public, anon, authenticated;
revoke all on function public.agent_inbox(text) from public, anon, authenticated;
revoke all on function public.agent_suggest(text, uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.agent_session(text) to anon, authenticated;
grant execute on function public.agent_inbox(text) to anon, authenticated;
grant execute on function public.agent_suggest(text, uuid, int, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
