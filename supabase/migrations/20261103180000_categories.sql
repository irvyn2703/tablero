-- Categories belong to the company. A ticket can carry several.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create unique index categories_company_name_idx
  on public.categories (company_id, lower(btrim(name)));

create table public.ticket_categories (
  company_id uuid not null,
  ticket_id uuid not null,
  category_id uuid not null,
  primary key (ticket_id, category_id),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade,
  foreign key (company_id, category_id) references public.categories (company_id, id) on delete cascade
);

alter table public.categories enable row level security;
alter table public.categories force row level security;
alter table public.ticket_categories enable row level security;
alter table public.ticket_categories force row level security;

revoke all on public.categories from public, anon, authenticated;
revoke all on public.ticket_categories from public, anon, authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, delete on public.ticket_categories to authenticated;

create policy categories_select on public.categories
for select to authenticated
using ((select private.is_member(company_id)));

create policy categories_insert on public.categories
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy categories_update on public.categories
for update to authenticated
using ((select private.can_edit(company_id)))
with check ((select private.can_edit(company_id)));

create policy categories_delete on public.categories
for delete to authenticated
using ((select private.can_edit(company_id)));

create policy ticket_categories_select on public.ticket_categories
for select to authenticated
using ((select private.is_member(company_id)));

create policy ticket_categories_insert on public.ticket_categories
for insert to authenticated
with check ((select private.can_edit(company_id)));

create policy ticket_categories_delete on public.ticket_categories
for delete to authenticated
using ((select private.can_edit(company_id)));

notify pgrst, 'reload schema';
