create table if not exists public.hus_notes (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references public.sowing_plan_rows (id) on delete cascade,
  observation_date date,
  note text,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hus_photos (
  id uuid primary key default gen_random_uuid(),
  sowing_plan_row_id uuid not null references public.sowing_plan_rows (id) on delete cascade,
  hus_event_id uuid references public.hus_events (id) on delete cascade,
  hus_note_id uuid references public.hus_notes (id) on delete cascade,
  storage_bucket text not null default 'small-plants-hus-photos',
  storage_path text not null,
  original_file_name text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png')),
  file_size_bytes integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  constraint hus_photos_one_target check (num_nonnulls(hus_event_id, hus_note_id) = 1),
  constraint hus_photos_storage_path_unique unique (storage_bucket, storage_path)
);

alter table public.hus_photos
drop constraint if exists hus_photos_target_required;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'hus_photos_one_target'
      and conrelid = 'public.hus_photos'::regclass
  ) then
    alter table public.hus_photos
    add constraint hus_photos_one_target check (num_nonnulls(hus_event_id, hus_note_id) = 1);
  end if;
end
$$;

create or replace function public.validate_hus_photo_target()
returns trigger
language plpgsql
as $$
declare
  target_row_id uuid;
begin
  if new.hus_event_id is not null then
    select sowing_plan_row_id
    into target_row_id
    from public.hus_events
    where id = new.hus_event_id;

    if target_row_id is null or target_row_id <> new.sowing_plan_row_id then
      raise exception 'hus_photos.sowing_plan_row_id must match hus_events.sowing_plan_row_id'
        using errcode = '23514';
    end if;
  end if;

  if new.hus_note_id is not null then
    select sowing_plan_row_id
    into target_row_id
    from public.hus_notes
    where id = new.hus_note_id;

    if target_row_id is null or target_row_id <> new.sowing_plan_row_id then
      raise exception 'hus_photos.sowing_plan_row_id must match hus_notes.sowing_plan_row_id'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create index if not exists hus_notes_plan_row_created_idx
on public.hus_notes (sowing_plan_row_id, created_at desc);

create index if not exists hus_photos_plan_row_created_idx
on public.hus_photos (sowing_plan_row_id, created_at desc);

create index if not exists hus_photos_event_idx
on public.hus_photos (hus_event_id);

create index if not exists hus_photos_note_idx
on public.hus_photos (hus_note_id);

drop trigger if exists hus_notes_set_updated_at on public.hus_notes;
create trigger hus_notes_set_updated_at
before update on public.hus_notes
for each row execute function public.set_updated_at();

drop trigger if exists hus_photos_validate_target on public.hus_photos;
create trigger hus_photos_validate_target
before insert or update of sowing_plan_row_id, hus_event_id, hus_note_id on public.hus_photos
for each row execute function public.validate_hus_photo_target();

alter table public.hus_notes enable row level security;
alter table public.hus_photos enable row level security;

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
-- Browser clients do not receive Supabase credentials and should not access this bucket/table directly.
-- Next.js server/API uses the server-only service-role key after app-cookie auth.
-- Keep RLS enabled and do not add anon/authenticated policies for this private data.
