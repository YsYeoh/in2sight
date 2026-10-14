import { randomBytes, timingSafeEqual } from 'node:crypto';

export const STATE_COOKIE = 'ig_oauth';
export const STATE_MAX_AGE_SECONDS = 600;
const MAX_AGE_MS = STATE_MAX_AGE_SECONDS * 1000;
const FUTURE_SKEW_MS = 60_000;

export function newOAuthState(group: string | null, now: number = Date.now()): { state: string; cookie: string } {
  const state = randomBytes(24).toString('base64url');
  const cookie = Buffer.from(JSON.stringify({ s: state, g: group, t: now })).toString('base64url');
  return { state, cookie };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyOAuthState(cookie: string | undefined, queryState: string | null, now: number = Date.now()): { ok: true; group: string | null } | { ok: false } {
  if (!cookie || !queryState) return { ok: false };
  try {
    const v = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as { s?: unknown; g?: unknown; t?: unknown };
    if (!v || typeof v !== 'object' || typeof v.s !== 'string' || typeof v.t !== 'number') return { ok: false };
    if (now - v.t > MAX_AGE_MS || v.t - now > FUTURE_SKEW_MS) return { ok: false };
    if (!safeEqual(v.s, queryState)) return { ok: false };
    return { ok: true, group: typeof v.g === 'string' ? v.g : null };
  } catch {
    return { ok: false };
  }
}
