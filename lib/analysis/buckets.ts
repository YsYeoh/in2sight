// Daily rows → day / week / month buckets for charts (Time Scope granularity). Pure.
// Sums add only the days that have a value and stay null (never 0) when none has one; levels such as followers take
// the bucket's last value. A bucket that the rows start or end inside (the range cuts it) is listed in `partial`.
import type { WeekStart } from '@/lib/prefs';
import { bucketRange, bucketStart, type Granularity } from '@/lib/time-scope/range';

export type Agg = 'sum' | 'last';
export type DayValues<K extends string> = { day: string } & Record<K, number | null>;

/** `rows` must be consecutive days, oldest first (as summarize() builds them). Output rows are keyed by the bucket's first day. */
export function bucketize<K extends string>(rows: DayValues<NoInfer<K>>[], gran: Granularity, weekStart: WeekStart, aggs: Record<K, Agg>): { rows: DayValues<K>[]; partial: string[] } {
  if (rows.length === 0) return { rows: [], partial: [] };
  const keys = Object.keys(aggs) as K[];
  const buckets = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const day = bucketStart(r.day, gran, weekStart);
    const b = buckets.get(day) ?? Object.fromEntries(keys.map((k) => [k, null]));
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'number' && Number.isFinite(v)) b[k] = aggs[k] === 'sum' ? (b[k] ?? 0) + v : v;
    }
    buckets.set(day, b);
  }
  const first = rows[0].day;
  const last = rows[rows.length - 1].day;
  return {
    rows: [...buckets].map(([day, b]) => ({ ...b, day }) as DayValues<K>),
    partial: [...buckets.keys()].filter((day) => {
      const span = bucketRange(day, gran);
      return span.from < first || span.to > last;
    }),
  };
}
