import { describe, expect, it } from 'vitest';
import { tokenStatus } from '@/lib/accounts/token-status';

const now = new Date('2026-10-14T00:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

describe('tokenStatus', () => {
  it('ok when more than 7 days remain', () => {
    expect(tokenStatus(inDays(54), now)).toEqual({ state: 'ok', daysLeft: 54 });
    expect(tokenStatus(inDays(8), now).state).toBe('ok');
  });
  it('expiring at 7 days or fewer', () => {
    expect(tokenStatus(inDays(7), now)).toEqual({ state: 'expiring', daysLeft: 7 });
    expect(tokenStatus(inDays(0.2), now)).toEqual({ state: 'expiring', daysLeft: 1 });
  });
  it('expired at or after the expiry instant; daysLeft never negative', () => {
    expect(tokenStatus(inDays(0), now)).toEqual({ state: 'expired', daysLeft: 0 });
    expect(tokenStatus(inDays(-3), now)).toEqual({ state: 'expired', daysLeft: 0 });
  });
  it('unknown for missing or unparsable values', () => {
    for (const v of [null, undefined, 'not a date', '']) expect(tokenStatus(v as never, now)).toEqual({ state: 'unknown', daysLeft: 0 });
  });
  it('accepts a Date', () => {
    expect(tokenStatus(new Date(inDays(30)), now).state).toBe('ok');
  });
});
