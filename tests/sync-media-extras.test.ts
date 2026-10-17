import { describe, expect, it } from 'vitest';
import type { IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, pickDueMedia, type SyncState } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore, METRICS } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const DONE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: hoursAgo(48) } };

function ctx(media: { id: string; kind: string; postedAt?: string; productType?: string }[], o: { deadline?: number; capabilities?: Record<string, boolean> } = {}) {
  const ig = fakeIg();
  const mem = memoryStore();
  for (const m of media) mem.media.set(m.id, { id: m.id, accountId: 'a1', postedAt: m.postedAt ?? hoursAgo(5), lastMetricsAt: null, kind: m.kind, productType: m.productType, gone: false });
  const acc = account({ id: 'a1' });
  let now = 0;
  const log: string[] = [];
  ig.feedInsights.mockImplementation(async (_t: string, id: string) => (log.push(`core:${id}`), (now += 100), METRICS));
  ig.extraInsights.mockImplementation((async (_t: string, id: string, metrics: readonly string[], breakdown?: string) => {
    log.push(`extra:${id}:${metrics.join(',')}${breakdown ? `/${breakdown}` : ''}`);
    now += 100;
    if (breakdown) return { BIO_LINK_CLICKED: 1 };
    return Object.fromEntries(metrics.map((m, i) => [m, i + 1]));
  }) as IgData['extraInsights']);
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...DONE, capabilities: o.capabilities ?? {} }, tz: 'UTC', now: NOW, deadline: o.deadline ?? 1_000_000, clock: () => now };
  return { c, ig, mem, log };
}

describe('7-day checkpoint', () => {
  it('one snapshot right after day 7 when the last one is from before day 7, even if the daily one was hours ago', () => {
    const refs = [
      { id: 'cross', postedAt: hoursAgo(24 * 7 + 1), lastMetricsAt: hoursAgo(3) }, // last snapshot at day 6.9
      { id: 'done', postedAt: hoursAgo(24 * 7 + 5), lastMetricsAt: hoursAgo(4) }, // last snapshot at day 7.04
      { id: 'early', postedAt: hoursAgo(24 * 6 + 20), lastMetricsAt: hoursAgo(3) }, // not day 7 yet
      { id: 'late', postedAt: hoursAgo(24 * 8 + 2), lastMetricsAt: hoursAgo(24 * 2) }, // missed window: normal daily rule
    ];
    expect(pickDueMedia(refs, NOW)).toEqual(['cross', 'late']);
  });
});

describe('per-media extras', () => {
  it('feed: follows+profile_visits in one call, profile_activity in another; Reels: one watch-time call — all after every core snapshot', async () => {
    const { c, mem, log } = ctx([{ id: 'img', kind: 'IMAGE' }, { id: 'reel', kind: 'REELS', postedAt: hoursAgo(6) }, { id: 'car', kind: 'CAROUSEL_ALBUM', postedAt: hoursAgo(7) }]);
    const { result } = await runAccount(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(log.slice(0, 3)).toEqual(['core:img', 'core:reel', 'core:car']);
    expect(log.slice(3)).toEqual([
      'extra:img:follows,profile_visits',
      'extra:img:profile_activity/action_type',
      'extra:reel:ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate',
      'extra:car:follows,profile_visits',
      'extra:car:profile_activity/action_type',
    ]);
    const at = NOW.toISOString();
    expect(mem.extras).toContainEqual({ mediaId: 'img', capturedAt: at, e: { follows: 1, profileVisits: 2, profileActivity: { BIO_LINK_CLICKED: 1 } } });
    expect(mem.extras).toContainEqual({ mediaId: 'reel', capturedAt: at, e: { avgWatchMs: 1, totalWatchMs: 2, skipRate: 3 } });
  });

  it('an unsupported metric in a batch drops only that group, is remembered, and the core snapshot is untouched', async () => {
    const { c, ig, mem, log } = ctx([{ id: 'img', kind: 'IMAGE' }]);
    const base = ig.extraInsights.getMockImplementation()!;
    ig.extraInsights.mockImplementation((async (t: string, id: string, metrics: readonly string[], b?: string) => {
      if (metrics.includes('follows')) throw new InstagramApiError('data', 400, 100, undefined, true);
      return base(t, id, metrics, b);
    }) as IgData['extraInsights']);
    const { result, patch } = await runAccount(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(log[0]).toBe('core:img');
    expect(mem.metrics).toEqual([{ mediaId: 'img', capturedAt: NOW.toISOString() }]);
    expect(mem.extras).toEqual([{ mediaId: 'img', capturedAt: NOW.toISOString(), e: { profileActivity: { BIO_LINK_CLICKED: 1 } } }]);
    expect(patch.capabilities).toMatchObject({ 'feed:follows_visits': false, 'feed:profile_activity': true });
  });

  it('an old feed video (kind REELS, product type FEED) gets the core snapshot but no Reels extras', async () => {
    const { c, mem, log } = ctx([{ id: 'oldvid', kind: 'REELS', productType: 'FEED' }, { id: 'reel', kind: 'REELS', productType: 'REELS' }]);
    await runAccount(c, ['mediaMetrics']);
    expect(mem.metrics.map((m) => m.mediaId).sort()).toEqual(['oldvid', 'reel']);
    expect(log.filter((l) => l.startsWith('extra:')).map((l) => l.split(':')[1])).toEqual(['reel']);
  });

  it('one refusal never switches off a metric that already worked for the account', async () => {
    const { c, ig } = ctx([{ id: 'reel', kind: 'REELS', productType: 'REELS' }], { capabilities: { 'reels:watch': true } });
    ig.extraInsights.mockImplementation((async () => {
      throw new InstagramApiError('data', 400, 100, undefined, true);
    }) as IgData['extraInsights']);
    const { result, patch } = await runAccount(c, ['mediaMetrics']);
    expect(result.outcome).toBe('ok');
    expect(patch.capabilities).toEqual({ 'reels:watch': true });
  });

  it('no extras for a post without a fresh core snapshot (gone, under-5/no data, unclassified error)', async () => {
    const { c, ig, log } = ctx([{ id: 'ok', kind: 'IMAGE' }, { id: 'gone', kind: 'IMAGE', postedAt: hoursAgo(6) }, { id: 'nodata', kind: 'IMAGE', postedAt: hoursAgo(7) }]);
    ig.feedInsights.mockImplementation(async (_t: string, id: string) => {
      log.push(`core:${id}`);
      if (id === 'gone') throw new InstagramApiError('data', 400, 100, 33);
      if (id === 'nodata') throw new InstagramApiError('data', 400, 10);
      return METRICS;
    });
    await runAccount(c, ['mediaMetrics']);
    expect(log.filter((l) => l.startsWith('extra:')).every((l) => l.startsWith('extra:ok:'))).toBe(true);
  });

  it('extras never starve the core capture: when time runs out after the core loop, extras are skipped and the job is done', async () => {
    const { c, mem, log } = ctx([{ id: 'p1', kind: 'IMAGE' }, { id: 'p2', kind: 'IMAGE', postedAt: hoursAgo(6) }, { id: 'p3', kind: 'REELS', postedAt: hoursAgo(7) }], { deadline: 300 });
    const { result } = await runAccount(c, ['mediaMetrics']);
    expect(mem.metrics).toHaveLength(3);
    expect(log.some((l) => l.startsWith('extra:'))).toBe(false);
    expect(result.outcome).toBe('ok');
  });
});
