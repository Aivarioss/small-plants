create type sector_table_capacity as enum ('26', '39');
create type work_type as enum ('sowing', 'thinning', 'previcure', 'sideShoots', 'sticks', 'rings', 'harvest');
create type plan_row_status as enum ('planned', 'imported', 'active', 'done');

create table sowing_plan_rows (
  id uuid primary key default gen_random_uuid(),
  sector_name text not null,
  required_plants integer not null check (required_plants > 0),
  extra_plants integer not null default 0,
  variety text not null,
  week_number integer,
  sowing_date date not null,
  harvest_date date not null,
  previcure_date date,
  cycle_length integer not null check (cycle_length > 0),
  sector_table_capacity sector_table_capacity not null,
  plants_per_box integer not null check (plants_per_box > 0),
  correction integer not null default 0,
  status plan_row_status not null default 'planned',
  placement jsonb not null default '{}'::jsonb,
  adjustments jsonb not null default '{}'::jsonb,
  change_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sowing_plan_total_positive check (required_plants + extra_plants > 0),
  constraint sowing_plan_dates_order check (harvest_date >= sowing_date)
);

create index sowing_plan_rows_sowing_date_idx on sowing_plan_rows (sowing_date);
create index sowing_plan_rows_harvest_date_idx on sowing_plan_rows (harvest_date);
create index sowing_plan_rows_sector_idx on sowing_plan_rows (sector_name);

-- In the local MVP, planned work is derived from sowing_plan_rows.
-- Persist this later only if generated work must be audited or synchronized independently.
create table planned_work_items (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  work_type work_type not null,
  planned_date date not null,
  cycle_day integer not null check (cycle_day > 0),
  fixed boolean not null default false,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index planned_work_items_date_idx on planned_work_items (planned_date);
create index planned_work_items_plan_row_idx on planned_work_items (sowing_plan_row_id);
