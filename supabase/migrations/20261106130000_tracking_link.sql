-- Members can copy the reporter tracking link again from the ticket.
-- Tickets created before this column existed get a new link the first time.

alter table public.tickets
  add column view_token text not null default '';

create or replace function private.tickets_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_kind text;
  resume_kind text;
  rotating text;
begin
  rotating := coalesce(pg_catalog.current_setting('tablero.rotate_view_token', true), '');

  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.public_number is distinct from old.public_number
    or (
      new.view_token_hash is distinct from old.view_token_hash
      and rotating is distinct from 'on'
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

  update public.companies
  set next_public_number = next_public_number + 1
  where id = p_company
  returning next_public_number - 1 into number;

  if number is null then
    raise exception 'empresa no encontrada';
  end if;

  secret := private.new_secret();

  insert into public.tickets (
    company_id, public_number, title, body, contact_email, status_id, view_token, view_token_hash, intake_link_id
  )
  values (
    p_company,
    number,
    btrim(p_title),
    coalesce(p_body, ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    sid,
    secret,
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

  if ticket.id is null or not private.is_member(ticket.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  if ticket.view_token <> '' then
    return jsonb_build_object('token', ticket.view_token, 'renewed', false);
  end if;

  secret := private.new_secret();
  perform pg_catalog.set_config('tablero.rotate_view_token', 'on', true);

  update public.tickets
  set view_token = secret,
      view_token_hash = private.sha256_hex(secret)
  where id = ticket.id;

  return jsonb_build_object('token', secret, 'renewed', true);
end;
$$;

revoke all on function public.tracking_link(uuid) from public, anon, authenticated;
grant execute on function public.tracking_link(uuid) to authenticated;

notify pgrst, 'reload schema';
