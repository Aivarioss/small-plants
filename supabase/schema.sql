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
