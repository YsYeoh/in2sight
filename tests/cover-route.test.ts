// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideRoute } from '@/lib/auth/route-policy';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const state = vi.hoisted(() => ({
  owner: true,
  row: null as Record<string, unknown> | null,
  readError: null as unknown,
  blob: null as Blob | null,
  downloads: [] as string[],
  queries: [] as unknown[][],
  order: [] as string[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    state.order.push('assertOwner');
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => {
    state.order.push('ownerSession');
    return {
      from: (t: string) => ({
        select: (cols: string) => ({ eq: (c: string, v: string) => ({ maybeSingle: async () => (state.queries.push([t, cols, c, v]), { data: state.row, error: state.readError }) }) }),
      }),
    };
  },
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => {
    state.order.push('admin');
    return { storage: { from: (b: string) => ({ download: async (p: string) => (state.downloads.push(`${b}:${p}`), state.blob ? { data: state.blob, error: null } : { data: null, error: { message: 'Object not found' } }) }) } };
  },
}));

import { GET } from '@/app/api/media/[id]/cover/route';

const call = (id: string) => GET(new Request(`https://app.test/api/media/${id}/cover`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.owner = true;
  state.row = { account_id: ACC, cover_status: 'ok', cover_path: `${ACC}/17900000000000001.jpg` };
  state.readError = null;
  state.blob = new Blob([JPEG], { type: 'image/jpeg' });
  state.downloads = [];
  state.queries = [];
  state.order = [];
});

describe('GET /api/media/[id]/cover', () => {
  it('streams the owner\'s stored cover: private immutable cache, nosniff, our content type; auth headers kept', async () => {
    const res = await call('17900000000000001');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.order).toEqual(['assertOwner', 'ownerSession', 'admin']); // owner check, then the RLS read, only then Storage
    expect(state.queries[0]).toEqual(['media', 'account_id,cover_status,cover_path', 'id', '17900000000000001']);
    expect(state.downloads).toEqual([`covers:${ACC}/17900000000000001.jpg`]);
  });

  it('401 for anyone but the owner; nothing read; headers kept on that response too', async () => {
    state.owner = false;
    const res = await call('17900000000000001');
    expect(res.status).toBe(401);
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(state.order).toEqual(['assertOwner']);
  });

  it('404 without touching Storage: bad id, media not visible to the owner, no cover yet, or a stored path that is not ours', async () => {
    for (const id of ['abc', '../../etc/passwd', '1'.repeat(40), '17900000000000001.jpg']) {
      const res = await call(id);
      expect(res.status, id).toBe(404);
    }
    for (const row of [null, { account_id: ACC, cover_status: 'pending', cover_path: null }, { account_id: ACC, cover_status: 'ok', cover_path: 'other-account/17900000000000001.jpg' }]) {
      state.row = row;
      const res = await call('17900000000000001');
      expect(res.status).toBe(404);
      expect(res.headers.get('x-from-supabase')).toBe('kept');
    }
    expect(state.downloads).toEqual([]);
  });

  it('object missing in Storage -> 404; a stored type outside the image allowlist is served as JPEG (never sniffed, never SVG)', async () => {
    state.blob = null;
    expect((await call('17900000000000001')).status).toBe(404);
    state.blob = new Blob(['<svg/>'], { type: 'image/svg+xml' });
    const res = await call('17900000000000001');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('a read error -> 500 with a fixed message, still uncached and with the auth headers', async () => {
    state.readError = { message: 'secret detail' };
    const res = await call('17900000000000001');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unexpected' });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
  });

  it('is session-protected by the proxy (no public exemption)', () => {
    expect(decideRoute({ pathname: '/api/media/17900000000000001/cover', configured: true, signedIn: false, aal: null, mfaRequired: false })).toEqual({ type: 'redirect', to: '/login' });
  });
});
