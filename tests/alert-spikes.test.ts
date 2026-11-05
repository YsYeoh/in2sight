import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateRules, nonFollowerShares, spikeDays, type RuleInput } from '@/lib/alerts/rules';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import type { DailyRow } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const NOW = new Date('2026-10-14T12:00:00Z'); // UTC: today 2026-10-14, checked days 10-13 and 10-12
const SPIKE_DAY = '2026-10-13';
const HISTORY = [18, 20, 22, 19, 21, 20, 23, 17]; // non-follower share % on the same weekday 1..8 weeks before (median 20)

type B = { day: string; followType: string; value: number };
const day = (share: number, d: string, total = 100): B[] => [
  { day: d, followType: 'FOLLOWER', value: Math.round((total * (100 - share)) / 100) },
  { day: d, followType: 'NON_FOLLOWER', value: Math.round((total * share) / 100) },
  { day: d, followType: 'UNKNOWN', value: 999 }, // neither: ignored
];
const breakdown = (spike: number, total = 100, weeks = 8): B[] => [...day(spike, SPIKE_DAY, total), ...HISTORY.slice(0, weeks).flatMap((s, i) => day(s, addDays(SPIKE_DAY, -7 * (i + 1))))];

const input = (o: Partial<RuleInput> = {}): RuleInput => ({
  account: { id: 'a1', username: 'cafe', status: 'active', tokenExpiresAt: null },
  sync: { consecutiveFailures: 0, lastSuccessAt: '2026-10-14T11:30:00.000Z' },
  daily: [],
  posts: [],
  lastReachDropAt: null,
  settings: DEFAULT_ALERT_SETTINGS,
  now: NOW,
  tz: 'UTC',
  ...o,
});
const spikes = (i: RuleInput) => evaluateRules(i).filter((a) => a.kind === 'nonfollower_spike' || a.kind === 'unfollow_spike');

describe('spikeDays', () => {
  it('yesterday and the day before, each with the same weekday of the 8 weeks before: 18 days', () => {
    const days = spikeDays('2026-10-14');
    expect(days).toHaveLength(18);
    expect(days.slice(0, 3)).toEqual(['2026-10-13', '2026-10-06', '2026-09-29']);
    expect(days).toContain('2026-08-18'); // 10-13 minus 8 weeks
    expect(days).toContain('2026-08-17'); // 10-12 minus 8 weeks
    expect(days).not.toContain('2026-10-14'); // today is partial
  });
});

describe('nonFollowerShares', () => {
  it('share of reach from non-followers in percent; UNKNOWN ignored; under 50 reached people the day has no share', () => {
    expect(nonFollowerShares(day(25, '2026-10-13'))).toEqual({ '2026-10-13': 25 });
    expect(nonFollowerShares(day(25, '2026-10-13', 40))).toEqual({ '2026-10-13': null });
    expect(nonFollowerShares([])).toEqual({});
  });
});

describe('nonfollower_spike rule', () => {
  it('an unusual upward share on a checked day alerts once for that day, with whole-percent numbers', () => {
    expect(spikes(input({ reachByFollow: breakdown(60) }))).toEqual([
      { kind: 'nonfollower_spike', accountId: 'a1', severity: 'info', dedupeKey: 'nonfollower_spike:a1:2026-10-13', payload: { username: 'cafe', pct: 60, usual: 20, day: '2026-10-13' } },
    ]);
  });

  it('nothing for a normal day, a drop, a tiny day, fewer than 4 same-weekday samples, no data or an inactive account', () => {
    expect(spikes(input({ reachByFollow: breakdown(21) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(2) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60, 40) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60, 100, 3) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: [] }))).toEqual([]);
    expect(spikes(input())).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60), account: { id: 'a1', username: 'cafe', status: 'needs_reconnect', tokenExpiresAt: null } }))).toEqual([]);
  });

  it('today is never checked (partial day)', () => {
    expect(spikes(input({ reachByFollow: breakdown(60), now: new Date('2026-10-13T12:00:00Z') }))).toEqual([]);
  });
});

describe('unfollow_spike rule', () => {
  const row = (d: string, unfollows: number | null): DailyRow => ({ day: d, unfollows, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, linkTaps: null });
  const daily = [row(SPIKE_DAY, 30), ...[2, 3, 2, 4, 3, 2, 3, 2].map((u, i) => row(addDays(SPIKE_DAY, -7 * (i + 1)), u))];

  afterEach(() => {
    vi.doUnmock('@/lib/alerts/settings');
    vi.resetModules();
  });

  it('is OFF while the follows/unfollows mapping is unverified (UNFOLLOW_SPIKE_ENABLED = false)', () => {
    expect(spikes(input({ daily }))).toEqual([]);
  });

  it('once enabled: an upward same-weekday spike of unfollows alerts once for that day', async () => {
    vi.resetModules();
    vi.doMock('@/lib/alerts/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/alerts/settings')>()), UNFOLLOW_SPIKE_ENABLED: true }));
    const { evaluateRules: on } = await import('@/lib/alerts/rules');
    expect(on(input({ daily })).filter((a) => a.kind === 'unfollow_spike')).toEqual([
      { kind: 'unfollow_spike', accountId: 'a1', severity: 'warning', dedupeKey: 'unfollow_spike:a1:2026-10-13', payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13' } },
    ]);
    expect(on(input({ daily: daily.map((r) => (r.day === SPIKE_DAY ? { ...r, unfollows: 3 } : r)) })).some((a) => a.kind === 'unfollow_spike')).toBe(false);
  });
});
