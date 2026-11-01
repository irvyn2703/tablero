-- storage.objects rejects a direct delete. The browser removes the object
-- through the Storage API, then this function drops the row.

create or replace function public.remove_ticket_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.ticket_files;
begin
  select * into rec from public.ticket_files where id = p_file_id;
  if rec.id is null or not private.can_edit(rec.company_id) then
    raise exception 'archivo no encontrado';
  end if;
  delete from public.ticket_files where id = rec.id;
  if rec.ready then
    insert into public.ticket_events (company_id, ticket_id, visibility, body)
    values (rec.company_id, rec.ticket_id, 'public', left('Se quitó ' || rec.name, 2000));
  end if;
end;
$$;

drop policy if exists ticket_files_delete on storage.objects;
create policy ticket_files_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'ticket-files'
  and private.can_edit(((storage.foldername(name))[1])::uuid)
);

notify pgrst, 'reload schema';
