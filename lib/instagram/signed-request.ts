import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseSignedRequest(signedRequest: string, appSecret: string): { userId: string } | null {
  try {
    if (!appSecret || typeof signedRequest !== 'string') return null;
    const parts = signedRequest.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [sig, payload] = parts;
    const expected = createHmac('sha256', appSecret).update(payload).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { algorithm?: unknown; user_id?: unknown };
    if (typeof data.algorithm !== 'string' || data.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
    const id = data.user_id;
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) === '') return null;
    return { userId: String(id) };
  } catch {
    return null;
  }
}
