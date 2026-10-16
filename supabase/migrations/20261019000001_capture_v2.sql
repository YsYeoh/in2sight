-- Plan 11 (Data Capture v2, first slice): two append-only history tables that cannot be backfilled from Instagram later.
-- Owner session: read-only (select policies gated on is_owner()). Writes only through the admin (secret-key) client.

-- Follower / following / media counts observed on every sync tick (about every 30 minutes) -> intraday follower curve.
create table public.follower_snapshots (
  account_id  uuid not null references public.accounts (id) on delete cascade,
  captured_at timestamptz not null,
  followers   integer,
  following   integer,
  media_count integer,
  primary key (account_id, captured_at)
);
alter table public.follower_snapshots enable row level security;
revoke all on public.follower_snapshots from anon, authenticated;
grant select on public.follower_snapshots to authenticated;
create policy follower_snapshots_owner_select on public.follower_snapshots
  for select to authenticated
  using (public.is_owner());

-- Daily reach and views split by follower type x media product type (account level, owner-timezone day).
-- follow_type: FOLLOWER | NON_FOLLOWER | UNKNOWN; product_type: STORY | REEL | POST | CAROUSEL_CONTAINER | AD.
create table public.account_daily_breakdown (
  account_id   uuid not null references public.accounts (id) on delete cascade,
  day          date not null,
  metric       text not null check (metric in ('reach', 'views')),
  follow_type  text not null,
  product_type text not null,
  value        integer not null,
  updated_at   timestamptz not null default now(),
  primary key (account_id, day, metric, follow_type, product_type)
);
alter table public.account_daily_breakdown enable row level security;
revoke all on public.account_daily_breakdown from anon, authenticated;
grant select on public.account_daily_breakdown to authenticated;
create policy account_daily_breakdown_owner_select on public.account_daily_breakdown
  for select to authenticated
  using (public.is_owner());
