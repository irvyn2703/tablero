-- Keep the intake address so an admin can copy it again.
-- Older rows stay null until someone replaces that address.

alter table public.intake_links
  add column token text;

alter table public.intake_links
  add constraint intake_links_token_check
  check (token is null or token ~ '^[0-9a-f]{64}$');

grant select (token) on public.intake_links to authenticated;

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
  insert into public.intake_links (company_id, token_hash, token, label)
  values (p_company_id, private.sha256_hex(secret), secret, btrim(p_label));
  return secret;
end;
$$;

create or replace function public.reissue_intake_link(p_link_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  company uuid;
  secret text;
begin
  select company_id into company from public.intake_links where id = p_link_id;
  if company is null or not private.is_admin(company) then
    raise exception 'liga no encontrada';
  end if;
  secret := private.new_secret();
  update public.intake_links
  set token_hash = private.sha256_hex(secret),
      token = secret
  where id = p_link_id;
  return secret;
end;
$$;

revoke all on function public.reissue_intake_link(uuid) from public, anon;
grant execute on function public.reissue_intake_link(uuid) to authenticated;

notify pgrst, 'reload schema';
