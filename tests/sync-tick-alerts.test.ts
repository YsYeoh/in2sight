import { describe, expect, it, vi } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { runTick, type TickDeps } from '@/lib/sync/tick';
import { memoryAlertStore, pushSub } from './fixtures/alert-fakes';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z');

function setup() {
  const ig = fakeIg();
  const mem = memoryStore({ tokens: { a1: 'tok-a1', a2: 'tok-a2' } });
  const accts = fakeAccounts([account({ id: 'a1' }), account({ id: 'a2' })]);
  const alerts = memoryAlertStore({ subs: [pushSub(1)] });
  const push = vi.fn(async () => 201);
  const deps: TickDeps = { store: mem.store, accounts: accts.accounts, ig, clock: () => T0, newId: () => 'lease', alerts: { store: alerts.store, push } };
  return { ig, mem, alerts, push, deps };
}

describe('runTick + alerts', () => {
  it('evaluates after the account jobs: an account flipped to needs_reconnect in this tick alerts now', async () => {
    const { deps, ig, alerts, push, mem } = setup();
    ig.listStories.mockImplementation(async (token: string) => {
      if (token === 'tok-a1') throw new InstagramApiError('data', 400, 190, 463);
      return [];
    });
    const s = await runTick(deps, { trigger: 'cron' });
    expect(alerts.rows.map((r) => [r.kind, r.accountId])).toEqual([['needs_reconnect', 'a1']]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(s.alerts).toEqual({ created: 1, pushed: 1, failed: 0 });
    expect(mem.runs[0].summary).toMatchObject({ alerts: { created: 1, pushed: 1, failed: 0 } });
    expect(JSON.stringify(mem.runs[0].summary)).not.toMatch(/push\.example|tok-/);
  });

  it('a broken alert store never fails the tick or the recorded run', async () => {
    const { deps, alerts, mem } = setup();
    vi.mocked(alerts.store.context).mockRejectedValue(new Error('db down'));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => a.outcome)).toEqual(['ok', 'ok']);
    expect(s.alerts).toEqual({ created: 0, pushed: 0, failed: 1 });
    expect(mem.runs).toHaveLength(1);
  });

  it('without alert deps the summary has no alerts field (sync-only callers unchanged)', async () => {
    const { deps } = setup();
    const s = await runTick({ ...deps, alerts: undefined }, { trigger: 'cron' });
    expect(s).not.toHaveProperty('alerts');
  });
});
