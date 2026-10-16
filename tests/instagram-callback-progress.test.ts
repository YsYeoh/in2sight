// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => [] as string[]);
const afterFns = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: (fn: () => unknown) => void afterFns.push(fn) }));
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => true }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({ __admin: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({}) }));
vi.mock('@/lib/env', async (orig) => ({ ...(await orig<object>()), getInstagramEnv: () => ({}) }));
// stands in for a successful OAuth exchange of an account that already exists (a reconnect)
vi.mock('@/lib/instagram/connect-flow', () => ({
  processCallback: async (_i: unknown, deps: { onConnected?: (id: string) => Promise<void> }) => {
    await deps.onConnected?.('acc-1');
    return { redirect: '/accounts?connected=brand' };
  },
}));
vi.mock('@/lib/sync/store', () => ({
  clearSyncError: async (_db: unknown, id: string) => void log.push(`clear:${id}`),
  resetSyncProgress: async (_db: unknown, id: string, iso: string) => void log.push(`reset:${id}:${typeof iso}`),
}));
vi.mock('@/lib/sync/connect-sync', () => ({ syncAccountNow: async (id: string) => void log.push(`sync:${id}`) }));

import { GET as callback } from '@/app/api/instagram/callback/route';

beforeEach(() => {
  log.length = 0;
  afterFns.length = 0;
});

describe('OAuth callback → progress (reconnect during an active import)', () => {
  it('reconnect resets only the live row, never sync_state coverage, then syncs after the redirect', async () => {
    const res = await callback(new NextRequest(new URL('/api/instagram/callback?code=c&state=s', 'https://app.test')));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/accounts?connected=brand'); // ?connected= kept for the panel
    expect(log).toEqual(['clear:acc-1', 'reset:acc-1:string']); // no coverage write of any kind
    expect(afterFns).toHaveLength(1);
    await afterFns[0]();
    expect(log.at(-1)).toBe('sync:acc-1');
  });
});
