# Plan 11b: Data Capture v2 (remainder) — granted scopes, capability memory, Story + per-media extras, media fields, covers to private Storage, comments, raw archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture everything Instagram gives us that cannot be re-fetched later — Story extras (SWIPE_FORWARD, follows, profile visits, profile activity) while the Story is live, per-media extras (feed follows/profile visits/profile activity, Reels watch time/skip rate) with a 7-day checkpoint, the media fields we currently drop, cover images copied into a private Storage bucket (Stories on first sight), comments (only when the comments scope is really granted), and the raw JSON of account-level insights — without ever letting an extra break the core capture.

**Architecture:** One additive migration. The OAuth code exchange now returns the `permissions` Meta granted; they are stored on `accounts.granted_scopes` and `hasScope()` gates comments (an empty comments list is never taken as "no comments"). Every optional Meta call is a separate, non-fatal call; an "unsupported metric/field" answer (code 100 + a fixed message pattern, kept only as a boolean) is remembered in `sync_state.capabilities` so it is not re-requested, while transient errors never touch that memory. Story extras and Story covers run inside the Stories job AFTER the core capture; per-media extras run after the core media loop with a per-run call budget; post covers and comments are new lane-2-only jobs (`covers`, `comments`) that run after the history import and report the reserved progress stages. Raw account-insights bodies are archived (deduped by hash, size-capped) through a callback the data client calls; the archive write is best-effort and time-capped.

**Tech Stack:** Next.js 16 App Router (route handler), Supabase Postgres + RLS + Storage (private bucket, admin client only), next-intl 4, Vitest. **New dependencies: none** (`node:crypto` for the body hash, `fetch` for the CDN).

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b (Plan 11 scope, data policy), §4 (covers: data, Storage, serving, SSRF rules, delete), §5 (Post Lab metrics + 7-day checkpoint), §8 (cross-cutting); `docs/TODO.md` §6c; verified Meta facts `docs/META_PROBE_RESULTS.md` (authoritative); `docs/HANDOVER.md` §1b/§1c. Project rules: `CLAUDE.md` (binding).

**Dry run (2026-10-17):** every task's code was executed once, in order, in a throwaway clone outside the repo (fresh `npm ci`, from `main` 97625c6, no new packages). See "Dry-run result" at the end. Nothing touched Supabase or Meta.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- ⚠ **Comments are incremental by COUNT, not by a `commented_at` cursor** (the brief said "incremental by commented_at"). A post is re-read when the `comments_count` from the hourly listing differs from the count at its last ingest (`media.comments_synced_count`). Meta does not document the order of the comments edge, so a "stop at the newest stored timestamp" cursor could silently miss new comments on long threads; the count rule is order-agnostic and costs zero calls for quiet posts. Limit: an edited comment (same count) is refreshed only at the next count change. Rows are upserted by comment id (`first_seen_at` kept, `last_seen_at` refreshed).
- ⚠ **Story extras every 2 hours of a Story's life + every pass in its last hour**, not every tick (3 calls per Story when all are supported; ~13 extras snapshots per Story instead of 48). The core Story snapshot stays every tick.
- ⚠ **Carousel CHILD covers are not captured.** `media_children` is created with `cover_path`/`cover_status` (as briefed) but only the parent cover (first child's image) is copied; child capture belongs with Post Lab. Children rows (position, type) ARE written from the listing.
- ⚠ **Reserved progress stages `covers`/`comments` are reported live but not added to the import checklist or percentage** (the brief said "extend the stage list + i18n labels"). The panel's activity line already has `sync.activity.covers`/`sync.activity.comments` in en + zh-CN, so the running stage is shown; but import completion must not wait for covers (hours of backlog) or comments (need a Reconnect), so `STAGES`/weights stay unchanged and no new i18n keys are needed.
- ⚠ **Covers and comments start only after the history import is complete** (spec order "…older posts, cover images, comments"), as hourly lane-2 jobs. Story covers are the exception: captured on first sight inside the Stories job.
- **Granted scopes:** Meta's code exchange returns `permissions` as one comma-separated string (verified in Meta's Business Login docs, 2026-10-17); stored on every connect/reconnect, overwritten each time (null when Meta does not report it = treated as not granted; the hint then shows). Existing accounts are backfilled with the two original scopes, so they show "Reconnect to enable comments" until reconnected.
- **"Unsupported" detection:** Meta answers code 100 with wording like "does not support the metric", "must be one of the following values", "nonexisting field". `call()` keeps only a boolean `unsupported` (the message text is discarded); `isUnsupported()` excludes the pre-conversion (2108006) and deleted-object (33) subcodes and network errors. `classifyIgError` is unchanged, so core capture behaves exactly as before.
- **Capability memory keys:** `story:follows`, `story:profile_visits`, `story:profile_activity`, `feed:follows_visits`, `feed:profile_activity`, `reels:watch`, `stories:url_fields`. Verified feed/Reels metrics are grouped in one call per group; unverified Story metrics are one per call.
- **Per-media extras:** same cadence as core media metrics (hourly < 48 h, daily < 30 d, older never-measured posts via the import) + a 7-day checkpoint (one snapshot right after day 7 when the last one predates it); extras run after the whole core loop within 20 extra calls per account run.
- **Cover URLs:** posts/Reels get a FRESH URL per attempt (`GET /{media-id}?fields=media_type,media_url,thumbnail_url,children{…}`, 1 call per cover, 25 per run) — CDN links expire in days, so none are stored. Stories use the URLs from the Stories listing; if Meta rejects those fields on Stories the listing falls back to the base fields (remembered as `stories:url_fields=false`) so the Story capture itself can never break.
- **Cover safety:** `redirect: 'manual'`, every hop re-checked against the allowlist (max 3); only JPEG/PNG/WebP (SVG/GIF/HEIC refused); object key `{account_id}/{media_id}.jpg` even for PNG/WebP (the real type is stored as the object's content type and served from there, re-allowlisted); `upsert: false` with "already exists" treated as stored.
- **Raw archive scope:** account day totals, follows/unfollows, reach/views breakdowns, demographics, online followers. Not media lists, media insights (re-fetchable ~2 years), captions or comments.
- **SPEC edit (flagged):** `docs/SPEC.md` §5 gains the new columns/tables and §6 a "Capture extras" paragraph (Task 15). No other SPEC behaviour changes.
- **New dependencies: none.**

## Out of scope

`MediaThumb` / grid / filmstrip / Post Lab / Explorer / Time Scope UI (Plans 12–13); comment moderation (reply/hide/delete) and comment replies; capture of carousel CHILD covers (the table has the columns; only the parent cover is captured); reading `X-Business-Use-Case-Usage`; Settings → Data storage dashboard.

## Global Constraints

- Ponytail: smallest thing that works; no abstraction with one implementation; **no new dependencies**.
- TypeScript strict. Every new Meta metric/field name lives in `lib/instagram/metrics.ts` (re-verify against Meta docs when touching it).
- All DB changes in the NEW file `supabase/migrations/20261022000001_capture_v2b.sql`; never edit an applied migration (latest applied: `20261021000001_sync_progress.sql`). RLS on every new table: owner select via `public.is_owner()`, `revoke all … from anon, authenticated; grant select … to authenticated`; writes only via the admin client. **Apply the migration BEFORE deploying the code.**
- Storage bucket `covers` is private (`public = false`), created by the migration; NO storage policies; only the admin client touches objects. Object key `{account_id}/{media_id}.jpg`.
- Extras, covers, comments and the archive are NON-FATAL for the core capture: only auth + rate-limit errors (`isFatalIgError`) may stop a job; the core Story/media snapshot is written before any extra call.
- Tokens, CDN URLs (they carry signatures), comment texts and third-party usernames are never logged, never put in errors, progress rows, summaries or route responses other than the owner's own data reads.
- Cover fetch: `https` only, hostname `fbcdn.net` / `cdninstagram.com` or a subdomain of them (parsed with `URL`), redirects followed manually only to allowlisted hosts (max 3), 10 s timeout, max 5 MB, content type `image/jpeg|png|webp` only (never SVG).
- The cover route is session-protected: `assertOwner(h)` with `h` copied onto EVERY response; `lib/auth/route-policy.ts` is NOT changed (no public exemption).
- Every UI string via next-intl, new keys in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese). Backend returns keys.
- Tests: mocked fetch/fakes only, no network, deterministic clocks, Vitest timeout 20 s. Windows: files have CRLF working-copy endings; create/modify files with the Write/Edit tools (never shell heredocs).
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **An unsupported metric inside a batched request** (Meta fails the WHOLE call, e.g. `follows` on a carousel product type, or a Story metric Meta stops serving) — only that group is dropped and remembered, the core snapshot and the other groups are kept: → Task 7 "an unsupported metric in a batch drops only that group, is remembered, and the core snapshot is untouched"; Task 6 "an unsupported metric only drops that metric, is remembered, and is not asked on the next run".
2. **A Story deleted/expired between the core capture and its extras** (code 100 / subcode 33) — the core snapshot stays, nothing is learned, the run is ok: → Task 6 "a Story gone mid-capture: the core snapshot stays, nothing is learned, the run is ok".
3. **A cover URL that expired (403/404/410) or redirects to a non-CDN host** (incl. the cloud metadata address) — refused before any request to the foreign host, counted as a failed attempt with back-off, never breaking the Story capture: → Task 9 "follows a redirect only to another CDN host…" and "expired link (403/404/410), SVG, HTML, empty body"; Task 10 "expired link or a redirect to a foreign host: a failed attempt, the Story snapshot is unaffected".
4. **Comments scope missing → Meta returns an empty list with no error** — it must never be recorded as "no comments": no call is made without the scope, nothing is written or marked; after a Reconnect that grants it the first run reads every recent post; and a post that HAS comments but returns none stays unsynced: → Task 13 "scope missing: no Instagram call, nothing recorded…", "a tick without the scope never schedules it; after a Reconnect…", "an empty answer for a post that has comments writes nothing and is asked again next run".
5. **Capability memory poisoned by a transient error** (5xx, network timeout, an unclassified code 100, under-5-viewers) — only an explicit "unsupported" answer may switch a metric off: → Task 4 "learns false only from an 'unsupported' answer; transient errors never poison the memory"; Task 6 "transient errors (5xx, network, unclassified 100) never poison the capability memory".

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261022000001_capture_v2b.sql` (new) | granted_scopes, capabilities, media_metrics extras, media fields + cover columns, `media_children`, `covers` bucket, `comments`, `api_snapshots` |
| `lib/instagram/oauth.ts` | `exchangeCode` returns `grantedScopes`; `InstagramApiError.unsupported` flag |
| `lib/instagram/metrics.ts` | extra metric groups, field lists (media, story, cover, comments) |
| `lib/instagram/parse.ts` | media details, comments page parsers |
| `lib/instagram/data.ts` | SWIPE_FORWARD, `extraInsights`, `mediaCover`, `commentsPage`, archive callback, `isUnsupported`, `isFatalIgError` |
| `lib/accounts/{types,service,supabase-store,scopes}.ts` | `grantedScopes` on accounts, `hasScope` |
| `lib/sync/capabilities.ts` (new) | pure capability-memory helpers |
| `lib/sync/extras.ts` (new) | one non-fatal call per metric group with capability memory and call budget |
| `lib/sync/covers.ts` (new) | URL pick, CDN allowlist, safe image fetch, cover due/backoff, capture |
| `lib/sync/schedule.ts` | jobs `covers`, `comments` (lane 2 only), 7-day checkpoint |
| `lib/sync/run-account.ts` | wiring: story extras + covers, media extras, covers job, comments job, archive |
| `lib/sync/store.ts` | new persistence methods, capabilities, `removeAccountCovers` |
| `lib/sync/tick.ts` | lane 2 also runs accounts with covers/comments due; `cdnFetch` dep |
| `app/api/media/[id]/cover/route.ts` (new) | owner-only cover stream |
| `app/(app)/accounts/actions.ts` | permanent delete also removes Storage objects |
| `components/accounts/AccountsView.tsx`, `messages/*.json` | "Reconnect to enable comments" hint |
| `tests/fixtures/sync-fakes.ts` | new fake methods |
| `docs/RUNBOOK_CAPTURE.md` (new), `docs/TODO.md`, `docs/HANDOVER.md`, `docs/SPEC.md` | runbook, honest ticks, SPEC §5 rows |

## Tasks

1. Migration `20261022000001_capture_v2b.sql` (+ migration test)
2. Granted scopes: code exchange → `accounts.granted_scopes`, `hasScope`
3. Accounts UI: "Reconnect to enable comments" hint (i18n)
4. Capability memory: `unsupported` error flag, pure helpers, persisted in `sync_state`
5. Metric constants + data client: SWIPE_FORWARD, `extraInsights`, extras columns in the store
6. Story extras (separate non-fatal calls after the core Story capture)
7. Per-media extras + 7-day checkpoint
8. Media fields + `media_children` (listing details, Story-field fallback)
9. Safe cover fetch (`lib/sync/covers.ts`: allowlist, redirects, size, type, timeout)
10. Cover persistence + capture (store, `mediaCover`, due/backoff, Story covers on first sight)
11. `covers` job in lane 2 (schedule, runner, tick lane-2 selection)
12. Cover route `GET /api/media/[id]/cover` + Storage cleanup on permanent delete
13. Comments ingestion (scope-gated `comments` job)
14. Raw response archive (`api_snapshots`)
15. Docs: RUNBOOK_CAPTURE, TODO, HANDOVER, SPEC §5/§6

---

### Task 1: Migration `20261022000001_capture_v2b.sql`

**Files:**
- Create: `supabase/migrations/20261022000001_capture_v2b.sql`
- Test: `tests/capture-v2b-migration.test.ts` (new)

**Interfaces:**
- Consumes: tables `accounts`, `sync_state`, `media`, `media_metrics`, function `public.is_owner()`, schema `storage` (earlier migrations / Supabase).
- Produces (exact column names later tasks write): `accounts.granted_scopes text[]`; `sync_state.capabilities jsonb`; `media_metrics.{swipe_forward, follows, profile_visits, profile_activity jsonb, avg_watch_ms, total_watch_ms bigint, skip_rate numeric}`; `media.{media_product_type, like_count, comments_count, is_shared_to_feed, children_count, cover_path, cover_status ('pending'|'ok'|'unavailable'|'failed', default 'pending'), cover_captured_at, cover_attempts, cover_tried_at, comments_synced_count}`; tables `media_children(media_id, position 0–9, media_type, cover_path, cover_status)`, `comments(id, account_id, media_id, parent_id, author_username, author_id, text, like_count, commented_at, hidden, first_seen_at, last_seen_at)`, `api_snapshots(id, account_id, endpoint, captured_at, body, body_hash; unique(account_id, endpoint, body_hash))`; private Storage bucket `covers`.

- [ ] **Step 1: Write the failing test** — create `tests/capture-v2b-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261022000001_capture_v2b.sql'), 'utf8').replace(/--.*$/gm, '');
const table = (name: string) => sql.match(new RegExp(`create\\s+table\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\r?\\n\\);`, 'i'))?.[1] ?? '';

describe('capture v2b migration', () => {
  it('is additive: no drops, no edits of existing columns', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).not.toMatch(/alter\s+column/i);
  });

  it('accounts.granted_scopes, backfilled with the two original scopes (no comments scope) for existing accounts', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.accounts\s+add\s+column\s+granted_scopes\s+text\[\]\s*;/i);
    const update = sql.match(/update\s+public\.accounts[\s\S]*?;/i)?.[0] ?? '';
    expect(update).toContain("'instagram_business_basic'");
    expect(update).toContain("'instagram_business_manage_insights'");
    expect(update).not.toContain('manage_comments');
    expect(update).toMatch(/where\s+granted_scopes\s+is\s+null/i);
  });

  it('sync_state.capabilities defaults to an empty object', () => {
    expect(sql).toMatch(/add\s+column\s+capabilities\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);
  });

  it('media_metrics gets every extra column, all nullable', () => {
    for (const c of ['swipe_forward', 'follows', 'profile_visits', 'profile_activity', 'avg_watch_ms', 'total_watch_ms', 'skip_rate']) {
      const line = sql.match(new RegExp(`add\\s+column\\s+${c}\\s+[^,;]*`, 'i'))?.[0] ?? '';
      expect(line, c).not.toBe('');
      expect(line, c).not.toMatch(/not\s+null/i);
    }
  });

  it('media gets the dropped fields and cover state with a closed status set', () => {
    for (const c of ['media_product_type', 'like_count', 'comments_count', 'is_shared_to_feed', 'children_count', 'cover_path', 'cover_status', 'cover_captured_at', 'cover_attempts', 'cover_tried_at', 'comments_synced_count'])
      expect(sql, c).toMatch(new RegExp(`add\\s+column\\s+${c}\\b`, 'i'));
    expect(sql).toMatch(/cover_status\s+text\s+not\s+null\s+default\s+'pending'\s+check\s*\(\s*cover_status\s+in\s*\(\s*'pending'\s*,\s*'ok'\s*,\s*'unavailable'\s*,\s*'failed'\s*\)\s*\)/i);
  });

  it('the covers bucket is private, size- and type-capped, and has no storage policies', () => {
    const insert = sql.match(/insert\s+into\s+storage\.buckets[\s\S]*?;/i)?.[0] ?? '';
    expect(insert).toMatch(/'covers'\s*,\s*'covers'\s*,\s*false\s*,\s*5242880/i);
    expect(insert).not.toMatch(/svg/i);
    expect(sql).not.toMatch(/on\s+storage\.objects/i);
  });

  it('comments and api_snapshots cascade with the account; snapshots dedupe on (account, endpoint, hash)', () => {
    expect(table('comments')).toMatch(/account_id\s+uuid\s+not\s+null\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('comments')).toMatch(/media_id\s+text\s+not\s+null\s+references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('api_snapshots')).toMatch(/account_id\s+uuid\s+not\s+null\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('api_snapshots')).toMatch(/unique\s*\(\s*account_id\s*,\s*endpoint\s*,\s*body_hash\s*\)/i);
    expect(table('media_children')).toMatch(/references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('every new table: RLS, revoked from browser roles, select granted, one owner select policy', () => {
    for (const t of ['media_children', 'comments', 'api_snapshots']) {
      expect(sql, t).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      expect(sql, t).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon\\s*,\\s*authenticated`, 'i'));
      expect(sql, t).toMatch(new RegExp(`grant\\s+select\\s+on\\s+public\\.${t}\\s+to\\s+authenticated`, 'i'));
      const policies = [...sql.matchAll(new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${t}\\b[\\s\\S]*?;`, 'gi'))].map((m) => m[0]);
      expect(policies, t).toHaveLength(1);
      expect(policies[0]).toMatch(/for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
    }
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/capture-v2b-migration.test.ts`
Expected: FAIL — `ENOENT … 20261022000001_capture_v2b.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261022000001_capture_v2b.sql`:

```sql
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
-- bodies over 64 KB skipped, kept forever so history can be reprocessed. Estimate: ~10 small bodies/account/day ≈ a few MB/year.
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/capture-v2b-migration.test.ts tests/migrations.test.ts`
Expected: PASS (the generic migration invariants — RLS + a policy on every table, no anon/public policy — stay green).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261022000001_capture_v2b.sql tests/capture-v2b-migration.test.ts
git commit -m "feat(db): capture v2b migration (scopes, capabilities, extras, media fields, covers bucket, comments, api snapshots)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Granted scopes — code exchange → `accounts.granted_scopes`, `hasScope`

**Files:**
- Modify: `lib/instagram/oauth.ts` (`parseScopes`, `exchangeCode` return type)
- Modify: `lib/instagram/connect-flow.ts`, `lib/accounts/types.ts`, `lib/accounts/service.ts`, `lib/accounts/supabase-store.ts`
- Create: `lib/accounts/scopes.ts`
- Test: `tests/granted-scopes.test.ts` (new); modify `tests/instagram-oauth.test.ts`, `tests/supabase-store.test.ts` (two expectations each gain the new field)

**Interfaces:**
- Consumes: Meta's code-exchange response `{ data: [{ access_token, user_id, permissions: "a,b,c" }] }` (verified in Meta's Business Login docs on 2026-10-17: `permissions` is ONE comma-separated string; the redirect itself carries no scopes).
- Produces: `parseScopes(v: unknown): string[] | null`; `exchangeCode(...)` → `{ accessToken; userId; grantedScopes: string[] | null }`; `StoredAccount.grantedScopes?: string[] | null`, `NewAccount.grantedScopes?`, `ConnectInput.grantedScopes?`; `COMMENTS_SCOPE = 'instagram_business_manage_comments'`; `hasScope(a: Pick<StoredAccount,'grantedScopes'>, scope: string): boolean` (null/absent = false). Tasks 3, 11 and 13 use `hasScope(account, COMMENTS_SCOPE)`.

- [ ] **Step 1: Write the failing test** — create `tests/granted-scopes.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { connectAccount } from '@/lib/accounts/service';
import { newToRow, patchToRow, rowToAccount } from '@/lib/accounts/supabase-store';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { processCallback } from '@/lib/instagram/connect-flow';
import { exchangeCode, parseScopes, type IgConfig } from '@/lib/instagram/oauth';
import { newOAuthState } from '@/lib/instagram/state';

const cfg: IgConfig = { appId: '123', appSecret: 'sekrit', redirectUri: 'https://app.test/api/instagram/callback', apiVersion: 'v25.0' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ALL = 'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_comments';

function memAccounts() {
  const rows: StoredAccount[] = [];
  const store: AccountsStore = {
    list: async () => rows,
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    findByIgUserId: async (ig) => rows.find((r) => r.igUserId === ig) ?? null,
    insert: async (a) => {
      const r: StoredAccount = { id: `a${rows.length + 1}`, ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: 'now' };
      rows.push(r);
      return r;
    },
    update: async (id, p) => Object.assign(rows.find((r) => r.id === id)!, p),
    saveToken: async () => undefined,
    remove: async () => undefined,
  };
  return { store, rows };
}

const fetchWith = (permissions: unknown) =>
  vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes('api.instagram.com/oauth/access_token')) return json({ data: [{ access_token: 'short', user_id: '1784', ...(permissions === undefined ? {} : { permissions }) }] });
    if (u.includes('/access_token')) return json({ access_token: 'long', expires_in: 5184000 });
    return json({ user_id: '1784', username: 'brandx', account_type: 'MEDIA_CREATOR' });
  }) as unknown as typeof fetch;

describe('parseScopes', () => {
  it('reads the documented comma-separated string, trims and dedupes', () => {
    expect(parseScopes(' instagram_business_basic, instagram_business_manage_comments ,instagram_business_basic')).toEqual(['instagram_business_basic', 'instagram_business_manage_comments']);
  });
  it('accepts an array; anything else (or nothing) is unknown = null', () => {
    expect(parseScopes(['a', 2, 'b'])).toEqual(['a', 'b']);
    expect(parseScopes(undefined)).toBeNull();
    expect(parseScopes(42)).toBeNull();
    expect(parseScopes('')).toEqual([]);
  });
});

describe('exchangeCode', () => {
  it('returns the granted scopes next to the short token', async () => {
    expect(await exchangeCode(cfg, 'C', fetchWith(ALL))).toEqual({ accessToken: 'short', userId: '1784', grantedScopes: ALL.split(',') });
    expect((await exchangeCode(cfg, 'C', fetchWith(undefined))).grantedScopes).toBeNull();
  });
});

describe('connect / reconnect stores what Meta granted', () => {
  it('a connect with the comments scope stores it; a reconnect without it overwrites it', async () => {
    const { store, rows } = memAccounts();
    const go = async (permissions: unknown) => {
      const s = newOAuthState(null);
      return processCallback({ code: 'C', state: s.state, error: null, cookie: s.cookie }, { cfg, store, fetchFn: fetchWith(permissions) });
    };
    expect(await go(ALL)).toEqual({ redirect: '/accounts?connected=brandx' });
    expect(hasScope(rows[0], COMMENTS_SCOPE)).toBe(true);
    await go('instagram_business_basic,instagram_business_manage_insights');
    expect(rows).toHaveLength(1);
    expect(hasScope(rows[0], COMMENTS_SCOPE)).toBe(false);
    await go(undefined); // Meta stopped reporting: unknown, not "still granted"
    expect(rows[0].grantedScopes).toBeNull();
  });

  it('connectAccount writes grantedScopes on insert and update', async () => {
    const { store, rows } = memAccounts();
    await connectAccount(store, { igUserId: '1', username: 'u', accessToken: 't', expiresAt: 'e', grantedScopes: ['x'] });
    expect(rows[0].grantedScopes).toEqual(['x']);
    await connectAccount(store, { igUserId: '1', username: 'u', accessToken: 't', expiresAt: 'e' });
    expect(rows[0].grantedScopes).toBeNull();
  });
});

describe('hasScope and the accounts row mapping', () => {
  it('unknown or missing scopes are never "granted"', () => {
    expect(hasScope({ grantedScopes: null }, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({}, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({ grantedScopes: ['instagram_business_basic'] }, COMMENTS_SCOPE)).toBe(false);
    expect(hasScope({ grantedScopes: [COMMENTS_SCOPE] }, COMMENTS_SCOPE)).toBe(true);
  });
  it('maps granted_scopes both ways', () => {
    expect(rowToAccount({ id: 'a', granted_scopes: ['x', 3] }).grantedScopes).toEqual(['x']);
    expect(rowToAccount({ id: 'a', granted_scopes: null }).grantedScopes).toBeNull();
    expect(patchToRow({ grantedScopes: ['x'] })).toEqual({ granted_scopes: ['x'] });
    expect(newToRow({ igUserId: '1', username: 'u', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, tokenExpiresAt: 't', grantedScopes: ['y'] })).toMatchObject({ granted_scopes: ['y'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/granted-scopes.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/accounts/scopes"`.

- [ ] **Step 3: Implement**

Create `lib/accounts/scopes.ts`:

```ts
import type { StoredAccount } from '@/lib/accounts/types';

/** Needed to read comments. Without it Meta returns an EMPTY comments list with no error, so it must be checked first. */
export const COMMENTS_SCOPE = 'instagram_business_manage_comments';

/** Only what Meta reported at connect/reconnect counts; unknown (null/absent) = not granted. Never inferred from API answers. */
export const hasScope = (a: Pick<StoredAccount, 'grantedScopes'>, scope: string): boolean => a.grantedScopes?.includes(scope) ?? false;
```

In `lib/instagram/oauth.ts` replace the `exchangeCode` signature line

```ts
export async function exchangeCode(cfg: IgConfig, code: string, fetchFn: typeof fetch = fetch): Promise<{ accessToken: string; userId: string }> {
```

with

```ts
/**
 * The scopes Meta granted, from the code exchange's `permissions` (documented as one comma-separated string; an array
 * is accepted too). null = Meta did not say, which callers treat as "not granted" (never inferred from API answers).
 */
export function parseScopes(v: unknown): string[] | null {
  const list = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
  return list ? [...new Set(list.map((s) => s.trim()).filter(Boolean))] : null;
}

export async function exchangeCode(cfg: IgConfig, code: string, fetchFn: typeof fetch = fetch): Promise<{ accessToken: string; userId: string; grantedScopes: string[] | null }> {
```

and its last line `return { accessToken: token, userId: String(user) };` with

```ts
  return { accessToken: token, userId: String(user), grantedScopes: parseScopes(first.permissions) };
```

In `lib/accounts/types.ts`, `StoredAccount` gains (after `connectedAt: string;`):

```ts
  /** Scopes Meta granted at the last connect/reconnect; null/absent = unknown (treated as not granted). */
  grantedScopes?: string[] | null;
```

and `NewAccount` gains (after `tokenExpiresAt: string;`):

```ts
  grantedScopes?: string[] | null;
```

(`AccountPatch` is derived from `StoredAccount`, so it accepts `grantedScopes` automatically. The field is optional so the many existing `StoredAccount` literals in tests stay valid.)

In `lib/accounts/supabase-store.ts`: in `rowToAccount` after `connectedAt: r.connected_at as string,` add

```ts
    grantedScopes: Array.isArray(r.granted_scopes) ? r.granted_scopes.filter((s): s is string => typeof s === 'string') : null,
```

in `PATCH_COLUMNS` after `tokenExpiresAt: 'token_expires_at',` add `grantedScopes: 'granted_scopes',`; in `newToRow` after `token_expires_at: a.tokenExpiresAt,` add `granted_scopes: a.grantedScopes ?? null,`.

In `lib/accounts/service.ts`: `ConnectInput` gains (after `expiresAt: string;`)

```ts
  /** What Meta granted with THIS token (null = not reported). Always overwritten: an old token's scopes no longer apply. */
  grantedScopes?: string[] | null;
```

and the `profile` object in `connectAccount` gains (after `tokenExpiresAt: input.expiresAt,`) `grantedScopes: input.grantedScopes ?? null,` (it is spread into both `insert` and `update`).

In `lib/instagram/connect-flow.ts` replace

```ts
  let token: { accessToken: string; expiresAt: string };
  try {
    const short = await exchangeCode(deps.cfg, input.code, fetchFn);
    token = await exchangeLongLived(deps.cfg, short.accessToken, fetchFn, deps.now);
```

with

```ts
  let token: { accessToken: string; expiresAt: string };
  let grantedScopes: string[] | null;
  try {
    const short = await exchangeCode(deps.cfg, input.code, fetchFn);
    grantedScopes = short.grantedScopes;
    token = await exchangeLongLived(deps.cfg, short.accessToken, fetchFn, deps.now);
```

and in the `connectAccount(deps.store, { … })` call add `grantedScopes,` after `expiresAt: token.expiresAt,`.

Update the two existing expectations that list the full exchange result / account shape:
- `tests/instagram-oauth.test.ts`: `toEqual({ accessToken: 'short1', userId: '1784' })` → `toEqual({ accessToken: 'short1', userId: '1784', grantedScopes: ['instagram_business_basic'] })`; `toEqual({ accessToken: 'short2', userId: '99' })` → `toEqual({ accessToken: 'short2', userId: '99', grantedScopes: ['x'] })`.
- `tests/supabase-store.test.ts` (`rowToAccount maps snake_case…`): append `, grantedScopes: null` after `connectedAt: '2026-10-14T00:00:00Z'` in the expected object.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/granted-scopes.test.ts tests/instagram-oauth.test.ts tests/supabase-store.test.ts tests/connect-flow.test.ts tests/accounts-service.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/accounts/scopes.ts lib/accounts/types.ts lib/accounts/service.ts lib/accounts/supabase-store.ts lib/instagram/oauth.ts lib/instagram/connect-flow.ts tests/granted-scopes.test.ts tests/instagram-oauth.test.ts tests/supabase-store.test.ts
git commit -m "feat(accounts): store the scopes Meta granted at connect; hasScope()" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Accounts UI — "Reconnect to enable comments" hint

**Files:**
- Modify: `components/accounts/AccountsView.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/accounts-comments-hint.test.tsx` (new)

**Interfaces:**
- Consumes: `hasScope`, `COMMENTS_SCOPE` (Task 2); `connectHref(group)` (existing, `components/accounts/ConnectDialog.tsx`).
- Produces: i18n key `accounts.commentsHint`.

- [ ] **Step 1: Write the failing test** — create `tests/accounts-comments-hint.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AccountsView } from '@/components/accounts/AccountsView';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const ALL = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'];
const acct = (o: Partial<StoredAccount> & { id: string; username: string }): StoredAccount => ({
  igUserId: o.id, displayName: null, accountType: 'MEDIA_CREATOR', profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000).toISOString(), connectedAt: '2026-10-02T00:00:00Z', ...o,
});
const ok = async () => ({ ok: true });

function view(accounts: StoredAccount[], locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <AccountsView accounts={accounts} actions={{ archive: vi.fn(ok), restore: vi.fn(ok), remove: vi.fn(ok), setGroup: vi.fn(ok), syncNow: vi.fn(ok) }} now={new Date().toISOString()} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('"Reconnect to enable comments" hint', () => {
  it('shows for an active account without the comments scope and links to the reconnect flow (keeps the group)', () => {
    view([acct({ id: '1', username: 'old', groupName: 'Brand X', grantedScopes: ALL.slice(0, 2) })]);
    const links = screen.getAllByRole('link', { name: 'Reconnect to enable comments' }); // table (desktop) + card (phone)
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20X');
  });

  it('unknown scopes (null) also show the hint; a granted scope hides it', () => {
    view([acct({ id: '1', username: 'unknown', grantedScopes: null }), acct({ id: '2', username: 'granted', grantedScopes: ALL })]);
    const links = screen.getAllByRole('link', { name: 'Reconnect to enable comments' });
    expect(links.length).toBe(2); // only account 1, once in the table and once in the card
  });

  it('not shown for archived or needs-reconnect accounts', () => {
    view([acct({ id: '1', username: 'a', status: 'needs_reconnect' }), acct({ id: '2', username: 'b', status: 'archived', archivedAt: '2026-10-10T00:00:00Z' })]);
    expect(screen.queryByRole('link', { name: 'Reconnect to enable comments' })).toBeNull();
  });

  it('is translated', () => {
    view([acct({ id: '1', username: 'old' })], 'zh-CN');
    expect(screen.getAllByRole('link', { name: '重新连接以启用评论读取' }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/accounts-comments-hint.test.tsx`
Expected: FAIL — no link named "Reconnect to enable comments".

- [ ] **Step 3: Implement**

`messages/en.json`, inside `"accounts"`, replace

```json
    "sync": {
      "never": "Not synced yet"
    }
  },
```

with

```json
    "sync": {
      "never": "Not synced yet"
    },
    "commentsHint": "Reconnect to enable comments"
  },
```

`messages/zh-CN.json`, same place:

```json
    "sync": {
      "never": "尚未同步"
    },
    "commentsHint": "重新连接以启用评论读取"
  },
```

`components/accounts/AccountsView.tsx`: add the import after `import { normalizeGroup } from '@/lib/accounts/group';`

```tsx
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
```

add this component directly above `function GroupBadge(`:

```tsx
// an active account whose token lacks the comments scope (connected before it was requested, or declined): one
// Reconnect grants it. Needs-reconnect accounts already say "Reconnect"; archived ones are not synced.
function CommentsHint({ a }: { a: StoredAccount }) {
  const t = useTranslations('accounts');
  if (a.status !== 'active' || hasScope(a, COMMENTS_SCOPE)) return null;
  return (
    <a href={connectHref(a.groupName)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {t('commentsHint')}
    </a>
  );
}
```

In `AccountTable`, the status cell becomes

```tsx
                <div className="flex flex-wrap items-center gap-1">
                  <StatusBadge status={a.status} token={tokenStatus(a.tokenExpiresAt, now).state} />
                  <SyncBadge p={progress.get(a.id)} />
                  <CommentsHint a={a} />
                </div>
```

and in `AccountCards` the badge row becomes

```tsx
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} token={tokenStatus(a.tokenExpiresAt, now).state} />
                <SyncBadge p={progress.get(a.id)} />
                <GroupBadge name={a.groupName} />
                <CommentsHint a={a} />
              </div>
```

(Wraps with the existing `flex-wrap` rows, so 360 px stays clean; tokens only.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/accounts-comments-hint.test.tsx tests/accounts-view.test.tsx tests/messages.test.ts`
Expected: PASS (existing tests query "Reconnect" by exact name, so the longer hint text does not collide).

- [ ] **Step 5: Commit**

```bash
git add components/accounts/AccountsView.tsx messages/en.json messages/zh-CN.json tests/accounts-comments-hint.test.tsx
git commit -m "feat(accounts): 'Reconnect to enable comments' hint when the scope is missing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Capability memory — `unsupported` error flag, pure helpers, persisted in `sync_state`

**Files:**
- Modify: `lib/instagram/oauth.ts` (`InstagramApiError.unsupported`, `call()`)
- Modify: `lib/instagram/data.ts` (`isFatalIgError`, `isUnsupported`)
- Create: `lib/sync/capabilities.ts`
- Modify: `lib/sync/schedule.ts` (`SyncState.capabilities`), `lib/sync/store.ts` (`rowToState`, `StatePatch`, `saveState`), `lib/sync/run-account.ts` (carry the map; shared `fatal`)
- Test: `tests/sync-capabilities.test.ts` (new)

**Interfaces:**
- Consumes: `IG_ERROR` (existing).
- Produces: `new InstagramApiError(kind, status?, code?, subcode?, unsupported = false)`; `isFatalIgError(e): boolean` (auth / rate limits); `isUnsupported(e): boolean` (code 100 + flag, never for subcodes 2108006/33 or network); `type Capabilities = Record<string, boolean>`; `parseCapabilities(v): Capabilities`; `shouldAsk(caps, key): boolean`; `learn(caps, key, { ok: true } | { error }): Capabilities` (returns a new map; false only for `isUnsupported`); `SyncState.capabilities?: Capabilities` (`emptyState` → `{}`); `StatePatch.capabilities?: Capabilities` (omitted = keep); inside `run-account.ts` the internal `Progress` object now carries `capabilities` (later tasks read/write `p.capabilities`).

- [ ] **Step 1: Write the failing test** — create `tests/sync-capabilities.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isUnsupported } from '@/lib/instagram/data';
import { call, InstagramApiError } from '@/lib/instagram/oauth';
import { learn, parseCapabilities, shouldAsk } from '@/lib/sync/capabilities';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { rowToState, supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const metaError = (message: string, code = 100, subcode?: number) => json({ error: { message, type: 'IGApiException', code, ...(subcode ? { error_subcode: subcode } : {}) } }, 400);
const fail = async (res: Response) => call('data', (async () => res) as typeof fetch, 'https://graph.instagram.com/x').then(() => null, (e: unknown) => e);

describe('the "unsupported" flag on Meta errors', () => {
  it('is set for "does not support the metric", invalid metric names and unknown fields — the text itself is discarded', async () => {
    const e = await fail(metaError('(#100) The Media Insights API does not support the follows metric for this media product type.'));
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(isUnsupported(e)).toBe(true);
    expect(String((e as Error).message)).not.toMatch(/follows|support/); // fixed message only
    expect(isUnsupported(await fail(metaError('(#100) metric[0] must be one of the following values: reach, views')))).toBe(true);
    expect(isUnsupported(await fail(metaError('(#100) Tried accessing nonexisting field (like_count) on node type (ShadowIGMedia)')))).toBe(true);
  });

  it('is NOT set for other code-100 errors, pre-conversion posts, deleted objects, 5xx, rate limits or network errors', async () => {
    expect(isUnsupported(await fail(metaError('(#100) Invalid parameter')))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support this operation', 100, 2108006)))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support', 100, 33)))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support', 2)))).toBe(false);
    expect(isUnsupported(await fail(json({ error: { message: 'does not support', code: 100 } }, 500)))).toBe(true); // code wins, status does not matter
    expect(isUnsupported(await fail(metaError('does not support', 80002)))).toBe(false);
    expect(isUnsupported(new InstagramApiError('network'))).toBe(false);
    expect(isUnsupported(new Error('does not support'))).toBe(false);
  });
});

describe('capability memory (pure)', () => {
  const unsupported = new InstagramApiError('data', 400, 100, undefined, true);
  it('parses only boolean entries', () => {
    expect(parseCapabilities({ 'story:follows': false, 'reels:watch': true, junk: 'x', n: 1 })).toEqual({ 'story:follows': false, 'reels:watch': true });
    expect(parseCapabilities(null)).toEqual({});
    expect(parseCapabilities([true])).toEqual({});
  });
  it('asks unknown and supported metrics, skips only remembered "unsupported"', () => {
    expect(shouldAsk({}, 'story:follows')).toBe(true);
    expect(shouldAsk({ 'story:follows': true }, 'story:follows')).toBe(true);
    expect(shouldAsk({ 'story:follows': false }, 'story:follows')).toBe(false);
  });
  it('learns false only from an "unsupported" answer; transient errors never poison the memory', () => {
    expect(learn({}, 'k', { error: unsupported })).toEqual({ k: false });
    expect(learn({}, 'k', { ok: true })).toEqual({ k: true });
    for (const e of [new InstagramApiError('network'), new InstagramApiError('data', 500, 2), new InstagramApiError('data', 400, 100), new InstagramApiError('data', 400, 10), new Error('db down')]) {
      expect(learn({ k: true }, 'k', { error: e })).toEqual({ k: true });
      expect(learn({}, 'k', { error: e })).toEqual({});
    }
  });
  it('a supported-again metric flips back to true (memory follows Meta)', () => {
    expect(learn({ k: false }, 'k', { ok: true })).toEqual({ k: true });
  });
});

describe('capability memory is persisted with the sync state', () => {
  it('rowToState reads it; saveState writes it only when the patch carries it', async () => {
    expect(rowToState({ account_id: 'a1', capabilities: { 'story:follows': false } }).capabilities).toEqual({ 'story:follows': false });
    const rows: unknown[] = [];
    const db = { from: () => ({ update: (r: unknown) => (rows.push(r), { eq: () => ({ eq: async () => ({ error: null }) }) }) }) };
    const base = { lastAttemptAt: 'x', consecutiveFailures: 0, lastErrorKey: null, dailyDoneThrough: null, backfilledFrom: null, lastRun: {} };
    await supabaseSyncStore(db as never).saveState('a1', 'L', { ...base, capabilities: { 'reels:watch': true } });
    await supabaseSyncStore(db as never).saveState('a1', 'L', base);
    expect(rows[0]).toMatchObject({ capabilities: { 'reels:watch': true } });
    expect(rows[1]).not.toHaveProperty('capabilities');
  });

  it('runAccount carries the stored map into its patch (a remembered "unsupported" survives the run)', async () => {
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig: fakeIg(), store: memoryStore().store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), capabilities: { 'story:follows': false } }, tz: 'UTC', now: new Date('2026-10-14T02:00:00Z'), deadline: 1, clock: () => 0 };
    const { patch } = await runAccount(c, ['stories']);
    expect(patch.capabilities).toMatchObject({ 'story:follows': false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-capabilities.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/capabilities"`.

- [ ] **Step 3: Implement**

`lib/instagram/oauth.ts` — replace the `InstagramApiError` doc comment + class header

```ts
/** Fixed message per kind: response bodies, tokens, codes and secrets never end up in an error. */
export class InstagramApiError extends Error {
  constructor(public kind: Kind, public status?: number, public code?: number, public subcode?: number) {
```

with

```ts
/**
 * Meta's wording when a metric or field is not available for this object/product type (verified 2026-10-16: "does not
 * support the metric for this media product type"; invalid names: "must be one of the following values"; unknown
 * fields: "nonexisting field"). Matched once in call(); the text itself is discarded.
 */
const UNSUPPORTED = /does not support|must be one of the following values|nonexisting field/i;

/**
 * Fixed message per kind: response bodies, tokens, codes and secrets never end up in an error. `unsupported` = Meta
 * said the requested metric/field is not available (see UNSUPPORTED); it is a flag, not the message.
 */
export class InstagramApiError extends Error {
  constructor(public kind: Kind, public status?: number, public code?: number, public subcode?: number, public unsupported = false) {
```

and in `call()` replace

```ts
    const err = body.error as { code?: unknown; error_subcode?: unknown } | undefined;
    const raw = typeof err === 'object' && err ? err.code : body.code;
    const sub = typeof err === 'object' && err ? err.error_subcode : undefined;
    throw new InstagramApiError(kind, res.status, typeof raw === 'number' ? raw : undefined, typeof sub === 'number' ? sub : undefined);
```

with

```ts
    const err = body.error as { code?: unknown; error_subcode?: unknown; message?: unknown } | undefined;
    const raw = typeof err === 'object' && err ? err.code : body.code;
    const sub = typeof err === 'object' && err ? err.error_subcode : undefined;
    // only a boolean leaves this function: Meta's message text is never stored or logged
    const unsupported = typeof err === 'object' && err && typeof err.message === 'string' && UNSUPPORTED.test(err.message);
    throw new InstagramApiError(kind, res.status, typeof raw === 'number' ? raw : undefined, typeof sub === 'number' ? sub : undefined, !!unsupported);
```

`lib/instagram/data.ts` — directly above `const num = (v: unknown)…` add:

```ts
/** Only auth and rate-limit problems may stop a job; everything else in an optional extra capture is skipped. */
export const isFatalIgError = (e: unknown): boolean => ['auth', 'app_rate_limit', 'rate_limit'].includes(classifyIgError(e));

/**
 * Meta said this metric/field is not available here (code 100 + the "not supported" wording). Never true for a
 * pre-conversion post (no data, 2108006) or a deleted object (33), and never for transient or network errors, so a
 * hiccup can not be mistaken for "unsupported" and poison the capability memory.
 */
export function isUnsupported(e: unknown): boolean {
  return e instanceof InstagramApiError && e.kind !== 'network' && e.code === M.IG_ERROR.invalidParam && e.unsupported && e.subcode !== M.IG_ERROR.preConversionSubcode && e.subcode !== M.IG_ERROR.objectMissingSubcode;
}
```

(`classifyIgError` is unchanged on purpose: core media capture keeps treating an unsupported answer as `other`, exactly as today.)

Create `lib/sync/capabilities.ts`:

```ts
// Capability memory: which optional Meta metrics/fields work for this account, learned at runtime and kept in
// sync_state.capabilities (e.g. {"story:follows": false}). Only an explicit "unsupported" answer is remembered as false,
// so a transient error can never switch a metric off. Reset (owner/assistant): update sync_state set capabilities = '{}';
import { isUnsupported } from '@/lib/instagram/data';

export type Capabilities = Record<string, boolean>;

/** Stored jsonb -> map; anything that is not a boolean is dropped. */
export function parseCapabilities(v: unknown): Capabilities {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
}

/** Ask unless Meta already said "unsupported". Unknown and supported are both asked. */
export const shouldAsk = (caps: Capabilities, key: string): boolean => caps[key] !== false;

/**
 * What one optional call taught: success -> supported; an "unsupported" answer -> false; anything else (transient,
 * network, no data, deleted object, unclassified) teaches nothing and leaves the map as it was.
 */
export function learn(caps: Capabilities, key: string, result: { ok: true } | { error: unknown }): Capabilities {
  if ('ok' in result) return caps[key] === true ? caps : { ...caps, [key]: true };
  return isUnsupported(result.error) ? { ...caps, [key]: false } : caps;
}
```

`lib/sync/schedule.ts` — add `import type { Capabilities } from '@/lib/sync/capabilities';` after the `AccountStatus` import; in `SyncState` after the `lastRun` line add

```ts
  /** Optional metrics/fields Meta answered "unsupported" (false) or served (true); see lib/sync/capabilities.ts. */
  capabilities?: Capabilities;
```

and in `emptyState` after `lastRun: {},` add `capabilities: {},`.

`lib/sync/store.ts` — add `import { parseCapabilities, type Capabilities } from '@/lib/sync/capabilities';` after the `lib/prefs` import; `StatePatch` gains `capabilities?: Capabilities; // omitted = keep the stored map` after `lastRun`; `rowToState` gains `capabilities: parseCapabilities(r.capabilities),` after `lastRun: …,`; in `saveState` after `if (p.lastSuccessAt) row.last_success_at = p.lastSuccessAt;` add `if (p.capabilities) row.capabilities = p.capabilities;`.

`lib/sync/run-account.ts`:
- import: `import { classifyIgError, type IgData } from '@/lib/instagram/data';` → `import { classifyIgError, isFatalIgError as fatal, type IgData } from '@/lib/instagram/data';` and add `import type { Capabilities } from '@/lib/sync/capabilities';` above the `lib/sync/progress` import;
- delete the local `fatal` (its doc comment and `const fatal = (e: unknown) => [...]` line) — the import replaces it;
- replace the `Progress` interface with

```ts
/**
 * What must survive a job failing half-way: the coverage edges (e.g. 40 history days written, then a 5xx) and the
 * capability memory learned so far (saved with the state patch).
 */
interface Progress {
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  capabilities: Capabilities;
}
```

- in `runAccount`: `const progress: Progress = { dailyDoneThrough: c.state.dailyDoneThrough, backfilledFrom: c.state.backfilledFrom, capabilities: { ...(c.state.capabilities ?? {}) } };` and add `capabilities: progress.capabilities,` after `lastRun,` in the returned `patch`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-capabilities.test.ts tests/sync-run-account.test.ts tests/sync-store.test.ts tests/sync-tick.test.ts tests/instagram-oauth.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/oauth.ts lib/instagram/data.ts lib/sync/capabilities.ts lib/sync/schedule.ts lib/sync/store.ts lib/sync/run-account.ts tests/sync-capabilities.test.ts
git commit -m "feat(sync): capability memory for optional metrics (unsupported flag, never poisoned by transient errors)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Metric constants + data client — SWIPE_FORWARD, `extraInsights`, extras columns in the store

**Files:**
- Modify: `lib/instagram/metrics.ts` (`ExtraScope`, `ExtraField`, `ExtraGroup`, `EXTRA_GROUPS`, navigation comment)
- Modify: `lib/instagram/data.ts` (`MediaMetricValues` extras, `MediaExtras`, `swipeForward`, `extraInsights`)
- Modify: `lib/sync/store.ts` (`insertMetrics` new columns, `updateMetricExtras`)
- Modify: `tests/fixtures/sync-fakes.ts` (`extraInsights`, `updateMetricExtras`, `extras` log)
- Modify: `tests/instagram-data.test.ts` (the Story fixture already contains `swipe_forward: 50`, which is now kept)
- Test: `tests/capture-extras-data.test.ts` (new)

**Interfaces:**
- Consumes: `parseTotals`, `parseBreakdown` (existing).
- Produces: `type ExtraScope = 'story' | 'feed' | 'reels'`; `type ExtraField = 'follows' | 'profileVisits' | 'profileActivity' | 'avgWatchMs' | 'totalWatchMs' | 'skipRate'`; `EXTRA_GROUPS: Record<ExtraScope, readonly { key; metrics: Record<metric, ExtraField>; breakdown? }[]>`; `MediaMetricValues` gains OPTIONAL `swipeForward, follows, profileVisits, profileActivity (Record<string, number>), avgWatchMs, totalWatchMs, skipRate`; `type MediaExtras = Pick<MediaMetricValues, ExtraField>`; `IgData.extraInsights(token, mediaId, metrics: readonly string[], breakdown?: string): Promise<Record<string, number>>`; `SyncStore.updateMetricExtras(mediaId, capturedAt, e: Partial<MediaExtras>): Promise<void>`; fake store returns `extras: { mediaId; capturedAt; e }[]`.

- [ ] **Step 1: Write the failing test** — create `tests/capture-extras-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { igData } from '@/lib/instagram/data';
import { EXTRA_GROUPS } from '@/lib/instagram/metrics';
import { supabaseSyncStore } from '@/lib/sync/store';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const NOW = '2026-10-14T02:00:00.000Z';

function recordFetch(respond: (u: URL) => unknown) {
  const seen: URL[] = [];
  const fn = (async (input: string | URL) => {
    const u = new URL(String(input));
    seen.push(u);
    return json(respond(u));
  }) as typeof fetch;
  return { fn, seen };
}

describe('EXTRA_GROUPS (metric names live only in lib/instagram/metrics.ts)', () => {
  it('never asks reposts per media, never follows/profile_visits for Reels, one metric per Story call', () => {
    const all = Object.values(EXTRA_GROUPS).flat();
    expect(all.flatMap((g) => Object.keys(g.metrics))).not.toContain('reposts');
    expect(EXTRA_GROUPS.reels.flatMap((g) => Object.keys(g.metrics))).not.toEqual(expect.arrayContaining(['follows']));
    expect(EXTRA_GROUPS.reels.flatMap((g) => Object.keys(g.metrics))).not.toEqual(expect.arrayContaining(['profile_visits']));
    for (const g of EXTRA_GROUPS.story) expect(Object.keys(g.metrics)).toHaveLength(1);
    for (const g of all.filter((x) => x.breakdown)) expect(Object.keys(g.metrics)).toHaveLength(1);
  });
  it('capability keys are unique per scope', () => {
    for (const groups of Object.values(EXTRA_GROUPS)) expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
  });
});

describe('extraInsights', () => {
  it('plain group: one call with exactly the group metrics, no breakdown; maps totals', async () => {
    const f = recordFetch(() => ({ data: [{ name: 'ig_reels_avg_watch_time', values: [{ value: 5120 }] }, { name: 'reels_skip_rate', values: [{ value: 41.5 }] }] }));
    const v = await igData('v25.0', f.fn).extraInsights('IGQ-secret', 'm1', ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate']);
    expect(v).toEqual({ ig_reels_avg_watch_time: 5120, reels_skip_rate: 41.5 });
    expect(f.seen[0].pathname).toBe('/v25.0/m1/insights');
    expect(f.seen[0].searchParams.get('metric')).toBe('ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate');
    expect(f.seen[0].searchParams.has('breakdown')).toBe(false);
  });

  it('breakdown group: asks the breakdown and returns the dimension map', async () => {
    const f = recordFetch(() => ({ data: [{ name: 'profile_activity', total_value: { value: 4, breakdowns: [{ dimension_keys: ['action_type'], results: [{ dimension_values: ['BIO_LINK_CLICKED'], value: 3 }, { dimension_values: ['DIRECTION'], value: 1 }] }] } }] }));
    const v = await igData('v25.0', f.fn).extraInsights('IGQ-secret', 'm1', ['profile_activity'], 'action_type');
    expect(v).toEqual({ BIO_LINK_CLICKED: 3, DIRECTION: 1 });
    expect(f.seen[0].searchParams.get('breakdown')).toBe('action_type');
  });

  it('nothing sent -> empty object (never zeros)', async () => {
    const f = recordFetch(() => ({ data: [] }));
    expect(await igData('v25.0', f.fn).extraInsights('t', 'm1', ['follows'])).toEqual({});
  });

  it('storyInsights keeps SWIPE_FORWARD whatever its case', async () => {
    const f = recordFetch((u) =>
      u.searchParams.get('metric') === 'navigation'
        ? { data: [{ name: 'navigation', total_value: { value: 9, breakdowns: [{ results: [{ dimension_values: ['SWIPE_FORWARD'], value: 7 }, { dimension_values: ['tap_exit'], value: 2 }] }] } }] }
        : { data: [] },
    );
    expect(await igData('v25.0', f.fn).storyInsights('t', 's1')).toMatchObject({ swipeForward: 7, exits: 2, tapsForward: null });
  });
});

describe('store: extras columns', () => {
  function recorder() {
    const calls: { table: string; op: string; row: unknown; filters: unknown[][] }[] = [];
    const db = {
      from(table: string) {
        const c = { table, op: '', row: undefined as unknown, filters: [] as unknown[][] };
        calls.push(c);
        const chain: Record<string, unknown> = {
          upsert: (r: unknown) => ((c.op = 'upsert'), (c.row = r), chain),
          update: (r: unknown) => ((c.op = 'update'), (c.row = r), chain),
          eq: (...a: unknown[]) => (c.filters.push(a), chain),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    };
    return { db: db as never, calls };
  }

  it('insertMetrics writes the new columns as null when a snapshot has no extras (never 0)', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).insertMetrics('s1', NOW, { reach: 1, views: 2, likes: null, comments: null, shares: 0, saves: null, totalInteractions: 1, replies: 0, tapsForward: 3, tapsBack: 1, exits: 1, swipeForward: 4 });
    expect(r.calls[0].row).toMatchObject({ swipe_forward: 4, follows: null, profile_visits: null, profile_activity: null, avg_watch_ms: null, total_watch_ms: null, skip_rate: null });
  });

  it('updateMetricExtras writes only the given fields onto that one snapshot; nothing given = no query', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.updateMetricExtras('p1', NOW, { follows: 3, profileActivity: { BIO_LINK_CLICKED: 2 } });
    expect(r.calls[0]).toMatchObject({ table: 'media_metrics', op: 'update', row: { follows: 3, profile_activity: { BIO_LINK_CLICKED: 2 } }, filters: [['media_id', 'p1'], ['captured_at', NOW]] });
    expect(Object.keys(r.calls[0].row as object)).toEqual(['follows', 'profile_activity']);
    await s.updateMetricExtras('p1', NOW, {});
    expect(r.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/capture-extras-data.test.ts`
Expected: FAIL — `EXTRA_GROUPS` is not exported / `extraInsights is not a function`.

- [ ] **Step 3: Implement** (the extras fields are optional on purpose: every existing `MediaMetricValues` literal stays valid, and `feedInsights` output is unchanged)

In `lib/instagram/metrics.ts` replace:

```ts
/**
 * Separate call (breakdown). Values TAP_FORWARD / TAP_BACK / TAP_EXIT map to taps_forward / taps_back / exits; they
 * come back upper- or lower-case (compare upper-cased). SWIPE_FORWARD (next story) has no column.
 */
```

with:

```ts
/**
 * Separate call (breakdown). Values TAP_FORWARD / TAP_BACK / TAP_EXIT / SWIPE_FORWARD map to taps_forward / taps_back /
 * exits / swipe_forward; they come back upper- or lower-case (compare upper-cased).
 */
```

In `lib/instagram/metrics.ts` replace:

```ts
/**
 * Error codes (https://developers.facebook.com/docs/graph-api/guides/error-handling/ and
```

with:

```ts
export type ExtraScope = 'story' | 'feed' | 'reels';
/** MediaMetricValues fields an extra metric lands in (lib/instagram/data.ts). */
export type ExtraField = 'follows' | 'profileVisits' | 'profileActivity' | 'avgWatchMs' | 'totalWatchMs' | 'skipRate';
export interface ExtraGroup {
  key: string; // capability-memory key: "<scope>:<key>"
  metrics: Readonly<Record<string, ExtraField>>; // Meta metric name -> field
  breakdown?: string; // a breakdown group has exactly one metric; its value is the { dimension: n } map
}

/**
 * Optional per-media metrics, fetched AFTER the core snapshot, ONE separate call per group: a single unsupported metric
 * fails a whole batched request (learned from `reposts`). Verified live 2026-10-16 (docs/META_PROBE_RESULTS.md): feed +
 * carousel `follows`, `profile_visits`, `profile_activity` (breakdown action_type); Reels `ig_reels_avg_watch_time` (ms),
 * `ig_reels_video_view_total_time` (ms), `reels_skip_rate` (percent) — Reels do NOT support follows/profile_visits.
 * Stories: documented but UNVERIFIED live, so one metric per call and support is learned at runtime (capability memory).
 * NEVER `reposts` per media (error 100 for every media type).
 */
export const EXTRA_GROUPS: Record<ExtraScope, readonly ExtraGroup[]> = {
  story: [
    { key: 'follows', metrics: { follows: 'follows' } },
    { key: 'profile_visits', metrics: { profile_visits: 'profileVisits' } },
    { key: 'profile_activity', metrics: { profile_activity: 'profileActivity' }, breakdown: 'action_type' },
  ],
  feed: [
    { key: 'follows_visits', metrics: { follows: 'follows', profile_visits: 'profileVisits' } },
    { key: 'profile_activity', metrics: { profile_activity: 'profileActivity' }, breakdown: 'action_type' },
  ],
  reels: [{ key: 'watch', metrics: { ig_reels_avg_watch_time: 'avgWatchMs', ig_reels_video_view_total_time: 'totalWatchMs', reels_skip_rate: 'skipRate' } }],
};

/**
 * Error codes (https://developers.facebook.com/docs/graph-api/guides/error-handling/ and
```

In `lib/instagram/data.ts` replace:

```ts
  tapsBack: number | null;
  exits: number | null;
}
```

with:

```ts
  tapsBack: number | null;
  exits: number | null;
  // Plan 11b extras: optional so a snapshot without them stays valid; missing = not captured (stored as null, never 0)
  swipeForward?: number | null;
  follows?: number | null;
  profileVisits?: number | null;
  profileActivity?: Record<string, number> | null;
  avgWatchMs?: number | null;
  totalWatchMs?: number | null;
  skipRate?: number | null;
}

/** The optional per-media metrics (lib/instagram/metrics.ts EXTRA_GROUPS), written onto an existing snapshot. */
export type MediaExtras = Pick<MediaMetricValues, M.ExtraField>;
```

In `lib/instagram/data.ts` replace:

```ts
        exits: navUpper.TAP_EXIT ?? null,
      };
```

with:

```ts
        exits: navUpper.TAP_EXIT ?? null,
        swipeForward: navUpper.SWIPE_FORWARD ?? null,
      };
```

In `lib/instagram/data.ts` replace:

```ts
    async audience(token: string, kind: M.AudienceKind)
```

with:

```ts
    /**
     * One optional metric group for one media item (a SEPARATE call; see EXTRA_GROUPS). Plain metrics -> { metric: n };
     * a breakdown group -> { dimension: n } of its single metric. Empty object when Meta sends nothing.
     */
    async extraInsights(token: string, mediaId: string, metrics: readonly string[], breakdown?: string): Promise<Record<string, number>> {
      const body = await get(`${mediaId}/insights`, { metric: metrics.join(','), ...(breakdown ? { breakdown } : {}) }, token);
      return breakdown ? parseBreakdown(body, metrics[0]) : parseTotals(body);
    },

    async audience(token: string, kind: M.AudienceKind)
```

In `lib/sync/store.ts` replace:

```ts
import type { AccountDayValues, BreakdownRow, MediaMetricValues } from '@/lib/instagram/data';
```

with:

```ts
import type { AccountDayValues, BreakdownRow, MediaExtras, MediaMetricValues } from '@/lib/instagram/data';
```

In `lib/sync/store.ts` replace:

```ts
  insertMetrics(mediaId: string, capturedAt: string, v: MediaMetricValues): Promise<void>;
```

with:

```ts
  insertMetrics(mediaId: string, capturedAt: string, v: MediaMetricValues): Promise<void>;
  /** Adds optional extras to the snapshot inserted for (mediaId, capturedAt). Only the given fields are written. */
  updateMetricExtras(mediaId: string, capturedAt: string, e: Partial<MediaExtras>): Promise<void>;
```

In `lib/sync/store.ts` replace:

```ts
const ITEM_TO_ROW = (accountId: string) =>
```

with:

```ts
const EXTRA_COLUMNS: Record<keyof MediaExtras, string> = { follows: 'follows', profileVisits: 'profile_visits', profileActivity: 'profile_activity', avgWatchMs: 'avg_watch_ms', totalWatchMs: 'total_watch_ms', skipRate: 'skip_rate' };

const ITEM_TO_ROW = (accountId: string) =>
```

In `lib/sync/store.ts` replace:

```ts
        exits: v.exits,
      };
      check('insertMetrics')
```

with:

```ts
        exits: v.exits,
        swipe_forward: v.swipeForward ?? null,
        follows: v.follows ?? null,
        profile_visits: v.profileVisits ?? null,
        profile_activity: v.profileActivity ?? null,
        avg_watch_ms: v.avgWatchMs ?? null,
        total_watch_ms: v.totalWatchMs ?? null,
        skip_rate: v.skipRate ?? null,
      };
      check('insertMetrics')
```

In `lib/sync/store.ts` replace:

```ts
    async markCaptured(mediaIds, atIso) {
```

with:

```ts
    async updateMetricExtras(mediaId, capturedAt, e) {
      const row: Row = {};
      for (const [k, col] of Object.entries(EXTRA_COLUMNS)) {
        const v = e[k as keyof MediaExtras];
        if (v !== undefined) row[col] = v;
      }
      if (Object.keys(row).length === 0) return;
      check('updateMetricExtras')(await db.from('media_metrics').update(row).eq('media_id', mediaId).eq('captured_at', capturedAt));
    },
    async markCaptured(mediaIds, atIso) {
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
import type { IgData, MediaMetricValues } from '@/lib/instagram/data';
```

with:

```ts
import type { IgData, MediaExtras, MediaMetricValues } from '@/lib/instagram/data';
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    storyInsights: vi.fn<IgData['storyInsights']>(async () => METRICS),
```

with:

```ts
    storyInsights: vi.fn<IgData['storyInsights']>(async () => METRICS),
    extraInsights: vi.fn<IgData['extraInsights']>(async () => ({})),
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  const metrics: { mediaId: string; capturedAt: string }[] = [];
```

with:

```ts
  const metrics: { mediaId: string; capturedAt: string }[] = [];
  const extras: { mediaId: string; capturedAt: string; e: Partial<MediaExtras> }[] = [];
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    insertMetrics: async (mediaId, capturedAt) => void metrics.push({ mediaId, capturedAt }),
```

with:

```ts
    insertMetrics: async (mediaId, capturedAt) => void metrics.push({ mediaId, capturedAt }),
    updateMetricExtras: async (mediaId, capturedAt, e) => void extras.push({ mediaId, capturedAt, e }),
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  return { store, states, media, daily, followers, metrics, audience,
```

with:

```ts
  return { store, states, media, daily, followers, metrics, extras, audience,
```

In `tests/instagram-data.test.ts` replace:

```ts
totalInteractions: 5, replies: 2, tapsForward: 200, tapsBack: 40, exits: 60 });
```

with:

```ts
totalInteractions: 5, replies: 2, tapsForward: 200, tapsBack: 40, exits: 60, swipeForward: 50 });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/capture-extras-data.test.ts tests/instagram-data.test.ts tests/sync-store.test.ts tests/sync-run-account.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/metrics.ts lib/instagram/data.ts lib/sync/store.ts tests/fixtures/sync-fakes.ts tests/instagram-data.test.ts tests/capture-extras-data.test.ts
git commit -m "feat(instagram): extra metric groups, SWIPE_FORWARD kept, extras columns in the store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Story extras — separate non-fatal calls after the core Story capture

**Files:**
- Create: `lib/sync/extras.ts`
- Modify: `lib/sync/schedule.ts` (`STORY_EXTRAS_EVERY_MIN`, `storyExtrasDue`)
- Modify: `lib/sync/run-account.ts` (`Progress.extraCalls`, `captureExtras`, Stories job)
- Test: `tests/sync-story-extras.test.ts` (new)

**Interfaces:**
- Consumes: `EXTRA_GROUPS` (Task 5), `learn`/`shouldAsk` (Task 4), `isFatalIgError` (Task 4), `IgData.extraInsights`, `SyncStore.updateMetricExtras` (Task 5).
- Produces: `EXTRA_CALLS_PER_RUN = 20`; `interface ExtrasRun { capabilities: Capabilities; extraCalls: number }`; `scopeOf(kind: string): ExtraScope` (`STORY`→story, `REELS`→reels, else feed); `fetchExtras(ig, token, mediaId, scope, run: ExtrasRun, timeUp: () => boolean): Promise<Partial<MediaExtras>>`; `storyExtrasDue(postedAt: string, now: Date): boolean`; in `run-account.ts` the private helper `captureExtras(c, p, items: { id; kind }[], at)` (Task 7 reuses it).

Design notes: the Story capture is unchanged up to `markCaptured`; extras run afterwards, only for Stories whose core snapshot was stored and whose cadence is due (first half hour of every 2-hour window of the Story's age + every pass in its last hour — ~13 extras snapshots per Story instead of 48, 3 calls each). Each extra metric is its own call (Story support is unverified live); unsupported answers are remembered, transient ones are not; a failed extras write never fails the job.

- [ ] **Step 1: Write the failing test** — create `tests/sync-story-extras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { EXTRA_CALLS_PER_RUN } from '@/lib/sync/extras';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, storyExtrasDue, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const story = (id: string, ageMin = 10) => ({ id, kind: 'STORY' as const, caption: null, permalink: null, postedAt: minsAgo(ageMin) });
const unsupported = () => new InstagramApiError('data', 400, 100, undefined, true);
const gone = () => new InstagramApiError('data', 400, 100, 33);
/** Only the Story-extras keys (later tasks add other capability keys, e.g. stories:url_fields). */
const storyCaps = (caps: Record<string, boolean> | undefined) => Object.fromEntries(Object.entries(caps ?? {}).filter(([k]) => k.startsWith('story:')));

function ctx(state: Partial<SyncState> = {}) {
  const ig = fakeIg();
  const mem = memoryStore();
  const acc = account({ id: 'a1' });
  const log: string[] = [];
  mem.store.insertMetrics = async (id) => void log.push(`core:${id}`);
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...state }, tz: 'UTC', now: NOW, deadline: 1_000, clock: () => 0 };
  return { c, ig, mem, log };
}

/** extraInsights fake answering per metric; `fail` maps a metric to the error it throws. */
function answer(ig: ReturnType<typeof fakeIg>, log: string[], fail: Record<string, () => Error> = {}) {
  ig.extraInsights.mockImplementation((async (_t: string, id: string, metrics: readonly string[], breakdown?: string) => {
    log.push(`extra:${id}:${metrics.join(',')}${breakdown ? `/${breakdown}` : ''}`);
    const m = metrics[0];
    if (fail[m]) throw fail[m]();
    if (breakdown) return { BIO_LINK_CLICKED: 2 };
    return { [m]: m === 'follows' ? 3 : 7 };
  }) as IgData['extraInsights']);
}

describe('storyExtrasDue', () => {
  it('first half hour of every 2-hour window, and every pass in the last hour', () => {
    expect(storyExtrasDue(minsAgo(10), NOW)).toBe(true);
    expect(storyExtrasDue(minsAgo(45), NOW)).toBe(false);
    expect(storyExtrasDue(minsAgo(125), NOW)).toBe(true);
    expect(storyExtrasDue(minsAgo(22 * 60 + 45), NOW)).toBe(false);
    expect(storyExtrasDue(minsAgo(23 * 60 + 10), NOW)).toBe(true);
  });
});

describe('Story extras', () => {
  it('one separate call per metric, AFTER every core snapshot; fields merged onto that snapshot', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1'), story('s2')]);
    answer(ig, log);
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(log.slice(0, 2)).toEqual(['core:s1', 'core:s2']);
    expect(log.slice(2, 5)).toEqual(['extra:s1:follows', 'extra:s1:profile_visits', 'extra:s1:profile_activity/action_type']);
    expect(mem.extras).toEqual([
      { mediaId: 's1', capturedAt: NOW.toISOString(), e: { follows: 3, profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } } },
      { mediaId: 's2', capturedAt: NOW.toISOString(), e: { follows: 3, profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } } },
    ]);
    expect(storyCaps(patch.capabilities)).toEqual({ 'story:follows': true, 'story:profile_visits': true, 'story:profile_activity': true });
  });

  it('an unsupported metric only drops that metric, is remembered, and is not asked on the next run', async () => {
    const first = ctx();
    first.ig.listStories.mockResolvedValue([story('s1')]);
    answer(first.ig, first.log, { follows: unsupported });
    const { result, patch } = await runAccount(first.c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(first.mem.extras[0].e).toEqual({ profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } });
    expect(patch.capabilities!['story:follows']).toBe(false);

    const next = ctx({ capabilities: patch.capabilities });
    next.ig.listStories.mockResolvedValue([story('s1')]);
    answer(next.ig, next.log);
    await runAccount(next.c, ['stories']);
    expect(next.log.filter((l) => l.startsWith('extra:'))).toEqual(['extra:s1:profile_visits', 'extra:s1:profile_activity/action_type']);
  });

  it('a Story gone mid-capture: the core snapshot stays, nothing is learned, the run is ok', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: gone, profile_visits: gone, profile_activity: gone });
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(log[0]).toBe('core:s1');
    expect(mem.extras).toEqual([]);
    expect(storyCaps(patch.capabilities)).toEqual({});
  });

  it('transient errors (5xx, network, unclassified 100) never poison the capability memory', async () => {
    const { c, ig, log } = ctx({ capabilities: { 'story:profile_visits': true } });
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: () => new InstagramApiError('data', 500, 2), profile_visits: () => new InstagramApiError('network'), profile_activity: () => new InstagramApiError('data', 400, 100) });
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(storyCaps(patch.capabilities)).toEqual({ 'story:profile_visits': true });
  });

  it('a rate limit in an extra still stops the job (back-off), but only after the core snapshot was stored', async () => {
    const { c, ig, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: () => new InstagramApiError('data', 400, 80002) });
    const { result } = await runAccount(c, ['stories']);
    expect(log[0]).toBe('core:s1');
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
  });

  it('a failing extras write costs only the extras', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log);
    mem.store.updateMetricExtras = async () => {
      throw new Error('sync store: updateMetricExtras failed');
    };
    expect((await runAccount(c, ['stories'])).result.outcome).toBe('ok');
  });

  it('respects the per-run call budget and the Story cadence; no extras for a Story without a core snapshot', async () => {
    const { c, ig, log } = ctx();
    ig.listStories.mockResolvedValue([...Array.from({ length: 12 }, (_, i) => story(`s${i}`)), story('late', 45), story('few')]);
    ig.storyInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'few') throw new InstagramApiError('data', 400, 10); // under 5 viewers
      return { reach: 1, views: 1, likes: null, comments: null, shares: null, saves: null, totalInteractions: null, replies: null, tapsForward: null, tapsBack: null, exits: null };
    });
    answer(ig, log);
    await runAccount(c, ['stories']);
    const extras = log.filter((l) => l.startsWith('extra:'));
    expect(extras).toHaveLength(EXTRA_CALLS_PER_RUN);
    expect(extras.some((l) => l.includes(':late:') || l.includes(':few:'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-story-extras.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/extras"`.

- [ ] **Step 3: Implement**

Create `lib/sync/extras.ts`:

```ts
// Optional per-media metrics (lib/instagram/metrics.ts EXTRA_GROUPS): one SEPARATE, non-fatal call per metric group,
// always after the core snapshot is stored. A group Meta calls "unsupported" is remembered (capability memory) and not
// asked again; a per-run call budget keeps extras from eating the tick. Only auth / rate-limit errors propagate.
import { isFatalIgError, type IgData, type MediaExtras } from '@/lib/instagram/data';
import { EXTRA_GROUPS, type ExtraScope } from '@/lib/instagram/metrics';
import { learn, shouldAsk, type Capabilities } from '@/lib/sync/capabilities';

/** Extra calls one account run may spend (Stories and posts together; ~0.4 s each). */
export const EXTRA_CALLS_PER_RUN = 20;

/** Mutable per-run state: the learned map is saved with the sync state; the budget counts down. */
export interface ExtrasRun {
  capabilities: Capabilities;
  extraCalls: number;
}

export const scopeOf = (kind: string): ExtraScope => (kind === 'STORY' ? 'story' : kind === 'REELS' ? 'reels' : 'feed');

export async function fetchExtras(ig: IgData, token: string, mediaId: string, scope: ExtraScope, run: ExtrasRun, timeUp: () => boolean): Promise<Partial<MediaExtras>> {
  const out: Record<string, unknown> = {};
  for (const g of EXTRA_GROUPS[scope]) {
    const key = `${scope}:${g.key}`;
    if (!shouldAsk(run.capabilities, key)) continue;
    if (run.extraCalls <= 0 || timeUp()) break;
    run.extraCalls -= 1;
    let values: Record<string, number>;
    try {
      values = await ig.extraInsights(token, mediaId, Object.keys(g.metrics), g.breakdown);
    } catch (e) {
      if (isFatalIgError(e)) throw e;
      run.capabilities = learn(run.capabilities, key, { error: e }); // false only for "unsupported"; anything else: skip
      continue;
    }
    run.capabilities = learn(run.capabilities, key, { ok: true });
    if (g.breakdown) {
      if (Object.keys(values).length > 0) out[Object.values(g.metrics)[0]] = values;
    } else {
      for (const [metric, field] of Object.entries(g.metrics)) if (values[metric] !== undefined) out[field] = values[metric];
    }
  }
  return out as Partial<MediaExtras>;
}
```

In `lib/sync/schedule.ts` replace:

```ts
const MIN = 60_000;
const HOUR = 60 * MIN;
```

with:

```ts
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Story extras every STORY_EXTRAS_EVERY_MIN of a Story's life, and on every pass in its last hour (final values). */
export const STORY_EXTRAS_EVERY_MIN = 120;

/**
 * Stateless cadence for Story extras (3 calls per Story when all are supported): the pass that lands in the first
 * half hour of each 2-hour window of the Story's age, plus every pass after 23 h. ~13 extra snapshots per Story.
 */
export function storyExtrasDue(postedAt: string, now: Date): boolean {
  const ageMin = (now.getTime() - Date.parse(postedAt)) / MIN;
  return ageMin >= 23 * 60 || ageMin % STORY_EXTRAS_EVERY_MIN < STORIES_EVERY_MIN;
}
```

In `lib/sync/run-account.ts` replace:

```ts
import type { Capabilities } from '@/lib/sync/capabilities';
```

with:

```ts
import type { Capabilities } from '@/lib/sync/capabilities';
import { EXTRA_CALLS_PER_RUN, fetchExtras, scopeOf } from '@/lib/sync/extras';
```

In `lib/sync/run-account.ts` replace:

```ts
import { BACKFILL_DAYS, FIRST_DAYS, firstWeekPending, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, type JobKind, type SyncState } from '@/lib/sync/schedule';
```

with:

```ts
import { BACKFILL_DAYS, FIRST_DAYS, firstWeekPending, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, storyExtrasDue, type JobKind, type SyncState } from '@/lib/sync/schedule';
```

In `lib/sync/run-account.ts` replace:

```ts
interface Progress {
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  capabilities: Capabilities;
}
```

with:

```ts
interface Progress {
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  capabilities: Capabilities;
  extraCalls: number; // budget for optional extra calls left in this run (not persisted)
}
```

In `lib/sync/run-account.ts` replace:

```ts
/** Live stories: upsert, then one metrics snapshot each. Under 5 viewers Instagram refuses (no_data): skip that story. */
const stories: Job = async (c) => {
```

with:

```ts
/**
 * Optional extras for media whose core snapshot (taken at `at`) is already stored. Best-effort: stops on the time
 * budget or the per-run call budget; only auth / rate-limit errors propagate (a DB hiccup here costs only the extras).
 */
async function captureExtras(c: RunContext, p: Progress, items: { id: string; kind: string }[], at: string): Promise<void> {
  for (const { id, kind } of items) {
    if (outOfTime(c) || p.extraCalls <= 0) return;
    try {
      const e = await fetchExtras(c.ig, c.token, id, scopeOf(kind), p, () => outOfTime(c));
      if (Object.keys(e).length > 0) await c.store.updateMetricExtras(id, at, e);
    } catch (e) {
      if (fatal(e)) throw e;
    }
  }
}

/**
 * Live stories: upsert, then one metrics snapshot each. Under 5 viewers Instagram refuses (no_data): skip that story.
 * Then, only once every live Story's core snapshot is stored, the Story extras on their own cadence (storyExtrasDue).
 */
const stories: Job = async (c, p) => {
```

In `lib/sync/run-account.ts` replace:

```ts
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
};

/** Feed + Reels list.
```

with:

```ts
  } finally {
    await c.store.markCaptured(captured, at);
  }
  const extrasDue = items.filter((s) => captured.includes(s.id) && storyExtrasDue(s.postedAt, c.now));
  await captureExtras(c, p, extrasDue.map((s) => ({ id: s.id, kind: 'STORY' })), at);
  return { done: true };
};

/** Feed + Reels list.
```

In `lib/sync/run-account.ts` replace:

```ts
capabilities: { ...(c.state.capabilities ?? {}) } };
```

with:

```ts
capabilities: { ...(c.state.capabilities ?? {}) }, extraCalls: EXTRA_CALLS_PER_RUN };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-story-extras.test.ts tests/sync-run-account.test.ts tests/sync-capture-v2.test.ts tests/sync-schedule.test.ts && npx tsc --noEmit`
Expected: PASS (existing Stories tests use a Story posted 60 min before `NOW`, outside the extras window, so they are unaffected).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/extras.ts lib/sync/schedule.ts lib/sync/run-account.ts tests/sync-story-extras.test.ts
git commit -m "feat(sync): Story extras (follows, profile visits, profile activity) as separate non-fatal calls" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Per-media extras + 7-day checkpoint

**Files:**
- Modify: `lib/sync/schedule.ts` (`CHECKPOINT_DAYS`, `MediaRef.kind`, checkpoint in `pickDueMedia`)
- Modify: `lib/sync/store.ts` (`mediaForMetrics` selects `media_type`)
- Modify: `lib/sync/run-account.ts` (`captureMedia(c, p, refs, due)` with extras after the core loop)
- Modify: `tests/fixtures/sync-fakes.ts` (`mediaForMetrics` returns `kind`), `tests/sync-schedule.test.ts` (one fixture row re-aged, see below)
- Test: `tests/sync-media-extras.test.ts` (new)

**Interfaces:**
- Consumes: `captureExtras` (Task 6, private in `run-account.ts`), `EXTRA_GROUPS` feed/reels (Task 5).
- Produces: `CHECKPOINT_DAYS = 7`; `MediaRef.kind?: string`; `pickDueMedia` additionally returns a post whose age just crossed 7 days when its last snapshot predates the 7-day mark (window: day 7 to day 8); `captureMedia(c, p, refs, due)` (internal).

Cadence = the existing media-metric cadence (hourly < 48 h, daily < 30 d, never-measured older posts via the history import) PLUS the 7-day checkpoint; every core snapshot is followed by its extras while the per-run budget (`EXTRA_CALLS_PER_RUN`) and the time slice last. Extras run after the WHOLE core loop, so they can only use time the core capture did not need.

`tests/sync-schedule.test.ts` change: the existing row `{ id: 'week-fresh', postedAt: hoursAgo(24 * 7), lastMetricsAt: hoursAgo(12) }` had its last snapshot at day 6.5, which the new checkpoint correctly makes due. Re-age it so it still means "captured recently, after the checkpoint" (shown in Step 3).

- [ ] **Step 1: Write the failing test** — create `tests/sync-media-extras.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, pickDueMedia, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore, METRICS } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const DONE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: hoursAgo(48) } };

function ctx(media: { id: string; kind: string; postedAt?: string }[], o: { deadline?: number } = {}) {
  const ig = fakeIg();
  const mem = memoryStore();
  for (const m of media) mem.media.set(m.id, { id: m.id, accountId: 'a1', postedAt: m.postedAt ?? hoursAgo(5), lastMetricsAt: null, kind: m.kind, gone: false });
  const acc = account({ id: 'a1' });
  let now = 0;
  const log: string[] = [];
  ig.feedInsights.mockImplementation(async (_t: string, id: string) => (log.push(`core:${id}`), (now += 100), METRICS));
  ig.extraInsights.mockImplementation((async (_t: string, id: string, metrics: readonly string[], breakdown?: string) => {
    log.push(`extra:${id}:${metrics.join(',')}${breakdown ? `/${breakdown}` : ''}`);
    now += 100;
    if (breakdown) return { BIO_LINK_CLICKED: 1 };
    return Object.fromEntries(metrics.map((m, i) => [m, i + 1]));
  }) as IgData['extraInsights']);
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...DONE }, tz: 'UTC', now: NOW, deadline: o.deadline ?? 1_000_000, clock: () => now };
  return { c, ig, mem, log };
}

describe('7-day checkpoint', () => {
  it('one snapshot right after day 7 when the last one is from before day 7, even if the daily one was hours ago', () => {
    const refs = [
      { id: 'cross', postedAt: hoursAgo(24 * 7 + 1), lastMetricsAt: hoursAgo(3) }, // last snapshot at day 6.9
      { id: 'done', postedAt: hoursAgo(24 * 7 + 5), lastMetricsAt: hoursAgo(4) }, // last snapshot at day 7.04
      { id: 'early', postedAt: hoursAgo(24 * 6 + 20), lastMetricsAt: hoursAgo(3) }, // not day 7 yet
      { id: 'late', postedAt: hoursAgo(24 * 8 + 2), lastMetricsAt: hoursAgo(24 * 2) }, // missed window: normal daily rule
    ];
    expect(pickDueMedia(refs, NOW)).toEqual(['cross', 'late']);
  });
});

describe('per-media extras', () => {
  it('feed: follows+profile_visits in one call, profile_activity in another; Reels: one watch-time call — all after every core snapshot', async () => {
    const { c, mem, log } = ctx([{ id: 'img', kind: 'IMAGE' }, { id: 'reel', kind: 'REELS', postedAt: hoursAgo(6) }, { id: 'car', kind: 'CAROUSEL_ALBUM', postedAt: hoursAgo(7) }]);
    const { result } = await runAccount(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(log.slice(0, 3)).toEqual(['core:img', 'core:reel', 'core:car']);
    expect(log.slice(3)).toEqual([
      'extra:img:follows,profile_visits',
      'extra:img:profile_activity/action_type',
      'extra:reel:ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
      'extra:car:follows,profile_visits',
      'extra:car:profile_activity/action_type',
    ]);
    const at = NOW.toISOString();
    expect(mem.extras).toContainEqual({ mediaId: 'img', capturedAt: at, e: { follows: 1, profileVisits: 2, profileActivity: { BIO_LINK_CLICKED: 1 } } });
    expect(mem.extras).toContainEqual({ mediaId: 'reel', capturedAt: at, e: { avgWatchMs: 1, totalWatchMs: 2, skipRate: 3 } });
  });

  it('an unsupported metric in a batch drops only that group, is remembered, and the core snapshot is untouched', async () => {
    const { c, ig, mem, log } = ctx([{ id: 'img', kind: 'IMAGE' }]);
    const base = ig.extraInsights.getMockImplementation()!;
    ig.extraInsights.mockImplementation((async (t: string, id: string, metrics: readonly string[], b?: string) => {
      if (metrics.includes('follows')) throw new InstagramApiError('data', 400, 100, undefined, true);
      return base(t, id, metrics, b);
    }) as IgData['extraInsights']);
    const { result, patch } = await runAccount(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(log[0]).toBe('core:img');
    expect(mem.metrics).toEqual([{ mediaId: 'img', capturedAt: NOW.toISOString() }]);
    expect(mem.extras).toEqual([{ mediaId: 'img', capturedAt: NOW.toISOString(), e: { profileActivity: { BIO_LINK_CLICKED: 1 } } }]);
    expect(patch.capabilities).toMatchObject({ 'feed:follows_visits': false, 'feed:profile_activity': true });
  });

  it('no extras for a post without a fresh core snapshot (gone, under-5/no data, unclassified error)', async () => {
    const { c, ig, log } = ctx([{ id: 'ok', kind: 'IMAGE' }, { id: 'gone', kind: 'IMAGE', postedAt: hoursAgo(6) }, { id: 'nodata', kind: 'IMAGE', postedAt: hoursAgo(7) }]);
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      log.push(`core:${id}`);
      if (id === 'gone') throw new InstagramApiError('data', 400, 100, 33);
      if (id === 'nodata') throw new InstagramApiError('data', 400, 10);
      return METRICS;
    });
    await runAccount(c, ['mediaMetrics']);
    expect(log.filter((l) => l.startsWith('extra:')).every((l) => l.startsWith('extra:ok:'))).toBe(true);
  });

  it('extras never starve the core capture: when time runs out after the core loop, extras are skipped and the job is done', async () => {
    const { c, mem, log } = ctx([{ id: 'p1', kind: 'IMAGE' }, { id: 'p2', kind: 'IMAGE', postedAt: hoursAgo(6) }, { id: 'p3', kind: 'REELS', postedAt: hoursAgo(7) }], { deadline: 300 });
    const { result } = await runAccount(c, ['mediaMetrics']);
    expect(mem.metrics).toHaveLength(3);
    expect(log.some((l) => l.startsWith('extra:'))).toBe(false);
    expect(result.outcome).toBe('ok');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-media-extras.test.ts`
Expected: FAIL — the checkpoint test returns `['late']` only, and no `extra:` calls are logged.

- [ ] **Step 3: Implement**

In `lib/sync/schedule.ts` replace:

```ts
export const MEDIA_DAILY_UNDER_DAYS = 30;
```

with:

```ts
export const MEDIA_DAILY_UNDER_DAYS = 30;
export const CHECKPOINT_DAYS = 7; // Post Lab velocity curve: one snapshot as close to day 7 as the ticks allow
```

In `lib/sync/schedule.ts` replace:

```ts
export interface MediaRef {
  id: string;
  postedAt: string;
  lastMetricsAt: string | null;
}
```

with:

```ts
export interface MediaRef {
  id: string;
  postedAt: string;
  lastMetricsAt: string | null;
  kind?: string; // IMAGE | CAROUSEL_ALBUM | REELS: picks the extra metric group (feed vs Reels)
}
```

In `lib/sync/schedule.ts` replace:

```ts
/**
 * Feed/Reels media needing a snapshot now, newest first: never captured, hourly under 48h, daily under 30d. Of the
 * never-captured posts older than 30 days only the newest `oldMax` are taken (the rest is the history import's job).
 */
```

with:

```ts
/**
 * Feed/Reels media needing a snapshot now, newest first: never captured, hourly under 48h, daily under 30d, plus the
 * 7-day checkpoint (first tick after day 7 when the last snapshot is from before day 7). Of the never-captured posts
 * older than 30 days only the newest `oldMax` are taken (the rest is the history import's job).
 */
```

In `lib/sync/schedule.ts` replace:

```ts
      if (age < MEDIA_HOURLY_UNDER_HOURS * HOUR) return since >= HOUR - slack;
      if (age < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR) return since >= 24 * HOUR - slack;
```

with:

```ts
      if (age < MEDIA_HOURLY_UNDER_HOURS * HOUR) return since >= HOUR - slack;
      const mark = Date.parse(r.postedAt) + CHECKPOINT_DAYS * 24 * HOUR;
      if (t >= mark && Date.parse(r.lastMetricsAt) < mark && age < (CHECKPOINT_DAYS + 1) * 24 * HOUR) return true;
      if (age < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR) return since >= 24 * HOUR - slack;
```

In `tests/sync-schedule.test.ts` replace:

```ts
      { id: 'week-fresh', postedAt: hoursAgo(24 * 7), lastMetricsAt: hoursAgo(12) },
```

with:

```ts
      { id: 'week-fresh', postedAt: hoursAgo(24 * 7 + 12), lastMetricsAt: hoursAgo(12) }, // captured at day 7: checkpoint done
```

In `lib/sync/store.ts` replace:

```ts
        .select('id,posted_at,last_metrics_at')
```

with:

```ts
        .select('id,posted_at,last_metrics_at,media_type')
```

In `lib/sync/store.ts` replace:

```ts
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, postedAt: r.posted_at as string, lastMetricsAt: (r.last_metrics_at as string | null) ?? null }));
```

with:

```ts
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, postedAt: r.posted_at as string, lastMetricsAt: (r.last_metrics_at as string | null) ?? null, kind: r.media_type as string | undefined }));
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
      [...media.values()].filter((m) => m.accountId === accountId && m.kind !== 'STORY' && !m.gone && (m.postedAt >= since || m.lastMetricsAt === null)).map(({ id, postedAt, lastMetricsAt }) => ({ id, postedAt, lastMetricsAt })),
```

with:

```ts
      [...media.values()].filter((m) => m.accountId === accountId && m.kind !== 'STORY' && !m.gone && (m.postedAt >= since || m.lastMetricsAt === null)).map(({ id, postedAt, lastMetricsAt, kind }) => ({ id, postedAt, lastMetricsAt, kind })),
```

In `lib/sync/run-account.ts` replace:

```ts
 * The first per-post error is rethrown at the end so the account shows it; the loop itself never stops for one bad post.
 */
async function captureMedia(c: RunContext, due: string[]): Promise<{ done: boolean }> {
  const at = c.now.toISOString();
  const captured: string[] = [];
```

with:

```ts
 * The first per-post error is rethrown at the end so the account shows it; the loop itself never stops for one bad post.
 * Extras (feed: follows/profile visits/activity; Reels: watch time/skip rate) come after the whole core loop, for the
 * posts that got a snapshot, within the per-run extras budget: they can never starve the core capture.
 */
async function captureMedia(c: RunContext, p: Progress, refs: MediaRef[], due: string[]): Promise<{ done: boolean }> {
  const at = c.now.toISOString();
  const captured: string[] = [];
  const measured: string[] = [];
```

In `lib/sync/run-account.ts` replace:

```ts
      await c.store.insertMetrics(id, at, values);
      captured.push(id);
      streak = 0;
```

with:

```ts
      await c.store.insertMetrics(id, at, values);
      captured.push(id);
      measured.push(id);
      streak = 0;
```

In `lib/sync/run-account.ts` replace:

```ts
    if (firstError) throw firstError;
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
}
```

with:

```ts
    if (firstError) throw firstError;
  } finally {
    await c.store.markCaptured(captured, at);
  }
  const kinds = new Map(refs.map((r) => [r.id, r.kind ?? 'IMAGE']));
  await captureExtras(c, p, measured.map((id) => ({ id, kind: kinds.get(id)! })), at);
  return { done: true };
}
```

In `lib/sync/run-account.ts` replace:

```ts
const mediaMetrics: Job = async (c) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  return captureMedia(c, pickDueMedia(await c.store.mediaForMetrics(c.account.id, since), c.now));
};
```

with:

```ts
const mediaMetrics: Job = async (c, p) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const refs = await c.store.mediaForMetrics(c.account.id, since);
  return captureMedia(c, p, refs, pickDueMedia(refs, c.now));
};
```

In `lib/sync/run-account.ts` replace:

```ts
  return captureMedia(c, pickDueMedia(refs, c.now, Infinity));
```

with:

```ts
  return captureMedia(c, p, refs, pickDueMedia(refs, c.now, Infinity));
```

In `lib/sync/run-account.ts` replace:

```ts
pickDueMedia, storyExtrasDue, type JobKind, type SyncState } from '@/lib/sync/schedule';
```

with:

```ts
pickDueMedia, storyExtrasDue, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-media-extras.test.ts tests/sync-schedule.test.ts tests/sync-onboarding-schedule.test.ts tests/sync-store.test.ts tests/sync-run-account.test.ts tests/sync-backfill.test.ts tests/sync-lanes.test.ts tests/sync-tick.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/schedule.ts lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-schedule.test.ts tests/sync-media-extras.test.ts
git commit -m "feat(sync): per-media extras (feed follows/visits/activity, Reels watch time/skip rate) + 7-day checkpoint" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Media fields + `media_children` (listing details, Story-field fallback)

**Files:**
- Modify: `lib/instagram/metrics.ts` (`MEDIA_BASE_FIELDS`, `MEDIA_FIELDS`, `STORY_FIELDS`, `COVER_FIELDS`)
- Modify: `lib/instagram/parse.ts` (`IgMediaItem.details`, `MediaDetails`, `MediaChild`, `parseMediaDetails`, `mediaDetailsById`)
- Modify: `lib/instagram/data.ts` (`listPaged` takes the field list and attaches details; `listStories(token, withUrls = true)`)
- Modify: `lib/sync/store.ts` (`upsertMedia` writes details + `media_children`)
- Modify: `lib/sync/run-account.ts` (`listLiveStories` fallback)
- Modify: `tests/fixtures/sync-fakes.ts` (`children` log), `tests/instagram-data.test.ts` (listing field list), `tests/sync-tick.test.ts` (`listStories` now gets `withUrls`), `scripts/record-ig-fixtures.mjs` (records Stories with `STORY_FIELDS`)
- Test: `tests/capture-media-fields.test.ts` (new)

**Interfaces:**
- Consumes: `learn`, `shouldAsk`, `isUnsupported` (Task 4).
- Produces: `MEDIA_BASE_FIELDS`, `MEDIA_FIELDS` (= base + `like_count,comments_count,is_shared_to_feed,children{media_type}`), `STORY_FIELDS` (= base + `media_url,thumbnail_url`), `COVER_FIELDS` (used by Task 10); `interface MediaDetails { mediaType; productType; likeCount; commentsCount; isSharedToFeed; mediaUrl; thumbnailUrl; childrenCount; children: MediaChild[] | null }`; `parseMediaDetails(v: unknown): MediaDetails`; `IgMediaItem.details?: MediaDetails`; `IgData.listStories(token, withUrls?: boolean)`; capability key `stories:url_fields`.

The original parsers keep their shapes (`parseMediaPage` output and its tests are unchanged); details ride on a separate optional property. CDN URLs are only kept in memory for the cover copy (Task 10) and never written to the database.

- [ ] **Step 1: Write the failing test** — create `tests/capture-media-fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { igData, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { parseMediaDetails } from '@/lib/instagram/parse';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const CDN = 'https://scontent-sin6-1.cdninstagram.com/v/t51/abc.jpg?oe=AAAA&_nc_sig=secret';

describe('parseMediaDetails', () => {
  it('reads counts, product type, Reels flag, URLs and the first 10 children; keeps the real child count', () => {
    const children = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, media_type: i % 2 ? 'VIDEO' : 'IMAGE', media_url: `${CDN}&i=${i}` }));
    const d = parseMediaDetails({ media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', like_count: 12, comments_count: 0, children: { data: children } });
    expect(d).toMatchObject({ mediaType: 'CAROUSEL_ALBUM', productType: 'FEED', likeCount: 12, commentsCount: 0, isSharedToFeed: null, childrenCount: 12 });
    expect(d.children).toHaveLength(10);
    expect(d.children![1]).toEqual({ mediaType: 'VIDEO', mediaUrl: `${CDN}&i=1`, thumbnailUrl: null });
  });
  it('missing or malformed values are null, never 0', () => {
    expect(parseMediaDetails({ like_count: '5', is_shared_to_feed: 'yes' })).toEqual({ mediaType: null, productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null });
    expect(parseMediaDetails(null).likeCount).toBeNull();
  });
});

describe('listing requests', () => {
  function record(body: unknown) {
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), json(body))) as typeof fetch;
    return { fn, seen };
  }
  it('listMedia asks the extended fields and attaches the details to each item', async () => {
    const f = record({ data: [{ id: 'r1', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-10-13T10:00:00+0000', like_count: 3, comments_count: 1, is_shared_to_feed: true }] });
    const [item] = await igData('v25.0', f.fn).listMedia('t', 10);
    expect(f.seen[0].searchParams.get('fields')).toContain('like_count,comments_count,is_shared_to_feed,children{media_type}');
    expect(item).toMatchObject({ id: 'r1', kind: 'REELS', details: { likeCount: 3, commentsCount: 1, isSharedToFeed: true, productType: 'REELS' } });
  });
  it('listStories asks the URL fields by default and only the base fields when told so', async () => {
    const f = record({ data: [] });
    const ig = igData('v25.0', f.fn);
    await ig.listStories('t');
    await ig.listStories('t', false);
    expect(f.seen[0].searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url');
    expect(f.seen[1].searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp');
  });
});

describe('Story field fallback', () => {
  function ctx(state: Partial<SyncState> = {}) {
    const ig = fakeIg();
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig, store: memoryStore().store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...state }, tz: 'UTC', now: new Date('2026-10-14T02:00:00Z'), deadline: 1, clock: () => 0 };
    return { c, ig };
  }
  it('"nonexisting field" on the URL fields: Stories are listed again with the base fields, and that is remembered', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockImplementation((async (_t: string, withUrls?: boolean) => {
      if (withUrls !== false) throw new InstagramApiError('data', 400, 100, undefined, true);
      return [];
    }) as IgData['listStories']);
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(ig.listStories.mock.calls.map((a) => a[1])).toEqual([true, false]);
    expect(patch.capabilities!['stories:url_fields']).toBe(false);

    const next = ctx({ capabilities: patch.capabilities });
    await runAccount(next.c, ['stories']);
    expect(next.ig.listStories.mock.calls.map((a) => a[1])).toEqual([false]);
  });
  it('any other error is not a reason to retry: a rate limit still stops the job', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    const { result, patch } = await runAccount(c, ['stories']);
    expect(ig.listStories).toHaveBeenCalledTimes(1);
    expect(result.errorKey).toBe('rate_limited');
    expect(patch.capabilities).toEqual({});
  });
});

describe('store: media fields and carousel children', () => {
  it('upserts the listing details (never the CDN URLs) and one children row per position', async () => {
    const calls: { table: string; rows: Record<string, unknown>[]; opts: unknown }[] = [];
    const db = { from: (table: string) => ({ upsert: async (rows: Record<string, unknown>[], opts: unknown) => (calls.push({ table, rows, opts }), { error: null }) }) };
    const details = { mediaType: 'CAROUSEL_ALBUM', productType: 'FEED', likeCount: 4, commentsCount: 2, isSharedToFeed: null, mediaUrl: CDN, thumbnailUrl: null, childrenCount: 2, children: [{ mediaType: 'IMAGE', mediaUrl: CDN, thumbnailUrl: null }, { mediaType: 'VIDEO', mediaUrl: null, thumbnailUrl: CDN }] };
    await supabaseSyncStore(db as never).upsertMedia('a1', [{ id: 'c1', kind: 'CAROUSEL_ALBUM', caption: null, permalink: null, postedAt: '2026-10-10T00:00:00.000Z', details }, { id: 'p1', kind: 'IMAGE', caption: null, permalink: null, postedAt: '2026-10-09T00:00:00.000Z' }]);
    expect(calls[0].rows[0]).toMatchObject({ id: 'c1', media_product_type: 'FEED', like_count: 4, comments_count: 2, is_shared_to_feed: null, children_count: 2 });
    expect(calls[0].rows[1]).not.toHaveProperty('like_count'); // no details -> stored values untouched
    expect(JSON.stringify(calls)).not.toContain('cdninstagram');
    expect(calls[0].rows[0]).not.toHaveProperty('cover_status');
    expect(calls[1]).toEqual({ table: 'media_children', rows: [{ media_id: 'c1', position: 0, media_type: 'IMAGE' }, { media_id: 'c1', position: 1, media_type: 'VIDEO' }], opts: { onConflict: 'media_id,position' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/capture-media-fields.test.ts`
Expected: FAIL — `parseMediaDetails` is not exported.

- [ ] **Step 3: Implement**

In `lib/instagram/metrics.ts` replace:

```ts
/**
 * GET /me/media and GET /me/stories fields. UNCERTAIN: the media reference marks `caption` and `media_product_type`
 * "Facebook Login only". If the first live call fails with error code 100 (nonexisting field), delete them here: the
 * parser already falls back (VIDEO -> REELS, caption null).
 */
export const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp';
```

with:

```ts
/**
 * Base fields of GET /me/media and GET /me/stories. `caption` and `media_product_type` work under Instagram Login
 * (verified live 2026-10-16, docs/META_PROBE_RESULTS.md) although the reference marks them "Facebook Login only".
 */
export const MEDIA_BASE_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp';
/** GET /me/media: + counts, Reels' is_shared_to_feed and the carousel children's types (all verified live 2026-10-16). */
export const MEDIA_FIELDS = `${MEDIA_BASE_FIELDS},like_count,comments_count,is_shared_to_feed,children{media_type}`;
/**
 * GET /me/stories: + the image URLs for the first-sight cover copy. UNVERIFIED on Stories (no Story was live while
 * probing): on a "nonexisting field" answer the sync falls back to MEDIA_BASE_FIELDS and remembers it (capability
 * "stories:url_fields"), so the Story capture itself can never break on these fields.
 */
export const STORY_FIELDS = `${MEDIA_BASE_FIELDS},media_url,thumbnail_url`;
/**
 * GET /{media-id}: fresh cover URLs (CDN links expire in ~1.4–4.5 days, so they are fetched right before the copy).
 * thumbnail_url = videos/Reels; media_url = images (omitted for copyrighted media); children = carousels.
 */
export const COVER_FIELDS = 'media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}';
```

In `lib/instagram/parse.ts` replace:

```ts
export type MediaKind = 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'STORY';
export interface IgMediaItem {
  id: string;
  kind: MediaKind;
  caption: string | null;
  permalink: string | null;
  postedAt: string; // ISO UTC
}
```

with:

```ts
export type MediaKind = 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'STORY';
export interface IgMediaItem {
  id: string;
  kind: MediaKind;
  caption: string | null;
  permalink: string | null;
  postedAt: string; // ISO UTC
  /** Extra fields from the listing (counts, product type, cover URLs, children); absent = not requested/parsed. */
  details?: MediaDetails;
}

export interface MediaChild {
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
}
export interface MediaDetails {
  mediaType: string | null;
  productType: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  isSharedToFeed: boolean | null;
  mediaUrl: string | null; // signed CDN URL: never logged, never stored
  thumbnailUrl: string | null; // signed CDN URL: never logged, never stored
  childrenCount: number | null;
  children: MediaChild[] | null; // carousels: the first 10, in order
}

/** One media object's optional fields. Missing or malformed values are null (never 0). */
export function parseMediaDetails(v: unknown): MediaDetails {
  const m = isObj(v) ? v : {};
  const kids = isObj(m.children) && Array.isArray(m.children.data) ? m.children.data.filter(isObj) : null;
  return {
    mediaType: str(m.media_type),
    productType: str(m.media_product_type),
    likeCount: num(m.like_count),
    commentsCount: num(m.comments_count),
    isSharedToFeed: typeof m.is_shared_to_feed === 'boolean' ? m.is_shared_to_feed : null,
    mediaUrl: str(m.media_url),
    thumbnailUrl: str(m.thumbnail_url),
    childrenCount: kids ? kids.length : null,
    children: kids ? kids.slice(0, 10).map((c) => ({ mediaType: str(c.media_type), mediaUrl: str(c.media_url), thumbnailUrl: str(c.thumbnail_url) })) : null,
  };
}

/** Details of every item on a media page, by id (parseMediaPage keeps its original item shape). */
export function mediaDetailsById(body: unknown): Map<string, MediaDetails> {
  const out = new Map<string, MediaDetails>();
  for (const m of entries(body)) {
    const id = typeof m.id === 'number' ? String(m.id) : str(m.id);
    if (id) out.set(id, parseMediaDetails(m));
  }
  return out;
}
```

In `lib/instagram/data.ts` replace:

```ts
import { parseBreakdown, parseMediaPage, parseOnlineFollowers, parseTotals, type IgMediaItem } from '@/lib/instagram/parse';
```

with:

```ts
import { mediaDetailsById, parseBreakdown, parseMediaPage, parseOnlineFollowers, parseTotals, type IgMediaItem } from '@/lib/instagram/parse';
```

In `lib/instagram/data.ts` replace:

```ts
  async function listPaged(path: string, token: string, story: boolean, maxItems: number, stopBefore?: string, timeUp?: () => boolean): Promise<IgMediaItem[]> {
    const out: IgMediaItem[] = [];
    const maxPages = Math.ceil(maxItems / M.MEDIA_PAGE_SIZE) + 1;
    let body = await get(path, { fields: M.MEDIA_FIELDS, limit: M.MEDIA_PAGE_SIZE }, token);
    for (let pages = 1; ; pages++) {
      const page = parseMediaPage(body, story);
      for (const item of page.items) {
        if (out.length >= maxItems) return out;
        out.push(item);
      }
```

with:

```ts
  async function listPaged(path: string, token: string, story: boolean, maxItems: number, fields: string, stopBefore?: string, timeUp?: () => boolean): Promise<IgMediaItem[]> {
    const out: IgMediaItem[] = [];
    const maxPages = Math.ceil(maxItems / M.MEDIA_PAGE_SIZE) + 1;
    let body = await get(path, { fields, limit: M.MEDIA_PAGE_SIZE }, token);
    for (let pages = 1; ; pages++) {
      const page = parseMediaPage(body, story);
      const details = mediaDetailsById(body);
      for (const item of page.items) {
        if (out.length >= maxItems) return out;
        out.push({ ...item, details: details.get(item.id) });
      }
```

In `lib/instagram/data.ts` replace:

```ts
    listMedia: (token: string, maxItems: number, stopBefore?: string, timeUp?: () => boolean) => listPaged('me/media', token, false, maxItems, stopBefore, timeUp),
    listStories: (token: string) => listPaged('me/stories', token, true, 100),
```

with:

```ts
    listMedia: (token: string, maxItems: number, stopBefore?: string, timeUp?: () => boolean) => listPaged('me/media', token, false, maxItems, M.MEDIA_FIELDS, stopBefore, timeUp),
    /** withUrls=false: the base fields only (fallback when Meta rejects the URL fields on Stories). */
    listStories: (token: string, withUrls = true) => listPaged('me/stories', token, true, 100, withUrls ? M.STORY_FIELDS : M.MEDIA_BASE_FIELDS),
```

In `lib/sync/store.ts` replace:

```ts
  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;
```

with:

```ts
  /** Media rows (+ listing details when present) and, for carousels, their children rows. */
  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;
```

In `lib/sync/store.ts` replace:

```ts
  posted_at: i.postedAt,
  expires_at: i.kind === 'STORY' ? new Date(Date.parse(i.postedAt) + 86_400_000).toISOString() : null,
});
```

with:

```ts
  posted_at: i.postedAt,
  expires_at: i.kind === 'STORY' ? new Date(Date.parse(i.postedAt) + 86_400_000).toISOString() : null,
  // listing details (never the CDN URLs); cover_* and comments_synced_count are never in this payload
  ...(i.details
    ? { media_product_type: i.details.productType, like_count: i.details.likeCount, comments_count: i.details.commentsCount, is_shared_to_feed: i.details.isSharedToFeed, children_count: i.details.childrenCount }
    : {}),
});
```

In `lib/sync/store.ts` replace:

```ts
      // last_metrics_at / gone_at are not in the payload, so re-listing never resets them
      check('upsertMedia')(await db.from('media').upsert(items.map(ITEM_TO_ROW(accountId)), { onConflict: 'id' }));
```

with:

```ts
      // last_metrics_at / gone_at are not in the payload, so re-listing never resets them
      check('upsertMedia')(await db.from('media').upsert(items.map(ITEM_TO_ROW(accountId)), { onConflict: 'id' }));
      const children = items.flatMap((i) => (i.details?.children ?? []).map((ch, position) => ({ media_id: i.id, position, media_type: ch.mediaType })));
      if (children.length > 0) check('upsertMediaChildren')(await db.from('media_children').upsert(children, { onConflict: 'media_id,position' }));
```

In `lib/sync/run-account.ts` replace:

```ts
import { classifyIgError, isFatalIgError as fatal, type IgData } from '@/lib/instagram/data';
```

with:

```ts
import { classifyIgError, isFatalIgError as fatal, isUnsupported, type IgData } from '@/lib/instagram/data';
```

In `lib/sync/run-account.ts` replace:

```ts
import type { Capabilities } from '@/lib/sync/capabilities';
```

with:

```ts
import { learn, shouldAsk, type Capabilities } from '@/lib/sync/capabilities';
```

In `lib/sync/run-account.ts` replace:

```ts
/**
 * Live stories: upsert, then one metrics snapshot each.
```

with:

```ts
/**
 * Live Stories with their image URLs (for the first-sight cover). Story support for the URL fields is unverified: on
 * an "unsupported field" answer the list is fetched again with the base fields and that is remembered.
 */
async function listLiveStories(c: RunContext, p: Progress) {
  const key = 'stories:url_fields';
  if (shouldAsk(p.capabilities, key)) {
    try {
      const items = await c.ig.listStories(c.token, true);
      p.capabilities = learn(p.capabilities, key, { ok: true });
      return items;
    } catch (e) {
      if (!isUnsupported(e)) throw e;
      p.capabilities = learn(p.capabilities, key, { error: e });
    }
  }
  return c.ig.listStories(c.token, false);
}

/**
 * Live stories: upsert, then one metrics snapshot each.
```

In `lib/sync/run-account.ts` replace:

```ts
  const items = await c.ig.listStories(c.token);
```

with:

```ts
  const items = await listLiveStories(c, p);
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  const breakdowns: { accountId: string; day: string; rows: number }[] = [];
```

with:

```ts
  const breakdowns: { accountId: string; day: string; rows: number }[] = [];
  const children: { mediaId: string; position: number; mediaType: string | null }[] = [];
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
      for (const i of items) media.set(i.id, { id: i.id, accountId, postedAt: i.postedAt, lastMetricsAt: media.get(i.id)?.lastMetricsAt ?? null, kind: i.kind, gone: media.get(i.id)?.gone ?? false });
```

with:

```ts
      for (const i of items) media.set(i.id, { id: i.id, accountId, postedAt: i.postedAt, lastMetricsAt: media.get(i.id)?.lastMetricsAt ?? null, kind: i.kind, gone: media.get(i.id)?.gone ?? false });
      for (const i of items) (i.details?.children ?? []).forEach((ch, position) => children.push({ mediaId: i.id, position, mediaType: ch.mediaType }));
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  return { store, states, media, daily, followers, metrics, extras, audience,
```

with:

```ts
  return { store, states, media, children, daily, followers, metrics, extras, audience,
```

In `tests/instagram-data.test.ts` replace:

```ts
    expect(f.calls[0].url.searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp');
```

with:

```ts
    expect(f.calls[0].url.searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,is_shared_to_feed,children{media_type}');
```

In `scripts/record-ig-fixtures.mjs` replace:

```
    ['stories', 'me/stories', { fields: M.MEDIA_FIELDS }],
```

with:

```
    ['stories', 'me/stories', { fields: M.STORY_FIELDS }],
```

In `tests/sync-tick.test.ts` replace:

```ts
    expect(ig.listStories).toHaveBeenCalledWith('tok-a2');
```

with:

```ts
    expect(ig.listStories).toHaveBeenCalledWith('tok-a2', true);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/capture-media-fields.test.ts tests/instagram-data.test.ts tests/instagram-parse.test.ts tests/sync-store.test.ts tests/sync-run-account.test.ts tests/sync-lanes.test.ts tests/sync-tick.test.ts tests/sync-story-extras.test.ts tests/sync-capabilities.test.ts tests/record-ig-fixtures.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/metrics.ts lib/instagram/parse.ts lib/instagram/data.ts lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/instagram-data.test.ts tests/sync-tick.test.ts scripts/record-ig-fixtures.mjs tests/capture-media-fields.test.ts
git commit -m "feat(sync): keep media fields (counts, product type, Reels flag, carousel children); Story URL fields with fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Safe cover fetch (`lib/sync/covers.ts`)

**Files:**
- Create: `lib/sync/covers.ts`
- Test: `tests/cover-fetch.test.ts` (new)

**Interfaces:**
- Consumes: `MediaDetails` (Task 8).
- Produces: `COVERS_BUCKET = 'covers'`; `COVER_MAX_BYTES`; `COVER_TYPES = ['image/jpeg','image/png','image/webp']`, `type CoverType`; `coverPath(accountId, mediaId) => '<account>/<media>.jpg'`; `isCdnUrl(raw): boolean`; `coverUrl(d?: MediaDetails): string | null`; `fetchImage(url, fetchFn = fetch): Promise<{ ok: true; bytes: Uint8Array; contentType: CoverType } | { ok: false; reason: 'blocked'|'http'|'type'|'too_large'|'network' }>` (never throws, never returns the URL); `type CoverStatus`; `interface CoverRef { id; kind; postedAt; status; attempts; triedAt }`; `COVER_MAX_ATTEMPTS = 5`; `coverRetryMs(attempts)`; `afterFailure(attempts) => { status: 'failed'|'unavailable'; attempts }`; `pickCoverDue(refs, now, max): CoverRef[]`.

Rules (spec §4 + Global Constraints): `https` only, default port, no credentials, host `fbcdn.net` / `cdninstagram.com` or a subdomain (parsed with `URL`, so `fbcdn.net.evil.com` and `evilfbcdn.net` fail); `redirect: 'manual'` and every hop re-checked (max 3); one 10 s `AbortSignal.timeout` for the whole fetch; declared `content-length` > 5 MB refused, streamed bodies cut at 5 MB; only JPEG/PNG/WebP (SVG refused — it can carry script and would be served from our origin).

- [ ] **Step 1: Write the failing test** — create `tests/cover-fetch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MediaDetails } from '@/lib/instagram/parse';
import { afterFailure, COVER_MAX_BYTES, coverPath, coverUrl, fetchImage, isCdnUrl, pickCoverDue, type CoverRef } from '@/lib/sync/covers';

const CDN = 'https://scontent-sin6-1.cdninstagram.com/v/t51.29350-15/abc_n.jpg?stp=dst-jpg&_nc_ht=x&oe=670A1B2C&_nc_sig=SECRET';
const FB = 'https://scontent.xx.fbcdn.net/v/t39/abc.jpg?oe=670A1B2C&_nc_sig=SECRET';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function img(body: BodyInit | null = JPEG, headers: Record<string, string> = { 'content-type': 'image/jpeg' }, status = 200) {
  return new Response(body, { status, headers });
}
/** fetch fake: answers by URL; records each URL and RequestInit it was asked for. */
function cdn(routes: Record<string, () => Response>) {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const r = routes[url];
    if (!r) throw new TypeError('fetch failed');
    return r();
  }) as typeof fetch;
  return { fn, seen };
}

describe('isCdnUrl', () => {
  it('accepts https Instagram CDN hosts and their subdomains', () => {
    for (const u of [CDN, FB, 'https://fbcdn.net/x.jpg', 'https://CDNINSTAGRAM.COM/x.jpg', 'https://a.b.fbcdn.net:443/x.jpg']) expect(isCdnUrl(u), u).toBe(true);
  });
  it('rejects look-alikes, other schemes, credentials, odd ports, IPs and garbage', () => {
    for (const u of ['http://scontent.cdninstagram.com/x.jpg', 'https://fbcdn.net.evil.com/x.jpg', 'https://evilfbcdn.net/x.jpg', 'https://cdninstagram.com.attacker.io/x', 'https://user:pw@scontent.fbcdn.net/x.jpg', 'https://scontent.fbcdn.net:8443/x.jpg', 'https://157.240.1.1/x.jpg', 'https://localhost/x', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url', ''])
      expect(isCdnUrl(u), u).toBe(false);
  });
});

describe('coverUrl', () => {
  const d = (o: Partial<MediaDetails>): MediaDetails => ({ mediaType: null, productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null, ...o });
  it('video/Reel -> thumbnail (never the mp4); photo -> media_url; carousel -> first child', () => {
    expect(coverUrl(d({ mediaType: 'VIDEO', mediaUrl: 'mp4', thumbnailUrl: 'thumb' }))).toBe('thumb');
    expect(coverUrl(d({ mediaType: 'VIDEO', mediaUrl: 'mp4' }))).toBeNull();
    expect(coverUrl(d({ mediaType: 'IMAGE', mediaUrl: 'img' }))).toBe('img');
    expect(coverUrl(d({ mediaType: 'CAROUSEL_ALBUM', mediaUrl: 'parent', children: [{ mediaType: 'VIDEO', mediaUrl: 'mp4', thumbnailUrl: 'kid-thumb' }] }))).toBe('kid-thumb');
    expect(coverUrl(d({ mediaType: 'IMAGE' }))).toBeNull(); // copyrighted media: Meta omits media_url
    expect(coverUrl(undefined)).toBeNull();
  });
});

describe('fetchImage', () => {
  it('downloads a JPEG from the CDN without following redirects automatically', async () => {
    const f = cdn({ [CDN]: () => img() });
    const r = await fetchImage(CDN, f.fn);
    expect(r).toEqual({ ok: true, bytes: JPEG, contentType: 'image/jpeg' });
    expect(f.seen[0].init?.redirect).toBe('manual');
    expect(f.seen[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows a redirect only to another CDN host (relative locations too), at most 3 hops', async () => {
    const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    const ok = cdn({ [CDN]: hop(FB), [FB]: () => img(JPEG, { 'content-type': 'image/webp' }) });
    expect(await fetchImage(CDN, ok.fn)).toMatchObject({ ok: true, contentType: 'image/webp' });
    const rel = cdn({ [CDN]: hop('/v/other.jpg'), 'https://scontent-sin6-1.cdninstagram.com/v/other.jpg': () => img() });
    expect(await fetchImage(CDN, rel.fn)).toMatchObject({ ok: true });
    const evil = cdn({ [CDN]: hop('https://169.254.169.254/latest/meta-data') });
    expect(await fetchImage(CDN, evil.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(evil.seen).toHaveLength(1); // the metadata address was never requested
    const loop = cdn({ [CDN]: hop(FB), [FB]: hop(CDN) });
    expect(await fetchImage(CDN, loop.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(loop.seen).toHaveLength(4);
  });

  it('refuses non-CDN URLs before any request', async () => {
    const f = cdn({});
    expect(await fetchImage('https://example.com/x.jpg', f.fn)).toEqual({ ok: false, reason: 'blocked' });
    expect(f.seen).toHaveLength(0);
  });

  it('expired link (403/404/410), SVG, HTML, empty body', async () => {
    for (const status of [403, 404, 410]) expect(await fetchImage(CDN, cdn({ [CDN]: () => img('denied', { 'content-type': 'text/plain' }, status) }).fn)).toEqual({ ok: false, reason: 'http' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img('<svg onload="x()"/>', { 'content-type': 'image/svg+xml' }) }).fn)).toEqual({ ok: false, reason: 'type' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img('<html>', { 'content-type': 'text/html; charset=utf-8' }) }).fn)).toEqual({ ok: false, reason: 'type' });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(new Uint8Array(0)) }).fn)).toEqual({ ok: false, reason: 'http' });
  });

  it('over 5 MB: refused by the declared length, and cut off while streaming when the length lies', async () => {
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(JPEG, { 'content-type': 'image/jpeg', 'content-length': String(COVER_MAX_BYTES + 1) }) }).fn)).toEqual({ ok: false, reason: 'too_large' });
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => void ((pulled += 1), c.enqueue(new Uint8Array(1024 * 1024))) });
    expect(await fetchImage(CDN, cdn({ [CDN]: () => img(endless) }).fn)).toEqual({ ok: false, reason: 'too_large' });
    expect(pulled).toBeLessThan(10);
  });

  it('network failure or timeout -> network; the result never carries the URL', async () => {
    const r = await fetchImage(CDN, (async () => Promise.reject(new DOMException('timed out', 'TimeoutError'))) as typeof fetch);
    expect(r).toEqual({ ok: false, reason: 'network' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
});

describe('cover retry policy', () => {
  const NOW = new Date('2026-10-14T02:00:00Z');
  const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
  const ref = (o: Partial<CoverRef> & { id: string }): CoverRef => ({ kind: 'IMAGE', postedAt: minsAgo(60), status: 'pending', attempts: 0, triedAt: null, ...o });
  it('never tried, or failed with its back-off (30, 60, 120… min) passed; newest first; capped', () => {
    const refs = [
      ref({ id: 'old-pending', postedAt: minsAgo(9000) }),
      ref({ id: 'new-pending', postedAt: minsAgo(10) }),
      ref({ id: 'failed-1-wait', status: 'failed', attempts: 1, triedAt: minsAgo(20) }),
      ref({ id: 'failed-1-due', status: 'failed', attempts: 1, triedAt: minsAgo(31), postedAt: minsAgo(30) }),
      ref({ id: 'failed-3-wait', status: 'failed', attempts: 3, triedAt: minsAgo(100) }),
      ref({ id: 'ok', status: 'ok' }),
      ref({ id: 'gave-up', status: 'unavailable' }),
    ];
    expect(pickCoverDue(refs, NOW, 10).map((r) => r.id)).toEqual(['new-pending', 'failed-1-due', 'old-pending']);
    expect(pickCoverDue(refs, NOW, 1).map((r) => r.id)).toEqual(['new-pending']);
  });
  it('gives up after 5 attempts', () => {
    expect(afterFailure(0)).toEqual({ status: 'failed', attempts: 1 });
    expect(afterFailure(3)).toEqual({ status: 'failed', attempts: 4 });
    expect(afterFailure(4)).toEqual({ status: 'unavailable', attempts: 5 });
  });
  it('object key = account/media.jpg', () => {
    expect(coverPath('3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b', '17900000000000001')).toBe('3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/17900000000000001.jpg');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/cover-fetch.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/sync/covers"`.

- [ ] **Step 3: Implement** — create `lib/sync/covers.ts`:

```ts
// Cover images: pick the right CDN URL, fetch it safely, decide when to (re)try. Signed CDN URLs are never logged,
// stored or put into results/errors. SSRF rules (spec §4): https only, Instagram CDN hosts only (re-checked after every
// redirect, which is followed by hand), 10 s timeout, max 5 MB, JPEG/PNG/WebP only (never SVG: it can carry script).
import type { MediaDetails } from '@/lib/instagram/parse';

export const COVERS_BUCKET = 'covers';
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_TIMEOUT_MS = 10_000;
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type CoverType = (typeof COVER_TYPES)[number];
const MAX_REDIRECTS = 3;
const CDN_SUFFIXES = ['fbcdn.net', 'cdninstagram.com'];

/** Storage key inside the bucket. Both parts are ours (uuid, numeric media id), never client input. */
export const coverPath = (accountId: string, mediaId: string) => `${accountId}/${mediaId}.jpg`;

/** https on the default port, no credentials, host = an Instagram CDN domain or a subdomain of one. */
export function isCdnUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port !== '' && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return CDN_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Thumbnail for videos/Reels, the image itself for photos, the first child for carousels. null = none offered. */
export function coverUrl(d: MediaDetails | undefined): string | null {
  if (!d) return null;
  const pick = (type: string | null, mediaUrl: string | null, thumb: string | null) => (type === 'VIDEO' ? thumb : (mediaUrl ?? thumb));
  const first = d.children?.[0];
  if (first) return pick(first.mediaType, first.mediaUrl, first.thumbnailUrl);
  return pick(d.mediaType, d.mediaUrl, d.thumbnailUrl);
}

export type FetchImageResult = { ok: true; bytes: Uint8Array; contentType: CoverType } | { ok: false; reason: 'blocked' | 'http' | 'type' | 'too_large' | 'network' };

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** GET one image under the rules above. Never throws; the result never contains the URL. */
export async function fetchImage(url: string, fetchFn: typeof fetch = fetch): Promise<FetchImageResult> {
  const signal = AbortSignal.timeout(COVER_TIMEOUT_MS);
  const drop = (res: Response) => res.body?.cancel().catch(() => {});
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      if (!isCdnUrl(current)) return { ok: false, reason: 'blocked' };
      const res = await fetchFn(current, { redirect: 'manual', signal, headers: { accept: COVER_TYPES.join(',') } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await drop(res);
        if (!location || hop >= MAX_REDIRECTS) return { ok: false, reason: 'blocked' };
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        await drop(res);
        return { ok: false, reason: 'http' };
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!(COVER_TYPES as readonly string[]).includes(type)) {
        await drop(res);
        return { ok: false, reason: 'type' };
      }
      if (Number(res.headers.get('content-length')) > COVER_MAX_BYTES) {
        await drop(res);
        return { ok: false, reason: 'too_large' };
      }
      const bytes = await readCapped(res, COVER_MAX_BYTES);
      if (!bytes) return { ok: false, reason: 'too_large' };
      if (bytes.byteLength === 0) return { ok: false, reason: 'http' };
      return { ok: true, bytes, contentType: type as CoverType };
    }
  } catch {
    return { ok: false, reason: 'network' }; // timeout, DNS, reset, bad redirect URL
  }
}

export type CoverStatus = 'pending' | 'ok' | 'unavailable' | 'failed';
export interface CoverRef {
  id: string;
  kind: string;
  postedAt: string;
  status: CoverStatus;
  attempts: number;
  triedAt: string | null;
}

/** After this many failed attempts a cover is given up on ('unavailable': the UI shows a type placeholder). */
export const COVER_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 30 * 60_000;

/** Back-off before attempt n+1 after n failures: 30, 60, 120, 240 min. */
export const coverRetryMs = (attempts: number) => RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);

/** Status after one more failed attempt. */
export const afterFailure = (attempts: number): { status: 'failed' | 'unavailable'; attempts: number } => ({ status: attempts + 1 >= COVER_MAX_ATTEMPTS ? 'unavailable' : 'failed', attempts: attempts + 1 });

/** Post covers to try now, newest first: never tried, or failed and its back-off has passed. */
export function pickCoverDue(refs: CoverRef[], now: Date, max: number): CoverRef[] {
  const t = now.getTime();
  return refs
    .filter((r) => r.status === 'pending' || (r.status === 'failed' && (!r.triedAt || t - Date.parse(r.triedAt) >= coverRetryMs(r.attempts))))
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
    .slice(0, max);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/cover-fetch.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/covers.ts tests/cover-fetch.test.ts
git commit -m "feat(sync): safe cover fetch (CDN allowlist, manual redirects, 5 MB cap, image types only, timeout) + retry policy" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Cover persistence + capture (store, `mediaCover`, Story covers on first sight)

**Files:**
- Modify: `lib/sync/covers.ts` (`captureCover`)
- Modify: `lib/instagram/data.ts` (`mediaCover`)
- Modify: `lib/sync/store.ts` (`coverRefs`, `markCover`, `uploadCover`, `expireStoryCovers`)
- Modify: `lib/sync/run-account.ts` (`RunContext.cdnFetch`, `captureStoryCovers` in the Stories job)
- Modify: `tests/fixtures/sync-fakes.ts` (`mediaCover`, cover methods, `covers` + `uploads` logs)
- Test: `tests/sync-covers-capture.test.ts` (new)

**Interfaces:**
- Consumes: `fetchImage`, `coverUrl`, `coverPath`, `afterFailure`, `COVERS_BUCKET`, `CoverRef`, `CoverStatus` (Task 9); `COVER_FIELDS`, `parseMediaDetails` (Task 8).
- Produces: `captureCover(store, accountId, ref: { id; attempts }, url, nowIso, fetchFn?): Promise<boolean>`; `IgData.mediaCover(token, mediaId): Promise<MediaDetails>`; `SyncStore.coverRefs(accountId, { ids?; limit }): Promise<CoverRef[]>`, `markCover(mediaId, { status; attempts; triedAt; path? })`, `uploadCover(path, bytes, contentType)`, `expireStoryCovers(accountId, nowIso)`; `RunContext.cdnFetch?: typeof fetch` (Task 11 passes it from the tick). Fake store: `covers: Map<id, {status, attempts, triedAt, path?}>`, `uploads: {path, bytes, contentType}[]`.

Story flow inside the Stories job: core snapshots → `markCaptured` → `captureStoryCovers` (every live Story whose cover is pending/failed, URL from the listing, retried on every pass while live up to 5 attempts; expired ones → `unavailable`) → Story extras. The whole cover step is wrapped: a Storage or database failure there never changes the job outcome. Object key `{account_id}/{media_id}.jpg`, `upsert: false` (an existing object counts as stored, so a lost status write is harmless).

- [ ] **Step 1: Write the failing test** — create `tests/sync-covers-capture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { igData } from '@/lib/instagram/data';
import type { MediaDetails } from '@/lib/instagram/parse';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const ACC = 'a1';
const URL1 = 'https://scontent-sin6-1.cdninstagram.com/v/story1.jpg?oe=1&_nc_sig=SECRET';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
const details = (o: Partial<MediaDetails> = {}): MediaDetails => ({ mediaType: 'IMAGE', productType: 'STORY', likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: URL1, thumbnailUrl: null, childrenCount: null, children: null, ...o });
const story = (id: string, d?: MediaDetails, ageMin = 45) => ({ id, kind: 'STORY' as const, caption: null, permalink: null, postedAt: new Date(NOW.getTime() - ageMin * 60_000).toISOString(), details: d });

function ctx(cdn: (url: string) => Response | Promise<Response>) {
  const ig = fakeIg();
  const mem = memoryStore();
  const acc = account({ id: ACC });
  const seen: string[] = [];
  const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), cdn(String(input)))) as typeof fetch;
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState(ACC), tz: 'UTC', now: NOW, deadline: 1, clock: () => 0, cdnFetch };
  return { c, ig, mem, seen };
}
const jpeg = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });

describe('Story covers on first sight', () => {
  it('copies a live Story cover into {account}/{media}.jpg once; the next pass does not fetch it again', async () => {
    const { c, ig, mem, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('s1', details())]);
    const { result } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(mem.uploads).toEqual([{ path: 'a1/s1.jpg', bytes: JPEG.byteLength, contentType: 'image/jpeg' }]);
    expect(mem.covers.get('s1')).toEqual({ status: 'ok', attempts: 1, triedAt: NOW.toISOString(), path: 'a1/s1.jpg' });
    await runAccount(c, ['stories']);
    expect(seen).toHaveLength(1);
  });

  it('video Story: the thumbnail is copied, never the video', async () => {
    const { c, ig, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('v1', details({ mediaType: 'VIDEO', mediaUrl: 'https://scontent.cdninstagram.com/v.mp4', thumbnailUrl: URL1 }))]);
    await runAccount(c, ['stories']);
    expect(seen).toEqual([URL1]);
  });

  it('expired link or a redirect to a foreign host: a failed attempt, the Story snapshot is unaffected', async () => {
    for (const cdn of [() => new Response('gone', { status: 403 }), () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })]) {
      const { c, ig, mem, seen } = ctx(cdn);
      ig.listStories.mockResolvedValue([story('s1', details())]);
      const { result } = await runAccount(c, ['stories']);
      expect(result.outcome).toBe('ok');
      expect(mem.metrics).toHaveLength(1);
      expect(mem.covers.get('s1')).toMatchObject({ status: 'failed', attempts: 1 });
      expect(seen.some((u) => u.includes('evil.example'))).toBe(false);
    }
  });

  it('retried on every live pass, then given up after 5 attempts', async () => {
    const { c, ig, mem } = ctx(() => new Response('x', { status: 500 }));
    ig.listStories.mockResolvedValue([story('s1', details())]);
    for (let i = 0; i < 6; i++) await runAccount(c, ['stories']);
    expect(mem.covers.get('s1')).toMatchObject({ status: 'unavailable', attempts: 5 });
  });

  it('no URL offered (Story URL fields unsupported): no attempt counted; once expired it becomes unavailable', async () => {
    const { c, ig, mem, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('s1')]);
    await runAccount(c, ['stories']);
    expect(seen).toHaveLength(0);
    expect(mem.covers.get('s1')).toBeUndefined();
    const later: RunContext = { ...c, now: new Date(NOW.getTime() + 25 * 3_600_000) };
    ig.listStories.mockResolvedValue([]);
    await runAccount(later, ['stories']);
    expect(mem.covers.get('s1')).toMatchObject({ status: 'unavailable' });
  });

  it('Storage down: a failed attempt; database down: the Story capture still succeeds', async () => {
    const storage = ctx(jpeg);
    storage.ig.listStories.mockResolvedValue([story('s1', details())]);
    storage.mem.store.uploadCover = async () => {
      throw new Error('sync store: uploadCover failed');
    };
    expect((await runAccount(storage.c, ['stories'])).result.outcome).toBe('ok');
    expect(storage.mem.covers.get('s1')).toMatchObject({ status: 'failed', attempts: 1 });

    const db = ctx(jpeg);
    db.ig.listStories.mockResolvedValue([story('s1', details())]);
    db.mem.store.coverRefs = async () => {
      throw new Error('sync store: coverRefs failed');
    };
    const { result } = await runAccount(db.c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(db.mem.metrics).toHaveLength(1);
  });
});

describe('cover persistence', () => {
  type Call = { table: string; op: string; row?: unknown; filters: unknown[][] };
  function recorder(storageError: unknown = null, data: unknown = []) {
    const calls: Call[] = [];
    const uploads: unknown[][] = [];
    const db = {
      from(table: string) {
        const c: Call = { table, op: 'select', filters: [] };
        calls.push(c);
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.update = (row: unknown) => ((c.op = 'update'), (c.row = row), chain);
        for (const f of ['eq', 'in', 'is', 'neq', 'lt', 'order', 'limit']) chain[f] = (...a: unknown[]) => (c.filters.push([f, ...a]), chain);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
        return chain;
      },
      storage: { from: (bucket: string) => ({ upload: async (...a: unknown[]) => (uploads.push([bucket, ...a]), { data: null, error: storageError }) }) },
    };
    return { db: db as never, calls, uploads };
  }

  it('coverRefs: pending/failed, not gone; Stories by id, otherwise feed + Reels; newest first, limited', async () => {
    const r = recorder(null, [{ id: 'p1', media_type: 'IMAGE', posted_at: 'x', cover_status: 'failed', cover_attempts: 2, cover_tried_at: 'y' }]);
    const s = supabaseSyncStore(r.db);
    expect(await s.coverRefs(ACC, { limit: 25 })).toEqual([{ id: 'p1', kind: 'IMAGE', postedAt: 'x', status: 'failed', attempts: 2, triedAt: 'y' }]);
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', ACC], ['in', 'cover_status', ['pending', 'failed']], ['is', 'gone_at', null], ['neq', 'media_type', 'STORY'], ['order', 'posted_at', { ascending: false }], ['limit', 25]]);
    await s.coverRefs(ACC, { ids: ['s1'], limit: 1 });
    expect(r.calls[1].filters).toContainEqual(['in', 'id', ['s1']]);
    expect(r.calls[1].filters).not.toContainEqual(['neq', 'media_type', 'STORY']);
  });

  it('markCover: ok stores path + captured time; a failure only the attempt', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.markCover('p1', { status: 'ok', attempts: 1, triedAt: 'T', path: 'a1/p1.jpg' });
    await s.markCover('p2', { status: 'failed', attempts: 2, triedAt: 'T' });
    expect(r.calls[0].row).toEqual({ cover_status: 'ok', cover_attempts: 1, cover_tried_at: 'T', cover_path: 'a1/p1.jpg', cover_captured_at: 'T' });
    expect(r.calls[1].row).toEqual({ cover_status: 'failed', cover_attempts: 2, cover_tried_at: 'T' });
  });

  it('uploadCover: private bucket, never overwrites, an existing object counts as stored, anything else throws', async () => {
    const ok = recorder();
    await supabaseSyncStore(ok.db).uploadCover('a1/p1.jpg', JPEG, 'image/jpeg');
    expect(ok.uploads[0]).toEqual(['covers', 'a1/p1.jpg', JPEG, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }]);
    await expect(supabaseSyncStore(recorder({ statusCode: '409', message: 'The resource already exists' }).db).uploadCover('p', JPEG, 'image/jpeg')).resolves.toBeUndefined();
    await expect(supabaseSyncStore(recorder({ statusCode: '500', message: 'boom' }).db).uploadCover('p', JPEG, 'image/jpeg')).rejects.toThrow('sync store: uploadCover failed');
  });

  it('expireStoryCovers only touches unfinished Stories past their expiry', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).expireStoryCovers(ACC, NOW.toISOString());
    expect(r.calls[0]).toMatchObject({ op: 'update', row: { cover_status: 'unavailable' } });
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', ACC], ['eq', 'media_type', 'STORY'], ['in', 'cover_status', ['pending', 'failed']], ['lt', 'expires_at', NOW.toISOString()]]);
  });

  it('mediaCover asks the cover fields of one media item', async () => {
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), new Response(JSON.stringify({ media_type: 'VIDEO', thumbnail_url: URL1 })))) as typeof fetch;
    expect(await igData('v25.0', fn).mediaCover('t', 'm1')).toMatchObject({ mediaType: 'VIDEO', thumbnailUrl: URL1 });
    expect(seen[0].pathname).toBe('/v25.0/m1');
    expect(seen[0].searchParams.get('fields')).toBe('media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-covers-capture.test.ts`
Expected: FAIL — no uploads recorded / `coverRefs is not a function`.

- [ ] **Step 3: Implement**

In `lib/sync/covers.ts` replace:

```ts
import type { MediaDetails } from '@/lib/instagram/parse';
```

with:

```ts
import type { MediaDetails } from '@/lib/instagram/parse';
import type { SyncStore } from '@/lib/sync/store';
```

In `lib/sync/covers.ts` replace:

```ts
/** Post covers to try now, newest first: never tried, or failed and its back-off has passed. */
```

with:

```ts
/**
 * One attempt: fetch the image, upload it as {account}/{media}.jpg (never overwriting), record the outcome. A fetch
 * or upload failure counts as a failed attempt (back-off, then 'unavailable'); only the status write itself can throw.
 */
export async function captureCover(store: SyncStore, accountId: string, ref: Pick<CoverRef, 'id' | 'attempts'>, url: string, nowIso: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const img = await fetchImage(url, fetchFn);
  if (img.ok) {
    const path = coverPath(accountId, ref.id);
    try {
      await store.uploadCover(path, img.bytes, img.contentType);
      await store.markCover(ref.id, { status: 'ok', attempts: ref.attempts + 1, triedAt: nowIso, path });
      return true;
    } catch {
      // Storage hiccup: counted as a failed attempt below
    }
  }
  await store.markCover(ref.id, { ...afterFailure(ref.attempts), triedAt: nowIso });
  return false;
}

/** Post covers to try now, newest first: never tried, or failed and its back-off has passed. */
```

In `lib/instagram/data.ts` replace:

```ts
import { mediaDetailsById, parseBreakdown, parseMediaPage, parseOnlineFollowers, parseTotals, type IgMediaItem } from '@/lib/instagram/parse';
```

with:

```ts
import { mediaDetailsById, parseBreakdown, parseMediaDetails, parseMediaPage, parseOnlineFollowers, parseTotals, type IgMediaItem, type MediaDetails } from '@/lib/instagram/parse';
```

In `lib/instagram/data.ts` replace:

```ts
    refresh: (token: string) => refreshLongLived(token, fetchFn),
```

with:

```ts
    /** Fresh cover URLs for one media item (they expire within days, so they are asked right before the copy). */
    async mediaCover(token: string, mediaId: string): Promise<MediaDetails> {
      return parseMediaDetails(await get(mediaId, { fields: M.COVER_FIELDS }, token));
    },

    refresh: (token: string) => refreshLongLived(token, fetchFn),
```

In `lib/sync/store.ts` replace:

```ts
import { parseCapabilities, type Capabilities } from '@/lib/sync/capabilities';
```

with:

```ts
import { parseCapabilities, type Capabilities } from '@/lib/sync/capabilities';
import { COVERS_BUCKET, type CoverRef, type CoverStatus } from '@/lib/sync/covers';
```

In `lib/sync/store.ts` replace:

```ts
  upsertAudience(accountId: string, day: string, kind: AudienceKind, data: Record<string, number>): Promise<void>;
```

with:

```ts
  upsertAudience(accountId: string, day: string, kind: AudienceKind, data: Record<string, number>): Promise<void>;
  /** Media whose cover is still to do (pending/failed, not gone), newest first. ids given: only those (Stories); else feed + Reels. */
  coverRefs(accountId: string, opts: { ids?: string[]; limit: number }): Promise<CoverRef[]>;
  markCover(mediaId: string, r: { status: CoverStatus; attempts: number; triedAt: string; path?: string }): Promise<void>;
  /** Private bucket "covers", never overwriting; an object that already exists counts as stored. */
  uploadCover(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Stories past expires_at whose cover never landed: 'unavailable' (the CDN link died with them). */
  expireStoryCovers(accountId: string, nowIso: string): Promise<void>;
```

In `lib/sync/store.ts` replace:

```ts
    async upsertOnlineFollowers(accountId, day, hourly) {
```

with:

```ts
    async coverRefs(accountId, opts) {
      let q = db
        .from('media')
        .select('id,media_type,posted_at,cover_status,cover_attempts,cover_tried_at')
        .eq('account_id', accountId)
        .in('cover_status', ['pending', 'failed'])
        .is('gone_at', null);
      q = opts.ids ? q.in('id', opts.ids) : q.neq('media_type', 'STORY');
      const { data, error } = await q.order('posted_at', { ascending: false }).limit(opts.limit);
      if (error) fail('coverRefs');
      return ((data ?? []) as Row[]).map((r) => ({
        id: r.id as string,
        kind: r.media_type as string,
        postedAt: r.posted_at as string,
        status: r.cover_status as CoverStatus,
        attempts: typeof r.cover_attempts === 'number' ? r.cover_attempts : 0,
        triedAt: (r.cover_tried_at as string | null) ?? null,
      }));
    },
    async markCover(mediaId, r) {
      const row: Row = { cover_status: r.status, cover_attempts: r.attempts, cover_tried_at: r.triedAt };
      if (r.status === 'ok') Object.assign(row, { cover_path: r.path ?? null, cover_captured_at: r.triedAt });
      check('markCover')(await db.from('media').update(row).eq('id', mediaId));
    },
    async uploadCover(path, bytes, contentType) {
      const { error } = await db.storage.from(COVERS_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
      if (!error) return;
      const e = error as { statusCode?: string; status?: number; code?: string };
      if (e.statusCode === '409' || e.status === 409 || e.code === 'ResourceAlreadyExists' || e.code === 'Duplicate') return;
      fail('uploadCover');
    },
    async expireStoryCovers(accountId, nowIso) {
      check('expireStoryCovers')(
        await db.from('media').update({ cover_status: 'unavailable' }).eq('account_id', accountId).eq('media_type', 'STORY').in('cover_status', ['pending', 'failed']).lt('expires_at', nowIso),
      );
    },
    async upsertOnlineFollowers(accountId, day, hourly) {
```

In `lib/sync/run-account.ts` replace:

```ts
  /** Live progress (only while the account is importing or on a manual run); best-effort, never throws. */
  progress?: ProgressSink;
}
```

with:

```ts
  /** Live progress (only while the account is importing or on a manual run); best-effort, never throws. */
  progress?: ProgressSink;
  /** fetch for the Instagram CDN (cover images); default: global fetch. */
  cdnFetch?: typeof fetch;
}
```

In `lib/sync/run-account.ts` replace:

```ts
import { EXTRA_CALLS_PER_RUN, fetchExtras, scopeOf } from '@/lib/sync/extras';
```

with:

```ts
import { captureCover, coverUrl } from '@/lib/sync/covers';
import { EXTRA_CALLS_PER_RUN, fetchExtras, scopeOf } from '@/lib/sync/extras';
```

In `lib/sync/run-account.ts` replace:

```ts
import { DEMOGRAPHIC_BREAKDOWNS, type AudienceKind } from '@/lib/instagram/metrics';
```

with:

```ts
import { DEMOGRAPHIC_BREAKDOWNS, type AudienceKind } from '@/lib/instagram/metrics';
import type { IgMediaItem } from '@/lib/instagram/parse';
```

In `lib/sync/run-account.ts` replace:

```ts
/**
 * Live Stories with their image URLs
```

with:

```ts
/**
 * Story covers on FIRST SIGHT (the CDN link dies with the Story): every live Story whose cover is not stored yet, with
 * the URL from the listing; retried on every pass while it is live (up to COVER_MAX_ATTEMPTS), then expired ones are
 * marked unavailable. Entirely best-effort: nothing here can cost the Story capture.
 */
async function captureStoryCovers(c: RunContext, items: IgMediaItem[]): Promise<void> {
  try {
    if (items.length > 0) {
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const ref of await c.store.coverRefs(c.account.id, { ids: [...byId.keys()], limit: items.length })) {
        if (outOfTime(c)) break;
        const url = coverUrl(byId.get(ref.id)?.details);
        if (url) await captureCover(c.store, c.account.id, ref, url, c.now.toISOString(), c.cdnFetch);
        // no URL (fields not offered on Stories, or none for this Story): no attempt counted; expiry ends it
      }
    }
    await c.store.expireStoryCovers(c.account.id, c.now.toISOString());
  } catch {
    // covers are optional; the Story snapshot is already stored
  }
}

/**
 * Live Stories with their image URLs
```

In `lib/sync/run-account.ts` replace:

```ts
  const extrasDue = items.filter((s) => captured.includes(s.id) && storyExtrasDue(s.postedAt, c.now));
```

with:

```ts
  await captureStoryCovers(c, items);
  const extrasDue = items.filter((s) => captured.includes(s.id) && storyExtrasDue(s.postedAt, c.now));
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
import { emptyState, type SyncState } from '@/lib/sync/schedule';
```

with:

```ts
import type { CoverStatus } from '@/lib/sync/covers';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  const children: { mediaId: string; position: number; mediaType: string | null }[] = [];
```

with:

```ts
  const children: { mediaId: string; position: number; mediaType: string | null }[] = [];
  /** cover state per media id; a media item without an entry is 'pending' with 0 attempts (the column default) */
  const covers = new Map<string, { status: CoverStatus; attempts: number; triedAt: string | null; path?: string }>();
  const uploads: { path: string; bytes: number; contentType: string }[] = [];
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    upsertAudience: async (accountId, _day, kind) => void audience.push({ accountId, kind }),
```

with:

```ts
    upsertAudience: async (accountId, _day, kind) => void audience.push({ accountId, kind }),
    coverRefs: async (accountId, opts) =>
      [...media.values()]
        .filter((m) => m.accountId === accountId && !m.gone && (opts.ids ? opts.ids.includes(m.id) : m.kind !== 'STORY'))
        .map((m) => ({ id: m.id, kind: m.kind, postedAt: m.postedAt, status: 'pending' as CoverStatus, attempts: 0, triedAt: null, ...covers.get(m.id) }))
        .filter((r) => r.status === 'pending' || r.status === 'failed')
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
        .slice(0, opts.limit),
    markCover: async (id, r) => void covers.set(id, r),
    uploadCover: async (path, bytes, contentType) => void uploads.push({ path, bytes: bytes.byteLength, contentType }),
    expireStoryCovers: async (accountId, nowIso) => {
      for (const m of media.values()) {
        const st = covers.get(m.id)?.status ?? 'pending';
        if (m.accountId === accountId && m.kind === 'STORY' && (st === 'pending' || st === 'failed') && Date.parse(m.postedAt) + 86_400_000 < Date.parse(nowIso)) covers.set(m.id, { status: 'unavailable', attempts: covers.get(m.id)?.attempts ?? 0, triedAt: null });
      }
    },
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  return { store, states, media, children,
```

with:

```ts
  return { store, states, media, children, covers, uploads,
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    storyInsights: vi.fn<IgData['storyInsights']>(async () => METRICS),
```

with:

```ts
    storyInsights: vi.fn<IgData['storyInsights']>(async () => METRICS),
    mediaCover: vi.fn<IgData['mediaCover']>(async () => ({ mediaType: 'IMAGE', productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null })),
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-covers-capture.test.ts tests/cover-fetch.test.ts tests/sync-run-account.test.ts tests/sync-story-extras.test.ts tests/capture-media-fields.test.ts tests/sync-lanes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/covers.ts lib/instagram/data.ts lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-covers-capture.test.ts
git commit -m "feat(sync): copy Story covers into private Storage on first sight (retry while live, then unavailable)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `covers` job in lane 2 (schedule, runner, tick lane-2 selection)

**Files:**
- Modify: `lib/sync/schedule.ts` (`COVERS_EVERY_MIN`, job `covers`, `LANE2_ONLY`, lane-1 filter)
- Modify: `lib/sync/run-account.ts` (`COVERS_PER_RUN`, `covers` job, `optional` wrapper)
- Modify: `lib/sync/tick.ts` (`TickDeps.cdnFetch`, schedule input helper, lane 2 also runs accounts with optional work due)
- Modify: `tests/sync-schedule.test.ts`, `tests/sync-onboarding-schedule.test.ts`, `tests/sync-tick.test.ts` (their "everything fresh" states gain `covers` in `lastRun`, otherwise the new hourly job is correctly due)
- Test: `tests/sync-covers-job.test.ts` (new)

**Interfaces:**
- Consumes: `pickCoverDue`, `captureCover`, `coverUrl`, `afterFailure` (Tasks 9–10); `IgData.mediaCover`, `SyncStore.coverRefs/markCover/markGone` (Task 10).
- Produces: `JOBS` = `[…, 'backfill', 'covers', 'tokenRefresh']`; `LANE2_ONLY: readonly JobKind[] = ['covers']` (Task 13 appends `'comments'`); `COVERS_EVERY_MIN = 60`; `COVERS_PER_RUN = 25` (exported from `run-account.ts`); private `optional(job)` wrapper in `run-account.ts` (Task 13 reuses it); `TickDeps.cdnFetch?: typeof fetch`; inside `runTick` a helper `input(account, state): ScheduleInput` (Task 13 extends it).

Rules: `covers` is due hourly only once the history import is finished (`!isBackfilling`, so a new account's Overview numbers come first — spec order "…older posts, covers, comments"), never in lane 1; lane 2 now also visits accounts whose only due work is optional (covers, later comments). The job reports the reserved progress stage `covers` (its activity label `sync.activity.covers` already exists in en/zh-CN; the stage is not part of the import checklist/percentage because import completion does not wait for covers). Any non-fatal failure inside the job ends it quietly (`optional`): covers never mark an account as failing.

- [ ] **Step 1: Write the failing test** — create `tests/sync-covers-job.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MediaDetails } from '@/lib/instagram/parse';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { COVERS_PER_RUN, runAccount, type RunContext } from '@/lib/sync/run-account';
import { dueJobs, emptyState, type SyncState } from '@/lib/sync/schedule';
import { runTick } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const url = (id: string) => `https://scontent.cdninstagram.com/v/${id}.jpg?_nc_sig=SECRET`;
const det = (o: Partial<MediaDetails>): MediaDetails => ({ mediaType: 'IMAGE', productType: 'FEED', likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null, ...o });
/** Import finished, every regular job fresh: only covers can be due. */
const COMPLETE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: minsAgo(600), stories: minsAgo(5), daily: minsAgo(60), mediaList: minsAgo(5), mediaMetrics: minsAgo(5), audience: minsAgo(60) } };

function ctx(n: number, o: { deadline?: number; state?: Partial<SyncState> } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, accountId: 'a1', postedAt: minsAgo(60 * (i + 1)), lastMetricsAt: minsAgo(5) })) });
  ig.mediaCover.mockImplementation(async (_t: string, id: string) => det({ mediaUrl: url(id) }));
  const seen: string[] = [];
  const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))) as typeof fetch;
  let now = 0;
  const acc = account({ id: 'a1' });
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...COMPLETE, ...o.state }, tz: 'UTC', now: NOW, deadline: o.deadline ?? 1e9, clock: () => (now += 10), cdnFetch };
  return { c, ig, mem, seen };
}

describe('covers job scheduling', () => {
  const input = (s: Partial<SyncState>) => ({ status: 'active' as const, tokenExpiresAt: null, state: { ...emptyState('a1'), ...s } });
  it('due hourly once the history import is through; never while importing; never in lane 1', () => {
    expect(dueJobs(input(COMPLETE), NOW, 'UTC')).toContain('covers');
    expect(dueJobs(input({ ...COMPLETE, lastRun: { ...COMPLETE.lastRun, covers: minsAgo(20) } }), NOW, 'UTC')).not.toContain('covers');
    expect(dueJobs(input({}), NOW, 'UTC')).not.toContain('covers'); // new account: Overview numbers first
    expect(dueJobs(input(COMPLETE), NOW, 'UTC', { lane: 'regular' })).not.toContain('covers');
  });
});

describe('covers job', () => {
  it('newest first, a fresh URL per post, at most COVERS_PER_RUN per run', async () => {
    const { c, ig, mem } = ctx(30);
    const { result } = await runAccount(c, ['covers']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['covers'] });
    expect(ig.mediaCover).toHaveBeenCalledTimes(COVERS_PER_RUN);
    expect(ig.mediaCover.mock.calls[0][1]).toBe('p00');
    expect(mem.uploads).toHaveLength(COVERS_PER_RUN);
    expect(mem.uploads[0].path).toBe('a1/p00.jpg');
  });

  it('gone on Instagram -> marked gone; no image offered -> unavailable; a transient error -> back-off', async () => {
    const { c, ig, mem } = ctx(3);
    ig.mediaCover.mockImplementation(async (_t: string, id: string) => {
      if (id === 'p00') throw new InstagramApiError('data', 400, 100, 33);
      if (id === 'p01') return det({ mediaUrl: null }); // copyrighted media
      throw new InstagramApiError('data', 500, 2);
    });
    const { result } = await runAccount(c, ['covers']);
    expect(result.outcome).toBe('ok');
    expect(mem.media.get('p00')!.gone).toBe(true);
    expect(mem.covers.get('p01')).toMatchObject({ status: 'unavailable', attempts: 1 });
    expect(mem.covers.get('p02')).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('a rate limit still stops it (back-off); a database failure never marks the account as failing', async () => {
    const limited = ctx(2);
    limited.ig.mediaCover.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    expect((await runAccount(limited.c, ['covers'])).result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    const db = ctx(2);
    db.mem.store.coverRefs = async () => {
      throw new Error('sync store: coverRefs failed');
    };
    expect((await runAccount(db.c, ['covers'])).result).toMatchObject({ outcome: 'ok' });
  });

  it('out of time: stops between posts and stays due (resumes next pass)', async () => {
    const { c, mem } = ctx(10, { deadline: 45 });
    const { result } = await runAccount(c, ['covers']);
    expect(result.outcome).toBe('partial');
    expect(mem.uploads.length).toBeGreaterThan(0);
    expect(mem.uploads.length).toBeLessThan(10);
  });
});

describe('covers in the tick', () => {
  it('a complete account gets its covers in lane 2 (never lane 1), with the tick-supplied CDN fetch', async () => {
    const ig = fakeIg();
    ig.mediaCover.mockImplementation(async (_t: string, id: string) => det({ mediaUrl: url(id) }));
    const mem = memoryStore({ tokens: { a1: 'tok' }, media: [{ id: 'p1', accountId: 'a1', postedAt: minsAgo(90), lastMetricsAt: minsAgo(5) }] });
    mem.states.set('a1', { ...emptyState('a1'), ...COMPLETE, leaseId: null } as SyncState & { leaseId: null });
    const seen: string[] = [];
    const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))) as typeof fetch;
    const s = await runTick({ store: mem.store, accounts: fakeAccounts([account({ id: 'a1' })]).accounts, ig, clock: () => NOW.getTime(), cdnFetch }, { trigger: 'cron' });
    expect(s.accounts[0].jobs.at(-1)).toBe('covers');
    expect(s.accounts[0].jobs.filter((j) => j === 'covers')).toHaveLength(1);
    expect(seen).toEqual([url('p1')]);
    expect(mem.covers.get('p1')).toMatchObject({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-covers-job.test.ts`
Expected: FAIL — `COVERS_PER_RUN` is not exported / `covers` is not a job.

- [ ] **Step 3: Implement**

In `lib/sync/schedule.ts` replace:

```ts
export const MEDIA_LIST_EVERY_MIN = 60;
```

with:

```ts
export const MEDIA_LIST_EVERY_MIN = 60;
export const COVERS_EVERY_MIN = 60; // new posts appear with the hourly media list; their CDN links live ~1.4–4.5 days
```

In `lib/sync/schedule.ts` replace:

```ts
 * history (backfill: days 8–90 newest first, then older posts' metrics; later plans append covers and comments there).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];
```

with:

```ts
 * history (backfill: days 8–90 newest first, then older posts' metrics) -> post covers (lane 2 only, once the history
 * import is through).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'covers', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

/** Optional catch-up work that only lane 2 runs (never inside lane 1's small per-account slice). */
export const LANE2_ONLY: readonly JobKind[] = ['covers'];
```

In `lib/sync/schedule.ts` replace:

```ts
  if (isBackfilling(s)) due.add('backfill');
```

with:

```ts
  if (isBackfilling(s)) due.add('backfill');
  else if (atLeast(s.lastRun.covers, COVERS_EVERY_MIN * MIN)) due.add('covers'); // after the import: Overview numbers first
```

In `lib/sync/schedule.ts` replace:

```ts
  // lane 1 never imports history; a new account gets only its time-critical jobs there, its onboarding runs in lane 2
  return jobs.filter((j) => j !== 'backfill' && (!firstWeek || j === 'stories' || j === 'tokenRefresh'));
```

with:

```ts
  // lane 1 never imports history or runs optional catch-up; a new account gets only its time-critical jobs there
  return jobs.filter((j) => j !== 'backfill' && !LANE2_ONLY.includes(j) && (!firstWeek || j === 'stories' || j === 'tokenRefresh'));
```

In `lib/sync/run-account.ts` replace:

```ts
import { captureCover, coverUrl } from '@/lib/sync/covers';
```

with:

```ts
import { afterFailure, captureCover, coverUrl, pickCoverDue } from '@/lib/sync/covers';
```

In `lib/sync/run-account.ts` replace:

```ts
/** Demographics + online followers.
```

with:

```ts
/** Post covers copied per run (one Instagram call + one CDN download each, ~0.5 s). */
export const COVERS_PER_RUN = 25;
/** Unfinished covers looked at per run (newest first); the back-off filter then picks COVERS_PER_RUN of them. */
const COVER_SCAN = 200; // ponytail: a block of >200 newer covers all waiting on back-off hides older pending ones until it clears

/**
 * Feed/Reels covers (lane 2, after the history import), newest first. Fresh URLs per item (they expire within days):
 * gone on Instagram -> marked gone; no image offered (copyrighted media) -> unavailable; fetch/upload problems ->
 * back-off, then unavailable. Out of time -> resumes next pass. Reports the reserved progress stage "covers".
 */
const covers: Job = async (c) => {
  const nowIso = c.now.toISOString();
  const due = pickCoverDue(await c.store.coverRefs(c.account.id, { limit: COVER_SCAN }), c.now, COVERS_PER_RUN);
  for (const [i, ref] of due.entries()) {
    if (outOfTime(c)) return { done: false };
    await c.progress?.report('covers', i, due.length);
    let details;
    try {
      details = await c.ig.mediaCover(c.token, ref.id);
    } catch (e) {
      if (fatal(e)) throw e;
      if (classifyIgError(e) === 'gone') await c.store.markGone(ref.id, nowIso);
      else await c.store.markCover(ref.id, { ...afterFailure(ref.attempts), triedAt: nowIso });
      continue;
    }
    const url = coverUrl(details);
    if (url) await captureCover(c.store, c.account.id, ref, url, nowIso, c.cdnFetch);
    else await c.store.markCover(ref.id, { status: 'unavailable', attempts: ref.attempts + 1, triedAt: nowIso });
  }
  return { done: true };
};

/**
 * Optional lane-2 work (covers, comments): only auth / rate-limit errors surface (needs_reconnect / back-off); any
 * other failure ends the job quietly — it is due again next time and must never mark the account as failing.
 */
const optional =
  (job: Job): Job =>
  async (c, p) => {
    try {
      return await job(c, p);
    } catch (e) {
      if (fatal(e)) throw e;
      return { done: true };
    }
  };

/** Demographics + online followers.
```

In `lib/sync/run-account.ts` replace:

```ts
const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, backfill, tokenRefresh };
```

with:

```ts
const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, backfill, covers: optional(covers), tokenRefresh };
```

In `lib/sync/tick.ts` replace:

```ts
import { byOldestAttempt, dueJobs, isBackfilling, type JobKind, type Lane, type SyncState } from '@/lib/sync/schedule';
```

with:

```ts
import { byOldestAttempt, dueJobs, isBackfilling, LANE2_ONLY, type JobKind, type Lane, type ScheduleInput, type SyncState } from '@/lib/sync/schedule';
```

In `lib/sync/tick.ts` replace:

```ts
  clock?: () => number;
  newId?: () => string;
}
```

with:

```ts
  clock?: () => number;
  newId?: () => string;
  cdnFetch?: typeof fetch; // cover downloads; default global fetch
}
```

In `lib/sync/tick.ts` replace:

```ts
  const ordered = [...active].sort((a, b) => byOldestAttempt(states.get(a.id)!, states.get(b.id)!));

```

with:

```ts
  const ordered = [...active].sort((a, b) => byOldestAttempt(states.get(a.id)!, states.get(b.id)!));
  const input = (a: StoredAccount, state: SyncState): ScheduleInput => ({ status: a.status, tokenExpiresAt: a.tokenExpiresAt, state });

```

In `lib/sync/tick.ts` replace:

```ts
    const plan = (s: SyncState) => dueJobs({ status: account.status, tokenExpiresAt: account.tokenExpiresAt, state: s }, now, tz, { manual, lane }).filter((j) => !skip.includes(j));
```

with:

```ts
    const plan = (s: SyncState) => dueJobs(input(account, s), now, tz, { manual, lane }).filter((j) => !skip.includes(j));
```

In `lib/sync/tick.ts` replace:

```ts
{ ig: deps.ig, store: deps.store, accounts: deps.accounts, account, token, state: fresh, tz, now, deadline: sliceEnd, clock, progress }
```

with:

```ts
{ ig: deps.ig, store: deps.store, accounts: deps.accounts, account, token, state: fresh, tz, now, deadline: sliceEnd, clock, progress, cdnFetch: deps.cdnFetch }
```

In `lib/sync/tick.ts` replace:

```ts
        return e.outcome === 'partial' || isBackfilling(states.get(a.id)!);
```

with:

```ts
        const s = states.get(a.id)!;
        const optionalDue = dueJobs(input(a, s), new Date(clock()), tz, { manual }).some((j) => LANE2_ONLY.includes(j)); // covers (+ comments)
        return e.outcome === 'partial' || isBackfilling(s) || optionalDue;
```

Test fixture updates (states that mean "every job ran recently"):

In `tests/sync-schedule.test.ts` replace:

```ts
  lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), mediaMetrics: minsAgo(10), audience: minsAgo(60) },
```

with:

```ts
  lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), mediaMetrics: minsAgo(10), audience: minsAgo(60), covers: minsAgo(10) },
```

In `tests/sync-onboarding-schedule.test.ts` replace:

```ts
    const legacy = st({ dailyDoneThrough: '2026-10-13', lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), audience: minsAgo(60) } });
```

with:

```ts
    const legacy = st({ dailyDoneThrough: '2026-10-13', lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), audience: minsAgo(60), covers: minsAgo(10) } });
```

In `tests/sync-tick.test.ts` replace:

```ts
    mem.states.set('a1', { ...emptyState('a1'), leaseId: null, dailyDoneThrough: '2026-10-13', lastRun: { stories: iso, daily: iso, mediaList: iso, audience: iso } });
```

with:

```ts
    mem.states.set('a1', { ...emptyState('a1'), leaseId: null, dailyDoneThrough: '2026-10-13', lastRun: { stories: iso, daily: iso, mediaList: iso, audience: iso, covers: iso } });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-covers-job.test.ts tests/sync-schedule.test.ts tests/sync-onboarding-schedule.test.ts tests/sync-tick.test.ts tests/sync-lanes.test.ts tests/sync-backfill.test.ts tests/cron-tick-chain.test.ts tests/connect-sync.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sync/schedule.ts lib/sync/run-account.ts lib/sync/tick.ts tests/sync-schedule.test.ts tests/sync-onboarding-schedule.test.ts tests/sync-tick.test.ts tests/sync-covers-job.test.ts
git commit -m "feat(sync): post/Reel cover backfill as a lane-2 job after the import (newest first, back-off, never fails the account)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Cover route `GET /api/media/[id]/cover` + Storage cleanup on permanent delete

**Files:**
- Create: `app/api/media/[id]/cover/route.ts`
- Modify: `lib/sync/store.ts` (`removeAccountCovers`)
- Modify: `app/(app)/accounts/actions.ts` (`deleteAccountAction` removes the objects after a successful delete)
- Test: `tests/cover-route.test.ts`, `tests/cover-delete.test.ts` (new)

**Interfaces:**
- Consumes: `assertOwner(h)`, `createServerSupabase({ responseHeaders })` (owner session, RLS), `createAdminSupabase()`; `COVERS_BUCKET`, `COVER_TYPES`, `coverPath` (Task 9).
- Produces: route `GET /api/media/{numeric id}/cover` → 200 image (private, 1-year immutable cache, `nosniff`) | 401 | 404 | 500 (fixed JSON bodies); `removeAccountCovers(db, accountId): Promise<number>` (best-effort, never throws). `MediaThumb` (Plan 12/13) will use `<img src="/api/media/{id}/cover">`.

Security notes: `assertOwner` first, its headers object `h` is passed to every `NextResponse` (401/404/500/200); the media row is read with the OWNER session (RLS), the stored path must equal `coverPath(row.account_id, id)` — so neither the request nor a tampered row can steer the Storage read elsewhere; content type comes from our own upload (allowlist re-checked, anything else served as JPEG); `lib/auth/route-policy.ts` is unchanged (the proxy sends signed-out visitors to `/login`). The service worker already never caches `/api/*`. Archive keeps covers; only the permanent delete removes them (rows go by FK cascade).

- [ ] **Step 1: Write the failing tests** — create `tests/cover-route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideRoute } from '@/lib/auth/route-policy';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const state = vi.hoisted(() => ({
  owner: true,
  row: null as Record<string, unknown> | null,
  readError: null as unknown,
  blob: null as Blob | null,
  downloads: [] as string[],
  queries: [] as unknown[][],
  order: [] as string[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    state.order.push('assertOwner');
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => {
    state.order.push('ownerSession');
    return {
      from: (t: string) => ({
        select: (cols: string) => ({ eq: (c: string, v: string) => ({ maybeSingle: async () => (state.queries.push([t, cols, c, v]), { data: state.row, error: state.readError }) }) }),
      }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    state.order.push('admin');
    return { storage: { from: (b: string) => ({ download: async (p: string) => (state.downloads.push(`${b}:${p}`), state.blob ? { data: state.blob, error: null } : { data: null, error: { message: 'Object not found' } }) }) } };
  },
}));

import { GET } from '@/app/api/media/[id]/cover/route';

const call = (id: string) => GET(new Request(`https://app.test/api/media/${id}/cover`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.owner = true;
  state.row = { account_id: ACC, cover_status: 'ok', cover_path: `${ACC}/17900000000000001.jpg` };
  state.readError = null;
  state.blob = new Blob([JPEG], { type: 'image/jpeg' });
  state.downloads = [];
  state.queries = [];
  state.order = [];
});

describe('GET /api/media/[id]/cover', () => {
  it('streams the owner\'s stored cover: private immutable cache, nosniff, our content type; auth headers kept', async () => {
    const res = await call('17900000000000001');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.order).toEqual(['assertOwner', 'ownerSession', 'admin']); // owner check, then the RLS read, only then Storage
    expect(state.queries[0]).toEqual(['media', 'account_id,cover_status,cover_path', 'id', '17900000000000001']);
    expect(state.downloads).toEqual([`covers:${ACC}/17900000000000001.jpg`]);
  });

  it('401 for anyone but the owner; nothing read; headers kept on that response too', async () => {
    state.owner = false;
    const res = await call('17900000000000001');
    expect(res.status).toBe(401);
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(state.order).toEqual(['assertOwner']);
  });

  it('404 without touching Storage: bad id, media not visible to the owner, no cover yet, or a stored path that is not ours', async () => {
    for (const id of ['abc', '../../etc/passwd', '1'.repeat(40), '17900000000000001.jpg']) {
      const res = await call(id);
      expect(res.status, id).toBe(404);
    }
    for (const row of [null, { account_id: ACC, cover_status: 'pending', cover_path: null }, { account_id: ACC, cover_status: 'ok', cover_path: 'other-account/17900000000000001.jpg' }]) {
      state.row = row;
      const res = await call('17900000000000001');
      expect(res.status).toBe(404);
      expect(res.headers.get('x-from-supabase')).toBe('kept');
    }
    expect(state.downloads).toEqual([]);
  });

  it('object missing in Storage -> 404; a stored type outside the image allowlist is served as JPEG (never sniffed, never SVG)', async () => {
    state.blob = null;
    expect((await call('17900000000000001')).status).toBe(404);
    state.blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const res = await call('17900000000000001');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('a read error -> 500 with a fixed message, still uncached and with the auth headers', async () => {
    state.readError = { message: 'secret detail' };
    const res = await call('17900000000000001');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unexpected' });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
  });

  it('is session-protected by the proxy (no public exemption)', () => {
    expect(decideRoute({ pathname: '/api/media/17900000000000001/cover', configured: true, signedIn: false, aal: null, mfaRequired: false })).toEqual({ type: 'redirect', to: '/login' });
  });
});
```

and `tests/cover-delete.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const state = vi.hoisted(() => ({ deleted: { ok: true } as { ok: boolean; error?: string }, removed: [] as string[] }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => undefined }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({ __admin: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({}) }));
vi.mock('@/lib/accounts/service', () => ({ deleteAccountPermanently: async () => state.deleted, archiveAccount: vi.fn(), restoreAccount: vi.fn(), setAccountGroup: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/sync/store', async (orig) => ({ ...(await orig<typeof import('@/lib/sync/store')>()), removeAccountCovers: async (_db: unknown, id: string) => (state.removed.push(id), 0) }));

import { deleteAccountAction } from '@/app/(app)/accounts/actions';

beforeEach(() => {
  state.deleted = { ok: true };
  state.removed = [];
});

describe('permanent delete removes the account\'s cover objects', () => {
  it('after a successful delete only (archive keeps them; a refused delete removes nothing)', async () => {
    expect(await deleteAccountAction(ID)).toEqual({ ok: true });
    expect(state.removed).toEqual([ID]);
    state.deleted = { ok: false, error: 'not_archived' };
    state.removed = [];
    expect(await deleteAccountAction(ID)).toEqual({ ok: false, error: 'not_archived' });
    expect(state.removed).toEqual([]);
  });
});

describe('removeAccountCovers', () => {
  it('lists the account prefix and removes in batches until empty; never throws', async () => {
    const { removeAccountCovers: real } = await vi.importActual<typeof import('@/lib/sync/store')>('@/lib/sync/store');
    const pages = [[{ name: '1.jpg' }, { name: '2.jpg' }], [{ name: '3.jpg' }], []];
    const removed: string[][] = [];
    const lists: unknown[][] = [];
    const db = { storage: { from: (b: string) => ({ list: async (...a: unknown[]) => (lists.push([b, ...a]), { data: pages.shift(), error: null }), remove: async (paths: string[]) => (removed.push(paths), { data: [], error: null }) }) } };
    expect(await real(db as never, ID)).toBe(3);
    expect(lists[0]).toEqual(['covers', ID, { limit: 1000 }]);
    expect(removed).toEqual([[`${ID}/1.jpg`, `${ID}/2.jpg`], [`${ID}/3.jpg`]]);
    const broken = { storage: { from: () => ({ list: async () => Promise.reject(new Error('storage down')) }) } };
    expect(await real(broken as never, ID)).toBe(0);
    const failing = { storage: { from: () => ({ list: async () => ({ data: [{ name: 'x.jpg' }], error: null }), remove: async () => ({ data: null, error: { message: 'no' } }) }) } };
    expect(await real(failing as never, ID)).toBe(0); // stops instead of looping forever
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/cover-route.test.ts tests/cover-delete.test.ts`
Expected: FAIL — the route module does not exist; `removeAccountCovers` is not exported.

- [ ] **Step 3: Implement**

Create `app/api/media/[id]/cover/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { assertOwner } from '@/lib/auth/assert-owner';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { COVER_TYPES, COVERS_BUCKET, coverPath } from '@/lib/sync/covers';

const MEDIA_ID = /^\d{1,32}$/; // Instagram media ids are numeric

/**
 * GET /api/media/[id]/cover — the stored cover image of one post/Reel/Story. Owner session only (proxy + assertOwner;
 * NOT a public exemption in lib/auth/route-policy.ts). The media row is read with the OWNER session (RLS decides it
 * exists for this owner); only then is the private object streamed with the admin client. The object key is recomputed
 * from our own ids and must equal the stored one, so no request value ever reaches Storage. Immutable once stored
 * (covers are never overwritten), cached privately for a year; the service worker never caches /api/*.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  if (!(await assertOwner(h))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: h });
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404, headers: h });
  const { id } = await ctx.params;
  if (!MEDIA_ID.test(id)) return notFound();
  try {
    const db = await createServerSupabase({ responseHeaders: h });
    const { data, error } = await db.from('media').select('account_id,cover_status,cover_path').eq('id', id).maybeSingle();
    if (error) throw new Error('cover lookup failed');
    const row = data as { account_id: string; cover_status: string; cover_path: string | null } | null;
    if (!row || row.cover_status !== 'ok' || row.cover_path !== coverPath(row.account_id, id)) return notFound();
    const file = await createAdminSupabase().storage.from(COVERS_BUCKET).download(row.cover_path);
    if (file.error || !file.data) return notFound();
    // our own upload type (Task 10 only stores JPEG/PNG/WebP); anything else is served as JPEG, never sniffed
    h.set('content-type', (COVER_TYPES as readonly string[]).includes(file.data.type) ? file.data.type : 'image/jpeg');
    h.set('cache-control', 'private, max-age=31536000, immutable');
    return new NextResponse(file.data.stream(), { status: 200, headers: h });
  } catch {
    console.error('cover read failed'); // fixed text: never log error objects, ids or paths
    return NextResponse.json({ error: 'unexpected' }, { status: 500, headers: h });
  }
}
```

In `lib/sync/store.ts` replace:

```ts
export interface SyncStatus {
```

with:

```ts
/**
 * Permanent account delete: removes the account's cover objects (bucket "covers", prefix "{accountId}/") after the
 * rows are gone. Admin client; best-effort, never throws. A leftover object is unreachable (the cover route needs the
 * media row) and the runbook lists orphans. Returns how many objects were removed.
 */
export async function removeAccountCovers(db: SupabaseClient, accountId: string): Promise<number> {
  let removed = 0;
  try {
    for (let round = 0; round < 50; round++) {
      const { data, error } = await db.storage.from(COVERS_BUCKET).list(accountId, { limit: 1000 });
      if (error || !data || data.length === 0) break;
      const { error: rmError } = await db.storage.from(COVERS_BUCKET).remove(data.map((f) => `${accountId}/${f.name}`));
      if (rmError) break;
      removed += data.length;
    }
  } catch {
    // Storage unreachable: the objects stay private and unreferenced; RUNBOOK_CAPTURE lists them
  }
  return removed;
}

export interface SyncStatus {
```

In `app/(app)/accounts/actions.ts` replace:

```ts
import { resetSyncProgress } from '@/lib/sync/store';
```

with:

```ts
import { removeAccountCovers, resetSyncProgress } from '@/lib/sync/store';
```

In `app/(app)/accounts/actions.ts` replace:

```ts
export async function deleteAccountAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  return guarded((s) => deleteAccountPermanently(s, id));
}
```

with:

```ts
export async function deleteAccountAction(id: string): Promise<Result> {
  await requireOwner();
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'not_found' };
  const result = await guarded((s) => deleteAccountPermanently(s, id));
  // rows are gone (FK cascade: media, comments, snapshots…); now the cover images in Storage. Archive keeps them.
  if (result.ok) await removeAccountCovers(createAdminSupabase(), id);
  return result;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/cover-route.test.ts tests/cover-delete.test.ts tests/account-actions.test.ts tests/route-policy.test.ts tests/proxy.test.ts tests/admin-guard.test.ts && npx tsc --noEmit`
Expected: PASS (the existing action test's mocked admin client has no `storage`; `removeAccountCovers` swallows that, as it would a Storage outage).

- [ ] **Step 5: Commit**

```bash
git add "app/api/media/[id]/cover/route.ts" lib/sync/store.ts "app/(app)/accounts/actions.ts" tests/cover-route.test.ts tests/cover-delete.test.ts
git commit -m "feat(covers): owner-only cover route; permanent delete removes the account's Storage objects" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Comments ingestion (scope-gated `comments` job)

**Files:**
- Modify: `lib/instagram/metrics.ts` (`COMMENT_FIELDS`, `COMMENT_PAGE_SIZE`)
- Modify: `lib/instagram/parse.ts` (`IgComment`, `parseCommentsPage`)
- Modify: `lib/instagram/data.ts` (`commentsPage`)
- Modify: `lib/sync/store.ts` (`mediaForComments`, `upsertComments`, `markCommentsSynced`)
- Modify: `lib/sync/schedule.ts` (job `comments`, `LANE2_ONLY`, `COMMENTS_EVERY_MIN`, `ScheduleInput.commentsScope`)
- Modify: `lib/sync/run-account.ts` (`COMMENT_CALLS_PER_RUN`, `comments` job)
- Modify: `lib/sync/tick.ts` (schedule input carries `commentsScope: hasScope(account, COMMENTS_SCOPE)`)
- Modify: `tests/fixtures/sync-fakes.ts` (`commentsPage`, comment methods, `commentCounts` + `comments` logs)
- Test: `tests/sync-comments.test.ts` (new)

**Interfaces:**
- Consumes: `hasScope`, `COMMENTS_SCOPE` (Task 2); `optional`, `LANE2_ONLY`, schedule `input()` helper in the tick (Task 11); `media.comments_count` written from the listing (Task 8).
- Produces: `IgComment { id; text; username; likeCount; commentedAt }`; `parseCommentsPage(body) => { items; next }`; `IgData.commentsPage(token, mediaId, next?)`; `SyncStore.mediaForComments(accountId, sinceIso) => { id; commentsCount; syncedCount }[]`, `upsertComments(accountId, mediaId, items, seenAtIso)`, `markCommentsSynced(mediaId, count)`; `JOBS` = `[…, 'covers', 'comments', 'tokenRefresh']`; `COMMENT_CALLS_PER_RUN = 20`.

Design: incremental by COUNT, not by cursor — a post is (re)read when its `comments_count` from the hourly listing differs from `comments_synced_count` (count at the last ingest). That is order-agnostic (Meta does not document the order of the comments edge) and costs nothing for quiet posts. Only posts of the last 30 days with `comments_count > 0`, newest first, top-level comments, ≤ 4 pages (200 comments) per post, ≤ 20 calls per run. Without the granted scope the job is never scheduled (and returns at once if called): Meta's empty answer is never recorded. A post that HAS comments but returns none is not marked synced (asked again). Upsert by comment id keeps `first_seen_at` (column default) and refreshes text/likes/`last_seen_at`. Edits that do not change the count are picked up at the next count change (documented limit). The reserved progress stage `comments` is reported (label `sync.activity.comments` already exists).

- [ ] **Step 1: Write the failing test** — create `tests/sync-comments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { igData, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { parseCommentsPage, type IgComment } from '@/lib/instagram/parse';
import { COMMENT_CALLS_PER_RUN, runAccount, type RunContext } from '@/lib/sync/run-account';
import { dueJobs, emptyState, type SyncState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { runTick } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'];
const COMPLETE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: hoursAgo(10), stories: hoursAgo(0.1), daily: hoursAgo(1), mediaList: hoursAgo(0.1), mediaMetrics: hoursAgo(0.1), audience: hoursAgo(1), covers: hoursAgo(0.1) } };
const comment = (id: string, o: Partial<IgComment> = {}): IgComment => ({ id, text: `hello ${id}`, username: `fan_${id}`, likeCount: 0, commentedAt: hoursAgo(1), ...o });

function ctx(o: { scopes?: string[] | null; posts?: { id: string; count: number; synced?: number | null; ageH?: number }[] } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: (o.posts ?? []).map((p) => ({ id: p.id, accountId: 'a1', postedAt: hoursAgo(p.ageH ?? 5), lastMetricsAt: hoursAgo(1) })) });
  for (const p of o.posts ?? []) mem.commentCounts.set(p.id, { count: p.count, synced: p.synced ?? null });
  const acc: StoredAccount = account({ id: 'a1', grantedScopes: o.scopes === undefined ? SCOPES : o.scopes });
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...COMPLETE }, tz: 'UTC', now: NOW, deadline: 1e9, clock: () => 0 };
  return { c, ig, mem, acc };
}

describe('comments scheduling', () => {
  const input = (state: Partial<SyncState>, commentsScope?: boolean) => ({ status: 'active' as const, tokenExpiresAt: null, state: { ...emptyState('a1'), ...state }, commentsScope });
  it('only with the granted scope, only after the import, hourly, never in lane 1', () => {
    expect(dueJobs(input(COMPLETE, true), NOW, 'UTC')).toContain('comments');
    expect(dueJobs(input(COMPLETE, false), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input(COMPLETE), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input({}, true), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input({ ...COMPLETE, lastRun: { ...COMPLETE.lastRun, comments: hoursAgo(0.5) } }, true), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input(COMPLETE, true), NOW, 'UTC', { lane: 'regular' })).not.toContain('comments');
  });
});

describe('comments job', () => {
  it('scope missing: no Instagram call, nothing recorded (an empty list must never read as "no comments")', async () => {
    for (const scopes of [null, SCOPES.slice(0, 2)]) {
      const { c, ig, mem } = ctx({ scopes, posts: [{ id: 'p1', count: 3 }] });
      const { result } = await runAccount(c, ['comments']);
      expect(result.outcome).toBe('ok');
      expect(ig.commentsPage).not.toHaveBeenCalled();
      expect(mem.comments).toEqual([]);
      expect(mem.commentCounts.get('p1')!.synced).toBeNull();
    }
  });

  it('a tick without the scope never schedules it; after a Reconnect that grants it, the first run reads every recent post', async () => {
    const run = async (scopes: string[]) => {
      const ig = fakeIg();
      ig.commentsPage.mockResolvedValue({ items: [comment('c1')], next: null });
      const mem = memoryStore({ tokens: { a1: 'tok' }, media: [{ id: 'p1', accountId: 'a1', postedAt: hoursAgo(5), lastMetricsAt: hoursAgo(0.1) }] });
      mem.commentCounts.set('p1', { count: 1, synced: null });
      mem.states.set('a1', { ...emptyState('a1'), ...COMPLETE, leaseId: null } as SyncState & { leaseId: null });
      const s = await runTick({ store: mem.store, accounts: fakeAccounts([account({ id: 'a1', grantedScopes: scopes })]).accounts, ig, clock: () => NOW.getTime() }, { trigger: 'cron' });
      return { s, ig, mem };
    };
    const before = await run(SCOPES.slice(0, 2));
    expect(before.ig.commentsPage).not.toHaveBeenCalled();
    expect(before.s.accounts[0].jobs).not.toContain('comments');
    const after = await run(SCOPES);
    expect(after.s.accounts[0].jobs).toContain('comments');
    expect(after.mem.comments.map((x) => x.id)).toEqual(['c1']);
  });

  it('reads every page (up to the cap), upserts by id, marks the post synced at its current count; unchanged posts are skipped next time', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 3 }, { id: 'p2', count: 2, synced: 2, ageH: 6 }] });
    ig.commentsPage.mockImplementation((async (_t: string, _id: string, next?: string) =>
      next ? { items: [comment('c3')], next: null } : { items: [comment('c1'), comment('c2')], next: 'https://graph.instagram.com/v25.0/p1/comments?after=X&access_token=IGQ-secret' }) as IgData['commentsPage']);
    const { result } = await runAccount(c, ['comments']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['comments'] });
    expect(ig.commentsPage.mock.calls.map((a) => [a[1], a[2] ? 'next' : 'first'])).toEqual([['p1', 'first'], ['p1', 'next']]); // p2 unchanged: not asked
    expect(mem.comments.map((x) => x.id)).toEqual(['c1', 'c2', 'c3']);
    expect(mem.commentCounts.get('p1')).toEqual({ count: 3, synced: 3 });
    ig.commentsPage.mockClear();
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).not.toHaveBeenCalled();
  });

  it('an empty answer for a post that has comments writes nothing and is asked again next run', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 4 }] });
    await runAccount(c, ['comments']);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(2);
    expect(mem.commentCounts.get('p1')!.synced).toBeNull();
    expect(mem.comments).toEqual([]);
  });

  it('per-run call budget across posts; per-post page cap', async () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, count: 1, ageH: i + 1 }));
    const { c, ig } = ctx({ posts });
    ig.commentsPage.mockImplementation((async (_t: string, id: string) => ({ items: [comment(`${id}-c`)], next: 'https://graph.instagram.com/more' })) as IgData['commentsPage']);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(COMMENT_CALLS_PER_RUN);
    expect(ig.commentsPage.mock.calls.filter((a) => a[1] === 'p00')).toHaveLength(4);
  });

  it('one post failing never stops the others; gone -> marked gone; rate limit -> stops; a DB failure never fails the account', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 1, ageH: 1 }, { id: 'p2', count: 1, ageH: 2 }, { id: 'p3', count: 1, ageH: 3 }] });
    ig.commentsPage.mockImplementation((async (_t: string, id: string) => {
      if (id === 'p1') throw new InstagramApiError('data', 500, 2);
      if (id === 'p2') throw new InstagramApiError('data', 400, 100, 33);
      return { items: [comment('c3')], next: null };
    }) as IgData['commentsPage']);
    expect((await runAccount(c, ['comments'])).result.outcome).toBe('ok');
    expect(mem.media.get('p2')!.gone).toBe(true);
    expect(mem.comments.map((x) => x.id)).toEqual(['c3']);

    const limited = ctx({ posts: [{ id: 'p1', count: 1 }] });
    limited.ig.commentsPage.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    expect((await runAccount(limited.c, ['comments'])).result.errorKey).toBe('rate_limited');

    const db = ctx({ posts: [{ id: 'p1', count: 1 }] });
    db.ig.commentsPage.mockResolvedValue({ items: [comment('c1')], next: null });
    db.mem.store.upsertComments = async () => {
      throw new Error('sync store: upsertComments failed');
    };
    expect((await runAccount(db.c, ['comments'])).result.outcome).toBe('ok');
  });

  it('third-party names and texts never reach progress rows', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 1 }] });
    const writes: unknown[] = [];
    c.progress = { report: async (...a) => void writes.push(a), finish: async () => undefined };
    ig.commentsPage.mockResolvedValue({ items: [comment('c1', { username: 'private.person', text: 'my phone is 123' })], next: null });
    await runAccount(c, ['comments']);
    expect(mem.comments).toHaveLength(1);
    expect(JSON.stringify(writes)).not.toMatch(/private\.person|phone/);
  });
});

describe('comments data client and store', () => {
  it('parses a page; skips items without id/timestamp; next only to Instagram\'s host', async () => {
    expect(parseCommentsPage({ data: [{ id: '1', text: '', username: 'a', like_count: 2, timestamp: '2026-10-13T10:00:00+0000' }, { id: '2' }, { text: 'x', timestamp: '2026-10-13T10:00:00+0000' }], paging: { next: 'N' } })).toEqual({
      items: [{ id: '1', text: '', username: 'a', likeCount: 2, commentedAt: '2026-10-13T10:00:00.000Z' }],
      next: 'N',
    });
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), new Response(JSON.stringify({ data: [] })))) as typeof fetch;
    const ig = igData('v25.0', fn);
    await ig.commentsPage('IGQ-secret', 'm1');
    expect(seen[0].pathname).toBe('/v25.0/m1/comments');
    expect(seen[0].searchParams.get('fields')).toBe('id,text,timestamp,username,like_count');
    expect(await ig.commentsPage('IGQ-secret', 'm1', 'https://evil.example/steal?access_token=IGQ-secret')).toEqual({ items: [], next: null });
    expect(seen).toHaveLength(1);
  });

  it('store: recent posts with comments, newest first; upsert by id without first_seen_at; synced count', async () => {
    const calls: { table: string; op: string; args: unknown[]; filters: unknown[][] }[] = [];
    const db = {
      from(table: string) {
        const c = { table, op: 'select', args: [] as unknown[], filters: [] as unknown[][] };
        calls.push(c);
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        for (const op of ['upsert', 'update']) chain[op] = (...a: unknown[]) => ((c.op = op), (c.args = a), chain);
        for (const f of ['eq', 'neq', 'is', 'gte', 'gt', 'order']) chain[f] = (...a: unknown[]) => (c.filters.push([f, ...a]), chain);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'p1', comments_count: 3, comments_synced_count: null }], error: null }).then(res);
        return chain;
      },
    };
    const s = supabaseSyncStore(db as never);
    expect(await s.mediaForComments('a1', 'SINCE')).toEqual([{ id: 'p1', commentsCount: 3, syncedCount: null }]);
    expect(calls[0].filters).toEqual([['eq', 'account_id', 'a1'], ['neq', 'media_type', 'STORY'], ['is', 'gone_at', null], ['gte', 'posted_at', 'SINCE'], ['gt', 'comments_count', 0], ['order', 'posted_at', { ascending: false }]]);
    await s.upsertComments('a1', 'p1', [comment('c1')], 'T');
    expect(calls[1]).toMatchObject({ table: 'comments', op: 'upsert', args: [[{ id: 'c1', account_id: 'a1', media_id: 'p1', author_username: 'fan_c1', text: 'hello c1', like_count: 0, commented_at: hoursAgo(1), last_seen_at: 'T' }], { onConflict: 'id' }] });
    expect((calls[1].args[0] as object[])[0]).not.toHaveProperty('first_seen_at');
    await s.upsertComments('a1', 'p1', [], 'T');
    expect(calls).toHaveLength(2);
    await s.markCommentsSynced('p1', 3);
    expect(calls[2]).toMatchObject({ table: 'media', op: 'update', args: [{ comments_synced_count: 3 }], filters: [['eq', 'id', 'p1']] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-comments.test.ts`
Expected: FAIL — `parseCommentsPage` / `COMMENT_CALLS_PER_RUN` are not exported.

- [ ] **Step 3: Implement**

In `lib/instagram/metrics.ts` replace:

```ts
/** UNCERTAIN: page-size maximum is not documented; 50 is conservative. */
```

with:

```ts
/**
 * GET /{media-id}/comments (top-level comments). Needs instagram_business_manage_comments; WITHOUT it Meta answers an
 * EMPTY list and no error (verified 2026-10-17), so the sync checks the granted scope first (lib/accounts/scopes.ts).
 * Fields verified live 2026-10-16. Replies and `hidden` are not requested (moderation is a later plan).
 */
export const COMMENT_FIELDS = 'id,text,timestamp,username,like_count';
export const COMMENT_PAGE_SIZE = 50;

/** UNCERTAIN: page-size maximum is not documented; 50 is conservative. */
```

In `lib/instagram/parse.ts` replace:

```ts
/**
 * The insight day an online_followers value belongs to.
```

with:

```ts
/** A comment on the owner's media. text and username are third-party personal data: never logged. */
export interface IgComment {
  id: string;
  text: string | null;
  username: string | null;
  likeCount: number | null;
  commentedAt: string; // ISO UTC
}

/** A page of /{media-id}/comments. Items without an id or a valid timestamp are skipped. */
export function parseCommentsPage(body: unknown): { items: IgComment[]; next: string | null } {
  const items: IgComment[] = [];
  for (const c of entries(body)) {
    const id = typeof c.id === 'number' ? String(c.id) : str(c.id);
    const commentedAt = toIso(c.timestamp);
    if (!id || !commentedAt) continue;
    items.push({ id, text: typeof c.text === 'string' ? c.text : null, username: str(c.username), likeCount: num(c.like_count), commentedAt });
  }
  const paging = isObj(body) && isObj(body.paging) ? body.paging : null;
  return { items, next: paging ? str(paging.next) : null };
}

/**
 * The insight day an online_followers value belongs to.
```

In `lib/instagram/data.ts` replace:

```ts
import { mediaDetailsById, parseBreakdown, parseMediaDetails, parseMediaPage, parseOnlineFollowers, parseTotals, type IgMediaItem, type MediaDetails } from '@/lib/instagram/parse';
```

with:

```ts
import { mediaDetailsById, parseBreakdown, parseCommentsPage, parseMediaDetails, parseMediaPage, parseOnlineFollowers, parseTotals, type IgComment, type IgMediaItem, type MediaDetails } from '@/lib/instagram/parse';
```

In `lib/instagram/data.ts` replace:

```ts
    /** Fresh cover URLs for one media item
```

with:

```ts
    /**
     * One page of a media item's top-level comments. `next` (from the previous page) carries the token, so it is only
     * followed to Instagram's own host; any other URL ends the paging.
     */
    async commentsPage(token: string, mediaId: string, next?: string): Promise<{ items: IgComment[]; next: string | null }> {
      if (next !== undefined && !next.startsWith(`${HOST}/`)) return { items: [], next: null };
      const body = next !== undefined ? await getUrl(next) : await get(`${mediaId}/comments`, { fields: M.COMMENT_FIELDS, limit: M.COMMENT_PAGE_SIZE }, token);
      return parseCommentsPage(body);
    },

    /** Fresh cover URLs for one media item
```

In `lib/sync/store.ts` replace:

```ts
import type { IgMediaItem } from '@/lib/instagram/parse';
```

with:

```ts
import type { IgComment, IgMediaItem } from '@/lib/instagram/parse';
```

In `lib/sync/store.ts` replace:

```ts
  /** Stories past expires_at whose cover never landed: 'unavailable' (the CDN link died with them). */
  expireStoryCovers(accountId: string, nowIso: string): Promise<void>;
```

with:

```ts
  /** Stories past expires_at whose cover never landed: 'unavailable' (the CDN link died with them). */
  expireStoryCovers(accountId: string, nowIso: string): Promise<void>;
  /** Feed + Reels posted since sinceIso that have comments (comments_count > 0), newest first, with the count at the last ingest. */
  mediaForComments(accountId: string, sinceIso: string): Promise<{ id: string; commentsCount: number; syncedCount: number | null }[]>;
  /** Upsert by comment id: text/likes/last_seen_at refresh, first_seen_at stays (column default on insert). */
  upsertComments(accountId: string, mediaId: string, items: IgComment[], seenAtIso: string): Promise<void>;
  markCommentsSynced(mediaId: string, commentsCount: number): Promise<void>;
```

In `lib/sync/store.ts` replace:

```ts
    async upsertOnlineFollowers(accountId, day, hourly) {
```

with:

```ts
    async mediaForComments(accountId, sinceIso) {
      const { data, error } = await db
        .from('media')
        .select('id,comments_count,comments_synced_count')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .is('gone_at', null)
        .gte('posted_at', sinceIso)
        .gt('comments_count', 0)
        .order('posted_at', { ascending: false });
      if (error) fail('mediaForComments');
      return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, commentsCount: r.comments_count as number, syncedCount: (r.comments_synced_count as number | null) ?? null }));
    },
    async upsertComments(accountId, mediaId, items, seenAtIso) {
      if (items.length === 0) return;
      const rows = items.map((i) => ({ id: i.id, account_id: accountId, media_id: mediaId, author_username: i.username, text: i.text, like_count: i.likeCount, commented_at: i.commentedAt, last_seen_at: seenAtIso }));
      check('upsertComments')(await db.from('comments').upsert(rows, { onConflict: 'id' }));
    },
    async markCommentsSynced(mediaId, commentsCount) {
      check('markCommentsSynced')(await db.from('media').update({ comments_synced_count: commentsCount }).eq('id', mediaId));
    },
    async upsertOnlineFollowers(accountId, day, hourly) {
```

In `lib/sync/schedule.ts` replace:

```ts
export const COVERS_EVERY_MIN = 60; // new posts appear with the hourly media list; their CDN links live ~1.4–4.5 days
```

with:

```ts
export const COVERS_EVERY_MIN = 60; // new posts appear with the hourly media list; their CDN links live ~1.4–4.5 days
export const COMMENTS_EVERY_MIN = 60;
```

In `lib/sync/schedule.ts` replace:

```ts
 * history (backfill: days 8–90 newest first, then older posts' metrics) -> post covers (lane 2 only, once the history
 * import is through).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'covers', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

/** Optional catch-up work that only lane 2 runs (never inside lane 1's small per-account slice). */
export const LANE2_ONLY: readonly JobKind[] = ['covers'];
```

with:

```ts
 * history (backfill: days 8–90 newest first, then older posts' metrics) -> post covers -> comments (both lane 2 only,
 * once the history import is through; comments only with the granted scope).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'covers', 'comments', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

/** Optional catch-up work that only lane 2 runs (never inside lane 1's small per-account slice). */
export const LANE2_ONLY: readonly JobKind[] = ['covers', 'comments'];
```

In `lib/sync/schedule.ts` replace:

```ts
export interface ScheduleInput {
  status: AccountStatus;
  tokenExpiresAt: string | null;
  state: SyncState;
}
```

with:

```ts
export interface ScheduleInput {
  status: AccountStatus;
  tokenExpiresAt: string | null;
  state: SyncState;
  /** The account's token carries instagram_business_manage_comments (hasScope); missing = no comments job. */
  commentsScope?: boolean;
}
```

In `lib/sync/schedule.ts` replace:

```ts
export function dueJobs({ status, tokenExpiresAt, state: s }: ScheduleInput,
```

with:

```ts
export function dueJobs({ status, tokenExpiresAt, state: s, commentsScope }: ScheduleInput,
```

In `lib/sync/schedule.ts` replace:

```ts
  else if (atLeast(s.lastRun.covers, COVERS_EVERY_MIN * MIN)) due.add('covers'); // after the import: Overview numbers first
```

with:

```ts
  else if (atLeast(s.lastRun.covers, COVERS_EVERY_MIN * MIN)) due.add('covers'); // after the import: Overview numbers first
  if (commentsScope && !isBackfilling(s) && atLeast(s.lastRun.comments, COMMENTS_EVERY_MIN * MIN)) due.add('comments');
```

In `lib/sync/run-account.ts` replace:

```ts
import { markNeedsReconnect } from '@/lib/accounts/service';
```

with:

```ts
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { markNeedsReconnect } from '@/lib/accounts/service';
```

In `lib/sync/run-account.ts` replace:

```ts
import type { IgMediaItem } from '@/lib/instagram/parse';
```

with:

```ts
import type { IgComment, IgMediaItem } from '@/lib/instagram/parse';
```

In `lib/sync/run-account.ts` replace:

```ts
/**
 * Optional lane-2 work (covers, comments):
```

with:

```ts
/** Comment pages read per run (all posts together) and per post (50 comments a page). */
export const COMMENT_CALLS_PER_RUN = 20;
const COMMENT_PAGES_PER_MEDIA = 4;

/**
 * Comments (read only, lane 2, after the import) for posts of the last 30 days whose comments_count changed since the
 * last ingest, newest first. Only with the granted scope: without it Meta answers an empty list with no error. An empty
 * answer for a post that HAS comments is never taken as "no comments": nothing is written or marked, it is asked again.
 * Upserts by comment id. Comment texts and usernames are never logged or put into progress/summary rows.
 */
const comments: Job = async (c) => {
  if (!hasScope(c.account, COMMENTS_SCOPE)) return { done: true }; // belt and braces: dueJobs already requires it
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const due = (await c.store.mediaForComments(c.account.id, since)).filter((m) => m.commentsCount !== m.syncedCount);
  let calls = COMMENT_CALLS_PER_RUN;
  for (const [i, m] of due.entries()) {
    if (outOfTime(c)) return { done: false };
    if (calls <= 0) break; // the rest next time (stamped done: the cadence brings it back within the hour)
    await c.progress?.report('comments', i, due.length);
    const items: IgComment[] = [];
    try {
      let next: string | undefined;
      for (let page = 0; page < COMMENT_PAGES_PER_MEDIA && calls > 0; page++) {
        calls -= 1;
        const r = await c.ig.commentsPage(c.token, m.id, next);
        items.push(...r.items);
        if (!r.next || outOfTime(c)) break;
        next = r.next;
      }
    } catch (e) {
      if (fatal(e)) throw e;
      if (classifyIgError(e) === 'gone') await c.store.markGone(m.id, c.now.toISOString());
      continue; // one post's problem never stops the others
    }
    if (items.length === 0) continue;
    await c.store.upsertComments(c.account.id, m.id, items, c.now.toISOString());
    await c.store.markCommentsSynced(m.id, m.commentsCount);
  }
  return { done: true };
};

/**
 * Optional lane-2 work (covers, comments):
```

In `lib/sync/run-account.ts` replace:

```ts
covers: optional(covers), tokenRefresh };
```

with:

```ts
covers: optional(covers), comments: optional(comments), tokenRefresh };
```

In `lib/sync/tick.ts` replace:

```ts
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
```

with:

```ts
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
```

In `lib/sync/tick.ts` replace:

```ts
  const input = (a: StoredAccount, state: SyncState): ScheduleInput => ({ status: a.status, tokenExpiresAt: a.tokenExpiresAt, state });
```

with:

```ts
  const input = (a: StoredAccount, state: SyncState): ScheduleInput => ({ status: a.status, tokenExpiresAt: a.tokenExpiresAt, state, commentsScope: hasScope(a, COMMENTS_SCOPE) });
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    mediaCover: vi.fn<IgData['mediaCover']>(
```

with:

```ts
    commentsPage: vi.fn<IgData['commentsPage']>(async () => ({ items: [], next: null })),
    mediaCover: vi.fn<IgData['mediaCover']>(
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  const uploads: { path: string; bytes: number; contentType: string }[] = [];
```

with:

```ts
  const uploads: { path: string; bytes: number; contentType: string }[] = [];
  /** comments_count / comments_synced_count per media id (only media listed here have comments) */
  const commentCounts = new Map<string, { count: number; synced: number | null }>();
  const comments: { accountId: string; mediaId: string; id: string; seenAt: string }[] = [];
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    markCover: async (id, r) => void covers.set(id, r),
```

with:

```ts
    markCover: async (id, r) => void covers.set(id, r),
    mediaForComments: async (accountId, since) =>
      [...media.values()]
        .filter((m) => m.accountId === accountId && m.kind !== 'STORY' && !m.gone && m.postedAt >= since && (commentCounts.get(m.id)?.count ?? 0) > 0)
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
        .map((m) => ({ id: m.id, commentsCount: commentCounts.get(m.id)!.count, syncedCount: commentCounts.get(m.id)!.synced })),
    upsertComments: async (accountId, mediaId, items, seenAt) => {
      for (const i of items) {
        const at = comments.findIndex((x) => x.id === i.id);
        if (at >= 0) comments.splice(at, 1);
        comments.push({ accountId, mediaId, id: i.id, seenAt });
      }
    },
    markCommentsSynced: async (id, n) => void commentCounts.set(id, { count: commentCounts.get(id)?.count ?? n, synced: n }),
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  return { store, states, media, children, covers, uploads,
```

with:

```ts
  return { store, states, media, children, covers, uploads, commentCounts, comments,
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/sync-comments.test.ts tests/sync-schedule.test.ts tests/sync-onboarding-schedule.test.ts tests/sync-tick.test.ts tests/sync-lanes.test.ts tests/sync-covers-job.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/metrics.ts lib/instagram/parse.ts lib/instagram/data.ts lib/sync/store.ts lib/sync/schedule.ts lib/sync/run-account.ts lib/sync/tick.ts tests/fixtures/sync-fakes.ts tests/sync-comments.test.ts
git commit -m "feat(sync): comments ingestion (read only, granted-scope gated, incremental by count, lane 2)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Raw response archive (`api_snapshots`)

**Files:**
- Modify: `lib/instagram/data.ts` (`Archive`, `endpointKey`, `get(…, archive?)`, `archive?` on `accountDay`, `accountDayBreakdown`, `audience`, `onlineFollowers`)
- Modify: `lib/sync/store.ts` (`SNAPSHOT_MAX_BYTES`, `archiveSnapshot`)
- Modify: `lib/sync/run-account.ts` (`RunContext.archive`, `ARCHIVE_WAIT_MS`, `settle`, archive wiring in `runAccount`, pass `c.archive` in the daily/backfill and audience calls)
- Modify: `tests/fixtures/sync-fakes.ts` (`archiveSnapshot`, `archived` log)
- Test: `tests/sync-archive.test.ts` (new)

**Interfaces:**
- Consumes: table `api_snapshots` (Task 1).
- Produces: `type Archive = (endpoint: string, body: Record<string, unknown>) => void`; `endpointKey(path, params)` (sorted params, never the token); `SyncStore.archiveSnapshot(accountId, endpoint, body, capturedAtIso)`; `SNAPSHOT_MAX_BYTES = 65536`; `ARCHIVE_WAIT_MS = 2000`.

What is archived: the raw JSON of every account-level insights call (day totals, follows/unfollows, reach/views breakdowns) and audience call (demographics, online followers) — the data Meta deletes after 90 days. NOT archived: media lists, captions, media insights (re-fetchable ~2 years), comments (third-party data). Dedupe: `unique (account_id, endpoint, body_hash)` + `ignoreDuplicates`, so the daily 3-day settle re-fetch only adds a row when Meta revised the numbers (which is exactly the history worth keeping). Size: ~10 bodies of 1–3 KB per account per day ≈ 5–10 MB per account per year before dedupe; kept forever. Best-effort: the client swallows archive errors; the runner fires the writes without awaiting them per call and settles them once at the end, capped at 2 s, so a slow database can never stall a sync.

- [ ] **Step 1: Write the failing test** — create `tests/sync-archive.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointKey, igData, type Archive, type IgData } from '@/lib/instagram/data';
import { ARCHIVE_WAIT_MS, runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { SNAPSHOT_MAX_BYTES, supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
afterEach(() => vi.useRealTimers());

describe('data client archive hook', () => {
  const body = { data: [{ name: 'reach', total_value: { value: 5 } }] };
  const fn = (async () => new Response(JSON.stringify(body))) as typeof fetch;

  it('account insights and audience calls hand their raw body and a token-free key to the archive', async () => {
    const seen: [string, unknown][] = [];
    const archive: Archive = (e, b) => void seen.push([e, b]);
    const ig = igData('v25.0', fn);
    await ig.accountDay('IGQ-secret', 100, 200, archive);
    await ig.accountDayBreakdown('IGQ-secret', 100, 200, archive);
    await ig.audience('IGQ-secret', 'country', archive);
    await ig.onlineFollowers('IGQ-secret', 100, 200, archive);
    expect(seen).toHaveLength(2 + 2 + 1 + 1);
    expect(seen[0]).toEqual(['me/insights?metric=reach%2Cviews%2Caccounts_engaged%2Ctotal_interactions%2Cprofile_links_taps&metric_type=total_value&period=day&since=100&until=200', body]);
    expect(JSON.stringify(seen)).not.toContain('IGQ-secret');
  });

  it('keys are stable whatever the parameter order', () => {
    expect(endpointKey('me/insights', { b: 2, a: 1 })).toBe(endpointKey('me/insights', { a: 1, b: 2 }));
  });

  it('a throwing archive never costs the call', async () => {
    const v = await igData('v25.0', fn).accountDay('t', 1, 2, () => {
      throw new Error('archive down');
    });
    expect(v.reach).toBe(5);
  });
});

describe('runner wiring', () => {
  function ctx() {
    const ig = fakeIg();
    const mem = memoryStore();
    const acc = account({ id: 'a1' });
    // the fakes call the archive like the real client would
    ig.accountDay.mockImplementation((async (_t: string, since: number, _u: number, archive?: Archive) => {
      archive?.(`me/insights?day=${since}`, { data: [{ name: 'reach', total_value: { value: 1 } }] });
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    }) as IgData['accountDay']);
    ig.audience.mockImplementation((async (_t: string, kind: string, archive?: Archive) => (archive?.(`aud-${kind}`, { data: [] }), {})) as IgData['audience']);
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'UTC', now: NOW, deadline: 1e9, clock: () => 0 };
    return { c, ig, mem };
  }

  it('daily + audience bodies are archived for this account (media lists, media insights and comments never are)', async () => {
    const { c, mem } = ctx();
    await runAccount(c, ['daily', 'audience', 'mediaList', 'mediaMetrics', 'stories']);
    expect(mem.archived.length).toBe(7 + 3);
    expect(mem.archived.every((a) => a.accountId === 'a1' && a.capturedAt === NOW.toISOString())).toBe(true);
    expect(mem.archived.map((a) => a.endpoint)).toContain('aud-country');
  });

  it('a failing archive write never fails a job', async () => {
    const { c, mem } = ctx();
    mem.store.archiveSnapshot = async () => {
      throw new Error('sync store: archiveSnapshot failed');
    };
    const { result } = await runAccount(c, ['daily']);
    expect(result.outcome).toBe('ok');
  });

  it('a hanging archive write holds the run up for at most ARCHIVE_WAIT_MS', async () => {
    vi.useFakeTimers();
    const { c, mem } = ctx();
    mem.store.archiveSnapshot = () => new Promise<void>(() => {});
    let done = false;
    const run = runAccount(c, ['audience']).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(ARCHIVE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).result.outcome).toBe('ok');
  });
});

describe('store: api_snapshots', () => {
  function recorder() {
    const calls: unknown[][] = [];
    const db = { from: (t: string) => ({ upsert: async (row: unknown, opts: unknown) => (calls.push([t, row, opts]), { error: null }) }) };
    return { db: db as never, calls };
  }
  it('dedupes on (account, endpoint, sha256 of the JSON text); identical bodies hash the same', async () => {
    const r = recorder();
    const body = { data: [{ name: 'reach', total_value: { value: 9 } }] };
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'me/insights?x=1', body, 'T');
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    expect(r.calls[0]).toEqual(['api_snapshots', { account_id: 'a1', endpoint: 'me/insights?x=1', captured_at: 'T', body, body_hash: hash }, { onConflict: 'account_id,endpoint,body_hash', ignoreDuplicates: true }]);
  });
  it('skips bodies over 64 KB', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'e', { blob: 'x'.repeat(SNAPSHOT_MAX_BYTES) }, 'T');
    expect(r.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-archive.test.ts`
Expected: FAIL — `endpointKey` / `ARCHIVE_WAIT_MS` / `SNAPSHOT_MAX_BYTES` are not exported.

- [ ] **Step 3: Implement**

In `lib/instagram/data.ts` replace:

```ts
export function igData(apiVersion: string, fetchFn: typeof fetch = fetch) {
  const getUrl = (url: string) => call('data', fetchFn, url, graphInit());
  const get = (path: string, params: Record<string, string | number>, token: string) => {
    const u = new URL(`${HOST}/${apiVersion}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('access_token', token);
    return getUrl(u.toString());
  };
```

with:

```ts
/**
 * Raw-response archive hook (api_snapshots): called with the request key (path + sorted params, never the token) and
 * the parsed JSON body of account-level insights and audience calls only. Must not throw (errors are swallowed anyway).
 */
export type Archive = (endpoint: string, body: Record<string, unknown>) => void;

/** Stable archive key: path + params sorted by name. The token is never part of it. */
export const endpointKey = (path: string, params: Record<string, string | number>) =>
  `${path}?${new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, String(v)])).toString()}`;

export function igData(apiVersion: string, fetchFn: typeof fetch = fetch) {
  const getUrl = (url: string) => call('data', fetchFn, url, graphInit());
  const get = async (path: string, params: Record<string, string | number>, token: string, archive?: Archive) => {
    const u = new URL(`${HOST}/${apiVersion}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('access_token', token);
    const body = await getUrl(u.toString());
    try {
      archive?.(endpointKey(path, params), body);
    } catch {
      // the archive is best-effort: never costs the call
    }
    return body;
  };
```

In `lib/instagram/data.ts` replace:

```ts
    async accountDayBreakdown(token: string, since: number, until: number): Promise<BreakdownRow[]> {
```

with:

```ts
    async accountDayBreakdown(token: string, since: number, until: number, archive?: Archive): Promise<BreakdownRow[]> {
```

In `lib/instagram/data.ts` replace:

```ts
        const r = parseBreakdown(await get('me/insights', { metric_type: 'total_value', period: 'day', since, until, metric, breakdown: M.BREAKDOWN_DIMS }, token), metric);
```

with:

```ts
        const r = parseBreakdown(await get('me/insights', { metric_type: 'total_value', period: 'day', since, until, metric, breakdown: M.BREAKDOWN_DIMS }, token, archive), metric);
```

In `lib/instagram/data.ts` replace:

```ts
    async accountDay(token: string, since: number, until: number): Promise<AccountDayValues> {
```

with:

```ts
    async accountDay(token: string, since: number, until: number, archive?: Archive): Promise<AccountDayValues> {
```

In `lib/instagram/data.ts` replace:

```ts
      const t = parseTotals(await get('me/insights', { ...base, metric: M.ACCOUNT_DAY_METRICS.join(',') }, token));
      const f = parseBreakdown(await get('me/insights', { ...base, metric: M.FOLLOWS_METRIC, breakdown: M.FOLLOWS_BREAKDOWN }, token), M.FOLLOWS_METRIC);
```

with:

```ts
      const t = parseTotals(await get('me/insights', { ...base, metric: M.ACCOUNT_DAY_METRICS.join(',') }, token, archive));
      const f = parseBreakdown(await get('me/insights', { ...base, metric: M.FOLLOWS_METRIC, breakdown: M.FOLLOWS_BREAKDOWN }, token, archive), M.FOLLOWS_METRIC);
```

In `lib/instagram/data.ts` replace:

```ts
    async audience(token: string, kind: M.AudienceKind): Promise<Record<string, number>> {
```

with:

```ts
    async audience(token: string, kind: M.AudienceKind, archive?: Archive): Promise<Record<string, number>> {
```

In `lib/instagram/data.ts` replace:

```ts
      return parseBreakdown(await get('me/insights', params, token), M.DEMOGRAPHICS_METRIC);
```

with:

```ts
      return parseBreakdown(await get('me/insights', params, token, archive), M.DEMOGRAPHICS_METRIC);
```

In `lib/instagram/data.ts` replace:

```ts
    async onlineFollowers(token: string, since: number, until: number) {
      return parseOnlineFollowers(await get('me/insights', { metric: M.ONLINE_FOLLOWERS_METRIC, period: 'lifetime', since, until }, token));
```

with:

```ts
    async onlineFollowers(token: string, since: number, until: number, archive?: Archive) {
      return parseOnlineFollowers(await get('me/insights', { metric: M.ONLINE_FOLLOWERS_METRIC, period: 'lifetime', since, until }, token, archive));
```

In `lib/sync/store.ts` replace:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
```

with:

```ts
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
```

In `lib/sync/store.ts` replace:

```ts
  markCommentsSynced(mediaId: string, commentsCount: number): Promise<void>;
```

with:

```ts
  markCommentsSynced(mediaId: string, commentsCount: number): Promise<void>;
  /** Raw JSON of one insights/audience call, deduped on (account, endpoint, sha256(body)); bodies over 64 KB are skipped. */
  archiveSnapshot(accountId: string, endpoint: string, body: Record<string, unknown>, capturedAtIso: string): Promise<void>;
```

In `lib/sync/store.ts` replace:

```ts
const EXTRA_COLUMNS: Record<keyof MediaExtras, string>
```

with:

```ts
/** api_snapshots size guard: an insights body is ~1–3 KB; anything this big is not what we meant to keep. */
export const SNAPSHOT_MAX_BYTES = 64 * 1024;

const EXTRA_COLUMNS: Record<keyof MediaExtras, string>
```

In `lib/sync/store.ts` replace:

```ts
    async upsertOnlineFollowers(accountId, day, hourly) {
```

with:

```ts
    async archiveSnapshot(accountId, endpoint, body, capturedAtIso) {
      const text = JSON.stringify(body);
      if (Buffer.byteLength(text) > SNAPSHOT_MAX_BYTES) return;
      const row = { account_id: accountId, endpoint, captured_at: capturedAtIso, body, body_hash: createHash('sha256').update(text).digest('hex') };
      check('archiveSnapshot')(await db.from('api_snapshots').upsert(row, { onConflict: 'account_id,endpoint,body_hash', ignoreDuplicates: true }));
    },
    async upsertOnlineFollowers(accountId, day, hourly) {
```

In `lib/sync/run-account.ts` replace:

```ts
import { classifyIgError, isFatalIgError as fatal, isUnsupported, type IgData } from '@/lib/instagram/data';
```

with:

```ts
import { classifyIgError, isFatalIgError as fatal, isUnsupported, type Archive, type IgData } from '@/lib/instagram/data';
```

In `lib/sync/run-account.ts` replace:

```ts
  /** fetch for the Instagram CDN (cover images); default: global fetch. */
  cdnFetch?: typeof fetch;
}
```

with:

```ts
  /** fetch for the Instagram CDN (cover images); default: global fetch. */
  cdnFetch?: typeof fetch;
  /** Raw-response archive for account insights + audience calls; set by runAccount (best-effort). */
  archive?: Archive;
}
```

In `lib/sync/run-account.ts` replace:

```ts
    await c.store.upsertDaily(c.account.id, day, await c.ig.accountDay(c.token, since, until));
```

with:

```ts
    await c.store.upsertDaily(c.account.id, day, await c.ig.accountDay(c.token, since, until, c.archive));
```

In `lib/sync/run-account.ts` replace:

```ts
    await c.store.upsertDailyBreakdown(c.account.id, day, await c.ig.accountDayBreakdown(c.token, since, until));
```

with:

```ts
    await c.store.upsertDailyBreakdown(c.account.id, day, await c.ig.accountDayBreakdown(c.token, since, until, c.archive));
```

In `lib/sync/run-account.ts` replace:

```ts
    const data = await c.ig.audience(c.token, kind);
```

with:

```ts
    const data = await c.ig.audience(c.token, kind, c.archive);
```

In `lib/sync/run-account.ts` replace:

```ts
  for (const d of await c.ig.onlineFollowers(c.token, since, until)) await c.store.upsertOnlineFollowers(c.account.id, d.day, d.hourly);
```

with:

```ts
  for (const d of await c.ig.onlineFollowers(c.token, since, until, c.archive)) await c.store.upsertOnlineFollowers(c.account.id, d.day, d.hourly);
```

In `lib/sync/run-account.ts` replace:

```ts
 * Runs `jobs` in order. auth -> needs_reconnect, stop.
```

with:

```ts
/** The archive never holds up a run: pending writes get this long after the last job, then they are left behind. */
export const ARCHIVE_WAIT_MS = 2_000;

async function settle(pending: Promise<void>[]): Promise<void> {
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.allSettled(pending), new Promise<void>((resolve) => (timer = setTimeout(resolve, ARCHIVE_WAIT_MS)))]);
  clearTimeout(timer);
}

/**
 * Runs `jobs` in order. auth -> needs_reconnect, stop.
```

In `lib/sync/run-account.ts` replace:

```ts
  const completed: JobKind[] = [];
  let partial = false;
```

with:

```ts
  const completed: JobKind[] = [];
  // raw insights/audience bodies -> api_snapshots; fire-and-forget per call, settled (time-capped) before returning
  const archived: Promise<void>[] = [];
  const archive: Archive = (endpoint, body) => void archived.push(c.store.archiveSnapshot(c.account.id, endpoint, body, nowIso).catch(() => {}));
  const ctx: RunContext = { ...c, archive };
  let partial = false;
```

In `lib/sync/run-account.ts` replace:

```ts
      const r = await JOB_RUNNERS[job](c, progress);
```

with:

```ts
      const r = await JOB_RUNNERS[job](ctx, progress);
```

In `lib/sync/run-account.ts` replace:

```ts
  if (outcome === 'ok' && partial) outcome = 'partial';

```

with:

```ts
  if (outcome === 'ok' && partial) outcome = 'partial';
  await settle(archived);

```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  const comments: { accountId: string; mediaId: string; id: string; seenAt: string }[] = [];
```

with:

```ts
  const comments: { accountId: string; mediaId: string; id: string; seenAt: string }[] = [];
  const archived: { accountId: string; endpoint: string; body: unknown; capturedAt: string }[] = [];
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
    markCommentsSynced: async (id, n) =>
```

with:

```ts
    archiveSnapshot: async (accountId, endpoint, body, capturedAt) => void archived.push({ accountId, endpoint, body, capturedAt }),
    markCommentsSynced: async (id, n) =>
```

In `tests/fixtures/sync-fakes.ts` replace:

```ts
  return { store, states, media, children, covers, uploads, commentCounts, comments,
```

with:

```ts
  return { store, states, media, children, covers, uploads, commentCounts, comments, archived,
```

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: lint, typecheck, all tests and the production build pass.

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/data.ts lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-archive.test.ts
git commit -m "feat(sync): archive raw account-insights and audience responses (deduped, size-capped, best-effort)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Docs — RUNBOOK_CAPTURE, TODO, HANDOVER, SPEC §5/§6

**Files:**
- Create: `docs/RUNBOOK_CAPTURE.md`
- Modify: `docs/TODO.md` (§6c honest ticks), `docs/HANDOVER.md` (§1d), `docs/SPEC.md` (§5 rows, §6 paragraph — **SPEC edit, flagged for the owner**), `docs/RUNBOOK_SYNC.md` (pointer)

**Interfaces:**
- Consumes: everything above (names, keys, limits).
- Produces: the owner's live-verification procedure, including "post a Story and run a probe", the comments Reconnect, capability-memory reset (`update sync_state set capabilities = '{}'`), storage size queries and the orphan query.

- [ ] **Step 1: Write the runbook** — create `docs/RUNBOOK_CAPTURE.md`:

````markdown
# Runbook — Data Capture v2b (Plan 11b)

How to check, live, everything Plan 11b captures: granted scopes, capability memory, Story extras, per-media extras,
media fields, cover images, comments and the raw response archive. Run the SQL in the Supabase SQL editor (it runs as
`postgres`, so RLS does not hide rows). Nothing here prints tokens; never paste tokens, CDN URLs or comment texts into
chats or issues.

## 0. Before deploying
1. Apply the migration FIRST: `npx supabase db push --yes --password $SUPABASE_DB_PASSWORD` (see docs/HANDOVER.md §4).
   The new code writes columns that only exist after `20261022000001_capture_v2b.sql`.
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
Accounts connected before the comments scope was requested show **"Reconnect to enable comments"** on `/accounts`.
1. Click it (or ⋮ → Reconnect), log in to that Instagram account, approve all permissions.
2. Check: `select username, granted_scopes from accounts;` → the list now contains `instagram_business_manage_comments`.
3. If `granted_scopes` is `null` after a reconnect, Meta did not report the granted permissions on the code exchange:
   tell the assistant (comments stay off rather than guessing).
4. Without the scope Instagram returns an EMPTY comments list without an error; the app never reads that as "no
   comments" — the comments job simply does not run.

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
1. Post a Story on a connected account (insights need ≥ 5 viewers; under that Meta answers "not enough viewers" and
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
   → `ok` with `cover_path = '<account_id>/<media_id>.jpg'` within one tick of posting. If `stories:url_fields` is
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
- Signed in, open `https://<domain>/api/media/<media_id>/cover` → the image (`Cache-Control: private, max-age=31536000,
  immutable`). Signed out → redirected to `/login`. A media id without a stored cover → 404.
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
data: never copy them out of the database into chats or issues.

## 8. Raw response archive
```sql
select a.username, count(*) as bodies, pg_size_pretty(sum(pg_column_size(s.body))) as size, max(s.captured_at)
  from api_snapshots s join accounts a on a.id = s.account_id group by 1;
select endpoint, captured_at from api_snapshots order by captured_at desc limit 10;
```
One row per distinct body per request (deduped by hash), so the daily re-fetch of the last 3 days only adds rows when
Meta revised the numbers. Bodies over 64 KB are skipped. Kept forever.

## 9. Expected growth (2 accounts)
| What | Per account | 2 accounts / year |
|---|---|---|
| `api_snapshots` | ~10 bodies/day × 1–3 KB | ~10–20 MB |
| `media_metrics` extras columns | a few bytes per snapshot | negligible |
| `comments` | depends on the audience; ~200 B/comment | < 5 MB for thousands of comments |
| Covers (Storage) | ~16–150 KB per post/Reel/Story | ~100 MB per 1,000 items (free tier: 1 GB) |

## 10. Known limits
- Comment edits that do not change a post's comment count are picked up at the next count change; replies and the
  `hidden` flag are not read yet (moderation plan).
- Carousel child covers are not captured (only the parent's first image).
- Story extras / Story covers depend on Meta supporting them on Stories (section 3).
- A cover backlog larger than 200 failed-and-waiting items can delay older pending ones until their back-off clears.
````

- [ ] **Step 2: Update TODO, HANDOVER, SPEC, RUNBOOK_SYNC**

In `docs/TODO.md` replace:

```markdown
- [ ] **URGENT next capture: Story extras** (Stories vanish after 24 h): keep SWIPE_FORWARD from the `navigation` breakdown (currently dropped in `lib/instagram/metrics.ts`/`data.ts`), add `follows`, `profile_visits`, `profile_activity`. **CAUTION (learned from `reposts`): one unsupported metric in a batched insights request fails the WHOLE request** — Story support for these metrics is unverified (no live Story during probing), so fetch the extras in a SEPARATE non-fatal call (like `followerSnapshot` in `lib/sync/run-account.ts`) so the existing Story capture can never break; probe first while a Story is live.
- [ ] Per-media extras (Reels watch time/skip rate; feed follows/profile_visits), raw API response archive, comments ingestion, cover capture. (Newest-first backfill and immediate sync on connect: done, see §6a.)
```

with:

```markdown
- [x] **Story extras** _(Plan 11b: code done; live verification pending — docs/RUNBOOK_CAPTURE.md §3 "post a Story and run a probe")_: SWIPE_FORWARD kept (`media_metrics.swipe_forward`); `follows`, `profile_visits`, `profile_activity` each in a SEPARATE non-fatal call after the core Story snapshot, every 2 h of a Story's life + its last hour; support learned at runtime (`sync_state.capabilities`), never assumed.
- [x] **Per-media extras** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §4)_: feed/carousel follows + profile visits + profile activity, Reels avg/total watch time + skip rate, separate non-fatal calls after the core loop, 20 extra calls per account run, + the 7-day checkpoint snapshot.
- [x] **Media fields** _(Plan 11b; RUNBOOK_CAPTURE §5)_: `media_product_type`, `like_count`, `comments_count`, `is_shared_to_feed`, `children_count` + `media_children`.
- [x] **Cover capture** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §6)_: private bucket `covers`, Stories on first sight, posts/Reels backfilled newest first in lane 2 after the import, CDN allowlist/size/type/timeout, owner-only `GET /api/media/[id]/cover`, permanent delete removes the objects. Not yet: `MediaThumb` UI (Plan 12/13), carousel child covers.
- [x] **Comments ingestion** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §1 + §7; **each account must Reconnect once** to grant `instagram_business_manage_comments`)_: read only, gated on the scope stored at connect (`accounts.granted_scopes`), incremental by comment count, recent 30 days. Not yet: replies, hidden flag, moderation.
- [x] **Raw API response archive** _(Plan 11b; RUNBOOK_CAPTURE §8)_: `api_snapshots` (account insights + audience bodies, deduped by hash, ≤ 64 KB, kept forever).
- [ ] Owner: post a Story and run the probe (RUNBOOK_CAPTURE §3); Reconnect both accounts for comments (§1); then record the results in docs/META_PROBE_RESULTS.md.
```

In `docs/HANDOVER.md` replace:

```markdown
## 2. What to do next (approved design, not yet built)
```

with:

```markdown
## 1d. Plan 11b — capture extras (2026-10-22)
- Granted scopes stored at connect (`accounts.granted_scopes`; existing accounts backfilled with the two original scopes → they show "Reconnect to enable comments"); capability memory (`sync_state.capabilities`); Story extras + SWIPE_FORWARD; per-media extras + 7-day checkpoint; media fields + `media_children`; covers in the private `covers` bucket (Stories on first sight, posts in lane 2) + `GET /api/media/[id]/cover`; comments (`comments` table, scope-gated); raw archive (`api_snapshots`). Plan: `docs/superpowers/plans/2026-10-22-11b-capture-extras.md`.
- **Apply migration `20261022000001_capture_v2b.sql` BEFORE deploying the code** (it adds the columns, tables and the bucket the code writes).
- Live verification pending: docs/RUNBOOK_CAPTURE.md (post a Story and probe; Reconnect each account once for comments; cover route; storage sizes). Plan 11 is complete in code after this; next: Plan 12 (Time Scope + rollups + Explorer).

## 2. What to do next (approved design, not yet built)
```

In `docs/SPEC.md` replace:

```markdown
| `accounts` | id, ig_user_id (unique), username, group_name (nullable; null = isolated account), status (`active`/`needs_reconnect`/`archived`), archived_at, created_at, display_name, account_type, profile_picture_url, last_error, token_expires_at (non-secret copy of the token expiry, for the UI), connected_at |
```

with:

```markdown
| `accounts` | id, ig_user_id (unique), username, group_name (nullable; null = isolated account), status (`active`/`needs_reconnect`/`archived`), archived_at, created_at, display_name, account_type, profile_picture_url, last_error, token_expires_at (non-secret copy of the token expiry, for the UI), connected_at, granted_scopes text[] (what Meta reported at the last connect; null = unknown = not granted) |
```

In `docs/SPEC.md` replace:

```markdown
| `media` | id (IG media id), account_id, media_type (`IMAGE`/`CAROUSEL_ALBUM`/`REELS`/`STORY`), permalink, caption, posted_at, expires_at (stories), last_metrics_at, gone_at (deleted on Instagram; history kept) |
| `media_metrics` | media_id, captured_at (timestamptz), reach, views, likes, comments, shares, saves, total_interactions, replies, taps_forward, taps_back, exits — pk(media_id, captured_at); story-only columns null for other types |
```

with:

```markdown
| `media` | id (IG media id), account_id, media_type (`IMAGE`/`CAROUSEL_ALBUM`/`REELS`/`STORY`), permalink, caption, posted_at, expires_at (stories), last_metrics_at, gone_at (deleted on Instagram; history kept), media_product_type, like_count, comments_count, is_shared_to_feed, children_count, cover_path (Storage key `{account_id}/{media_id}.jpg` in the private bucket `covers`), cover_status (`pending`/`ok`/`unavailable`/`failed`), cover_captured_at, cover_attempts, cover_tried_at, comments_synced_count |
| `media_children` | media_id, position (0–9), media_type, cover_path, cover_status (child covers not captured yet) — pk(media_id, position) |
| `media_metrics` | media_id, captured_at (timestamptz), reach, views, likes, comments, shares, saves, total_interactions, replies, taps_forward, taps_back, exits, swipe_forward, follows, profile_visits, profile_activity jsonb (by action_type), avg_watch_ms, total_watch_ms, skip_rate — pk(media_id, captured_at); story-only columns null for other types; extras null when not captured (never 0) |
| `comments` | id (IG comment id), account_id, media_id, parent_id, author_username, author_id, text, like_count, commented_at, hidden, first_seen_at, last_seen_at — third-party personal data: owner-only, cascade-deleted with the account, never logged or exported by default |
| `api_snapshots` | id, account_id, endpoint (path + sorted params, no token), captured_at, body jsonb, body_hash — unique(account_id, endpoint, body_hash); raw account-insights + audience responses, ≤ 64 KB, kept forever |
```

In `docs/SPEC.md` replace:

```markdown
last_run jsonb (per-job last success; `backfill` = history import finished) |
```

with:

```markdown
last_run jsonb (per-job last success; `backfill` = history import finished), capabilities jsonb (optional metrics/fields learned at runtime: `true` served, `false` "unsupported"; reset with `'{}'`) |
```

In `docs/SPEC.md` replace:

```markdown
**Stories job (every tick):** for each `active` account, list live Stories, upsert into `media`, insert a `media_metrics` snapshot per story. Stories exist for 24h only, so a missed window is lost data; a 30-minute tick gives ~48 snapshots per story.
```

with:

```markdown
**Stories job (every tick):** for each `active` account, list live Stories, upsert into `media`, insert a `media_metrics` snapshot per story. Stories exist for 24h only, so a missed window is lost data; a 30-minute tick gives ~48 snapshots per story.

**Capture extras (Plan 11b):** every optional Meta metric or field is a SEPARATE, non-fatal call made after the core snapshot is stored (one unsupported metric fails a whole batched request); an "unsupported" answer is remembered in `sync_state.capabilities`, transient errors are not. Story job, after the snapshots: cover copy on first sight (URL from the listing; retried every pass while live, then `unavailable`), then Story extras (follows, profile visits, profile activity) every 2 h of the Story's life and in its last hour. Media metrics: after the core loop, feed/carousel extras (follows + profile visits, profile activity) and Reels extras (watch time, skip rate) within 20 extra calls per account run; plus a 7-day checkpoint snapshot. Lane 2 only, after the history import: `covers` (hourly, 25 posts/Reels per run, newest first, fresh URL per item, CDN allowlist + 5 MB + image types + 10 s, back-off then `unavailable`) and `comments` (hourly, only with the granted `instagram_business_manage_comments` scope — Meta returns an empty list without it — posts of the last 30 days whose comment count changed, ≤ 20 page calls per run). Raw account-insights and audience bodies are archived to `api_snapshots` (deduped, best-effort). Covers are served only by the owner-only route `GET /api/media/[id]/cover`; a permanent account delete removes the account's objects.
```

In `docs/RUNBOOK_SYNC.md` replace:

```markdown
## Known limits
```

with:

```markdown
> Plan 11b capture extras (Story/per-media extras, covers, comments, raw archive) have their own runbook: docs/RUNBOOK_CAPTURE.md.

## Known limits
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: PASS (docs only; nothing else changes). Then re-read `docs/TODO.md` §6c: every tick says "code done; live verification pending" where the owner still has to look.

- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK_CAPTURE.md docs/TODO.md docs/HANDOVER.md docs/SPEC.md docs/RUNBOOK_SYNC.md
git commit -m "docs: Plan 11b runbook (live capture checks, Story probe, comments reconnect), TODO, handover, SPEC §5/§6" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
