# Plan 6 (part 1): Analysis & Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the synced snapshots into numbers people can read: a metrics registry, pure analysis functions (growth with prior-period comparison, top posts, format comparison, best-time heatmaps with a sample guard, tag performance, flags, missing-data reasons), an owner-session read layer, shared dashboard UI (StatCard, ChartCard, Recharts wrappers, heatmap grid, DataTable with phone card mode, the motion gate), and a real Overview page.

**Architecture:** Pages stay wiring. `lib/dashboard/read.ts` reads with the owner-session client (RLS select only) and shapes rows into `lib/analysis/types.ts` inputs; `lib/analysis/*` are pure, deterministic functions (today/now/timezone are parameters, day maths reuse `lib/sync/time.ts`); `lib/dashboard/overview.ts` turns them into an `OverviewModel`; `components/overview/OverviewView.tsx` renders it with the shared pieces in `components/shared` and `components/charts`. All formatting goes through `lib/format.ts` + `lib/metrics.ts`; all text through next-intl.

**Tech Stack:** Next.js 16.4 (App Router, server components + one client view), TypeScript strict, `@supabase/ssr` owner session, Vitest 5 + Testing Library, next-intl 4, Tailwind 4 tokens. **New dependencies:** `recharts@^3.10.1` (SPEC §2/§8 approved chart library; released 2026-07-25) and `react-is@19.3.0` (Recharts 3 peer dependency; without an explicit install npm resolves the hoisted `react-is@16` from `prop-types`, which does not recognise React 19 elements — Recharts' docs say to install the `react-is` matching your React).

**Spec:** `docs/SPEC.md` §5, §7, §7b, §7c, §8, §8b. Project rules: `CLAUDE.md` (binding). Visual reference: `docs/mockups/app-prototype.html` (Overview), `kit-charts.html` + `charts.css/js` (chart spec), `kit-data.html` (table, states).

## Decisions taken in this plan (owner: please confirm the two marked ⚠)

- ⚠ **Periods are 7 / 30 / 90 days** (SPEC §7b "7/30/90d", §7 "7/30-day", mockup "vs previous 30d"). The brief for this plan said 7/28/90; the spec wins until the owner says otherwise. It is ONE constant (`PERIODS` in `lib/analysis/types.ts`) plus the default in `parsePeriod` — switching to 28 is a two-line change.
- ⚠ **Folder layout:** SPEC §8b.2 says `features/overview|account|…`; the codebase already uses `components/<feature>/` (`components/accounts/AccountsView.tsx`). This plan follows the codebase: `components/overview/OverviewView.tsx`; shared pieces in `components/shared/` (SPEC §8b.1 list) and chart wrappers in `components/charts/`.
- **Window end = the account's latest day with reach data before today**, not "yesterday": Meta lags up to 48 h, and ending on an empty yesterday would compare 6 days with 7 and fake a −14% drop (which would trip the −20% reach-drop flag on noise). A window only gets a comparison when ≥ 80% of its days have data (`MIN_COVERAGE`), otherwise the value is shown with the reason "Not enough history to compare yet".
- **Followers delta** = latest snapshot (the sync writes it on *today's* row) vs the latest snapshot at least one period earlier. Follower history starts at connect (Instagram has no follower series), so the first N days show the "not enough history" reason — honest, not zero.
- **Engagement rate:** post ER = (likes + comments + saves + shares) ÷ reach (SPEC §7); account/period ER = Σ `total_interactions` ÷ Σ reach from `account_daily` (SPEC §7 "Account ER over a period"). Engagement deltas are shown in **percentage points** ("+0.4 pp"), counts as relative % — or as an absolute "+3" when the previous value was 0 (no meaningful %). Never NaN/Infinity: a zero/missing base gives `null` + a reason.
- **Metrics registry kinds are `count | percent` only.** No stored metric is a duration or a per-unit rate yet (Reels watch time is not synced); add a kind when the first such metric lands. How a metric aggregates (sum / last / ratio) lives in `kpis()` (`lib/analysis/growth.ts`), the one place that computes it; the registry holds label, kind, formatting and higher-is-better.
- **Flags on read** (SPEC §5): taking off = reach ≥ 2× median of the previous 20 feed posts, ≥ 24 h old, ≥ 5 prior posts with reach, reported for the last 7 days; reach drop = 7-day reach ≤ −20% vs the previous 7 days (only when both weeks are comparable). Thresholds are constants in `lib/analysis/flags.ts`; Plan 7 turns them into Settings parameters.
- **Best time:** post performance by owner-timezone weekday × hour of `posted_at` (cells < 2 posts flagged `lowSample`, whole grid flagged `not_enough_posts` under 30 measured feed posts) and followers online by weekday × the hour index Instagram reports (hour base still UNCERTAIN per `lib/instagram/metrics.ts`; one remap point documented in the function). Pooled = pass several accounts' rows. The UI for these lives in part 2 (Account detail); part 1 ships the functions, the `Heatmap` component and a styleguide demo.
- **Latest metrics per post in ONE query:** PostgREST embedded resource with `order` + `limit(1, { referencedTable: 'media_metrics' })`, so 500 posts = 500 rows (under the 1000-row cap) instead of ~40k snapshots. Daily reads are per account (≤ 200 rows each). No new migration, no view.
- **Backfilling state** needs `sync_state.daily_done_through`: `listSyncStatus` gains an optional `dailyDoneThrough` field (one extra column in its select).
- **No TanStack Table yet** (SPEC §2 lists it): the comparison table is a handful of rows; `DataTable` sorts in ~20 lines. TanStack arrives with part 2's Posts table (500 rows, pagination) — `ponytail:` note in `DataTable.tsx`.
- **No GSAP and no count-up here.** Light motion = CSS `motion-safe:` fade-ins + Recharts 3's `isAnimationActive="auto"` (skips animation under reduced motion). The shared gate `useHeavyMotion()` (`lib/motion.ts`: reduced-motion, coarse pointer, Save-Data; false during SSR/hydration) is shipped and tested now for part 2's globe/particles/GSAP.
- **Sparklines are plain SVG** (one per card, up to ~20 on the page): a Recharts instance each would be heavy; the mockup's `spark()` is a polyline too.
- **Overview cards are not links yet** — the Account detail page is part 2.

## Out of scope — what part 2 must provide

Account detail page + tabs (Overview / Posts / Stories / Audience, globe), Tags page + tag assignment UI, calendar, flags UI beyond the Overview card. For the functions shipped here, part 2 must add:
1. Migration for `tags` (id, name, color — a chart token name like `chart-3`, never a raw colour) and `media_tags` (media_id, tag_id, pk both) with owner RLS (select for the owner session; writes through server actions), plus a reader returning `Tag[]` / `MediaTag[]` for `tagPerformance()`.
2. Readers for `online_followers` (→ `OnlineFollowersRow[]` for `onlineHeatmap()`) and `audience_snapshots`.
3. `caption` in `loadPosts()`'s select (the Posts table needs it; part 1 does not read captions), and a Stories reader (`media_type = 'STORY'`, last snapshot = final value).
4. A `heatmapRows()` helper when the second Heatmap user appears (the styleguide demo builds its labels inline — "extract on the second use").
5. TanStack Table for the Posts table, and `gsap`/`three` behind `useHeavyMotion()`.

## Global Constraints

- Ponytail: smallest thing that works; no SDKs where `fetch` suffices; no abstraction with one implementation; new dependencies only `recharts` + `react-is` (justified above).
- TypeScript strict. Meta metric names stay in `lib/instagram/metrics.ts` (this plan adds none).
- No DB changes in this plan (no migration). Dashboard reads use ONLY the owner-session client from `createServerSupabase()`; never `lib/supabase/admin.ts` in `lib/dashboard/*` or pages; never `account_tokens`.
- Analysis logic = pure functions in `lib/analysis/` with Vitest tests; deterministic (no `Date.now()` / `new Date()` inside); owner-timezone day maths only via `lib/sync/time.ts` (`localDay`, `localHour`, `addDays`).
- Every UI string via next-intl; new keys in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation `，：。`). `tests/messages.test.ts` enforces parity, placeholders and "zh differs from en".
- Theming: semantic tokens only (`bg-card`, `text-muted-foreground`, `text-success`, `text-destructive`, `var(--chart-1..6)`, `color-mix(… var(--primary) …, var(--surface))`); never a hex/rgb literal in components. Must look right in all 4 themes × light/dark.
- Responsive: mobile-first, works at 360 / 768 / 1280; CSS breakpoints only (`md:hidden` / `hidden md:block`), never `matchMedia`/`useMediaQuery` for layout; no fixed pixel widths on layout containers; long text truncates (`min-w-0` + `truncate`).
- Dates/numbers only via `lib/format.ts` (`formatDay`, `formatDateTime`, `formatCompact`, `formatPercent`, `formatDelta`, `formatSigned`, `formatNumber`) and `lib/metrics.ts`; never `toLocale*`.
- UI kit rules: density is un-layered (`h-*`/`p-*` on shadcn Button/Card/Table cells are ignored — use tokens), `TooltipProvider` is already in `app/layout.tsx`, no `npx shadcn init`.
- Recharts **3** API (installed major): `responsive` prop + CSS size, `isAnimationActive` default `'auto'`; do not copy v2 `ResponsiveContainer` examples.
- `npm run check` (lint + typecheck + tests + build) must pass at the end. Commits: conventional, end with `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`, stage specific paths only. Don't push.

## Review Focus

1. **Zero or missing base** (new account with 0 followers, a week with 0 reach, an account with no follow data): no `NaN`/`Infinity` anywhere, a reason instead of a fake % → Task 1 "a zero base never produces NaN or Infinity", Task 2 "absolute change when the previous value was 0", Task 8 Sparkline "flat/empty series without NaN", Task 11 "zero followers, missing data and very long names render without NaN/Infinity".
2. **All-null metrics from Meta** (under 100 followers, unsettled days, removed metrics, posts without a metrics snapshot): values are `null` with `no_data` / `needs_100_followers`, never 0 → Task 1 "all-null metrics from Meta", Task 3 "missing parts count as 0, but all missing or no reach is null", Task 6 "drops rows with an unknown media type and tolerates non-numeric metrics", Task 4 "no data (under 100 followers)".
3. **Meta's 48 h lag / sync gaps** (yesterday not written yet, a missed day): the window must not end on an empty day and fake a drop → Task 1 "ends the window on the latest day with reach (Meta's 48 h lag)" and "unsorted rows and … gaps", Task 5 "no flag without two comparable weeks".
4. **Owner timezone & DST** in day/hour binning (a post at 01:30 on DST fall-back day; a post at 17:00 UTC that is tomorrow in Kuala Lumpur; a calendar day formatted in a far-off timezone) → Task 4 "DST fall-back: both 01:30s … land in Sunday 01:00", Task 1 "counts feed posts by owner-timezone day", Task 2 "formats a calendar day without shifting it by the timezone".
5. **Identical timestamps, a single post, very long names, 90 days of data**: deterministic ordering and layouts that hold at 360 px → Task 3 "a single post and identical timestamps stay deterministic", Task 5 "identical timestamps order by id", Task 1 "90 days of data", Task 9 "90 days, gaps" + "very long account name truncates in the legend", Task 8 "a very long label or value truncates".

## File Structure

| File | Responsibility |
|---|---|
| `lib/analysis/types.ts` | analysis inputs (`DailyRow`, `Post`, `OnlineFollowersRow`, `Tag`, `MediaTag`), `MissingReason`, `PERIODS` |
| `lib/analysis/growth.ts` | `summarize`, `combine`, `kpis` (period vs prior period, coverage, reasons) |
| `lib/analysis/posts.ts` | `engagementRate`, `median`, `topPosts`, `formatComparison`, `tagPerformance` |
| `lib/analysis/best-time.ts` | `postHeatmap`, `onlineHeatmap` (weekday × hour, sample guard) |
| `lib/analysis/flags.ts` | `takingOff`, `reachDrop` |
| `lib/metrics.ts` | metrics registry, `formatMetric`, `deltaView` |
| `lib/format.ts` (modify) | + `formatDay`, `formatSigned` (`formatDelta` reuses it) |
| `lib/dashboard/read.ts` | owner-session reads: `loadDaily`, `loadPosts`, `loadOverviewInput` |
| `lib/sync/store.ts` (modify) | `listSyncStatus` also returns `dailyDoneThrough` |
| `lib/dashboard/overview.ts` | `parsePeriod`, `fromDayFor`, `buildOverview` → `OverviewModel` |
| `lib/motion.ts` | the shared heavy-motion gate (`heavyMotionAllowed`, `readMotionEnv`, `useHeavyMotion`) |
| `components/shared/StatCard.tsx` | `StatCard`, `DeltaPill` |
| `components/shared/ChartCard.tsx` | chart frame with sr summary + table fallback |
| `components/shared/DataTable.tsx` | sortable table (md+) / card list (phones), empty + loading |
| `components/charts/Sparkline.tsx` | SVG trend line |
| `components/charts/SeriesChart.tsx` | Recharts line / area / bar |
| `components/charts/Heatmap.tsx` | weekday × hour grid as a `<table>` |
| `components/overview/OverviewView.tsx` | the Overview UI |
| `app/(app)/overview/page.tsx` (replace), `app/(app)/overview/loading.tsx` | wiring + skeleton |
| `app/styleguide/DashboardGallery.tsx`, `app/styleguide/page.tsx` (modify) | sample dashboards for visual checks |
| `messages/en.json`, `messages/zh-CN.json` (modify) | `metrics`, `analysis`, `table`, `pages.overview`, `styleguide.gallery` keys |
| `docs/RUNBOOK_DASHBOARDS.md` | visual verification at 360/768/1280 × 4 themes × light/dark |

**Adding i18n keys (every task that touches messages):** insert the given object into the existing top-level key of the same name (create the key if it does not exist), in BOTH files, keeping existing entries; 2-space JSON indentation. Never overwrite existing strings (e.g. `pages.overview.emptyHint` already exists and stays as is).

---

### Task 1: Analysis input types and growth (period vs prior period)

**Files:**
- Create: `lib/analysis/types.ts`, `lib/analysis/growth.ts`
- Test: `tests/analysis-growth.test.ts`

**Interfaces:**
- Consumes: `addDays(day, n)`, `localDay(at, tz)` from `lib/sync/time.ts`; `MediaKind` from `lib/instagram/parse.ts`.
- Produces: types `DailyRow`, `Post`, `OnlineFollowersRow`, `Tag`, `MediaTag`, `MissingReason`, `PERIODS`, `Period`; `summarize(rows: DailyRow[], posts: Post[], period: number, today: string, tz: string): Summary`; `combine(list: Summary[]): Summary | null`; `kpis(s: Summary): Record<KpiId, Kpi>`; types `Totals`, `Summary`, `KpiId = 'followers'|'reach'|'views'|'engagementRate'|'posts'|'netFollows'`, `Kpi { value; prior; diff; change; reason }`; const `MIN_COVERAGE = 0.8`.

- [ ] **Step 1: Write the failing test** — `tests/analysis-growth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { combine, kpis, summarize } from '@/lib/analysis/growth';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
/** n consecutive days ending yesterday (oldest first), each built by f(i). */
const days = (n: number, f: (i: number) => Partial<DailyRow>, end = addDays(TODAY, -1)) => Array.from({ length: n }, (_, i) => row(addDays(end, i - n + 1), f(i)));
const post = (id: string, postedAt: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null, ...o });

describe('summarize + kpis', () => {
  it('compares the period with the preceding period of equal length', () => {
    const rows = days(14, (i) => ({ reach: i < 7 ? 100 : 150, views: 10, interactions: i < 7 ? 5 : 15 }));
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.endDay).toBe('2026-10-14');
    expect(s.current).toMatchObject({ reach: 1050, views: 70, interactions: 105, days: 7 });
    expect(s.prior).toMatchObject({ reach: 700, days: 7 });
    const k = kpis(s);
    expect(k.reach).toEqual({ value: 1050, prior: 700, diff: 350, change: 0.5, reason: null });
    expect(k.engagementRate.value).toBeCloseTo(0.1);
    expect(k.engagementRate.diff).toBeCloseTo(0.1 - 35 / 700); // percentage points, not a relative change
    expect(s.reachByDay).toHaveLength(7);
    expect(s.reachByDay[6]).toEqual({ day: '2026-10-14', value: 150 });
  });

  it("ends the window on the latest day with reach (Meta's 48 h lag), so a missing yesterday does not fake a drop", () => {
    const rows = days(14, () => ({ reach: 100 }), '2026-10-13'); // nothing for the 14th yet
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.endDay).toBe('2026-10-13');
    expect(kpis(s).reach.change).toBe(0);
  });

  it('followers: latest snapshot (may be today) vs the snapshot one period earlier', () => {
    const rows = [row('2026-10-01', { followers: 900 }), row('2026-10-08', { followers: 950 }), row(TODAY, { followers: 1000 })];
    const k = kpis(summarize(rows, [], 7, TODAY, KL));
    expect(k.followers).toEqual({ value: 1000, prior: 950, diff: 50, change: 50 / 950, reason: null });
  });

  it('short history: values shown, comparison missing with a reason', () => {
    const k = kpis(summarize(days(5, () => ({ reach: 10, followers: 300 })), [], 7, TODAY, KL));
    expect(k.reach).toEqual({ value: 50, prior: null, diff: null, change: null, reason: 'not_enough_history' });
    expect(k.followers.reason).toBe('not_enough_history');
  });

  it('a zero base never produces NaN or Infinity', () => {
    const rows = days(14, (i) => ({ reach: i < 7 ? 0 : 20, interactions: 0, followers: 0 }));
    const k = kpis(summarize(rows, [], 7, TODAY, KL));
    expect(k.reach).toMatchObject({ value: 140, prior: 0, diff: 140, change: null });
    expect(k.engagementRate).toMatchObject({ value: 0, prior: null, reason: 'not_enough_history' });
    expect(k.followers).toMatchObject({ value: 0, change: 0 });
    for (const v of Object.values(k)) for (const n of [v.value, v.diff, v.change]) if (n !== null) expect(Number.isFinite(n)).toBe(true);
  });

  it('all-null metrics from Meta: every value null with reason no_data', () => {
    const k = kpis(summarize(days(14, () => ({})), [], 7, TODAY, KL));
    for (const id of ['followers', 'reach', 'views', 'engagementRate', 'netFollows'] as const) expect(k[id]).toMatchObject({ value: null, reason: 'no_data' });
    expect(k.posts).toMatchObject({ value: 0, change: 0 });
  });

  it('net follows need follow data; under 100 followers the reason says so', () => {
    const k = kpis(summarize(days(14, () => ({ reach: 5, followers: 42 })), [], 7, TODAY, KL));
    expect(k.netFollows).toMatchObject({ value: null, reason: 'needs_100_followers' });
    const k2 = kpis(summarize(days(14, () => ({ reach: 5, followers: 500, follows: 3, unfollows: 1 })), [], 7, TODAY, KL));
    expect(k2.netFollows).toMatchObject({ value: 14, prior: 14, change: 0 });
  });

  it('counts feed posts by owner-timezone day and ignores stories', () => {
    const rows = days(14, () => ({ reach: 1 }));
    // 17:00 UTC on the 7th is 01:00 on the 8th in Kuala Lumpur: first day of the current window
    const posts = [post('p1', '2026-10-07T17:00:00Z'), post('p2', '2026-10-07T15:00:00Z'), post('s1', '2026-10-10T00:00:00Z', { mediaType: 'STORY' })];
    const s = summarize(rows, posts, 7, TODAY, KL);
    expect(s.current.posts).toBe(1);
    expect(s.prior.posts).toBe(1);
  });

  it('unsorted rows and duplicate-free gaps are handled', () => {
    const rows = days(14, () => ({ reach: 10 })).reverse().filter((_, i) => i !== 3);
    const s = summarize(rows, [], 7, TODAY, KL);
    expect(s.current.days).toBe(6); // 6 of 7 ≥ 80%: still comparable
    expect(kpis(s).reach.change).toBeCloseTo(60 / 70 - 1);
  });

  it('90 days of data: windows of 90 with a 90-day prior', () => {
    const s = summarize(days(180, (i) => ({ reach: i })), [], 90, TODAY, KL);
    expect(s.reachByDay).toHaveLength(90);
    expect(s.current.days).toBe(90);
    expect(kpis(s).reach.change).toBeGreaterThan(0);
  });
});

describe('combine', () => {
  it('sums accounts; coverage is the least complete account', () => {
    const a = summarize(days(14, () => ({ reach: 10, followers: 100 })), [], 7, TODAY, KL);
    const b = summarize(days(9, () => ({ reach: 5, followers: 50 })), [], 7, TODAY, KL);
    const c = combine([a, b])!;
    expect(c.current).toMatchObject({ reach: 105, followers: 150, days: 7 });
    expect(c.prior.days).toBe(2);
    expect(kpis(c).reach.reason).toBe('not_enough_history');
    expect(c.reachByDay[6].value).toBe(15);
    expect(combine([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/analysis-growth.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/growth"`.

- [ ] **Step 3: Write `lib/analysis/types.ts`:**

```ts
// Inputs and shared result types for the pure analysis functions. Rows are shaped by lib/dashboard/read.ts.
// Every metric is nullable: Meta returns nothing under 100 followers, for days it has not settled, or for removed metrics.
import type { MediaKind } from '@/lib/instagram/parse';

/** One account_daily row. day = 'YYYY-MM-DD' in the owner's timezone (as written by the sync). */
export interface DailyRow {
  day: string;
  followers: number | null;
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  interactions: number | null;
  follows: number | null;
  unfollows: number | null;
  linkTaps: number | null;
}

/** A media item with its LATEST media_metrics snapshot (lifetime values). Stories carry mediaType 'STORY'. */
export interface Post {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string; // ISO UTC
  permalink: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number | null;
}

/** One online_followers row: 24 values, index = hour as Instagram reports it (hour base UNCERTAIN, see lib/instagram/metrics.ts). */
export interface OnlineFollowersRow {
  day: string;
  hourly: (number | null)[];
}

/** Tags are a part-2 feature (tables `tags`, `media_tags`); the analysis accepts them as plain input now. */
export interface Tag {
  id: string;
  name: string;
  color: string; // a token name such as 'chart-3', never a raw colour
}
export interface MediaTag {
  mediaId: string;
  tagId: string;
}

/** Why a number is missing. Each key has a translation under `analysis.reasons.*`. */
export type MissingReason = 'no_data' | 'needs_100_followers' | 'not_enough_history' | 'not_enough_posts' | 'backfilling';

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];
```

- [ ] **Step 4: Write `lib/analysis/growth.ts`:**

```ts
// Account growth over a period vs the immediately preceding period of equal length (SPEC §7 "Delta").
// Pure and deterministic: "today" and the timezone are inputs, never read from the clock.
import { addDays, localDay } from '@/lib/sync/time';
import type { DailyRow, MissingReason, Post } from '@/lib/analysis/types';

export interface Totals {
  followers: number | null; // latest snapshot (current) / snapshot one period earlier (prior)
  reach: number | null;
  views: number | null;
  interactions: number | null;
  netFollows: number | null; // Σ(follows − unfollows); null when Instagram gave no follow data (under 100 followers)
  posts: number; // feed posts + reels published in the window (stories excluded)
  days: number; // days in the window that have reach data (coverage)
}

export interface Summary {
  period: number;
  endDay: string; // last day of the current window
  current: Totals;
  prior: Totals;
  reachByDay: { day: string; value: number | null }[]; // current window, oldest first
}

export type KpiId = 'followers' | 'reach' | 'views' | 'engagementRate' | 'posts' | 'netFollows';

export interface Kpi {
  value: number | null;
  prior: number | null;
  diff: number | null; // value − prior (for engagement rate: percentage points as a ratio, 0.004 = +0.4 pp)
  change: number | null; // relative change (diff / prior); null when prior is 0 or missing
  reason: MissingReason | null; // why value or the comparison is missing
}

/** A window only counts for a comparison when at least 80% of its days have data (sync gaps, Meta's 48 h lag). */
export const MIN_COVERAGE = 0.8;

const sum = (vals: (number | null)[]): number | null => {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
};

function totals(rows: DailyRow[], posts: Post[], from: string, to: string, tz: string): Omit<Totals, 'followers'> {
  const inWin = rows.filter((r) => r.day >= from && r.day <= to);
  const follow = inWin.filter((r) => r.follows !== null && r.unfollows !== null);
  return {
    reach: sum(inWin.map((r) => r.reach)),
    views: sum(inWin.map((r) => r.views)),
    interactions: sum(inWin.map((r) => r.interactions)),
    netFollows: follow.length ? follow.reduce((a, r) => a + (r.follows as number) - (r.unfollows as number), 0) : null,
    posts: posts.filter((p) => {
      if (p.mediaType === 'STORY') return false;
      const d = localDay(new Date(p.postedAt), tz);
      return d >= from && d <= to;
    }).length,
    days: inWin.filter((r) => r.reach !== null).length,
  };
}

/** Last non-null followers value on or before `day`, with the day it was taken. */
function followersAt(sorted: DailyRow[], day: string): { day: string; value: number } | null {
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (r.day <= day && r.followers !== null) return { day: r.day, value: r.followers };
  }
  return null;
}

/**
 * The current window ends on the latest day with reach data before today (Instagram lags up to 48 h, so ending on
 * "yesterday" would compare a short window with a full one); with no data at all it ends yesterday.
 * Followers are a daily snapshot written on the day they were read (can be today), so they use their own latest day.
 */
export function summarize(rows: DailyRow[], posts: Post[], period: number, today: string, tz: string): Summary {
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const yesterday = addDays(today, -1);
  const withReach = sorted.filter((r) => r.reach !== null && r.day <= yesterday);
  const endDay = withReach.length ? withReach[withReach.length - 1].day : yesterday;
  const curFrom = addDays(endDay, -(period - 1));
  const priorTo = addDays(endDay, -period);
  const priorFrom = addDays(endDay, -(2 * period - 1));
  const curF = followersAt(sorted, today);
  const priorF = curF ? followersAt(sorted, addDays(curF.day, -period)) : null;
  const byDay = new Map(sorted.map((r) => [r.day, r.reach]));
  return {
    period,
    endDay,
    current: { followers: curF?.value ?? null, ...totals(sorted, posts, curFrom, endDay, tz) },
    prior: { followers: priorF?.value ?? null, ...totals(sorted, posts, priorFrom, priorTo, tz) },
    reachByDay: Array.from({ length: period }, (_, i) => {
      const day = addDays(curFrom, i);
      return { day, value: byDay.get(day) ?? null };
    }),
  };
}

const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
function addTotals(a: Totals, b: Totals): Totals {
  return {
    followers: add(a.followers, b.followers),
    reach: add(a.reach, b.reach),
    views: add(a.views, b.views),
    interactions: add(a.interactions, b.interactions),
    netFollows: add(a.netFollows, b.netFollows),
    posts: a.posts + b.posts,
    days: Math.min(a.days, b.days), // a combined window is only as complete as its least complete account
  };
}

/**
 * Sums several accounts' summaries (group or all-accounts totals). Each account keeps its own window end, so the
 * daily series is merged by position (day 1 … day N of each window) and labelled with the latest end day.
 * ponytail: positional merge; switch to calendar-day merge if accounts' lags ever differ by more than a day.
 */
export function combine(list: Summary[]): Summary | null {
  if (list.length === 0) return null;
  return list.slice(1).reduce<Summary>(
    (acc, s) => ({
      period: acc.period,
      endDay: s.endDay > acc.endDay ? s.endDay : acc.endDay,
      current: addTotals(acc.current, s.current),
      prior: addTotals(acc.prior, s.prior),
      reachByDay: acc.reachByDay.map((d, i) => {
        const o = s.reachByDay[i];
        return { day: o && o.day > d.day ? o.day : d.day, value: add(d.value, o?.value ?? null) };
      }),
    }),
    list[0],
  );
}

const er = (t: Totals) => (t.interactions !== null && t.reach !== null && t.reach > 0 ? t.interactions / t.reach : null);

function kpi(value: number | null, prior: number | null, comparable: boolean, emptyReason: MissingReason): Kpi {
  if (value === null) return { value: null, prior, diff: null, change: null, reason: emptyReason };
  if (!comparable || prior === null) return { value, prior: null, diff: null, change: null, reason: 'not_enough_history' };
  const diff = value - prior;
  return { value, prior, diff, change: prior === 0 ? (diff === 0 ? 0 : null) : diff / Math.abs(prior), reason: null };
}

/** Headline numbers with their comparison. Never NaN or Infinity: a missing or zero base gives null + a reason. */
export function kpis(s: Summary): Record<KpiId, Kpi> {
  const need = Math.ceil(s.period * MIN_COVERAGE);
  const comparable = s.current.days >= need && s.prior.days >= need;
  const fewFollowers: MissingReason = s.current.followers !== null && s.current.followers < 100 ? 'needs_100_followers' : 'no_data';
  return {
    followers: kpi(s.current.followers, s.prior.followers, true, 'no_data'),
    reach: kpi(s.current.reach, s.prior.reach, comparable, 'no_data'),
    views: kpi(s.current.views, s.prior.views, comparable, 'no_data'),
    engagementRate: kpi(er(s.current), er(s.prior), comparable, 'no_data'),
    // media history comes from the 500-post backfill, not from daily snapshots, so post counts always compare
    posts: kpi(s.current.posts, s.prior.posts, true, 'no_data'),
    netFollows: kpi(s.current.netFollows, s.prior.netFollows, comparable, fewFollowers),
  };
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/analysis-growth.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/analysis/types.ts lib/analysis/growth.ts tests/analysis-growth.test.ts
git commit -m "feat: growth analysis (period vs prior period, coverage, missing-data reasons)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Metrics registry, `formatDay` / `formatSigned`, metric labels

**Files:**
- Create: `lib/metrics.ts`
- Modify: `lib/format.ts` (after `formatDateTime`; replace `formatDelta`), `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/metrics.test.ts`

**Interfaces:**
- Consumes: `Kpi`, `KpiId` (Task 1); `formatCompact`, `formatNumber`, `formatPercent`, `formatDelta`, `FormatPrefs` (`lib/format.ts`).
- Produces: `METRICS: Record<KpiId, MetricDef>` (`{ id, kind: 'count'|'percent', higherIsBetter }`); `formatMetric(id, value, prefs, { full? }): string`; `deltaView(id, kpi, prefs): DeltaView | null` with `DeltaView { text; unit: 'relative'|'absolute'|'points'; direction: 'up'|'down'|'flat'; tone: 'good'|'bad'|'neutral' }`; `formatDay(day: string, p): string`; `formatSigned(n, p, digits = 0): string`. i18n: `metrics.<KpiId>`, `analysis.reasons.<MissingReason>`.

- [ ] **Step 1: Write the failing test** — `tests/metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import type { Kpi } from '@/lib/analysis/growth';
import { formatDay, formatSigned, type FormatPrefs } from '@/lib/format';
import { deltaView, formatMetric, METRICS } from '@/lib/metrics';

const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'Asia/Kuala_Lumpur' };
const k = (o: Partial<Kpi>): Kpi => ({ value: 1, prior: 1, diff: 0, change: 0, reason: null, ...o });

describe('METRICS registry', () => {
  it('every metric has a label in both languages', () => {
    for (const id of Object.keys(METRICS)) {
      expect((en.metrics as Record<string, string>)[id], id).toBeTruthy();
      expect((zh.metrics as Record<string, string>)[id], id).toBeTruthy();
    }
  });
});

describe('formatMetric', () => {
  it('compact counts, full counts, percents', () => {
    expect(formatMetric('reach', 12345, P)).toBe('12.3K');
    expect(formatMetric('followers', 12345, P, { full: true })).toBe('12,345');
    expect(formatMetric('engagementRate', 0.0456, P)).toBe('4.6%');
    expect(formatMetric('reach', null, P)).toBe('—');
  });
});

describe('deltaView', () => {
  it('relative change for counts, coloured by higher-is-better', () => {
    expect(deltaView('reach', k({ diff: 50, change: 0.125 }), P)).toEqual({ text: '+12.5%', unit: 'relative', direction: 'up', tone: 'good' });
    expect(deltaView('reach', k({ diff: -50, change: -0.125 }), P)).toMatchObject({ text: '-12.5%', direction: 'down', tone: 'bad' });
  });
  it('percentage points for rates', () => {
    expect(deltaView('engagementRate', k({ diff: 0.004, change: 0.1 }), P)).toEqual({ text: '+0.4', unit: 'points', direction: 'up', tone: 'good' });
  });
  it('absolute change when the previous value was 0; flat is neutral; nothing to compare is null', () => {
    expect(deltaView('posts', k({ diff: 3, change: null }), P)).toEqual({ text: '+3', unit: 'absolute', direction: 'up', tone: 'good' });
    expect(deltaView('reach', k({ diff: 0.0001, change: 0.0000001 }), P)).toMatchObject({ text: '0.0%', direction: 'flat', tone: 'neutral' });
    expect(deltaView('reach', k({ diff: null, change: null }), P)).toBeNull();
  });
});

describe('formatDay / formatSigned', () => {
  it('formats a calendar day without shifting it by the timezone', () => {
    expect(formatDay('2026-10-14', { ...P, timezone: 'Pacific/Kiritimati' })).toBe('14 Oct 2026');
    expect(formatDay('2026-10-14', { ...P, timezone: 'Pacific/Pago_Pago' })).toBe('14 Oct 2026');
    expect(formatDay('nonsense', P)).toBe('—');
  });
  it('signs absolute changes, never a signed zero', () => {
    expect(formatSigned(1234, P)).toBe('+1,234');
    expect(formatSigned(-3.25, P, 1)).toBe('-3.3');
    expect(formatSigned(-0.01, P)).toBe('0');
    expect(formatSigned(null, P)).toBe('—');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/metrics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/metrics"`.

- [ ] **Step 3: Add the format helpers** — in `lib/format.ts`, insert directly after the `formatDateTime` function:

```ts
/** A calendar day 'YYYY-MM-DD' that is already in the owner's timezone (account_daily.day): no timezone shift. */
export function formatDay(day: string, p: FormatPrefs): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(`${day}T12:00:00Z`, { ...p, timezone: 'UTC' }) : DASH;
}
```

and replace the whole existing `formatDelta` function (end of the file) with:

```ts
/** "+12" / "-3.5" / "0": a signed absolute change. Never a signed zero. */
export function formatSigned(n: number | null | undefined, p: FormatPrefs, digits = 0): string {
  if (!isNum(n)) return DASH;
  const fixed = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (Number(n.toFixed(digits)) === 0) return formatNumber(0, p, fixed);
  return `${n > 0 ? '+' : '-'}${formatNumber(Math.abs(n), p, fixed)}`;
}

export function formatDelta(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
  return isNum(ratio) ? `${formatSigned(ratio * 100, p, digits)}%` : DASH;
}
```

(`formatDelta`'s behaviour is unchanged; `tests/format.test.ts` keeps passing.)

- [ ] **Step 4: Write `lib/metrics.ts`:**

```ts
// The metrics registry (SPEC §8b.2): one entry per metric drives cards, charts, tables and pickers.
// How a metric is aggregated lives in lib/analysis/growth.ts (kpis); this file says how to label, format and judge it.
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { formatCompact, formatNumber, formatPercent, formatSigned, formatDelta, type FormatPrefs } from '@/lib/format';

export type MetricKind = 'count' | 'percent';

export interface MetricDef {
  id: KpiId;
  kind: MetricKind;
  higherIsBetter: boolean; // decides the colour of a change: up is good for reach, would be bad for e.g. unfollows
}

/** i18n label: `metrics.<id>` in messages/*.json. Order = display order. */
export const METRICS: Record<KpiId, MetricDef> = {
  followers: { id: 'followers', kind: 'count', higherIsBetter: true },
  reach: { id: 'reach', kind: 'count', higherIsBetter: true },
  views: { id: 'views', kind: 'count', higherIsBetter: true },
  engagementRate: { id: 'engagementRate', kind: 'percent', higherIsBetter: true },
  posts: { id: 'posts', kind: 'count', higherIsBetter: true },
  netFollows: { id: 'netFollows', kind: 'count', higherIsBetter: true },
};

/** The headline value. Counts are compact (12.3K) unless `full`; percents keep one decimal. */
export function formatMetric(id: KpiId, value: number | null, p: FormatPrefs, opts: { full?: boolean } = {}): string {
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
export function deltaView(id: KpiId, k: Kpi, p: FormatPrefs): DeltaView | null {
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

- [ ] **Step 5: Add the i18n keys** (see "Adding i18n keys" above).

`messages/en.json`:
```json
"metrics": {
  "followers": "Followers",
  "reach": "Reach",
  "views": "Views",
  "engagementRate": "Engagement",
  "posts": "Posts",
  "netFollows": "Net follows"
},
"analysis": {
  "reasons": {
    "no_data": "No data yet",
    "needs_100_followers": "Instagram shares this from 100 followers",
    "not_enough_history": "Not enough history to compare yet",
    "not_enough_posts": "Needs ~30+ posts for a reliable pattern",
    "backfilling": "Importing history…"
  }
}
```

`messages/zh-CN.json`:
```json
"metrics": {
  "followers": "粉丝",
  "reach": "触达",
  "views": "播放",
  "engagementRate": "互动率",
  "posts": "帖子",
  "netFollows": "净增粉丝"
},
"analysis": {
  "reasons": {
    "no_data": "暂无数据",
    "needs_100_followers": "粉丝达到 100 后 Instagram 才提供此数据",
    "not_enough_history": "历史数据不足，暂无法对比",
    "not_enough_posts": "需要约 30 篇以上帖子才能得出可靠规律",
    "backfilling": "正在导入历史数据…"
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/metrics.test.ts tests/format.test.ts tests/messages.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/metrics.ts lib/format.ts messages/en.json messages/zh-CN.json tests/metrics.test.ts
git commit -m "feat: metrics registry, formatDay/formatSigned, metric and reason labels" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Post analysis (engagement rate, top posts, formats, tags)

**Files:**
- Create: `lib/analysis/posts.ts`
- Test: `tests/analysis-posts.test.ts`

**Interfaces:**
- Consumes: `Post`, `Tag`, `MediaTag` (Task 1); `MediaKind` (`lib/instagram/parse.ts`).
- Produces: `engagementRate(p: Post): number | null`; `median(values: number[]): number | null`; `topPosts(posts, by: 'reach'|'engagementRate', { limit = 5, order: 'top'|'bottom' }): { post; value }[]`; `formatComparison(posts): ({ mediaType } & GroupStats)[]`; `tagPerformance(posts, mediaTags, tags): ({ tag } & GroupStats)[]`; `GroupStats { posts; measured; avgReach; engagementRate }`; `FEED_FORMATS`.

- [ ] **Step 1: Write the failing test** — `tests/analysis-posts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { engagementRate, formatComparison, median, tagPerformance, topPosts } from '@/lib/analysis/posts';
import type { Post } from '@/lib/analysis/types';

const post = (id: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-01T10:00:00Z', permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null, ...o });

describe('engagementRate', () => {
  it('(likes + comments + saves + shares) ÷ reach', () => {
    expect(engagementRate(post('p', { reach: 200, likes: 10, comments: 4, saves: 3, shares: 3 }))).toBe(0.1);
  });
  it('missing parts count as 0, but all missing or no reach is null (never NaN/Infinity)', () => {
    expect(engagementRate(post('p', { reach: 100, likes: 5 }))).toBe(0.05);
    expect(engagementRate(post('p', { reach: 100 }))).toBeNull();
    expect(engagementRate(post('p', { reach: 0, likes: 5 }))).toBeNull();
    expect(engagementRate(post('p', { likes: 5 }))).toBeNull();
  });
});

describe('median', () => {
  it('odd, even, empty', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('topPosts', () => {
  const posts = [
    post('a', { reach: 100, likes: 1 }),
    post('b', { reach: 500, likes: 4 }),
    post('c', { reach: null, likes: 50 }),
    post('d', { reach: 500, likes: 100, postedAt: '2026-10-02T10:00:00Z' }),
    post('s', { reach: 9999, mediaType: 'STORY' }),
  ];
  it('ranks by reach, ties newest first, skips stories and missing values', () => {
    expect(topPosts(posts, 'reach').map((x) => x.post.id)).toEqual(['d', 'b', 'a']);
  });
  it('bottom and by engagement rate', () => {
    expect(topPosts(posts, 'engagementRate', { order: 'bottom', limit: 2 }).map((x) => x.post.id)).toEqual(['b', 'a']);
    expect(topPosts(posts, 'engagementRate')[0]).toEqual({ post: posts[3], value: 0.2 });
  });
  it('a single post and identical timestamps stay deterministic', () => {
    expect(topPosts([post('x', { reach: 1 })], 'reach')).toHaveLength(1);
    const same = [post('z', { reach: 5 }), post('y', { reach: 5 })];
    expect(topPosts(same, 'reach').map((x) => x.post.id)).toEqual(['y', 'z']);
    expect(topPosts([...same].reverse(), 'reach').map((x) => x.post.id)).toEqual(['y', 'z']);
  });
});

describe('formatComparison', () => {
  it('avg reach and pooled engagement per format, fixed order, empty formats omitted', () => {
    const rows = formatComparison([
      post('i1', { reach: 100, likes: 10 }),
      post('i2', { reach: 300, likes: 10 }),
      post('i3', { reach: null }),
      post('r1', { mediaType: 'REELS', reach: 1000, likes: 50, shares: 50 }),
      post('s1', { mediaType: 'STORY', reach: 10 }),
    ]);
    expect(rows.map((r) => r.mediaType)).toEqual(['REELS', 'IMAGE']);
    expect(rows[1]).toEqual({ mediaType: 'IMAGE', posts: 3, measured: 2, avgReach: 200, engagementRate: 20 / 400 });
    expect(rows[0].engagementRate).toBe(0.1);
  });
  it('a format whose posts all lack reach has null averages', () => {
    expect(formatComparison([post('c', { mediaType: 'CAROUSEL_ALBUM' })])[0]).toMatchObject({ posts: 1, measured: 0, avgReach: null, engagementRate: null });
  });
});

describe('tagPerformance', () => {
  it('per tag stats; multi-tagged posts count for each tag; unused tags kept and listed last', () => {
    const posts = [post('p1', { reach: 100, likes: 10 }), post('p2', { reach: 300 }), post('s', { reach: 50, mediaType: 'STORY' })];
    const tags = [
      { id: 't1', name: 'Tips', color: 'chart-1' },
      { id: 't2', name: 'Promo', color: 'chart-2' },
      { id: 't3', name: 'Unused', color: 'chart-3' },
    ];
    const out = tagPerformance(posts, [{ mediaId: 'p1', tagId: 't1' }, { mediaId: 'p2', tagId: 't1' }, { mediaId: 'p2', tagId: 't2' }, { mediaId: 's', tagId: 't2' }, { mediaId: 'gone', tagId: 't2' }], tags);
    expect(out.map((r) => r.tag.name)).toEqual(['Promo', 'Tips', 'Unused']);
    expect(out[0]).toMatchObject({ posts: 1, avgReach: 300 });
    expect(out[1]).toMatchObject({ posts: 2, avgReach: 200, engagementRate: 10 / 400 });
    expect(out[2]).toMatchObject({ posts: 0, avgReach: null });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/analysis-posts.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/posts"`.

- [ ] **Step 3: Write `lib/analysis/posts.ts`:**

```ts
// Post-level analysis: engagement rate, top/bottom posts, format comparison, tag performance (SPEC §7).
import type { MediaKind } from '@/lib/instagram/parse';
import type { MediaTag, Post, Tag } from '@/lib/analysis/types';

const n = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** (likes + comments + saves + shares) ÷ reach (SPEC §7). Missing parts count as 0; all missing, or no reach → null. */
export function engagementRate(p: Post): number | null {
  const parts = [p.likes, p.comments, p.saves, p.shares].map(n);
  const reach = n(p.reach);
  if (reach === null || reach <= 0 || parts.every((v) => v === null)) return null;
  return parts.reduce<number>((a, v) => a + (v ?? 0), 0) / reach;
}

const interactionsOf = (p: Post) => [p.likes, p.comments, p.saves, p.shares].reduce<number>((a, v) => a + (n(v) ?? 0), 0);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Deterministic order for equal values: newer first, then id. */
const tieBreak = (a: Post, b: Post) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt > b.postedAt ? -1 : 1);

/** Top (or bottom) feed posts by reach or engagement rate. Posts without that value are left out, never ranked as 0. */
export function topPosts(posts: Post[], by: 'reach' | 'engagementRate', opts: { limit?: number; order?: 'top' | 'bottom' } = {}): { post: Post; value: number }[] {
  const { limit = 5, order = 'top' } = opts;
  return posts
    .filter((p) => p.mediaType !== 'STORY')
    .map((post) => ({ post, value: by === 'reach' ? n(post.reach) : engagementRate(post) }))
    .filter((x): x is { post: Post; value: number } => x.value !== null)
    .sort((a, b) => (a.value === b.value ? tieBreak(a.post, b.post) : order === 'top' ? b.value - a.value : a.value - b.value))
    .slice(0, limit);
}

export interface GroupStats {
  posts: number; // posts in the group
  measured: number; // posts with a reach value (the base of the averages)
  avgReach: number | null;
  engagementRate: number | null; // Σ interactions ÷ Σ reach over measured posts
}

function stats(list: Post[]): GroupStats {
  const measured = list.filter((p) => (n(p.reach) ?? 0) > 0);
  const reach = measured.reduce((a, p) => a + (p.reach as number), 0);
  return {
    posts: list.length,
    measured: measured.length,
    avgReach: measured.length ? reach / measured.length : null,
    engagementRate: reach > 0 ? measured.reduce((a, p) => a + interactionsOf(p), 0) / reach : null,
  };
}

export const FEED_FORMATS: Exclude<MediaKind, 'STORY'>[] = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE'];

/** Avg reach + engagement per format, in a fixed order; formats with no posts are omitted. */
export function formatComparison(posts: Post[]): ({ mediaType: Exclude<MediaKind, 'STORY'> } & GroupStats)[] {
  return FEED_FORMATS.map((mediaType) => ({ mediaType, ...stats(posts.filter((p) => p.mediaType === mediaType)) })).filter((r) => r.posts > 0);
}

/**
 * Per-tag stats. Tags come from part 2 (`tags`, `media_tags`); a post with several tags counts for each. Tags with no
 * posts are kept (posts: 0) so the Tags page can list them; sorted by avg reach, unmeasured last, then name.
 */
export function tagPerformance(posts: Post[], mediaTags: MediaTag[], tags: Tag[]): ({ tag: Tag } & GroupStats)[] {
  const byId = new Map(posts.filter((p) => p.mediaType !== 'STORY').map((p) => [p.id, p]));
  return tags
    .map((tag) => {
      const ids = new Set(mediaTags.filter((mt) => mt.tagId === tag.id).map((mt) => mt.mediaId));
      return { tag, ...stats([...ids].map((id) => byId.get(id)).filter((p): p is Post => !!p)) };
    })
    .sort((a, b) => (b.avgReach ?? -1) - (a.avgReach ?? -1) || a.tag.name.localeCompare(b.tag.name));
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/analysis-posts.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/posts.ts tests/analysis-posts.test.ts
git commit -m "feat: post analysis (engagement rate, top posts, format comparison, tag performance)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Best time to post (weekday × hour, sample guard)

**Files:**
- Create: `lib/analysis/best-time.ts`
- Test: `tests/analysis-best-time.test.ts`

**Interfaces:**
- Consumes: `localDay`, `localHour` (`lib/sync/time.ts`); `WeekStart` (`lib/prefs.ts`); `engagementRate` (Task 3); `Post`, `OnlineFollowersRow`, `MissingReason` (Task 1).
- Produces: `postHeatmap(posts, tz, weekStart): Heatmap`; `onlineHeatmap(rows, weekStart): Heatmap`; `Heatmap { rows: { weekday: 0-6; cells: HeatCell[24] }[]; sample; reason }`; `HeatCell { value; count; lowSample }`; `weekdayOf(day)`, `weekOrder(start)`; consts `MIN_CELL_POSTS = 2`, `RELIABLE_POSTS = 30`.

- [ ] **Step 1: Write the failing test** — `tests/analysis-best-time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { onlineHeatmap, postHeatmap, RELIABLE_POSTS, weekdayOf, type Heatmap } from '@/lib/analysis/best-time';
import type { Post } from '@/lib/analysis/types';

const post = (id: string, postedAt: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: 100, views: null, likes: 10, comments: null, shares: null, saves: null, interactions: null, ...o });
const cell = (h: Heatmap, weekday: number, hour: number) => h.rows.find((r) => r.weekday === weekday)!.cells[hour];

describe('weekdayOf', () => {
  it('reads the calendar day, not the instant', () => {
    expect(weekdayOf('2026-10-14')).toBe(3); // Wednesday
  });
});

describe('postHeatmap', () => {
  it('bins by owner-timezone weekday and hour; rows follow the week start', () => {
    // 16:30 UTC Tue 13 Oct = 00:30 Wed 14 Oct in Kuala Lumpur
    const h = postHeatmap([post('a', '2026-10-13T16:30:00Z'), post('b', '2026-10-13T16:45:00Z', { likes: 30 })], 'Asia/Kuala_Lumpur', 'mon');
    expect(h.rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(h.rows.every((r) => r.cells.length === 24)).toBe(true);
    expect(cell(h, 3, 0)).toEqual({ value: 0.2, count: 2, lowSample: false });
    expect(cell(h, 2, 16)).toEqual({ value: null, count: 0, lowSample: true });
    expect(postHeatmap([], 'UTC', 'sun').rows[0].weekday).toBe(0);
  });

  it('cells with fewer than 2 posts are flagged; under 30 posts the whole grid says why', () => {
    const h = postHeatmap([post('a', '2026-10-13T10:00:00Z')], 'UTC', 'mon');
    expect(cell(h, 2, 10)).toMatchObject({ count: 1, lowSample: true });
    expect(h).toMatchObject({ sample: 1, reason: 'not_enough_posts' });
    const many = Array.from({ length: RELIABLE_POSTS }, (_, i) => post(`p${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`));
    expect(postHeatmap(many, 'UTC', 'mon').reason).toBeNull();
  });

  it('DST fall-back: both 01:30s on 1 Nov 2026 in New York land in Sunday 01:00', () => {
    const h = postHeatmap([post('edt', '2026-11-01T05:30:00Z'), post('est', '2026-11-01T06:30:00Z')], 'America/New_York', 'mon');
    expect(cell(h, 0, 1).count).toBe(2);
  });

  it('skips stories, posts without engagement data and bad timestamps', () => {
    const h = postHeatmap([post('s', '2026-10-13T10:00:00Z', { mediaType: 'STORY' }), post('n', '2026-10-13T10:00:00Z', { reach: null }), post('x', 'not a date')], 'UTC', 'mon');
    expect(h.sample).toBe(0);
  });
});

describe('onlineHeatmap', () => {
  it('averages followers online per weekday and hour across days', () => {
    const hourly = (v: number) => Array.from({ length: 24 }, (_, i) => (i === 20 ? v : 1));
    const h = onlineHeatmap([{ day: '2026-10-07', hourly: hourly(100) }, { day: '2026-10-14', hourly: hourly(300) }, { day: '2026-10-13', hourly: hourly(50) }], 'mon');
    expect(cell(h, 3, 20)).toEqual({ value: 200, count: 2, lowSample: false });
    expect(h).toMatchObject({ sample: 3, reason: null });
  });

  it('no data (under 100 followers) gives an empty grid with the reason; null hours are skipped', () => {
    expect(onlineHeatmap([], 'mon').reason).toBe('needs_100_followers');
    const h = onlineHeatmap([{ day: '2026-10-14', hourly: [null, 5] }], 'mon');
    expect(cell(h, 3, 0)).toMatchObject({ value: null, count: 0 });
    expect(cell(h, 3, 1)).toMatchObject({ value: 5, count: 1 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/analysis-best-time.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/best-time"`.

- [ ] **Step 3: Write `lib/analysis/best-time.ts`:**

```ts
// Best time to post (SPEC §7): weekday × hour grids. Default view = followers online; toggle = your post performance.
// Pass one account's rows for the per-account view, or several accounts' rows concatenated for the pooled view.
import { localDay, localHour } from '@/lib/sync/time';
import type { WeekStart } from '@/lib/prefs';
import { engagementRate } from '@/lib/analysis/posts';
import type { MissingReason, OnlineFollowersRow, Post } from '@/lib/analysis/types';

/** Cells with fewer posts than this are greyed out. */
export const MIN_CELL_POSTS = 2;
/** Below this many measured feed posts the view says "Needs ~30+ posts for a reliable pattern". */
export const RELIABLE_POSTS = 30;

export interface HeatCell {
  value: number | null; // average (engagement rate, or followers online)
  count: number; // posts (or days) behind the value
  lowSample: boolean;
}
export interface Heatmap {
  rows: { weekday: number; cells: HeatCell[] }[]; // weekday 0 = Sunday … 6 = Saturday, ordered by the user's week start; 24 cells each
  sample: number; // measured posts (or days) in total
  reason: MissingReason | null; // set when the whole grid is unreliable or empty
}

/** Weekday of a 'YYYY-MM-DD' calendar day (timezone-free). */
export const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
export const weekOrder = (start: WeekStart) => (start === 'sun' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]);

function build(points: { weekday: number; hour: number; value: number }[], start: WeekStart, minCount: number): Heatmap['rows'] {
  const acc = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ total: 0, count: 0 })));
  for (const p of points) {
    acc[p.weekday][p.hour].total += p.value;
    acc[p.weekday][p.hour].count += 1;
  }
  return weekOrder(start).map((weekday) => ({
    weekday,
    cells: acc[weekday].map(({ total, count }) => ({ value: count ? total / count : null, count, lowSample: count < minCount })),
  }));
}

/** Avg engagement rate by the owner-timezone weekday and hour each feed post was published. */
export function postHeatmap(posts: Post[], tz: string, start: WeekStart): Heatmap {
  const points = posts
    .filter((p) => p.mediaType !== 'STORY')
    .map((p) => ({ at: new Date(p.postedAt), value: engagementRate(p) }))
    .filter((x): x is { at: Date; value: number } => x.value !== null && !Number.isNaN(x.at.getTime()))
    .map(({ at, value }) => ({ weekday: weekdayOf(localDay(at, tz)), hour: localHour(at, tz), value }));
  return { rows: build(points, start, MIN_CELL_POSTS), sample: points.length, reason: points.length < RELIABLE_POSTS ? 'not_enough_posts' : null };
}

/**
 * Average followers online by weekday × hour. The hour index is used as Instagram reports it (hour base UNCERTAIN,
 * see lib/instagram/metrics.ts); re-map here once the runbook confirms it. Instagram only reports this from 100 followers.
 */
export function onlineHeatmap(rows: OnlineFollowersRow[], start: WeekStart): Heatmap {
  const points = rows.flatMap((r) =>
    r.hourly.slice(0, 24).flatMap((v, hour) => (typeof v === 'number' && Number.isFinite(v) ? [{ weekday: weekdayOf(r.day), hour, value: v }] : [])),
  );
  return { rows: build(points, start, 1), sample: rows.length, reason: points.length === 0 ? 'needs_100_followers' : null };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/analysis-best-time.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/best-time.ts tests/analysis-best-time.test.ts
git commit -m "feat: best-time heatmaps (post performance and followers online, sample guard)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Flags computed on read (taking off, reach drop)

**Files:**
- Create: `lib/analysis/flags.ts`
- Test: `tests/analysis-flags.test.ts`

**Interfaces:**
- Consumes: `summarize`, `kpis` (Task 1); `median` (Task 3); `DailyRow`, `Post` (Task 1).
- Produces: `takingOff(posts, now: Date, withinDays = 7): { kind: 'taking_off'; postId; permalink; postedAt; ratio }[]` (newest first); `reachDrop(rows, today, tz): { kind: 'reach_drop'; change } | null`; type `Flag` (union of both); consts `TAKING_OFF_RATIO`, `PRIOR_POSTS`, `MIN_PRIOR_POSTS`, `MIN_AGE_HOURS`, `REACH_DROP`.

- [ ] **Step 1: Write the failing test** — `tests/analysis-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const NOW = new Date('2026-10-15T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const post = (id: string, postedAt: string, reach: number | null, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: `https://instagram.com/p/${id}`, reach, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null, ...o });
/** n older posts with reach 100, one per day, ending 3 days ago. */
const history = (n: number, reach: number | null = 100) => Array.from({ length: n }, (_, i) => post(`h${i}`, hoursAgo(72 + 24 * (n - i)), reach));

describe('takingOff', () => {
  it('flags a post with ≥ 2× the median reach of the previous 20 posts', () => {
    const flags = takingOff([...history(20), post('hit', hoursAgo(30), 200), post('meh', hoursAgo(26), 150)], NOW);
    expect(flags).toEqual([{ kind: 'taking_off', postId: 'hit', permalink: 'https://instagram.com/p/hit', postedAt: hoursAgo(30), ratio: 2 }]);
  });

  it('waits 24 h after posting and ignores posts older than the window', () => {
    expect(takingOff([...history(10), post('young', hoursAgo(23), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10), post('old', hoursAgo(24 * 8), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10), post('old', hoursAgo(24 * 8), 1000)], NOW, 30)).toHaveLength(1);
  });

  it('needs ≥ 5 prior posts with reach; a single post or all-null history never flags', () => {
    expect(takingOff([...history(4), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([post('only', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10, null), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]);
    expect(takingOff([...history(10, 0), post('x', hoursAgo(30), 1000)], NOW)).toEqual([]); // median 0: no ratio
  });

  it('only the previous 20 count; stories are ignored; identical timestamps order by id', () => {
    const old = Array.from({ length: 5 }, (_, i) => post(`o${i}`, hoursAgo(24 * 60 + i), 10_000));
    expect(takingOff([...old, ...history(20), post('hit', hoursAgo(30), 250)], NOW).map((f) => f.postId)).toEqual(['hit']);
    expect(takingOff([...history(10), post('s', hoursAgo(30), 9999, { mediaType: 'STORY' })], NOW)).toEqual([]);
    const t = hoursAgo(30);
    expect(takingOff([...history(10), post('b', t, 1000), post('a', t, 1000)], NOW).map((f) => f.postId)).toEqual(['b', 'a']);
  });
});

describe('reachDrop', () => {
  const row = (day: string, reach: number | null): DailyRow => ({ day, followers: null, reach, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
  const weeks = (prev: number, cur: number) => Array.from({ length: 14 }, (_, i) => row(addDays('2026-10-01', i), i < 7 ? prev : cur));
  it('flags a 7-day drop of 20% or more', () => {
    expect(reachDrop(weeks(100, 80), '2026-10-15', 'UTC')).toEqual({ kind: 'reach_drop', change: -0.2 });
    expect(reachDrop(weeks(100, 81), '2026-10-15', 'UTC')).toBeNull();
  });
  it('no flag without two comparable weeks', () => {
    expect(reachDrop(weeks(100, 0).slice(7), '2026-10-15', 'UTC')).toBeNull();
    expect(reachDrop([], '2026-10-15', 'UTC')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/analysis-flags.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/analysis/flags"`.

- [ ] **Step 3: Write `lib/analysis/flags.ts`:**

```ts
// Flags are computed on read, never stored (SPEC §5). Definitions: SPEC §7 "Post taking off" and §7c "reach drop".
// Plan 7 (alerts) reuses these; its Settings thresholds become parameters then.
import { kpis, summarize } from '@/lib/analysis/growth';
import { median } from '@/lib/analysis/posts';
import type { DailyRow, Post } from '@/lib/analysis/types';

export const TAKING_OFF_RATIO = 2;
export const PRIOR_POSTS = 20;
export const MIN_PRIOR_POSTS = 5;
export const MIN_AGE_HOURS = 24;
export const REACH_DROP = -0.2;

export type Flag =
  | { kind: 'taking_off'; postId: string; permalink: string | null; postedAt: string; ratio: number }
  | { kind: 'reach_drop'; change: number };

const HOUR = 3_600_000;

/**
 * Feed posts (one account) whose reach is ≥ 2× the median reach of that account's previous 20 feed posts, evaluated
 * ≥ 24 h after posting, with ≥ 5 prior posts that have reach. Only posts from the last `withinDays` days are reported.
 * Newest first.
 */
export function takingOff(posts: Post[], now: Date, withinDays = 7): Extract<Flag, { kind: 'taking_off' }>[] {
  const feed = posts
    .filter((p) => p.mediaType !== 'STORY' && !Number.isNaN(Date.parse(p.postedAt)))
    .sort((a, b) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt < b.postedAt ? -1 : 1));
  const out: Extract<Flag, { kind: 'taking_off' }>[] = [];
  feed.forEach((p, i) => {
    const age = now.getTime() - Date.parse(p.postedAt);
    if (age < MIN_AGE_HOURS * HOUR || age > withinDays * 24 * HOUR || p.reach === null) return;
    const prior = feed.slice(Math.max(0, i - PRIOR_POSTS), i).map((x) => x.reach).filter((r): r is number => r !== null);
    const m = prior.length >= MIN_PRIOR_POSTS ? median(prior) : null;
    if (m !== null && m > 0 && p.reach >= TAKING_OFF_RATIO * m) out.push({ kind: 'taking_off', postId: p.id, permalink: p.permalink, postedAt: p.postedAt, ratio: p.reach / m });
  });
  return out.reverse();
}

/** 7-day reach ≤ −20% vs the previous 7 days (only when both weeks have enough data to compare). */
export function reachDrop(rows: DailyRow[], today: string, tz: string): Extract<Flag, { kind: 'reach_drop' }> | null {
  const change = kpis(summarize(rows, [], 7, today, tz)).reach.change;
  return change !== null && change <= REACH_DROP ? { kind: 'reach_drop', change } : null;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/analysis-flags.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/flags.ts tests/analysis-flags.test.ts
git commit -m "feat: flags on read (post taking off, 7-day reach drop)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard read layer (owner session, RLS)

**Files:**
- Create: `lib/dashboard/read.ts`
- Modify: `lib/sync/store.ts` (`SyncStatus`, `listSyncStatus`), `tests/sync-store.test.ts` (one expectation)
- Test: `tests/dashboard-read.test.ts`

**Interfaces:**
- Consumes: `supabaseAccountsStore(db).list()` (`lib/accounts/supabase-store.ts`); `listSyncStatus(db)`, `SyncStatus` (`lib/sync/store.ts`); `DailyRow`, `Post` (Task 1).
- Produces: `loadDaily(db, accountId, fromDay): Promise<DailyRow[]>`; `loadPosts(db, accountId, limit = 500): Promise<Post[]>`; `loadOverviewInput(db, fromDay): Promise<OverviewInput>` with `OverviewInput { accounts: StoredAccount[] (archived removed); sync: Record<id, SyncStatus>; daily: Record<id, DailyRow[]>; posts: Record<id, Post[]> }`; `rowToDaily`, `rowToPost`; consts `MEDIA_LIMIT = 500`, `DAILY_LIMIT = 200`. `SyncStatus.dailyDoneThrough?: string | null`.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadDaily, loadOverviewInput, loadPosts, MEDIA_LIMIT, rowToPost } from '@/lib/dashboard/read';

type Call = { table: string; select: string; ops: unknown[][] };

/** Fake Supabase client: every chained call is recorded; an awaited query resolves to the next result queued for its table. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'neq', 'gte', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[table]?.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const mediaRow = (id: string, metrics: unknown[] = [{ reach: 120, likes: 9, total_interactions: 11, captured_at: '2026-10-14T00:00:00Z' }]) => ({ id, account_id: 'a1', media_type: 'REELS', posted_at: '2026-10-10T10:00:00+00:00', permalink: 'https://www.instagram.com/reel/x/', media_metrics: metrics });

describe('loadDaily', () => {
  it('reads one account from a day on, oldest first, capped, and maps columns', async () => {
    const f = fakeDb({ account_daily: [{ data: [{ day: '2026-10-13', followers: 120, reach: 50, views: 80, accounts_engaged: 4, total_interactions: 7, follows: null, unfollows: null, link_taps: 1 }] }] });
    expect(await loadDaily(f.db, 'a1', '2026-07-17')).toEqual([{ day: '2026-10-13', followers: 120, reach: 50, views: 80, accountsEngaged: 4, interactions: 7, follows: null, unfollows: null, linkTaps: 1 }]);
    expect(f.calls[0].ops).toEqual([['eq', 'account_id', 'a1'], ['gte', 'day', '2026-07-17'], ['order', 'day', { ascending: true }], ['limit', 200]]);
  });
  it('throws a fixed message that never echoes the database error', async () => {
    const f = fakeDb({ account_daily: [{ error: { message: 'secret detail' } }] });
    await expect(loadDaily(f.db, 'a1', '2026-07-17')).rejects.toThrow(/^dashboard read: daily failed$/);
  });
});

describe('loadPosts', () => {
  it('newest 500 feed posts with only the latest metrics snapshot each', async () => {
    const f = fakeDb({ media: [{ data: [mediaRow('m1'), mediaRow('m2', [])] }] });
    const posts = await loadPosts(f.db, 'a1', 10_000);
    expect(posts[0]).toMatchObject({ id: 'm1', accountId: 'a1', mediaType: 'REELS', reach: 120, likes: 9, interactions: 11, comments: null });
    expect(posts[1]).toMatchObject({ id: 'm2', reach: null });
    expect(f.calls[0].select).toContain('media_metrics(');
    expect(f.calls[0].ops).toEqual([
      ['eq', 'account_id', 'a1'],
      ['neq', 'media_type', 'STORY'],
      ['order', 'posted_at', { ascending: false }],
      ['order', 'captured_at', { ascending: false, referencedTable: 'media_metrics' }],
      ['limit', MEDIA_LIMIT],
      ['limit', 1, { referencedTable: 'media_metrics' }],
    ]);
  });
  it('drops rows with an unknown media type and tolerates non-numeric metrics', () => {
    expect(rowToPost({ ...mediaRow('x'), media_type: 'VIDEO' })).toBeNull();
    expect(rowToPost(mediaRow('y', [{ reach: 'NaN', likes: Infinity }]))).toMatchObject({ reach: null, likes: null });
    expect(rowToPost({ ...mediaRow('z'), media_metrics: null })).toMatchObject({ reach: null });
  });
});

describe('loadOverviewInput', () => {
  it('hides archived accounts and loads daily + posts for each remaining account', async () => {
    const acc = (id: string, status: string) => ({ id, ig_user_id: id, username: id, status, connected_at: '2026-10-01T00:00:00Z' });
    const f = fakeDb({
      accounts: [{ data: [acc('a1', 'active'), acc('a2', 'archived'), acc('a3', 'needs_reconnect')] }],
      sync_state: [{ data: [{ account_id: 'a1', last_success_at: null, last_error_key: null, consecutive_failures: 0, daily_done_through: null }] }],
    });
    const out = await loadOverviewInput(f.db, '2026-07-17');
    expect(out.accounts.map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(Object.keys(out.daily)).toEqual(['a1', 'a3']);
    expect(Object.keys(out.posts)).toEqual(['a1', 'a3']);
    expect(out.sync.a1.dailyDoneThrough).toBeNull();
    expect(f.calls.filter((c) => c.table === 'account_daily')).toHaveLength(2);
    expect(f.calls.some((c) => c.table === 'account_tokens')).toBe(false);
  });
});
```

- [ ] **Step 2: Update the existing `listSyncStatus` expectation** — in `tests/sync-store.test.ts`, `describe('listSyncStatus')`, change

```ts
    expect(await listSyncStatus(r.db)).toEqual({ a1: { lastSuccessAt: NOW, lastErrorKey: null, consecutiveFailures: 0 } });
```
to
```ts
    expect(await listSyncStatus(r.db)).toEqual({ a1: { lastSuccessAt: NOW, lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: null } });
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/dashboard-read.test.ts tests/sync-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/dashboard/read"`, and the `listSyncStatus` test fails (no `dailyDoneThrough`).

- [ ] **Step 4: Extend `listSyncStatus`** — in `lib/sync/store.ts`:

```ts
export interface SyncStatus {
  lastSuccessAt: string | null;
  lastErrorKey: string | null;
  consecutiveFailures: number;
  dailyDoneThrough?: string | null; // null until the first-connect backfill has written a day (Overview: "backfilling")
}

/** Owner-session read for the Accounts page (RLS: owner select). Never throws: the page still renders without it. */
export async function listSyncStatus(db: SupabaseClient): Promise<Record<string, SyncStatus>> {
  const { data, error } = await db.from('sync_state').select('account_id,last_success_at,last_error_key,consecutive_failures,daily_done_through');
  if (error || !data) return {};
  return Object.fromEntries(
    (data as Row[]).map((r) => [r.account_id as string, { lastSuccessAt: (r.last_success_at as string | null) ?? null, lastErrorKey: (r.last_error_key as string | null) ?? null, consecutiveFailures: typeof r.consecutive_failures === 'number' ? r.consecutive_failures : 0, dailyDoneThrough: (r.daily_done_through as string | null) ?? null }]),
  );
}
```

(The field is optional, so `components/accounts/AccountsView.tsx` and its tests need no change.)

- [ ] **Step 5: Write `lib/dashboard/read.ts`:**

```ts
// Dashboard reads. Always the OWNER SESSION client (createServerSupabase): RLS lets the owner select, nothing else.
// Never the admin client here. Errors carry fixed messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { MediaKind } from '@/lib/instagram/parse';
import { listSyncStatus, type SyncStatus } from '@/lib/sync/store';

/** SPEC §7c: the backfill stops at 500 posts, so reads never need more per account (also under PostgREST's 1000-row cap). */
export const MEDIA_LIMIT = 500;
/** 2 × 90-day windows + today; keeps a daily read well under PostgREST's 1000-row cap. */
export const DAILY_LIMIT = 200;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MEDIA_KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

export function rowToDaily(r: Row): DailyRow {
  return {
    day: String(r.day),
    followers: num(r.followers),
    reach: num(r.reach),
    views: num(r.views),
    accountsEngaged: num(r.accounts_engaged),
    interactions: num(r.total_interactions),
    follows: num(r.follows),
    unfollows: num(r.unfollows),
    linkTaps: num(r.link_taps),
  };
}

/** A media row with its embedded latest media_metrics snapshot (array of 0 or 1). Unknown media types are dropped. */
export function rowToPost(r: Row): Post | null {
  if (!MEDIA_KINDS.includes(r.media_type as string)) return null;
  const m = (Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Row | undefined) : undefined) ?? {};
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    mediaType: r.media_type as MediaKind,
    postedAt: String(r.posted_at),
    permalink: typeof r.permalink === 'string' ? r.permalink : null,
    reach: num(m.reach),
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
    shares: num(m.shares),
    saves: num(m.saves),
    interactions: num(m.total_interactions),
  };
}

export async function loadDaily(db: SupabaseClient, accountId: string, fromDay: string): Promise<DailyRow[]> {
  const { data, error } = await db
    .from('account_daily')
    .select('day,followers,reach,views,accounts_engaged,total_interactions,follows,unfollows,link_taps')
    .eq('account_id', accountId)
    .gte('day', fromDay)
    .order('day', { ascending: true })
    .limit(DAILY_LIMIT);
  if (error) fail('daily');
  return ((data ?? []) as Row[]).map(rowToDaily);
}

/** Newest feed posts + reels (stories excluded) with ONLY their latest metrics snapshot (one row per post). */
export async function loadPosts(db: SupabaseClient, accountId: string, limit = MEDIA_LIMIT): Promise<Post[]> {
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,media_metrics(captured_at,reach,views,likes,comments,shares,saves,total_interactions)')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(Math.min(limit, MEDIA_LIMIT))
    .limit(1, { referencedTable: 'media_metrics' });
  if (error) fail('posts');
  return ((data ?? []) as Row[]).map(rowToPost).filter((p): p is Post => p !== null);
}

export interface OverviewInput {
  accounts: StoredAccount[]; // archived accounts are hidden from every view (SPEC §7c)
  sync: Record<string, SyncStatus>;
  daily: Record<string, DailyRow[]>;
  posts: Record<string, Post[]>;
}

/** Everything the Overview needs: 1 + 1 + 2 × accounts queries, run in parallel. */
export async function loadOverviewInput(db: SupabaseClient, fromDay: string): Promise<OverviewInput> {
  const [all, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
  const accounts = all.filter((a) => a.status !== 'archived');
  const per = await Promise.all(accounts.map((a) => Promise.all([loadDaily(db, a.id, fromDay), loadPosts(db, a.id)])));
  return {
    accounts,
    sync,
    daily: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][0]])),
    posts: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][1]])),
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/dashboard-read.test.ts tests/sync-store.test.ts tests/accounts-view.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/read.ts lib/sync/store.ts tests/dashboard-read.test.ts tests/sync-store.test.ts
git commit -m "feat: owner-session dashboard reads (daily rows, posts with latest metrics, overview input)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Overview model (sections, totals, comparison scopes, card states)

**Files:**
- Create: `lib/dashboard/overview.ts`
- Test: `tests/dashboard-overview.test.ts`

**Interfaces:**
- Consumes: `tokenStatus` (`lib/accounts/token-status.ts`); `summarize`, `combine`, `kpis` (Task 1); `takingOff`, `reachDrop`, `Flag` (Task 5); `OverviewInput` (Task 6); `PERIODS`, `Period` (Task 1); `addDays`.
- Produces: `parsePeriod(v: unknown): Period` (default 30); `fromDayFor(period, today): string`; `buildOverview(input, { period, today, now, tz, locale }): OverviewModel`; types `CardState = 'ok'|'backfilling'|'no_data'|'needs_reconnect'`, `AccountCard { id; username; displayName; groupName; status; state; lastSyncedAt; syncErrorKey; kpis; spark; flags }`, `Scope { id: 'all' | 'g:<name>'; group: string|null; accountIds }`, `OverviewModel { period; totals; totalsSpark; sections: { group; totals; cards }[]; scopes; days; series }`.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-overview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview, fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { addDays } from '@/lib/sync/time';

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const OPTS = { period: 7 as const, today: TODAY, now: NOW, tz: 'Asia/Kuala_Lumpur', locale: 'en' };
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

function input(o: Partial<OverviewInput> = {}): OverviewInput {
  return {
    accounts: [acct('zeta', { groupName: 'Brand X' }), acct('alpha', { groupName: 'Brand X' }), acct('solo'), acct('other', { groupName: 'Personal' })],
    sync: { zeta: synced, alpha: synced, solo: synced, other: synced },
    daily: { zeta: days(14, 100), alpha: days(14, 50), solo: days(14, 10), other: days(14, 1) },
    posts: {},
    ...o,
  };
}

describe('parsePeriod / fromDayFor', () => {
  it('accepts 7/30/90, defaults to 30', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod(['90'])).toBe(90);
    expect(parsePeriod('28')).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });
  it('reads two windows plus lag, at least 2 × 7 days', () => {
    expect(fromDayFor(30, TODAY)).toBe(addDays(TODAY, -62));
    expect(fromDayFor(7, TODAY)).toBe(addDays(TODAY, -16));
  });
});

describe('buildOverview', () => {
  it('groups A→Z with accounts A→Z inside, isolated accounts last and never combined', () => {
    const m = buildOverview(input(), OPTS);
    expect(m.sections.map((s) => s.group)).toEqual(['Brand X', 'Personal', null]);
    expect(m.sections[0].cards.map((c) => c.id)).toEqual(['alpha', 'zeta']);
    expect(m.sections[0].totals?.reach.value).toBe(1050);
    expect(m.sections[2].totals).toBeNull();
    expect(m.totals?.followers.value).toBe(4000);
  });

  it('comparison scopes: groups with 2+ accounts, then all accounts; series aligned with the window days', () => {
    const m = buildOverview(input(), OPTS);
    expect(m.scopes.map((s) => s.id)).toEqual(['g:Brand X', 'all']);
    expect(m.scopes[1].accountIds).toEqual(['alpha', 'zeta', 'other', 'solo']);
    expect(m.days).toHaveLength(7);
    expect(m.days[6]).toBe('2026-10-14');
    expect(m.series.zeta).toEqual(Array(7).fill(100));
  });

  it('card states: reconnect beats everything, never-synced is backfilling, synced-but-empty is no data', () => {
    const m = buildOverview(
      input({
        accounts: [acct('r', { status: 'needs_reconnect' }), acct('x', { tokenExpiresAt: '2026-10-01T00:00:00Z' }), acct('b'), acct('e'), acct('ok')],
        sync: { e: synced, ok: synced },
        daily: { r: days(14, 5), x: [], b: [], e: [], ok: days(3, 5) },
      }),
      OPTS,
    );
    const state = Object.fromEntries(m.sections.flatMap((s) => s.cards).map((c) => [c.id, c.state]));
    expect(state).toEqual({ r: 'needs_reconnect', x: 'needs_reconnect', b: 'backfilling', e: 'no_data', ok: 'ok' });
  });

  it('surfaces sync errors only while failing, and flags (taking off, reach drop)', () => {
    const posts: Post[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, accountId: 'solo', mediaType: 'IMAGE' as const, postedAt: addDays('2026-09-20', i) + 'T00:00:00Z', permalink: null, reach: 100, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null })),
      { id: 'hit', accountId: 'solo', mediaType: 'REELS', postedAt: '2026-10-13T00:00:00Z', permalink: null, reach: 500, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null },
    ];
    const drop = [...days(14, 100).slice(0, 7), ...days(7, 50)];
    const m = buildOverview(input({ accounts: [acct('solo')], sync: { solo: { ...synced, lastErrorKey: 'rate_limited', consecutiveFailures: 2 } }, daily: { solo: drop }, posts: { solo: posts } }), OPTS);
    const card = m.sections[0].cards[0];
    expect(card.syncErrorKey).toBe('rate_limited');
    expect(card.flags.map((f) => f.kind)).toEqual(['taking_off', 'reach_drop']);
    expect(m.scopes).toEqual([]); // one account: nothing to compare
  });

  it('no accounts: empty model, no NaN', () => {
    const m = buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, OPTS);
    expect(m).toMatchObject({ totals: null, sections: [], scopes: [], totalsSpark: [] });
    expect(m.days).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/dashboard-overview.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/dashboard/overview"`.

- [ ] **Step 3: Write `lib/dashboard/overview.ts`:**

```ts
// Shapes loadOverviewInput() into what the Overview page renders. Pure: today/now/tz are inputs.
import { tokenStatus } from '@/lib/accounts/token-status';
import type { AccountStatus } from '@/lib/accounts/types';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { combine, kpis, summarize, type Kpi, type KpiId, type Summary } from '@/lib/analysis/growth';
import { PERIODS, type Period } from '@/lib/analysis/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { addDays } from '@/lib/sync/time';

export type CardState = 'ok' | 'backfilling' | 'no_data' | 'needs_reconnect';

export interface AccountCard {
  id: string;
  username: string;
  displayName: string | null;
  groupName: string | null;
  status: AccountStatus;
  state: CardState;
  lastSyncedAt: string | null;
  syncErrorKey: string | null; // only while the account is failing (consecutive failures > 0)
  kpis: Record<KpiId, Kpi>;
  spark: (number | null)[]; // daily reach over the current window
  flags: Flag[];
}

export interface Scope {
  id: string; // 'all' or 'g:<group name>'
  group: string | null; // null = all accounts
  accountIds: string[];
}

export interface OverviewModel {
  period: Period;
  totals: Record<KpiId, Kpi> | null; // every non-archived account together; null when there are none
  totalsSpark: (number | null)[];
  sections: { group: string | null; totals: Record<KpiId, Kpi> | null; cards: AccountCard[] }[]; // named groups A→Z, isolated last
  scopes: Scope[]; // comparison scopes: groups with 2+ accounts, then all accounts (when 2+)
  days: string[]; // comparison x axis: the current window
  series: Record<string, (number | null)[]>; // daily reach per account id, aligned with days
}

/** ?period= from the URL; anything else falls back to 30 days (SPEC §7b default). */
export function parsePeriod(v: unknown): Period {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

/** First day to read: two windows plus Instagram's up-to-48 h lag. The reach-drop flag needs 2 × 7 days at least. */
export function fromDayFor(period: Period, today: string): string {
  return addDays(today, -(2 * Math.max(period, 7) + 2));
}

function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, doneThrough: string | null | undefined, s: Summary, hasRows: boolean): CardState {
  if (status === 'needs_reconnect' || tokenStatus(tokenExpiresAt, now).state === 'expired') return 'needs_reconnect';
  if (!doneThrough && !hasRows) return 'backfilling';
  return s.current.days === 0 && s.current.followers === null ? 'no_data' : 'ok';
}

export function buildOverview(input: OverviewInput, o: { period: Period; today: string; now: Date; tz: string; locale: string }): OverviewModel {
  const summaries = new Map<string, Summary>();
  const cards: AccountCard[] = input.accounts.map((a) => {
    const daily = input.daily[a.id] ?? [];
    const posts = input.posts[a.id] ?? [];
    const s = summarize(daily, posts, o.period, o.today, o.tz);
    summaries.set(a.id, s);
    const sync = input.sync[a.id];
    const drop = reachDrop(daily, o.today, o.tz);
    return {
      id: a.id,
      username: a.username,
      displayName: a.displayName,
      groupName: a.groupName,
      status: a.status,
      state: cardState(a.status, a.tokenExpiresAt, o.now, sync?.dailyDoneThrough, s, daily.length > 0),
      lastSyncedAt: sync?.lastSuccessAt ?? null,
      syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
      kpis: kpis(s),
      spark: s.reachByDay.map((d) => d.value),
      flags: [...takingOff(posts, o.now), ...(drop ? [drop] : [])],
    };
  });

  const byName = (x: AccountCard, y: AccountCard) => x.username.localeCompare(y.username, o.locale);
  const groups = [...new Set(cards.map((c) => c.groupName).filter((g): g is string => !!g))].sort((x, y) => x.localeCompare(y, o.locale));
  const totalsOf = (list: AccountCard[]) => {
    const c = combine(list.map((x) => summaries.get(x.id)!));
    return c ? kpis(c) : null;
  };
  const sections = [
    ...groups.map((g) => {
      const list = cards.filter((c) => c.groupName === g).sort(byName);
      return { group: g, totals: totalsOf(list), cards: list };
    }),
    ...(cards.some((c) => !c.groupName) ? [{ group: null, totals: null, cards: cards.filter((c) => !c.groupName).sort(byName) }] : []), // isolated: never combined
  ];

  const scopes: Scope[] = [
    ...sections.filter((s) => s.group !== null && s.cards.length >= 2).map((s) => ({ id: `g:${s.group}`, group: s.group, accountIds: s.cards.map((c) => c.id) })),
    ...(cards.length >= 2 ? [{ id: 'all', group: null, accountIds: sections.flatMap((s) => s.cards.map((c) => c.id)) }] : []),
  ];

  const all = combine([...summaries.values()]);
  const end = all?.endDay ?? addDays(o.today, -1);
  const days = Array.from({ length: o.period }, (_, i) => addDays(end, i - o.period + 1));
  const series = Object.fromEntries(
    [...summaries.entries()].map(([id, s]) => {
      const m = new Map(s.reachByDay.map((d) => [d.day, d.value]));
      return [id, days.map((d) => m.get(d) ?? null)];
    }),
  );

  return { period: o.period, totals: all ? kpis(all) : null, totalsSpark: all?.reachByDay.map((d) => d.value) ?? [], sections, scopes, days, series };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/dashboard-overview.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/overview.ts tests/dashboard-overview.test.ts
git commit -m "feat: overview model (groups, isolated accounts, totals, comparison scopes, card states)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Motion gate, StatCard, ChartCard, Sparkline

**Files:**
- Create: `lib/motion.ts`, `components/shared/StatCard.tsx`, `components/shared/ChartCard.tsx`, `components/charts/Sparkline.tsx`
- Test: `tests/motion.test.tsx`, `tests/stat-card.test.tsx`

**Interfaces:**
- Consumes: `Card`, `CardContent`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction` (`components/ui/card.tsx`); `cn`.
- Produces: `heavyMotionAllowed(env: MotionEnv): boolean`, `readMotionEnv(w: Window): MotionEnv`, `useHeavyMotion(): boolean` (false on server + hydration); `StatCard({ label, value, delta?, comparison, note?, spark?, className? })`, `DeltaPill({ delta, className? })`, type `StatDelta { text; direction; tone }`; `ChartCard({ title, subtitle?, actions?, summary?, table?, tableLabel?, children })`; `Sparkline({ data: (number|null)[], className?, height = 32 })`.

- [ ] **Step 1: Write the failing tests** — `tests/motion.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heavyMotionAllowed, readMotionEnv, useHeavyMotion } from '@/lib/motion';

const fakeWindow = (matches: Record<string, boolean>, saveData?: boolean) =>
  ({ matchMedia: (q: string) => ({ matches: !!matches[q] }), navigator: { connection: saveData === undefined ? undefined : { saveData } } }) as unknown as Window;

describe('motion gate', () => {
  it('allows heavy motion only with no reduced-motion, a fine pointer and no Save-Data', () => {
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: false, saveData: false })).toBe(true);
    expect(heavyMotionAllowed({ reducedMotion: true, coarsePointer: false, saveData: false })).toBe(false);
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: true, saveData: false })).toBe(false);
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: false, saveData: true })).toBe(false);
  });

  it('reads the environment from media queries and the Network Information API', () => {
    expect(readMotionEnv(fakeWindow({ '(prefers-reduced-motion: reduce)': true }))).toEqual({ reducedMotion: true, coarsePointer: false, saveData: false });
    expect(readMotionEnv(fakeWindow({ '(pointer: coarse)': true }, true))).toEqual({ reducedMotion: false, coarsePointer: true, saveData: true });
    expect(readMotionEnv({ navigator: {} } as unknown as Window)).toEqual({ reducedMotion: false, coarsePointer: false, saveData: false });
  });
});

describe('useHeavyMotion', () => {
  afterEach(() => vi.unstubAllGlobals());
  function Probe() {
    return <p>{useHeavyMotion() ? 'heavy' : 'light'}</p>;
  }
  it('follows the live environment in the browser', () => {
    const mm = (reduce: boolean) => (q: string) => ({ matches: q.includes('reduce') && reduce, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('matchMedia', mm(true));
    const { unmount } = render(<Probe />);
    expect(screen.getByText('light')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('matchMedia', mm(false));
    render(<Probe />);
    expect(screen.getByText('heavy')).toBeInTheDocument();
  });
});
```

and `tests/stat-card.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '@/components/charts/Sparkline';
import { ChartCard } from '@/components/shared/ChartCard';
import { DeltaPill, StatCard } from '@/components/shared/StatCard';

describe('StatCard', () => {
  it('shows label, value, the delta and its comparison', () => {
    render(<StatCard label="Reach" value="12.3K" delta={{ text: '+12.5%', direction: 'up', tone: 'good' }} comparison="vs previous 30 days" note="unused" />);
    expect(screen.getByText('Reach')).toBeInTheDocument();
    expect(screen.getByText('12.3K')).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByText('vs previous 30 days')).toBeInTheDocument();
    expect(screen.queryByText('unused')).toBeNull();
  });

  it('without a delta it states why (numbers always come with a comparison or a reason)', () => {
    render(<StatCard label="Reach" value="—" comparison="vs previous 30 days" note="Not enough history to compare yet" />);
    expect(screen.getByText('Not enough history to compare yet')).toBeInTheDocument();
    expect(screen.queryByText('vs previous 30 days')).toBeNull();
  });

  it('a very long label or value truncates instead of widening the card', () => {
    const long = 'x'.repeat(300);
    render(<StatCard label={long} value={long} comparison="c" />);
    for (const el of screen.getAllByText(long)) expect(el.className).toContain('truncate');
  });
});

describe('DeltaPill', () => {
  it('bad tone uses the destructive token, never a raw colour', () => {
    render(<DeltaPill delta={{ text: '-20.0%', direction: 'down', tone: 'bad' }} />);
    const pill = screen.getByText('-20.0%');
    expect(pill.className).toContain('text-destructive');
    expect(pill.className).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
});

describe('Sparkline', () => {
  it('draws one polyline per run of data and breaks at gaps', () => {
    const { container } = render(<Sparkline data={[1, 2, null, 3, 4]} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('renders nothing with fewer than two points or a flat/empty series without NaN', () => {
    expect(render(<Sparkline data={[null, 5]} />).container.innerHTML).toBe('');
    const { container } = render(<Sparkline data={[0, 0, 0]} />);
    expect(container.querySelector('polyline')?.getAttribute('points')).not.toContain('NaN');
  });
});

describe('ChartCard', () => {
  it('title as a heading, summary for screen readers, table fallback collapsed', () => {
    render(
      <ChartCard title="Reach by account" summary="Daily reach for 2 accounts" table={<table aria-label="data" />} tableLabel="Show as table">
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.getByRole('heading', { name: 'Reach by account' })).toBeInTheDocument();
    expect(screen.getByText('Daily reach for 2 accounts')).toHaveClass('sr-only');
    expect(screen.getByText('Show as table').closest('details')).not.toHaveAttribute('open');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/motion.test.tsx tests/stat-card.test.tsx`
Expected: FAIL — `Failed to resolve import "@/lib/motion"` / `"@/components/charts/Sparkline"`.

- [ ] **Step 3: Write `lib/motion.ts`:**

```ts
'use client';

// The shared motion gate (SPEC §8b.5). Heavy effects (particles, canvas, globe, GSAP timelines; part 2) render only when
// heavyMotionAllowed() is true. Light motion (CSS transitions, Recharts' own entry animation) needs no gate: CSS uses
// `motion-safe:` and Recharts' isAnimationActive="auto" already honours prefers-reduced-motion.
// matchMedia here is about motion, never layout (layout uses CSS breakpoints only).
import { useSyncExternalStore } from 'react';

export interface MotionEnv {
  reducedMotion: boolean;
  coarsePointer: boolean; // phones/tablets: the "off on phones" rule
  saveData: boolean;
}

export const heavyMotionAllowed = (e: MotionEnv) => !e.reducedMotion && !e.coarsePointer && !e.saveData;

const QUERIES = ['(prefers-reduced-motion: reduce)', '(pointer: coarse)'] as const;
type NetInfo = EventTarget & { saveData?: boolean };
const connection = (w: Window) => (w.navigator as Navigator & { connection?: NetInfo }).connection;

export function readMotionEnv(w: Window): MotionEnv {
  const mq = (q: string) => (typeof w.matchMedia === 'function' ? w.matchMedia(q).matches : false);
  return { reducedMotion: mq(QUERIES[0]), coarsePointer: mq(QUERIES[1]), saveData: connection(w)?.saveData === true };
}

function subscribe(onChange: () => void): () => void {
  const lists = typeof window.matchMedia === 'function' ? QUERIES.map((q) => window.matchMedia(q)) : [];
  lists.forEach((l) => l.addEventListener('change', onChange));
  connection(window)?.addEventListener('change', onChange);
  return () => {
    lists.forEach((l) => l.removeEventListener('change', onChange));
    connection(window)?.removeEventListener('change', onChange);
  };
}

/** False on the server and during hydration (no flash of a heavy effect), then the live answer. */
export function useHeavyMotion(): boolean {
  return useSyncExternalStore(subscribe, () => heavyMotionAllowed(readMotionEnv(window)), () => false);
}
```

- [ ] **Step 4: Write `components/charts/Sparkline.tsx`:**

```tsx
import { cn } from '@/lib/utils';

/**
 * Tiny trend line for stat cards (plain SVG: 24+ of these on a page would be heavy as Recharts charts).
 * Decorative: the card states the number and its comparison in text. Colour = currentColor, set with a token class
 * such as `text-chart-1` or `text-destructive`. Gaps (null days) break the line instead of drawing a fake zero.
 */
export function Sparkline({ data, className, height = 32 }: { data: (number | null)[]; className?: string; height?: number }) {
  const vals = data.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * 100;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const segments: string[] = [];
  let cur: string[] = [];
  data.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) cur.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
    else if (cur.length) {
      segments.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) segments.push(cur.join(' '));
  return (
    <svg data-slot="sparkline" aria-hidden="true" focusable="false" className={cn('block w-full text-chart-1', className)} height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {segments.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
```

- [ ] **Step 5: Write `components/shared/StatCard.tsx`:**

```tsx
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatDelta {
  text: string; // already formatted and signed, e.g. "+12.5%" or "+0.4 pp"
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
}

const TONE = {
  good: 'bg-success/10 text-success',
  bad: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
} as const;
const ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** Signed change with an arrow; colour follows good/bad (not up/down), and the sign is always in the text. */
export function DeltaPill({ delta, className }: { delta: StatDelta; className?: string }) {
  const Icon = ICON[delta.direction];
  return (
    <span data-tone={delta.tone} className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-xs font-medium tabular-nums whitespace-nowrap', TONE[delta.tone], className)}>
      <Icon aria-hidden="true" className="size-3" />
      {delta.text}
    </span>
  );
}

/**
 * A KPI tile: label, value, and ALWAYS a comparison line (SPEC §7b): the delta + "vs previous N days", or the reason
 * the comparison is missing (`note`).
 */
export function StatCard({ label, value, delta, comparison, note, spark, className }: { label: string; value: string; delta?: StatDelta | null; comparison: string; note?: string; spark?: ReactNode; className?: string }) {
  return (
    <Card className={cn('min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1', className)}>
      <CardContent className="grid min-w-0 gap-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-[length:var(--fv)] font-semibold leading-tight tabular-nums">{value}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {delta ? <DeltaPill delta={delta} /> : null}
          <span className="min-w-0 text-muted-foreground">{delta ? comparison : (note ?? comparison)}</span>
        </div>
        {spark ? <div className="mt-1">{spark}</div> : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Write `components/shared/ChartCard.tsx`:**

```tsx
import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Frame for a chart: title, optional subtitle and actions, a screen-reader summary, and an optional data table
 * fallback (collapsed) so every chart's numbers are reachable without the graphic.
 */
export function ChartCard({ title, subtitle, actions, summary, table, tableLabel, children }: { title: string; subtitle?: string; actions?: ReactNode; summary?: string; table?: ReactNode; tableLabel?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-[length:var(--fh)] font-medium">
          <h2>{title}</h2>
        </CardTitle>
        {subtitle ? <CardDescription className="text-xs">{subtitle}</CardDescription> : null}
        {actions ? <CardAction className="max-w-full">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className="min-w-0">
        <figure className="m-0 min-w-0">
          {children}
          {summary ? <figcaption className="sr-only">{summary}</figcaption> : null}
        </figure>
        {table ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">{tableLabel}</summary>
            <div className="mt-2">{table}</div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/motion.test.tsx tests/stat-card.test.tsx tests/css-vars-defined.test.ts`
Expected: PASS (`css-vars-defined` now also scans `StatCard.tsx`/`ChartCard.tsx`; they use no undefined variables).

- [ ] **Step 8: Commit**

```bash
git add lib/motion.ts components/shared/StatCard.tsx components/shared/ChartCard.tsx components/charts/Sparkline.tsx tests/motion.test.tsx tests/stat-card.test.tsx
git commit -m "feat: StatCard, ChartCard, Sparkline and the shared heavy-motion gate" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Recharts wrappers (line / area / bar) and the heatmap grid

**Files:**
- Modify: `package.json`, `package-lock.json` (npm), `vitest.config.ts` (test timeout)
- Create: `components/charts/SeriesChart.tsx`, `components/charts/Heatmap.tsx`
- Test: `tests/charts.test.tsx`

**Interfaces:**
- Consumes: `recharts@3` (`LineChart`, `AreaChart`, `BarChart`, `Line`, `Area`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`); `cn`.
- Produces: `SeriesChart({ kind: 'line'|'area'|'bar', data: ChartRow[], xKey, series: Series[], title, desc?, height = 220, formatX?, formatY? })`, `seriesColor(i): string` (`var(--chart-1..6)`), types `Series { key; label }`, `ChartRow`; `Heatmap({ caption, columns: string[], rows: { label; cells: HeatmapCell[] }[], lowLabel, highLabel })`, type `HeatmapCell { value; lowSample; label }`.

- [ ] **Step 1: Install the dependencies**

```bash
npm install recharts@^3.10.1
npm install --save-exact react-is@19.3.0
npm ls react-is
```
Expected: `package.json` gains `"recharts": "^3.10.1"` and `"react-is": "19.3.0"`; `npm ls react-is` shows `recharts@3.10.1 └── react-is@19.3.0 deduped`. Check `git diff --stat` touches only `package.json` and `package-lock.json`.

- [ ] **Step 2: Write the failing test** — `tests/charts.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heatmap, type HeatmapCell } from '@/components/charts/Heatmap';
import { SeriesChart, seriesColor } from '@/components/charts/SeriesChart';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const rows = Array.from({ length: 90 }, (_, i) => ({ day: `d${i}`, a: i % 7 === 0 ? null : i * 10, b: 5 }));

describe('SeriesChart', () => {
  it.each(['line', 'area', 'bar'] as const)('%s: renders a legend for every series without crashing (90 days, gaps)', (kind) => {
    const { container } = render(<SeriesChart kind={kind} data={rows} xKey="day" series={[{ key: 'a', label: '@brand.official' }, { key: 'b', label: '@studio' }]} title="Reach" />);
    expect(screen.getByText('@brand.official')).toBeInTheDocument();
    expect(screen.getByText('@studio')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i); // tokens only
  });

  it('colours cycle through the six chart tokens', () => {
    expect([0, 5, 6].map(seriesColor)).toEqual(['var(--chart-1)', 'var(--chart-6)', 'var(--chart-1)']);
  });

  it('a very long account name truncates in the legend', () => {
    render(<SeriesChart kind="line" data={rows} xKey="day" series={[{ key: 'a', label: 'a'.repeat(200) }]} title="Reach" />);
    expect(screen.getByText('a'.repeat(200)).className).toContain('truncate');
  });
});

describe('Heatmap', () => {
  const cells = (f: (h: number) => Partial<HeatmapCell>): HeatmapCell[] => Array.from({ length: 24 }, (_, h) => ({ value: null, lowSample: false, label: `h${h}`, ...f(h) }));
  const hours = Array.from({ length: 24 }, (_, h) => `${h}:00`);

  it('is a table with a caption, row headers and screen-reader text per cell', () => {
    render(<Heatmap caption="Best time to post" columns={hours} rows={[{ label: 'Mon', cells: cells((h) => ({ value: h, label: `Mon ${h}:00 · ${h}` })) }]} lowLabel="Low" highLabel="High" />);
    const table = screen.getByRole('table', { name: 'Best time to post' });
    expect(within(table).getByRole('rowheader', { name: 'Mon' })).toBeInTheDocument();
    expect(within(table).getByText('Mon 23:00 · 23')).toHaveClass('sr-only');
    expect(table.innerHTML).toContain('var(--primary) 94%');
  });

  it('low-sample cells are greyed and do not set the scale; all-empty grid has no NaN', () => {
    const { container } = render(<Heatmap caption="c" columns={hours} rows={[{ label: 'Tue', cells: cells((h) => (h === 1 ? { value: 1000, lowSample: true } : h === 2 ? { value: 10 } : {})) }]} lowLabel="Low" highLabel="High" />);
    expect(container.querySelectorAll('[data-low]')).toHaveLength(1);
    expect(container.innerHTML).toContain('var(--primary) 94%'); // the 10 is the max, the low-sample 1000 is ignored
    const empty = render(<Heatmap caption="e" columns={hours} rows={[{ label: 'Wed', cells: cells(() => ({})) }]} lowLabel="Low" highLabel="High" />);
    expect(empty.container.innerHTML).not.toContain('NaN');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run tests/charts.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/charts/Heatmap"`.

- [ ] **Step 4: Write `components/charts/SeriesChart.tsx`:**

```tsx
'use client';

// Line / area / bar chart over a shared x axis, styled like docs/mockups/charts.js: --chart-1…6 colours, 2px lines,
// dashed horizontal grid, token-styled tooltip. Recharts 3 API (installed major): `responsive` sizes the chart from CSS,
// isAnimationActive="auto" (the default) skips the entry animation under prefers-reduced-motion.
import { useId } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

export interface Series {
  key: string; // property name in each data row
  label: string; // legend + tooltip name (already translated)
}

export type ChartRow = Record<string, string | number | null>;

export const seriesColor = (i: number) => `var(--chart-${(i % 6) + 1})`;

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 10 };
const TOOLTIP_STYLE = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', boxShadow: 'var(--shadow)', fontSize: 'var(--lb)', color: 'var(--foreground)' };

export function SeriesChart({
  kind,
  data,
  xKey,
  series,
  title,
  desc,
  height = 220,
  formatX = String,
  formatY = String,
}: {
  kind: 'line' | 'area' | 'bar';
  data: ChartRow[];
  xKey: string;
  series: Series[];
  title: string;
  desc?: string;
  height?: number;
  formatX?: (v: string) => string;
  formatY?: (v: number) => string;
}) {
  const gid = useId().replace(/:/g, '');
  const common = { data, responsive: true, style: { width: '100%', height }, title, desc, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const parts = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--border)" strokeDasharray="3 4" />,
    <XAxis key="x" dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatX(String(v))} minTickGap={24} />,
    <YAxis key="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatY(Number(v))} />,
    <Tooltip key="tip" contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 500 }} labelFormatter={(v) => formatX(String(v))} formatter={(v) => (typeof v === 'number' ? formatY(v) : String(v ?? ''))} />,
  ];

  return (
    <div data-slot="series-chart" className="min-w-0">
      <ul className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
            <span className="max-w-48 truncate">{s.label}</span>
          </li>
        ))}
      </ul>
      {kind === 'line' ? (
        <LineChart {...common}>
          {parts}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={seriesColor(i)} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} />
          ))}
        </LineChart>
      ) : kind === 'area' ? (
        <AreaChart {...common}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={seriesColor(i)} stopOpacity={0.3} />
                <stop offset="1" stopColor={seriesColor(i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {parts}
          {series.map((s, i) => (
            <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={seriesColor(i)} strokeWidth={2} fill={`url(#${gid}-${i})`} connectNulls={false} />
          ))}
        </AreaChart>
      ) : (
        <BarChart {...common}>
          {parts}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(i)} radius={[4, 4, 0, 0]} maxBarSize={30} />
          ))}
        </BarChart>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `components/charts/Heatmap.tsx`:**

```tsx
import { cn } from '@/lib/utils';

export interface HeatmapCell {
  value: number | null;
  lowSample: boolean; // greyed out: too few posts behind it
  label: string; // full text for screen readers and the native tooltip, e.g. "Wed 20:00 · 4.2% · 3 posts"
}

/**
 * Weekday × hour grid drawn as a real <table> (screen readers get rows/columns for free; no separate fallback).
 * Intensity = color-mix of --primary into --surface (tokens only, like docs/mockups/charts.js heat()).
 * At 360px the 24 columns shrink to ~11px squares; hour labels show every 3 hours.
 */
export function Heatmap({ caption, columns, rows, lowLabel, highLabel }: { caption: string; columns: string[]; rows: { label: string; cells: HeatmapCell[] }[]; lowLabel: string; highLabel: string }) {
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.filter((c) => !c.lowSample && c.value !== null).map((c) => c.value as number)));
  const shade = (c: HeatmapCell) => (c.value === null || c.lowSample || max <= 0 ? undefined : `color-mix(in srgb, var(--primary) ${Math.round(6 + (c.value / max) * 88)}%, var(--surface))`);
  return (
    <div data-slot="heatmap" className="min-w-0">
      <table className="w-full table-fixed border-separate border-spacing-0.5 text-[10px] text-muted-foreground">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-7" />
            {columns.map((c, i) => (
              <th key={c} scope="col" className="p-0 text-center font-normal">
                <span className={i % 3 === 0 ? undefined : 'sr-only'}>{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="pr-1 text-left font-normal">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} className="p-0" title={c.label}>
                  <span
                    aria-hidden="true"
                    data-low={c.lowSample || undefined}
                    className={cn('block aspect-square max-h-[22px] w-full rounded-[calc(var(--rs)*0.4)]', shade(c) ? undefined : 'bg-muted', c.lowSample && 'opacity-50')}
                    style={shade(c) ? { background: shade(c) } : undefined}
                  />
                  <span className="sr-only">{c.label}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden="true" className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {lowLabel}
        <span className="h-1.5 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 6%, var(--surface)), var(--primary))' }} />
        {highLabel}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Raise the per-test timeout** — Recharts renders in jsdom take seconds on a busy machine; with the full suite running in parallel the 5 s default flaked during plan verification (the chart tests and even `tests/admin-guard.test.ts` timed out). In `vitest.config.ts`, inside `test: { … }`, add after the `include` line:

```ts
    testTimeout: 20_000, // Recharts renders in jsdom are slow on a busy machine; the 5 s default flaked
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run tests/charts.test.tsx`
Expected: PASS (7 tests). (If Vitest reports "Timeout waiting for worker to respond", re-run — that is a worker start-up timeout, not a test failure.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts components/charts/SeriesChart.tsx components/charts/Heatmap.tsx tests/charts.test.tsx
git commit -m "feat: Recharts 3 line/area/bar wrapper and token-coloured heatmap table" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: DataTable (sortable, phone card mode, empty/loading)

**Files:**
- Create: `components/shared/DataTable.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/data-table.test.tsx`

**Interfaces:**
- Consumes: `Table*` (`components/ui/table.tsx`), `Skeleton`, next-intl `useTranslations('table')`.
- Produces: `DataTable<T>({ rows, columns: Column<T>[], rowKey, caption, empty?, loading?, initialSort? })`; `Column<T> { key; header; cell(row); sortValue?(row): number|string|null; align? }`; `sortRows(rows, columns, sort)` (nulls last, stable). The first column is the card title on phones.

- [ ] **Step 1: Write the failing test** — `tests/data-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { DataTable, sortRows, type Column } from '@/components/shared/DataTable';

type R = { name: string; reach: number | null };
const rows: R[] = [
  { name: 'beta', reach: 50 },
  { name: 'alpha', reach: null },
  { name: 'gamma', reach: 900 },
];
const columns: Column<R>[] = [
  { key: 'name', header: 'Account', cell: (r) => `@${r.name}`, sortValue: (r) => r.name },
  { key: 'reach', header: 'Reach', cell: (r) => String(r.reach ?? '—'), sortValue: (r) => r.reach, align: 'right' },
];

function setup(props: Partial<React.ComponentProps<typeof DataTable<R>>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.name} caption="Accounts compared" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('sortRows', () => {
  it('sorts numbers and strings both ways; nulls always last; stable for ties', () => {
    expect(sortRows(rows, columns, { key: 'reach', dir: 'desc' }).map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortRows(rows, columns, { key: 'reach', dir: 'asc' }).map((r) => r.name)).toEqual(['beta', 'gamma', 'alpha']);
    expect(sortRows(rows, columns, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortRows(rows, columns, null)).toBe(rows);
    const ties = [{ name: 'x', reach: 1 }, { name: 'y', reach: 1 }];
    expect(sortRows(ties, columns, { key: 'reach', dir: 'desc' }).map((r) => r.name)).toEqual(['x', 'y']);
  });
});

describe('DataTable', () => {
  it('renders a table (md+) and a card list (phones) from the same rows', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Accounts compared' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const list = screen.getByRole('list', { name: 'Accounts compared' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(table.closest('.hidden.md\\:block')).not.toBeNull();
    expect(list.closest('.md\\:hidden')).not.toBeNull();
  });

  it('clicking a header sorts (descending first) and announces it with aria-sort', async () => {
    setup();
    const table = screen.getByRole('table');
    await userEvent.click(within(table).getByRole('button', { name: /Reach/ }));
    expect(within(table).getByRole('columnheader', { name: /Reach/ })).toHaveAttribute('aria-sort', 'descending');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('@gamma');
    await userEvent.click(within(table).getByRole('button', { name: /Reach/ }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('@beta');
  });

  it('phones sort with a native select', async () => {
    setup();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: en.table.sortBy }), 'reach');
    expect(within(screen.getByRole('list')).getAllByRole('listitem')[0]).toHaveTextContent('@gamma');
  });

  it('empty and loading states', () => {
    const { unmount } = setup({ rows: [] });
    expect(screen.getByText(en.table.empty)).toBeInTheDocument();
    unmount();
    setup({ loading: true });
    expect(screen.queryByText('@beta')).toBeNull();
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/data-table.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/shared/DataTable"`.

- [ ] **Step 3: Add the i18n keys.**

`messages/en.json`:
```json
"table": {
  "empty": "Nothing to show yet",
  "sortBy": "Sort by",
  "defaultOrder": "Default order"
}
```
`messages/zh-CN.json`:
```json
"table": {
  "empty": "暂无内容",
  "sortBy": "排序方式",
  "defaultOrder": "默认顺序"
}
```

- [ ] **Step 4: Write `components/shared/DataTable.tsx`:**

```tsx
'use client';

// Sortable table on md+, card list on phones (CSS breakpoints only, both rendered; never matchMedia).
// ponytail: client-side sort of already-loaded rows; TanStack Table (SPEC §2) comes in with the part-2 Posts table
// when it needs pagination / column visibility.
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string | null; // sortable when set; nulls always sort last
  align?: 'left' | 'right';
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: Sort): T[] {
  const col = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !col?.sortValue) return rows;
  const get = col.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      if (a.v === b.v) return a.i - b.i; // stable
      return (typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v))) * sign;
    })
    .map((x) => x.row);
}

export function DataTable<T>({ rows, columns, rowKey, caption, empty, loading = false, initialSort = null }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; caption: string; empty?: ReactNode; loading?: boolean; initialSort?: Sort }) {
  const t = useTranslations('table');
  const [sort, setSort] = useState<Sort>(initialSort);
  const sorted = sortRows(rows, columns, sort);
  const [first, ...rest] = columns;
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  const sortable = columns.filter((c) => c.sortValue);

  if (!loading && rows.length === 0) return <div className="py-6 text-center text-sm text-muted-foreground">{empty ?? t('empty')}</div>;

  return (
    <div data-slot="data-table" className="min-w-0">
      <div className="hidden md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <TableHead key={c.key} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(c.align === 'right' && 'text-right')}>
                    {c.sortValue ? (
                      <button type="button" onClick={() => toggle(c.key)} className={cn('inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', active ? 'text-foreground' : 'text-muted-foreground')}>
                        {c.header}
                        <Icon aria-hidden="true" className={cn('size-3', !active && 'opacity-50')} />
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">{c.header}</span>
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? [0, 1, 2].map((i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}>
                      <Skeleton className="h-3.5 w-3/4" />
                    </TableCell>
                  </TableRow>
                ))
              : sorted.map((r) => (
                  <TableRow key={rowKey(r)}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn('max-w-64 truncate', c.align === 'right' && 'text-right tabular-nums')}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-[var(--gp)] md:hidden">
        {sortable.length > 0 ? (
          <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            {t('sortBy')}
            <select
              className="h-[var(--ctl-sm)] rounded-md border border-input bg-background px-2 text-xs text-foreground"
              value={sort?.key ?? ''}
              onChange={(e) => setSort(e.target.value ? { key: e.target.value, dir: 'desc' } : null)}
            >
              <option value="">{t('defaultOrder')}</option>
              {sortable.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.header}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ul className="grid gap-[var(--gp)]" aria-label={caption}>
          {loading
            ? [0, 1, 2].map((i) => (
                <li key={i} className="rounded-lg border bg-card p-[var(--pc)]">
                  <Skeleton className="h-3.5 w-2/3" />
                </li>
              ))
            : sorted.map((r) => (
                <li key={rowKey(r)} className="min-w-0 rounded-lg border bg-card p-[var(--pc)]">
                  <div className="min-w-0 truncate font-medium">{first.cell(r)}</div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {rest.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <dt className="truncate text-muted-foreground">{c.header}</dt>
                        <dd className="truncate font-medium tabular-nums">{c.cell(r)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/data-table.test.tsx tests/messages.test.ts tests/css-vars-defined.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/shared/DataTable.tsx messages/en.json messages/zh-CN.json tests/data-table.test.tsx
git commit -m "feat: DataTable with sorting, phone card mode, empty and loading states" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Overview page

**Files:**
- Create: `components/overview/OverviewView.tsx`, `app/(app)/overview/loading.tsx`
- Replace: `app/(app)/overview/page.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (`pages.overview`)
- Test: `tests/overview-view.test.tsx`

**Interfaces:**
- Consumes: `requireOwner` (`lib/auth/require-owner.ts`), `getPrefs` (`lib/prefs.server.ts`), `createServerSupabase` (`lib/supabase/server.ts`), `localDay`; `parsePeriod`, `fromDayFor`, `buildOverview`, `OverviewModel`, `AccountCard` (Task 7); `loadOverviewInput` (Task 6); `deltaView`, `formatMetric` (Task 2); `StatCard`, `DeltaPill`, `ChartCard`, `Sparkline` (Task 8); `SeriesChart` (Task 9); `DataTable` (Task 10); `EmptyState`, `PageHeader`, `usePrefs`; i18n `accounts.errors.*` (existing sync error keys).
- Produces: `OverviewView({ model: OverviewModel })`; the `/overview?period=7|30|90` page.

- [ ] **Step 1: Write the failing test** — `tests/overview-view.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number, followers = 1000): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
const LONG = 'a_really_long_instagram_handle_that_goes_on_and_on_forever';
const hit: Post = { id: 'hit', accountId: 'brand.one', mediaType: 'REELS', postedAt: '2026-10-13T00:00:00Z', permalink: 'https://www.instagram.com/reel/hit/', reach: 900, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null };
const history: Post[] = Array.from({ length: 6 }, (_, i) => ({ ...hit, id: `h${i}`, mediaType: 'IMAGE', postedAt: `${addDays('2026-09-20', i)}T00:00:00Z`, reach: 100 }));

const input: OverviewInput = {
  accounts: [acct('brand.one', { groupName: 'Brand X' }), acct('brand.two', { groupName: 'Brand X' }), acct(LONG), acct('broken', { status: 'needs_reconnect' }), acct('fresh')],
  sync: { 'brand.one': synced, 'brand.two': synced, [LONG]: synced, broken: { ...synced, lastErrorKey: 'token_invalid', consecutiveFailures: 3 } },
  daily: { 'brand.one': days(14, 100), 'brand.two': days(14, 0, 0), [LONG]: days(3, 5), broken: days(14, 10), fresh: [] },
  posts: { 'brand.one': [...history, hit] },
};

function view(model = buildOverview(input, { period: 7, today: TODAY, now: NOW, tz: 'Asia/Kuala_Lumpur', locale: 'en' }), locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <OverviewView model={model} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('OverviewView', () => {
  it('no accounts: empty state linking to /accounts, period selector still there', () => {
    view(buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, { period: 30, today: TODAY, now: NOW, tz: 'UTC', locale: 'en' }));
    expect(screen.getByRole('status')).toHaveTextContent(en.pages.overview.empty);
    expect(screen.getByRole('link', { name: en.pages.overview.addAccount })).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page');
  });

  it('totals with comparisons, group sections then isolated accounts', () => {
    view();
    const totals = screen.getByRole('region', { name: en.pages.overview.allAccounts });
    expect(within(totals).getByText(en.metrics.reach)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([expect.stringContaining('Brand X'), expect.stringContaining(en.pages.overview.isolated)]);
  });

  it('card states: reconnect badge + link, backfilling note, sync error, taking-off flag linking to the post', () => {
    view();
    const broken = screen.getByRole('heading', { name: '@broken' }).closest('li')!;
    expect(within(broken).getByText(en.pages.overview.needsReconnect)).toBeInTheDocument();
    expect(within(broken).getByRole('link', { name: en.pages.overview.reconnectHint })).toHaveAttribute('href', '/accounts');
    expect(within(broken).getByText(new RegExp(en.accounts.errors.token_invalid.slice(0, 20)))).toBeInTheDocument();
    const fresh = screen.getByRole('heading', { name: '@fresh' }).closest('li')!;
    expect(within(fresh).getByText(en.analysis.reasons.backfilling)).toBeInTheDocument();
    expect(within(fresh).getByText(en.pages.overview.neverSynced)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Post taking off: 9× median reach/ })).toHaveAttribute('href', hit.permalink);
  });

  it('comparison: scoped to the group first, widen to all accounts', async () => {
    view();
    const group = screen.getByRole('group', { name: en.pages.overview.scope });
    expect(within(group).getByRole('button', { name: 'Brand X' })).toHaveAttribute('aria-pressed', 'true');
    const table = () => screen.getByRole('table', { name: en.pages.overview.compareTitle });
    expect(within(table()).getAllByRole('row')).toHaveLength(3);
    await userEvent.click(within(group).getByRole('button', { name: en.pages.overview.allAccounts }));
    expect(within(table()).getAllByRole('row')).toHaveLength(6);
  });

  it('zero followers, missing data and very long names render without NaN/Infinity and truncate', () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByRole('heading', { name: `@${LONG}` }).className).toContain('truncate');
  });

  it('renders in Simplified Chinese', () => {
    view(undefined, 'zh-CN');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('总览');
    expect(screen.getByRole('link', { name: '7 天' })).toBeInTheDocument();
    expect(screen.getAllByText('对比前 7 天').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/overview-view.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/overview/OverviewView"`.

- [ ] **Step 3: Add the i18n keys** inside the existing `pages.overview` object (keep `title`, `empty`, `emptyHint`, `addAccount` as they are).

`messages/en.json` → `pages.overview`:
```json
"subtitle": "Your accounts at a glance",
"period": "Period",
"periodOption": "{days} days",
"vsPrevious": "vs previous {days} days",
"allAccounts": "All accounts",
"isolated": "Isolated accounts",
"needsReconnect": "Needs reconnect",
"reconnectHint": "Reconnect on the Accounts page",
"lastSynced": "Synced {time}",
"neverSynced": "Not synced yet",
"takingOff": "Post taking off: {ratio}× median reach",
"reachDrop": "Reach {change} vs previous 7 days",
"compareTitle": "Reach by account",
"compareHint": "Scoped to a group by default — widen to compare everything",
"scope": "Comparison scope",
"chartSummary": "Daily reach of {count} accounts over the last {days} days. The table below lists the same accounts.",
"account": "Account",
"points": "{value} pp"
```

`messages/zh-CN.json` → `pages.overview`:
```json
"subtitle": "一眼看清所有账号",
"period": "时间范围",
"periodOption": "{days} 天",
"vsPrevious": "对比前 {days} 天",
"allAccounts": "全部账号",
"isolated": "独立账号",
"needsReconnect": "需要重新连接",
"reconnectHint": "前往账号页面重新连接",
"lastSynced": "同步于 {time}",
"neverSynced": "尚未同步",
"takingOff": "帖子表现突出：触达达到中位数的 {ratio} 倍",
"reachDrop": "触达较前 7 天 {change}",
"compareTitle": "各账号触达",
"compareHint": "默认按分组对比，可扩大到全部账号",
"scope": "对比范围",
"chartSummary": "{count} 个账号近 {days} 天的每日触达。下方表格列出相同账号。",
"account": "账号",
"points": "{value} 个百分点"
```

- [ ] **Step 4: Write `components/overview/OverviewView.tsx`:**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CircleUserRound, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { DeltaPill, StatCard, type StatDelta } from '@/components/shared/StatCard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { PERIODS, type Period } from '@/lib/analysis/types';
import type { AccountCard, OverviewModel } from '@/lib/dashboard/overview';
import { formatCompact, formatDateTime, formatDay, formatDelta, formatNumber } from '@/lib/format';
import { deltaView, formatMetric } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/** KPI → what StatCard/DeltaPill show; percentage points get their translated unit. */
function useDelta() {
  const t = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  return (id: KpiId, k: Kpi | undefined): StatDelta | null => {
    const d = k ? deltaView(id, k, prefs) : null;
    return d && { ...d, text: d.unit === 'points' ? t('points', { value: d.text }) : d.text };
  };
}

function PeriodSelect({ period }: { period: Period }) {
  const t = useTranslations('pages.overview');
  return (
    <nav aria-label={t('period')} className="inline-flex rounded-md border bg-card p-0.5">
      {PERIODS.map((p) => (
        <Button key={p} asChild size="sm" variant={p === period ? 'secondary' : 'ghost'}>
          <Link href={`?period=${p}`} aria-current={p === period ? 'page' : undefined} scroll={false}>
            {t('periodOption', { days: p })}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

function MiniStat({ id, k }: { id: KpiId; k: Kpi }) {
  const tm = useTranslations('metrics');
  const { prefs } = usePrefs();
  const delta = useDelta()(id, k);
  return (
    <div className="min-w-0">
      <span className="block truncate text-[10px] text-muted-foreground">{tm(id)}</span>
      <b className="block truncate font-medium tabular-nums">{formatMetric(id, k.value, prefs)}</b>
      {delta ? <span className={cn('block truncate text-[10px] tabular-nums', delta.tone === 'good' ? 'text-success' : delta.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{delta.text}</span> : null}
    </div>
  );
}

function AccountCardView({ c, period }: { c: AccountCard; period: Period }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const delta = useDelta()('followers', c.kpis.followers);
  const reachDown = (c.kpis.reach.change ?? 0) < 0;
  return (
    <li className="min-w-0">
      <Card className="h-full min-w-0 motion-safe:animate-in motion-safe:fade-in">
        <CardContent className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Avatar>
              <AvatarFallback>{[...c.username][0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">@{c.username}</h3>
              {c.displayName ? <p className="truncate text-xs text-muted-foreground">{c.displayName}</p> : null}
            </div>
            {c.state === 'needs_reconnect' ? (
              <Badge variant="destructive">
                <TriangleAlert aria-hidden="true" />
                {t('needsReconnect')}
              </Badge>
            ) : null}
          </div>

          <div className="flex min-w-0 items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{tm('followers')}</p>
              <p className="truncate text-[length:var(--fv)] font-semibold leading-tight tabular-nums">{formatMetric('followers', c.kpis.followers.value, prefs, { full: true })}</p>
            </div>
            {delta ? <DeltaPill delta={delta} /> : null}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{delta ? t('vsPrevious', { days: period }) : c.kpis.followers.reason ? tR(c.kpis.followers.reason) : null}</p>

          <Sparkline data={c.spark} className={reachDown ? 'text-destructive' : 'text-chart-1'} />

          <div className="grid grid-cols-3 gap-1.5 border-t pt-2">
            <MiniStat id="reach" k={c.kpis.reach} />
            <MiniStat id="engagementRate" k={c.kpis.engagementRate} />
            <MiniStat id="posts" k={c.kpis.posts} />
          </div>

          {c.state === 'backfilling' || c.state === 'no_data' ? <p className="text-xs text-muted-foreground">{tR(c.state)}</p> : null}
          {c.state === 'needs_reconnect' ? (
            <Link href="/accounts" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
              {t('reconnectHint')}
            </Link>
          ) : null}

          {c.flags.length ? (
            <ul className="grid gap-1 text-xs">
              {c.flags.map((f) =>
                f.kind === 'taking_off' ? (
                  <li key={f.postId} className="flex items-center gap-1.5 text-success">
                    <TrendingUp aria-hidden="true" className="size-3.5 shrink-0" />
                    {f.permalink ? (
                      <a href={f.permalink} target="_blank" rel="noreferrer" className="truncate underline-offset-4 hover:underline">
                        {t('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}
                      </a>
                    ) : (
                      <span className="truncate">{t('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}</span>
                    )}
                  </li>
                ) : (
                  <li key="drop" className="flex items-center gap-1.5 text-destructive">
                    <TrendingDown aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{t('reachDrop', { change: formatDelta(f.change, prefs) })}</span>
                  </li>
                ),
              )}
            </ul>
          ) : null}

          <p className="mt-auto truncate text-[10px] text-muted-foreground">
            {c.lastSyncedAt ? t('lastSynced', { time: formatDateTime(c.lastSyncedAt, prefs) }) : t('neverSynced')}
            {c.syncErrorKey ? <span className="ml-1 text-destructive">· {tErr.has(c.syncErrorKey) ? tErr(c.syncErrorKey) : tErr('unexpected')}</span> : null}
          </p>
        </CardContent>
      </Card>
    </li>
  );
}

function Comparison({ model }: { model: OverviewModel }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const { prefs } = usePrefs();
  const delta = useDelta();
  const [scopeId, setScopeId] = useState(model.scopes[0]?.id);
  const scope = model.scopes.find((s) => s.id === scopeId) ?? model.scopes[0];
  if (!scope) return null;
  const cards = model.sections.flatMap((s) => s.cards);
  const inScope = scope.accountIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is AccountCard => !!c);
  const data = model.days.map((day, i) => ({ day, ...Object.fromEntries(inScope.map((c) => [c.id, model.series[c.id]?.[i] ?? null])) }));
  const kpiCol = (id: KpiId): Column<AccountCard> => ({
    key: id,
    header: tm(id),
    align: 'right',
    sortValue: (c) => c.kpis[id].value,
    cell: (c) => {
      const d = delta(id, c.kpis[id]);
      return (
        <>
          {formatMetric(id, c.kpis[id].value, prefs)}
          {d ? <span className={cn('ml-1.5 text-xs', d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{d.text}</span> : null}
        </>
      );
    },
  });
  const columns: Column<AccountCard>[] = [{ key: 'account', header: t('account'), cell: (c) => `@${c.username}`, sortValue: (c) => c.username }, kpiCol('followers'), kpiCol('reach'), kpiCol('engagementRate'), kpiCol('posts')];

  return (
    <ChartCard
      title={t('compareTitle')}
      subtitle={t('compareHint')}
      summary={t('chartSummary', { count: inScope.length, days: model.period })}
      actions={
        <div role="group" aria-label={t('scope')} className="flex flex-wrap gap-1">
          {model.scopes.map((s) => (
            <Button key={s.id} type="button" size="sm" variant={s.id === scope.id ? 'secondary' : 'ghost'} aria-pressed={s.id === scope.id} onClick={() => setScopeId(s.id)} className="max-w-48">
              <span className="truncate">{s.group ?? t('allAccounts')}</span>
            </Button>
          ))}
        </div>
      }
    >
      <SeriesChart kind="line" data={data} xKey="day" series={inScope.map((c) => ({ key: c.id, label: `@${c.username}` }))} title={t('compareTitle')} formatX={(d) => formatDay(d, prefs)} formatY={(n) => formatCompact(n, prefs)} />
      <div className="mt-4">
        <DataTable rows={inScope} columns={columns} rowKey={(c) => c.id} caption={t('compareTitle')} initialSort={{ key: 'reach', dir: 'desc' }} />
      </div>
    </ChartCard>
  );
}

export function OverviewView({ model }: { model: OverviewModel }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const delta = useDelta();
  const header = <PageHeader title={t('title')} subtitle={t('subtitle')} actions={<PeriodSelect period={model.period} />} />;

  if (model.sections.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<CircleUserRound className="size-5" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
          action={
            <Button asChild>
              <Link href="/accounts">{t('addAccount')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const totals = model.totals!;
  const vs = t('vsPrevious', { days: model.period });
  return (
    <>
      {header}
      <section aria-label={t('allAccounts')} className="mb-[var(--gp)] grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        {(['followers', 'reach', 'views', 'engagementRate'] as const).map((id) => (
          <StatCard
            key={id}
            label={tm(id)}
            value={formatMetric(id, totals[id].value, prefs, { full: id === 'followers' })}
            delta={delta(id, totals[id])}
            comparison={vs}
            note={totals[id].reason ? tR(totals[id].reason) : undefined}
            spark={id === 'reach' ? <Sparkline data={model.totalsSpark} /> : undefined}
          />
        ))}
      </section>

      <div className="grid gap-[calc(var(--gp)*1.5)]">
        {model.sections.map((s) => (
          <section key={s.group ?? '\u0000isolated'} aria-labelledby={`grp-${s.group ?? 'isolated'}`}>
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id={`grp-${s.group ?? 'isolated'}`} className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="min-w-0 truncate">{s.group ?? t('isolated')}</span>
                <Badge variant="secondary">{formatNumber(s.cards.length, prefs)}</Badge>
              </h2>
              {s.totals ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {(['followers', 'reach'] as const).map((id) => {
                    const d = delta(id, s.totals![id]);
                    return (
                      <span key={id} className="inline-flex items-center gap-1">
                        {tm(id)} <b className="font-medium text-foreground tabular-nums">{formatMetric(id, s.totals![id].value, prefs)}</b>
                        {d ? <DeltaPill delta={d} /> : null}
                      </span>
                    );
                  })}
                </p>
              ) : null}
            </div>
            <ul className="grid gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-3">
              {s.cards.map((c) => (
                <AccountCardView key={c.id} c={c} period={model.period} />
              ))}
            </ul>
          </section>
        ))}

        <Comparison model={model} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Replace `app/(app)/overview/page.tsx`** (wiring only; owner check first, owner-session client, no admin client):

```tsx
import { OverviewView } from '@/components/overview/OverviewView';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildOverview, fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const period = parsePeriod((await searchParams).period);
  const prefs = await getPrefs(); // timezone = the owner's (synced to profiles); the sync writes days in it too
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const input = await loadOverviewInput(db, fromDayFor(period, today));
  return <OverviewView model={buildOverview(input, { period, today, now, tz: prefs.timezone, locale: prefs.locale })} />;
}
```

- [ ] **Step 6: Write `app/(app)/overview/loading.tsx`:**

```tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function OverviewLoading() {
  return (
    <div aria-busy="true" className="grid gap-[var(--gp)]">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/overview-view.test.tsx tests/messages.test.ts`
Expected: PASS (6 + 6 tests).

- [ ] **Step 8: Commit**

```bash
git add components/overview/OverviewView.tsx "app/(app)/overview/page.tsx" "app/(app)/overview/loading.tsx" messages/en.json messages/zh-CN.json tests/overview-view.test.tsx
git commit -m "feat: Overview page (grouped account cards, totals, period selector, comparison)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Styleguide dashboard gallery, runbook, TODO and final check

**Files:**
- Create: `app/styleguide/DashboardGallery.tsx`, `docs/RUNBOOK_DASHBOARDS.md`
- Modify: `app/styleguide/page.tsx`, `messages/en.json`, `messages/zh-CN.json`, `docs/TODO.md`, `docs/superpowers/plans/2026-10-13-00-roadmap.md`
- Test: `tests/dashboard-gallery.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–10; `postHeatmap` (Task 4).
- Produces: `DashboardGallery()` on `/styleguide` (fixed sample data); i18n `styleguide.gallery.{stats,charts,lineChart,areaChart,barChart,heatmap,dataTable,sampleComparison,sampleSummary}`, `analysis.{low,high,lowSample,heatCell,weekday.0-6}` (part 2's best-time UI reuses the `analysis.*` ones).

- [ ] **Step 1: Write the failing test** — `tests/dashboard-gallery.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DashboardGallery } from '@/app/styleguide/DashboardGallery';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['en', en],
  ['zh-CN', zh],
] as const)('DashboardGallery (%s)', (locale, messages) => {
  it('shows stat cards, the three chart kinds, the heatmap and the data table', () => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={() => {}}>
          <DashboardGallery />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const g = messages.styleguide.gallery;
    for (const label of [g.stats, g.charts, g.lineChart, g.areaChart, g.barChart, g.dataTable]) expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: g.heatmap })).toBeInTheDocument();
    expect(screen.getAllByText(messages.analysis.weekday['1']).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/dashboard-gallery.test.tsx`
Expected: FAIL — `Failed to resolve import "@/app/styleguide/DashboardGallery"`.

- [ ] **Step 3: Add the i18n keys.**

`messages/en.json` → inside `styleguide.gallery`:
```json
"stats": "Stat cards",
"charts": "Charts",
"lineChart": "Line chart",
"areaChart": "Area chart",
"barChart": "Bar chart",
"heatmap": "Best time heatmap",
"dataTable": "Data table",
"sampleComparison": "vs previous 30 days",
"sampleSummary": "Sample data: daily reach of three accounts over 30 days."
```
and inside `analysis` (next to `reasons`):
```json
"low": "Low",
"high": "High",
"lowSample": "too few posts",
"heatCell": "{day} {hour}:00 · {value} · {count} posts",
"weekday": { "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat" }
```

`messages/zh-CN.json` → inside `styleguide.gallery`:
```json
"stats": "统计卡片",
"charts": "图表",
"lineChart": "折线图",
"areaChart": "面积图",
"barChart": "柱状图",
"heatmap": "最佳发布时间热力图",
"dataTable": "数据表",
"sampleComparison": "对比前 30 天",
"sampleSummary": "示例数据：三个账号近 30 天的每日触达。"
```
and inside `analysis`:
```json
"low": "低",
"high": "高",
"lowSample": "帖子太少",
"heatCell": "{day} {hour}:00 · {value} · {count} 篇帖子",
"weekday": { "0": "周日", "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六" }
```

- [ ] **Step 4: Write `app/styleguide/DashboardGallery.tsx`:**

```tsx
'use client';

// Dashboard pieces with fixed sample data, for checking every theme × mode × density at 360 / 768 / 1280
// (docs/RUNBOOK_DASHBOARDS.md). Sample values are deterministic so screenshots compare.
import { useTranslations } from 'next-intl';
import { Heatmap } from '@/components/charts/Heatmap';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { postHeatmap } from '@/lib/analysis/best-time';
import type { Post } from '@/lib/analysis/types';
import { formatCompact, formatDay, formatPercent } from '@/lib/format';
import { addDays } from '@/lib/sync/time';

const DAYS = Array.from({ length: 30 }, (_, i) => addDays('2026-09-15', i));
const wave = (i: number, base: number, amp: number, k: number) => Math.round(base + amp * Math.sin(i / 3 + k) + i * (base / 60));
const ROWS = DAYS.map((day, i) => ({ day, a: wave(i, 4200, 900, 0), b: wave(i, 2600, 700, 2), c: i % 9 === 4 ? null : wave(i, 1200, 400, 4) }));
const SERIES = [
  { key: 'a', label: '@brandx.official' },
  { key: 'b', label: '@brandx.shop' },
  { key: 'c', label: '@studio.two' },
];
const POSTS: Post[] = Array.from({ length: 80 }, (_, i) => ({
  id: `p${i}`,
  accountId: 'a',
  mediaType: 'IMAGE',
  postedAt: new Date(Date.UTC(2026, 8, 1 + (i % 7), 9 + (i % 4) * 3)).toISOString(), // 28 slots, ~3 posts each
  permalink: null,
  reach: 1000,
  views: null,
  likes: 20 + ((i * 13) % 60),
  comments: null,
  shares: null,
  saves: null,
  interactions: null,
}));

export function DashboardGallery() {
  const t = useTranslations('styleguide.gallery');
  const ta = useTranslations('analysis');
  const tm = useTranslations('metrics');
  const to = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  const heat = postHeatmap(POSTS, prefs.timezone, prefs.weekStart);
  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const fmtY = (n: number) => formatCompact(n, prefs);
  const fmtX = (d: string) => formatDay(d, prefs);

  return (
    <section className="grid gap-[var(--gp)]">
      <h2 className="text-[length:var(--fh)] font-medium">{t('stats')}</h2>
      <div className="grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        <StatCard label={tm('followers')} value="18,204" delta={{ text: '+3.1%', direction: 'up', tone: 'good' }} comparison={t('sampleComparison')} spark={<Sparkline data={ROWS.map((r) => r.a)} />} />
        <StatCard label={tm('reach')} value="241K" delta={{ text: '-18.0%', direction: 'down', tone: 'bad' }} comparison={t('sampleComparison')} spark={<Sparkline data={ROWS.map((r) => r.b)} className="text-destructive" />} />
        <StatCard label={tm('engagementRate')} value="4.8%" delta={{ text: '0.0%', direction: 'flat', tone: 'neutral' }} comparison={t('sampleComparison')} />
        <StatCard label={tm('netFollows')} value="—" comparison={t('sampleComparison')} note={ta('reasons.needs_100_followers')} />
      </div>

      <h2 className="text-[length:var(--fh)] font-medium">{t('charts')}</h2>
      <div className="grid gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard title={t('lineChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="line" data={ROWS} xKey="day" series={SERIES} title={t('lineChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('areaChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="area" data={ROWS} xKey="day" series={SERIES.slice(0, 2)} title={t('areaChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('barChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="bar" data={ROWS.slice(-10)} xKey="day" series={SERIES.slice(0, 2)} title={t('barChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('heatmap')} subtitle={heat.reason ? ta(`reasons.${heat.reason}`) : undefined}>
          <Heatmap
            caption={t('heatmap')}
            columns={hours}
            lowLabel={ta('low')}
            highLabel={ta('high')}
            rows={heat.rows.map((r) => ({
              label: ta(`weekday.${r.weekday}`),
              cells: r.cells.map((c, h) => ({
                value: c.value,
                lowSample: c.lowSample,
                label: c.lowSample ? `${ta(`weekday.${r.weekday}`)} ${h}:00 · ${ta('lowSample')}` : ta('heatCell', { day: ta(`weekday.${r.weekday}`), hour: h, value: formatPercent(c.value, prefs), count: c.count }),
              })),
            }))}
          />
        </ChartCard>
      </div>

      <h2 className="text-[length:var(--fh)] font-medium">{t('dataTable')}</h2>
      <DataTable
        rows={SERIES.map((s, i) => ({ ...s, reach: ROWS.reduce((a, r) => a + ((r[s.key as 'a' | 'b' | 'c'] as number | null) ?? 0), 0), er: [0.048, 0.031, null][i] }))}
        rowKey={(r) => r.key}
        caption={t('dataTable')}
        initialSort={{ key: 'reach', dir: 'desc' }}
        columns={[
          { key: 'account', header: to('account'), cell: (r) => r.label, sortValue: (r) => r.label },
          { key: 'reach', header: tm('reach'), cell: (r) => formatCompact(r.reach, prefs), sortValue: (r) => r.reach, align: 'right' },
          { key: 'er', header: tm('engagementRate'), cell: (r) => formatPercent(r.er, prefs), sortValue: (r) => r.er, align: 'right' },
        ]}
      />
    </section>
  );
}
```

- [ ] **Step 5: Mount it** — in `app/styleguide/page.tsx` add the import after the other imports and render it after `<Gallery />`:

```tsx
import { DashboardGallery } from './DashboardGallery';
```
```tsx
      <Gallery />
      <DashboardGallery />
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/dashboard-gallery.test.tsx tests/messages.test.ts tests/gallery.test.tsx`
Expected: PASS.

- [ ] **Step 7: Write `docs/RUNBOOK_DASHBOARDS.md`:**

````markdown
# Dashboards visual-verification runbook (Plan 6, part 1)

Run this twice: once right after Plan 6 part 1 lands (styleguide samples only), and again once real data exists (at least one account synced for 14+ days, `docs/RUNBOOK_SYNC.md` passed). Who: owner, or Claude with the owner. Nothing here touches Supabase, Vercel or Meta settings.

## 0. Start

```bash
npm run dev        # http://localhost:3000
```

- `/styleguide` works without signing in: stat cards, line/area/bar charts, the best-time heatmap and the data table with fixed sample data.
- `/overview` needs the owner session (and real data for step 3).

## 1. The matrix

For each page below check every cell: 4 themes (Ink, Sunset, Forest, Mono) × light/dark, at 360, 768 and 1280 px wide. Switch theme/mode with the bar at the top of `/styleguide` or Settings; the choice applies to every page. Browser dev tools → device toolbar → "Responsive", type the width.

| Width | What must hold |
|---|---|
| 360 | No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`). Stat cards 2 per row; account cards 1 per row; the comparison table shows as cards with a "Sort by" select; heatmap squares shrink but every row stays on screen. Long `@usernames` end in "…". |
| 768 | Table view (not cards) for the comparison; account cards 2 per row; period selector fits next to the title or wraps under it cleanly. |
| 1280 | Stat cards 4 per row; account cards 3 per row; chart legends on one line for up to 4 accounts. |

In every theme and mode:
- Chart lines/bars use the theme's chart colours (compare with the "Chart series" swatches at the top of `/styleguide`); grid lines are dashed and faint; axis text readable.
- Tooltip (hover a chart): surface background, border, readable text in dark mode.
- Delta pills: green-ish for good, red-ish for bad, grey for flat; the sign (+/−) is always in the text.
- Heatmap: darker = more; greyed cells are the "too few posts" ones; the Low→High scale matches.
- Nothing uses a colour that ignores the theme (a white box in dark mode is a bug).

## 2. Motion

- OS setting "reduce motion" on (Windows: Settings → Accessibility → Visual effects → Animation effects off; macOS: Accessibility → Display → Reduce motion): reload; charts appear without the draw-in animation, cards without the fade.
- Phone or DevTools "touch" emulation: same as above for heavy effects (none in part 1; part 2's globe/particles must stay off).

## 3. With real data (`/overview`)

1. Period selector 7 / 30 / 90 days: numbers change, the URL shows `?period=…`, "vs previous N days" follows.
2. Compare one account's 7-day reach on its card with Instagram's app (Professional dashboard → Insights → Accounts reached, last 7 days). Expect the same order of magnitude, not an exact match: we sum daily reach (SPEC §7), Instagram shows unique accounts.
3. An account under 100 followers: net follows show "Instagram shares this from 100 followers".
4. A freshly connected account: card says "Importing history…" until the first daily sync writes a day.
5. An account in `needs_reconnect`: red "Needs reconnect" badge + link to `/accounts`.
6. Comparison card: group scope first (if a group has 2+ accounts), "All accounts" widens it; isolated accounts appear only under "All accounts".
7. Language switch to 简体中文: every label is Chinese, numbers/dates follow Settings → formats.

## What to send if something looks wrong

Page, width, theme + mode, language, a screenshot, and (for numbers) the account and period. Never screenshots of tokens or the Supabase dashboard's secret keys.
````

- [ ] **Step 8: Update `docs/TODO.md`** (tick only what is done; live checks stay pending):
  - §4 Analysis: replace the line with `- [x] \`lib/analysis\`: growth, top posts, format comparison, best-time heatmap, per-tag (tags arrive in Plan 6 part 2), flags (+ vitest) (Plan 6 part 1)`
  - §5: `- [x] DataTable, StatCard, ChartCard (Plan 6)`; `- [x] DataTable card mode (Plan 6)`; `- [x] \`lib/metrics.ts\` registry (Plan 6)`; change the styleguide line to `- [x] /styleguide gallery: primitives (Plan 2); stat cards, charts, heatmap, data table (Plan 6) — visual matrix in docs/RUNBOOK_DASHBOARDS.md`.
  - §5 PWA line: split into `- [x] Motion gating helper (\`lib/motion.ts\`: reduced-motion, coarse pointer, Save-Data) (Plan 6)` and `- [ ] PWA: manifest, icons, service worker (static + offline page only), install prompt`.
  - §6: replace with `- [x] Overview (grouped cards, totals, comparison, period selector) (code done; visual + live check pending — docs/RUNBOOK_DASHBOARDS.md)` and `- [ ] Account detail (incl. Stories, calendar, flags, tags), Tags page (Plan 6 part 2)`. (Accounts page is already done in Plan 4; keep it out of this line.)

- [ ] **Step 9: Update the roadmap** — in `docs/superpowers/plans/2026-10-13-00-roadmap.md`, row 6, change the "Delivers" cell to: `**Part 1** (\`2026-10-16-06-analysis-overview.md\`): \`lib/analysis/*\` (growth, top posts, formats, tags as input, best-time with sample guard, flags), metrics registry, owner-session read layer, StatCard/ChartCard/DataTable/Recharts wrappers/heatmap, motion gate, Overview. **Part 2**: Account detail (Overview / Posts / Stories / Audience tabs incl. globe), Tags page + \`tags\`/\`media_tags\` migration, calendar`.

- [ ] **Step 10: Full verification**

Run: `npm run check`
Expected: lint clean, `tsc --noEmit` clean, all tests pass (≈ 84 files), `next build` succeeds and lists `ƒ /overview` and `ƒ /styleguide`.

Then:
- `git diff --stat main -- app/globals.css` is empty.
- `grep -rnE "supabase/admin|createAdminSupabase|account_tokens" lib/dashboard "app/(app)/overview" components/overview` finds nothing (owner session only).
- `grep -rnE "#[0-9a-fA-F]{6}|rgb\(" components/charts components/shared/StatCard.tsx components/shared/ChartCard.tsx components/shared/DataTable.tsx components/overview` finds nothing.
- `grep -rn "toLocale" components/overview components/charts components/shared lib/analysis lib/dashboard` finds nothing.
- `npm run dev`, open `/styleguide`, scroll to "Stat cards": charts draw, the heatmap shows coloured and greyed cells; resize to 360 px: no horizontal page scroll.

- [ ] **Step 11: Commit**

```bash
git add app/styleguide/DashboardGallery.tsx app/styleguide/page.tsx messages/en.json messages/zh-CN.json tests/dashboard-gallery.test.tsx docs/RUNBOOK_DASHBOARDS.md docs/TODO.md docs/superpowers/plans/2026-10-13-00-roadmap.md
git commit -m "docs: dashboards runbook, styleguide dashboard gallery, TODO" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## After the plan (owner, not a task)

1. Run `docs/RUNBOOK_DASHBOARDS.md` §1–2 on `/styleguide` now; §3 once an account has synced for 14+ days.
2. Confirm the two ⚠ decisions (7/30/90 periods; `components/<feature>/` folders) — or ask for 28 days / `features/`.
3. Plan 6 part 2 starts from "Out of scope — what part 2 must provide" above.

## Known ceilings (deliberate)

- Group/all-accounts totals merge each account's daily series by position (each account keeps its own lag-aware window end) — `ponytail:` in `combine()`; switch to calendar-day merge if lags ever differ by more than a day.
- Summing daily reach overcounts unique accounts across days (SPEC §7's definition); Instagram's app shows uniques, so totals differ from the app (runbook §3.2 says so).
- Overview reads 2 queries per account per render, no caching; fine for 3–4 accounts. Add `unstable_cache`/revalidate if the account count grows.
- `DataTable` sorts client-side and renders every row (no pagination) — fine for the comparison table; part 2's Posts table brings TanStack Table.
