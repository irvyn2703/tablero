-- Public links, invites, and the agent contract. Each one checks its own secret.

create or replace function private.intake_link(p_token text)
returns public.intake_links
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'liga no encontrada';
  end if;

  select * into link
  from public.intake_links
  where token_hash = private.sha256_hex(p_token)
    and active;

  if link.id is null then
    raise exception 'liga no encontrada';
  end if;
  return link;
end;
$$;

create or replace function public.read_intake(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
  company_name text;
begin
  link := private.intake_link(p_token);
  select c.name into company_name from public.companies c where c.id = link.company_id;
  return jsonb_build_object('companyName', company_name, 'label', link.label);
end;
$$;

create or replace function public.create_ticket_from_intake(
  p_token text,
  p_title text,
  p_body text default '',
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.intake_links;
  recent int;
begin
  link := private.intake_link(p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(link.id::text));

  select count(*) into recent
  from public.tickets t
  where t.intake_link_id = link.id
    and t.created_at > pg_catalog.now() - interval '1 hour';

  if recent >= link.hourly_limit then
    raise exception 'la liga llegó al límite de esta hora';
  end if;

  return private.insert_ticket(link.company_id, p_title, p_body, p_email, link.id);
end;
$$;

create or replace function public.read_public_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  status_name text;
  company_name text;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;

  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);

  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;

  select s.name into status_name from public.statuses s where s.id = rec.status_id;
  select c.name into company_name from public.companies c where c.id = rec.company_id;

  return jsonb_build_object(
    'number', rec.public_number,
    'title', rec.title,
    'companyName', company_name,
    'status', status_name,
    'progress', private.measure_progress(rec.id),
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('body', e.body, 'at', e.created_at)
        order by e.created_at
      )
      from public.ticket_events e
      where e.ticket_id = rec.id
        and e.visibility = 'public'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_invite(
  p_company_id uuid,
  p_email text,
  p_role text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
  clean text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.is_admin(p_company_id) then
    raise exception 'no autorizado';
  end if;
  if p_role not in ('admin', 'dev') then
    raise exception 'ese rol no se invita';
  end if;
  if clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'el correo no es válido';
  end if;

  secret := private.new_secret();
  insert into public.company_invites (company_id, email, role, token_hash, expires_at)
  values (p_company_id, clean, p_role, private.sha256_hex(secret), pg_catalog.now() + interval '14 days');
  return secret;
end;
$$;

create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.company_invites;
  em text;
  confirmed timestamptz;
begin
  if uid is null then
    raise exception 'no autorizado';
  end if;
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'invitación no encontrada';
  end if;

  select * into inv
  from public.company_invites
  where token_hash = private.sha256_hex(p_token)
    and accepted_at is null
    and expires_at > pg_catalog.now()
  for update;

  if inv.id is null then
    raise exception 'invitación no encontrada';
  end if;

  select u.email, u.email_confirmed_at into em, confirmed
  from auth.users u
  where u.id = uid;

  if confirmed is null then
    raise exception 'confirma tu correo antes de unirte';
  end if;
  if lower(em) <> inv.email then
    raise exception 'esta invitación es de otro correo';
  end if;

  insert into public.company_members (company_id, user_id, email, role)
  values (inv.company_id, uid, lower(em), inv.role)
  on conflict (company_id, user_id) do nothing;

  update public.company_invites
    set accepted_at = pg_catalog.now()
  where id = inv.id;

  return inv.company_id;
end;
$$;

create or replace function public.create_intake_link(p_company_id uuid, p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if not private.is_admin(p_company_id) then
    raise exception 'no autorizado';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'la liga necesita un nombre';
  end if;
  secret := private.new_secret();
  insert into public.intake_links (company_id, token_hash, label)
  values (p_company_id, private.sha256_hex(secret), btrim(p_label));
  return secret;
end;
$$;

create or replace function public.set_intake_active(p_link_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select company_id into company from public.intake_links where id = p_link_id;
  if company is null or not private.is_admin(company) then
    raise exception 'liga no encontrada';
  end if;
  update public.intake_links set active = p_active where id = p_link_id;
end;
$$;

create or replace function public.create_agent_token(p_company_id uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  if not private.is_admin(p_company_id) then
    raise exception 'no autorizado';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'el token necesita un nombre';
  end if;
  secret := private.new_secret();
  insert into public.agent_tokens (company_id, token_hash, name)
  values (p_company_id, private.sha256_hex(secret), btrim(p_name));
  return secret;
end;
$$;

create or replace function public.revoke_agent_token(p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
begin
  select company_id into company from public.agent_tokens where id = p_token_id;
  if company is null or not private.is_admin(company) then
    raise exception 'token no encontrado';
  end if;
  update public.agent_tokens
    set revoked_at = coalesce(revoked_at, pg_catalog.now())
  where id = p_token_id;
end;
$$;

create or replace function private.agent_context(p_token text)
returns table (token_id uuid, company_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  found public.agent_tokens;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'token no válido';
  end if;

  select * into found
  from public.agent_tokens
  where token_hash = private.sha256_hex(p_token)
    and revoked_at is null;

  if found.id is null then
    raise exception 'token no válido';
  end if;

  update public.agent_tokens
    set last_used_at = pg_catalog.now()
  where id = found.id;

  token_id := found.id;
  company_id := found.company_id;
  return next;
end;
$$;

create or replace function private.require_lease(p_token_id uuid, p_ticket_id uuid, p_company uuid)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
begin
  select * into rec
  from public.tickets
  where id = p_ticket_id
    and company_id = p_company
  for update;

  if rec.id is null
    or rec.agent_token_id is distinct from p_token_id
    or rec.agent_lease_until is null
    or rec.agent_lease_until <= pg_catalog.now()
  then
    raise exception 'la reserva no está vigente';
  end if;
  return rec;
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
      t.repo_id,
      t.created_at,
      s.name as status_name,
      private.measure_progress(t.id) as progress,
      r.github_full_name,
      r.default_branch,
      exists (
        select 1 from public.sprints sp
        where sp.id = t.sprint_id
          and pg_catalog.current_date between sp.starts_on and sp.ends_on
      ) as in_sprint
    from public.tickets t
    join public.statuses s on s.id = t.status_id
    left join public.repos r on r.id = t.repo_id
    where t.company_id = ctx.company_id
      and s.kind = 'work'
      and (t.agent_lease_until is null or t.agent_lease_until <= pg_catalog.now())
    order by in_sprint desc, t.priority asc, t.created_at asc
    limit 20
  ),
  numbered as (
    select
      ranked.*,
      row_number() over (
        order by in_sprint desc, priority asc, created_at asc
      ) as ordinal
    from ranked
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', n.id,
      'number', n.public_number,
      'title', n.title,
      'body', n.body,
      'priority', n.priority,
      'estimate', n.estimate,
      'autonomy', n.autonomy,
      'status', n.status_name,
      'progress', n.progress,
      'repo', n.github_full_name,
      'baseBranch', n.default_branch,
      'action', case
        when n.ordinal = 1
          and auto_on
          and n.estimate = max_estimate
          and n.autonomy = want_autonomy
          and n.repo_id is not null
        then 'ejecutar'
        else 'sugerir'
      end,
      'reason', case
        when n.ordinal = 1
          and auto_on
          and n.estimate = max_estimate
          and n.autonomy = want_autonomy
          and n.repo_id is not null
        then 'Cumple la política automática: tamaño permitido, autonomía de pull y repo asignado.'
        when n.ordinal = 1 and n.in_sprint then 'Es el primero del sprint activo.'
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
    'title', rec.title,
    'leaseUntil', rec.agent_lease_until
  );
end;
$$;

create or replace function public.agent_report_progress(
  p_token text,
  p_ticket_id uuid,
  p_status_id uuid default null,
  p_local int default null,
  p_note text default null,
  p_public boolean default false
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  rec public.tickets;
begin
  select * into ctx from private.agent_context(p_token);
  rec := private.require_lease(ctx.token_id, p_ticket_id, ctx.company_id);

  if p_status_id is not null or p_local is not null then
    perform private.apply_progress(rec.id, coalesce(p_status_id, rec.status_id), p_local);
  elsif p_note is null or btrim(p_note) = '' then
    raise exception 'indica el avance o una nota';
  end if;

  if p_note is not null and btrim(p_note) <> '' then
    insert into public.ticket_events (company_id, ticket_id, visibility, body)
    values (ctx.company_id, rec.id, case when p_public then 'public' else 'internal' end, btrim(p_note));
  end if;

  return private.measure_progress(rec.id);
end;
$$;

create or replace function public.agent_attach_pr(p_token text, p_ticket_id uuid, p_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
  rec public.tickets;
  pid uuid;
begin
  if coalesce(p_url, '') !~ '^https://' then
    raise exception 'la url del pull tiene que empezar con https://';
  end if;

  select * into ctx from private.agent_context(p_token);
  rec := private.require_lease(ctx.token_id, p_ticket_id, ctx.company_id);

  insert into public.pull_requests (company_id, ticket_id, url)
  values (ctx.company_id, rec.id, p_url)
  returning id into pid;

  insert into public.ticket_events (company_id, ticket_id, visibility, body)
  values
    (ctx.company_id, rec.id, 'public', 'Hay un cambio listo para revisión.'),
    (ctx.company_id, rec.id, 'internal', p_url);

  return pid;
end;
$$;

create or replace function public.agent_release(p_token text, p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
begin
  select * into ctx from private.agent_context(p_token);
  perform private.require_lease(ctx.token_id, p_ticket_id, ctx.company_id);

  update public.tickets
    set agent_token_id = null,
        agent_lease_until = null
  where id = p_ticket_id
    and company_id = ctx.company_id;
end;
$$;

revoke all on function private.intake_link(text) from public, anon, authenticated;
revoke all on function private.agent_context(text) from public, anon, authenticated;
revoke all on function private.require_lease(uuid, uuid, uuid) from public, anon, authenticated;

do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[
    'public.read_intake(text)'::regprocedure,
    'public.create_ticket_from_intake(text, text, text, text)'::regprocedure,
    'public.read_public_ticket(text)'::regprocedure,
    'public.create_invite(uuid, text, text)'::regprocedure,
    'public.accept_invite(text)'::regprocedure,
    'public.create_intake_link(uuid, text)'::regprocedure,
    'public.set_intake_active(uuid, boolean)'::regprocedure,
    'public.create_agent_token(uuid, text)'::regprocedure,
    'public.revoke_agent_token(uuid)'::regprocedure,
    'public.agent_recommend(text)'::regprocedure,
    'public.agent_claim(text, uuid)'::regprocedure,
    'public.agent_report_progress(text, uuid, uuid, int, text, boolean)'::regprocedure,
    'public.agent_attach_pr(text, uuid, text)'::regprocedure,
    'public.agent_release(text, uuid)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end;
$$;

grant execute on function public.read_intake(text) to anon, authenticated;
grant execute on function public.create_ticket_from_intake(text, text, text, text) to anon, authenticated;
grant execute on function public.read_public_ticket(text) to anon, authenticated;
grant execute on function public.agent_recommend(text) to anon, authenticated;
grant execute on function public.agent_claim(text, uuid) to anon, authenticated;
grant execute on function public.agent_report_progress(text, uuid, uuid, int, text, boolean) to anon, authenticated;
grant execute on function public.agent_attach_pr(text, uuid, text) to anon, authenticated;
grant execute on function public.agent_release(text, uuid) to anon, authenticated;

grant execute on function public.create_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.create_intake_link(uuid, text) to authenticated;
grant execute on function public.set_intake_active(uuid, boolean) to authenticated;
grant execute on function public.create_agent_token(uuid, text) to authenticated;
grant execute on function public.revoke_agent_token(uuid) to authenticated;
