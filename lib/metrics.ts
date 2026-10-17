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
