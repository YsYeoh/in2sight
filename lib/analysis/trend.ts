// Trend maths for the Growth tab (Plan 15a). Two robust methods, chosen so one viral day never skews the answer and
// a number is never more precise than the data behind it:
//  - Iglewicz & Hoaglin modified z-score (median / MAD) against the same weekday of the weeks before: "unusual" for
//    THIS account on THIS weekday, not a fixed threshold.
//  - Theil-Sen median slope for the follower projection, with the middle half of the slopes as the band.
import { median } from '@/lib/analysis/posts';
import { addDays } from '@/lib/sync/time';
import { daysBetween } from '@/lib/time-scope/range';

export const ANOMALY = { weeks: 8, minSamples: 4, threshold: 3.5, minAbs: 3, minRel: 0.1 } as const;
export const PROJECTION = { days: 28, minPoints: 14, mediumPoints: 21, horizons: [7, 30, 90] } as const;

export interface Anomaly {
  value: number;
  median: number;
  n: number;
  z: number | null;
  unusual: boolean;
  direction: 'up' | 'down' | 'flat';
}
export type AnomalyResult = Anomaly | { reason: 'few_samples'; n: number };

export interface Projection {
  method: 'median_slope';
  n: number;
  from: string;
  to: string;
  last: number;
  perDay: number;
  confidence: 'low' | 'medium';
  horizons: { days: number; value: number; low: number; high: number }[];
}
export type ProjectionResult = Projection | { reason: 'not_enough_history'; n: number };

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

// ponytail: the pair-slope loop is O(n²) on at most 28 points (378 slopes); never run it on longer series.
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
