-- A check constraint runs as the member who edits the ticket.
-- sha256_hex stays private, so the same rule lives in the definer trigger.

alter table public.tickets
  drop constraint if exists tickets_view_token_check;

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
    or (
      new.view_token_hash is distinct from old.view_token_hash
      and old.view_token <> ''
    )
  ) then
    raise exception 'el ticket no cambia de empresa';
  end if;

  if new.view_token <> '' and (
    new.view_token !~ '^[0-9a-f]{64}$'
    or new.view_token_hash is distinct from private.sha256_hex(new.view_token)
  ) then
    raise exception 'el enlace de seguimiento no coincide';
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
