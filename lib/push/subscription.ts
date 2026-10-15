// Boundary validation for a browser's PushSubscription.toJSON() before it is stored. Anything off-shape is refused.

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const MAX_ENDPOINT = 1024;

/** An https URL without credentials, at most 1024 characters (the DB check matches). */
export function parseEndpoint(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_ENDPOINT) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname !== '' ? v : null;
  } catch {
    return null;
  }
}

const key = (v: unknown, min: number, max: number) => (typeof v === 'string' && B64URL.test(v) && v.length >= min && v.length <= max ? v : null);

/** p256dh = 65-byte P-256 public key (87 base64url chars), auth = 16-byte secret (22 chars); a little slack for padding. */
export function parseSubscription(raw: unknown): SubscriptionInput | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const endpoint = parseEndpoint(r.endpoint);
  const k = (r.keys ?? {}) as Record<string, unknown>;
  const p256dh = key(k.p256dh, 80, 100);
  const auth = key(k.auth, 16, 32);
  return endpoint && p256dh && auth ? { endpoint, keys: { p256dh, auth } } : null;
}

export const clipUserAgent = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.slice(0, 512) : null);

/** The VAPID public key (base64url) as the bytes pushManager.subscribe wants for applicationServerKey. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
