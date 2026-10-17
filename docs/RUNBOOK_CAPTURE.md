# Runbook — Data Capture v2b (Plan 11b)

How to check, live, everything Plan 11b captures: granted scopes, capability memory, Story extras, per-media extras,
media fields, cover images, comments and the raw response archive. Run the SQL in the Supabase SQL editor (it runs as
`postgres`, so RLS does not hide rows). Nothing here prints tokens; never paste tokens, CDN URLs or comment texts into
chats or issues. Everything the owner still has to do by hand, across the whole project, is listed in
docs/OWNER_ACTIONS.md.

## 0. Before deploying
1. Apply the migration FIRST: `npx supabase db push --yes --password $SUPABASE_DB_PASSWORD` (see docs/HANDOVER.md §4).
   The new code writes columns that only exist after `20261022000001_capture_v2b.sql`. This is an owner step: nobody
   applies it for you.
2. Check the bucket is private and capped:
   ```sql
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'covers';
   -- expect: covers | false | 5242880 | {image/jpeg,image/png,image/webp}
   select count(*) from pg_policies where schemaname = 'storage' and policyname ilike '%cover%';  -- expect 0
   ```
3. Existing accounts were given the two original scopes:
   ```sql
   select username, granted_scopes from accounts order by connected_at;
   ```

## 1. Comments scope: reconnect each account once
Accounts connected before the comments scope was requested show **"Reconnect to enable comments"** under their name on
`/accounts`. Do this once per account.
1. Click that link, log in to that Instagram account, approve all permissions (including comments).
2. Check: `select username, granted_scopes from accounts;` -> the list now contains `instagram_business_manage_comments`.
3. If `granted_scopes` is `null` after a reconnect, Meta did not report the granted permissions on the code exchange:
   tell the assistant (comments stay off rather than guessing).
4. Without the scope Instagram returns an EMPTY comments list without an error; the app never reads that as "no
   comments" — the comments job simply does not run for that account.

## 2. Capability memory (`sync_state.capabilities`)
```sql
select a.username, s.capabilities from sync_state s join accounts a on a.id = s.account_id;
```
Keys: `story:follows`, `story:profile_visits`, `story:profile_activity`, `feed:follows_visits`, `feed:profile_activity`,
`reels:watch`, `stories:url_fields`. `true` = Meta served it; `false` = Meta answered "not supported" (error 100 with
the "does not support / nonexisting field" wording) and it is no longer requested. Transient errors never write `false`.
**Reset** (e.g. after Meta adds support, or to re-probe):
```sql
update sync_state set capabilities = '{}';                                   -- all accounts
update sync_state set capabilities = capabilities - 'story:follows';         -- one key
```

## 3. Story extras — "post a Story and run a probe"
Story support for `follows`, `profile_visits`, `profile_activity` and the Story image fields is documented but was
never verified live (no Story was up while probing). The code discovers it at runtime; this procedure confirms it.
1. Post a Story on a connected account (insights need >= 5 viewers; under that Meta answers "not enough viewers" and
   nothing is stored, which is expected).
2. Wait for a tick, or trigger one: `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET`.
3. Story extras run on the pass in the first 30 minutes of each 2-hour window of the Story's age and on every pass in
   its last hour. After the first such pass:
   ```sql
   select m.id, mm.captured_at, mm.reach, mm.taps_forward, mm.taps_back, mm.exits, mm.swipe_forward,
          mm.follows, mm.profile_visits, mm.profile_activity
     from media m join media_metrics mm on mm.media_id = m.id
    where m.media_type = 'STORY'
    order by mm.captured_at desc limit 20;
   select capabilities from sync_state;   -- story:* keys now true (served) or false (unsupported)
   ```
4. Cover: `select id, cover_status, cover_attempts, cover_path from media where media_type = 'STORY' order by posted_at desc limit 5;`
   -> `ok` with `cover_path = '<account_id>/<media_id>.jpg'` within one tick of posting. If `stories:url_fields` is
   `false`, Meta rejected `media_url`/`thumbnail_url` on Stories: Story covers cannot be captured (they end
   `unavailable` at expiry) — report it.
5. Record the outcome in `docs/META_PROBE_RESULTS.md` (supported / unsupported per metric, date, no ids).

## 4. Per-media extras and the 7-day checkpoint
```sql
select m.media_type, mm.captured_at, mm.follows, mm.profile_visits, mm.profile_activity,
       mm.avg_watch_ms, mm.total_watch_ms, mm.skip_rate
  from media m join media_metrics mm on mm.media_id = m.id
 where m.media_type <> 'STORY' and m.posted_at > now() - interval '30 days'
 order by mm.captured_at desc limit 30;
```
Feed/carousel rows get follows/profile visits/activity, Reels rows get watch time and skip rate (Reels never get
follows/profile visits — Meta does not support them). Extras are budgeted (20 extra calls per account run), so a busy
tick can leave a snapshot without extras; the next one fills in.
7-day checkpoint: each post gets one snapshot right after its 7th day:
```sql
select m.id, min(mm.captured_at - m.posted_at) filter (where mm.captured_at - m.posted_at >= interval '7 days') as first_after_day7
  from media m join media_metrics mm on mm.media_id = m.id
 where m.media_type <> 'STORY' and m.posted_at between now() - interval '20 days' and now() - interval '8 days'
 group by m.id;   -- expect ~7 days + less than one hour
```

## 5. Media fields and carousel children
```sql
select media_type, media_product_type, like_count, comments_count, is_shared_to_feed, children_count
  from media where media_type <> 'STORY' order by posted_at desc limit 10;
select media_id, position, media_type from media_children order by media_id, position limit 20;
```
Filled by the hourly media list (recent posts) — older posts get them when they are next listed.

## 6. Cover images
```sql
select a.username, m.cover_status, count(*) from media m join accounts a on a.id = m.account_id
 group by 1, 2 order by 1, 2;
select count(*) as objects, pg_size_pretty(sum((metadata->>'size')::bigint)) as size
  from storage.objects where bucket_id = 'covers';
```
- New accounts: covers start after the history import (Overview numbers first), 25 per account per lane-2 run,
  newest first, hourly; posts whose image Meta does not offer (copyrighted media) end `unavailable`; failures retry
  after 30/60/120/240 min, then `unavailable`.
- Signed in, open `https://<domain>/api/media/<media_id>/cover` -> the image (`Cache-Control: private, max-age=31536000,
  immutable`). Signed out -> not served (401 or a redirect to `/login`). A media id without a stored cover -> 404.
- Orphaned objects (Storage clean-up after a permanent delete failed):
  ```sql
  select name from storage.objects
   where bucket_id = 'covers' and split_part(name, '/', 1) not in (select id::text from accounts);
  ```
  Delete them from the Storage dashboard (they are private and unreachable through the app).
- Archive keeps covers; only "Delete permanently" removes them.

## 7. Comments
```sql
select a.username, count(c.*) as comments, count(distinct c.author_username) as commenters, max(c.commented_at)
  from accounts a left join comments c on c.account_id = a.id group by 1;
select id, comments_count, comments_synced_count from media
 where media_type <> 'STORY' and posted_at > now() - interval '30 days' and comments_count > 0
 order by posted_at desc limit 10;   -- synced = count once ingested; a post stays unsynced while Meta returns nothing
```
Runs hourly in lane 2 after the import, only for accounts with the scope; posts of the last 30 days whose comment
count changed; top-level comments only; 20 page calls per account run. Usernames and texts are third-party personal
data: owner-only (RLS), deleted with the account, never logged and never in sync summaries. Do not copy them out of the
database into chats or issues.

## 8. Raw response archive
```sql
select a.username, count(*) as bodies, pg_size_pretty(sum(pg_column_size(s.body))) as size, max(s.captured_at)
  from api_snapshots s join accounts a on a.id = s.account_id group by 1;
select endpoint, captured_at from api_snapshots order by captured_at desc limit 10;
-- must return 0 rows (no token ever stored):
select count(*) from api_snapshots where endpoint ilike '%access_token%' or body::text ilike '%access_token%';
```
One row per distinct body per request (deduped by hash), so the daily re-fetch of the last 3 days only adds rows when
Meta revised the numbers. Only account-level insights and audience responses are kept (never media lists, captions or
comments). Meta's `paging` links (they carry the access token) are removed before archiving. Bodies over 64 KB are
skipped. Kept forever.

## 9. Expected growth (2 accounts)
| What | Per account | 2 accounts / year |
|---|---|---|
| `api_snapshots` | ~10 bodies/day x 1-3 KB | ~10-20 MB |
| `media_metrics` extras columns | a few bytes per snapshot | negligible |
| `comments` | depends on the audience; ~200 B/comment | < 5 MB for thousands of comments |
| Covers (Storage) | ~16-150 KB per post/Reel/Story | ~100 MB per 1,000 items (free tier: 1 GB) |

## 10. Known limits
- Comment edits that do not change a post's comment count are picked up at the next count change; replies and the
  `hidden` flag are not read yet (moderation plan).
- Carousel child covers are not captured (only the parent's first image).
- Story extras / Story covers depend on Meta supporting them on Stories (section 3).
- A cover backlog larger than 200 failed-and-waiting items can delay older pending ones until their back-off clears.
