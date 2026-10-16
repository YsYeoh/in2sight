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
  - `interface AccountProgress { accountId; phase; percent; stages: StageView[]; current: { stage: Stage; day: string | null; done: number; total: number | null } | null; startedAt: string | null; elapsedMs: number | null; etaMs: number | null; resumeAt: string | null; errorKey: string | null; summary: { days: number; posts: number } }`
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
    expect(p.resumeAt).toBe(new Date(NOW.getTime() + 50 * MIN).toISOString());
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

export type ProgressState = Pick<SyncState, 'lastRun' | 'dailyDoneThrough' | 'backfilledFrom' | 'leaseUntil' | 'lastAttemptAt' | 'lastErrorKey' | 'consecutiveFailures'>;

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
  resumeAt: string | null; // rate limited: when the back-off ends
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

/** Worth showing: history still importing, a run not finished, or a run that finished a few minutes ago. */
export function isTracked(i: Pick<ProgressInput, 'state' | 'live'>, now: Date): boolean {
  if (isBackfilling(i.state)) return true;
  if (!i.live) return false;
  return i.live.finishedAt === null || now.getTime() - Date.parse(i.live.finishedAt) < RECENT_MS;
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
  else if (!backfilling && (!live || live.state === 'done' || live.finishedAt !== null)) phase = 'done';
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
    resumeAt: phase === 'rate_limited' && s.lastAttemptAt ? new Date(Date.parse(s.lastAttemptAt) + backoffMs(s.consecutiveFailures)).toISOString() : null,
    errorKey,
    summary: { days: covered, posts: i.posts.measured },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/sync-progress.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/progress.ts tests/sync-progress.test.ts
git commit -m "feat(sync): pure progress model (stages, percent, phase, estimate)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
