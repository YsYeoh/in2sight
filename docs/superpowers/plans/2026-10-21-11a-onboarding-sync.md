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
