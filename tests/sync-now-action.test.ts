import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, runTick } = vi.hoisted(() => ({ calls: [] as string[], requireOwner: vi.fn(), runTick: vi.fn() }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/sync/deps', () => ({ createSyncDeps: () => (calls.push('deps'), { __deps: true }) }));
vi.mock('@/lib/sync/tick', () => ({ TICK_BUDGET_MS: 45_000, runTick: (...a: unknown[]) => (calls.push('tick'), runTick(...a)) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => calls.push(`revalidate:${p}`) }));

import { syncNowAction } from '@/app/(app)/accounts/actions';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const summary = (accounts: unknown[]) => ({ trigger: 'manual', startedAt: '', durationMs: 1, stoppedEarly: false, accounts });

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('requireOwner'));
  runTick.mockReset().mockResolvedValue(summary([{ accountId: ID, outcome: 'ok', jobs: ['stories'] }]));
});

describe('syncNowAction', () => {
  it('checks the owner first, then runs a manual tick for that one account', async () => {
    expect(await syncNowAction(ID)).toEqual({ ok: true });
    expect(calls.slice(0, 3)).toEqual(['requireOwner', 'deps', 'tick']);
    expect(runTick).toHaveBeenCalledWith({ __deps: true }, { trigger: 'manual', budgetMs: 45_000, accountId: ID });
    expect(calls).toContain('revalidate:/accounts');
  });

  it('does nothing when requireOwner redirects', async () => {
    requireOwner.mockRejectedValue(new Error('REDIRECT:/login'));
    await expect(syncNowAction(ID)).rejects.toThrow('REDIRECT');
    expect(runTick).not.toHaveBeenCalled();
  });

  it('rejects a non-uuid id without running anything', async () => {
    expect(await syncNowAction('nope')).toEqual({ ok: false, error: 'not_found' });
    expect(runTick).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'not_active'],
    [[{ accountId: ID, outcome: 'locked', jobs: [] }], 'busy'],
    [[{ accountId: ID, outcome: 'failed', jobs: [], errorKey: 'rate_limited' }], 'rate_limited'],
    [[{ accountId: ID, outcome: 'needs_reconnect', jobs: [], errorKey: 'token_invalid' }], 'token_invalid'],
  ])('maps the tick outcome %j to the error key %s', async (accounts, error) => {
    runTick.mockResolvedValue(summary(accounts));
    expect(await syncNowAction(ID)).toEqual({ ok: false, error });
  });

  it('a partial run (time budget) still counts as ok', async () => {
    runTick.mockResolvedValue(summary([{ accountId: ID, outcome: 'partial', jobs: ['stories'] }]));
    expect(await syncNowAction(ID)).toEqual({ ok: true });
  });

  it('unexpected failures become a generic key without details', async () => {
    runTick.mockRejectedValue(new Error('db password hunter2'));
    const r = await syncNowAction(ID);
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});
