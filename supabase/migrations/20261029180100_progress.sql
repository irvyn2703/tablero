-- Progress is computed in one place. Status and percent have one writer.

create or replace function private.sha256_hex(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_raw, 'utf8'), 'sha256'), 'hex');
$$;

create or replace function private.new_secret()
returns text
language sql
volatile
set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(32), 'hex');
$$;

create or replace function private.seed_statuses(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.statuses (company_id, name, position, kind, weight)
  values
    (p_company, 'Recibido', 1, 'work', 10),
    (p_company, 'En cola', 2, 'work', 5),
    (p_company, 'En curso', 3, 'work', 80),
    (p_company, 'En revisión', 4, 'work', 5),
    (p_company, 'Listo', 5, 'close', 0),
    (p_company, 'Falta información', 6, 'pause', 0),
    (p_company, 'Descartado', 7, 'pause', 0);
end;
$$;

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

create or replace function private.ticket_progress(p_ticket_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select t.company_id into company from public.tickets t where t.id = p_ticket_id;
  if company is null then
    return null;
  end if;
  if (select auth.uid()) is not null and not private.is_member(company) then
    raise exception 'ticket no encontrado';
  end if;
  return private.measure_progress(p_ticket_id);
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

  return rec.id;
end;
$$;

create or replace function private.insert_ticket(
  p_company uuid,
  p_title text,
  p_body text,
  p_email text,
  p_intake uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
  number int;
  secret text;
  tid uuid;
begin
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'el título es obligatorio';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_company::text));

  select s.id into sid
  from public.statuses s
  where s.company_id = p_company
    and s.kind = 'work'
  order by s.position
  limit 1;

  if sid is null then
    raise exception 'la empresa no tiene estados de trabajo';
  end if;

  select coalesce(max(t.public_number), 0) + 1 into number
  from public.tickets t
  where t.company_id = p_company;

  secret := private.new_secret();

  insert into public.tickets (
    company_id, public_number, title, body, contact_email, status_id, view_token_hash, intake_link_id
  )
  values (
    p_company,
    number,
    btrim(p_title),
    coalesce(p_body, ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    sid,
    private.sha256_hex(secret),
    p_intake
  )
  returning id into tid;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values (p_company, tid, 'public', 'El ticket quedó registrado.');

  return jsonb_build_object(
    'id', tid,
    'number', number,
    'viewToken', secret
  );
end;
$$;

create or replace function private.set_statuses(p_company uuid, p_rows jsonb, p_remap jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  element jsonb;
  ord int := 0;
  work_sum int;
  close_count int;
  removed record;
  target uuid;
  target_kind text;
begin
  if not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'empresa no encontrada';
  end if;

  perform 1 from public.companies where id = p_company for update;

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) < 1 then
    raise exception 'el flujo necesita estados';
  end if;

  drop table if exists pg_temp.desired;
  create temp table desired (
    ord int primary key,
    id uuid,
    name text,
    kind text,
    weight int
  ) on commit drop;

  for ord in 1 .. jsonb_array_length(p_rows)
  loop
    element := p_rows -> (ord - 1);
    insert into desired (ord, id, name, kind, weight)
    values (
      ord,
      nullif(element ->> 'id', '')::uuid,
      btrim(element ->> 'name'),
      element ->> 'kind',
      coalesce((element ->> 'weight')::int, 0)
    );
  end loop;

  if exists (select 1 from desired where name is null or name = '') then
    raise exception 'cada estado lleva nombre';
  end if;
  if exists (select 1 from desired where kind not in ('work', 'close', 'pause')) then
    raise exception 'tipo de estado inválido';
  end if;
  if exists (select 1 from desired where kind <> 'work' and weight <> 0) then
    raise exception 'solo el trabajo lleva peso';
  end if;
  if exists (select 1 from desired where weight < 0 or weight > 100) then
    raise exception 'peso fuera de rango';
  end if;

  select count(*) into close_count from desired where kind = 'close';
  select coalesce(sum(weight), 0) into work_sum from desired where kind = 'work';
  if close_count <> 1 then
    raise exception 'hace falta un solo cierre';
  end if;
  if work_sum <> 100 then
    raise exception 'los pesos de trabajo suman %', work_sum;
  end if;

  update desired set id = extensions.gen_random_uuid() where id is null;

  if exists (
    select 1
    from desired d
    join public.statuses s on s.id = d.id
    where s.company_id <> p_company
  ) then
    raise exception 'estado de otra empresa';
  end if;

  if exists (
    select 1
    from desired d
    join public.statuses s on s.id = d.id and s.company_id = p_company
    join public.tickets t on t.status_id = d.id
    where s.kind is distinct from d.kind
      and d.kind = 'pause'
  ) then
    raise exception 'no puedes volver pausa un estado con tickets';
  end if;

  update public.statuses
    set position = position + 1000
  where company_id = p_company;

  update public.statuses s
    set name = d.name,
        kind = d.kind,
        weight = d.weight,
        position = d.ord
  from desired d
  where s.id = d.id
    and s.company_id = p_company;

  insert into public.statuses (id, company_id, name, position, kind, weight)
  select d.id, p_company, d.name, d.ord, d.kind, d.weight
  from desired d
  where not exists (
    select 1 from public.statuses s where s.id = d.id
  );

  for removed in
    select s.id
    from public.statuses s
    where s.company_id = p_company
      and s.position > 1000
  loop
    if exists (
      select 1 from public.tickets t
      where t.company_id = p_company
        and (t.status_id = removed.id or t.resume_status_id = removed.id)
    ) then
      target := nullif(p_remap ->> removed.id::text, '')::uuid;
      if target is null or not exists (select 1 from desired d where d.id = target) then
        raise exception 'hay tickets en un estado que se quita';
      end if;
      select d.kind into target_kind from desired d where d.id = target;
      if target_kind = 'pause' then
        raise exception 'el reemplazo no puede ser una pausa';
      end if;
      if exists (select 1 from public.tickets t where t.resume_status_id = removed.id)
        and target_kind <> 'work' then
        raise exception 'el reemplazo de un estado de trabajo tiene que ser de trabajo';
      end if;

      update public.tickets t
        set status_id = case when t.status_id = removed.id then target else t.status_id end,
            resume_status_id = case
              when t.resume_status_id = removed.id then target
              else t.resume_status_id
            end
      where t.company_id = p_company
        and (t.status_id = removed.id or t.resume_status_id = removed.id);
    end if;
  end loop;

  update public.tickets t
    set resume_status_id = null
  from public.statuses s
  where t.status_id = s.id
    and t.company_id = p_company
    and s.kind <> 'pause'
    and t.resume_status_id is not null;

  delete from public.statuses s
  where s.company_id = p_company
    and s.position > 1000;

  if (
    select count(*) from public.statuses s
    where s.company_id = p_company and s.kind = 'close'
  ) <> 1
  or (
    select coalesce(sum(s.weight), 0) from public.statuses s
    where s.company_id = p_company and s.kind = 'work'
  ) <> 100 then
    raise exception 'el flujo quedó inconsistente';
  end if;
end;
$$;

create or replace function public.create_company(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cid uuid;
  em text;
begin
  if uid is null then
    raise exception 'no autorizado';
  end if;

  select u.email into em from auth.users u where u.id = uid;
  if em is null or em = '' then
    raise exception 'tu cuenta no tiene correo';
  end if;

  insert into public.companies (name, slug)
  values (btrim(p_name), lower(btrim(p_slug)))
  returning id into cid;

  insert into public.company_members (company_id, user_id, email, role)
  values (cid, uid, lower(em), 'owner');

  perform private.seed_statuses(cid);
  return cid;
end;
$$;

create or replace function public.create_ticket(
  p_company_id uuid,
  p_title text,
  p_body text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_company_id) then
    raise exception 'no autorizado';
  end if;
  return private.insert_ticket(p_company_id, p_title, p_body, null, null);
end;
$$;

create or replace function public.set_ticket_progress(
  p_ticket_id uuid,
  p_status_id uuid,
  p_local int
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select t.company_id into company from public.tickets t where t.id = p_ticket_id;
  if company is null or not private.is_member(company) then
    raise exception 'ticket no encontrado';
  end if;
  perform private.apply_progress(p_ticket_id, p_status_id, p_local);
  return private.measure_progress(p_ticket_id);
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
  t.repo_id,
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

revoke all on function private.sha256_hex(text) from public, anon, authenticated;
revoke all on function private.new_secret() from public, anon, authenticated;
revoke all on function private.seed_statuses(uuid) from public, anon, authenticated;
revoke all on function private.measure_progress(uuid) from public, anon, authenticated;
revoke all on function private.ticket_progress(uuid) from public, anon, authenticated;
revoke all on function private.apply_progress(uuid, uuid, int) from public, anon, authenticated;
revoke all on function private.insert_ticket(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.set_statuses(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function private.ticket_progress(uuid) to authenticated;

revoke all on function public.create_company(text, text) from public, anon, authenticated;
revoke all on function public.create_ticket(uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_ticket_progress(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.set_statuses(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_company(text, text) to authenticated;
grant execute on function public.create_ticket(uuid, text, text) to authenticated;
grant execute on function public.set_ticket_progress(uuid, uuid, int) to authenticated;
grant execute on function public.set_statuses(uuid, jsonb, jsonb) to authenticated;

revoke all on public.ticket_rows from public, anon, authenticated;
grant select on public.ticket_rows to authenticated;
