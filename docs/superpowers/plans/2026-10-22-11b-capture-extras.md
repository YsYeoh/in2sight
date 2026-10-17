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

  it('runAccount carries the stored map into its patch (nothing learned = unchanged)', async () => {
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig: fakeIg(), store: memoryStore().store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), capabilities: { 'story:follows': false } }, tz: 'UTC', now: new Date('2026-10-14T02:00:00Z'), deadline: 1, clock: () => 0 };
    const { patch } = await runAccount(c, ['stories']);
    expect(patch.capabilities).toEqual({ 'story:follows': false });
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
