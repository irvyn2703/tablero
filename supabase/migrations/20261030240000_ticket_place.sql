-- Drop a ticket before or after another one in the same status.
-- The queue stays one list, so the other columns keep their relative order.

create or replace function public.place_ticket(p_ticket_id uuid, p_target_id uuid, p_before boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  target public.tickets;
  ids uuid[];
  placed uuid[];
  target_pos int;
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

  select array_agg(ticket.id order by ticket.rank) into ids
  from public.tickets as ticket
  where ticket.company_id = rec.company_id;

  placed := array_remove(ids, rec.id);
  target_pos := array_position(placed, target.id);
  if not p_before then
    target_pos := target_pos + 1;
  end if;
  placed := placed[1:target_pos - 1] || array[rec.id] || placed[target_pos:cardinality(placed)];
  if placed = ids then
    return;
  end if;

  with shifted as (
    select ticket.id, -row_number() over (order by ticket.rank) as tmp
    from public.tickets as ticket
    where ticket.company_id = rec.company_id
  )
  update public.tickets as ticket
  set rank = shifted.tmp
  from shifted
  where ticket.id = shifted.id;

  update public.tickets as ticket
  set rank = placed.ord::int
  from unnest(placed) with ordinality as placed(id, ord)
  where ticket.id = placed.id;
end;
$$;

revoke all on function public.place_ticket(uuid, uuid, boolean) from public, anon;
grant execute on function public.place_ticket(uuid, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
