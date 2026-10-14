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
