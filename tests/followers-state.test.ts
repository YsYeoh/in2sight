import { describe, expect, it } from 'vitest';
import { FOLLOWER_KEYS, followerHref, parseFollowerState, resolvePair, staleDays, type FollowerState, type SnapshotMeta } from '@/lib/followers/state';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const meta = (n: number, takenOn: string): SnapshotMeta => ({ id: id(n), takenOn, followerCount: 100 + n, followingCount: n === 2 ? null : 50, createdAt: `${takenOn}T10:00:00Z` });
// newest first, as listFollowerSnapshots returns them
const SNAPS = [meta(3, '2026-10-20'), meta(2, '2026-09-20'), meta(1, '2026-08-20')];
const BASE: FollowerState = { snap: null, vs: null, list: null, q: '', page: 1 };

describe('parseFollowerState', () => {
  it('nothing in the URL → every default', () => {
    expect(parseFollowerState({}, SNAPS)).toEqual(BASE);
  });

  it('keeps valid values (ids lower-cased), drops everything else', () => {
    expect(parseFollowerState({ snap: id(2).toUpperCase(), vs: id(1), list: 'lost', q: '  @Some.User ', page: '3' }, SNAPS)).toEqual({ snap: id(2), vs: id(1), list: 'lost', q: 'some.user', page: 3 });
    expect(parseFollowerState({ snap: id(9), vs: 'not-a-uuid', list: 'everyone', page: '0' }, SNAPS)).toEqual(BASE);
    expect(parseFollowerState({ snap: [id(2), id(1)], list: ['new', 'lost'], page: '1.5' }, SNAPS)).toEqual(BASE);
    expect(parseFollowerState({ list: '__proto__', page: '-2' }, SNAPS)).toEqual(BASE);
  });

  it('a snapshot compared with itself is no comparison; the search is cut at 30 characters without spaces', () => {
    expect(parseFollowerState({ snap: id(2), vs: id(2) }, SNAPS)).toMatchObject({ snap: id(2), vs: null });
    expect(parseFollowerState({ q: `a b ${'c'.repeat(40)}` }, SNAPS).q).toBe(`ab${'c'.repeat(28)}`);
  });
});

describe('resolvePair', () => {
  const pair = (s: Partial<FollowerState>) => {
    const r = resolvePair({ ...BASE, ...s }, SNAPS);
    return [r.newer?.id ?? null, r.older?.id ?? null];
  };

  it('defaults: the newest against the one just before', () => {
    expect(pair({})).toEqual([id(3), id(2)]);
    expect(pair({ snap: id(2) })).toEqual([id(2), id(1)]);
    expect(pair({ snap: id(1) })).toEqual([id(1), null]); // the oldest has nothing before it
  });

  it('any two snapshots, always in date order', () => {
    expect(pair({ snap: id(3), vs: id(1) })).toEqual([id(3), id(1)]);
    expect(pair({ snap: id(1), vs: id(3) })).toEqual([id(3), id(1)]);
    expect(pair({ vs: id(1) })).toEqual([id(3), id(1)]);
    expect(pair({ vs: id(3) })).toEqual([id(3), id(2)]); // vs = the default newer: compare with the one before
  });

  it('one snapshot → no comparison; none → nothing', () => {
    expect(resolvePair(BASE, [SNAPS[0]])).toEqual({ newer: SNAPS[0], older: null });
    expect(resolvePair(BASE, [])).toEqual({ newer: null, older: null });
  });
});

describe('followerHref', () => {
  const keep = { from: '2026-09-01', to: '2026-09-30' };

  it('the tab first, defaults omitted, the Time Scope kept untouched', () => {
    expect(followerHref(BASE, {}, keep)).toBe('?tab=followers&from=2026-09-01&to=2026-09-30');
    expect(followerHref({ ...BASE, snap: id(3), vs: id(1), list: 'lost', q: 'ann' }, {}, keep)).toBe(`?tab=followers&snap=${id(3)}&vs=${id(1)}&list=lost&q=ann&from=2026-09-01&to=2026-09-30`);
  });

  it('writes only FOLLOWER_KEYS (and tab) of its own', () => {
    const href = followerHref({ snap: id(3), vs: id(1), list: 'lost', q: 'ann', page: 2 }, { page: 2 });
    expect([...new URLSearchParams(href.slice(1)).keys()]).toEqual(['tab', ...FOLLOWER_KEYS]);
  });

  it('any change goes back to page 1; only a page link carries page; the scope never overrides the tab', () => {
    const s = { ...BASE, list: 'new' as const, page: 4 };
    expect(followerHref(s, { list: 'mutual' })).toBe('?tab=followers&list=mutual');
    expect(followerHref(s, { page: 5 })).toBe('?tab=followers&list=new&page=5');
    expect(followerHref(s, { q: '' }, { tab: 'posts' })).toBe('?tab=followers&list=new');
  });
});

describe('staleDays', () => {
  it('the newest export\'s age when it is more than 30 days, else null', () => {
    expect(staleDays(SNAPS, '2026-11-19')).toBeNull(); // 30 days
    expect(staleDays(SNAPS, '2026-11-20')).toBe(31);
    expect(staleDays([], '2026-11-20')).toBeNull();
  });
});
