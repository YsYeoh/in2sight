import { describe, expect, it, vi } from 'vitest';
import { DEVICES_MAX, deviceLabel, listPushDevices } from '@/lib/push/devices';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

describe('deviceLabel', () => {
  it.each([
    [UA.chromeWin, 'Chrome · Windows'],
    [UA.edgeWin, 'Edge · Windows'],
    [UA.safariIphone, 'Safari · iPhone'],
    [UA.safariMac, 'Safari · macOS'],
    [UA.firefoxLinux, 'Firefox · Linux'],
    [UA.chromeAndroid, 'Chrome · Android'],
  ])('%s -> %s', (ua, label) => expect(deviceLabel(ua)).toBe(label));

  it('unknown or missing -> null', () => {
    for (const v of [null, undefined, '', '   ', 'curl/8.0']) expect(deviceLabel(v)).toBeNull();
  });
});

/** Owner-session fake for one chained read. */
function db(result: { data?: unknown; error?: unknown } | 'throw') {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ['select', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => (result === 'throw' ? Promise.reject(new Error('x')) : Promise.resolve(result)).then(res, rej);
  return { client: { from: vi.fn((t: string) => (calls.push(['from', t]), chain)) } as never, calls };
}

describe('listPushDevices', () => {
  it('reads ids, user agents and dates only, newest first, capped; maps to labels', async () => {
    const f = db({ data: [{ id: 7, user_agent: UA.chromeWin, created_at: '2026-10-12T08:00:00Z' }, { id: '3', user_agent: null, created_at: '2026-10-01T08:00:00Z' }], error: null });
    expect(await listPushDevices(f.client)).toEqual([
      { id: 7, label: 'Chrome · Windows', createdAt: '2026-10-12T08:00:00Z' },
      { id: 3, label: null, createdAt: '2026-10-01T08:00:00Z' },
    ]);
    expect(f.calls).toEqual([['from', 'push_subscriptions'], ['select', 'id,user_agent,created_at'], ['order', 'created_at', { ascending: false }], ['limit', DEVICES_MAX]]);
    expect(JSON.stringify(f.calls)).not.toMatch(/endpoint|keys/);
  });

  it('a failed read is null, never an empty list; it never throws', async () => {
    expect(await listPushDevices(db({ data: null, error: { message: 'boom' } }).client)).toBeNull();
    expect(await listPushDevices(db('throw').client)).toBeNull();
  });
});
