# Plan 11b: Data Capture v2 (remainder) — granted scopes, capability memory, Story + per-media extras, media fields, covers to private Storage, comments, raw archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture everything Instagram gives us that cannot be re-fetched later — Story extras (SWIPE_FORWARD, follows, profile visits, profile activity) while the Story is live, per-media extras (feed follows/profile visits/profile activity, Reels watch time/skip rate) with a 7-day checkpoint, the media fields we currently drop, cover images copied into a private Storage bucket (Stories on first sight), comments (only when the comments scope is really granted), and the raw JSON of account-level insights — without ever letting an extra break the core capture.

**Architecture:** One additive migration. The OAuth code exchange now returns the `permissions` Meta granted; they are stored on `accounts.granted_scopes` and `hasScope()` gates comments (an empty comments list is never taken as "no comments"). Every optional Meta call is a separate, non-fatal call; an "unsupported metric/field" answer (code 100 + a fixed message pattern, kept only as a boolean) is remembered in `sync_state.capabilities` so it is not re-requested, while transient errors never touch that memory. Story extras and Story covers run inside the Stories job AFTER the core capture; per-media extras run after the core media loop with a per-run call budget; post covers and comments are new lane-2-only jobs (`covers`, `comments`) that run after the history import and report the reserved progress stages. Raw account-insights bodies are archived (deduped by hash, size-capped) through a callback the data client calls; the archive write is best-effort and time-capped.

**Tech Stack:** Next.js 16 App Router (route handler), Supabase Postgres + RLS + Storage (private bucket, admin client only), next-intl 4, Vitest. **New dependencies: none** (`node:crypto` for the body hash, `fetch` for the CDN).

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b (Plan 11 scope, data policy), §4 (covers: data, Storage, serving, SSRF rules, delete), §5 (Post Lab metrics + 7-day checkpoint), §8 (cross-cutting); `docs/TODO.md` §6c; verified Meta facts `docs/META_PROBE_RESULTS.md` (authoritative); `docs/HANDOVER.md` §1b/§1c. Project rules: `CLAUDE.md` (binding).

**Dry run (2026-10-17):** every task's code was executed once, in order, in a throwaway clone outside the repo (fresh `npm ci`, from `main` 97625c6, no new packages). See "Dry-run result" at the end. Nothing touched Supabase or Meta.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

_(filled in below as tasks land)_

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

_(filled in below)_

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
