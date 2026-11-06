-- The company background travels with the brand, including the public report form.

alter table public.companies
  add column background_color text not null default '';

alter table public.companies
  add constraint companies_background_color_check
  check (background_color = '' or background_color ~ '^#[0-9a-f]{6}$');

grant select (background_color) on public.companies to authenticated;
grant update (background_color) on public.companies to authenticated;

create or replace function private.logo_on_intake(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    join public.intake_links l on l.company_id = c.id
    where c.logo_path = p_name
      and c.logo_path <> ''
      and l.active
  );
$$;

revoke all on function private.logo_on_intake(text) from public, anon, authenticated;
grant execute on function private.logo_on_intake(text) to anon, authenticated;

create policy company_logos_intake_read on storage.objects
for select to anon
using (
  bucket_id = 'company-logos'
  and private.logo_on_intake(name)
);

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
    'backgroundColor', company.background_color,
    'logoPath', company.logo_path
  );
end;
$$;

notify pgrst, 'reload schema';
