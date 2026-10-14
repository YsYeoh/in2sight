import { describe, expect, it } from 'vitest';
import { insightDay, parseBreakdown, parseMediaPage, parseOnlineFollowers, parseTotals, toIso } from '@/lib/instagram/parse';
import { fixture } from './fixtures/instagram/load';

describe('parseTotals', () => {
  it('reads total_value.value for account insights', () => {
    expect(parseTotals(fixture('account-day'))).toEqual({ reach: 1830, views: 4210, accounts_engaged: 96, total_interactions: 240, profile_links_taps: 7 });
  });
  it('reads values[0].value for media insights', () => {
    expect(parseTotals(fixture('media-insights-feed'))).toMatchObject({ reach: 900, saved: 30, total_interactions: 172 });
  });
  it('an empty data set yields no keys (missing is not zero)', () => {
    expect(parseTotals(fixture('empty-insights'))).toEqual({});
    expect(parseTotals({})).toEqual({});
    expect(parseTotals({ data: [{ name: 'reach', total_value: { value: 'x' } }] })).toEqual({});
  });
});

describe('parseBreakdown', () => {
  it('keys results by the joined dimension values', () => {
    expect(parseBreakdown(fixture('account-follows'), 'follows_and_unfollows')).toEqual({ FOLLOWER: 12, NON_FOLLOWER: 3 });
    expect(parseBreakdown(fixture('demographics-age-gender'), 'follower_demographics')).toEqual({ '18-24|F': 210, '25-34|M': 180, '25-34|F': 330 });
  });
  it('is empty when the metric or breakdown is missing', () => {
    expect(parseBreakdown(fixture('empty-insights'), 'follower_demographics')).toEqual({});
    expect(parseBreakdown(fixture('account-day'), 'reach')).toEqual({});
  });
});

describe('parseMediaPage', () => {
  it('maps items and returns the next page URL', () => {
    const { items, next } = parseMediaPage(fixture('media-page-1'), false);
    expect(items).toEqual([
      { id: '18000000000000003', kind: 'REELS', caption: 'New drop', permalink: 'https://www.instagram.com/reel/AAA/', postedAt: '2026-10-13T10:00:00.000Z' },
      { id: '18000000000000002', kind: 'CAROUSEL_ALBUM', caption: 'Behind the scenes', permalink: 'https://www.instagram.com/p/BBB/', postedAt: '2026-10-10T02:30:00.000Z' },
    ]);
    expect(next).toMatch(/^https:\/\/graph\.instagram\.com\//);
  });
  it('falls back when caption / media_product_type are not returned: VIDEO is a Reel, caption null, no next page', () => {
    const { items, next } = parseMediaPage(fixture('media-page-2'), false);
    expect(items.map((i) => [i.kind, i.caption])).toEqual([['IMAGE', null], ['REELS', null]]);
    expect(next).toBeNull();
  });
  it('marks everything from /stories as STORY', () => {
    expect(parseMediaPage(fixture('stories'), true).items[0]).toMatchObject({ id: '18100000000000001', kind: 'STORY', postedAt: '2026-10-14T01:00:00.000Z' });
  });
  it('skips items with an unknown type or a bad timestamp', () => {
    const body = { data: [{ id: '1', media_type: 'HOLOGRAM', timestamp: '2026-10-13T10:00:00+0000' }, { id: '2', media_type: 'IMAGE', timestamp: 'nope' }, { media_type: 'IMAGE', timestamp: '2026-10-13T10:00:00+0000' }] };
    expect(parseMediaPage(body, false).items).toEqual([]);
  });
});

describe('time parsing', () => {
  it('toIso accepts Instagram +0000 offsets', () => {
    expect(toIso('2026-10-13T10:00:00+0000')).toBe('2026-10-13T10:00:00.000Z');
    expect(toIso('2026-10-13T10:00:00+0800')).toBe('2026-10-13T02:00:00.000Z');
    expect(toIso('garbage')).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
  it('insightDay maps an end_time to the day it closes', () => {
    expect(insightDay('2026-10-13T07:00:00+0000')).toBe('2026-10-12');
    expect(insightDay('2026-10-13T00:00:00+0000')).toBe('2026-10-12');
  });
});

describe('parseOnlineFollowers', () => {
  it('returns 24 hourly values per day', () => {
    const [d] = parseOnlineFollowers(fixture('online-followers'));
    expect(d.day).toBe('2026-10-12');
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly[0]).toBe(10);
    expect(d.hourly[23]).toBe(33);
  });
  it('skips empty values (under 100 followers) and missing data', () => {
    expect(parseOnlineFollowers({ data: [{ name: 'online_followers', values: [{ value: {}, end_time: '2026-10-13T07:00:00+0000' }] }] })).toEqual([]);
    expect(parseOnlineFollowers(fixture('empty-insights'))).toEqual([]);
  });
});
