import { describe, expect, it } from 'vitest';
import type { IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { EXTRA_CALLS_PER_RUN } from '@/lib/sync/extras';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, storyExtrasDue, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const story = (id: string, ageMin = 10) => ({ id, kind: 'STORY' as const, caption: null, permalink: null, postedAt: minsAgo(ageMin) });
const unsupported = () => new InstagramApiError('data', 400, 100, undefined, true);
const gone = () => new InstagramApiError('data', 400, 100, 33);
/** Only the Story-extras keys (later tasks add other capability keys, e.g. stories:url_fields). */
const storyCaps = (caps: Record<string, boolean> | undefined) => Object.fromEntries(Object.entries(caps ?? {}).filter(([k]) => k.startsWith('story:')));

function ctx(state: Partial<SyncState> = {}) {
  const ig = fakeIg();
  const mem = memoryStore();
  const acc = account({ id: 'a1' });
  const log: string[] = [];
  mem.store.insertMetrics = async (id) => void log.push(`core:${id}`);
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...state }, tz: 'UTC', now: NOW, deadline: 1_000, clock: () => 0 };
  return { c, ig, mem, log };
}

/** extraInsights fake answering per metric; `fail` maps a metric to the error it throws. */
function answer(ig: ReturnType<typeof fakeIg>, log: string[], fail: Record<string, () => Error> = {}) {
  ig.extraInsights.mockImplementation((async (_t: string, id: string, metrics: readonly string[], breakdown?: string) => {
    log.push(`extra:${id}:${metrics.join(',')}${breakdown ? `/${breakdown}` : ''}`);
    const m = metrics[0];
    if (fail[m]) throw fail[m]();
    if (breakdown) return { BIO_LINK_CLICKED: 2 };
    return { [m]: m === 'follows' ? 3 : 7 };
  }) as IgData['extraInsights']);
}

describe('storyExtrasDue', () => {
  it('first half hour of every 2-hour window, and every pass in the last hour', () => {
    expect(storyExtrasDue(minsAgo(10), NOW)).toBe(true);
    expect(storyExtrasDue(minsAgo(45), NOW)).toBe(false);
    expect(storyExtrasDue(minsAgo(125), NOW)).toBe(true);
    expect(storyExtrasDue(minsAgo(22 * 60 + 45), NOW)).toBe(false);
    expect(storyExtrasDue(minsAgo(23 * 60 + 10), NOW)).toBe(true);
  });
});

describe('Story extras', () => {
  it('one separate call per metric, AFTER every core snapshot; fields merged onto that snapshot', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1'), story('s2')]);
    answer(ig, log);
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(log.slice(0, 2)).toEqual(['core:s1', 'core:s2']);
    expect(log.slice(2, 5)).toEqual(['extra:s1:follows', 'extra:s1:profile_visits', 'extra:s1:profile_activity/action_type']);
    expect(mem.extras).toEqual([
      { mediaId: 's1', capturedAt: NOW.toISOString(), e: { follows: 3, profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } } },
      { mediaId: 's2', capturedAt: NOW.toISOString(), e: { follows: 3, profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } } },
    ]);
    expect(storyCaps(patch.capabilities)).toEqual({ 'story:follows': true, 'story:profile_visits': true, 'story:profile_activity': true });
  });

  it('an unsupported metric only drops that metric, is remembered, and is not asked on the next run', async () => {
    const first = ctx();
    first.ig.listStories.mockResolvedValue([story('s1')]);
    answer(first.ig, first.log, { follows: unsupported });
    const { result, patch } = await runAccount(first.c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(first.mem.extras[0].e).toEqual({ profileVisits: 7, profileActivity: { BIO_LINK_CLICKED: 2 } });
    expect(patch.capabilities!['story:follows']).toBe(false);

    const next = ctx({ capabilities: patch.capabilities });
    next.ig.listStories.mockResolvedValue([story('s1')]);
    answer(next.ig, next.log);
    await runAccount(next.c, ['stories']);
    expect(next.log.filter((l) => l.startsWith('extra:'))).toEqual(['extra:s1:profile_visits', 'extra:s1:profile_activity/action_type']);
  });

  it('a Story gone mid-capture: the core snapshot stays, nothing is learned, the run is ok', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: gone, profile_visits: gone, profile_activity: gone });
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(log[0]).toBe('core:s1');
    expect(mem.extras).toEqual([]);
    expect(storyCaps(patch.capabilities)).toEqual({});
  });

  it('transient errors (5xx, network, unclassified 100) never poison the capability memory', async () => {
    const { c, ig, log } = ctx({ capabilities: { 'story:profile_visits': true } });
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: () => new InstagramApiError('data', 500, 2), profile_visits: () => new InstagramApiError('network'), profile_activity: () => new InstagramApiError('data', 400, 100) });
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(storyCaps(patch.capabilities)).toEqual({ 'story:profile_visits': true });
  });

  it('a rate limit in an extra still stops the job (back-off), but only after the core snapshot was stored', async () => {
    const { c, ig, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log, { follows: () => new InstagramApiError('data', 400, 80002) });
    const { result } = await runAccount(c, ['stories']);
    expect(log[0]).toBe('core:s1');
    expect(result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
  });

  it('a failing extras write costs only the extras', async () => {
    const { c, ig, mem, log } = ctx();
    ig.listStories.mockResolvedValue([story('s1')]);
    answer(ig, log);
    mem.store.updateMetricExtras = async () => {
      throw new Error('sync store: updateMetricExtras failed');
    };
    expect((await runAccount(c, ['stories'])).result.outcome).toBe('ok');
  });

  it('respects the per-run call budget and the Story cadence; no extras for a Story without a core snapshot', async () => {
    const { c, ig, log } = ctx();
    ig.listStories.mockResolvedValue([...Array.from({ length: 12 }, (_, i) => story(`s${i}`)), story('late', 45), story('few')]);
    ig.storyInsights.mockImplementation(async (_t: string, id: string) => {
      if (id === 'few') throw new InstagramApiError('data', 400, 10); // under 5 viewers
      return { reach: 1, views: 1, likes: null, comments: null, shares: null, saves: null, totalInteractions: null, replies: null, tapsForward: null, tapsBack: null, exits: null };
    });
    answer(ig, log);
    await runAccount(c, ['stories']);
    const extras = log.filter((l) => l.startsWith('extra:'));
    expect(extras).toHaveLength(EXTRA_CALLS_PER_RUN);
    expect(extras.some((l) => l.includes(':late:') || l.includes(':few:'))).toBe(false);
  });
});
