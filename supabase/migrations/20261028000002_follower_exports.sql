-- Plan 15b: follower / following snapshots the owner uploads from Instagram's "Download your information" export
-- (creator-toolkit design §6). No API gives follower names and crawling was declined (design §0b), so this upload is
-- the only by-name route.
--
-- Owner-authored data (like tags and explorer_views): the owner session selects, inserts and deletes under RLS; the
-- app never uses the admin client for this table, and lib/followers/read.ts is the only module that names it.
-- Third-party usernames are personal data: owner-only, never logged, deleted with the account (on delete cascade =
-- SPEC §7c "Delete all data permanently") or one snapshot at a time from the Followers tab.
--
-- ONE row per snapshot with array columns instead of one row per username: at 50,000 followers a row per name costs
-- ~110 bytes each with its index entry (~6 MB per snapshot), the arrays ~1 MB after TOAST compression, read in one
-- round trip. The arrays are never queried element-wise (the diff is TypeScript, lib/followers/diff.ts).
-- followers_at / following_at: when each follow happened, seconds since 1970 UTC as in the file, NULL = unknown; same
-- length and order as the name arrays. following / following_at are NULL when the upload had no following.json.
-- The caps equal MAX_FOLLOWERS / MAX_FOLLOWING in lib/followers/parse.ts (the app checks them first).
create table public.follower_exports (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  taken_on        date not null check (taken_on >= date '2010-10-06'),
  followers       text[] not null,
  followers_at    bigint[] not null,
  following       text[],
  following_at    bigint[],
  follower_count  int generated always as (cardinality(followers)) stored,
  following_count int generated always as (cardinality(following)) stored,
  created_at      timestamptz not null default now(),
  check (cardinality(followers) <= 50000 and cardinality(followers_at) = cardinality(followers) and array_position(followers, null) is null),
  check ((following is null) = (following_at is null)),
  check (following is null or (cardinality(following) <= 10000 and cardinality(following_at) = cardinality(following) and array_position(following, null) is null))
);
-- the Followers tab lists an account's snapshots newest first; the cascade from accounts uses it too
create index follower_exports_account_idx on public.follower_exports (account_id, taken_on desc, created_at desc);
alter table public.follower_exports enable row level security;
create policy follower_exports_owner_all on public.follower_exports
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.follower_exports from anon;
