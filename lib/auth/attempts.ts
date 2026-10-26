// A cookie attempt counter (Plan 16b): friction for an honest browser, NOT a security boundary (anyone can drop the cookie).
// The real limits are Supabase's (/token per IP, /recover once per user per 60 s, the project email cap).
// ponytail: cookie only; a durable per-account lockout needs a table or a KV store, add one if the runbook ever sees abuse.
export interface Limit {
  max: number;
  windowMs: number;
}
export interface Attempts {
  count: number;
  since: number;
}

export const PASSWORD_LIMIT: Limit = { max: 5, windowMs: 15 * 60_000 };
export const FORGOT_LIMIT: Limit = { max: 1, windowMs: 60_000 };
export const PASSWORD_COOKIE = 'in2s_pw_attempts';
export const FORGOT_COOKIE = 'in2s_forgot_attempts';

/** `count.firstAtMs`; anything malformed, from the future or older than the window counts as a fresh start. */
export function readAttempts(raw: string | undefined, now: number, limit: Limit): Attempts {
  const m = /^(\d{1,3})\.(\d{1,15})$/.exec(raw ?? '');
  if (!m) return { count: 0, since: now };
  const count = Number(m[1]);
  const since = Number(m[2]);
  if (since > now || now - since >= limit.windowMs) return { count: 0, since: now };
  return { count, since };
}

export const isLimited = (a: Attempts, limit: Limit): boolean => a.count >= limit.max;

export const bumpAttempts = (a: Attempts): string => `${a.count + 1}.${a.since}`;

export function attemptCookieOptions(limit: Limit) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.ceil(limit.windowMs / 1000),
  };
}
