import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification } }));

import { sendToAll, vapidFromEnv, webPushTransport, type PushSub } from '@/lib/push/send';

const MSG = { title: 'Reconnect needed', body: '@cafe lost its connection', url: '/accounts', tag: 'needs_reconnect:a1' };
const sub = (n: number): PushSub => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });
const VAPID = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:me@example.com' };

beforeEach(() => sendNotification.mockReset());

describe('sendToAll', () => {
  it('sends the JSON message to every subscription', async () => {
    const transport = vi.fn(async () => 201);
    const r = await sendToAll([sub(1), sub(2)], MSG, transport, vi.fn());
    expect(r).toEqual({ sent: 2, failed: 0, pruned: 0 });
    expect(transport).toHaveBeenCalledWith(sub(1), JSON.stringify(MSG));
  });

  it('410 and 404 prune that subscription only; the others still get the push', async () => {
    const prune = vi.fn<(endpoint: string) => Promise<void>>(async () => {});
    const status: Record<string, number> = { 'https://push.example/1': 410, 'https://push.example/2': 201, 'https://push.example/3': 404 };
    const r = await sendToAll([sub(1), sub(2), sub(3)], MSG, async (s) => status[s.endpoint], prune);
    expect(r).toEqual({ sent: 1, failed: 0, pruned: 2 });
    expect(prune.mock.calls.map((c) => c[0]).sort()).toEqual(['https://push.example/1', 'https://push.example/3']);
  });

  it('429, 500, network errors and a throwing transport count as failed and are kept (retried next alert)', async () => {
    const prune = vi.fn(async () => {});
    const codes = [429, 500, 0];
    let i = 0;
    const r = await sendToAll([sub(1), sub(2), sub(3), sub(4)], MSG, async () => {
      if (i === 3) throw new Error('boom');
      return codes[i++];
    }, prune);
    expect(r).toEqual({ sent: 0, failed: 4, pruned: 0 });
    expect(prune).not.toHaveBeenCalled();
  });

  it('a failing prune never throws', async () => {
    await expect(sendToAll([sub(1)], MSG, async () => 410, async () => Promise.reject(new Error('db down')))).resolves.toEqual({ sent: 0, failed: 0, pruned: 1 });
  });

  it('no subscriptions: nothing sent', async () => {
    expect(await sendToAll([], MSG, vi.fn(), vi.fn())).toEqual({ sent: 0, failed: 0, pruned: 0 });
  });
});

describe('webPushTransport', () => {
  it('signs with VAPID, sets a TTL and a timeout, returns the status', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await webPushTransport(VAPID)(sub(1), '{}')).toBe(201);
    expect(sendNotification).toHaveBeenCalledWith(sub(1), '{}', expect.objectContaining({ vapidDetails: VAPID, TTL: 86_400, timeout: 5_000 }));
  });

  it('turns a WebPushError into its status code and anything else into 0', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Received unexpected response code'), { statusCode: 410 }));
    expect(await webPushTransport(VAPID)(sub(1), '{}')).toBe(410);
    sendNotification.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await webPushTransport(VAPID)(sub(1), '{}')).toBe(0);
  });
});

describe('vapidFromEnv', () => {
  it('needs all three values', () => {
    expect(vapidFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:me@example.com' })).toEqual(VAPID);
    expect(vapidFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: ' ', VAPID_SUBJECT: 'mailto:me@example.com' })).toBeNull();
    expect(vapidFromEnv({})).toBeNull();
  });
});
