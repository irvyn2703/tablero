-- The agent can file a ticket with the same choices as the dev form.
-- Omitted choices keep the form defaults. Names are resolved before the insert,
-- so a bad name does not leave a ticket behind.

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
  repo_names text[];
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
  if exists (
    select 1 from unnest(p_repos) as item
    where btrim(coalesce(item, '')) = ''
  ) then
    raise exception 'repo no encontrado';
  end if;
  select coalesce(array_agg(distinct btrim(item)), '{}'::text[]) into wanted
  from unnest(p_repos) as item
  where btrim(coalesce(item, '')) <> '';
  select coalesce(array_agg(r.id), '{}'::uuid[]), coalesce(array_agg(r.github_full_name order by r.github_full_name), '{}'::text[])
  into repo_ids, repo_names
  from public.repos r
  where r.company_id = ctx.company_id
    and r.github_full_name = any (wanted);
  if coalesce(pg_catalog.cardinality(repo_ids), 0) is distinct from coalesce(pg_catalog.cardinality(wanted), 0) then
    raise exception 'repo no encontrado';
  end if;

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
    'repos', to_jsonb(repo_names)
  );
end;
$$;

revoke all on function public.agent_create_ticket(text, text, text, text, int, text, text, text, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.agent_create_ticket(text, text, text, text, int, text, text, text, text, text, text, text[], text[]) to anon, authenticated;

notify pgrst, 'reload schema';
