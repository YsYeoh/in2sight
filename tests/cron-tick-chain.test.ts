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

import { POST } from '@/app/api/cron/tick/route';
import { chainDepth, chainTarget, MAX_CHAIN, shouldChain } from '@/lib/sync/chain';

const SECRET = 'c'.repeat(40);
const req = (chain?: string) => new NextRequest('https://app.test/api/cron/tick', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, ...(chain ? { 'x-tick-chain': chain } : {}) } });
const fetchMock = vi.fn();

beforeEach(() => {
  pending.length = 0;
  runTick.mockReset().mockResolvedValue({ accounts: [], more: false });
  createSyncDeps.mockReset().mockReturnValue({});
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_x');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://in2sight.example');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const run = async (chain?: string) => {
  await POST(req(chain));
  await pending[0]();
};

describe('chain helpers', () => {
  it('chainDepth accepts small integers only', () => {
    expect(chainDepth(null)).toBe(0);
    expect(chainDepth('3')).toBe(3);
    expect(chainDepth('99')).toBe(MAX_CHAIN);
    for (const bad of ['-1', '1.5', 'abc', '', '100', '1e1', ' 2']) expect(chainDepth(bad)).toBe(0);
  });
  it('chainTarget is our own https origin (or localhost over http) and nothing else', () => {
    expect(chainTarget('https://in2sight.example')).toBe('https://in2sight.example/api/cron/tick');
    expect(chainTarget('https://in2sight.example/some/path?x=1')).toBe('https://in2sight.example/api/cron/tick');
    expect(chainTarget('http://localhost:3000')).toBe('http://localhost:3000/api/cron/tick');
    for (const bad of [undefined, '', 'http://in2sight.example', 'ftp://x', 'https://user:pw@in2sight.example', 'not a url']) expect(chainTarget(bad)).toBeNull();
  });
  it('shouldChain needs more work and room left in the chain', () => {
    expect(shouldChain(true, 0)).toBe(true);
    expect(shouldChain(true, MAX_CHAIN - 1)).toBe(true);
    expect(shouldChain(true, MAX_CHAIN)).toBe(false);
    expect(shouldChain(false, 0)).toBe(false);
  });
});

describe('/api/cron/tick continuation', () => {
  it('starts one follow-up pass when the tick stopped on its time budget', async () => {
    runTick.mockResolvedValue({ accounts: [], more: true });
    await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://in2sight.example/api/cron/tick');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(init.headers['x-tick-chain']).toBe('1');
  });

  it('increments the depth along the chain and stops at the cap', async () => {
    runTick.mockResolvedValue({ accounts: [], more: true });
    await run('4');
    expect(fetchMock.mock.calls[0][1].headers['x-tick-chain']).toBe('5');
    fetchMock.mockClear();
    pending.length = 0;
    await run(String(MAX_CHAIN));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not chain when nothing is left, or when Meta throttled the app (more=false)', async () => {
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not chain without a safe own origin', async () => {
    runTick.mockResolvedValue({ accounts: [], more: true });
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://evil.example');
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failing follow-up request or a failing tick never throws out of the background task', async () => {
    runTick.mockResolvedValue({ accounts: [], more: true });
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(run()).resolves.toBeUndefined();
    pending.length = 0;
    runTick.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(run()).resolves.toBeUndefined();
  });

  it('an unauthenticated call can never start a chain', async () => {
    const res = await POST(new NextRequest('https://app.test/api/cron/tick', { method: 'POST', headers: { 'x-tick-chain': '1' } }));
    expect(res.status).toBe(401);
    expect(pending).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
