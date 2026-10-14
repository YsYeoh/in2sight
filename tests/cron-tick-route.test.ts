// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pending, runTick, createSyncDeps } = vi.hoisted(() => ({
  pending: [] as (() => Promise<void>)[],
  runTick: vi.fn(),
  createSyncDeps: vi.fn(),
}));
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<void>) => void pending.push(fn) }));
vi.mock('@/lib/sync/deps', () => ({ createSyncDeps }));
vi.mock('@/lib/sync/tick', async (orig) => ({ ...(await orig<object>()), runTick }));

import { GET, POST, maxDuration } from '@/app/api/cron/tick/route';
import { isCronAuthorized } from '@/lib/sync/cron-auth';

const SECRET = 'c'.repeat(40);
const req = (auth?: string, method = 'GET') => new NextRequest('https://app.test/api/cron/tick', { method, headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  pending.length = 0;
  runTick.mockReset().mockResolvedValue({ accounts: [] });
  createSyncDeps.mockReset().mockReturnValue({ __deps: true });
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_x');
});
afterEach(() => vi.unstubAllEnvs());

describe('/api/cron/tick', () => {
  it('declares an explicit maxDuration for Vercel', () => {
    expect(maxDuration).toBe(60);
  });

  it('accepts the right bearer secret with 202 and runs the tick after the response', async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(runTick).not.toHaveBeenCalled(); // not before the response
    expect(pending).toHaveLength(1);
    await pending[0]();
    expect(runTick).toHaveBeenCalledWith({ __deps: true }, { trigger: 'cron', budgetMs: 45_000 });
  });

  it('POST works the same (schedulers differ)', async () => {
    expect((await POST(req(`Bearer ${SECRET}`, 'POST'))).status).toBe(202);
  });

  it.each([
    ['missing header', undefined],
    ['wrong secret', 'Bearer nope'],
    ['secret without Bearer', SECRET],
    ['wrong scheme', `Basic ${SECRET}`],
    ['secret prefix', `Bearer ${SECRET.slice(0, -1)}`],
    ['secret plus suffix', `Bearer ${SECRET}x`],
    ['empty bearer', 'Bearer '],
  ])('401 for %s, and nothing runs', async (_n, auth) => {
    const res = await GET(req(auth));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(pending).toHaveLength(0);
    expect(createSyncDeps).not.toHaveBeenCalled();
    expect(runTick).not.toHaveBeenCalled();
  });

  it('the 401 body is identical for every kind of bad credential and never echoes the secret', async () => {
    const bodies = await Promise.all([undefined, 'Bearer nope', SECRET, `Bearer ${SECRET}x`].map(async (a) => (await GET(req(a))).text()));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain(SECRET);
  });

  it('fails closed with 503 when CRON_SECRET is not set, even for an empty bearer', async () => {
    vi.stubEnv('CRON_SECRET', '');
    for (const auth of ['Bearer ', 'Bearer x', undefined]) {
      const res = await GET(req(auth));
      expect(res.status).toBe(503);
    }
    expect(pending).toHaveLength(0);
    expect(createSyncDeps).not.toHaveBeenCalled();
  });

  it('503 when Instagram/Supabase env is missing (createSyncDeps throws EnvError)', async () => {
    const { EnvError } = await import('@/lib/env');
    createSyncDeps.mockImplementation(() => {
      throw new EnvError(['IG_APP_ID']);
    });
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(503);
    expect(pending).toHaveLength(0);
  });

  it('a failing tick is logged with a fixed message only', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runTick.mockRejectedValue(new Error('boom with IGQ-token'));
    await GET(req(`Bearer ${SECRET}`));
    await pending[0]();
    expect(spy).toHaveBeenCalledWith('sync tick failed');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('IGQ');
    spy.mockRestore();
  });
});

describe('isCronAuthorized', () => {
  it('only the exact bearer secret passes; an empty secret never does', () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`Bearer ${SECRET} `, SECRET)).toBe(false);
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized('Bearer ', '')).toBe(false);
    expect(isCronAuthorized('Bearer x', '')).toBe(false);
  });
});
