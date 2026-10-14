-- Plan 5: synced Instagram data + sync bookkeeping. Owner session: read-only (select policies gated on is_owner()).
-- Every write goes through the server-side admin (secret-key) client, which bypasses RLS.

-- One row per account per Instagram insight day (owner timezone). followers is the count observed during that day.
-- profile_views stays null: the account-level metric was removed from the API (v21+); kept for the SPEC §5 shape.
create table public.account_daily (
  account_id         uuid not null references public.accounts (id) on delete cascade,
  day                date not null,
  followers          integer,
  reach              integer,
  views              integer,
  profile_views      integer,
  accounts_engaged   integer,
  total_interactions integer,
  follows            integer,
  unfollows          integer,
  link_taps          integer,
  updated_at         timestamptz not null default now(),
  primary key (account_id, day)
);
alter table public.account_daily enable row level security;
create policy account_daily_owner_select on public.account_daily
  for select to authenticated
  using (public.is_owner());

-- Feed posts, Reels and Stories. id is the Instagram media id.
create table public.media (
  id              text primary key,
  account_id      uuid not null references public.accounts (id) on delete cascade,
  media_type      text not null check (media_type in ('IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY')),
  permalink       text,
  caption         text,
  posted_at       timestamptz not null,
  expires_at      timestamptz,                -- stories only: posted_at + 24h
  last_metrics_at timestamptz,                -- when the last media_metrics snapshot was taken (drives re-capture)
  gone_at         timestamptz,                -- Instagram says the media no longer exists; stop fetching, keep history
  created_at      timestamptz not null default now()
);
create index media_account_posted_idx on public.media (account_id, posted_at desc);
alter table public.media enable row level security;
create policy media_owner_select on public.media
  for select to authenticated
  using (public.is_owner());

-- Point-in-time metric snapshots (growth curves). Story-only columns stay null for feed/reels.
create table public.media_metrics (
  media_id           text not null references public.media (id) on delete cascade,
  captured_at        timestamptz not null,
  reach              integer,
  views              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saves              integer,
  total_interactions integer,
  replies            integer,
  taps_forward       integer,
  taps_back          integer,
  exits              integer,
  primary key (media_id, captured_at)
);
alter table public.media_metrics enable row level security;
create policy media_metrics_owner_select on public.media_metrics
  for select to authenticated
  using (public.is_owner());

create table public.audience_snapshots (
  account_id uuid not null references public.accounts (id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('age_gender', 'country', 'city')),
  data       jsonb not null,
  primary key (account_id, day, kind)
);
alter table public.audience_snapshots enable row level security;
create policy audience_snapshots_owner_select on public.audience_snapshots
  for select to authenticated
  using (public.is_owner());

create table public.online_followers (
  account_id uuid not null references public.accounts (id) on delete cascade,
  day        date not null,
  hourly     jsonb not null,                  -- 24 numbers, index = hour as Instagram reports it
  primary key (account_id, day)
);
alter table public.online_followers enable row level security;
create policy online_followers_owner_select on public.online_followers
  for select to authenticated
  using (public.is_owner());

-- Per-account scheduler state. The lease (lease_id + lease_until) stops overlapping ticks from double-running.
create table public.sync_state (
  account_id           uuid primary key references public.accounts (id) on delete cascade,
  lease_id             uuid,
  lease_until          timestamptz,
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error_key       text,
  daily_done_through   date,                  -- last insight day fully written to account_daily
  last_run             jsonb not null default '{}'::jsonb   -- { "<job>": "<ISO time of last success>" }
);
alter table public.sync_state enable row level security;
create policy sync_state_owner_select on public.sync_state
  for select to authenticated
  using (public.is_owner());

-- One row per tick (cron or manual): a small JSON summary with counts and error keys, never tokens.
create table public.sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null,
  finished_at timestamptz not null,
  trigger     text not null check (trigger in ('cron', 'manual')),
  summary     jsonb not null
);
alter table public.sync_runs enable row level security;
create policy sync_runs_owner_select on public.sync_runs
  for select to authenticated
  using (public.is_owner());
