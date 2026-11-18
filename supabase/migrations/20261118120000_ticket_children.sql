-- A parent ticket is the summary of its children. One level only.
-- The parent's column is the child furthest behind. Its bar is the
-- estimate-weighted average of the children that still count.
-- A pause counts unless that status allows delete: that column is the discard pile.

alter table public.tickets
  add column parent_id uuid;

alter table public.tickets
  add constraint tickets_parent_fk
  foreign key (company_id, parent_id)
  references public.tickets (company_id, id);

create index tickets_parent_idx on public.tickets (parent_id);

grant select (parent_id) on public.tickets to authenticated;

create or replace function private.estimate_weight(p_estimate text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_estimate
    when 'xs' then 1
    when 's' then 2
    when 'm' then 3
    when 'l' then 5
    else 3
  end;
$$;

create or replace function private.child_counts(p_kind text, p_allows_delete boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not (p_kind = 'pause' and coalesce(p_allows_delete, false));
$$;

create or replace function private.rolled_progress(p_parent uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(
    sum(private.estimate_weight(c.estimate)::numeric * private.measure_progress(c.id))
    / nullif(sum(private.estimate_weight(c.estimate))::numeric, 0),
    1
  )
  from public.tickets c
  join public.statuses s on s.id = c.status_id
  where c.parent_id = p_parent
    and private.child_counts(s.kind, s.allows_delete);
$$;

create or replace function private.has_children(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.tickets c where c.parent_id = p_ticket);
$$;

create or replace function private.bottleneck_status(p_parent uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.tickets c
  join public.statuses s on s.id = c.status_id
  where c.parent_id = p_parent
  order by
    case
      when s.kind = 'pause' and not coalesce(s.allows_delete, false) then 0
      when private.child_counts(s.kind, s.allows_delete) then 1
      else 2
    end,
    s.position
  limit 1;
$$;

create or replace function private.sync_parent(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.tickets;
  next_status uuid;
  next_kind text;
  resume uuid;
  progress numeric;
  status_name text;
  opened uuid;
  opened_name text;
begin
  if p_parent is null then
    return;
  end if;

  select * into parent from public.tickets where id = p_parent for update;
  if parent.id is null then
    return;
  end if;
  if not private.has_children(parent.id) then
    select s.id, s.name into opened, opened_name
    from public.statuses s
    where s.company_id = parent.company_id
      and s.kind = 'work'
    order by s.position
    limit 1;
    if opened is null then
      return;
    end if;
    update public.tickets
      set status_id = opened,
          local_percent = 0,
          resume_status_id = null,
          agent_token_id = null,
          agent_lease_until = null
    where id = parent.id;
    if parent.status_id is distinct from opened or parent.local_percent <> 0 then
      insert into public.ticket_events (company_id, ticket_id, visibility, body)
      values (
        parent.company_id,
        parent.id,
        'public',
        format('%s · %s%%', opened_name, trim(to_char(0, 'FM990.0')))
      );
    end if;
    return;
  end if;

  next_status := private.bottleneck_status(parent.id);
  progress := coalesce(private.rolled_progress(parent.id), 0);
  select s.kind into next_kind from public.statuses s where s.id = next_status;
  resume := null;
  if next_kind = 'pause' then
    select s.id into resume
    from public.statuses s
    where s.company_id = parent.company_id
      and s.kind = 'work'
    order by s.position
    limit 1;
  end if;

  update public.tickets
    set status_id = next_status,
        resume_status_id = resume,
        agent_token_id = null,
        agent_lease_until = null
  where id = parent.id;

  if parent.status_id is distinct from next_status then
    select s.name into status_name from public.statuses s where s.id = next_status;
    insert into public.ticket_events (company_id, ticket_id, visibility, body)
    values (
      parent.company_id,
      parent.id,
      'public',
      format('%s · %s%%', status_name, trim(to_char(progress, 'FM990.0')))
    );
  end if;
end;
$$;

create or replace function private.guard_ticket_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.tickets;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'un ticket no es hijo de sí mismo';
  end if;

  select * into parent
  from public.tickets
  where id = new.parent_id
    and company_id = new.company_id;

  if parent.id is null then
    raise exception 'el padre no es de esta empresa';
  end if;
  if parent.parent_id is not null then
    raise exception 'un hijo no tiene hijos';
  end if;
  if exists (select 1 from public.tickets c where c.parent_id = new.id) then
    raise exception 'un padre no puede ser hijo';
  end if;
  if new.sprint_id is not null or new.version_id is not null then
    raise exception 'el hijo no lleva sprint ni versión';
  end if;

  return new;
end;
$$;

create trigger tickets_parent_guard
before insert or update on public.tickets
for each row
execute function private.guard_ticket_parent();

create or replace function private.measure_progress(p_ticket_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  current_kind text;
  measured_id uuid;
  measured_weight int;
  measured_position int;
  prior numeric;
begin
  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null then
    return null;
  end if;

  if private.has_children(rec.id) then
    return coalesce(private.rolled_progress(rec.id), 0);
  end if;

  select s.kind into current_kind
  from public.statuses s
  where s.id = rec.status_id;

  if current_kind = 'close' then
    return 100;
  end if;

  measured_id := case when current_kind = 'pause' then rec.resume_status_id else rec.status_id end;

  select s.weight, s.position into measured_weight, measured_position
  from public.statuses s
  where s.id = measured_id
    and s.company_id = rec.company_id
    and s.kind = 'work';

  if measured_position is null then
    return 0;
  end if;

  select coalesce(sum(s.weight), 0) into prior
  from public.statuses s
  where s.company_id = rec.company_id
    and s.kind = 'work'
    and s.position < measured_position;

  return round(prior + (rec.local_percent::numeric / 100) * measured_weight, 1);
end;
$$;

create or replace function private.apply_progress(
  p_ticket_id uuid,
  p_status_id uuid,
  p_local int
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  cur public.statuses;
  nxt public.statuses;
  measured public.statuses;
  new_local int;
  new_resume uuid;
  progress numeric;
begin
  if p_local is not null and p_local not between 0 and 100 then
    raise exception 'el porcentaje va de 0 a 100';
  end if;

  select * into rec from public.tickets where id = p_ticket_id for update;
  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;
  if private.has_children(rec.id) then
    raise exception 'el padre se mueve con sus hijos';
  end if;

  select * into cur from public.statuses where id = rec.status_id;
  select * into nxt
  from public.statuses
  where id = coalesce(p_status_id, rec.status_id)
    and company_id = rec.company_id;

  if nxt.id is null then
    raise exception 'el estado no es de esta empresa';
  end if;

  if nxt.kind = 'pause' then
    if cur.kind = 'close' then
      raise exception 'un ticket listo no pasa a pausa';
    end if;
    new_resume := case when cur.kind = 'pause' then rec.resume_status_id else cur.id end;
    new_local := coalesce(p_local, rec.local_percent);
  elsif nxt.kind = 'close' then
    new_resume := null;
    new_local := coalesce(p_local, rec.local_percent);
  else
    if cur.kind = 'pause' then
      select * into measured from public.statuses where id = rec.resume_status_id;
    elsif cur.kind = 'work' then
      measured := cur;
    end if;

    if cur.kind = 'close' then
      new_local := coalesce(p_local, 100);
    elsif measured.id is null or nxt.position > measured.position then
      new_local := coalesce(p_local, 0);
    elsif nxt.position < measured.position then
      new_local := coalesce(p_local, 100);
    else
      new_local := coalesce(p_local, rec.local_percent);
    end if;
    new_resume := null;
  end if;

  update public.tickets
    set status_id = nxt.id,
        resume_status_id = new_resume,
        local_percent = new_local
  where id = rec.id;

  progress := private.measure_progress(rec.id);

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (
    rec.company_id,
    rec.id,
    'public',
    format('%s · %s%%', nxt.name, trim(to_char(progress, 'FM990.0')))
  );

  if rec.parent_id is not null then
    perform private.sync_parent(rec.parent_id);
  end if;

  return rec.id;
end;
$$;

create or replace function private.delete_ticket_row(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
begin
  select * into rec from public.tickets where id = p_ticket_id for update;
  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;
  if private.has_children(rec.id) then
    raise exception 'quita los hijos antes de borrar el padre';
  end if;

  delete from public.tickets where id = rec.id;

  if rec.parent_id is not null then
    perform private.sync_parent(rec.parent_id);
  end if;
end;
$$;

create or replace function public.delete_ticket(p_ticket_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  allowed boolean;
  paths text[];
begin
  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rec.company_id::text));

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;

  select s.allows_delete into allowed
  from public.statuses s
  where s.id = rec.status_id
    and s.company_id = rec.company_id;

  if not coalesce(allowed, false) then
    raise exception 'este estado no permite borrar tickets';
  end if;

  select coalesce(array_agg(f.object_path), '{}'::text[]) into paths
  from public.ticket_files f
  where f.ticket_id = rec.id;

  perform private.delete_ticket_row(rec.id);
  return paths;
end;
$$;

create or replace function public.create_child_ticket(
  p_parent_id uuid,
  p_title text,
  p_estimate text,
  p_priority int,
  p_autonomy text,
  p_assignee_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent public.tickets;
  made jsonb;
  child uuid;
begin
  if p_estimate not in ('xs', 's', 'm', 'l') then
    raise exception 'el tamaño no es válido';
  end if;
  if p_priority is null or p_priority not between 1 and 4 then
    raise exception 'la prioridad va de 1 a 4';
  end if;
  if p_autonomy not in ('suggest', 'pull', 'human') then
    raise exception 'esa autonomía no existe';
  end if;

  select * into parent from public.tickets where id = p_parent_id for update;
  if parent.id is null or not private.can_edit(parent.company_id) then
    raise exception 'ticket no encontrado';
  end if;
  if parent.parent_id is not null then
    raise exception 'un hijo no tiene hijos';
  end if;
  if p_assignee_id is not null and not exists (
    select 1
    from public.company_members m
    where m.company_id = parent.company_id
      and m.user_id = p_assignee_id
  ) then
    raise exception 'el asignado no es de la empresa';
  end if;

  made := private.insert_ticket(parent.company_id, p_title, '', null, null);
  child := (made ->> 'id')::uuid;

  update public.tickets
    set parent_id = parent.id,
        estimate = p_estimate,
        priority = p_priority,
        autonomy = p_autonomy,
        assignee_id = p_assignee_id
  where id = child;

  perform private.sync_parent(parent.id);
  return made;
end;
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
      and not private.has_children(t.id)
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
    and not private.has_children(t.id)
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
  t.parent_id,
  s.name as status_name,
  s.kind as status_kind,
  s.position as status_position,
  private.ticket_progress(t.id) as progress,
  t.rank,
  t.version_id
from public.tickets t
join public.statuses s on s.id = t.status_id;

revoke all on function private.has_children(uuid) from public, anon, authenticated;
revoke all on function private.estimate_weight(text) from public, anon, authenticated;
revoke all on function private.child_counts(text, boolean) from public, anon, authenticated;
revoke all on function private.rolled_progress(uuid) from public, anon, authenticated;
revoke all on function private.bottleneck_status(uuid) from public, anon, authenticated;
revoke all on function private.sync_parent(uuid) from public, anon, authenticated;
revoke all on function private.guard_ticket_parent() from public, anon, authenticated;
revoke all on function private.delete_ticket_row(uuid) from public, anon, authenticated;
revoke all on function public.create_child_ticket(uuid, text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function public.create_child_ticket(uuid, text, text, int, text, uuid) to authenticated;

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
    and parent_id is not distinct from rec.parent_id
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

  perform private.reseat_ticket(rec.company_id, rec.id, neighbor.id, p_direction < 0);
end;
$$;

create or replace function public.place_ticket(p_ticket_id uuid, p_target_id uuid, p_before boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  target public.tickets;
begin
  if p_ticket_id = p_target_id then
    return;
  end if;

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rec.company_id::text));

  select * into rec from public.tickets where id = p_ticket_id;
  select * into target from public.tickets where id = p_target_id;
  if target.id is null
    or target.company_id is distinct from rec.company_id
    or target.status_id is distinct from rec.status_id
    or target.parent_id is distinct from rec.parent_id then
    return;
  end if;

  perform private.reseat_ticket(rec.company_id, rec.id, target.id, p_before);
end;
$$;

create or replace function public.set_statuses(
  p_company_id uuid,
  p_rows jsonb,
  p_remap jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(p_company_id) then
    raise exception 'no autorizado';
  end if;
  perform private.set_statuses(p_company_id, p_rows, coalesce(p_remap, '{}'::jsonb));
  perform private.sync_parent(p.id)
  from public.tickets p
  where p.company_id = p_company_id
    and private.has_children(p.id);
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
      and not private.has_children(t.id)
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

notify pgrst, 'reload schema';
