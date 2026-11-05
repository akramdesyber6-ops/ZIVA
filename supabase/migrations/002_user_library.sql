create table if not exists public.user_library (
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv', 'anime')),
  content_id text not null check (char_length(content_id) between 1 and 160),
  collection text not null check (collection in ('watchlist', 'favorite')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, media_type, content_id, collection)
);

create index if not exists user_library_collection_updated_idx
  on public.user_library (user_id, collection, updated_at desc);

alter table public.user_library enable row level security;

drop policy if exists "Users can read their own library" on public.user_library;
create policy "Users can read their own library"
  on public.user_library for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add to their own library" on public.user_library;
create policy "Users can add to their own library"
  on public.user_library for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own library" on public.user_library;
create policy "Users can update their own library"
  on public.user_library for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove from their own library" on public.user_library;
create policy "Users can remove from their own library"
  on public.user_library for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_library to authenticated;

create table if not exists public.watch_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv', 'anime')),
  content_id text not null check (char_length(content_id) between 1 and 160),
  title text not null check (char_length(title) between 1 and 240),
  position_seconds integer not null default 0 check (position_seconds >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, media_type, content_id),
  check (duration_seconds is null or position_seconds <= duration_seconds)
);

create index if not exists watch_history_recent_idx
  on public.watch_history (user_id, updated_at desc);

alter table public.watch_history enable row level security;

drop policy if exists "Users can read their own watch history" on public.watch_history;
create policy "Users can read their own watch history"
  on public.watch_history for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add their own watch history" on public.watch_history;
create policy "Users can add their own watch history"
  on public.watch_history for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own watch history" on public.watch_history;
create policy "Users can update their own watch history"
  on public.watch_history for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own watch history" on public.watch_history;
create policy "Users can remove their own watch history"
  on public.watch_history for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.watch_history to authenticated;
