import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, queue } = vi.hoisted(() => ({
  calls: [] as unknown[][],
  requireOwner: vi.fn(),
  queue: [] as { error?: unknown }[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['upsert', 'delete', 'eq', 'select', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { deleteSubscriptionAction, saveAlertSettingsAction, saveSubscriptionAction } from '@/app/(app)/settings/actions';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import { parseSubscription, vapidKeyBytes } from '@/lib/push/subscription';

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) } };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => (calls.push(['requireOwner']), { userId: 'u1', email: null }));
});

describe('parseSubscription', () => {
  it('accepts a real-shaped subscription and keeps only endpoint + keys', () => {
    expect(parseSubscription(SUB)).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys });
  });

  it.each([
    ['http endpoint', { ...SUB, endpoint: 'http://push.example/x' }],
    ['javascript: endpoint', { ...SUB, endpoint: 'javascript:alert(1)' }],
    ['credentials in the URL', { ...SUB, endpoint: 'https://user:pw@fcm.googleapis.com/x' }],
    ['endpoint over 1024 chars', { ...SUB, endpoint: 'https://fcm.googleapis.com/' + 'a'.repeat(1010) }],
    ['an unknown push host', { ...SUB, endpoint: 'https://push.example/x' }],
    ['a look-alike prefix host', { ...SUB, endpoint: 'https://evilfcm.googleapis.com.attacker.test/x' }],
    ['a look-alike suffix host', { ...SUB, endpoint: 'https://fcm.googleapis.com.evil.test/x' }],
    ['an allowed host as a subdomain of another domain', { ...SUB, endpoint: 'https://x.notify.windows.com.evil.test/x' }],
    ['a prefix without a dot', { ...SUB, endpoint: 'https://evilpush.apple.com.test/x' }],
    ['an IPv4 literal', { ...SUB, endpoint: 'https://127.0.0.1/x' }],
    ['an IPv6 literal', { ...SUB, endpoint: 'https://[::1]/x' }],
    ['a metadata address', { ...SUB, endpoint: 'https://169.254.169.254/latest' }],
    ['a non-default port', { ...SUB, endpoint: 'https://fcm.googleapis.com:8443/x' }],
    ['a bare push.apple.com suffix with no label', { ...SUB, endpoint: 'https://apple.com/x' }],
    ['missing keys', { endpoint: SUB.endpoint }],
    ['short p256dh', { ...SUB, keys: { ...SUB.keys, p256dh: 'abc' } }],
    ['non-base64url auth', { ...SUB, keys: { ...SUB.keys, auth: '<script>alert(1)</script>' } }],
    ['oversized auth', { ...SUB, keys: { ...SUB.keys, auth: 'y'.repeat(200) } }],
    ['a string', 'https://push.example/x'],
    ['null', null],
  ])('refuses %s', (_n, raw) => {
    expect(parseSubscription(raw)).toBeNull();
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('accepts the real push service endpoint %s', (endpoint) => {
    expect(parseSubscription({ ...SUB, endpoint })?.endpoint).toBe(endpoint);
  });

  it('vapidKeyBytes decodes base64url without padding (a VAPID public key is 65 bytes starting 0x04)', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i * 3));
    const b64url = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(Array.from(vapidKeyBytes(b64url))).toEqual(Array.from(bytes));
  });
});

describe('push and alert-settings actions', () => {
  it.each([
    ['saveSubscription', () => saveSubscriptionAction(SUB, 'UA')],
    ['deleteSubscription', () => deleteSubscriptionAction(SUB.endpoint)],
    ['saveAlertSettings', () => saveAlertSettingsAction({})],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('saveSubscription upserts on endpoint with the owner session; the user agent is clipped', async () => {
    expect(await saveSubscriptionAction(SUB, 'U'.repeat(900))).toEqual({ ok: true });
    const up = calls.find((c) => c[0] === 'upsert')!;
    expect(up[1]).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys, user_agent: 'U'.repeat(512) });
    expect(up[2]).toEqual({ onConflict: 'endpoint' });
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('hostile bodies return invalid without opening a client', async () => {
    expect(await saveSubscriptionAction({ ...SUB, endpoint: 'http://x' }, 'UA')).toEqual({ ok: false, error: 'invalid' });
    expect(await deleteSubscriptionAction("https://x' or 1=1 --".repeat(100))).toEqual({ ok: false, error: 'invalid' });
    expect(await deleteSubscriptionAction(42)).toEqual({ ok: false, error: 'invalid' });
    expect(calls.filter((c) => c[0] === 'session')).toEqual([]);
  });

  it('deleteSubscription deletes by endpoint', async () => {
    expect(await deleteSubscriptionAction(SUB.endpoint)).toEqual({ ok: true });
    expect(calls).toContainEqual(['delete']);
    expect(calls).toContainEqual(['eq', 'endpoint', SUB.endpoint]);
  });

  const rows = (n: number, first = 'https://fcm.googleapis.com/fcm/send/other0') => ({ data: Array.from({ length: n }, (_, i) => ({ endpoint: i === 0 ? first : `https://fcm.googleapis.com/fcm/send/other${i}` })) });

  it('a new endpoint is refused once 20 subscriptions exist, before any upsert', async () => {
    queue.push(rows(20));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: false, error: 'invalid' });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(false);
  });

  it('with 19 subscriptions a new endpoint is saved', async () => {
    queue.push(rows(19));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(true);
  });

  it('re-subscribing an endpoint that already exists still works at 20', async () => {
    queue.push(rows(20, SUB.endpoint));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(true);
  });

  it('a database error returns unexpected (never the Supabase message)', async () => {
    queue.push({ data: [] }, { error: { message: 'duplicate key value violates…' } });
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: false, error: 'unexpected' });
  });

  it('saveAlertSettings stores the normalised settings on the owner profile and returns them', async () => {
    const r = await saveAlertSettingsAction({ push: { taking_off: true, hack: true }, reachDropPct: 500, takingOffRatio: '3', syncFailures: 'x' });
    const settings = { ...DEFAULT_ALERT_SETTINGS, push: { ...DEFAULT_ALERT_SETTINGS.push, taking_off: true }, reachDropPct: 90, takingOffRatio: 3 };
    expect(r).toEqual({ ok: true, settings });
    const up = calls.find((c) => c[0] === 'upsert')![1] as Record<string, unknown>;
    expect(up).toMatchObject({ user_id: 'u1', alert_settings: settings });
    expect(calls).toContainEqual(['from', 'profiles']);
    expect(calls).toContainEqual(['revalidate', '/settings']);
  });
});
