-- Single-owner model: exactly one row in public.owners. Every policy in later migrations gates on public.is_owner().

create table public.owners (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  singleton  boolean not null default true unique check (singleton),   -- at most one row, ever
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;

-- If the owner login already exists when this runs, claim it now (the first/only user).
insert into public.owners (user_id)
select id from auth.users order by created_at asc limit 1
on conflict do nothing;

-- Every later policy gates on this, so it also enforces 2FA: once the user has a verified factor, only an aal2
-- JWT counts. Without that, a password-only (aal1) token could query PostgREST directly and skip the code step.
-- security definer so it can read auth.mfa_factors, which authenticated users cannot select.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.owners where user_id = (select auth.uid()))
    and ((select auth.jwt() ->> 'aal') = 'aal2'
         or not exists (select 1 from auth.mfa_factors where user_id = (select auth.uid()) and status = 'verified'))
$$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- Called once after the first successful login if the owners table is still empty. First caller wins.
create or replace function public.claim_ownership()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    return false;
  end if;
  if exists (select 1 from public.owners) then
    return exists (select 1 from public.owners where user_id = uid);
  end if;
  insert into public.owners (user_id) values (uid) on conflict do nothing;
  return exists (select 1 from public.owners where user_id = uid);
end;
$$;
revoke execute on function public.claim_ownership() from public, anon;
grant execute on function public.claim_ownership() to authenticated;

create policy owners_select_self on public.owners
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Preferences, synced across devices (the cookie stays the fast read path).
create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  language       text not null default 'en'          check (language in ('en', 'zh-CN')),
  timezone       text not null default 'Asia/Kuala_Lumpur',
  date_format    text not null default 'D MMM YYYY'  check (date_format in ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'D MMM YYYY')),
  time_format    text not null default '24h'         check (time_format in ('24h', '12h')),
  number_format  text not null default '1,234.5'     check (number_format in ('1,234.5', '1.234,5', '1 234,5')),
  week_start     text not null default 'mon'         check (week_start in ('mon', 'sun')),
  theme          text not null default 'ink'         check (theme in ('ink', 'sunset', 'forest', 'mono')),
  mode           text not null default 'light'       check (mode in ('light', 'dark')),
  density        text not null default 'dense'       check (density in ('dense', 'comfortable')),
  radius         text not null default 'soft'        check (radius in ('sharp', 'soft', 'round')),
  alert_settings jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy profiles_owner_all on public.profiles
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_owner())
  with check (user_id = (select auth.uid()) and public.is_owner());
