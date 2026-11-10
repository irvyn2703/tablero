-- A version front (Móvil, Dash) is not a ticket category.
-- Anything already stored pointed at the ticket list, so it is cleared.

create table public.version_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create unique index version_categories_company_name_idx
  on public.version_categories (company_id, lower(btrim(name)));

alter table public.versions drop constraint versions_category_fk;

update public.versions set category_id = null;

alter table public.versions
  add constraint versions_category_fk
  foreign key (company_id, category_id)
  references public.version_categories (company_id, id)
  on delete set null (category_id);

alter table public.version_categories enable row level security;
alter table public.version_categories force row level security;

revoke all on public.version_categories from public, anon, authenticated;
grant select, insert, update, delete on public.version_categories to authenticated;

create policy version_categories_select on public.version_categories
for select to authenticated
using ((select private.is_member(company_id)));

create policy version_categories_insert on public.version_categories
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy version_categories_update on public.version_categories
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

create policy version_categories_delete on public.version_categories
for delete to authenticated
using ((select private.can_edit(company_id)));

notify pgrst, 'reload schema';
