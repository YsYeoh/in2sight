// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = { set: vi.fn(), getAll: () => [] as { name: string; value: string }[] };
let setAll: (c: { name: string; value: string; options: object }[], h: Record<string, string>) => void;

vi.mock('next/headers', () => ({ cookies: async () => store }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: typeof setAll } }) => {
    setAll = opts.cookies.setAll;
    return {};
  },
}));

import { createServerSupabase } from '@/lib/supabase/server';

beforeEach(() => {
  store.set.mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_1');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('createServerSupabase', () => {
  it('does not need NEXT_PUBLIC_APP_URL', async () => {
    await expect(createServerSupabase()).resolves.toBeDefined();
  });

  it('writes cookies and copies no-store headers onto the supplied response headers', async () => {
    const responseHeaders = new Headers();
    await createServerSupabase({ responseHeaders });
    setAll([{ name: 'sb-a', value: '1', options: {} }], { 'cache-control': 'private, no-store' });
    expect(store.set).toHaveBeenCalledWith('sb-a', '1', {});
    expect(responseHeaders.get('cache-control')).toBe('private, no-store');
  });
});
