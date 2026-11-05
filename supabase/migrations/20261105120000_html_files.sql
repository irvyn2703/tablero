-- Tickets can also carry an HTML file. It downloads; it is not opened as a page.

update storage.buckets
set allowed_mime_types = allowed_mime_types || array['text/html']
where id = 'ticket-files'
  and not ('text/html' = any (coalesce(allowed_mime_types, array[]::text[])));

create or replace function private.file_mime(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case ext
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png'
    when 'gif' then 'image/gif'
    when 'webp' then 'image/webp'
    when 'xls' then 'application/vnd.ms-excel'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'htm' then 'text/html'
    when 'html' then 'text/html'
    else null
  end
  from (
    select lower(btrim(coalesce(p_name, ''))) as name
  ) raw
  cross join lateral (
    select reverse(split_part(reverse(raw.name), '.', 1)) as ext
  ) parts
  where raw.name ~ '^[^/\\]+[.](jpg|jpeg|png|gif|webp|xls|xlsx|doc|docx|htm|html)$';
$$;

create or replace function private.file_label(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text;
begin
  clean := regexp_replace(btrim(coalesce(p_name, '')), E'[\\x00-\\x1f/\\\\]', '', 'g');
  clean := right(clean, 120);
  if private.file_mime(clean) is null then
    raise exception 'solo imágenes, Excel, Word o HTML';
  end if;
  return clean;
end;
$$;

notify pgrst, 'reload schema';
