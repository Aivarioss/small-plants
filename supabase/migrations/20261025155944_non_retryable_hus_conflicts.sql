-- PostgREST 14 retries SQLSTATE 40001 indefinitely. Domain conflicts must return PT409.
-- Prepared only: apply separately before deploying the matching application code.
-- One RPC = one PostgreSQL transaction. An exception rolls back parent and all children.
create or replace function public.save_sowing_plan_row(
  p_operation text,
  p_row jsonb,
  p_expected_updated_at timestamptz,
  p_work_adjustments jsonb,
  p_table_placement jsonb,
  p_plant_corrections jsonb,
  p_hus_events jsonb,
  p_change_history jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  incoming public.sowing_plan_rows;
  current_row public.sowing_plan_rows;
  items jsonb;
  child_table text;
  found_collision boolean;
begin
  incoming := jsonb_populate_record(null::public.sowing_plan_rows, p_row);
  if incoming.id is null or p_operation not in ('create', 'update') or p_operation is null then
    raise exception 'Invalid save request' using errcode = '22023';
  end if;
  foreach items in array array[p_work_adjustments, p_plant_corrections, p_hus_events, p_change_history] loop
    if jsonb_typeof(items) is distinct from 'array' then
      raise exception 'Complete child arrays are required' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(items) x
      where (x->>'sowing_plan_row_id')::uuid is distinct from incoming.id) then
      raise exception 'Child belongs to another cycle' using errcode = '23514';
    end if;
  end loop;
  if p_table_placement is not null and p_table_placement <> 'null'::jsonb
    and (p_table_placement->>'sowing_plan_row_id')::uuid is distinct from incoming.id then
    raise exception 'Placement belongs to another cycle' using errcode = '23514';
  end if;

  if p_operation = 'update' then
    select * into current_row from public.sowing_plan_rows where id = incoming.id for update;
    if not found then raise exception 'HUS not found' using errcode = 'P0002'; end if;
    if current_row.archived_at is not null then
      raise exception 'Archived HUS is read only' using errcode = '55000';
    end if;
    if p_expected_updated_at is null or current_row.updated_at <> p_expected_updated_at then
      raise exception 'HUS changed elsewhere' using errcode = 'PT409';
    end if;
    update public.sowing_plan_rows set
      hus = incoming.hus, greenhouse_required_plants = incoming.greenhouse_required_plants,
      required_plants = incoming.required_plants, extra_plants = incoming.extra_plants,
      variety = incoming.variety, week_number = incoming.week_number, sowing_tables = incoming.sowing_tables,
      sowing_date = incoming.sowing_date, move_out_date = incoming.move_out_date,
      previcure_date = incoming.previcure_date, cycle_length = incoming.cycle_length,
      sector_type = incoming.sector_type, correction = incoming.correction,
      status = incoming.status, source = incoming.source
    where id = incoming.id;
  else
    -- Creation cannot smuggle an archive snapshot into the active plan.
    insert into public.sowing_plan_rows (
      id, hus, greenhouse_required_plants, required_plants, extra_plants, variety,
      week_number, sowing_tables, sowing_date, move_out_date, previcure_date,
      cycle_length, sector_type, correction, status, source
    ) values (
      incoming.id, incoming.hus, incoming.greenhouse_required_plants, incoming.required_plants,
      incoming.extra_plants, incoming.variety, incoming.week_number, incoming.sowing_tables,
      incoming.sowing_date, incoming.move_out_date, incoming.previcure_date,
      incoming.cycle_length, incoming.sector_type, incoming.correction, incoming.status, incoming.source
    );
  end if;

  -- Never allow a child UUID from a different HUS to be reassigned by upsert.
  for child_table, items in select * from (values
    ('plant_corrections', p_plant_corrections), ('hus_events', p_hus_events),
    ('change_history', p_change_history)
  ) as payloads(table_name, payload) loop
    if exists (select 1 from jsonb_array_elements(items) x where x->>'id' is null) then
      raise exception 'Stable child ID is required' using errcode = '22023';
    end if;
    execute format('select exists (select 1 from public.%I c join jsonb_array_elements($1) x on c.id = (x->>''id'')::uuid where c.sowing_plan_row_id <> $2)', child_table)
      into strict found_collision using items, incoming.id;
    if found_collision then
      raise exception 'Child ID belongs to another cycle' using errcode = '23514';
    end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(p_hus_events) e
    where e->>'plant_correction_id' is not null and not exists (
      select 1 from jsonb_array_elements(p_plant_corrections) c
      where c->>'id' = e->>'plant_correction_id'
    )) then
    raise exception 'Linked correction is missing from the complete payload' using errcode = '23514';
  end if;

  delete from public.work_adjustments where sowing_plan_row_id = incoming.id;
  insert into public.work_adjustments (id, sowing_plan_row_id, work_type, dates, source, locked)
    select id, sowing_plan_row_id, work_type, dates, source, locked
    from jsonb_populate_recordset(null::public.work_adjustments, p_work_adjustments);
  delete from public.table_placements where sowing_plan_row_id = incoming.id;
  if p_table_placement is not null and p_table_placement <> 'null'::jsonb then
    insert into public.table_placements (id, sowing_plan_row_id, primary_row, tables, manual)
      select id, sowing_plan_row_id, primary_row, tables, manual
      from jsonb_populate_record(null::public.table_placements, p_table_placement);
  end if;

  insert into public.plant_corrections (id, sowing_plan_row_id, correction_date, amount, reason, note)
    select id, sowing_plan_row_id, correction_date, amount, reason, note
    from jsonb_populate_recordset(null::public.plant_corrections, p_plant_corrections)
  on conflict (id) do update set correction_date = excluded.correction_date,
    amount = excluded.amount, reason = excluded.reason, note = excluded.note;

  -- Retained event IDs must never be deleted/recreated: that would cascade-delete their photos.
  delete from public.hus_events e where e.sowing_plan_row_id = incoming.id
    and not exists (select 1 from jsonb_array_elements(p_hus_events) x where (x->>'id')::uuid = e.id);
  if exists (select 1 from jsonb_populate_recordset(null::public.hus_events, p_hus_events) e
    join public.plant_corrections c on c.id = e.plant_correction_id
    where c.sowing_plan_row_id <> incoming.id) then
    raise exception 'Correction belongs to another cycle' using errcode = '23514';
  end if;
  insert into public.hus_events (id, sowing_plan_row_id, event_date, event_type, location,
    destination_location, plant_change, plant_correction_id, note, created_at)
    select id, sowing_plan_row_id, event_date, event_type, location,
      destination_location, plant_change, plant_correction_id, note, coalesce(created_at, now())
    from jsonb_populate_recordset(null::public.hus_events, p_hus_events)
  on conflict (id) do update set event_date = excluded.event_date, event_type = excluded.event_type,
    location = excluded.location, destination_location = excluded.destination_location,
    plant_change = excluded.plant_change, plant_correction_id = excluded.plant_correction_id, note = excluded.note;
  delete from public.plant_corrections c where c.sowing_plan_row_id = incoming.id
    and not exists (select 1 from jsonb_array_elements(p_plant_corrections) x where (x->>'id')::uuid = c.id);

  insert into public.change_history (id, sowing_plan_row_id, field, from_value, to_value, note, created_at)
    select id, sowing_plan_row_id, field, from_value, to_value, note, coalesce(created_at, now())
    from jsonb_populate_recordset(null::public.change_history, p_change_history)
  on conflict (id) do nothing;
  return incoming.id;
end;
$$;

-- The existing application uses its server-only service-role client, not browser RPC access.
revoke all on function public.save_sowing_plan_row(text, jsonb, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_sowing_plan_row(text, jsonb, timestamptz, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
notify pgrst, 'reload schema';

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
    raise exception 'HUS changed' using errcode = 'PT409';
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
    raise exception 'Active plan changed' using errcode = 'PT409';
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
