# Plan 12b: Rollups + Explorer + Drill-down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner zoom vertically (portfolio → group → account → format → single item → its follower curve → audience slice) and horizontally (accounts, groups, formats, tags, weekdays, hours, periods) through a new desktop-first `/explorer` page with a whitelisted metric/dimension registry, a linked chart + table, saved views and an Excel export of the current view; and make the existing Overview / account pages drill into it — all driven by the Plan 12a Time Scope.

**Architecture:** One additive migration adds four `security invoker` SQL functions (RLS still applies, execute granted to `authenticated` only) that return small, additive rollups — account days per account or per day/week/month bucket, published media with their latest snapshot (also used as the capped post list), the same media summed per account/format/tag/weekday/hour/bucket, and a follower curve from `follower_snapshots` — rewrites five read policies so `is_owner()` runs once per statement, and adds the owner-authored `explorer_views` table. TypeScript never sends SQL text: the URL is parsed into an allow-listed `ExplorerState`, the reader maps it to one of the fixed RPCs with typed arguments, and pure functions in `lib/analysis/explorer.ts` turn the additive parts into metric values through the registry in `lib/metrics.ts` (a new metric = one entry), combine accounts into groups, join the comparison period, and compute drill targets and the breadcrumb trail. Pages are wiring only.

**Tech Stack:** Next.js 16.4 App Router, TypeScript strict, Supabase Postgres (SQL functions, RLS), `@supabase/supabase-js` `rpc()` with the owner-session client, next-intl 4, Recharts 3 (installed), `write-excel-file` (installed), Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Drill-down & time scope", "Data policy", Round 3 decisions) and §8 (cross-cutting rules); `docs/SPEC.md` §5, §7, §7b, §8b; Plan 12a `docs/superpowers/plans/2026-10-23-12a-time-scope.md` (consumed, see "Assumptions about 12a"). Project rules: `CLAUDE.md` (binding).

**Dry run:** see "Dry-run result" at the end of this file.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **SQL functions, no rollup tables.** Volume estimate for the owner (≈ 10 accounts, 1,000+ posts each, 1–2 years): `account_daily` ≈ 7,300 rows, `media` ≈ 10,000 posts + ≈ 11,000 Stories a year, `media_metrics` ≈ 1.3 M snapshots (80 per post, 48 per Story), `follower_snapshots` ≈ 350,000. Measured in the dry run on exactly that volume (PostgreSQL 16, the repo's real migrations + this one, queried as the owner under RLS): every rollup answers in **≤ 0.3 s** (most ≤ 0.1 s; the heaviest is "1 year by format incl. Stories", 16,000 items). Rollup tables would add refresh-after-tick plumbing and staleness for no measurable gain. ponytail: if a rollup ever passes ~0.5 s, add a `media_latest` table written by the sync (one row per media) and point `explorer_media` at it.
- **Why SQL and not TypeScript** for each rollup: (1) PostgREST returns at most 1,000 rows per request — 1 year × 10 accounts is 3,650 daily rows and 10,000+ posts, each needing its LATEST snapshot out of ~80, so TypeScript would page through megabytes on every page view; the SQL answers with one row per bucket/group. (2) Owner-timezone weekday/hour of `posted_at`, week/month buckets, tag fan-out (a post with 2 tags counts for both) and "last follower value per hour" are one `GROUP BY`/`DISTINCT ON` in SQL. (3) `security invoker` keeps RLS in charge, so the owner-session client can call them and nobody else gets rows.
- **RLS policy rewrite for speed (same predicate).** `account_daily`, `media`, `media_metrics`, `media_tags` and `follower_snapshots` policies change from `using (public.is_owner())` to `using ((select public.is_owner()))`: Postgres then evaluates the owner check once per statement (an InitPlan) instead of once per row. Dry run: the slowest rollup went from ~5 s to ~0.1–0.3 s. Nothing else about the policies changes (Supabase's documented RLS performance pattern).
- **Functions return additive parts, TypeScript computes the metric values** (`MetricDef.value(parts)` in `lib/metrics.ts`): sums and counts combine correctly across accounts and groups, so "by group" is a TypeScript sum of the per-account rows (named groups combined; an isolated account stays its own row, SPEC §7b), and a new metric that can be expressed with existing parts is one registry entry.
- **Two metric sources.** *Account metrics* (`account_daily`: followers, reach, views, interactions, net follows, engagement rate = Σ interactions ÷ Σ reach over days that have both) can be grouped by group, account and time only — Instagram's account insights are daily totals with no format, tag or hour. *Post metrics* (published media with their latest lifetime snapshot: posts, avg reach/views per post, likes, comments, saves, shares, post engagement = (likes + comments + saves + shares) ÷ reach, SPEC §7) can be grouped by everything. A metric the chosen dimension cannot show is dropped (parser) and the UI says why.
- ⚠ **Stories are opt-in in post metrics:** excluded unless the format filter is Stories or the table is grouped by format (then a Stories row appears). Engagement-rate parts never include Stories (they have no likes/comments/saves). Matches every existing analysis (top posts, formats, heatmaps exclude Stories).
- **Dimensions:** group, account, format, tag (incl. "Untagged"), weekday, hour posted, time (the bucket size is the Time Scope's effective granularity day/week/month — the spec's "week, month" group-by), single posts. Weekday/hour are the owner-timezone time the item was published.
- ⚠ **Single posts = the newest 500 in the range** (SQL `order by posted_at desc limit 500`), with a "showing the newest 500" note when the cap is hit. Sorting by any column happens in the table.
- **Chart + table:** the chart draws ONE metric (`chart=`, default the first selected) as bars (categories) or a line (time), plus the comparison period as a muted second series when a comparison is on; the table shows all selected metrics (max 4) with the previous value's change. Table rows link to the drill target (keyboard path); chart bars/points are clickable too (mouse convenience).
- **Comparison = Plan 12a's compare range.** Categories are joined by key (account, format, …); time buckets by position (bucket 1 of the current range vs bucket 1 of the previous one). No comparison for single posts (a post has no "previous").
- **Drill map** (`drillTarget`): group → its accounts; account → its formats; format, tag, hour → single posts; weekday → hours of that weekday; a time bucket → that bucket as the new fixed range (month → weeks → days → posts of that day); single post → the item level. The breadcrumb (`All accounts › group › @account › format › post`) rebuilds each level from the URL; every link keeps the Time Scope parameters; the browser Back button restores the previous URL.
- **Single-item level** (`?item=<media id>`): its latest numbers and links (Instagram permalink, the account's Posts or Stories tab — there is no Post Lab yet), the account's **follower curve** around the posting time (hourly, posting day −1 to +2 days, from `follower_snapshots`), and an **audience slice**: that day's account-level reach of the item's format split followers / non-followers (`account_daily_breakdown`), labelled as account-level. The UI says plainly that Instagram has no hourly reach (account insights are daily-only).
- **Filters:** accounts (multi, ≤ 20), group, format, tag/untagged, weekday, hour. Filters are a GET form (`next/form`): the URL is the only state, so the top progress bar, Back and saved views work without client state.
- **Saved views:** owner-authored table `explorer_views` (`is_owner()` for all, like tags): name 1–60 characters (unique ignoring case), `state` = the canonical, allow-listed query parameters of the Explorer **plus** the Time Scope parameters exactly as 12a writes them — a preset stays rolling (`from=30d`), fixed days stay fixed. ≤ 2 KB, at most 50 views (app check, like `TAG_LIMIT`). Re-validated through both parsers on every save AND every read; rename and delete with confirmation.
- **Export of the current view:** `GET /api/export/explorer?<same parameters>` → one-sheet `.xlsx` (dimension column, the selected metrics, and "previous" + "change" columns when comparing) through the existing `write-excel-file` module and cell rules (safe text, real dates, empty cells for missing values). It also sends `Server-Timing: explorer;dur=…` (the same loader as the page), which the runbook uses to measure 1-year performance.
- **Navigation:** Explorer is a 6th main item between Calendar and Settings (icon `ChartNoAxesCombined`); the phone tab bar becomes 6 columns. It carries the Time Scope like Overview/Calendar do after 12a.
- **Desktop-first layout:** controls in a left column from `lg` (sticky), stacked above the results below it; table + chart full width; card list on phones (DataTable). Every list and select scales to 20+ accounts (multi-select is a scrollable checkbox list).
- **No new dependencies; no Meta calls; no new Meta metric names.**

## Open questions for the owner (the plan implements the default shown)

1. Stories counted in post metrics only when chosen (format = Stories or grouped by format)? **Default: yes.**
2. Single posts capped at the newest 500 per range? **Default: yes** (narrow the range for older ones).
3. Explorer in the phone tab bar (6 tabs) or desktop sidebar only? **Default: in both.**
4. Max 4 metrics per view, 50 saved views. **Default: yes.**
5. Keyboard shortcuts for analysis (Round 3 asks for them): **Default: not in 12b** — every control is a link, select or button (Tab/Enter work); shortcuts can come later.

## Assumptions about 12a

12b runs AFTER Plan 12a is merged. Names below are copied from the 12a plan's Interfaces blocks (commit `ce165ba`, Tasks 1–4); the ones marked **(assumed)** were not yet committed by the 12a planner when this was written and must be reconciled by the orchestrator.

- `lib/time-scope/range.ts` (12a Task 1, **dry-run here: its code was replayed in the clone**): `DayRange { from; to }`, `Window = { last: number } | DayRange`, `Compare`, `Granularity = 'day' | 'week' | 'month'`, `isDay`, `daysIn`, `minDay`, `compareRange(asked: Window, cur: DayRange, cmp: Compare): DayRange | null`, `bucketStart(day, gran, weekStart)`, `bucketRange(start, gran): DayRange`.
- `lib/time-scope/scope.ts` (12a Task 2, **replayed**): `TimeScope { range: Preset | DayRange; cmp: Compare; gran: GranChoice }`, `SCOPE_KEYS`, `parseTimeScope(sp, weekStart)`, `scopeParams(s): Record<string, string>`, `scopeQuery(s): string`, `ResolvedScope { scope; params; query; preset; window; range; compare; gran; earliest; partial; comparePartial }`, `resolveScope(s, today, earliest)`.
- `lib/analysis/growth.ts` after 12a Task 4: `MAX_LAG_DAYS` (= 3) and `Kpi { value; prior; diff; change; reason }` unchanged (verified in its Task 4 text).
- Settled-day rule copied from 12a Task 4 `summarize()`: rolling windows end on the latest settled day, fixed windows are cut there (`explorerWindow` mirrors it for the accounts in scope).
- _(further 12a names used by Tasks 11–13 — the `TimeScopeBar` props, the post-12a shape of `OverviewView`, `AccountOverview`, `PostsTab` and the account page — are listed here once 12a commits Tasks 6–9)_

## Out of scope

Covers UI / Post Lab (Plan 13), Followers & Growth Center, comment moderation, settings, the planner, new Meta metrics, hourly reach (Instagram does not provide it), keyboard shortcuts, a per-Story "final numbers" rollup for the Stories tab/export (12a mentions it; `explorer_media` already returns a Story's latest = final snapshot, but switching the Stories tab to it is not in this plan's scope — see the final report), rollup tables.

## Global Constraints

- Ponytail: smallest thing that works; no abstraction with one implementation; **no new dependencies**.
- TypeScript strict. No Meta metric names added or changed.
- DB: ONE new migration `supabase/migrations/20261024000001_explorer.sql`; never edit applied migrations. Functions: `language sql stable security invoker set search_path = ''`, fully qualified names, typed parameters, no dynamic SQL; `revoke execute … from public, anon; grant execute … to authenticated`. `explorer_views`: RLS + one `for all to authenticated using (public.is_owner()) with check (public.is_owner())` policy. **Apply the migration BEFORE deploying the code** (runbook §0).
- Reads and writes: OWNER SESSION client (`createServerSupabase`) only, under RLS; never the admin client, never `account_tokens`. Explicit column lists; fixed error messages (`explorer read: <op> failed`) that never echo Supabase errors.
- No free-form queries from the client: every metric id, dimension id, format, tag, weekday, hour, account id and group name is allow-listed in `lib/explorer/state.ts`; the server maps a state to one of the fixed RPCs. Hostile parameters never throw on pages (they fall back per part) and are rejected with `bad_params` by the export route.
- Server actions: `await requireOwner()` FIRST and outside any try/catch, then validate every argument; return `{ ok: true } | { ok: false; error: <key> }`. Pages call `requireOwner()` first.
- Pure logic deterministic: `lib/analysis/explorer.ts`, `lib/explorer/state.ts`, `lib/explorer/views.ts` take `today`/`tz`/`weekStart` as inputs; no `Date.now()` / `new Date()` there.
- Every UI string via next-intl; ALL new keys are added by Task 2 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation); later tasks only read them. `tests/messages.test.ts` enforces parity + placeholders.
- Theming: semantic tokens only (`bg-card`, `text-muted-foreground`, `--chart-n`); no raw colours. Responsive 360 / 768 / 1280, desktop-first density; CSS breakpoints only (no `matchMedia`/`useMediaQuery` for layout); `min-w-0` + `truncate` on user text; no fixed pixel widths on layout containers.
- UI kit: build from `components/ui/` + `components/shared/`; dialogs use `ResponsiveDialog*` / `ConfirmDialog`; forms use `FormField` render-props; density is un-layered (`h-*`/`p-*` on shadcn `Button`/`Input`/`Card` are ignored — use the `--ctl` tokens as the existing selects do). No `npx shadcn` call is needed in this plan.
- Dates, times and numbers only via `lib/format.ts`.
- Tests: Vitest timeout 20 s; jsdom `Blob` has no `.stream()` (build `Response` bodies from strings); rerun once on "worker start timeout" before concluding anything; never chain a commit after a piped command.
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **RLS through the functions:** a signed-in non-owner and `anon` get nothing (`security invoker`, no definer, execute only for `authenticated`) → Task 1 migration test + runbook §5 SQL check (verified on PostgreSQL 16 in the dry run).
2. **Hostile URL parameters** (`?m=__proto__`, `?acc=' or 1=1`, repeated keys, `?by=drop table`) never reach SQL as text and never throw → Task 3 "hostile or malformed values", Task 4 "rollupArgs: every state maps to fixed RPC arguments", Task 11 "400 bad_params for anything that is not the canonical query".
3. **Numbers match the existing analyses:** engagement rate, averages and "measured" follow `lib/analysis/posts.ts`/SPEC §7; followers are a level (last value), never summed over days → Task 1 SQL checks (dry run) + Task 5 "by group: sums the accounts first, then computes ratios".
4. **Saved views can't smuggle anything:** stored JSON is re-validated through both parsers on read; unknown keys dropped; size-capped in the DB → Task 6.
5. **Drill keeps the scope:** every drill link and breadcrumb carries the Time Scope; a time-bucket drill becomes a fixed range → Task 5 "drill-down" tests + Task 12 page test + runbook §3.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261024000001_explorer.sql` (new) | `explorer_daily`, `explorer_media`, `explorer_posts`, `explorer_followers`; read-policy InitPlan rewrite; `explorer_views` |
| `tests/explorer-migration.test.ts` (new) | migration lint |
| `lib/metrics.ts` | registry: `MetricId`, `MetricSource`, parts types, `value()`, `DIMENSIONS`, `supports`, guards |
| `components/shared/useKpiDelta.ts` | accepts any `MetricId` |
| `messages/en.json`, `messages/zh-CN.json` | `nav.explorer`, new `metrics.*`, `explorer.*` |
| `lib/explorer/state.ts` (new) | `ExplorerState`, `parseExplorerState`, `explorerParams`, `withState`, `defaultMetrics` |
| `lib/explorer/read.ts` (new) | owner-session RPC reader: `rollupArgs`, `loadRollup`, `loadItems` |
| `lib/analysis/explorer.ts` (new) | `toKpi`, `addParts`, `itemParts`, `byGroup`, `settledDay`, `explorerWindow`, `bucketsOf`, `buildExplorer`, `drillTarget`, `drillHref`, `breadcrumbs` |
| `lib/explorer/load.ts`, `lib/explorer/labels.ts` (new) | the one loader of page + export; row labels shared by screen and Excel |
| `lib/explorer/views.ts` (new), `app/(app)/explorer/actions.ts` (new), `lib/tags.ts` | saved-view validation, server actions; `normalizeTagName` gains a `max` |
| `components/charts/SeriesChart.tsx`, `components/charts/Heatmap.tsx` | `onPointClick` + `clickedIndex`, muted series; cell `href` |
| `lib/explorer/item.ts` (new), `components/explorer/ItemPanel.tsx` (new) | single-item level |
| `components/explorer/SavedViews.tsx` (new) | saved views menu, save/rename/delete dialogs |
| `app/api/export/explorer/route.ts`, `lib/export/explorer.ts` (new), `lib/export/workbook.ts` | export of the current view (+ `Server-Timing`) |
| `app/(app)/explorer/page.tsx`, `loading.tsx` (new), `components/explorer/ExplorerView.tsx` (new), `lib/nav.ts`, `components/shared/AppShell.tsx` | the page, nav item |
| `components/overview/OverviewView.tsx`, `components/account/AccountOverview.tsx`, `components/account/PostsTab.tsx`, `app/(app)/accounts/[id]/page.tsx` | drill links into the Explorer |
| `docs/RUNBOOK_EXPLORER.md` (new), `docs/SPEC.md`, `docs/TODO.md` | live checks, spec sections, ticks |

**Adding i18n keys:** merge the given object into the existing top-level key of the same name in BOTH files (create it if missing), keep existing entries, 2-space JSON.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | `supabase/migrations/20261024000001_explorer.sql`, `tests/explorer-migration.test.ts` | 2, 7 |
| 2 | Registry + all i18n keys | — | `lib/metrics.ts`, `components/shared/useKpiDelta.ts`, `messages/en.json`, `messages/zh-CN.json`, `tests/explorer-registry.test.ts` | 1, 7 |
| 3 | Explorer URL state | 2 | `lib/explorer/state.ts`, `tests/explorer-state.test.ts` | 1, 7 |
| 4 | Rollup reader | 3 | `lib/explorer/read.ts`, `tests/explorer-read.test.ts` | 5, 6, 7 |
| 5 | Pure model: rows, groups, comparison, drill, breadcrumbs | 3, 4 (type only), 12a | `lib/analysis/explorer.ts`, `tests/analysis-explorer.test.ts` | 6, 7 |
| 6 | Saved views: validation + server actions | 3, 12a | `lib/explorer/views.ts`, `lib/tags.ts`, `app/(app)/explorer/actions.ts`, `tests/explorer-views.test.ts` | 4, 5, 7 |
| 7 | Clickable charts | — | `components/charts/SeriesChart.tsx`, `components/charts/Heatmap.tsx`, `tests/charts-drill.test.tsx` | 1–6 |
| 8 | Single-item level | 2, 4, 5 | `lib/explorer/item.ts`, `components/explorer/ItemPanel.tsx`, `tests/explorer-item.test.tsx` | 9, 10, 13, 14 |
| 9 | Saved views menu | 2, 6 | `components/explorer/SavedViews.tsx`, `tests/saved-views.test.tsx` | 8, 10, 13, 14 |
| 10 | Server loader + row labels | 4, 5, 8 | `lib/explorer/load.ts`, `lib/explorer/labels.ts`, `tests/explorer-load.test.ts` | 9, 13, 14 |
| 11 | Excel export of the current view | 6, 10 | `app/api/export/explorer/route.ts`, `lib/export/explorer.ts`, `lib/export/workbook.ts`, `tests/explorer-export.test.ts` | 13, 14 |
| 12 | Explorer page + nav item | 7–11, 12a | `app/(app)/explorer/page.tsx`, `app/(app)/explorer/loading.tsx`, `components/explorer/ExplorerView.tsx`, `lib/nav.ts`, `components/shared/AppShell.tsx`, `tests/explorer-view.test.tsx`, `tests/nav.test.ts`, `tests/app-shell.test.tsx` | 13, 14 |
| 13 | Drill from Overview | 3, 12a | `components/overview/OverviewView.tsx`, `tests/overview-drill.test.tsx` | 8–12, 14 |
| 14 | Drill from account pages | 3, 7, 12a | `components/account/AccountOverview.tsx`, `components/account/PostsTab.tsx`, `app/(app)/accounts/[id]/page.tsx`, `tests/account-drill.test.tsx` | 8–13 |
| 15 | Docs: SPEC, TODO, RUNBOOK_EXPLORER; final check | all | `docs/SPEC.md`, `docs/TODO.md`, `docs/RUNBOOK_EXPLORER.md` | — |

Run order for SDD: wave A = 1, 2, 7 · wave B = 3 · wave C = 4, 6 · wave D = 5 · wave E = 8, 9, 13, 14 · wave F = 10 · wave G = 11 · wave H = 12 · wave I = 15. Tasks in one wave touch disjoint files. Every task's code was executed in the dry run in this order (see "Dry-run result"), except where that section says otherwise.

---

### Task 1: Migration `20261024000001_explorer.sql` + migration test

**Files:**
- Create: `supabase/migrations/20261024000001_explorer.sql`
- Test: `tests/explorer-migration.test.ts` (new). `tests/migrations.test.ts` (RLS + a policy on every table, no anon/public policy, `(select auth.uid())`) must keep passing.

**Interfaces:**
- Consumes: `public.is_owner()`; tables `account_daily`, `media`, `media_metrics`, `media_tags`, `follower_snapshots` and their policies `account_daily_owner_select`, `media_owner_select`, `media_metrics_owner_select`, `media_tags_owner_all`, `follower_snapshots_owner_select` (migrations `20261015000001`, `20261017000001`, `20261019000001`).
- Produces (exact names/columns later tasks call through `db.rpc`):
  - `public.explorer_daily(p_accounts uuid[], p_from date, p_to date, p_by text, p_grain text, p_week_start text)` → `(key text, reach bigint, views bigint, interactions bigint, er_interactions bigint, er_reach bigint, net_follows bigint, followers bigint)`. `p_by = 'account'` → key = account uuid; otherwise key = bucket start `'YYYY-MM-DD'` of `p_grain` `'day' | 'week' | 'month'` (week start `p_week_start` `'mon' | 'sun'`).
  - `public.explorer_media(p_accounts uuid[], p_from timestamptz, p_to timestamptz, p_tz text, p_format text, p_stories boolean, p_tag uuid, p_untagged boolean, p_weekday int, p_hour int)` → `(id text, account_id uuid, media_type text, posted_at timestamptz, permalink text, caption text, local_day date, weekday int, hour int, reach int, views int, likes int, comments int, saves int, shares int)` — latest snapshot per item, caption ≤ 200 chars.
  - `public.explorer_posts(<the 10 explorer_media args>, p_by text, p_grain text, p_week_start text)` → `(key text, posts bigint, measured bigint, reach_sum bigint, views_sum bigint, views_n bigint, likes bigint, comments bigint, saves bigint, shares bigint, er_interactions bigint, er_reach bigint)`; `p_by` ∈ `'account' | 'format' | 'tag' | 'weekday' | 'hour'`, anything else = time bucket. Tag key = tag uuid or `'untagged'`; weekday/hour keys are numbers as text.
  - `public.explorer_followers(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_hourly boolean)` → `(at text, followers int)`; `at` = `'YYYY-MM-DDTHH:00'` (hourly) or `'YYYY-MM-DD'`, owner timezone.
  - `public.explorer_views(id uuid, name text 1–60 trimmed, state jsonb object ≤ 2048 bytes, created_at, updated_at)`, unique `lower(name)`.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261024000001_explorer.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = {
  explorer_daily: 'uuid[], date, date, text, text, text',
  explorer_media: 'uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int',
  explorer_posts: 'uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text',
  explorer_followers: 'uuid, timestamptz, timestamptz, text, boolean',
};
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');

describe('explorer migration', () => {
  it('is additive: no drops, no column edits, no other tables touched except the policy rewrite', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function|policy)\b/i);
    expect(sql).not.toMatch(/alter\s+column/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it.each(Object.entries(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const head = m![1];
    const body = m![2];
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).not.toMatch(/security\s+definer/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\|\|/i); // nothing is ever spliced into SQL text
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('the week/month bucket rule is identical in the daily and the posts rollup (inline on purpose: a helper cannot be inlined)', () => {
    const week = /when\s+'week'\s+then\s+(\w+\.\w+)\s+-\s+\(\(extract\(dow\s+from\s+\1\)::int\s+-\s+case\s+when\s+p_week_start\s+=\s+'sun'\s+then\s+0\s+else\s+1\s+end\s+\+\s+7\)\s+%\s+7\)/i;
    const month = /when\s+'month'\s+then\s+date_trunc\('month',\s+\w+\.\w+::timestamp\)::date/i;
    for (const name of ['explorer_daily', 'explorer_posts']) {
      expect(fn(name)![2], name).toMatch(week);
      expect(fn(name)![2], name).toMatch(month);
    }
  });

  it('Stories are opt-in and never part of the engagement-rate parts; the latest snapshot is used', () => {
    expect(fn('explorer_media')![2]).toMatch(/\(p_stories\s+or\s+m\.media_type\s+<>\s+'STORY'\)/i);
    expect(fn('explorer_media')![2]).toMatch(/order\s+by\s+x\.captured_at\s+desc\s+limit\s+1/i);
    const parts = fn('explorer_posts')![2].match(/filter\s*\(where\s+k\.reach\s+>\s+0\s+and\s+k\.media_type\s+<>\s+'STORY'\)/gi) ?? [];
    expect(parts).toHaveLength(2);
  });

  it('rewrites the read policies the rollups hit so is_owner() is evaluated once per statement (same predicate)', () => {
    for (const [policy, table] of [
      ['account_daily_owner_select', 'account_daily'],
      ['media_owner_select', 'media'],
      ['media_metrics_owner_select', 'media_metrics'],
      ['follower_snapshots_owner_select', 'follower_snapshots'],
    ])
      expect(sql).toMatch(new RegExp(`alter\\s+policy\\s+${policy}\\s+on\\s+public\\.${table}\\s+using\\s*\\(\\s*\\(\\s*select\\s+public\\.is_owner\\(\\)\\s*\\)\\s*\\)\\s*;`, 'i'));
    expect(sql).toMatch(/alter\s+policy\s+media_tags_owner_all\s+on\s+public\.media_tags\s+using\s*\(\s*\(\s*select\s+public\.is_owner\(\)\s*\)\s*\)\s+with\s+check\s*\(\s*\(\s*select\s+public\.is_owner\(\)\s*\)\s*\)\s*;/i);
    for (const m of sql.matchAll(/alter\s+policy[\s\S]*?;/gi)) expect(m[0]).not.toMatch(/\btrue\b|auth\.uid/i);
  });

  it('explorer_views: owner-authored, one for-all is_owner() policy, bounded name and state, unique name ignoring case', () => {
    const body = sql.match(/create\s+table\s+public\.explorer_views\s*\(([\s\S]*?)\r?\n\);/i)?.[1] ?? '';
    expect(body).toMatch(/name\s+text\s+not\s+null\s+check\s*\(\s*char_length\(name\)\s+between\s+1\s+and\s+60\s+and\s+name\s*=\s*btrim\(name\)\s*\)/i);
    expect(body).toMatch(/state\s+jsonb\s+not\s+null\s+check\s*\(\s*jsonb_typeof\(state\)\s*=\s*'object'\s+and\s+octet_length\(state::text\)\s*<=\s*2048\s*\)/i);
    expect(sql).toMatch(/create\s+unique\s+index\s+\w+\s+on\s+public\.explorer_views\s*\(\s*lower\(name\)\s*\)/i);
    expect(sql).toMatch(/alter\s+table\s+public\.explorer_views\s+enable\s+row\s+level\s+security/i);
    const policies = [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on\s+public\.explorer_views\s+for\s+all\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)\s+with\s+check\s*\(\s*public\.is_owner\(\)\s*\)/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.explorer_views\s+from\s+anon/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory … 20261024000001_explorer.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261024000001_explorer.sql`:

```sql
-- Plan 12b: Explorer rollups + saved views. All additive. Apply BEFORE deploying the code that calls these functions.
--
-- Every function is `security invoker`: it runs with the caller's rights, so the owner-only RLS policies of the tables it
-- reads still apply (any other session gets empty results). Execute is revoked from public/anon and granted to
-- `authenticated` only. Inputs are typed (uuid[], date, timestamptz, int, boolean); the few text inputs are only compared
-- inside CASE expressions or passed to `at time zone`, never concatenated into SQL. Results are one row per bucket or
-- group (well under PostgREST's 1000-row cap); metric values are computed from these additive parts in lib/metrics.ts.
-- Time buckets: 'day' | 'week' (first day = p_week_start 'mon' | 'sun') | 'month'. The bucket CASE is written inline in
-- explorer_daily and explorer_posts on purpose: a helper function with `set search_path` cannot be inlined and made the
-- 2-year rollups ~3x slower (measured in the plan's dry run).

-- 1. RLS cost: the owner check becomes an InitPlan evaluated once per statement instead of once per row. Same predicate,
-- same result; on 10 accounts x 2 years it took the slowest rollup from ~5 s to ~0.1 s (dry run).
alter policy account_daily_owner_select on public.account_daily using ((select public.is_owner()));
alter policy media_owner_select on public.media using ((select public.is_owner()));
alter policy media_metrics_owner_select on public.media_metrics using ((select public.is_owner()));
alter policy media_tags_owner_all on public.media_tags using ((select public.is_owner())) with check ((select public.is_owner()));
alter policy follower_snapshots_owner_select on public.follower_snapshots using ((select public.is_owner()));

-- 2. Account days (owner-timezone days, as the sync writes them) summed per account (p_by = 'account') or per time
-- bucket over all given accounts (any other p_by). followers is a level, not a flow: the last value of each account in
-- the bucket, summed over the accounts. Engagement-rate parts only count days that have both reach and interactions.
create or replace function public.explorer_daily(p_accounts uuid[], p_from date, p_to date, p_by text, p_grain text, p_week_start text)
returns table (key text, reach bigint, views bigint, interactions bigint, er_interactions bigint, er_reach bigint, net_follows bigint, followers bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (
    select a.account_id, a.day, a.reach, a.views, a.total_interactions, a.followers, a.follows - a.unfollows as net,
           case when p_by = 'account' then a.account_id::text
                else to_char(case p_grain
                       when 'month' then date_trunc('month', a.day::timestamp)::date
                       when 'week' then a.day - ((extract(dow from a.day)::int - case when p_week_start = 'sun' then 0 else 1 end + 7) % 7)
                       else a.day
                     end, 'YYYY-MM-DD') end as key
      from public.account_daily a
     where a.account_id = any (p_accounts) and a.day between p_from and p_to
  ),
  f as (
    select distinct on (d.key, d.account_id) d.key, d.followers
      from d
     where d.followers is not null
     order by d.key, d.account_id, d.day desc
  )
  select d.key,
         sum(d.reach)::bigint,
         sum(d.views)::bigint,
         sum(d.total_interactions)::bigint,
         (sum(d.total_interactions) filter (where d.reach is not null and d.total_interactions is not null))::bigint,
         (sum(d.reach) filter (where d.reach is not null and d.total_interactions is not null))::bigint,
         sum(d.net)::bigint,
         (select sum(f.followers) from f where f.key = d.key)::bigint
    from d
   group by d.key
   order by d.key
$$;

-- 3. Media published in [p_from, p_to) with their LATEST metrics snapshot (lifetime values) and the owner-timezone day,
-- weekday (0 = Sunday) and hour they were published. Stories only when p_stories. Filters: format, tag or untagged,
-- weekday, hour (null / false = no filter). Captions are cut to 200 characters (the table shows a snippet).
create or replace function public.explorer_media(p_accounts uuid[], p_from timestamptz, p_to timestamptz, p_tz text, p_format text, p_stories boolean, p_tag uuid, p_untagged boolean, p_weekday int, p_hour int)
returns table (id text, account_id uuid, media_type text, posted_at timestamptz, permalink text, caption text, local_day date, weekday int, hour int, reach int, views int, likes int, comments int, saves int, shares int)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.account_id, m.media_type, m.posted_at, m.permalink, left(m.caption, 200),
         l.at::date, extract(dow from l.at)::int, extract(hour from l.at)::int,
         s.reach, s.views, s.likes, s.comments, s.saves, s.shares
    from public.media m
   cross join lateral (select m.posted_at at time zone p_tz as at) l
    left join lateral (
      select x.reach, x.views, x.likes, x.comments, x.saves, x.shares
        from public.media_metrics x
       where x.media_id = m.id
       order by x.captured_at desc
       limit 1
    ) s on true
   where m.account_id = any (p_accounts)
     and m.posted_at >= p_from and m.posted_at < p_to
     and (p_format is null or m.media_type = p_format)
     and (p_stories or m.media_type <> 'STORY')
     and (p_weekday is null or extract(dow from l.at)::int = p_weekday)
     and (p_hour is null or extract(hour from l.at)::int = p_hour)
     and (p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))
     and (not p_untagged or not exists (select 1 from public.media_tags t where t.media_id = m.id))
$$;

-- 4. The media of explorer_media() summed per account, format, tag ('untagged' for none; a post with several tags counts
-- for each), weekday, hour, or time bucket of the publishing day. "measured" = items with reach > 0 (the base of averages,
-- like lib/analysis/posts.ts groupStats); engagement-rate parts never include Stories.
create or replace function public.explorer_posts(p_accounts uuid[], p_from timestamptz, p_to timestamptz, p_tz text, p_format text, p_stories boolean, p_tag uuid, p_untagged boolean, p_weekday int, p_hour int, p_by text, p_grain text, p_week_start text)
returns table (key text, posts bigint, measured bigint, reach_sum bigint, views_sum bigint, views_n bigint, likes bigint, comments bigint, saves bigint, shares bigint, er_interactions bigint, er_reach bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select * from public.explorer_media(p_accounts, p_from, p_to, p_tz, p_format, p_stories, p_tag, p_untagged, p_weekday, p_hour)
  ),
  k as (
    select b.media_type, b.reach, b.views, b.likes, b.comments, b.saves, b.shares,
           case p_by
             when 'account' then b.account_id::text
             when 'format' then b.media_type
             when 'weekday' then b.weekday::text
             when 'hour' then b.hour::text
             else to_char(case p_grain
                    when 'month' then date_trunc('month', b.local_day::timestamp)::date
                    when 'week' then b.local_day - ((extract(dow from b.local_day)::int - case when p_week_start = 'sun' then 0 else 1 end + 7) % 7)
                    else b.local_day
                  end, 'YYYY-MM-DD')
           end as key
      from b
     where p_by <> 'tag'
    union all
    select b.media_type, b.reach, b.views, b.likes, b.comments, b.saves, b.shares, coalesce(t.tag_id::text, 'untagged')
      from b
      left join public.media_tags t on t.media_id = b.id
     where p_by = 'tag'
  )
  select k.key,
         count(*),
         count(*) filter (where k.reach > 0),
         (sum(k.reach) filter (where k.reach > 0))::bigint,
         sum(k.views)::bigint,
         count(k.views),
         sum(k.likes)::bigint,
         sum(k.comments)::bigint,
         sum(k.saves)::bigint,
         sum(k.shares)::bigint,
         (sum(coalesce(k.likes, 0) + coalesce(k.comments, 0) + coalesce(k.saves, 0) + coalesce(k.shares, 0)) filter (where k.reach > 0 and k.media_type <> 'STORY'))::bigint,
         (sum(k.reach) filter (where k.reach > 0 and k.media_type <> 'STORY'))::bigint
    from k
   group by k.key
   order by k.key
$$;

-- 5. Follower curve of one account from follower_snapshots (every sync tick, ~30 min): the last value per owner-timezone
-- hour (p_hourly) or day. Instagram's account insights are daily only: this is the ONLY intraday series we have.
create or replace function public.explorer_followers(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_hourly boolean)
returns table (at text, followers int)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (b.at) to_char(b.at, case when p_hourly then 'YYYY-MM-DD"T"HH24:00' else 'YYYY-MM-DD' end), f.followers
    from public.follower_snapshots f
   cross join lateral (select date_trunc(case when p_hourly then 'hour' else 'day' end, f.captured_at at time zone p_tz) as at) b
   where f.account_id = p_account and f.captured_at >= p_from and f.captured_at < p_to and f.followers is not null
   order by b.at, f.captured_at desc
$$;

revoke execute on function public.explorer_daily(uuid[], date, date, text, text, text) from public, anon;
revoke execute on function public.explorer_media(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int) from public, anon;
revoke execute on function public.explorer_posts(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text) from public, anon;
revoke execute on function public.explorer_followers(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.explorer_daily(uuid[], date, date, text, text, text) to authenticated;
grant execute on function public.explorer_media(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int) to authenticated;
grant execute on function public.explorer_posts(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text) to authenticated;
grant execute on function public.explorer_followers(uuid, timestamptz, timestamptz, text, boolean) to authenticated;

-- 6. Saved Explorer views: owner-authored data (like tags), so the owner session may select/insert/update/delete under
-- RLS. state = the canonical, allow-listed query parameters of the view (re-validated by the app on every read).
create table public.explorer_views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  state      jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index explorer_views_name_lower_key on public.explorer_views (lower(name));
alter table public.explorer_views enable row level security;
create policy explorer_views_owner_all on public.explorer_views
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
revoke all on public.explorer_views from anon;
```

Why `security invoker` and not `definer`: a definer function would bypass RLS and need its own owner check; invoker keeps the existing, tested policies as the only gate. Why `explorer_media` is callable on its own: the reader uses it (with PostgREST `order`/`limit`) for the single-posts list, so the posts list and the post totals can never disagree on which items are in scope.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/explorer-migration.test.ts tests/migrations.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261024000001_explorer.sql tests/explorer-migration.test.ts
git commit -m "feat(db): explorer rollup functions, RLS InitPlan rewrite, saved views table" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Metric + dimension registry and all Explorer i18n keys

**Files:**
- Modify: `lib/metrics.ts` (whole file below), `components/shared/useKpiDelta.ts` (whole file below), `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/explorer-registry.test.ts` (new). `tests/metrics.test.ts` (labels for every registry entry, `formatMetric`, `deltaView`), `tests/messages.test.ts` and every existing test must keep passing unchanged.

**Interfaces:**
- Consumes: `Kpi`, `KpiId` (`lib/analysis/growth.ts`), `lib/format.ts`.
- Produces:
  - `type MetricSource = 'daily' | 'posts'`; `interface DailyParts { reach; views; interactions; erInteractions; erReach; netFollows; followers: number | null }`; `interface PostParts { posts: number; measured: number; reachSum; viewsSum: number | null; viewsN: number; likes; comments; saves; shares; erInteractions; erReach: number | null }`; `interface Parts { daily: DailyParts | null; posts: PostParts | null }`.
  - `type MetricId = KpiId | 'interactions' | 'avgReach' | 'avgViews' | 'likes' | 'comments' | 'saves' | 'shares' | 'postEngagementRate'`; `MetricDef` gains `source` and `value(parts)`; `METRICS: Record<MetricId, MetricDef>` (the six KPI ids keep their order first), `METRIC_IDS`, `isMetricId(v)` (own keys only: `__proto__`, `toString` are rejected).
  - `DIMENSIONS = ['group','account','format','tag','weekday','hour','time','post'] as const`, `type DimensionId`, `isDimensionId(v)`, `supports(metric, by)` (daily metrics: group, account, time only).
  - `formatMetric(id: MetricId, …)`, `deltaView(id: MetricId, …)`, `useKpiDelta()(id: MetricId, k)` — widened from `KpiId`; behaviour for the six KPI ids is unchanged.
  - i18n: `nav.explorer`, `metrics.{interactions,avgReach,avgViews,likes,comments,saves,shares,postEngagementRate}`, and the whole `explorer` namespace used by Tasks 8–12 (no later task edits `messages/*.json`).

- [ ] **Step 1: Write the failing test** — create `tests/explorer-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DIMENSIONS, formatMetric, isDimensionId, isMetricId, METRIC_IDS, METRICS, supports, type Parts } from '@/lib/metrics';
import type { FormatPrefs } from '@/lib/format';

const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
const parts: Parts = {
  daily: { reach: 1000, views: 3000, interactions: 70, erInteractions: 60, erReach: 900, netFollows: -4, followers: 2500 },
  posts: { posts: 4, measured: 3, reachSum: 600, viewsSum: 900, viewsN: 2, likes: 30, comments: 5, saves: 2, shares: 1, erInteractions: 38, erReach: 600 },
};

describe('metric registry (Explorer)', () => {
  it('every metric is keyed by its own id, has a source, and a label in both languages', () => {
    for (const id of METRIC_IDS) {
      expect(METRICS[id].id).toBe(id);
      expect(['daily', 'posts']).toContain(METRICS[id].source);
      expect((en.metrics as Record<string, string>)[id], id).toBeTruthy();
      expect((zh.metrics as Record<string, string>)[id], id).toBeTruthy();
    }
  });

  it('computes each value from the additive parts (ratios guard a zero or missing base)', () => {
    const v = Object.fromEntries(METRIC_IDS.map((id) => [id, METRICS[id].value(parts)]));
    expect(v).toEqual({
      followers: 2500, reach: 1000, views: 3000, engagementRate: 60 / 900, posts: 4, netFollows: -4, interactions: 70,
      avgReach: 200, avgViews: 450, likes: 30, comments: 5, saves: 2, shares: 1, postEngagementRate: 38 / 600,
    });
    const empty: Parts = { daily: null, posts: { ...parts.posts!, measured: 0, viewsN: 0, erReach: null } };
    expect(METRICS.reach.value(empty)).toBeNull();
    expect(METRICS.avgReach.value(empty)).toBeNull();
    expect(METRICS.avgViews.value(empty)).toBeNull();
    expect(METRICS.postEngagementRate.value(empty)).toBeNull();
    expect(METRICS.engagementRate.value({ daily: { ...parts.daily!, erReach: 0 }, posts: null })).toBeNull();
  });

  it('account-day metrics only group by group, account and time; post metrics by everything', () => {
    for (const d of DIMENSIONS) {
      expect(supports('posts', d)).toBe(true);
      expect(supports('reach', d)).toBe(['group', 'account', 'time'].includes(d));
    }
  });

  it('id guards accept only registry entries (no prototype keys, no junk)', () => {
    expect(isMetricId('reach')).toBe(true);
    for (const v of ['toString', '__proto__', 'constructor', 'REACH', '', null, 1]) expect(isMetricId(v)).toBe(false);
    expect(isDimensionId('hour')).toBe(true);
    for (const v of ['day', 'hours', '', undefined]) expect(isDimensionId(v)).toBe(false);
  });

  it('every dimension has a label in both languages', () => {
    for (const d of DIMENSIONS) {
      expect((en.explorer.by as Record<string, string>)[d], d).toBeTruthy();
      expect((zh.explorer.by as Record<string, string>)[d], d).toBeTruthy();
    }
  });

  it('formats new metrics like the old ones', () => {
    expect(formatMetric('avgReach', 1234.5, P)).toBe('1.2K');
    expect(formatMetric('postEngagementRate', 0.0633, P)).toBe('6.3%');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-registry.test.ts`
Expected: FAIL — 6 failed (`TypeError: METRIC_IDS is not iterable`, … the new exports do not exist yet).

- [ ] **Step 3: Replace `lib/metrics.ts`** with:

```ts
// The metrics registry (SPEC §8b.2): one entry per metric drives cards, charts, tables, pickers and the Explorer.
// KPI cards aggregate in lib/analysis/growth.ts (kpis); the Explorer computes `value` from the additive parts that the
// SQL rollups return (supabase/migrations/20261024000001_explorer.sql). A new metric = one entry (+ its `metrics.<id>`
// label); it needs SQL only when no existing part can express it.
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { formatCompact, formatNumber, formatPercent, formatSigned, formatDelta, type FormatPrefs } from '@/lib/format';

export type MetricKind = 'count' | 'percent';
/** 'daily' = account insight days (account_daily); 'posts' = published media with their latest snapshot. */
export type MetricSource = 'daily' | 'posts';

/** Sums over account days (explorer_daily). null = no day in the bucket had a value (never 0). */
export interface DailyParts {
  reach: number | null;
  views: number | null;
  interactions: number | null;
  erInteractions: number | null; // interactions on days that also have reach
  erReach: number | null; // reach on days that also have interactions
  netFollows: number | null;
  followers: number | null; // a level: each account's last value in the bucket, summed
}

/** Sums over published media (explorer_posts). measured = items with reach > 0 (the base of the averages). */
export interface PostParts {
  posts: number;
  measured: number;
  reachSum: number | null;
  viewsSum: number | null;
  viewsN: number;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  erInteractions: number | null; // never includes Stories
  erReach: number | null;
}

export interface Parts {
  daily: DailyParts | null;
  posts: PostParts | null;
}

export type MetricId = KpiId | 'interactions' | 'avgReach' | 'avgViews' | 'likes' | 'comments' | 'saves' | 'shares' | 'postEngagementRate';

export interface MetricDef {
  id: MetricId;
  kind: MetricKind;
  higherIsBetter: boolean; // decides the colour of a change: up is good for reach, would be bad for e.g. unfollows
  source: MetricSource;
  value: (p: Parts) => number | null; // the Explorer value of one row (bucket, account, format, …)
}

const ratio = (a: number | null | undefined, b: number | null | undefined) => (typeof a === 'number' && typeof b === 'number' && b > 0 ? a / b : null);

/** i18n label: `metrics.<id>` in messages/*.json. Order = display order (KPI cards use the first six). */
export const METRICS: Record<MetricId, MetricDef> = {
  followers: { id: 'followers', kind: 'count', higherIsBetter: true, source: 'daily', value: (p) => p.daily?.followers ?? null },
  reach: { id: 'reach', kind: 'count', higherIsBetter: true, source: 'daily', value: (p) => p.daily?.reach ?? null },
  views: { id: 'views', kind: 'count', higherIsBetter: true, source: 'daily', value: (p) => p.daily?.views ?? null },
  engagementRate: { id: 'engagementRate', kind: 'percent', higherIsBetter: true, source: 'daily', value: (p) => ratio(p.daily?.erInteractions, p.daily?.erReach) },
  posts: { id: 'posts', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => p.posts?.posts ?? null },
  netFollows: { id: 'netFollows', kind: 'count', higherIsBetter: true, source: 'daily', value: (p) => p.daily?.netFollows ?? null },
  interactions: { id: 'interactions', kind: 'count', higherIsBetter: true, source: 'daily', value: (p) => p.daily?.interactions ?? null },
  avgReach: { id: 'avgReach', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => ratio(p.posts?.reachSum, p.posts?.measured) },
  avgViews: { id: 'avgViews', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => ratio(p.posts?.viewsSum, p.posts?.viewsN) },
  likes: { id: 'likes', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => p.posts?.likes ?? null },
  comments: { id: 'comments', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => p.posts?.comments ?? null },
  saves: { id: 'saves', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => p.posts?.saves ?? null },
  shares: { id: 'shares', kind: 'count', higherIsBetter: true, source: 'posts', value: (p) => p.posts?.shares ?? null },
  postEngagementRate: { id: 'postEngagementRate', kind: 'percent', higherIsBetter: true, source: 'posts', value: (p) => ratio(p.posts?.erInteractions, p.posts?.erReach) },
};

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];
export const isMetricId = (v: unknown): v is MetricId => typeof v === 'string' && Object.hasOwn(METRICS, v);

/**
 * Explorer group-by dimensions. i18n label: `explorer.by.<id>`. 'time' buckets by the Time Scope granularity
 * (day / week / month); 'post' lists single items.
 */
export const DIMENSIONS = ['group', 'account', 'format', 'tag', 'weekday', 'hour', 'time', 'post'] as const;
export type DimensionId = (typeof DIMENSIONS)[number];
export const isDimensionId = (v: unknown): v is DimensionId => typeof v === 'string' && (DIMENSIONS as readonly string[]).includes(v);

/** Account insights are daily totals per account: they have no format, tag, publishing weekday/hour or single post. */
const DAILY_DIMENSIONS: readonly DimensionId[] = ['group', 'account', 'time'];
export const supports = (id: MetricId, by: DimensionId): boolean => METRICS[id].source === 'posts' || DAILY_DIMENSIONS.includes(by);

/** The headline value. Counts are compact (12.3K) unless `full`; percents keep one decimal. */
export function formatMetric(id: MetricId, value: number | null, p: FormatPrefs, opts: { full?: boolean } = {}): string {
  if (METRICS[id].kind === 'percent') return formatPercent(value, p);
  return opts.full ? formatNumber(value, p, { maximumFractionDigits: 0 }) : formatCompact(value, p);
}

export interface DeltaView {
  text: string; // "+12.5%", "+40" or "+0.4" (points; the UI adds the translated "pp" unit)
  unit: 'relative' | 'absolute' | 'points';
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
}

/**
 * How a KPI's comparison is shown. Percent metrics change in percentage points; counts change relatively, or
 * absolutely when the previous value was 0 (no meaningful %). Null when there is nothing to compare.
 */
export function deltaView(id: MetricId, k: Kpi, p: FormatPrefs): DeltaView | null {
  if (k.diff === null) return null;
  const def = METRICS[id];
  const points = def.kind === 'percent';
  const shown = points ? Number((k.diff * 100).toFixed(1)) : k.change !== null ? Number((k.change * 100).toFixed(1)) : Math.round(k.diff);
  const direction = shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat';
  const tone = direction === 'flat' ? 'neutral' : (direction === 'up') === def.higherIsBetter ? 'good' : 'bad';
  if (points) return { text: formatSigned(k.diff * 100, p, 1), unit: 'points', direction, tone };
  if (k.change !== null) return { text: formatDelta(k.change, p), unit: 'relative', direction, tone };
  return { text: formatSigned(k.diff, p), unit: 'absolute', direction, tone };
}
```

- [ ] **Step 4: Replace `components/shared/useKpiDelta.ts`** with:

```ts
'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import type { StatDelta } from '@/components/shared/StatCard';
import type { Kpi } from '@/lib/analysis/growth';
import { deltaView, type MetricId } from '@/lib/metrics';

/** KPI → what StatCard/DeltaPill show; percentage points get their translated unit. Any registry metric (Explorer too). */
export function useKpiDelta() {
  const t = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  return (id: MetricId, k: Kpi | undefined): StatDelta | null => {
    const d = k ? deltaView(id, k, prefs) : null;
    return d && { ...d, text: d.unit === 'points' ? t('points', { value: d.text }) : d.text };
  };
}
```

- [ ] **Step 5: Add the i18n keys** — merge into `messages/en.json` (keys `nav` and `metrics` exist: add to them; `explorer` is a new top-level key after `export`; 12a's `timeScope` stays as it is):

```json
{
  "nav": {
    "explorer": "Explorer"
  },
  "metrics": {
    "interactions": "Interactions",
    "avgReach": "Avg reach per post",
    "avgViews": "Avg views per post",
    "likes": "Likes",
    "comments": "Comments",
    "saves": "Saves",
    "shares": "Shares",
    "postEngagementRate": "Post engagement"
  },
  "explorer": {
    "by": {
      "group": "Group",
      "account": "Account",
      "format": "Format",
      "tag": "Tag",
      "weekday": "Weekday",
      "hour": "Hour posted",
      "time": "Over time",
      "post": "Single posts"
    },
    "item": {
      "notFound": "This post is not in your connected accounts.",
      "posted": "Published {time}",
      "measured": "last measured {time}",
      "notMeasured": "not measured yet",
      "openInstagram": "Open on Instagram",
      "openTab": "Open in {tab}",
      "numbers": "Latest numbers",
      "followersTitle": "Followers around this post",
      "followersHint": "Follower count from every sync (about every 30 minutes), last value per hour. Instagram reports reach and views only per day, so there is no hourly reach.",
      "followersSummary": "Follower count per hour from {from} to {to}.",
      "followersEmpty": "No follower snapshots for these days yet.",
      "audienceTitle": "Who saw {format} that day",
      "audienceHint": "All {format} reach of @{username} on {day}, split by followers. Instagram does not split a single post's reach.",
      "follower": "Followers",
      "nonFollower": "Non-followers",
      "audienceEmpty": "No follower breakdown for that day yet."
    },
    "views": {
      "title": "Saved views",
      "empty": "No saved views yet. Save the current settings to come back to them in one click.",
      "save": "Save view",
      "saveTitle": "Save this view",
      "saveHint": "Saves the metrics, grouping, filters and time range. A preset such as “Last 30 days” keeps moving with today; fixed dates stay fixed.",
      "name": "Name",
      "cancel": "Cancel",
      "confirm": "Save",
      "renameTitle": "Rename view",
      "renameNamed": "Rename {name}",
      "delete": "Delete",
      "deleteNamed": "Delete {name}",
      "deleteTitle": "Delete “{name}”?",
      "deleteBody": "Only the saved view is removed. Your data stays as it is.",
      "errors": {
        "invalid_name": "Use 1–60 characters.",
        "invalid_state": "This view cannot be saved. Reload the page and try again.",
        "duplicate": "A view with this name already exists.",
        "not_found": "This view no longer exists.",
        "too_many": "You can keep up to 50 views. Delete one first.",
        "unexpected": "Something went wrong. Try again."
      }
    },
    "untagged": "Untagged",
    "deletedTag": "Deleted tag",
    "weekOf": "Week of {day}",
    "title": "Explorer",
    "previous": "{metric} (previous)",
    "subtitle": "Pick metrics, group them, and click any bar or row to go one level deeper",
    "controls": "Explorer settings",
    "groupBy": "Break down by",
    "metrics": "Metrics",
    "metricsHint": "up to {max}",
    "accountTotalsHint": "Followers, reach, views, interactions, net follows and engagement are daily account totals: they group by group, account or time only and cannot be narrowed to a format, tag, weekday or hour.",
    "chartMetric": "Chart",
    "accounts": "Accounts",
    "accountsPicked": "{count, plural, one {# account picked} other {# accounts picked}}",
    "allAccounts": "All accounts",
    "group": "Group",
    "anyGroup": "All groups",
    "format": "Format",
    "anyFormat": "Posts and Reels",
    "tag": "Tag",
    "anyTag": "Any tag",
    "weekday": "Weekday posted",
    "hour": "Hour posted",
    "any": "Any",
    "apply": "Apply",
    "reset": "Reset",
    "breadcrumb": "Drill-down path",
    "crumbs": {
      "all": "All accounts",
      "item": "Post"
    },
    "drill": "Show {name} in detail",
    "removeFilter": "Remove filter {name}",
    "publishedHint": "Weekday and hour are when each post was published, in your timezone. Instagram reports reach and views only per day, so there is no hourly reach.",
    "chartTitle": "{metric} by {by}",
    "drillHint": "Click a bar or a row to go one level deeper.",
    "chartSummary": "{metric} for {count} rows. The table below lists the same rows.",
    "truncated": "Showing the newest {count} posts in this range. Narrow the range to see older ones.",
    "tableCaption": "Explorer results",
    "empty": "No data for this selection. Widen the range or remove a filter.",
    "partial": "* The range cuts this period, so it holds fewer days.",
    "export": "Export view",
    "window": "Data from {from} to {to}",
    "windowCompare": "compared with {from} to {to}",
    "exploreMetric": "Explore {metric} in the Explorer",
    "openAccount": "Open {name}"
  }
}
```

and into `messages/zh-CN.json`:

```json
{
  "nav": {
    "explorer": "探索"
  },
  "metrics": {
    "interactions": "互动次数",
    "avgReach": "每帖平均触达",
    "avgViews": "每帖平均浏览量",
    "likes": "点赞",
    "comments": "评论",
    "saves": "收藏",
    "shares": "分享",
    "postEngagementRate": "帖子互动率"
  },
  "explorer": {
    "by": {
      "group": "分组",
      "account": "账号",
      "format": "形式",
      "tag": "标签",
      "weekday": "星期",
      "hour": "发布时段",
      "time": "按时间",
      "post": "单篇帖子"
    },
    "item": {
      "notFound": "这篇帖子不属于你已连接的账号。",
      "posted": "发布于 {time}",
      "measured": "最后统计于 {time}",
      "notMeasured": "尚未统计",
      "openInstagram": "在 Instagram 中打开",
      "openTab": "在{tab}中打开",
      "numbers": "最新数据",
      "followersTitle": "这篇帖子前后的粉丝数",
      "followersHint": "每次同步（约每 30 分钟）记录的粉丝数，每小时取最后一个值。Instagram 的触达和浏览量只按天提供，因此没有每小时触达。",
      "followersSummary": "{from} 至 {to} 每小时的粉丝数。",
      "followersEmpty": "这几天还没有粉丝数快照。",
      "audienceTitle": "当天谁看到了{format}",
      "audienceHint": "@{username} 在 {day} 的全部{format}触达，按是否为粉丝拆分。Instagram 不提供单篇帖子的触达拆分。",
      "follower": "粉丝",
      "nonFollower": "非粉丝",
      "audienceEmpty": "当天还没有粉丝拆分数据。"
    },
    "views": {
      "title": "已保存的视图",
      "empty": "还没有保存的视图。保存当前设置，以后一键回到这里。",
      "save": "保存视图",
      "saveTitle": "保存此视图",
      "saveHint": "会保存指标、分组、筛选条件和时间范围。“最近 30 天”这类预设会随今天移动；固定日期保持不变。",
      "name": "名称",
      "cancel": "取消",
      "confirm": "保存",
      "renameTitle": "重命名视图",
      "renameNamed": "重命名 {name}",
      "delete": "删除",
      "deleteNamed": "删除 {name}",
      "deleteTitle": "删除“{name}”？",
      "deleteBody": "只会删除这个已保存的视图，你的数据不受影响。",
      "errors": {
        "invalid_name": "请使用 1–60 个字符。",
        "invalid_state": "无法保存此视图。请刷新页面后重试。",
        "duplicate": "已有同名视图。",
        "not_found": "此视图已不存在。",
        "too_many": "最多可保存 50 个视图。请先删除一个。",
        "unexpected": "出了点问题，请重试。"
      }
    },
    "untagged": "未加标签",
    "deletedTag": "已删除的标签",
    "weekOf": "{day} 起的一周",
    "title": "探索",
    "previous": "{metric}（之前）",
    "subtitle": "选择指标并分组，点击任意柱形或行即可深入下一层",
    "controls": "探索设置",
    "groupBy": "拆分依据",
    "metrics": "指标",
    "metricsHint": "最多 {max} 个",
    "accountTotalsHint": "粉丝、触达、浏览量、互动次数、净增粉丝和互动率是账号的每日总数：只能按分组、账号或时间分组，不能按形式、标签、星期或时段筛选。",
    "chartMetric": "图表",
    "accounts": "账号",
    "accountsPicked": "{count, plural, other {已选 # 个账号}}",
    "allAccounts": "全部账号",
    "group": "分组",
    "anyGroup": "全部分组",
    "format": "形式",
    "anyFormat": "帖子和 Reels",
    "tag": "标签",
    "anyTag": "任意标签",
    "weekday": "发布星期",
    "hour": "发布时段",
    "any": "不限",
    "apply": "应用",
    "reset": "重置",
    "breadcrumb": "深入路径",
    "crumbs": {
      "all": "全部账号",
      "item": "帖子"
    },
    "drill": "查看 {name} 的详情",
    "removeFilter": "移除筛选条件 {name}",
    "publishedHint": "星期和时段指每篇帖子的发布时间（你的时区）。Instagram 的触达和浏览量只按天提供，因此没有每小时触达。",
    "chartTitle": "按{by}查看{metric}",
    "drillHint": "点击柱形或行即可深入下一层。",
    "chartSummary": "{count} 行的{metric}。下表列出相同的行。",
    "truncated": "显示此范围内最新的 {count} 篇帖子。缩小范围可查看更早的帖子。",
    "tableCaption": "探索结果",
    "empty": "此选择没有数据。请扩大范围或移除筛选条件。",
    "partial": "* 范围截断了这个时段，因此它包含的天数较少。",
    "export": "导出视图",
    "window": "数据范围：{from} 至 {to}",
    "windowCompare": "对比 {from} 至 {to}",
    "exploreMetric": "在探索中查看{metric}",
    "openAccount": "打开 {name}"
  }
}
```

`explorer.groupBy` is "Break down by" on purpose: 12a's granularity select is labelled "Group by" and both sit on the Explorer page.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/explorer-registry.test.ts tests/metrics.test.ts tests/messages.test.ts` and `npx tsc --noEmit`
Expected: PASS (3 files); typecheck clean (every existing `KpiId` caller still compiles: `KpiId` ⊂ `MetricId`).

- [ ] **Step 7: Commit**

```bash
git add lib/metrics.ts components/shared/useKpiDelta.ts messages/en.json messages/zh-CN.json tests/explorer-registry.test.ts
git commit -m "feat(metrics): explorer metric + dimension registry, explorer i18n" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Explorer URL state (`lib/explorer/state.ts`)

**Files:**
- Create: `lib/explorer/state.ts`
- Test: `tests/explorer-state.test.ts` (new)

**Interfaces:**
- Consumes: `isMetricId`, `isDimensionId`, `supports`, `MetricId`, `DimensionId` (Task 2); `normalizeGroup` (`lib/accounts/group.ts`); `isUuid`, `isMediaId` (`lib/tags.ts`); `MediaKind` (`lib/instagram/parse.ts`).
- Produces:
  - `MAX_METRICS = 4`, `MAX_ACCOUNTS = 20`, `FORMATS: readonly MediaKind[]` (`['REELS','CAROUSEL_ALBUM','IMAGE','STORY']`), `EXPLORER_KEYS = ['m','chart','by','acc','grp','fmt','tag','wd','hr','item'] as const`.
  - `interface ExplorerState { metrics: MetricId[]; chart: MetricId; by: DimensionId; accounts: string[]; group: string | null; format: MediaKind | null; tag: string | null; weekday: number | null; hour: number | null; item: string | null }`.
  - `usable(id, f: Pick<ExplorerState, 'by' | 'format' | 'tag' | 'weekday' | 'hour'>): boolean` — the dimension supports the metric AND account totals are not narrowed by a format/tag/weekday/hour filter (Instagram reports them per account and day only); `defaultMetrics(f): MetricId[]`.
  - `parseExplorerState(sp: Record<string, string | string[] | undefined>): ExplorerState` (never throws; a repeated key counts as missing), `explorerParams(s): URLSearchParams` (canonical, fixed key order, defaults omitted), `withState(s, patch): ExplorerState` (re-applies `usable`), `explorerHref(s, scopeQuery: string): string` (`/explorer?<state>&<scope>`; `scopeQuery` = 12a's `ResolvedScope.query`).
  - None of these keys collide with the Time Scope keys of 12a (`SCOPE_KEYS` = `from, to, cmp, cfrom, cto, gran, week, month, quarter, period`). This module does not import 12a.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { explorerHref, explorerParams, MAX_ACCOUNTS, parseExplorerState, usable, withState } from '@/lib/explorer/state';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('parseExplorerState', () => {
  it('nothing in the URL: accounts compared on account totals', () => {
    expect(parseExplorerState({})).toEqual({ metrics: ['reach', 'engagementRate', 'posts', 'avgReach'], chart: 'reach', by: 'account', accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
  });

  it('keeps valid values in the given order, drops duplicates, caps metrics at 4', () => {
    const s = parseExplorerState({ m: 'likes,reach,likes,shares,views', chart: 'shares', by: 'time', acc: `${A.toUpperCase()},${B},${A}`, grp: 'Food', item: '17895695668004550' });
    expect(s).toEqual({ metrics: ['likes', 'reach', 'shares', 'views'], chart: 'shares', by: 'time', accounts: [A, B], group: 'Food', format: null, tag: null, weekday: null, hour: null, item: '17895695668004550' });
    const f = parseExplorerState({ m: 'likes,saves,comments,shares,posts', by: 'hour', fmt: 'REELS', tag: B, wd: '3', hr: '20' });
    expect(f).toMatchObject({ metrics: ['likes', 'saves', 'comments', 'shares'], format: 'REELS', tag: B, weekday: 3, hour: 20 });
  });

  it('metrics the dimension cannot show are dropped (account totals have no format); none left = the defaults', () => {
    expect(parseExplorerState({ m: 'reach,likes', by: 'format' }).metrics).toEqual(['likes']);
    expect(parseExplorerState({ m: 'reach,views', by: 'hour' }).metrics).toEqual(['posts', 'avgReach', 'postEngagementRate']);
  });

  it('a format, tag, weekday or hour filter also drops account totals (they cannot be narrowed to content)', () => {
    expect(parseExplorerState({ m: 'reach,likes', by: 'account', fmt: 'REELS' }).metrics).toEqual(['likes']);
    expect(parseExplorerState({ m: 'reach', by: 'time', tag: 'untagged' }).metrics).toEqual(['posts', 'avgReach', 'postEngagementRate']);
    expect(parseExplorerState({ m: 'reach,likes', by: 'account', hr: '9' }).metrics).toEqual(['likes']);
    expect(usable('reach', { by: 'account', format: null, tag: null, weekday: null, hour: null })).toBe(true);
    expect(usable('reach', { by: 'account', format: null, tag: null, weekday: 0, hour: null })).toBe(false);
  });

  it('hostile or malformed values fall back per part and never throw', () => {
    const s = parseExplorerState({
      m: ['reach', 'posts'], by: 'drop table', chart: 'toString', acc: `x,${"'; select 1 --"},${A}`, grp: ' Food ', fmt: 'reels',
      tag: '../etc', wd: '7', hr: '-1', item: 'a/b',
    });
    expect(s).toEqual({ metrics: ['reach', 'engagementRate', 'posts', 'avgReach'], chart: 'reach', by: 'account', accounts: [A], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
    expect(parseExplorerState({ wd: '03', hr: '024', tag: 'untagged', m: '__proto__,constructor' })).toMatchObject({ weekday: 3, hour: null, tag: 'untagged', metrics: ['posts', 'avgReach', 'postEngagementRate'] });
  });

  it('caps the account list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(parseExplorerState({ acc: many.join(',') }).accounts).toHaveLength(MAX_ACCOUNTS);
  });
});

describe('explorerParams', () => {
  it('round-trips and omits defaults (chart = first metric, empty filters)', () => {
    const s = parseExplorerState({ m: 'posts,likes', by: 'tag', tag: 'untagged', wd: '0' });
    expect(explorerParams(s).toString()).toBe('m=posts%2Clikes&by=tag&tag=untagged&wd=0');
    expect(parseExplorerState(Object.fromEntries(explorerParams(s)))).toEqual(s);
    const full = parseExplorerState({ m: 'likes,reach', chart: 'reach', by: 'time', acc: `${A},${B}`, grp: 'Food & Co', fmt: 'STORY', hr: '9', item: '42' });
    expect(parseExplorerState(Object.fromEntries(explorerParams(full)))).toEqual(full);
  });
});

describe('explorerHref', () => {
  it('appends the Time Scope query when there is one', () => {
    const s = parseExplorerState({ m: 'posts', by: 'hour' });
    expect(explorerHref(s, '')).toBe('/explorer?m=posts&by=hour');
    expect(explorerHref(s, 'from=90d&cmp=yoy')).toBe('/explorer?m=posts&by=hour&from=90d&cmp=yoy');
  });
});

describe('withState', () => {
  it('changing the dimension drops metrics it cannot show and keeps the chart metric when possible', () => {
    const s = parseExplorerState({ m: 'reach,likes,posts', chart: 'likes', by: 'account' });
    expect(withState(s, { by: 'format' })).toMatchObject({ by: 'format', metrics: ['likes', 'posts'], chart: 'likes' });
    expect(withState(parseExplorerState({ m: 'reach', by: 'time' }), { by: 'hour' })).toMatchObject({ metrics: ['posts', 'avgReach', 'postEngagementRate'], chart: 'posts' });
    expect(withState(parseExplorerState({ m: 'reach,likes' }), { format: 'REELS' }).metrics).toEqual(['likes']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-state.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/explorer/state"`.

- [ ] **Step 3: Write `lib/explorer/state.ts`**

```ts
// Explorer URL state (`/explorer?m=…&by=…&…`). Every value comes from a URL or a saved view, so everything is
// allow-listed: unknown, repeated or hostile values fall back to the default for that part (never echoed, never thrown).
// The Time Scope keys (from/to/cmp/cfrom/cto/gran, Plan 12a) are NOT parsed here: lib/time-scope owns them.
import { normalizeGroup } from '@/lib/accounts/group';
import type { MediaKind } from '@/lib/instagram/parse';
import { isDimensionId, isMetricId, METRICS, supports, type DimensionId, type MetricId } from '@/lib/metrics';
import { isMediaId, isUuid } from '@/lib/tags';

export const MAX_METRICS = 4;
export const MAX_ACCOUNTS = 20;
export const FORMATS: readonly MediaKind[] = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'];
/** The query keys this module owns (saved views keep only these plus the Time Scope keys). */
export const EXPLORER_KEYS = ['m', 'chart', 'by', 'acc', 'grp', 'fmt', 'tag', 'wd', 'hr', 'item'] as const;

export interface ExplorerState {
  metrics: MetricId[]; // m=reach,posts — order kept, duplicates and metrics the dimension cannot show dropped, ≤ 4
  chart: MetricId; // chart= — the metric drawn in the chart; one of `metrics`
  by: DimensionId; // by=
  accounts: string[]; // acc=<uuid>,<uuid> — empty = every live account (≤ 20)
  group: string | null; // grp=<group name>
  format: MediaKind | null; // fmt=REELS|CAROUSEL_ALBUM|IMAGE|STORY
  tag: string | null; // tag=<uuid> | untagged
  weekday: number | null; // wd=0..6 (0 = Sunday, owner timezone)
  hour: number | null; // hr=0..23 (owner timezone)
  item: string | null; // item=<media id> — the single-item level
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);

type Filters = Pick<ExplorerState, 'by' | 'format' | 'tag' | 'weekday' | 'hour'>;
const contentFiltered = (f: Filters) => f.format !== null || f.tag !== null || f.weekday !== null || f.hour !== null;

/**
 * Whether a metric can be shown: the dimension must support it, and account totals (daily metrics) cannot be narrowed
 * to a format, tag, weekday or hour — Instagram reports them per account and day only.
 */
export function usable(id: MetricId, f: Filters): boolean {
  return supports(id, f.by) && (METRICS[id].source === 'posts' || !contentFiltered(f));
}

/** Defaults when the URL names no usable metric: account totals where allowed, post numbers otherwise. */
export function defaultMetrics(f: Filters): MetricId[] {
  return usable('reach', f) ? ['reach', 'engagementRate', 'posts', 'avgReach'] : ['posts', 'avgReach', 'postEngagementRate'];
}

function intIn(v: string | null, min: number, max: number): number | null {
  if (v === null || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export function parseExplorerState(sp: Params): ExplorerState {
  const g = normalizeGroup(one(sp.grp) ?? undefined);
  const fmt = one(sp.fmt);
  const tag = one(sp.tag);
  const item = one(sp.item);
  const base = {
    by: isDimensionId(one(sp.by)) ? (one(sp.by) as DimensionId) : 'account',
    accounts: [...new Set((one(sp.acc) ?? '').split(',').filter(isUuid).map((id) => id.toLowerCase()))].slice(0, MAX_ACCOUNTS),
    group: g.ok && g.value !== null && g.value === one(sp.grp) ? g.value : null, // only an exact, already-normal name
    format: fmt && (FORMATS as readonly string[]).includes(fmt) ? (fmt as MediaKind) : null,
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    weekday: intIn(one(sp.wd), 0, 6),
    hour: intIn(one(sp.hr), 0, 23),
    item: isMediaId(item) ? item : null,
  } satisfies Omit<ExplorerState, 'metrics' | 'chart'>;
  const asked = (one(sp.m) ?? '').split(',').filter(isMetricId).filter((id) => usable(id, base));
  const metrics = asked.length ? [...new Set(asked)].slice(0, MAX_METRICS) : defaultMetrics(base);
  const chart = one(sp.chart);
  return { metrics, chart: isMetricId(chart) && metrics.includes(chart) ? chart : metrics[0], ...base };
}

/** Canonical query of a state, in a fixed key order (links, saved views and the export all use this). */
export function explorerParams(s: ExplorerState): URLSearchParams {
  const q = new URLSearchParams();
  q.set('m', s.metrics.join(','));
  if (s.chart !== s.metrics[0]) q.set('chart', s.chart);
  q.set('by', s.by);
  if (s.accounts.length) q.set('acc', s.accounts.join(','));
  if (s.group !== null) q.set('grp', s.group);
  if (s.format !== null) q.set('fmt', s.format);
  if (s.tag !== null) q.set('tag', s.tag);
  if (s.weekday !== null) q.set('wd', String(s.weekday));
  if (s.hour !== null) q.set('hr', String(s.hour));
  if (s.item !== null) q.set('item', s.item);
  return q;
}

/** A new state with some parts changed: metrics it cannot show are dropped, the chart metric follows. */
export function withState(s: ExplorerState, patch: Partial<ExplorerState>): ExplorerState {
  const next = { ...s, ...patch };
  const kept = next.metrics.filter((id) => usable(id, next));
  const metrics = kept.length ? kept : defaultMetrics(next);
  return { ...next, metrics, chart: metrics.includes(next.chart) ? next.chart : metrics[0] };
}

/** `/explorer?<state>&<scope>`: `scopeQuery` is the Time Scope's canonical query (ResolvedScope.query, '' = default). */
export function explorerHref(s: ExplorerState, scopeQuery: string): string {
  return `/explorer?${explorerParams(s)}${scopeQuery ? `&${scopeQuery}` : ''}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/explorer-state.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/explorer/state.ts tests/explorer-state.test.ts
git commit -m "feat(explorer): allow-listed URL state (metrics, group-by, filters, item)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rollup reader (`lib/explorer/read.ts`)

**Files:**
- Create: `lib/explorer/read.ts`
- Test: `tests/explorer-read.test.ts` (new)

**Interfaces:**
- Consumes: the four functions of Task 1 (via `db.rpc`), `ExplorerState` (Task 3), `METRICS`, `Parts` (Task 2), `safeLink` (`lib/dashboard/read.ts`), `addDays`, `dayStart` (`lib/sync/time.ts`), `WeekStart`, `MediaKind`.
- Produces:
  - `ITEM_LIMIT = 500`, `type Grain = 'day' | 'week' | 'month'` (same values as 12a's `Granularity`).
  - `interface RollupQuery { accounts: string[]; from: string; to: string; tz: string; weekStart: WeekStart; grain: Grain }` — days inclusive, owner timezone.
  - `interface ItemRow { id; accountId; mediaType: MediaKind; postedAt; permalink: string | null; caption: string | null; reach; views; likes; comments; saves; shares: number | null }`.
  - `rollupArgs(s, q): { daily: object | null; posts: object | null; media: object }` (pure, the exact RPC arguments), `loadRollup(db, s, q): Promise<Map<string, Parts>>`, `loadItems(db, s, q): Promise<{ items: ItemRow[]; truncated: boolean }>`.
  - Errors: `explorer read: daily|posts|items failed` (fixed text). The first captured day comes from 12a's `loadFirstDay` (Task 10 uses it), not from here.

How a state maps to SQL (no other path exists): metrics with source `daily` → `explorer_daily` with `p_by = 'account'` (also for groups, summed in Task 5) or `'time'`; metrics with source `posts` → `explorer_posts` with `p_by` = the dimension (`'account'` for groups); `by = 'post'` → `explorer_media` + PostgREST `order(posted_at desc).limit(501)`. Post bounds are the owner-timezone day starts (`dayStart`), so a post at 23:30 local time belongs to that local day. Stories are passed only when the format filter is Stories or the dimension is format.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_LIMIT, loadItems, loadRollup, rollupArgs, type RollupQuery } from '@/lib/explorer/read';
import { parseExplorerState } from '@/lib/explorer/state';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const Q: RollupQuery = { accounts: [A], from: '2026-10-01', to: '2026-10-31', tz: 'Asia/Kuala_Lumpur', weekStart: 'mon', grain: 'week' };

/** Owner-session fake: records rpc calls and chained modifiers; resolves to the queued result per rpc name. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = [];
  const db = {
    rpc(name: string, args: unknown) {
      calls.push(['rpc', name, args]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe('rollupArgs: every state maps to fixed RPC arguments', () => {
  it('account totals + post numbers by account: both rollups, owner-timezone instants for posts, Stories excluded', () => {
    const a = rollupArgs(parseExplorerState({ m: 'reach,posts', by: 'account' }), Q);
    expect(a.daily).toEqual({ p_accounts: [A], p_from: '2026-10-01', p_to: '2026-10-31', p_by: 'account', p_grain: 'week', p_week_start: 'mon' });
    expect(a.posts).toEqual({
      p_accounts: [A], p_from: '2026-09-30T16:00:00.000Z', p_to: '2026-10-31T16:00:00.000Z', p_tz: 'Asia/Kuala_Lumpur', p_format: null, p_stories: false,
      p_tag: null, p_untagged: false, p_weekday: null, p_hour: null, p_by: 'account', p_grain: 'week', p_week_start: 'mon',
    });
  });

  it('groups are read per account (summed later); time uses the grain; only the needed rollup is called', () => {
    expect(rollupArgs(parseExplorerState({ m: 'reach', by: 'group' }), Q)).toMatchObject({ daily: { p_by: 'account' }, posts: null });
    expect(rollupArgs(parseExplorerState({ m: 'reach', by: 'time' }), Q)).toMatchObject({ daily: { p_by: 'time', p_grain: 'week' }, posts: null });
    expect(rollupArgs(parseExplorerState({ m: 'likes', by: 'time' }), Q)).toMatchObject({ daily: null, posts: { p_by: 'time' } });
  });

  it('filters become typed arguments; Stories only when chosen or grouped by format; untagged is a flag', () => {
    expect(rollupArgs(parseExplorerState({ m: 'posts', by: 'hour', fmt: 'STORY', tag: T, wd: '2' }), Q).posts).toMatchObject({ p_format: 'STORY', p_stories: true, p_tag: T, p_untagged: false, p_weekday: 2, p_hour: null, p_by: 'hour' });
    expect(rollupArgs(parseExplorerState({ m: 'posts', by: 'format', tag: 'untagged' }), Q).posts).toMatchObject({ p_format: null, p_stories: true, p_tag: null, p_untagged: true });
  });

  it('single posts read no rollup at all', () => {
    expect(rollupArgs(parseExplorerState({ by: 'post' }), Q)).toMatchObject({ daily: null, posts: null });
  });
});

describe('loadRollup', () => {
  it('merges both rollups by key into additive parts (nulls stay null, counts default to 0)', async () => {
    const { db, calls } = fakeDb({
      explorer_daily: { data: [{ key: A, reach: 100, views: 200, interactions: 10, er_interactions: 9, er_reach: 90, net_follows: null, followers: 1500 }], error: null },
      explorer_posts: { data: [{ key: A, posts: 3, measured: 2, reach_sum: 400, views_sum: null, views_n: 0, likes: 7, comments: null, saves: 1, shares: 0, er_interactions: 8, er_reach: 400 }], error: null },
    });
    const out = await loadRollup(db, parseExplorerState({ m: 'reach,posts', by: 'account' }), Q);
    expect(calls.map((c) => c[1])).toEqual(['explorer_daily', 'explorer_posts']);
    expect(out.get(A)).toEqual({
      daily: { reach: 100, views: 200, interactions: 10, erInteractions: 9, erReach: 90, netFollows: null, followers: 1500 },
      posts: { posts: 3, measured: 2, reachSum: 400, viewsSum: null, viewsN: 0, likes: 7, comments: null, saves: 1, shares: 0, erInteractions: 8, erReach: 400 },
    });
  });

  it('no accounts in scope: no query at all', async () => {
    const { db, calls } = fakeDb({});
    expect((await loadRollup(db, parseExplorerState({}), { ...Q, accounts: [] })).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('a failed rollup throws a fixed message (never the database text)', async () => {
    const { db } = fakeDb({ explorer_posts: { data: null, error: { message: 'secret detail' } } });
    await expect(loadRollup(db, parseExplorerState({ m: 'posts' }), Q)).rejects.toThrow('explorer read: posts failed');
  });
});

describe('loadItems', () => {
  it('reads the newest ITEM_LIMIT + 1 through explorer_media and reports the cut; keeps https permalinks only', async () => {
    const rows = Array.from({ length: ITEM_LIMIT + 1 }, (_, i) => ({ id: `m${i}`, account_id: A, media_type: 'REELS', posted_at: '2026-10-05T01:00:00Z', permalink: i === 0 ? 'javascript:alert(1)' : 'https://www.instagram.com/p/x/', caption: 'c', reach: 1, views: null, likes: 0, comments: 0, saves: 0, shares: 0 }));
    const { db, calls } = fakeDb({ explorer_media: { data: rows, error: null } });
    const r = await loadItems(db, parseExplorerState({ by: 'post', fmt: 'REELS' }), Q);
    expect(calls[0]).toEqual(['rpc', 'explorer_media', expect.objectContaining({ p_format: 'REELS', p_stories: false })]);
    expect(calls).toContainEqual(['order', 'posted_at', { ascending: false }]);
    expect(calls).toContainEqual(['limit', ITEM_LIMIT + 1]);
    expect(r.truncated).toBe(true);
    expect(r.items).toHaveLength(ITEM_LIMIT);
    expect(r.items[0].permalink).toBeNull();
    expect(r.items[1].permalink).toBe('https://www.instagram.com/p/x/');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-read.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/explorer/read"`.

- [ ] **Step 3: Write `lib/explorer/read.ts`**

```ts
// Explorer reads. OWNER SESSION client only: the SQL functions are `security invoker`, so RLS decides what comes back.
// Never the admin client. Every ExplorerState maps to fixed RPCs with typed arguments (rollupArgs): nothing from the URL
// reaches SQL as text. Fixed error messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeLink } from '@/lib/dashboard/read';
import type { ExplorerState } from '@/lib/explorer/state';
import type { MediaKind } from '@/lib/instagram/parse';
import { METRICS, type Parts } from '@/lib/metrics';
import type { WeekStart } from '@/lib/prefs';
import { addDays, dayStart } from '@/lib/sync/time';

/** Single posts are the newest ITEM_LIMIT in the range; one more is read to know whether the list was cut. */
export const ITEM_LIMIT = 500;

export type Grain = 'day' | 'week' | 'month';

export interface RollupQuery {
  accounts: string[]; // live account ids in scope (resolved by the page from the state's account/group filters)
  from: string; // first owner-timezone day, inclusive ('YYYY-MM-DD')
  to: string; // last owner-timezone day, inclusive
  tz: string; // the owner's timezone (prefs; the sync writes days in it too)
  weekStart: WeekStart;
  grain: Grain; // bucket size when grouping by time (the Time Scope's effective granularity)
}

export interface ItemRow {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string;
  permalink: string | null;
  caption: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`explorer read: ${op} failed`);
}

/** The arguments of explorer_media (shared by the post rollup and the single-posts list). */
function mediaArgs(s: ExplorerState, q: RollupQuery) {
  return {
    p_accounts: q.accounts,
    p_from: dayStart(q.from, q.tz).toISOString(),
    p_to: dayStart(addDays(q.to, 1), q.tz).toISOString(),
    p_tz: q.tz,
    p_format: s.format,
    p_stories: s.format === 'STORY' || s.by === 'format',
    p_tag: s.tag !== null && s.tag !== 'untagged' ? s.tag : null,
    p_untagged: s.tag === 'untagged',
    p_weekday: s.weekday,
    p_hour: s.hour,
  };
}

/** Which RPCs a state needs, with their exact arguments. Pure: the tests pin the mapping. */
export function rollupArgs(s: ExplorerState, q: RollupQuery) {
  const sources = new Set(s.metrics.map((id) => METRICS[id].source));
  const sqlBy = s.by === 'group' ? 'account' : s.by; // groups are summed from accounts in TypeScript
  const daily =
    sources.has('daily') && s.by !== 'post'
      ? { p_accounts: q.accounts, p_from: q.from, p_to: q.to, p_by: sqlBy === 'time' ? 'time' : 'account', p_grain: q.grain, p_week_start: q.weekStart }
      : null;
  const posts = sources.has('posts') && s.by !== 'post' ? { ...mediaArgs(s, q), p_by: sqlBy, p_grain: q.grain, p_week_start: q.weekStart } : null;
  return { daily, posts, media: mediaArgs(s, q) };
}

/** One row per key (account id, group-less bucket, format, tag id / 'untagged', weekday, hour) with its additive parts. */
export async function loadRollup(db: SupabaseClient, s: ExplorerState, q: RollupQuery): Promise<Map<string, Parts>> {
  const out = new Map<string, Parts>();
  if (q.accounts.length === 0) return out;
  const args = rollupArgs(s, q);
  const [d, p] = await Promise.all([args.daily ? db.rpc('explorer_daily', args.daily) : null, args.posts ? db.rpc('explorer_posts', args.posts) : null]);
  if (d?.error) fail('daily');
  if (p?.error) fail('posts');
  const at = (key: string) => out.get(key) ?? out.set(key, { daily: null, posts: null }).get(key)!;
  for (const r of (d?.data ?? []) as Row[]) {
    at(String(r.key)).daily = { reach: num(r.reach), views: num(r.views), interactions: num(r.interactions), erInteractions: num(r.er_interactions), erReach: num(r.er_reach), netFollows: num(r.net_follows), followers: num(r.followers) };
  }
  for (const r of (p?.data ?? []) as Row[]) {
    at(String(r.key)).posts = {
      posts: num(r.posts) ?? 0,
      measured: num(r.measured) ?? 0,
      reachSum: num(r.reach_sum),
      viewsSum: num(r.views_sum),
      viewsN: num(r.views_n) ?? 0,
      likes: num(r.likes),
      comments: num(r.comments),
      saves: num(r.saves),
      shares: num(r.shares),
      erInteractions: num(r.er_interactions),
      erReach: num(r.er_reach),
    };
  }
  return out;
}

/** The newest ITEM_LIMIT media in scope (same filters as the post rollup), newest first; truncated = there were more. */
export async function loadItems(db: SupabaseClient, s: ExplorerState, q: RollupQuery): Promise<{ items: ItemRow[]; truncated: boolean }> {
  if (q.accounts.length === 0) return { items: [], truncated: false };
  const { data, error } = await db
    .rpc('explorer_media', rollupArgs(s, q).media)
    .select('id,account_id,media_type,posted_at,permalink,caption,reach,views,likes,comments,saves,shares')
    .order('posted_at', { ascending: false })
    .limit(ITEM_LIMIT + 1);
  if (error) fail('items');
  const rows = ((data ?? []) as Row[]).filter((r) => KINDS.includes(r.media_type as string));
  return {
    truncated: rows.length > ITEM_LIMIT,
    items: rows.slice(0, ITEM_LIMIT).map((r) => ({
      id: String(r.id),
      accountId: String(r.account_id),
      mediaType: r.media_type as MediaKind,
      postedAt: String(r.posted_at),
      permalink: safeLink(r.permalink), // rendered as a link: https only
      caption: str(r.caption),
      reach: num(r.reach),
      views: num(r.views),
      likes: num(r.likes),
      comments: num(r.comments),
      saves: num(r.saves),
      shares: num(r.shares),
    })),
  };
}
```

Known limit (runbook §6): a timezone that `Intl` accepts but Postgres does not know (e.g. the deprecated `America/Argentina/ComodRivadavia`) makes the post RPCs fail with the fixed error; every zone in `lib/timezones.ts` is known to both (checked in the dry run against PostgreSQL 16).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/explorer-read.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/explorer/read.ts tests/explorer-read.test.ts
git commit -m "feat(explorer): owner-session rollup reader with fixed RPC mapping" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pure model (`lib/analysis/explorer.ts`)

**Files:**
- Create: `lib/analysis/explorer.ts`
- Test: `tests/analysis-explorer.test.ts` (new)

**Interfaces:**
- Consumes: `weekOrder` (`lib/analysis/best-time.ts`), `MAX_LAG_DAYS`, `Kpi` (`lib/analysis/growth.ts`), `ItemRow` (Task 4, type only), `explorerHref`, `FORMATS`, `withState`, `ExplorerState` (Task 3), `METRICS`, `Parts`, `DailyParts`, `PostParts`, `MetricId` (Task 2); from 12a: `bucketRange`, `bucketStart`, `compareRange`, `minDay`, `DayRange`, `Granularity` (`lib/time-scope/range.ts`), `scopeQuery`, `ResolvedScope`, `TimeScope` (`lib/time-scope/scope.ts`), `parseTimeScope`, `resolveScope` (tests).
- Produces:
  - `interface ScopeAccount { id; username; groupName: string | null }`
  - `toKpi(value, prior): Kpi`, `addParts(a, b): Parts`, `itemParts(i: ItemRow): Parts`, `groupKey(a): string` (`'g:<name>'` / `'a:<id>'`), `byGroup(rows, accounts): Map<string, Parts>`
  - `settledDay(doneThrough: (string | null | undefined)[], today): string`, `explorerWindow(r: ResolvedScope, settled): { current: DayRange; compare: DayRange | null }`, `bucketsOf(range, gran, weekStart): string[]`
  - `interface ExplorerRow { key: string; priorKey: string | null; values: Partial<Record<MetricId, Kpi>> }`, `interface ExplorerModel { rows: ExplorerRow[]; partial: string[] }`, `interface ExplorerInput { state; window; current: Map<string, Parts>; prior: Map<string, Parts> | null; accounts: ScopeAccount[]; items: ItemRow[]; gran: Granularity; weekStart: WeekStart }`, `buildExplorer(i): ExplorerModel`
  - `drillTarget(s, key, gran): { state: ExplorerState; range?: DayRange; gran?: Granularity } | null`, `drillHref(s, key, r: Pick<ResolvedScope, 'scope' | 'query' | 'gran'>): string | null`
  - `interface Crumb { kind: 'all' | 'group' | 'account' | 'format' | 'item'; key: string; href: string }`, `breadcrumbs(s, { query, hasGroups }): Crumb[]`

Rules this task pins: the Explorer's days follow the KPI cards (12a `summarize`): a rolling preset ends on the latest settled day (`daily_done_through` within `MAX_LAG_DAYS` of yesterday, else yesterday) and a fixed range is cut there, with 12a's `compareRange` for the comparison — so a comparison never pits a window missing Instagram's last 1–2 lagging days against a complete one. Rows with no data stay `null` (never 0); groups add parts first and compute ratios after; weekday (owner week start) / hour / time axes are complete; accounts, groups and tags rank by the chart metric with "untagged" last.

- [ ] **Step 1: Write the failing test** — create `tests/analysis-explorer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addParts, breadcrumbs, bucketsOf, buildExplorer, byGroup, drillHref, drillTarget, explorerWindow, itemParts, settledDay, toKpi, type ExplorerInput, type ScopeAccount } from '@/lib/analysis/explorer';
import type { ItemRow } from '@/lib/explorer/read';
import { parseExplorerState } from '@/lib/explorer/state';
import type { DailyParts, Parts, PostParts } from '@/lib/metrics';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const ACCOUNTS: ScopeAccount[] = [
  { id: A, username: 'alpha', groupName: 'Food' },
  { id: B, username: 'beta', groupName: 'Food' },
  { id: C, username: 'gamma', groupName: null },
];
const d = (o: Partial<DailyParts> = {}): DailyParts => ({ reach: null, views: null, interactions: null, erInteractions: null, erReach: null, netFollows: null, followers: null, ...o });
const p = (o: Partial<PostParts> = {}): PostParts => ({ posts: 0, measured: 0, reachSum: null, viewsSum: null, viewsN: 0, likes: null, comments: null, saves: null, shares: null, erInteractions: null, erReach: null, ...o });
const parts = (daily: Partial<DailyParts> | null, posts: Partial<PostParts> | null = null): Parts => ({ daily: daily && d(daily), posts: posts && p(posts) });
const TODAY = '2026-10-17';
const W = { current: { from: '2026-09-17', to: '2026-10-16' }, compare: { from: '2026-08-18', to: '2026-09-16' } };
const input = (o: Partial<ExplorerInput>): ExplorerInput => ({ state: parseExplorerState({}), window: W, current: new Map(), prior: null, accounts: ACCOUNTS, items: [], gran: 'day', weekStart: 'mon', ...o });

describe('toKpi', () => {
  it('relative change, zero base, missing sides', () => {
    expect(toKpi(120, 100)).toEqual({ value: 120, prior: 100, diff: 20, change: 0.2, reason: null });
    expect(toKpi(5, 0)).toMatchObject({ diff: 5, change: null });
    expect(toKpi(0, 0)).toMatchObject({ diff: 0, change: 0 });
    expect(toKpi(5, null)).toEqual({ value: 5, prior: null, diff: null, change: null, reason: null });
    expect(toKpi(null, 3)).toEqual({ value: null, prior: 3, diff: null, change: null, reason: 'no_data' });
  });
});

describe('addParts / byGroup', () => {
  it('adds sums and counts; null + number keeps the number; a missing side keeps the other', () => {
    const x = addParts(parts({ reach: 10, followers: 100 }, { posts: 2, measured: 1, reachSum: 50, viewsN: 1 }), parts({ reach: null, followers: 50, netFollows: 3 }, null));
    expect(x.daily).toEqual(d({ reach: 10, followers: 150, netFollows: 3 }));
    expect(x.posts).toEqual(p({ posts: 2, measured: 1, reachSum: 50, viewsN: 1 }));
  });

  it('named groups combine their accounts; an isolated account stays its own row', () => {
    const rows = new Map([[A, parts({ reach: 10, erInteractions: 1, erReach: 10 })], [B, parts({ reach: 30, erInteractions: 9, erReach: 30 })], [C, parts({ reach: 5 })]]);
    const g = byGroup(rows, ACCOUNTS);
    expect([...g.keys()]).toEqual(['g:Food', `a:${C}`]);
    expect(g.get('g:Food')!.daily).toMatchObject({ reach: 40, erInteractions: 10, erReach: 40 }); // ER of the group = 10 / 40, not the mean of 10 % and 30 %
  });
});

describe('itemParts', () => {
  it('a single post uses the rollup rules: measured needs reach > 0, Stories never count for engagement', () => {
    const post: ItemRow = { id: 'm1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: null, reach: 200, views: null, likes: 10, comments: 5, saves: null, shares: 1 };
    expect(itemParts(post).posts).toEqual(p({ posts: 1, measured: 1, reachSum: 200, viewsSum: null, viewsN: 0, likes: 10, comments: 5, shares: 1, erInteractions: 16, erReach: 200 }));
    expect(itemParts({ ...post, mediaType: 'STORY' }).posts).toMatchObject({ erInteractions: null, erReach: null });
    expect(itemParts({ ...post, reach: 0 }).posts).toMatchObject({ measured: 0, reachSum: null, erReach: null });
  });
});

describe('windows', () => {
  it('settled day: the newest done-through day within the lag, else yesterday', () => {
    expect(settledDay(['2026-10-15', '2026-10-14', null], TODAY)).toBe('2026-10-15');
    expect(settledDay(['2026-10-10'], TODAY)).toBe('2026-10-16'); // stale: yesterday, its gap shows
    expect(settledDay([], TODAY)).toBe('2026-10-16');
    expect(settledDay(['2026-10-17'], TODAY)).toBe('2026-10-16'); // today is never settled
  });

  it('rolling presets end on the settled day; fixed ranges are cut there; comparison from 12a compareRange', () => {
    const r30 = resolveScope(parseTimeScope({}), TODAY, '2026-01-01');
    expect(explorerWindow(r30, '2026-10-15')).toEqual({ current: { from: '2026-09-16', to: '2026-10-15' }, compare: { from: '2026-08-17', to: '2026-09-15' } });
    const oct = resolveScope(parseTimeScope({ month: '2026-10' }), TODAY, '2026-01-01');
    expect(explorerWindow(oct, '2026-10-15')).toEqual({ current: { from: '2026-10-01', to: '2026-10-15' }, compare: { from: '2026-09-01', to: '2026-09-15' } });
    const none = resolveScope(parseTimeScope({ from: '7d', cmp: 'none' }), TODAY, '2026-01-01');
    expect(explorerWindow(none, '2026-10-16').compare).toBeNull();
  });

  it('bucketsOf lists every bucket touching the range (weeks on the week start, months)', () => {
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-14' }, 'week', 'mon')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-14' }, 'week', 'sun')).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
    expect(bucketsOf({ from: '2025-11-15', to: '2026-02-01' }, 'month', 'mon')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-03' }, 'day', 'mon')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('buildExplorer', () => {
  it('by account: every account in scope (no data = null, never 0), ranked by the chart metric, compared by key', () => {
    const m = buildExplorer(input({
      state: parseExplorerState({ m: 'reach,posts', by: 'account' }),
      current: new Map([[A, parts({ reach: 100 }, { posts: 3 })], [B, parts({ reach: 300 }, null)]]),
      prior: new Map([[A, parts({ reach: 80 }, { posts: 3 })]]),
    }));
    expect(m.rows.map((r) => r.key)).toEqual([B, A, C]);
    expect(m.rows[1].values.reach).toMatchObject({ value: 100, prior: 80, change: 0.25 });
    expect(m.rows[0].values.reach).toMatchObject({ value: 300, prior: null });
    expect(m.rows[0].values.posts).toMatchObject({ value: null, reason: 'no_data' });
    expect(m.rows[2].values.reach?.value).toBeNull();
  });

  it('by group: sums the accounts first, then computes ratios', () => {
    const m = buildExplorer(input({
      state: parseExplorerState({ m: 'engagementRate', by: 'group' }),
      current: new Map([[A, parts({ erInteractions: 1, erReach: 10 })], [B, parts({ erInteractions: 9, erReach: 30 })], [C, parts({ erInteractions: 1, erReach: 100 })]]),
    }));
    expect(m.rows.map((r) => [r.key, r.values.engagementRate?.value])).toEqual([['g:Food', 0.25], [`a:${C}`, 0.01]]);
  });

  it('by time: every bucket of the range, partial ones flagged, the comparison aligned by position', () => {
    const state = parseExplorerState({ m: 'reach', by: 'time' });
    const window = { current: { from: '2026-10-01', to: '2026-10-14' }, compare: { from: '2026-09-17', to: '2026-09-30' } };
    const m = buildExplorer(input({ state, window, gran: 'week', current: new Map([['2026-10-05', parts({ reach: 70 })]]), prior: new Map([['2026-09-21', parts({ reach: 35 })]]) }));
    expect(m.rows.map((r) => [r.key, r.priorKey])).toEqual([['2026-09-28', '2026-09-14'], ['2026-10-05', '2026-09-21'], ['2026-10-12', '2026-09-28']]);
    expect(m.rows[1].values.reach).toMatchObject({ value: 70, prior: 35, change: 1 });
    expect(m.partial).toEqual(['2026-09-28', '2026-10-12']);
  });

  it('weekday and hour axes are complete and ordered; tags put untagged last; formats only when present', () => {
    const state = (by: string) => parseExplorerState({ m: 'posts', by });
    expect(buildExplorer(input({ state: state('weekday'), weekStart: 'sun' })).rows.map((r) => r.key)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(buildExplorer(input({ state: state('hour') })).rows).toHaveLength(24);
    const tags = buildExplorer(input({ state: state('tag'), current: new Map([['untagged', parts(null, { posts: 9 })], ['t1', parts(null, { posts: 2 })]]) }));
    expect(tags.rows.map((r) => r.key)).toEqual(['t1', 'untagged']); // ranked by posts would put untagged first: it is always last
    const f = buildExplorer(input({ state: state('format'), current: new Map([['STORY', parts(null, { posts: 1 })], ['REELS', parts(null, { posts: 2 })]]) }));
    expect(f.rows.map((r) => r.key)).toEqual(['REELS', 'STORY']);
  });

  it('single posts: one row per item, no comparison', () => {
    const it: ItemRow = { id: 'm1', accountId: A, mediaType: 'IMAGE', postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: 'x', reach: 50, views: 80, likes: 4, comments: 1, saves: 0, shares: 0 };
    const m = buildExplorer(input({ state: parseExplorerState({ m: 'avgReach,postEngagementRate', by: 'post' }), items: [it] }));
    expect(m.rows).toEqual([{ key: 'm1', priorKey: null, values: { avgReach: toKpi(50, null), postEngagementRate: toKpi(0.1, null) } }]);
  });
});

describe('drill-down', () => {
  const r = resolveScope(parseTimeScope({ from: '90d', cmp: 'yoy' }), TODAY, '2026-01-01');

  it('goes one level deeper and keeps the scope', () => {
    const s = parseExplorerState({ m: 'reach,likes', by: 'group' });
    expect(drillHref(s, 'g:Food', r)).toBe('/explorer?m=reach%2Clikes&by=account&grp=Food&from=90d&cmp=yoy');
    expect(drillHref(s, `a:${C}`, r)).toBe(`/explorer?m=likes&by=format&acc=${C}&from=90d&cmp=yoy`);
    expect(drillTarget(parseExplorerState({ by: 'account' }), A, 'day')?.state).toMatchObject({ accounts: [A], by: 'format' });
    expect(drillTarget(parseExplorerState({ by: 'format' }), 'REELS', 'day')?.state).toMatchObject({ format: 'REELS', by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'weekday' }), '3', 'day')?.state).toMatchObject({ weekday: 3, by: 'hour' });
    expect(drillTarget(parseExplorerState({ by: 'hour' }), '20', 'day')?.state).toMatchObject({ hour: 20, by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'tag' }), 'untagged', 'day')?.state).toMatchObject({ tag: 'untagged', by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'post' }), '42', 'day')?.state).toMatchObject({ item: '42' });
  });

  it('a time bucket becomes the new fixed range one granularity finer; a day lists its posts', () => {
    const s = parseExplorerState({ m: 'reach', by: 'time' });
    expect(drillHref(s, '2026-09-01', { ...r, gran: 'month' })).toBe('/explorer?m=reach&by=time&from=2026-09-01&to=2026-09-30&cmp=yoy&gran=week');
    expect(drillHref(s, '2026-09-07', { ...r, gran: 'week' })).toBe('/explorer?m=reach&by=time&from=2026-09-07&to=2026-09-13&cmp=yoy&gran=day');
    expect(drillHref(s, '2026-09-08', { ...r, gran: 'day' })).toBe('/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&from=2026-09-08&to=2026-09-08&cmp=yoy');
  });

  it('breadcrumbs rebuild each level from the URL and keep the scope', () => {
    const s = parseExplorerState({ m: 'likes', by: 'post', grp: 'Food', acc: A, fmt: 'REELS', item: '42' });
    const c = breadcrumbs(s, { query: 'from=90d', hasGroups: true });
    expect(c.map((x) => [x.kind, x.key])).toEqual([['all', ''], ['group', 'Food'], ['account', A], ['format', 'REELS'], ['item', '42']]);
    expect(c[0].href).toBe('/explorer?m=likes&by=group&from=90d');
    expect(c[2].href).toBe(`/explorer?m=likes&by=format&acc=${A}&grp=Food&from=90d`);
    expect(breadcrumbs(parseExplorerState({}), { query: '', hasGroups: false })).toEqual([{ kind: 'all', key: '', href: '/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analysis-explorer.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/explorer"`.

- [ ] **Step 3: Write `lib/analysis/explorer.ts`**

```ts
// The Explorer model (creator-toolkit spec §0b "Drill-down & time scope"). Pure: the rollup rows (additive parts per
// key), the window, today and the owner's week start are inputs. Metric values come from the registry (lib/metrics.ts);
// groups are sums of their accounts' parts (never averages of averages); the comparison period is joined by key, or by
// position for time buckets.
import { weekOrder } from '@/lib/analysis/best-time';
import { MAX_LAG_DAYS, type Kpi } from '@/lib/analysis/growth';
import type { ItemRow } from '@/lib/explorer/read';
import { explorerHref, FORMATS, withState, type ExplorerState } from '@/lib/explorer/state';
import { METRICS, type DailyParts, type MetricId, type Parts, type PostParts } from '@/lib/metrics';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { bucketRange, bucketStart, compareRange, minDay, type DayRange, type Granularity } from '@/lib/time-scope/range';
import { scopeQuery, type ResolvedScope, type TimeScope } from '@/lib/time-scope/scope';

export interface ScopeAccount {
  id: string;
  username: string;
  groupName: string | null;
}

/** A value with its comparison, in the shape StatCard / deltaView already understand. */
export function toKpi(value: number | null, prior: number | null): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: 'no_data' };
  if (prior === null) return { value, prior: null, diff: null, change: null, reason: null };
  const diff = value - prior;
  return { value, prior, diff, change: prior === 0 ? (diff === 0 ? 0 : null) : diff / Math.abs(prior), reason: null };
}

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

function addDaily(a: DailyParts, b: DailyParts): DailyParts {
  return { reach: add(a.reach, b.reach), views: add(a.views, b.views), interactions: add(a.interactions, b.interactions), erInteractions: add(a.erInteractions, b.erInteractions), erReach: add(a.erReach, b.erReach), netFollows: add(a.netFollows, b.netFollows), followers: add(a.followers, b.followers) };
}

function addPosts(a: PostParts, b: PostParts): PostParts {
  return {
    posts: a.posts + b.posts,
    measured: a.measured + b.measured,
    reachSum: add(a.reachSum, b.reachSum),
    viewsSum: add(a.viewsSum, b.viewsSum),
    viewsN: a.viewsN + b.viewsN,
    likes: add(a.likes, b.likes),
    comments: add(a.comments, b.comments),
    saves: add(a.saves, b.saves),
    shares: add(a.shares, b.shares),
    erInteractions: add(a.erInteractions, b.erInteractions),
    erReach: add(a.erReach, b.erReach),
  };
}

/** Parts are sums and counts, so two rows combine by adding (a missing side keeps the other). */
export function addParts(a: Parts, b: Parts): Parts {
  return {
    daily: a.daily && b.daily ? addDaily(a.daily, b.daily) : (a.daily ?? b.daily),
    posts: a.posts && b.posts ? addPosts(a.posts, b.posts) : (a.posts ?? b.posts),
  };
}

/** One published item as parts, so single posts use the same registry formulas (same rules as explorer_posts). */
export function itemParts(i: ItemRow): Parts {
  const measured = (i.reach ?? 0) > 0;
  const er = measured && i.mediaType !== 'STORY';
  return {
    daily: null,
    posts: {
      posts: 1,
      measured: measured ? 1 : 0,
      reachSum: measured ? i.reach : null,
      viewsSum: i.views,
      viewsN: i.views === null ? 0 : 1,
      likes: i.likes,
      comments: i.comments,
      saves: i.saves,
      shares: i.shares,
      erInteractions: er ? (i.likes ?? 0) + (i.comments ?? 0) + (i.saves ?? 0) + (i.shares ?? 0) : null,
      erReach: er ? i.reach : null,
    },
  };
}

/** Group key of an account: 'g:<name>' for a named group, 'a:<id>' for an isolated account (never combined, SPEC §7b). */
export const groupKey = (a: Pick<ScopeAccount, 'id' | 'groupName'>) => (a.groupName ? `g:${a.groupName}` : `a:${a.id}`);

/** Per-account rows → per-group rows (sums of parts). Accounts outside `accounts` are ignored. */
export function byGroup(rows: Map<string, Parts>, accounts: ScopeAccount[]): Map<string, Parts> {
  const out = new Map<string, Parts>();
  for (const a of accounts) {
    const r = rows.get(a.id);
    if (!r) continue;
    const k = groupKey(a);
    const prev = out.get(k);
    out.set(k, prev ? addParts(prev, r) : r);
  }
  return out;
}

/**
 * The latest settled insight day of the accounts in scope (Instagram lags up to 48 h): the newest `daily_done_through`
 * that is within MAX_LAG_DAYS of yesterday, else yesterday — the same rule as summarize() uses per account.
 */
export function settledDay(doneThrough: (string | null | undefined)[], today: string): string {
  const yesterday = addDays(today, -1);
  const latest = doneThrough.filter((d): d is string => typeof d === 'string' && d <= yesterday).sort().at(-1);
  return latest !== undefined && latest >= addDays(yesterday, -MAX_LAG_DAYS) ? latest : yesterday;
}

/** The Explorer's days: like the KPI cards, a rolling preset ends on the settled day and a fixed range is cut there. */
export function explorerWindow(r: ResolvedScope, settled: string): { current: DayRange; compare: DayRange | null } {
  const w = r.window;
  const to = 'last' in w ? settled : minDay(w.to, settled > w.from ? settled : w.from);
  const from = 'last' in w ? addDays(to, -(w.last - 1)) : w.from;
  return { current: { from, to }, compare: compareRange(w, { from, to }, r.scope.cmp) };
}

/** First days of every bucket that touches the range, oldest first. */
export function bucketsOf(range: DayRange, gran: Granularity, weekStart: WeekStart): string[] {
  const out: string[] = [];
  for (let b = bucketStart(range.from, gran, weekStart); b <= range.to; b = addDays(bucketRange(b, gran).to, 1)) out.push(b);
  return out;
}

export interface ExplorerRow {
  key: string; // account id, 'g:<group>' / 'a:<id>', format, tag id / 'untagged', weekday, hour, bucket start, media id
  priorKey: string | null; // the comparison bucket (time) or the same key; null without a comparison
  values: Partial<Record<MetricId, Kpi>>;
}

export interface ExplorerModel {
  rows: ExplorerRow[]; // display order
  partial: string[]; // time buckets the range starts or ends inside
}

export interface ExplorerInput {
  state: ExplorerState;
  window: { current: DayRange; compare: DayRange | null };
  current: Map<string, Parts>; // per account when by = 'group' (combined here), otherwise per key
  prior: Map<string, Parts> | null;
  accounts: ScopeAccount[]; // live accounts in scope, sorted by username
  items: ItemRow[]; // by = 'post' only
  gran: Granularity;
  weekStart: WeekStart;
}

const EMPTY: Parts = { daily: null, posts: null };

export function buildExplorer(i: ExplorerInput): ExplorerModel {
  const { state: s } = i;
  if (s.by === 'post') {
    return { rows: i.items.map((it) => ({ key: it.id, priorKey: null, values: Object.fromEntries(s.metrics.map((m) => [m, toKpi(METRICS[m].value(itemParts(it)), null)])) })), partial: [] };
  }
  const cur = s.by === 'group' ? byGroup(i.current, i.accounts) : i.current;
  const pri = i.prior && (s.by === 'group' ? byGroup(i.prior, i.accounts) : i.prior);
  let keys: string[];
  let priorKeys: (string | null)[];
  let partial: string[] = [];
  if (s.by === 'time') {
    keys = bucketsOf(i.window.current, i.gran, i.weekStart);
    const before = i.window.compare ? bucketsOf(i.window.compare, i.gran, i.weekStart) : [];
    priorKeys = keys.map((_, n) => before[n] ?? null); // bucket n of the range vs bucket n of the comparison
    partial = keys.filter((b) => {
      const span = bucketRange(b, i.gran);
      return span.from < i.window.current.from || span.to > i.window.current.to;
    });
  } else {
    keys =
      s.by === 'account' ? i.accounts.map((a) => a.id)
      : s.by === 'group' ? [...new Set(i.accounts.map(groupKey))]
      : s.by === 'weekday' ? weekOrder(i.weekStart).map(String)
      : s.by === 'hour' ? Array.from({ length: 24 }, (_, h) => String(h))
      : s.by === 'format' ? FORMATS.filter((f) => cur.has(f) || pri?.has(f))
      : [...new Set([...cur.keys(), ...(pri?.keys() ?? [])])]; // tags (ids and 'untagged')
    priorKeys = keys.map((k) => (pri ? k : null));
  }
  const rows = keys.map((key, n) => {
    const now = cur.get(key) ?? EMPTY;
    const pk = priorKeys[n];
    const before = pk !== null && pri ? (pri.get(pk) ?? EMPTY) : null;
    return { key, priorKey: pk, values: Object.fromEntries(s.metrics.map((m) => [m, toKpi(METRICS[m].value(now), before ? METRICS[m].value(before) : null)])) };
  });
  // people, groups and tags rank by the chart metric (stable: ties keep username / A→Z order; "untagged" always last);
  // axes (weekday, hour, time, format) keep their natural order
  if (s.by === 'account' || s.by === 'group' || s.by === 'tag') {
    const v = (r: ExplorerRow) => r.values[s.chart]?.value ?? null;
    const last = (r: ExplorerRow) => (r.key === 'untagged' ? 1 : 0);
    rows.sort((a, b) => last(a) - last(b) || (v(a) === v(b) ? 0 : v(a) === null ? 1 : v(b) === null ? -1 : v(b)! - v(a)!));
  }
  return { rows, partial };
}

/** Where a click on a row / bar goes: one level deeper, or a narrower range. Null = the deepest level. */
export function drillTarget(s: ExplorerState, key: string, gran: Granularity): { state: ExplorerState; range?: DayRange; gran?: Granularity } | null {
  switch (s.by) {
    case 'group':
      return key.startsWith('g:') ? { state: withState(s, { group: key.slice(2), accounts: [], by: 'account' }) } : { state: withState(s, { accounts: [key.slice(2)], by: 'format' }) };
    case 'account':
      return { state: withState(s, { accounts: [key], by: 'format' }) };
    case 'format':
      return { state: withState(s, { format: key as ExplorerState['format'], by: 'post' }) };
    case 'tag':
      return { state: withState(s, { tag: key, by: 'post' }) };
    case 'weekday':
      return { state: withState(s, { weekday: Number(key), by: 'hour' }) };
    case 'hour':
      return { state: withState(s, { hour: Number(key), by: 'post' }) };
    case 'time': {
      const range = bucketRange(key, gran);
      if (gran === 'day') return { state: withState(s, { by: 'post' }), range };
      return { state: s, range, gran: gran === 'month' ? 'week' : 'day' };
    }
    case 'post':
      return { state: withState(s, { item: key }) };
  }
}

/** The link of a drill target: the Explorer state plus the scope (kept, or the clicked bucket as fixed days). */
export function drillHref(s: ExplorerState, key: string, r: Pick<ResolvedScope, 'scope' | 'query' | 'gran'>): string | null {
  const t = drillTarget(s, key, r.gran);
  if (!t) return null;
  if (!t.range) return explorerHref(t.state, r.query);
  const scope: TimeScope = { range: t.range, cmp: typeof r.scope.cmp === 'object' ? 'prev' : r.scope.cmp, gran: t.gran ?? 'auto' };
  return explorerHref(t.state, scopeQuery(scope));
}

export interface Crumb {
  kind: 'all' | 'group' | 'account' | 'format' | 'item';
  key: string; // '' for all, the group name, account id, format, media id
  href: string;
}

/** The vertical trail of the current state: All accounts › group › @account › format › post. Every link keeps the scope. */
export function breadcrumbs(s: ExplorerState, o: { query: string; hasGroups: boolean }): Crumb[] {
  const base = withState(s, { accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null, by: o.hasGroups ? 'group' : 'account' });
  const out: Crumb[] = [{ kind: 'all', key: '', href: explorerHref(base, o.query) }];
  let at = base;
  if (s.group !== null) {
    at = withState(at, { group: s.group, by: 'account' });
    out.push({ kind: 'group', key: s.group, href: explorerHref(at, o.query) });
  }
  if (s.accounts.length === 1) {
    at = withState(at, { accounts: s.accounts, by: 'format' });
    out.push({ kind: 'account', key: s.accounts[0], href: explorerHref(at, o.query) });
  }
  if (s.format !== null) {
    at = withState(at, { format: s.format, by: 'post' });
    out.push({ kind: 'format', key: s.format, href: explorerHref(at, o.query) });
  }
  if (s.item !== null) out.push({ kind: 'item', key: s.item, href: explorerHref(s, o.query) });
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/analysis-explorer.test.ts` and `npx tsc --noEmit`
Expected: PASS (15 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/explorer.ts tests/analysis-explorer.test.ts
git commit -m "feat(analysis): explorer model (groups, comparison, drill targets, breadcrumbs)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Saved views — validation + server actions

**Files:**
- Create: `lib/explorer/views.ts`, `app/(app)/explorer/actions.ts`
- Modify: `lib/tags.ts` (`normalizeTagName` gains an optional `max`; default unchanged)
- Test: `tests/explorer-views.test.ts` (new). `tests/tags.test.ts` and `tests/tag-actions.test.ts` must keep passing unchanged.

**Interfaces:**
- Consumes: `EXPLORER_KEYS`, `explorerParams`, `parseExplorerState` (Task 3); 12a `parseTimeScope`, `SCOPE_KEYS`, `scopeParams` (`lib/time-scope/scope.ts`); `normalizeTagName`, `sameTagName`, `isUuid` (`lib/tags.ts`); `requireOwner`, `createServerSupabase`, `getPrefs`; table `explorer_views` (Task 1).
- Produces:
  - `VIEW_NAME_MAX = 60`, `MAX_VIEWS = 50`, `interface SavedView { id; name; href }`.
  - `viewState(query: string, weekStart): Record<string, string>` (canonical Explorer + Time Scope params; unknown keys dropped; repeated key = missing), `viewHref(stored: unknown, weekStart): string` (re-validates stored JSON), `loadViews(db, weekStart): Promise<SavedView[]>` (never throws).
  - Server actions `saveViewAction(name, query)`, `renameViewAction(id, name)`, `deleteViewAction(id)` → `ViewResult = { ok: true } | { ok: false; error: ViewError }`, `ViewError = 'invalid_name' | 'invalid_state' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected'` (i18n `explorer.views.errors.<key>`, Task 2).
  - `normalizeTagName(raw, max = TAG_NAME_MAX)`.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-views.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

type Op = unknown[];
const { calls, requireOwner, queue } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ weekStart: 'mon' }) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { deleteViewAction, renameViewAction, saveViewAction } from '@/app/(app)/explorer/actions';
import { loadViews, MAX_VIEWS, viewHref, viewState } from '@/lib/explorer/views';

const V1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const V2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('viewState / viewHref', () => {
  it('keeps only Explorer and Time Scope keys, canonical; a preset stays a preset, picker shorthands become fixed days', () => {
    expect(viewState('m=likes&by=hour&from=90d&cmp=yoy&tab=posts&evil=1', 'mon')).toEqual({ m: 'likes', by: 'hour', from: '90d', cmp: 'yoy' });
    expect(viewState('by=time&month=2026-09&gran=week', 'mon')).toEqual({ m: 'reach,engagementRate,posts,avgReach', by: 'time', from: '2026-09-01', to: '2026-09-30', gran: 'week' });
    expect(viewState('m=reach&m=likes&by=format', 'mon')).toEqual({ m: 'posts,avgReach,postEngagementRate', by: 'format' }); // repeated = missing
  });

  it('a stored state is re-validated: junk JSON, unknown keys and non-strings never reach the link', () => {
    expect(viewHref({ m: 'likes', by: 'tag', from: '2026-01-01', to: '2026-03-31', x: 'y', acc: 5 }, 'mon')).toBe('/explorer?m=likes&by=tag&from=2026-01-01&to=2026-03-31');
    for (const junk of [null, 'm=likes', [], 42, { by: 'drop table', from: '<script>' }]) expect(viewHref(junk, 'mon')).toBe('/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account');
  });

  it('loadViews: A→Z, at most MAX_VIEWS, links rebuilt; a failed read is an empty menu', async () => {
    queue.push({ data: [{ id: V1, name: 'Reels', state: { m: 'likes', by: 'hour' } }], error: null });
    expect(await loadViews(fakeDb() as unknown as SupabaseClient, 'mon')).toEqual([{ id: V1, name: 'Reels', href: '/explorer?m=likes&by=hour' }]);
    expect(has('order', 'name', { ascending: true })).toBe(true);
    expect(has('limit', MAX_VIEWS)).toBe(true);
    queue.push({ data: null, error: { message: 'x' } });
    expect(await loadViews(fakeDb() as unknown as SupabaseClient, 'mon')).toEqual([]);
  });
});

describe('saved view actions: authorization and validation', () => {
  it.each([
    ['save', () => saveViewAction('Reels by hour', 'by=hour')],
    ['rename', () => renameViewAction(V1, 'New')],
    ['delete', () => deleteViewAction(V1)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('invalid input returns an error key without opening a database client; never the admin client', async () => {
    expect(await saveViewAction('   ', 'by=hour')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await saveViewAction('a'.repeat(61), 'by=hour')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await saveViewAction('ok', 'x'.repeat(4001))).toEqual({ ok: false, error: 'invalid_state' });
    expect(await saveViewAction('ok', 42 as unknown as string)).toEqual({ ok: false, error: 'invalid_state' });
    expect(await renameViewAction("1' or 1=1", 'x')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteViewAction('nope')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session' || c[0] === 'ADMIN')).toBe(false);
  });
});

describe('saveViewAction', () => {
  it('stores the normalised name and the canonical state, then revalidates', async () => {
    queue.push({ data: [{ id: V2, name: 'Other' }] }, { error: null });
    expect(await saveViewAction('  Reels   by hour ', 'm=likes&by=hour&from=30d&tab=x')).toEqual({ ok: true });
    expect(has('insert', { name: 'Reels by hour', state: { m: 'likes', by: 'hour' } })).toBe(true);
    expect(has('revalidate', '/explorer')).toBe(true);
  });

  it('duplicate names (any case), too many views, a DB race and unexpected errors map to keys, never messages', async () => {
    queue.push({ data: [{ id: V2, name: 'reels' }] });
    expect(await saveViewAction('REELS', '')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ data: Array.from({ length: MAX_VIEWS }, (_, i) => ({ id: `v${i}`, name: `View ${i}` })) });
    expect(await saveViewAction('One more', '')).toEqual({ ok: false, error: 'too_many' });
    queue.push({ data: [] }, { error: { code: '23505', message: 'duplicate key' } });
    expect(await saveViewAction('Race', '')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ error: { message: 'secret' } });
    expect(await saveViewAction('Boom', '')).toEqual({ ok: false, error: 'unexpected' });
    expect(calls.some((c) => c[0] === 'insert' && JSON.stringify(c).includes('One more'))).toBe(false);
  });
});

describe('renameViewAction / deleteViewAction', () => {
  it('rename: own name in another case is fine, another view with that name is a duplicate, a gone view is not_found', async () => {
    queue.push({ data: [{ id: V1, name: 'reels' }] }, { data: [{ id: V1 }] });
    expect(await renameViewAction(V1, 'Reels')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'update' && (c[1] as { name: string }).name === 'Reels')).toBe(true);
    expect(has('eq', 'id', V1)).toBe(true);
    queue.push({ data: [{ id: V2, name: 'Reels' }] });
    expect(await renameViewAction(V1, 'reels')).toEqual({ ok: false, error: 'duplicate' });
    queue.push({ data: [] }, { data: [] });
    expect(await renameViewAction(V1, 'X')).toEqual({ ok: false, error: 'not_found' });
  });

  it('delete: removes by id; a gone view is not_found', async () => {
    queue.push({ data: [{ id: V1 }] });
    expect(await deleteViewAction(V1)).toEqual({ ok: true });
    expect(has('delete')).toBe(true);
    queue.push({ data: [] });
    expect(await deleteViewAction(V1)).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-views.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/(app)/explorer/actions"`.

- [ ] **Step 3: Give `normalizeTagName` a maximum** — in `lib/tags.ts` replace the JSDoc + signature + length check of `normalizeTagName` so the diff is exactly:

```diff
diff --git a/lib/tags.ts b/lib/tags.ts
index 3afbd50..54cd6d6 100644
--- a/lib/tags.ts
+++ b/lib/tags.ts
@@ -17,13 +17,14 @@ export const isMediaId = (v: unknown): v is string => typeof v === 'string' && M
 // something else. Plain RTL text (Arabic, Hebrew) is fine. Tabs/newlines are whitespace and collapse instead.
 const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
 
-/** NFC, whitespace collapsed and trimmed, 1-40 code points (Postgres char_length counts code points too). */
-export function normalizeTagName(raw: unknown): { ok: true; value: string } | { ok: false; error: 'invalid_name' } {
+/** NFC, whitespace collapsed and trimmed, 1-`max` code points (Postgres char_length counts code points too). Also
+ *  used for saved Explorer view names (max 60). */
+export function normalizeTagName(raw: unknown, max: number = TAG_NAME_MAX): { ok: true; value: string } | { ok: false; error: 'invalid_name' } {
   if (typeof raw !== 'string') return { ok: false, error: 'invalid_name' };
   const nfc = raw.normalize('NFC');
   if (FORBIDDEN.test(nfc)) return { ok: false, error: 'invalid_name' };
   const value = nfc.replace(/\s+/g, ' ').trim();
-  if (value === '' || [...value].length > TAG_NAME_MAX) return { ok: false, error: 'invalid_name' };
+  if (value === '' || [...value].length > max) return { ok: false, error: 'invalid_name' };
   return { ok: true, value };
 }
 
```

- [ ] **Step 4: Write `lib/explorer/views.ts`**

```ts
// Saved Explorer views (table explorer_views, owner-authored, RLS is_owner()). A view stores the canonical query of the
// Explorer plus the Time Scope exactly as Plan 12a writes it (a preset stays rolling, fixed days stay fixed). The stored
// JSON is never trusted: it is re-validated through both parsers when saved AND when read.
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXPLORER_KEYS, explorerParams, parseExplorerState } from '@/lib/explorer/state';
import type { WeekStart } from '@/lib/prefs';
import { parseTimeScope, SCOPE_KEYS, scopeParams } from '@/lib/time-scope/scope';

export const VIEW_NAME_MAX = 60;
export const MAX_VIEWS = 50;

export interface SavedView {
  id: string;
  name: string;
  href: string; // '/explorer?…' rebuilt from the validated state
}

/** The canonical parameters to store for a query: Explorer keys + Time Scope keys only, each re-serialised by its parser. */
export function viewState(query: string, weekStart: WeekStart): Record<string, string> {
  const q = new URLSearchParams(query);
  const one = (k: string) => (q.getAll(k).length === 1 ? q.get(k)! : undefined); // repeated = missing (as on the page)
  const state = parseExplorerState(Object.fromEntries(EXPLORER_KEYS.map((k) => [k, one(k)])));
  return { ...Object.fromEntries(explorerParams(state)), ...scopeParams(parseTimeScope(q, weekStart)) };
}

/** A stored state (any JSON) → a safe Explorer link. Unknown keys and non-string values are dropped before parsing. */
export function viewHref(stored: unknown, weekStart: WeekStart): string {
  const o = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const allowed: readonly string[] = [...EXPLORER_KEYS, ...SCOPE_KEYS];
  const q = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => allowed.includes(e[0]) && typeof e[1] === 'string'));
  return `/explorer?${new URLSearchParams(viewState(q.toString(), weekStart))}`;
}

/** The owner's saved views, A→Z (owner session, RLS). Never throws: the Explorer still works without its menu. */
export async function loadViews(db: SupabaseClient, weekStart: WeekStart): Promise<SavedView[]> {
  const { data, error } = await db.from('explorer_views').select('id,name,state').order('name', { ascending: true }).limit(MAX_VIEWS);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({ id: String(r.id), name: String(r.name), href: viewHref(r.state, weekStart) }));
}
```

- [ ] **Step 5: Write `app/(app)/explorer/actions.ts`**

```ts
'use server';

// Saved Explorer views are owner-authored data: these actions use the OWNER-SESSION client, so RLS
// (explorer_views_owner_all, gated on is_owner()) applies to every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { MAX_VIEWS, VIEW_NAME_MAX, viewState } from '@/lib/explorer/views';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid, normalizeTagName, sameTagName } from '@/lib/tags';

export type ViewError = 'invalid_name' | 'invalid_state' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected';
export type ViewResult = { ok: true } | { ok: false; error: ViewError };

/** A view's query is at most a few hundred characters; anything far longer is not one of ours. */
const QUERY_MAX = 4000;

type DbError = { code?: string } | null;
// 23505 unique_violation (lower(name) index, a race with another tab), 23514 check (state too large)
const keyOf = (e: DbError): ViewError => (e?.code === '23505' ? 'duplicate' : e?.code === '23514' ? 'invalid_state' : 'unexpected');
const fail = (error: ViewError): ViewResult => ({ ok: false, error });

function done(): ViewResult {
  revalidatePath('/explorer');
  return { ok: true };
}

async function existing(db: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data, error } = await db.from('explorer_views').select('id,name').limit(MAX_VIEWS + 1);
  if (error) throw new Error('views read failed');
  return (data ?? []) as { id: string; name: string }[];
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function saveViewAction(name: string, query: string): Promise<ViewResult> {
  await requireOwner();
  const n = normalizeTagName(name, VIEW_NAME_MAX);
  if (!n.ok) return fail(n.error);
  if (typeof query !== 'string' || query.length > QUERY_MAX) return fail('invalid_state');
  try {
    const state = viewState(query, (await getPrefs()).weekStart);
    const db = await createServerSupabase();
    const views = await existing(db);
    if (views.some((v) => sameTagName(v.name, n.value))) return fail('duplicate');
    if (views.length >= MAX_VIEWS) return fail('too_many');
    const { error } = await db.from('explorer_views').insert({ name: n.value, state });
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}

export async function renameViewAction(id: string, name: string): Promise<ViewResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  const n = normalizeTagName(name, VIEW_NAME_MAX);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    if ((await existing(db)).some((v) => v.id !== id && sameTagName(v.name, n.value))) return fail('duplicate');
    const { data, error } = await db.from('explorer_views').update({ name: n.value, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deleteViewAction(id: string): Promise<ViewResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('explorer_views').delete().eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/explorer-views.test.ts tests/tags.test.ts tests/tag-actions.test.ts` and `npx tsc --noEmit`
Expected: PASS (3 files); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add lib/explorer/views.ts "app/(app)/explorer/actions.ts" lib/tags.ts tests/explorer-views.test.ts
git commit -m "feat(explorer): saved views (validated state, owner-session actions)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Clickable charts (`SeriesChart` point clicks, `Heatmap` cell links)

**Files:**
- Modify: `components/charts/SeriesChart.tsx`, `components/charts/Heatmap.tsx`
- Test: `tests/charts-drill.test.tsx` (new). `tests/charts.test.tsx` must keep passing unchanged.

**Interfaces:**
- Produces:
  - `SeriesChart` prop `onPointClick?: (index: number) => void` (index into `data`); `Series.muted?: boolean` (dashed line / 45 % bar opacity, for the comparison period).
  - `clickedIndex(s: { activeTooltipIndex?: number | string | null } | null | undefined): number | null` (exported from `components/charts/SeriesChart.tsx`).
  - `HeatmapCell.href?: string` — the cell renders as a `next/link` whose accessible name is the cell's `label`.
- Nothing else changes for existing callers (all new props are optional).

- [ ] **Step 1: Write the failing test** — create `tests/charts-drill.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heatmap, type HeatmapCell } from '@/components/charts/Heatmap';
import { clickedIndex, SeriesChart } from '@/components/charts/SeriesChart';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('clickedIndex (chart drill-down)', () => {
  it('accepts the index as a number or a numeric string (Recharts 3 uses strings)', () => {
    expect(clickedIndex({ activeTooltipIndex: 3 })).toBe(3);
    expect(clickedIndex({ activeTooltipIndex: '12' })).toBe(12);
    expect(clickedIndex({ activeTooltipIndex: 0 })).toBe(0);
  });

  it('anything else is no click target', () => {
    for (const v of [undefined, null, -1, 1.5, '', 'a', '1e3', '-2', Number.NaN]) expect(clickedIndex({ activeTooltipIndex: v as number })).toBeNull();
    expect(clickedIndex(null)).toBeNull();
    expect(clickedIndex(undefined)).toBeNull();
  });

  it('a clickable chart and a muted (comparison) series render without crashing', () => {
    const data = [{ k: 'a', v: 1, p: 2 }, { k: 'b', v: 3, p: null }];
    for (const kind of ['line', 'bar'] as const) {
      const { unmount } = render(<SeriesChart kind={kind} data={data} xKey="k" series={[{ key: 'v', label: 'Now' }, { key: 'p', label: 'Before', muted: true }]} title="t" onPointClick={() => {}} />);
      expect(screen.getByText('Before')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Heatmap drill links', () => {
  const hours = Array.from({ length: 24 }, (_, h) => `${h}:00`);
  const cells: HeatmapCell[] = Array.from({ length: 24 }, (_, h) => ({ value: h, lowSample: false, label: `Mon ${h}:00`, href: h === 20 ? '/explorer?by=post&wd=1&hr=20' : undefined }));

  it('a cell with an href is a link named by its label; the others stay plain cells', () => {
    render(<Heatmap caption="Best time" columns={hours} rows={[{ label: 'Mon', cells }]} lowLabel="Low" highLabel="High" />);
    const table = screen.getByRole('table', { name: 'Best time' });
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Mon 20:00');
    expect(links[0]).toHaveAttribute('href', '/explorer?by=post&wd=1&hr=20');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/charts-drill.test.tsx`
Expected: FAIL — `clickedIndex` is not exported (`TypeError: clickedIndex is not a function`) and the heatmap has no link.

- [ ] **Step 3: Edit `components/charts/SeriesChart.tsx`** — make exactly these changes:

1. In `interface Series`, after the `label` line add:
```ts
  muted?: boolean; // a secondary series (the comparison period): dashed line, lighter bar
```
2. After the `seriesColor` line add:
```ts

/** The data index a chart click landed on. Recharts 3 reports it as a number or a numeric string; anything else is null. */
export function clickedIndex(s: { activeTooltipIndex?: number | string | null } | null | undefined): number | null {
  const v = s?.activeTooltipIndex;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}
```
3. In the destructured props, after `animate = true,` add `onPointClick,`; in the props type, after the `animate?: boolean; …` line add:
```ts
  onPointClick?: (index: number) => void; // drill-down: a click on a bar / point. Mouse only: the linked table holds the keyboard path
```
4. Replace the `const common = …` line with:
```ts
  const onClick = onPointClick
    ? (state: { activeTooltipIndex?: number | string | null }) => {
        const i = clickedIndex(state);
        if (i !== null) onPointClick(i);
      }
    : undefined;
  const common = { data, responsive: true, style: { width: '100%', height, cursor: onPointClick ? 'pointer' : undefined }, title, desc, margin: { top: 8, right: 8, bottom: 0, left: 0 }, onClick };
```
5. On the `<Line …>` element add `strokeDasharray={s.muted ? '4 3' : undefined}` right after `strokeWidth={2}`; on the `<Bar …>` element add `fillOpacity={s.muted ? 0.45 : 1}` right after `fill={seriesColor(i)}`.

- [ ] **Step 4: Edit `components/charts/Heatmap.tsx`** — make exactly these changes:

1. First line: add `import Link from 'next/link';` above `import { cn } from '@/lib/utils';`.
2. In `interface HeatmapCell`, after the `label` line add:
```ts
  href?: string; // drill-down: the cell becomes a link (its accessible name is `label`)
```
3. Replace the whole `{r.cells.map((c, i) => ( <td …> … </td> ))}` block with:
```tsx
              {r.cells.map((c, i) => {
                const inner = (
                  <>
                    <span
                      aria-hidden="true"
                      data-low={c.lowSample || undefined}
                      className={cn('block aspect-square max-h-[22px] w-full rounded-[calc(var(--rs)*0.4)]', shade(c) ? undefined : 'bg-muted', c.lowSample && 'opacity-50')}
                      style={shade(c) ? { background: shade(c) } : undefined}
                    />
                    <span className="sr-only">{c.label}</span>
                  </>
                );
                return (
                  <td key={i} className="p-0" title={c.label}>
                    {c.href ? (
                      <Link href={c.href} className="block rounded-[calc(var(--rs)*0.4)] outline-none hover:ring-2 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </td>
                );
              })}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/charts-drill.test.tsx tests/charts.test.tsx`
Expected: PASS (2 files, 11 tests). Then `npx tsc --noEmit` — exit 0 (the Recharts 3 `onClick` type accepts the handler).

- [ ] **Step 6: Commit**

```bash
git add components/charts/SeriesChart.tsx components/charts/Heatmap.tsx tests/charts-drill.test.tsx
git commit -m "feat(charts): clickable chart points, muted comparison series, heatmap cell links" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Single-item level (`lib/explorer/item.ts`, `components/explorer/ItemPanel.tsx`)

**Files:**
- Create: `lib/explorer/item.ts`, `components/explorer/ItemPanel.tsx`
- Test: `tests/explorer-item.test.tsx` (new)

**Interfaces:**
- Consumes: `explorer_followers` (Task 1), table `account_daily_breakdown` (migration `20261019000001`), `ItemRow` (Task 4), `itemParts` (Task 5), `METRICS`, `formatMetric`, `MetricId` (Task 2), `safeLink`, `addDays`, `dayStart`, `localDay`, `SeriesChart` (Task 7 props unchanged), `ChartCard`, `EmptyState`, i18n `explorer.item.*`, `metrics.*`, `analysis.format.*`, `pages.account.tab.*` (Task 2 / existing).
- Produces:
  - `PRODUCT_TYPE: Record<MediaKind, string>` (`IMAGE → POST`, `CAROUSEL_ALBUM → CAROUSEL_CONTAINER`, `REELS → REEL`, `STORY → STORY`, the breakdown values verified live).
  - `interface ItemDetail { item: ItemRow; measuredAt: string | null; day: string; followers: { at: string; followers: number }[]; audience: { follower: number; nonFollower: number } | null }`, `loadItem(db, id, accounts, tz): Promise<ItemDetail | null>` (null when the item is not in one of `accounts`).
  - `<ItemPanel detail={ItemDetail | null} username={string} tabHref={string} />` (client).

- [ ] **Step 1: Write the failing test** — create `tests/explorer-item.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import en from '@/messages/en.json';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { loadItem, type ItemDetail } from '@/lib/explorer/item';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TZ = 'Asia/Kuala_Lumpur';

/** Owner-session fake: records table/rpc calls and modifiers; resolves each table/rpc to its queued result. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = [];
  const chainFor = (name: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { db: { from: (t: string) => (calls.push(['from', t]), chainFor(t)), rpc: (n: string, a: unknown) => (calls.push(['rpc', n, a]), chainFor(n)) } as unknown as SupabaseClient, calls };
}

const MEDIA = { id: '42', account_id: A, media_type: 'REELS', posted_at: '2026-10-05T15:30:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hello', media_metrics: [{ captured_at: '2026-10-07T01:00:00Z', reach: 200, views: 900, likes: 10, comments: 5, saves: 3, shares: 2 }] };

describe('loadItem', () => {
  it('reads the item only from the given accounts, then its follower curve (owner-timezone day −1 … +2) and the reach split of that day', async () => {
    const { db, calls } = fakeDb({
      media: { data: [MEDIA], error: null },
      explorer_followers: { data: [{ at: '2026-10-05T23:00', followers: 1000 }, { at: 'junk', followers: null }], error: null },
      account_daily_breakdown: { data: [{ follow_type: 'FOLLOWER', value: 60 }, { follow_type: 'NON_FOLLOWER', value: 40 }, { follow_type: 'UNKNOWN', value: 5 }], error: null },
    });
    const d = await loadItem(db, '42', [A], TZ);
    expect(calls).toContainEqual(['in', 'account_id', [A]]);
    expect(d?.day).toBe('2026-10-05'); // 15:30 UTC = 23:30 in Kuala Lumpur
    expect(calls).toContainEqual(['rpc', 'explorer_followers', { p_account: A, p_from: '2026-10-03T16:00:00.000Z', p_to: '2026-10-07T16:00:00.000Z', p_tz: TZ, p_hourly: true }]);
    expect(calls).toContainEqual(['eq', 'product_type', 'REEL']);
    expect(d).toMatchObject({ measuredAt: '2026-10-07T01:00:00Z', followers: [{ at: '2026-10-05T23:00', followers: 1000 }], audience: { follower: 60, nonFollower: 40 } });
    expect(d?.item).toMatchObject({ id: '42', mediaType: 'REELS', reach: 200, permalink: 'https://www.instagram.com/reel/x/' });
  });

  it('an item outside the accounts (or none at all) is null; no breakdown rows = no audience slice; errors are fixed text', async () => {
    expect(await loadItem(fakeDb({ media: { data: [], error: null } }).db, '42', [A], TZ)).toBeNull();
    expect(await loadItem(fakeDb({}).db, '42', [], TZ)).toBeNull();
    expect((await loadItem(fakeDb({ media: { data: [MEDIA], error: null } }).db, '42', [A], TZ))?.audience).toBeNull();
    await expect(loadItem(fakeDb({ media: { error: { message: 'secret' } } }).db, '42', [A], TZ)).rejects.toThrow('explorer read: item failed');
  });
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const DETAIL: ItemDetail = {
  item: { id: '42', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T15:30:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hello', reach: 200, views: 900, likes: 10, comments: 5, saves: 3, shares: 2 },
  measuredAt: '2026-10-07T01:00:00Z',
  day: '2026-10-05',
  followers: [{ at: '2026-10-05T23:00', followers: 1000 }, { at: '2026-10-06T00:00', followers: 1004 }],
  audience: { follower: 60, nonFollower: 40 },
};

function view(detail: ItemDetail | null) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ItemPanel detail={detail} username="brand" tabHref={`/accounts/${A}?tab=posts&from=90d`} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('ItemPanel', () => {
  it('shows the latest numbers, the links, the follower curve and the audience split', () => {
    view(DETAIL);
    expect(screen.getByRole('heading', { name: 'Reel · @brand' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/reel/x/');
    expect(screen.getByRole('link', { name: 'Open in Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts&from=90d`);
    expect(screen.getByText('Post engagement').nextSibling).toHaveTextContent('10.0%'); // (10+5+3+2) / 200
    expect(screen.getByRole('heading', { name: 'Followers around this post' })).toBeInTheDocument();
    expect(screen.getByText(/no hourly reach/)).toBeInTheDocument();
    expect(screen.getByText('Non-followers').nextSibling).toHaveTextContent('40 · 40%');
  });

  it('not in scope: an empty state; no snapshots / no breakdown: plain explanations', () => {
    view(null);
    expect(screen.getByText('This post is not in your connected accounts.')).toBeInTheDocument();
    view({ ...DETAIL, followers: [], audience: null, item: { ...DETAIL.item, mediaType: 'STORY', permalink: null } });
    expect(screen.getByText('No follower snapshots for these days yet.')).toBeInTheDocument();
    expect(screen.getByText('No follower breakdown for that day yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Stories' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open on Instagram' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-item.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/explorer/ItemPanel"`.

- [ ] **Step 3: Write `lib/explorer/item.ts`**

```ts
// The single-item level of the drill-down: one post or Story with its latest numbers, the account's follower curve
// around the posting time (follower_snapshots, the only intraday data we have) and an audience slice (that day's
// account-level reach of the item's format, followers vs non-followers). OWNER SESSION client only (RLS).
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeLink } from '@/lib/dashboard/read';
import type { ItemRow } from '@/lib/explorer/read';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, dayStart, localDay } from '@/lib/sync/time';

/** media_type → the media_product_type value of account_daily_breakdown (verified live, docs/META_PROBE_RESULTS.md).
 *  ponytail: an old feed video stored as REELS is a POST there; use media.media_product_type if that ever matters. */
export const PRODUCT_TYPE: Record<MediaKind, string> = { IMAGE: 'POST', CAROUSEL_ALBUM: 'CAROUSEL_CONTAINER', REELS: 'REEL', STORY: 'STORY' };

export interface ItemDetail {
  item: ItemRow;
  measuredAt: string | null; // when the latest snapshot was taken
  day: string; // owner-timezone day it was published
  followers: { at: string; followers: number }[]; // last value per owner-timezone hour, day −1 … day +2
  audience: { follower: number; nonFollower: number } | null; // that day's account reach of this format
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`explorer read: ${op} failed`);
}

/** One media item of the given (live, in-scope) accounts; null when it is not one of them. */
export async function loadItem(db: SupabaseClient, id: string, accounts: string[], tz: string): Promise<ItemDetail | null> {
  if (accounts.length === 0) return null;
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption,media_metrics(captured_at,reach,views,likes,comments,saves,shares)')
    .eq('id', id)
    .in('account_id', accounts)
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(1, { referencedTable: 'media_metrics' })
    .limit(1);
  if (error) fail('item');
  const r = ((data ?? []) as Row[])[0];
  if (!r || !KINDS.includes(r.media_type as string)) return null;
  const m = (Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Row | undefined) : undefined) ?? {};
  const item: ItemRow = {
    id: String(r.id),
    accountId: String(r.account_id),
    mediaType: r.media_type as MediaKind,
    postedAt: String(r.posted_at),
    permalink: safeLink(r.permalink),
    caption: typeof r.caption === 'string' ? r.caption : null,
    reach: num(m.reach),
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
    saves: num(m.saves),
    shares: num(m.shares),
  };
  const day = localDay(new Date(item.postedAt), tz);
  const [f, b] = await Promise.all([
    db.rpc('explorer_followers', { p_account: item.accountId, p_from: dayStart(addDays(day, -1), tz).toISOString(), p_to: dayStart(addDays(day, 3), tz).toISOString(), p_tz: tz, p_hourly: true }),
    db.from('account_daily_breakdown').select('follow_type,value').eq('account_id', item.accountId).eq('day', day).eq('metric', 'reach').eq('product_type', PRODUCT_TYPE[item.mediaType]),
  ]);
  if (f.error) fail('followers');
  if (b.error) fail('audience');
  const split = ((b.data ?? []) as Row[]).reduce<{ follower: number; nonFollower: number }>((acc, x) => {
    const v = num(x.value) ?? 0;
    if (x.follow_type === 'FOLLOWER') acc.follower += v;
    else if (x.follow_type === 'NON_FOLLOWER') acc.nonFollower += v;
    return acc;
  }, { follower: 0, nonFollower: 0 });
  return {
    item,
    measuredAt: typeof m.captured_at === 'string' ? m.captured_at : null,
    day,
    followers: ((f.data ?? []) as Row[]).flatMap((x) => (typeof x.at === 'string' && num(x.followers) !== null ? [{ at: x.at, followers: num(x.followers)! }] : [])),
    audience: (b.data ?? []).length ? split : null,
  };
}
```

- [ ] **Step 4: Write `components/explorer/ItemPanel.tsx`**

```tsx
'use client';

// The single-item level of the Explorer drill-down: latest numbers + links, the follower curve around the post and
// the audience slice. There is no Post Lab yet (Plan 13): this links to Instagram and to the account's Posts/Stories tab.
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { itemParts } from '@/lib/analysis/explorer';
import type { ItemDetail } from '@/lib/explorer/item';
import { formatCompact, formatDateTime, formatDay, formatHour, formatPercent } from '@/lib/format';
import { formatMetric, METRICS, type MetricId } from '@/lib/metrics';

const NUMBERS: MetricId[] = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'postEngagementRate'];

export function ItemPanel({ detail, username, tabHref }: { detail: ItemDetail | null; username: string; tabHref: string }) {
  const t = useTranslations('explorer.item');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tt = useTranslations('pages.account.tab');
  const { prefs } = usePrefs();
  if (!detail) return <EmptyState title={t('notFound')} />;
  const { item, followers, audience } = detail;
  const format = ta(`format.${item.mediaType}`);
  const parts = itemParts(item);
  // reach/views of one item are its own values; the registry computes the ratio the same way as everywhere else
  const value = (id: MetricId) => (id === 'reach' ? item.reach : id === 'views' ? item.views : METRICS[id].value(parts));
  const at = (s: string) => `${formatDay(s.slice(0, 10), prefs)} ${formatHour(Number(s.slice(11, 13)), prefs)}`;
  const total = audience ? audience.follower + audience.nonFollower : 0;

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <Card className="min-w-0">
        <CardContent className="grid min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-medium">
                {format} · @{username}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('posted', { time: formatDateTime(item.postedAt, prefs) })} · {detail.measuredAt ? t('measured', { time: formatDateTime(detail.measuredAt, prefs) }) : t('notMeasured')}
              </p>
              {item.caption ? (
                <p className="mt-1 line-clamp-2 text-xs break-words text-muted-foreground" dir="auto">
                  {item.caption}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {item.permalink ? (
                <Button asChild variant="outline" size="sm">
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    {t('openInstagram')}
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={tabHref}>{t('openTab', { tab: tt(item.mediaType === 'STORY' ? 'stories' : 'posts') })}</Link>
              </Button>
            </div>
          </div>
          <dl aria-label={t('numbers')} className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4 xl:grid-cols-7">
            {NUMBERS.map((id) => (
              <div key={id} className="min-w-0">
                <dt className="truncate text-xs text-muted-foreground">{tm(id)}</dt>
                <dd className="truncate font-medium tabular-nums">{formatMetric(id, value(id), prefs, { full: true })}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ChartCard title={t('followersTitle')} subtitle={t('followersHint')} summary={followers.length ? t('followersSummary', { from: at(followers[0].at), to: at(followers[followers.length - 1].at) }) : undefined}>
            {followers.length ? (
              <SeriesChart kind="line" data={followers} xKey="at" series={[{ key: 'followers', label: tm('followers') }]} title={t('followersTitle')} formatX={at} formatY={(n) => formatCompact(n, prefs)} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('followersEmpty')}</p>
            )}
          </ChartCard>
        </div>
        <ChartCard title={t('audienceTitle', { format })} subtitle={t('audienceHint', { format, username, day: formatDay(detail.day, prefs) })}>
          {audience && total > 0 ? (
            <dl className="grid gap-2 text-sm">
              {([['follower', audience.follower], ['nonFollower', audience.nonFollower]] as const).map(([k, v]) => (
                <div key={k} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t(k)}</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCompact(v, prefs)} · {formatPercent(v / total, prefs, 0)}
                    </dd>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                    <div className={k === 'follower' ? 'h-full rounded-full bg-chart-1' : 'h-full rounded-full bg-chart-2'} style={{ width: `${Math.round((v / total) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('audienceEmpty')}</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/explorer-item.test.tsx` and `npx tsc --noEmit`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/explorer/item.ts components/explorer/ItemPanel.tsx tests/explorer-item.test.tsx
git commit -m "feat(explorer): single-item level (latest numbers, follower curve, audience slice)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Saved views menu (`components/explorer/SavedViews.tsx`)

**Files:**
- Create: `components/explorer/SavedViews.tsx`
- Test: `tests/saved-views.test.tsx` (new)

**Interfaces:**
- Consumes: `SavedView` (Task 6, type only), `ViewResult` (Task 6, type only), `ConfirmDialog`, `FormField`, `LoadingButton`, `NavLink`, `ResponsiveDialog*`, i18n `explorer.views.*` (Task 2).
- Produces: `interface SavedViewsProps { views: SavedView[]; query: string; save(name, query); rename(id, name); remove(id) }`, `<SavedViews {...props} />` (client). The page passes the imported server actions straight through (never wrapped in a closure), like the Tags page.

- [ ] **Step 1: Write the failing test** — create `tests/saved-views.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { SavedViews, type SavedViewsProps } from '@/components/explorer/SavedViews';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const V1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const ok = async () => ({ ok: true as const });

function view(o: Partial<SavedViewsProps> = {}) {
  const props: SavedViewsProps = { views: [{ id: V1, name: 'Reels by hour', href: '/explorer?m=likes&by=hour' }], query: 'm=posts&by=format&from=90d', save: vi.fn(ok), rename: vi.fn(ok), remove: vi.fn(ok), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SavedViews {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('SavedViews', () => {
  it('lists the views as links; empty list explains what a view is', () => {
    view();
    expect(screen.getByRole('link', { name: 'Reels by hour' })).toHaveAttribute('href', '/explorer?m=likes&by=hour');
    expect(screen.getByRole('button', { name: 'Rename Reels by hour' })).toBeInTheDocument();
    view({ views: [] });
    expect(screen.getByText(/No saved views yet/)).toBeInTheDocument();
  });

  it('save: asks for a name and sends it with the current query; an error key is shown translated', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: 'duplicate' }).mockResolvedValueOnce({ ok: true });
    view({ save });
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = screen.getByRole('dialog', { name: 'Save this view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Top formats');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Top formats', 'm=posts&by=format&from=90d');
    expect(await within(dialog).findByText('A view with this name already exists.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()); // the transition has ended
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rename starts from the current name; delete asks first and sends the id', async () => {
    const user = userEvent.setup();
    const p = view();
    await user.click(screen.getByRole('button', { name: 'Rename Reels by hour' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename view' });
    const input = within(dialog).getByLabelText('Name');
    expect(input).toHaveValue('Reels by hour');
    await user.clear(input);
    await user.type(input, 'Reels per hour');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.rename).toHaveBeenCalledWith(V1, 'Reels per hour');
    await user.click(screen.getByRole('button', { name: 'Delete Reels by hour' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete “Reels by hour”?');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(p.remove).toHaveBeenCalledWith(V1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/saved-views.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/explorer/SavedViews"`.

- [ ] **Step 3: Write `components/explorer/SavedViews.tsx`**

```tsx
'use client';

// Saved Explorer views: links to the stored views, "Save view" (name dialog), rename and delete (confirmed).
// The current query is saved as is; the server re-validates it (lib/explorer/views.ts) and answers with error keys.
import { useState, useTransition } from 'react';
import { Bookmark, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { NavLink } from '@/components/shared/NavLink';
import { ResponsiveDialog, ResponsiveDialogClose, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle } from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SavedView } from '@/lib/explorer/views';
import type { ViewResult } from '@/app/(app)/explorer/actions';

export interface SavedViewsProps {
  views: SavedView[];
  query: string; // the current canonical query (Explorer + Time Scope)
  save: (name: string, query: string) => Promise<ViewResult>;
  rename: (id: string, name: string) => Promise<ViewResult>;
  remove: (id: string) => Promise<ViewResult>;
}

/** One name dialog for "save" and "rename": open while `initial` is a string. */
function NameDialog({ title, hint, initial, submit, onClose }: { title: string; hint?: string; initial: string | null; submit: (name: string) => Promise<ViewResult>; onClose: () => void }) {
  const t = useTranslations('explorer.views');
  const tErr = useTranslations('explorer.views.errors');
  const [name, setName] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog open={initial !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await submit(name);
              if (r.ok) onClose();
              else setError(tErr(r.error));
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            {hint ? <ResponsiveDialogDescription>{hint}</ResponsiveDialogDescription> : null}
          </ResponsiveDialogHeader>
          {/* no maxLength: it counts UTF-16 units; the server checks 60 characters */}
          <FormField id="view-name" label={t('name')} error={error ?? undefined}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" />}
          </FormField>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                {t('cancel')}
              </Button>
            </ResponsiveDialogClose>
            <LoadingButton type="submit" pending={pending} disabled={name.trim() === ''}>
              {t('confirm')}
            </LoadingButton>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function SavedViews({ views, query, save, rename, remove }: SavedViewsProps) {
  const t = useTranslations('explorer.views');
  const tErr = useTranslations('explorer.views.errors');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="saved-views" className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="saved-views" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setSaving(true)}>
          <Bookmark aria-hidden="true" />
          {t('save')}
        </Button>
      </div>
      {views.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
          {views.map((v) => (
            <li key={v.id} className="flex min-w-0 items-center gap-1">
              <NavLink href={v.href} className="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-sm underline-offset-4 hover:underline" dir="auto">
                {v.name}
              </NavLink>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('renameNamed', { name: v.name })} onClick={() => setRenaming(v)}>
                <Pencil aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" aria-label={t('deleteNamed', { name: v.name })} onClick={() => setDeleting(v)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <NameDialog key={saving ? 'save' : 'save-closed'} title={t('saveTitle')} hint={t('saveHint')} initial={saving ? '' : null} submit={(name) => save(name, query)} onClose={() => setSaving(false)} />
      <NameDialog key={renaming?.id ?? 'rename-closed'} title={t('renameTitle')} initial={renaming?.name ?? null} submit={(name) => rename(renaming!.id, name)} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={pending}
        error={deleteError}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={() =>
          deleting &&
          start(async () => {
            const r = await remove(deleting.id);
            if (r.ok) setDeleting(null);
            else setDeleteError(tErr(r.error));
          })
        }
      />
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/saved-views.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add components/explorer/SavedViews.tsx tests/saved-views.test.tsx
git commit -m "feat(explorer): saved views menu (save, rename, delete)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Server loader + row labels (`lib/explorer/load.ts`, `lib/explorer/labels.ts`)

**Files:**
- Create: `lib/explorer/load.ts`, `lib/explorer/labels.ts`
- Test: `tests/explorer-load.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 8; `loadTags` (`lib/dashboard/detail-read.ts`), 12a `loadFirstDay(db, accountIds)` (`lib/dashboard/read.ts`, 12a Task 10), `StoredAccount`, `SyncStatus` (`lib/sync/store.ts`, `dailyDoneThrough`), 12a `parseTimeScope`, `resolveScope`, `ResolvedScope`, `DayRange`, `Granularity`; `formatDateTime`, `formatDay`, `formatHour`, `formatMonth`; `translator` (`lib/export/workbook.ts`, test only).
- Produces:
  - `interface ExplorerData { state; scope: ResolvedScope; window: { current: DayRange; compare: DayRange | null }; live: ScopeAccount[]; accounts: ScopeAccount[]; groups: string[]; tags: Tag[]; model: ExplorerModel; items: ItemRow[]; truncated: boolean; item: ItemDetail | null }`
  - `loadExplorer(db, sp: Record<string, string | string[] | undefined>, o: { today; tz; weekStart; accounts: StoredAccount[]; sync: Record<string, SyncStatus> }): Promise<ExplorerData>` — the ONE loader of the page (Task 12) and the export (Task 11).
  - `type Translate = (key, values?) => string`, `interface LabelContext { accounts; tags; items; gran }`, `rowLabel(by, key, ctx, t, prefs): string` — the same row text on screen and in Excel.

Flow: parse the state → live accounts (archived hidden) → accounts kept by the account/group filters → first captured day (12a `loadFirstDay`, for "all" and the coverage note) + tags → `resolveScope(parseTimeScope(sp, weekStart), today, earliest)` → `explorerWindow(scope, settledDay(...))` → item level, single posts, or current + comparison rollups in parallel → `buildExplorer`.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-load.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import en from '@/messages/en.json';
import type { StoredAccount } from '@/lib/accounts/types';
import { rowLabel, type LabelContext } from '@/lib/explorer/labels';
import { loadExplorer } from '@/lib/explorer/load';
import { translator } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const acct = (id: string, username: string, groupName: string | null, status: StoredAccount['status'] = 'active'): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName, status, archivedAt: status === 'archived' ? '2026-01-01T00:00:00Z' : null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-01-01T00:00:00Z' });
const ACCOUNTS = [acct(B, 'beta', 'Food'), acct(A, 'alpha', 'Food'), acct(C, 'gamma', null, 'archived')];
const SYNC = { [A]: { lastSuccessAt: null, lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-15' } };
const O = { today: '2026-10-17', tz: 'UTC', weekStart: 'mon' as const, accounts: ACCOUNTS, sync: SYNC };

/** Owner-session fake: records table/rpc calls; resolves each name to its result. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const calls: unknown[][] = [];
  const chainFor = (name: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { db: { from: (t: string) => (calls.push(['from', t]), chainFor(t)), rpc: (n: string, a: unknown) => (calls.push(['rpc', n, a]), chainFor(n)) } as unknown as SupabaseClient, calls };
}
const rpcs = (calls: unknown[][]) => calls.filter((c) => c[0] === 'rpc').map((c) => [c[1], (c[2] as { p_from: string }).p_from, (c[2] as { p_to: string }).p_to]);

describe('loadExplorer', () => {
  it('archived accounts are hidden; the window ends on the settled day; the comparison is a second rollup', async () => {
    const { db, calls } = fakeDb({ explorer_daily: { data: [{ key: A, reach: 10 }], error: null }, account_daily: { data: [{ day: '2026-01-01' }], error: null } });
    const d = await loadExplorer(db, { m: 'reach' }, O);
    expect(d.live.map((a) => a.username)).toEqual(['alpha', 'beta']);
    expect(d.groups).toEqual(['Food']);
    expect(d.window).toEqual({ current: { from: '2026-09-16', to: '2026-10-15' }, compare: { from: '2026-08-17', to: '2026-09-15' } });
    expect(rpcs(calls)).toEqual([['explorer_daily', '2026-09-16', '2026-10-15'], ['explorer_daily', '2026-08-17', '2026-09-15']]);
    expect(d.model.rows.map((r) => [r.key, r.values.reach?.value])).toEqual([[A, 10], [B, null]]);
  });

  it('account and group filters intersect; an unknown or archived id is simply not in scope', async () => {
    const { db } = fakeDb();
    expect((await loadExplorer(db, { acc: `${A},${C}`, grp: 'Food' }, O)).accounts.map((a) => a.id)).toEqual([A]);
    expect((await loadExplorer(db, { grp: 'Nope' }, O)).accounts).toEqual([]);
  });

  it('single posts read the capped list (no rollup); the item level reads only the item', async () => {
    const posts = fakeDb({ explorer_media: { data: [{ id: 'm1', account_id: A, media_type: 'IMAGE', posted_at: '2026-10-01T00:00:00Z', permalink: null, caption: null, reach: 5, views: null, likes: 1, comments: 0, saves: 0, shares: 0 }], error: null } });
    const d = await loadExplorer(posts.db, { by: 'post', from: '7d', cmp: 'none' }, O);
    expect(rpcs(posts.calls).map((c) => c[0])).toEqual(['explorer_media']);
    expect(d.model.rows.map((r) => r.key)).toEqual(['m1']);
    const item = fakeDb();
    const i = await loadExplorer(item.db, { item: '42' }, O);
    expect(i.item).toBeNull(); // not found in the fake: the page shows "not in your accounts"
    expect(rpcs(item.calls)).toEqual([]);
    expect(item.calls).toContainEqual(['eq', 'id', '42']);
  });
});

describe('rowLabel', () => {
  const t = translator('en');
  const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
  const c: LabelContext = { accounts: [{ id: A, username: 'alpha', groupName: 'Food' }], tags: [{ id: 't1', name: 'Promo', color: 'chart-1' }], items: [{ id: 'm1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T09:30:00Z', permalink: null, caption: null, reach: null, views: null, likes: null, comments: null, saves: null, shares: null }], gran: 'week' };

  it('reads the same on screen and in the file', () => {
    expect(rowLabel('account', A, c, t, P)).toBe('@alpha');
    expect(rowLabel('group', 'g:Food', c, t, P)).toBe('Food');
    expect(rowLabel('group', `a:${A}`, c, t, P)).toBe('@alpha');
    expect(rowLabel('format', 'CAROUSEL_ALBUM', c, t, P)).toBe(en.analysis.format.CAROUSEL_ALBUM);
    expect(rowLabel('tag', 't1', c, t, P)).toBe('Promo');
    expect(rowLabel('tag', 'untagged', c, t, P)).toBe(en.explorer.untagged);
    expect(rowLabel('tag', 'gone', c, t, P)).toBe(en.explorer.deletedTag);
    expect(rowLabel('weekday', '0', c, t, P)).toBe('Sun');
    expect(rowLabel('hour', '9', c, t, P)).toBe('09:00');
    expect(rowLabel('time', '2026-10-05', c, t, P)).toBe('Week of 5 Oct 2026');
    expect(rowLabel('time', '2026-10-01', { ...c, gran: 'month' }, t, P)).toBe('October 2026');
    expect(rowLabel('post', 'm1', c, t, P)).toBe('Reel · 5 Oct 2026 09:30');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-load.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/explorer/labels"`.

- [ ] **Step 3: Write `lib/explorer/labels.ts`**

```ts
// Row labels of the Explorer, shared by the page (useTranslations) and the Excel export (server translator), so a
// row reads the same on screen and in the file. Pure: the translator and the format preferences are inputs.
import type { ScopeAccount } from '@/lib/analysis/explorer';
import type { Tag } from '@/lib/analysis/types';
import type { ItemRow } from '@/lib/explorer/read';
import { formatDateTime, formatDay, formatHour, formatMonth, type FormatPrefs } from '@/lib/format';
import type { DimensionId } from '@/lib/metrics';
import type { Granularity } from '@/lib/time-scope/range';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface LabelContext {
  accounts: ScopeAccount[];
  tags: Tag[];
  items: ItemRow[];
  gran: Granularity;
}

const user = (c: LabelContext, id: string) => `@${c.accounts.find((a) => a.id === id)?.username ?? '?'}`;

export function rowLabel(by: DimensionId, key: string, c: LabelContext, t: Translate, p: FormatPrefs): string {
  switch (by) {
    case 'account':
      return user(c, key);
    case 'group':
      return key.startsWith('g:') ? key.slice(2) : user(c, key.slice(2));
    case 'format':
      return t(`analysis.format.${key}`);
    case 'tag':
      return key === 'untagged' ? t('explorer.untagged') : (c.tags.find((x) => x.id === key)?.name ?? t('explorer.deletedTag'));
    case 'weekday':
      return t(`analysis.weekday.${key}`);
    case 'hour':
      return formatHour(Number(key), p);
    case 'time':
      return c.gran === 'month' ? formatMonth(key.slice(0, 7), p) : c.gran === 'week' ? t('explorer.weekOf', { day: formatDay(key, p) }) : formatDay(key, p);
    case 'post': {
      const it = c.items.find((x) => x.id === key);
      return it ? `${t(`analysis.format.${it.mediaType}`)} · ${formatDateTime(it.postedAt, p)}` : key;
    }
  }
}
```

- [ ] **Step 4: Write `lib/explorer/load.ts`**

```ts
// Everything one Explorer view needs, for the page AND the Excel export (two callers, one loader): URL → state and
// Time Scope → accounts in scope → window → the fixed RPCs → the model. OWNER SESSION client only (RLS).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import { buildExplorer, explorerWindow, settledDay, type ExplorerModel, type ScopeAccount } from '@/lib/analysis/explorer';
import type { Tag } from '@/lib/analysis/types';
import { loadTags } from '@/lib/dashboard/detail-read';
import { loadFirstDay } from '@/lib/dashboard/read';
import { loadItem, type ItemDetail } from '@/lib/explorer/item';
import { loadItems, loadRollup, type ItemRow, type RollupQuery } from '@/lib/explorer/read';
import { parseExplorerState, type ExplorerState } from '@/lib/explorer/state';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';
import type { DayRange } from '@/lib/time-scope/range';
import { parseTimeScope, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';

export interface ExplorerData {
  state: ExplorerState;
  scope: ResolvedScope;
  window: { current: DayRange; compare: DayRange | null };
  live: ScopeAccount[]; // every live account, by username (filter choices)
  accounts: ScopeAccount[]; // the ones the filters keep
  groups: string[]; // named groups A→Z
  tags: Tag[];
  model: ExplorerModel;
  items: ItemRow[]; // single posts (by = 'post')
  truncated: boolean;
  item: ItemDetail | null; // the single-item level (state.item)
}

type Params = Record<string, string | string[] | undefined>;

export async function loadExplorer(db: SupabaseClient, sp: Params, o: { today: string; tz: string; weekStart: WeekStart; accounts: StoredAccount[]; sync: Record<string, SyncStatus> }): Promise<ExplorerData> {
  const state = parseExplorerState(sp);
  const live: ScopeAccount[] = o.accounts
    .filter((a) => a.status !== 'archived') // archived = hidden from every view (SPEC §7c)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((a) => ({ id: a.id, username: a.username, groupName: a.groupName }));
  const accounts = live.filter((a) => (state.group === null || a.groupName === state.group) && (state.accounts.length === 0 || state.accounts.includes(a.id)));
  const ids = accounts.map((a) => a.id);
  const [earliest, tags] = await Promise.all([loadFirstDay(db, ids), loadTags(db)]);
  const scope = resolveScope(parseTimeScope(sp, o.weekStart), o.today, earliest);
  const window = explorerWindow(scope, settledDay(accounts.map((a) => o.sync[a.id]?.dailyDoneThrough), o.today));
  const q: RollupQuery = { accounts: ids, from: window.current.from, to: window.current.to, tz: o.tz, weekStart: o.weekStart, grain: scope.gran };
  const base = { state, scope, window, live, accounts, groups: [...new Set(live.flatMap((a) => (a.groupName ? [a.groupName] : [])))].sort((a, b) => a.localeCompare(b)), tags };
  const empty: ExplorerModel = { rows: [], partial: [] };
  if (state.item !== null) return { ...base, model: empty, items: [], truncated: false, item: await loadItem(db, state.item, ids, o.tz) };
  if (state.by === 'post') {
    const { items, truncated } = await loadItems(db, state, q);
    return { ...base, items, truncated, item: null, model: buildExplorer({ state, window, current: new Map(), prior: null, accounts, items, gran: scope.gran, weekStart: o.weekStart }) };
  }
  const [current, prior] = await Promise.all([loadRollup(db, state, q), window.compare ? loadRollup(db, state, { ...q, from: window.compare.from, to: window.compare.to }) : null]);
  return { ...base, items: [], truncated: false, item: null, model: buildExplorer({ state, window, current, prior, accounts, items: [], gran: scope.gran, weekStart: o.weekStart }) };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/explorer-load.test.ts` and `npx tsc --noEmit`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/explorer/load.ts lib/explorer/labels.ts tests/explorer-load.test.ts
git commit -m "feat(explorer): one server loader for page and export; shared row labels" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Excel export of the current view (`GET /api/export/explorer`)

**Files:**
- Create: `app/api/export/explorer/route.ts`, `lib/export/explorer.ts`
- Modify: `lib/export/workbook.ts` (export `Kind`, `Col`, `sheet`; `cellOf`/`sheet` take only `Pick<WorkbookOptions, 'prefs'>` — the only field they read)
- Test: `tests/explorer-export.test.ts` (new). `tests/export-workbook.test.ts` and `tests/export-xlsx-route.test.ts` must keep passing unchanged.

**Interfaces:**
- Consumes: `loadExplorer`, `ExplorerData`, `rowLabel` (Task 10), `viewState` (Task 6), `assertOwner`, `supabaseAccountsStore`, `listSyncStatus`, `getPrefs`, `createServerSupabase({ responseHeaders })`, `exportHeaders`/`exportError`/`exportFile` (`lib/export/request.ts`), `contentDisposition` (`lib/export/filename.ts`), `translator`, `writeWorkbook`, `sheetNames`, `serverTiming`/`timed` (`lib/server-timing.ts`); i18n `explorer.title`, `explorer.previous`, `explorer.by.*`, `export.cols.*`.
- Produces: `GET /api/export/explorer?<canonical query>` → `.xlsx` attachment named `in2sight-explorer-<from>_<to>.xlsx`, header `Server-Timing: explorer;dur=…`; errors `{ error: 'unauthorized' | 'bad_params' | 'unexpected' }` (the export dialog's existing keys). `buildExplorerSheet(d, t, prefs): WorkbookSheet[]`.

Strictness: the route recomputes the canonical query (`viewState`) and answers `bad_params` unless the request is EXACTLY that query — no extra, repeated, reordered or shorthand keys — before any read. The page builds the link from the same canonical parts, so a real click always matches.

- [ ] **Step 1: Write the failing test** — create `tests/explorer-export.test.ts`:

```ts
// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const state = vi.hoisted(() => ({ owner: true, prefs: null as Prefs | null, rpcs: [] as string[], fail: false }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return state.owner;
  },
}));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => state.prefs }));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: async () => ({}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({
  supabaseAccountsStore: () => ({ list: async () => [{ id: A, igUserId: '1', username: 'brand=one', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-01-01T00:00:00Z' }] }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => {
    const chain = (name: string) => {
      const c: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'order', 'limit']) c[op] = () => c;
      const data: Record<string, unknown[]> = {
        explorer_daily: [{ key: A, reach: 1200, views: 3000, interactions: 90, er_interactions: 90, er_reach: 1200, net_follows: 4, followers: 900 }],
        explorer_posts: [{ key: A, posts: 3, measured: 3, reach_sum: 600, views_sum: 900, views_n: 3, likes: 30, comments: 3, saves: 2, shares: 1, er_interactions: 36, er_reach: 600 }],
      };
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(state.fail ? { data: null, error: { message: 'secret-row' } } : { data: data[name] ?? [], error: null }).then(res);
      return c;
    };
    return { from: (t: string) => chain(t), rpc: (n: string) => (state.rpcs.push(n), chain(n)) };
  },
}));

import { GET } from '@/app/api/export/explorer/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/explorer?${qs}`, 'https://app.test')));
beforeEach(() => {
  state.owner = true;
  state.prefs = { ...DEFAULT_PREFS, timezone: 'UTC' };
  state.rpcs = [];
  state.fail = false;
});

describe('GET /api/export/explorer', () => {
  it('401 for anyone but the owner, uncached, nothing read', async () => {
    state.owner = false;
    const res = await get('m=reach&by=account');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.rpcs).toEqual([]);
  });

  it('400 bad_params for anything that is not the canonical query, before any read', async () => {
    for (const qs of ['', 'by=account', 'm=reach&by=account&m=reach', 'm=reach&by=drop', 'm=reach&by=account&x=1', 'm=reach&by=account&month=2026-09', 'by=account&m=reach', 'm=reach&by=account&acc=nope']) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_params' });
    }
    expect(state.rpcs).toEqual([]);
  });

  it('200: one sheet with the view, previous + change columns when comparing, Server-Timing, private + no-store', async () => {
    const res = await get('m=reach%2CengagementRate%2Cposts&by=account&from=90d');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('server-timing')).toMatch(/^explorer;dur=\d+\.\d$/);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="in2sight-explorer-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx"/);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('name="Explorer"');
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    for (const s of ['Account', 'Reach', 'Reach (previous)', 'Reach change', 'Posts', '@brand=one']) expect(strings).toContain(s);
    expect(state.rpcs).toEqual(['explorer_daily', 'explorer_posts', 'explorer_daily', 'explorer_posts']); // current + comparison
  });

  it('no comparison: no previous/change columns; zh-CN headers', async () => {
    state.prefs = { ...DEFAULT_PREFS, locale: 'zh-CN', timezone: 'UTC' };
    const zip = unzipSync(new Uint8Array(await (await get('m=reach&by=account&cmp=none')).arrayBuffer()));
    const strings = strFromU8(zip['xl/sharedStrings.xml']);
    expect(strings).toContain('触达');
    expect(strings).not.toContain('之前');
  });

  it('a failed read is 500 unexpected with a fixed log line, never the database text', async () => {
    state.fail = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('m=reach&by=account');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unexpected' });
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret-row');
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/explorer-export.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/export/explorer/route"`.

- [ ] **Step 3: Edit `lib/export/workbook.ts`** — exactly this diff (12a edits other parts of the file; apply by hand if the context lines moved):

```diff
diff --git a/lib/export/workbook.ts b/lib/export/workbook.ts
index db93009..50693a8 100644
--- a/lib/export/workbook.ts
+++ b/lib/export/workbook.ts
@@ -35,9 +35,9 @@ export interface WorkbookSheet {
   stickyRowsCount: number; // the header row stays visible ("frozen")
 }
 
-type Kind = 'text' | 'count' | 'avg' | 'percent' | 'date' | 'datetime';
+export type Kind = 'text' | 'count' | 'avg' | 'percent' | 'date' | 'datetime';
 type Value = string | number | null | undefined;
-interface Col<R> {
+export interface Col<R> {
   header: string;
   kind: Kind;
   width: number;
@@ -55,7 +55,7 @@ export interface WorkbookOptions {
 const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];
 const num = (v: Value) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
 
-function cellOf(kind: Kind, v: Value, o: WorkbookOptions): Cell {
+function cellOf(kind: Kind, v: Value, o: Pick<WorkbookOptions, 'prefs'>): Cell {
   if (kind === 'text') {
     const s = safeText(typeof v === 'string' ? v : null);
     return s === null ? null : { value: s, type: String };
@@ -72,7 +72,7 @@ function cellOf(kind: Kind, v: Value, o: WorkbookOptions): Cell {
   return { value: n, type: Number, format: kind === 'percent' ? PERCENT_FORMAT : kind === 'avg' ? AVG_FORMAT : COUNT_FORMAT };
 }
 
-function sheet<R>(name: string, cols: Col<R>[], rows: R[], o: WorkbookOptions): Omit<WorkbookSheet, 'sheet'> & { name: string } {
+export function sheet<R>(name: string, cols: Col<R>[], rows: R[], o: Pick<WorkbookOptions, 'prefs'>): Omit<WorkbookSheet, 'sheet'> & { name: string } {
   return {
     name,
     data: [cols.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' as const })), ...rows.map((r) => cols.map((c) => cellOf(c.kind, c.get(r), o)))],
```

- [ ] **Step 4: Write `lib/export/explorer.ts`**

```ts
// The Excel export of the current Explorer view: one sheet = the table on screen (dimension, the selected metrics, and
// "previous" + change columns when comparing). Same cell rules as every export sheet (lib/export/workbook.ts): numbers
// are number cells, time buckets are real date cells, missing values are EMPTY cells, user text goes through safeText.
import type { ExplorerRow } from '@/lib/analysis/explorer';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { sheetNames } from '@/lib/export/cells';
import { sheet, type Col, type Kind, type Translate, type WorkbookSheet } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';
import { METRICS, type MetricId } from '@/lib/metrics';

type Data = Pick<ExplorerData, 'state' | 'model' | 'accounts' | 'tags' | 'items' | 'scope' | 'window'>;

const kindOf = (m: MetricId): Kind => (METRICS[m].kind === 'percent' ? 'percent' : m === 'avgReach' || m === 'avgViews' ? 'avg' : 'count');

export function buildExplorerSheet(d: Data, t: Translate, prefs: FormatPrefs): WorkbookSheet[] {
  const { state: s } = d;
  const ctx = { accounts: d.accounts, tags: d.tags, items: d.items, gran: d.scope.gran };
  const item = new Map(d.items.map((i) => [i.id, i]));
  const user = new Map(d.accounts.map((a) => [a.id, a.username]));
  const compare = d.window.compare !== null && s.by !== 'post';
  const lead: Col<ExplorerRow>[] =
    s.by === 'time'
      ? [{ header: t('explorer.by.time'), kind: 'date', width: 13, get: (r) => r.key }]
      : s.by === 'post'
        ? [
            { header: t('export.cols.account'), kind: 'text', width: 24, get: (r) => user.get(item.get(r.key)?.accountId ?? '') },
            { header: t('export.cols.postedAt'), kind: 'datetime', width: 18, get: (r) => item.get(r.key)?.postedAt },
            { header: t('export.cols.type'), kind: 'text', width: 11, get: (r) => (item.get(r.key) ? t(`analysis.format.${item.get(r.key)!.mediaType}`) : null) },
            { header: t('export.cols.caption'), kind: 'text', width: 50, get: (r) => item.get(r.key)?.caption },
            { header: t('export.cols.permalink'), kind: 'text', width: 34, get: (r) => item.get(r.key)?.permalink },
          ]
        : [{ header: t(`explorer.by.${s.by}`), kind: 'text', width: 24, get: (r) => rowLabel(s.by, r.key, ctx, t, prefs) }];
  const metrics = s.metrics.flatMap((m): Col<ExplorerRow>[] => {
    const metric = t(`metrics.${m}`);
    const value: Col<ExplorerRow> = { header: metric, kind: kindOf(m), width: 13, get: (r) => r.values[m]?.value };
    if (!compare) return [value];
    return [
      value,
      { header: t('explorer.previous', { metric }), kind: kindOf(m), width: 13, get: (r) => r.values[m]?.prior },
      { header: t('export.cols.change', { metric }), kind: 'percent', width: 13, get: (r) => r.values[m]?.change },
    ];
  });
  const built = sheet(t('explorer.title'), [...lead, ...metrics], d.model.rows, { prefs });
  return [{ sheet: sheetNames([built.name])[0], data: built.data, columns: built.columns, stickyRowsCount: built.stickyRowsCount }];
}
```

- [ ] **Step 5: Write `app/api/export/explorer/route.ts`**

```ts
import type { NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { loadExplorer } from '@/lib/explorer/load';
import { viewState } from '@/lib/explorer/views';
import { buildExplorerSheet } from '@/lib/export/explorer';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportFile, exportHeaders } from '@/lib/export/request';
import { translator, writeWorkbook } from '@/lib/export/workbook';
import { getPrefs } from '@/lib/prefs.server';
import { serverTiming, timed, type Span } from '@/lib/server-timing';
import { createServerSupabase } from '@/lib/supabase/server';
import { listSyncStatus } from '@/lib/sync/store';
import { localDay } from '@/lib/sync/time';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * GET /api/export/explorer?<the Explorer's canonical query> — owner session only. The query must be exactly what the
 * page links to (canonical Explorer + Time Scope parameters); anything else, repeated or extra is `bad_params`.
 * `Server-Timing: explorer;dur=…` = the same loader as the page (docs/RUNBOOK_EXPLORER.md §4).
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const prefs = await getPrefs(); // timezone + formats: the owner's; the sync writes days in it too
    if (q.size === 0 || new URLSearchParams(viewState(q.toString(), prefs.weekStart)).toString() !== q.toString()) return exportError(h, 400, 'bad_params');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const today = localDay(new Date(), prefs.timezone);
    const spans: Span[] = [];
    const d = await timed(spans, 'explorer', async () => {
      const [accounts, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
      return loadExplorer(db, Object.fromEntries(q), { today, tz: prefs.timezone, weekStart: prefs.weekStart, accounts, sync });
    });
    h.set('server-timing', serverTiming(spans));
    const file = await writeWorkbook(buildExplorerSheet(d, translator(prefs.locale), prefs));
    return exportFile(h, file, XLSX, contentDisposition(`in2sight-explorer-${d.window.current.from}_${d.window.current.to}`, 'xlsx'));
  } catch {
    console.error('explorer export failed'); // fixed text: never log error objects (they can carry row values)
    return exportError(h, 500, 'unexpected');
  }
}
```

The route is NOT added to `lib/auth/route-policy.ts` (no public exemption): the proxy already requires a session, and `assertOwner` runs first.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/explorer-export.test.ts tests/export-workbook.test.ts tests/export-xlsx-route.test.ts` and `npx tsc --noEmit`
Expected: PASS (3 files); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/api/export/explorer/route.ts lib/export/explorer.ts lib/export/workbook.ts tests/explorer-export.test.ts
git commit -m "feat(export): Excel export of the current Explorer view with Server-Timing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Explorer page + nav item

**Files:**
- Create: `app/(app)/explorer/page.tsx`, `app/(app)/explorer/loading.tsx`, `components/explorer/ExplorerView.tsx`
- Modify: `lib/nav.ts`, `components/shared/AppShell.tsx`, `tests/nav.test.ts`, `tests/app-shell.test.tsx`
- Test: `tests/explorer-view.test.tsx` (new). `tests/route-loading.test.tsx` (every page has a page-shaped `loading.tsx` with one status orb) must pass with the new route.

**Interfaces:**
- Consumes: `loadExplorer`, `ExplorerData` (Task 10), `rowLabel` (Task 10), `breadcrumbs`, `drillHref`, `ExplorerRow` (Task 5), `explorerHref`, `explorerParams`, `FORMATS`, `MAX_METRICS`, `usable`, `withState` (Task 3), `DIMENSIONS`, `METRIC_IDS`, `formatMetric` (Task 2), `SeriesChart` `onPointClick`/`muted` (Task 7), `ItemPanel` (Task 8), `SavedViews` (Task 9), `loadViews` (Task 6), `saveViewAction`/`renameViewAction`/`deleteViewAction` (Task 6), `downloadExport` (`lib/export/download.ts`), 12a `TimeScopeBar({ scope, today, keep })`, `loadAccounts`/`loadSyncStatus` (`lib/dashboard/cached.ts`), `requireOwner`, `getPrefs`, `createServerSupabase`.
- Produces: route `/explorer` (owner only), `ExplorerView({ data, today, views, save, rename, remove })` (client), nav item `{ href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined }` between Calendar and Settings, a 6-column phone tab bar.

Layout (desktop-first): from `lg` a 17rem settings column (sticky, scrolls on its own) + the results; below `lg` the settings stack above the results. Settings are ONE GET form (`next/form` + `startProgress(formHref(form))`, like the Posts filters): metrics and picked accounts are kept in React state and submitted as ONE comma-joined hidden field each (a repeated key would count as missing); the scope parameters ride along as hidden fields. Metrics the chosen breakdown cannot show are disabled live; the chart select follows the chosen metrics. Results: removable filter chips (tag/weekday/hour), the "no hourly reach" hint for weekday/hour, a ChartCard (bars for categories, a line over time, the comparison as a muted series; clicking a point drills like the row link), the DataTable (first column = the drill link, change pills from `useKpiDelta`, "Show more" for single posts), partial-bucket and 500-post notes. The export button sends the canonical query of the view (state + `scope.params`) to `/api/export/explorer`.

- [ ] **Step 1: Write the failing tests** — create `tests/explorer-view.test.tsx`:

```tsx
import { existsSync, readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ExplorerView } from '@/components/explorer/ExplorerView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildExplorer, toKpi, type ScopeAccount } from '@/lib/analysis/explorer';
import type { ExplorerData } from '@/lib/explorer/load';
import { parseExplorerState } from '@/lib/explorer/state';
import type { Parts } from '@/lib/metrics';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
const download = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/export/download', () => ({ downloadExport: (...a: unknown[]) => download(...(a as [])) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
  download.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-17';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const LIVE: ScopeAccount[] = [{ id: A, username: 'alpha', groupName: 'Food' }, { id: B, username: 'beta', groupName: null }];
const daily = (reach: number): Parts => ({ daily: { reach, views: null, interactions: null, erInteractions: null, erReach: null, netFollows: null, followers: null }, posts: null });

function data(q: Record<string, string>, o: Partial<ExplorerData> = {}): ExplorerData {
  const state = parseExplorerState(q);
  const scope = resolveScope(parseTimeScope(q), TODAY, '2026-01-01');
  const window = { current: { from: '2026-09-16', to: '2026-10-15' }, compare: scope.scope.cmp === 'none' ? null : { from: '2026-08-17', to: '2026-09-15' } };
  const model = buildExplorer({ state, window, current: new Map([[A, daily(300)], [B, daily(100)]]), prior: window.compare ? new Map([[A, daily(200)]]) : null, accounts: LIVE, items: [], gran: scope.gran, weekStart: 'mon' });
  return { state, scope, window, live: LIVE, accounts: LIVE, groups: ['Food'], tags: [], model, items: [], truncated: false, item: null, ...o };
}

function view(d: ExplorerData) {
  const actions = { save: vi.fn(async () => ({ ok: true as const })), rename: vi.fn(async () => ({ ok: true as const })), remove: vi.fn(async () => ({ ok: true as const })) };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ExplorerView data={d} today={TODAY} views={[]} {...actions} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return actions;
}

describe('ExplorerView: results', () => {
  it('rows link one level deeper and keep the scope; values show their change; the chart is titled by metric and dimension', () => {
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    const table = screen.getByRole('table', { name: 'Explorer results' });
    expect(within(table).getByRole('link', { name: 'Show @alpha in detail' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=format&acc=${A}&from=90d`); // reach has no format split: post metrics take over
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('+50.0%'); // 300 vs 200
    expect(screen.getByRole('heading', { name: 'Reach by Account' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Drill-down path' })).toHaveTextContent('All accounts');
    expect(screen.getByText('Data from 16 Sep 2026 to 15 Oct 2026 · compared with 17 Aug 2026 to 15 Sep 2026')).toBeInTheDocument();
  });

  it('the Time Scope bar keeps the Explorer parameters in every preset link', () => {
    view(data({ m: 'reach', by: 'account' }));
    expect(screen.getByRole('link', { name: en.timeScope.preset['7d'] })).toHaveAttribute('href', '?m=reach&by=account&from=7d');
  });

  it('export sends the canonical view query; the item level has no export button', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    await user.click(screen.getByRole('button', { name: 'Export view' }));
    expect(download).toHaveBeenCalledWith('/api/export/explorer?m=reach&by=account&from=90d', 'xlsx');
  });

  it('filter chips remove one filter and keep the rest; weekday/hour views say there is no hourly reach', () => {
    view(data({ m: 'posts', by: 'hour', wd: '3', from: '90d' }));
    expect(screen.getByRole('link', { name: 'Remove filter Wed' })).toHaveAttribute('href', '/explorer?m=posts&by=hour&from=90d');
    expect(screen.getByText(/no hourly reach/)).toBeInTheDocument();
  });

  it('single posts: no chart, the cut is explained', () => {
    view(data({ by: 'post' }, { truncated: true, items: [], model: { rows: [], partial: [] } }));
    expect(screen.queryByRole('heading', { name: /by Single posts/ })).toBeNull();
    expect(screen.getByText(/Showing the newest 0 posts/)).toBeInTheDocument();
  });

  it('no accounts yet: an empty state that links to Accounts', () => {
    view(data({}, { live: [], accounts: [] }));
    expect(screen.getByRole('link', { name: en.pages.overview.addAccount })).toHaveAttribute('href', '/accounts');
  });
});

describe('ExplorerView: settings form', () => {
  const hidden = () => Object.fromEntries([...document.querySelectorAll<HTMLInputElement>('form[aria-label="Explorer settings"] input[type=hidden]')].map((i) => [i.name, i.value]));

  it('metrics and accounts are joined into one parameter each; the scope rides along', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    expect(hidden()).toMatchObject({ m: 'reach', from: '90d' });
    await user.click(screen.getByRole('checkbox', { name: 'Likes' }));
    await user.click(screen.getByRole('checkbox', { name: '@beta' }));
    expect(hidden()).toMatchObject({ m: 'reach,likes', acc: B });
  });

  it('grouping by something account totals cannot show disables them and drops them from the query', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach,likes', by: 'account' }));
    await user.selectOptions(screen.getByLabelText('Break down by'), 'format');
    expect(screen.getByRole('checkbox', { name: 'Reach' })).toBeDisabled();
    expect(hidden().m).toBe('likes');
  });
});

describe('ExplorerView: item level', () => {
  it('shows the post with breadcrumbs down to its day and links to the account tab with the scope', () => {
    const item = { item: { id: '42', accountId: A, mediaType: 'REELS' as const, postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: null, reach: 10, views: null, likes: 1, comments: 0, saves: 0, shares: 0 }, measuredAt: null, day: '2026-10-05', followers: [], audience: null };
    view(data({ m: 'likes', by: 'post', acc: A, fmt: 'REELS', item: '42', from: '90d' }, { item }));
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' });
    expect(within(crumbs).getByRole('link', { name: '@alpha' })).toHaveAttribute('href', `/explorer?m=likes&by=format&acc=${A}&from=90d`);
    expect(within(crumbs).getByText('5 Oct 2026')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Open in Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts&from=90d`);
    expect(screen.queryByRole('button', { name: 'Export view' })).toBeNull();
  });
});

// The view is a client component: its runtime imports must never reach the server readers, stores or Excel writer.
const RUNTIME_IMPORT = /^import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](@\/[^'"]+)['"]/gm;
function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const file = ['.ts', '.tsx'].map((e) => `${entry.replace('@/', '')}${e}`).find(existsSync);
  if (!file) return seen;
  for (const m of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) graph(m[1], seen);
  return seen;
}

describe('client module graph', () => {
  it('ExplorerView never pulls the Explorer readers, the stores, the actions or the workbook writer', () => {
    const mods = [...graph('@/components/explorer/ExplorerView')];
    expect(mods).toContain('@/lib/analysis/explorer');
    expect(mods.filter((m) => /explorer\/(read|item|load|views)|explorer\/actions|sync\/store|supabase|dashboard\/(read|detail-read|cached)|export\/workbook/.test(m))).toEqual([]);
  });
});
```

In `tests/nav.test.ts` and `tests/app-shell.test.tsx` make exactly these edits:

```diff
diff --git a/tests/nav.test.ts b/tests/nav.test.ts
index 736ada3..28784ab 100644
--- a/tests/nav.test.ts
+++ b/tests/nav.test.ts
@@ -2,9 +2,9 @@ import { describe, expect, it } from 'vitest';
 import { NAV_ITEMS, isActive } from '@/lib/nav';
 
 describe('navigation model', () => {
-  it('lists the five main destinations in order', () => {
-    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/settings']);
-    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'settings']);
+  it('lists the six main destinations in order', () => {
+    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/explorer', '/settings']);
+    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'explorer', 'settings']);
   });
 
   it('isActive matches the route and its children, not look-alike prefixes', () => {
diff --git a/tests/app-shell.test.tsx b/tests/app-shell.test.tsx
index 7acdeae..9099bf6 100644
--- a/tests/app-shell.test.tsx
+++ b/tests/app-shell.test.tsx
@@ -32,7 +32,7 @@ describe('AppShell', () => {
     setup();
     for (const name of ['Main navigation', 'Main tabs']) {
       const nav = screen.getByRole('navigation', { name });
-      for (const label of ['Overview', 'Accounts', 'Tags', 'Settings']) {
+      for (const label of ['Overview', 'Accounts', 'Tags', 'Explorer', 'Settings']) {
         expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
       }
     }
@@ -76,6 +76,7 @@ describe('AppShell', () => {
     expect(side.className).toContain('md:flex');
     expect(side.className).toContain('lg:w-56');
     expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('md:hidden');
+    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('grid-cols-6'); // one column per item
   });
 
   it('the mode toggle flips light/dark through the preferences provider', async () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/explorer-view.test.tsx tests/nav.test.ts tests/app-shell.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/explorer/ExplorerView"`, the nav list has no `/explorer`, and the tab bar is `grid-cols-5`.

- [ ] **Step 3: Write `components/explorer/ExplorerView.tsx`**

```tsx
'use client';

// The Explorer (creator-toolkit spec §0b): desktop-first. Left: the settings (a GET form: the URL is the only state) and
// saved views. Right: breadcrumb trail, Time Scope bar, linked chart + table (every row links one level deeper; chart
// bars/points do the same on click), or the single-item level. Logic lives in lib/analysis/explorer.ts.
import { useState, type ReactNode } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, CircleUserRound, Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { SavedViews, type SavedViewsProps } from '@/components/explorer/SavedViews';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { NavLink } from '@/components/shared/NavLink';
import { PageHeader } from '@/components/shared/PageHeader';
import { TimeScopeBar } from '@/components/shared/TimeScopeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { breadcrumbs, drillHref, type ExplorerRow } from '@/lib/analysis/explorer';
import { downloadExport } from '@/lib/export/download';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { explorerHref, explorerParams, FORMATS, MAX_METRICS, usable, withState, type ExplorerState } from '@/lib/explorer/state';
import { formatDay, formatHour } from '@/lib/format';
import { DIMENSIONS, formatMetric, METRIC_IDS, type MetricId } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

function Hidden({ params }: { params: Record<string, string> }) {
  return Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

/** The settings form. Multi-choices (metrics, accounts) are joined into ONE value: a repeated key would count as missing. */
function Controls({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const s = data.state;
  const [by, setBy] = useState(s.by);
  const [metrics, setMetrics] = useState<MetricId[]>(s.metrics);
  const [accounts, setAccounts] = useState<string[]>(s.accounts);
  const filters = { by, format: s.format, tag: s.tag, weekday: s.weekday, hour: s.hour };
  const kept = metrics.filter((id) => usable(id, filters));
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  return (
    <Form action="" onSubmit={(e) => startProgress(formHref(e.currentTarget))} aria-label={t('controls')} className="grid min-w-0 gap-[var(--gp)]">
      <Hidden params={data.scope.params} />
      <input type="hidden" name="m" value={kept.join(',')} />
      {accounts.length ? <input type="hidden" name="acc" value={accounts.join(',')} /> : null}
      <FormField id="x-by" label={t('groupBy')}>
        {(p) => (
          <select {...p} name="by" value={by} onChange={(e) => setBy(e.target.value as ExplorerState['by'])} className={SELECT}>
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {t(`by.${d}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="grid min-w-0 gap-1">
        <legend className="mb-1 text-sm font-medium">
          {t('metrics')} <span className="text-xs font-normal text-muted-foreground">{t('metricsHint', { max: MAX_METRICS })}</span>
        </legend>
        {METRIC_IDS.map((id) => {
          const ok = usable(id, filters);
          const on = kept.includes(id);
          return (
            <label key={id} className={cn('flex min-w-0 items-center gap-2 text-sm', !ok && 'text-muted-foreground')}>
              <input type="checkbox" checked={on} disabled={!ok || (!on && kept.length >= MAX_METRICS)} onChange={(e) => setMetrics((l) => toggle(l, id, e.target.checked) as MetricId[])} className="size-4 accent-[var(--primary)]" />
              <span className="truncate">{tm(id)}</span>
            </label>
          );
        })}
        <p className="text-xs text-muted-foreground">{t('accountTotalsHint')}</p>
      </fieldset>
      <FormField id="x-chart" label={t('chartMetric')}>
        {(p) => (
          <select {...p} name="chart" defaultValue={s.chart} key={kept.join()} className={SELECT}>
            {kept.map((id) => (
              <option key={id} value={id}>
                {tm(id)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="grid min-w-0 gap-1">
        <legend className="mb-1 text-sm font-medium">{t('accounts')}</legend>
        <div className="grid max-h-48 gap-1 overflow-y-auto pr-1">
          {data.live.map((a) => (
            <label key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
              <input type="checkbox" checked={accounts.includes(a.id)} onChange={(e) => setAccounts((l) => toggle(l, a.id, e.target.checked))} className="size-4 accent-[var(--primary)]" />
              <span className="truncate">@{a.username}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{accounts.length ? t('accountsPicked', { count: accounts.length }) : t('allAccounts')}</p>
      </fieldset>
      {data.groups.length ? (
        <FormField id="x-grp" label={t('group')}>
          {(p) => (
            <select {...p} name="grp" defaultValue={s.group ?? ''} className={SELECT}>
              <option value="">{t('anyGroup')}</option>
              {data.groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}
      <FormField id="x-fmt" label={t('format')}>
        {(p) => (
          <select {...p} name="fmt" defaultValue={s.format ?? ''} className={SELECT}>
            <option value="">{t('anyFormat')}</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {ta(`format.${f}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField id="x-tag" label={t('tag')}>
        {(p) => (
          <select {...p} name="tag" defaultValue={s.tag ?? ''} className={SELECT}>
            <option value="">{t('anyTag')}</option>
            <option value="untagged">{t('untagged')}</option>
            {data.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <FormField id="x-wd" label={t('weekday')}>
          {(p) => (
            <select {...p} name="wd" defaultValue={s.weekday ?? ''} className={SELECT}>
              <option value="">{t('any')}</option>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {ta(`weekday.${d}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="x-hr" label={t('hour')}>
          {(p) => (
            <select {...p} name="hr" defaultValue={s.hour ?? ''} className={SELECT}>
              <option value="">{t('any')}</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {formatHour(h, prefs)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{t('apply')}</Button>
        <Button asChild variant="ghost">
          <Link href={explorerHref(withState(s, { metrics: [], accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null, by: 'account' }), data.scope.query)}>{t('reset')}</Link>
        </Button>
      </div>
    </Form>
  );
}

function Crumbs({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const crumbs = breadcrumbs(data.state, { query: data.scope.query, hasGroups: data.groups.length > 0 });
  const label = (k: (typeof crumbs)[number]) =>
    k.kind === 'all' ? t('crumbs.all') : k.kind === 'group' ? k.key : k.kind === 'account' ? `@${data.live.find((a) => a.id === k.key)?.username ?? '?'}` : k.kind === 'format' ? ta(`format.${k.key}`) : data.item ? formatDay(data.item.day, prefs) : t('crumbs.item');
  return (
    <nav aria-label={t('breadcrumb')} className="mb-2 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={c.kind} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden="true" className="size-3 shrink-0" /> : null}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {label(c)}
              </span>
            ) : (
              <NavLink href={c.href} className="truncate underline-offset-4 hover:text-foreground hover:underline">
                {label(c)}
              </NavLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Results({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const tm = useTranslations('metrics');
  const tAll = useTranslations();
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const router = useRouter();
  const s = data.state;
  const ctx = { accounts: data.live, tags: data.tags, items: data.items, gran: data.scope.gran };
  const partial = new Set(data.model.partial);
  const label = (r: ExplorerRow) => `${rowLabel(s.by, r.key, ctx, (k, v) => tAll(k as never, v as never), prefs)}${partial.has(r.key) ? ' *' : ''}`;
  const href = (r: ExplorerRow) => drillHref(s, r.key, data.scope);
  const compare = data.window.compare !== null && s.by !== 'post';
  const chartLabel = tm(s.chart);
  const rows = data.model.rows.map((r) => ({ label: label(r), now: r.values[s.chart]?.value ?? null, before: r.values[s.chart]?.prior ?? null }));
  const go = (i: number) => {
    const h = href(data.model.rows[i]);
    if (!h) return;
    startProgress(h);
    router.push(h);
  };
  const metricCol = (id: MetricId): Column<ExplorerRow> => ({
    key: id,
    header: tm(id),
    align: 'right',
    sortValue: (r) => r.values[id]?.value ?? null,
    cell: (r) => {
      const k = r.values[id];
      const d = compare && k ? delta(id, k) : null;
      return (
        <>
          {formatMetric(id, k?.value ?? null, prefs)}
          {d ? <span className={cn('ml-1.5 text-xs', d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{d.text}</span> : null}
        </>
      );
    },
  });
  const columns: Column<ExplorerRow>[] = [
    {
      key: 'row',
      header: t(`by.${s.by}`),
      cell: (r) => {
        const h = href(r);
        return h ? (
          <NavLink href={h} aria-label={t('drill', { name: label(r) })} className="underline-offset-4 hover:underline" dir="auto">
            {label(r)}
          </NavLink>
        ) : (
          label(r)
        );
      },
    },
    ...s.metrics.map(metricCol),
  ];
  const chips: { key: string; name: string; patch: Partial<ExplorerState> }[] = [
    ...(s.tag !== null ? [{ key: 'tag', name: rowLabel('tag', s.tag, ctx, (k, v) => tAll(k as never, v as never), prefs), patch: { tag: null } }] : []),
    ...(s.weekday !== null ? [{ key: 'wd', name: rowLabel('weekday', String(s.weekday), ctx, (k, v) => tAll(k as never, v as never), prefs), patch: { weekday: null } }] : []),
    ...(s.hour !== null ? [{ key: 'hr', name: formatHour(s.hour, prefs), patch: { hour: null } }] : []),
  ];
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      {chips.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.key}>
              <Link href={explorerHref(withState(s, c.patch), data.scope.query)} aria-label={t('removeFilter', { name: c.name })} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs hover:bg-hover">
                {c.name}
                <X aria-hidden="true" className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {s.by === 'weekday' || s.by === 'hour' ? <p className="text-xs text-muted-foreground">{t('publishedHint')}</p> : null}
      {s.by !== 'post' ? (
        <ChartCard title={t('chartTitle', { metric: chartLabel, by: t(`by.${s.by}`) })} subtitle={t('drillHint')} summary={t('chartSummary', { metric: chartLabel, count: rows.length })}>
          <SeriesChart
            kind={s.by === 'time' ? 'line' : 'bar'}
            data={rows}
            xKey="label"
            series={[{ key: 'now', label: chartLabel }, ...(compare ? [{ key: 'before', label: t('previous', { metric: chartLabel }), muted: true }] : [])]}
            title={t('chartTitle', { metric: chartLabel, by: t(`by.${s.by}`) })}
            formatY={(n) => formatMetric(s.chart, n, prefs)}
            height={260}
            onPointClick={go}
          />
        </ChartCard>
      ) : null}
      {data.truncated ? <p className="text-xs text-muted-foreground">{t('truncated', { count: data.items.length })}</p> : null}
      <DataTable rows={data.model.rows} columns={columns} rowKey={(r) => r.key} caption={t('tableCaption')} empty={t('empty')} pageSize={s.by === 'post' ? 50 : undefined} />
      {partial.size ? <p className="text-xs text-muted-foreground">{t('partial')}</p> : null}
    </div>
  );
}

export function ExplorerView({ data, today, views, save, rename, remove }: { data: ExplorerData; today: string } & Omit<SavedViewsProps, 'query'>) {
  const t = useTranslations('explorer');
  const te = useTranslations('export.errors');
  const tp = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const s = data.state;
  const query = new URLSearchParams({ ...Object.fromEntries(explorerParams(s)), ...data.scope.params }).toString();
  const exportButton: ReactNode =
    s.item === null && data.live.length ? (
      <LoadingButton
        type="button"
        variant="outline"
        size="sm"
        pending={exporting}
        onClick={async () => {
          setExporting(true);
          const r = await downloadExport(`/api/export/explorer?${query}`, 'xlsx');
          setExporting(false);
          setExportError(r.ok ? null : te(r.error));
        }}
      >
        <Download aria-hidden="true" />
        {t('export')}
      </LoadingButton>
    ) : null;
  const item = data.item ? data.live.find((a) => a.id === data.item!.item.accountId) : undefined;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={exportButton} />
      {exportError ? (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {exportError}
        </p>
      ) : null}
      <Crumbs data={data} />
      <TimeScopeBar scope={data.scope} today={today} keep={Object.fromEntries(explorerParams(s))} />
      {data.live.length === 0 ? (
        <EmptyState
          icon={<CircleUserRound className="size-5" aria-hidden />}
          title={tp('empty')}
          description={tp('emptyHint')}
          action={
            <Button asChild>
              <Link href="/accounts">{tp('addAccount')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="grid min-w-0 content-start gap-[var(--gp)] lg:sticky lg:top-[calc(50px+var(--pg))] lg:max-h-[calc(100dvh-50px-2*var(--pg))] lg:overflow-y-auto">
            <Card className="min-w-0">
              <CardContent>
                <Controls key={query} data={data} />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardContent>
                <SavedViews views={views} query={query} save={save} rename={rename} remove={remove} />
              </CardContent>
            </Card>
          </aside>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">
              {t('window', { from: formatDay(data.window.current.from, prefs), to: formatDay(data.window.current.to, prefs) })}
              {data.window.compare && s.by !== 'post' ? ` · ${t('windowCompare', { from: formatDay(data.window.compare.from, prefs), to: formatDay(data.window.compare.to, prefs) })}` : null}
            </p>
            {s.item !== null ? (
              <ItemPanel detail={data.item} username={item?.username ?? '?'} tabHref={`/accounts/${data.item?.item.accountId ?? ''}?${new URLSearchParams({ tab: data.item?.item.mediaType === 'STORY' ? 'stories' : 'posts', ...data.scope.params })}`} />
            ) : (
              <Results data={data} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Write `app/(app)/explorer/page.tsx`**

```tsx
import { ExplorerView } from '@/components/explorer/ExplorerView';
import { deleteViewAction, renameViewAction, saveViewAction } from '@/app/(app)/explorer/actions';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { loadExplorer } from '@/lib/explorer/load';
import { loadViews } from '@/lib/explorer/views';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  // owner session: RLS applies (inside the security-invoker rollups too), never the admin client
  const [prefs, db, accounts, sync] = await Promise.all([getPrefs(), createServerSupabase(), loadAccounts(), loadSyncStatus()]);
  const today = localDay(new Date(), prefs.timezone);
  const [data, views] = await Promise.all([loadExplorer(db, sp, { today, tz: prefs.timezone, weekStart: prefs.weekStart, accounts, sync }), loadViews(db, prefs.weekStart)]);
  // imported server actions are passed straight through to the client view (never wrapped in a closure here)
  return <ExplorerView data={data} today={today} views={views} save={saveViewAction} rename={renameViewAction} remove={deleteViewAction} />;
}
```

- [ ] **Step 5: Write `app/(app)/explorer/loading.tsx`** (page-shaped: header, scope bar, settings column, chart, table)

```tsx
import { RouteLoading, SkeletonHeader, SkeletonTable } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function ExplorerLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader actions={1} />
      <Skeleton className="mb-[var(--gp)] h-[var(--ctl)] w-full max-w-xl" />
      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-[var(--rm)]" />
        <div className="grid min-w-0 content-start gap-[var(--gp)]">
          <Skeleton className="h-72 rounded-[var(--rm)]" />
          <SkeletonTable rows={6} />
        </div>
      </div>
    </RouteLoading>
  );
}
```

- [ ] **Step 6: Add the nav item** — in `lib/nav.ts` and `components/shared/AppShell.tsx` exactly this diff (the `nav.explorer` label was added in Task 2):

```diff
diff --git a/lib/nav.ts b/lib/nav.ts
index 36e7fc3..0cc9443 100644
--- a/lib/nav.ts
+++ b/lib/nav.ts
@@ -1,8 +1,8 @@
-import { CalendarDays, CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';
+import { CalendarDays, ChartNoAxesCombined, CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';
 
 export interface NavItem {
-  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/settings';
-  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'settings';
+  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/explorer' | '/settings';
+  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'explorer' | 'settings';
   icon: LucideIcon;
 }
 
@@ -11,6 +11,7 @@ export const NAV_ITEMS: readonly NavItem[] = [
   { href: '/accounts', key: 'accounts', icon: CircleUserRound },
   { href: '/tags', key: 'tags', icon: Tag },
   { href: '/calendar', key: 'calendar', icon: CalendarDays },
+  { href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined },
   { href: '/settings', key: 'settings', icon: Settings },
 ];
 
diff --git a/components/shared/AppShell.tsx b/components/shared/AppShell.tsx
index 814bd52..277af1c 100644
--- a/components/shared/AppShell.tsx
+++ b/components/shared/AppShell.tsx
@@ -54,7 +54,7 @@ export function AppShell({ children, userEmail, signOutAction, bell }: { childre
       </div>
 
       {/* phones: bottom tab bar */}
-      <nav aria-label={t('tabs')} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
+      <nav aria-label={t('tabs')} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
         {NAV_ITEMS.map(({ href, key, icon: Icon }) => (
           <NavLink
             key={href}
```

If 12a (its Task 12 "Navigation carries the scope") made the nav links carry the Time Scope through a list of scoped destinations, add `'/explorer'` to that list too: the Explorer is a scoped page.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/explorer-view.test.tsx tests/nav.test.ts tests/app-shell.test.tsx tests/route-loading.test.tsx`, then `npx tsc --noEmit` and `npx eslint components/explorer "app/(app)/explorer"`
Expected: PASS (4 files: 10 + nav + shell + loading tests); typecheck and lint clean.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/explorer/page.tsx" "app/(app)/explorer/loading.tsx" components/explorer/ExplorerView.tsx lib/nav.ts components/shared/AppShell.tsx tests/explorer-view.test.tsx tests/nav.test.ts tests/app-shell.test.tsx
git commit -m "feat(explorer): /explorer page (settings, linked chart + table, drill, breadcrumbs, export) and nav item" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Drill from the Overview (tiles, group headings, comparison rows and chart)

**Files:**
- Modify: `components/overview/OverviewView.tsx` (the version 12a's Task 9 leaves: `TimeScopeBar`, `useScopeText`, `useBucketFormat`, `model.scope`)
- Test: `tests/overview-drill.test.tsx` (new). 12a's `tests/overview-view.test.tsx` must keep passing unchanged (the comparison table's account link is named "Open @…" so the card link stays the only link named "@…").

**Interfaces:**
- Consumes: `explorerHref`, `parseExplorerState` (Task 3), `SeriesChart` `onPointClick` (Task 7), `startProgress`, i18n `explorer.exploreMetric`, `explorer.openAccount` (Task 2); 12a `OverviewModel { scope: ResolvedScope; days; partial; scopes; sections }`, `bucketRange` (`lib/time-scope/range.ts`), `scopeQuery` (`lib/time-scope/scope.ts`).
- Produces (all links keep the Time Scope via `model.scope.query`):
  - each total tile (followers, reach, views, engagement) is a link to `/explorer?m=<metric>&by=group|account&<scope>` (group when any named group exists — the portfolio level);
  - each named group heading links to `/explorer?…&by=account&grp=<group>&<scope>` (isolated accounts are not a group);
  - each comparison-table row's account links to `/accounts/<id>?<scope>`;
  - a click on a comparison-chart bucket opens `/explorer?m=reach&by=account[&grp=<group>]` on that bucket's days (fixed range, the comparison mode kept, granularity auto).

- [ ] **Step 1: Write the failing test** — create `tests/overview-drill.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
// Recharts draws nothing in jsdom (no layout): a stand-in exposes the chart's click handler as buttons
vi.mock('@/components/charts/SeriesChart', () => ({
  SeriesChart: ({ data, onPointClick }: { data: { day: string }[]; onPointClick?: (i: number) => void }) => (
    <div>
      {data.map((d, i) => (
        <button key={d.day} type="button" onClick={() => onPointClick?.(i)}>
          {`bucket ${d.day}`}
        </button>
      ))}
    </div>
  ),
}));

const TODAY = '2026-10-15';
const acct = (id: string, groupName: string | null): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

function view(q: string) {
  const scope = resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-09-01');
  const model = buildOverview(
    { accounts: [acct('brand.one', 'Brand X'), acct('brand.two', 'Brand X')], sync: { 'brand.one': synced, 'brand.two': synced }, daily: { 'brand.one': days(14, 100), 'brand.two': days(14, 50) }, posts: {} },
    { scope, today: TODAY, now: new Date('2026-10-15T04:00:00Z'), tz: 'UTC', locale: 'en', weekStart: 'mon' },
  );
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <OverviewView model={model} today={TODAY} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Overview drill-down into the Explorer (the scope is kept)', () => {
  it('each total tile opens the Explorer on that metric at the portfolio level', () => {
    view('from=7d');
    const totals = screen.getByRole('region', { name: en.pages.overview.allAccounts });
    expect(within(totals).getByRole('link', { name: /Explore Reach in the Explorer/ })).toHaveAttribute('href', '/explorer?m=reach&by=group&from=7d');
    expect(within(totals).getByRole('link', { name: /Explore Engagement in the Explorer/ })).toHaveAttribute('href', '/explorer?m=engagementRate&by=group&from=7d');
  });

  it('a group heading opens its accounts; a comparison row opens the account page', () => {
    view('from=7d&cmp=yoy');
    expect(screen.getByRole('link', { name: 'Brand X' })).toHaveAttribute('href', '/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account&grp=Brand+X&from=7d&cmp=yoy');
    const table = screen.getByRole('table', { name: en.pages.overview.compareTitle });
    expect(within(table).getByRole('link', { name: 'Open @brand.one' })).toHaveAttribute('href', '/accounts/brand.one?from=7d&cmp=yoy');
  });

  it('a click on a chart bucket opens the Explorer on those days, the group compared side by side', async () => {
    const user = userEvent.setup();
    view('from=7d');
    await user.click(screen.getByRole('button', { name: 'bucket 2026-10-08' }));
    expect(push).toHaveBeenCalledWith('/explorer?m=reach&by=account&grp=Brand+X&from=2026-10-08&to=2026-10-08');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/overview-drill.test.tsx`
Expected: FAIL — no link named "Explore Reach in the Explorer", no group link, no "Open @brand.one", `push` not called.

- [ ] **Step 3: Edit `components/overview/OverviewView.tsx`** — exactly this diff on top of 12a's Task 9 version:

```diff
diff --git a/components/overview/OverviewView.tsx b/components/overview/OverviewView.tsx
index 6c0ff50..d7e1305 100644
--- a/components/overview/OverviewView.tsx
+++ b/components/overview/OverviewView.tsx
@@ -2,6 +2,7 @@
 
 import { useId, useState, type ReactNode } from 'react';
 import Link from 'next/link';
+import { useRouter } from 'next/navigation';
 import { CircleUserRound, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
 import { useTranslations } from 'next-intl';
 import { SyncBadge } from '@/components/accounts/SyncBadge';
@@ -12,6 +13,7 @@ import { usePrefs } from '@/components/providers/PrefsProvider';
 import { ChartCard } from '@/components/shared/ChartCard';
 import { DataTable, type Column } from '@/components/shared/DataTable';
 import { EmptyState } from '@/components/shared/EmptyState';
+import { startProgress } from '@/components/shared/NavigationProgress';
 import { NavLink } from '@/components/shared/NavLink';
 import { PageHeader } from '@/components/shared/PageHeader';
 import { DeltaPill, StatCard } from '@/components/shared/StatCard';
@@ -23,9 +25,12 @@ import { Button } from '@/components/ui/button';
 import { Card, CardContent } from '@/components/ui/card';
 import type { Kpi, KpiId } from '@/lib/analysis/growth';
 import type { AccountCard, OverviewModel } from '@/lib/dashboard/overview';
+import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
 import type { AccountProgress } from '@/lib/sync/progress';
 import { formatCompact, formatDateTime, formatDelta, formatNumber, formatPercent } from '@/lib/format';
 import { formatMetric } from '@/lib/metrics';
+import { bucketRange } from '@/lib/time-scope/range';
+import { scopeQuery } from '@/lib/time-scope/scope';
 import { cn } from '@/lib/utils';
 
 function MiniStat({ id, k }: { id: KpiId; k: Kpi }) {
@@ -151,9 +156,17 @@ function Comparison({ model }: { model: OverviewModel }) {
   const { prefs } = usePrefs();
   const delta = useKpiDelta();
   const formatX = useBucketFormat(model.scope.gran, model.partial);
+  const tx = useTranslations('explorer');
+  const router = useRouter();
   const [scopeId, setScopeId] = useState(model.scopes[0]?.id);
   const scope = model.scopes.find((s) => s.id === scopeId) ?? model.scopes[0];
   if (!scope) return null;
+  // drill-down: a click on a bucket opens the Explorer on those days, accounts of this comparison side by side
+  const bucketHref = (i: number) =>
+    explorerHref(
+      parseExplorerState({ m: 'reach', by: 'account', ...(scope.group ? { grp: scope.group } : {}) }),
+      scopeQuery({ range: bucketRange(model.days[i], model.scope.gran), cmp: typeof model.scope.scope.cmp === 'object' ? 'prev' : model.scope.scope.cmp, gran: 'auto' }),
+    );
   const cards = model.sections.flatMap((s) => s.cards);
   const inScope = scope.accountIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is AccountCard => !!c);
   const data = model.days.map((day, i) => ({ day, ...Object.fromEntries(inScope.map((c) => [c.id, model.series[c.id]?.[i] ?? null])) }));
@@ -172,7 +185,12 @@ function Comparison({ model }: { model: OverviewModel }) {
       );
     },
   });
-  const columns: Column<AccountCard>[] = [{ key: 'account', header: t('account'), cell: (c) => `@${c.username}`, sortValue: (c) => c.username }, kpiCol('followers'), kpiCol('reach'), kpiCol('engagementRate'), kpiCol('posts')];
+  const account = (c: AccountCard) => (
+    <NavLink href={`/accounts/${c.id}${model.scope.query ? `?${model.scope.query}` : ''}`} aria-label={tx('openAccount', { name: `@${c.username}` })} className="underline-offset-4 hover:underline">
+      @{c.username}
+    </NavLink>
+  );
+  const columns: Column<AccountCard>[] = [{ key: 'account', header: t('account'), cell: account, sortValue: (c) => c.username }, kpiCol('followers'), kpiCol('reach'), kpiCol('engagementRate'), kpiCol('posts')];
 
   return (
     <ChartCard
@@ -189,7 +207,20 @@ function Comparison({ model }: { model: OverviewModel }) {
         </div>
       }
     >
-      <SeriesChart kind="line" data={data} xKey="day" series={inScope.map((c) => ({ key: c.id, label: `@${c.username}` }))} title={t('compareTitle')} formatX={formatX} formatY={(n) => formatCompact(n, prefs)} />
+      <SeriesChart
+        kind="line"
+        data={data}
+        xKey="day"
+        series={inScope.map((c) => ({ key: c.id, label: `@${c.username}` }))}
+        title={t('compareTitle')}
+        formatX={formatX}
+        formatY={(n) => formatCompact(n, prefs)}
+        onPointClick={(i) => {
+          const h = bucketHref(i);
+          startProgress(h);
+          router.push(h);
+        }}
+      />
       {model.partial.length ? <p className="mt-1 text-xs text-muted-foreground">{ts('partialNote')}</p> : null}
       <div className="mt-4">
         <DataTable rows={inScope} columns={columns} rowKey={(c) => c.id} caption={t('compareTitle')} initialSort={{ key: 'reach', dir: 'desc' }} />
@@ -202,6 +233,7 @@ export function OverviewView({ model, today, exportButton, progress = NO_PROGRES
   const t = useTranslations('pages.overview');
   const tm = useTranslations('metrics');
   const tR = useTranslations('analysis.reasons');
+  const tx = useTranslations('explorer');
   const { prefs } = usePrefs();
   const delta = useKpiDelta();
   const uid = useId();
@@ -234,20 +266,24 @@ export function OverviewView({ model, today, exportButton, progress = NO_PROGRES
   }
 
   const totals = model.totals!;
+  const by = model.sections.some((s) => s.group !== null) ? 'group' : 'account'; // the Explorer's portfolio level
   return (
     <>
       {header}
       <section aria-label={t('allAccounts')} className="mb-[var(--gp)] grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
         {(['followers', 'reach', 'views', 'engagementRate'] as const).map((id) => (
-          <StatCard
-            key={id}
-            label={tm(id)}
-            value={formatMetric(id, totals[id].value, prefs, { full: id === 'followers' })}
-            delta={delta(id, totals[id])}
-            comparison={vs}
-            note={totals[id].reason ? tR(totals[id].reason) : undefined}
-            spark={id === 'reach' ? <Sparkline data={model.totalsSpark} /> : undefined}
-          />
+          <Link key={id} href={explorerHref(parseExplorerState({ m: id, by }), model.scope.query)} className="block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
+            <StatCard
+              className="h-full"
+              label={tm(id)}
+              value={formatMetric(id, totals[id].value, prefs, { full: id === 'followers' })}
+              delta={delta(id, totals[id])}
+              comparison={vs}
+              note={totals[id].reason ? tR(totals[id].reason) : undefined}
+              spark={id === 'reach' ? <Sparkline data={model.totalsSpark} /> : undefined}
+            />
+            <span className="sr-only">{tx('exploreMetric', { metric: tm(id) })}</span>
+          </Link>
         ))}
       </section>
 
@@ -256,7 +292,15 @@ export function OverviewView({ model, today, exportButton, progress = NO_PROGRES
           <section key={s.group ?? '\u0000isolated'} aria-labelledby={`${uid}-grp-${i}`}>
             <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
               <h2 id={`${uid}-grp-${i}`} className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
-                <span className="min-w-0 truncate">{s.group ?? t('isolated')}</span>
+                <span className="min-w-0 truncate">
+                  {s.group ? (
+                    <NavLink href={explorerHref(parseExplorerState({ grp: s.group, by: 'account' }), model.scope.query)} className="underline-offset-4 hover:underline">
+                      {s.group}
+                    </NavLink>
+                  ) : (
+                    t('isolated')
+                  )}
+                </span>
                 <Badge variant="secondary">{formatNumber(s.cards.length, prefs)}</Badge>
               </h2>
               {s.totals ? (
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/overview-drill.test.tsx tests/overview-view.test.tsx` and `npx tsc --noEmit`
Expected: PASS (2 files); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add components/overview/OverviewView.tsx tests/overview-drill.test.tsx
git commit -m "feat(overview): drill into the Explorer from tiles, groups, comparison rows and chart" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Drill from the account pages (format comparison, best-time cells, Posts table)

**Files:**
- Modify: `components/account/AccountOverview.tsx`, `components/account/PostsTab.tsx` (the versions 12a's Task 10 leaves), `app/(app)/accounts/[id]/page.tsx` (two props)
- Test: `tests/account-drill.test.tsx` (new). 12a's `tests/account-view.test.tsx` and `tests/posts-tab.test.tsx` must keep passing unchanged (the new props are optional; without them nothing links).

**Interfaces:**
- Consumes: `explorerHref`, `parseExplorerState` (Task 3), `HeatmapCell.href` (Task 7), `NavLink`, i18n `explorer.drill` (Task 2); 12a `AccountOverviewModel.scope` (`ResolvedScope`), `PostsTab` `scope` prop (`ResolvedScope.params`), `scopeQuery` (`lib/time-scope/scope.ts`).
- Produces:
  - `AccountOverview({ model, account?: { id: string; groupName: string | null } })` — with `account`: each format row links to `/explorer?…&by=post&acc=<id>&fmt=<format>&<page scope>`; each cell of the "your post performance" grid that has posts links to `/explorer?…&by=post&<acc=<id> | grp=<group> (pooled)>&wd=<weekday>&hr=<hour>&from=all` (the grid uses every stored post, so the list does too; "followers online" cells have nothing to list and stay plain).
  - `PostsTab({ …, accountId?: string })` — with `accountId`: each post's title links to its single-item level `/explorer?…&by=post&acc=<id>&fmt=<format>&item=<media id>&<page scope>`.

- [ ] **Step 1: Write the failing test** — create `tests/account-drill.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AccountOverview } from '@/components/account/AccountOverview';
import { PostsTab } from '@/components/account/PostsTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildAccountOverview } from '@/lib/dashboard/account';
import type { PostView } from '@/lib/dashboard/content';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-15';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const account: StoredAccount = { id: A, igUserId: '1', username: 'brand', displayName: null, accountType: null, profilePictureUrl: null, groupName: 'Food', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' };
const days: DailyRow[] = Array.from({ length: 14 }, (_, i) => ({ day: addDays(TODAY, i - 14), followers: 1000, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null }));
// a Reel published Wednesday 7 Oct 2026, 20:00 in Kuala Lumpur (12:00 UTC), with engagement
const reel: Post = { id: 'r1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: null, reach: 500, views: null, likes: 40, comments: 5, shares: 2, saves: 3 };
const scope = resolveScope(parseTimeScope(new URLSearchParams('from=90d')), TODAY, '2026-09-01');
const model = buildAccountOverview({ account, sync: undefined, daily: days, posts: [reel], online: [], pooled: { accounts: 2, posts: [reel], online: [] } }, { scope, today: TODAY, now: new Date('2026-10-15T04:00:00Z'), tz: 'Asia/Kuala_Lumpur', weekStart: 'mon' });

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur' }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('account overview drill-down', () => {
  it('a format row lists that format of this account in the Explorer, with the page scope', () => {
    wrap(<AccountOverview model={model} account={{ id: A, groupName: 'Food' }} />);
    const table = screen.getByRole('table', { name: en.pages.account.formatsTitle });
    expect(within(table).getByRole('link', { name: 'Show Reel in detail' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=REELS&from=90d`);
  });

  it('a best-time cell (your posts) lists the posts behind it over all history; the pooled grid uses the group', async () => {
    const user = userEvent.setup();
    wrap(<AccountOverview model={model} account={{ id: A, groupName: 'Food' }} />);
    expect(within(screen.getByRole('table', { name: en.pages.account.bestTimeTitle })).queryAllByRole('link')).toHaveLength(0); // followers online: nothing to list
    await user.click(screen.getByRole('button', { name: en.pages.account.bestTimePosts }));
    const grid = screen.getByRole('table', { name: en.pages.account.bestTimeTitle });
    const links = within(grid).getAllByRole('link');
    expect(links).toHaveLength(1); // only the cell that has a post
    expect(links[0]).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&wd=3&hr=20&from=all`);
    await user.click(screen.getByRole('button', { name: '2 accounts pooled' }));
    expect(within(screen.getByRole('table', { name: en.pages.account.bestTimeTitle })).getByRole('link')).toHaveAttribute('href', '/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&grp=Food&wd=3&hr=20&from=all');
  });

  it('without the account prop nothing links (unchanged behaviour)', () => {
    wrap(<AccountOverview model={model} />);
    expect(within(screen.getByRole('table', { name: en.pages.account.formatsTitle })).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('posts tab drill-down', () => {
  const row: PostView = { id: '42', mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: null, caption: 'Hi', reach: 500, views: null, likes: 40, comments: 5, saves: 3, shares: 2, engagementRate: 0.1, tags: [] };
  it('each post opens its single-item level in the Explorer, keeping the scope', () => {
    wrap(<PostsTab posts={[row]} total={1} tags={[]} filters={{ format: null, tag: null, from: null, to: null }} scope={{ from: '90d' }} accountId={A} setPostTags={vi.fn()} />);
    const links = screen.getAllByRole('link', { name: /^Reel · 7 Oct 2026 20:00$/ }); // table (md+) and card list (phones)
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=REELS&item=42&from=90d`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/account-drill.test.tsx`
Expected: FAIL — no "Show Reel in detail" link, no heatmap links, the post title is not a link.

- [ ] **Step 3: Edit the two components** — exactly this diff on top of 12a's Task 10 versions:

```diff
diff --git a/components/account/AccountOverview.tsx b/components/account/AccountOverview.tsx
index 7d558a9..7490b33 100644
--- a/components/account/AccountOverview.tsx
+++ b/components/account/AccountOverview.tsx
@@ -10,14 +10,17 @@ import { useBestTimeRows } from '@/components/charts/useBestTimeRows';
 import { usePrefs } from '@/components/providers/PrefsProvider';
 import { ChartCard } from '@/components/shared/ChartCard';
 import { DataTable } from '@/components/shared/DataTable';
+import { NavLink } from '@/components/shared/NavLink';
 import { StatCard } from '@/components/shared/StatCard';
 import { useBucketFormat, useScopeText } from '@/components/shared/TimeScopeBar';
 import { useKpiDelta } from '@/components/shared/useKpiDelta';
 import { Button } from '@/components/ui/button';
 import type { KpiId } from '@/lib/analysis/growth';
 import type { AccountOverviewModel } from '@/lib/dashboard/account';
+import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
 import { formatCompact, formatDateTime, formatDelta, formatNumber, formatPercent } from '@/lib/format';
 import { formatMetric } from '@/lib/metrics';
+import { scopeQuery } from '@/lib/time-scope/scope';
 
 const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];
 
@@ -33,19 +36,29 @@ function Toggle<T extends string>({ label, value, options, onChange }: { label:
   );
 }
 
-export function AccountOverview({ model }: { model: AccountOverviewModel }) {
+/** `account` set: formats and best-time cells link into the Explorer (drill-down), scoped to this account. */
+export function AccountOverview({ model, account }: { model: AccountOverviewModel; account?: { id: string; groupName: string | null } }) {
   const t = useTranslations('pages.account');
   const to = useTranslations('pages.overview');
   const tm = useTranslations('metrics');
   const ta = useTranslations('analysis');
   const ts = useTranslations('timeScope');
   const tErr = useTranslations('accounts.errors');
+  const tx = useTranslations('explorer');
   const { prefs } = usePrefs();
   const delta = useKpiDelta();
   const bestTime = useBestTimeRows();
   const [view, setView] = useState<'online' | 'posts'>('online'); // SPEC §7: followers online is the default
   const [scope, setScope] = useState<'account' | 'pooled'>('account');
   const heat = model.heat[view][scope];
+  // drill-down: a cell of "your post performance" lists the posts behind it. The grid uses every stored post, so the
+  // link asks for the whole history ("all"), this account or its pool (its group, or every account when isolated).
+  const cellScope = scope === 'account' ? { acc: account?.id } : account?.groupName ? { grp: account.groupName } : {};
+  const all = scopeQuery({ range: 'all', cmp: 'none', gran: 'auto' });
+  const heatRows = bestTime.rows(heat, view).map((r, i) => ({
+    ...r,
+    cells: r.cells.map((c, hour) => ({ ...c, href: account && view === 'posts' && c.value !== null ? explorerHref(parseExplorerState({ by: 'post', ...cellScope, wd: String(heat.rows[i].weekday), hr: String(hour) }), all) : undefined })),
+  }));
   const { vs } = useScopeText(model.scope);
   const fmtX = useBucketFormat(model.scope.gran, model.trendPartial);
   const gran = model.scope.gran;
@@ -95,7 +108,18 @@ export function AccountOverview({ model }: { model: AccountOverviewModel }) {
             empty={ta('reasons.no_data')}
             initialSort={{ key: 'avgReach', dir: 'desc' }}
             columns={[
-              { key: 'format', header: t('format'), cell: (r) => ta(`format.${r.mediaType}`) },
+              {
+                key: 'format',
+                header: t('format'),
+                cell: (r) =>
+                  account ? (
+                    <NavLink href={explorerHref(parseExplorerState({ by: 'post', acc: account.id, fmt: r.mediaType }), model.scope.query)} aria-label={tx('drill', { name: ta(`format.${r.mediaType}`) })} className="underline-offset-4 hover:underline">
+                      {ta(`format.${r.mediaType}`)}
+                    </NavLink>
+                  ) : (
+                    ta(`format.${r.mediaType}`)
+                  ),
+              },
               { key: 'posts', header: tm('posts'), cell: (r) => formatNumber(r.posts, prefs), sortValue: (r) => r.posts, align: 'right' },
               { key: 'avgReach', header: t('avgReach'), cell: (r) => formatCompact(r.avgReach, prefs), sortValue: (r) => r.avgReach, align: 'right' },
               { key: 'er', header: tm('engagementRate'), cell: (r) => formatPercent(r.engagementRate, prefs), sortValue: (r) => r.engagementRate, align: 'right' },
@@ -145,7 +169,7 @@ export function AccountOverview({ model }: { model: AccountOverviewModel }) {
           </div>
         }
       >
-        <Heatmap caption={t('bestTimeTitle')} columns={bestTime.hours} rows={bestTime.rows(heat, view)} lowLabel={ta('low')} highLabel={ta('high')} />
+        <Heatmap caption={t('bestTimeTitle')} columns={bestTime.hours} rows={heatRows} lowLabel={ta('low')} highLabel={ta('high')} />
       </ChartCard>
     </div>
   );
diff --git a/components/account/PostsTab.tsx b/components/account/PostsTab.tsx
index 44551fb..3c584bb 100644
--- a/components/account/PostsTab.tsx
+++ b/components/account/PostsTab.tsx
@@ -9,11 +9,13 @@ import { usePrefs } from '@/components/providers/PrefsProvider';
 import { DataTable, type Column } from '@/components/shared/DataTable';
 import { FormField } from '@/components/shared/FormField';
 import { formHref, startProgress } from '@/components/shared/NavigationProgress';
+import { NavLink } from '@/components/shared/NavLink';
 import { TagBadge } from '@/components/shared/TagBadge';
 import { Button } from '@/components/ui/button';
 import { FEED_FORMATS } from '@/lib/analysis/posts';
 import type { Tag } from '@/lib/analysis/types';
 import type { PostFilters, PostView } from '@/lib/dashboard/content';
+import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
 import { formatCompact, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
 
 export const POSTS_PAGE = 50;
@@ -67,13 +69,15 @@ function Filters({ tags, filters, scope }: { tags: Tag[]; filters: PostFilters;
 }
 
 /** `scope` = the canonical Time Scope parameters of the page (ResolvedScope.params), kept by the filter form. */
-export function PostsTab({ posts, total, tags, filters, scope = {}, setPostTags }: { posts: PostView[]; total: number; tags: Tag[]; filters: PostFilters; scope?: Record<string, string>; setPostTags: SetPostTags }) {
+/** `accountId` set: each post links to its single-item level in the Explorer (with the page's scope). */
+export function PostsTab({ posts, total, tags, filters, scope = {}, accountId, setPostTags }: { posts: PostView[]; total: number; tags: Tag[]; filters: PostFilters; scope?: Record<string, string>; accountId?: string; setPostTags: SetPostTags }) {
   const t = useTranslations('pages.account.posts');
   const tm = useTranslations('metrics');
   const ta = useTranslations('analysis');
   const { prefs } = usePrefs();
   const count = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
   const label = (p: PostView) => `${ta(`format.${p.mediaType}`)} · ${formatDateTime(p.postedAt, prefs)}`;
+  const query = new URLSearchParams(scope).toString();
 
   const columns: Column<PostView>[] = [
     {
@@ -83,7 +87,13 @@ export function PostsTab({ posts, total, tags, filters, scope = {}, setPostTags
       cell: (p) => (
         <span className="flex min-w-0 flex-col">
           <span className="flex min-w-0 items-center gap-1.5">
-            <span className="truncate">{label(p)}</span>
+            {accountId ? (
+              <NavLink href={explorerHref(parseExplorerState({ by: 'post', acc: accountId, fmt: p.mediaType, item: p.id }), query)} className="truncate underline-offset-4 hover:underline">
+                {label(p)}
+              </NavLink>
+            ) : (
+              <span className="truncate">{label(p)}</span>
+            )}
             {p.permalink ? (
               <a href={p.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open', { post: label(p) })} className="shrink-0 text-muted-foreground hover:text-foreground">
                 <ExternalLink aria-hidden="true" className="size-3.5" />
```

- [ ] **Step 4: Pass the account from the page** — in `app/(app)/accounts/[id]/page.tsx` (12a's Task 10 version), in `TabContent`:
  - `return <AccountOverview model={model} />;` → `return <AccountOverview model={model} account={{ id: account.id, groupName: account.groupName }} />;`
  - in the `<PostsTab … scope={scope.params} setPostTags={setPostTagsAction} />` element, add `accountId={account.id}` before `setPostTags` (the server action stays passed straight through).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/account-drill.test.tsx tests/account-view.test.tsx tests/posts-tab.test.tsx tests/account-page.test.tsx tests/charts-drill.test.tsx` and `npx tsc --noEmit`
Expected: PASS (5 files); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add components/account/AccountOverview.tsx components/account/PostsTab.tsx "app/(app)/accounts/[id]/page.tsx" tests/account-drill.test.tsx
git commit -m "feat(account): drill into the Explorer from formats, best-time cells and posts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Docs — RUNBOOK_EXPLORER, SPEC, TODO; final check

**Files:**
- Create: `docs/RUNBOOK_EXPLORER.md`
- Modify: `docs/SPEC.md`, `docs/TODO.md` (12a edits them too: insert by the anchors below, never replace 12a's text)

- [ ] **Step 1: Write `docs/RUNBOOK_EXPLORER.md`**

```markdown
# Runbook — Explorer, rollups and drill-down (Plan 12b)

Live checks for the owner (with the assistant). Nothing here has been verified on the live project yet: the SQL was
verified on a local PostgreSQL 16 with the repo's real migrations, a stand-in for Supabase's `auth` schema and
2 years × 10 accounts of synthetic data (see the plan's "Dry-run result"); the UI only in jsdom tests.

## 0. Apply the migration BEFORE deploying the code

The new code calls four SQL functions and a table that exist only after `supabase/migrations/20261024000001_explorer.sql`.
Deploying first breaks `/explorer` (the page shows the error screen) — nothing else depends on them.

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §4)
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Then in the Supabase SQL editor:

```sql
select proname, prosecdef from pg_proc where proname like 'explorer_%' order by 1;
-- 4 rows (explorer_daily, explorer_followers, explorer_media, explorer_posts), prosecdef = false (security invoker)
select count(*) from public.explorer_views;               -- 0
select polname, pg_get_expr(polqual, polrelid) from pg_policy where polname in ('media_metrics_owner_select', 'account_daily_owner_select');
-- the expression reads ( SELECT is_owner() AS is_owner ): the owner check runs once per query
```

Run the database advisors (Supabase dashboard → Advisors → Security and Performance): no new warnings for the
`explorer_*` functions (each pins `search_path`) or for `explorer_views` (RLS on, one owner policy).

## 1. Layout: 360 / 768 / 1280 × themes

Open `/explorer` in each width (DevTools device toolbar) and in each theme (Ink, Sunset, Forest, Mono) in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| No horizontal page scroll; the table becomes cards on phones | | | |
| Settings stack above the results (360/768); a sticky left column (1280) that scrolls on its own | | | |
| The phone tab bar shows 6 items, labels readable (en and zh-CN) | | — | — |
| Chart colours and the muted comparison series are visible in every theme, light and dark | | | |
| Breadcrumb wraps instead of overflowing with a 40-character group name and a long @username | | | |

## 2. Explore and compare

1. Overview → click the **Reach** tile → `/explorer?m=reach&by=group…` (or `by=account` without groups).
2. Pick metrics (max 4; account totals are disabled when you break down by format/tag/weekday/hour or filter content),
   **Break down by** each option, **Apply**. Numbers must match the Overview KPI for the same range (Reach, Engagement).
3. Time Scope: 1y + "same period last year" → each row shows a change; "Over time" draws two lines (the second dashed).

## 3. Drill-down round trip keeps the scope

Set the scope to **90d, same period last year**, then: Explorer by group → click a group row → its accounts → click an
account → its formats → click **Reels** → single posts → click a post → the item level (followers around the post,
followers/non-followers that day). At every step the URL keeps `from=90d&cmp=yoy`, the breadcrumb grows, and each
breadcrumb link goes back up with the scope. Browser **Back** walks the same path backwards.
Also from the account page: Format comparison row → single posts; Best time → "Your post performance" cell → the posts
of that weekday/hour (all history); Posts tab → a post title → its item level. Over time → click a month bar → that
month by weeks → a week → its days → a day → its posts.

## 4. One year performance (Server-Timing)

1. Explorer, **1y**, break down by **Account** with 4 metrics, then by **Format** and **Over time**.
2. DevTools → Network: the document/RSC request's "Waiting for server response" should stay ≤ 1.2 s (the budget in
   `docs/RUNBOOK_PERF.md`).
3. Click **Export view**: the `/api/export/explorer` response has `Server-Timing: explorer;dur=…` = the same loader as
   the page. Note the value here: ______ ms (1y by account) / ______ ms (1y by format) / ______ ms (all, by month).
4. If anything is over ~1 s: in the SQL editor run `explain analyze` on the slow call (e.g. `select * from
   public.explorer_posts(array['<account uuid>']::uuid[], now() - interval '1 year', now(), 'Asia/Kuala_Lumpur', null,
   true, null, false, null, null, 'format', 'day', 'mon');`) and send the plan to the assistant. The upgrade path is a
   `media_latest` table maintained by the sync (plan Decisions).

## 5. Security: nobody but the owner gets rows

SQL editor (it runs as `postgres`). First copy one account id: `select id from public.accounts limit 1;`

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.explorer_daily(array['<account uuid>']::uuid[], current_date - 365, current_date, 'account', 'day', 'mon'); -- 0
select count(*) from public.explorer_media(array['<account uuid>']::uuid[], now() - interval '1 year', now(), 'UTC', null, true, null, false, null, null); -- 0
select count(*) from public.explorer_views; -- 0
rollback;

begin;
set local role anon;
select public.explorer_daily(array['<account uuid>']::uuid[], current_date - 30, current_date, 'account', 'day', 'mon'); -- ERROR: permission denied for function explorer_daily
rollback;
```

In the browser while signed out: `/explorer` redirects to `/login`; `/api/export/explorer?m=reach&by=account` answers
401 (never data). Hand-edited URLs (`?by=drop`, `?m=__proto__`, `?acc=' or 1=1`) show the default view, never an error
page with database text; the export answers `400 bad_params`.

## 6. Saved views

Save the current view ("Reels by hour"), reload, open it from the list → the same URL. Rename it (same name in another
case is fine; another view's name says "already exists"), delete it (confirmation first). A view saved with **30d**
still means "the last 30 days" next week; a view saved with fixed dates keeps them.

## 7. Known limits (by design)

- Instagram has **no hourly reach or views**: account insights are daily totals. The only intraday series is the follower
  count from every sync (`follower_snapshots`, since Plan 11). Hour/weekday in the Explorer = when a post was published.
- Account totals (followers, reach, views, interactions, net follows, engagement) can't be split by format, tag,
  weekday or hour; post metrics can. The audience slice of a post is the account's reach of that format on that day
  (`account_daily_breakdown`: a 90-day backfill on 16 Oct 2026, daily since), not the single post's.
- Stories count in post metrics only when you choose the Stories format or break down by format.
- Single posts: the newest 500 in the range (the page says when the list is cut).
- A timezone that the browser knows but Postgres does not (very rare, deprecated names) makes the Explorer show the
  error screen: pick a zone from the Settings list.
- Days follow the KPI cards: a rolling range ends on the latest settled insight day (Instagram lags up to 48 h).

## What to send if it fails

The URL (it holds the whole view), the width/theme, a screenshot, the `Server-Timing` value, and for SQL problems the
error code (never paste tokens or the service key).
```

- [ ] **Step 2: `docs/SPEC.md`** — four edits:

1. §5 table: insert this row right after the `media_tags` row:

```markdown
| `explorer_views` | id, name (1–60 characters, unique ignoring case), state jsonb (the canonical Explorer + Time Scope URL parameters, ≤ 2 KB, re-validated on every read), created_at, updated_at — owner-authored (owner session under `is_owner()` RLS, like tags); at most 50 |
```

2. Insert this section right before the `## 8. UI (v1)` heading:

```markdown
## 7e. Explorer, rollups and drill-down (Plan 12b; creator-toolkit design §0b)
- **Rollups in SQL, not TypeScript** (`supabase/migrations/20261024000001_explorer.sql`): `explorer_daily` (account days per account or per day/week/month bucket; followers = last value per account, summed), `explorer_media` (media published in a range with their latest snapshot, owner-timezone day/weekday/hour; also the single-posts list, newest 500), `explorer_posts` (the same summed per account/format/tag/weekday/hour/bucket; "measured" = reach > 0; engagement parts never include Stories) and `explorer_followers` (last follower count per owner-timezone hour or day from `follower_snapshots`). All `security invoker` (RLS applies), `set search_path = ''`, execute for `authenticated` only; they return additive parts, one row per group. No rollup tables: measured ≤ 0.3 s for 10 accounts × 2 years. The read policies of `account_daily`, `media`, `media_metrics`, `media_tags`, `follower_snapshots` use `(select public.is_owner())` so the check runs once per query.
- **Registry** (`lib/metrics.ts`): each metric has a source (`daily` = account insight days; `posts` = published media) and computes its value from the parts; a new metric = one entry. Dimensions: group, account, format, tag, weekday, hour, time (the Time Scope granularity), single posts. Account totals group by group/account/time only and cannot be narrowed to a format, tag, weekday or hour. Every id in the URL is allow-listed (`lib/explorer/state.ts`); the server maps a state to fixed RPCs — no free-form queries.
- **Explorer** (`/explorer`): metrics (≤ 4), break-down, filters (accounts, group, format incl. Stories, tag/untagged, weekday, hour), Time Scope bar, linked chart (one metric + the comparison period) and table (all metrics with change), saved views (`explorer_views`), Excel export of the current view (`/api/export/explorer`, strict canonical query, `Server-Timing`). Days follow the KPI cards (a rolling range ends on the latest settled day).
- **Drill-down:** group → accounts → formats → single posts → the item level (latest numbers, follower curve around the post, that day's followers/non-followers reach of its format); weekday → hours; a time bucket → that bucket as fixed days, one granularity finer. Breadcrumb `All accounts › group › @account › format › post`; every link keeps the Time Scope. Entry points: Overview tiles, group headings, comparison rows and chart; account format comparison, "your post performance" cells, Posts table.
- **No hourly reach:** Instagram's account insights are daily; hour/weekday mean the publishing time; the only intraday series is the follower count.
```

3. §7b: replace `custom report builder` with `custom report builder (the Explorer, §7e, is a whitelisted analysis view, not a free-form builder)`.
4. §8: in the `Pages:` line, add ` · Explorer (§7e)` before the final period.

- [ ] **Step 3: `docs/TODO.md`** — insert right before the `## 6b. Next (Plan 14/15 Settings)` heading:

```markdown
## 6e. Explorer, rollups, drill-down (Plan 12b)
- [x] SQL rollups (`explorer_daily`, `explorer_media`, `explorer_posts`, `explorer_followers`; security invoker; InitPlan owner check) + `explorer_views` _(code done; **apply migration `20261024000001_explorer.sql` before deploying**; live verification pending — docs/RUNBOOK_EXPLORER.md §0, §5)_
- [x] Metric/dimension registry, `/explorer` (linked chart + table, comparison, filters, breadcrumbs, item level, saved views, Excel export) _(code done; live verification pending — RUNBOOK_EXPLORER §1–§4, §6)_
- [x] Drill-down from Overview (tiles, groups, comparison rows/chart) and account pages (formats, best-time cells, Posts) _(code done; live verification pending — RUNBOOK_EXPLORER §3)_
- [ ] Owner: fill the 1-year Server-Timing numbers in RUNBOOK_EXPLORER §4; confirm the open questions in the plan (Stories opt-in, 500-post cap, 6-tab phone bar)
```

- [ ] **Step 4: Final check**

Run: `npm run check`
Expected: lint, typecheck, every test file and `next build` pass (the build lists `/explorer` and `/api/export/explorer`). Then `git diff --stat app/globals.css` → empty (no shadcn command was run) and `grep -rn 'from "cn"\|next-themes' components/ui` → nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/RUNBOOK_EXPLORER.md docs/SPEC.md docs/TODO.md
git commit -m "docs: Explorer runbook, SPEC §5/§7e, TODO" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
