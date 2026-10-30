-- Member alias. The email stays the account; the alias is the name people see.

create or replace function private.display_name(p_user_id uuid, p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(
    btrim(
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(btrim(concat_ws(
          ' ',
          u.raw_user_meta_data ->> 'given_name',
          u.raw_user_meta_data ->> 'family_name'
        )), ''),
        nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
        'Sin nombre'
      )
    ),
    40
  )
  from auth.users u
  where u.id = p_user_id;
$$;

revoke all on function private.display_name(uuid, text) from public, anon, authenticated;

alter table public.company_members add column alias text;

update public.company_members m
set alias = coalesce(
  private.display_name(m.user_id, m.email),
  left(nullif(split_part(m.email, '@', 1), ''), 40),
  'Sin nombre'
);

alter table public.company_members alter column alias set not null;
alter table public.company_members
  add constraint company_members_alias_check
  check (char_length(btrim(alias)) between 1 and 40);

grant select (alias) on public.company_members to authenticated;

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

  insert into public.company_members (company_id, user_id, email, role, alias)
  values (cid, uid, lower(em), 'owner', private.display_name(uid, em));

  perform private.seed_statuses(cid);
  return cid;
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

  insert into public.company_members (company_id, user_id, email, role, alias)
  values (inv.company_id, uid, lower(em), inv.role, private.display_name(uid, em))
  on conflict (company_id, user_id) do nothing;

  update public.company_invites
    set accepted_at = pg_catalog.now()
  where id = inv.id;

  return inv.company_id;
end;
$$;

create or replace function public.set_member_alias(
  p_company_id uuid,
  p_user_id uuid,
  p_alias text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(p_alias, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'no autorizado';
  end if;
  if not private.is_admin(p_company_id)
    and p_user_id is distinct from (select auth.uid()) then
    raise exception 'no autorizado';
  end if;
  if char_length(clean) < 1 or char_length(clean) > 40 then
    raise exception 'el alias necesita entre 1 y 40 caracteres';
  end if;

  update public.company_members
    set alias = clean
  where company_id = p_company_id
    and user_id = p_user_id;

  if not found then
    raise exception 'miembro no encontrado';
  end if;
end;
$$;

revoke all on function public.set_member_alias(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_member_alias(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
