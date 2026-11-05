create table if not exists public.catalog_entries (
  id uuid primary key default gen_random_uuid(),
  media_type text not null check (media_type in ('movie', 'tv', 'anime')),
  external_id text not null check (char_length(external_id) between 1 and 160),
  title text not null check (char_length(title) between 1 and 240),
  description text not null default '',
  release_year integer check (release_year is null or release_year between 1800 and 2200),
  genres text[] not null default '{}',
  poster_url text,
  backdrop_url text,
  is_published boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_type, external_id)
);

create index if not exists catalog_entries_public_idx
  on public.catalog_entries (media_type, is_published, updated_at desc);

alter table public.catalog_entries enable row level security;

drop policy if exists "Anyone can read published catalogue entries" on public.catalog_entries;
create policy "Anyone can read published catalogue entries"
  on public.catalog_entries for select
  using (is_published);

drop policy if exists "Admins can manage catalogue entries" on public.catalog_entries;
create policy "Admins can manage catalogue entries"
  on public.catalog_entries for all
  to authenticated
  using (public.is_user_admin())
  with check (public.is_user_admin());

grant select on public.catalog_entries to anon, authenticated;
grant insert, update, delete on public.catalog_entries to authenticated;

create table if not exists public.authorized_video_sources (
  id uuid primary key default gen_random_uuid(),
  catalog_entry_id uuid not null references public.catalog_entries(id) on delete cascade,
  provider_name text not null check (char_length(provider_name) between 1 and 120),
  provider_asset_id text not null check (char_length(provider_asset_id) between 1 and 240),
  rights_reference text not null check (char_length(rights_reference) between 1 and 500),
  rights_expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'expired', 'revoked')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_name, provider_asset_id)
);

alter table public.authorized_video_sources enable row level security;

drop policy if exists "Admins can manage authorized video sources" on public.authorized_video_sources;
create policy "Admins can manage authorized video sources"
  on public.authorized_video_sources for all
  to authenticated
  using (public.is_user_admin())
  with check (public.is_user_admin());

grant select, insert, update, delete on public.authorized_video_sources to authenticated;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null check (plan in ('free', 'premium')),
  status text not null check (status in ('active', 'trialing', 'past_due', 'cancelled', 'expired')),
  provider text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create index if not exists subscriptions_user_updated_idx
  on public.subscriptions (user_id, updated_at desc);

alter table public.subscriptions enable row level security;

drop policy if exists "Users can read their own subscriptions" on public.subscriptions;
create policy "Users can read their own subscriptions"
  on public.subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins can manage subscriptions" on public.subscriptions;
create policy "Admins can manage subscriptions"
  on public.subscriptions for all
  to authenticated
  using (public.is_user_admin())
  with check (public.is_user_admin());

grant select on public.subscriptions to authenticated;
grant insert, update, delete on public.subscriptions to authenticated;

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 80),
  external_payment_id text,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, external_payment_id)
);

create index if not exists payment_records_user_recent_idx
  on public.payment_records (user_id, occurred_at desc);

alter table public.payment_records enable row level security;

drop policy if exists "Users can read their own payment records" on public.payment_records;
create policy "Users can read their own payment records"
  on public.payment_records for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins can manage payment records" on public.payment_records;
create policy "Admins can manage payment records"
  on public.payment_records for all
  to authenticated
  using (public.is_user_admin())
  with check (public.is_user_admin());

grant select on public.payment_records to authenticated;
grant insert, update, delete on public.payment_records to authenticated;
