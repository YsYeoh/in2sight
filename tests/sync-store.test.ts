import { describe, expect, it } from 'vitest';
import { clearSyncError, listSyncStatus, rowToState, supabaseSyncStore } from '@/lib/sync/store';

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
      chain.maybeSingle = next;
      chain.single = next;
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const NOW = '2026-10-14T02:00:00.000Z';

describe('rowToState', () => {
  it('maps a row and defaults missing values', () => {
    expect(rowToState({ account_id: 'a1', last_run: { stories: NOW }, consecutive_failures: 2, daily_done_through: '2026-10-13' })).toMatchObject({ accountId: 'a1', consecutiveFailures: 2, dailyDoneThrough: '2026-10-13', lastRun: { stories: NOW }, leaseUntil: null });
    expect(rowToState({ account_id: 'a1', last_run: null }).lastRun).toEqual({});
  });
});

describe('supabaseSyncStore', () => {
  it('ownerTimezone reads the owner profile and falls back to the default for missing/invalid values', async () => {
    const ok = recorder([{ data: { user_id: 'u1' } }, { data: { timezone: 'Europe/London' } }]);
    expect(await supabaseSyncStore(ok.db).ownerTimezone()).toBe('Europe/London');
    expect(ok.calls[1]).toMatchObject({ table: 'profiles', filters: [['eq', 'user_id', 'u1']] });
    expect(await supabaseSyncStore(recorder([{ data: null }]).db).ownerTimezone()).toBe('Asia/Kuala_Lumpur');
    expect(await supabaseSyncStore(recorder([{ data: { user_id: 'u1' } }, { data: { timezone: 'Mars/Base' } }]).db).ownerTimezone()).toBe('Asia/Kuala_Lumpur');
  });

  it('loadStates returns an empty state for accounts without a row', async () => {
    const r = recorder([{ data: [{ account_id: 'a1', consecutive_failures: 1, last_run: {} }] }]);
    const m = await supabaseSyncStore(r.db).loadStates(['a1', 'a2']);
    expect(m.get('a1')?.consecutiveFailures).toBe(1);
    expect(m.get('a2')).toMatchObject({ accountId: 'a2', lastAttemptAt: null, lastRun: {} });
    expect(r.calls[0].filters).toEqual([['in', 'account_id', ['a1', 'a2']]]);
  });

  it('claimLease: ensures the row, then one conditional UPDATE (free or expired lease) that stamps the attempt and returns the fresh row', async () => {
    const won = recorder([{ data: null }, { data: [{ account_id: 'a1', consecutive_failures: 2, last_run: { stories: NOW } }] }]);
    const state = await supabaseSyncStore(won.db).claimLease('a1', 'L1', '2026-10-14T02:02:00.000Z', NOW);
    expect(state).toMatchObject({ accountId: 'a1', consecutiveFailures: 2, lastRun: { stories: NOW } });
    expect(won.calls[0]).toMatchObject({ table: 'sync_state', op: 'upsert', args: [{ account_id: 'a1' }, { onConflict: 'account_id', ignoreDuplicates: true }] });
    expect(won.calls[1]).toMatchObject({ table: 'sync_state', op: 'update', args: [{ lease_id: 'L1', lease_until: '2026-10-14T02:02:00.000Z', last_attempt_at: NOW }, '*'] });
    expect(won.calls[1].filters).toEqual([['eq', 'account_id', 'a1'], ['or', `lease_until.is.null,lease_until.lt."${NOW}"`]]);
    const lost = recorder([{ data: null }, { data: [] }]);
    expect(await supabaseSyncStore(lost.db).claimLease('a1', 'L2', NOW, NOW)).toBeNull();
  });

  it('saveState releases the lease only if this tick still holds it', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).saveState('a1', 'L1', { lastAttemptAt: NOW, lastSuccessAt: NOW, consecutiveFailures: 0, lastErrorKey: null, dailyDoneThrough: '2026-10-13', lastRun: { stories: NOW } });
    expect(r.calls[0].args[0]).toMatchObject({ lease_id: null, lease_until: null, last_success_at: NOW, last_run: { stories: NOW } });
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', 'a1'], ['eq', 'lease_id', 'L1']]);
    const failed = recorder();
    await supabaseSyncStore(failed.db).saveState('a1', 'L1', { lastAttemptAt: NOW, consecutiveFailures: 1, lastErrorKey: 'rate_limited', dailyDoneThrough: null, lastRun: {} });
    expect(failed.calls[0].args[0]).not.toHaveProperty('last_success_at');
  });

  it('upserts are idempotent: keyed on the natural primary key', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.upsertDaily('a1', '2026-10-13', { reach: 1, views: 2, accountsEngaged: 3, totalInteractions: 4, linkTaps: 5, follows: null, unfollows: null });
    await s.upsertFollowers('a1', '2026-10-14', 1520);
    await s.upsertAudience('a1', '2026-10-14', 'country', { MY: 9 });
    await s.upsertOnlineFollowers('a1', '2026-10-13', Array(24).fill(0));
    expect(r.calls.map((c) => [c.table, c.op, (c.args[1] as { onConflict: string }).onConflict])).toEqual([
      ['account_daily', 'upsert', 'account_id,day'],
      ['account_daily', 'upsert', 'account_id,day'],
      ['audience_snapshots', 'upsert', 'account_id,day,kind'],
      ['online_followers', 'upsert', 'account_id,day'],
    ]);
    expect(r.calls[0].args[0]).not.toHaveProperty('followers'); // metrics upsert never clobbers the follower count
    expect(Object.keys(r.calls[1].args[0] as object).sort()).toEqual(['account_id', 'day', 'followers']);
  });

  it('upsertMedia writes stories with a 24h expiry and never sends last_metrics_at / gone_at', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).upsertMedia('a1', [
      { id: 's1', kind: 'STORY', caption: null, permalink: null, postedAt: '2026-10-14T01:00:00.000Z' },
      { id: 'p1', kind: 'IMAGE', caption: 'x', permalink: 'https://www.instagram.com/p/x/', postedAt: '2026-10-10T01:00:00.000Z' },
    ]);
    const [rows, opts] = r.calls[0].args as [Record<string, unknown>[], unknown];
    expect(opts).toEqual({ onConflict: 'id' });
    expect(rows[0]).toMatchObject({ id: 's1', account_id: 'a1', media_type: 'STORY', expires_at: '2026-10-15T01:00:00.000Z' });
    expect(rows[1].expires_at).toBeNull();
    for (const row of rows) expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['last_metrics_at']));
    await supabaseSyncStore(recorder().db).upsertMedia('a1', []); // no-op, no query
  });

  it('mediaForMetrics: feed/reels only, not gone, recent or never captured', async () => {
    const r = recorder([{ data: [{ id: 'p1', posted_at: NOW, last_metrics_at: null }] }]);
    expect(await supabaseSyncStore(r.db).mediaForMetrics('a1', '2026-09-14T02:00:00.000Z')).toEqual([{ id: 'p1', postedAt: NOW, lastMetricsAt: null }]);
    expect(r.calls[0].filters).toEqual([
      ['eq', 'account_id', 'a1'],
      ['neq', 'media_type', 'STORY'],
      ['is', 'gone_at', null],
      ['or', 'posted_at.gte."2026-09-14T02:00:00.000Z",last_metrics_at.is.null'],
    ]);
  });

  it('insertMetrics ignores a duplicate (media_id, captured_at)', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).insertMetrics('p1', NOW, { reach: 1, views: 2, likes: 3, comments: 4, shares: 5, saves: 6, totalInteractions: 7, replies: null, tapsForward: null, tapsBack: null, exits: null });
    expect(r.calls[0]).toMatchObject({ table: 'media_metrics', op: 'upsert' });
    expect(r.calls[0].args[1]).toEqual({ onConflict: 'media_id,captured_at', ignoreDuplicates: true });
    expect(r.calls[0].args[0]).toMatchObject({ media_id: 'p1', saves: 6, total_interactions: 7, taps_forward: null });
  });

  it('getToken returns null for a missing token; errors never carry Supabase messages', async () => {
    expect(await supabaseSyncStore(recorder([{ data: null }]).db).getToken('a1')).toBeNull();
    expect(await supabaseSyncStore(recorder([{ data: { access_token: 'IGQ' } }]).db).getToken('a1')).toBe('IGQ');
    const err = await supabaseSyncStore(recorder([{ error: { message: 'token IGQ-leak' } }]).db).getToken('a1').catch((e) => e);
    expect(err.message).toBe('sync store: getToken failed');
  });
});

describe('clearSyncError', () => {
  it('resets failures and the error key for one account, and never throws', async () => {
    const r = recorder();
    await clearSyncError(r.db, 'a1');
    expect(r.calls[0]).toMatchObject({ table: 'sync_state', op: 'update', args: [{ consecutive_failures: 0, last_error_key: null }] });
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', 'a1']]);
    await expect(clearSyncError(recorder([{ error: { message: 'x' } }]).db, 'a1')).resolves.toBeUndefined();
    await expect(clearSyncError({} as never, 'a1')).resolves.toBeUndefined();
  });
});

describe('listSyncStatus', () => {
  it('maps rows by account id and is empty on error', async () => {
    const r = recorder([{ data: [{ account_id: 'a1', last_success_at: NOW, last_error_key: null, consecutive_failures: 0 }] }]);
    expect(await listSyncStatus(r.db)).toEqual({ a1: { lastSuccessAt: NOW, lastErrorKey: null, consecutiveFailures: 0 } });
    expect(await listSyncStatus(recorder([{ error: { message: 'x' } }]).db)).toEqual({});
  });
});
