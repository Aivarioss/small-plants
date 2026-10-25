create extension if not exists pgcrypto;

create type plan_row_status as enum ('planned', 'imported', 'active', 'done');
create type plan_row_source as enum ('user', 'import');
create type work_adjustment_type as enum ('thinning', 'sideShoots', 'sticks');
create type work_adjustment_source as enum ('manual', 'optimizer');
create type greenhouse_row_id as enum ('A', 'B', 'C', 'D');
create type plant_correction_reason as enum ('thinning', 'brownRoots', 'damaged', 'other');

create table sowing_plan_rows (
  id uuid primary key default gen_random_uuid(),
  hus text not null,
  greenhouse_required_plants integer check (greenhouse_required_plants is null or greenhouse_required_plants > 0),
  required_plants integer not null check (required_plants > 0),
  extra_plants integer not null default 0,
  variety text not null,
  week_number integer,
  sowing_tables text,
  sowing_date date not null,
  move_out_date date not null,
  previcure_date date,
  cycle_length integer not null check (cycle_length > 0),
  sector_type integer not null check (sector_type in (26, 39)),
  correction integer not null default 0,
  status plan_row_status not null default 'planned',
  source plan_row_source not null default 'user',
  archived_at timestamptz,
  archived_note text,
  archive_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sowing_plan_total_positive check (required_plants + extra_plants > 0),
  constraint sowing_plan_dates_order check (move_out_date >= sowing_date),
  constraint sowing_plan_archive_snapshot_required check (archived_at is null or archive_snapshot is not null)
);

create table work_adjustments (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  work_type work_adjustment_type not null,
  dates jsonb not null,
  source work_adjustment_source not null,
  locked boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_adjustments_dates_array check (jsonb_typeof(dates) = 'array'),
  constraint work_adjustments_dates_not_empty check (jsonb_array_length(dates) > 0),
  constraint work_adjustments_unique_work unique (sowing_plan_row_id, work_type)
);

create table table_placements (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null unique references sowing_plan_rows (id) on delete cascade,
  primary_row greenhouse_row_id,
  tables integer check (tables > 0),
  manual boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table change_history (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  field text not null,
  from_value text not null default '',
  to_value text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);

create table plant_corrections (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  correction_date date not null,
  amount integer not null check (amount <> 0),
  reason plant_correction_reason not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hus_events (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  event_date date not null,
  event_type text not null,
  location text,
  destination_location text,
  plant_change integer check (plant_change is null or plant_change <> 0),
  plant_correction_id uuid references plant_corrections (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hus_notes (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  observation_date date,
  note text,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hus_photos (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  hus_event_id uuid references hus_events (id) on delete cascade,
  hus_note_id uuid references hus_notes (id) on delete cascade,
  storage_bucket text not null default 'small-plants-hus-photos',
  storage_path text not null,
  original_file_name text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  constraint hus_photos_one_target check (num_nonnulls(hus_event_id, hus_note_id) = 1),
  constraint hus_photos_storage_path_unique unique (storage_bucket, storage_path)
);

create table sowing_plan_documents (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null default 'small-plants-plan-documents',
  storage_path text not null,
  original_file_name text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sowing_plan_documents_storage_path_unique unique (storage_bucket, storage_path)
);

create index sowing_plan_rows_sowing_date_idx on sowing_plan_rows (sowing_date);
create index sowing_plan_rows_move_out_date_idx on sowing_plan_rows (move_out_date);
create index sowing_plan_rows_hus_idx on sowing_plan_rows (hus);
create index sowing_plan_rows_active_sowing_date_idx on sowing_plan_rows (sowing_date) where archived_at is null;
create index sowing_plan_rows_archived_at_idx on sowing_plan_rows (archived_at desc) where archived_at is not null;
create unique index sowing_plan_rows_active_cycle_identity_idx
on sowing_plan_rows (lower(btrim(hus)), sowing_date, move_out_date)
where archived_at is null;
create index work_adjustments_plan_row_idx on work_adjustments (sowing_plan_row_id);
create index table_placements_plan_row_idx on table_placements (sowing_plan_row_id);
create index change_history_plan_row_created_idx on change_history (sowing_plan_row_id, created_at desc);
create index plant_corrections_plan_row_date_idx on plant_corrections (sowing_plan_row_id, correction_date);
create index hus_events_plan_row_date_idx on hus_events (sowing_plan_row_id, event_date);
create index hus_events_plant_correction_idx on hus_events (plant_correction_id);
create index hus_notes_plan_row_created_idx on hus_notes (sowing_plan_row_id, created_at desc);
create index hus_photos_plan_row_created_idx on hus_photos (sowing_plan_row_id, created_at desc);
create index hus_photos_event_idx on hus_photos (hus_event_id);
create index hus_photos_note_idx on hus_photos (hus_note_id);
create unique index sowing_plan_documents_one_current_idx
on sowing_plan_documents (is_current)
where is_current;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function validate_hus_photo_target()
returns trigger
language plpgsql
as $$
declare
  target_row_id uuid;
begin
  if new.hus_event_id is not null then
    select sowing_plan_row_id
    into target_row_id
    from hus_events
    where id = new.hus_event_id;

    if target_row_id is null or target_row_id <> new.sowing_plan_row_id then
      raise exception 'hus_photos.sowing_plan_row_id must match hus_events.sowing_plan_row_id'
        using errcode = '23514';
    end if;
  end if;

  if new.hus_note_id is not null then
    select sowing_plan_row_id
    into target_row_id
    from hus_notes
    where id = new.hus_note_id;

    if target_row_id is null or target_row_id <> new.sowing_plan_row_id then
      raise exception 'hus_photos.sowing_plan_row_id must match hus_notes.sowing_plan_row_id'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger sowing_plan_rows_set_updated_at
before update on sowing_plan_rows
for each row execute function set_updated_at();

create trigger work_adjustments_set_updated_at
before update on work_adjustments
for each row execute function set_updated_at();

create trigger table_placements_set_updated_at
before update on table_placements
for each row execute function set_updated_at();

create trigger plant_corrections_set_updated_at
before update on plant_corrections
for each row execute function set_updated_at();

create trigger hus_events_set_updated_at
before update on hus_events
for each row execute function set_updated_at();

create trigger hus_notes_set_updated_at
before update on hus_notes
for each row execute function set_updated_at();

create trigger hus_photos_validate_target
before insert or update of sowing_plan_row_id, hus_event_id, hus_note_id on hus_photos
for each row execute function validate_hus_photo_target();

create trigger sowing_plan_documents_set_updated_at
before update on sowing_plan_documents
for each row execute function set_updated_at();

alter table sowing_plan_rows enable row level security;
alter table work_adjustments enable row level security;
alter table table_placements enable row level security;
alter table change_history enable row level security;
alter table plant_corrections enable row level security;
alter table hus_events enable row level security;
alter table hus_notes enable row level security;
alter table hus_photos enable row level security;
alter table sowing_plan_documents enable row level security;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'small-plants-plan-documents',
      'small-plants-plan-documents',
      false,
      10485760,
      array['image/jpeg', 'image/png', 'application/pdf']
    )
    on conflict (id) do update
    set
      public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'small-plants-hus-photos',
      'small-plants-hus-photos',
      false,
      10485760,
      array['image/jpeg', 'image/png']
    )
    on conflict (id) do update
    set
      public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png'];
  end if;
end
$$;

-- Shared-password app model:
-- The browser must not receive Supabase credentials and should have no direct table access.
-- Next.js server/API code uses the server-only Supabase service-role key after app-cookie auth.
-- Keep RLS enabled and do not create anon/authenticated client policies for these private tables.

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
      raise exception 'HUS changed elsewhere' using errcode = '40001';
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
