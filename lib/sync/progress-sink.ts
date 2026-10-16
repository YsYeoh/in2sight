// Live progress for the panel: throttled, best-effort writes of the account's sync_progress row. A failing write never
// throws and is never retried, so progress can never fail or stall a sync. Counts, keys and a day only: no tokens.
import type { LiveState, Stage } from '@/lib/sync/progress';
import type { SyncStore } from '@/lib/sync/store';

/** At most one write per account this often while the stage stays the same. */
export const THROTTLE_MS = 3_000;

export interface ProgressSink {
  /** What the run is doing now. Written at once when the stage changes, otherwise at most every THROTTLE_MS. */
  report(stage: Stage, done: number, total: number | null, day?: string | null): Promise<void>;
  /** End of this account's run in this pass: done (nothing left), waiting (more to do) or failed. */
  finish(state: Exclude<LiveState, 'running'>, errorKey: string | null): Promise<void>;
}

export function progressSink(store: SyncStore, accountId: string, clock: () => number): ProgressSink {
  let stage: Stage | null = null;
  let snap: { done: number; total: number | null; day: string | null } = { done: 0, total: null, day: null };
  let last = -Infinity;
  const write = async (state: LiveState, errorKey: string | null) => {
    const at = new Date(clock()).toISOString();
    try {
      await store.writeProgress(accountId, { stage, state, done: snap.done, total: snap.total, detailDay: snap.day, errorKey, updatedAt: at, finishedAt: state === 'done' ? at : null });
    } catch {
      // best-effort: the panel shows the persisted state; the sync carries on
    }
  };
  return {
    async report(s, done, total, day = null) {
      const now = clock();
      const changed = s !== stage;
      stage = s;
      snap = { done, total, day };
      if (!changed && now - last < THROTTLE_MS) return;
      last = now;
      await write('running', null);
    },
    finish: (state, errorKey) => write(state, errorKey),
  };
}
