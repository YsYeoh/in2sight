-- Plan 11b (Data Capture v2, remainder). All additive. Apply BEFORE deploying the code that writes these columns.
-- Owner session: read-only (select policies gated on is_owner()). Every write goes through the admin (secret-key) client.

-- 1. Scopes Meta actually granted at connect/reconnect (the code exchange's `permissions`). Accounts connected before
-- this plan were authorized with the two original scopes only (no comments scope until they reconnect).
alter table public.accounts add column granted_scopes text[];
update public.accounts
   set granted_scopes = array['instagram_business_basic', 'instagram_business_manage_insights']
 where granted_scopes is null;

-- 2. Metric/field support learned at runtime, e.g. {"story:follows": false}. Reset with: update sync_state set capabilities = '{}';
alter table public.sync_state add column capabilities jsonb not null default '{}'::jsonb;

-- 3 + 4. Story and per-media extras (all nullable: null = not captured, never 0).
alter table public.media_metrics
  add column swipe_forward    integer,
  add column follows          integer,
  add column profile_visits   integer,
  add column profile_activity jsonb,     -- { "<action_type>": n }, e.g. BIO_LINK_CLICKED, CALL, DIRECTION, EMAIL, TEXT
  add column avg_watch_ms     integer,   -- ig_reels_avg_watch_time (ms)
  add column total_watch_ms   bigint,    -- ig_reels_video_view_total_time (ms)
  add column skip_rate        numeric;   -- reels_skip_rate (percent)

-- 5 + 6 + 7. Media fields we used to drop, cover capture state, comment sync marker.
alter table public.media
  add column media_product_type    text,
  add column like_count            integer,
  add column comments_count        integer,
  add column is_shared_to_feed     boolean,
  add column children_count        integer,
  add column cover_path            text,          -- Storage key in bucket "covers": {account_id}/{media_id}.jpg
  add column cover_status          text not null default 'pending' check (cover_status in ('pending', 'ok', 'unavailable', 'failed')),
  add column cover_captured_at     timestamptz,
  add column cover_attempts        integer not null default 0 check (cover_attempts >= 0),
  add column cover_tried_at        timestamptz,
  add column comments_synced_count integer;       -- comments_count at the last successful comments ingest

-- Stories that already expired can never get a cover (the CDN link died with them).
update public.media set cover_status = 'unavailable' where media_type = 'STORY' and expires_at < now();

-- Carousel children (first 10, in order). Child covers are not captured yet (columns reserved for Post Lab).
create table public.media_children (
  media_id     text not null references public.media (id) on delete cascade,
  position     integer not null check (position between 0 and 9),
  media_type   text,
  cover_path   text,
  cover_status text check (cover_status in ('pending', 'ok', 'unavailable', 'failed')),
  primary key (media_id, position)
);
alter table public.media_children enable row level security;
revoke all on public.media_children from anon, authenticated;
grant select on public.media_children to authenticated;
create policy media_children_owner_select on public.media_children
  for select to authenticated
  using (public.is_owner());

-- Private cover bucket: no storage policies at all, so only the secret-key (admin) client can read or write objects.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Comments on the owner's media (read only). Third-party usernames are personal data: owner-only, deleted with the
-- account (cascade), never logged, not exported unless chosen later.
create table public.comments (
  id              text primary key,             -- Instagram comment id
  account_id      uuid not null references public.accounts (id) on delete cascade,
  media_id        text not null references public.media (id) on delete cascade,
  parent_id       text,                         -- replies (not ingested yet)
  author_username text,
  author_id       text,
  text            text,
  like_count      integer,
  commented_at    timestamptz not null,
  hidden          boolean not null default false,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create index comments_media_idx on public.comments (media_id, commented_at desc);
create index comments_account_idx on public.comments (account_id, commented_at desc);
alter table public.comments enable row level security;
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
create policy comments_owner_select on public.comments
  for select to authenticated
  using (public.is_owner());

-- Raw JSON of account-level insights and audience calls (never media lists, captions or comments), deduped by hash,
-- bodies over 64 KB skipped, kept forever so history can be reprocessed. Estimate: ~10 small bodies/account/day, a few MB/year.
create table public.api_snapshots (
  id          bigint generated always as identity primary key,
  account_id  uuid not null references public.accounts (id) on delete cascade,
  endpoint    text not null,                    -- path + sorted query params, never the token
  captured_at timestamptz not null default now(),
  body        jsonb not null,
  body_hash   text not null,                    -- sha256 hex of the JSON text
  unique (account_id, endpoint, body_hash)
);
create index api_snapshots_account_idx on public.api_snapshots (account_id, captured_at desc);
alter table public.api_snapshots enable row level security;
revoke all on public.api_snapshots from anon, authenticated;
grant select on public.api_snapshots to authenticated;
create policy api_snapshots_owner_select on public.api_snapshots
  for select to authenticated
  using (public.is_owner());
