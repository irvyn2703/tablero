-- The tracking hash changes only while the stored token is still empty.
-- A dark fondo is ignored by the page. The public logo list is closed.

alter table public.tickets
  add column view_token_rotated boolean not null default false;

alter table public.tickets
  add constraint tickets_view_token_check
  check (
    view_token = ''
    or (
      view_token ~ '^[0-9a-f]{64}$'
      and view_token_hash = private.sha256_hex(view_token)
    )
  );

create or replace function private.tickets_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_kind text;
  resume_kind text;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.public_number is distinct from old.public_number
    or (
      new.view_token_hash is distinct from old.view_token_hash
      and old.view_token <> ''
    )
  ) then
    raise exception 'el ticket no cambia de empresa';
  end if;

  select s.kind into current_kind
  from public.statuses s
  where s.id = new.status_id
    and s.company_id = new.company_id;

  if current_kind is null then
    raise exception 'el estado no es de esta empresa';
  end if;

  if current_kind = 'pause' then
    if new.resume_status_id is null then
      raise exception 'una pausa necesita estado de reanudación';
    end if;
    select s.kind into resume_kind
    from public.statuses s
    where s.id = new.resume_status_id
      and s.company_id = new.company_id;
    if resume_kind is distinct from 'work' then
      raise exception 'el estado de reanudación tiene que ser de trabajo';
    end if;
  else
    new.resume_status_id := null;
  end if;

  return new;
end;
$$;

create or replace function public.tracking_link(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.tickets;
  secret text;
begin
  select * into ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if ticket.id is null or not private.can_edit(ticket.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  if ticket.view_token <> '' then
    return jsonb_build_object('token', ticket.view_token, 'renewed', ticket.view_token_rotated);
  end if;

  secret := private.new_secret();

  update public.tickets
  set view_token = secret,
      view_token_hash = private.sha256_hex(secret),
      view_token_rotated = true
  where id = ticket.id;

  return jsonb_build_object('token', secret, 'renewed', true);
end;
$$;

drop policy if exists company_logos_intake_read on storage.objects;

drop function if exists private.logo_on_intake(text);

create or replace function public.read_intake(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
  company public.companies;
begin
  link := private.intake_link(p_token);
  select * into company from public.companies c where c.id = link.company_id;
  return jsonb_build_object(
    'companyName', company.name,
    'label', link.label,
    'brandColor', company.brand_color,
    'accentColor', company.accent_color,
    'backgroundColor', company.background_color
  );
end;
$$;

notify pgrst, 'reload schema';
