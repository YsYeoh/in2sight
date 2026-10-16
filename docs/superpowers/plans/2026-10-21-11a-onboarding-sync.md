# Plan 11a: Onboarding sync — newest-first progressive backfill, fair lanes, sync progress panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A newly connected (or reconnected, or "Sync now") account fills Overview with real numbers within the first pass — profile and followers, then the newest 7 days, newest posts, Stories and audience, then days 8–90 newest to oldest and older posts — while every other account's regular capture keeps running first, and the owner sees an honest live progress panel (stages, counts, current activity, estimate, rate-limit/stall/error states) that survives reloads.

**Architecture:** `sync_state` gets a backward-moving edge `backfilled_from` next to the existing forward edge `daily_done_through` (every day between them is handled). A new job `backfill` (lane 2) walks days newest → oldest down to 90 days back, then measures older posts; the existing `daily` job does the newest 7 days first for a new account and keeps its regular "yesterday + last 3 days" refresh. `runTick` runs two lanes: lane 1 = regular jobs for ALL accounts with a small per-account slice (a new account only gets Stories there), lane 2 = everything left (onboarding + history) with equal slices across accounts that still have work. The runner writes a throttled, best-effort live row into a new owner-readable `sync_progress` table; a pure `lib/sync/progress.ts` turns persistent state + counts + the live row into stages, percent, phase (running/waiting/rate-limited/failed/stalled/done) and an estimate. An owner-only `GET /api/sync/progress` feeds a polling client hook used by a progress panel on `/accounts` and compact badges on account rows and Overview cards. Growth analysis marks windows that are still importing (`backfilling` reason + coverage) instead of comparing partial windows.

**Tech Stack:** Next.js 16 App Router (route handler, server actions, `after()`), React 19, Supabase Postgres + RLS (owner select via `public.is_owner()`, writes via the admin client), next-intl 4, Tailwind 4 + shadcn (`Progress`, `Badge`, `Card`, `Alert`), Vitest + Testing Library + jsdom. **New dependencies: none.**

**Spec:** `docs/TODO.md` §6a (owner requirements: onboarding sync, progress experience, progressive backfill, fair lanes) and `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Onboarding sync", "Progressive backfill"), §3 (InsightOrb), §8 (cross-cutting rules). Facts: `docs/META_PROBE_RESULTS.md`, `docs/HANDOVER.md` §1b. Project rules: `CLAUDE.md` (binding).

**Dry run (2026-10-17):** every task's code in this plan was executed once, in order, in a throwaway clone outside the repo (fresh `npm ci`, branch at `main` 0db8b09, no new packages): see the note at the end of the plan for the `npm run check` result. Nothing touched Supabase; no signed-in page was rendered (no Supabase project in the clone), so the panel's live behaviour is a runbook step (`docs/RUNBOOK_SYNC.md` §7).

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- ⚠ **Stories are captured in lane 1 before the newest week** (spec order puts "live Stories + audience" at step 4). A Story is lost after 24 h and the call is cheap; the follower snapshot that the Stories job takes IS step 1 (profile + follower count). Everything else follows the spec order: newest 7 days → post list → newest posts' metrics → audience → days 8–90 newest first → older posts.
- ⚠ **No 90-day `time_series` reach call.** It would save one call per day for `reach` only, but the daily job still needs per-day `total_value` calls for views/engagement/link taps/follows and the breakdowns (META_PROBE_RESULTS: only `reach` works as a series), and a series call cannot be resumed half-way or stored per day with the same "never fake zeros" guarantee without a second code path. Saving ~20 % of calls is not worth two backfill paths. Skipped; revisit if Meta's rate limit ever bites (it has not).
- ⚠ **Progress estimate = remaining work × measured call cost** (~1.5 s per day, ~0.4 s per post, from the 2026-10-16 debugging), not "observed rate since start": a reconnect or "Sync now" of a half-imported account starts at e.g. 50 %, so a rate measured from the session start would promise seconds for minutes of work. Shown as "about N min"; "estimating…" until the post list is known. Marked `ponytail:` in code.
- **Schema (one new migration, `supabase/migrations/20261021000001_sync_progress.sql`):** `sync_state.backfilled_from date` (backward edge) and table `sync_progress` (one row per account: `stage`, `state` waiting/running/failed/done, `done`, `total`, `detail_day`, `error_key`, `started_at`, `updated_at`, `finished_at`). The activity line's i18n key is derived from `stage` (one key per stage), so no `detail_key` column. Owner session: select only (RLS `is_owner()`), revoked from anon/authenticated + `grant select` like `20261019000001`; writes only through the admin client.
- **Existing accounts migrate without re-fetching:** the migration sets `backfilled_from` = their oldest `account_daily.day` and stamps `last_run.backfill`, so they count as complete. As a second net, any row with `daily_done_through` set and `backfilled_from` empty is also treated as complete in code (`isBackfilling`).
- **Lanes:** lane 1 slice = 8 s per account (`REGULAR_SLICE_MS`); lane 2 = the remaining tick budget split equally across accounts with work left, re-split after each account, at least `MIN_ACCOUNT_MS` (5 s). An account whose lane-1 slice ran out continues its regular jobs at the start of its lane-2 slice. An app-wide rate limit (code 4) stops the tick at once: lane 2 never starts, so it is always the first thing to stop. `more` (chain continuation) stays "stopped on the time budget with work left, never under a Meta rate limit".
- **Progress writes are best-effort:** throttled to one write per 3 s per account (plus stage changes and the final state), every write in try/catch, a failed write never fails or slows the sync; written only while an account is importing or during a manual run, so a complete account's 30-minute ticks never flash "Importing…".
- **Reconnect and "Sync now" reset only the live row** (`resetSyncProgress`: new `started_at`, `waiting`), never `sync_state` coverage; "Sync now" chains a continuation pass when its run stops on the time budget (same as connect).
- **Partial coverage:** `summarize()` reports `coverage` (days with reach ÷ period) per window; `kpis(s, { backfilling })` gives reason `backfilling` ("Importing history…") instead of `not_enough_history` while the account is importing. Overview cards keep showing real partial numbers with "Importing history… · N% of this period"; totals keep excluding non-`ok` accounts (Plan 6 fix-wave rule unchanged).
- **Polling, not Realtime:** `useSyncProgress` polls `GET /api/sync/progress` every 3 s while the tab is visible and an account is importing, backs off 3 → 6 → 12 → … 60 s on errors, stops when nothing is tracked, and calls `router.refresh()` whenever a stage completes (so Overview numbers appear as each step lands) and once at the end.

## Out of scope

Story extras, per-media extras, cover capture, comments ingestion, raw response archive, Explorer/Time Scope (later plans). Reading `X-Business-Use-Case-Usage`. Push/bell notification on import completion (the panel shows the summary; a notification needs an alert rule — later). Supabase Realtime.

## Global Constraints

- Ponytail: smallest thing that works; no abstraction with one implementation; **no new dependencies**.
- TypeScript strict. No Meta metric names change (`lib/instagram/metrics.ts` untouched).
- All DB changes in the NEW file `supabase/migrations/20261021000001_sync_progress.sql`; never edit an applied migration. RLS on the new table; owner select via `public.is_owner()`; `revoke all … from anon, authenticated; grant select … to authenticated`.
- Sync isolates failures per account; progress writes can never fail a sync. Tokens never appear in progress rows, route responses, logs or summaries.
- Server actions and pages call `await requireOwner()` first; route handlers call `assertOwner(h)` and copy `h` onto every response. `lib/auth/route-policy.ts` is NOT changed: `/api/sync/progress` stays session-protected (no new public exemption).
- Every UI string via next-intl, new keys in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation in Chinese sentences); `tests/messages.test.ts` enforces parity. Backend returns keys, not prose.
- Dates and numbers only via `lib/format.ts` (`formatDay`, `formatTime`, `formatNumber`, `formatPercent`).
- Theming: semantic tokens only; no hex/rgb in new files. Responsive 360/768/1280, CSS breakpoints only (no `matchMedia`). Density is un-layered: no `h-*`/`p-*` on shadcn Button/Card/Table cells.
- Tests deterministic: injected clock/timezone, fake timers restored in `afterEach`, Vitest timeout 20 s, jsdom stubs as in existing tests (`ResizeObserver`, pointer capture). Windows: create/modify files with the Write/Edit tools (not shell heredocs).
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **Reconnect (or "Sync now") while a backfill is half-way** — coverage must be kept and the import must resume where it stopped, never restart or re-fetch: → Task 9 "reconnect resets only the live row, never sync_state coverage" and Task 5 "resumes after a budget stop from the backward edge, never re-fetching a day".
2. **Two lanes + a Meta rate limit with 1 complete + 2 new accounts** — the complete account's Stories run first, new accounts split lane 2 fairly, an app-wide limit stops everything new and never chains, a per-account limit only removes that account: → Task 7 "1 old + 2 new accounts", "app-wide rate limit in lane 1: lane 2 never starts, no continuation", "a rate-limited account sits out lane 2; the others still import".
3. **Progress writes failing (DB hiccup, missing table before the migration is applied)** must never fail, stop or slow the sync: → Task 6 "a failing progress write never throws and never stops the job" and Task 7 "progress table missing: the tick still syncs every account".
4. **A crashed/killed run (lease expired, no fresh write)** must show "waiting" and then "stalled", never "running" forever: → Task 3 "a lease that expired with no fresh write is not running forever".
5. **Partial coverage at the window boundary and day boundaries in other time zones** — a window at exactly 80 % coverage, a backfill walking across a DST change, an account under 100 followers whose follows/breakdown calls come back empty: → Task 10 "coverage boundary: 6 of 7 days compares, 5 of 7 says importing" and Task 5 "walks across a DST change with correct local-midnight boundaries" and "empty follows/breakdown (under 100 followers) writes nulls, never zeros".

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261021000001_sync_progress.sql` (new) | `sync_state.backfilled_from`, existing rows marked complete, table `sync_progress` + RLS |
| `lib/sync/schedule.ts` (modify) | `backfilledFrom`, `isBackfilling`, `firstWeekPending`, job `backfill`, lanes in `dueJobs`, old-post cap in `pickDueMedia` |
| `lib/sync/progress.ts` (new) | pure progress model: stages, weights → percent, phase, estimate, `isTracked` |
| `lib/sync/store.ts` (modify) | persist `backfilled_from`, `writeProgress`, `resetSyncProgress`, `SyncStatus.backfilling` |
| `lib/sync/run-account.ts` (modify) | newest-first walk (`walkBack`), `daily` first-week branch, `backfill` job, shared `captureMedia`, progress reports |
| `lib/sync/progress-sink.ts` (new) | throttled, never-throwing live progress writer used by the runner |
| `lib/sync/tick.ts` (modify) | two lanes with slices, progress sink wiring, merged per-account summary |
| `lib/sync/progress-read.ts` (new) | owner-session read of state + live rows + counts → `AccountProgress[]` |
| `app/api/sync/progress/route.ts` (new) | `GET` owner-only JSON (counts/keys only) |
| `app/api/instagram/callback/route.ts`, `app/(app)/accounts/actions.ts` (modify) | reset live progress on reconnect / "Sync now"; "Sync now" chains |
| `lib/analysis/growth.ts`, `lib/dashboard/overview.ts`, `lib/dashboard/account.ts` (modify) | coverage per window, `backfilling` reason, card state from `SyncStatus.backfilling` |
| `components/accounts/useSyncProgress.ts` (new) | polling hook (visibility, back-off, refresh on stage completion) |
| `components/accounts/SyncProgressPanel.tsx`, `components/accounts/SyncBadge.tsx` (new) | panel (checklist, activity, estimate, live region) and compact badge |
| `components/accounts/AccountsView.tsx`, `app/(app)/accounts/(list)/page.tsx`, `components/overview/OverviewView.tsx`, `app/(app)/overview/page.tsx` (modify) | wiring: panel + badges + coverage note |
| `messages/en.json`, `messages/zh-CN.json` (modify) | `sync.*` namespace, `analysis.coverage` |
| `tests/fixtures/sync-fakes.ts` (modify) | `writeProgress` in the memory store |
| `docs/RUNBOOK_SYNC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/SPEC.md` (modify) | newest-first order, lanes, reading `sync_progress`, debugging a stalled sync; honest ticks |

## Tasks

1. Migration: `backfilled_from` + `sync_progress` (+ migration test)
2. Schedule: backward edge, `backfill` job, lanes, old-post cap
3. Pure progress model (`lib/sync/progress.ts`)
4. Store: persist the backward edge, live progress writes, `SyncStatus.backfilling`
5. Runner: newest-first walk, `backfill` job, shared media capture
6. Progress sink + runner reports
7. Fair lanes in `runTick`
8. Progress read + `GET /api/sync/progress`
9. Reconnect and "Sync now" reuse the progress mechanics
10. Partial coverage in growth analysis and Overview
11. `useSyncProgress` polling hook
12. `SyncProgressPanel` + `SyncBadge` + i18n
13. Wire panel and badges into Accounts and Overview
14. Docs: runbook, TODO, handover, SPEC

---

### Task 1: Migration — `backfilled_from` + `sync_progress`

**Files:**
- Create: `supabase/migrations/20261021000001_sync_progress.sql`
- Test: `tests/sync-progress-migration.test.ts` (new)

**Interfaces:**
- Consumes: tables `sync_state`, `account_daily`, `accounts`, function `public.is_owner()` (earlier migrations).
- Produces: column `sync_state.backfilled_from date`; table `sync_progress(account_id uuid pk, stage text null, state text, done int, total int null, detail_day date null, error_key text null, started_at, updated_at, finished_at)`. Stage values: `profile|stories|account_days|posts_list|post_metrics|audience|covers|comments`; state values: `waiting|running|failed|done`. Tasks 4 and 8 read/write exactly these column names.

- [ ] **Step 1: Write the failing test** — create `tests/sync-progress-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261021000001_sync_progress.sql'), 'utf8').replace(/--.*$/gm, '');
const body = sql.match(/create\s+table\s+public\.sync_progress\s*\(([\s\S]*?)\r?\n\);/i)?.[1] ?? '';

describe('sync progress migration', () => {
  it('adds the backward edge to sync_state without touching the forward edge', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.sync_state\s+add\s+column\s+backfilled_from\s+date\s*;/i);
    expect(sql).not.toMatch(/drop\s+column/i);
  });

  it('marks accounts synced before this plan as complete (oldest stored day, backfill stamped) and nothing else', () => {
    const update = sql.match(/update\s+public\.sync_state[\s\S]*?;/i)?.[0] ?? '';
    expect(update).toMatch(/min\(d\.day\)\s+from\s+public\.account_daily/i);
    expect(update).toMatch(/'backfill'/);
    expect(update).toMatch(/where\s+s\.daily_done_through\s+is\s+not\s+null/i);
  });

  it('sync_progress: one row per account, cascades with it, every stage the sync writes (and the reserved covers/comments) is allowed', () => {
    expect(body).toMatch(/account_id\s+uuid\s+primary\s+key\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    for (const s of ['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience', 'covers', 'comments']) expect(body, s).toContain(`'${s}'`);
    expect(body).toMatch(/state\s+in\s*\(\s*'waiting'\s*,\s*'running'\s*,\s*'failed'\s*,\s*'done'\s*\)/i);
    expect(body).not.toMatch(/token|caption|media_id/i);
  });

  it('owner session reads only: RLS, revoked from anon/authenticated, select granted, one select policy on is_owner()', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.sync_progress\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.sync_progress\s+from\s+anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.sync_progress\s+to\s+authenticated/i);
    const policies = [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on\s+public\.sync_progress\s+for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-progress-migration.test.ts`
Expected: FAIL — `ENOENT … 20261021000001_sync_progress.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261021000001_sync_progress.sql`:

```sql
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
```

- [ ] **Step 4: Run the migration tests**

Run: `npx vitest run tests/sync-progress-migration.test.ts tests/migrations.test.ts`
Expected: PASS (the global `migrations.test.ts` checks RLS + policy on every table, no anon policy, `to authenticated`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261021000001_sync_progress.sql tests/sync-progress-migration.test.ts
git commit -m "feat(db): sync_state.backfilled_from and owner-readable sync_progress" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schedule — backward edge, `backfill` job, lanes, old-post cap

**Files:**
- Modify: `lib/sync/schedule.ts`
- Modify: `lib/sync/run-account.ts` (one line: temporary `backfill` runner, replaced in Task 5)
- Modify: `tests/sync-schedule.test.ts` (one expectation), `tests/sync-tick.test.ts` (one expectation)
- Test: `tests/sync-onboarding-schedule.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces (all in `lib/sync/schedule.ts`):
  - `FIRST_DAYS = 7`, `NEWEST_POSTS = 10`
  - `JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'tokenRefresh']`, `type JobKind` (now includes `'backfill'`)
  - `type Lane = 'regular' | 'all'`
  - `SyncState.backfilledFrom: string | null` (and `emptyState` sets it to `null`)
  - `isBackfilling(s: Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom'>): boolean`
  - `firstWeekPending(s: Pick<SyncState, 'dailyDoneThrough' | 'backfilledFrom'>, today: string): boolean`
  - `dueJobs(input, now, tz, opts?: { manual?: boolean; lane?: Lane }): JobKind[]` (default lane = `'all'`, i.e. old behaviour + `backfill`)
  - `pickDueMedia(refs: MediaRef[], now: Date, oldMax = NEWEST_POSTS): string[]`

- [ ] **Step 1: Write the failing test** — create `tests/sync-onboarding-schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dueJobs, emptyState, firstWeekPending, isBackfilling, pickDueMedia, type ScheduleInput, type SyncState } from '@/lib/sync/schedule';

const TZ = 'Asia/Kuala_Lumpur'; // UTC+8
const NOW = new Date('2026-10-14T02:00:00Z'); // 10:00 local, local day 2026-10-14
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const input = (state: SyncState, o: Partial<ScheduleInput> = {}): ScheduleInput => ({ status: 'active', tokenExpiresAt: '2026-12-01T00:00:00Z', state, ...o });
const st = (o: Partial<SyncState> = {}): SyncState => ({ ...emptyState('a1'), ...o });

describe('isBackfilling / firstWeekPending', () => {
  it('a new account is backfilling and its first week is pending', () => {
    expect(isBackfilling(st())).toBe(true);
    expect(firstWeekPending(st(), '2026-10-14')).toBe(true);
  });

  it('half-way through the newest week: still pending; the week is complete once 7 days back is reached', () => {
    expect(firstWeekPending(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-10' }), '2026-10-14')).toBe(true);
    expect(firstWeekPending(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }), '2026-10-14')).toBe(false);
  });

  it('a row synced before this plan (done-through set, backfilled_from empty) is complete: never re-fetched', () => {
    const legacy = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: null });
    expect(isBackfilling(legacy)).toBe(false);
    expect(firstWeekPending(legacy, '2026-10-14')).toBe(false);
  });

  it('the import is done once the backfill job has finished once', () => {
    expect(isBackfilling(st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: minsAgo(5) } }))).toBe(false);
  });
});

describe('dueJobs lanes', () => {
  it('lane 1 gives a brand-new account only its time-critical jobs; lane 2 runs the onboarding in order', () => {
    expect(dueJobs(input(st()), NOW, TZ, { lane: 'regular' })).toEqual(['stories']);
    expect(dueJobs(input(st()), NOW, TZ)).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
  });

  it('once the newest week is in, lane 1 runs the regular jobs and never the history import', () => {
    const importing = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-09-20', lastAttemptAt: minsAgo(30), lastRun: { stories: minsAgo(40), daily: minsAgo(60), mediaList: minsAgo(70), audience: minsAgo(60) } });
    expect(dueJobs(input(importing), NOW, TZ, { lane: 'regular' })).toEqual(['stories', 'mediaList', 'mediaMetrics']);
    expect(dueJobs(input(importing), NOW, TZ)).toEqual(['stories', 'mediaList', 'mediaMetrics', 'backfill']);
  });

  it('a first week stopped half-way keeps daily due at any hour (03:00 local), in lane 2 only', () => {
    const early = new Date('2026-10-13T19:00:00Z');
    const half = st({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-11', lastRun: { stories: minsAgo(500) } });
    expect(dueJobs(input(half), early, TZ)).toContain('daily');
    expect(dueJobs(input(half), early, TZ, { lane: 'regular' })).not.toContain('daily');
  });

  it('token refresh stays in lane 1 even for a new account; a rate-limited account gets nothing in either lane', () => {
    expect(dueJobs(input(st(), { tokenExpiresAt: '2026-10-20T00:00:00Z' }), NOW, TZ, { lane: 'regular' })).toEqual(['stories', 'tokenRefresh']);
    const limited = st({ lastErrorKey: 'rate_limited', consecutiveFailures: 1, lastAttemptAt: minsAgo(5) });
    expect(dueJobs(input(limited), NOW, TZ, { lane: 'regular' })).toEqual([]);
    expect(dueJobs(input(limited), NOW, TZ)).toEqual([]);
  });

  it('a legacy (pre-Plan-11a) complete account never gets the backfill job', () => {
    const legacy = st({ dailyDoneThrough: '2026-10-13', lastRun: { stories: minsAgo(10), daily: minsAgo(60), mediaList: minsAgo(10), audience: minsAgo(60) } });
    expect(dueJobs(input(legacy), NOW, TZ)).toEqual(['mediaMetrics']);
  });
});

describe('pickDueMedia old-post cap', () => {
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  it('takes every recent post but only the newest N never-measured posts older than 30 days', () => {
    const refs = [
      { id: 'recent', postedAt: daysAgo(3), lastMetricsAt: null },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `old${i}`, postedAt: daysAgo(40 + i), lastMetricsAt: null })),
    ];
    expect(pickDueMedia(refs, NOW, 2)).toEqual(['recent', 'old0', 'old1']);
    expect(pickDueMedia(refs, NOW, Infinity)).toHaveLength(6);
    expect(pickDueMedia(refs, NOW)).toHaveLength(6); // default cap (10) is above 5
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-onboarding-schedule.test.ts`
Expected: FAIL — `firstWeekPending` / `isBackfilling` are not exported.

- [ ] **Step 3: Implement in `lib/sync/schedule.ts`** (five edits)

(a) Constants — replace

```ts
export const BACKFILL_DAYS = 90; // first connect: account insights this far back (Meta keeps ~90 days)
export const SETTLE_DAYS = 3; // Instagram data can lag up to 48h: re-fetch the last 3 days every day
```

with

```ts
export const BACKFILL_DAYS = 90; // first connect: account insights this far back (Meta keeps ~90 days)
export const FIRST_DAYS = 7; // onboarding: the newest week first (KPIs + sparkline), before posts and older history
export const NEWEST_POSTS = 10; // never-measured posts older than 30 days the regular media job takes per run (newest first)
export const SETTLE_DAYS = 3; // Instagram data can lag up to 48h: re-fetch the last 3 days every day
```

(b) Jobs, lanes, state — replace the block from `/** Run order inside one account: …` through the closing `}` of `export const emptyState = … });` with:

```ts
/**
 * Run order inside one account: time-critical first, token refresh last (the current token stays valid). It is also the
 * onboarding order of a new account: newest week (daily) -> post list -> newest posts' metrics -> audience -> older
 * history (backfill: days 8–90 newest first, then older posts' metrics; later plans append covers and comments there).
 */
export const JOBS = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill', 'tokenRefresh'] as const;
export type JobKind = (typeof JOBS)[number];

/** regular = lane 1 (every account, small slice, never the history import); all = lane 2 / single-lane callers. */
export type Lane = 'regular' | 'all';

export interface SyncState {
  accountId: string;
  leaseUntil: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastErrorKey: string | null;
  /** Newest insight day handled (forward edge). Every day from backfilledFrom to here is handled. */
  dailyDoneThrough: string | null;
  /** Oldest insight day handled by the newest-first import (backward edge); null = not started. */
  backfilledFrom: string | null;
  lastRun: Partial<Record<JobKind, string>>; // ISO time of each job's last success
}

export const emptyState = (accountId: string): SyncState => ({
  accountId,
  leaseUntil: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  lastErrorKey: null,
  dailyDoneThrough: null,
  backfilledFrom: null,
  lastRun: {},
});

/**
 * The history import (days 8–90, older posts) still has work. A row synced before Plan 11a (daily_done_through set,
 * backfilled_from never written) finished the old oldest-first backfill: it counts as complete and is never re-fetched.
 */
export function isBackfilling(s: Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom'>): boolean {
  return !s.lastRun.backfill && !(s.dailyDoneThrough !== null && s.backfilledFrom === null);
}

/** The newest FIRST_DAYS days are not all in yet (new account, or its first pass stopped half-way). */
export function firstWeekPending(s: Pick<SyncState, 'dailyDoneThrough' | 'backfilledFrom'>, today: string): boolean {
  return !s.dailyDoneThrough || (s.backfilledFrom !== null && s.backfilledFrom > addDays(today, -FIRST_DAYS));
}
```

(c) `dueJobs` — replace the whole function with:

```ts
export function dueJobs({ status, tokenExpiresAt, state: s }: ScheduleInput, now: Date, tz: string, opts: { manual?: boolean; lane?: Lane } = {}): JobKind[] {
  if (status !== 'active') return []; // archived and needs_reconnect accounts are never synced
  const t = now.getTime();
  if (s.leaseUntil && Date.parse(s.leaseUntil) > t) return []; // another tick holds this account
  const ago = (iso: string | null | undefined) => (iso ? t - Date.parse(iso) : Infinity);
  const atLeast = (iso: string | null | undefined, ms: number) => ago(iso) >= ms - SLACK_MIN * MIN;
  if (!opts.manual && s.lastErrorKey === 'rate_limited' && !atLeast(s.lastAttemptAt, backoffMs(s.consecutiveFailures))) return [];

  const today = localDay(now, tz);
  const afterDailyHour = localHour(now, tz) >= DAILY_HOUR;
  const ranToday = (iso: string | undefined) => !!iso && localDay(new Date(iso), tz) === today;
  const due = new Set<JobKind>();

  if (opts.manual || atLeast(s.lastRun.stories, STORIES_EVERY_MIN * MIN)) due.add('stories');
  // behind = newest week not in yet (new account) or a day was missed: catch up now, whatever the hour
  const firstWeek = firstWeekPending(s, today);
  const behind = firstWeek || s.dailyDoneThrough! < addDays(today, -2);
  if (behind || (afterDailyHour && !ranToday(s.lastRun.daily))) due.add('daily');
  if (opts.manual || atLeast(s.lastRun.mediaList, MEDIA_LIST_EVERY_MIN * MIN)) due.add('mediaList');
  due.add('mediaMetrics'); // cheap when nothing is due: pickDueMedia decides per post
  if (!s.lastRun.audience || (afterDailyHour && !ranToday(s.lastRun.audience))) due.add('audience');
  if (isBackfilling(s)) due.add('backfill');
  const expires = tokenExpiresAt ? Date.parse(tokenExpiresAt) : NaN;
  if (!Number.isNaN(expires) && expires - t <= TOKEN_REFRESH_WITHIN_DAYS * 24 * HOUR && atLeast(s.lastRun.tokenRefresh, TOKEN_RETRY_HOURS * HOUR)) due.add('tokenRefresh');

  const jobs = JOBS.filter((j) => due.has(j));
  if (opts.lane !== 'regular') return jobs;
  // lane 1 never imports history; a new account gets only its time-critical jobs there, its onboarding runs in lane 2
  return jobs.filter((j) => j !== 'backfill' && (!firstWeek || j === 'stories' || j === 'tokenRefresh'));
}
```

(d) `pickDueMedia` — replace the whole function (and its doc comment) with:

```ts
/**
 * Feed/Reels media needing a snapshot now, newest first: never captured, hourly under 48h, daily under 30d. Of the
 * never-captured posts older than 30 days only the newest `oldMax` are taken (the rest is the history import's job).
 */
export function pickDueMedia(refs: MediaRef[], now: Date, oldMax = NEWEST_POSTS): string[] {
  const t = now.getTime();
  const slack = SLACK_MIN * MIN;
  let old = 0;
  return refs
    .filter((r) => {
      if (!r.lastMetricsAt) return true;
      const age = t - Date.parse(r.postedAt);
      const since = t - Date.parse(r.lastMetricsAt);
      if (age < MEDIA_HOURLY_UNDER_HOURS * HOUR) return since >= HOUR - slack;
      if (age < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR) return since >= 24 * HOUR - slack;
      return false;
    })
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
    .filter((r) => r.lastMetricsAt !== null || t - Date.parse(r.postedAt) < MEDIA_DAILY_UNDER_DAYS * 24 * HOUR || old++ < oldMax)
    .map((r) => r.id);
}
```

(e) `lib/sync/run-account.ts` must still compile (`JOB_RUNNERS` is `Record<JobKind, Job>`). Replace

```ts
const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, tokenRefresh };
```

with (temporary; Task 5 replaces `backfill` with the real job in the next-but-two commit)

```ts
const JOB_RUNNERS: Record<JobKind, Job> = { stories, daily, mediaList, mediaMetrics, audience, backfill: async () => ({ done: true }), tokenRefresh };
```

- [ ] **Step 4: Update the two existing expectations that list every job of a new account**

In `tests/sync-schedule.test.ts` (test "a brand-new active account is due for everything except token refresh"), replace

```ts
    expect(dueJobs(input(emptyState('a1')), NOW, TZ)).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience']);
```

with

```ts
    expect(dueJobs(input(emptyState('a1')), NOW, TZ)).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
```

In `tests/sync-tick.test.ts` (test "runs every due job for each active account…"), replace

```ts
    expect(s.accounts[0].jobs).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience']);
```

with

```ts
    expect(s.accounts[0].jobs).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync-onboarding-schedule.test.ts tests/sync-schedule.test.ts tests/sync-tick.test.ts tests/sync-run-account.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. (`sync-run-account` still runs the old forward `daily` on an empty state: `firstWeekPending` is not used by the runner yet.)

- [ ] **Step 6: Commit**

```bash
git add lib/sync/schedule.ts lib/sync/run-account.ts tests/sync-onboarding-schedule.test.ts tests/sync-schedule.test.ts tests/sync-tick.test.ts
git commit -m "feat(sync): backward coverage edge, backfill job and lanes in the schedule" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure progress model (`lib/sync/progress.ts`)

**Files:**
- Create: `lib/sync/progress.ts`
- Test: `tests/sync-progress.test.ts` (new)

**Interfaces:**
- Consumes: `SyncState`, `isBackfilling`, `backoffMs`, `BACKFILL_DAYS` from `lib/sync/schedule.ts` (Task 2).
- Produces (used by Tasks 4, 6, 8, 11–13):
  - `STAGES` (`'profile' | 'stories' | 'account_days' | 'posts_list' | 'post_metrics' | 'audience'`), `RESERVED_STAGES` (`'covers' | 'comments'`), `type ShownStage`, `type Stage`, `type LiveState = 'waiting' | 'running' | 'failed' | 'done'`
  - `interface LiveProgress { stage: Stage | null; state: LiveState; done: number; total: number | null; detailDay: string | null; errorKey: string | null; startedAt: string; updatedAt: string; finishedAt: string | null }`
  - `type ProgressState`, `interface ProgressInput { accountId; needsReconnect: boolean; state: ProgressState; live: LiveProgress | null; posts: { total: number; measured: number }; followers: number | null }`
  - `type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'`, `interface StageView { stage: ShownStage; state: StageState; done: number | null; total: number | null; reason: string | null }`
  - `type Phase = 'running' | 'waiting' | 'rate_limited' | 'needs_reconnect' | 'failed' | 'stalled' | 'done'`
  - `interface AccountProgress { accountId; phase; percent; stages: StageView[]; current: { stage: Stage; day: string | null; done: number; total: number | null } | null; startedAt: string | null; elapsedMs: number | null; etaMs: number | null; resumeInMs: number | null; errorKey: string | null; summary: { days: number; posts: number } }`
  - `coveredDays(s): number`, `isTracked(i, now): boolean`, `buildProgress(i: ProgressInput, now: Date): AccountProgress`
  - constants `WEIGHTS`, `ACTIVE_MS = 90_000`, `STALL_MS = 35 min`, `RECENT_MS = 10 min`

- [ ] **Step 1: Write the failing test** — create `tests/sync-progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProgress, coveredDays, isTracked, type LiveProgress, type ProgressInput } from '@/lib/sync/progress';
import { emptyState } from '@/lib/sync/schedule';

const NOW = new Date('2026-10-14T02:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const live = (o: Partial<LiveProgress> = {}): LiveProgress => ({ stage: null, state: 'waiting', done: 0, total: null, detailDay: null, errorKey: null, startedAt: ago(MIN), updatedAt: ago(1_000), finishedAt: null, ...o });
const input = (o: Partial<ProgressInput> = {}, state: Partial<ProgressInput['state']> = {}): ProgressInput => ({
  accountId: 'a1',
  needsReconnect: false,
  state: { ...emptyState('a1'), ...state },
  live: null,
  posts: { total: 0, measured: 0 },
  followers: null,
  ...o,
});
const stage = (p: ReturnType<typeof buildProgress>, s: string) => p.stages.find((x) => x.stage === s)!;

describe('coveredDays', () => {
  it('counts handled days between the two edges, 0 before anything, 90 for a pre-Plan-11a row', () => {
    expect(coveredDays({ dailyDoneThrough: null, backfilledFrom: null })).toBe(0);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' })).toBe(7);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-05-01' })).toBe(90);
    expect(coveredDays({ dailyDoneThrough: '2026-10-13', backfilledFrom: null })).toBe(90);
  });
});

describe('buildProgress', () => {
  it('right after connect: waiting, 0 %, every stage pending, no estimate yet', () => {
    const p = buildProgress(input({ live: live() }), NOW);
    expect(p.phase).toBe('waiting');
    expect(p.percent).toBe(0);
    expect(p.stages.map((s) => s.state)).toEqual(Array(6).fill('pending'));
    expect(p.etaMs).toBeNull();
    expect(p.elapsedMs).toBe(MIN);
  });

  it('while importing days: running, the live day count beats the saved edge, current activity names the day', () => {
    const p = buildProgress(
      input({ followers: 1520, live: live({ stage: 'account_days', state: 'running', done: 30, total: 90, detailDay: '2026-09-14' }) }, { lastRun: { stories: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }),
      NOW,
    );
    expect(p.phase).toBe('running');
    expect(stage(p, 'account_days')).toEqual({ stage: 'account_days', state: 'running', done: 30, total: 90, reason: null });
    expect(p.current).toEqual({ stage: 'account_days', day: '2026-09-14', done: 30, total: 90 });
    expect(p.percent).toBe(21); // (2 + 3 + 50 × 30/90) of 100
  });

  it('half-finished history with posts listed: honest estimate from the remaining days and posts', () => {
    const p = buildProgress(input({ posts: { total: 40, measured: 10 }, live: live({ stage: 'account_days', state: 'running', done: 60, total: 90 }) }, { lastRun: { stories: ago(MIN), mediaList: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-08-15' }), NOW);
    expect(p.etaMs).toBe(30 * 1_500 + 30 * 400);
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'pending', done: 10, total: 40 });
  });

  it('a lease that expired with no fresh write is not "running forever": waiting, then stalled after 35 min', () => {
    const run = (mins: number) => buildProgress(input({ live: live({ stage: 'account_days', state: 'running', updatedAt: ago(mins * MIN) }) }, { lastAttemptAt: ago(mins * MIN), leaseUntil: ago(1_000), dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-01' }), NOW);
    expect(run(2).phase).toBe('waiting');
    expect(run(2).current).toBeNull();
    expect(run(40).phase).toBe('stalled');
  });

  it('a held lease counts as running even between writes', () => {
    expect(buildProgress(input({ live: live({ state: 'waiting', updatedAt: ago(5 * MIN) }) }, { leaseUntil: new Date(NOW.getTime() + MIN).toISOString() }), NOW).phase).toBe('running');
  });

  it('rate limited: says when the back-off ends (2 failures = 60 min after the last attempt)', () => {
    const p = buildProgress(input({ live: live() }, { lastErrorKey: 'rate_limited', consecutiveFailures: 2, lastAttemptAt: ago(10 * MIN) }), NOW);
    expect(p.phase).toBe('rate_limited');
    expect(p.resumeInMs).toBe(50 * MIN);
    expect(p.errorKey).toBe('rate_limited');
  });

  it('failed: the stage that was running carries the error key', () => {
    const p = buildProgress(input({ posts: { total: 5, measured: 1 }, live: live({ stage: 'post_metrics', state: 'failed' }) }, { lastErrorKey: 'instagram_error', consecutiveFailures: 1, lastRun: { mediaList: ago(MIN) } }), NOW);
    expect(p.phase).toBe('failed');
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'failed', reason: 'instagram_error' });
  });

  it('needs reconnect beats everything', () => {
    const p = buildProgress(input({ needsReconnect: true, live: live({ stage: 'stories' }) }), NOW);
    expect(p).toMatchObject({ phase: 'needs_reconnect', errorKey: 'token_invalid' });
    expect(stage(p, 'stories').state).toBe('failed');
  });

  it('skips with a reason: no posts at all, audience under 100 followers', () => {
    const p = buildProgress(input({ followers: 42, live: live() }, { lastRun: { mediaList: ago(MIN), audience: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' }), NOW);
    expect(stage(p, 'post_metrics')).toMatchObject({ state: 'skipped', reason: 'no_posts' });
    expect(stage(p, 'audience')).toMatchObject({ state: 'skipped', reason: 'needs_100_followers' });
  });

  it('never shows 100 % before the import is really finished; finished = 100 % with a summary', () => {
    const almost = buildProgress(input({ followers: 500, posts: { total: 3, measured: 3 }, live: live({ state: 'waiting' }) }, { lastRun: { stories: ago(MIN), mediaList: ago(MIN), audience: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' }), NOW);
    expect(almost.percent).toBe(99);
    const finished = buildProgress(input({ posts: { total: 3, measured: 3 }, live: live({ state: 'done', finishedAt: ago(MIN) }) }, { lastRun: { backfill: ago(MIN), mediaList: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' }), NOW);
    expect(finished).toMatchObject({ phase: 'done', percent: 100, etaMs: null, summary: { days: 90, posts: 3 } });
  });
});

describe('isTracked', () => {
  const doneState = { ...emptyState('a1'), lastRun: { backfill: ago(MIN) }, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' };
  it('importing accounts and unfinished runs are shown; a finished run for 10 minutes; a quiet complete account never', () => {
    expect(isTracked({ state: emptyState('a1'), live: null }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live() }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live({ state: 'done', finishedAt: ago(9 * MIN) }) }, NOW)).toBe(true);
    expect(isTracked({ state: doneState, live: live({ state: 'done', finishedAt: ago(11 * MIN) }) }, NOW)).toBe(false);
    expect(isTracked({ state: { ...emptyState('a1'), dailyDoneThrough: '2026-10-13' }, live: null }, NOW)).toBe(false);
  });

  it('a "Sync now" that found the account leased ends when that other tick succeeds (not "waiting" forever)', () => {
    const session = live({ state: 'waiting', startedAt: ago(20 * MIN), updatedAt: ago(20 * MIN) });
    const after = { ...doneState, lastSuccessAt: ago(15 * MIN) };
    expect(buildProgress(input({ live: session }, after), NOW).phase).toBe('done');
    expect(isTracked({ state: after, live: session }, NOW)).toBe(false); // ended 15 min ago
    expect(buildProgress(input({ live: session }, { ...doneState, lastSuccessAt: ago(30 * MIN) }), NOW).phase).toBe('waiting');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-progress.test.ts`
Expected: FAIL — cannot resolve `@/lib/sync/progress`.

- [ ] **Step 3: Implement** — create `lib/sync/progress.ts`:

```ts
// Sync progress as the panel and badges show it. Pure: `now` and `today` (owner-timezone day) are inputs.
// Persistent truth (sync_state coverage + counts) drives the stage checklist and the percentage; the live sync_progress
// row (written by the running sync, docs/RUNBOOK_SYNC.md) adds the current activity, start time and fresh day counts.
import { backoffMs, BACKFILL_DAYS, isBackfilling, type SyncState } from '@/lib/sync/schedule';

/** Panel order. Reserved stages (later plans: cover images, comments) are valid in the table but not shown yet. */
export const STAGES = ['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience'] as const;
export const RESERVED_STAGES = ['covers', 'comments'] as const;
export type ShownStage = (typeof STAGES)[number];
export type Stage = ShownStage | (typeof RESERVED_STAGES)[number];
export type LiveState = 'waiting' | 'running' | 'failed' | 'done';

/** One sync_progress row: the live activity of the current run. Counts and keys only, never ids of media or tokens. */
export interface LiveProgress {
  stage: Stage | null;
  state: LiveState;
  done: number;
  total: number | null;
  detailDay: string | null;
  errorKey: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type ProgressState = Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom' | 'leaseUntil' | 'lastAttemptAt' | 'lastSuccessAt' | 'lastErrorKey' | 'consecutiveFailures'>;

export interface ProgressInput {
  accountId: string;
  needsReconnect: boolean;
  state: ProgressState;
  live: LiveProgress | null;
  posts: { total: number; measured: number }; // feed + Reels not gone; measured = has a metrics snapshot (or was skipped for good)
  followers: number | null; // latest follower snapshot
}

export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';
export interface StageView {
  stage: ShownStage;
  state: StageState;
  done: number | null;
  total: number | null;
  reason: string | null; // i18n key: skip reason or sync error key
}
export type Phase = 'running' | 'waiting' | 'rate_limited' | 'needs_reconnect' | 'failed' | 'stalled' | 'done';

export interface AccountProgress {
  accountId: string;
  phase: Phase;
  percent: number; // 0–100, 100 only when done
  stages: StageView[];
  current: { stage: Stage; day: string | null; done: number; total: number | null } | null;
  startedAt: string | null;
  elapsedMs: number | null;
  etaMs: number | null; // null = "estimating"
  resumeInMs: number | null; // rate limited: time until the back-off ends
  errorKey: string | null;
  summary: { days: number; posts: number };
}

export const WEIGHTS: Record<ShownStage, number> = { profile: 2, stories: 3, account_days: 50, posts_list: 5, post_metrics: 35, audience: 5 };
/** The sync writes at least every few seconds while working: an older row is not "running now". */
export const ACTIVE_MS = 90_000;
/** A tick comes every 30 minutes; no activity for longer than this while work is left = stalled. */
export const STALL_MS = 35 * 60_000;
/** Show a finished run's summary for this long after it ends. */
export const RECENT_MS = 10 * 60_000;
/** Measured live 2026-10-16 (docs/RUNBOOK_SYNC.md): ~5 calls per day ≈ 1.5 s, one insights call per post ≈ 0.4 s. */
const MS_PER_DAY = 1_500;
const MS_PER_POST = 400;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Insight days of the BACKFILL_DAYS window handled so far (backfilledFrom … dailyDoneThrough). */
export function coveredDays(s: Pick<SyncState, 'dailyDoneThrough' | 'backfilledFrom'>): number {
  if (!s.dailyDoneThrough) return 0;
  if (!s.backfilledFrom) return BACKFILL_DAYS; // synced before Plan 11a: the old backfill finished
  return Math.max(0, Math.min(BACKFILL_DAYS, daysBetween(s.backfilledFrom, s.dailyDoneThrough) + 1));
}

/**
 * When the live session ended: its own finish stamp or, for a complete account whose run another tick did (a "Sync now"
 * that found the account leased), the last success after the session started. null = still going.
 */
function sessionEnd({ state: s, live }: Pick<ProgressInput, 'state' | 'live'>): string | null {
  if (!live) return null;
  if (live.finishedAt) return live.finishedAt;
  const doneElsewhere = !isBackfilling(s) && live.state !== 'running' && !!s.lastSuccessAt && Date.parse(s.lastSuccessAt) >= Date.parse(live.startedAt);
  return doneElsewhere ? s.lastSuccessAt : null;
}

/** Worth showing: history still importing, a run not finished, or a run that finished a few minutes ago. */
export function isTracked(i: Pick<ProgressInput, 'state' | 'live'>, now: Date): boolean {
  if (isBackfilling(i.state)) return true;
  if (!i.live) return false;
  const end = sessionEnd(i);
  return end === null || now.getTime() - Date.parse(end) < RECENT_MS;
}

export function buildProgress(i: ProgressInput, now: Date): AccountProgress {
  const t = now.getTime();
  const { state: s, live } = i;
  const backfilling = isBackfilling(s);
  const covered = Math.max(coveredDays(s), live?.stage === 'account_days' && live.state === 'running' ? Math.min(live.done, BACKFILL_DAYS) : 0);
  const lastActivity = Math.max(live ? Date.parse(live.updatedAt) : 0, s.lastAttemptAt ? Date.parse(s.lastAttemptAt) : 0);
  const failing = s.consecutiveFailures > 0 && !!s.lastErrorKey;

  let phase: Phase;
  if (i.needsReconnect) phase = 'needs_reconnect';
  else if (!backfilling && (!live || live.state === 'done' || sessionEnd(i) !== null)) phase = 'done';
  else if (failing && s.lastErrorKey === 'rate_limited') phase = 'rate_limited';
  else if (failing) phase = 'failed';
  else if ((s.leaseUntil && Date.parse(s.leaseUntil) > t) || (live?.state === 'running' && t - Date.parse(live.updatedAt) < ACTIVE_MS)) phase = 'running';
  else if (lastActivity === 0 || t - lastActivity < STALL_MS) phase = 'waiting';
  else phase = 'stalled';

  const runningStage = phase === 'running' ? (live?.stage ?? null) : null;
  const failedStage = phase === 'failed' || phase === 'needs_reconnect' ? (live?.stage ?? null) : null;
  const errorKey = phase === 'needs_reconnect' ? 'token_invalid' : failing ? s.lastErrorKey : (live?.errorKey ?? null);
  const pending = (done: number | null = null, total: number | null = null) => ({ state: 'pending' as const, done, total, reason: null });
  const done = (d: number | null = null, total: number | null = null) => ({ state: 'done' as const, done: d, total, reason: null });
  const skipped = (reason: string) => ({ state: 'skipped' as const, done: null, total: null, reason });

  const base: Record<ShownStage, Omit<StageView, 'stage'>> = {
    profile: i.followers !== null || s.lastRun.stories ? done() : pending(),
    stories: s.lastRun.stories ? done() : pending(),
    account_days: !backfilling || covered >= BACKFILL_DAYS ? done(covered, BACKFILL_DAYS) : pending(covered, BACKFILL_DAYS),
    posts_list: s.lastRun.mediaList ? done() : pending(),
    post_metrics:
      s.lastRun.mediaList && i.posts.total === 0
        ? skipped('no_posts')
        : !backfilling || (i.posts.total > 0 && i.posts.measured >= i.posts.total)
          ? done(i.posts.measured, i.posts.total)
          : pending(i.posts.measured, i.posts.total || null),
    audience: s.lastRun.audience ? (i.followers !== null && i.followers < 100 ? skipped('needs_100_followers') : done()) : pending(),
  };
  const stages: StageView[] = STAGES.map((stage) => {
    const b = base[stage];
    if (b.state !== 'pending') return { stage, ...b };
    if (stage === failedStage) return { stage, ...b, state: 'failed', reason: errorKey };
    if (stage === runningStage) return { stage, ...b, state: 'running' };
    return { stage, ...b };
  });

  const frac = (v: StageView) => (v.state === 'done' || v.state === 'skipped' ? 1 : v.total ? Math.min(1, (v.done ?? 0) / v.total) : 0);
  const sumW = STAGES.reduce((n, st) => n + WEIGHTS[st], 0);
  const percent = phase === 'done' ? 100 : Math.min(99, Math.floor((stages.reduce((n, v) => n + WEIGHTS[v.stage] * frac(v), 0) / sumW) * 100));

  const startedAt = live?.startedAt ?? null;
  const active = phase === 'running' || phase === 'waiting';
  const remaining = (BACKFILL_DAYS - covered) * MS_PER_DAY + Math.max(0, i.posts.total - i.posts.measured) * MS_PER_POST;
  return {
    accountId: i.accountId,
    phase,
    percent,
    stages,
    current: phase === 'running' && live?.stage ? { stage: live.stage, day: live.detailDay, done: live.done, total: live.total } : null,
    startedAt,
    elapsedMs: startedAt ? Math.max(0, t - Date.parse(startedAt)) : null,
    // ponytail: estimate from measured per-call costs; switch to the observed rate once runs record their start counts
    etaMs: active && backfilling && s.lastRun.mediaList ? remaining : null,
    resumeInMs: phase === 'rate_limited' && s.lastAttemptAt ? Math.max(0, Date.parse(s.lastAttemptAt) + backoffMs(s.consecutiveFailures) - t) : null,
    errorKey,
    summary: { days: covered, posts: i.posts.measured },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/sync-progress.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/progress.ts tests/sync-progress.test.ts
git commit -m "feat(sync): pure progress model (stages, percent, phase, estimate)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Store — persist the backward edge, live progress writes, `SyncStatus.backfilling`

**Files:**
- Modify: `lib/sync/store.ts`
- Modify: `lib/sync/tick.ts` (two `saveState` calls), `lib/sync/run-account.ts` (one line in the patch)
- Modify: `tests/fixtures/sync-fakes.ts`, `tests/sync-store.test.ts` (three fixtures)
- Test: `tests/sync-store-progress.test.ts` (new)

**Interfaces:**
- Consumes: `isBackfilling`, `SyncState.backfilledFrom` (Task 2); `Stage`, `LiveState` (Task 3); table/columns from Task 1.
- Produces (in `lib/sync/store.ts`):
  - `StatePatch.backfilledFrom: string | null` (required)
  - `interface ProgressWrite { stage: Stage | null; state: LiveState; done: number; total: number | null; detailDay: string | null; errorKey: string | null; updatedAt: string; finishedAt?: string | null }`
  - `SyncStore.writeProgress(accountId: string, p: ProgressWrite): Promise<void>` (throws `sync store: writeProgress failed` on error)
  - `resetSyncProgress(db: SupabaseClient, accountId: string, nowIso: string): Promise<void>` (never throws)
  - `SyncStatus.backfilledFrom?: string | null`, `SyncStatus.backfilling?: boolean`
  - memory fake: `memoryStore(...).progress: { accountId: string; p: ProgressWrite }[]`

- [ ] **Step 1: Write the failing test** — create `tests/sync-store-progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { listSyncStatus, resetSyncProgress, rowToState, supabaseSyncStore } from '@/lib/sync/store';

type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][] };

/** Records every query-builder call; each awaited query resolves to the next queued result (default: ok, no data). */
function recorder(results: { data?: unknown; error?: unknown }[] = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = (...a: unknown[]) => ((call.op = op), call.args.push(...a), chain);
      chain.select = (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain);
      for (const f of ['eq', 'neq', 'in', 'is', 'or', 'limit']) chain[f] = (...a: unknown[]) => (call.filters.push([f, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const NOW = '2026-10-14T02:00:00.000Z';

describe('backward edge (backfilled_from)', () => {
  it('is read from the row and written back with the state', async () => {
    expect(rowToState({ account_id: 'a1', backfilled_from: '2026-09-01' }).backfilledFrom).toBe('2026-09-01');
    expect(rowToState({ account_id: 'a1' }).backfilledFrom).toBeNull();
    const r = recorder();
    await supabaseSyncStore(r.db).saveState('a1', 'L1', { lastAttemptAt: NOW, consecutiveFailures: 0, lastErrorKey: null, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-09-01', lastRun: {} });
    expect(r.calls[0].args[0]).toMatchObject({ daily_done_through: '2026-10-13', backfilled_from: '2026-09-01' });
  });
});

describe('live progress writes', () => {
  it('upserts one row per account with counts and keys only; finished_at only when given', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.writeProgress('a1', { stage: 'account_days', state: 'running', done: 12, total: 90, detailDay: '2026-09-02', errorKey: null, updatedAt: NOW });
    expect(r.calls[0]).toMatchObject({ table: 'sync_progress', op: 'upsert', args: [{ account_id: 'a1', stage: 'account_days', state: 'running', done: 12, total: 90, detail_day: '2026-09-02', error_key: null, updated_at: NOW }, { onConflict: 'account_id' }] });
    expect(r.calls[0].args[0]).not.toHaveProperty('finished_at');
    expect(r.calls[0].args[0]).not.toHaveProperty('started_at'); // a run never moves the session start
    await s.writeProgress('a1', { stage: 'audience', state: 'done', done: 1, total: 1, detailDay: null, errorKey: null, updatedAt: NOW, finishedAt: NOW });
    expect(r.calls[1].args[0]).toMatchObject({ finished_at: NOW });
  });

  it('a failed write throws a fixed message (the sink swallows it)', async () => {
    const r = recorder([{ error: { message: 'relation "sync_progress" does not exist' } }]);
    await expect(supabaseSyncStore(r.db).writeProgress('a1', { stage: null, state: 'waiting', done: 0, total: null, detailDay: null, errorKey: null, updatedAt: NOW })).rejects.toThrow('sync store: writeProgress failed');
  });

  it('resetSyncProgress starts a new session (start time, waiting, unfinished) and never throws', async () => {
    const r = recorder();
    await resetSyncProgress(r.db, 'a1', NOW);
    expect(r.calls[0]).toMatchObject({ table: 'sync_progress', op: 'upsert', args: [{ account_id: 'a1', stage: null, state: 'waiting', done: 0, started_at: NOW, finished_at: null, error_key: null }, { onConflict: 'account_id' }] });
    expect(r.calls.some((c) => c.table === 'sync_state')).toBe(false); // coverage is never reset
    await expect(resetSyncProgress({} as never, 'a1', NOW)).resolves.toBeUndefined();
  });
});

describe('listSyncStatus backfilling flag', () => {
  it('new accounts are importing, finished and pre-Plan-11a accounts are not', async () => {
    const r = recorder([
      {
        data: [
          { account_id: 'new', consecutive_failures: 0, daily_done_through: null, backfilled_from: null, last_run: {} },
          { account_id: 'half', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: '2026-09-20', last_run: { daily: NOW } },
          { account_id: 'done', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: '2026-07-16', last_run: { backfill: NOW } },
          { account_id: 'legacy', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: null, last_run: { daily: NOW } },
        ],
      },
    ]);
    const s = await listSyncStatus(r.db);
    expect(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.backfilling]))).toEqual({ new: true, half: true, done: false, legacy: false });
    expect(s.half.backfilledFrom).toBe('2026-09-20');
    expect(r.calls[0].args[0]).toContain('backfilled_from');
    expect(r.calls[0].args[0]).toContain('last_run');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-store-progress.test.ts`
Expected: FAIL — `resetSyncProgress` is not exported / `writeProgress` is not a function.

- [ ] **Step 3: Implement in `lib/sync/store.ts`** (seven edits)

(a) Imports — replace

```ts
import { emptyState, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';
```

with

```ts
import type { LiveState, Stage } from '@/lib/sync/progress';
import { emptyState, isBackfilling, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';
```

(b) `StatePatch` + new `ProgressWrite` — replace

```ts
  dailyDoneThrough: string | null;
  lastRun: Partial<Record<JobKind, string>>;
}
```

(the end of `interface StatePatch`) with

```ts
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
  lastRun: Partial<Record<JobKind, string>>;
}

/** One live progress write (sync_progress row). started_at comes from resetSyncProgress or the insert default. */
export interface ProgressWrite {
  stage: Stage | null;
  state: LiveState;
  done: number;
  total: number | null;
  detailDay: string | null;
  errorKey: string | null;
  updatedAt: string;
  finishedAt?: string | null; // omitted = keep the stored value
}
```

(c) `SyncStore` interface — replace

```ts
  recordRun(run: SyncRun): Promise<void>;
}
```

with

```ts
  recordRun(run: SyncRun): Promise<void>;
  /** Upserts the account's live progress row. Callers treat it as best-effort (lib/sync/progress-sink.ts). */
  writeProgress(accountId: string, p: ProgressWrite): Promise<void>;
}
```

(d) `rowToState` — after the line `    dailyDoneThrough: (r.daily_done_through as string | null) ?? null,` add

```ts
    backfilledFrom: (r.backfilled_from as string | null) ?? null,
```

(e) `saveState` — after the line `        daily_done_through: p.dailyDoneThrough,` add

```ts
        backfilled_from: p.backfilledFrom,
```

(f) `supabaseSyncStore` — after the `recordRun` method (before the closing `};` of the returned object) add

```ts
    async writeProgress(accountId, p) {
      const row: Row = { account_id: accountId, stage: p.stage, state: p.state, done: p.done, total: p.total, detail_day: p.detailDay, error_key: p.errorKey, updated_at: p.updatedAt };
      if (p.finishedAt !== undefined) row.finished_at = p.finishedAt;
      check('writeProgress')(await db.from('sync_progress').upsert(row, { onConflict: 'account_id' }));
    },
```

(g) Replace everything from `export interface SyncStatus {` to the end of the file with

```ts
/**
 * Reconnect / "Sync now": a fresh live progress row (new start time, waiting, nothing finished). Never touches sync_state
 * coverage, so an import resumes where it stopped. Admin client; best-effort, never throws.
 */
export async function resetSyncProgress(db: SupabaseClient, accountId: string, nowIso: string): Promise<void> {
  try {
    const row = { account_id: accountId, stage: null, state: 'waiting', done: 0, total: null, detail_day: null, error_key: null, started_at: nowIso, updated_at: nowIso, finished_at: null };
    await db.from('sync_progress').upsert(row, { onConflict: 'account_id' });
  } catch {
    // the sync writes the row itself on its first progress report
  }
}

export interface SyncStatus {
  lastSuccessAt: string | null;
  lastErrorKey: string | null;
  consecutiveFailures: number;
  dailyDoneThrough?: string | null; // null until the first insight day is written
  backfilledFrom?: string | null;
  backfilling?: boolean; // history still importing (isBackfilling in lib/sync/schedule.ts); missing = unknown
}

/** Owner-session read for the Accounts page (RLS: owner select). Never throws: the page still renders without it. */
export async function listSyncStatus(db: SupabaseClient): Promise<Record<string, SyncStatus>> {
  const { data, error } = await db.from('sync_state').select('account_id,last_success_at,last_error_key,consecutive_failures,daily_done_through,backfilled_from,last_run');
  if (error || !data) return {};
  return Object.fromEntries(
    (data as Row[]).map((r) => {
      const s = rowToState(r);
      return [s.accountId, { lastSuccessAt: s.lastSuccessAt, lastErrorKey: s.lastErrorKey, consecutiveFailures: s.consecutiveFailures, dailyDoneThrough: s.dailyDoneThrough, backfilledFrom: s.backfilledFrom, backfilling: isBackfilling(s) }];
    }),
  );
}
```

- [ ] **Step 4: Keep the callers compiling**

`lib/sync/tick.ts`: in BOTH `saveState(...)` calls, replace `dailyDoneThrough: fresh.dailyDoneThrough, lastRun: fresh.lastRun` with `dailyDoneThrough: fresh.dailyDoneThrough, backfilledFrom: fresh.backfilledFrom, lastRun: fresh.lastRun`.

`lib/sync/run-account.ts`: in the `patch` object at the end of `runAccount`, after `    dailyDoneThrough: progress.dailyDoneThrough,` add

```ts
    backfilledFrom: c.state.backfilledFrom,
```

(Task 5 changes this to the runner's moving edge.)

`tests/fixtures/sync-fakes.ts` (memory store gets `writeProgress`):
- replace `import type { StatePatch, SyncRun, SyncStore } from '@/lib/sync/store';` with `import type { ProgressWrite, StatePatch, SyncRun, SyncStore } from '@/lib/sync/store';`
- after `  const saved: { accountId: string; patch: StatePatch }[] = [];` add `  const progress: { accountId: string; p: ProgressWrite }[] = [];`
- after `    recordRun: async (r) => void runs.push(r),` add `    writeProgress: async (accountId, p) => void progress.push({ accountId, p }),`
- in the final `return { store, … saved };` add `progress` to the returned object: `return { store, states, media, daily, followers, metrics, audience, online, snapshots, breakdowns, runs, saved, progress };`

`tests/sync-store.test.ts` (patch objects now need the new field; the status row has two new fields):
- replace `dailyDoneThrough: '2026-10-13', lastRun: { stories: NOW } });` with `dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { stories: NOW } });`
- replace `dailyDoneThrough: null, lastRun: {} });` with `dailyDoneThrough: null, backfilledFrom: null, lastRun: {} });`
- replace `toEqual({ a1: { lastSuccessAt: NOW, lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: null } });` with `toEqual({ a1: { lastSuccessAt: NOW, lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: null, backfilledFrom: null, backfilling: true } });`

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync-store-progress.test.ts tests/sync-store.test.ts tests/sync-tick.test.ts tests/sync-run-account.test.ts tests/dashboard-read.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/store.ts lib/sync/tick.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-store.test.ts tests/sync-store-progress.test.ts
git commit -m "feat(sync): persist backfilled_from, live progress writes, SyncStatus.backfilling" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Runner — newest-first walk, `backfill` job, shared media capture

**Files:**
- Modify: `lib/sync/run-account.ts`
- Modify: `tests/sync-run-account.test.ts` (three `daily job` tests rewritten), `tests/sync-capture-v2.test.ts` (one test)
- Test: `tests/sync-backfill.test.ts` (new)

**Interfaces:**
- Consumes: `FIRST_DAYS`, `firstWeekPending`, `pickDueMedia(refs, now, oldMax)`, `BACKFILL_DAYS` (Task 2); `StatePatch.backfilledFrom` (Task 4).
- Produces: the real `backfill` job in `JOB_RUNNERS`; `runAccount` patches carry the moved `backfilledFrom`/`dailyDoneThrough`. Internal helpers (not exported, Task 6 adds progress reports inside them): `fetchDay(c, day)`, `walkBack(c, p, floor)`, `captureMedia(c, ids)`. Behaviour:
  - `daily` on a new account (or a first week stopped half-way): days yesterday → today−7, newest first; then only days that began meanwhile; then today's follower count.
  - `daily` on an account whose first week is in: unchanged (missed days + last 3 days re-fetch).
  - `backfill`: days from the backward edge − 1 down to today − 90 (newest first), then every never-measured post (newest first); a pre-Plan-11a row returns done at once.
  - `mediaMetrics`: recent posts on their cadence + the newest 10 never-measured older posts.

- [ ] **Step 1: Write the failing test** — create `tests/sync-backfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore, type MemoryInit } from './fixtures/sync-fakes';

const KL = 'Asia/Kuala_Lumpur';
const NOW = new Date('2026-10-14T02:00:00Z'); // 10:00 local, local day 2026-10-14
const DAY = { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };

function ctx(o: { state?: Partial<SyncState>; media?: MemoryInit['media']; budgetCalls?: number; tz?: string; now?: Date } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: o.media });
  const acc = account({ id: 'a1' });
  let calls = 0;
  const c: RunContext = {
    ig,
    store: mem.store,
    accounts: fakeAccounts([acc]).accounts,
    account: acc,
    token: 'IGQ-secret',
    state: { ...emptyState('a1'), ...o.state },
    tz: o.tz ?? KL,
    now: o.now ?? NOW,
    deadline: 1_000,
    clock: () => (o.budgetCalls === undefined ? 0 : calls++ < o.budgetCalls ? 0 : 1_000),
  };
  return { c, ig, mem };
}
const run = (c: RunContext, jobs: JobKind[]) => runAccount(c, jobs);
const ONBOARDING: JobKind[] = ['daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill'];

describe('newest-first progressive backfill', () => {
  it('a new account gets its 90 days newest first: the newest week, then 6 Oct back to 16 Jul', async () => {
    const { c, mem } = ctx();
    const { result, patch } = await run(c, ONBOARDING);
    expect(result.outcome).toBe('ok');
    const days = mem.daily.map((d) => d.day);
    expect(days).toHaveLength(90);
    expect(days.slice(0, 8)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07', '2026-10-06']);
    expect(days.at(-1)).toBe('2026-07-16');
    expect([...days].sort().reverse()).toEqual(days); // strictly newest -> oldest
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' });
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('resumes after a budget stop from the backward edge, never re-fetching a day', async () => {
    const first = ctx({ budgetCalls: 25 });
    const a = await run(first.c, ONBOARDING);
    expect(a.result.outcome).toBe('partial');
    const second = ctx({ state: { ...emptyState('a1'), ...a.patch } });
    const b = await run(second.c, ['backfill']); // daily finished in the first pass (lastRun.daily), so only the history job is due
    expect(b.result.outcome).toBe('ok');
    const all = [...first.mem.daily, ...second.mem.daily].map((d) => d.day);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(90);
    expect(second.ig.accountDay.mock.calls.length).toBe(90 - first.mem.daily.length);
  });

  it('an account synced before this plan (done-through set, no backward edge) is complete: nothing is re-fetched', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-13', backfilledFrom: null } });
    const { result, patch } = await run(c, ['backfill']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['backfill'] });
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(patch.backfilledFrom).toBeNull();
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('empty follows/breakdown (under 100 followers) writes nulls, never zeros', async () => {
    const { c, ig, mem } = ctx();
    const written: unknown[] = [];
    const upsert = mem.store.upsertDaily;
    mem.store.upsertDaily = async (id, day, v) => (written.push(v), upsert(id, day, v));
    ig.accountDay.mockResolvedValue({ ...DAY, follows: null, unfollows: null, linkTaps: null });
    ig.accountDayBreakdown.mockResolvedValue([]);
    await run(c, ['daily']);
    expect(written).toHaveLength(7);
    expect(written.every((v) => (v as typeof DAY).follows === null && (v as typeof DAY).linkTaps === null)).toBe(true);
    expect(mem.breakdowns.every((b) => b.rows === 0)).toBe(true); // the real store skips an empty list
  });

  it('walks across a DST change with correct local-midnight boundaries (New York, clocks back on 1 Nov 2026)', async () => {
    const { c, ig } = ctx({ tz: 'America/New_York', now: new Date('2026-11-03T15:00:00Z'), state: {} });
    await run(c, ['daily']);
    const ranges = ig.accountDay.mock.calls.slice(0, 3).map(([, since, until]) => [new Date(since * 1000).toISOString(), (until - since) / 3600]);
    expect(ranges).toEqual([
      ['2026-11-02T05:00:00.000Z', 24], // 2 Nov, EST
      ['2026-11-01T04:00:00.000Z', 25], // 1 Nov: 25-hour day
      ['2026-10-31T04:00:00.000Z', 24], // 31 Oct, EDT
    ]);
  });

  it('posts: the regular media job takes recent + the newest 10 old posts; the history job takes the rest, newest first', async () => {
    const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
    const media = [{ id: 'recent', accountId: 'a1', postedAt: daysAgo(2), lastMetricsAt: null }, ...Array.from({ length: 15 }, (_, i) => ({ id: `old${String(i).padStart(2, '0')}`, accountId: 'a1', postedAt: daysAgo(40 + i), lastMetricsAt: null }))];
    const { c, ig } = ctx({ media, state: { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' } });
    await run(c, ['mediaMetrics']);
    expect(ig.feedInsights.mock.calls.map((a) => a[1])).toEqual(['recent', ...Array.from({ length: 10 }, (_, i) => `old${String(i).padStart(2, '0')}`)]);
    ig.feedInsights.mockClear();
    const { patch } = await run(c, ['backfill']);
    expect(ig.feedInsights.mock.calls.map((a) => a[1])).toEqual(['old10', 'old11', 'old12', 'old13', 'old14']);
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });

  it('a rate limit during the history walk stops it with the edge kept, and it is not marked done', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' } });
    let n = 0;
    ig.accountDay.mockImplementation(async () => {
      if (++n === 4) throw new InstagramApiError('data', 400, 80002);
      return DAY;
    });
    const { result, patch } = await run(c, ['backfill']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    expect(patch.backfilledFrom).toBe('2026-10-04');
    expect(patch.lastRun.backfill).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-backfill.test.ts`
Expected: FAIL — the first test sees 90 days written oldest first (or the stub `backfill` does nothing), the DST test sees 90 calls.

- [ ] **Step 3: Implement in `lib/sync/run-account.ts`** (six edits)

(a) Import — replace

```ts
import { BACKFILL_DAYS, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, type JobKind, type SyncState } from '@/lib/sync/schedule';
```

with

```ts
import { BACKFILL_DAYS, FIRST_DAYS, firstWeekPending, MEDIA_BACKFILL_MAX, MEDIA_DAILY_UNDER_DAYS, MEDIA_RECENT_MAX, SETTLE_DAYS, pickDueMedia, type JobKind, type SyncState } from '@/lib/sync/schedule';
```

(b) `Progress` — replace

```ts
/** Progress that must survive a job failing half-way (e.g. 40 backfill days written, then a 5xx). */
interface Progress {
  dailyDoneThrough: string | null;
}
```

with

```ts
/** Coverage edges that must survive a job failing half-way (e.g. 40 history days written, then a 5xx). */
interface Progress {
  dailyDoneThrough: string | null;
  backfilledFrom: string | null;
}
```

(c) Replace the whole `daily` job (from `/** Account insights day by day: …` through its closing `};`) with:

```ts
/** One insight day: account totals + the follower-type x format split. Nothing Instagram did not send is written as 0. */
async function fetchDay(c: RunContext, day: string): Promise<void> {
  const { since, until } = dayRangeSec(day, c.tz);
  try {
    await c.store.upsertDaily(c.account.id, day, await c.ig.accountDay(c.token, since, until));
  } catch (e) {
    // ponytail: Meta does not document how far back each metric goes; an "other" error on a day older than 30 days is
    // treated as "no data that far back" and skipped so the backfill cannot wedge. Tighten once the runbook confirms.
    if (!(classifyIgError(e) === 'other' && day < addDays(localDay(c.now, c.tz), -30))) throw e;
  }
  try {
    await c.store.upsertDailyBreakdown(c.account.id, day, await c.ig.accountDayBreakdown(c.token, since, until));
  } catch (e) {
    if (fatal(e)) throw e; // the follower/non-follower split is an extra; an unsupported day must not wedge the backfill
  }
}

/**
 * Newest-first walk from the day before the backward edge (or yesterday) down to `floor`. Both edges move after every
 * day, so a stop (time budget, error) resumes exactly where it left off and no day is fetched twice.
 */
async function walkBack(c: RunContext, p: Progress, floor: string): Promise<{ done: boolean }> {
  const yesterday = addDays(localDay(c.now, c.tz), -1);
  for (let day = p.backfilledFrom ? addDays(p.backfilledFrom, -1) : yesterday; day >= floor; day = addDays(day, -1)) {
    if (outOfTime(c)) return { done: false };
    await fetchDay(c, day);
    p.dailyDoneThrough ??= day;
    p.backfilledFrom = day;
  }
  return { done: true };
}

/**
 * Account insights by day. New account: the newest FIRST_DAYS days, newest first (KPIs within the first pass). After
 * that: missed days, and a re-fetch of the last SETTLE_DAYS (data lags up to 48h), then today's follower count.
 */
const daily: Job = async (c, p) => {
  const today = localDay(c.now, c.tz);
  const yesterday = addDays(today, -1);
  let day: string;
  if (firstWeekPending(p, today)) {
    if (!(await walkBack(c, p, addDays(today, -FIRST_DAYS))).done) return { done: false };
    day = addDays(p.dailyDoneThrough!, 1); // the week was just fetched: no settle re-fetch, only a day that began meanwhile
  } else {
    const settleFrom = addDays(yesterday, -(SETTLE_DAYS - 1));
    const next = addDays(p.dailyDoneThrough!, 1);
    day = next < settleFrom ? next : settleFrom;
  }
  for (; day <= yesterday; day = addDays(day, 1)) {
    if (outOfTime(c)) return { done: false };
    await fetchDay(c, day);
    if (day > p.dailyDoneThrough!) p.dailyDoneThrough = day;
  }
  const { followersCount } = await c.ig.profile(c.token);
  if (followersCount !== null) await c.store.upsertFollowers(c.account.id, today, followersCount);
  return { done: true };
};
```

(d) Media metrics — replace the head of the old job

```ts
const mediaMetrics: Job = async (c) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  const due = pickDueMedia(await c.store.mediaForMetrics(c.account.id, since), c.now);
  const at = c.now.toISOString();
```

with

```ts
async function captureMedia(c: RunContext, due: string[]): Promise<{ done: boolean }> {
  const at = c.now.toISOString();
```

and change the first line of its doc comment from ` * Snapshots for media that are due (pickDueMedia, newest first). Per-post outcomes of the insights call:` to ` * Snapshots for the given media (newest first). Per-post outcomes of the insights call:`. Then replace the end of that function

```ts
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
};

/** Demographics
```

with

```ts
  } finally {
    await c.store.markCaptured(captured, at);
  }
  return { done: true };
}

/** Recent posts on their cadence plus the newest NEWEST_POSTS never-measured older posts (onboarding step 3). */
const mediaMetrics: Job = async (c) => {
  const since = new Date(c.now.getTime() - MEDIA_DAILY_UNDER_DAYS * DAY_MS).toISOString();
  return captureMedia(c, pickDueMedia(await c.store.mediaForMetrics(c.account.id, since), c.now));
};

/**
 * History import (lane 2), newest first: insight days down to BACKFILL_DAYS back, then every never-measured older post.
 * Done once both are through. Extension point: later plans append cover capture and comments here.
 */
const backfill: Job = async (c, p) => {
  if (p.dailyDoneThrough !== null && p.backfilledFrom === null) return { done: true }; // synced before Plan 11a: complete
  if (!(await walkBack(c, p, addDays(localDay(c.now, c.tz), -BACKFILL_DAYS))).done) return { done: false };
  const refs = await c.store.mediaForMetrics(c.account.id, c.now.toISOString()); // since = now: only never-measured media
  return captureMedia(c, pickDueMedia(refs, c.now, Infinity));
};

/** Demographics
```

(e) Runners — replace `backfill: async () => ({ done: true }), tokenRefresh };` with `backfill, tokenRefresh };`.

(f) `runAccount` — replace `  const progress: Progress = { dailyDoneThrough: c.state.dailyDoneThrough };` with `  const progress: Progress = { dailyDoneThrough: c.state.dailyDoneThrough, backfilledFrom: c.state.backfilledFrom };` and, in the patch, `    backfilledFrom: c.state.backfilledFrom,` with `    backfilledFrom: progress.backfilledFrom,`.

- [ ] **Step 4: Rewrite the existing tests that assumed the oldest-first backfill**

In `tests/sync-run-account.test.ts`, `describe('daily job')`: replace the test `'first connect backfills BACKFILL_DAYS of account insights up to yesterday, then snapshots followers on today'` with

```ts
  it('first connect fetches the newest 7 days, newest first, then snapshots followers on today', async () => {
    const { c, ig, mem } = ctx();
    const { result, patch } = await run(c, ['daily']);
    expect(result).toEqual({ accountId: 'a1', outcome: 'ok', jobs: ['daily'] });
    expect(ig.accountDay).toHaveBeenCalledTimes(7);
    expect(mem.daily.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07']);
    expect(mem.followers).toEqual([{ accountId: 'a1', day: '2026-10-14', followers: 1520 }]);
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' });
    expect(patch.lastRun.daily).toBe(NOW.toISOString());
  });
```

and replace the three tests `'stops at the time budget, keeps progress, and the job stays due (no lastRun)'`, `'keeps backfill progress when a transient error hits half-way'` and `'skips days older than 30 days that Instagram rejects (unknown retention), but not recent ones'` with

```ts
  it('stops at the time budget, keeps both edges, and the job stays due (no lastRun)', async () => {
    const { c, mem } = ctx({ budgetCalls: 4 }); // 1 check in runAccount + 3 days
    const { result, patch } = await run(c, ['daily']);
    expect(result.outcome).toBe('partial');
    expect(mem.daily.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11']);
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-11', consecutiveFailures: 0 });
    expect(patch.lastRun.daily).toBeUndefined();
  });

  it('keeps history progress when a transient error hits half-way', async () => {
    const { c, ig } = ctx({ state: { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-10-07' } });
    let n = 0;
    ig.accountDay.mockImplementation(async () => {
      if (++n === 41) throw igErr(2, 500);
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const { result, patch } = await run(c, ['backfill']);
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'instagram_unavailable' });
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-08-28', consecutiveFailures: 1 }); // 40 days: 6 Oct back to 28 Aug
  });

  it('skips days older than 30 days that Instagram rejects (unknown retention): the edge moves on, nothing is written for them', async () => {
    const { c, ig, mem } = ctx();
    ig.accountDay.mockImplementation(async (_t: string, since: number) => {
      if (since < Date.parse('2026-08-31T16:00:00Z') / 1000) throw igErr(100); // before 1 Sep (local midnight)
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const { result, patch } = await run(c, ['daily', 'backfill']);
    expect(result.outcome).toBe('ok');
    expect(mem.daily.at(-1)!.day).toBe('2026-09-01');
    expect(patch).toMatchObject({ dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16' });
    expect(patch.lastRun.backfill).toBe(NOW.toISOString());
  });
```

(The test `'passes owner-timezone day boundaries as unix seconds'` stays as it is: its state has `dailyDoneThrough` and no backward edge, i.e. a pre-Plan-11a row on the regular path.)

In `tests/sync-capture-v2.test.ts`, test `'stores the split for every backfilled day'`, replace

```ts
    await run(c, ['daily']);
    expect(ig.accountDayBreakdown).toHaveBeenCalledTimes(90);
    expect(mem.breakdowns).toHaveLength(90);
    expect(mem.breakdowns[0]).toEqual({ accountId: 'a1', day: '2026-07-16', rows: 2 });
```

with

```ts
    await run(c, ['daily', 'backfill']);
    expect(ig.accountDayBreakdown).toHaveBeenCalledTimes(90);
    expect(mem.breakdowns).toHaveLength(90);
    expect(mem.breakdowns[0]).toEqual({ accountId: 'a1', day: '2026-10-13', rows: 2 }); // newest first
    expect(mem.breakdowns.at(-1)).toEqual({ accountId: 'a1', day: '2026-07-16', rows: 2 });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync-backfill.test.ts tests/sync-run-account.test.ts tests/sync-capture-v2.test.ts tests/sync-tick.test.ts tests/sync-tick-alerts.test.ts tests/cron-tick-chain.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/run-account.ts tests/sync-backfill.test.ts tests/sync-run-account.test.ts tests/sync-capture-v2.test.ts
git commit -m "feat(sync): newest-first progressive backfill with a resumable backward edge" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Progress sink + runner reports

**Files:**
- Create: `lib/sync/progress-sink.ts`
- Modify: `lib/sync/run-account.ts`
- Test: `tests/sync-progress-sink.test.ts` (new)

**Interfaces:**
- Consumes: `SyncStore.writeProgress`, `ProgressWrite` (Task 4); `Stage`, `LiveState`, `coveredDays` (Task 3).
- Produces:
  - `THROTTLE_MS = 3_000`
  - `interface ProgressSink { report(stage: Stage, done: number, total: number | null, day?: string | null): Promise<void>; finish(state: 'waiting' | 'failed' | 'done', errorKey: string | null): Promise<void> }`
  - `progressSink(store: SyncStore, accountId: string, clock: () => number): ProgressSink` — never throws
  - `RunContext.progress?: ProgressSink` (optional: every existing caller and test stays valid)
  - Reports: `profile` (before the follower snapshot), `stories` (after listing), `account_days` (before every fetched day, `done` = days covered so far, `total` = 90, `day` = the day), `posts_list`, `post_metrics` (`i` of `n` in this batch), `audience`.

- [ ] **Step 1: Write the failing test** — create `tests/sync-progress-sink.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { progressSink, THROTTLE_MS } from '@/lib/sync/progress-sink';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');

describe('progressSink', () => {
  it('writes at once on a stage change, otherwise at most every THROTTLE_MS', async () => {
    const mem = memoryStore();
    let t = 0;
    const sink = progressSink(mem.store, 'a1', () => t);
    await sink.report('account_days', 1, 90, '2026-10-13');
    t += 1_000;
    await sink.report('account_days', 2, 90, '2026-10-12'); // throttled
    t += THROTTLE_MS;
    await sink.report('account_days', 3, 90, '2026-10-11');
    await sink.report('posts_list', 0, null); // stage change: immediate
    expect(mem.progress.map(({ p }) => [p.stage, p.done, p.detailDay])).toEqual([
      ['account_days', 1, '2026-10-13'],
      ['account_days', 3, '2026-10-11'],
      ['posts_list', 0, null],
    ]);
    expect(mem.progress.every(({ accountId, p }) => accountId === 'a1' && p.state === 'running' && p.finishedAt === null)).toBe(true);
  });

  it('finish: done stamps finished_at; waiting and failed do not', async () => {
    const mem = memoryStore();
    const sink = progressSink(mem.store, 'a1', () => NOW.getTime());
    await sink.finish('waiting', null);
    await sink.finish('failed', 'rate_limited');
    await sink.finish('done', null);
    expect(mem.progress.map(({ p }) => [p.state, p.errorKey, p.finishedAt])).toEqual([
      ['waiting', null, null],
      ['failed', 'rate_limited', null],
      ['done', null, NOW.toISOString()],
    ]);
  });

  it('a failing progress write never throws and never stops the job', async () => {
    const ig = fakeIg();
    const mem = memoryStore();
    mem.store.writeProgress = async () => {
      throw new Error('sync store: writeProgress failed');
    };
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'Asia/Kuala_Lumpur', now: NOW, deadline: 1_000, clock: () => 0, progress: progressSink(mem.store, 'a1', () => 0) };
    await expect(c.progress!.finish('done', null)).resolves.toBeUndefined();
    const { result } = await runAccount(c, ['stories', 'daily']);
    expect(result.outcome).toBe('ok');
    expect(mem.daily).toHaveLength(7);
  });
});

describe('runner progress reports', () => {
  it('reports each onboarding stage in run order, with the day being fetched, and never the token', async () => {
    const ig = fakeIg();
    ig.listMedia.mockResolvedValue([{ id: 'p1', kind: 'IMAGE', caption: null, permalink: null, postedAt: '2026-10-12T00:00:00.000Z' }]);
    const mem = memoryStore();
    const acc = account({ id: 'a1' });
    let t = 0;
    const clock = () => (t += 4_000); // every read moves past the throttle
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'Asia/Kuala_Lumpur', now: NOW, deadline: Infinity, clock, progress: progressSink(mem.store, 'a1', clock) };
    const jobs: JobKind[] = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill'];
    await runAccount(c, jobs);
    const stages = mem.progress.map(({ p }) => p.stage).filter((s, i, a) => s !== a[i - 1]);
    expect(stages).toEqual(['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience', 'account_days']);
    const days = mem.progress.filter(({ p }) => p.stage === 'account_days').map(({ p }) => p.detailDay);
    expect(days[0]).toBe('2026-10-13');
    expect(days.at(-1)).toBe('2026-07-16');
    expect(mem.progress.find(({ p }) => p.stage === 'account_days' && p.detailDay === '2026-10-06')?.p).toMatchObject({ done: 7, total: 90 });
    expect(JSON.stringify(mem.progress)).not.toContain('IGQ-secret');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-progress-sink.test.ts`
Expected: FAIL — cannot resolve `@/lib/sync/progress-sink`.

- [ ] **Step 3: Create `lib/sync/progress-sink.ts`**

```ts
// Live progress for the panel: throttled, best-effort writes of the account's sync_progress row. A failing write never
// throws and is never retried, so progress can never fail or stall a sync. Counts, keys and a day only: no tokens.
import type { LiveState, Stage } from '@/lib/sync/progress';
import type { SyncStore } from '@/lib/sync/store';

/** At most one write per account this often while the stage stays the same. */
export const THROTTLE_MS = 3_000;

export interface ProgressSink {
  /** What the run is doing now. Written at once when the stage changes, otherwise at most every THROTTLE_MS. */
  report(stage: Stage, done: number, total: number | null, day?: string | null): Promise<void>;
  /** End of this account's run in this pass: done (nothing left), waiting (more to do) or failed. */
  finish(state: Exclude<LiveState, 'running'>, errorKey: string | null): Promise<void>;
}

export function progressSink(store: SyncStore, accountId: string, clock: () => number): ProgressSink {
  let stage: Stage | null = null;
  let snap: { done: number; total: number | null; day: string | null } = { done: 0, total: null, day: null };
  let last = -Infinity;
  const write = async (state: LiveState, errorKey: string | null) => {
    const at = new Date(clock()).toISOString();
    try {
      await store.writeProgress(accountId, { stage, state, done: snap.done, total: snap.total, detailDay: snap.day, errorKey, updatedAt: at, finishedAt: state === 'done' ? at : null });
    } catch {
      // best-effort: the panel shows the persisted state; the sync carries on
    }
  };
  return {
    async report(s, done, total, day = null) {
      const now = clock();
      const changed = s !== stage;
      stage = s;
      snap = { done, total, day };
      if (!changed && now - last < THROTTLE_MS) return;
      last = now;
      await write('running', null);
    },
    finish: (state, errorKey) => write(state, errorKey),
  };
}
```

- [ ] **Step 4: Report from the runner** — in `lib/sync/run-account.ts`:

(a) Imports: add these two lines directly above the `import { BACKFILL_DAYS, FIRST_DAYS, … } from '@/lib/sync/schedule';` line:

```ts
import { coveredDays } from '@/lib/sync/progress';
import type { ProgressSink } from '@/lib/sync/progress-sink';
```

(b) `RunContext`: after `  clock: () => number;` add

```ts
  /** Live progress (only while the account is importing or on a manual run); best-effort, never throws. */
  progress?: ProgressSink;
```

(c) In `walkBack`, between `    if (outOfTime(c)) return { done: false };` and `    await fetchDay(c, day);` add

```ts
    await c.progress?.report('account_days', coveredDays(p), BACKFILL_DAYS, day);
```

(d) In `daily`'s forward loop (`for (; day <= yesterday; …)`), between `    if (outOfTime(c)) return { done: false };` and `    await fetchDay(c, day);` add the same line:

```ts
    await c.progress?.report('account_days', coveredDays(p), BACKFILL_DAYS, day);
```

(e) `stories`: make its first line `  await c.progress?.report('profile', 0, 1);` (before `await followerSnapshot(c);`) and add, directly after `  await c.store.upsertMedia(c.account.id, items);`,

```ts
  await c.progress?.report('stories', 0, items.length);
```

(f) `mediaList`: make its first line

```ts
  await c.progress?.report('posts_list', 0, null);
```

(g) `captureMedia`: replace `    for (const id of due) {` with `    for (const [i, id] of due.entries()) {` and, right after the `if (outOfTime(c)) { … return { done: false }; }` block inside that loop, add

```ts
      await c.progress?.report('post_metrics', i, due.length);
```

(h) `audience`: make its first line

```ts
  await c.progress?.report('audience', 0, 1);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync-progress-sink.test.ts tests/sync-backfill.test.ts tests/sync-run-account.test.ts tests/sync-capture-v2.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/progress-sink.ts lib/sync/run-account.ts tests/sync-progress-sink.test.ts
git commit -m "feat(sync): throttled best-effort live progress reports from the runner" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Fair lanes in `runTick`

**Files:**
- Modify (full replacement): `lib/sync/tick.ts`
- Modify: `tests/sync-tick.test.ts` (two tests rewritten)
- Test: `tests/sync-lanes.test.ts` (new)

**Interfaces:**
- Consumes: `dueJobs(…, { lane })`, `isBackfilling`, `type Lane` (Task 2); `progressSink` (Task 6); `StatePatch.backfilledFrom` (Task 4).
- Produces: `runTick(deps, opts)` with the same signature and `TickSummary` shape as before (`more` = stopped on the time budget with work left, never under an app-wide rate limit); new export `REGULAR_SLICE_MS = 8_000`. `TickSummary.accounts` has ONE entry per account (lane 1 + lane 2 jobs merged; the lane-2 outcome wins when lane 2 ran). Live progress: a sink only when `manual || isBackfilling(state)`; each lane run ends with `finish('failed' | 'waiting' | 'done')`.

- [ ] **Step 1: Write the failing test** — create `tests/sync-lanes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
import { runTick, type TickDeps } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z'); // 10:00 in Kuala Lumpur
const DAY = { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
const ago = (m: number) => new Date(T0 - m * 60_000).toISOString();

/** A complete account (pre-Plan-11a row) whose Stories and media list are due. */
const complete = (id: string): SyncState & { leaseId: null } => ({ ...emptyState(id), leaseId: null, lastAttemptAt: ago(30), dailyDoneThrough: '2026-10-13', lastRun: { stories: ago(30), daily: ago(60), mediaList: ago(30), audience: ago(60) } });

function setup(list: StoredAccount[], states: (SyncState & { leaseId: null })[] = []) {
  const ig = fakeIg();
  const mem = memoryStore({ tokens: Object.fromEntries(list.map((a) => [a.id, `tok-${a.id}`])) });
  for (const s of states) mem.states.set(s.accountId, s);
  let now = T0;
  const log: string[] = [];
  const cost = (ms: number) => (now += ms);
  ig.listStories.mockImplementation(async (t: string) => (log.push(`${t}:stories`), cost(100), []));
  ig.accountDay.mockImplementation(async (t: string) => (log.push(`${t}:day`), cost(300), DAY));
  const deps: TickDeps = { store: mem.store, accounts: fakeAccounts(list).accounts, ig, clock: () => now, newId: (() => { let n = 0; return () => `lease-${++n}`; })() };
  return { ig, mem, deps, log, cost, now: () => now };
}

describe('fair lanes', () => {
  it('1 old + 2 new accounts: every account\'s Stories run first, then the new accounts split the rest fairly', async () => {
    const { deps, log, mem } = setup([account({ id: 'old' }), account({ id: 'n1' }), account({ id: 'n2' })], [complete('old')]);
    const s = await runTick(deps, { trigger: 'cron' });
    const firstDay = log.findIndex((l) => l.endsWith(':day'));
    expect(log.slice(0, firstDay).sort()).toEqual(['tok-n1:stories', 'tok-n2:stories', 'tok-old:stories']); // lane 1 for all, before any import
    expect(log.filter((l) => l === 'tok-old:day')).toEqual([]); // the complete account imports nothing
    const days = (id: string) => mem.daily.filter((d) => d.accountId === id).length;
    expect(days('n1')).toBeGreaterThan(30);
    expect(Math.abs(days('n1') - days('n2'))).toBeLessThanOrEqual(3); // equal slices
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['n1', 'partial'], ['n2', 'partial'], ['old', 'ok']]);
    expect(s.accounts.find((a) => a.accountId === 'n1')!.jobs.slice(0, 2)).toEqual(['stories', 'daily']); // lane 1 + lane 2 merged
    expect(s).toMatchObject({ stoppedEarly: true, more: true });
  });

  it('a slice cut short in lane 1 continues in lane 2 in the same pass (nothing runs twice)', async () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, accountId: 'old', postedAt: ago(60 * (i + 1)), lastMetricsAt: null }));
    const env = setup([account({ id: 'old' })], [complete('old')]);
    for (const m of recent) env.mem.media.set(m.id, { ...m, kind: 'IMAGE', gone: false });
    env.ig.feedInsights.mockImplementation(async () => (env.cost(1_000), { reach: 1, views: 1, likes: 1, comments: 0, shares: 0, saves: 0, totalInteractions: 1, replies: null, tapsForward: null, tapsBack: null, exits: null }));
    const s = await runTick(env.deps, { trigger: 'cron' });
    expect(env.ig.feedInsights).toHaveBeenCalledTimes(20);
    expect(env.ig.listStories).toHaveBeenCalledTimes(1);
    expect(s.accounts[0]).toMatchObject({ accountId: 'old', outcome: 'ok' });
    expect(s.more).toBe(false);
  });

  it('app-wide rate limit in lane 1: lane 2 never starts, no continuation', async () => {
    const { deps, ig } = setup([account({ id: 'n1' }), account({ id: 'n2' })]);
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 4));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(s.accounts.map((a) => a.accountId)).toEqual(['n1']);
    expect(s).toMatchObject({ stoppedEarly: true, more: false });
  });

  it('a rate-limited account sits out lane 2; the others still import', async () => {
    const { deps, ig, log } = setup([account({ id: 'n1' }), account({ id: 'n2' })]);
    ig.listStories.mockImplementation(async (t: string) => {
      if (t === 'tok-n1') throw new InstagramApiError('data', 400, 80002);
      return [];
    });
    const s = await runTick(deps, { trigger: 'cron' });
    expect(log.some((l) => l === 'tok-n1:day')).toBe(false);
    expect(log.some((l) => l === 'tok-n2:day')).toBe(true);
    expect(s.accounts.find((a) => a.accountId === 'n1')).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
  });

  it('progress table missing: the tick still syncs every account', async () => {
    const { deps, mem } = setup([account({ id: 'n1' }), account({ id: 'old' })], [complete('old')]);
    deps.clock = () => T0; // no time passes: everything finishes
    mem.store.writeProgress = async () => {
      throw new Error('sync store: writeProgress failed');
    };
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['n1', 'ok'], ['old', 'ok']]);
    expect(mem.daily.filter((d) => d.accountId === 'n1')).toHaveLength(90);
  });

  it('live progress only for importing accounts and manual runs; a finished import ends "done"', async () => {
    const { deps, mem } = setup([account({ id: 'n1' }), account({ id: 'old' })], [complete('old')]);
    deps.clock = () => T0;
    await runTick(deps, { trigger: 'cron' });
    expect(mem.progress.some((w) => w.accountId === 'old')).toBe(false); // a complete account's tick stays silent
    expect(mem.progress.filter((w) => w.accountId === 'n1').at(-1)!.p).toMatchObject({ state: 'done', finishedAt: new Date(T0).toISOString() });
    mem.progress.length = 0;
    await runTick(deps, { trigger: 'manual', accountId: 'old' });
    expect(mem.progress.map((w) => w.accountId)).toContain('old');
    expect(mem.progress.at(-1)!.p.state).toBe('done');
  });

  it('a new account mid-import that hits the budget ends its pass "waiting", with both edges saved', async () => {
    const { deps, mem } = setup([account({ id: 'n1' })]);
    await runTick(deps, { trigger: 'cron', budgetMs: 15_000 });
    const st = mem.states.get('n1')!;
    expect(st.dailyDoneThrough).toBe('2026-10-13');
    expect(st.backfilledFrom! < '2026-10-07').toBe(true);
    expect(mem.progress.at(-1)!.p).toMatchObject({ state: 'waiting', finishedAt: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-lanes.test.ts`
Expected: FAIL — e.g. the first test finds `tok-n1:day` before `tok-n2:stories` (one lane, whole account at a time), and no progress rows are written.

- [ ] **Step 3: Replace `lib/sync/tick.ts`** with:

```ts
// One scheduler tick in two lanes. Lane 1: the regular jobs (Stories, recent posts, daily refresh, token) of EVERY
// account, round-robin by oldest attempt, each with a small slice. Lane 2: whatever is left (a new account's onboarding,
// the history import, regular jobs a slice cut short), the remaining budget split equally across those accounts. Each
// lane run leases the account, runs within its slice, persists state; then alerts are evaluated and a summary recorded.
// One account failing (bad token, DB hiccup) never stops the others.
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { ALERT_BUDGET_MS, runAlerts, type AlertDeps, type AlertRunSummary } from '@/lib/alerts/run';
import type { IgData } from '@/lib/instagram/data';
import { progressSink } from '@/lib/sync/progress-sink';
import { runAccount, type AccountOutcome, type SyncErrorKey } from '@/lib/sync/run-account';
import { byOldestAttempt, dueJobs, isBackfilling, type JobKind, type Lane, type SyncState } from '@/lib/sync/schedule';
import type { SyncStore } from '@/lib/sync/store';

/** Route maxDuration is 60s. Work stops at 35s: a call started just before the deadline can take its 10s timeout (twice for
 *  the two-call jobs) and the state write still has to fit. */
export const TICK_BUDGET_MS = 35_000;
/** Don't start an account with less than this left: a half-started account only wastes calls. */
const MIN_ACCOUNT_MS = 5_000;
/** Lane 1 slice per account: enough for Stories + recent posts; whatever does not fit continues in lane 2. */
export const REGULAR_SLICE_MS = 8_000;
/** Longer than any invocation can live, so a crashed tick's lease expires well before the next tick. */
export const LEASE_MS = 120_000;

export interface TickDeps {
  store: SyncStore;
  accounts: AccountsStore;
  ig: IgData;
  alerts?: AlertDeps; // omitted: no alert evaluation (tests of the sync itself)
  clock?: () => number;
  newId?: () => string;
}

interface TickAccount {
  accountId: string;
  outcome: AccountOutcome | 'locked' | 'idle';
  jobs: JobKind[];
  errorKey?: SyncErrorKey;
}

export interface TickSummary {
  trigger: 'cron' | 'manual';
  startedAt: string;
  durationMs: number;
  stoppedEarly: boolean; // time budget or app-wide rate limit left due work for the next tick
  more: boolean; // due work remains because of the TIME BUDGET (not a Meta rate limit): worth an immediate follow-up pass
  accounts: TickAccount[];
  alerts?: AlertRunSummary; // counts only
}

type LaneResult = TickAccount & { appRateLimited?: boolean };

export async function runTick(deps: TickDeps, opts: { trigger: 'cron' | 'manual'; budgetMs?: number; accountId?: string }): Promise<TickSummary> {
  const clock = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const start = clock();
  const deadline = start + (opts.budgetMs ?? TICK_BUDGET_MS);
  const startedAt = new Date(start).toISOString();
  const manual = opts.trigger === 'manual';
  const out = new Map<string, TickAccount>(); // insertion order = lane 1 order
  let budgetStop = false; // ran out of time with work left (a continuation pass is useful)
  let appLimited = false; // Meta throttled the whole app (a continuation would only make it worse)

  const tz = await deps.store.ownerTimezone();
  const active = (await deps.accounts.list()).filter((a) => a.status === 'active' && (!opts.accountId || a.id === opts.accountId));
  const states = await deps.store.loadStates(active.map((a) => a.id));
  const ordered = [...active].sort((a, b) => byOldestAttempt(states.get(a.id)!, states.get(b.id)!));

  /** One lane for one account: lease, plan from the claimed row, run until sliceEnd, persist, report progress. */
  async function runLane(account: StoredAccount, lane: Lane, sliceEnd: number, skip: readonly JobKind[]): Promise<LaneResult> {
    const id = account.id;
    const now = new Date(clock());
    const state = states.get(id)!;
    const plan = (s: SyncState) => dueJobs({ status: account.status, tokenExpiresAt: account.tokenExpiresAt, state: s }, now, tz, { manual, lane }).filter((j) => !skip.includes(j));
    if (plan(state).length === 0) return { accountId: id, outcome: state.leaseUntil && Date.parse(state.leaseUntil) > now.getTime() ? 'locked' : 'idle', jobs: [] };
    const leaseId = newId();
    try {
      const claimed = await deps.store.claimLease(id, leaseId, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString());
      if (!claimed) return { accountId: id, outcome: 'locked', jobs: [] };
      // The snapshot above can be stale (a double-fired tick may have just finished this account): plan from the claimed row.
      // Its last_attempt_at is our own claim stamp and must not count for back-off; the lease is ours, not "another tick's".
      const fresh: SyncState = { ...claimed, lastAttemptAt: state.lastAttemptAt, leaseUntil: null };
      const keep = { lastAttemptAt: now.toISOString(), dailyDoneThrough: fresh.dailyDoneThrough, backfilledFrom: fresh.backfilledFrom, lastRun: fresh.lastRun };
      const jobs = plan(fresh);
      if (jobs.length === 0) {
        await deps.store.saveState(id, leaseId, { ...keep, consecutiveFailures: fresh.consecutiveFailures, lastErrorKey: fresh.lastErrorKey });
        states.set(id, { ...fresh, lastAttemptAt: keep.lastAttemptAt });
        return { accountId: id, outcome: 'idle', jobs: [] };
      }
      const token = await deps.store.getToken(id);
      if (!token) {
        // connected without a stored token: nothing can be fetched until the owner reconnects
        await deps.accounts.update(id, { status: 'needs_reconnect', lastError: 'token_missing' });
        await deps.store.saveState(id, leaseId, { ...keep, consecutiveFailures: fresh.consecutiveFailures + 1, lastErrorKey: 'token_invalid' });
        return { accountId: id, outcome: 'needs_reconnect', jobs: [], errorKey: 'token_invalid' };
      }
      // live progress only while importing or on a manual run: a complete account's 30-minute ticks stay silent
      const progress = manual || isBackfilling(fresh) ? progressSink(deps.store, id, clock) : undefined;
      const { result, patch } = await runAccount({ ig: deps.ig, store: deps.store, accounts: deps.accounts, account, token, state: fresh, tz, now, deadline: sliceEnd, clock, progress }, jobs);
      await deps.store.saveState(id, leaseId, patch);
      const next: SyncState = { ...fresh, ...patch, lastSuccessAt: patch.lastSuccessAt ?? fresh.lastSuccessAt };
      states.set(id, next);
      if (progress) {
        const failed = result.outcome === 'failed' || result.outcome === 'needs_reconnect';
        await progress.finish(failed ? 'failed' : result.outcome === 'partial' || isBackfilling(next) ? 'waiting' : 'done', result.errorKey ?? null);
      }
      return { accountId: id, outcome: result.outcome, jobs: result.jobs, ...(result.errorKey ? { errorKey: result.errorKey } : {}), ...(result.appRateLimited ? { appRateLimited: true } : {}) };
    } catch {
      // store failure outside runAccount (lease, token read, state write). The lease expires by itself (LEASE_MS).
      return { accountId: id, outcome: 'failed', jobs: [], errorKey: 'unexpected' };
    }
  }
  const entry = (r: LaneResult): TickAccount => ({ accountId: r.accountId, outcome: r.outcome, jobs: r.jobs, ...(r.errorKey ? { errorKey: r.errorKey } : {}) });

  // Lane 1: regular jobs for every account first, each within a small slice.
  for (const account of ordered) {
    if (deadline - clock() < MIN_ACCOUNT_MS) {
      budgetStop = true;
      break;
    }
    const r = await runLane(account, 'regular', Math.min(deadline, clock() + REGULAR_SLICE_MS), []);
    out.set(account.id, entry(r));
    if (r.appRateLimited) {
      appLimited = true; // app-wide throttle: every further call would fail too, so lane 2 never starts
      break;
    }
  }

  // Lane 2: accounts with work left share the rest equally (re-split after each one, so time a fast one leaves is reused).
  const lane2 = appLimited
    ? []
    : ordered.filter((a) => {
        const e = out.get(a.id);
        if (!e || e.outcome === 'locked' || e.outcome === 'needs_reconnect' || e.errorKey === 'rate_limited' || e.errorKey === 'unexpected') return false;
        return e.outcome === 'partial' || isBackfilling(states.get(a.id)!);
      });
  for (const [i, account] of lane2.entries()) {
    const left = deadline - clock();
    if (left < MIN_ACCOUNT_MS) {
      budgetStop = true;
      break;
    }
    const before = out.get(account.id)!;
    const r = await runLane(account, 'all', Math.min(deadline, clock() + Math.max(MIN_ACCOUNT_MS, left / (lane2.length - i))), before.jobs);
    if (r.outcome !== 'idle' && r.outcome !== 'locked') out.set(account.id, { ...entry(r), jobs: [...before.jobs, ...r.jobs] });
    if (r.outcome === 'partial') budgetStop = true;
    if (r.appRateLimited) {
      appLimited = true;
      break;
    }
  }

  // SPEC §6: rules run after the account jobs. runAlerts never throws; the catch is a second net for the tick.
  const alerts = deps.alerts
    ? await runAlerts(deps.alerts, { accounts: deps.accounts, sync: deps.store, now: new Date(clock()), tz, deadline: deadline + ALERT_BUDGET_MS, clock, accountId: opts.accountId }).catch(() => ({ created: 0, pushed: 0, failed: 1 }))
    : undefined;
  const summary: TickSummary = { trigger: opts.trigger, startedAt, durationMs: clock() - start, stoppedEarly: budgetStop || appLimited, more: budgetStop && !appLimited, accounts: [...out.values()], ...(alerts ? { alerts } : {}) };
  await deps.store.recordRun({ startedAt, finishedAt: new Date(clock()).toISOString(), trigger: opts.trigger, summary }).catch(() => {});
  return summary;
}
```

- [ ] **Step 4: Update the two tick tests whose expectations assumed one lane**

In `tests/sync-tick.test.ts`, replace the test `'overlapping ticks (scheduler retry / double fire) cannot double-run an account'` with

```ts
  it('overlapping ticks (scheduler retry / double fire) cannot double-run an account', async () => {
    const { deps, ig, mem } = setup();
    const [x, y] = await Promise.all([runTick(deps, { trigger: 'cron' }), runTick({ ...deps, newId: () => 'other' }, { trigger: 'cron' })]);
    expect([...x.accounts, ...y.accounts].some((a) => a.outcome === 'locked')).toBe(true);
    expect(ig.listStories).toHaveBeenCalledTimes(2); // once per account, not twice
    expect(ig.accountDay).toHaveBeenCalledTimes(180); // 90 days per account (the two lanes may land in different ticks), none twice
    expect(new Set(mem.daily.map((d) => `${d.accountId}:${d.day}`)).size).toBe(180);
  });
```

and replace the test `'stops before the time budget and leaves remaining accounts due; the next tick starts with them'` with

```ts
  it('stops on the time budget with work left (more = true); every new account got a slice; the next tick resumes', async () => {
    const list = [account({ id: 'a1' }), account({ id: 'a2' }), account({ id: 'a3' })];
    const { deps, ig, mem } = setup(list, { a1: 't1', a2: 't2', a3: 't3' });
    let now = T0;
    ig.accountDay.mockImplementation(async () => {
      now += 300; // 90 days x 300ms = 27s per account: three accounts cannot finish in one 35s pass
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const first = await runTick({ ...deps, clock: () => now }, { trigger: 'cron' });
    expect(first.stoppedEarly).toBe(true);
    expect(first.more).toBe(true); // stopped on the time budget with work left -> continuation is useful
    expect(first.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['a1', 'partial'], ['a2', 'partial'], ['a3', 'partial']]);
    for (const id of ['a1', 'a2', 'a3']) expect(mem.states.get(id)).toMatchObject({ dailyDoneThrough: '2026-10-13' });
    const before = mem.daily.length;
    now += 30 * 60_000;
    await runTick({ ...deps, clock: () => now }, { trigger: 'cron' });
    expect(mem.daily.length).toBeGreaterThan(before);
    expect(new Set(mem.daily.map((d) => `${d.accountId}:${d.day}`)).size).toBe(mem.daily.length); // resumed, nothing re-fetched
  });
```

- [ ] **Step 5: Run the sync suite**

Run: `npx vitest run tests/sync-lanes.test.ts tests/sync-tick.test.ts tests/sync-tick-alerts.test.ts tests/cron-tick-chain.test.ts tests/cron-tick-route.test.ts tests/connect-sync.test.ts tests/sync-now-action.test.ts tests/alert-run.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/tick.ts tests/sync-lanes.test.ts tests/sync-tick.test.ts
git commit -m "feat(sync): two fair lanes per tick (regular first, equal import slices)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Progress read + `GET /api/sync/progress`

**Files:**
- Create: `lib/sync/progress-read.ts`, `app/api/sync/progress/route.ts`
- Test: `tests/sync-progress-route.test.ts` (new)

**Interfaces:**
- Consumes: `buildProgress`, `isTracked`, `LiveProgress`, `AccountProgress`, `Stage` (Task 3); `rowToState` (Task 4); `emptyState` (Task 2); `assertOwner(h)`, `createServerSupabase({ responseHeaders })`, `supabaseAccountsStore(db).list()` (existing).
- Produces:
  - `rowToLive(r: Record<string, unknown>): LiveProgress`
  - `loadSyncProgress(db: SupabaseClient, accounts: StoredAccount[], now: Date): Promise<AccountProgress[]>` — owner session, never throws, archived accounts skipped, only tracked accounts returned, 3 count queries per tracked account (posts total, posts measured, latest follower snapshot)
  - `GET /api/sync/progress` → `200 { accounts: AccountProgress[] }` | `401 { error: 'unauthorized' }` | `500 { error: 'unexpected' }`, always `cache-control: private, no-store` plus the headers Supabase handed to `assertOwner`/`createServerSupabase`.

- [ ] **Step 1: Write the failing test** — create `tests/sync-progress-route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideRoute } from '@/lib/auth/route-policy';
import type { StoredAccount } from '@/lib/accounts/types';
import { loadSyncProgress, rowToLive } from '@/lib/sync/progress-read';

const state = vi.hoisted(() => ({ owner: true, reads: 0, fail: false }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({ __db: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({
  supabaseAccountsStore: () => ({
    list: async () => {
      state.reads++;
      if (state.fail) throw new Error('dashboard read: accounts failed secret-value');
      return [];
    },
  }),
}));

import { GET } from '@/app/api/sync/progress/route';

beforeEach(() => {
  state.owner = true;
  state.reads = 0;
  state.fail = false;
});

describe('GET /api/sync/progress', () => {
  it('401 for anyone but the owner, uncached, nothing read; the auth headers are kept', async () => {
    state.owner = false;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.reads).toBe(0);
  });

  it('200 with the progress list for the owner, uncached', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
  });

  it('a read failure is a fixed 500 that never echoes the error', async () => {
    state.fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });

  it('stays session-protected: no public exemption in the route policy', () => {
    expect(decideRoute({ pathname: '/api/sync/progress', configured: true, signedIn: false, aal: null, mfaRequired: false })).toEqual({ type: 'redirect', to: '/login' });
  });
});

/** Minimal PostgREST stand-in: each table returns its rows; count queries return `counts[table]`. */
function fakeDb(rows: Record<string, unknown[]>, o: { counts?: number[]; errors?: string[] } = {}) {
  const counts = [...(o.counts ?? [])];
  const queried: string[] = [];
  return {
    queried,
    db: {
      from(table: string) {
        queried.push(table);
        let head = false;
        const q: Record<string, unknown> = {};
        const result = () => (o.errors?.includes(table) ? { data: null, error: { message: 'x' }, count: null } : head ? { data: null, error: null, count: counts.shift() ?? 0 } : { data: rows[table] ?? [], error: null });
        q.select = (_c: string, opts?: { head?: boolean }) => ((head = !!opts?.head), q);
        for (const f of ['in', 'eq', 'neq', 'is', 'not', 'order', 'limit']) q[f] = () => q;
        q.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
        q.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
        return q;
      },
    } as never,
  };
}

const NOW = new Date('2026-10-14T02:00:00Z');
const acct = (id: string, o: Partial<StoredAccount> = {}) => ({ id, status: 'active', ...o }) as StoredAccount;

describe('loadSyncProgress', () => {
  it('only importing / unfinished accounts are returned, with counts and keys only', async () => {
    const { db, queried } = fakeDb(
      {
        sync_state: [
          { account_id: 'new', daily_done_through: '2026-10-13', backfilled_from: '2026-10-07', last_run: { daily: NOW.toISOString() }, consecutive_failures: 0, lease_id: 'secret-lease' },
          { account_id: 'done', daily_done_through: '2026-10-13', backfilled_from: '2026-07-16', last_run: { backfill: NOW.toISOString() }, consecutive_failures: 0 },
        ],
        sync_progress: [{ account_id: 'new', stage: 'account_days', state: 'running', done: 7, total: 90, detail_day: '2026-10-06', started_at: '2026-10-14T01:59:00Z', updated_at: '2026-10-14T01:59:58Z' }],
        follower_snapshots: [{ followers: 1520 }],
      },
      { counts: [12, 3] },
    );
    const out = await loadSyncProgress(db, [acct('new'), acct('done'), acct('gone', { status: 'archived' })], NOW);
    expect(out.map((p) => p.accountId)).toEqual(['new']);
    expect(out[0]).toMatchObject({ phase: 'running', current: { stage: 'account_days', day: '2026-10-06', done: 7, total: 90 } });
    expect(out[0].stages.find((s) => s.stage === 'post_metrics')).toMatchObject({ done: 3, total: 12 });
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(queried.filter((t) => t === 'media')).toHaveLength(2); // counts only for the tracked account
  });

  it('works before the migration is applied (sync_progress missing): the state alone drives the panel', async () => {
    const { db } = fakeDb({ sync_state: [] }, { errors: ['sync_progress'] });
    const out = await loadSyncProgress(db, [acct('brand-new')], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ accountId: 'brand-new', phase: 'waiting', percent: 0 });
  });

  it('never throws: a failing state read gives an empty list', async () => {
    expect(await loadSyncProgress(fakeDb({}, { errors: ['sync_state'] }).db, [acct('a')], NOW)).toEqual([]);
    expect(await loadSyncProgress({} as never, [acct('a')], NOW)).toEqual([]);
  });

  it('rowToLive defaults unknown states to waiting and missing numbers safely', () => {
    expect(rowToLive({ state: 'weird', done: 'x' })).toMatchObject({ state: 'waiting', done: 0, total: null, stage: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-progress-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/sync/progress/route` / `@/lib/sync/progress-read`.

- [ ] **Step 3: Create `lib/sync/progress-read.ts`**

```ts
// Owner-session read for the progress panel and badges (RLS: owner select; never the admin client). Only accounts
// worth showing (isTracked) get the extra count queries. Output is counts, keys and days: no tokens, no media ids.
// Never throws: on any read error the panel simply shows nothing new.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import { buildProgress, isTracked, type AccountProgress, type LiveProgress, type Stage } from '@/lib/sync/progress';
import { emptyState } from '@/lib/sync/schedule';
import { rowToState } from '@/lib/sync/store';

type Row = Record<string, unknown>;
const STATE_COLUMNS = 'account_id,lease_until,last_attempt_at,last_success_at,last_error_key,consecutive_failures,daily_done_through,backfilled_from,last_run';
const PROGRESS_COLUMNS = 'account_id,stage,state,done,total,detail_day,error_key,started_at,updated_at,finished_at';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function rowToLive(r: Row): LiveProgress {
  const state = r.state === 'running' || r.state === 'failed' || r.state === 'done' ? r.state : 'waiting';
  return {
    stage: (str(r.stage) as Stage | null) ?? null,
    state,
    done: num(r.done) ?? 0,
    total: num(r.total),
    detailDay: str(r.detail_day),
    errorKey: str(r.error_key),
    startedAt: str(r.started_at) ?? new Date(0).toISOString(),
    updatedAt: str(r.updated_at) ?? new Date(0).toISOString(),
    finishedAt: str(r.finished_at),
  };
}

async function counts(db: SupabaseClient, accountId: string) {
  const posts = () => db.from('media').select('id', { count: 'exact', head: true }).eq('account_id', accountId).neq('media_type', 'STORY').is('gone_at', null);
  const [total, measured, snap] = await Promise.all([
    posts(),
    posts().not('last_metrics_at', 'is', null),
    db.from('follower_snapshots').select('followers').eq('account_id', accountId).order('captured_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    posts: { total: total.error ? 0 : (total.count ?? 0), measured: measured.error ? 0 : (measured.count ?? 0) },
    followers: snap.error ? null : num((snap.data as Row | null)?.followers),
  };
}

export async function loadSyncProgress(db: SupabaseClient, accounts: StoredAccount[], now: Date): Promise<AccountProgress[]> {
  const shown = accounts.filter((a) => a.status !== 'archived');
  if (shown.length === 0) return [];
  try {
    const ids = shown.map((a) => a.id);
    const [st, pr] = await Promise.all([db.from('sync_state').select(STATE_COLUMNS).in('account_id', ids), db.from('sync_progress').select(PROGRESS_COLUMNS).in('account_id', ids)]);
    if (st.error) return [];
    const states = new Map(((st.data ?? []) as Row[]).map((r) => [r.account_id as string, rowToState(r)]));
    const live = new Map((pr.error ? [] : ((pr.data ?? []) as Row[])).map((r) => [r.account_id as string, rowToLive(r)])); // table missing: no live rows
    const tracked = shown.map((a) => ({ a, state: states.get(a.id) ?? emptyState(a.id), live: live.get(a.id) ?? null })).filter((x) => isTracked(x, now));
    return await Promise.all(tracked.map(async ({ a, state, live: l }) => buildProgress({ accountId: a.id, needsReconnect: a.status === 'needs_reconnect', state, live: l, ...(await counts(db, a.id)) }, now)));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Create `app/api/sync/progress/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';

/**
 * GET /api/sync/progress — owner session only (proxy + assertOwner; NOT a public exemption in lib/auth/route-policy.ts).
 * Progress of the accounts that are importing or just finished: counts, i18n keys and days only. Polled by the
 * progress panel every few seconds, so it is uncached and cheap (count queries only for tracked accounts).
 */
export async function GET() {
  const h = new Headers({ 'cache-control': 'private, no-store' });
  if (!(await assertOwner(h))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: h });
  try {
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const accounts = await supabaseAccountsStore(db).list();
    return NextResponse.json({ accounts: await loadSyncProgress(db, accounts, new Date()) }, { headers: h });
  } catch {
    console.error('sync progress read failed'); // fixed text: never log error objects
    return NextResponse.json({ error: 'unexpected' }, { status: 500, headers: h });
  }
}
```

`lib/auth/route-policy.ts` is NOT touched: the proxy keeps requiring a session (and aal2 when enrolled) for this path, and the handler checks ownership itself.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/sync-progress-route.test.ts tests/route-policy.test.ts tests/admin-guard.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/progress-read.ts app/api/sync/progress/route.ts tests/sync-progress-route.test.ts
git commit -m "feat(sync): owner-only GET /api/sync/progress (counts and keys only)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Reconnect and "Sync now" reuse the progress mechanics

**Files:**
- Modify: `app/api/instagram/callback/route.ts`, `app/(app)/accounts/actions.ts`, `lib/sync/connect-sync.ts`
- Modify: `tests/sync-now-action.test.ts`, `tests/connect-sync.test.ts`
- Test: `tests/instagram-callback-progress.test.ts` (new)

**Interfaces:**
- Consumes: `resetSyncProgress` (Task 4); `shouldChain`, `continueChain` (existing `lib/sync/chain.ts`).
- Produces: `continueIfMore(more: boolean): Promise<void>` in `lib/sync/connect-sync.ts` (never throws). Callback: `clearSyncError` → `resetSyncProgress` → `after(syncAccountNow)`; redirect `?connected=<username>` unchanged. `syncNowAction`: `requireOwner` → id check → `resetSyncProgress` → `runTick` → `after(continueIfMore(more))`; results/error keys unchanged.

- [ ] **Step 1: Write the failing test** — create `tests/instagram-callback-progress.test.ts`:

```ts
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => [] as string[]);
const afterFns = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void afterFns.push(fn) }));
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => true }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({ __admin: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({}) }));
vi.mock('@/lib/env', async (orig) => ({ ...(await orig<object>()), getInstagramEnv: () => ({}) }));
// stands in for a successful OAuth exchange of an account that already exists (a reconnect)
vi.mock('@/lib/instagram/connect-flow', () => ({
  processCallback: async (_i: unknown, deps: { onConnected?: (id: string) => Promise<void> }) => {
    await deps.onConnected?.('acc-1');
    return { redirect: '/accounts?connected=brand' };
  },
}));
vi.mock('@/lib/sync/store', () => ({
  clearSyncError: async (_db: unknown, id: string) => void log.push(`clear:${id}`),
  resetSyncProgress: async (_db: unknown, id: string, iso: string) => void log.push(`reset:${id}:${typeof iso}`),
}));
vi.mock('@/lib/sync/connect-sync', () => ({ syncAccountNow: async (id: string) => void log.push(`sync:${id}`) }));

import { GET as callback } from '@/app/api/instagram/callback/route';

beforeEach(() => {
  log.length = 0;
  afterFns.length = 0;
});

describe('OAuth callback → progress (reconnect during an active import)', () => {
  it('reconnect resets only the live row, never sync_state coverage, then syncs after the redirect', async () => {
    const res = await callback(new NextRequest(new URL('/api/instagram/callback?code=c&state=s', 'https://app.test')));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/accounts?connected=brand'); // ?connected= kept for the panel
    expect(log).toEqual(['clear:acc-1', 'reset:acc-1:string']); // no coverage write of any kind
    expect(afterFns).toHaveLength(1);
    await afterFns[0]();
    expect(log.at(-1)).toBe('sync:acc-1');
  });
});
```

and update the existing tests:

`tests/sync-now-action.test.ts` — directly after the existing `vi.mock('next/cache', …)` line add

```ts
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock('@/lib/sync/store', () => ({ resetSyncProgress: async (_db: unknown, id: string) => void calls.push(`reset:${id}`) }));
vi.mock('@/lib/sync/connect-sync', () => ({ continueIfMore: async (more: boolean) => void calls.push(`continue:${more}`) }));
```

replace `    expect(calls.slice(0, 3)).toEqual(['requireOwner', 'deps', 'tick']);` with

```ts
    expect(calls.slice(0, 4)).toEqual(['requireOwner', `reset:${ID}`, 'deps', 'tick']);
```

and replace the test `'a partial run (time budget) still counts as ok'` with

```ts
  it('a partial run (time budget) still counts as ok and starts a continuation pass after the response', async () => {
    runTick.mockResolvedValue({ ...summary([{ accountId: ID, outcome: 'partial', jobs: ['stories'] }]), more: true });
    expect(await syncNowAction(ID)).toEqual({ ok: true });
    expect(calls).toContain('continue:true');
  });

  it('a complete run does not chain; a non-uuid id resets nothing', async () => {
    await syncNowAction(ID);
    expect(calls).toContain('continue:false');
    calls.length = 0;
    await syncNowAction('nope');
    expect(calls.some((c) => c.startsWith('reset:'))).toBe(false);
  });
```

`tests/connect-sync.test.ts` — change the import to `import { continueIfMore, syncAccountNow } from '@/lib/sync/connect-sync';` and append at the end of the file:

```ts
describe('continueIfMore ("Sync now" while an import is still going)', () => {
  it('chains only when the run stopped on its time budget, and never throws', async () => {
    await continueIfMore(false);
    expect(continueChain).not.toHaveBeenCalled();
    await continueIfMore(true);
    expect(continueChain).toHaveBeenCalledWith(SECRET, 0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('CRON_SECRET', '');
    await expect(continueIfMore(true)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/instagram-callback-progress.test.ts tests/sync-now-action.test.ts tests/connect-sync.test.ts`
Expected: FAIL — no `reset:` call is logged; `continueIfMore` is not exported.

- [ ] **Step 3: Implement**

`lib/sync/connect-sync.ts` — append:

```ts

/** "Sync now": start a continuation pass (chain depth 0) when the run stopped on its time budget. Never throws. */
export async function continueIfMore(more: boolean): Promise<void> {
  try {
    if (shouldChain(more, 0)) await continueChain(getServerEnv().cronSecret, 0);
  } catch {
    console.error('sync continuation failed'); // fixed text: never log error objects
  }
}
```

`app/api/instagram/callback/route.ts` — change the store import to `import { clearSyncError, resetSyncProgress } from '@/lib/sync/store';` and replace

```ts
          await clearSyncError(db, id);
          after(() => syncAccountNow(id)); // start syncing this account at once; the redirect is not delayed
```

with

```ts
          await clearSyncError(db, id);
          await resetSyncProgress(db, id, new Date().toISOString()); // new progress session; coverage (sync_state) is kept
          after(() => syncAccountNow(id)); // start syncing this account at once; the redirect is not delayed
```

`app/(app)/accounts/actions.ts`:
- after `import { revalidatePath } from 'next/cache';` add `import { after } from 'next/server';`
- replace `import { createSyncDeps } from '@/lib/sync/deps';` with

```ts
import { continueIfMore } from '@/lib/sync/connect-sync';
import { createSyncDeps } from '@/lib/sync/deps';
import { resetSyncProgress } from '@/lib/sync/store';
```

- extend the comment above `syncNowAction` with two lines:

```ts
// Starts a fresh progress session (the panel shows it) and, if the run stopped on its time budget (an import still
// going), a continuation pass after the response. Coverage is never reset.
```

- inside `syncNowAction`'s `try`, replace

```ts
    const summary = await runTick(createSyncDeps(), { trigger: 'manual', budgetMs: TICK_BUDGET_MS, accountId: id });
    revalidatePath('/accounts');
```

with

```ts
    await resetSyncProgress(createAdminSupabase(), id, new Date().toISOString());
    const summary = await runTick(createSyncDeps(), { trigger: 'manual', budgetMs: TICK_BUDGET_MS, accountId: id });
    revalidatePath('/accounts');
    after(() => continueIfMore(summary.more === true));
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/instagram-callback-progress.test.ts tests/sync-now-action.test.ts tests/connect-sync.test.ts tests/instagram-routes.test.ts tests/account-actions.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/instagram/callback/route.ts "app/(app)/accounts/actions.ts" lib/sync/connect-sync.ts tests/instagram-callback-progress.test.ts tests/sync-now-action.test.ts tests/connect-sync.test.ts
git commit -m "feat(sync): reconnect and Sync now start a progress session; Sync now chains" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Partial coverage in growth analysis and Overview

**Files:**
- Modify: `lib/analysis/growth.ts`, `lib/dashboard/overview.ts`, `lib/dashboard/account.ts`, `components/overview/OverviewView.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (one key: `analysis.coverage`)
- Modify: `tests/overview-view.test.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx` (one assertion each)
- Test: `tests/analysis-coverage.test.ts` (new)

**Interfaces:**
- Consumes: `SyncStatus.backfilling` (Task 4); `MissingReason 'backfilling'` (existing, `analysis.reasons.backfilling` = "Importing history…").
- Produces:
  - `Summary.coverage: { current: number; prior: number }` (0–1, days with reach ÷ period; `combine` uses the combined `days`, i.e. the weakest account)
  - `kpis(s: Summary, opts?: { backfilling?: boolean }): Record<KpiId, Kpi>` — while backfilling, a window under 80 % coverage gets reason `'backfilling'` (instead of `'not_enough_history'`) and a metric with no value gets `'backfilling'` (instead of `'no_data'`); values stay the real partial sums
  - `cardState(status, tokenExpiresAt, now, sync: SyncStatus | undefined, s, hasRows)` (4th parameter is now the whole `SyncStatus`)
  - `AccountCard.coverage: number`; message key `analysis.coverage` with `{pct}`

- [ ] **Step 1: Write the failing test** — create `tests/analysis-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { combine, kpis, summarize } from '@/lib/analysis/growth';
import type { DailyRow } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import { addDays } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
/** n consecutive days ending yesterday (oldest first). */
const days = (n: number, o: Partial<DailyRow> = {}) => Array.from({ length: n }, (_, i) => row(addDays(TODAY, i - n), o));
const acct = (id: string): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' });

describe('coverage per window', () => {
  it('reports the share of days with reach in each window', () => {
    const s = summarize(days(10, { reach: 5 }), [], 7, TODAY, KL);
    expect(s.coverage).toEqual({ current: 1, prior: 3 / 7 });
  });

  it('coverage boundary: 6 of 7 days compares, 5 of 7 says importing (while backfilling) or not enough history', () => {
    const gap = (n: number) => [...days(14, { reach: 10 })].filter((_, i) => i >= 7 - n); // prior window keeps n days, current all 7
    const six = summarize(gap(6), [], 7, TODAY, KL);
    expect(kpis(six, { backfilling: true }).reach).toMatchObject({ reason: null, diff: 10 }); // 70 vs 60
    const five = summarize(gap(5), [], 7, TODAY, KL);
    expect(kpis(five, { backfilling: true }).reach).toMatchObject({ value: 70, change: null, reason: 'backfilling' });
    expect(kpis(five).reach.reason).toBe('not_enough_history');
  });

  it('a half-finished import shows real partial numbers, never a fake drop or zero', () => {
    const s = summarize(days(10, { reach: 100, views: 200, interactions: 10, followers: 1500 }), [], 30, TODAY, KL);
    const k = kpis(s, { backfilling: true });
    expect(k.reach).toMatchObject({ value: 1_000, diff: null, change: null, reason: 'backfilling' });
    expect(k.views.value).toBe(2_000);
    expect(k.followers).toMatchObject({ value: 1500, reason: 'backfilling' }); // no follower history a period back yet
    expect(s.coverage.current).toBeCloseTo(10 / 30);
    const nothing = kpis(summarize([], [], 30, TODAY, KL), { backfilling: true });
    expect(nothing.reach).toMatchObject({ value: null, reason: 'backfilling' });
  });

  it('combine carries the weakest coverage of its accounts', () => {
    const c = combine([summarize(days(14, { reach: 1 }), [], 7, TODAY, KL), summarize(days(3, { reach: 1 }), [], 7, TODAY, KL)])!;
    expect(c.coverage.current).toBeCloseTo(3 / 7);
  });
});

describe('Overview while an account is importing', () => {
  const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
  it('7-day KPIs appear as soon as the newest week lands; totals keep excluding the importing account', () => {
    const m = buildOverview(
      {
        accounts: [acct('old'), acct('new')],
        sync: { old: { ...synced, backfilling: false }, new: { ...synced, backfilledFrom: '2026-10-08', backfilling: true } },
        daily: { old: days(14, { reach: 100, followers: 1000, interactions: 10 }), new: days(7, { reach: 40, followers: 300, interactions: 4 }) },
        posts: {},
      },
      { period: 7, today: TODAY, now: NOW, tz: KL, locale: 'en' },
    );
    const card = m.sections.flatMap((s) => s.cards).find((c) => c.id === 'new')!;
    expect(card.state).toBe('backfilling');
    expect(card.kpis.reach).toMatchObject({ value: 280, reason: 'backfilling', change: null });
    expect(card.coverage).toBe(1);
    expect(m.totals!.reach).toMatchObject({ value: 700, reason: null }); // only the complete account, still compared
    expect(m.totals!.reach.diff).toBe(0);
  });

  it('a sync row without the flag (older data) keeps the old rule: rows or a done-through date mean not importing', () => {
    const m = buildOverview({ accounts: [acct('x')], sync: { x: synced }, daily: { x: days(14, { reach: 1 }) }, posts: {} }, { period: 7, today: TODAY, now: NOW, tz: KL, locale: 'en' });
    expect(m.sections[0].cards[0].state).toBe('ok');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analysis-coverage.test.ts`
Expected: FAIL — `s.coverage` is undefined; reasons are `not_enough_history`; the importing account's card is `ok`.

- [ ] **Step 3: Implement**

`lib/analysis/growth.ts` (four edits):

(a) `interface Summary` — after `  prior: Totals;` add

```ts
  coverage: { current: number; prior: number }; // share of each window's days that have reach data (0–1)
```

(b) In `summarize`, replace

```ts
  const byDay = new Map(sorted.map((r) => [r.day, r.reach]));
  return {
    period,
    endDay,
    current: { followers: curF?.value ?? null, ...totals(sorted, posts, curFrom, endDay, tz) },
    prior: { followers: priorF?.value ?? null, ...totals(sorted, posts, priorFrom, priorTo, tz) },
```

with

```ts
  const byDay = new Map(sorted.map((r) => [r.day, r.reach]));
  const current: Totals = { followers: curF?.value ?? null, ...totals(sorted, posts, curFrom, endDay, tz) };
  const prior: Totals = { followers: priorF?.value ?? null, ...totals(sorted, posts, priorFrom, priorTo, tz) };
  return {
    period,
    endDay,
    current,
    prior,
    coverage: { current: current.days / period, prior: prior.days / period },
```

(c) In `combine`, after the `    prior,` line of the returned object add

```ts
    coverage: { current: current.days / list[0].period, prior: prior.days / list[0].period },
```

(d) Replace `function kpi(…)`'s first three lines and the whole `kpis` function:

```ts
function kpi(value: number | null, prior: number | null, comparable: boolean, emptyReason: MissingReason, shortReason: MissingReason = 'not_enough_history'): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: emptyReason };
  if (!comparable || prior === null) return { value, prior: null, diff: null, change: null, reason: shortReason };
```

(the remaining two lines of `kpi` stay) and

```ts
/**
 * Headline numbers with their comparison. Never NaN or Infinity: a missing or zero base gives null + a reason.
 * backfilling (history still importing): a window with gaps says "Importing history…" instead of "not enough history",
 * and a metric with no day yet says the same instead of "no data". The values themselves stay the real partial sums.
 */
export function kpis(s: Summary, opts: { backfilling?: boolean } = {}): Record<KpiId, Kpi> {
  const need = Math.ceil(s.period * MIN_COVERAGE);
  const comparable = s.current.days >= need && s.prior.days >= need;
  const short: MissingReason = opts.backfilling ? 'backfilling' : 'not_enough_history';
  const empty: MissingReason = opts.backfilling ? 'backfilling' : 'no_data';
  const fewFollowers: MissingReason = s.current.followers !== null && s.current.followers < 100 ? 'needs_100_followers' : empty;
  return {
    followers: kpi(s.current.followers, s.prior.followers, true, empty, short),
    reach: kpi(s.current.reach, s.prior.reach, comparable, empty, short),
    views: kpi(s.current.views, s.prior.views, comparable, empty, short),
    engagementRate: kpi(er(s.current), er(s.prior), comparable, empty, short),
    // media history comes from the 500-post backfill, not from daily snapshots, so post counts always compare
    posts: kpi(s.current.posts, s.prior.posts, true, 'no_data'),
    netFollows: kpi(s.current.netFollows, s.prior.netFollows, comparable, fewFollowers, short),
  };
}
```

`lib/dashboard/overview.ts` (four edits):
- after `import type { OverviewInput } from '@/lib/dashboard/read';` add `import type { SyncStatus } from '@/lib/sync/store';`
- in `interface AccountCard`, after the `syncErrorKey` line add `  coverage: number; // share of the current window's days with data (0–1); shown while importing`
- replace the first three lines of `cardState` with

```ts
/** backfilling = history still importing (SyncStatus.backfilling); without that flag (older rows): never synced and no rows. */
export function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, sync: SyncStatus | undefined, s: Summary, hasRows: boolean): CardState {
  if (status === 'needs_reconnect' || tokenStatus(tokenExpiresAt, now).state === 'expired') return 'needs_reconnect';
  if (sync?.backfilling ?? (!sync?.dailyDoneThrough && !hasRows)) return 'backfilling';
```

- in `buildOverview`'s card mapping, after `    const drop = reachDrop(daily, o.today, o.tz);` add `    const state = cardState(a.status, a.tokenExpiresAt, o.now, sync, s, daily.length > 0);` and in the returned card replace

```ts
      state: cardState(a.status, a.tokenExpiresAt, o.now, sync?.dailyDoneThrough, s, daily.length > 0),
      lastSyncedAt: sync?.lastSuccessAt ?? null,
      syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
      kpis: kpis(s),
```

with

```ts
      state,
      lastSyncedAt: sync?.lastSuccessAt ?? null,
      syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
      coverage: s.coverage.current,
      kpis: kpis(s, { backfilling: state === 'backfilling' }),
```

(The totals line `healthy = … x.state === 'ok'` is unchanged: an importing account never enters totals.)

`lib/dashboard/account.ts` — replace

```ts
  return {
    period: o.period,
    state: cardState(account.status, account.tokenExpiresAt, o.now, sync?.dailyDoneThrough, s, daily.length > 0),
    kpis: kpis(s),
```

with

```ts
  const state = cardState(account.status, account.tokenExpiresAt, o.now, sync, s, daily.length > 0);
  return {
    period: o.period,
    state,
    kpis: kpis(s, { backfilling: state === 'backfilling' }),
```

`components/overview/OverviewView.tsx` (`AccountCardView`):
- import `formatPercent` too: `import { formatCompact, formatDateTime, formatDay, formatDelta, formatNumber, formatPercent } from '@/lib/format';`
- after `  const tR = useTranslations('analysis.reasons');` (inside `AccountCardView`) add `  const tA = useTranslations('analysis');`
- replace

```tsx
          {c.state === 'backfilling' || c.state === 'no_data' ? <p className="text-xs text-muted-foreground">{tR(c.state)}</p> : null}
```

with

```tsx
          {c.state === 'backfilling' ? (
            <p className="text-xs text-muted-foreground">
              {tR('backfilling')} · {tA('coverage', { pct: formatPercent(c.coverage, prefs, 0) })}
            </p>
          ) : c.state === 'no_data' ? (
            <p className="text-xs text-muted-foreground">{tR('no_data')}</p>
          ) : null}
```

Messages — add as the FIRST key inside the top-level `"analysis": {` object:
- `messages/en.json`: `"coverage": "{pct} of this period imported so far",`
- `messages/zh-CN.json`: `"coverage": "本期已导入 {pct}",`

- [ ] **Step 4: Update the three assertions that expected the old reasons**

`tests/overview-view.test.tsx` (test "card states: …"): replace

```tsx
    expect(within(fresh).getByText(en.analysis.reasons.backfilling)).toBeInTheDocument();
```

with

```tsx
    expect(within(fresh).getByText(/of this period imported so far/)).toHaveTextContent(`${en.analysis.reasons.backfilling} · 0% of this period imported so far`);
```

`tests/dashboard-account.test.ts` (test "account with no data yet: …"): replace `    expect(m.kpis.reach).toMatchObject({ value: null, reason: 'no_data' });` with

```ts
    expect(m.kpis.reach).toMatchObject({ value: null, reason: 'backfilling' }); // importing, not 'no data'
```

`tests/account-view.test.tsx` (test "account with no data renders every reason and no NaN (zh-CN)"): replace `    expect(screen.getByText(zh.analysis.reasons.backfilling)).toBeInTheDocument();` with

```tsx
    expect(screen.getAllByText(zh.analysis.reasons.backfilling).length).toBeGreaterThan(0); // the state note and the KPI reasons
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/analysis-coverage.test.ts tests/analysis-growth.test.ts tests/analysis-flags.test.ts tests/dashboard-overview.test.ts tests/dashboard-account.test.ts tests/overview-view.test.tsx tests/account-view.test.tsx tests/messages.test.ts tests/export-report.test.ts tests/export-workbook.test.ts tests/report-pages.test.tsx && npx tsc --noEmit`
Expected: PASS (the Plan 6 combine tests in `analysis-growth.test.ts` still pass: not-comparable accounts are still excluded), no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/analysis/growth.ts lib/dashboard/overview.ts lib/dashboard/account.ts components/overview/OverviewView.tsx messages/en.json messages/zh-CN.json tests/analysis-coverage.test.ts tests/overview-view.test.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx
git commit -m "feat(analysis): coverage per window and an importing reason instead of fake comparisons" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `useSyncProgress` polling hook

**Files:**
- Create: `components/accounts/useSyncProgress.ts`
- Test: `tests/use-sync-progress.test.tsx` (new)

**Interfaces:**
- Consumes: `AccountProgress` (Task 3); `GET /api/sync/progress` → `{ accounts: AccountProgress[] }` (Task 8); `useRouter().refresh` (`next/navigation`).
- Produces: `useSyncProgress(initial: AccountProgress[]): AccountProgress[]`; constants `POLL_MS = 3_000`, `MAX_BACKOFF_MS = 60_000`. Polls only while some entry has `phase !== 'done'`; pauses while `document.visibilityState !== 'visible'`; stops on 401; adopts a new `initial` array (server re-render) via the "adjust state on prop change" pattern (the same one `NavigationProgress` uses — no `setState` inside an effect). Callers must pass a server-provided array (stable between client renders).

- [ ] **Step 1: Write the failing test** — create `tests/use-sync-progress.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProgress } from '@/lib/sync/progress';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { MAX_BACKOFF_MS, POLL_MS, useSyncProgress } from '@/components/accounts/useSyncProgress';

const progress = (o: Partial<AccountProgress> = {}): AccountProgress => ({
  accountId: 'a1',
  phase: 'running',
  percent: 10,
  stages: [{ stage: 'profile', state: 'done', done: null, total: null, reason: null }, { stage: 'account_days', state: 'running', done: 9, total: 90, reason: null }],
  current: { stage: 'account_days', day: '2026-10-05', done: 9, total: 90 },
  startedAt: '2026-10-14T02:00:00Z',
  elapsedMs: 10_000,
  etaMs: null,
  resumeInMs: null,
  errorKey: null,
  summary: { days: 9, posts: 0 },
  ...o,
});
const BOTH_DONE: AccountProgress['stages'] = [{ stage: 'profile', state: 'done', done: null, total: null, reason: null }, { stage: 'account_days', state: 'done', done: 90, total: 90, reason: null }];
/** the server render's value: one stable array, like a server component prop */
const INIT = [progress()];
const DONE = [progress({ phase: 'done', percent: 100 })];
const ok = (accounts: AccountProgress[]) => new Response(JSON.stringify({ accounts }), { status: 200, headers: { 'content-type': 'application/json' } });
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSyncProgress', () => {
  it('does not poll when nothing is running', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(DONE));
    await act(() => vi.advanceTimersByTimeAsync(4 * POLL_MS));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('polls every 3 s while running, adopts the answer, refreshes on each completed stage and stops when done', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(ok([progress({ percent: 30 })]))
      .mockResolvedValueOnce(ok([progress({ percent: 60, stages: BOTH_DONE })]))
      .mockResolvedValue(ok([progress({ phase: 'done', percent: 100, stages: BOTH_DONE })]));
    vi.stubGlobal('fetch', fetchFn);
    const { result } = renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledWith('/api/sync/progress', { cache: 'no-store' });
    expect(result.current[0].percent).toBe(30);
    expect(refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(result.current[0].percent).toBe(60);
    expect(refresh).toHaveBeenCalledTimes(1); // account days finished: show the new numbers
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(result.current[0].phase).toBe('done');
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(3); // stopped
  });

  it('backs off on errors: 3 s, then 6 s, then 12 s … capped at 60 s', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2 * POLL_MS - 1));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(4 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(10 * MAX_BACKOFF_MS));
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(3 + 2 + 10); // never faster than the cap once backed off
  });

  it('pauses while the tab is hidden and polls at once when it becomes visible again', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok([progress()]));
    vi.stubGlobal('fetch', fetchFn);
    visibility = 'hidden';
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(5 * POLL_MS));
    expect(fetchFn).not.toHaveBeenCalled();
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops polling when the session is gone (401)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 }));
    vi.stubGlobal('fetch', fetchFn);
    renderHook(() => useSyncProgress(INIT));
    await act(() => vi.advanceTimersByTimeAsync(10 * POLL_MS));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('adopts fresher server data passed in after a refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok([progress()])));
    const { result, rerender } = renderHook(({ init }) => useSyncProgress(init), { initialProps: { init: [progress({ percent: 10 })] } });
    rerender({ init: [progress({ percent: 77 })] });
    expect(result.current[0].percent).toBe(77);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/use-sync-progress.test.tsx`
Expected: FAIL — cannot resolve `@/components/accounts/useSyncProgress`.

- [ ] **Step 3: Create `components/accounts/useSyncProgress.ts`**

```ts
'use client';

// Polls the owner-only GET /api/sync/progress while an account is importing and the tab is visible. Progress is server
// state, so a reload or a second tab shows the same thing; the server render passes the first value in. Backs off on
// errors (3 s doubling to 60 s), stops on 401 and when nothing is running, and refreshes the page's server data
// whenever a stage completes (Overview numbers appear as each step lands) and once at the end.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountProgress } from '@/lib/sync/progress';

export const POLL_MS = 3_000;
export const MAX_BACKOFF_MS = 60_000;

const completed = (list: AccountProgress[]) => list.reduce((n, p) => n + (p.phase === 'done' ? 1 : 0) + p.stages.filter((s) => s.state === 'done' || s.state === 'skipped').length, 0);

export function useSyncProgress(initial: AccountProgress[]): AccountProgress[] {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    // a new server render (router.refresh, navigation) brings fresher data: adopt it
    setSeen(initial);
    setList(initial);
  }
  const active = list.some((p) => p.phase !== 'done');

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let delay = POLL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(poll, ms);
    };
    async function poll() {
      if (document.visibilityState !== 'visible') return; // paused; visibilitychange resumes
      try {
        const res = await fetch('/api/sync/progress', { cache: 'no-store' });
        if (res.status === 401) {
          stopped = true; // signed out: the next navigation goes to /login
          return;
        }
        if (!res.ok) throw new Error('progress');
        const body = (await res.json()) as { accounts?: AccountProgress[] };
        if (stopped) return;
        delay = POLL_MS;
        setList(Array.isArray(body.accounts) ? body.accounts : []);
      } catch {
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      schedule(delay);
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule(POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  const done = completed(list);
  const prev = useRef(done);
  useEffect(() => {
    if (done > prev.current) router.refresh();
    prev.current = done;
  }, [done, router]);

  return list;
}
```

- [ ] **Step 4: Run the test and lint**

Run: `npx vitest run tests/use-sync-progress.test.tsx && npx eslint components/accounts/useSyncProgress.ts tests/use-sync-progress.test.tsx`
Expected: PASS (6 tests), no lint errors.

- [ ] **Step 5: Commit**

```bash
git add components/accounts/useSyncProgress.ts tests/use-sync-progress.test.tsx
git commit -m "feat(accounts): useSyncProgress polling hook (visibility, back-off, refresh per stage)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `SyncProgressPanel` + `SyncBadge` + i18n

**Files:**
- Create: `components/accounts/SyncProgressPanel.tsx`, `components/accounts/SyncBadge.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (new top-level `sync` namespace)
- Test: `tests/sync-progress-panel.test.tsx` (new)

**Interfaces:**
- Consumes: `AccountProgress`, `StageView` (Task 3); `InsightOrb` (`size="xs" decorative`), `Progress`, `Badge`, `Button`, `Card` (existing UI kit); `connectHref(group)` from `components/accounts/ConnectDialog.tsx`; `formatDay`, `formatNumber`, `formatPercent` from `lib/format.ts`; `accounts.errors.*` messages (existing).
- Produces:
  - `SyncProgressPanel({ progress: AccountProgress[]; accounts: StoredAccount[]; busy?: boolean; onRetry: (id: string) => void })` — renders nothing when no entry matches a known account
  - `SyncBadge({ p: AccountProgress | undefined })` — renders nothing when `p` is missing or `phase === 'done'`
  - message keys `sync.*` (both catalogs)

- [ ] **Step 1: Write the failing test** — create `tests/sync-progress-panel.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { SyncBadge } from '@/components/accounts/SyncBadge';
import { SyncProgressPanel } from '@/components/accounts/SyncProgressPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';
import type { AccountProgress, StageView } from '@/lib/sync/progress';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const acct: StoredAccount = { id: 'a1', igUserId: 'a1', username: 'brand.one', displayName: null, accountType: null, profilePictureUrl: null, groupName: 'Brand X', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-10-14T00:00:00Z' };
const st = (stage: StageView['stage'], state: StageView['state'], o: Partial<StageView> = {}): StageView => ({ stage, state, done: null, total: null, reason: null, ...o });
const base: AccountProgress = {
  accountId: 'a1',
  phase: 'running',
  percent: 21,
  stages: [st('profile', 'done'), st('stories', 'done'), st('account_days', 'running', { done: 30, total: 90 }), st('posts_list', 'pending'), st('post_metrics', 'pending'), st('audience', 'pending')],
  current: { stage: 'account_days', day: '2026-09-14', done: 30, total: 90 },
  startedAt: '2026-10-14T02:00:00Z',
  elapsedMs: 150_000,
  etaMs: null,
  resumeInMs: null,
  errorKey: null,
  summary: { days: 30, posts: 0 },
};

function view(progress: AccountProgress[], locale: 'en' | 'zh-CN' = 'en', onRetry = vi.fn()) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <SyncProgressPanel progress={progress} accounts={[acct]} onRetry={onRetry} />
        <SyncBadge p={progress[0]} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return onRetry;
}

describe('SyncProgressPanel', () => {
  it('running: title, percent bar, what it is doing now, stage checklist with counts, elapsed + estimating', () => {
    view([base]);
    expect(screen.getByRole('heading', { name: 'Importing @brand.one' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Import progress for @brand.one' })).toBeInTheDocument();
    expect(screen.getByText(/^Pulling insights for .+…$/)).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).getByText('30 / 90 days')).toBeInTheDocument();
    expect(within(list).getAllByText('Done')).toHaveLength(2);
    expect(screen.getByText(/Running for 3 min · Estimating…/)).toBeInTheDocument();
    expect(screen.getByText('Importing… 21%')).toBeInTheDocument(); // the badge
  });

  it('shows an honest estimate once known', () => {
    view([{ ...base, etaMs: 7 * 60_000 }]);
    expect(screen.getByText(/About 7 min left/)).toBeInTheDocument();
  });

  it('rate limited: explains the slow-down and when it resumes', () => {
    view([{ ...base, phase: 'rate_limited', current: null, resumeInMs: 12 * 60_000 }]);
    expect(screen.getByText('Instagram asked us to slow down; resuming in about 12 min.')).toBeInTheDocument();
  });

  it('failed and stalled offer Retry; failed names the reason in plain language', async () => {
    const onRetry = view([{ ...base, phase: 'failed', current: null, errorKey: 'instagram_unavailable', stages: base.stages.map((s) => (s.stage === 'account_days' ? { ...s, state: 'failed', reason: 'instagram_unavailable' } : s)) }]);
    expect(screen.getByText(`The last batch failed: ${en.accounts.errors.instagram_unavailable}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('a1');
  });

  it('stalled is never shown as running', () => {
    view([{ ...base, phase: 'stalled', current: null }]);
    expect(screen.getByText(en.sync.phase.stalled)).toBeInTheDocument();
    expect(screen.queryByText(/Pulling insights/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('needs reconnect links to the reconnect flow (keeps the group)', () => {
    view([{ ...base, phase: 'needs_reconnect', current: null, errorKey: 'token_invalid' }]);
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', expect.stringContaining('/api/instagram/connect'));
    expect(screen.getByText(en.sync.phase.needs_reconnect)).toBeInTheDocument();
  });

  it('done: summary and a link to the dashboard; the badge disappears', () => {
    view([{ ...base, phase: 'done', percent: 100, current: null, summary: { days: 90, posts: 42 }, stages: base.stages.map((s) => ({ ...s, state: 'done' as const })) }]);
    expect(screen.getByRole('heading', { name: '@brand.one is ready' })).toBeInTheDocument();
    expect(screen.getByText('Imported 90 days of account metrics and 42 posts.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', '/accounts/a1');
    expect(screen.queryByText(/Importing…/)).not.toBeInTheDocument();
  });

  it('skipped stages say why', () => {
    view([{ ...base, stages: [...base.stages.slice(0, 5), st('audience', 'skipped', { reason: 'needs_100_followers' })] }]);
    expect(screen.getByText(en.sync.skip.needs_100_followers)).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('one polite live region per card, announcing the stage (not every percent tick)', () => {
    view([base]);
    const live = document.querySelector('[aria-live="polite"].sr-only')!;
    expect(live.textContent).toBe('@brand.one: Account metrics');
    expect(live.textContent).not.toMatch(/%/);
  });

  it('zh-CN: real Chinese text, no raw keys', () => {
    view([base], 'zh-CN');
    expect(screen.getByRole('heading', { name: '正在导入 @brand.one' })).toBeInTheDocument();
    expect(screen.getByText('30 / 90 天')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sync\.|stages\.|activity\./);
  });

  it('renders nothing for accounts it does not know (archived/removed)', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <SyncProgressPanel progress={[{ ...base, accountId: 'other' }]} accounts={[acct]} onRetry={vi.fn()} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/sync-progress-panel.test.tsx`
Expected: FAIL — cannot resolve `@/components/accounts/SyncBadge`.

- [ ] **Step 3: Add the messages** — insert this block as a new top-level key directly BEFORE the line `  "analysis": {` in `messages/en.json`:

```json
  "sync": {
    "badge": "Importing… {pct}",
    "panelTitle": "Importing @{username}",
    "doneTitle": "@{username} is ready",
    "progressLabel": "Import progress for @{username}",
    "percent": "{pct} done",
    "stages": {
      "profile": "Profile and followers",
      "stories": "Live Stories",
      "account_days": "Account metrics",
      "posts_list": "Post list",
      "post_metrics": "Post metrics",
      "audience": "Audience"
    },
    "state": {
      "pending": "Waiting",
      "running": "In progress",
      "done": "Done",
      "skipped": "Skipped",
      "failed": "Failed"
    },
    "days": "{done} / {total} days",
    "posts": "{done} / {total} posts",
    "activity": {
      "profile": "Reading the profile and follower count…",
      "stories": "Capturing live Stories…",
      "account_days": "Pulling insights for {day}…",
      "posts_list": "Listing posts…",
      "post_metrics": "Reading post {done} of {total}…",
      "audience": "Reading audience data…",
      "covers": "Saving cover images…",
      "comments": "Reading comments…"
    },
    "phase": {
      "waiting": "The next batch starts shortly.",
      "rate_limited": "Instagram asked us to slow down; resuming in about {minutes} min.",
      "needs_reconnect": "Instagram no longer accepts this connection. Reconnect the account to continue.",
      "failed": "The last batch failed: {reason}",
      "stalled": "No progress for a while. Try syncing again.",
      "done": "Import finished."
    },
    "elapsed": "Running for {minutes} min",
    "eta": "About {minutes} min left",
    "estimating": "Estimating… usually 5–10 minutes. You can leave this page; progress is saved.",
    "summary": "Imported {days} days of account metrics and {posts} posts.",
    "retry": "Retry",
    "reconnect": "Reconnect",
    "openDashboard": "Open dashboard",
    "skip": {
      "no_posts": "No posts yet",
      "needs_100_followers": "Instagram shares this from 100 followers"
    },
    "announce": "@{username}: {stage}"
  },
```

and this block directly BEFORE `  "analysis": {` in `messages/zh-CN.json`:

```json
  "sync": {
    "badge": "导入中… {pct}",
    "panelTitle": "正在导入 @{username}",
    "doneTitle": "@{username} 已就绪",
    "progressLabel": "@{username} 的导入进度",
    "percent": "已完成 {pct}",
    "stages": {
      "profile": "资料与粉丝数",
      "stories": "进行中的快拍",
      "account_days": "账号数据",
      "posts_list": "帖子列表",
      "post_metrics": "帖子数据",
      "audience": "受众"
    },
    "state": {
      "pending": "等待中",
      "running": "进行中",
      "done": "已完成",
      "skipped": "已跳过",
      "failed": "失败"
    },
    "days": "{done} / {total} 天",
    "posts": "{done} / {total} 篇帖子",
    "activity": {
      "profile": "正在读取资料和粉丝数…",
      "stories": "正在保存进行中的快拍…",
      "account_days": "正在获取 {day} 的数据…",
      "posts_list": "正在列出帖子…",
      "post_metrics": "正在读取第 {done} 篇帖子（共 {total} 篇）…",
      "audience": "正在读取受众数据…",
      "covers": "正在保存封面图…",
      "comments": "正在读取评论…"
    },
    "phase": {
      "waiting": "下一批即将开始。",
      "rate_limited": "Instagram 要求放慢速度，约 {minutes} 分钟后继续。",
      "needs_reconnect": "Instagram 不再接受此连接。请重新连接账号以继续。",
      "failed": "上一批失败：{reason}",
      "stalled": "一段时间没有进展。请再同步一次。",
      "done": "导入完成。"
    },
    "elapsed": "已运行 {minutes} 分钟",
    "eta": "约剩 {minutes} 分钟",
    "estimating": "正在估算…通常需要 5–10 分钟。你可以离开此页面，进度会保存。",
    "summary": "已导入 {days} 天的账号数据和 {posts} 篇帖子。",
    "retry": "重试",
    "reconnect": "重新连接",
    "openDashboard": "打开仪表板",
    "skip": {
      "no_posts": "还没有帖子",
      "needs_100_followers": "Instagram 在 100 位粉丝后才提供此数据"
    },
    "announce": "@{username}：{stage}"
  },
```

- [ ] **Step 4: Create `components/accounts/SyncBadge.tsx`**

```tsx
'use client';

import { Clock, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Badge } from '@/components/ui/badge';
import { formatPercent } from '@/lib/format';
import type { AccountProgress } from '@/lib/sync/progress';

const WARN = ['failed', 'needs_reconnect', 'stalled', 'rate_limited'];

/** Compact "Importing… 63%" for account rows and Overview cards; nothing once the import is done. Icon + text, never colour alone. */
export function SyncBadge({ p }: { p: AccountProgress | undefined }) {
  const t = useTranslations('sync');
  const { prefs } = usePrefs();
  if (!p || p.phase === 'done') return null;
  const warn = WARN.includes(p.phase);
  return (
    <Badge variant={warn ? 'outline' : 'secondary'} className="max-w-full">
      {p.phase === 'running' ? <InsightOrb size="xs" decorative /> : warn ? <TriangleAlert aria-hidden="true" /> : <Clock aria-hidden="true" />}
      <span className="truncate">{t('badge', { pct: formatPercent(p.percent / 100, prefs, 0) })}</span>
    </Badge>
  );
}
```

- [ ] **Step 5: Create `components/accounts/SyncProgressPanel.tsx`**

```tsx
'use client';

// The onboarding / sync progress panel (docs/TODO.md §6a): one card per account that is importing or just finished.
// Server state from useSyncProgress, so it survives reloads. Stage checklist, the current activity, elapsed time and an
// honest estimate, plain-language rate-limit / stall / error states with Retry or Reconnect, a completion summary.
// One polite live region per card announces only stage and phase changes (never every percent tick).
import Link from 'next/link';
import { Circle, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { StoredAccount } from '@/lib/accounts/types';
import { formatDay, formatNumber, formatPercent } from '@/lib/format';
import type { AccountProgress, StageView } from '@/lib/sync/progress';
import { cn } from '@/lib/utils';

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

function StageRow({ s }: { s: StageView }) {
  const t = useTranslations('sync');
  const { prefs } = usePrefs();
  const n = (v: number | null) => formatNumber(v ?? 0, prefs);
  const count = s.total && s.stage === 'account_days' ? t('days', { done: n(s.done), total: n(s.total) }) : s.total && s.stage === 'post_metrics' ? t('posts', { done: n(s.done), total: n(s.total) }) : null;
  const reason = s.state === 'skipped' && s.reason && t.has(`skip.${s.reason}`) ? t(`skip.${s.reason}`) : null;
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0">
        {s.state === 'done' ? (
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
        ) : s.state === 'running' ? (
          <InsightOrb size="xs" decorative />
        ) : s.state === 'failed' ? (
          <CircleX aria-hidden="true" className="size-4 text-destructive" />
        ) : s.state === 'skipped' ? (
          <CircleMinus aria-hidden="true" className="size-4 text-muted-foreground" />
        ) : (
          <Circle aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words', s.state === 'pending' && 'text-muted-foreground')}>{t(`stages.${s.stage}`)}</span>
        {reason ? <span className="block text-xs text-muted-foreground">{reason}</span> : null}
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {count ? <span className="block">{count}</span> : null}
        <span className="block">{t(`state.${s.state}`)}</span>
      </span>
    </li>
  );
}

function PanelCard({ p, account, busy, onRetry }: { p: AccountProgress; account: StoredAccount; busy: boolean; onRetry: (id: string) => void }) {
  const t = useTranslations('sync');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const username = account.username;
  const done = p.phase === 'done';
  const pct = formatPercent(p.percent / 100, prefs, 0);
  const activity = p.current
    ? t(`activity.${p.current.stage}`, { day: p.current.day ? formatDay(p.current.day, prefs) : '', done: formatNumber(p.current.done + 1, prefs), total: formatNumber(p.current.total ?? 0, prefs) })
    : null;
  const reason = p.errorKey && tErr.has(p.errorKey) ? tErr(p.errorKey) : tErr('unexpected');
  const status =
    p.phase === 'running' ? activity
    : p.phase === 'rate_limited' ? t('phase.rate_limited', { minutes: formatNumber(minutes(p.resumeInMs ?? 0), prefs) })
    : p.phase === 'failed' ? t('phase.failed', { reason })
    : t(`phase.${p.phase}`);
  const currentStage = p.stages.find((s) => s.state === 'running' || s.state === 'failed') ?? p.stages.find((s) => s.state === 'pending');
  const announce = done ? t('phase.done') : t('announce', { username, stage: currentStage ? t(`stages.${currentStage.stage}`) : t('phase.waiting') });

  return (
    <Card>
      <CardContent className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="min-w-0 break-words font-semibold">{done ? t('doneTitle', { username }) : t('panelTitle', { username })}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{t('percent', { pct })}</span>
        </div>
        <Progress value={p.percent} aria-label={t('progressLabel', { username })} />
        {status ? (
          <p className={cn('flex min-w-0 items-center gap-2 text-sm', p.phase === 'failed' || p.phase === 'needs_reconnect' || p.phase === 'stalled' ? 'text-destructive' : 'text-muted-foreground')}>
            {p.phase === 'running' ? <InsightOrb size="xs" decorative /> : null}
            <span className="min-w-0 break-words">{status}</span>
          </p>
        ) : null}
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {p.stages.map((s) => (
            <StageRow key={s.stage} s={s} />
          ))}
        </ol>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 break-words">
            {done
              ? t('summary', { days: formatNumber(p.summary.days, prefs), posts: formatNumber(p.summary.posts, prefs) })
              : [p.elapsedMs !== null ? t('elapsed', { minutes: formatNumber(minutes(p.elapsedMs), prefs) }) : null, p.etaMs !== null ? t('eta', { minutes: formatNumber(minutes(p.etaMs), prefs) }) : t('estimating')].filter(Boolean).join(' · ')}
          </span>
          <span className="flex flex-wrap gap-2">
            {p.phase === 'failed' || p.phase === 'stalled' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(p.accountId)}>
                {t('retry')}
              </Button>
            ) : null}
            {p.phase === 'needs_reconnect' ? (
              <Button size="sm" asChild>
                <a href={connectHref(account.groupName)}>{t('reconnect')}</a>
              </Button>
            ) : null}
            {done ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/accounts/${p.accountId}`}>{t('openDashboard')}</Link>
              </Button>
            ) : null}
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </CardContent>
    </Card>
  );
}

export function SyncProgressPanel({ progress, accounts, busy = false, onRetry }: { progress: AccountProgress[]; accounts: StoredAccount[]; busy?: boolean; onRetry: (id: string) => void }) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const shown = progress.filter((p) => byId.has(p.accountId));
  if (shown.length === 0) return null;
  return (
    <section className="mb-[var(--gp)] grid gap-[var(--gp)]">
      {shown.map((p) => (
        <PanelCard key={p.accountId} p={p} account={byId.get(p.accountId)!} busy={busy} onRetry={onRetry} />
      ))}
    </section>
  );
}
```

- [ ] **Step 6: Run the tests and lint**

Run: `npx vitest run tests/sync-progress-panel.test.tsx tests/messages.test.ts tests/ui-imports.test.ts tests/admin-guard.test.ts && npx eslint components/accounts && npx tsc --noEmit`
Expected: PASS (11 panel tests; catalogs in parity with real zh-CN), no lint or type errors.

- [ ] **Step 7: Commit**

```bash
git add components/accounts/SyncProgressPanel.tsx components/accounts/SyncBadge.tsx messages/en.json messages/zh-CN.json tests/sync-progress-panel.test.tsx
git commit -m "feat(accounts): sync progress panel and badge (stages, activity, estimate, states)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
