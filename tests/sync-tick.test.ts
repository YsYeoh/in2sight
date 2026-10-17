import { describe, expect, it } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { emptyState } from '@/lib/sync/schedule';
import { LEASE_MS, runTick, type TickDeps } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z');
const fixedClock = () => T0;
const ids = () => {
  let n = 0;
  return () => `lease-${++n}`;
};

function setup(list = [account({ id: 'a1' }), account({ id: 'a2' })], tokens: Record<string, string> = { a1: 'tok-a1', a2: 'tok-a2' }) {
  const ig = fakeIg();
  const mem = memoryStore({ tokens });
  const accts = fakeAccounts(list);
  const deps: TickDeps = { store: mem.store, accounts: accts.accounts, ig, clock: fixedClock, newId: ids() };
  return { ig, mem, accts, deps };
}

describe('runTick', () => {
  it('runs every due job for each active account and records a summary', async () => {
    const { deps, mem } = setup();
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['a1', 'ok'], ['a2', 'ok']]);
    expect(s.accounts[0].jobs).toEqual(['stories', 'daily', 'mediaList', 'mediaMetrics', 'audience', 'backfill']);
    expect(mem.runs).toHaveLength(1);
    expect(mem.runs[0]).toMatchObject({ trigger: 'cron', startedAt: '2026-10-14T02:00:00.000Z' });
    expect(mem.states.get('a1')).toMatchObject({ leaseId: null, leaseUntil: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-13' });
  });

  it('skips archived and needs_reconnect accounts entirely', async () => {
    const { deps, ig } = setup([account({ id: 'a1', status: 'archived', archivedAt: '2026-10-10T00:00:00Z' }), account({ id: 'a2', status: 'needs_reconnect' })]);
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts).toEqual([]);
    expect(ig.listStories).not.toHaveBeenCalled();
  });

  it('one expired token never stops the other accounts', async () => {
    const { deps, ig, accts } = setup();
    ig.listStories.mockImplementation(async (token: string) => {
      if (token === 'tok-a1') throw new InstagramApiError('data', 400, 190, 463);
      return [];
    });
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => [a.accountId, a.outcome, a.errorKey])).toEqual([['a1', 'needs_reconnect', 'token_invalid'], ['a2', 'ok', undefined]]);
    expect(accts.byId.get('a1')?.status).toBe('needs_reconnect');
    expect(accts.byId.get('a2')?.status).toBe('active');
  });

  it('a database failure on one account is isolated', async () => {
    const { deps, mem } = setup();
    const real = mem.store.getToken;
    mem.store.getToken = async (id) => {
      if (id === 'a1') throw new Error('sync store: getToken failed');
      return real(id);
    };
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['a1', 'failed'], ['a2', 'ok']]);
  });

  it('an account without a stored token is flagged needs_reconnect', async () => {
    const { deps, accts } = setup([account({ id: 'a1' })], {});
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts[0]).toMatchObject({ outcome: 'needs_reconnect', errorKey: 'token_invalid' });
    expect(accts.byId.get('a1')).toMatchObject({ status: 'needs_reconnect', lastError: 'token_missing' });
  });

  it('overlapping ticks (scheduler retry / double fire) cannot double-run an account', async () => {
    const { deps, ig, mem } = setup();
    const [x, y] = await Promise.all([runTick(deps, { trigger: 'cron' }), runTick({ ...deps, newId: () => 'other' }, { trigger: 'cron' })]);
    expect([...x.accounts, ...y.accounts].some((a) => a.outcome === 'locked')).toBe(true);
    expect(ig.listStories).toHaveBeenCalledTimes(2); // once per account, not twice
    expect(ig.accountDay).toHaveBeenCalledTimes(180); // 90 days per account (the two lanes may land in different ticks), none twice
    expect(new Set(mem.daily.map((d) => `${d.accountId}:${d.day}`)).size).toBe(180);
  });

  it('a lease left by a crashed tick blocks until it expires', async () => {
    const { deps, mem } = setup([account({ id: 'a1' })]);
    mem.states.set('a1', { ...emptyState('a1'), leaseId: 'dead', leaseUntil: new Date(T0 + 60_000).toISOString() });
    expect((await runTick(deps, { trigger: 'cron' })).accounts[0].outcome).toBe('locked');
    const later = { ...deps, clock: () => T0 + LEASE_MS };
    expect((await runTick(later, { trigger: 'cron' })).accounts[0].outcome).toBe('ok');
  });

  it('claiming stamps last_attempt_at, so an account killed mid-run goes to the back of the queue', async () => {
    const { deps, mem } = setup();
    mem.states.set('a2', { ...emptyState('a2'), leaseId: null, lastAttemptAt: new Date(T0 - 3_600_000).toISOString() });
    const real = mem.store.getToken;
    mem.store.getToken = async (id) => {
      if (id === 'a1') throw new Error('killed'); // stands in for a function killed after the claim
      return real(id);
    };
    await runTick(deps, { trigger: 'manual', accountId: 'a1' });
    expect(mem.states.get('a1')?.lastAttemptAt).toBe(new Date(T0).toISOString());
    mem.store.getToken = real;
    const next = await runTick({ ...deps, clock: () => T0 + LEASE_MS + 1 }, { trigger: 'cron' });
    expect(next.accounts.map((a) => a.accountId)).toEqual(['a2', 'a1']);
  });

  it('plans from the row the claim returns: work another tick just finished is not run again', async () => {
    const { deps, mem, ig } = setup([account({ id: 'a1' })]);
    const iso = new Date(T0).toISOString();
    mem.states.set('a1', { ...emptyState('a1'), leaseId: null, dailyDoneThrough: '2026-10-13', lastRun: { stories: iso, daily: iso, mediaList: iso, audience: iso } });
    mem.store.loadStates = async (ids) => new Map(ids.map((id) => [id, emptyState(id)])); // the stale snapshot taken before the other tick finished
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts[0]).toMatchObject({ outcome: 'ok', jobs: ['mediaMetrics'] });
    expect(ig.listStories).not.toHaveBeenCalled();
    expect(ig.accountDay).not.toHaveBeenCalled();
    expect(mem.states.get('a1')).toMatchObject({ leaseId: null, lastRun: { stories: iso, mediaMetrics: iso } }); // other tick's progress kept
  });

  it('stops on the time budget with work left (more = true); every new account got a slice; the next tick resumes', async () => {
    const list = [account({ id: 'a1' }), account({ id: 'a2' }), account({ id: 'a3' })];
    const { deps, ig, mem } = setup(list, { a1: 't1', a2: 't2', a3: 't3' });
    let now = T0;
    ig.accountDay.mockImplementation(async () => {
      now += 300; // 90 days x 300ms = 27s per account: three accounts cannot finish in one 35s pass
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    });
    const first = await runTick({ ...deps, clock: () => now }, { trigger: 'cron' });
    expect(first.stoppedEarly).toBe(true);
    expect(first.more).toBe(true); // stopped on the time budget with work left -> continuation is useful
    expect(first.accounts.map((a) => [a.accountId, a.outcome])).toEqual([['a1', 'partial'], ['a2', 'partial'], ['a3', 'partial']]);
    for (const id of ['a1', 'a2', 'a3']) expect(mem.states.get(id)).toMatchObject({ dailyDoneThrough: '2026-10-13' });
    const before = mem.daily.length;
    now += 30 * 60_000;
    await runTick({ ...deps, clock: () => now }, { trigger: 'cron' });
    expect(mem.daily.length).toBeGreaterThan(before);
    expect(new Set(mem.daily.map((d) => `${d.accountId}:${d.day}`)).size).toBe(mem.daily.length); // resumed, nothing re-fetched
  });

  it('an app-wide rate limit (code 4) stops the tick', async () => {
    const { deps, ig } = setup();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 4));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => a.accountId)).toEqual(['a1']);
    expect(s.stoppedEarly).toBe(true);
    expect(s.more).toBe(false); // Meta throttled the whole app: never chain into it
  });

  it('manual sync of one account touches only that account', async () => {
    const { deps, ig } = setup();
    const s = await runTick(deps, { trigger: 'manual', accountId: 'a2' });
    expect(s.accounts.map((a) => a.accountId)).toEqual(['a2']);
    expect(ig.listStories).toHaveBeenCalledWith('tok-a2', true);
  });

  it('the summary and the recorded run never contain a token', async () => {
    const { deps, mem, ig } = setup();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 190));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(JSON.stringify([s, mem.runs])).not.toMatch(/tok-a/);
  });
});
