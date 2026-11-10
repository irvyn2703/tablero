alter table public.versions
  add column category_id uuid;

alter table public.versions
  add constraint versions_category_fk
  foreign key (company_id, category_id)
  references public.categories (company_id, id)
  on delete set null (category_id);

drop index public.versions_company_name_idx;

create unique index versions_company_category_name_idx
  on public.versions (company_id, category_id, lower(btrim(name)));

create unique index versions_company_loose_name_idx
  on public.versions (company_id, lower(btrim(name)))
  where category_id is null;

notify pgrst, 'reload schema';
