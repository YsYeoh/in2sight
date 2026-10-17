import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointKey, igData, type Archive, type IgData } from '@/lib/instagram/data';
import { ARCHIVE_WAIT_MS, runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { SNAPSHOT_MAX_BYTES, supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
afterEach(() => vi.useRealTimers());

describe('data client archive hook', () => {
  const body = { data: [{ name: 'reach', total_value: { value: 5 } }] };
  const fn = (async () => new Response(JSON.stringify(body))) as typeof fetch;

  it('account insights and audience calls hand their raw body and a token-free key to the archive', async () => {
    const seen: [string, unknown][] = [];
    const archive: Archive = (e, b) => void seen.push([e, b]);
    const ig = igData('v25.0', fn);
    await ig.accountDay('IGQ-secret', 100, 200, archive);
    await ig.accountDayBreakdown('IGQ-secret', 100, 200, archive);
    await ig.audience('IGQ-secret', 'country', archive);
    await ig.onlineFollowers('IGQ-secret', 100, 200, archive);
    expect(seen).toHaveLength(2 + 2 + 1 + 1);
    expect(seen[0]).toEqual(['me/insights?metric=reach%2Cviews%2Caccounts_engaged%2Ctotal_interactions%2Cprofile_links_taps&metric_type=total_value&period=day&since=100&until=200', body]);
    expect(JSON.stringify(seen)).not.toContain('IGQ-secret');
  });

  it('keys are stable whatever the parameter order', () => {
    expect(endpointKey('me/insights', { b: 2, a: 1 })).toBe(endpointKey('me/insights', { a: 1, b: 2 }));
  });

  it('a throwing archive never costs the call', async () => {
    const v = await igData('v25.0', fn).accountDay('t', 1, 2, () => {
      throw new Error('archive down');
    });
    expect(v.reach).toBe(5);
  });

  it('paging links carry the access token: they are stripped from the archived body, the caller still sees the full answer', async () => {
    const withPaging = { ...body, paging: { next: 'https://graph.instagram.com/v25.0/me/insights?access_token=IGQ-secret&since=1' } };
    const seen: unknown[] = [];
    const v = await igData('v25.0', (async () => new Response(JSON.stringify(withPaging))) as typeof fetch).accountDay('IGQ-secret', 1, 2, (_e, b) => void seen.push(b));
    expect(v.reach).toBe(5);
    expect(seen).toEqual([body, body]);
    expect(JSON.stringify(seen)).not.toMatch(/access_token|IGQ-secret|paging/);
  });
});

describe('runner wiring', () => {
  function ctx() {
    const ig = fakeIg();
    const mem = memoryStore();
    const acc = account({ id: 'a1' });
    // the fakes call the archive like the real client would
    ig.accountDay.mockImplementation((async (_t: string, since: number, _u: number, archive?: Archive) => {
      archive?.(`me/insights?day=${since}`, { data: [{ name: 'reach', total_value: { value: 1 } }] });
      return { reach: 1, views: 1, accountsEngaged: 1, totalInteractions: 1, linkTaps: 1, follows: null, unfollows: null };
    }) as IgData['accountDay']);
    ig.audience.mockImplementation((async (_t: string, kind: string, archive?: Archive) => (archive?.(`aud-${kind}`, { data: [] }), {})) as IgData['audience']);
    const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState('a1'), tz: 'UTC', now: NOW, deadline: 1e9, clock: () => 0 };
    return { c, ig, mem };
  }

  it('daily + audience bodies are archived for this account (media lists, media insights and comments never are)', async () => {
    const { c, mem } = ctx();
    await runAccount(c, ['daily', 'audience', 'mediaList', 'mediaMetrics', 'stories']);
    expect(mem.archived.length).toBe(7 + 3);
    expect(mem.archived.every((a) => a.accountId === 'a1' && a.capturedAt === NOW.toISOString())).toBe(true);
    expect(mem.archived.map((a) => a.endpoint)).toContain('aud-country');
  });

  it('a failing archive write never fails a job', async () => {
    const { c, mem } = ctx();
    mem.store.archiveSnapshot = async () => {
      throw new Error('sync store: archiveSnapshot failed');
    };
    const { result } = await runAccount(c, ['daily']);
    expect(result.outcome).toBe('ok');
  });

  it('a hanging archive write holds the run up for at most ARCHIVE_WAIT_MS', async () => {
    vi.useFakeTimers();
    const { c, mem } = ctx();
    mem.store.archiveSnapshot = () => new Promise<void>(() => {});
    let done = false;
    const run = runAccount(c, ['audience']).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(ARCHIVE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).result.outcome).toBe('ok');
  });
});

describe('store: api_snapshots', () => {
  function recorder() {
    const calls: unknown[][] = [];
    const db = { from: (t: string) => ({ upsert: async (row: unknown, opts: unknown) => (calls.push([t, row, opts]), { error: null }) }) };
    return { db: db as never, calls };
  }
  it('dedupes on (account, endpoint, sha256 of the JSON text); identical bodies hash the same', async () => {
    const r = recorder();
    const body = { data: [{ name: 'reach', total_value: { value: 9 } }] };
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'me/insights?x=1', body, 'T');
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    expect(r.calls[0]).toEqual(['api_snapshots', { account_id: 'a1', endpoint: 'me/insights?x=1', captured_at: 'T', body, body_hash: hash }, { onConflict: 'account_id,endpoint,body_hash', ignoreDuplicates: true }]);
  });
  it('skips bodies over 64 KB', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'e', { blob: 'x'.repeat(SNAPSHOT_MAX_BYTES) }, 'T');
    expect(r.calls).toHaveLength(0);
  });
  it('never stores a body or key that carries an access token', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'me/insights?x=1', { paging: { next: 'https://graph.instagram.com/x?access_token=IGQ-secret' } }, 'T');
    await supabaseSyncStore(r.db).archiveSnapshot('a1', 'me/insights?access_token=IGQ-secret', { data: [] }, 'T');
    expect(r.calls).toHaveLength(0);
  });
});
