import { describe, expect, it } from 'vitest';
import type { MediaDetails } from '@/lib/instagram/parse';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { COVERS_PER_RUN, runAccount, type RunContext } from '@/lib/sync/run-account';
import { dueJobs, emptyState, type SyncState } from '@/lib/sync/schedule';
import { runTick } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const url = (id: string) => `https://scontent.cdninstagram.com/v/${id}.jpg?_nc_sig=SECRET`;
const det = (o: Partial<MediaDetails>): MediaDetails => ({ mediaType: 'IMAGE', productType: 'FEED', likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null, ...o });
/** Import finished, every regular job fresh: only covers can be due. */
const COMPLETE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: minsAgo(600), stories: minsAgo(5), daily: minsAgo(60), mediaList: minsAgo(5), mediaMetrics: minsAgo(5), audience: minsAgo(60) } };

function ctx(n: number, o: { deadline?: number; state?: Partial<SyncState> } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, accountId: 'a1', postedAt: minsAgo(60 * (i + 1)), lastMetricsAt: minsAgo(5) })) });
  ig.mediaCover.mockImplementation(async (_t: string, id: string) => det({ mediaUrl: url(id) }));
  const seen: string[] = [];
  const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))) as typeof fetch;
  let now = 0;
  const acc = account({ id: 'a1' });
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...COMPLETE, ...o.state }, tz: 'UTC', now: NOW, deadline: o.deadline ?? 1e9, clock: () => (now += 10), cdnFetch };
  return { c, ig, mem, seen };
}

describe('covers job scheduling', () => {
  const input = (s: Partial<SyncState>) => ({ status: 'active' as const, tokenExpiresAt: null, state: { ...emptyState('a1'), ...s } });
  it('due hourly once the history import is through; never while importing; never in lane 1', () => {
    expect(dueJobs(input(COMPLETE), NOW, 'UTC')).toContain('covers');
    expect(dueJobs(input({ ...COMPLETE, lastRun: { ...COMPLETE.lastRun, covers: minsAgo(20) } }), NOW, 'UTC')).not.toContain('covers');
    expect(dueJobs(input({}), NOW, 'UTC')).not.toContain('covers'); // new account: Overview numbers first
    expect(dueJobs(input(COMPLETE), NOW, 'UTC', { lane: 'regular' })).not.toContain('covers');
  });
});

describe('covers job', () => {
  it('newest first, a fresh URL per post, at most COVERS_PER_RUN per run', async () => {
    const { c, ig, mem } = ctx(30);
    const { result } = await runAccount(c, ['covers']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['covers'] });
    expect(ig.mediaCover).toHaveBeenCalledTimes(COVERS_PER_RUN);
    expect(ig.mediaCover.mock.calls[0][1]).toBe('p00');
    expect(mem.uploads).toHaveLength(COVERS_PER_RUN);
    expect(mem.uploads[0].path).toBe('a1/p00.jpg');
  });

  it('gone on Instagram -> marked gone; no image offered -> unavailable; a transient error -> back-off', async () => {
    const { c, ig, mem } = ctx(3);
    ig.mediaCover.mockImplementation(async (_t: string, id: string) => {
      if (id === 'p00') throw new InstagramApiError('data', 400, 100, 33);
      if (id === 'p01') return det({ mediaUrl: null }); // copyrighted media
      throw new InstagramApiError('data', 500, 2);
    });
    const { result } = await runAccount(c, ['covers']);
    expect(result.outcome).toBe('ok');
    expect(mem.media.get('p00')!.gone).toBe(true);
    expect(mem.covers.get('p01')).toMatchObject({ status: 'unavailable', attempts: 1 });
    expect(mem.covers.get('p02')).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('a rate limit still stops it (back-off); a database failure never marks the account as failing', async () => {
    const limited = ctx(2);
    limited.ig.mediaCover.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    expect((await runAccount(limited.c, ['covers'])).result).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
    const db = ctx(2);
    db.mem.store.coverRefs = async () => {
      throw new Error('sync store: coverRefs failed');
    };
    expect((await runAccount(db.c, ['covers'])).result).toMatchObject({ outcome: 'ok' });
  });

  it('out of time: stops between posts and stays due (resumes next pass)', async () => {
    const { c, mem } = ctx(10, { deadline: 45 });
    const { result } = await runAccount(c, ['covers']);
    expect(result.outcome).toBe('partial');
    expect(mem.uploads.length).toBeGreaterThan(0);
    expect(mem.uploads.length).toBeLessThan(10);
  });
});

describe('covers in the tick', () => {
  it('a complete account gets its covers in lane 2 (never lane 1), with the tick-supplied CDN fetch', async () => {
    const ig = fakeIg();
    ig.mediaCover.mockImplementation(async (_t: string, id: string) => det({ mediaUrl: url(id) }));
    const mem = memoryStore({ tokens: { a1: 'tok' }, media: [{ id: 'p1', accountId: 'a1', postedAt: minsAgo(90), lastMetricsAt: minsAgo(5) }] });
    mem.states.set('a1', { ...emptyState('a1'), ...COMPLETE, leaseId: null } as SyncState & { leaseId: null });
    const seen: string[] = [];
    const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))) as typeof fetch;
    const s = await runTick({ store: mem.store, accounts: fakeAccounts([account({ id: 'a1' })]).accounts, ig, clock: () => NOW.getTime(), cdnFetch }, { trigger: 'cron' });
    expect(s.accounts[0].jobs.at(-1)).toBe('covers');
    expect(s.accounts[0].jobs.filter((j) => j === 'covers')).toHaveLength(1);
    expect(seen).toEqual([url('p1')]);
    expect(mem.covers.get('p1')).toMatchObject({ status: 'ok' });
  });
});
