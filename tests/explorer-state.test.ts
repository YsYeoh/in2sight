import { describe, expect, it } from 'vitest';
import { explorerHref, explorerParams, MAX_ACCOUNTS, parseExplorerState, usable, withState } from '@/lib/explorer/state';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

describe('parseExplorerState', () => {
  it('nothing in the URL: accounts compared on account totals', () => {
    expect(parseExplorerState({})).toEqual({ metrics: ['reach', 'engagementRate', 'posts', 'avgReach'], chart: 'reach', by: 'account', accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
  });

  it('keeps valid values in the given order, drops duplicates, caps metrics at 4', () => {
    const s = parseExplorerState({ m: 'likes,reach,likes,shares,views', chart: 'shares', by: 'time', acc: `${A.toUpperCase()},${B},${A}`, grp: 'Food', item: '17895695668004550' });
    expect(s).toEqual({ metrics: ['likes', 'reach', 'shares', 'views'], chart: 'shares', by: 'time', accounts: [A, B], group: 'Food', format: null, tag: null, weekday: null, hour: null, item: '17895695668004550' });
    const f = parseExplorerState({ m: 'likes,saves,comments,shares,posts', by: 'hour', fmt: 'REELS', tag: B, wd: '3', hr: '20' });
    expect(f).toMatchObject({ metrics: ['likes', 'saves', 'comments', 'shares'], format: 'REELS', tag: B, weekday: 3, hour: 20 });
  });

  it('metrics the dimension cannot show are dropped (account totals have no format); none left = the defaults', () => {
    expect(parseExplorerState({ m: 'reach,likes', by: 'format' }).metrics).toEqual(['likes']);
    expect(parseExplorerState({ m: 'reach,views', by: 'hour' }).metrics).toEqual(['posts', 'avgReach', 'postEngagementRate']);
  });

  it('a format, tag, weekday or hour filter also drops account totals (they cannot be narrowed to content)', () => {
    expect(parseExplorerState({ m: 'reach,likes', by: 'account', fmt: 'REELS' }).metrics).toEqual(['likes']);
    expect(parseExplorerState({ m: 'reach', by: 'time', tag: 'untagged' }).metrics).toEqual(['posts', 'avgReach', 'postEngagementRate']);
    expect(parseExplorerState({ m: 'reach,likes', by: 'account', hr: '9' }).metrics).toEqual(['likes']);
    expect(usable('reach', { by: 'account', format: null, tag: null, weekday: null, hour: null })).toBe(true);
    expect(usable('reach', { by: 'account', format: null, tag: null, weekday: 0, hour: null })).toBe(false);
  });

  it('hostile or malformed values fall back per part and never throw', () => {
    const s = parseExplorerState({
      m: ['reach', 'posts'], by: 'drop table', chart: 'toString', acc: `x,${"'; select 1 --"},${A}`, grp: ' Food ', fmt: 'reels',
      tag: '../etc', wd: '7', hr: '-1', item: 'a/b',
    });
    expect(s).toEqual({ metrics: ['reach', 'engagementRate', 'posts', 'avgReach'], chart: 'reach', by: 'account', accounts: [A], group: null, format: null, tag: null, weekday: null, hour: null, item: null });
    expect(parseExplorerState({ wd: '03', hr: '024', tag: 'untagged', m: '__proto__,constructor' })).toMatchObject({ weekday: 3, hour: null, tag: 'untagged', metrics: ['posts', 'avgReach', 'postEngagementRate'] });
  });

  it('caps the account list', () => {
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(parseExplorerState({ acc: many.join(',') }).accounts).toHaveLength(MAX_ACCOUNTS);
  });
});

describe('explorerParams', () => {
  it('round-trips and omits defaults (chart = first metric, empty filters)', () => {
    const s = parseExplorerState({ m: 'posts,likes', by: 'tag', tag: 'untagged', wd: '0' });
    expect(explorerParams(s).toString()).toBe('m=posts%2Clikes&by=tag&tag=untagged&wd=0');
    expect(parseExplorerState(Object.fromEntries(explorerParams(s)))).toEqual(s);
    const full = parseExplorerState({ m: 'likes,reach', chart: 'reach', by: 'time', acc: `${A},${B}`, grp: 'Food & Co', fmt: 'STORY', hr: '9', item: '42' });
    expect(parseExplorerState(Object.fromEntries(explorerParams(full)))).toEqual(full);
  });
});

describe('explorerHref', () => {
  it('appends the Time Scope query when there is one', () => {
    const s = parseExplorerState({ m: 'posts', by: 'hour' });
    expect(explorerHref(s, '')).toBe('/explorer?m=posts&by=hour');
    expect(explorerHref(s, 'from=90d&cmp=yoy')).toBe('/explorer?m=posts&by=hour&from=90d&cmp=yoy');
  });
});

describe('withState', () => {
  it('changing the dimension drops metrics it cannot show and keeps the chart metric when possible', () => {
    const s = parseExplorerState({ m: 'reach,likes,posts', chart: 'likes', by: 'account' });
    expect(withState(s, { by: 'format' })).toMatchObject({ by: 'format', metrics: ['likes', 'posts'], chart: 'likes' });
    expect(withState(parseExplorerState({ m: 'reach', by: 'time' }), { by: 'hour' })).toMatchObject({ metrics: ['posts', 'avgReach', 'postEngagementRate'], chart: 'posts' });
    expect(withState(parseExplorerState({ m: 'reach,likes' }), { format: 'REELS' }).metrics).toEqual(['likes']);
  });
});
