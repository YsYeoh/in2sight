// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { newOAuthState, verifyOAuthState } from '@/lib/instagram/state';

describe('OAuth state', () => {
  it('generates unguessable, url-safe, unique states', () => {
    const a = newOAuthState(null);
    const b = newOAuthState(null);
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.cookie).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts the matching state and returns the group chosen at the start', () => {
    const { state, cookie } = newOAuthState('Brand X');
    expect(verifyOAuthState(cookie, state)).toEqual({ ok: true, group: 'Brand X' });
    const n = newOAuthState(null);
    expect(verifyOAuthState(n.cookie, n.state)).toEqual({ ok: true, group: null });
  });

  it('rejects missing, wrong or swapped states', () => {
    const a = newOAuthState(null);
    const b = newOAuthState(null);
    expect(verifyOAuthState(undefined, a.state)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, null)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, '')).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, b.state)).toEqual({ ok: false });
    expect(verifyOAuthState(a.cookie, a.state + 'x')).toEqual({ ok: false });
  });

  it('rejects malformed or tampered cookies without throwing', () => {
    const { state } = newOAuthState(null);
    for (const bad of ['', 'not-base64!!', Buffer.from('{"s":1}').toString('base64url'), Buffer.from('null').toString('base64url'), Buffer.from('[]').toString('base64url')])
      expect(verifyOAuthState(bad, state), bad).toEqual({ ok: false });
  });

  it('expires after 10 minutes and rejects a cookie from the future', () => {
    const t0 = 1_700_000_000_000;
    const { state, cookie } = newOAuthState(null, t0);
    expect(verifyOAuthState(cookie, state, t0 + 9 * 60_000)).toMatchObject({ ok: true });
    expect(verifyOAuthState(cookie, state, t0 + 10 * 60_000 + 1)).toEqual({ ok: false });
    expect(verifyOAuthState(cookie, state, t0 - 5 * 60_000)).toEqual({ ok: false });
  });
});
