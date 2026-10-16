import { getServerEnv } from '@/lib/env';
import { continueChain, shouldChain } from '@/lib/sync/chain';
import { createSyncDeps } from '@/lib/sync/deps';
import { runTick, TICK_BUDGET_MS } from '@/lib/sync/tick';

/**
 * Right after an account is connected or reconnected: sync THAT account now instead of waiting for the next 30-minute
 * tick, and keep going (chain) while the backfill still has work. Never throws; failures fall back to the scheduler.
 */
export async function syncAccountNow(accountId: string): Promise<void> {
  try {
    const { cronSecret } = getServerEnv();
    const summary = await runTick(createSyncDeps(), { trigger: 'manual', accountId, budgetMs: TICK_BUDGET_MS });
    if (shouldChain(summary.more === true, 0)) await continueChain(cronSecret, 0);
  } catch {
    console.error('sync after connect failed'); // fixed text: never log error objects
  }
}
