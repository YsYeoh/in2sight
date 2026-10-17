import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DIMENSIONS, formatMetric, isDimensionId, isMetricId, METRIC_IDS, METRICS, supports, type Parts } from '@/lib/metrics';
import type { FormatPrefs } from '@/lib/format';

const P: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
const parts: Parts = {
  daily: { reach: 1000, views: 3000, interactions: 70, erInteractions: 60, erReach: 900, netFollows: -4, followers: 2500 },
  posts: { posts: 4, measured: 3, reachSum: 600, viewsSum: 900, viewsN: 2, likes: 30, comments: 5, saves: 2, shares: 1, erInteractions: 38, erReach: 600 },
};

describe('metric registry (Explorer)', () => {
  it('every metric is keyed by its own id, has a source, and a label in both languages', () => {
    for (const id of METRIC_IDS) {
      expect(METRICS[id].id).toBe(id);
      expect(['daily', 'posts']).toContain(METRICS[id].source);
      expect((en.metrics as Record<string, string>)[id], id).toBeTruthy();
      expect((zh.metrics as Record<string, string>)[id], id).toBeTruthy();
    }
  });

  it('computes each value from the additive parts (ratios guard a zero or missing base)', () => {
    const v = Object.fromEntries(METRIC_IDS.map((id) => [id, METRICS[id].value(parts)]));
    expect(v).toEqual({
      followers: 2500, reach: 1000, views: 3000, engagementRate: 60 / 900, posts: 4, netFollows: -4, interactions: 70,
      avgReach: 200, avgViews: 450, likes: 30, comments: 5, saves: 2, shares: 1, postEngagementRate: 38 / 600,
    });
    const empty: Parts = { daily: null, posts: { ...parts.posts!, measured: 0, viewsN: 0, erReach: null } };
    expect(METRICS.reach.value(empty)).toBeNull();
    expect(METRICS.avgReach.value(empty)).toBeNull();
    expect(METRICS.avgViews.value(empty)).toBeNull();
    expect(METRICS.postEngagementRate.value(empty)).toBeNull();
    expect(METRICS.engagementRate.value({ daily: { ...parts.daily!, erReach: 0 }, posts: null })).toBeNull();
  });

  it('account-day metrics only group by group, account and time; post metrics by everything', () => {
    for (const d of DIMENSIONS) {
      expect(supports('posts', d)).toBe(true);
      expect(supports('reach', d)).toBe(['group', 'account', 'time'].includes(d));
    }
  });

  it('id guards accept only registry entries (no prototype keys, no junk)', () => {
    expect(isMetricId('reach')).toBe(true);
    for (const v of ['toString', '__proto__', 'constructor', 'REACH', '', null, 1]) expect(isMetricId(v)).toBe(false);
    expect(isDimensionId('hour')).toBe(true);
    for (const v of ['day', 'hours', '', undefined]) expect(isDimensionId(v)).toBe(false);
  });

  it('every dimension has a label in both languages', () => {
    for (const d of DIMENSIONS) {
      expect((en.explorer.by as Record<string, string>)[d], d).toBeTruthy();
      expect((zh.explorer.by as Record<string, string>)[d], d).toBeTruthy();
    }
  });

  it('formats new metrics like the old ones', () => {
    expect(formatMetric('avgReach', 1234.5, P)).toBe('1.2K');
    expect(formatMetric('postEngagementRate', 0.0633, P)).toBe('6.3%');
  });
});
