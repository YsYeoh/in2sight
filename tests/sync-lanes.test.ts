import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
import { runTick, type TickDeps } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z'); // 10:00 in Kuala Lumpur
const DAY = { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
const ago = (m: number) => new Date(T0 - m * 60_000).toISOString();

/** A complete account (pre-Plan-11a row) whose Stories and media list are due. */
const complete = (id: string): SyncState & { leaseId: null } => ({ ...emptyState(id), leaseId: null, lastAttemptAt: ago(30), dailyDoneThrough: '2026-10-13', lastRun: { stories: ago(30), daily: ago(60), mediaList: ago(30), audience: ago(60) } });

function setup(list: StoredAccount[], states: (SyncState & { leaseId: null })[] = []) {
  const ig = fakeIg();
  const mem = memoryStore({ tokens: Object.fromEntries(list.map((a) => [a.id, `tok-${a.id}`])) });
  for (const s of states) mem.states.set(s.accountId, s);
  let now = T0;
  const log: string[] = [];
  const cost = (ms: number) => (now += ms);
  ig.listStories.mockImplementation(async (t: string) => (log.push(`${t}:stories`), cost(100), []));
  ig.accountDay.mockImplementation(async (t: string) => (log.push(`${t}:day`), cost(300), DAY));
  const deps: TickDeps = { store: mem.store, accounts: fakeAccounts(list).accounts, ig, clock: () => now, newId: (() => { let n = 0; return () => `lease-${++n}`; })() };
  return { ig, mem, deps, log, cost, now: () => now };
}

describe('fair lanes', () => {
  it('1 old + 2 new accounts: every account\'s Stories run first, then the new accounts split the rest fairly', async () => {
    const { deps, log, mem } = setup([account({ id: 'old' }), account({ id: 'n1' }), account({ id: 'n2' })], [complete('old')]);
    const s = await runTick(deps, { trigger: 'cron' });
    const firstDay = log.findIndex((l) => l.endsWith(':day'));
    expect(log.slice(0, firstDay).sort()).toEqual(['tok-n1:stories', 'tok-n2:stories', 'tok-old:stories']); // lane 1 for all, before any import
    expect(log.filter((l) => l === 'tok-old:day')).toEqual([]); // the complete account imports nothing
    const days = (id: string) => mem.daily.filter((d) => d.accountId === id).length;
    expect(days('n1')).toBeGreaterThan(30);
    expect(Math.abs(days('n1') - days('n2'))).toBeLessThanOrEqual(3); // equal slices
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['n1', 'partial'], ['n2', 'partial'], ['old', 'ok']]);
    expect(s.accounts.find((a) => a.accountId === 'n1')!.jobs.slice(0, 2)).toEqual(['stories', 'daily']); // lane 1 + lane 2 merged
    expect(s).toMatchObject({ stoppedEarly: true, more: true });
  });

  it('a slice cut short in lane 1 continues in lane 2 in the same pass (nothing runs twice)', async () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, accountId: 'old', postedAt: ago(60 * (i + 1)), lastMetricsAt: null }));
    const env = setup([account({ id: 'old' })], [complete('old')]);
    for (const m of recent) env.mem.media.set(m.id, { ...m, kind: 'IMAGE', gone: false });
    env.ig.feedInsights.mockImplementation(async () => (env.cost(1_000), { reach: 1, views: 1, likes: 1, comments: 0, shares: 0, saves: 0, totalInteractions: 1, replies: null, tapsForward: null, tapsBack: null, exits: null }));
    const s = await runTick(env.deps, { trigger: 'cron' });
    expect(env.ig.feedInsights).toHaveBeenCalledTimes(20);
    expect(env.ig.listStories).toHaveBeenCalledTimes(1);
    expect(s.accounts[0]).toMatchObject({ accountId: 'old', outcome: 'ok' });
    expect(s.more).toBe(false);
  });

  it('app-wide rate limit in lane 1: lane 2 never starts, no continuation', async () => {
    const { deps, ig } = setup([account({ id: 'n1' }), account({ id: 'n2' })]);
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 4));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(s.accounts.map((a) => a.accountId)).toEqual(['n1']);
    expect(s).toMatchObject({ stoppedEarly: true, more: false });
  });

  it('a rate-limited account sits out lane 2; the others still import', async () => {
    const { deps, ig, log } = setup([account({ id: 'n1' }), account({ id: 'n2' })]);
    ig.listStories.mockImplementation(async (t: string) => {
      if (t === 'tok-n1') throw new InstagramApiError('data', 400, 80002);
      return [];
    });
    const s = await runTick(deps, { trigger: 'cron' });
    expect(log.some((l) => l === 'tok-n1:day')).toBe(false);
    expect(log.some((l) => l === 'tok-n2:day')).toBe(true);
    expect(s.accounts.find((a) => a.accountId === 'n1')).toMatchObject({ outcome: 'failed', errorKey: 'rate_limited' });
  });

  it('progress table missing: the tick still syncs every account', async () => {
    const { deps, mem } = setup([account({ id: 'n1' }), account({ id: 'old' })], [complete('old')]);
    deps.clock = () => T0; // no time passes: everything finishes
    mem.store.writeProgress = async () => {
      throw new Error('sync store: writeProgress failed');
    };
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['n1', 'ok'], ['old', 'ok']]);
    expect(mem.daily.filter((d) => d.accountId === 'n1')).toHaveLength(90);
  });

  it('live progress only for importing accounts and manual runs; a finished import ends "done"', async () => {
    const { deps, mem } = setup([account({ id: 'n1' }), account({ id: 'old' })], [complete('old')]);
    deps.clock = () => T0;
    await runTick(deps, { trigger: 'cron' });
    expect(mem.progress.some((w) => w.accountId === 'old')).toBe(false); // a complete account's tick stays silent
    expect(mem.progress.filter((w) => w.accountId === 'n1').at(-1)!.p).toMatchObject({ state: 'done', finishedAt: new Date(T0).toISOString() });
    mem.progress.length = 0;
    await runTick(deps, { trigger: 'manual', accountId: 'old' });
    expect(mem.progress.map((w) => w.accountId)).toContain('old');
    expect(mem.progress.at(-1)!.p.state).toBe('done');
  });

  it('a new account mid-import that hits the budget ends its pass "waiting", with both edges saved', async () => {
    const { deps, mem } = setup([account({ id: 'n1' })]);
    await runTick(deps, { trigger: 'cron', budgetMs: 15_000 });
    const st = mem.states.get('n1')!;
    expect(st.dailyDoneThrough).toBe('2026-10-13');
    expect(st.backfilledFrom! < '2026-10-07').toBe(true);
    expect(mem.progress.at(-1)!.p).toMatchObject({ state: 'waiting', finishedAt: null });
  });
});

describe('lane 1 failure', () => {
  it('a persistent non-rate-limit error in lane 1 adds exactly one failure per tick, keeps its errorKey, and lane 2 does not retry it', async () => {
    const { deps, ig, mem, cost } = setup([account({ id: 'n1' })]);
    ig.listStories.mockImplementation(async () => {
      cost(100);
      throw new InstagramApiError('data', 400, 1);
    });
    for (const n of [1, 2]) {
      const s = await runTick(deps, { trigger: 'cron' });
      expect(mem.states.get('n1')!.consecutiveFailures).toBe(n);
      expect(s.accounts).toHaveLength(1);
      expect(s.accounts[0]).toMatchObject({ outcome: 'failed', errorKey: expect.any(String) });
      expect((mem.runs.at(-1)!.summary as { accounts: { errorKey?: string }[] }).accounts[0].errorKey).toBe(s.accounts[0].errorKey);
      expect(ig.listStories).toHaveBeenCalledTimes(n);
      expect(ig.accountDay).not.toHaveBeenCalled();
    }
  });

  it('a lane-1 success still lets lane 2 import', async () => {
    const { deps, ig } = setup([account({ id: 'n1' })]);
    await runTick(deps, { trigger: 'cron' });
    expect(ig.accountDay).toHaveBeenCalled();
  });
});
