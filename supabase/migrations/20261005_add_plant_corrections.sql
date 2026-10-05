do $$
begin
  if not exists (select 1 from pg_type where typname = 'plant_correction_reason') then
    create type plant_correction_reason as enum ('thinning', 'brownRoots', 'damaged', 'other');
  end if;
end
$$;

create table if not exists plant_corrections (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references sowing_plan_rows (id) on delete cascade,
  correction_date date not null,
  amount integer not null check (amount <> 0),
  reason plant_correction_reason not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plant_corrections_plan_row_date_idx
on plant_corrections (sowing_plan_row_id, correction_date);

drop trigger if exists plant_corrections_set_updated_at on plant_corrections;
create trigger plant_corrections_set_updated_at
before update on plant_corrections
for each row execute function set_updated_at();

alter table plant_corrections enable row level security;
