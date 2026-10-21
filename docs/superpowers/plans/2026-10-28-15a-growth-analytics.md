# Plan 15a: Growth analytics (Followers & Growth Center, part 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** A **Growth** tab on every account page (beside Overview / Posts / Stories, with the range bar) that answers "how are my followers moving and why": six KPI cards with sparklines (Followers, Net follows, Follows, Unfollows, Churn rate, Non-follower reach); a Followers chart (hourly points for ranges of 7 days or less, daily otherwise) with the range's growth (absolute and %) and a 7 / 30 / 90-day projection that states its method, sample and confidence; Follows vs unfollows per day (Instagram's numbers, or the follower-count change when Instagram gives none, said on screen) with churn, best and worst days and "what was published that day" in the tooltip; Followers vs non-followers reached over time and per format; Audience then-vs-now (age, gender, countries, cities) with notable changes highlighted; and **"Why did this change?"**: an "Unusual days" list (robust z-score against the account's own same-weekday history, with a sample guard) and, for any clicked or picked day, rule-based reasons with their evidence, a confidence word and the sample size.

**Architecture:** No migration and no new table: the tab reads the existing tables with the owner session (`account_daily`, `account_daily_breakdown`, `media`, `audience_snapshots`, `comments`, and the live `explorer_followers` SQL function for the hourly curve) for the range plus a 90-day look-back, and computes everything in pure functions: `lib/analysis/trend.ts` (robust z-score, same-weekday anomaly, the median-slope projection), `lib/analysis/why.ts` (the per-day facts type and the reason rules) and `lib/dashboard/growth.ts` (the tab model: KPIs, series, flow, loyalty, audience change, unusual days). The model is built on the server; the "Why" panel runs `explainDay` in the browser on the model's per-day facts, so picking a day costs no server round trip. The picked day lives in the URL (`?day=…&why=…`, written with `history.replaceState`, which Next keeps in sync with `useSearchParams`), so a link reopens the same explanation. Charts reuse `SeriesChart` (two small additive props: a good/bad series tone and a tooltip label formatter) and `Sparkline`; KPI deltas reuse `deltaView` (which now also accepts a `{ kind, higherIsBetter }` definition for the four growth numbers that are not Explorer metrics).

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, Supabase Postgres (owner session, RLS), `@supabase/supabase-js`, next-intl 4, Recharts 3 (via `SeriesChart`), shadcn/Radix, lucide-react, Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §6 "Audience & growth" (Followers daily, Follow flow, Loyalty vs discovery, Demographics over time; NOT Top commenters = Plan 15c, NOT Followers diff = Plan 15b), §0b (owner decisions: "Why did this change?", anomaly detection "unusual for that account/weekday/hour, not fixed thresholds", "the app does the work", every tool states its data source, sample size and why you can or can't trust it, engagement rate both ways is untouched here), §2 (what the API allows), §8 (cross-cutting rules). UX rules: `docs/superpowers/specs/2026-10-20-ux-polish-and-tabs-design.md` and `docs/UI_STANDARDS.md` (a trend page uses `RangeBar` + `parseTimeScope`/`resolveScope`; underline tabs; one control height; full-word labels; URL is the state). Project rules: `CLAUDE.md` (binding). Plan 15b (followers diff upload, `docs/superpowers/plans/2026-10-28-15b-followers-diff.md`) is written in parallel and is independent of this plan except for `messages/*.json` (see "Running with Plan 15b").

**Dry run:** the projection and z-score numbers in Tasks 2 and 6 were computed by a scratch implementation of the algorithms below (outside the repo); every expected value in the tests is that output.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- ⚠ **A Growth tab, not a section of Overview.** `TABS = ['overview', 'growth', 'posts', 'stories']`, `?tab=growth`. Why: the account Overview is the 10-second briefing (KPIs, reach/followers trend, formats, flags, best time, audience) and is already long; Growth adds five chart cards and its own reads (90-day look-back, breakdown rows, story and comment counts) that should only load when asked for (each tab streams only its own data). The range bar shows on Growth exactly as on Overview (`RangeBar` with `keep={{ tab: 'growth' }}`, so a range change stays on the tab). Open question 1.
- ⚠ **No all-accounts Growth roll-up on Overview in this plan.** The Overview cards already show Followers and Net follows per account with their deltas; a cross-account growth ranking belongs to "Compare accounts" (spec §6, content intelligence). Open question 2.
- **No new SQL.** Measured by row counts, not guessed: one account's reach breakdown is ≈ 8 rows a day (2 follow types × ≤ 4 product types, no `UNKNOWN` seen live), so the default Last 30 Days + 90-day look-back is ≈ 1,000 rows (one request), a year ≈ 3,600 rows (4 requests), the 5-year maximum ≈ 15,000 rows (15 requests, paged by `readPages`). Everything else is one row per day (`account_daily`), one row per Story or comment (counted, newest first, capped at 5,000 each) or 6 single-row audience reads. `ponytail:` the breakdown read is the ceiling; if Server-Timing shows the Growth tab over the 1.2 s budget for "All time" (RUNBOOK_GROWTH §5), the upgrade is a `security invoker` rollup function (one row per bucket) with the 14b-style fallback.
- **Followers come from `account_daily.followers`** (the day's last observed count, written on every tick since Plan 5; already loaded by `loadDaily`), not from `follower_snapshots`, because it reaches further back; the **hourly** curve for ranges of ≤ 7 days (`HOURLY_MAX_DAYS`) comes from `explorer_followers(…, p_hourly => true)` (migration `20261024000001`, applied live; the last value per owner-timezone hour, ≤ 192 rows). Days the 90-day backfill imported have no follower count (Instagram has no follower history), so the follower history starts on the connect day: the card says "Follower history starts <date>".
- **Follow flow:** `account_daily.follows` / `unfollows` are stored separately (`follows_and_unfollows` with `breakdown=follow_type`, mapped FOLLOWER = follows, NON_FOLLOWER = unfollows by `lib/instagram/metrics.ts` `FOLLOW_TYPE`, marked UNCERTAIN there). A day with both is `netSource: 'instagram'`; a day without them (Instagram gives none under 100 followers) but with follower counts on that day and the day before uses the change of the count (`netSource: 'derived'`, net only, follows/unfollows null). The card says which (`instagram` / `derived` / `mixed`). The mapping is checked live by RUNBOOK_GROWTH §2 (Instagram's net vs the count change); this plan does not touch the constant.
- **Churn rate** = Σ unfollows in the KPI window ÷ the follower count at the window start (the last count before the first day; else the first count inside the window); null without either. Lower is better.
- **Non-follower reach share** = Σ NON_FOLLOWER reach ÷ Σ (FOLLOWER + NON_FOLLOWER) reach over `account_daily_breakdown` rows with `metric = 'reach'`, **summed over product types** (Instagram reports reach per format; a person reached by a Story and a Reel counts in both — said on screen). Higher = more discovery, so `higherIsBetter: true`. Views by follow type are stored too but not shown (one more series later if wanted).
- **KPI comparison rules:** Followers and Net follows are exactly the Overview KPIs (`summarize` + `kpis` of `lib/analysis/growth.ts`, same window, same comparison). Follows, Unfollows and Churn rate share Net follows' comparability (the same follow-data days): no comparison and the same reason whenever Net follows has none. Non-follower reach compares only when both windows have breakdown rows on ≥ 80 % of their days (`MIN_COVERAGE`), else "not enough history".
- **Projection (exact algorithm, Task 2):** Theil–Sen. The daily follower counts of the 28 days ending on the latest day with a count; at least 14 of them (`PROJECTION.minPoints`), else "not enough history (has n)". `perDay` = the median of the slopes between every pair of days; the band = the 25th and 75th nearest-rank percentiles of those slopes. For h = 7, 30, 90 days after the latest count: value = last + perDay·h, low = last + q25·h, high = last + q75·h (never below 0), then rounded to `step = 10^max(0, ⌊log10(max(1, high − low))⌋)` (value to the nearest step, low down, high up) so the number is never more precise than its band. Confidence: `'medium'` when n ≥ 21 and q25 and q75 have the same sign (the direction is clear), else `'low'`; never "high". The card prints the method, n, the dates and the per-day rate.
- **Anomaly (exact algorithm, Task 2):** a day's value vs the same weekday in the 8 weeks before it (d − 7 … d − 56), at least 4 of those with a value (`ANOMALY.minSamples`), else no verdict ("few samples"). Modified z-score (Iglewicz–Hoaglin): z = (v − median) / (1.4826 × MAD); MAD = 0 → (v − median) / (1.2533 × mean absolute deviation); both 0 → z = null. Unusual when (|z| ≥ 3.5, or z = null and v ≠ median) AND |v − median| ≥ max(3, 10 % of |median|) (`ANOMALY.minAbs`, `minRel`: 1 → 2 follows is never "unusual"). Run on two daily series: net follows and reach. The tab lists at most 10 unusual days of the range, the most extreme first.
- **"Why did this change?" (exact rules, Task 3):** pure `explainDay(days, day, metric)`. Baseline = the 28 days before the day (not the day itself); typical = their median (≥ 7 values, else "not enough earlier days"); direction = the day's value vs typical. Six rules — `posted` (feed posts and Reels of that day and the day before; the one with the most reach vs the median reach of earlier posts of the same format, ≥ 5 of them, within 90 days), `no_posts` (none in those two days while the account usually posts at least every 4 days), `stories` (account-level Story reach that day vs typical, ≥ 30 % off), `non_followers` (non-follower share of reach vs typical, ≥ 5 points off), `time_of_day` (the top post's hour ± 1 h usually reaches ≥ 20 % more or less than the median post, ≥ 3 posts), `comments` (≥ 5 comments that day and ≥ 2 × typical) — each with a direction, a weight, its evidence values, n, and a confidence word (`'medium'` at the stated larger sample, else `'low'`; never "high": a rule finds a pattern, not a cause). Reasons pointing the other way than the change are dropped; the rest are sorted by weight (ties in the rule order above), at most 4. The panel always says "Patterns, not proof".
- **The picked day is URL state:** `day=YYYY-MM-DD` (a real day inside the range, else ignored) and `why=reach` (default `net`, omitted). Picking writes the URL with `window.history.replaceState` (Next 16 syncs `useSearchParams` with it: no server request, no history entry per click, the shell tab's frame bridge sees the new URL); the component also keeps the pick in local state. A range change drops both (the range bar carries only `tab`). A chart click picks a day only when the chart is daily (`gran = day`); otherwise the card says "Choose Group by: Day to click single days". The "Unusual days" list is the keyboard path (the chart click is mouse-only, as in the Explorer).
- **Audience over time = then vs now:** for each kind the first snapshot inside the range and the latest one inside the range (`audience_snapshots`, one per day since connect, timeframe `this_month` = Instagram's rolling month). Rows: the top 8 keys of "now" (age buckets with the genders added up; gender F / M / unspecified; countries; cities) with their share then and now and the change in points; a change of ≥ 2 points (`NOTABLE_PP`) with ≥ 100 people counted in both snapshots is highlighted. A key outside "then"'s top-45 list has no "then" (shown as "—", never 0). No share-over-time line (it would read every daily jsonb snapshot; Open question 6).
- **"What happened that day":** the follow-flow and loyalty tooltips name the bucket's posts and Stories ("2 posts, 3 Stories"); best / worst day lines say the same; the Why panel lists the posts with Instagram links. Story and comment counts are read newest first and capped at 5,000 rows each (`DAY_COUNT_LIMIT`); a capped read says from which day the counts are complete, and older days count as unknown (never 0).
- **Up/down colour:** follows use `--success`, unfollows `--destructive` (the new `tone` of a `SeriesChart` series), KPI sparklines take the delta's tone (`text-success` / `text-destructive` / `text-chart-1`), audience changes use an arrow icon plus `font-medium` (a change in age mix is not good or bad). Tokens only.
- **Every card states its basis** (spec: "data source, sample size, trust"): a source line under each title, `n` next to every "typical", the confidence word, "data starts" lines. This becomes UI standard rule 14 (Task 10).
- **No new dependencies; no Meta calls; no capture or sync changes; Time Scope URL contract unchanged; nothing exported (Plan 9's exports are untouched).**

## Open questions for the owner (the plan implements the default shown)

1. Growth as its own tab (Overview / Growth / Posts / Stories) instead of more sections on Overview? **Default: own tab.**
2. No all-accounts growth roll-up on the Overview page in this plan (the account cards already show Followers and Net follows)? **Default: none now;** a cross-account growth ranking comes with "Compare accounts".
3. Loyalty uses reach (people), not views, and adds the formats up (a person reached by a Story and a Reel counts twice, said on screen)? **Default: yes.**
4. Projection: median slope of the last 28 days, at least 14 days of counts, 7 / 30 / 90 days ahead, a band from the middle half of the day-to-day slopes, rounded to the band's precision, "low" or "medium" confidence only? **Default: yes.**
5. Unusual = robust z-score ≥ 3.5 against the same weekday of the 8 weeks before (at least 4 of them), and at least 3 (or 10 %) away from typical? **Default: yes.**
6. Audience over time as "first snapshot in the range vs latest" with highlighted changes, no per-day share lines? **Default: yes** (lines need a SQL sample of the daily snapshots; add when wanted).
7. Follows / unfollows: show Instagram's numbers as the sync stores them (the FOLLOWER = follow mapping is marked uncertain) and verify it live with RUNBOOK_GROWTH §2 before trusting them? **Default: yes;** if the check fails, a one-line fix in `lib/instagram/metrics.ts` plus a data fix is a separate change.
8. No new SQL now; a rollup function only if the "All time" Growth tab is measured slower than 1.2 s? **Default: yes.**

## Assumptions about the current code (`main` at `0cee097`, read for this plan)

- **Tables** (all owner-select RLS, written only by the sync's admin client): `account_daily (account_id, day date, followers, reach, views, accounts_engaged, total_interactions, follows, unfollows, link_taps)` PK `(account_id, day)` (`20261015000001_sync.sql`); `account_daily_breakdown (account_id, day, metric 'reach'|'views', follow_type, product_type, value int not null)` PK `(account_id, day, metric, follow_type, product_type)`, follow_type FOLLOWER | NON_FOLLOWER | UNKNOWN, product_type STORY | REEL | POST | CAROUSEL_CONTAINER | AD (`20261019000001_capture_v2.sql`); `media (id, account_id, media_type IMAGE|CAROUSEL_ALBUM|REELS|STORY, permalink, caption, posted_at, …)` with index `media_account_posted_idx (account_id, posted_at desc)`; `audience_snapshots (account_id, day, kind 'age_gender'|'country'|'city', data jsonb)` PK `(account_id, day, kind)`, written once a day by the `audience` job with timeframe `this_month` (`lib/sync/run-account.ts` `audience`, `lib/instagram/metrics.ts` `DEMOGRAPHICS_TIMEFRAME`); `comments (id, account_id, media_id, …, commented_at timestamptz not null, …)` with index `comments_account_idx (account_id, commented_at desc)` (`20261022000001_capture_v2b.sql`; filled only for accounts that granted the comments scope). Function `public.explorer_followers(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_hourly boolean) returns table (at text, followers int)` (`20261024000001_explorer.sql`, applied live 2026-10-19): the last value per owner-timezone hour (`'YYYY-MM-DD"T"HH24:00'`) or day, from `follower_snapshots`, ordered by `at`. All migrations through `20261027000001` are applied live (docs/HANDOVER.md).
- **Sync facts:** `account_daily.followers` is written for "today" on each profile run (`upsertFollowers(account, today, count)`), so a day's value is its last observed count; backfilled days (Instagram's 90-day window, `backfill` job) get reach/views/follows/unfollows but no followers. `follows`/`unfollows` come from `follows_and_unfollows` + `breakdown=follow_type` (`FOLLOW_TYPE = { follows: 'FOLLOWER', unfollows: 'NON_FOLLOWER' }`, UNCERTAIN) and are null under 100 followers.
- `lib/analysis/types.ts`: `DailyRow { day; followers; reach; views; accountsEngaged; interactions; follows; unfollows; linkTaps }` (all `number | null` except `day`), `Post { id; accountId; mediaType: MediaKind; postedAt; permalink; reach; views; likes; comments; shares; saves }`, `MissingReason` = `'no_data' | 'needs_100_followers' | 'not_enough_history' | 'not_enough_posts' | 'backfilling' | 'needs_5_viewers' | 'few_posts'` (each has `analysis.reasons.<key>` in both locales).
- `lib/analysis/growth.ts`: `summarize(rows, posts, window, today, tz, cmp)` → `Summary { period; from; endDay; compare: DayRange | null; current: Totals; prior: Totals; coverage; reachByDay }`, `kpis(s, { backfilling? })` → `Record<KpiId, Kpi>`, `Kpi { value; prior; diff; change; reason: MissingReason | null }`, `MIN_COVERAGE = 0.8`, `MAX_LAG_DAYS = 3`. `lib/analysis/explorer.ts`: `toKpi(value, prior): Kpi` (null value → reason `'no_data'`; null prior → no delta, reason null). `lib/analysis/posts.ts`: `median(values: number[]): number | null` (mean of the two middles for an even count). `lib/analysis/best-time.ts`: `weekdayOf(day): 0..6` (0 = Sunday). `lib/analysis/buckets.ts`: `bucketize(rows, gran, weekStart, aggs)` → `{ rows; partial }` (rows must be consecutive days, oldest first; `'sum'` keeps null when no day had a value; `'last'` = the bucket's last non-null value). `lib/instagram/parse.ts`: `MediaKind`.
- `lib/time-scope/scope.ts`: `ResolvedScope { scope; params; query; preset; window; range; listRange; compare; gran; earliest; partial; comparePartial }`, `readFrom(scope, today)`, `parseTimeScope(sp, weekStart)`, `resolveScope(s, today, earliest)`. `lib/time-scope/range.ts`: `DayRange`, `daysIn`, `daysBetween`, `minDay`, `isDay`, `bucketStart(day, gran, weekStart)`, `Granularity`. `lib/sync/time.ts`: `addDays`, `localDay(at, tz)`, `localHour(at, tz)`, `dayStart`, `daysToIso(from, to, tz)` → `{ fromIso, toIso }`. `lib/prefs.ts`: `WeekStart`, `DEFAULT_PREFS`.
- `lib/dashboard/read.ts`: `loadDaily(db, accountId, fromDay)` (every row from `fromDay`, oldest first, paged), `loadPosts(db, accountId, newest = MEDIA_LIMIT, since)` (feed posts + Reels, no Stories, latest snapshot), `readPages(page, op, { size?, max?, enough? })` → `{ rows; truncated }`, `MISSING_FUNCTION = ['PGRST202', '42883']`, `safeLink`, `MEDIA_LIMIT = 500`, `PAGE = 1000`. `lib/dashboard/detail-read.ts`: `loadAudience(db, accountId)` (latest snapshot per kind; parses counts inline with a private `isCounts`), `AudienceSnapshots = Record<AudienceKind, { day: string; data: Record<string, number> } | null>`. `lib/dashboard/account.ts`: `TABS = ['overview', 'posts', 'stories']`, `Tab`, `parseTab`. `lib/metrics.ts`: `MetricKind`, `MetricDef`, `METRICS`, `MetricId`, `deltaView(id: MetricId, k, p)`, `formatMetric(id, value, p, { full? })`. `lib/format.ts`: `formatNumber(n, p, opts?)`, `formatCompact`, `formatPercent(ratio, p, digits = 1)`, `formatSigned(n, p, digits = 0)`, `formatDelta(ratio, p, digits = 1)`, `formatDay(day, p)`, `formatHour(hour, p)`, `formatDateTime`, `formatCountry(code, p)` (all return `'—'` for null).
- Components: `StatCard({ label, value, delta?, comparison, note?, spark?, className? })` and `DeltaPill`, `StatDelta { text; direction; tone: 'good' | 'bad' | 'neutral' }`; `ChartCard({ title, subtitle?, actions?, summary?, table?, tableLabel?, children })`; `SeriesChart({ kind, data, xKey, series: Series[], title, desc?, height?, formatX?, formatY?, animate?, onPointClick? })`, `Series { key; label; muted? }`, `seriesColor(i)`; `Sparkline({ data, className?, height? })` (colour = `currentColor`); `DataTable({ rows, columns, rowKey, caption, empty, initialSort?, … })`, `Column<T> { key; header; cell; sortValue?; align? }`; `RangeBar({ scope, today, keep })` (`keep` = params every range link carries), `useScopeText`, `useBucketFormat(gran, partial)`; `useKpiDelta()` → `(id: MetricId, k) => StatDelta | null`; `usePrefs()`. `AccountView` renders `<RangeBar scope={scope} today={today} />` only when `v === 'overview'`. Colour tokens: `--success`, `--danger` (Tailwind `text-success`, `text-destructive`), `--chart-1..6`.
- Tests: `tests/account-page.test.tsx` mocks `@/lib/dashboard/read` and `@/lib/dashboard/detail-read` with factories (a module the page newly imports must be mocked there too); `tests/account-view.test.tsx` mocks `useRouter` and has the Radix DOM stubs; `tests/route-loading.test.tsx` runs `it.each(TABS)` over `TabSkeleton` (its `default` branch already serves a new tab); `tests/dashboard-account.test.ts` pins `TABS`; `tests/ui-standards.test.ts` pins the `<RangeBar` users (`AccountView` is already one), forbids `7d`-style labels in message values and `size="sm"` in `AccountView`; `tests/messages.test.ts` enforces key and placeholder parity and that zh-CN differs from en; `tests/css-vars-defined.test.ts` checks `var(--x)` in `components/ui` and `components/shared`.

## Out of scope

Followers diff upload (Plan 15b); comments ingestion changes, top commenters, fans, moderation (Plan 15c); goals, compare accounts, insights feed, digests; the Overview page; exports; any sync, capture, Meta metric or `FOLLOW_TYPE` change; SQL functions, indexes, tables.

## Data not captured that a requested feature would need

- **Engaged-audience demographics** (spec §6 "engaged-audience demographics added"): `engaged_audience_demographics` is not requested by the sync; only follower demographics (`this_month`) are stored. The `last_30_days` / `last_90_days` timeframes work (probe) but are not captured.
- **Follower counts before the connect day:** Instagram has no follower history; backfilled days have reach and follows but no count, so the follower chart, churn and projection start at the connect day.
- **Follows / unfollows under 100 followers:** Instagram returns nothing; the tab falls back to the count change (net only).
- **Per-post follower vs non-follower split:** not offered by the API (account level only), so "why" uses the day's account-level split.
- **Comments:** only for accounts connected with `instagram_business_manage_comments` (older connections need a reconnect); without them the comments rule never fires.
- **Intraday reach:** not offered (daily only); the only intraday series is the follower count.

## Global Constraints

- Ponytail: smallest thing that works. No SQL, no new table, no new dependency, no new design token. Reuse `summarize`/`kpis`, `bucketize`, `median`, `toKpi`, `readPages`, `SeriesChart`, `Sparkline`, `StatCard`, `ChartCard`, `DataTable`, `RangeBar`. A shared piece only where a second user exists (`audienceRow`: `loadAudience` + `loadAudienceEnds`; the `deltaView` definition form: Growth KPIs + every registry KPI).
- TypeScript strict. No Meta metric names touched (`lib/instagram/metrics.ts` unchanged).
- Reads: OWNER SESSION client only (`createServerSupabase`), under RLS; never the admin client, never `account_tokens`; every read filtered by the URL's account id; explicit columns (no `*`); fixed error messages (`dashboard read: <op> failed`) that never echo Supabase errors; hard row caps.
- Pure analysis in `lib/analysis/` and `lib/dashboard/growth.ts`: `today`, `tz`, `weekStart` are inputs (no `new Date()` there); null-safe everywhere (a missing number is null with a reason, never 0, never NaN or Infinity).
- Every UI string via next-intl; ALL new keys are added by Task 1 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation); full-word labels (no `7d`, `1y`); `tests/messages.test.ts` and `tests/ui-standards.test.ts` must pass.
- UI standard (`docs/UI_STANDARDS.md`): trend page = `RangeBar` + the resolved scope; one control height per row; underline tabs; the URL is the state. Theming: semantic tokens only (`--success`, `--danger`, `--chart-n`, `text-muted-foreground`, …), checked in light and dark of every theme. Responsive 360 / 768 / 1280: `min-w-0` grids, `grid-cols-2 md:grid-cols-3 xl:grid-cols-6` KPI row, `lg:grid-cols-2` chart rows, no fixed pixel widths, CSS breakpoints only (never `matchMedia`).
- Dates, times and numbers only via `lib/format.ts`.
- Tests: Vitest timeout 20 s; jsdom 29; component tests copy the Radix stubs block of `tests/account-view.test.tsx` and the `next/navigation` mock below; rerun a file alone on "worker start timeout"; never chain a commit after a piped command.
- `npm run check` passes after every wave. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **Missing data never becomes a number:** an account under 100 followers (no follows/unfollows), a new account (3 days of counts), days the backfill imported (no follower count), capped Story/comment counts, no breakdown rows, no audience snapshot → null + a stated reason, a "data starts" line, no NaN/Infinity/"undefined" in either language → Task 6 "a new small account", Task 8 "zh-CN, no data".
2. **Owner-timezone days and hours:** a post at 23:30 local time belongs to that local day and hour 23, not the UTC day; Story/comment counts are grouped by local day → Task 4 "counts by owner-timezone day", Task 6 "posts land on their owner-timezone day and hour".
3. **Honest comparisons and guards:** Follows / Unfollows / Churn never show a delta when Net follows cannot compare; non-follower share needs 80 % coverage on both sides; no projection under 14 days of counts; no "unusual" with fewer than 4 same-weekday values or for a change of 1–2; no "high" confidence anywhere; reasons pointing the other way are dropped → Tasks 2, 3, 6.
4. **Hostile or stale URL state:** a `day` that is malformed, repeated, outside the range or in the future, a junk `why` → ignored (no reasons, no crash); a range change drops `day`/`why`; the tab survives range changes → Task 6 `parseWhyParams`, Task 9 "the range bar on Growth keeps the tab".
5. **The chart click has a keyboard path and does not hit the server:** picking an unusual day or clicking a daily chart point updates the URL by `history.replaceState` (no navigation, no server render) and shows the reasons; weekly/monthly charts say how to get daily points → Task 8.

## File Structure

| File | Responsibility |
|---|---|
| `messages/en.json`, `messages/zh-CN.json` | every new key (Task 1) |
| `lib/analysis/trend.ts` (new), `tests/analysis-trend.test.ts` (new) | `robustZ`, `weekdayAnomaly`, `projectFollowers` and their constants |
| `lib/analysis/why.ts` (new), `tests/analysis-why.test.ts` (new) | per-day facts (`GrowthDay`, `DayPost`), `UnusualDay`, the reason rules (`explainDay`) |
| `lib/dashboard/growth-read.ts` (new), `lib/dashboard/detail-read.ts`, `tests/growth-read.test.ts` (new) | readers: reach breakdown, hourly follower curve, Story and comment counts per day, audience snapshots at both ends of the range; `audienceRow` shared with `loadAudience` |
| `components/charts/SeriesChart.tsx`, `lib/metrics.ts`, `components/shared/useKpiDelta.ts`, `tests/charts.test.tsx`, `tests/metrics.test.ts` | series `tone` and tooltip `formatLabel`; `deltaView` / `useKpiDelta` accept a `{ kind, higherIsBetter }` definition |
| `lib/dashboard/growth.ts` (new), `tests/dashboard-growth.test.ts` (new) | the Growth tab model (`buildGrowth`), read window (`growthReadFrom`), audience then-vs-now (`audienceChange`), URL state (`parseWhyParams`, `whyHref`) |
| `components/account/WhyPanel.tsx` (new), `tests/why-panel.test.tsx` (new) | unusual-days list + the explanation of the picked day |
| `components/account/GrowthTab.tsx` (new), `tests/growth-tab.test.tsx` (new) | the tab: KPIs, followers + projection, follow flow, loyalty, audience change, Why panel wiring |
| `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | wiring: the `growth` tab, the range bar on it, the server reads |
| `docs/RUNBOOK_GROWTH.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/UI_STANDARDS.md` | live checks, spec §7g, ticks, handover lines, rule 14 |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys; zh-CN uses full-width punctuation (`，：（）。`).

**Running with Plan 15b:** 15b also adds keys to `messages/*.json` and may touch `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`. If both plans run in the same rounds, never put 15a Task 1 and 15b's i18n task in the same wave, nor 15a Task 10 and 15b's docs task; otherwise the plans touch disjoint files.

**Mocking `next/navigation` in component tests (Tasks 8, 9):** `const { push, replace, search } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: { value: '' } }));` and `vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }), useSearchParams: () => new URLSearchParams(search.value) }));`.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | i18n: every new key | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3, 4, 5 |
| 2 | Trend maths: robust z, same-weekday anomaly, projection | — | `lib/analysis/trend.ts`, `tests/analysis-trend.test.ts` | 1, 3, 4, 5 |
| 3 | "Why did this change?" rules | — | `lib/analysis/why.ts`, `tests/analysis-why.test.ts` | 1, 2, 4, 5 |
| 4 | Growth readers | — | `lib/dashboard/growth-read.ts`, `lib/dashboard/detail-read.ts`, `tests/growth-read.test.ts` | 1, 2, 3, 5 |
| 5 | Chart tone + tooltip label; `deltaView` with a definition | — | `components/charts/SeriesChart.tsx`, `lib/metrics.ts`, `components/shared/useKpiDelta.ts`, `tests/charts.test.tsx`, `tests/metrics.test.ts` | 1, 2, 3, 4 |
| 6 | Growth model | 2, 3, 4 | `lib/dashboard/growth.ts`, `tests/dashboard-growth.test.ts` | 7 |
| 7 | `WhyPanel` | 1, 3 | `components/account/WhyPanel.tsx`, `tests/why-panel.test.tsx` | 6 |
| 8 | `GrowthTab` | 1, 5, 6, 7 | `components/account/GrowthTab.tsx`, `tests/growth-tab.test.tsx` | — (wave C alone) |
| 9 | Wiring: tab, range bar, page reads | 4, 6, 8 | `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | 10 |
| 10 | Docs: runbook, spec, TODO, handover, UI standard | 1–8 | `docs/RUNBOOK_GROWTH.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/UI_STANDARDS.md` | 9 |

Run order: wave A = 1, 2, 3, 4, 5 · wave B = 6, 7 · wave C = 8 · wave D = 9, 10. Tasks in one wave touch disjoint files. Nothing is reachable from the UI before Task 9 (the tab joins `TABS` there), so `main` works after every wave; Task 9 changes `TABS`, its users and the three tests that pin them in one commit. After wave D the orchestrator runs the full `npm run check`.

---

### Task 1: i18n — every new key

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts`, `tests/ui-standards.test.ts` (existing guards)

**Interfaces:**
- Produces: `pages.account.tab.growth` and the whole `pages.account.growth` namespace below. Tasks 7, 8 and 9 use exactly these keys (placeholders included); Task 8 also uses the existing `metrics.*`, `analysis.format.*`, `analysis.reasons.*`, `pages.overview.points`, `timeScope.partialNote`.

- [ ] **Step 1: Insert the English keys.** In `messages/en.json`, replace the anchor line

```json
      "tab": { "overview": "Overview", "posts": "Posts", "stories": "Stories" },
```

with

```json
      "tab": { "overview": "Overview", "growth": "Growth", "posts": "Posts", "stories": "Stories" },
      "growth": {
        "kpis": "Growth numbers",
        "kpi": { "followers": "Followers", "netFollows": "Net follows", "follows": "Follows", "unfollows": "Unfollows", "churnRate": "Churn rate", "nonFollowerShare": "Non-follower reach" },
        "table": "Show the numbers",
        "followersTitle": "Followers",
        "followersSource": "Your follower count, read about every 30 minutes; one value per day (the day's last count).",
        "followersHourly": "Hourly points: the last count of each hour.",
        "followersSince": "Follower history starts {date} (Instagram keeps no earlier counts).",
        "change": "{abs} ({pct}) in this range",
        "changeNoPct": "{abs} in this range",
        "projectionTitle": "Projection",
        "projectionRow": "In {days, plural, one {# day} other {# days}}: about {value} (between {low} and {high})",
        "projectionMethod": "How: the median daily change between every pair of the {n} days with a count from {from} to {to} ({perDay} a day), continued. A rough guide, not a promise.",
        "projectionNone": "No projection yet: it needs at least 14 days of follower counts in the last 28 days (has {n}).",
        "confidence": { "low": "Low confidence: few days of counts, or the direction is unclear.", "medium": "Medium confidence: a steady direction over {n} days." },
        "flowTitle": "Follows and unfollows",
        "flowSource": {
          "instagram": "Instagram's daily follows and unfollows.",
          "derived": "Instagram shares follows and unfollows from 100 followers, so this shows the daily change of your follower count (net only).",
          "mixed": "Instagram's daily follows and unfollows; days without them show the change of your follower count (net only).",
          "none": "No follow data in this range yet."
        },
        "follows": "Follows",
        "unfollows": "Unfollows",
        "net": "Net change",
        "churn": "Churn: {rate} of your followers unfollowed in this range.",
        "best": "Best days",
        "worst": "Worst days",
        "noDays": "None in this range",
        "dayLine": "{day}: {net}, {activity}",
        "activity": "{posts, plural, =0 {no posts} one {# post} other {# posts}}, {stories, plural, =0 {no Stories} one {# Story} other {# Stories}}",
        "storiesFrom": "Story counts are complete from {date} (only the newest Stories were counted).",
        "dayOnly": "Choose Group by: Day under More ranges to click single days.",
        "loyaltyTitle": "Followers and non-followers reached",
        "loyaltySource": "Instagram's daily reach split by followers and non-followers, added up over formats (someone reached by a Story and a Reel counts twice).",
        "follower": "Followers",
        "nonFollower": "Non-followers",
        "noBreakdown": "No follower and non-follower split in this range yet.",
        "formatsTitle": "Who each format reaches",
        "format": "Format",
        "share": "Non-follower share",
        "shareChange": "Change",
        "product": { "STORY": "Stories", "REEL": "Reels", "POST": "Posts", "CAROUSEL_CONTAINER": "Carousels", "AD": "Ads" },
        "audienceTitle": "Audience over time",
        "audienceSource": "Instagram's follower demographics for the past month, saved once a day; countries and cities: the top 45 only. Changes of 2 points or more are highlighted.",
        "audienceRange": "{from} compared with {to}",
        "audienceSingle": "One snapshot in this range ({date}): a change needs two.",
        "audienceNone": "No demographics in this range (Instagram shares them from 100 followers).",
        "audienceKind": { "age": "Age", "gender": "Gender", "country": "Countries", "city": "Cities" },
        "key": "Group",
        "then": "Then",
        "now": "Now",
        "notable": "Notable change",
        "gender": { "F": "Women", "M": "Men", "U": "Unspecified" },
        "weekday": { "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday", "4": "Thursday", "5": "Friday", "6": "Saturday" },
        "why": {
          "title": "Why did this change?",
          "source": "Rule-based: what was posted that day and the day before, Stories, who was reached and comments, each compared with the 28 days before. Patterns, not proof.",
          "unusualTitle": "Unusual days",
          "unusualHint": "Compared with the same weekday in the 8 weeks before (at least 4 of them).",
          "noUnusual": "Nothing unusual for this account in this range.",
          "unusualItem": "{day}: {metric} {value}, usually {typical} on a {weekday}",
          "metric": { "net": "Net follows", "reach": "Reach" },
          "pick": "Click a day in a daily chart, or pick an unusual day, to see what changed.",
          "headline": "{metric} on {day}: {value}, typical {typical} (median of {n} earlier days)",
          "headlineNoBase": "{metric} on {day}: {value}. Not enough earlier days to say what is typical.",
          "noValue": "No {metric} figure for {day}.",
          "none": "No clear reason in the data we have.",
          "basis": "{confidence} confidence · sample {n}",
          "confidence": { "low": "Low", "medium": "Medium" },
          "when": { "same_day": "that day", "day_before": "the day before" },
          "posts": "Published that day and the day before",
          "reason": {
            "posted": "{format} posted {when} at {hour}: reached {reach}, {ratio}× your typical {format}",
            "postedNoBase": "{format} posted {when} at {hour}: reached {reach} (too few earlier posts of this format to compare)",
            "no_posts": "Nothing posted that day or the day before; you usually post every {every} days",
            "stories": "Story reach {reach}, {change} against the typical {typical} ({stories, plural, =0 {no Stories} one {# Story} other {# Stories}} that day)",
            "non_followers": "Non-followers were {share} of reach, typical {typical}",
            "time_of_day": "Posts around {hour} usually reach {ratio}× your median post",
            "comments": "{comments, plural, one {# comment} other {# comments}} that day, typical {typical}"
          }
        }
      },
```

- [ ] **Step 2: Insert the Simplified Chinese keys.** In `messages/zh-CN.json`, replace the anchor line

```json
      "tab": { "overview": "概览", "posts": "帖子", "stories": "快拍" },
```

with

```json
      "tab": { "overview": "概览", "growth": "增长", "posts": "帖子", "stories": "快拍" },
      "growth": {
        "kpis": "增长数据",
        "kpi": { "followers": "粉丝", "netFollows": "净关注", "follows": "新关注", "unfollows": "取消关注", "churnRate": "流失率", "nonFollowerShare": "非粉丝覆盖占比" },
        "table": "查看数字",
        "followersTitle": "粉丝",
        "followersSource": "粉丝数约每 30 分钟读取一次；每天保留一个值（当天最后一次读数）。",
        "followersHourly": "按小时显示：每小时的最后一次读数。",
        "followersSince": "粉丝历史从 {date} 开始（Instagram 不保留更早的数字）。",
        "change": "本时间范围内 {abs}（{pct}）",
        "changeNoPct": "本时间范围内 {abs}",
        "projectionTitle": "预测",
        "projectionRow": "{days} 天后：约 {value}（介于 {low} 和 {high} 之间）",
        "projectionMethod": "方法：取 {from} 至 {to} 期间 {n} 个有粉丝数的日子，两两之间每日变化的中位数（每天 {perDay}），并按此延续。仅供粗略参考，不是保证。",
        "projectionNone": "暂无预测：需要最近 28 天中至少 14 天的粉丝数（目前 {n} 天）。",
        "confidence": { "low": "可信度低：粉丝数的天数太少，或方向不明确。", "medium": "可信度中等：{n} 天内方向稳定。" },
        "flowTitle": "新关注与取消关注",
        "flowSource": {
          "instagram": "Instagram 提供的每日新关注和取消关注数。",
          "derived": "Instagram 在 100 位粉丝以上才提供新关注和取消关注数，因此这里显示的是粉丝数的每日变化（仅净值）。",
          "mixed": "Instagram 提供的每日新关注和取消关注数；没有这些数据的日子显示粉丝数的变化（仅净值）。",
          "none": "本时间范围内还没有关注数据。"
        },
        "follows": "新关注",
        "unfollows": "取消关注",
        "net": "净变化",
        "churn": "流失：本时间范围内 {rate} 的粉丝取消了关注。",
        "best": "最好的日子",
        "worst": "最差的日子",
        "noDays": "本时间范围内没有",
        "dayLine": "{day}：{net}，{activity}",
        "activity": "{posts, plural, =0 {没有帖子} other {# 个帖子}}，{stories, plural, =0 {没有快拍} other {# 个快拍}}",
        "storiesFrom": "快拍数从 {date} 起完整（只统计了最新的快拍）。",
        "dayOnly": "在「更多时间范围」中选择「分组方式：按天」即可点选单日。",
        "loyaltyTitle": "覆盖的粉丝与非粉丝",
        "loyaltySource": "Instagram 每日覆盖人数按粉丝与非粉丝拆分，并把各种格式相加（同时被快拍和 Reels 覆盖的人会算两次）。",
        "follower": "粉丝",
        "nonFollower": "非粉丝",
        "noBreakdown": "本时间范围内还没有粉丝与非粉丝的拆分数据。",
        "formatsTitle": "各格式覆盖了谁",
        "format": "格式",
        "share": "非粉丝占比",
        "shareChange": "变化",
        "product": { "STORY": "快拍", "REEL": "Reels 短视频", "POST": "帖子", "CAROUSEL_CONTAINER": "轮播", "AD": "广告" },
        "audienceTitle": "受众变化",
        "audienceSource": "Instagram 过去一个月的粉丝人口统计，每天保存一次；国家和城市只有前 45 名。变化达到 2 个百分点或以上时会突出显示。",
        "audienceRange": "{from} 对比 {to}",
        "audienceSingle": "本时间范围内只有一个快照（{date}）：比较需要两个。",
        "audienceNone": "本时间范围内没有人口统计（Instagram 在 100 位粉丝以上才提供）。",
        "audienceKind": { "age": "年龄", "gender": "性别", "country": "国家", "city": "城市" },
        "key": "分组",
        "then": "之前",
        "now": "现在",
        "notable": "明显变化",
        "gender": { "F": "女性", "M": "男性", "U": "未说明" },
        "weekday": { "0": "星期日", "1": "星期一", "2": "星期二", "3": "星期三", "4": "星期四", "5": "星期五", "6": "星期六" },
        "why": {
          "title": "为什么会变化？",
          "source": "基于规则：当天和前一天发布的内容、快拍、覆盖了谁以及评论，各自与之前 28 天相比。这是规律，不是证明。",
          "unusualTitle": "异常的日子",
          "unusualHint": "与之前 8 周中相同的星期几比较（至少 4 个）。",
          "noUnusual": "本时间范围内这个账号没有异常。",
          "unusualItem": "{day}：{metric} {value}，{weekday}通常为 {typical}",
          "metric": { "net": "净关注", "reach": "覆盖人数" },
          "pick": "点选每日图表中的某一天，或选择一个异常的日子，查看发生了什么变化。",
          "headline": "{day} 的{metric}：{value}，通常为 {typical}（之前 {n} 天的中位数）",
          "headlineNoBase": "{day} 的{metric}：{value}。之前的天数不够，无法判断通常水平。",
          "noValue": "{day} 没有{metric}数据。",
          "none": "现有数据中没有明显原因。",
          "basis": "{confidence}可信度 · 样本 {n}",
          "confidence": { "low": "低", "medium": "中" },
          "when": { "same_day": "当天", "day_before": "前一天" },
          "posts": "当天和前一天发布的内容",
          "reason": {
            "posted": "{when} {hour} 发布的{format}：覆盖 {reach}，是你通常{format}的 {ratio} 倍",
            "postedNoBase": "{when} {hour} 发布的{format}：覆盖 {reach}（之前同格式的帖子太少，无法比较）",
            "no_posts": "当天和前一天都没有发布；你通常每 {every} 天发布一次",
            "stories": "快拍覆盖 {reach}，相比通常的 {typical} 变化 {change}（当天{stories, plural, =0 {没有快拍} other {# 个快拍}}）",
            "non_followers": "非粉丝占覆盖人数的 {share}，通常为 {typical}",
            "time_of_day": "在 {hour} 前后发布的帖子，覆盖通常是你帖子中位数的 {ratio} 倍",
            "comments": "当天 {comments} 条评论，通常为 {typical}"
          }
        }
      },
```

- [ ] **Step 3: Run the guards**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts`
Expected: PASS (same keys in both files, matching placeholders — note `projectionRow` keeps `{days}` and `comments` keeps `{comments}` in zh-CN although it uses no plural there; no `7d`-style label).

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): growth tab strings (en, zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
