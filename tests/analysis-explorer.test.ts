import { describe, expect, it } from 'vitest';
import { addParts, breadcrumbs, bucketsOf, buildExplorer, byGroup, drillHref, drillTarget, explorerWindow, itemParts, settledDay, toKpi, type ExplorerInput, type ScopeAccount } from '@/lib/analysis/explorer';
import type { ItemRow } from '@/lib/explorer/read';
import { parseExplorerState } from '@/lib/explorer/state';
import type { DailyParts, Parts, PostParts } from '@/lib/metrics';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const ACCOUNTS: ScopeAccount[] = [
  { id: A, username: 'alpha', groupName: 'Food' },
  { id: B, username: 'beta', groupName: 'Food' },
  { id: C, username: 'gamma', groupName: null },
];
const d = (o: Partial<DailyParts> = {}): DailyParts => ({ reach: null, views: null, interactions: null, erInteractions: null, erReach: null, netFollows: null, followers: null, ...o });
const p = (o: Partial<PostParts> = {}): PostParts => ({ posts: 0, measured: 0, reachSum: null, viewsSum: null, viewsN: 0, likes: null, comments: null, saves: null, shares: null, erInteractions: null, erReach: null, ...o });
const parts = (daily: Partial<DailyParts> | null, posts: Partial<PostParts> | null = null): Parts => ({ daily: daily && d(daily), posts: posts && p(posts) });
const TODAY = '2026-10-17';
const W = { current: { from: '2026-09-17', to: '2026-10-16' }, compare: { from: '2026-08-18', to: '2026-09-16' } };
const input = (o: Partial<ExplorerInput>): ExplorerInput => ({ state: parseExplorerState({}), window: W, current: new Map(), prior: null, accounts: ACCOUNTS, items: [], gran: 'day', weekStart: 'mon', ...o });

describe('toKpi', () => {
  it('relative change, zero base, missing sides', () => {
    expect(toKpi(120, 100)).toEqual({ value: 120, prior: 100, diff: 20, change: 0.2, reason: null });
    expect(toKpi(5, 0)).toMatchObject({ diff: 5, change: null });
    expect(toKpi(0, 0)).toMatchObject({ diff: 0, change: 0 });
    expect(toKpi(5, null)).toEqual({ value: 5, prior: null, diff: null, change: null, reason: null });
    expect(toKpi(null, 3)).toEqual({ value: null, prior: 3, diff: null, change: null, reason: 'no_data' });
  });
});

describe('addParts / byGroup', () => {
  it('adds sums and counts; null + number keeps the number; a missing side keeps the other', () => {
    const x = addParts(parts({ reach: 10, followers: 100 }, { posts: 2, measured: 1, reachSum: 50, viewsN: 1 }), parts({ reach: null, followers: 50, netFollows: 3 }, null));
    expect(x.daily).toEqual(d({ reach: 10, followers: 150, netFollows: 3 }));
    expect(x.posts).toEqual(p({ posts: 2, measured: 1, reachSum: 50, viewsN: 1 }));
  });

  it('named groups combine their accounts; an isolated account stays its own row', () => {
    const rows = new Map([[A, parts({ reach: 10, erInteractions: 1, erReach: 10 })], [B, parts({ reach: 30, erInteractions: 9, erReach: 30 })], [C, parts({ reach: 5 })]]);
    const g = byGroup(rows, ACCOUNTS);
    expect([...g.keys()]).toEqual(['g:Food', `a:${C}`]);
    expect(g.get('g:Food')!.daily).toMatchObject({ reach: 40, erInteractions: 10, erReach: 40 }); // ER of the group = 10 / 40, not the mean of 10 % and 30 %
  });
});

describe('itemParts', () => {
  it('a single post uses the rollup rules: measured needs reach > 0, Stories never count for engagement', () => {
    const post: ItemRow = { id: 'm1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: null, reach: 200, views: null, likes: 10, comments: 5, saves: null, shares: 1 };
    expect(itemParts(post).posts).toEqual(p({ posts: 1, measured: 1, reachSum: 200, viewsSum: null, viewsN: 0, likes: 10, comments: 5, shares: 1, erInteractions: 16, erReach: 200 }));
    expect(itemParts({ ...post, mediaType: 'STORY' }).posts).toMatchObject({ erInteractions: null, erReach: null });
    expect(itemParts({ ...post, reach: 0 }).posts).toMatchObject({ measured: 0, reachSum: null, erReach: null });
  });
});

describe('windows', () => {
  it('settled day: the newest done-through day within the lag, else yesterday', () => {
    expect(settledDay(['2026-10-15', '2026-10-14', null], TODAY)).toBe('2026-10-15');
    expect(settledDay(['2026-10-10'], TODAY)).toBe('2026-10-16'); // stale: yesterday, its gap shows
    expect(settledDay([], TODAY)).toBe('2026-10-16');
    expect(settledDay(['2026-10-17'], TODAY)).toBe('2026-10-16'); // today is never settled
  });

  it('rolling presets end on the settled day; fixed ranges are cut there; comparison from 12a compareRange', () => {
    const r30 = resolveScope(parseTimeScope({}), TODAY, '2026-01-01');
    expect(explorerWindow(r30, '2026-10-15')).toEqual({ current: { from: '2026-09-16', to: '2026-10-15' }, compare: { from: '2026-08-17', to: '2026-09-15' } });
    const oct = resolveScope(parseTimeScope({ month: '2026-10' }), TODAY, '2026-01-01');
    expect(explorerWindow(oct, '2026-10-15')).toEqual({ current: { from: '2026-10-01', to: '2026-10-15' }, compare: { from: '2026-09-01', to: '2026-09-15' } });
    const none = resolveScope(parseTimeScope({ from: '7d', cmp: 'none' }), TODAY, '2026-01-01');
    expect(explorerWindow(none, '2026-10-16').compare).toBeNull();
  });

  it('bucketsOf lists every bucket touching the range (weeks on the week start, months)', () => {
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-14' }, 'week', 'mon')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-14' }, 'week', 'sun')).toEqual(['2026-09-27', '2026-10-04', '2026-10-11']);
    expect(bucketsOf({ from: '2025-11-15', to: '2026-02-01' }, 'month', 'mon')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    expect(bucketsOf({ from: '2026-10-01', to: '2026-10-03' }, 'day', 'mon')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });
});

describe('buildExplorer', () => {
  it('by account: every account in scope (no data = null, never 0), ranked by the chart metric, compared by key', () => {
    const m = buildExplorer(input({
      state: parseExplorerState({ m: 'reach,posts', by: 'account' }),
      current: new Map([[A, parts({ reach: 100 }, { posts: 3 })], [B, parts({ reach: 300 }, null)]]),
      prior: new Map([[A, parts({ reach: 80 }, { posts: 3 })]]),
    }));
    expect(m.rows.map((r) => r.key)).toEqual([B, A, C]);
    expect(m.rows[1].values.reach).toMatchObject({ value: 100, prior: 80, change: 0.25 });
    expect(m.rows[0].values.reach).toMatchObject({ value: 300, prior: null });
    expect(m.rows[0].values.posts).toMatchObject({ value: null, reason: 'no_data' });
    expect(m.rows[2].values.reach?.value).toBeNull();
  });

  it('by group: sums the accounts first, then computes ratios', () => {
    const m = buildExplorer(input({
      state: parseExplorerState({ m: 'engagementRate', by: 'group' }),
      current: new Map([[A, parts({ erInteractions: 1, erReach: 10 })], [B, parts({ erInteractions: 9, erReach: 30 })], [C, parts({ erInteractions: 1, erReach: 100 })]]),
    }));
    expect(m.rows.map((r) => [r.key, r.values.engagementRate?.value])).toEqual([['g:Food', 0.25], [`a:${C}`, 0.01]]);
  });

  it('by time: every bucket of the range, partial ones flagged, the comparison aligned by position', () => {
    const state = parseExplorerState({ m: 'reach', by: 'time' });
    const window = { current: { from: '2026-10-01', to: '2026-10-14' }, compare: { from: '2026-09-17', to: '2026-09-30' } };
    const m = buildExplorer(input({ state, window, gran: 'week', current: new Map([['2026-10-05', parts({ reach: 70 })]]), prior: new Map([['2026-09-21', parts({ reach: 35 })]]) }));
    expect(m.rows.map((r) => [r.key, r.priorKey])).toEqual([['2026-09-28', '2026-09-14'], ['2026-10-05', '2026-09-21'], ['2026-10-12', '2026-09-28']]);
    expect(m.rows[1].values.reach).toMatchObject({ value: 70, prior: 35, change: 1 });
    expect(m.partial).toEqual(['2026-09-28', '2026-10-12']);
  });

  it('weekday and hour axes are complete and ordered; tags put untagged last; formats only when present', () => {
    const state = (by: string) => parseExplorerState({ m: 'posts', by });
    expect(buildExplorer(input({ state: state('weekday'), weekStart: 'sun' })).rows.map((r) => r.key)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(buildExplorer(input({ state: state('hour') })).rows).toHaveLength(24);
    const tags = buildExplorer(input({ state: state('tag'), current: new Map([['untagged', parts(null, { posts: 9 })], ['t1', parts(null, { posts: 2 })]]) }));
    expect(tags.rows.map((r) => r.key)).toEqual(['t1', 'untagged']); // ranked by posts would put untagged first: it is always last
    const f = buildExplorer(input({ state: state('format'), current: new Map([['STORY', parts(null, { posts: 1 })], ['REELS', parts(null, { posts: 2 })]]) }));
    expect(f.rows.map((r) => r.key)).toEqual(['REELS', 'STORY']);
  });

  it('single posts: one row per item, no comparison', () => {
    const it: ItemRow = { id: 'm1', accountId: A, mediaType: 'IMAGE', postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: 'x', reach: 50, views: 80, likes: 4, comments: 1, saves: 0, shares: 0 };
    const m = buildExplorer(input({ state: parseExplorerState({ m: 'avgReach,postEngagementRate', by: 'post' }), items: [it] }));
    expect(m.rows).toEqual([{ key: 'm1', priorKey: null, values: { avgReach: toKpi(50, null), postEngagementRate: toKpi(0.1, null) } }]);
  });
});

describe('drill-down', () => {
  const r = resolveScope(parseTimeScope({ from: '90d', cmp: 'yoy' }), TODAY, '2026-01-01');

  it('goes one level deeper and keeps the scope', () => {
    const s = parseExplorerState({ m: 'reach,likes', by: 'group' });
    expect(drillHref(s, 'g:Food', r)).toBe('/explorer?m=reach%2Clikes&by=account&grp=Food&from=90d&cmp=yoy');
    expect(drillHref(s, `a:${C}`, r)).toBe(`/explorer?m=likes&by=format&acc=${C}&from=90d&cmp=yoy`);
    expect(drillTarget(parseExplorerState({ by: 'account' }), A, 'day')?.state).toMatchObject({ accounts: [A], by: 'format' });
    expect(drillTarget(parseExplorerState({ by: 'format' }), 'REELS', 'day')?.state).toMatchObject({ format: 'REELS', by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'weekday' }), '3', 'day')?.state).toMatchObject({ weekday: 3, by: 'hour' });
    expect(drillTarget(parseExplorerState({ by: 'hour' }), '20', 'day')?.state).toMatchObject({ hour: 20, by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'tag' }), 'untagged', 'day')?.state).toMatchObject({ tag: 'untagged', by: 'post' });
    expect(drillTarget(parseExplorerState({ by: 'post' }), '42', 'day')?.state).toMatchObject({ item: '42' });
  });

  it('a time bucket becomes the new fixed range one granularity finer; a day lists its posts', () => {
    const s = parseExplorerState({ m: 'reach', by: 'time' });
    expect(drillHref(s, '2026-09-01', { ...r, gran: 'month' })).toBe('/explorer?m=reach&by=time&from=2026-09-01&to=2026-09-30&cmp=yoy&gran=week');
    expect(drillHref(s, '2026-09-07', { ...r, gran: 'week' })).toBe('/explorer?m=reach&by=time&from=2026-09-07&to=2026-09-13&cmp=yoy&gran=day');
    expect(drillHref(s, '2026-09-08', { ...r, gran: 'day' })).toBe('/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&from=2026-09-08&to=2026-09-08&cmp=yoy');
  });

  it('breadcrumbs rebuild each level from the URL and keep the scope', () => {
    const s = parseExplorerState({ m: 'likes', by: 'post', grp: 'Food', acc: A, fmt: 'REELS', item: '42' });
    const c = breadcrumbs(s, { query: 'from=90d', hasGroups: true });
    expect(c.map((x) => [x.kind, x.key])).toEqual([['all', ''], ['group', 'Food'], ['account', A], ['format', 'REELS'], ['item', '42']]);
    expect(c[0].href).toBe('/explorer?m=likes&by=group&from=90d');
    expect(c[2].href).toBe(`/explorer?m=likes&by=format&acc=${A}&grp=Food&from=90d`);
    expect(breadcrumbs(parseExplorerState({}), { query: '', hasGroups: false })).toEqual([{ kind: 'all', key: '', href: '/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account' }]);
  });
});
