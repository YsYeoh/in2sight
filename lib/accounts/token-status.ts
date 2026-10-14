const DAY = 86_400_000;

export function tokenStatus(expiresAt: string | Date | null | undefined, now: Date): { state: 'ok' | 'expiring' | 'expired' | 'unknown'; daysLeft: number } {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : typeof expiresAt === 'string' && expiresAt !== '' ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(t)) return { state: 'unknown', daysLeft: 0 };
  const ms = t - now.getTime();
  if (ms <= 0) return { state: 'expired', daysLeft: 0 };
  const daysLeft = Math.ceil(ms / DAY);
  return { state: daysLeft <= 7 ? 'expiring' : 'ok', daysLeft };
}
