-- Tablero: tables, privileges, and row level security.
-- Privileged checks live in schema private, which PostgREST does not expose.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  policy jsonb not null default jsonb_build_object(
    'autoExecute', jsonb_build_object(
      'enabled', false,
      'maxEstimate', 'xs',
      'autonomy', 'pull'
    )
  ),
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'admin', 'dev')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'dev')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.repos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  github_full_name text not null check (github_full_name ~ '^[\w.-]+/[\w.-]+$'),
  default_branch text not null default 'develop' check (char_length(btrim(default_branch)) between 1 and 120),
  unique (company_id, id),
  unique (company_id, github_full_name)
);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  position int not null check (position > 0),
  kind text not null check (kind in ('work', 'close', 'pause')),
  weight int not null default 0 check (weight between 0 and 100),
  unique (company_id, id),
  unique (company_id, position)
);

create table public.sprints (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  check (ends_on >= starts_on),
  unique (company_id, id)
);

create table public.intake_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  token_hash text not null unique,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  hourly_limit int not null default 30 check (hourly_limit between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  token_hash text not null unique,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  public_number int not null check (public_number > 0),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 8000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  status_id uuid not null,
  resume_status_id uuid,
  local_percent int not null default 0 check (local_percent between 0 and 100),
  priority int not null default 3 check (priority between 1 and 4),
  estimate text not null default 'm' check (estimate in ('xs', 's', 'm', 'l')),
  autonomy text not null default 'suggest' check (autonomy in ('suggest', 'pull', 'human')),
  sprint_id uuid,
  repo_id uuid,
  assignee_id uuid,
  view_token_hash text not null unique,
  intake_link_id uuid,
  agent_token_id uuid,
  agent_lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, public_number),
  foreign key (company_id, status_id) references public.statuses (company_id, id),
  foreign key (company_id, resume_status_id) references public.statuses (company_id, id),
  foreign key (company_id, sprint_id) references public.sprints (company_id, id),
  foreign key (company_id, repo_id) references public.repos (company_id, id),
  foreign key (company_id, assignee_id) references public.company_members (company_id, user_id),
  foreign key (company_id, intake_link_id) references public.intake_links (company_id, id),
  foreign key (company_id, agent_token_id) references public.agent_tokens (company_id, id)
);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ticket_id uuid not null,
  visibility text not null check (visibility in ('public', 'internal')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade
);

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  ticket_id uuid not null,
  url text not null check (url ~ '^https://'),
  created_at timestamptz not null default now(),
  foreign key (company_id, ticket_id) references public.tickets (company_id, id) on delete cascade
);

create index tickets_company_status_idx on public.tickets (company_id, status_id);
create index tickets_company_created_idx on public.tickets (company_id, created_at);
create index tickets_intake_created_idx on public.tickets (intake_link_id, created_at desc);
create index company_members_user_idx on public.company_members (user_id);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

create or replace function private.is_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_admin(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

create or replace function private.is_owner(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke all on function private.is_member(uuid) from public, anon, authenticated;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;
revoke all on function private.is_owner(uuid) from public, anon, authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.is_admin(uuid) to authenticated;
grant execute on function private.is_owner(uuid) to authenticated;

create or replace function private.protect_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id is distinct from old.user_id or new.company_id is distinct from old.company_id) then
    raise exception 'la membresía no se reasigna';
  end if;

  if old.role = 'owner' and (tg_op = 'DELETE' or new.role is distinct from 'owner') then
    if (
      select count(*)
      from public.company_members m
      where m.company_id = old.company_id
        and m.role = 'owner'
        and m.user_id <> old.user_id
    ) = 0 then
      raise exception 'la empresa necesita un dueño';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger company_members_protect_owner
before update or delete on public.company_members
for each row execute function private.protect_owner();

create or replace function private.tickets_shape()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_kind text;
  resume_kind text;
begin
  if tg_op = 'UPDATE' and (
    new.company_id is distinct from old.company_id
    or new.public_number is distinct from old.public_number
    or new.view_token_hash is distinct from old.view_token_hash
  ) then
    raise exception 'el ticket no cambia de empresa';
  end if;

  select s.kind into current_kind
  from public.statuses s
  where s.id = new.status_id
    and s.company_id = new.company_id;

  if current_kind is null then
    raise exception 'el estado no es de esta empresa';
  end if;

  if current_kind = 'pause' then
    if new.resume_status_id is null then
      raise exception 'una pausa necesita estado de reanudación';
    end if;
    select s.kind into resume_kind
    from public.statuses s
    where s.id = new.resume_status_id
      and s.company_id = new.company_id;
    if resume_kind is distinct from 'work' then
      raise exception 'el estado de reanudación tiene que ser de trabajo';
    end if;
  else
    new.resume_status_id := null;
  end if;

  return new;
end;
$$;

create trigger tickets_shape
before insert or update on public.tickets
for each row execute function private.tickets_shape();

create or replace function private.touch_ticket()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger tickets_touch
before update on public.tickets
for each row execute function private.touch_ticket();

create or replace function private.companies_policy_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  keys int;
  auto_exec jsonb;
begin
  if jsonb_typeof(new.policy) is distinct from 'object' then
    raise exception 'la política no es válida';
  end if;

  select count(*) into keys from jsonb_object_keys(new.policy);
  if keys <> 1 or not (new.policy ? 'autoExecute') then
    raise exception 'la política no es válida';
  end if;

  auto_exec := new.policy -> 'autoExecute';
  if jsonb_typeof(auto_exec) is distinct from 'object'
    or jsonb_typeof(auto_exec -> 'enabled') is distinct from 'boolean'
    or coalesce(auto_exec ->> 'maxEstimate', '') not in ('xs', 's', 'm', 'l')
    or coalesce(auto_exec ->> 'autonomy', '') not in ('suggest', 'pull', 'human')
  then
    raise exception 'la política no es válida';
  end if;

  select count(*) into keys from jsonb_object_keys(auto_exec);
  if keys <> 3 then
    raise exception 'la política no es válida';
  end if;

  return new;
end;
$$;

create trigger companies_policy_shape
before insert or update on public.companies
for each row execute function private.companies_policy_shape();

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.repos enable row level security;
alter table public.statuses enable row level security;
alter table public.sprints enable row level security;
alter table public.intake_links enable row level security;
alter table public.agent_tokens enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.pull_requests enable row level security;

alter table public.companies force row level security;
alter table public.company_members force row level security;
alter table public.company_invites force row level security;
alter table public.repos force row level security;
alter table public.statuses force row level security;
alter table public.sprints force row level security;
alter table public.intake_links force row level security;
alter table public.agent_tokens force row level security;
alter table public.tickets force row level security;
alter table public.ticket_events force row level security;
alter table public.pull_requests force row level security;

revoke all on all tables in schema public from public, anon, authenticated;

grant select (id, name, slug, policy, created_at) on public.companies to authenticated;
grant update (name, policy) on public.companies to authenticated;

grant select (company_id, user_id, email, role, created_at) on public.company_members to authenticated;
grant update (role) on public.company_members to authenticated;
grant delete on public.company_members to authenticated;

grant select (id, company_id, email, role, expires_at, accepted_at, created_at) on public.company_invites to authenticated;

grant select, insert, update, delete on public.repos to authenticated;
grant select on public.statuses to authenticated;
grant select, insert, update, delete on public.sprints to authenticated;
grant select (id, company_id, label, hourly_limit, active, created_at) on public.intake_links to authenticated;
grant select (id, company_id, name, revoked_at, last_used_at, created_at) on public.agent_tokens to authenticated;

grant select (
  id, company_id, public_number, title, body, contact_email,
  status_id, resume_status_id, local_percent, priority, estimate, autonomy,
  sprint_id, repo_id, assignee_id, intake_link_id, agent_lease_until, created_at, updated_at
) on public.tickets to authenticated;
grant update (
  title, body, contact_email, priority, estimate, autonomy, sprint_id, repo_id, assignee_id
) on public.tickets to authenticated;

grant select on public.ticket_events to authenticated;
grant select on public.pull_requests to authenticated;

create policy companies_select on public.companies
for select to authenticated
using ((select private.is_member(id)));

create policy companies_update on public.companies
for update to authenticated
using ((select private.is_admin(id)))
with check ((select private.is_admin(id)));

create policy members_select on public.company_members
for select to authenticated
using ((select private.is_member(company_id)));

create policy members_update on public.company_members
for update to authenticated
using ((select private.is_owner(company_id)))
with check ((select private.is_owner(company_id)) and role in ('owner', 'admin', 'dev'));

create policy members_delete on public.company_members
for delete to authenticated
using ((select private.is_owner(company_id)));

create policy invites_select on public.company_invites
for select to authenticated
using ((select private.is_admin(company_id)));

create policy repos_select on public.repos
for select to authenticated
using ((select private.is_member(company_id)));

create policy repos_insert on public.repos
for insert to authenticated
with check ((select private.is_admin(company_id)));

create policy repos_update on public.repos
for update to authenticated
using ((select private.is_admin(company_id)))
with check ((select private.is_admin(company_id)));

create policy repos_delete on public.repos
for delete to authenticated
using ((select private.is_admin(company_id)));

create policy statuses_select on public.statuses
for select to authenticated
using ((select private.is_member(company_id)));

create policy sprints_all on public.sprints
for all to authenticated
using ((select private.is_member(company_id)))
with check ((select private.is_member(company_id)));

create policy intake_select on public.intake_links
for select to authenticated
using ((select private.is_admin(company_id)));

create policy agent_select on public.agent_tokens
for select to authenticated
using ((select private.is_admin(company_id)));

create policy tickets_select on public.tickets
for select to authenticated
using ((select private.is_member(company_id)));

create policy tickets_update on public.tickets
for update to authenticated
using ((select private.is_member(company_id)))
with check ((select private.is_member(company_id)));

create policy events_select on public.ticket_events
for select to authenticated
using ((select private.is_member(company_id)));

create policy pulls_select on public.pull_requests
for select to authenticated
using ((select private.is_member(company_id)));
