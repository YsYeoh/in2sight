-- Plan 11a (onboarding sync): newest-first backfill coverage + live sync progress.
-- Owner session: read-only (select policy gated on is_owner()). Writes only through the admin (secret-key) client.

-- Backward edge of the newest-first import: every insight day from backfilled_from to daily_done_through is handled
-- (written, or confirmed unavailable). null = the import has not started.
alter table public.sync_state add column backfilled_from date;

-- Accounts synced before this plan finished the old oldest-first backfill: mark them complete (coverage from their
-- oldest stored day, backfill job stamped done) so nothing is re-fetched.
update public.sync_state s
   set backfilled_from = coalesce((select min(d.day) from public.account_daily d where d.account_id = s.account_id), s.daily_done_through),
       last_run = s.last_run || jsonb_build_object('backfill', to_jsonb(now()))
 where s.daily_done_through is not null;

-- Live activity of the current sync run, one row per account (stage, counts, the day being fetched). Counts and keys
-- only: never tokens, media ids or captions. Reset (not deleted) on reconnect / "Sync now".
create table public.sync_progress (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  stage       text check (stage in ('profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience', 'covers', 'comments')),
  state       text not null default 'waiting' check (state in ('waiting', 'running', 'failed', 'done')),
  done        integer not null default 0 check (done >= 0),
  total       integer check (total >= 0),
  detail_day  date,
  error_key   text,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.sync_progress enable row level security;
revoke all on public.sync_progress from anon, authenticated;
grant select on public.sync_progress to authenticated;
create policy sync_progress_owner_select on public.sync_progress
  for select to authenticated
  using (public.is_owner());
