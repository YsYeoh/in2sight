import { describe, expect, it, vi } from 'vitest';
import { confirmEnroll, disableFactor, getMfaStatus, normalizeCode, startEnroll, verifyLogin } from '@/lib/auth/mfa';

type Factor = { id: string; status: 'verified' | 'unverified' };

function fake(o: { factors?: Factor[]; enrollError?: unknown; verifyError?: unknown; currentLevel?: 'aal1' | 'aal2'; throws?: boolean; claimsError?: boolean } = {}) {
  const factors = o.factors ?? [];
  const mfa = {
    listFactors: vi.fn(async () => ({ data: { all: factors, totp: factors.filter((f) => f.status === 'verified') }, error: null })),
    unenroll: vi.fn(async () => ({ data: {}, error: null })),
    enroll: vi.fn(async () =>
      o.enrollError ? { data: null, error: o.enrollError } : { data: { id: 'f-new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEF', uri: 'otpauth://x' } }, error: null },
    ),
    challengeAndVerify: vi.fn(async () => {
      if (o.throws) throw new Error('network');
      return o.verifyError ? { data: null, error: o.verifyError } : { data: {}, error: null };
    }),
  };
  const getClaims = vi.fn(async () => (o.claimsError ? { data: null, error: { message: 'bad jwt' } } : { data: { claims: { sub: 'u1', aal: o.currentLevel ?? 'aal2' } }, error: null }));
  return { supabase: { auth: { mfa, getClaims } } as never, mfa, getClaims };
}

describe('normalizeCode', () => {
  it('accepts 6 digits, ignoring spaces and dashes', () => {
    expect(normalizeCode('123456')).toBe('123456');
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
  });
  it('rejects anything else', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5x', '١٢٣٤٥٦']) expect(normalizeCode(bad), bad).toBeNull();
  });
});

describe('startEnroll', () => {
  it('returns the QR, secret and factor id', async () => {
    const f = fake();
    expect(await startEnroll(f.supabase)).toEqual({ ok: true, factorId: 'f-new', qrSvg: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEF' });
    expect(f.mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'in2sight' });
  });

  it('with a verified factor, an aal1 (password-only) session cannot enrol another: enroll is never called', async () => {
    const f = fake({ factors: [{ id: 'v', status: 'verified' }], currentLevel: 'aal1' });
    expect(await startEnroll(f.supabase)).toEqual({ ok: false, error: 'needs_aal2' });
    expect(f.mfa.enroll).not.toHaveBeenCalled();
    expect(f.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('with a verified factor, an aal2 session may enrol', async () => {
    const f = fake({ factors: [{ id: 'v', status: 'verified' }], currentLevel: 'aal2' });
    expect((await startEnroll(f.supabase)).ok).toBe(true);
  });

  it('the first enrolment is allowed at aal1 (no verified factor yet)', async () => {
    const f = fake({ factors: [{ id: 'u', status: 'unverified' }], currentLevel: 'aal1' });
    expect((await startEnroll(f.supabase)).ok).toBe(true);
  });

  it('a claims error fails closed when a verified factor exists', async () => {
    const f = fake({ factors: [{ id: 'v', status: 'verified' }], claimsError: true });
    expect(await startEnroll(f.supabase)).toEqual({ ok: false, error: 'needs_aal2' });
    expect(f.mfa.enroll).not.toHaveBeenCalled();
  });

  it('removes abandoned unverified factors first but never touches verified ones', async () => {
    const f = fake({ factors: [{ id: 'old1', status: 'unverified' }, { id: 'keep', status: 'verified' }, { id: 'old2', status: 'unverified' }] });
    await startEnroll(f.supabase);
    expect(f.mfa.unenroll.mock.calls.map((c) => ((c as unknown[])[0] as { factorId: string }).factorId)).toEqual(['old1', 'old2']);
  });

  it('reports unexpected on an enrol error without leaking details', async () => {
    const f = fake({ enrollError: { message: 'secret detail' } });
    const r = await startEnroll(f.supabase);
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('secret detail');
  });
});

describe('confirmEnroll / verifyLogin', () => {
  it('confirmEnroll validates the code format before calling Supabase', async () => {
    const f = fake();
    expect(await confirmEnroll(f.supabase, { factorId: 'f1', code: '12' })).toEqual({ ok: false, error: 'invalid_code' });
    expect(f.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it('confirmEnroll succeeds with a valid code and maps a wrong code to invalid_code', async () => {
    expect(await confirmEnroll(fake().supabase, { factorId: 'f1', code: '123 456' })).toEqual({ ok: true });
    const bad = fake({ verifyError: { message: 'Invalid TOTP code entered' } });
    expect(await confirmEnroll(bad.supabase, { factorId: 'f1', code: '123456' })).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('verifyLogin uses the first verified TOTP factor', async () => {
    const f = fake({ factors: [{ id: 'u', status: 'unverified' }, { id: 'v1', status: 'verified' }] });
    expect(await verifyLogin(f.supabase, '123456')).toEqual({ ok: true });
    expect(f.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'v1', code: '123456' });
  });

  it('verifyLogin with no verified factor -> no_factor; bad code -> invalid_code; thrown -> unexpected', async () => {
    expect(await verifyLogin(fake({ factors: [] }).supabase, '123456')).toEqual({ ok: false, error: 'no_factor' });
    expect(await verifyLogin(fake({ factors: [{ id: 'v', status: 'verified' }] }).supabase, 'abc')).toEqual({ ok: false, error: 'invalid_code' });
    expect(await verifyLogin(fake({ factors: [{ id: 'v', status: 'verified' }], verifyError: { message: 'x' } }).supabase, '123456')).toEqual({ ok: false, error: 'invalid_code' });
    expect(await verifyLogin(fake({ factors: [{ id: 'v', status: 'verified' }], throws: true }).supabase, '123456')).toEqual({ ok: false, error: 'unexpected' });
  });
});

describe('getMfaStatus / disableFactor', () => {
  it('reports enrolment from verified factors only', async () => {
    expect(await getMfaStatus(fake({ factors: [{ id: 'u', status: 'unverified' }] }).supabase)).toEqual({ enrolled: false, factorId: null });
    expect(await getMfaStatus(fake({ factors: [{ id: 'v', status: 'verified' }] }).supabase)).toEqual({ enrolled: true, factorId: 'v' });
  });

  it('disabling needs an aal2 session: an aal1 session cannot remove the factor', async () => {
    const f = fake({ currentLevel: 'aal1' });
    expect(await disableFactor(f.supabase, 'v')).toEqual({ ok: false, error: 'needs_aal2' });
    expect(f.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('a claims error fails closed for disable too', async () => {
    const f = fake({ claimsError: true });
    expect(await disableFactor(f.supabase, 'v')).toEqual({ ok: false, error: 'needs_aal2' });
    expect(f.mfa.unenroll).not.toHaveBeenCalled();
  });

  it('with an aal2 session the factor is removed', async () => {
    const f = fake({ currentLevel: 'aal2' });
    expect(await disableFactor(f.supabase, 'v')).toEqual({ ok: true });
    expect(f.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'v' });
  });
});

describe('rate limiting', () => {
  it('a 429 / rate-limit error maps to rate_limited, never invalid_code', async () => {
    for (const verifyError of [{ status: 429, message: 'x' }, { code: 'over_request_rate_limit', message: 'x' }]) {
      const f = fake({ factors: [{ id: 'v', status: 'verified' }], verifyError });
      expect(await verifyLogin(f.supabase, '123456')).toEqual({ ok: false, error: 'rate_limited' });
      expect(await confirmEnroll(f.supabase, { factorId: 'f1', code: '123456' })).toEqual({ ok: false, error: 'rate_limited' });
    }
  });
});
