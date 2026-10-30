-- Free hex colors. Existing palette tokens become the swatch they already showed.

alter table public.statuses drop constraint statuses_color_check;

update public.statuses
set color = case color
  when 'sand' then '#c4a574'
  when 'brass' then '#8d6b3a'
  when 'pine' then '#1c3d34'
  when 'slate' then '#3d5560'
  when 'moss' then '#3f6b4a'
  when 'clay' then '#8c4a3a'
  when 'ink' then '#1c1915'
  when 'wine' then '#7c2e2e'
  else lower(color)
end;
alter table public.statuses alter column color set default '#1c3d34';
alter table public.statuses
  add constraint statuses_color_check check (color ~ '^#[0-9a-f]{6}$');

create or replace function private.seed_statuses(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.statuses (company_id, name, position, kind, weight, color)
  values
    (p_company, 'Recibido', 1, 'work', 10, '#c4a574'),
    (p_company, 'En cola', 2, 'work', 5, '#8d6b3a'),
    (p_company, 'En curso', 3, 'work', 80, '#1c3d34'),
    (p_company, 'En revisión', 4, 'work', 5, '#3d5560'),
    (p_company, 'Listo', 5, 'close', 0, '#1c1915'),
    (p_company, 'Falta información', 6, 'pause', 0, '#7c2e2e'),
    (p_company, 'Descartado', 7, 'pause', 0, '#8c4a3a');
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
    weight int,
    color text
  ) on commit drop;

  for ord in 1 .. jsonb_array_length(p_rows)
  loop
    element := p_rows -> (ord - 1);
    insert into desired (ord, id, name, kind, weight, color)
    values (
      ord,
      nullif(element ->> 'id', '')::uuid,
      btrim(element ->> 'name'),
      element ->> 'kind',
      coalesce((element ->> 'weight')::int, 0),
      lower(coalesce(nullif(btrim(element ->> 'color'), ''), '#1c3d34'))
    );
  end loop;

  if exists (select 1 from desired where name is null or name = '') then
    raise exception 'cada estado lleva nombre';
  end if;
  if exists (select 1 from desired where kind not in ('work', 'close', 'pause')) then
    raise exception 'tipo de estado inválido';
  end if;
  if exists (select 1 from desired where color !~ '^#[0-9a-f]{6}$') then
    raise exception 'color de estado inválido';
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
        color = d.color,
        position = d.ord
  from desired d
  where s.id = d.id
    and s.company_id = p_company;

  insert into public.statuses (id, company_id, name, position, kind, weight, color)
  select d.id, p_company, d.name, d.ord, d.kind, d.weight, d.color
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

notify pgrst, 'reload schema';
