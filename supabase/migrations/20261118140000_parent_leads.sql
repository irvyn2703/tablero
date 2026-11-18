-- The parent column follows the child furthest ahead. Close is the
-- exception: a child still in a work status keeps the parent out of
-- close. A pause does not. If every child is discarded, the parent
-- lands in that discard status.

create or replace function private.bottleneck_status(p_parent uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.tickets c
  join public.statuses s on s.id = c.status_id
  where c.parent_id = p_parent
    and (
      not exists (
        select 1
        from public.tickets w
        join public.statuses ws on ws.id = w.status_id
        where w.parent_id = p_parent
          and private.child_counts(ws.kind, ws.allows_delete)
          and ws.kind = 'work'
      )
      or s.kind <> 'close'
    )
  order by
    case
      when not private.child_counts(s.kind, s.allows_delete) then 0
      when s.kind = 'pause' then 1
      else 2
    end desc,
    s.position desc
  limit 1;
$$;

revoke all on function private.bottleneck_status(uuid) from public, anon, authenticated;
