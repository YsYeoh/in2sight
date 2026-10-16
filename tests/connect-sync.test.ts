// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runTick, createSyncDeps, continueChain } = vi.hoisted(() => ({ runTick: vi.fn(), createSyncDeps: vi.fn(), continueChain: vi.fn() }));
vi.mock('@/lib/sync/deps', () => ({ createSyncDeps }));
vi.mock('@/lib/sync/tick', async (orig) => ({ ...(await orig<object>()), runTick }));
vi.mock('@/lib/sync/chain', async (orig) => ({ ...(await orig<object>()), continueChain }));

import { syncAccountNow } from '@/lib/sync/connect-sync';

const SECRET = 'c'.repeat(40);

beforeEach(() => {
  runTick.mockReset().mockResolvedValue({ accounts: [], more: false });
  createSyncDeps.mockReset().mockReturnValue({ __deps: true });
  continueChain.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_x');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('syncAccountNow (right after connecting an account)', () => {
  it('syncs exactly that account as a manual run with the tick budget', async () => {
    await syncAccountNow('acc-1');
    expect(runTick).toHaveBeenCalledWith({ __deps: true }, { trigger: 'manual', accountId: 'acc-1', budgetMs: 35_000 });
    expect(continueChain).not.toHaveBeenCalled();
  });

  it('keeps going (chain, depth 0) while the backfill still has work', async () => {
    runTick.mockResolvedValue({ accounts: [], more: true });
    await syncAccountNow('acc-1');
    expect(continueChain).toHaveBeenCalledWith(SECRET, 0);
  });

  it('never throws: a failing sync or missing configuration falls back to the scheduler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    runTick.mockRejectedValue(new Error('boom'));
    await expect(syncAccountNow('acc-1')).resolves.toBeUndefined();
    vi.stubEnv('CRON_SECRET', '');
    await expect(syncAccountNow('acc-1')).resolves.toBeUndefined();
    expect(runTick).toHaveBeenCalledTimes(1); // the second call stopped at the missing secret, before any work
  });
});
