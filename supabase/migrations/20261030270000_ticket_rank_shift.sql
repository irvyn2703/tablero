-- Ranks move as one set. The unique key waits until the statement finishes,
-- so a ticket can pass through a rank another ticket still holds.

alter table public.tickets drop constraint tickets_rank_unique;

alter table public.tickets
  add constraint tickets_rank_unique unique (company_id, rank) deferrable initially deferred;

create or replace function private.reseat_ticket(
  p_company uuid,
  p_ticket uuid,
  p_target uuid,
  p_before boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ids uuid[];
  placed uuid[];
  old_pos int;
  new_pos int;
  lo int;
  hi int;
  span_ranks int[];
begin
  select array_agg(ticket.id order by ticket.rank) into ids
  from public.tickets as ticket
  where ticket.company_id = p_company;

  placed := array_remove(ids, p_ticket);
  new_pos := array_position(placed, p_target);
  if new_pos is null then
    return;
  end if;
  if not p_before then
    new_pos := new_pos + 1;
  end if;
  placed := placed[1:new_pos - 1] || array[p_ticket] || placed[new_pos:cardinality(placed)];
  if placed = ids then
    return;
  end if;

  old_pos := array_position(ids, p_ticket);
  new_pos := array_position(placed, p_ticket);
  lo := least(old_pos, new_pos);
  hi := greatest(old_pos, new_pos);

  select array_agg(ticket.rank order by ticket.rank) into span_ranks
  from public.tickets as ticket
  where ticket.id = any(ids[lo:hi]);

  update public.tickets as ticket
  set rank = assigned.new_rank
  from unnest(placed[lo:hi], span_ranks) as assigned(id, new_rank)
  where ticket.id = assigned.id;
end;
$$;

revoke all on function private.reseat_ticket(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function private.reseat_ticket(uuid, uuid, uuid, boolean) to postgres;

create or replace function public.move_ticket(p_ticket_id uuid, p_direction int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  neighbor public.tickets;
begin
  if p_direction not in (-1, 1) then
    raise exception 'movimiento inválido';
  end if;

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rec.company_id::text));

  select * into rec from public.tickets where id = p_ticket_id;

  select * into neighbor
  from public.tickets
  where company_id = rec.company_id
    and status_id = rec.status_id
    and case
      when p_direction = -1 then rank < rec.rank
      else rank > rec.rank
    end
  order by case when p_direction = -1 then rank end desc,
           case when p_direction = 1 then rank end asc
  limit 1;

  if neighbor.id is null then
    return;
  end if;

  perform private.reseat_ticket(rec.company_id, rec.id, neighbor.id, p_direction < 0);
end;
$$;

create or replace function public.place_ticket(p_ticket_id uuid, p_target_id uuid, p_before boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  target public.tickets;
begin
  if p_ticket_id = p_target_id then
    return;
  end if;

  select * into rec from public.tickets where id = p_ticket_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'ticket no encontrado';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(rec.company_id::text));

  select * into rec from public.tickets where id = p_ticket_id;
  select * into target from public.tickets where id = p_target_id;
  if target.id is null
    or target.company_id is distinct from rec.company_id
    or target.status_id is distinct from rec.status_id then
    return;
  end if;

  perform private.reseat_ticket(rec.company_id, rec.id, target.id, p_before);
end;
$$;

notify pgrst, 'reload schema';
