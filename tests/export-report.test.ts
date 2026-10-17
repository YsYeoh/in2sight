import { describe, expect, it } from 'vitest';
import { SECTIONS, type ReportParams } from '@/lib/export/params';
import { buildReport, isReportModel, TOP_POSTS } from '@/lib/export/report';
import { DEFAULT_SCOPE } from '@/lib/time-scope/scope';
import { A, NOW, post, sampleData, scopeOf, TODAY, TZ } from './fixtures/export-data';

const params = (o: Partial<ReportParams> = {}): ReportParams => ({ scope: { kind: 'group', name: 'Brand X' }, time: DEFAULT_SCOPE, sections: [...SECTIONS], title: 'Monthly', note: 'Hi', ...o });
const build = (p = params(), data = sampleData()) => buildReport(data, p, { today: TODAY, now: NOW, tz: TZ, weekStart: 'mon' });

describe('buildReport', () => {
  it('header fields come from the params; the KPI window ends on the latest day with data', () => {
    const m = build();
    expect(m).toMatchObject({ v: 1, title: 'Monthly', note: 'Hi', scope: { kind: 'group', name: 'Brand X' }, period: 30, from: '2026-09-15', to: '2026-10-14', compare: { from: '2026-08-16', to: '2026-09-14' }, gran: 'day', generatedAt: NOW.toISOString(), sections: [...SECTIONS] });
    expect(m.trend).toHaveLength(30);
    expect(m.trendPartial).toEqual([]);
  });

  it('a quarter by weeks: the trend is bucketed, cut weeks are partial; top posts and formats stay inside it', () => {
    const d = sampleData('quarter=2026-Q3&gran=week&cmp=none');
    const m = build(params(), d);
    expect(m).toMatchObject({ from: '2026-07-01', to: '2026-09-30', compare: null, gran: 'week' });
    expect(m.trend[0].day).toBe('2026-06-29'); // the Monday week holding 1 July
    expect(m.trendPartial).toEqual(['2026-06-29', '2026-09-28']);
    expect(m.topPosts).toEqual([]); // the sample posts are from October
    expect(m.kpis.reach).toMatchObject({ prior: null, reason: null });
  });

  it('a group: totals over the accounts WITH data, plus one KPI row per account (the empty one has no values)', () => {
    const m = build();
    expect(m.kpis.reach.value).toBe(2000);
    expect(m.accounts.map((a) => a.username)).toEqual(['brand.one', '=brand\u{1F600}/two']);
    expect(m.accounts[1].kpis.reach).toMatchObject({ value: null, reason: 'no_data' });
  });

  it('a single account: no per-account table, its own KPIs', () => {
    const d = sampleData();
    d.accounts = [d.accounts[0]];
    const m = build(params({ scope: { kind: 'account', id: A } }), d);
    expect(m.accounts).toEqual([]);
    expect(m.scope).toEqual({ kind: 'account', name: 'brand.one' });
    expect(m.kpis.followers.value).toBe(1000);
  });

  it('trend sums reach and views per day; days without rows are null, not 0', () => {
    const m = build();
    expect(m.trend.at(-1)).toEqual({ day: '2026-10-14', reach: 100, views: 200 });
    expect(m.trend[0]).toEqual({ day: '2026-09-15', reach: null, views: null }); // before the 20 days of data
  });

  it('top posts: at most 10, by reach, posts without reach left out, caption snippet kept as text', () => {
    const d = sampleData();
    d.posts[A] = Array.from({ length: 15 }, (_, i) => post(`x${i}`, A, { reach: i * 10, caption: `=cap ${i}` }));
    const m = build(params(), d);
    expect(m.topPosts).toHaveLength(TOP_POSTS);
    expect(m.topPosts[0]).toMatchObject({ id: 'x14', reach: 140, username: 'brand.one', caption: '=cap 14' }); // React escapes; no formula risk in a PDF
    expect(build().topPosts.map((x) => x.id)).toEqual(['p1']); // p2 has no reach
  });

  it('formats, tags (+ untagged) and best time come from the dashboard analysis', () => {
    const m = build();
    expect(m.formats.map((f) => f.mediaType)).toEqual(['REELS', 'IMAGE']);
    expect(m.tags).toEqual([{ name: '=evil tag', color: 'chart-2', stat: { posts: 1, measured: 1, avgReach: 100, engagementRate: 0.16, reason: 'few_posts' } }]);
    expect(m.untagged.posts).toBe(1);
    expect(m.bestTime.online.reason).toBe('needs_100_followers');
    expect(m.bestTime.posts.rows[0].weekday).toBe(1); // week starts Monday
  });

  it('audience without the globe, stories summary and flags per account', () => {
    const m = build();
    expect(m.audience[0].model.countries?.rows[0]).toMatchObject({ key: 'MY', share: 0.6 });
    expect('globe' in m.audience[0].model).toBe(false);
    expect(m.audience[1].model.reason).toBe('needs_100_followers');
    expect(m.stories).toEqual([
      { username: 'brand.one', count: 1, avgReach: 40, avgViews: 50, avgExitRate: 0.1 },
      { username: '=brand\u{1F600}/two', count: 0, avgReach: null, avgViews: null, avgExitRate: null },
    ]);
    expect(m.flags).toEqual([]);
  });

  it('no accounts at all: a valid, empty model', () => {
    const m = build(params({ scope: { kind: 'all' } }), { accounts: [], scope: scopeOf(), sync: {}, daily: {}, posts: {}, stories: {}, audience: {}, online: {}, tags: [] });
    expect(m.kpis.reach.value).toBeNull();
    expect(m.topPosts).toEqual([]);
    expect(isReportModel(JSON.parse(JSON.stringify(m)))).toBe(true); // survives the trip into the headless page
  });

  it('isReportModel rejects anything else', () => {
    for (const v of [null, undefined, 'x', 1, [], {}, { v: 2 }, { ...build(), v: '1' }, { ...build(), sections: 'kpis' }]) expect(isReportModel(v)).toBe(false);
    expect(isReportModel(build())).toBe(true);
  });

  it('is deterministic and holds no secrets', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    expect(JSON.stringify(build())).not.toMatch(/token|secret/i);
  });
});
