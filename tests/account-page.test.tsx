import { Suspense, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, accounts, fail } = vi.hoisted(() => ({ calls: [] as string[], accounts: [] as Record<string, unknown>[], fail: { postRows: false } }));

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
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ list: async () => (calls.push('accounts'), accounts) }) }));
vi.mock('@/lib/sync/store', () => ({ listSyncStatus: async () => ({}) }));
vi.mock('@/lib/dashboard/read', () => ({
  MEDIA_LIMIT: 500,
  loadDaily: async () => (calls.push('daily'), []),
  loadPosts: async () => (calls.push('posts'), []),
  loadFirstDay: async () => (calls.push('firstDay'), '2026-07-01'),
}));
vi.mock('@/lib/dashboard/detail-read', () => ({
  loadOnline: async () => (calls.push('online'), {}),
  loadPostRows: async () => {
    if (fail.postRows) throw new Error('db down');
    return calls.push('postRows'), [];
  },
  loadTags: async () => (calls.push('tags'), []),
  loadStories: async () => (calls.push('stories'), { stories: [], truncated: false }),
  loadAudience: async () => (calls.push('audience'), { age_gender: null, country: null, city: null }),
}));

import AccountPage from '@/app/(app)/accounts/[id]/page';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (id: string, status = 'active', o: Record<string, unknown> = {}) => ({ id, igUserId: id, username: `u${id.slice(0, 4)}`, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status, archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-09-01T00:00:00Z', ...o });
type Boundary = ReactElement<{ fallback: ReactElement<{ tab: string }>; children: ReactElement<Record<string, unknown>> }>;
type Page = ReactElement<{ tab: string; children: Boundary }>;
const run = (id: string, sp: Record<string, string | string[]> = {}) => AccountPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) }) as Promise<Page>;
/** What React would stream into the boundary: render the async tab component. */
const streamTab = async (el: Page) => {
  const inner = el.props.children.props.children;
  return (inner.type as (p: Record<string, unknown>) => Promise<ReactElement>)(inner.props);
};

beforeEach(() => {
  calls.length = 0;
  accounts.length = 0;
  fail.postRows = false;
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

  it('header and tab bar render before any tab data: the tab streams inside Suspense with its own skeleton', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'posts' });
    expect(el.props.tab).toBe('posts');
    expect(el.props.children.type).toBe(Suspense);
    expect(el.props.children.props.fallback.props.tab).toBe('posts');
    expect([...calls].sort()).toEqual(['accounts', 'firstDay', 'requireOwner', 'session', 'session']); // the accounts list and the first captured day only; no tab query yet
  });

  it('the Suspense key changes with the query, so a new tab/period/filter shows its skeleton instead of the stale tab', async () => {
    accounts.push(acct(ID));
    const a = await run(ID, { tab: 'posts' });
    const b = await run(ID, { tab: 'posts', format: 'REELS' });
    const c = await run(ID, { tab: 'stories' });
    expect(new Set([a.props.children.key, b.props.children.key, c.props.children.key]).size).toBe(3);
  });

  it('renders the overview tab by default (and for an injected tab) with the owner session only', async () => {
    accounts.push(acct(ID));
    const el = await run(ID.toUpperCase(), { tab: '<script>' });
    expect(isValidElement(el)).toBe(true);
    expect(el.props.tab).toBe('overview');
    expect(isValidElement(await streamTab(el))).toBe(true);
    expect(calls).toContain('daily');
    expect(calls).not.toContain('ADMIN');
    expect(calls).not.toContain('stories');
  });

  it('offers the Export dialog scoped to this account, with every live account as an option', async () => {
    accounts.push(acct(ID), acct('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'archived'));
    const el = (await run(ID, { period: '90' })) as unknown as ReactElement<{ exportButton: ReactElement<{ defaultScope: string; time: { preset: string }; scopes: { value: string }[] }> }>;
    expect(el.props.exportButton.props.defaultScope).toBe(`a:${ID}`);
    expect(el.props.exportButton.props.time.preset).toBe('90d'); // the page's Time Scope (an old ?period=90 link)
    expect(el.props.exportButton.props.time).toBe((el.props as unknown as { scope: unknown }).scope); // the same scope as the bar
    expect(el.props.exportButton.props.scopes.map((s) => s.value)).toEqual(['all', `a:${ID}`]); // archived accounts are not offered
  });

  it('the scope is resolved once with the first captured day and kept by the bar; Posts filters are kept (validated)', async () => {
    accounts.push(acct(ID));
    const el = (await run(ID, { tab: 'posts', from: 'all', format: 'REELS', tag: 'not-a-uuid' })) as unknown as ReactElement<{ scope: { window: unknown; query: string }; keep: Record<string, string> }>;
    expect(el.props.scope.window).toEqual({ from: '2026-07-01', to: expect.any(String) });
    expect(el.props.scope.query).toBe('from=all');
    expect(el.props.keep).toEqual({ tab: 'posts', format: 'REELS' });
  });

  it('posts tab loads only its own data (posts with tags + tag list)', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'posts', format: 'REELS' });
    await streamTab(el);
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
    await streamTab(el);
    expect(el.props.tab).toBe(tab);
    expect(calls).toContain(call);
    expect(calls).not.toContain('daily');
    expect(calls).not.toContain('postRows');
  });

  it('a failing tab query rejects inside the boundary, after the header rendered (app/(app)/error.tsx catches it)', async () => {
    accounts.push(acct(ID));
    fail.postRows = true;
    const el = await run(ID, { tab: 'posts' });
    expect(el.props.tab).toBe('posts');
    await expect(streamTab(el)).rejects.toThrow('db down');
  });
});
