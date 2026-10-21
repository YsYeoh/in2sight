// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, toPayload } from '@/lib/followers/payload';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const state = vi.hoisted(() => ({
  owner: true,
  account: { id: '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b', status: 'active' } as { id: string; status: string } | null,
  save: 'ok' as string | Error,
  order: [] as string[],
  saved: [] as unknown[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    state.order.push('assertOwner');
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (state.order.push('ownerSession'), {}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => state.order.push('ADMIN') }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (state.order.push('prefs'), (await import('@/lib/prefs')).DEFAULT_PREFS) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ getById: async (id: string) => (state.order.push(`account:${id}`), state.account) }) }));
vi.mock('@/lib/followers/read', () => ({
  saveFollowerSnapshot: async (_db: unknown, accountId: string, u: unknown) => {
    state.order.push('save');
    state.saved.push([accountId, u]);
    if (state.save instanceof Error) throw state.save;
    return state.save;
  },
}));

import { POST } from '@/app/api/accounts/[id]/followers/route';

const GOOD = toPayload({ takenOn: '2026-10-01', followers: [{ username: 'alice', at: 1_700_000_000 }], following: null });
const URL_ = `https://app.test/api/accounts/${ACC}/followers`;
const headersFor = (body: string, extra: Record<string, string> = {}) => ({ origin: 'https://app.test', host: 'app.test', 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length), ...extra });
const call = (body: BodyInit | null, headers: Record<string, string>, id = ACC) => POST(new Request(URL_, { method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit), { params: Promise.resolve({ id }) });
const err = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  state.owner = true;
  state.account = { id: ACC, status: 'active' };
  state.save = 'ok';
  state.order = [];
  state.saved = [];
});

describe('POST /api/accounts/[id]/followers', () => {
  it('stores a valid upload for the live account: 201, private no-store, nosniff, the owner session headers kept', async () => {
    const res = await call(GOOD, headersFor(GOOD));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.order).toEqual(['assertOwner', 'prefs', 'ownerSession', `account:${ACC}`, 'save']);
    expect(state.saved).toEqual([[ACC, { takenOn: '2026-10-01', followers: [{ username: 'alice', at: 1_700_000_000 }], following: null }]]);
  });

  it('the owner check comes first: a stranger gets 401 and nothing else runs', async () => {
    state.owner = false;
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(state.order).toEqual(['assertOwner']);
  });

  it('then the account id, the origin and the content type, before the body is touched', async () => {
    expect(await err(await call(GOOD, headersFor(GOOD), 'not-a-uuid'))).toEqual({ status: 404, body: { error: 'notFound' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { origin: 'https://evil.example' })))).toEqual({ status: 403, body: { error: 'unauthorized' } });
    const noOrigin: Record<string, string> = headersFor(GOOD);
    delete noOrigin.origin;
    expect(await err(await call(GOOD, noOrigin))).toEqual({ status: 403, body: { error: 'unauthorized' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-type': 'text/plain' })))).toEqual({ status: 415, body: { error: 'invalid' } });
    expect(state.order.every((s) => s === 'assertOwner')).toBe(true);
  });

  it('behind a proxy the forwarded host is the one compared', async () => {
    const res = await call(GOOD, headersFor(GOOD, { origin: 'https://in2sight.example', host: 'internal:3000', 'x-forwarded-host': 'in2sight.example' }));
    expect(res.status).toBe(201);
  });

  it('size: a declared length over the cap is refused before reading (413); no length → 411', async () => {
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-length': String(MAX_BODY_BYTES + 1) })))).toEqual({ status: 413, body: { error: 'tooLarge' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-length': '0' })))).toEqual({ status: 411, body: { error: 'invalid' } });
    expect(state.order).not.toContain('prefs');
  });

  it('a lying content-length cannot get more in: the reader stops at the cap and nothing is parsed or saved', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32); // 1 MB of spaces
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 50) c.close();
        else c.enqueue(chunk);
      },
    });
    expect(await err(await call(stream, headersFor('', { 'content-length': '100' })))).toEqual({ status: 413, body: { error: 'tooLarge' } });
    expect(pulled).toBeLessThan(10); // stopped right after passing 4 MB, not after 50 MB
    expect(state.order).toEqual(['assertOwner']);
  });

  it('not UTF-8, not JSON or not the exact payload → 400 invalid, nothing saved', async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect(await err(await call(bytes, { ...headersFor(''), 'content-length': '4' }))).toEqual({ status: 400, body: { error: 'invalid' } });
    for (const body of ['{"v":1', '[]', GOOD.replace('"v":1', '"v":1,"extra":true'), GOOD.replace('alice', 'Alice'), GOOD.replace('2026-10-01', '2099-01-01')])
      expect(await err(await call(body, headersFor(body))), body.slice(0, 40)).toEqual({ status: 400, body: { error: 'invalid' } });
    expect(state.order).not.toContain('save');
  });

  it('unknown or archived account → 404; cap → 409; migration missing → 503', async () => {
    state.account = null;
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 404, body: { error: 'notFound' } });
    state.account = { id: ACC, status: 'archived' };
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 404, body: { error: 'notFound' } });
    state.account = { id: ACC, status: 'active' };
    state.save = 'tooManySnapshots';
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 409, body: { error: 'tooManySnapshots' } });
    state.save = 'notReady';
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 503, body: { error: 'notReady' } });
  });

  it('a failure is a fixed 500 and a fixed log line: no error object, no usernames', async () => {
    state.save = new Error('insert failed for alice');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 500, body: { error: 'unexpected' } });
    expect(log.mock.calls).toEqual([['followers upload failed']]);
    log.mockRestore();
  });

  it('never the admin client', async () => {
    await call(GOOD, headersFor(GOOD));
    expect(state.order).not.toContain('ADMIN');
  });
});
