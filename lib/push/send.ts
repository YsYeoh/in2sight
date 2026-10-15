import 'server-only'; // the VAPID private key must never reach a browser bundle
// Web Push delivery. web-push does the VAPID signing and payload encryption (RFC 8291/8292); this file only fans a
// message out to every subscription, isolates failures per device and prunes subscriptions the push service has dropped.
import webpush from 'web-push';
import type { PushMessage } from '@/lib/alerts/push-message';

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one payload to one subscription and returns the push service's HTTP status (0 = network error). Never throws. */
export type PushTransport = (sub: PushSub, payload: string) => Promise<number>;

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** null when push is not configured (alerts are then in-app only). */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function webPushTransport(vapid: Vapid): PushTransport {
  return async (sub, payload) => {
    try {
      const r = await webpush.sendNotification(sub, payload, { vapidDetails: vapid, TTL: 86_400, urgency: 'normal', timeout: 5_000 });
      return r.statusCode;
    } catch (e) {
      // WebPushError carries the status; never log the error itself (it includes the endpoint)
      const status = (e as { statusCode?: unknown } | null)?.statusCode;
      return typeof status === 'number' ? status : 0;
    }
  };
}

export interface SendResult {
  sent: number;
  failed: number;
  pruned: number;
}

/** 404/410: the subscription is gone for good (unsubscribed, browser data cleared, app uninstalled). */
const GONE = new Set([404, 410]);

export async function sendToAll(subs: PushSub[], msg: PushMessage, transport: PushTransport, prune: (endpoint: string) => Promise<void>): Promise<SendResult> {
  const payload = JSON.stringify(msg);
  const out: SendResult = { sent: 0, failed: 0, pruned: 0 };
  await Promise.all(
    subs.map(async (s) => {
      const status = await transport(s, payload).catch(() => 0);
      if (status >= 200 && status < 300) out.sent++;
      else if (GONE.has(status)) {
        out.pruned++;
        await prune(s.endpoint).catch(() => {}); // a failed prune is retried at the next 410
      } else out.failed++;
    }),
  );
  return out;
}
