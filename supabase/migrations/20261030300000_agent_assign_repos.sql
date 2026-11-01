-- The agent sees the company repos and marks the ones a ticket needs
-- while that ticket is still in the first work status.

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
  tickets jsonb;
  catalog jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'repo', r.github_full_name,
    'baseBranch', r.default_branch
  ) order by r.github_full_name), '[]'::jsonb) into catalog
  from public.repos r
  where r.company_id = ctx.company_id;

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
  sid uuid;
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

  select s.id into sid
  from public.statuses s
  where s.company_id = ctx.company_id
    and s.kind = 'work'
  order by s.position
  limit 1;

  select * into rec
  from public.tickets t
  where t.id = p_ticket_id
    and t.company_id = ctx.company_id
    and t.status_id = sid
  for update;

  if rec.id is null then
    raise exception 'el ticket ya no está en el estado inicial';
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'repo', r.github_full_name,
    'baseBranch', r.default_branch
  ) order by r.github_full_name), '[]'::jsonb) into linked
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

revoke all on function public.agent_inbox(text) from public, anon, authenticated;
revoke all on function public.agent_assign_repos(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.agent_inbox(text) to anon, authenticated;
grant execute on function public.agent_assign_repos(text, uuid, text[]) to anon, authenticated;

notify pgrst, 'reload schema';
