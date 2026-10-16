import { describe, expect, it } from 'vitest';
import { listSyncStatus, resetSyncProgress, rowToState, supabaseSyncStore } from '@/lib/sync/store';

type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][] };

/** Records every query-builder call; each awaited query resolves to the next queued result (default: ok, no data). */
function recorder(results: { data?: unknown; error?: unknown }[] = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = (...a: unknown[]) => ((call.op = op), call.args.push(...a), chain);
      chain.select = (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain);
      for (const f of ['eq', 'neq', 'in', 'is', 'or', 'limit']) chain[f] = (...a: unknown[]) => (call.filters.push([f, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const NOW = '2026-10-14T02:00:00.000Z';

describe('backward edge (backfilled_from)', () => {
  it('is read from the row and written back with the state', async () => {
    expect(rowToState({ account_id: 'a1', backfilled_from: '2026-09-01' }).backfilledFrom).toBe('2026-09-01');
    expect(rowToState({ account_id: 'a1' }).backfilledFrom).toBeNull();
    const r = recorder();
    await supabaseSyncStore(r.db).saveState('a1', 'L1', { lastAttemptAt: NOW, consecutiveFailures: 0, lastErrorKey: null, dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-09-01', lastRun: {} });
    expect(r.calls[0].args[0]).toMatchObject({ daily_done_through: '2026-10-13', backfilled_from: '2026-09-01' });
  });
});

describe('live progress writes', () => {
  it('upserts one row per account with counts and keys only; finished_at only when given', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.writeProgress('a1', { stage: 'account_days', state: 'running', done: 12, total: 90, detailDay: '2026-09-02', errorKey: null, updatedAt: NOW });
    expect(r.calls[0]).toMatchObject({ table: 'sync_progress', op: 'upsert', args: [{ account_id: 'a1', stage: 'account_days', state: 'running', done: 12, total: 90, detail_day: '2026-09-02', error_key: null, updated_at: NOW }, { onConflict: 'account_id' }] });
    expect(r.calls[0].args[0]).not.toHaveProperty('finished_at');
    expect(r.calls[0].args[0]).not.toHaveProperty('started_at'); // a run never moves the session start
    await s.writeProgress('a1', { stage: 'audience', state: 'done', done: 1, total: 1, detailDay: null, errorKey: null, updatedAt: NOW, finishedAt: NOW });
    expect(r.calls[1].args[0]).toMatchObject({ finished_at: NOW });
  });

  it('a failed write throws a fixed message (the sink swallows it)', async () => {
    const r = recorder([{ error: { message: 'relation "sync_progress" does not exist' } }]);
    await expect(supabaseSyncStore(r.db).writeProgress('a1', { stage: null, state: 'waiting', done: 0, total: null, detailDay: null, errorKey: null, updatedAt: NOW })).rejects.toThrow('sync store: writeProgress failed');
  });

  it('resetSyncProgress starts a new session (start time, waiting, unfinished) and never throws', async () => {
    const r = recorder();
    await resetSyncProgress(r.db, 'a1', NOW);
    expect(r.calls[0]).toMatchObject({ table: 'sync_progress', op: 'upsert', args: [{ account_id: 'a1', stage: null, state: 'waiting', done: 0, started_at: NOW, finished_at: null, error_key: null }, { onConflict: 'account_id' }] });
    expect(r.calls.some((c) => c.table === 'sync_state')).toBe(false); // coverage is never reset
    await expect(resetSyncProgress({} as never, 'a1', NOW)).resolves.toBeUndefined();
  });
});

describe('listSyncStatus backfilling flag', () => {
  it('new accounts are importing, finished and pre-Plan-11a accounts are not', async () => {
    const r = recorder([
      {
        data: [
          { account_id: 'new', consecutive_failures: 0, daily_done_through: null, backfilled_from: null, last_run: {} },
          { account_id: 'half', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: '2026-09-20', last_run: { daily: NOW } },
          { account_id: 'done', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: '2026-07-16', last_run: { backfill: NOW } },
          { account_id: 'legacy', consecutive_failures: 0, daily_done_through: '2026-10-13', backfilled_from: null, last_run: { daily: NOW } },
        ],
      },
    ]);
    const s = await listSyncStatus(r.db);
    expect(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.backfilling]))).toEqual({ new: true, half: true, done: false, legacy: false });
    expect(s.half.backfilledFrom).toBe('2026-09-20');
    expect(r.calls[0].args[0]).toContain('backfilled_from');
    expect(r.calls[0].args[0]).toContain('last_run');
  });
});
