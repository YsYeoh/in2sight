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

_(pending — filled once `docs/superpowers/plans/2026-10-23-12a-time-scope.md` has its Interfaces committed)_

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
2. **Hostile URL parameters** (`?m=__proto__`, `?acc=' or 1=1`, repeated keys, `?by=drop table`) never reach SQL as text and never throw → Task 3 "hostile or malformed values", Task 4 "maps every state to fixed RPC arguments", Task 10 "rejects anything the page would only fall back on".
3. **Numbers match the existing analyses:** engagement rate, averages and "measured" follow `lib/analysis/posts.ts`/SPEC §7; followers are a level (last value), never summed over days → Task 1 SQL checks (dry run) + Task 5 "groups sum parts, never averages of averages".
4. **Saved views can't smuggle anything:** stored JSON is re-validated through both parsers on read; unknown keys dropped; size-capped in the DB → Task 6.
5. **Drill keeps the scope:** every drill link and breadcrumb carries the Time Scope; a time-bucket drill becomes a fixed range → Task 5 "drill targets" + Task 11 page test + runbook §3.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261024000001_explorer.sql` (new) | `explorer_daily`, `explorer_media`, `explorer_posts`, `explorer_followers`; read-policy InitPlan rewrite; `explorer_views` |
| `tests/explorer-migration.test.ts` (new) | migration lint |
| `lib/metrics.ts` | registry: `MetricId`, `MetricSource`, parts types, `value()`, `DIMENSIONS`, `supports`, guards |
| `components/shared/useKpiDelta.ts` | accepts any `MetricId` |
| `messages/en.json`, `messages/zh-CN.json` | `nav.explorer`, new `metrics.*`, `explorer.*` |
| `lib/explorer/state.ts` (new) | `ExplorerState`, `parseExplorerState`, `explorerParams`, `withState`, `defaultMetrics` |
| `lib/explorer/read.ts` (new) | owner-session RPC reader: `loadRollup`, `loadItems`, `rollupArgs` |
| `lib/analysis/explorer.ts` (new) | `toKpi`, `addParts`, `byGroup`, `itemParts`, `buildExplorer`, `drillTarget`, `breadcrumbs` |
| `lib/explorer/views.ts` (new), `app/(app)/explorer/actions.ts` (new), `lib/tags.ts` | saved-view validation, server actions; `normalizeTagName` gains a `max` |
| `components/charts/SeriesChart.tsx`, `components/charts/Heatmap.tsx` | `onPointClick` + `clickedIndex`, muted series; cell `href` |
| `lib/explorer/item.ts` (new), `components/explorer/ItemPanel.tsx` (new) | single-item level |
| `components/explorer/SavedViews.tsx` (new) | saved views menu, save/rename/delete dialogs |
| `app/api/export/explorer/route.ts` (new), `lib/export/workbook.ts` | export of the current view |
| `app/(app)/explorer/page.tsx`, `loading.tsx` (new), `components/explorer/ExplorerView.tsx` (new), `lib/nav.ts`, `components/shared/AppShell.tsx` | the page, nav item |
| `components/overview/OverviewView.tsx`, `components/account/AccountOverview.tsx`, `components/account/PostsTab.tsx`, `app/(app)/accounts/[id]/page.tsx` | drill links into the Explorer |
| `docs/RUNBOOK_EXPLORER.md` (new), `docs/SPEC.md`, `docs/TODO.md` | live checks, spec sections, ticks |

**Adding i18n keys:** merge the given object into the existing top-level key of the same name in BOTH files (create it if missing), keep existing entries, 2-space JSON.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | migration, `tests/explorer-migration.test.ts` | 2, 7 |
| 2 | Registry + all i18n keys | — | `lib/metrics.ts`, `components/shared/useKpiDelta.ts`, `messages/*.json`, `tests/explorer-registry.test.ts` | 1, 7 |
| 3 | Explorer URL state | 2 | `lib/explorer/state.ts`, `tests/explorer-state.test.ts` | 1, 7 |
| 4 | Rollup reader | 3 | `lib/explorer/read.ts`, `tests/explorer-read.test.ts` | 5, 6, 7 |
| 5 | Pure model: rows, groups, comparison, drill, breadcrumbs | 3, 12a | `lib/analysis/explorer.ts`, `tests/analysis-explorer.test.ts` | 4, 6, 7 |
| 6 | Saved views: validation + server actions | 3, 12a | `lib/explorer/views.ts`, `lib/tags.ts`, `app/(app)/explorer/actions.ts`, `tests/explorer-views.test.ts` | 4, 5, 7 |
| 7 | Clickable charts | — | `components/charts/{SeriesChart,Heatmap}.tsx`, `tests/charts-drill.test.tsx` | 1–6 |
| 8 | Single-item level | 4 | `lib/explorer/item.ts`, `components/explorer/ItemPanel.tsx`, `tests/explorer-item.test.tsx` | 9, 10, 12, 13 |
| 9 | Saved views menu | 6 | `components/explorer/SavedViews.tsx`, `tests/saved-views.test.tsx` | 8, 10, 12, 13 |
| 10 | Export of the current view | 4, 5 | `app/api/export/explorer/route.ts`, `lib/export/workbook.ts`, `tests/explorer-export.test.ts` | 8, 9, 12, 13 |
| 11 | Explorer page + nav | 5, 7–10, 12a | `app/(app)/explorer/{page,loading}.tsx`, `components/explorer/ExplorerView.tsx`, `lib/nav.ts`, `components/shared/AppShell.tsx`, `tests/explorer-view.test.tsx`, `tests/explorer-page.test.tsx`, `tests/nav.test.ts`, `tests/app-shell.test.tsx` | 12, 13 |
| 12 | Drill from Overview | 3, 5, 12a | `components/overview/OverviewView.tsx`, `tests/overview-drill.test.tsx` | 8–11, 13 |
| 13 | Drill from account pages | 3, 5, 7, 12a | `components/account/AccountOverview.tsx`, `components/account/PostsTab.tsx`, `app/(app)/accounts/[id]/page.tsx`, `tests/account-drill.test.tsx` | 8–12 |
| 14 | Docs: SPEC, TODO, RUNBOOK_EXPLORER; final check | all | `docs/*` | — |

Run order for SDD: wave A = 1, 2, 7 · wave B = 3 · wave C = 4, 5, 6 · wave D = 8, 9, 10, 12, 13 · wave E = 11 · wave F = 14. Tasks in one wave touch disjoint files.

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

_(pending — registry code is dry-run; the complete i18n block is written after the UI tasks so that every key used by Tasks 8–13 is added here once)_

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
  - `defaultMetrics(by): MetricId[]`, `parseExplorerState(sp: Record<string, string | string[] | undefined>): ExplorerState` (never throws), `explorerParams(s): URLSearchParams` (canonical, fixed key order, defaults omitted), `withState(s, patch): ExplorerState` (re-applies the metric/dimension rule).
  - None of these keys collide with the Time Scope keys of 12a (`from`, `to`, `cmp`, `cfrom`, `cto`, `gran`, `week`, `month`, `quarter`, `period`).

- [ ] **Step 1: Write the failing test** — create `tests/explorer-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultMetrics, explorerParams, MAX_ACCOUNTS, parseExplorerState, withState } from '@/lib/explorer/state';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('parseExplorerState', () => {
  it('nothing in the URL: accounts compared on account totals', () => {
    expect(parseExplorerState({})).toEqual({ metrics: ['reach', 'engagementRate', 'posts', 'avgReach'], chart: 'reach', by: 'account', accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
  });

  it('keeps valid values in the given order, drops duplicates, caps metrics at 4', () => {
    const s = parseExplorerState({ m: 'likes,reach,likes,shares,saves,comments', chart: 'shares', by: 'time', acc: `${A.toUpperCase()},${B},${A}`, grp: 'Food', fmt: 'REELS', tag: B, wd: '3', hr: '20', item: '17895695668004550' });
    expect(s).toEqual({ metrics: ['likes', 'reach', 'shares', 'saves'], chart: 'shares', by: 'time', accounts: [A, B], group: 'Food', format: 'REELS', tag: B, weekday: 3, hour: 20, item: '17895695668004550' });
  });

  it('metrics the dimension cannot show are dropped (account totals have no format); none left = the defaults', () => {
    expect(parseExplorerState({ m: 'reach,likes', by: 'format' }).metrics).toEqual(['likes']);
    expect(parseExplorerState({ m: 'reach,views', by: 'hour' }).metrics).toEqual(defaultMetrics('hour'));
    expect(defaultMetrics('hour')).toEqual(['posts', 'avgReach', 'postEngagementRate']);
  });

  it('hostile or malformed values fall back per part and never throw', () => {
    const s = parseExplorerState({
      m: ['reach', 'posts'], by: 'drop table', chart: 'toString', acc: `x,${"'; select 1 --"},${A}`, grp: ' Food ', fmt: 'reels',
      tag: '../etc', wd: '7', hr: '-1', item: 'a/b',
    });
    expect(s).toEqual({ metrics: defaultMetrics('account'), chart: 'reach', by: 'account', accounts: [A], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
    expect(parseExplorerState({ wd: '03', hr: '024', tag: 'untagged', m: '__proto__,constructor' })).toMatchObject({ weekday: 3, hour: null, tag: 'untagged', metrics: defaultMetrics('account') });
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

describe('withState', () => {
  it('changing the dimension drops metrics it cannot show and keeps the chart metric when possible', () => {
    const s = parseExplorerState({ m: 'reach,likes,posts', chart: 'likes', by: 'account' });
    expect(withState(s, { by: 'format' })).toMatchObject({ by: 'format', metrics: ['likes', 'posts'], chart: 'likes' });
    expect(withState(parseExplorerState({ m: 'reach', by: 'time' }), { by: 'hour' })).toMatchObject({ metrics: defaultMetrics('hour'), chart: 'posts' });
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
import { isDimensionId, isMetricId, supports, type DimensionId, type MetricId } from '@/lib/metrics';
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

/** Defaults when the URL names no usable metric: account totals where the dimension allows them, post numbers otherwise. */
export function defaultMetrics(by: DimensionId): MetricId[] {
  return supports('reach', by) ? ['reach', 'engagementRate', 'posts', 'avgReach'] : ['posts', 'avgReach', 'postEngagementRate'];
}

function intIn(v: string | null, min: number, max: number): number | null {
  if (v === null || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export function parseExplorerState(sp: Params): ExplorerState {
  const by: DimensionId = isDimensionId(one(sp.by)) ? (one(sp.by) as DimensionId) : 'account';
  const asked = (one(sp.m) ?? '').split(',').filter(isMetricId).filter((id) => supports(id, by));
  const metrics = asked.length ? [...new Set(asked)].slice(0, MAX_METRICS) : defaultMetrics(by);
  const chart = one(sp.chart);
  const accounts = [...new Set((one(sp.acc) ?? '').split(',').filter(isUuid).map((id) => id.toLowerCase()))].slice(0, MAX_ACCOUNTS);
  const g = normalizeGroup(one(sp.grp) ?? undefined);
  const fmt = one(sp.fmt);
  const tag = one(sp.tag);
  const item = one(sp.item);
  return {
    metrics,
    chart: isMetricId(chart) && metrics.includes(chart) ? chart : metrics[0],
    by,
    accounts,
    group: g.ok && g.value !== null && g.value === one(sp.grp) ? g.value : null, // only an exact, already-normal name
    format: fmt && (FORMATS as readonly string[]).includes(fmt) ? (fmt as MediaKind) : null,
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    weekday: intIn(one(sp.wd), 0, 6),
    hour: intIn(one(sp.hr), 0, 23),
    item: isMediaId(item) ? item : null,
  };
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

/** A new state with some parts changed: metrics the new dimension cannot show are dropped, the chart metric follows. */
export function withState(s: ExplorerState, patch: Partial<ExplorerState>): ExplorerState {
  const next = { ...s, ...patch };
  const kept = next.metrics.filter((id) => supports(id, next.by));
  const metrics = kept.length ? kept : defaultMetrics(next.by);
  return { ...next, metrics, chart: metrics.includes(next.chart) ? next.chart : metrics[0] };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/explorer-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/explorer/state.ts tests/explorer-state.test.ts
git commit -m "feat(explorer): allow-listed URL state (metrics, group-by, filters, item)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rollup reader (`lib/explorer/read.ts`)

_(pending)_

---

### Task 5: Pure model (`lib/analysis/explorer.ts`)

_(pending)_

---

### Task 6: Saved views — validation + server actions

_(pending)_

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

_(Tasks 8–14 pending)_
