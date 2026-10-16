import { describe, expect, it } from 'vitest';
import { progressSink, THROTTLE_MS } from '@/lib/sync/progress-sink';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type JobKind } from '@/lib/sync/schedule';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');

describe('progressSink', () => {
  it('writes at once on a stage change, otherwise at most every THROTTLE_MS', async () => {
    const mem = memoryStore();
    let t = 0;
    const sink = progressSink(mem.store, 'a1', () => t);
    await sink.report('account_days', 1, 90, '2026-10-13');
    t += 1_000;
    await sink.report('account_days', 2, 90, '2026-10-12'); // throttled
    t += THROTTLE_MS;
    await sink.report('account_days', 3, 90, '2026-10-11');
    await sink.report('posts_list', 0, null); // stage change: immediate
    expect(mem.progress.map(({ p }) => [p.stage, p.done, p.detailDay])).toEqual([
      ['account_days', 1, '2026-10-13'],
      ['account_days', 3, '2026-10-11'],
      ['posts_list', 0, null],
    ]);
    expect(mem.progress.every(({ accountId, p }) => accountId === 'a1' && p.state === 'running' && p.finishedAt === null)).toBe(true);
  });

  it('finish: done stamps finished_at; waiting and failed do not', async () => {
    const mem = memoryStore();
    const sink = progressSink(mem.store, 'a1', () => NOW.getTime());
    await sink.finish('waiting', null);
    await sink.finish('failed', 'rate_limited');
    await sink.finish('done', null);
    expect(mem.progress.map(({ p }) => [p.state, p.errorKey, p.finishedAt])).toEqual([
      ['waiting', null, null],
      ['failed', 'rate_limited', null],
      ['done', null, NOW.toISOString()],
    ]);
  });

  it('a failing progress write never throws and never stops the job', async () => {
    const ig = fakeIg();
    const mem = memoryStore();
    mem.store.writeProgress = async () => {
      throw new Error('sync store: writeProgress failed');
    };
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'Asia/Kuala_Lumpur', now: NOW, deadline: 1_000, clock: () => 0, progress: progressSink(mem.store, 'a1', () => 0) };
    await expect(c.progress!.finish('done', null)).resolves.toBeUndefined();
    const { result } = await runAccount(c, ['stories', 'daily']);
    expect(result.outcome).toBe('ok');
    expect(mem.daily).toHaveLength(7);
  });
});

describe('runner progress reports', () => {
  it('reports each onboarding stage in run order, with the day being fetched, and never the token', async () => {
    const ig = fakeIg();
    ig.listMedia.mockResolvedValue([{ id: 'p1', kind: 'IMAGE', caption: null, permalink: null, postedAt: '2026-10-12T00:00:00.000Z' }]);
    const mem = memoryStore();
    const acc = account({ id: 'a1' });
    let t = 0;
    const clock = () => (t += 4_000); // every read moves past the throttle
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'Asia/Kuala_Lumpur', now: NOW, deadline: Infinity, clock, progress: progressSink(mem.store, 'a1', clock) };
    const jobs: JobKind[] = ['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill'];
    await runAccount(c, jobs);
    const stages = mem.progress.map(({ p }) => p.stage).filter((s, i, a) => s !== a[i - 1]);
    expect(stages).toEqual(['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience', 'account_days']);
    const days = mem.progress.filter(({ p }) => p.stage === 'account_days').map(({ p }) => p.detailDay);
    expect(days[0]).toBe('2026-10-13');
    expect(days.at(-1)).toBe('2026-07-16');
    expect(mem.progress.find(({ p }) => p.stage === 'account_days' && p.detailDay === '2026-10-06')?.p).toMatchObject({ done: 7, total: 90 });
    expect(JSON.stringify(mem.progress)).not.toContain('IGQ-secret');
  });
});
