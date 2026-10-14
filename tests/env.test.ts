// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvError, getInstagramEnv, getServerEnv, getSupabasePublic, getSupabaseSecretKey, getSupabaseUrl, isSupabaseConfigured } from '@/lib/env';
import { createAdminSupabase } from '@/lib/supabase/admin';

afterEach(() => vi.unstubAllEnvs());

describe('isSupabaseConfigured', () => {
  it('needs both the URL and the publishable key', () => {
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_1' })).toBe(true);
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })).toBe(false);
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBe(false);
    expect(isSupabaseConfigured({})).toBe(false);
  });

  it('treats blank or whitespace-only values as missing', () => {
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: '  ', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' })).toBe(false);
  });
});

describe('getServerEnv', () => {
  it('getServerEnv requires the secret key and the cron secret', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_value');
    vi.stubEnv('CRON_SECRET', '');
    expect(() => getServerEnv()).toThrow(/CRON_SECRET/);
    try {
      getServerEnv();
    } catch (e) {
      expect((e as Error).message).not.toContain('sb_secret_value');
    }
  });
});

describe('getSupabaseSecretKey / getSupabaseUrl', () => {
  it('return the trimmed values', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', ' sb_secret_value ');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    expect(getSupabaseSecretKey()).toBe('sb_secret_value');
    expect(getSupabaseUrl()).toBe('https://x.supabase.co');
  });

  it('throw naming only the variable, never a value', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '  ');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    for (const [fn, name] of [[getSupabaseSecretKey, 'SUPABASE_SECRET_KEY'], [getSupabaseUrl, 'NEXT_PUBLIC_SUPABASE_URL']] as const) {
      try {
        fn();
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(EnvError);
        expect((e as EnvError).missing).toEqual([name]);
        expect((e as Error).message).toContain(name);
      }
    }
  });
});

describe('createAdminSupabase', () => {
  it('needs only the Supabase URL and the secret key (no CRON_SECRET, no app URL)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_value');
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(createAdminSupabase()).toBeDefined();
  });

  it('throws EnvError naming only the secret when it is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(() => createAdminSupabase()).toThrow(EnvError);
    expect(() => createAdminSupabase()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('refuses to run in a browser', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_value');
    vi.stubGlobal('window', {});
    try {
      expect(() => createAdminSupabase()).toThrow(/browser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('getSupabasePublic', () => {
  it('needs only the URL and the publishable key (no app URL)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ' https://x.supabase.co ');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_1');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(getSupabasePublic()).toEqual({ url: 'https://x.supabase.co', publishableKey: 'sb_publishable_1' });
  });

  it('throws EnvError naming only the missing variables', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    try {
      getSupabasePublic();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).missing).toEqual(['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
      expect((e as Error).message).not.toContain('x.supabase.co');
    }
  });
});

describe('getInstagramEnv', () => {
  it('reads the four variables and defaults the API version', () => {
    vi.stubEnv('IG_APP_ID', '123'); vi.stubEnv('IG_APP_SECRET', 'abc'); vi.stubEnv('IG_REDIRECT_URI', 'https://x/cb'); vi.stubEnv('IG_API_VERSION', '');
    expect(getInstagramEnv()).toEqual({ appId: '123', appSecret: 'abc', redirectUri: 'https://x/cb', apiVersion: 'v25.0' });
  });

  it('lists missing NAMES only', () => {
    vi.stubEnv('IG_APP_ID', '123'); vi.stubEnv('IG_APP_SECRET', ''); vi.stubEnv('IG_REDIRECT_URI', '');
    try {
      getInstagramEnv();
      throw new Error('no');
    } catch (e) {
      expect((e as EnvError).missing).toEqual(['IG_APP_SECRET', 'IG_REDIRECT_URI']);
      expect((e as Error).message).not.toContain('123');
    }
  });
});
