-- Prepared only. Requires the atomic single-row save migration.
create table if not exists public.sowing_plan_import_operations (
  id uuid primary key,
  request jsonb not null,
  row_ids uuid[] not null,
  created_at timestamptz not null default now()
);
alter table public.sowing_plan_import_operations enable row level security;
revoke all on public.sowing_plan_import_operations from anon, authenticated;
grant select, insert on public.sowing_plan_import_operations to service_role;

create or replace function public.import_sowing_plan_rows(p_id uuid, p_request jsonb, p_items jsonb)
returns uuid[] language plpgsql security invoker set search_path = public, pg_temp
set lock_timeout = '5s'
as $$
declare
  previous public.sowing_plan_import_operations;
  item jsonb;
  result uuid[] := '{}';
  saved uuid;
begin
  if p_id is null or jsonb_typeof(p_request) is distinct from 'array'
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 500
    or jsonb_array_length(p_items) <> jsonb_array_length(p_request) then
    raise exception 'Invalid import' using errcode = '22023';
  end if;
  -- Serialize identical request IDs, including the case where no receipt exists yet.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into previous from public.sowing_plan_import_operations where id = p_id;
  if found then
    if previous.request <> p_request then
      raise exception 'Import ID belongs to another request' using errcode = '22023';
    end if;
    return previous.row_ids;
  end if;
  if (select count(distinct (x->'row'->>'id')::uuid) from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'Duplicate or missing target ID' using errcode = '22023';
  end if;
  -- Same lock ordering as archive changes. Stabilizes duplicate checks and bounds waiting.
  lock table public.sowing_plan_rows in share row exclusive mode;
  for item in select value from jsonb_array_elements(p_items) order by value->'row'->>'id' loop
    if item->>'operation' is null or item->>'operation' not in ('create','update') then
      raise exception 'Invalid import operation' using errcode = '22023';
    end if;
    if exists(select 1 from public.sowing_plan_rows r where r.archived_at is null
      and r.id <> (item->'row'->>'id')::uuid
      and lower(regexp_replace(btrim(r.hus), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(item->'row'->>'hus'), '\s+', ' ', 'g'))
      and r.sowing_date = (item->'row'->>'sowing_date')::date
      and r.move_out_date = (item->'row'->>'move_out_date')::date) then
      raise exception 'Identical active cycle exists' using errcode = '23505';
    end if;
    saved := public.save_sowing_plan_row(item->>'operation', item->'row', (item->>'expected_updated_at')::timestamptz,
      item->'work', item->'placement', item->'losses', item->'events', item->'history');
    result := array_append(result, saved);
  end loop;
  insert into public.sowing_plan_import_operations(id, request, row_ids) values(p_id, p_request, result);
  return result;
end;
$$;
revoke all on function public.import_sowing_plan_rows(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.import_sowing_plan_rows(uuid,jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
