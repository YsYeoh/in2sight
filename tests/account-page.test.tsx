import { Suspense, isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, accounts, fail, since, storiesFrom, storyArgs, postArgs, migrated, growthArgs } = vi.hoisted(() => ({ growthArgs: { breakdownFrom: [] as string[] }, calls: [] as string[], accounts: [] as Record<string, unknown>[], fail: { postRows: false }, since: [] as (string | null)[], storiesFrom: [] as string[], storyArgs: [] as Record<string, unknown>[], postArgs: [] as Record<string, unknown>[], migrated: { stories: true, posts: true } }));

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => void calls.push('requireOwner') }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
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
  loadPostRows: async (_db: unknown, _id: string, from: string | null) => {
    if (fail.postRows) throw new Error('db down');
    since.push(from);
    return calls.push('postRows'), [];
  },
  loadPostPage: async (_db: unknown, _id: string, a: Record<string, unknown>) => {
    if (fail.postRows) throw new Error('db down');
    return calls.push('postPage'), postArgs.push(a), migrated.posts ? { rows: [], total: 0, page: 1 } : null;
  },
  loadTags: async () => (calls.push('tags'), []),
  loadStories: async (_db: unknown, _id: string, fromIso: string) => (calls.push('stories'), storiesFrom.push(fromIso), { stories: [], truncated: false }),
  loadStoryPage: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('storyPage'), storyArgs.push(a), migrated.stories ? { stories: [], items: 0, days: 0, page: 1 } : null),
  loadAudience: async () => (calls.push('audience'), { age_gender: null, country: null, city: null }),
}));

vi.mock('@/lib/dashboard/growth-read', () => ({
  loadReachBreakdown: async (_db: unknown, _id: string, from: string) => (calls.push('breakdown'), growthArgs.breakdownFrom.push(from), []),
  loadFollowerCurve: async () => (calls.push('curve'), []),
  loadStoryDays: async () => (calls.push('storyDays'), { days: {}, from: null }),
  loadCommentDays: async () => (calls.push('commentDays'), { days: {}, from: null }),
  loadAudienceEnds: async () => (calls.push('audienceEnds'), { first: { age_gender: null, country: null, city: null }, last: { age_gender: null, country: null, city: null } }),
}));

import AccountPage from '@/app/(app)/accounts/[id]/(tabs)/page';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { daysToIso, localDay } from '@/lib/sync/time';

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
  since.length = 0;
  storiesFrom.length = 0;
  storyArgs.length = 0;
  postArgs.length = 0;
  migrated.stories = true;
  migrated.posts = true;
  accounts.length = 0;
  fail.postRows = false;
  growthArgs.breakdownFrom.length = 0;
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

  it('the Suspense key ignores the list params (the toolbar stays mounted, the search box keeps focus); a tab or Time Scope change re-keys', async () => {
    accounts.push(acct(ID));
    const key = async (sp: Record<string, string>) => (await run(ID, sp)).props.children.key;
    const stories = await key({ tab: 'stories' });
    expect(await key({ tab: 'stories', pr: '7d', pfrom: '2026-10-01', pto: '2026-10-09', sort: 'views', measured: 'yes', page: '2' })).toBe(stories);
    const posts = await key({ tab: 'posts' });
    expect(await key({ tab: 'posts', q: 'cat', format: 'REELS', tag: 'untagged', sort: 'reach', page: '3', view: 'grid' })).toBe(posts);
    expect(new Set([stories, posts, await key({ tab: 'stories', from: '90d' })]).size).toBe(3);
  });

  it('posts view: ?view=grid|table is passed to the tab; the Suspense key ignores it (the shown view stays until the other one streams in)', async () => {
    accounts.push(acct(ID));
    const plain = await run(ID, { tab: 'posts' });
    const grid = await run(ID, { tab: 'posts', view: 'grid' });
    expect(grid.props.children.key).toBe(plain.props.children.key);
    expect(((await streamTab(grid)) as ReactElement<{ state: { view: string | null } }>).props.state.view).toBe('grid');
    const junk = await run(ID, { tab: 'posts', view: '<x>' });
    expect(((await streamTab(junk)) as ReactElement<{ state: { view: string | null } }>).props.state.view).toBeNull();
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

  it('the scope is resolved once with the first captured day', async () => {
    accounts.push(acct(ID));
    const el = (await run(ID, { tab: 'posts', from: 'all', format: 'REELS', tag: 'not-a-uuid' })) as unknown as ReactElement<{ scope: { window: unknown; query: string } }>;
    expect(el.props.scope.window).toEqual({ from: '2026-07-01', to: expect.any(String) });
    expect(el.props.scope.query).toBe('from=all');
  });

  it('posts tab loads only its own data (posts with tags + tag list)', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'posts', format: 'REELS' });
    await streamTab(el);
    expect(el.props.tab).toBe('posts');
    expect(calls).toEqual(expect.arrayContaining(['postPage', 'tags']));
    expect(calls).not.toContain('daily');
  });

  it('the Stories tab gets the account id and the scope (its Post Lab links)', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'stories', from: '90d' });
    expect(((await streamTab(el)) as ReactElement<{ accountId: string; scope: Record<string, string> }>).props).toMatchObject({ accountId: ID, scope: { from: '90d' } });
  });

  it.each([['stories', 'storyPage']])('%s tab loads only its own data', async (tab, call) => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab });
    await streamTab(el);
    expect(el.props.tab).toBe(tab);
    expect(calls).toContain(call);
    expect(calls).not.toContain('daily');
    expect(calls).not.toContain('postRows');
  });

  it('the Overview also loads the audience snapshots and hands them to the page', async () => {
    accounts.push(acct(ID));
    const tab = (await streamTab(await run(ID))) as ReactElement<{ audience: { reason: string | null } }>;
    expect(calls).toContain('audience');
    expect(tab.props.audience).toMatchObject({ reason: 'needs_100_followers' }); // the mock has no snapshot
  });

  it('?tab=audience (old links) redirects to the Audience section of Overview, keeping the scope; unknown accounts still 404', async () => {
    await expect(run(ID, { tab: 'audience' })).rejects.toThrow('NEXT_NOT_FOUND');
    accounts.push(acct(ID));
    await expect(run(ID, { tab: 'audience', from: '90d' })).rejects.toThrow(`NEXT_REDIRECT /accounts/${ID}?from=90d#audience`);
    await expect(run(ID, { tab: 'audience' })).rejects.toThrow(`NEXT_REDIRECT /accounts/${ID}#audience`);
  });

  it('a failing tab query rejects inside the boundary, after the header rendered (app/(app)/error.tsx catches it)', async () => {
    accounts.push(acct(ID));
    fail.postRows = true;
    const el = await run(ID, { tab: 'posts' });
    expect(el.props.tab).toBe('posts');
    await expect(streamTab(el)).rejects.toThrow('db down');
  });
});

describe('account page: Stories list (Plan 14b)', () => {
  type StoriesEl = ReactElement<{ state: unknown; page: number; items: number; days: number; today: string; truncated?: boolean; scope: Record<string, string> }>;
  it('own list params, never the Time Scope: the posted window in the owner timezone, one page of story_list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T04:00:00Z')); // 12:00 in the default timezone: the same day everywhere
    try {
      accounts.push(acct(ID));
      const tz = DEFAULT_PREFS.timezone;
      const el = (await streamTab(await run(ID, { tab: 'stories', pr: '7d', sort: 'exit', measured: 'no', page: '2', from: '2026-09-01', to: '2026-09-30' }))) as StoriesEl;
      expect(storyArgs).toEqual([{ ...daysToIso('2026-10-11', '2026-10-17', tz), tz, measured: false, sort: 'exit', page: 2, size: 48 }]);
      expect(el.props).toMatchObject({ state: { dates: { pr: '7d', from: null, to: null }, measured: false, sort: 'exit', page: 2 }, page: 1, items: 0, days: 0, today: '2026-10-17', scope: { from: '2026-09-01', to: '2026-09-30' } });
      expect(calls).not.toContain('stories'); // no capped read once the migration is applied
      await streamTab(await run(ID, { tab: 'stories' })); // All time = the MAX_DAYS floor, newest pages by 7 days
      expect(storyArgs.at(-1)).toMatchObject({ ...daysToIso('2021-10-14', '2026-10-17', tz), sort: 'newest', page: 1, size: 7, measured: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('before the migration (function missing): the capped read of the same window, the state applied in TypeScript', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T04:00:00Z'));
    try {
      accounts.push(acct(ID));
      migrated.stories = false;
      const el = (await streamTab(await run(ID, { tab: 'stories', pr: '30d', page: '4' }))) as StoriesEl;
      expect(calls).toContain('storyPage');
      expect(storiesFrom).toEqual([daysToIso('2026-09-18', '2026-10-17', DEFAULT_PREFS.timezone).fromIso]);
      expect(el.props).toMatchObject({ items: 0, days: 0, page: 1, truncated: false }); // page 4 of nothing = page 1
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('account page: Posts list (Plan 14b)', () => {
  type PostsEl = ReactElement<{ state: unknown; page: number; total: number; today: string; scope: Record<string, string> }>;
  it('own list params, never the Time Scope: the posted window in the owner timezone, one page of post_list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T04:00:00Z')); // 12:00 in the default timezone: the same day everywhere
    try {
      accounts.push(acct(ID));
      const tz = DEFAULT_PREFS.timezone;
      const el = (await streamTab(await run(ID, { tab: 'posts', pfrom: '2026-10-01', pto: '2026-10-09', q: ' cat ', format: 'REELS', tag: 'untagged', sort: 'engagement_asc', page: '2', view: 'grid', from: '7d' }))) as PostsEl;
      expect(postArgs).toEqual([{ ...daysToIso('2026-10-01', '2026-10-09', tz), q: 'cat', format: 'REELS', tag: 'untagged', sort: { key: 'engagement', asc: true }, page: 2, size: 24 }]);
      expect(el.props).toMatchObject({ state: { q: 'cat', sort: 'engagement_asc', page: 2, view: 'grid' }, page: 1, total: 0, today: '2026-10-17', scope: { from: '7d' } });
      expect(calls).not.toContain('postRows'); // no full read once the migration is applied
      await streamTab(await run(ID, { tab: 'posts' })); // All time = the MAX_DAYS floor, newest first, 50 per page
      expect(postArgs.at(-1)).toMatchObject({ ...daysToIso('2021-10-14', '2026-10-17', tz), q: '', format: null, tag: null, sort: { key: 'date', asc: false }, page: 1, size: 50 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('before the migration (function missing): every post of the same window, the state applied in TypeScript', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T04:00:00Z'));
    try {
      accounts.push(acct(ID));
      migrated.posts = false;
      const el = (await streamTab(await run(ID, { tab: 'posts', pr: 'year', page: '3' }))) as PostsEl;
      expect(calls).toEqual(expect.arrayContaining(['postPage', 'postRows']));
      expect(since.at(-1)).toBe(daysToIso('2026-01-01', '2026-10-17', DEFAULT_PREFS.timezone).fromIso);
      expect(el.props).toMatchObject({ total: 0, page: 1 }); // page 3 of nothing = page 1
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('account page: Growth tab (Plan 15a)', () => {
  it('reads the scope plus the 90-day look-back with the owner session, builds the model and hands it to the tab', async () => {
    accounts.push(acct(ID));
    const el = await run(ID, { tab: 'growth', from: '30d' });
    const tab = (await streamTab(el)) as ReactElement<{ model: { scope: { range: { to: string } }; days: { day: string }[] } }>;
    expect(el.props.tab).toBe('growth');
    expect(calls).toEqual(expect.arrayContaining(['daily', 'posts', 'breakdown', 'storyDays', 'commentDays', 'audienceEnds']));
    expect(calls).not.toContain('curve'); // 30 days: daily points, no hourly read
    expect(calls).not.toContain('ADMIN');
    expect(calls).not.toContain('postPage');
    const today = localDay(new Date(), DEFAULT_PREFS.timezone);
    expect(tab.props.model.scope.range.to).toBe(today);
    expect(tab.props.model.days[0].day).toBe(growthArgs.breakdownFrom[0]); // the readers and the model use the same first day
  });

  it('ranges of 7 days or less also read the hourly follower curve', async () => {
    accounts.push(acct(ID));
    await streamTab(await run(ID, { tab: 'growth', from: '7d' }));
    expect(calls).toContain('curve');
  });
});
