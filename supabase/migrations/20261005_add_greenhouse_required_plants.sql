alter table public.sowing_plan_rows
add column if not exists greenhouse_required_plants integer;

alter table public.sowing_plan_rows
drop constraint if exists sowing_plan_rows_greenhouse_required_plants_check;

alter table public.sowing_plan_rows
add constraint sowing_plan_rows_greenhouse_required_plants_check
check (greenhouse_required_plants is null or greenhouse_required_plants > 0);
