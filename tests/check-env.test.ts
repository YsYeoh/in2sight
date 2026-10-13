import { describe, expect, it } from 'vitest';
import { GROUPS, checkEnv } from '../scripts/check-env.mjs';

const good: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: 'https://in2sight.vercel.app',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_AbC123',
  SUPABASE_SECRET_KEY: 'sb_secret_XyZ789',
  CRON_SECRET: 'a'.repeat(64),
  IG_APP_ID: '123456789012345',
  IG_APP_SECRET: 'abcdef0123456789abcdef0123456789',
  IG_REDIRECT_URI: 'https://in2sight.vercel.app/api/instagram/callback',
};

const problems = (env: Record<string, string | undefined>, groups?: string[]) =>
  checkEnv(env, groups)
    .filter((r) => !r.ok)
    .map((r) => r.name);

describe('checkEnv', () => {
  it('accepts a complete, well-formed environment', () => {
    expect(problems(good)).toEqual([]);
  });

  it('reports every missing required variable', () => {
    expect(problems({})).toEqual(
      expect.arrayContaining(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'CRON_SECRET', 'IG_APP_ID', 'IG_APP_SECRET', 'IG_REDIRECT_URI']),
    );
  });

  it('can check one group at a time', () => {
    const supabaseOnly = { ...good, IG_APP_ID: undefined, IG_APP_SECRET: undefined, IG_REDIRECT_URI: undefined };
    expect(problems(supabaseOnly, ['app', 'supabase', 'security'])).toEqual([]);
    expect(problems(supabaseOnly, ['meta'])).toContain('IG_APP_ID');
  });

  it('treats untouched template placeholders as missing', () => {
    expect(problems({ ...good, SUPABASE_SECRET_KEY: 'your-secret-key-here' })).toContain('SUPABASE_SECRET_KEY');
    expect(problems({ ...good, IG_APP_ID: '<instagram app id>' })).toContain('IG_APP_ID');
    expect(problems({ ...good, CRON_SECRET: '' })).toContain('CRON_SECRET');
  });

  it('catches the secret and publishable Supabase keys being swapped or identical', () => {
    expect(problems({ ...good, SUPABASE_SECRET_KEY: 'sb_publishable_AbC123' })).toContain('SUPABASE_SECRET_KEY');
    expect(problems({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_XyZ789' })).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(problems({ ...good, SUPABASE_SECRET_KEY: good.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY })).toContain('SUPABASE_SECRET_KEY');
  });

  it('accepts the legacy JWT-style Supabase keys', () => {
    expect(problems({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOi.anon.sig', SUPABASE_SECRET_KEY: 'eyJhbGciOi.service.sig' })).toEqual([]);
  });

  it('validates URL shapes (https, no trailing slash; localhost allowed for the app URL)', () => {
    expect(problems({ ...good, NEXT_PUBLIC_APP_URL: 'https://in2sight.vercel.app/' })).toContain('NEXT_PUBLIC_APP_URL');
    expect(problems({ ...good, NEXT_PUBLIC_APP_URL: 'http://in2sight.example.com' })).toContain('NEXT_PUBLIC_APP_URL');
    expect(problems({ ...good, NEXT_PUBLIC_APP_URL: 'http://localhost:3000', IG_REDIRECT_URI: 'http://localhost:3000/api/instagram/callback' })).toEqual([]);
    expect(problems({ ...good, NEXT_PUBLIC_SUPABASE_URL: 'https://example.com' })).toContain('NEXT_PUBLIC_SUPABASE_URL');
  });

  it('requires the redirect URI to be exactly APP_URL + /api/instagram/callback (Meta matches it literally)', () => {
    expect(problems({ ...good, IG_REDIRECT_URI: 'https://in2sight.vercel.app/api/instagram/callback/' })).toContain('IG_REDIRECT_URI');
    expect(problems({ ...good, IG_REDIRECT_URI: 'https://other.vercel.app/api/instagram/callback' })).toContain('IG_REDIRECT_URI');
  });

  it('validates Meta credential shapes (numeric app id, 32-hex secret)', () => {
    expect(problems({ ...good, IG_APP_ID: 'not-a-number' })).toContain('IG_APP_ID');
    expect(problems({ ...good, IG_APP_SECRET: 'tooshort' })).toContain('IG_APP_SECRET');
  });

  it('requires a long CRON_SECRET', () => {
    expect(problems({ ...good, CRON_SECRET: 'short' })).toContain('CRON_SECRET');
  });

  it('optional groups are only validated when something is filled in', () => {
    expect(problems(good)).not.toContain('VAPID_PRIVATE_KEY');
    expect(problems({ ...good, VAPID_PRIVATE_KEY: 'bad key!' }, ['push'])).toContain('VAPID_PRIVATE_KEY');
  });

  it('never echoes a secret value in a result', () => {
    const secret = 'sb_secret_SUPER_SECRET_VALUE';
    const results = checkEnv({ ...good, SUPABASE_SECRET_KEY: secret, CRON_SECRET: 'tiny' });
    expect(JSON.stringify(results)).not.toContain(secret);
    expect(JSON.stringify(results)).not.toContain('tiny');
  });

  it('exports the known groups', () => {
    expect(Object.keys(GROUPS)).toEqual(['app', 'supabase', 'security', 'meta', 'push', 'report']);
  });
});
