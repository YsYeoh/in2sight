// Audience tab model: latest follower_demographics snapshots to ranked bars, an age x gender split and globe points.
// Instagram returns at most 45 rows per breakdown and nothing under 100 followers (lib/instagram/metrics.ts).
import type { MissingReason } from '@/lib/analysis/types';
import type { AudienceSnapshots } from '@/lib/dashboard/detail-read';
import { CENTROIDS } from '@/lib/geo/centroids';

export const TOP_N = 8;

export interface RankedRow {
  key: string; // country code (upper-case) or city name
  value: number;
  share: number; // of the snapshot total, 0..1
}
export interface Ranked {
  day: string;
  total: number;
  rows: RankedRow[]; // top N, largest first
  other: { value: number; share: number } | null; // everything after the top N
}
export interface AgeRow {
  age: string; // '18-24', '65+', or the raw bucket Instagram sent
  female: number;
  male: number;
  unknown: number;
  total: number;
  share: number;
}
export interface GlobePoint {
  code: string;
  lat: number;
  lon: number;
  share: number;
}
export interface AudienceModel {
  ages: { day: string; total: number; rows: AgeRow[] } | null;
  countries: Ranked | null;
  cities: Ranked | null;
  globe: GlobePoint[]; // every country with a known centroid (not just the top N)
  reason: MissingReason | null; // needs_100_followers when Instagram shared nothing at all
}

function rank(day: string, counts: Map<string, number>, top: number): Ranked | null {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const sorted = [...counts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rest = sorted.slice(top).reduce((a, [, v]) => a + v, 0);
  return {
    day,
    total,
    rows: sorted.slice(0, top).map(([key, value]) => ({ key, value, share: value / total })),
    other: rest > 0 ? { value: rest, share: rest / total } : null,
  };
}

function tally(data: Record<string, number>, keyOf: (k: string) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(data)) {
    const key = keyOf(k);
    if (key && Number.isFinite(v) && v > 0) m.set(key, (m.get(key) ?? 0) + v);
  }
  return m;
}

const ageStart = (age: string) => {
  const n = Number.parseInt(age, 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
};

function ages(snap: AudienceSnapshots['age_gender']): AudienceModel['ages'] {
  if (!snap) return null;
  const by = new Map<string, AgeRow>();
  for (const [k, v] of Object.entries(snap.data)) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const [age = '', g = ''] = k.split('|').map((s) => s.trim());
    if (!age) continue;
    const row = by.get(age) ?? { age, female: 0, male: 0, unknown: 0, total: 0, share: 0 };
    const gender = g.toUpperCase();
    if (gender === 'F') row.female += v;
    else if (gender === 'M') row.male += v;
    else row.unknown += v;
    row.total += v;
    by.set(age, row);
  }
  const total = [...by.values()].reduce((a, r) => a + r.total, 0);
  if (total <= 0) return null;
  const rows = [...by.values()].sort((a, b) => ageStart(a.age) - ageStart(b.age) || a.age.localeCompare(b.age)).map((r) => ({ ...r, share: r.total / total }));
  return { day: snap.day, total, rows };
}

export function buildAudience(s: AudienceSnapshots): AudienceModel {
  const countryCounts = s.country ? tally(s.country.data, (k) => k.trim().toUpperCase()) : new Map<string, number>();
  const countries = s.country ? rank(s.country.day, countryCounts, TOP_N) : null;
  const cities = s.city ? rank(s.city.day, tally(s.city.data, (k) => k.trim()), TOP_N) : null;
  const a = ages(s.age_gender);
  const total = countries?.total ?? 0;
  const globe = [...countryCounts.entries()].flatMap(([code, value]) => {
    const c = CENTROIDS[code];
    return c && total > 0 ? [{ code, lat: c[0], lon: c[1], share: value / total }] : [];
  });
  return { ages: a, countries, cities, globe, reason: !a && !countries && !cities ? 'needs_100_followers' : null };
}
