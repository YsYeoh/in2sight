import { describe, expect, it, vi } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';

const { runAutoHide } = vi.hoisted(() => ({ runAutoHide: vi.fn() }));
vi.mock('@/lib/moderation/auto', async (orig) => ({ ...(await orig<object>()), runAutoHide }));

import { runTick, type TickDeps } from '@/lib/sync/tick';
import { memoryAlertStore } from './fixtures/alert-fakes';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z');
function setup() {
  const ig = fakeIg();
  const mem = memoryStore({ tokens: { a1: 'tok-a1' } });
  const alerts = memoryAlertStore();
  const deps: TickDeps = {
    store: mem.store,
    accounts: fakeAccounts([account({ id: 'a1' })]).accounts,
    ig,
    clock: () => T0,
    newId: () => 'lease',
    alerts: { store: alerts.store, push: null },
    moderation: { db: {} as never, ig: { hide: vi.fn() }, token: vi.fn() },
  };
  return { ig, mem, alerts, deps };
}

describe('runTick + auto-hide', () => {
  it('runs after the alerts in its own window (35 + 10 + 5 s) with a fresh account list; counts land in the summary and sync_runs', async () => {
    runAutoHide.mockReset().mockResolvedValue({ hidden: 2, failed: 0, paused: 0 });
    const { deps, alerts, mem } = setup();
    const s = await runTick(deps, { trigger: 'cron' });
    expect(vi.mocked(alerts.store.context).mock.invocationCallOrder[0]).toBeLessThan(runAutoHide.mock.invocationCallOrder[0]);
    const ctx = runAutoHide.mock.calls[0][1];
    expect(ctx.deadline).toBe(T0 + 50_000);
    expect(ctx.accounts.map((a: { id: string }) => a.id)).toEqual(['a1']);
    expect(s.moderation).toEqual({ hidden: 2, failed: 0, paused: 0 });
    expect(mem.runs[0].summary).toMatchObject({ moderation: { hidden: 2, failed: 0, paused: 0 } });
  });

  it('a failing pass never fails the tick or the recorded run', async () => {
    runAutoHide.mockReset().mockRejectedValue(new Error('boom'));
    const { deps, mem } = setup();
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => a.outcome)).toEqual(['ok']);
    expect(s.moderation).toEqual({ hidden: 0, failed: 1, paused: 0 });
    expect(mem.runs).toHaveLength(1);
  });

  it('a manual run for one account passes its id', async () => {
    runAutoHide.mockReset().mockResolvedValue({ hidden: 0, failed: 0, paused: 0 });
    const { deps } = setup();
    await runTick(deps, { trigger: 'manual', accountId: 'a1' });
    expect(runAutoHide.mock.calls[0][1].accountId).toBe('a1');
  });

  it('an app-wide Instagram rate limit in the sync skips the pass', async () => {
    runAutoHide.mockReset();
    const { deps, ig } = setup();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 4));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(runAutoHide).not.toHaveBeenCalled();
    expect(s).not.toHaveProperty('moderation');
  });

  it('without moderation deps nothing runs and the summary has no moderation field', async () => {
    runAutoHide.mockReset();
    const { deps } = setup();
    const s = await runTick({ ...deps, moderation: undefined }, { trigger: 'cron' });
    expect(runAutoHide).not.toHaveBeenCalled();
    expect(s).not.toHaveProperty('moderation');
  });
});
