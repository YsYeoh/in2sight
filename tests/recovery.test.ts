// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { RECOVERY_WINDOW_SEC, RESET_MIN_MS, confirmRecovery, hasRecentEmailProof, hasRecoveryProof, isTokenHash, isValidEmail, requestPasswordReset } from '@/lib/auth/recovery';

const NOW = 1_800_000_000;

describe('isValidEmail / isTokenHash', () => {
  it('accepts plain addresses (trimmed) and refuses the rest', () => {
    for (const e of ['o@x.io', ' owner@yongsen.space ', 'a.b+c@d.e.f']) expect(isValidEmail(e), e).toBe(true);
    for (const e of ['', 'a', 'a@b', '@b.c', 'a@.c x', 'a b@c.d', 'a@b c.d', `${'a'.repeat(250)}@b.cd`]) expect(isValidEmail(e), e).toBe(false);
  });
  it('token hashes are 16-256 url-safe characters only', () => {
    expect(isTokenHash('a'.repeat(56))).toBe(true);
    expect(isTokenHash('pkce_0123456789abcdef')).toBe(true);
    for (const t of ['', 'short', 'a'.repeat(257), 'abc def ghi jkl mnop', 'abc/def/ghi/jkl/mno', 'x'.repeat(20) + '&next=/evil']) expect(isTokenHash(t), t).toBe(false);
  });
});

describe('requestPasswordReset', () => {
  const run = async (impl: () => Promise<unknown>, elapsed = 300) => {
    const resetPasswordForEmail = vi.fn(impl);
    const wait = vi.fn(async () => {});
    let t = 0;
    const now = () => (t++ === 0 ? 1000 : 1000 + elapsed);
    const result = await requestPasswordReset({ auth: { resetPasswordForEmail } } as never, ' o@x.io ', wait, now);
    return { result, resetPasswordForEmail, wait };
  };

  it('sends the trimmed email without redirectTo', async () => {
    const r = await run(async () => ({ data: {}, error: null }));
    expect(r.resetPasswordForEmail).toHaveBeenCalledWith('o@x.io');
    expect(r.result).toBeUndefined();
  });

  it('success, an error and a throw all resolve the same way and wait up to RESET_MIN_MS', async () => {
    expect(RESET_MIN_MS).toBe(2000);
    for (const impl of [async () => ({ error: null }), async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }), async () => Promise.reject(new Error('network'))]) {
      const r = await run(impl, 300);
      expect(r.result).toBeUndefined();
      expect(r.wait).toHaveBeenCalledWith(1700);
    }
  });

  it('does not wait when the call already took longer', async () => {
    const r = await run(async () => ({ error: null }), 2500);
    expect(r.wait).not.toHaveBeenCalled();
  });
});

describe('confirmRecovery', () => {
  it('verifies the token hash as a recovery OTP and needs a session back', async () => {
    const verifyOtp = vi.fn(async () => ({ data: { session: { access_token: 't' } }, error: null }));
    expect(await confirmRecovery({ auth: { verifyOtp } } as never, 'h'.repeat(56))).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'h'.repeat(56) });
  });
  it('an error, no session or a throw is false', async () => {
    const cases = [async () => ({ data: {}, error: { code: 'otp_expired' } }), async () => ({ data: { session: null }, error: null }), async () => Promise.reject(new Error('x'))];
    for (const impl of cases) expect(await confirmRecovery({ auth: { verifyOtp: impl } } as never, 'h'.repeat(56))).toBe(false);
  });
});

describe('hasRecentEmailProof', () => {
  const claims = (amr: unknown) => ({ sub: 'u', aal: 'aal2', amr });
  it('accepts a recovery, otp or magiclink entry at most 15 minutes old', () => {
    expect(RECOVERY_WINDOW_SEC).toBe(900);
    for (const method of ['recovery', 'otp', 'magiclink']) {
      expect(hasRecentEmailProof(claims([{ method: 'totp', timestamp: NOW }, { method, timestamp: NOW - 900 }]), NOW), method).toBe(true);
    }
  });
  it('refuses an old, far-future, password-only or malformed proof (fail closed)', () => {
    expect(hasRecentEmailProof(claims([{ method: 'recovery', timestamp: NOW - 901 }]), NOW)).toBe(false);
    expect(hasRecentEmailProof(claims([{ method: 'recovery', timestamp: NOW + 61 }]), NOW)).toBe(false);
    expect(hasRecentEmailProof(claims([{ method: 'password', timestamp: NOW }, { method: 'totp', timestamp: NOW }]), NOW)).toBe(false);
    expect(hasRecentEmailProof(claims(['recovery', 'otp']), NOW)).toBe(false); // string format has no timestamp
    expect(hasRecentEmailProof(claims([{ method: 'recovery', timestamp: String(NOW) }]), NOW)).toBe(false);
    for (const c of [null, undefined, {}, claims(null), claims({}), claims([null])]) expect(hasRecentEmailProof(c, NOW)).toBe(false);
  });
});

describe('hasRecoveryProof', () => {
  it('reads the signature-checked claims', async () => {
    const getClaims = vi.fn(async () => ({ data: { claims: { amr: [{ method: 'recovery', timestamp: NOW - 10 }] } }, error: null }));
    expect(await hasRecoveryProof({ auth: { getClaims } } as never, NOW)).toBe(true);
  });
  it('an error or a throw is false', async () => {
    const amr = [{ method: 'recovery', timestamp: NOW }];
    expect(await hasRecoveryProof({ auth: { getClaims: async () => ({ data: { claims: { amr } }, error: { message: 'bad jwt' } }) } } as never, NOW)).toBe(false);
    expect(await hasRecoveryProof({ auth: { getClaims: async () => Promise.reject(new Error('x')) } } as never, NOW)).toBe(false);
  });
});
