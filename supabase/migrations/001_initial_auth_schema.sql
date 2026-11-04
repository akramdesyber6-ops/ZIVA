create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role_id uuid;
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      updated_at = now();

  select r.id into v_role_id
  from public.roles r
  where r.name = 'user';

  if v_role_id is null then
    insert into public.roles (name, description)
    values ('user', 'Standard public user')
    on conflict (name) do nothing
    returning id into v_role_id;
  end if;

  if v_role_id is not null then
    insert into public.user_roles (user_id, role_id)
    values (new.id, v_role_id)
    on conflict (user_id, role_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.is_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.name = 'admin'
  );
$$;

revoke all on function public.is_user_admin() from public;
grant execute on function public.is_user_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create policy "Users can view own profile"
on public.profiles
for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Admins can view all profiles"
on public.profiles
for select
using (public.is_user_admin());

create policy "Admins can read roles"
on public.roles
for select
using (public.is_user_admin());

create policy "Admins can manage roles"
on public.roles
for all
using (public.is_user_admin())
with check (public.is_user_admin());

create policy "Admins can manage role assignments"
on public.user_roles
for all
using (public.is_user_admin())
with check (public.is_user_admin());

insert into public.roles (name, description)
values
  ('user', 'Standard public user'),
  ('admin', 'System administrator')
on conflict (name) do nothing;
