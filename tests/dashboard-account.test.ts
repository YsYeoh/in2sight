import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildAccountOverview, parseTab, poolFor, type AccountOverviewInput } from '@/lib/dashboard/account';
import { addDays } from '@/lib/sync/time';

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur';
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000 + i, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const post = (id: string, postedAt: string, reach: number, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: 10, comments: null, shares: null, saves: null, ...o });
const empty: AccountOverviewInput = { account: acct('a1'), sync: undefined, daily: [], posts: [], online: [], pooled: { accounts: 1, posts: [], online: [] } };
const opts = { period: 7 as const, today: TODAY, now: NOW, tz: KL, weekStart: 'mon' as const };

describe('parseTab', () => {
  it('accepts the four tabs only (tab param injection falls back to overview)', () => {
    expect(['overview', 'posts', 'stories', 'audience'].map(parseTab)).toEqual(['overview', 'posts', 'stories', 'audience']);
    for (const bad of [undefined, '', 'POSTS', 'settings', '<script>alert(1)</script>', 'posts ', ['posts', 'audience'], 42, '__proto__', 'constructor']) expect(parseTab(bad)).toBe('overview');
  });
});

describe('poolFor', () => {
  it('pools the group, or every live account for an isolated one; archived never', () => {
    const list = [acct('a', { groupName: 'G' }), acct('b', { groupName: 'G' }), acct('c'), acct('d', { groupName: 'G', status: 'archived' })];
    expect(poolFor(list[0], list).map((a) => a.id)).toEqual(['a', 'b']);
    expect(poolFor(list[2], list).map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildAccountOverview', () => {
  it('KPIs with comparison, a trend over the window, formats, heatmaps, flags and sync status', () => {
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100));
    const hit = post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS', permalink: 'https://www.instagram.com/reel/hit/' });
    const m = buildAccountOverview(
      { ...empty, sync: { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: 'rate_limited', consecutiveFailures: 1, dailyDoneThrough: '2026-10-14' }, daily: days(14, 100), posts: [...history, hit], online: [{ day: '2026-10-12', hourly: Array(24).fill(5) }], pooled: { accounts: 2, posts: [...history, hit, post('x', '2026-10-01T02:00:00Z', 50, { accountId: 'a2' })], online: [] } },
      opts,
    );
    expect(m.state).toBe('ok');
    expect(m.kpis.reach).toMatchObject({ value: 700, change: 0 });
    expect(m.trend).toHaveLength(7);
    expect(m.trend[6]).toEqual({ day: '2026-10-14', reach: 100, views: 200, followers: 1013 });
    expect(m.formats.map((f) => f.mediaType)).toEqual(['REELS', 'IMAGE']);
    expect(m.heat.online.account.reason).toBeNull();
    expect(m.heat.online.pooled.reason).toBe('needs_100_followers');
    expect(m.heat.posts.pooled.sample).toBe(8);
    expect(m.pooledAccounts).toBe(2);
    expect(m.flags).toEqual([expect.objectContaining({ kind: 'taking_off', postId: 'hit' })]);
    expect(m.lastSyncedAt).toBe('2026-10-15T03:00:00Z');
    expect(m.syncErrorKey).toBe('rate_limited');
  });

  it('account with no data yet: reasons everywhere, no NaN, backfilling state', () => {
    const m = buildAccountOverview(empty, opts);
    expect(m.state).toBe('backfilling');
    expect(m.kpis.reach).toMatchObject({ value: null, reason: 'no_data' });
    expect(m.trend.every((d) => d.reach === null && d.followers === null)).toBe(true);
    expect(m.formats).toEqual([]);
    expect(m.heat.online.account.reason).toBe('needs_100_followers');
    expect(m.heat.posts.account.reason).toBe('not_enough_posts');
    expect(m.flags).toEqual([]);
    expect(m.syncErrorKey).toBeNull();
    for (const k of Object.values(m.kpis)) for (const v of [k.value, k.diff, k.change]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
  });

  it('a needs_reconnect account says so', () => {
    expect(buildAccountOverview({ ...empty, account: acct('a1', { status: 'needs_reconnect' }) }, opts).state).toBe('needs_reconnect');
  });
});
