-- A GitHub name can appear more than once when the branch it is born from
-- or the branch the pull targets is different. The same pair is still one repo.

do $$
declare
  cons text;
begin
  select c.conname into cons
  from pg_constraint c
  where c.conrelid = 'public.repos'::regclass
    and c.contype = 'u'
    and pg_get_constraintdef(c.oid) like '%github_full_name%';
  if cons is not null then
    execute format('alter table public.repos drop constraint %I', cons);
  end if;
end;
$$;

update public.repos
set source_branch = btrim(source_branch),
    default_branch = btrim(default_branch)
where source_branch is distinct from btrim(source_branch)
   or default_branch is distinct from btrim(default_branch);

alter table public.repos
  add constraint repos_source_branch_trimmed check (source_branch = btrim(source_branch)),
  add constraint repos_default_branch_trimmed check (default_branch = btrim(default_branch)),
  add constraint repos_company_route_key unique (company_id, github_full_name, source_branch, default_branch);

create or replace function private.resolve_repo_ids(p_company uuid, p_repos text[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item text;
  parts text[];
  repo_name text;
  born text;
  lands text;
  found int;
  rid uuid;
  ids uuid[] := '{}'::uuid[];
begin
  if p_repos is null then
    return ids;
  end if;

  foreach item in array p_repos loop
    item := btrim(coalesce(item, ''));
    if item = '' then
      raise exception 'repo no encontrado';
    end if;

    parts := pg_catalog.string_to_array(item, '|');
    repo_name := btrim(coalesce(parts[1], ''));
    born := nullif(btrim(coalesce(parts[2], '')), '');
    lands := nullif(btrim(coalesce(parts[3], '')), '');
    if repo_name = '' or coalesce(pg_catalog.array_length(parts, 1), 0) > 3 then
      raise exception 'repo no encontrado';
    end if;
    if (born is null) is distinct from (lands is null) then
      raise exception 'indica las dos ramas';
    end if;

    if born is null then
      select count(*)::int into found
      from public.repos r
      where r.company_id = p_company
        and r.github_full_name = repo_name;
      if found = 0 then
        raise exception 'repo no encontrado';
      end if;
      if found > 1 then
        raise exception 'hay más de un repo con ese nombre';
      end if;
      select r.id into rid
      from public.repos r
      where r.company_id = p_company
        and r.github_full_name = repo_name;
    else
      select r.id into rid
      from public.repos r
      where r.company_id = p_company
        and r.github_full_name = repo_name
        and r.source_branch = born
        and r.default_branch = lands;
      if rid is null then
        raise exception 'repo no encontrado';
      end if;
    end if;

    if pg_catalog.array_position(ids, rid) is null then
      ids := ids || rid;
    end if;
  end loop;

  return ids;
end;
$$;

revoke all on function private.resolve_repo_ids(uuid, text[]) from public, anon, authenticated;
grant execute on function private.resolve_repo_ids(uuid, text[]) to postgres;

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

  ids := private.resolve_repo_ids(ctx.company_id, p_repos);

  delete from public.ticket_repos
  where company_id = ctx.company_id
    and ticket_id = rec.id;

  insert into public.ticket_repos (company_id, ticket_id, repo_id)
  select ctx.company_id, rec.id, repo_id
  from unnest(ids) as repo_id;
  get diagnostics inserted = row_count;

  if inserted is distinct from coalesce(pg_catalog.cardinality(ids), 0) then
    raise exception 'repo no encontrado';
  end if;

  select coalesce(jsonb_agg(
    private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
    order by r.github_full_name, r.source_branch, r.default_branch
  ), '[]'::jsonb) into linked
  from public.ticket_repos tr
  join public.repos r on r.company_id = tr.company_id and r.id = tr.repo_id
  where tr.ticket_id = rec.id;

  select string_agg(
    (item ->> 'repo') || ' ' || (item ->> 'fromBranch') || ' → ' || (item ->> 'pullBranch'),
    ', ' order by item ->> 'repo'
  ) into names
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

create or replace function public.agent_create_ticket(
  p_token text,
  p_title text,
  p_body text default '',
  p_kind text default 'ticket',
  p_priority int default 3,
  p_estimate text default 'm',
  p_autonomy text default 'suggest',
  p_assignee text default null,
  p_status text default null,
  p_sprint text default null,
  p_version text default null,
  p_categories text[] default '{}',
  p_repos text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  created jsonb;
  tid uuid;
  assignee uuid;
  assignee_name text;
  sprint uuid;
  sprint_name text;
  version uuid;
  version_name text;
  status public.statuses;
  opened public.statuses;
  category_ids uuid[];
  category_names text[];
  repo_ids uuid[];
  linked jsonb;
  wanted text[];
  detail text;
  kind_name text;
  found int;
  born uuid;
begin
  p_body := coalesce(p_body, '');
  p_kind := coalesce(p_kind, 'ticket');
  p_priority := coalesce(p_priority, 3);
  p_estimate := coalesce(p_estimate, 'm');
  p_autonomy := coalesce(p_autonomy, 'suggest');
  if p_kind is null or p_kind not in ('ticket', 'request') then
    raise exception 'el tipo tiene que ser ticket o request';
  end if;
  if p_priority is null or p_priority not between 1 and 4 then
    raise exception 'la prioridad va de 1 a 4';
  end if;
  if private.estimate_rank(p_estimate) is null then
    raise exception 'el tamaño tiene que ser xs, s, m o l';
  end if;
  if p_autonomy is null or p_autonomy not in ('suggest', 'pull', 'human') then
    raise exception 'la autonomía tiene que ser suggest, pull o human';
  end if;

  select * into ctx from private.agent_context(p_token);

  if nullif(btrim(coalesce(p_assignee, '')), '') is not null then
    select count(*)::int into found
    from public.company_members m
    where m.company_id = ctx.company_id
      and lower(m.alias) = lower(btrim(p_assignee));
    if found = 0 then
      raise exception 'miembro no encontrado';
    end if;
    if found > 1 then
      raise exception 'hay más de un miembro con ese alias';
    end if;
    select m.user_id, m.alias into assignee, assignee_name
    from public.company_members m
    where m.company_id = ctx.company_id
      and lower(m.alias) = lower(btrim(p_assignee));
  end if;

  if nullif(btrim(coalesce(p_sprint, '')), '') is not null then
    select count(*)::int into found
    from public.sprints s
    where s.company_id = ctx.company_id
      and lower(btrim(s.name)) = lower(btrim(p_sprint));
    if found = 0 then
      raise exception 'sprint no encontrado';
    end if;
    if found > 1 then
      raise exception 'hay más de un sprint con ese nombre';
    end if;
    select s.id, s.name into sprint, sprint_name
    from public.sprints s
    where s.company_id = ctx.company_id
      and lower(btrim(s.name)) = lower(btrim(p_sprint));
  end if;

  if nullif(btrim(coalesce(p_version, '')), '') is not null then
    select count(*)::int into found
    from public.versions v
    where v.company_id = ctx.company_id
      and lower(btrim(v.name)) = lower(btrim(p_version));
    if found = 0 then
      raise exception 'versión no encontrada';
    end if;
    if found > 1 then
      raise exception 'hay más de una versión con ese nombre';
    end if;
    select v.id, v.name into version, version_name
    from public.versions v
    where v.company_id = ctx.company_id
      and lower(btrim(v.name)) = lower(btrim(p_version));
  end if;

  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    status := private.agent_status(ctx.company_id, p_status);
  end if;

  if p_categories is null then
    p_categories := '{}';
  end if;
  if exists (
    select 1 from unnest(p_categories) as item
    where btrim(coalesce(item, '')) = ''
  ) then
    raise exception 'categoría no encontrada';
  end if;
  select coalesce(array_agg(distinct btrim(item)), '{}'::text[]) into wanted
  from unnest(p_categories) as item
  where btrim(coalesce(item, '')) <> '';
  select coalesce(array_agg(c.id), '{}'::uuid[]), coalesce(array_agg(c.name order by c.name), '{}'::text[])
  into category_ids, category_names
  from public.categories c
  where c.company_id = ctx.company_id
    and lower(btrim(c.name)) = any (select lower(name) from unnest(wanted) as name);
  if coalesce(pg_catalog.cardinality(category_ids), 0) is distinct from coalesce(pg_catalog.cardinality(wanted), 0) then
    raise exception 'categoría no encontrada';
  end if;

  if p_repos is null then
    p_repos := '{}';
  end if;
  repo_ids := private.resolve_repo_ids(ctx.company_id, p_repos);
  select coalesce(jsonb_agg(
    private.repo_card(r.github_full_name, r.source_branch, r.default_branch)
    order by r.github_full_name, r.source_branch, r.default_branch
  ), '[]'::jsonb)
  into linked
  from public.repos r
  where r.company_id = ctx.company_id
    and r.id = any (repo_ids);

  kind_name := case when p_kind = 'request' then 'Requerimiento' else 'Ticket' end;
  detail := 'Tipo' || E'\n' || kind_name;
  if nullif(btrim(coalesce(p_body, '')), '') is not null then
    detail := detail || E'\n\n' || btrim(p_body);
  end if;
  if char_length(detail) > 8000 then
    raise exception 'el reporte es demasiado largo';
  end if;

  created := private.insert_ticket(ctx.company_id, p_title, detail, null, null);
  tid := (created ->> 'id')::uuid;

  select * into opened from public.statuses where id = (
    select t.status_id from public.tickets t where t.id = tid
  );
  born := opened.id;
  if nullif(btrim(coalesce(p_status, '')), '') is not null then
    opened := status;
  end if;

  update public.tickets
    set priority = p_priority,
        estimate = p_estimate,
        autonomy = p_autonomy,
        assignee_id = assignee,
        sprint_id = sprint,
        version_id = version,
        status_id = opened.id,
        resume_status_id = case
          when opened.kind = 'pause' and opened.id is distinct from born then born
          else null
        end
  where id = tid;

  insert into public.ticket_categories (company_id, ticket_id, category_id)
  select ctx.company_id, tid, category_id
  from unnest(category_ids) as category_id;

  insert into public.ticket_repos (company_id, ticket_id, repo_id)
  select ctx.company_id, tid, repo_id
  from unnest(repo_ids) as repo_id;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (ctx.company_id, tid, 'internal', 'El agente registró el ticket.');

  return jsonb_build_object(
    'id', tid,
    'key', private.ticket_key(ctx.company_id, (created ->> 'number')::int),
    'title', btrim(p_title),
    'type', kind_name,
    'status', opened.name,
    'priority', p_priority,
    'estimate', p_estimate,
    'autonomy', p_autonomy,
    'assignee', assignee_name,
    'sprint', sprint_name,
    'version', version_name,
    'categories', to_jsonb(category_names),
    'repos', linked
  );
end;
$$;

revoke all on function public.agent_create_ticket(text, text, text, text, int, text, text, text, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.agent_create_ticket(text, text, text, text, int, text, text, text, text, text, text, text[], text[]) to anon, authenticated;

notify pgrst, 'reload schema';
