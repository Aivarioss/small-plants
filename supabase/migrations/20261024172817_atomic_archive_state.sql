-- Archive state and schedule preservation succeed or roll back together.
create or replace function public.change_sowing_plan_archive(
  p_id uuid, p_operation text, p_expected_updated_at timestamptz,
  p_active_versions jsonb, p_freeze jsonb,
  p_archived_at timestamptz, p_note text, p_snapshot jsonb
) returns uuid
language plpgsql security invoker set search_path = public
set lock_timeout = '5s'
as $$
declare
  target public.sowing_plan_rows;
  item public.work_adjustments;
begin
  if p_operation is null or p_operation not in ('archive', 'restore')
    or jsonb_typeof(p_active_versions) is distinct from 'array'
    or jsonb_typeof(p_freeze) is distinct from 'array' then
    raise exception 'Invalid archive request' using errcode = '22023';
  end if;
  -- Stabilize membership as well as versions: a newly inserted active cycle also
  -- changes the optimizer context. Lock before reading or changing any rows.
  lock table public.sowing_plan_rows in share row exclusive mode;
  select * into target from public.sowing_plan_rows where id = p_id for update;
  if not found then raise exception 'HUS missing' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or target.updated_at <> p_expected_updated_at
    or (p_operation = 'archive') <> (target.archived_at is null) then
    raise exception 'HUS changed' using errcode = '40001';
  end if;
  if (select count(*) from jsonb_array_elements(p_active_versions)) <>
     (select count(distinct (v->>'id')::uuid) from jsonb_array_elements(p_active_versions) v)
    or exists (
      select 1 from public.sowing_plan_rows r
      full join jsonb_to_recordset(p_active_versions) as v(id uuid, updated_at timestamptz)
        on r.id = v.id
      where (r.archived_at is null or v.id is not null)
        and (r.id is null or r.archived_at is not null or v.id is null
             or v.updated_at is null or r.updated_at <> v.updated_at)
    ) then
    raise exception 'Active plan changed' using errcode = '40001';
  end if;
  if p_operation = 'restore' and exists (
    select 1 from public.sowing_plan_rows r where r.archived_at is null
      and lower(regexp_replace(btrim(r.hus), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(target.hus), '\s+', ' ', 'g'))
      and r.sowing_date = target.sowing_date and r.move_out_date = target.move_out_date
  ) then
    raise exception 'Identical active HUS cycle exists' using errcode = '23505';
  end if;
  if p_operation = 'archive' and (p_archived_at is null or p_snapshot is null
    or p_snapshot->>'version' is distinct from '1'
    or p_snapshot->'hus'->>'id' is distinct from p_id::text) then
    raise exception 'Archive snapshot required' using errcode = '22023';
  end if;
  for item in select * from jsonb_populate_recordset(null::public.work_adjustments, p_freeze) loop
    if item.sowing_plan_row_id = p_id or item.sowing_plan_row_id is null
      or not exists(select 1 from public.sowing_plan_rows where id = item.sowing_plan_row_id and archived_at is null)
      or item.source is distinct from 'optimizer' or item.locked is distinct from true then
      raise exception 'Invalid schedule freeze' using errcode = '22023';
    end if;
    -- Existing manual or optimizer dates must never be overwritten.
    insert into public.work_adjustments(id, sowing_plan_row_id, work_type, dates, source, locked)
      values(item.id, item.sowing_plan_row_id, item.work_type, item.dates, item.source, item.locked);
    update public.sowing_plan_rows set status = status where id = item.sowing_plan_row_id;
  end loop;
  if p_operation = 'archive' then
    update public.sowing_plan_rows set archived_at = p_archived_at,
      archived_note = nullif(btrim(p_note), ''), archive_snapshot = p_snapshot where id = p_id;
  else
    update public.sowing_plan_rows set archived_at = null, archived_note = null where id = p_id;
  end if;
  return p_id;
end;
$$;
revoke all on function public.change_sowing_plan_archive(uuid,text,timestamptz,jsonb,jsonb,timestamptz,text,jsonb) from public, anon, authenticated;
grant execute on function public.change_sowing_plan_archive(uuid,text,timestamptz,jsonb,jsonb,timestamptz,text,jsonb) to service_role;
notify pgrst, 'reload schema';
