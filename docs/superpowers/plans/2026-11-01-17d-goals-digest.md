# Plan 17d: Goals + weekly / monthly digest (new side-nav item "Plan") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** answer "where do I stand?" for a week or a month. ONE new side-nav item **Plan** (`/plan`, sidebar, icon rail, phone bottom bar, shell tab titles) with two sections in the Settings URL pattern: **Digest** (`/plan/digest?week=YYYY-MM-DD` or `?month=YYYY-MM`: per account and for all accounts, the Overview's KPIs for one calendar week or month compared with the one before, the 3 best and 3 weakest feed posts by reach, and each account's goals now) and **Goals** (`/plan/goals`: per account, at most one goal of each kind: followers by a date, average reach per post this month, posts per week; pace, projection and an honest status, explicit save).

**Architecture:** one migration `supabase/migrations/20261103000001_goals.sql` (table `goals`, owner-all RLS under `is_owner()`, cascade from `accounts`, unique `(account_id, metric)`; NEVER applied by an implementer). Pure progress maths in `lib/analysis/goals.ts` (Vitest), reusing the Growth projection (`projectFollowers`, Theil-Sen, gains an optional `horizons` argument: default unchanged). The digest is NOT a second dashboard: `lib/plan/model.ts` turns the period into a fixed Time Scope and calls the existing `buildOverview` (same KPIs, comparison, 80 % coverage rule, healthy-only totals, groups) on the existing `loadOverviewInput` read; it adds only the top/bottom posts (from the same read) and the goals. Goals storage = `lib/plan/goals.ts` (owner session, error keys). Pages are wiring (`app/(app)/plan/...`). No sync change, no Meta call, no new dependency, no new design token.

**Tech stack:** Next.js App Router (TS strict), next-intl, Vitest + Testing Library, Supabase owner session (RLS). Rules from the roadmap apply unchanged: `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §3 "Rules that apply to EVERY plan" (not repeated here).

**Independence and order:** written at `main` = `81054d7`. Plans 17a (content lab), 17b (insights feed + Today, migration `20261101000001_insight_dismissals.sql`), 17c (auto-tagging, migration `20261102000001_tag_rules.sql`) and 17e (smart alerts, migration `20261104000001_smart_alerts.sql`) are planned, NOT built. **This plan uses none of their code** and builds on `81054d7` alone; roadmap order 17a → 17b → 17c → 17d → 17e. Shared files and how each collision is avoided are listed under "Collisions with 17a / 17b / 17c". The migration timestamp `20261103000001` sorts after 17b / 17c and before 17e; no shared table. **Plan 17e depends on this route:** its `WEEKLY_REVIEW_HREF` switches from `/overview` to `/plan/digest` once `app/(app)/plan/[[...section]]/page.tsx` exists (exactly the path Task 6 creates; keep it). Plan 17f adds `'board'` to `PLAN_SECTIONS` (`lib/plan/sections.ts`).

**Scratch run:** every code block below was written into a throwaway `git clone` of `main` at `81054d7` in the session scratchpad (own `npm ci`; the real `node_modules` untouched) and the migration ran on PGlite 0.3.15 (Postgres 17 in WASM) on top of all 16 existing migrations. Results: "Scratch-run result" at the end.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

Assumed from roadmap §4 (the owner approved the recommended defaults as working assumptions):
- **⚠ Q2 (a), assumed from roadmap §4:** goals per account only, three kinds: **followers by a date**, **average reach per post in the current month**, **posts per week**. No group / all-accounts goals, no other registry metric, no "saves per post" (roadmap marked it optional: left out, ponytail).
- **⚠ Q3 (a), assumed from roadmap §4:** the digest is an **in-app page**; the Monday push that links to it is Plan 17e; **no email**.
- **⚠ Q8, assumed from roadmap §4:** ONE side-nav item **Plan** with sections Digest and Goals (17f adds Board). The side navigation is kept; the item sits between Explorer and Settings (7 items; the phone bottom bar becomes 7 columns).
- **⚠ SPEC change needed:** `docs/SPEC.md` §7b says "Not in v1: goals/targets, scheduled or emailed reports". Task 7 edits it (goals and an in-app digest move in; emailed reports stay out). **CLAUDE.md: the owner must nod this SPEC edit before Task 7 is merged** (the orchestrator asks; if the owner says no, stop the plan).

This plan's own decisions:
- **URLs follow the Settings pattern** (`lib/settings/sections.ts`): `/plan` redirects to `/plan/digest`; `/plan/<id>` for a known id; anything else is a 404. The sections are underline tabs (`TabsList variant="line"`, UI standard 7) in `app/(app)/plan/layout.tsx`, navigating like the account tabs; a dirty goals form asks before leaving (`confirmLeave`, the Settings guard).
- **Period, not the range bar.** The digest is one calendar week (week-start setting) or one calendar month in the owner timezone: a `Segmented` Week / Month + Previous / Next links; no `RangeBar` (the period IS the range; UI standard 4 allows the bar but a free range would turn the digest into a second Overview). URL: `?week=<first day>` or `?month=YYYY-MM` (both already accepted by the Time Scope parser as inputs); default = the **last complete week**; a period that starts after today, junk or repeated params fall back to the default. The running week / month may be opened (Next from the last complete one); it says "still running" and the comparison is cut to the same number of days (the existing `compareRange`).
- **Numbers = the Overview's.** `buildDigest` calls `buildOverview` with the fixed scope `{ range: <period>, cmp: 'prev', gran: 'day' }`, so every KPI, delta, "not enough history" (80 % coverage) and the settled-day lag (`MAX_LAG_DAYS`) behave exactly as on Overview for the same days (RUNBOOK §2 checks it). KPIs shown: followers, net follows, reach, views, engagement, posts.
- **Best / weakest posts** = the period's feed posts (Stories excluded) with reach, by their latest reach (core metric, so the latest snapshot is right; the 17a "latest-known" trap concerns follows / profile visits only), top 3; the weakest 3 only from 7 measured posts (no overlap). A post fewer than 7 days old (vs today) is marked "still gaining reach". Each links to its Post Lab. No covers (the read has no cover status; a format + date link is enough).
- **No findings block** (roadmap wanted 17b's findings): 17b is not built; adding them is a small follow-up once 17b lands (one list in `DigestView`). **No digest export** (roadmap: "only if trivial"): the Overview export with the same week does it already; out.
- **Goals: one per (account, metric)**, unique in SQL; so the roadmap's "max 20 per account" is moot (3). No `period` column: the kind fixes the period (followers → by a date, avg reach → calendar month, posts → week). `target` is a whole number 1 to 1,000,000,000 (posts per week: 1 to 50); a followers goal needs a due day after today, at most 1,830 days ahead; other kinds have none (SQL checks + `parseGoalInput`, same numbers, pinned by a test).
- **Pace and projection** (pure, `lib/analysis/goals.ts`):
  - followers: baseline = the count on the day the goal was created (owner timezone; the first count after it if none); pace line baseline → target on the due day; status Reached / On track (at or above the line) / Behind / Missed (due day passed). Projection = `projectFollowers` (Theil-Sen over the last 28 days, at least 14 points, else "not enough history"), evaluated at the due day, **today's part-day count left out** (PROGRESS §10 lesson), band = the 25th-75th percentile slopes, Low or Medium only and **always Low beyond 90 days**; verdict likely (band low ≥ target) / unlikely (band high < target) / could go either way.
  - avg reach: mean reach of the month's feed posts with reach; no status below 3 such posts ("needs 3 posts"); posts under 7 days old are counted and named ("still gaining reach"). No projection (the average so far is the run rate).
  - posts per week: feed posts this week; even pace = floor(target × days so far ÷ 7); Reached / On track / Behind; last week's count shown.
  - A goal's progress is always "now", also on a past digest period (a past period's goal state is not stored; said by the "Goals now" heading).
  - Editing a goal keeps its start (the pace line); clearing it deletes it; setting it again starts a new line.
- **Save model:** one explicit-save form per account (UI standard 18: dirty tracking, `SaveBar`, unsaved guard). The browser validates with the same `parseGoalInput` and names a wrong value before sending; the server re-validates. After a save the page refreshes (progress is computed on the server).
- **Without the migration:** Goals shows one "needs a database update" message; the Digest works and simply has no goals block; `loadGoals` returns null on `PGRST205` / `42P01`, any other error throws a fixed message (page error boundary).
- **Export / storage:** `goals` joins `EXPORT_TABLES` (owner data, not third-party). `delete_all_data()` needs no change (cascade from `accounts`, PGlite verified). `data_usage()` (16c, applied) lists tables by a literal array, so `goals` (a handful of rows) is not counted in "Storage used" (same choice as 17c).
- **Privacy:** no third-party data anywhere (no comments, no names, no captions: the digest lists posts by format + date). Nothing logged. Owner session only; `requireOwner()` in the page and the action; no route-policy change (`/plan` is not public).

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_DIGEST.md`)

1. **Default period:** last complete week (Monday review). Alternative: the running week.
2. **Plan's place in the nav:** between Explorer and Settings. Alternative: after Overview.
3. **avg reach guard 3 posts / weakest posts from 7 / "young" = 7 days.** Alternatives: 5 posts (the Post Lab guard) for the average.
4. **L1 — digest = Overview:** for the last complete week, every KPI of the digest equals Overview opened with the same fixed days (`?from=<monday>&to=<sunday>`). RUNBOOK §2.
5. **L2 — speed:** `/plan/digest` reads like Overview (one `loadOverviewInput` + one goals read); warm ≤ 1.2 s p75 with two accounts. RUNBOOK §4.
6. **L3 — the migration on the real project:** `goals` exists, anon is denied (`42501`), the owner session saves and reads. RUNBOOK §0 / §3.

## Owner prerequisites

1. **Nod the SPEC edit** (Decisions, ⚠ SPEC change) before Task 7 merges.
2. **Apply `20261103000001_goals.sql`** (owner's explicit go-ahead; `docs/RUNBOOK_DIGEST.md` §0) BEFORE deploying. Order with other pending migrations: after 17b's / 17c's if they exist (file order); independent of them. The code degrades without it (Goals says "needs a database update"; the export of `goals` fails with the existing export error until applied: noted in the runbook).

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- `lib/nav.ts:1` imports `CalendarDays, ChartNoAxesCombined, CircleUserRound, LayoutDashboard, Settings, Tag` from lucide; `:4-8` `NavItem` with `href` / `key` unions of the six items; `:10-17` `NAV_ITEMS` (Explorer line `:15`); `navHref` adds the Time Scope only for `SCOPED = ['/overview', '/calendar', '/explorer']` (Plan is not scoped). `lib/tabs/model.ts:50` `isTabPath` and `:59` `navKeyOf` derive from `NAV_ITEMS`, so `/plan/*` becomes a tab page and gets the tab title `nav.plan` with no change there.
- `components/shared/AppShell.tsx:92` the phone bar `className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t …"`; `tests/app-shell.test.tsx:147` asserts `grid-cols-6`.
- `public/sw.js:81` `const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|settings)(\/|$)/;`; `tests/service-worker.test.ts:197-201` requires it to contain `NAV_ITEMS` hrefs joined by `|` in order.
- `tests/nav.test.ts:189-192` pins the six items; `:199` `for (const href of ['/accounts', '/tags', '/settings'])`. `tests/tabs-model.test.ts:11-13` the "six main pages" `isTabPath` test.
- `lib/settings/sections.ts` (the pattern copied by `lib/plan/sections.ts`); `app/(app)/settings/layout.tsx` + `[[...section]]/page.tsx` + `loading.tsx` (the route shape); `tests/route-loading.test.tsx` requires a `loading.tsx` next to every page (the new `(app)/plan/[[...section]]` gets one; the layout needs none).
- `components/settings/SaveBar.tsx` (`dirty, pending, result, error, saved, onDiscard`; registers `useUnsavedGuard`), `components/settings/unsaved.ts` `confirmLeave`, `components/settings/AlertSettingsForm.tsx` (the explicit-save pattern, `isRedirectError`), `components/shared/FormField.tsx` (render-prop), `components/shared/Segmented.tsx`, `components/shared/StatCard.tsx`, `components/shared/useKpiDelta.ts`, `components/shared/RangeBar.tsx` `useScopeText(scope).vs`, `components/account/AccountView.tsx:34-39` (tabs navigate with `startProgress` + `router.push` in a transition).
- `lib/dashboard/read.ts:255` `loadOverviewInput(db, fromDay, tz)` (accounts minus archived, sync, `account_daily` from `fromDay`, posts newest 500 + back to `fromDay`, latest snapshot embedded). `lib/dashboard/overview.ts:53` `buildOverview(input, { scope, today, now, tz, locale, weekStart })` → `{ scope, totals, sections[{ group, totals, cards[{ id, username, kpis, … }] }] }`.
- `lib/time-scope/scope.ts` `resolveScope`, `readFrom`, `earliestDay`, `TimeScope` (`range` may be a `DayRange`); `lib/time-scope/range.ts` `weekOf`, `monthOf`, `daysBetween`, `isDay`, `minDay`; `lib/sync/time.ts` `localDay`, `addDays`.
- `lib/analysis/trend.ts:11` `PROJECTION = { days: 28, minPoints: 14, mediumPoints: 21, horizons: [7, 30, 90] } as const`; `:62` `export function projectFollowers(points: { day: string; value: number }[]): ProjectionResult {`; `:73` `  const horizons = PROJECTION.horizons.map((days) => {`; `:79` the return ends `… ? 'medium' : 'low', horizons };`. Callers: `lib/dashboard/growth.ts:194` (one argument: unchanged behaviour).
- `lib/analysis/types.ts` `DailyRow`, `Post` (`mediaType` incl. `'STORY'`, `reach: number | null`).
- `lib/data/export.ts:32` `  { name: 'explorer_views', keys: ['id'] },` inside `EXPORT_TABLES`; `tests/data-export.test.ts:56-68` parses `create table public.<name> (…\n);` for the primary key; `tests/settings-data.test.tsx:84,87,92` count `18` / `'18 files downloaded.'` / `20` at `81054d7` (**after 17b and 17c they read 21 / 21 / 23**: Task 5 adds one to whatever is there).
- `messages/en.json` / `zh-CN.json`: `nav` block lines 33-42 (`"explorer"`, `"settings"`, `"sidebar"` lines 38-40); `settings.data.tables.explorer_views` line 427; `settings.data.deleteAll.removes` line 439; the top-level `  "metrics": {` line 1175 (the only line with exactly that indentation), followed by `    "followers": "Followers",` (zh `"粉丝"`). zh-CN calls reach `触达`. `metrics.<KpiId>`, `analysis.reasons.*`, `analysis.format.*`, `settings.unsaved.confirm`, `common.save` exist.
- `lib/prefs.server.ts` `getPrefs()` (cookie: `timezone`, `weekStart`, `locale`); `lib/auth/require-owner.ts` `requireOwner()`; `lib/supabase/server.ts` `createServerSupabase()`.
- `tests/migrations.test.ts`: every `create table public.X` needs RLS + a policy `to authenticated`, no policy to anon/public, policies never call bare `auth.uid()`.

## Collisions with 17a / 17b / 17c / 17e (checked against their plan files; do not depend on them; merge in any order)

| Shared file | 17d's change | Theirs | Safe because |
|---|---|---|---|
| `lib/analysis/trend.ts` | lines 62, 73, 79 (horizons argument) | 17a exports `rank` (line 59); 17b / 17e only import `weekdayAnomaly` | different lines; the Edit anchors stay unique |
| `lib/data/export.ts` | a line after `explorer_views` | 17b also inserts after `explorer_views`; 17c after `media_tags` | the `explorer_views` line itself never changes, so the anchor stays unique; the order of the inserted lines does not matter |
| `tests/settings-data.test.tsx` | +1 to the three counts | 17b +1, 17c +2 | Task 5 says "add one to the number that is there" (18 / 18 / 20 at `81054d7`; 21 / 21 / 23 after 17b and 17c) |
| `messages/*.json` | `nav.plan`, `settings.data.tables.goals` (after `explorer_views`), `deleteAll.removes`, new top-level `plan` (before the top-level `metrics` line) | 17a `pages.account.*`; 17b top-level `insights` (before the top-level `notifications` line) and `settings.data.tables.insight_dismissals` (after `explorer_views`); 17c `pages.tags.*`, tables after `media_tags`; 17e inside `notifications.kinds` / `settings.notifications` | the anchors stay unique (the `explorer_views` label line is never changed); no other plan uses a top-level `plan` key or `nav.plan` |
| `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md` | new §7o, TODO `6u`, PROGRESS rows | 17a §7l / 6r, 17b §7m / 6s, 17c §7n / 6t, 17e edits §7c in place / 6v | letters reserved by each plan; each inserts before a fixed anchor |
| migrations | `20261103000001_goals.sql` | 17b `20261101000001`, 17c `20261102000001`, 17e `20261104000001` (notification kinds) | file order; no shared table |
| routes / nav | `/plan`, `/plan/digest`, `/plan/goals`, `NAV_ITEMS`, `public/sw.js` `TAB_PAGE` | 17e links `/plan/digest` and does not touch `sw.js`; 17b adds no route; 17f will add `/plan/board` | no other plan edits `lib/nav.ts`, `AppShell.tsx` or `sw.js` |

## Out of scope

Email, the digest push (17e), findings in the digest (follow-up after 17b), digest export (Overview export covers it), group / all-accounts goals, goal history per past period, Stories in post goals, AI wording (17g), covers in the digest lists.

## Global Constraints

- Roadmap §3 "Rules that apply to EVERY plan" (link, not repeated). Ponytail: one migration, no new dependency, no new token, no new shared component beyond `components/plan/*`.
- TypeScript strict. Reads and writes with the owner session only (`createServerSupabase`), never the admin client; fixed error messages (`goals read failed`), error KEYS to the UI.
- Every UI string via next-intl; ALL new keys are added by Task 1 in BOTH catalogs (real Simplified Chinese, full-width punctuation).
- Tests: Vitest; lib / action tests `// @vitest-environment node`; fakes only; never connect to Supabase. The migration file is NEVER applied by an implementer.
- `npm run check` passes after every wave. Commits: conventional, `git add` the listed paths only, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus (opus read-only review after the last wave)

1. **Period boundaries:** owner timezone days; week = week-start setting (`weekOf`), month = calendar month; the running period compares the same number of days (`compareRange`); the settled-day lag (`MAX_LAG_DAYS`) ends the window like Overview; "last complete week" on a Monday / Sunday with both week starts; DST weeks (Europe/London test).
2. **Comparison coverage rule:** the digest uses `buildOverview` unchanged (80 % `MIN_COVERAGE`, healthy-only totals): grep that `lib/plan/model.ts` computes no KPI itself.
3. **Honest projection:** today's part-day count excluded; "not enough history" under 14 points; never "High"; Low beyond 90 days; no number shown as 0 when missing (`—` / a reason).
4. **Goal validation at the trust boundary:** `parseGoalInput` in the action (never trusts the form), SQL checks equal the TS constants (cross-check test), `accountId` uuid check, FK error → `invalid`, missing table → `needs_update`; no Supabase text reaches the UI.
5. **Nav change:** 7 items everywhere (sidebar, rail, phone bar `grid-cols-7`, service worker `TAB_PAGE`, `isTabPath`), 360 px phone bar still readable, `/plan` not in `route-policy.ts`.
6. **Privacy / RLS:** `goals` owner-all InitPlan policy, anon revoked, cascade; no logging in new files; no third-party data in the digest.
7. **Empty / degraded states:** no accounts, no posts, no migration, a goal without data.

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | `nav.plan`, `settings.data.tables.goals`, `settings.data.deleteAll.removes`, top-level `plan.*` |
| `supabase/migrations/20261103000001_goals.sql` (new), `tests/goals-migration.test.ts` (new) | 2 | the table, RLS; static SQL test |
| `lib/analysis/goals.ts` (new), `lib/analysis/trend.ts`, `tests/analysis-goals.test.ts` (new) | 3 | pace / projection / status, pure |
| `lib/plan/sections.ts` (new), `lib/plan/goals.ts` (new), `lib/plan/model.ts` (new), `tests/plan-model.test.ts` (new) | 4 | sections routing, goals storage, digest + goals models |
| `lib/nav.ts`, `components/shared/AppShell.tsx`, `public/sw.js`, `tests/nav.test.ts`, `tests/tabs-model.test.ts`, `tests/app-shell.test.tsx`, `lib/data/export.ts`, `tests/settings-data.test.tsx` | 5 | the nav item; the export registry |
| `components/plan/PlanNav.tsx`, `components/plan/GoalLine.tsx`, `components/plan/DigestView.tsx`, `components/plan/GoalsView.tsx`, `app/(app)/plan/layout.tsx`, `app/(app)/plan/actions.ts`, `app/(app)/plan/[[...section]]/page.tsx`, `app/(app)/plan/[[...section]]/loading.tsx` (all new), `tests/plan-views.test.tsx` (new), `tests/plan-actions.test.ts` (new) | 6 | UI, route, server action |
| `docs/RUNBOOK_DIGEST.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 7 | runbook and docs |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor with the block shown), never by re-serialising the JSON. Keep every other line byte-identical; both locales get the same keys.

**Editing existing files:** exact old → new text for the Edit tool. The working copies are CRLF; the Edit tool matches either; do not convert line endings. New files: use the Write tool (they contain regexes, `—`, `§` and Chinese).

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261103000001_goals.sql`, `tests/goals-migration.test.ts` | 1, 3 |
| 3 goals analysis | — | `lib/analysis/goals.ts`, `lib/analysis/trend.ts`, `tests/analysis-goals.test.ts` | 1, 2 |
| 4 plan libs | 2, 3 | `lib/plan/sections.ts`, `lib/plan/goals.ts`, `lib/plan/model.ts`, `tests/plan-model.test.ts` | 5 |
| 5 nav + export registry | 1, 2 | `lib/nav.ts`, `components/shared/AppShell.tsx`, `public/sw.js`, `tests/nav.test.ts`, `tests/tabs-model.test.ts`, `tests/app-shell.test.tsx`, `lib/data/export.ts`, `tests/settings-data.test.tsx` | 4 |
| 6 UI + route + action | 1, 4, 5 | `components/plan/*` (4 files), `app/(app)/plan/*` (4 files), `tests/plan-views.test.tsx`, `tests/plan-actions.test.ts` | 7 |
| 7 docs | 2 (+ the owner's nod on the SPEC edit) | `docs/RUNBOOK_DIGEST.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 6 |

**Waves (at most 3 sonnet worktree agents at a time; check free disk first, `Get-PSDrive C`):** 1 = Tasks 1, 2, 3 → 2 = Tasks 4, 5 → 3 = Tasks 6, 7. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log` and READ it (implementer rules, orchestrator checklist). Every wave leaves `main` green: wave 1 adds unused keys, an unapplied migration and an unused pure module; wave 2 adds unused libs and the nav item (until wave 3 the Plan link opens a 404 page: harmless, never pushed in between); wave 3 adds the route. Then the opus review (Review Focus), ONE fix wave, check, docs ticks.

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

- [ ] **Step 1 — `messages/en.json`.** Make these replacements (each old text occurs exactly once):

Edit 1: replace the exact text

```
    "explorer": "Explorer",
    "settings": "Settings",
    "sidebar": "Main navigation",
```

with

```
    "explorer": "Explorer",
    "plan": "Plan",
    "settings": "Settings",
    "sidebar": "Main navigation",
```

Edit 2: replace the exact text

```
        "explorer_views": "Saved Explorer views",
```

with

```
        "explorer_views": "Saved Explorer views",
        "goals": "Goals",
```

Edit 3: replace the exact text

```
moderation rules and log, tags, saved views, notifications and the sync history.",
```

with

```
moderation rules and log, tags, saved views, goals, notifications and the sync history.",
```

Edit 4: replace the exact text

```
  "metrics": {
    "followers": "Followers",
```

with

```
  "plan": {
    "title": "Plan",
    "subtitle": "Where you stand: a week or a month on one page, and your goals.",
    "sections": {
      "label": "Plan sections",
      "digest": { "title": "Digest", "description": "A week or a month per account, compared with the one before." },
      "goals": { "title": "Goals", "description": "Targets per account and how you are doing now." }
    },
    "digest": {
      "period": "Period",
      "week": "Week",
      "month": "Month",
      "previous": "Previous",
      "next": "Next",
      "range": "{from} to {to}",
      "source": "Instagram's daily account numbers, compared with the period before. A comparison needs data on 80% of its days.",
      "running": "This period is still running: it is compared with the same number of days of the one before.",
      "allAccounts": "All accounts",
      "isolated": "Accounts without a group",
      "empty": "No accounts yet",
      "emptyHint": "Connect an Instagram account on the Accounts page to get a digest.",
      "postsSource": "{n, plural, one {# feed post} other {# feed posts}} with reach in this period, ranked by their latest reach.",
      "topTitle": "Best posts",
      "bottomTitle": "Weakest posts",
      "bottomFew": "The weakest posts show from {n} posts with reach.",
      "noPosts": "No feed post with reach in this period.",
      "reach": "Reach {value}",
      "young": "still gaining reach",
      "openPostLab": "Open the {format} of {date} in the Post Lab",
      "goalsTitle": "Goals now",
      "noGoals": "No goals for this account.",
      "setGoals": "Set goals"
    },
    "goals": {
      "needsUpdate": "Goals need a database update",
      "needsUpdateHint": "Apply the migration 20261103000001_goals.sql (docs/RUNBOOK_DIGEST.md §0), then reload this page.",
      "empty": "No accounts yet",
      "emptyHint": "Connect an Instagram account on the Accounts page to set goals.",
      "pattern": "Pace and projections are rules applied to your own numbers: a guide, not a promise.",
      "formHint": "Leave a field empty for no goal. Progress is checked against Instagram's numbers each time this page opens.",
      "progressLabel": "Goals of @{username}",
      "followers": "Followers",
      "followersHint": "The follower count to reach (1 to {max}).",
      "followersDue": "By",
      "followersDueHint": "A day after today, at most 5 years ahead.",
      "avgReach": "Average reach per post",
      "avgReachHint": "Feed posts published this month (1 to {max}).",
      "postsPerWeek": "Posts per week",
      "postsPerWeekHint": "Reels, photos and carousels; Stories do not count (1 to {max}).",
      "saved": "Goals saved.",
      "errors": {
        "invalid": "Some values are not valid: whole numbers in the range shown, and a day after today for followers.",
        "needs_update": "Goals need a database update.",
        "unexpected": "Could not save the goals. Try again."
      },
      "status": { "done": "Reached", "ahead": "On track", "behind": "Behind", "missed": "Missed" },
      "confidence": { "low": "Low", "medium": "Medium" },
      "followersLine": "{actual} of {target} followers by {date}. The straight line from {baseline} is at {expected} today.",
      "followersNoData": "No follower count yet.",
      "forecast": "Projection for {date}: about {value} (between {low} and {high}), {confidence} confidence, from your last {n} days. {verdict, select, likely {Likely to get there.} unlikely {Unlikely at this pace.} other {Could go either way.}}",
      "forecastFew": "No projection yet: it needs 14 days of follower counts ({n} so far).",
      "avgLine": "Average reach {actual} over {n, plural, one {# post} other {# posts}} this month (goal {target}).",
      "avgFew": "Needs 3 posts with reach this month to judge.",
      "avgNone": "No post with reach this month yet.",
      "avgYoung": "{young, plural, one {# post is} other {# posts are}} under 7 days old and still gaining reach.",
      "postsLine": "{actual} of {target} posts this week; an even pace asks for {expected} by today. Last week: {last}."
    }
  },
  "metrics": {
    "followers": "Followers",
```

- [ ] **Step 2 — `messages/zh-CN.json`.** Make these replacements:

Edit 1: replace the exact text

```
    "explorer": "探索",
    "settings": "设置",
    "sidebar": "主导航",
```

with

```
    "explorer": "探索",
    "plan": "计划",
    "settings": "设置",
    "sidebar": "主导航",
```

Edit 2: replace the exact text

```
        "explorer_views": "已保存的探索视图",
```

with

```
        "explorer_views": "已保存的探索视图",
        "goals": "目标",
```

Edit 3: replace the exact text

```
标签、已保存视图、通知以及同步记录。",
```

with

```
标签、已保存视图、目标、通知以及同步记录。",
```

Edit 4: replace the exact text

```
  "metrics": {
    "followers": "粉丝",
```

with

```
  "plan": {
    "title": "计划",
    "subtitle": "你现在的位置：一周或一个月汇总在一页，以及你的目标。",
    "sections": {
      "label": "计划分区",
      "digest": { "title": "摘要", "description": "按账号查看一周或一个月，并与上一周期比较。" },
      "goals": { "title": "目标", "description": "每个账号的目标以及目前的进度。" }
    },
    "digest": {
      "period": "周期",
      "week": "周",
      "month": "月",
      "previous": "上一个",
      "next": "下一个",
      "range": "{from} 至 {to}",
      "source": "Instagram 每日账号数据，与上一周期比较。比较需要该周期 80% 的天数有数据。",
      "running": "此周期尚未结束：与上一周期相同天数进行比较。",
      "allAccounts": "全部账号",
      "isolated": "未分组的账号",
      "empty": "还没有账号",
      "emptyHint": "在账号页面连接 Instagram 账号后即可查看摘要。",
      "postsSource": "此周期内有触达数据的动态 {n, plural, other {# 条}}，按最新触达排序。",
      "topTitle": "表现最好的帖子",
      "bottomTitle": "表现最弱的帖子",
      "bottomFew": "有 {n} 条或以上有触达数据的帖子时才显示最弱的帖子。",
      "noPosts": "此周期内没有有触达数据的动态。",
      "reach": "触达 {value}",
      "young": "触达仍在增长",
      "openPostLab": "在帖子实验室中打开 {date} 的{format}",
      "goalsTitle": "目前的目标",
      "noGoals": "此账号还没有目标。",
      "setGoals": "设置目标"
    },
    "goals": {
      "needsUpdate": "目标需要更新数据库",
      "needsUpdateHint": "请应用迁移 20261103000001_goals.sql（docs/RUNBOOK_DIGEST.md §0），然后重新加载此页面。",
      "empty": "还没有账号",
      "emptyHint": "在账号页面连接 Instagram 账号后即可设置目标。",
      "pattern": "进度和预测是基于你自己数据的规则：仅供参考，并非保证。",
      "formHint": "留空表示不设目标。每次打开此页面都会按 Instagram 的数据检查进度。",
      "progressLabel": "@{username} 的目标",
      "followers": "粉丝",
      "followersHint": "要达到的粉丝数（1 至 {max}）。",
      "followersDue": "截止日期",
      "followersDueHint": "今天之后的某一天，最多 5 年内。",
      "avgReach": "每条帖子平均触达",
      "avgReachHint": "本月发布的动态（1 至 {max}）。",
      "postsPerWeek": "每周发帖数",
      "postsPerWeekHint": "Reels、照片和轮播；快拍不计入（1 至 {max}）。",
      "saved": "目标已保存。",
      "errors": {
        "invalid": "有些值无效：请填写所示范围内的整数，粉丝目标需选择今天之后的日期。",
        "needs_update": "目标需要更新数据库。",
        "unexpected": "无法保存目标，请重试。"
      },
      "status": { "done": "已达成", "ahead": "进度正常", "behind": "落后", "missed": "未达成" },
      "confidence": { "low": "低", "medium": "中" },
      "followersLine": "{date} 前达到 {target} 粉丝，目前 {actual}。从 {baseline} 出发的直线今天应在 {expected}。",
      "followersNoData": "还没有粉丝数。",
      "forecast": "{date} 的预测：约 {value}（{low} 至 {high} 之间），可信度{confidence}，基于最近 {n} 天。{verdict, select, likely {很可能达成。} unlikely {按目前速度不太可能达成。} other {结果难以判断。}}",
      "forecastFew": "暂无预测：需要 14 天的粉丝数（目前 {n} 天）。",
      "avgLine": "本月 {n, plural, other {# 条帖子}}的平均触达为 {actual}（目标 {target}）。",
      "avgFew": "本月需要 3 条有触达数据的帖子才能判断。",
      "avgNone": "本月还没有有触达数据的帖子。",
      "avgYoung": "{young, plural, other {# 条帖子}}发布不足 7 天，触达仍在增长。",
      "postsLine": "本周已发 {actual} 条，目标 {target} 条；按均匀节奏今天应达到 {expected} 条。上周：{last} 条。"
    }
  },
  "metrics": {
    "followers": "粉丝",
```

- [ ] **Step 3 — verify.** `npx vitest run tests/messages.test.ts` → PASS (same keys, same placeholders, no abbreviated range label). `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` → no error.
- [ ] **Step 4 — commit.** `git add messages/en.json messages/zh-CN.json` → `git commit -m "feat(i18n): Plan nav item, digest and goals strings (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 2: migration + its test (NEVER applied)

**Files:** Create `supabase/migrations/20261103000001_goals.sql`, `tests/goals-migration.test.ts`.

- [ ] **Step 1 — failing test.** Write `tests/goals-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261103000001_goals.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('goals migration (Plan 17d)', () => {
  it('one owner-only table and its index; nothing dropped, no function, no grant', () => {
    const heads = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create table', 'create unique', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|grant|function|security\s+definer)\b/i);
  });

  it('metrics, target range and due day (tests/plan-model.test.ts pins lib/analysis/goals.ts to these literals)', () => {
    expect(sql).toMatch(exact("metric text not null check (metric in ('followers', 'avg_reach', 'posts_per_week'))"));
    expect(sql).toMatch(exact('target integer not null check (target between 1 and 1000000000)'));
    expect(sql).toMatch(exact("check (metric <> 'posts_per_week' or target <= 50)"));
    expect(sql).toMatch(exact("check ((metric = 'followers') = (due_day is not null))"));
  });

  it('cascades with the account; one goal per account and metric', () => {
    expect(sql).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(sql).toMatch(exact('create unique index goals_account_metric_key on public.goals (account_id, metric)'));
  });

  it('RLS on, owner-all in InitPlan form, authenticated only, anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.goals enable row level security'));
    expect(sql).toMatch(exact('create policy goals_owner_all on public.goals for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.goals from anon'));
  });
});
```

- [ ] **Step 2 — run, see it fail** (`ENOENT … 20261103000001_goals.sql`): `npx vitest run tests/goals-migration.test.ts`.
- [ ] **Step 3 — the migration.** Write `supabase/migrations/20261103000001_goals.sql` (keep `create table public.goals (` and the closing `);` on their own lines: `tests/data-export.test.ts` parses that shape):

```sql
-- Plan 17d: goals per account (roadmap §4 Q2 (a)). Three kinds, at most one of each per account:
--   followers      = reach `target` followers by `due_day`
--   avg_reach      = average reach per feed post of the current calendar month (owner timezone)
--   posts_per_week = feed posts in the current week (week-start setting)
-- Progress is computed on read (lib/analysis/goals.ts); nothing here is derived. Owner-authored like tags (owner-all
-- RLS under is_owner()); deleted with the account (cascade), so delete_all_data() (16c) needs no change.

create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  metric     text not null check (metric in ('followers', 'avg_reach', 'posts_per_week')),
  target     integer not null check (target between 1 and 1000000000),
  due_day    date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((metric = 'followers') = (due_day is not null)),
  check (metric <> 'posts_per_week' or target <= 50)
);
-- one goal per (account, metric): the save upserts on it; account_id leads, so it also serves the account delete cascade
create unique index goals_account_metric_key on public.goals (account_id, metric);
alter table public.goals enable row level security;
create policy goals_owner_all on public.goals
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.goals from anon;
```

- [ ] **Step 4 — verify.** `npx vitest run tests/goals-migration.test.ts tests/migrations.test.ts tests/data-privacy-migration.test.ts` → PASS. Do NOT run any `supabase` / `db push` command.
- [ ] **Step 5 — commit.** `git add supabase/migrations/20261103000001_goals.sql tests/goals-migration.test.ts` → `git commit -m "feat(db): goals per account, owner-only, cascade with the account (Plan 17d, not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 3: goal progress, pure (TDD)

**Files:** Create `lib/analysis/goals.ts`, `tests/analysis-goals.test.ts`; modify `lib/analysis/trend.ts`.

- [ ] **Step 1 — failing test.** Write `tests/analysis-goals.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { AVG_MIN_POSTS, avgReachProgress, followersProgress, postsPerWeekProgress, type Goal } from '@/lib/analysis/goals';
import { projectFollowers } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const row = (day: string, followers: number | null): DailyRow => ({ day, followers, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
const goal = (metric: Goal['metric'], target: number, extra: Partial<Goal> = {}): Goal => ({ id: 'g1', accountId: 'a1', metric, target, dueDay: null, startDay: '2026-10-01', ...extra });
const post = (id: string, postedAt: string, reach: number | null, mediaType: Post['mediaType'] = 'IMAGE'): Post => ({ id, accountId: 'a1', mediaType, postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });
/** n days of followers from `from`, +perDay each day. */
const series = (from: string, n: number, start: number, perDay: number) => Array.from({ length: n }, (_, i) => row(addDays(from, i), start + i * perDay));

describe('projectFollowers horizons (Plan 17d)', () => {
  it('defaults to 7 / 30 / 90 days and accepts other horizons', () => {
    const pts = Array.from({ length: 28 }, (_, i) => ({ day: addDays('2026-09-01', i), value: 1000 + 10 * i }));
    const def = projectFollowers(pts);
    expect('horizons' in def && def.horizons.map((h) => h.days)).toEqual([7, 30, 90]);
    const one = projectFollowers(pts, [45]);
    expect('horizons' in one && one.horizons).toEqual([{ days: 45, value: 1720, low: 1720, high: 1720 }]);
  });
});

describe('followersProgress', () => {
  const g = goal('followers', 2000, { dueDay: '2026-12-31', startDay: '2026-10-01' }) as Goal & { dueDay: string };

  it('pace = the straight line from the start-day count to the target; ahead when at or above it', () => {
    const daily = series('2026-10-01', 31, 1000, 20); // 1000 on 1 Oct, 1600 on 31 Oct
    const p = followersProgress(g, daily, '2026-10-31');
    expect(p.baseline).toBe(1000);
    expect(p.actual).toBe(1600);
    expect(p.expected).toBe(1330); // 1000 + 1000 x 30 / 91, rounded
    expect(p.status).toBe('ahead');
  });

  it('forecast = the Theil-Sen line at the due day, without today’s part-day count; Medium with 21+ clear days', () => {
    const daily = [...series('2026-10-01', 30, 1000, 10), row('2026-10-31', 5000)]; // today's odd count is ignored
    const p = followersProgress(g, daily, '2026-10-31');
    expect(p.actual).toBe(5000);
    expect(p.status).toBe('done');
    expect(p.forecast).toBeNull(); // nothing to forecast once reached
    const q = followersProgress(g, series('2026-10-01', 30, 1000, 10), '2026-10-31');
    // last complete day 30 Oct (1290), 62 days to 31 Dec at +10 a day = 1910 < 2000; 28 clear days -> Medium
    expect(q.forecast).toEqual({ value: 1910, low: 1910, high: 1910, n: 28, confidence: 'medium', verdict: 'unlikely' });
  });

  it('a due day further than 90 days is always Low; under 14 days of history says so', () => {
    const near = goal('followers', 1500, { dueDay: '2026-11-20', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    const p = followersProgress(near, series('2026-10-01', 30, 1000, 10), '2026-10-31');
    expect(p.forecast).toMatchObject({ value: 1500, confidence: 'medium', verdict: 'likely' }); // 1290 + 10 x 21
    const far = goal('followers', 5000, { dueDay: '2027-06-30', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    expect(followersProgress(far, series('2026-10-01', 30, 1000, 10), '2026-10-31').forecast).toMatchObject({ confidence: 'low' });
    expect(followersProgress(near, series('2026-10-20', 10, 1000, 10), '2026-10-31').forecast).toEqual({ reason: 'not_enough_history', n: 10 });
  });

  it('missed after the due day; no count at all = no status, never 0', () => {
    const past = goal('followers', 2000, { dueDay: '2026-10-15', startDay: '2026-10-01' }) as Goal & { dueDay: string };
    const p = followersProgress(past, series('2026-10-01', 20, 1000, 10), '2026-10-25');
    expect(p.status).toBe('missed');
    expect(p.forecast).toBeNull();
    const none = followersProgress(g, [row('2026-10-02', null)], '2026-10-31');
    expect(none).toMatchObject({ actual: null, baseline: null, expected: null, status: null });
  });

  it('a goal set before the first count starts from the first count after it', () => {
    const p = followersProgress({ ...g, startDay: '2026-09-01' }, series('2026-10-01', 5, 1000, 0), '2026-10-05');
    expect(p.baseline).toBe(1000);
  });
});

describe('avgReachProgress', () => {
  const month = { from: '2026-10-01', to: '2026-10-31' };
  const now = new Date('2026-10-30T12:00:00Z');

  it('average of the month’s feed posts with reach (owner timezone), Stories and unmeasured posts left out', () => {
    const posts = [post('1', '2026-10-02T03:00:00Z', 100), post('2', '2026-10-10T03:00:00Z', 200), post('3', '2026-10-29T03:00:00Z', 600), post('4', '2026-10-12T03:00:00Z', null), post('5', '2026-10-12T03:00:00Z', 9999, 'STORY'), post('6', '2026-09-30T16:30:00Z', 9999)];
    // post 6 is 1 Oct 00:30 in Kuala Lumpur (+8): it counts there, not in UTC
    expect(avgReachProgress(goal('avg_reach', 300), posts, month, now, 'UTC')).toMatchObject({ actual: 300, n: 3, young: 1, status: 'ahead' });
    expect(avgReachProgress(goal('avg_reach', 3000), posts, month, now, 'Asia/Kuala_Lumpur')).toMatchObject({ actual: 2725, n: 4, status: 'behind' });
  });

  it('no status below AVG_MIN_POSTS posts; no posts = null, never 0', () => {
    expect(AVG_MIN_POSTS).toBe(3);
    expect(avgReachProgress(goal('avg_reach', 10), [post('1', '2026-10-02T03:00:00Z', 100)], month, now, 'UTC')).toMatchObject({ actual: 100, n: 1, status: null });
    expect(avgReachProgress(goal('avg_reach', 10), [], month, now, 'UTC')).toMatchObject({ actual: null, n: 0, status: null });
  });
});

describe('postsPerWeekProgress', () => {
  const week = { from: '2026-10-26', to: '2026-11-01' }; // Monday start
  const posts = [post('1', '2026-10-26T09:00:00Z', 1), post('2', '2026-10-27T09:00:00Z', 1), post('s', '2026-10-27T10:00:00Z', 1, 'STORY'), post('3', '2026-10-20T09:00:00Z', 1), post('4', '2026-10-21T09:00:00Z', 1), post('5', '2026-10-22T09:00:00Z', 1)];

  it('counts feed posts of the week; even pace = floor(target x days so far / 7); last week met or not', () => {
    const p = postsPerWeekProgress(goal('posts_per_week', 4), posts, week, '2026-10-29', 'UTC');
    expect(p).toMatchObject({ actual: 2, expected: 2, status: 'ahead', lastWeek: { actual: 3, met: false } }); // day 4 of 7: floor(4 x 4 / 7) = 2
    expect(postsPerWeekProgress(goal('posts_per_week', 4), posts, week, '2026-11-01', 'UTC').status).toBe('behind'); // 2 < 4 on the last day
    expect(postsPerWeekProgress(goal('posts_per_week', 2), posts, week, '2026-10-27', 'UTC').status).toBe('done');
  });

  it('a week across the DST change keeps owner-timezone days', () => {
    const w = { from: '2026-10-19', to: '2026-10-25' };
    // 25 Oct 2026 23:30 in London (BST ended at 01:00 UTC that day) = 23:30 UTC; 26 Oct 00:30 London = 00:30 UTC
    const p = postsPerWeekProgress(goal('posts_per_week', 1), [post('a', '2026-10-25T23:30:00Z', 1), post('b', '2026-10-26T00:30:00Z', 1)], w, '2026-10-25', 'Europe/London');
    expect(p.actual).toBe(1);
  });
});
```

- [ ] **Step 2 — run, see it fail** (cannot resolve `@/lib/analysis/goals`; the horizons test fails on `[45]` being ignored): `npx vitest run tests/analysis-goals.test.ts`.
- [ ] **Step 3 — `lib/analysis/trend.ts`** (optional horizons; the default keeps every existing caller identical). Make these replacements:

Edit 1: replace the exact text

```
export function projectFollowers(points: { day: string; value: number }[]): ProjectionResult {
```

with

```
export function projectFollowers(points: { day: string; value: number }[], horizons: readonly number[] = PROJECTION.horizons): ProjectionResult {
```

Edit 2: replace the exact text

```
  const horizons = PROJECTION.horizons.map((days) => {
```

with

```
  const result = horizons.map((days) => {
```

Edit 3: replace the exact text

```
confidence: w.length >= PROJECTION.mediumPoints && clear ? 'medium' : 'low', horizons };
```

with

```
confidence: w.length >= PROJECTION.mediumPoints && clear ? 'medium' : 'low', horizons: result };
```

- [ ] **Step 4 — `lib/analysis/goals.ts`.** Write:

```ts
// Goal progress (Plan 17d). Pure: today / now / tz come in, never the clock. Three goals per account (roadmap §4 Q2 (a)):
//  - followers: reach a count by a date. Pace = the straight line from the count on the day the goal was set to the
//    target on the due day; forecast = the Growth projection (Theil-Sen, lib/analysis/trend.ts) at the due day.
//  - avg_reach: average reach per feed post published this calendar month (owner timezone). No forecast: the average
//    of the posts so far IS the run rate; posts younger than 7 days are still gaining reach (said, never hidden).
//  - posts_per_week: feed posts this week (week-start setting). Pace = the target spread evenly over the 7 days.
// Honest labels: a forecast is Low or Medium only, "not enough history" under 14 days; a missing number is null with a
// reason, never 0. Today's part-day follower count is left out of the projection (lesson: no partial days in trends).
import type { DailyRow, Post } from '@/lib/analysis/types';
import { PROJECTION, projectFollowers } from '@/lib/analysis/trend';
import { addDays, localDay } from '@/lib/sync/time';
import { daysBetween, type DayRange } from '@/lib/time-scope/range';

export const GOAL_METRICS = ['followers', 'avg_reach', 'posts_per_week'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
/** = the migration's checks (20261103000001_goals.sql). */
export const TARGET_MAX: Record<GoalMetric, number> = { followers: 1_000_000_000, avg_reach: 1_000_000_000, posts_per_week: 50 };
/** A due day at most this far ahead (= MAX_DAYS of the Time Scope, about 5 years). */
export const DUE_MAX_DAYS = 1830;
/** The average reach needs this many posts with reach before it says ahead / behind. */
export const AVG_MIN_POSTS = 3;
/** A post younger than this still gains reach (the Post Lab "too early" window). */
export const YOUNG_DAYS = 7;

export interface Goal {
  id: string;
  accountId: string;
  metric: GoalMetric;
  target: number;
  dueDay: string | null; // followers only
  startDay: string; // owner-timezone day the goal was set (created_at)
}

export type Status = 'done' | 'ahead' | 'behind' | 'missed';
export interface Forecast {
  value: number;
  low: number;
  high: number;
  confidence: 'low' | 'medium';
  n: number;
  verdict: 'likely' | 'unlikely' | 'uncertain';
}
export interface FollowersProgress {
  metric: 'followers';
  target: number;
  dueDay: string;
  actual: number | null;
  baseline: number | null;
  expected: number | null; // where the straight line is today
  status: Status | null;
  forecast: Forecast | { reason: 'not_enough_history'; n: number } | null; // null = due day already passed
}
export interface AvgReachProgress {
  metric: 'avg_reach';
  target: number;
  month: DayRange;
  actual: number | null;
  n: number; // posts of the month with reach
  young: number; // of those, posted within YOUNG_DAYS of now
  status: Status | null; // null below AVG_MIN_POSTS
}
export interface PostsPerWeekProgress {
  metric: 'posts_per_week';
  target: number;
  week: DayRange;
  actual: number;
  expected: number; // posts the even pace asks for by today
  status: Status;
  lastWeek: { actual: number; met: boolean };
}
export type GoalProgress = FollowersProgress | AvgReachProgress | PostsPerWeekProgress;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const feedDay = (p: Post, tz: string) => (p.mediaType === 'STORY' ? null : localDay(new Date(p.postedAt), tz));

export function followersProgress(g: Goal & { dueDay: string }, daily: DailyRow[], today: string): FollowersProgress {
  const known = daily.filter((r) => r.followers !== null).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const actual = known.at(-1)?.followers ?? null;
  // the count on the start day, else the first one after it (a goal set before the first sync)
  const base = known.filter((r) => r.day <= g.startDay).at(-1) ?? known.find((r) => r.day > g.startDay);
  const baseline = base?.followers ?? null;
  const span = daysBetween(g.startDay, g.dueDay);
  const expected = baseline === null ? null : Math.round(baseline + (g.target - baseline) * (span > 0 ? clamp01(daysBetween(g.startDay, today) / span) : 1));
  const status: Status | null = actual === null ? null : actual >= g.target ? 'done' : today > g.dueDay ? 'missed' : expected !== null && actual >= expected ? 'ahead' : 'behind';
  let forecast: FollowersProgress['forecast'] = null;
  if (today <= g.dueDay && status !== 'done') {
    const points = known.filter((r) => r.day < today).map((r) => ({ day: r.day, value: r.followers! }));
    const last = points.at(-1)?.day ?? today;
    const p = projectFollowers(points, [Math.max(1, daysBetween(last, g.dueDay))]);
    if ('reason' in p) forecast = p;
    else {
      const h = p.horizons[0];
      const far = h.days > PROJECTION.horizons[PROJECTION.horizons.length - 1];
      forecast = { value: h.value, low: h.low, high: h.high, n: p.n, confidence: far ? 'low' : p.confidence, verdict: h.low >= g.target ? 'likely' : h.high < g.target ? 'unlikely' : 'uncertain' };
    }
  }
  return { metric: 'followers', target: g.target, dueDay: g.dueDay, actual, baseline, expected, status, forecast };
}

export function avgReachProgress(g: Goal, posts: Post[], month: DayRange, now: Date, tz: string): AvgReachProgress {
  const inMonth = posts.filter((p) => {
    const d = feedDay(p, tz);
    return d !== null && d >= month.from && d <= month.to && p.reach !== null;
  });
  const n = inMonth.length;
  const actual = n ? Math.round(inMonth.reduce((a, p) => a + p.reach!, 0) / n) : null;
  const young = inMonth.filter((p) => now.getTime() - Date.parse(p.postedAt) < YOUNG_DAYS * 86_400_000).length;
  const status: Status | null = actual === null || n < AVG_MIN_POSTS ? null : actual >= g.target ? 'ahead' : 'behind';
  return { metric: 'avg_reach', target: g.target, month, actual, n, young, status };
}

export function postsPerWeekProgress(g: Goal, posts: Post[], week: DayRange, today: string, tz: string): PostsPerWeekProgress {
  const count = (r: DayRange) =>
    posts.filter((p) => {
      const d = feedDay(p, tz);
      return d !== null && d >= r.from && d <= r.to;
    }).length;
  const actual = count(week);
  const elapsed = Math.min(7, Math.max(1, daysBetween(week.from, today) + 1));
  const expected = Math.floor((g.target * elapsed) / 7);
  const last = count({ from: addDays(week.from, -7), to: addDays(week.from, -1) });
  return { metric: 'posts_per_week', target: g.target, week, actual, expected, status: actual >= g.target ? 'done' : actual >= expected ? 'ahead' : 'behind', lastWeek: { actual: last, met: last >= g.target } };
}
```

- [ ] **Step 5 — verify.** `npx vitest run tests/analysis-goals.test.ts tests/analysis-trend.test.ts tests/dashboard-growth.test.ts` → PASS; `npx tsc --noEmit`; `npx eslint lib/analysis/goals.ts lib/analysis/trend.ts tests/analysis-goals.test.ts`.
- [ ] **Step 6 — commit.** `git add lib/analysis/goals.ts lib/analysis/trend.ts tests/analysis-goals.test.ts` → `git commit -m "feat(analysis): goal pace, projection and status (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 4: plan libraries — sections, goals storage, digest and goals models (TDD)

**Files:** Create `lib/plan/sections.ts`, `lib/plan/goals.ts`, `lib/plan/model.ts`, `tests/plan-model.test.ts`.

- [ ] **Step 1 — failing test.** Write `tests/plan-model.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GOAL_METRICS, TARGET_MAX, type Goal } from '@/lib/analysis/goals';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { StoredAccount } from '@/lib/accounts/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { loadGoals, parseGoalInput, saveGoals } from '@/lib/plan/goals';
import { buildDigest, buildGoals, digestHref, lastComplete, parseDigestPeriod, planReadFrom, periodScope } from '@/lib/plan/model';
import { DEFAULT_PLAN_SECTION, PLAN_SECTIONS, isPlanSection, planHref, routePlan } from '@/lib/plan/sections';
import { addDays } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (id: string, username: string, groupName: string | null = null): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-08-01T00:00:00Z' });
const day = (d: string, followers: number, reach: number): DailyRow => ({ day: d, followers, reach, views: reach * 2, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null });
const post = (id: string, postedAt: string, reach: number | null, mediaType: Post['mediaType'] = 'IMAGE'): Post => ({ id, accountId: A, mediaType, postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });

describe('plan sections (the Settings pattern)', () => {
  it('digest then goals; /plan redirects to the digest; unknown or deeper paths are 404', () => {
    expect(PLAN_SECTIONS).toEqual(['digest', 'goals']);
    expect(DEFAULT_PLAN_SECTION).toBe('digest');
    expect(routePlan(undefined)).toEqual({ redirect: '/plan/digest' });
    expect(routePlan([])).toEqual({ redirect: '/plan/digest' });
    expect(routePlan(['goals'])).toEqual({ section: 'goals' });
    for (const s of [['Goals'], ['board'], ['goals', 'x'], ['constructor']]) expect(routePlan(s)).toBeNull();
    for (const v of ['', 'Digest', 'toString', null, 1]) expect(isPlanSection(v)).toBe(false);
  });

  it('section URLs are /plan/<id> (tests/tabs-model.test.ts checks they stay inside a shell tab)', () => {
    for (const id of PLAN_SECTIONS) expect(planHref(id)).toBe(`/plan/${id}`);
  });
});

describe('digest period', () => {
  const today = '2026-10-29'; // a Thursday

  it('default = the last complete week (week-start setting)', () => {
    expect(parseDigestPeriod({}, today, 'mon')).toEqual({ kind: 'week', range: { from: '2026-10-19', to: '2026-10-25' }, prev: '/plan/digest?week=2026-10-12', next: '/plan/digest?week=2026-10-26', running: false });
    expect(parseDigestPeriod({}, today, 'sun').range).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(lastComplete('month', today, 'mon')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('week=<any day> picks its week; the running week has no next and is marked running', () => {
    expect(parseDigestPeriod({ week: '2026-10-28' }, today, 'mon')).toMatchObject({ range: { from: '2026-10-26', to: '2026-11-01' }, next: null, running: true });
  });

  it('month=YYYY-MM wins over week; a month or week starting after today, junk and repeats fall back to the last week', () => {
    expect(parseDigestPeriod({ month: '2026-09', week: '2026-10-28' }, today, 'mon')).toEqual({ kind: 'month', range: { from: '2026-09-01', to: '2026-09-30' }, prev: '/plan/digest?month=2026-08', next: '/plan/digest?month=2026-10', running: false });
    expect(parseDigestPeriod({ month: '2026-10' }, today, 'mon')).toMatchObject({ kind: 'month', next: null, running: true });
    for (const sp of [{ month: '2026-11' }, { week: '2026-11-02' }, { week: '2026-02-30' }, { month: '2026-13' }, { week: ['2026-10-01', '2026-10-08'] }])
      expect(parseDigestPeriod(sp, today, 'mon').range, JSON.stringify(sp)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('month steps across the year and February', () => {
    expect(parseDigestPeriod({ month: '2026-01' }, today, 'mon').prev).toBe('/plan/digest?month=2025-12');
    expect(parseDigestPeriod({ month: '2026-02' }, today, 'mon').range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(digestHref('week', { from: '2026-10-19', to: '2026-10-25' })).toBe('/plan/digest?week=2026-10-19');
  });

  it('the period is a fixed Time Scope compared with the one before', () => {
    expect(periodScope(parseDigestPeriod({}, today, 'mon'))).toEqual({ range: { from: '2026-10-19', to: '2026-10-25' }, cmp: 'prev', gran: 'day' });
  });

  it('reads far enough back for the comparison, this month, last week, 30 days of followers and each followers goal start', () => {
    const p = parseDigestPeriod({}, today, 'mon');
    expect(planReadFrom(periodScope(p), today, 'mon', [])).toBe('2026-09-29'); // 30 days before today
    const g: Goal = { id: 'g', accountId: A, metric: 'followers', target: 9, dueDay: '2027-01-01', startDay: '2026-06-01' };
    expect(planReadFrom(periodScope(p), today, 'mon', [g])).toBe('2026-06-01');
    expect(planReadFrom({ range: { from: '2026-08-01', to: '2026-08-31' }, cmp: 'prev', gran: 'day' }, today, 'mon', [])).toBe('2026-06-27');
  });
});

describe('buildDigest', () => {
  const today = '2026-10-29';
  const now = new Date('2026-10-29T10:00:00Z');
  const daily = Array.from({ length: 40 }, (_, i) => day(addDays('2026-09-19', i), 1000 + i, 100));
  const posts = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => post(`p${n}`, `2026-10-${String(18 + n).padStart(2, '0')}T03:00:00Z`, n * 100)), // 19..25 Oct
    post('null', '2026-10-20T03:00:00Z', null),
    post('story', '2026-10-21T03:00:00Z', 99999, 'STORY'),
    post('old', '2026-10-10T03:00:00Z', 99999),
  ];
  const input: OverviewInput = { accounts: [acct(A, 'one')], sync: {}, daily: { [A]: daily }, posts: { [A]: posts } };
  const period = parseDigestPeriod({}, today, 'mon');

  it('Overview numbers for the week vs the week before', () => {
    const m = buildDigest(input, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' });
    expect(m.overview.scope.range).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(m.overview.scope.compare).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    const card = m.overview.sections[0].cards[0];
    expect(card.kpis.reach).toMatchObject({ value: 700, prior: 700, change: 0 });
    expect(card.kpis.posts.value).toBe(8); // feed posts incl. the unmeasured one; Stories never
  });

  it('top 3 and bottom 3 by reach of the week’s measured feed posts; young = posted under 7 days before today', () => {
    const a = buildDigest(input, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' }).accounts[A];
    expect(a.measured).toBe(7);
    expect(a.top.map((p) => p.id)).toEqual(['p7', 'p6', 'p5']);
    expect(a.bottom.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(a.top.map((p) => p.young)).toEqual([true, true, true]); // 25, 24, 23 Oct: 4 to 6 days before 29 Oct
    expect(a.bottom.map((p) => p.young)).toEqual([false, false, false]); // 19 to 21 Oct: 8 to 10 days
  });

  it('no bottom list with 6 or fewer measured posts (it would repeat the top)', () => {
    const few: OverviewInput = { ...input, posts: { [A]: posts.slice(0, 6) } };
    const a = buildDigest(few, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' }).accounts[A];
    expect(a.top).toHaveLength(3);
    expect(a.bottom).toEqual([]);
  });

  it('goals are computed for today, whatever the period', () => {
    const g: Goal = { id: 'g', accountId: A, metric: 'posts_per_week', target: 3, dueDay: null, startDay: '2026-10-01' };
    const m = buildDigest(input, [g], { period: parseDigestPeriod({ month: '2026-09' }, today, 'mon'), today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' });
    expect(m.accounts[A].goals).toEqual([expect.objectContaining({ metric: 'posts_per_week', week: { from: '2026-10-26', to: '2026-11-01' }, actual: 0, lastWeek: { actual: 8, met: true } })]);
    expect(buildGoals(input, [g], { today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' })).toEqual([expect.objectContaining({ id: A, username: 'one', goals: [g] })]);
  });
});

describe('goal input and storage', () => {
  const today = '2026-10-29';

  it('the TypeScript limits equal the migration checks (20261103000001_goals.sql)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261103000001_goals.sql'), 'utf8');
    expect(sql).toContain(`check (metric in (${GOAL_METRICS.map((m) => `'${m}'`).join(', ')}))`);
    expect(sql).toContain(`check (target between 1 and ${TARGET_MAX.followers})`);
    expect(TARGET_MAX.avg_reach).toBe(TARGET_MAX.followers);
    expect(sql).toContain(`target <= ${TARGET_MAX.posts_per_week})`);
  });

  it('empty = no goal; whole numbers in range; followers needs a due day after today and within 5 years', () => {
    expect(parseGoalInput({ followers: '', avg_reach: '1200', posts_per_week: 3 }, today)).toEqual({ followers: null, avg_reach: { target: 1200, dueDay: null }, posts_per_week: { target: 3, dueDay: null } });
    expect(parseGoalInput({ followers: ' 5000 ', followersDue: '2026-12-31' }, today)).toEqual({ followers: { target: 5000, dueDay: '2026-12-31' }, avg_reach: null, posts_per_week: null });
    for (const bad of [null, 'x', { posts_per_week: '51' }, { avg_reach: '0' }, { avg_reach: '1.5' }, { avg_reach: '-3' }, { avg_reach: '1e3' }, { followers: '10' }, { followers: '10', followersDue: today }, { followers: '10', followersDue: '2031-11-03' }, { followers: '10', followersDue: '2026-02-30' }])
      expect(parseGoalInput(bad, today), JSON.stringify(bad)).toBeNull();
  });

  function fakeDb(answers: { upsert?: unknown; delete?: unknown; select?: { data: unknown; error: unknown } } = {}) {
    const calls: unknown[][] = [];
    const db = {
      from: (t: string) => ({
        upsert: (rows: unknown, o: unknown) => (calls.push(['upsert', t, rows, o]), Promise.resolve({ error: answers.upsert ?? null })),
        delete: () => ({ eq: (k: string, v: string) => ({ in: (k2: string, v2: string[]) => (calls.push(['delete', t, k, v, k2, v2]), Promise.resolve({ error: answers.delete ?? null })) }) }),
        select: (s: string) => ({ order: () => ({ limit: (n: number) => (calls.push(['select', t, s, n]), Promise.resolve(answers.select ?? { data: [], error: null })) }) }),
      }),
    };
    return { db: db as never, calls };
  }

  it('saveGoals upserts set goals on (account, metric) and deletes cleared ones', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T01:00:00Z') });
    const { db, calls } = fakeDb();
    expect(await saveGoals(db, A, { followers: null, avg_reach: { target: 500, dueDay: null }, posts_per_week: null })).toEqual({ ok: true });
    expect(calls).toEqual([
      ['upsert', 'goals', [{ account_id: A, metric: 'avg_reach', target: 500, due_day: null, updated_at: '2026-10-29T01:00:00.000Z' }], { onConflict: 'account_id,metric' }],
      ['delete', 'goals', 'account_id', A, 'metric', ['followers', 'posts_per_week']],
    ]);
    vi.useRealTimers();
  });

  it('error keys: not a uuid / unknown account = invalid, no table = needs_update, anything else = unexpected', async () => {
    const none = { followers: null, avg_reach: null, posts_per_week: { target: 2, dueDay: null } };
    expect(await saveGoals(fakeDb().db, 'nope', none)).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoals(fakeDb({ upsert: { code: '23503' } }).db, A, none)).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoals(fakeDb({ upsert: { code: 'PGRST205' } }).db, A, none)).toEqual({ ok: false, error: 'needs_update' });
    expect(await saveGoals(fakeDb({ delete: { code: '57014', message: 'secret' } }).db, A, none)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('loadGoals maps rows (start day in the owner timezone), null without the migration, throws a fixed message otherwise', async () => {
    const rows = [{ id: 'g1', account_id: A, metric: 'followers', target: 5000, due_day: '2026-12-31', created_at: '2026-10-28T20:00:00Z' }, { id: 'g2', account_id: A, metric: 'bogus', target: 1, due_day: null, created_at: '2026-10-28T20:00:00Z' }];
    expect(await loadGoals(fakeDb({ select: { data: rows, error: null } }).db, 'Asia/Kuala_Lumpur')).toEqual([{ id: 'g1', accountId: A, metric: 'followers', target: 5000, dueDay: '2026-12-31', startDay: '2026-10-29' }]);
    expect(await loadGoals(fakeDb({ select: { data: null, error: { code: '42P01' } } }).db, 'UTC')).toBeNull();
    await expect(loadGoals(fakeDb({ select: { data: null, error: { code: 'XX', message: 'secret 1' } } }).db, 'UTC')).rejects.toThrow('goals read failed');
  });
});
```

- [ ] **Step 2 — run, see it fail** (cannot resolve `@/lib/plan/…`): `npx vitest run tests/plan-model.test.ts`.
- [ ] **Step 3 — `lib/plan/sections.ts`.** Write:

```ts
// Plan sections (Plan 17d; the Settings pattern of lib/settings/sections.ts): ids and order in ONE place, URL
// /plan/<id>. Titles and descriptions are `plan.sections.<id>.title` / `.description`. Plan 17f adds 'board'.
export const PLAN_SECTIONS = ['digest', 'goals'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];
export const DEFAULT_PLAN_SECTION: PlanSection = 'digest';

export const isPlanSection = (v: unknown): v is PlanSection => typeof v === 'string' && (PLAN_SECTIONS as readonly string[]).includes(v);
export const planHref = (id: PlanSection): string => `/plan/${id}`;

/** /plan -> a redirect to the first section; /plan/<known id> -> that section; anything else -> null (404). */
export function routePlan(segments: readonly string[] | undefined): { section: PlanSection } | { redirect: string } | null {
  if (!segments || segments.length === 0) return { redirect: planHref(DEFAULT_PLAN_SECTION) };
  if (segments.length === 1 && isPlanSection(segments[0])) return { section: segments[0] };
  return null;
}
```

- [ ] **Step 4 — `lib/plan/goals.ts`.** Write:

```ts
// Goals storage (Plan 17d): the owner session only (RLS: goals_owner_all under is_owner()), never the admin client.
// One goal per (account, metric) (unique index), so a save is: set metrics upserted, cleared metrics deleted.
// Errors are keys (`invalid`, `needs_update`, `unexpected`), never Supabase text. Nothing here logs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { DUE_MAX_DAYS, GOAL_METRICS, TARGET_MAX, type Goal, type GoalMetric } from '@/lib/analysis/goals';
import { addDays, localDay } from '@/lib/sync/time';
import { isDay } from '@/lib/time-scope/range';

/** PostgREST / Postgres "table does not exist": the 17d migration is not applied yet. */
const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoalInput = Record<GoalMetric, { target: number; dueDay: string | null } | null>;
export type GoalError = 'invalid' | 'needs_update' | 'unexpected';

type Row = Record<string, unknown>;
const isMetric = (v: unknown): v is GoalMetric => typeof v === 'string' && (GOAL_METRICS as readonly string[]).includes(v);

/** Every goal of the live accounts, oldest first; null = the migration 20261103000001 is not applied yet. */
export async function loadGoals(db: SupabaseClient, tz: string): Promise<Goal[] | null> {
  const { data, error } = await db.from('goals').select('id,account_id,metric,target,due_day,created_at').order('created_at', { ascending: true }).limit(500);
  if (error) {
    if (MISSING_TABLE.includes(String((error as { code?: unknown }).code))) return null;
    throw new Error('goals read failed');
  }
  return ((data ?? []) as Row[]).flatMap((r) =>
    isMetric(r.metric) && typeof r.target === 'number' && typeof r.created_at === 'string'
      ? [{ id: String(r.id), accountId: String(r.account_id), metric: r.metric, target: r.target, dueDay: isDay(r.due_day) ? r.due_day : null, startDay: localDay(new Date(r.created_at), tz) }]
      : [],
  );
}

/**
 * The form's raw values -> what to store. Per metric: '' (or missing) = no goal; else a whole number 1..TARGET_MAX;
 * followers also needs a due day after today and at most DUE_MAX_DAYS ahead. null = anything invalid (the form
 * validates the same rules first, so this only refuses hostile or stale input).
 */
export function parseGoalInput(raw: unknown, today: string): GoalInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out = {} as GoalInput;
  for (const m of GOAL_METRICS) {
    const t = r[m];
    if (t === undefined || t === null || t === '') {
      out[m] = null;
      continue;
    }
    const n = typeof t === 'number' ? t : typeof t === 'string' && /^\d{1,10}$/.test(t.trim()) ? Number(t.trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > TARGET_MAX[m]) return null;
    if (m !== 'followers') {
      out[m] = { target: n, dueDay: null };
      continue;
    }
    const due = r.followersDue;
    if (!isDay(due) || due <= today || due > addDays(today, DUE_MAX_DAYS)) return null;
    out[m] = { target: n, dueDay: due };
  }
  return out;
}

/** Applies one account's goals. The start day of a kept goal stays (an edit keeps its pace line); clearing a goal deletes it. */
export async function saveGoals(db: SupabaseClient, accountId: string, input: GoalInput): Promise<{ ok: true } | { ok: false; error: GoalError }> {
  if (!UUID.test(accountId)) return { ok: false, error: 'invalid' };
  const code = (e: unknown) => String((e as { code?: unknown } | null)?.code);
  const failed = (e: unknown): { ok: false; error: GoalError } => ({ ok: false, error: MISSING_TABLE.includes(code(e)) ? 'needs_update' : code(e) === '23503' ? 'invalid' : 'unexpected' });
  const set = GOAL_METRICS.filter((m) => input[m] !== null);
  const cleared = GOAL_METRICS.filter((m) => input[m] === null);
  if (set.length) {
    const rows = set.map((m) => ({ account_id: accountId, metric: m, target: input[m]!.target, due_day: input[m]!.dueDay, updated_at: new Date().toISOString() }));
    const { error } = await db.from('goals').upsert(rows, { onConflict: 'account_id,metric' });
    if (error) return failed(error);
  }
  if (cleared.length) {
    const { error } = await db.from('goals').delete().eq('account_id', accountId).in('metric', cleared);
    if (error) return failed(error);
  }
  return { ok: true };
}
```

- [ ] **Step 5 — `lib/plan/model.ts`.** Write:

```ts
// The Plan page models (Plan 17d). Pure: today / now / tz / weekStart are inputs.
// Digest = the Overview's numbers (buildOverview: KPIs with the comparison and its 80 % coverage rule, groups, healthy-only
// totals) for ONE calendar week or month, compared with the one before, plus per account the top 3 / bottom 3 feed posts
// by reach and the goals' current progress. Weeks follow the week-start setting; days are owner-timezone days.
import { avgReachProgress, followersProgress, postsPerWeekProgress, YOUNG_DAYS, type Goal, type GoalProgress } from '@/lib/analysis/goals';
import type { Post } from '@/lib/analysis/types';
import { buildOverview, type OverviewModel } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay } from '@/lib/sync/time';
import { daysBetween, isDay, minDay, monthOf, weekOf, type DayRange } from '@/lib/time-scope/range';
import { earliestDay, readFrom, resolveScope, type TimeScope } from '@/lib/time-scope/scope';

export type PeriodKind = 'week' | 'month';
export interface DigestPeriod {
  kind: PeriodKind;
  range: DayRange;
  prev: string; // href of the period before
  next: string | null; // href of the period after; null when it would start after today
  running: boolean; // the period has not ended yet (today is inside it)
}
export const TOP_POSTS = 3;

type Params = Record<string, string | string[] | undefined>;
const one = (sp: Params, k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : null);

/** `/plan/digest?week=<first day>` or `?month=YYYY-MM`. */
export const digestHref = (kind: PeriodKind, r: DayRange): string => (kind === 'week' ? `/plan/digest?week=${r.from}` : `/plan/digest?month=${r.from.slice(0, 7)}`);

/** The last COMPLETE week or month before today (the Monday review). */
export function lastComplete(kind: PeriodKind, today: string, weekStart: WeekStart): DayRange {
  return kind === 'week' ? weekOf(addDays(weekOf(today, weekStart).from, -1), weekStart) : monthOf(addDays(`${today.slice(0, 7)}-01`, -1));
}

/** ?month=YYYY-MM wins over ?week=<any day of it>; junk, or a period that starts after today, = the last complete week. */
export function parseDigestPeriod(sp: Params, today: string, weekStart: WeekStart): DigestPeriod {
  const m = one(sp, 'month')?.match(/^(20\d\d)-(0[1-9]|1[0-2])$/);
  const w = one(sp, 'week');
  let kind: PeriodKind = 'week';
  let range = lastComplete('week', today, weekStart);
  if (m && `${m[0]}-01` <= today) [kind, range] = ['month', monthOf(`${m[0]}-01`)];
  else if (!m && isDay(w) && weekOf(w, weekStart).from <= today) range = weekOf(w, weekStart);
  const after = kind === 'week' ? weekOf(addDays(range.to, 1), weekStart) : monthOf(addDays(range.to, 1));
  const before = kind === 'week' ? weekOf(addDays(range.from, -1), weekStart) : monthOf(addDays(range.from, -1));
  return { kind, range, prev: digestHref(kind, before), next: after.from <= today ? digestHref(kind, after) : null, running: range.to >= today };
}

/** The Time Scope of a period: those days, compared with the period before (cut to the same days while it runs). */
export const periodScope = (p: DigestPeriod): TimeScope => ({ range: p.range, cmp: 'prev', gran: 'day' });

export interface DigestPost {
  id: string;
  mediaType: Post['mediaType'];
  postedAt: string;
  reach: number;
  young: boolean; // posted fewer than YOUNG_DAYS days before today: its reach is still growing
}
export interface DigestAccount {
  top: DigestPost[];
  bottom: DigestPost[]; // only when there are more than 2 x TOP_POSTS measured posts (no overlap with top)
  measured: number; // feed posts of the period with reach
  goals: GoalProgress[];
}
export interface DigestModel {
  period: DigestPeriod;
  overview: OverviewModel;
  accounts: Record<string, DigestAccount>;
}

const byReach = (a: DigestPost, b: DigestPost) => b.reach - a.reach || (a.postedAt < b.postedAt ? 1 : -1);

/** The goals of one account, computed for today (never for a past period: a goal's pace is a "now" answer). */
export function goalsNow(goals: Goal[], input: OverviewInput, accountId: string, o: { today: string; now: Date; tz: string; weekStart: WeekStart }): GoalProgress[] {
  const daily = input.daily[accountId] ?? [];
  const posts = input.posts[accountId] ?? [];
  return goals
    .filter((g) => g.accountId === accountId)
    .map((g) =>
      g.metric === 'followers' && g.dueDay !== null
        ? followersProgress({ ...g, dueDay: g.dueDay }, daily, o.today)
        : g.metric === 'avg_reach'
          ? avgReachProgress(g, posts, monthOf(o.today), o.now, o.tz)
          : postsPerWeekProgress(g, posts, weekOf(o.today, o.weekStart), o.today, o.tz),
    );
}

/** The first day the Plan page reads: the period and its comparison (readFrom), this month and last week, 28 days of follower history before today, and each followers goal's start day. */
export function planReadFrom(time: TimeScope, today: string, weekStart: WeekStart, goals: Goal[]): string {
  let from = minDay(readFrom(time, today), minDay(`${today.slice(0, 7)}-01`, addDays(weekOf(today, weekStart).from, -7)));
  from = minDay(from, addDays(today, -30));
  for (const g of goals) if (g.metric === 'followers') from = minDay(from, g.startDay);
  return from;
}

export function buildDigest(input: OverviewInput, goals: Goal[], o: { period: DigestPeriod; today: string; now: Date; tz: string; locale: string; weekStart: WeekStart }): DigestModel {
  const scope = resolveScope(periodScope(o.period), o.today, earliestDay(Object.values(input.daily)));
  const overview = buildOverview(input, { scope, today: o.today, now: o.now, tz: o.tz, locale: o.locale, weekStart: o.weekStart });
  const accounts: Record<string, DigestAccount> = {};
  for (const a of input.accounts) {
    const measured = (input.posts[a.id] ?? [])
      .filter((p) => {
        if (p.mediaType === 'STORY' || p.reach === null) return false;
        const d = localDay(new Date(p.postedAt), o.tz);
        return d >= o.period.range.from && d <= o.period.range.to;
      })
      .map((p): DigestPost => ({ id: p.id, mediaType: p.mediaType, postedAt: p.postedAt, reach: p.reach!, young: daysBetween(localDay(new Date(p.postedAt), o.tz), o.today) < YOUNG_DAYS }))
      .sort(byReach);
    accounts[a.id] = {
      top: measured.slice(0, TOP_POSTS),
      bottom: measured.length > 2 * TOP_POSTS ? measured.slice(-TOP_POSTS).reverse() : [],
      measured: measured.length,
      goals: goalsNow(goals, input, a.id, o),
    };
  }
  return { period: o.period, overview, accounts };
}

export interface GoalsAccount {
  id: string;
  username: string;
  goals: Goal[];
  progress: GoalProgress[];
}

/** The Goals section: every live account (Overview order: by username), its stored goals and their progress now. */
export function buildGoals(input: OverviewInput, goals: Goal[], o: { today: string; now: Date; tz: string; locale: string; weekStart: WeekStart }): GoalsAccount[] {
  return [...input.accounts]
    .sort((x, y) => x.username.localeCompare(y.username, o.locale))
    .map((a) => ({ id: a.id, username: a.username, goals: goals.filter((g) => g.accountId === a.id), progress: goalsNow(goals, input, a.id, o) }));
}
```

- [ ] **Step 6 — verify.** `npx vitest run tests/plan-model.test.ts` → PASS; `npx tsc --noEmit`; `npx eslint lib/plan tests/plan-model.test.ts`.
- [ ] **Step 7 — commit.** `git add lib/plan/sections.ts lib/plan/goals.ts lib/plan/model.ts tests/plan-model.test.ts` → `git commit -m "feat(plan): digest period, digest and goals models, goals storage (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 5: the side-nav item and the export registry

**Files:** Modify `lib/nav.ts`, `components/shared/AppShell.tsx`, `public/sw.js`, `tests/nav.test.ts`, `tests/tabs-model.test.ts`, `tests/app-shell.test.tsx`, `lib/data/export.ts`, `tests/settings-data.test.tsx`.

- [ ] **Step 1 — tests first.** `tests/nav.test.ts`:

Edit 1: replace the exact text

```
  it('lists the six main destinations in order', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/explorer', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'explorer', 'settings']);
```

with

```
  it('lists the seven main destinations in order (Plan 17d added Plan before Settings)', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/explorer', '/plan', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'explorer', 'plan', 'settings']);
```

Edit 2: replace the exact text

```
    for (const href of ['/accounts', '/tags', '/settings']) expect(navHref(href, search)).toBe(href);
```

with

```
    for (const href of ['/accounts', '/tags', '/plan', '/settings']) expect(navHref(href, search)).toBe(href);
```

`tests/tabs-model.test.ts`:

Edit 1: replace the exact text

```
  it('isTabPath: the six main pages and everything below them, nothing else', () => {
    for (const p of ['/overview', '/accounts', '/accounts/7b0c', '/accounts/7b0c/media/123', '/tags', '/calendar', '/explorer', '/settings']) expect(isTabPath(p), p).toBe(true);
    for (const p of ['/', '/login', '/login/verify', '/setup', '/auth/signout', '/report', '/report/print', '/styleguide', '/api/export/xlsx', '/offline', '/accounts-x']) expect(isTabPath(p), p).toBe(false);
```

with

```
  it('isTabPath: the seven main pages and everything below them, nothing else', () => {
    for (const p of ['/overview', '/accounts', '/accounts/7b0c', '/accounts/7b0c/media/123', '/tags', '/calendar', '/explorer', '/plan', '/plan/goals', '/settings']) expect(isTabPath(p), p).toBe(true);
    for (const p of ['/', '/login', '/login/verify', '/setup', '/auth/signout', '/report', '/report/print', '/styleguide', '/api/export/xlsx', '/offline', '/accounts-x', '/planner']) expect(isTabPath(p), p).toBe(false);
```

`tests/app-shell.test.tsx`:

Edit 1: replace the exact text

```
    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('grid-cols-6'); // one column per item
```

with

```
    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('grid-cols-7'); // one column per item (Plan 17d: seven)
```

`tests/settings-data.test.tsx`: **add one** to each of the three counts in the test "Download all fetches one table at a time …". At `81054d7` they are:

Edit 1: replace the exact text

```
    expect(urls).toHaveLength(18);
```

with

```
    expect(urls).toHaveLength(19);
```

Edit 2: replace the exact text

```
    expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();
```

with

```
    expect(await screen.findByText('19 files downloaded.')).toBeInTheDocument();
```

Edit 3: replace the exact text

```
    expect(server.download.mock.calls).toHaveLength(20);
```

with

```
    expect(server.download.mock.calls).toHaveLength(21);
```

(Plan 17b adds one and 17c two: after both the numbers are 21 / `'21 files downloaded.'` / 23; make them 22 / `'22 files downloaded.'` / 24. Always add exactly one to what is there.)

- [ ] **Step 2 — run, see them fail:** `npx vitest run tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx tests/service-worker.test.ts tests/settings-data.test.tsx`.
- [ ] **Step 3 — `lib/nav.ts`:**

Edit 1: replace the exact text

```
import { CalendarDays, ChartNoAxesCombined, CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';
```

with

```
import { CalendarDays, ChartNoAxesCombined, CircleUserRound, ClipboardList, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';
```

Edit 2: replace the exact text

```
  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/explorer' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'explorer' | 'settings';
```

with

```
  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/explorer' | '/plan' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'explorer' | 'plan' | 'settings';
```

Edit 3: replace the exact text

```
  { href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined },
```

with

```
  { href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined },
  { href: '/plan', key: 'plan', icon: ClipboardList }, // Plan 17d: Digest and Goals (Plan 17f adds the board)
```

- [ ] **Step 4 — `components/shared/AppShell.tsx`** (seven columns on the phone bar):

Edit 1: replace the exact text

```
className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t
```

with

```
className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-7 border-t
```

- [ ] **Step 5 — `public/sw.js`** (the worker knows the same tab pages; its test checks the order):

Edit 1: replace the exact text

```
const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|settings)(\/|$)/;
```

with

```
const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|plan|settings)(\/|$)/;
```

- [ ] **Step 6 — `lib/data/export.ts`:**

Edit 1: replace the exact text

```
  { name: 'explorer_views', keys: ['id'] },
```

with

```
  { name: 'explorer_views', keys: ['id'] },
  { name: 'goals', keys: ['id'] },
```

- [ ] **Step 7 — verify.** `npx vitest run tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx tests/service-worker.test.ts tests/settings-data.test.tsx tests/data-export.test.ts tests/route-policy.test.ts tests/frame-breakout.test.tsx tests/messages.test.ts` → PASS (`data-export.test.ts` finds `goals`' primary key in Task 2's migration); `npx tsc --noEmit`; `npx eslint lib/nav.ts components/shared/AppShell.tsx lib/data/export.ts tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx tests/settings-data.test.tsx`.
- [ ] **Step 8 — commit.** `git add lib/nav.ts components/shared/AppShell.tsx public/sw.js tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx lib/data/export.ts tests/settings-data.test.tsx` → `git commit -m "feat(nav): Plan side-nav item; goals in the data export (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 6: the Plan page — section tabs, Digest, Goals, the save action

**Files:** Create `components/plan/PlanNav.tsx`, `components/plan/GoalLine.tsx`, `components/plan/DigestView.tsx`, `components/plan/GoalsView.tsx`, `app/(app)/plan/layout.tsx`, `app/(app)/plan/actions.ts`, `app/(app)/plan/[[...section]]/page.tsx`, `app/(app)/plan/[[...section]]/loading.tsx`, `tests/plan-views.test.tsx`, `tests/plan-actions.test.ts`.

UI notes (all in the code below): tokens only; `min-w-0` / `break-words` on text; KPI grid 2 / 3 / 6 columns at 360 / 768 / 1280; the header row (Segmented + Previous + Next) is one control height and wraps at 360 px; the goals form is 1 column on phones, 2 from `md`; `SaveBar` is the form's last child; the date input is disabled while the followers target is empty.

- [ ] **Step 1 — failing tests.** Write `tests/plan-actions.test.ts`:

```ts
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const requireOwner = vi.fn();
const createServerSupabase = vi.fn();
const saveGoals = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => createServerSupabase() }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ timezone: 'UTC' }) }));
vi.mock('@/lib/plan/goals', async (orig) => ({ ...(await orig<typeof import('@/lib/plan/goals')>()), saveGoals: (...a: unknown[]) => saveGoals(...a) }));

import { saveGoalsAction } from '@/app/(app)/plan/actions';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T10:00:00Z') });
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('owner'));
  createServerSupabase.mockReset().mockImplementation(async () => (calls.push('client'), {}));
  saveGoals.mockReset().mockImplementation(async () => (calls.push('save'), { ok: true }));
  revalidatePath.mockReset();
});

describe('saveGoalsAction', () => {
  it('owner first, then the owner-session client, then the save; revalidates /plan', async () => {
    expect(await saveGoalsAction(A, { posts_per_week: '3' })).toEqual({ ok: true });
    expect(calls).toEqual(['owner', 'client', 'save']);
    expect(saveGoals.mock.calls[0][1]).toBe(A);
    expect(saveGoals.mock.calls[0][2]).toEqual({ followers: null, avg_reach: null, posts_per_week: { target: 3, dueDay: null } });
    expect(revalidatePath).toHaveBeenCalledWith('/plan', 'layout');
  });

  it('stops when requireOwner throws (a redirect)', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(saveGoalsAction(A, {})).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('invalid input or a non-string id never reaches the database', async () => {
    expect(await saveGoalsAction(A, { followers: '10', followersDue: '2026-10-29' })).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoalsAction(42, {})).toEqual({ ok: false, error: 'invalid' });
    expect(calls).toEqual(['owner', 'owner']);
  });

  it('passes the store’s error key through; a throw is "unexpected"; no revalidate on failure', async () => {
    saveGoals.mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    expect(await saveGoalsAction(A, {})).toEqual({ ok: false, error: 'needs_update' });
    saveGoals.mockRejectedValueOnce(new Error('secret'));
    expect(await saveGoalsAction(A, {})).toEqual({ ok: false, error: 'unexpected' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
```

and `tests/plan-views.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const push = vi.fn();
const refresh = vi.fn();
let pathname = '/plan/digest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => pathname }));

import { DigestView } from '@/components/plan/DigestView';
import { GoalsView, type SaveGoals } from '@/components/plan/GoalsView';
import { PlanNav } from '@/components/plan/PlanNav';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { StoredAccount } from '@/lib/accounts/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildDigest, buildGoals, parseDigestPeriod } from '@/lib/plan/model';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const today = '2026-10-29';
const now = new Date('2026-10-29T10:00:00Z');
const o = { today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' as const };
const acct: StoredAccount = { id: A, igUserId: '1', username: 'one', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-08-01T00:00:00Z' };
const day = (d: string): DailyRow => ({ day: d, followers: 1000, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null });
const post = (id: string, postedAt: string, reach: number): Post => ({ id, accountId: A, mediaType: 'REELS', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });
const input: OverviewInput = { accounts: [acct], sync: {}, daily: { [A]: Array.from({ length: 40 }, (_, i) => day(addDays('2026-09-19', i))) }, posts: { [A]: [post('p1', '2026-10-20T03:00:00Z', 500), post('p2', '2026-10-22T03:00:00Z', 900)] } };

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'UTC' }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
const G = en.plan.goals;
const D = en.plan.digest;

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  pathname = '/plan/digest';
});

describe('PlanNav', () => {
  it('underline tabs Digest and Goals; the current path is selected; choosing one navigates to /plan/<id>', async () => {
    wrap(<PlanNav />);
    const list = screen.getByRole('tablist', { name: en.plan.sections.label });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Digest', 'Goals']);
    expect(screen.getByRole('tab', { name: 'Digest' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Goals' }));
    expect(push).toHaveBeenCalledWith('/plan/goals');
  });
});

describe('DigestView', () => {
  const model = buildDigest(input, [], { ...o, period: parseDigestPeriod({}, today, 'mon') });

  it('states the period, its source, the KPIs with a comparison, and the best posts linking to the Post Lab', () => {
    wrap(<DigestView model={model} today={today} goalsReady />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/to/);
    expect(screen.getByText(D.source)).toBeInTheDocument();
    expect(screen.getAllByText('Reach').length).toBeGreaterThan(0);
    const best = screen.getByRole('heading', { name: D.topTitle }).parentElement!;
    expect(within(best).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([`/accounts/${A}/media/p2`, `/accounts/${A}/media/p1`]);
    expect(screen.getByText(D.bottomFew.replace('{n}', '7'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: D.setGoals })).toHaveAttribute('href', '/plan/goals');
  });

  it('Previous / Next are links; Next is disabled on the newest period; Month navigates to the last complete month', async () => {
    wrap(<DigestView model={buildDigest(input, [], { ...o, period: parseDigestPeriod({ week: today }, today, 'mon') })} today={today} goalsReady={false} />);
    expect(screen.getByRole('link', { name: D.previous })).toHaveAttribute('href', '/plan/digest?week=2026-10-19');
    expect(screen.getByRole('button', { name: D.next })).toBeDisabled();
    expect(screen.getByText(D.running)).toBeInTheDocument();
    expect(screen.queryByText(D.goalsTitle)).toBeNull(); // no goals block before the migration
    await userEvent.click(screen.getByRole('button', { name: D.month }));
    expect(push).toHaveBeenCalledWith('/plan/digest?month=2026-09');
  });
});

describe('GoalsView', () => {
  const save = vi.fn<SaveGoals>();
  beforeEach(() => save.mockReset().mockResolvedValue({ ok: true }));

  it('without the migration: one "needs a database update" message and no form', () => {
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready={false} today={today} save={save} />);
    expect(screen.getByText(G.needsUpdate)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('explicit save: Save is off while clean; a typed goal saves the raw values and refreshes the page', async () => {
    const user = userEvent.setup();
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready today={today} save={save} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText(G.postsPerWeek), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(A, { followers: '', followersDue: '', avg_reach: '', posts_per_week: '3' });
    expect(await screen.findByRole('status')).toHaveTextContent(G.saved);
    expect(refresh).toHaveBeenCalled();
  });

  it('an invalid value is named before anything is sent; a server error key is shown as text', async () => {
    const user = userEvent.setup();
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready today={today} save={save} />);
    await user.type(screen.getByLabelText(G.followers), '5000'); // no due day
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(G.errors.invalid);
    await user.clear(screen.getByLabelText(G.followers));
    await user.type(screen.getByLabelText(G.avgReach), '800');
    save.mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(G.errors.needs_update);
  });

  it('stored goals fill the form and their progress shows with a status word', () => {
    const goals = [{ id: 'g', accountId: A, metric: 'posts_per_week' as const, target: 2, dueDay: null, startDay: '2026-10-01' }];
    wrap(<GoalsView accounts={buildGoals(input, goals, o)} ready today={today} save={save} />);
    expect(screen.getByLabelText(G.postsPerWeek)).toHaveValue(2);
    expect(within(screen.getByRole('list', { name: 'Goals of @one' })).getByText(G.status.behind)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 — run, see them fail** (unresolved imports): `npx vitest run tests/plan-actions.test.ts tests/plan-views.test.tsx`.
- [ ] **Step 3 — `app/(app)/plan/actions.ts`:**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { parseGoalInput, saveGoals, type GoalError } from '@/lib/plan/goals';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

/** Saves one account's goals (Plan 17d). Owner session only (RLS goals_owner_all); errors are keys, never Supabase text. */
export async function saveGoalsAction(accountId: unknown, raw: unknown): Promise<{ ok: true } | { ok: false; error: GoalError }> {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const prefs = await getPrefs();
  const input = parseGoalInput(raw, localDay(new Date(), prefs.timezone));
  if (!input || typeof accountId !== 'string') return { ok: false, error: 'invalid' };
  try {
    const r = await saveGoals(await createServerSupabase(), accountId, input);
    if (r.ok) revalidatePath('/plan', 'layout'); // the digest and the goals section
    return r;
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
```

- [ ] **Step 4 — `components/plan/PlanNav.tsx`:**

```tsx
'use client';

// The Plan sections (Plan 17d) as underline tabs (UI standard 7). Each section has its own URL (/plan/<id>, the Settings
// pattern); choosing one navigates, after the unsaved-changes question when a goals form is dirty. activationMode
// "manual": arrowing between tabs does not navigate per key press.
import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { confirmLeave } from '@/components/settings/unsaved';
import { startProgress } from '@/components/shared/NavigationProgress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isActive } from '@/lib/nav';
import { DEFAULT_PLAN_SECTION, PLAN_SECTIONS, isPlanSection, planHref } from '@/lib/plan/sections';

export function PlanNav() {
  const t = useTranslations('plan.sections');
  const tu = useTranslations('settings.unsaved');
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const active = PLAN_SECTIONS.find((id) => isActive(pathname, planHref(id))) ?? DEFAULT_PLAN_SECTION;
  const choose = (v: string) => {
    if (!isPlanSection(v) || v === active || !confirmLeave(tu('confirm'))) return;
    startProgress(planHref(v)); // router.push is not a link click: tell the top bar
    start(() => router.push(planHref(v)));
  };
  return (
    <Tabs value={active} activationMode="manual" onValueChange={choose} className="mb-[var(--gp)] min-w-0">
      <TabsList variant="line" aria-label={t('label')}>
        {PLAN_SECTIONS.map((id) => (
          <TabsTrigger key={id} value={id} className="flex-none">
            {t(`${id}.title`)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

- [ ] **Step 5 — `components/plan/GoalLine.tsx`:**

```tsx
'use client';

// One goal's progress as words (Plan 17d): a status badge and the numbers behind it, used by the Digest and the Goals
// section. Pace and projection are rules on the owner's numbers: Low / Medium confidence only, never "High".
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Badge } from '@/components/ui/badge';
import type { GoalProgress } from '@/lib/analysis/goals';
import { formatDay, formatNumber } from '@/lib/format';

const TONE = { done: 'default', ahead: 'secondary', behind: 'outline', missed: 'destructive' } as const;

export function GoalLine({ p }: { p: GoalProgress }) {
  const t = useTranslations('plan.goals');
  const { prefs } = usePrefs();
  const n = (v: number | null) => (v === null ? '—' : formatNumber(v, prefs));
  const title = t(p.metric === 'followers' ? 'followers' : p.metric === 'avg_reach' ? 'avgReach' : 'postsPerWeek');
  const lines: string[] = [];
  if (p.metric === 'followers') {
    lines.push(p.actual === null ? t('followersNoData') : t('followersLine', { actual: n(p.actual), target: n(p.target), date: formatDay(p.dueDay, prefs), baseline: n(p.baseline), expected: n(p.expected) }));
    if (p.forecast && 'reason' in p.forecast) lines.push(t('forecastFew', { n: p.forecast.n }));
    else if (p.forecast) lines.push(t('forecast', { date: formatDay(p.dueDay, prefs), value: n(p.forecast.value), low: n(p.forecast.low), high: n(p.forecast.high), confidence: t(`confidence.${p.forecast.confidence}`), n: p.forecast.n, verdict: p.forecast.verdict }));
  } else if (p.metric === 'avg_reach') {
    lines.push(p.actual === null ? t('avgNone') : t('avgLine', { actual: n(p.actual), n: p.n, target: n(p.target) }));
    if (p.actual !== null && p.status === null) lines.push(t('avgFew'));
    if (p.young > 0) lines.push(t('avgYoung', { young: p.young }));
  } else {
    lines.push(t('postsLine', { actual: n(p.actual), target: n(p.target), expected: n(p.expected), last: n(p.lastWeek.actual) }));
  }
  return (
    <li className="grid min-w-0 gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {p.status ? <Badge variant={TONE[p.status]}>{t(`status.${p.status}`)}</Badge> : null}
      </div>
      {lines.map((l) => (
        <p key={l} className="text-xs break-words text-muted-foreground">
          {l}
        </p>
      ))}
    </li>
  );
}
```

- [ ] **Step 6 — `components/plan/DigestView.tsx`:**

```tsx
'use client';

// The weekly / monthly digest (Plan 17d): one calendar week or month per account and for all accounts, compared with the
// one before (the Overview's numbers and comparison rules), the best and weakest feed posts by reach, and each account's
// goals now. Week / Month and Previous / Next are links (the URL is the state); no range bar (the period IS the range).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, CircleUserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GoalLine } from '@/components/plan/GoalLine';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { startProgress } from '@/components/shared/NavigationProgress';
import { Segmented } from '@/components/shared/Segmented';
import { StatCard } from '@/components/shared/StatCard';
import { useScopeText } from '@/components/shared/RangeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { formatDay, formatMonth, formatNumber } from '@/lib/format';
import { formatMetric } from '@/lib/metrics';
import { digestHref, lastComplete, TOP_POSTS, type DigestModel, type DigestPost, type PeriodKind } from '@/lib/plan/model';
import { planHref } from '@/lib/plan/sections';
import { localDay } from '@/lib/sync/time';

const KPIS: KpiId[] = ['followers', 'netFollows', 'reach', 'views', 'engagementRate', 'posts'];

function Kpis({ kpis, vs }: { kpis: Record<KpiId, Kpi>; vs: string }) {
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  return (
    <div className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3 xl:grid-cols-6">
      {KPIS.map((id) => (
        <StatCard key={id} label={tm(id)} value={formatMetric(id, kpis[id].value, prefs, { full: id === 'followers' })} delta={delta(id, kpis[id])} comparison={vs} note={kpis[id].reason ? tR(kpis[id].reason) : undefined} />
      ))}
    </div>
  );
}

function Posts({ title, posts, accountId }: { title: string; posts: DigestPost[]; accountId: string }) {
  const t = useTranslations('plan.digest');
  const tf = useTranslations('analysis.format');
  const { prefs } = usePrefs();
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ol className="grid gap-1 text-sm">
        {posts.map((p) => {
          const date = formatDay(localDay(new Date(p.postedAt), prefs.timezone), prefs);
          return (
            <li key={p.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <Link href={`/accounts/${accountId}/media/${encodeURIComponent(p.id)}`} aria-label={t('openPostLab', { format: tf(p.mediaType), date })} className="min-w-0 truncate underline-offset-4 hover:underline">
                {tf(p.mediaType)} · {date}
              </Link>
              <span className="tabular-nums text-muted-foreground">{t('reach', { value: formatNumber(p.reach, prefs) })}</span>
              {p.young ? <span className="text-xs text-muted-foreground">({t('young')})</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DigestView({ model, today, goalsReady }: { model: DigestModel; today: string; goalsReady: boolean }) {
  const t = useTranslations('plan.digest');
  const { prefs } = usePrefs();
  const router = useRouter();
  const { vs } = useScopeText(model.overview.scope);
  const { period, overview } = model;
  const label = period.kind === 'month' ? formatMonth(period.range.from.slice(0, 7), prefs) : t('range', { from: formatDay(period.range.from, prefs), to: formatDay(period.range.to, prefs) });
  const pick = (kind: PeriodKind) => {
    const href = digestHref(kind, lastComplete(kind, today, prefs.weekStart));
    startProgress(href);
    router.push(href);
  };

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmented label={t('period')} value={period.kind} options={[{ value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} onChange={pick} />
        <Button asChild variant="outline">
          <Link href={period.prev}>
            <ChevronLeft aria-hidden="true" />
            {t('previous')}
          </Link>
        </Button>
        {period.next ? (
          <Button asChild variant="outline">
            <Link href={period.next}>
              {t('next')}
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t('next')}
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="min-w-0">
        <h2 className="text-[length:var(--fh)] font-semibold">{label}</h2>
        <p className="text-xs text-muted-foreground">{t('source')}</p>
        {period.running ? <p className="text-xs text-muted-foreground">{t('running')}</p> : null}
      </div>

      {overview.sections.length === 0 ? (
        <EmptyState icon={<CircleUserRound className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          {overview.totals && overview.sections.flatMap((s) => s.cards).length > 1 ? (
            <section aria-labelledby="digest-all" className="grid gap-2">
              <h3 id="digest-all" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('allAccounts')}
              </h3>
              <Kpis kpis={overview.totals} vs={vs} />
            </section>
          ) : null}
          {overview.sections.map((s) => (
            <section key={s.group ?? '\u0000isolated'} className="grid gap-[var(--gp)]">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.group ?? t('isolated')}</h3>
              {s.cards.map((c) => {
                const a = model.accounts[c.id];
                return (
                  <Card key={c.id} className="min-w-0">
                    <CardHeader>
                      <CardTitle>
                        <Link href={`/accounts/${c.id}${overview.scope.query ? `?${overview.scope.query}` : ''}`} className="underline-offset-4 hover:underline">
                          @{c.username}
                        </Link>
                      </CardTitle>
                      <CardDescription>{t('postsSource', { n: a?.measured ?? 0 })}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid min-w-0 gap-[var(--gp)]">
                      <Kpis kpis={c.kpis} vs={vs} />
                      {a && a.top.length ? (
                        <div className="grid gap-[var(--gp)] md:grid-cols-2">
                          <Posts title={t('topTitle')} posts={a.top} accountId={c.id} />
                          {a.bottom.length ? <Posts title={t('bottomTitle')} posts={a.bottom} accountId={c.id} /> : <p className="text-xs text-muted-foreground">{t('bottomFew', { n: 2 * TOP_POSTS + 1 })}</p>}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('noPosts')}</p>
                      )}
                      {goalsReady ? (
                        <div className="grid gap-1">
                          <h4 className="text-sm font-medium">{t('goalsTitle')}</h4>
                          {a && a.goals.length ? (
                            <ul className="grid gap-2">
                              {a.goals.map((p) => (
                                <GoalLine key={p.metric} p={p} />
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t('noGoals')}{' '}
                              <Link href={planHref('goals')} className="font-medium text-primary underline-offset-4 hover:underline">
                                {t('setGoals')}
                              </Link>
                            </p>
                          )}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7 — `components/plan/GoalsView.tsx`:**

```tsx
'use client';

// The Goals section (Plan 17d): one explicit-save form per account (UI standard 18: dirty tracking against the stored
// goals, SaveBar, unsaved-changes guard). An empty field = no goal. The browser checks the same rules as the server
// (parseGoalInput) so a wrong value is named before saving; the server checks again.
import { useState, useTransition } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';
import { CircleUserRound, DatabaseZap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GoalLine } from '@/components/plan/GoalLine';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { SaveBar } from '@/components/settings/SaveBar';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TARGET_MAX, type Goal } from '@/lib/analysis/goals';
import { formatNumber } from '@/lib/format';
import { parseGoalInput, type GoalError } from '@/lib/plan/goals';
import type { GoalsAccount } from '@/lib/plan/model';

type Values = { followers: string; followersDue: string; avg_reach: string; posts_per_week: string };
export type SaveGoals = (accountId: string, raw: Values) => Promise<{ ok: true } | { ok: false; error: GoalError }>;

const valuesOf = (goals: Goal[]): Values => {
  const of = (m: Goal['metric']) => goals.find((g) => g.metric === m);
  return { followers: of('followers') ? String(of('followers')!.target) : '', followersDue: of('followers')?.dueDay ?? '', avg_reach: of('avg_reach') ? String(of('avg_reach')!.target) : '', posts_per_week: of('posts_per_week') ? String(of('posts_per_week')!.target) : '' };
};

function AccountGoals({ a, today, save }: { a: GoalsAccount; today: string; save: SaveGoals }) {
  const t = useTranslations('plan.goals');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [stored, setStored] = useState(() => valuesOf(a.goals));
  const [v, setV] = useState(stored);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [error, setError] = useState<GoalError>('unexpected');
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(stored);
  const valid = parseGoalInput(v, today) !== null;
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const max = (m: Goal['metric']) => formatNumber(TARGET_MAX[m], prefs);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError('invalid');
      return setResult('error');
    }
    start(async () => {
      try {
        const r = await save(a.id, v);
        if (!r.ok) {
          setError(r.error);
          return setResult('error');
        }
        setStored(v);
        setResult('saved');
        router.refresh(); // the progress lines are computed on the server
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError('unexpected');
        setResult('error');
      }
    });
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>@{a.username}</CardTitle>
        <CardDescription>{t('formHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-[var(--gp)]">
        {a.progress.length ? (
          <ul className="grid gap-2" aria-label={t('progressLabel', { username: a.username })}>
            {a.progress.map((p) => (
              <GoalLine key={p.metric} p={p} />
            ))}
          </ul>
        ) : null}
        <form onSubmit={submit} noValidate className="flex flex-col gap-[var(--gp)]">
          <div className="grid gap-[var(--gp)] md:grid-cols-2">
            <FormField id={`${a.id}-followers`} label={t('followers')} hint={t('followersHint', { max: max('followers') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.followers} step={1} value={v.followers} onChange={set('followers')} />}
            </FormField>
            <FormField id={`${a.id}-due`} label={t('followersDue')} hint={t('followersDueHint')}>
              {(p) => <Input {...p} type="date" min={today} value={v.followersDue} onChange={set('followersDue')} disabled={v.followers === ''} />}
            </FormField>
            <FormField id={`${a.id}-avg`} label={t('avgReach')} hint={t('avgReachHint', { max: max('avg_reach') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.avg_reach} step={1} value={v.avg_reach} onChange={set('avg_reach')} />}
            </FormField>
            <FormField id={`${a.id}-ppw`} label={t('postsPerWeek')} hint={t('postsPerWeekHint', { max: max('posts_per_week') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.posts_per_week} step={1} value={v.posts_per_week} onChange={set('posts_per_week')} />}
            </FormField>
          </div>
          <SaveBar dirty={dirty} pending={pending} result={result} error={t(`errors.${error}`)} saved={t('saved')} onDiscard={() => (setV(stored), setResult(null))} />
        </form>
      </CardContent>
    </Card>
  );
}

export function GoalsView({ accounts, ready, today, save }: { accounts: GoalsAccount[]; ready: boolean; today: string; save: SaveGoals }) {
  const t = useTranslations('plan.goals');
  if (!ready) return <EmptyState icon={<DatabaseZap className="size-5" aria-hidden />} title={t('needsUpdate')} description={t('needsUpdateHint')} />;
  if (accounts.length === 0) return <EmptyState icon={<CircleUserRound className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />;
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="text-xs text-muted-foreground">{t('pattern')}</p>
      {accounts.map((a) => (
        <AccountGoals key={a.id} a={a} today={today} save={save} />
      ))}
    </div>
  );
}
```

- [ ] **Step 8 — the route.** `app/(app)/plan/layout.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { PlanNav } from '@/components/plan/PlanNav';
import { PageHeader } from '@/components/shared/PageHeader';

// The Plan shell (Plan 17d): header + section tabs stay while a section streams in ([[...section]]/loading.tsx).
// The (app) layout already checked the owner; the section page checks again (layouts don't re-run on navigation).
export default async function PlanLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('plan');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PlanNav />
      <div className="min-w-0">{children}</div>
    </>
  );
}
```

`app/(app)/plan/[[...section]]/page.tsx`:

```tsx
import { notFound, redirect } from 'next/navigation';
import { DigestView } from '@/components/plan/DigestView';
import { GoalsView } from '@/components/plan/GoalsView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { loadGoals } from '@/lib/plan/goals';
import { buildDigest, buildGoals, parseDigestPeriod, periodScope, planReadFrom } from '@/lib/plan/model';
import { routePlan } from '@/lib/plan/sections';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { saveGoalsAction } from '@/app/(app)/plan/actions';

// Plan 17d: /plan -> /plan/digest; /plan/digest?week=|month= and /plan/goals. Pages = wiring; logic in lib/plan.
export default async function PlanSectionPage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const route = routePlan(section);
  if (!route) notFound();
  if ('redirect' in route) redirect(route.redirect);
  const prefs = await getPrefs();
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const goals = await loadGoals(db, prefs.timezone); // null = the 17d migration is not applied yet
  const period = parseDigestPeriod(sp, today, prefs.weekStart);
  const input = await loadOverviewInput(db, planReadFrom(periodScope(period), today, prefs.weekStart, goals ?? []), prefs.timezone);
  const o = { today, now, tz: prefs.timezone, locale: prefs.locale, weekStart: prefs.weekStart };
  if (route.section === 'goals') return <GoalsView accounts={buildGoals(input, goals ?? [], o)} ready={goals !== null} today={today} save={saveGoalsAction} />;
  return <DigestView model={buildDigest(input, goals ?? [], { ...o, period })} today={today} goalsReady={goals !== null} />;
}
```

`app/(app)/plan/[[...section]]/loading.tsx`:

```tsx
import { RouteLoading, SkeletonGrid } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

// Only the section streams: the Plan layout (header + section tabs) stays on screen.
export default function PlanSectionLoading() {
  return (
    <RouteLoading>
      <Skeleton className="mb-[var(--gp)] h-10 w-full max-w-sm" />
      <SkeletonGrid count={6} className="mb-[var(--gp)] grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
      <Skeleton className="h-64 rounded-[var(--rm)]" />
    </RouteLoading>
  );
}
```

- [ ] **Step 9 — verify.** `rm -rf .next`; `npx vitest run tests/plan-actions.test.ts tests/plan-views.test.tsx tests/route-loading.test.tsx tests/ui-standards.test.ts tests/messages.test.ts tests/plan-model.test.ts` → PASS; `npx tsc --noEmit`; `npx eslint components/plan "app/(app)/plan" tests/plan-actions.test.ts tests/plan-views.test.tsx`.
- [ ] **Step 10 — commit.** `git add components/plan "app/(app)/plan" tests/plan-actions.test.ts tests/plan-views.test.tsx` → `git commit -m "feat(plan): Plan page with the weekly / monthly digest and per-account goals (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 7: runbook and docs

**Files:** Create `docs/RUNBOOK_DIGEST.md`; modify `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`. Docs are CRLF: Edit tool only. **The orchestrator merges this task only after the owner has nodded the SPEC §7b edit.**

- [ ] **Step 1 — `docs/RUNBOOK_DIGEST.md`.** Write:

````markdown
# Runbook — Goals and the weekly / monthly digest (Plan 17d)

Live checks for the **Plan** page (`/plan/digest`, `/plan/goals`). Nothing here has been tried on real data yet: the code
was tested with fakes and the migration on PGlite only (plan `docs/superpowers/plans/2026-11-01-17d-goals-digest.md`,
"Scratch-run result"). Do the steps with the owner (2FA login, real accounts). Report yes/no and numbers only.

## 0. The migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261103000001_goals.sql` adds the table `goals` (owner-only RLS, deleted with its account).
```
node --env-file=.env.local scripts/sb.mjs migration list        # only 20261103000001 pending (plus any earlier pending file, e.g. 17b / 17c)
node --env-file=.env.local scripts/db-probe.mjs table:goals    # before: 404 PGRST205 (absent)
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # exactly the pending file(s)
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs table:goals    # after: 401 with code 42501 (exists, anon denied)  (L3)
```
Until it is applied: Goals shows "Goals need a database update", the digest has no goals block, and Settings → Data &
privacy → Download all fails on the `goals` file with the usual export error.

## 1. Navigation (360 / 768 / 1280 px, light and dark of every theme)
1. Sidebar (desktop), icon rail (tablet) and the phone bottom bar show **Plan** between Explorer and Settings; the phone
   bar has 7 items and every label is readable at 360 px.
2. `/plan` opens `/plan/digest`; the Digest / Goals underline tabs switch sections; `/plan/x` is a 404; Plan opens in a
   shell tab titled "Plan" and stays inside the frame.
3. A dirty goals form asks before switching to Digest; reload asks too.

## 2. Digest = Overview (L1)
1. Open `/plan/digest` (last complete week). Note the six KPIs of one account.
2. Open Overview with the same days: `/overview?from=<first day>&to=<last day>`. Every KPI and its change must match.
3. Month: pick Month (last complete month) and repeat with `?from=<1st>&to=<last day>`.
4. Next on the running week: "still running" shows; the comparison covers the same number of days of the week before.
5. Best / weakest posts: open one; its Post Lab reach equals the digest number (latest snapshot). Posts under 7 days
   old say "still gaining reach". With fewer than 7 measured posts there is no weakest list (the line says why).
6. Week start: switch Settings → Language & formats → week starts on Sunday; the default week shifts by one day.

## 3. Goals (L3)
1. Set for one account: followers = current + 100 by a day 60 days ahead; average reach = a round number; posts per
   week = 3. Save → "Goals saved."; reload: the values stay; the progress lines show a status word.
2. Followers: the "straight line" number today ≈ the current count (set today); the projection says Low or Medium and
   "not enough history" when the account has under 14 days of follower counts. Never "High".
3. Clear the posts-per-week field, save: that goal disappears from the digest's "Goals now".
4. Wrong values: a target of 0 or 1.5, a followers target without a date, a date in the past: the form says what is
   wrong and nothing is saved.
5. Settings → Data & privacy → Download all: `goals.json` is one of the files; it holds only your targets.

## 4. Speed (L2)
DevTools → Network → the `/plan/digest` document → Server-Timing; warm load ≤ 1.2 s p75 with two accounts (the same reads
as Overview plus one small goals read). Record the numbers here.

## 5. Delete
Settings → Data & privacy → Delete all data (only when the owner wants everything gone): `goals` is emptied with the
accounts (cascade). Archive → delete permanently on one account removes only that account's goals.

## Results
| Step | Date | Result |
|---|---|---|
| §0 | | |
| §1 | | |
| §2 (L1) | | |
| §3 (L3) | | |
| §4 (L2) | | |
````

- [ ] **Step 2 — `docs/SPEC.md`.**
  (a) §7b: replace the exact line
  `- **Not in v1:** goals/targets, scheduled or emailed reports, shareable report links, custom report builder (the Explorer, §7e, is a whitelisted analysis view, not a free-form builder), logo upload.`
  with
  `- **Not in v1:** emailed reports, shareable report links, custom report builder (the Explorer, §7e, is a whitelisted analysis view, not a free-form builder), logo upload. Goals and an in-app weekly / monthly digest were added by Plan 17d (§7o; owner-approved 2026-10, creator-toolkit design §6 / §0b); a scheduled digest push is Plan 17e.`
  (b) §5 table: insert after the row that starts `| \`explorer_views\` |` the row
  `| \`goals\` | id, account_id (fk, cascade), metric (\`followers\` / \`avg_reach\` / \`posts_per_week\`), target (whole number 1 to 1,000,000,000; posts per week at most 50), due_day (followers only, required there), created_at (the start of the pace line), updated_at — unique (account_id, metric); owner-authored (owner session under \`is_owner()\` RLS) |`
  (c) §8: in the line starting `Pages: Login · Overview`, replace `· Explorer (§7e) ·` with `· Explorer (§7e) · Plan (Digest and Goals, §7o) ·`.
  (d) insert immediately BEFORE the line `## 8. UI (v1)` (after any §7l–§7n another plan added) this section:

```markdown
## 7o. Goals and the weekly / monthly digest (Plan 17d; creator-toolkit design §6, §0b)
Status: code done, NOT verified live (`docs/RUNBOOK_DIGEST.md`); migration `20261103000001_goals` NOT applied (owner applies it before deploying; until then Goals says "needs a database update" and the digest has no goals block).

Side navigation → **Plan** (between Explorer and Settings; sections as underline tabs with their own URLs, the Settings pattern: `/plan` → `/plan/digest`; `/plan/goals`; Plan 17f adds `board`).
- **Digest** (`/plan/digest?week=<first day>` or `?month=YYYY-MM`; default the last complete week; week = the week-start setting, owner-timezone days; Week / Month and Previous / Next, no range bar): the Overview's numbers (`buildOverview` with the fixed days of the period, compared with the period before; the same coverage, lag and healthy-only total rules) for all accounts and per account (followers, net follows, reach, views, engagement, posts), the 3 best and 3 weakest feed posts by latest reach (weakest from 7 measured posts; posts under 7 days old marked "still gaining reach"; each links to its Post Lab), and the account's goals now. A running period says so and compares the same number of days. No findings yet (follow-up after Plan 17b), no export (the Overview export covers the same days), no email; a Monday push linking here is Plan 17e.
- **Goals** (`/plan/goals`, table `goals`): per account at most one of each: **followers by a date** (pace = straight line from the count on the day the goal was set to the target on the due day; projection = the Growth tab's Theil-Sen method at the due day without today's part-day count, Low or Medium only, always Low beyond 90 days, "not enough history" under 14 days), **average reach per post this month** (feed posts with reach; judged from 3 posts; young posts named), **posts per week** (feed posts; even pace through the week; last week shown). Status: Reached / On track / Behind / Missed. Targets are whole numbers (1 to 1,000,000,000; posts per week at most 50); explicit save per account (UI standard 18). Owner-only RLS, deleted with the account, included in "Export your data".
```

- [ ] **Step 3 — `docs/TODO.md`.** Insert immediately BEFORE the line `## 6b. Next (Plan 14/15 Settings)`:

```markdown
## 6u. Goals + weekly / monthly digest (Plan 17d)
- [x] Side-nav item Plan (/plan/digest, /plan/goals); digest = Overview numbers for one week or month + best / weakest posts + goals now; goals per account with pace, projection and status (code done; live verification pending: docs/RUNBOOK_DIGEST.md)
- [ ] Apply migration `20261103000001_goals` (owner's go-ahead, before deploying)
- [ ] RUNBOOK_DIGEST §0–§5 walked through by the owner (L1 digest = Overview, L2 speed, L3 the migration live)
- Known: no findings block until Plan 17b; no digest export or email; a goal's progress is always "now" (no history per past period); goals are not counted in Storage used.
```

- [ ] **Step 4 — `docs/PROGRESS.md`.** (a) §3: after the 16c bullet (the line starting `- **16c: Data & privacy`) and after any 17a–17c bullets, add `- **17d: Goals + digest (code done, NOT verified live; migration 20261103000001 NOT applied).** New side-nav item **Plan** (/plan/digest, /plan/goals): one calendar week or month per account and for all accounts with the Overview's numbers vs the period before, best and weakest posts, goals now; goals per account (followers by a date, average reach per post this month, posts per week) with pace, Theil-Sen projection (Low/Medium) and status, explicit save. Plan: docs/superpowers/plans/2026-11-01-17d-goals-digest.md. Runbook: docs/RUNBOOK_DIGEST.md.` (b) §5 table: add the row `| 20261103000001_goals | goals (owner-all RLS, cascade from accounts, unique (account_id, metric)) (Plan 17d; **NOT applied**: owner go-ahead, apply BEFORE deploying; RUNBOOK_DIGEST §0) |`. (c) §6: append the next numbered item `**docs/RUNBOOK_DIGEST.md** (Plan 17d): §0 migration, then §1–§5.` (d) §8: append `- 17d: Plan between Explorer and Settings; /plan/<section> URLs; default = last complete week; no range bar; goals = 3 kinds, one each per account, no period column; avg-reach guard 3 posts; weakest posts from 7; young = 7 days; no findings block until 17b; no digest export; goals not counted in Storage used.` (e) under the line starting `Account page tabs now:` (end of §3) add the line `Side navigation now: Overview, Accounts, Tags, Calendar, Explorer, **Plan** (17d), Settings.`
- [ ] **Step 5 — verify.** `npx vitest run tests/ui-standards.test.ts tests/messages.test.ts` → PASS (unchanged; docs only).
- [ ] **Step 6 — commit.** `git add docs/RUNBOOK_DIGEST.md docs/SPEC.md docs/TODO.md docs/PROGRESS.md` → `git commit -m "docs(plan): runbook, spec, todo, progress for goals and the digest (Plan 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

## Scratch-run result (2026-10-30, throwaway clone and PGlite OUTSIDE the repo)

**Code (clone of `main` at `81054d7` under the session scratchpad `p17d/`, own `npm ci`, the real `node_modules` untouched):** every file of Tasks 1–6 written exactly as in this plan (the plan text was generated from the clone's files, and every Edit-tool replacement above was re-applied to the pristine `81054d7` file and compared byte for byte with the clone's result: all 11 edited files identical). Targeted runs green: `tests/analysis-goals.test.ts` (10), `tests/plan-model.test.ts` (17), `tests/goals-migration.test.ts` (4), `tests/plan-views.test.tsx` (7), `tests/plan-actions.test.ts` (4), plus `analysis-trend`, `dashboard-growth`, `nav`, `tabs-model`, `app-shell`, `service-worker`, `settings-sections`, `messages`, `data-export`, `settings-data`, `data-privacy-guard`, `migrations`, `ui-standards`. **Full `npm run check` (lint + tsc + vitest + next build) in the clone: CHECK_EXIT=0, 308 test files, 3,127 tests passed; the build lists `ƒ /plan/[[...section]]`.**

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; all 16 existing migrations, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.mfa_factors` / `storage.*`; roles `anon`, `authenticated`, `service_role` (bypassrls) with Supabase-like default privileges), 21 of 21 checks passed:** the migration applies; the save's upsert on `(account_id, metric)` edits in place and keeps `created_at` (the pace start); deleting cleared metrics removes only those; a second goal of the same metric → 23505; unknown metric, target 0, target above 1,000,000,000, posts per week 51, followers without a due day, a due day on another metric → 23514; unknown account → 23503; a non-number target refused; another signed-in user sees 0 rows, cannot insert, updates nothing; the owner at aal1 with a verified factor sees 0 rows, at aal2 both; anon: permission denied; deleting an account cascades to its goals only; `delete_all_data()` (16c, unchanged) empties `goals`; indexes = primary key + `goals_account_metric_key`.

**Not executed:** a real PostgREST (the `on_conflict=account_id,metric` upsert against a unique INDEX: PostgREST accepts a unique index for `on_conflict`; L3 checks it live), a browser (360 / 768 / 1280 px, the 7-item phone bar, themes), Server-Timing on Vercel (L2), real data (L1).

## Self-review

- Spec coverage: roadmap §3 "17d" — nav item (Task 5), sections (Tasks 4, 6), week / month period with the week-start setting and DST (Tasks 4, 3 tests), goals with pace / forecast / "not enough history" and Low/Medium (Task 3), explicit save (Task 6), digest KPIs + top/bottom posts + goals (Tasks 4, 6), migration with RLS and cascade (Task 2), export registry (Task 5), runbook / SPEC / TODO / PROGRESS (Task 7). Not covered on purpose (Decisions): findings (17b not built), digest export, saves-per-post goal, max-20 cap (moot).
- Names checked against the code by grep: `projectFollowers`, `PROJECTION`, `buildOverview`, `loadOverviewInput`, `resolveScope`, `readFrom`, `earliestDay`, `weekOf`, `monthOf`, `isDay`, `daysBetween`, `minDay`, `localDay`, `addDays`, `isActive`, `isTabPath`, `requireOwner`, `getPrefs`, `createServerSupabase`, `SaveBar`, `confirmLeave`, `FormField`, `Segmented`, `StatCard`, `useKpiDelta`, `useScopeText`, `formatMetric`, `formatDay`, `formatMonth`, `formatNumber`, `startProgress`, `EXPORT_TABLES`, `RouteLoading`, `SkeletonGrid`.
