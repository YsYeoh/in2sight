// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn();
const createServerSupabase = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: (...a: unknown[]) => createServerSupabase(...a) }));

import { GET } from '@/app/auth/signout/route';

beforeEach(() => {
  signOut.mockReset().mockResolvedValue({ error: null });
  // like the real client: signing out hands no-store headers to the response headers it was given
  createServerSupabase.mockReset().mockImplementation(async ({ responseHeaders }: { responseHeaders: Headers }) => ({
    auth: {
      signOut: async () => {
        responseHeaders.set('cache-control', 'no-store');
        return signOut();
      },
    },
  }));
});

describe('GET /auth/signout', () => {
  it('signs out and redirects to /login on the same origin, with the no-store headers on the response', async () => {
    const res = await GET(new Request('https://app.test/auth/signout?next=https://evil.test'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
