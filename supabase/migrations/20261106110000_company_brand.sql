-- Each company can carry its own colors and logo. Empty colors keep the Tablero palette.

alter table public.companies
  add column brand_color text not null default '',
  add column accent_color text not null default '',
  add column logo_path text not null default '';

alter table public.companies
  add constraint companies_brand_color_check
  check (brand_color = '' or brand_color ~ '^#[0-9a-f]{6}$'),
  add constraint companies_accent_color_check
  check (accent_color = '' or accent_color ~ '^#[0-9a-f]{6}$'),
  add constraint companies_logo_path_check
  check (
    logo_path = ''
    or logo_path ~ ('^' || id::text || '/logo[.](jpg|jpeg|png|webp|gif)$')
  );

grant select (brand_color, accent_color, logo_path) on public.companies to authenticated;
grant update (brand_color, accent_color, logo_path) on public.companies to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy company_logos_read on storage.objects
for select to authenticated
using (
  bucket_id = 'company-logos'
  and private.is_member(((storage.foldername(name))[1])::uuid)
);

create policy company_logos_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'company-logos'
  and name ~ '^[0-9a-f-]{36}/logo[.](jpg|jpeg|png|webp|gif)$'
  and private.is_admin(((storage.foldername(name))[1])::uuid)
);

create policy company_logos_update on storage.objects
for update to authenticated
using (
  bucket_id = 'company-logos'
  and private.is_admin(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'company-logos'
  and name ~ '^[0-9a-f-]{36}/logo[.](jpg|jpeg|png|webp|gif)$'
  and private.is_admin(((storage.foldername(name))[1])::uuid)
);

create policy company_logos_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'company-logos'
  and private.is_admin(((storage.foldername(name))[1])::uuid)
);

notify pgrst, 'reload schema';
