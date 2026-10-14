import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time (hashing first makes the lengths equal, so neither
 * content nor length leaks through timing). An empty secret never authorizes anything.
 */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(secret));
}
