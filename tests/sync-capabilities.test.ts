import { describe, expect, it } from 'vitest';
import { isUnsupported } from '@/lib/instagram/data';
import { call, InstagramApiError } from '@/lib/instagram/oauth';
import { learn, parseCapabilities, shouldAsk } from '@/lib/sync/capabilities';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { rowToState, supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const metaError = (message: string, code = 100, subcode?: number) => json({ error: { message, type: 'IGApiException', code, ...(subcode ? { error_subcode: subcode } : {}) } }, 400);
const fail = async (res: Response) => call('data', (async () => res) as typeof fetch, 'https://graph.instagram.com/x').then(() => null, (e: unknown) => e);

describe('the "unsupported" flag on Meta errors', () => {
  it('is set for "does not support the metric", invalid metric names and unknown fields — the text itself is discarded', async () => {
    const e = await fail(metaError('(#100) The Media Insights API does not support the follows metric for this media product type.'));
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(isUnsupported(e)).toBe(true);
    expect(String((e as Error).message)).not.toMatch(/follows|support/); // fixed message only
    expect(isUnsupported(await fail(metaError('(#100) metric[0] must be one of the following values: reach, views')))).toBe(true);
    expect(isUnsupported(await fail(metaError('(#100) Tried accessing nonexisting field (like_count) on node type (ShadowIGMedia)')))).toBe(true);
  });

  it('is NOT set for other code-100 errors, pre-conversion posts, deleted objects, 5xx, rate limits or network errors', async () => {
    expect(isUnsupported(await fail(metaError('(#100) Invalid parameter')))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support this operation', 100, 2108006)))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support', 100, 33)))).toBe(false);
    // Meta's generic object error, even without a subcode, is about the object and never about the metric
    expect(isUnsupported(await fail(metaError("Unsupported get request. Object with ID '1789' does not exist, cannot be loaded due to missing permissions, or does not support this operation.")))).toBe(false);
    expect(isUnsupported(await fail(metaError('does not support', 2)))).toBe(false);
    expect(isUnsupported(await fail(json({ error: { message: 'does not support', code: 100 } }, 500)))).toBe(true); // code wins, status does not matter
    expect(isUnsupported(await fail(metaError('does not support', 80002)))).toBe(false);
    expect(isUnsupported(new InstagramApiError('network'))).toBe(false);
    expect(isUnsupported(new Error('does not support'))).toBe(false);
  });
});

describe('capability memory (pure)', () => {
  const unsupported = new InstagramApiError('data', 400, 100, undefined, true);
  it('parses only boolean entries', () => {
    expect(parseCapabilities({ 'story:follows': false, 'reels:watch': true, junk: 'x', n: 1 })).toEqual({ 'story:follows': false, 'reels:watch': true });
    expect(parseCapabilities(null)).toEqual({});
    expect(parseCapabilities([true])).toEqual({});
  });
  it('asks unknown and supported metrics, skips only remembered "unsupported"', () => {
    expect(shouldAsk({}, 'story:follows')).toBe(true);
    expect(shouldAsk({ 'story:follows': true }, 'story:follows')).toBe(true);
    expect(shouldAsk({ 'story:follows': false }, 'story:follows')).toBe(false);
  });
  it('learns false only from an "unsupported" answer; transient errors never poison the memory', () => {
    expect(learn({}, 'k', { error: unsupported })).toEqual({ k: false });
    expect(learn({}, 'k', { ok: true })).toEqual({ k: true });
    for (const e of [new InstagramApiError('network'), new InstagramApiError('data', 500, 2), new InstagramApiError('data', 400, 100), new InstagramApiError('data', 400, 10), new Error('db down')]) {
      expect(learn({ k: true }, 'k', { error: e })).toEqual({ k: true });
      expect(learn({}, 'k', { error: e })).toEqual({});
    }
  });
  it('a supported-again metric flips back to true (memory follows Meta)', () => {
    expect(learn({ k: false }, 'k', { ok: true })).toEqual({ k: true });
  });
});

describe('capability memory is persisted with the sync state', () => {
  it('rowToState reads it; saveState writes it only when the patch carries it', async () => {
    expect(rowToState({ account_id: 'a1', capabilities: { 'story:follows': false } }).capabilities).toEqual({ 'story:follows': false });
    const rows: unknown[] = [];
    const db = { from: () => ({ update: (r: unknown) => (rows.push(r), { eq: () => ({ eq: async () => ({ error: null }) }) }) }) };
    const base = { lastAttemptAt: 'x', consecutiveFailures: 0, lastErrorKey: null, dailyDoneThrough: null, backfilledFrom: null, lastRun: {} };
    await supabaseSyncStore(db as never).saveState('a1', 'L', { ...base, capabilities: { 'reels:watch': true } });
    await supabaseSyncStore(db as never).saveState('a1', 'L', base);
    expect(rows[0]).toMatchObject({ capabilities: { 'reels:watch': true } });
    expect(rows[1]).not.toHaveProperty('capabilities');
  });

  it('runAccount carries the stored map into its patch (a remembered "unsupported" survives the run)', async () => {
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig: fakeIg(), store: memoryStore().store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), capabilities: { 'story:follows': false } }, tz: 'UTC', now: new Date('2026-10-14T02:00:00Z'), deadline: 1, clock: () => 0 };
    const { patch } = await runAccount(c, ['stories']);
    expect(patch.capabilities).toMatchObject({ 'story:follows': false });
  });
});
