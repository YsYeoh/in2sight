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
            "storiesNoCount": "Story reach {reach}, {change} against the typical {typical}",
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
            "storiesNoCount": "快拍覆盖 {reach}，相比通常的 {typical} 变化 {change}",
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

### Task 2: Trend maths — robust z-score, same-weekday anomaly, follower projection

**Files:**
- Create: `lib/analysis/trend.ts`
- Test: `tests/analysis-trend.test.ts` (new)

**Interfaces:**
- Consumes: `median` (`lib/analysis/posts.ts`), `addDays` (`lib/sync/time.ts`), `daysBetween` (`lib/time-scope/range.ts`).
- Produces (Task 6 uses all of them):
  - `export const ANOMALY = { weeks: 8, minSamples: 4, threshold: 3.5, minAbs: 3, minRel: 0.1 } as const;`
  - `export const PROJECTION = { days: 28, minPoints: 14, mediumPoints: 21, horizons: [7, 30, 90] } as const;`
  - `export function robustZ(v: number, history: number[]): number | null`
  - `export interface Anomaly { value: number; median: number; n: number; z: number | null; unusual: boolean; direction: 'up' | 'down' | 'flat' }`, `export type AnomalyResult = Anomaly | { reason: 'few_samples'; n: number };`
  - `export function weekdayAnomaly(series: Record<string, number | null>, day: string): AnomalyResult | null` (null = the day has no value)
  - `export interface Projection { method: 'median_slope'; n: number; from: string; to: string; last: number; perDay: number; confidence: 'low' | 'medium'; horizons: { days: number; value: number; low: number; high: number }[] }`, `export type ProjectionResult = Projection | { reason: 'not_enough_history'; n: number };`
  - `export function projectFollowers(points: { day: string; value: number }[]): ProjectionResult`

- [ ] **Step 1: Write the failing test** — create `tests/analysis-trend.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ANOMALY, PROJECTION, projectFollowers, robustZ, weekdayAnomaly, type Anomaly, type Projection } from '@/lib/analysis/trend';
import { addDays } from '@/lib/sync/time';

const WED = '2026-10-14'; // a Wednesday
/** The same weekday 1, 2, 3 … weeks before WED get vals[0], vals[1], vals[2] …; `extra` sets any other day. */
const weekly = (vals: (number | null)[], extra: Record<string, number | null> = {}) => ({ ...Object.fromEntries(vals.map((v, i) => [addDays(WED, -7 * (i + 1)), v])), ...extra });
const series = (start: string, vals: number[]) => vals.map((value, i) => ({ day: addDays(start, i), value }));
const NORMAL = [10, 12, 11, 13, 9, 10, 12, 11]; // median 11, MAD 1

describe('robustZ', () => {
  it('is the modified z-score: (v − median) / (1.4826 × MAD)', () => {
    expect(robustZ(30, NORMAL)).toBeCloseTo(12.815, 3);
    expect(robustZ(11, NORMAL)).toBe(0);
  });

  it('a MAD of 0 falls back to 1.2533 × the mean absolute deviation; an identical or empty history has no z', () => {
    expect(robustZ(9, [5, 5, 5, 5, 9])).toBeCloseTo(3.989, 3);
    expect(robustZ(9, [5, 5, 5, 5])).toBeNull();
    expect(robustZ(5, [])).toBeNull();
  });
});

describe('weekdayAnomaly', () => {
  it('a value far above the same weekday of the 8 weeks before is unusual; other weekdays and older weeks are ignored', () => {
    const r = weekdayAnomaly(weekly(NORMAL, { [WED]: 30, [addDays(WED, -1)]: 1000, [addDays(WED, -63)]: 500 }), WED) as Anomaly;
    expect(r).toMatchObject({ value: 30, median: 11, n: 8, unusual: true, direction: 'up' });
    expect(r.z).toBeCloseTo(12.815, 3);
  });

  it('far below is unusual too (direction down); a usual value is not', () => {
    expect(weekdayAnomaly(weekly(NORMAL, { [WED]: 0 }), WED)).toMatchObject({ unusual: true, direction: 'down' });
    const r = weekdayAnomaly(weekly(NORMAL, { [WED]: 12 }), WED) as Anomaly;
    expect(r).toMatchObject({ unusual: false, direction: 'up' });
    expect(r.z).toBeCloseTo(0.674, 3);
  });

  it('no value on the day → null; fewer than 4 same-weekday values (nulls skipped) → few_samples', () => {
    expect(weekdayAnomaly(weekly(NORMAL), WED)).toBeNull();
    expect(weekdayAnomaly(weekly(NORMAL, { [WED]: null }), WED)).toBeNull();
    expect(weekdayAnomaly(weekly([10, null, 12, null, 11], { [WED]: 50 }), WED)).toEqual({ reason: 'few_samples', n: 3 });
    expect(ANOMALY.minSamples).toBe(4);
  });

  it('tiny or relatively small changes are never unusual: |v − median| must reach max(3, 10 % of the median)', () => {
    expect(weekdayAnomaly(weekly([0, 0, 0, 0, 1, 0, 0, 0], { [WED]: 2 }), WED)).toMatchObject({ unusual: false }); // z ≈ 12.8 but only +2
    expect(weekdayAnomaly(weekly([0, 0, 0, 0], { [WED]: 3 }), WED)).toMatchObject({ z: null, unusual: true, direction: 'up' }); // identical history, +3
    expect(weekdayAnomaly(weekly([1000, 1000, 1010, 990, 1000, 1005, 995, 1000], { [WED]: 1080 }), WED)).toMatchObject({ median: 1000, unusual: false }); // z ≈ 21.6 but +80 < 100
  });
});

describe('projectFollowers', () => {
  it('a steady line: the exact numbers, no band, medium confidence', () => {
    expect(projectFollowers(series('2026-09-17', Array.from({ length: 28 }, (_, i) => 1000 + 10 * i)))).toEqual({
      method: 'median_slope',
      n: 28,
      from: '2026-09-17',
      to: '2026-10-14',
      last: 1270,
      perDay: 10,
      confidence: 'medium',
      horizons: [
        { days: 7, value: 1340, low: 1340, high: 1340 },
        { days: 30, value: 1570, low: 1570, high: 1570 },
        { days: 90, value: 2170, low: 2170, high: 2170 },
      ],
    });
  });

  it('noisy growth: the band is the 25th–75th percentile of the pair slopes, rounded to the band’s precision', () => {
    const noise = [0, 4, -3, 6, -5, 2, 0, -4, 7, -1, 3, -6, 5, 0, -2, 4, -3, 1, 6, -4, 0];
    const p = projectFollowers(series('2026-09-24', noise.map((x, i) => 1000 + 10 * i + x))) as Projection;
    expect(p).toMatchObject({ n: 21, from: '2026-09-24', to: '2026-10-14', last: 1200, perDay: 10, confidence: 'medium' });
    expect(p.horizons).toEqual([
      { days: 7, value: 1270, low: 1265, high: 1275 },
      { days: 30, value: 1500, low: 1480, high: 1520 },
      { days: 90, value: 2100, low: 2000, high: 2200 },
    ]);
  });

  it('no clear direction (the middle half of the slopes spans zero) → low confidence', () => {
    const p = projectFollowers(series('2026-09-24', Array.from({ length: 21 }, (_, i) => 1000 + (i % 2 ? 8 : -8)))) as Projection;
    expect(p).toMatchObject({ n: 21, last: 992, perDay: 0, confidence: 'low' });
    expect(p.horizons).toEqual([
      { days: 7, value: 990, low: 980, high: 1000 },
      { days: 30, value: 990, low: 960, high: 1030 },
      { days: 90, value: 1000, low: 900, high: 1100 },
    ]);
  });

  it('uses only the 28 days ending on the latest count (any order); under 14 counts → not enough history', () => {
    const steady = series('2026-09-17', Array.from({ length: 28 }, (_, i) => 1000 + 10 * i));
    const withOld = [...steady, { day: '2026-09-15', value: 0 }, { day: '2026-09-16', value: 5000 }].reverse();
    expect(projectFollowers(withOld)).toMatchObject({ n: 28, from: '2026-09-17', perDay: 10 });
    expect(projectFollowers(steady.slice(0, 13))).toEqual({ reason: 'not_enough_history', n: 13 });
    expect(projectFollowers([])).toEqual({ reason: 'not_enough_history', n: 0 });
    expect(PROJECTION.minPoints).toBe(14);
  });

  it('never projects below zero; 14–20 counts are low confidence', () => {
    const p = projectFollowers(series('2026-10-01', Array.from({ length: 14 }, (_, i) => 100 - 7 * i))) as Projection;
    expect(p).toMatchObject({ n: 14, last: 9, perDay: -7, confidence: 'low' });
    expect(p.horizons.map((h) => [h.value, h.low, h.high])).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analysis-trend.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/trend"`.

- [ ] **Step 3: Implement `lib/analysis/trend.ts`** — a header comment naming both methods (Iglewicz–Hoaglin modified z-score; Theil–Sen median slope) and why (robust to the odd viral day; never a fake precise number). The algorithms, exactly:

```ts
/** Modified z-score (Iglewicz & Hoaglin): robust to outliers in the history itself. */
export function robustZ(v: number, history: number[]): number | null {
  const m = median(history);
  if (m === null) return null;
  const dev = history.map((x) => Math.abs(x - m));
  const mad = median(dev)!;
  if (mad > 0) return (v - m) / (1.4826 * mad);
  const meanDev = dev.reduce((a, d) => a + d, 0) / dev.length;
  return meanDev > 0 ? (v - m) / (1.2533 * meanDev) : null;
}

export function weekdayAnomaly(series: Record<string, number | null>, day: string): AnomalyResult | null {
  const value = series[day];
  if (typeof value !== 'number') return null;
  const history = Array.from({ length: ANOMALY.weeks }, (_, i) => series[addDays(day, -7 * (i + 1))]).filter((x): x is number => typeof x === 'number');
  if (history.length < ANOMALY.minSamples) return { reason: 'few_samples', n: history.length };
  const m = median(history)!;
  const z = robustZ(value, history);
  const diff = value - m;
  const big = Math.abs(diff) >= Math.max(ANOMALY.minAbs, ANOMALY.minRel * Math.abs(m));
  return { value, median: m, n: history.length, z, unusual: big && (z === null ? diff !== 0 : Math.abs(z) >= ANOMALY.threshold), direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
}

/** Nearest-rank percentile of a sorted list. */
const rank = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

export function projectFollowers(points: { day: string; value: number }[]): ProjectionResult {
  const sorted = [...points].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const last = sorted[sorted.length - 1];
  const w = last ? sorted.filter((p) => p.day >= addDays(last.day, -(PROJECTION.days - 1))) : [];
  if (w.length < PROJECTION.minPoints) return { reason: 'not_enough_history', n: w.length };
  const slopes: number[] = [];
  for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) slopes.push((w[j].value - w[i].value) / daysBetween(w[i].day, w[j].day));
  slopes.sort((a, b) => a - b);
  const perDay = median(slopes)!;
  const q25 = rank(slopes, 0.25);
  const q75 = rank(slopes, 0.75);
  const horizons = PROJECTION.horizons.map((days) => {
    const at = (s: number) => Math.max(0, last.value + s * days);
    const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, at(q75) - at(q25)))));
    return { days, value: Math.round(at(perDay) / step) * step, low: Math.floor(at(q25) / step) * step, high: Math.ceil(at(q75) / step) * step };
  });
  const clear = q25 >= 0 === q75 >= 0;
  return { method: 'median_slope', n: w.length, from: w[0].day, to: last.day, last: last.value, perDay, confidence: w.length >= PROJECTION.mediumPoints && clear ? 'medium' : 'low', horizons };
}
```

`ponytail:` the pair-slope loop is O(n²) on at most 28 points (378 slopes); never run it on longer series.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/analysis-trend.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/trend.ts tests/analysis-trend.test.ts
git commit -m "feat(analysis): robust z-score, same-weekday anomaly and median-slope follower projection" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: "Why did this change?" — per-day facts and the reason rules

**Files:**
- Create: `lib/analysis/why.ts`
- Test: `tests/analysis-why.test.ts` (new)

**Interfaces:**
- Consumes: `median` (`lib/analysis/posts.ts`), `addDays` (`lib/sync/time.ts`), `MediaKind` (`lib/instagram/parse.ts`).
- Produces (Tasks 6, 7, 8):

```ts
export type FeedKind = Exclude<MediaKind, 'STORY'>;
/** A feed post or Reel published on an owner-timezone day, with its latest reach. */
export interface DayPost { id: string; mediaType: FeedKind; postedAt: string; hour: number; reach: number | null; permalink: string | null }
/** Everything known about one owner-timezone day of one account (null = not known, never 0). */
export interface GrowthDay {
  day: string;
  followers: number | null; // the day's last follower count
  follows: number | null;
  unfollows: number | null;
  net: number | null; // follows − unfollows, else the change of the follower count from the day before
  netSource: 'instagram' | 'derived' | null;
  reach: number | null; // account_daily.reach
  reachFollower: number | null; // breakdown reach of FOLLOWER, summed over formats
  reachNonFollower: number | null;
  storyReach: number | null; // breakdown reach of STORY, every follow type
  posts: DayPost[]; // feed posts and Reels published that day
  stories: number | null; // Stories published that day; null = not counted
  comments: number | null; // comments received that day; null = not counted
}
export type WhyMetric = 'net' | 'reach';
export const WHY_METRICS: readonly WhyMetric[] = ['net', 'reach'];
export type ReasonId = 'posted' | 'no_posts' | 'stories' | 'non_followers' | 'time_of_day' | 'comments';
export const REASON_ORDER: readonly ReasonId[] = ['posted', 'no_posts', 'stories', 'non_followers', 'time_of_day', 'comments'];
export interface Reason { id: ReasonId; direction: 'up' | 'down'; weight: number; confidence: 'low' | 'medium'; n: number; values: Record<string, number | string | null> }
export interface Why { day: string; metric: WhyMetric; value: number | null; typical: number | null; n: number; direction: 'up' | 'down' | 'flat' | null; reasons: Reason[]; posts: (DayPost & { when: 'same_day' | 'day_before' })[] }
/** A day of the range that weekdayAnomaly (Task 2) flagged; built by Task 6, listed by Task 7. */
export interface UnusualDay { day: string; metric: WhyMetric; value: number; typical: number; z: number | null; direction: 'up' | 'down' | 'flat' }
export const WHY = { baselineDays: 28, minBaseline: 7, mediumBaseline: 14, postDays: 90, minFormatPosts: 5, mediumFormatPosts: 10, maxReasons: 4, postEvery: 4, storyShift: 0.3, nfShift: 0.05, hourShift: 0.2, minHourPosts: 3, mediumHourPosts: 5, minComments: 5, commentsRatio: 2 } as const;
export function explainDay(days: GrowthDay[], day: string, metric: WhyMetric): Why
```

- Each reason's `values` keys (Task 7 formats them): `posted` {`postId`, `format` (FeedKind), `when` ('same_day' | 'day_before'), `hour`, `reach`, `ratio` (null = too few earlier posts of the format), `posts`}; `no_posts` {`every`}; `stories` {`reach`, `typical`, `change`, `stories` (null = not counted)}; `non_followers` {`share`, `typical`, `change`}; `time_of_day` {`hour`, `ratio`, `posts`}; `comments` {`comments`, `typical`}.

- [ ] **Step 1: Write the failing test** — create `tests/analysis-why.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { explainDay, REASON_ORDER, WHY, type DayPost, type GrowthDay } from '@/lib/analysis/why';
import { addDays } from '@/lib/sync/time';

const DAY = '2026-10-14';
const day = (d: string, o: Partial<GrowthDay> = {}): GrowthDay => ({ day: d, followers: null, follows: null, unfollows: null, net: 5, netSource: 'instagram', reach: 1000, reachFollower: 700, reachNonFollower: 300, storyReach: 400, posts: [], stories: 2, comments: 1, ...o });
const post = (id: string, d: string, o: Partial<DayPost> = {}): DayPost => ({ id, mediaType: 'REELS', postedAt: `${d}T12:00:00Z`, hour: 20, reach: 1000, permalink: null, ...o });
/** 44 days ending DAY. Every second day up to DAY − 2 has a Reel (reach 1000, 20:00) and an image (reach 400, 09:00); DAY − 1 and DAY have none. */
function history(over: Record<string, Partial<GrowthDay>> = {}, n = 44): GrowthDay[] {
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(DAY, i - (n - 1));
    const posts = i % 2 === 0 && d < addDays(DAY, -1) ? [post(`r${i}`, d), post(`i${i}`, d, { mediaType: 'IMAGE', reach: 400, hour: 9 })] : [];
    return day(d, { posts, ...over[d] });
  });
}
const ids = (w: { reasons: { id: string }[] }) => w.reasons.map((r) => r.id);

describe('explainDay', () => {
  it('a follower spike: the big Reel and the non-follower share explain it, strongest first (ties in rule order)', () => {
    const w = explainDay(history({ [DAY]: { net: 60, reach: 5000, reachFollower: 800, reachNonFollower: 1200, posts: [post('big', DAY, { reach: 5000 })] } }), DAY, 'net');
    expect(w).toMatchObject({ day: DAY, metric: 'net', value: 60, typical: 5, n: 28, direction: 'up' });
    expect(ids(w)).toEqual(['posted', 'non_followers', 'time_of_day']);
    expect(w.reasons[0]).toEqual({ id: 'posted', direction: 'up', weight: 3, confidence: 'medium', n: 21, values: { postId: 'big', format: 'REELS', when: 'same_day', hour: 20, reach: 5000, ratio: 5, posts: 1 } });
    expect(w.reasons[1]).toMatchObject({ id: 'non_followers', direction: 'up', weight: 3, confidence: 'medium', n: 28 });
    expect(w.reasons[1].values.share).toBeCloseTo(0.6);
    expect(w.reasons[1].values.change).toBeCloseTo(0.3);
    expect(w.reasons[2]).toMatchObject({ id: 'time_of_day', direction: 'up', confidence: 'medium', n: 21, values: { hour: 20, posts: 21 } });
    expect(w.reasons[2].weight).toBeCloseTo(0.857, 3); // Reels at 20:00 reach 1000 vs the median post 700
    expect(w.posts.map((p) => [p.id, p.when])).toEqual([['big', 'same_day']]);
  });

  it('reasons pointing the other way are dropped (Story reach fell on a spike day)', () => {
    const w = explainDay(history({ [DAY]: { net: 60, storyReach: 100, posts: [post('big', DAY, { reach: 5000 })] } }), DAY, 'net');
    expect(ids(w)).not.toContain('stories');
    expect(w.reasons.every((r) => r.direction === 'up')).toBe(true);
  });

  it('a drop: nothing posted that day or the day before, and Story reach fell', () => {
    const w = explainDay(history({ [DAY]: { net: -20, storyReach: 100, stories: 0 } }), DAY, 'net');
    expect(w).toMatchObject({ value: -20, typical: 5, direction: 'down', posts: [] });
    expect(ids(w)).toEqual(['no_posts', 'stories']);
    expect(w.reasons[0]).toMatchObject({ direction: 'down', weight: 1.5, confidence: 'medium', n: 28 });
    expect(w.reasons[0].values.every).toBeCloseTo(28 / 13); // 13 of the 28 days before had a post
    expect(w.reasons[1]).toMatchObject({ direction: 'down', weight: 1.5, values: { reach: 100, typical: 400, change: -0.75, stories: 0 } });
  });

  it('the day before counts; reach as the metric; a comment burst', () => {
    const w = explainDay(history({ [addDays(DAY, -1)]: { posts: [post('eve', addDays(DAY, -1), { reach: 3000 })] }, [DAY]: { reach: 4000, comments: 12 } }), DAY, 'reach');
    expect(w).toMatchObject({ metric: 'reach', value: 4000, typical: 1000, direction: 'up' });
    expect(w.reasons.find((r) => r.id === 'posted')?.values).toMatchObject({ postId: 'eve', when: 'day_before', ratio: 3 });
    expect(w.reasons.find((r) => r.id === 'comments')).toMatchObject({ direction: 'up', weight: 2, values: { comments: 12, typical: 1 } });
  });

  it('too little history: no typical, no direction, every reason kept with low confidence and no ratio', () => {
    const w = explainDay(history({ [DAY]: { net: 9, posts: [post('p', DAY, { mediaType: 'IMAGE', hour: 9 })] } }, 4), DAY, 'net');
    expect(w).toMatchObject({ value: 9, typical: null, n: 3, direction: null });
    expect(w.reasons.find((r) => r.id === 'posted')).toMatchObject({ direction: 'up', weight: 1, confidence: 'low', n: 1, values: { ratio: null } }); // one earlier image (DAY − 3), under the 5 needed
  });

  it('an unknown day or a missing value: nothing to explain, no crash', () => {
    expect(explainDay(history(), '2027-01-01', 'net')).toMatchObject({ value: null, typical: null, direction: null, reasons: [] });
    expect(explainDay(history({ [DAY]: { reach: null } }), DAY, 'reach')).toMatchObject({ value: null, direction: null });
  });

  it('never more than 4 reasons, never "high" confidence', () => {
    const w = explainDay(history({ [DAY]: { net: 80, reachNonFollower: 2000, storyReach: 2000, comments: 40, posts: [post('big', DAY, { reach: 9000 })] } }), DAY, 'net');
    expect(w.reasons.length).toBeLessThanOrEqual(WHY.maxReasons);
    for (const r of w.reasons) expect(['low', 'medium']).toContain(r.confidence);
    expect(REASON_ORDER).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/analysis-why.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/why"`.

- [ ] **Step 3: Implement `lib/analysis/why.ts`** — the types and constants above, a header comment ("rule-based patterns, not causes; every reason carries its evidence, its sample and a confidence word, never 'high'"), and `explainDay` exactly as follows (`base` = the days in `[day − 28, day − 1]`; `med(xs)` = `median` of the numbers in `xs`, nulls dropped):
  1. No `GrowthDay` for `day` → `{ day, metric, value: null, typical: null, n: 0, direction: null, reasons: [], posts: [] }`. `value` = the day's `net` or `reach`. `vals` = the base days' metric values (non-null); `n = vals.length`; `typical = n ≥ WHY.minBaseline ? median(vals) : null`; `direction` = null when value or typical is null, else up / down / flat. If `value` is null: return with `reasons: []` and the posts.
  2. `P` = that day's posts tagged `when: 'same_day'`, then the day before's tagged `'day_before'` (also returned as `posts`). `earlier` = the posts of the days in `[day − 90, day − 2]` with a reach.
  3. **posted** (P not empty): `top` = the P post with the most reach (a null reach ranks last; ties keep P order). `fmt` = reaches of `earlier` posts with `top.mediaType`; `ratio = fmt.length ≥ 5 && med(fmt) > 0 && top.reach !== null ? top.reach / med(fmt) : null`. Direction `ratio !== null && ratio < 1 ? 'down' : 'up'`; weight `ratio === null ? 1 : Math.min(3, Math.max(ratio, 1 / ratio))`; confidence `fmt.length ≥ 10 ? 'medium' : 'low'`; `n = fmt.length`; values as listed in Interfaces (`posts = P.length`).
  4. **no_posts** (P empty): `postingDays` = base days with ≥ 1 post; fires when `base.length > 0 && postingDays / base.length ≥ 1 / WHY.postEvery`: direction `'down'`, weight 1.5, values `{ every: base.length / postingDays }`, confidence `base.length ≥ 14 ? 'medium' : 'low'`, `n = base.length`.
  5. **stories**: `m = med(base storyReach)` over `ns` values; fires when the day's `storyReach !== null && ns ≥ 7 && m > 0` and `|change| ≥ 0.3` with `change = (storyReach − m) / m`: direction by sign, weight `Math.min(3, Math.abs(change) * 2)`, values `{ reach, typical: m, change, stories: the day's stories }`, confidence `ns ≥ 14 ? 'medium' : 'low'`, `n = ns`.
  6. **non_followers**: `share(d) = reachFollower and reachNonFollower both non-null and their sum > 0 ? reachNonFollower / sum : null`; `m = med(base shares)` over `nb`; fires when the day's share is non-null, `nb ≥ 7` and `|share − m| ≥ 0.05`: direction by sign, weight `Math.min(3, Math.abs(change) / 0.05)`, values `{ share, typical: m, change }`, confidence `nb ≥ 14 ? 'medium' : 'low'`, `n = nb`.
  7. **time_of_day** (only with `top`): `near` = `earlier` posts whose hour is within 1 of `top.hour` on a 24-hour clock (`Math.min(d, 24 − d) ≤ 1`, `d = |h − top.hour|`); fires when `near.length ≥ 3`, `med(all earlier) > 0` and `|ratio − 1| ≥ 0.2` with `ratio = med(near) / med(all earlier)`: direction `ratio > 1 ? 'up' : 'down'`, weight `Math.min(1.5, Math.abs(ratio − 1) * 2)`, values `{ hour: top.hour, ratio, posts: near.length }`, confidence `near.length ≥ 5 ? 'medium' : 'low'`, `n = near.length`.
  8. **comments**: `m = med(base comments)` over `nc`; fires when the day's `comments !== null && nc ≥ 7 && comments ≥ 5 && comments ≥ 2 × max(m, 1)`: direction `'up'`, weight `Math.min(2, comments / Math.max(m, 1) / 2)`, values `{ comments, typical: m }`, confidence `nc ≥ 14 ? 'medium' : 'low'`, `n = nc`.
  9. Keep only reasons whose direction equals `direction` when that is `'up'` or `'down'` (all of them otherwise); sort by weight descending, ties by `REASON_ORDER`; keep the first `WHY.maxReasons`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/analysis-why.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/why.ts tests/analysis-why.test.ts
git commit -m "feat(analysis): rule-based reasons for a day's change (why did this change)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: Growth readers

**Files:**
- Create: `lib/dashboard/growth-read.ts`
- Modify: `lib/dashboard/detail-read.ts` (export `AUDIENCE_KINDS` and a shared `audienceRow`; `loadAudience` uses it, behaviour unchanged)
- Test: `tests/growth-read.test.ts` (new); `tests/detail-read.test.ts` must keep passing unchanged

**Interfaces:**
- Consumes: `readPages`, `MISSING_FUNCTION` (`lib/dashboard/read.ts`), `addDays`, `localDay` (`lib/sync/time.ts`), `AudienceSnapshots`, `AudienceKind`.
- Produces (Tasks 6 and 9):
  - in `lib/dashboard/detail-read.ts`: `export const AUDIENCE_KINDS: AudienceKind[] = ['age_gender', 'country', 'city'];` (was private) and `export function audienceRow(r: Record<string, unknown> | undefined): { day: string; data: Record<string, number> } | null` (null without a row or when `data` is not a plain object; non-numeric counts dropped — exactly what `loadAudience` did inline).
  - in `lib/dashboard/growth-read.ts`:
    - `export const BREAKDOWN_LIMIT = 20_000;` (5 years × ~8 rows a day, newest first) and `export const DAY_COUNT_LIMIT = 5000;`
    - `export interface BreakdownRow { day: string; followType: string; productType: string; value: number }`
    - `export interface DayCounts { days: Record<string, number>; from: string | null }` — `from` = the first owner-timezone day counted completely when the read stopped at `DAY_COUNT_LIMIT` (older days are unknown); null = the whole window is counted.
    - `loadReachBreakdown(db: SupabaseClient, accountId: string, fromDay: string, toDay: string): Promise<BreakdownRow[]>`
    - `loadFollowerCurve(db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string): Promise<{ at: string; followers: number }[] | null>` (null = `explorer_followers` missing)
    - `loadStoryDays(db, accountId, fromIso, toIso, tz): Promise<DayCounts>` and `loadCommentDays(db, accountId, fromIso, toIso, tz): Promise<DayCounts>`
    - `loadAudienceEnds(db, accountId, fromDay, toDay): Promise<{ first: AudienceSnapshots; last: AudienceSnapshots }>`

- [ ] **Step 1: Write the failing test** — create `tests/growth-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { audienceRow } from '@/lib/dashboard/detail-read';
import { DAY_COUNT_LIMIT, loadAudienceEnds, loadCommentDays, loadFollowerCurve, loadReachBreakdown, loadStoryDays } from '@/lib/dashboard/growth-read';

type Call = { table: string; select: string; ops: unknown[][] };
type Result = { data?: unknown; error?: unknown };

/** Fake Supabase client: chained calls are recorded; an awaited query resolves to the next result queued for its table; rpc() to the next one queued under `rpc:<name>`. */
function fakeDb(results: Record<string, Result[]>) {
  const calls: Call[] = [];
  const next = (key: string) => Promise.resolve(results[key]?.shift() ?? { data: [], error: null });
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'gte', 'lte', 'lt', 'order', 'limit', 'range']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next(table).then(res, rej);
      return chain;
    },
    rpc(name: string, args: unknown) {
      calls.push({ table: `rpc:${name}`, select: '', ops: [['args', args]] });
      return next(`rpc:${name}`);
    },
  };
  return { db: db as never, calls };
}

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST

describe('loadReachBreakdown', () => {
  it('reach rows of one account and day window, newest first, paged; non-numeric values dropped', async () => {
    const f = fakeDb({ account_daily_breakdown: [{ data: [{ day: '2026-10-14', follow_type: 'FOLLOWER', product_type: 'REEL', value: 120 }, { day: '2026-10-14', follow_type: 'NON_FOLLOWER', product_type: 'REEL', value: 'x' }] }] });
    expect(await loadReachBreakdown(f.db, 'a1', '2026-07-01', '2026-10-14')).toEqual([{ day: '2026-10-14', followType: 'FOLLOWER', productType: 'REEL', value: 120 }]);
    const c = f.calls[0];
    expect(c.select).toBe('day,follow_type,product_type,value');
    expect(c.ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['eq', 'metric', 'reach'], ['gte', 'day', '2026-07-01'], ['lte', 'day', '2026-10-14'], ['order', 'day', { ascending: false }], ['range', 0, 999]]));
  });

  it('a database error becomes a fixed message', async () => {
    const f = fakeDb({ account_daily_breakdown: [{ error: { message: 'secret' } }] });
    await expect(loadReachBreakdown(f.db, 'a1', '2026-07-01', '2026-10-14')).rejects.toThrow(/^dashboard read: reach breakdown failed$/);
  });
});

describe('loadFollowerCurve', () => {
  it('the hourly curve from explorer_followers (owner timezone); junk rows dropped', async () => {
    const f = fakeDb({ 'rpc:explorer_followers': [{ data: [{ at: '2026-10-14T09:00', followers: 1200 }, { at: null, followers: 3 }, { at: '2026-10-14T10:00', followers: null }] }] });
    expect(await loadFollowerCurve(f.db, 'a1', '2026-10-07T16:00:00.000Z', '2026-10-14T16:00:00.000Z', KL)).toEqual([{ at: '2026-10-14T09:00', followers: 1200 }]);
    expect(f.calls[0].ops[0]).toEqual(['args', { p_account: 'a1', p_from: '2026-10-07T16:00:00.000Z', p_to: '2026-10-14T16:00:00.000Z', p_tz: KL, p_hourly: true }]);
  });

  it('a missing function is null (the tab falls back to daily points); any other error throws a fixed message', async () => {
    expect(await loadFollowerCurve(fakeDb({ 'rpc:explorer_followers': [{ error: { code: 'PGRST202' } }] }).db, 'a1', 'x', 'y', KL)).toBeNull();
    await expect(loadFollowerCurve(fakeDb({ 'rpc:explorer_followers': [{ error: { code: '500', message: 'secret' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: follower curve failed$/);
  });
});

describe('loadStoryDays / loadCommentDays', () => {
  it('counts by owner-timezone day (23:30 and 00:30 local fall on different days); a complete read has from = null', async () => {
    const f = fakeDb({ media: [{ data: [{ posted_at: '2026-10-13T16:30:00Z' }, { posted_at: '2026-10-13T16:10:00Z' }, { posted_at: '2026-10-13T15:30:00Z' }] }] });
    expect(await loadStoryDays(f.db, 'a1', '2026-10-01T16:00:00Z', '2026-10-14T16:00:00Z', KL)).toEqual({ days: { '2026-10-14': 2, '2026-10-13': 1 }, from: null });
    expect(f.calls[0].select).toBe('posted_at');
    expect(f.calls[0].ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['eq', 'media_type', 'STORY'], ['gte', 'posted_at', '2026-10-01T16:00:00Z'], ['lt', 'posted_at', '2026-10-14T16:00:00Z'], ['order', 'posted_at', { ascending: false }]]));
  });

  it('a read capped at DAY_COUNT_LIMIT (newest first) says from which day the counts are complete', async () => {
    const page = (day: number) => ({ data: Array.from({ length: 1000 }, () => ({ commented_at: `2026-10-${day}T04:00:00Z` })) });
    const f = fakeDb({ comments: [page(14), page(13), page(12), page(11), page(10)] });
    const out = await loadCommentDays(f.db, 'a1', '2026-09-01T16:00:00Z', '2026-10-14T16:00:00Z', KL);
    expect(DAY_COUNT_LIMIT).toBe(5000);
    expect(out.from).toBe('2026-10-11'); // 10 October may be cut off: unknown, not 1,000
    expect(out.days['2026-10-14']).toBe(1000);
    expect(out.days['2026-10-10']).toBeUndefined();
    expect(f.calls).toHaveLength(5);
    expect(f.calls[0].select).toBe('commented_at');
    expect(f.calls[0].ops).toEqual(expect.arrayContaining([['eq', 'account_id', 'a1'], ['order', 'commented_at', { ascending: false }]]));
  });

  it('errors become fixed messages', async () => {
    await expect(loadStoryDays(fakeDb({ media: [{ error: { message: 's' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: story days failed$/);
    await expect(loadCommentDays(fakeDb({ comments: [{ error: { message: 's' } }] }).db, 'a1', 'x', 'y', KL)).rejects.toThrow(/^dashboard read: comment days failed$/);
  });
});

describe('loadAudienceEnds', () => {
  it('per kind: the first and the latest snapshot inside the day window (6 single-row reads)', async () => {
    const snap = (day: string, data: unknown) => ({ data: [{ day, data }] });
    const f = fakeDb({
      audience_snapshots: [snap('2026-09-16', { '18-24|F': 10 }), snap('2026-10-14', { '18-24|F': 12, '25-34|M': 'x' }), snap('2026-09-16', { MY: 40 }), snap('2026-10-14', { MY: 50 }), { data: [] }, { data: [] }],
    });
    const out = await loadAudienceEnds(f.db, 'a1', '2026-09-15', '2026-10-14');
    expect(out.first).toEqual({ age_gender: { day: '2026-09-16', data: { '18-24|F': 10 } }, country: { day: '2026-09-16', data: { MY: 40 } }, city: null });
    expect(out.last).toEqual({ age_gender: { day: '2026-10-14', data: { '18-24|F': 12 } }, country: { day: '2026-10-14', data: { MY: 50 } }, city: null });
    expect(f.calls.map((c) => [c.ops[1], c.ops.find((o) => o[0] === 'order')])).toEqual([
      [['eq', 'kind', 'age_gender'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'age_gender'], ['order', 'day', { ascending: false }]],
      [['eq', 'kind', 'country'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'country'], ['order', 'day', { ascending: false }]],
      [['eq', 'kind', 'city'], ['order', 'day', { ascending: true }]],
      [['eq', 'kind', 'city'], ['order', 'day', { ascending: false }]],
    ]);
    for (const c of f.calls) expect(c.ops).toEqual(expect.arrayContaining([['gte', 'day', '2026-09-15'], ['lte', 'day', '2026-10-14'], ['limit', 1]]));
  });

  it('audienceRow: no row or a non-object payload is null; non-numeric counts are dropped', () => {
    expect(audienceRow(undefined)).toBeNull();
    expect(audienceRow({ day: '2026-10-14', data: [1, 2] })).toBeNull();
    expect(audienceRow({ day: '2026-10-14', data: { MY: 3, XX: '4' } })).toEqual({ day: '2026-10-14', data: { MY: 3 } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/growth-read.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/dashboard/growth-read"`.

- [ ] **Step 3: Implement.** In `lib/dashboard/detail-read.ts`: export `AUDIENCE_KINDS`; add `audienceRow` (the body of `loadAudience`'s per-row parsing: `if (!r || !isCounts(r.data)) return null;` then the numeric filter, `day: String(r.day)`); `loadAudience` becomes `return audienceRow(((data ?? []) as Row[])[0]);` per kind. In `lib/dashboard/growth-read.ts` (header comment: owner session only, explicit columns, row caps, fixed messages; why no SQL — see the plan's Decisions):
  - `loadReachBreakdown`: `readPages((from, to) => db.from('account_daily_breakdown').select('day,follow_type,product_type,value').eq('account_id', accountId).eq('metric', 'reach').gte('day', fromDay).lte('day', toDay).order('day', { ascending: false }).order('follow_type', { ascending: true }).order('product_type', { ascending: true }).range(from, to), 'reach breakdown', { max: BREAKDOWN_LIMIT })`; rows whose `value` is not a finite number are dropped. `ponytail:` ~8 rows a day, 15 requests for 5 years; a `security invoker` rollup is the upgrade if Server-Timing says so.
  - `loadFollowerCurve`: `db.rpc('explorer_followers', { p_account, p_from, p_to, p_tz, p_hourly: true })`; an error whose code is in `MISSING_FUNCTION` → `null`, any other error → `throw new Error('dashboard read: follower curve failed')`; keep rows with a string `at` and a finite `followers`.
  - `loadStoryDays` / `loadCommentDays`: one shared private `dayCounts(db, table: 'media' | 'comments', column: 'posted_at' | 'commented_at', op: string, accountId, fromIso, toIso, tz)`: `readPages` over `.select(column).eq('account_id', …)` (+ `.eq('media_type', 'STORY')` for Stories) `.gte(column, fromIso).lt(column, toIso).order(column, { ascending: false }).range(from, to)` with `{ max: DAY_COUNT_LIMIT }`; count `localDay(new Date(row[column]), tz)`; `from = truncated ? addDays(oldest counted day, 1) : null` (delete the oldest day from `days` too: it may be cut). Ops `'story days'`, `'comment days'`.
  - `loadAudienceEnds`: `Promise.all(AUDIENCE_KINDS.map((kind) => Promise.all([end(kind, true), end(kind, false)])))` where `end` = `db.from('audience_snapshots').select('day,data').eq('account_id', accountId).eq('kind', kind).gte('day', fromDay).lte('day', toDay).order('day', { ascending }).limit(1)`, error → `dashboard read: audience ends failed`, row → `audienceRow`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/growth-read.test.ts tests/detail-read.test.ts`
Expected: PASS (both files; `loadAudience`'s existing test is unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/growth-read.ts lib/dashboard/detail-read.ts tests/growth-read.test.ts
git commit -m "feat(dashboard): growth readers (reach breakdown, hourly followers, story and comment days, audience ends)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Chart tone and tooltip label; `deltaView` with a definition

**Files:**
- Modify: `components/charts/SeriesChart.tsx`, `lib/metrics.ts`, `components/shared/useKpiDelta.ts`
- Test: `tests/charts.test.tsx`, `tests/metrics.test.ts` (append)

**Interfaces:**
- Produces (Task 8):
  - `Series` gains `tone?: 'good' | 'bad'` — the series is drawn (line/area stroke, bar fill, legend dot) in `var(--success)` / `var(--danger)` instead of `seriesColor(i)`; `export const toneColor = { good: 'var(--success)', bad: 'var(--danger)' } as const;`
  - `SeriesChart` gains `formatLabel?: (v: string) => string` — the tooltip's label (defaults to `formatX`), so a tooltip can say "14 Oct 2026 · 2 posts, 3 Stories" while the axis says "14 Oct 2026".
  - `lib/metrics.ts`: `export type DeltaDef = Pick<MetricDef, 'kind' | 'higherIsBetter'>;` and `deltaView(id: MetricId | DeltaDef, k: Kpi, p: FormatPrefs): DeltaView | null` (a string id reads `METRICS[id]` as before; an object is used as the definition).
  - `useKpiDelta()` returns `(id: MetricId | DeltaDef, k: Kpi | undefined) => StatDelta | null`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/charts.test.tsx` inside `describe('SeriesChart', …)`:

```tsx
  it('a series with a tone uses the success / danger token (legend and marks); the others keep their chart colour', () => {
    const { container } = render(<SeriesChart kind="bar" data={rows} xKey="day" series={[{ key: 'a', label: 'Follows', tone: 'good' }, { key: 'b', label: 'Unfollows', tone: 'bad' }, { key: 'a', label: 'Plain' }]} title="Flow" formatLabel={(v) => `${v} · 2 posts`} />);
    const dots = [...container.querySelectorAll('[data-slot="series-chart"] li > span[aria-hidden="true"]')].map((s) => (s as HTMLElement).style.background);
    expect(dots).toEqual(['var(--success)', 'var(--danger)', 'var(--chart-3)']);
    expect(toneColor).toEqual({ good: 'var(--success)', bad: 'var(--danger)' });
  });
```

and change the file's import to `import { SeriesChart, seriesColor, toneColor } from '@/components/charts/SeriesChart';`. Append to `tests/metrics.test.ts` inside `describe('deltaView', …)`:

```ts
  it('takes a { kind, higherIsBetter } definition for numbers outside the registry (lower-is-better turns a rise bad)', () => {
    expect(deltaView({ kind: 'count', higherIsBetter: false }, k({ diff: 5, change: 0.5 }), P)).toEqual({ text: '+50.0%', unit: 'relative', direction: 'up', tone: 'bad' });
    expect(deltaView({ kind: 'percent', higherIsBetter: false }, k({ diff: -0.01, change: -0.2 }), P)).toEqual({ text: '-1.0', unit: 'points', direction: 'down', tone: 'good' });
    expect(deltaView({ kind: 'count', higherIsBetter: true }, k({ diff: null }), P)).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/charts.test.tsx tests/metrics.test.ts`
Expected: FAIL — `toneColor` is not exported / the legend shows `var(--chart-1)`, `var(--chart-2)`; `deltaView` with an object throws reading `METRICS[...]`.

- [ ] **Step 3: Implement.** `SeriesChart.tsx`: add `tone?: 'good' | 'bad'` to `Series` (comment: "up/down meaning, e.g. follows vs unfollows: drawn in the success / danger token"), export `toneColor`, a local `colorOf = (s: Series, i: number) => (s.tone ? toneColor[s.tone] : seriesColor(i))` used by the legend dot, `Line` `stroke`, `Area` `stroke` + gradient stops, `Bar` `fill`; add the `formatLabel` prop and pass `labelFormatter={(v) => (formatLabel ?? formatX)(String(v))}` to the `Tooltip`. `lib/metrics.ts`: add `DeltaDef`, widen `deltaView`'s first parameter and start it with `const def = typeof id === 'string' ? METRICS[id] : id;`. `useKpiDelta.ts`: widen the returned function's `id` parameter to `MetricId | DeltaDef` (import the type).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/charts.test.tsx tests/metrics.test.ts tests/charts-drill.test.tsx tests/stat-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/charts/SeriesChart.tsx lib/metrics.ts components/shared/useKpiDelta.ts tests/charts.test.tsx tests/metrics.test.ts
git commit -m "feat(charts): good/bad series tone and tooltip label; deltaView takes a metric definition" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
