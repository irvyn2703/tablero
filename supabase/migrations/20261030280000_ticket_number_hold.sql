-- The next ticket number only moves forward. Deleting a ticket leaves the hole.

alter table public.companies
  add column next_public_number int;

update public.companies as company
set next_public_number = coalesce((
  select max(ticket.public_number)
  from public.tickets as ticket
  where ticket.company_id = company.id
), 0) + 1;

alter table public.companies
  alter column next_public_number set not null,
  alter column next_public_number set default 1;

alter table public.companies
  add constraint companies_next_public_number_check check (next_public_number > 0);

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

create or replace function private.allow_message(p_ticket_id uuid, p_side text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.tickets
  where id = p_ticket_id
  for update;

  if (
    select count(*)
    from public.ticket_messages
    where ticket_id = p_ticket_id
  ) >= 200 then
    raise exception 'este ticket ya tiene muchos mensajes';
  end if;

  if p_side = 'reporte' and (
    select count(*)
    from public.ticket_messages
    where ticket_id = p_ticket_id
      and side = 'reporte'
      and created_at > pg_catalog.now() - interval '1 minute'
  ) >= 4 then
    raise exception 'espera un momento para enviar otro mensaje';
  end if;
end;
$$;

notify pgrst, 'reload schema';
