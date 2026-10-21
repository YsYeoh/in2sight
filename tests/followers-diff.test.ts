import { describe, expect, it } from 'vitest';
import { byRecent, defaultList, diffSnapshots, filterList, FOLLOWER_PAGE, followersView, pageList, sinceKey, type Snapshot } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';

const p = (username: string, at: number | null = null): Person => ({ username, at });
const names = (l: Person[] | null) => (l === null ? null : l.map((x) => x.username).sort());

// older: a, b, c follow you. newer: b, c, d, e follow you; you follow c, d, x.
const older: Snapshot = { followers: [p('a', 10), p('b', 20), p('c', 30)], following: [p('c', 5)] };
const newer: Snapshot = { followers: [p('b', 20), p('c', 30), p('d', 40), p('e', 50)], following: [p('c', 31), p('d', 41), p('x', 42)] };

describe('diffSnapshots', () => {
  it('the five lists by name', () => {
    const d = diffSnapshots(newer, older);
    expect(names(d.new)).toEqual(['d', 'e']);
    expect(names(d.lost)).toEqual(['a']);
    expect(names(d.theyDontFollow)).toEqual(['x']);
    expect(names(d.iDontFollow)).toEqual(['b', 'e']);
    expect(names(d.mutual)).toEqual(['c', 'd']);
  });

  it('each person keeps the time from the file the list comes from', () => {
    const d = diffSnapshots(newer, older);
    expect(d.lost).toEqual([p('a', 10)]); // when a had followed (older followers)
    expect(d.theyDontFollow).toEqual([p('x', 42)]); // when you followed x (newer following)
    expect(d.mutual).toEqual([p('c', 30), p('d', 40)]); // when they followed you
  });

  it('unavailable lists are null: no older snapshot → no new/lost; no following.json → no follow-back lists', () => {
    const first = diffSnapshots(newer, null);
    expect([first.new, first.lost]).toEqual([null, null]);
    expect(names(first.mutual)).toEqual(['c', 'd']);
    const noFollowing = diffSnapshots({ followers: newer.followers, following: null }, older);
    expect([noFollowing.theyDontFollow, noFollowing.iDontFollow, noFollowing.mutual]).toEqual([null, null, null]);
    expect(names(noFollowing.new)).toEqual(['d', 'e']);
    // the OLDER snapshot's following.json is never needed
    expect(names(diffSnapshots(newer, { followers: older.followers, following: null }).lost)).toEqual(['a']);
  });

  it('identical snapshots: nobody new, nobody lost', () => {
    const d = diffSnapshots(newer, newer);
    expect([d.new, d.lost]).toEqual([[], []]);
  });

  it('defaultList: the changes when there is a comparison, else who doesn\'t follow back; sinceKey per list', () => {
    expect(defaultList(diffSnapshots(newer, older))).toBe('new');
    expect(defaultList(diffSnapshots(newer, null))).toBe('theyDontFollow');
    expect(defaultList(diffSnapshots({ followers: newer.followers, following: null }, null))).toBe('new');
    expect(sinceKey('theyDontFollow')).toBe('youFollowed');
    for (const l of ['new', 'lost', 'iDontFollow', 'mutual'] as const) expect(sinceKey(l)).toBe('followedYou');
  });

  it('50,000 × 50,000 with 7,500 following: correct counts, fast (Sets, no nested loops)', () => {
    const N = 50_000;
    const big = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => p(`user.${from + i}`, 1_700_000_000 + from + i));
    const a: Snapshot = { followers: big(0, N), following: null };
    const b: Snapshot = { followers: big(1_000, N + 1_000), following: big(40_000, 47_500) };
    const t0 = performance.now();
    const d = diffSnapshots(b, a);
    const page = pageList(d.iDontFollow!, 'user.4', 3);
    const ms = performance.now() - t0;
    expect([d.new!.length, d.lost!.length, d.theyDontFollow!.length, d.iDontFollow!.length, d.mutual!.length]).toEqual([1_000, 1_000, 0, 42_500, 7_500]);
    expect(page.rows).toHaveLength(FOLLOWER_PAGE);
    expect(ms).toBeLessThan(1_500); // ~30 ms on a laptop; generous for a loaded CI machine
  });
});

describe('ordering, search, pages', () => {
  const people = [p('zoe', 100), p('amy', null), p('bob', 300), p('cat', 300), p('dan', null), p('eve', 200)];

  it('byRecent: newest follow first, unknown times last, ties by name', () => {
    expect([...people].sort(byRecent).map((x) => x.username)).toEqual(['bob', 'cat', 'eve', 'zoe', 'amy', 'dan']);
  });

  it('filterList: a substring of the username, sorted; never mutates its input', () => {
    const before = people.map((x) => x.username);
    expect(filterList(people, 'a').map((x) => x.username)).toEqual(['cat', 'amy', 'dan']);
    expect(filterList(people, '').map((x) => x.username)).toEqual(['bob', 'cat', 'eve', 'zoe', 'amy', 'dan']);
    expect(people.map((x) => x.username)).toEqual(before);
  });

  it('pageList: pages of the given size, the total after the search, a stale page shows page 1, an empty list is one page', () => {
    expect(pageList(people, '', 2, 4)).toEqual({ rows: [p('amy', null), p('dan', null)], total: 6, page: 2, pages: 2 });
    expect(pageList(people, '', 9, 4)).toMatchObject({ page: 1, pages: 2, total: 6 });
    expect(pageList(people, 'zz', 1, 4)).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
    expect(pageList(Array.from({ length: 120 }, (_, i) => p(`u${i}`, i)), '', 3)).toMatchObject({ total: 120, page: 3, pages: 3 });
  });
});

describe('followersView', () => {
  it('the default list, the size of every list (null = unavailable) and one page of the chosen list', () => {
    expect(followersView(newer, older, { list: null, q: '', page: 1 })).toEqual({
      list: 'new',
      counts: { new: 2, lost: 1, theyDontFollow: 1, iDontFollow: 2, mutual: 2 },
      page: { rows: [p('e', 50), p('d', 40)], total: 2, page: 1, pages: 1 },
    });
    expect(followersView(newer, null, { list: 'mutual', q: 'c', page: 1 })).toEqual({
      list: 'mutual',
      counts: { new: null, lost: null, theyDontFollow: 1, iDontFollow: 2, mutual: 2 },
      page: { rows: [p('c', 30)], total: 1, page: 1, pages: 1 },
    });
  });

  it('a list the snapshots cannot answer has no page', () => {
    expect(followersView(newer, null, { list: 'lost', q: '', page: 1 })).toMatchObject({ list: 'lost', page: null });
  });
});
