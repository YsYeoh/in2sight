import { describe, expect, it } from 'vitest';
import { FORGOT_LIMIT, PASSWORD_LIMIT, attemptCookieOptions, bumpAttempts, isLimited, readAttempts } from '@/lib/auth/attempts';

const NOW = 1_800_000_000_000;

describe('attempt counter', () => {
  it('limits: 5 wrong passwords per 15 minutes, 1 reset request per minute', () => {
    expect(PASSWORD_LIMIT).toEqual({ max: 5, windowMs: 900_000 });
    expect(FORGOT_LIMIT).toEqual({ max: 1, windowMs: 60_000 });
  });

  it('no cookie or a malformed one is a fresh start', () => {
    for (const raw of [undefined, '', 'x', '1', '1.', '.5', '-1.5', '1.2.3', '9999.1', '1.abc', '1.1e5']) {
      expect(readAttempts(raw, NOW, PASSWORD_LIMIT), String(raw)).toEqual({ count: 0, since: NOW });
    }
  });

  it('counts within the window and starts over after it (or for a future timestamp)', () => {
    expect(readAttempts(`3.${NOW - 1000}`, NOW, PASSWORD_LIMIT)).toEqual({ count: 3, since: NOW - 1000 });
    expect(readAttempts(`3.${NOW - 900_000}`, NOW, PASSWORD_LIMIT)).toEqual({ count: 0, since: NOW });
    expect(readAttempts(`3.${NOW + 1}`, NOW, PASSWORD_LIMIT)).toEqual({ count: 0, since: NOW });
  });

  it('is limited at max, and bumping keeps the first timestamp', () => {
    const a = readAttempts(`4.${NOW - 5}`, NOW, PASSWORD_LIMIT);
    expect(isLimited(a, PASSWORD_LIMIT)).toBe(false);
    const raw = bumpAttempts(a);
    expect(raw).toBe(`5.${NOW - 5}`);
    expect(isLimited(readAttempts(raw, NOW, PASSWORD_LIMIT), PASSWORD_LIMIT)).toBe(true);
    expect(isLimited(readAttempts(bumpAttempts({ count: 0, since: NOW }), NOW, FORGOT_LIMIT), FORGOT_LIMIT)).toBe(true);
  });

  it('cookie options: HttpOnly, Lax, whole site, lives as long as the window', () => {
    expect(attemptCookieOptions(PASSWORD_LIMIT)).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900 });
    expect(attemptCookieOptions(FORGOT_LIMIT).maxAge).toBe(60);
  });
});
