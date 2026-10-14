import { describe, expect, it } from 'vitest';
import { buildAudience, TOP_N } from '@/lib/dashboard/audience';
import type { AudienceSnapshots } from '@/lib/dashboard/detail-read';
import { formatCountry } from '@/lib/format';
import { CENTROIDS } from '@/lib/geo/centroids';

const none: AudienceSnapshots = { age_gender: null, country: null, city: null };
const day = '2026-10-14';

describe('buildAudience', () => {
  it('empty snapshots give needs_100_followers and nothing else', () => {
    expect(buildAudience(none)).toEqual({ ages: null, countries: null, cities: null, globe: [], reason: 'needs_100_followers' });
    expect(buildAudience({ ...none, country: { day, data: {} } }).reason).toBe('needs_100_followers');
  });

  it('countries: top 8 + other, shares of the total, ties by code, lower-case codes merged', () => {
    const data: Record<string, number> = { my: 5, MY: 45, SG: 20, ID: 10 };
    'ABCDEFGH'.split('').forEach((ch, i) => (data[`Z${ch}`] = 1 + (i % 2)));
    const m = buildAudience({ ...none, country: { day, data } });
    expect(m.countries!.total).toBe(50 + 20 + 10 + 12);
    expect(m.countries!.rows).toHaveLength(TOP_N);
    expect(m.countries!.rows.slice(0, 3).map((r) => [r.key, r.value])).toEqual([['MY', 50], ['SG', 20], ['ID', 10]]);
    expect(m.countries!.rows[3].key).toBe('ZB'); // value 2, ties broken by code
    expect(m.countries!.other!.value).toBe(m.countries!.total - m.countries!.rows.reduce((a, r) => a + r.value, 0));
    expect(m.reason).toBeNull();
  });

  it('unknown country codes keep the raw code and get no centroid (no globe dot); known ones do', () => {
    const m = buildAudience({ ...none, country: { day, data: { MY: 10, XK: 2, ZZ: 3, '??': 1 } } });
    expect(m.countries!.rows.map((r) => r.key)).toEqual(['MY', 'ZZ', 'XK', '??']);
    expect(m.globe.map((g) => g.code).sort()).toEqual(['MY', 'XK']);
    expect(m.globe.find((g) => g.code === 'MY')).toMatchObject({ lat: CENTROIDS.MY[0], lon: CENTROIDS.MY[1], share: 10 / 16 });
  });

  it('age x gender: buckets ordered by age, F/M/unknown split, keys without gender count as unknown', () => {
    const m = buildAudience({ ...none, age_gender: { day, data: { '25-34|F': 30, '18-24|M': 10, '18-24|F': 20, '65+|U': 5, '35-44': 5, '|F': 9, '13-17|M': -1 } } });
    expect(m.ages!.rows.map((r) => [r.age, r.female, r.male, r.unknown])).toEqual([
      ['18-24', 20, 10, 0],
      ['25-34', 30, 0, 0],
      ['35-44', 0, 0, 5],
      ['65+', 0, 0, 5],
    ]);
    expect(m.ages!.total).toBe(70);
    expect(m.ages!.rows[0].share).toBeCloseTo(30 / 70);
  });

  it('cities rank by name as Instagram sends it', () => {
    const m = buildAudience({ ...none, city: { day, data: { 'Kuala Lumpur, Federal Territory of Kuala Lumpur': 30, 'Singapore, Singapore': 10 } } });
    expect(m.cities!.rows[0]).toMatchObject({ key: 'Kuala Lumpur, Federal Territory of Kuala Lumpur', share: 0.75 });
    expect(m.cities!.other).toBeNull();
  });
});

describe('formatCountry', () => {
  it('names a code in the UI language; junk comes back unchanged', () => {
    expect(formatCountry('MY', { locale: 'en' })).toBe('Malaysia');
    expect(formatCountry('my', { locale: 'zh-CN' })).toBe('马来西亚'); // Malaysia in Chinese
    expect(formatCountry('XK', { locale: 'en' })).toMatch(/\S/);
    expect(formatCountry('??', { locale: 'en' })).toBe('??');
    expect(formatCountry('USA', { locale: 'en' })).toBe('USA');
  });
});

describe('CENTROIDS', () => {
  it('every entry is a valid alpha-2 code with a lat/lon in range', () => {
    expect(Object.keys(CENTROIDS).length).toBeGreaterThan(240);
    for (const [code, [lat, lon]] of Object.entries(CENTROIDS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });
});
