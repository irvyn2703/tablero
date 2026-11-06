-- The public report form loads one logo by its path.
-- The bucket is public for that download. Anonymous users still cannot list it.

update storage.buckets
set public = true
where id = 'company-logos';

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
