import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN, passwordStrength } from '@/lib/auth/password-rules';

describe('passwordStrength', () => {
  it('refuses fewer than 12 characters (counted as characters, not bytes)', () => {
    expect(PASSWORD_MIN).toBe(12);
    expect(passwordStrength('Short1!')).toEqual({ score: 0, issue: 'too_short' });
    expect(passwordStrength('abcdefghijk')).toEqual({ score: 0, issue: 'too_short' });
    expect(passwordStrength('')).toEqual({ score: 0, issue: 'too_short' });
    // 12 CJK characters are 12 characters (36 bytes): long enough
    expect(passwordStrength('我的密码很长而且安全的呢').issue).toBeNull();
  });

  it('refuses more than 72 UTF-8 bytes (bcrypt would silently ignore the rest)', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(passwordStrength('Abcdefghij1!'.repeat(6)).issue).toBeNull(); // exactly 72 bytes
    expect(passwordStrength('Abcdefghij1!'.repeat(6) + 'x')).toEqual({ score: 0, issue: 'too_long' });
    expect(passwordStrength('密码安全长度测试'.repeat(4))).toEqual({ score: 0, issue: 'too_long' }); // 32 characters, 96 bytes
  });

  it('refuses fewer than 5 different characters', () => {
    expect(passwordStrength('aaaaaaaaaaaa')).toEqual({ score: 0, issue: 'too_simple' });
    expect(passwordStrength('abcabcabcabc')).toEqual({ score: 0, issue: 'too_simple' });
    expect(passwordStrength('abcdabcdabcd')).toEqual({ score: 0, issue: 'too_simple' });
    expect(passwordStrength('abcdeabcdeab').issue).toBeNull();
  });

  it("refuses a password containing the email's local part (3+ characters, any case)", () => {
    expect(passwordStrength('my-Yeohy-password', 'yeohy@example.com')).toEqual({ score: 0, issue: 'has_email' });
    expect(passwordStrength('my-yeohy-password', null).issue).toBeNull();
    expect(passwordStrength('abc-correct-horse', 'ab@example.com').issue).toBeNull(); // a 2-character name is ignored
  });

  it('scores length first, plus one for 3 or more character classes, capped at 4', () => {
    expect(passwordStrength('correcthorse')).toEqual({ score: 1, issue: null }); // 12, one class
    expect(passwordStrength('Correcthorse1')).toEqual({ score: 2, issue: null }); // 13, three classes
    expect(passwordStrength('correcthorsebatt')).toEqual({ score: 2, issue: null }); // 16
    expect(passwordStrength('correct horse battery')).toEqual({ score: 3, issue: null }); // 21, lower + other
    expect(passwordStrength('Correct horse battery 9')).toEqual({ score: 4, issue: null }); // 23, four classes
  });
});
