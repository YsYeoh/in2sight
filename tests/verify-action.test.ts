import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = { tag: 'client' };
const verifyLogin = vi.fn();
const syncPrefsFromProfile = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/lib/auth/mfa', () => ({ verifyLogin: (...a: unknown[]) => verifyLogin(...a) }));
vi.mock('@/lib/prefs.sync.server', () => ({ syncPrefsFromProfile: (...a: unknown[]) => syncPrefsFromProfile(...a) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => supabase }));

import { verifyMfaAction } from '@/app/login/verify/actions';

const form = (code: string) => {
  const f = new FormData();
  f.set('code', code);
  return f;
};

beforeEach(() => {
  verifyLogin.mockReset().mockResolvedValue({ ok: true });
  syncPrefsFromProfile.mockReset().mockResolvedValue(undefined);
});

describe('verifyMfaAction', () => {
  it('syncs prefs from the profile (now readable at aal2) before redirecting to /overview', async () => {
    await expect(verifyMfaAction({}, form('123456'))).rejects.toThrow('REDIRECT:/overview');
    expect(syncPrefsFromProfile).toHaveBeenCalledWith(supabase);
  });

  it('does not sync, and returns the error, after a failed verify', async () => {
    verifyLogin.mockResolvedValue({ ok: false, error: 'invalid_code' });
    await expect(verifyMfaAction({}, form('000000'))).resolves.toEqual({ error: 'invalid_code' });
    expect(syncPrefsFromProfile).not.toHaveBeenCalled();
  });

  it('maps no_factor to unexpected without syncing', async () => {
    verifyLogin.mockResolvedValue({ ok: false, error: 'no_factor' });
    await expect(verifyMfaAction({}, form('1'))).resolves.toEqual({ error: 'unexpected' });
    expect(syncPrefsFromProfile).not.toHaveBeenCalled();
  });
});
