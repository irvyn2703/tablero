-- The public tracking page says how many tickets are ahead in the same status.
-- Pause and close have no queue line.

create or replace function public.read_public_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.tickets;
  status_name text;
  status_kind text;
  company_name text;
  ahead_count int;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception 'ticket no encontrado';
  end if;

  select * into rec
  from public.tickets
  where view_token_hash = private.sha256_hex(p_token);

  if rec.id is null then
    raise exception 'ticket no encontrado';
  end if;

  select s.name, s.kind into status_name, status_kind
  from public.statuses s
  where s.id = rec.status_id;

  select c.name into company_name from public.companies c where c.id = rec.company_id;

  if status_kind = 'work' then
    select count(*)::int into ahead_count
    from public.tickets other
    where other.company_id = rec.company_id
      and other.status_id = rec.status_id
      and other.rank < rec.rank;
  end if;

  return jsonb_build_object(
    'number', rec.public_number,
    'key', private.ticket_key(rec.company_id, rec.public_number),
    'title', rec.title,
    'companyName', company_name,
    'status', status_name,
    'progress', private.measure_progress(rec.id),
    'ahead', ahead_count,
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object('body', e.body, 'at', e.created_at)
        order by e.created_at
      )
      from public.ticket_events e
      where e.ticket_id = rec.id
        and e.visibility = 'public'
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'side', m.side,
          'name', m.author_label,
          'body', m.body,
          'at', m.created_at
        )
        order by m.created_at
      )
      from public.ticket_messages m
      where m.ticket_id = rec.id
    ), '[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
