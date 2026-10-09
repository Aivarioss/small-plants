-- Prepared migration only. Review and run manually in Supabase SQL Editor.
-- It is intentionally non-destructive.

create unique index if not exists sowing_plan_rows_active_cycle_identity_idx
on public.sowing_plan_rows (lower(btrim(hus)), sowing_date, move_out_date)
where archived_at is null;

create table if not exists public.sowing_plan_documents (
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

create unique index if not exists sowing_plan_documents_one_current_idx
on public.sowing_plan_documents (is_current)
where is_current;

drop trigger if exists sowing_plan_documents_set_updated_at on public.sowing_plan_documents;
create trigger sowing_plan_documents_set_updated_at
before update on public.sowing_plan_documents
for each row execute function public.set_updated_at();

alter table public.sowing_plan_documents enable row level security;

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
