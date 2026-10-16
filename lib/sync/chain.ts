// Continuation passes: when a tick stops because of its time budget (not a Meta rate limit) with due work left, the
// route calls itself again at once instead of waiting for the next 30-minute tick. Bounded and same-origin only.
export const MAX_CHAIN = 10;
export const CHAIN_HEADER = 'x-tick-chain';

/** Depth of this pass in the chain (0 = a scheduler call). Anything that is not a small non-negative integer counts as 0. */
export function chainDepth(header: string | null): number {
  if (!header || !/^\d{1,2}$/.test(header)) return 0;
  return Math.min(Number(header), MAX_CHAIN);
}

/** Absolute URL of this endpoint on OUR OWN origin (NEXT_PUBLIC_APP_URL), or null when it is missing or unsafe. */
export function chainTarget(appUrl: string | undefined): string | null {
  if (!appUrl) return null;
  try {
    const u = new URL(appUrl);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password) return null;
    return new URL('/api/cron/tick', u.origin).toString();
  } catch {
    return null;
  }
}

/** Should this pass start another one? */
export function shouldChain(more: boolean, depth: number): boolean {
  return more && depth < MAX_CHAIN;
}
