import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, accounts } = vi.hoisted(() => ({ calls: [] as string[], accounts: [] as Record<string, unknown>[] }));

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => void calls.push('requireOwner') }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push('session'), {}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push('ADMIN') }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (await import('@/lib/prefs')).DEFAULT_PREFS }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ list: async () => accounts }) }));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: async () => ({}) }));
vi.mock('@/lib/dashboard/read', () => ({ loadDaily: async () => (calls.push('daily'), []), loadPosts: async () => (calls.push('posts'), []) }));
vi.mock('@/lib/dashboard/detail-read', () => ({
  loadOnline: async () => (calls.push('online'), {}),
  loadPostRows: async () => (calls.push('postRows'), []),
  loadTags: async () => (calls.push('tags'), []),
  loadStories: async () => (calls.push('stories'), []),
  loadAudience: async () => (calls.push('audience'), { age_gender: null, country: null, city: null }),
}));

import AccountPage from '@/app/(app)/accounts/[id]/page';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (id: string, status = 'active', o: Record<string, unknown> = {}) => ({ id, igUserId: id, username: `u${id.slice(0, 4)}`, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status, archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-09-01T00:00:00Z', ...o });
const run = (id: string, sp: Record<string, string | string[]> = {}) => AccountPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) }) as Promise<ReactElement<{ tab: string; children: ReactElement }>>;

beforeEach(() => {
  calls.length = 0;
  accounts.length = 0;
});

describe('account detail page', () => {
  it('not a uuid → notFound, after requireOwner and before any database client', async () => {
    await expect(run('not-a-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(run(`${ID}'--`)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls.filter((c) => c !== 'requireOwner')).toEqual([]);
    expect(calls[0]).toBe('requireOwner');
  });

  it('unknown and archived accounts → notFound (archived accounts are hidden, SPEC §7c)', async () => {
    accounts.push(acct(ID, 'archived'));
    await expect(run(ID)).rejects.toThrow('NEXT_NOT_FOUND');
    accounts.length = 0;
    await expect(run(ID)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders the overview tab by default (and for an injected tab) with the owner session only', async () => {
    accounts.push(acct(ID));
    const el = await run(ID.toUpperCase(), { tab: '<script>' });
    expect(isValidElement(el)).toBe(true);
    expect(el.props.tab).toBe('overview');
    expect(calls).toContain('daily');
    expect(calls).not.toContain('ADMIN');
    expect(calls).not.toContain('stories');
  });

  it('offers the Export dialog scoped to this account, with every live account as an option', async () => {
    accounts.push(acct(ID), acct('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'archived'));
    const el = (await run(ID, { period: '90' })) as unknown as ReactElement<{ exportButton: ReactElement<{ defaultScope: string; period: number; scopes: { value: string }[] }> }>;
    expect(el.props.exportButton.props.defaultScope).toBe(`a:${ID}`);
    expect(el.props.exportButton.props.period).toBe(90);
    expect(el.props.exportButton.props.scopes.map((s) => s.value)).toEqual(['all', `a:${ID}`]); // archived accounts are not offered
  });

  it('posts tab loads only its own data (posts with tags + tag list)', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'posts', format: 'REELS' });
    expect(el.props.tab).toBe('posts');
    expect(calls).toEqual(expect.arrayContaining(['postRows', 'tags']));
    expect(calls).not.toContain('daily');
  });

  it.each([
    ['stories', 'stories'],
    ['audience', 'audience'],
  ])('%s tab loads only its own data', async (tab, call) => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab });
    expect(el.props.tab).toBe(tab);
    expect(calls).toContain(call);
    expect(calls).not.toContain('daily');
    expect(calls).not.toContain('postRows');
  });
});
