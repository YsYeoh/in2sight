import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AccountOverview } from '@/components/account/AccountOverview';
import { PostsTab } from '@/components/account/PostsTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildAccountOverview } from '@/lib/dashboard/account';
import type { PostView } from '@/lib/dashboard/content';
import { ALL_TIME } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-15';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const account: StoredAccount = { id: A, igUserId: '1', username: 'brand', displayName: null, accountType: null, profilePictureUrl: null, groupName: 'Food', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' };
const days: DailyRow[] = Array.from({ length: 14 }, (_, i) => ({ day: addDays(TODAY, i - 14), followers: 1000, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null }));
// a Reel published Wednesday 7 Oct 2026, 20:00 in Kuala Lumpur (12:00 UTC), with engagement
const reel: Post = { id: 'r1', accountId: A, mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: null, reach: 500, views: null, likes: 40, comments: 5, shares: 2, saves: 3 };
const scope = resolveScope(parseTimeScope(new URLSearchParams('from=90d')), TODAY, '2026-09-01');
const model = buildAccountOverview({ account, sync: undefined, daily: days, posts: [reel], online: [], pooled: { accounts: 2, posts: [reel], online: [] } }, { scope, today: TODAY, now: new Date('2026-10-15T04:00:00Z'), tz: 'Asia/Kuala_Lumpur', weekStart: 'mon' });

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur' }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('account overview drill-down', () => {
  it('a format row lists that format of this account in the Explorer, with the page scope', () => {
    wrap(<AccountOverview model={model} account={{ id: A, groupName: 'Food' }} />);
    const table = screen.getByRole('table', { name: en.pages.account.formatsTitle });
    expect(within(table).getByRole('link', { name: 'Show Reel in detail' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=REELS&from=90d`);
  });

  it('a best-time cell (your posts) lists the posts behind it over all history; the pooled grid uses the group', async () => {
    const user = userEvent.setup();
    wrap(<AccountOverview model={model} account={{ id: A, groupName: 'Food' }} />);
    expect(within(screen.getByRole('table', { name: en.pages.account.bestTimeTitle })).queryAllByRole('link')).toHaveLength(0); // followers online: nothing to list
    await user.click(screen.getByRole('button', { name: en.pages.account.bestTimePosts }));
    const grid = screen.getByRole('table', { name: en.pages.account.bestTimeTitle });
    const links = within(grid).getAllByRole('link');
    expect(links).toHaveLength(1); // only the cell that has a post
    expect(links[0]).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&wd=3&hr=20&from=all`);
    await user.click(screen.getByRole('button', { name: '2 accounts pooled' }));
    expect(within(screen.getByRole('table', { name: en.pages.account.bestTimeTitle })).getByRole('link')).toHaveAttribute('href', '/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&grp=Food&wd=3&hr=20&from=all');
  });

  it('without the account prop nothing links (unchanged behaviour)', () => {
    wrap(<AccountOverview model={model} />);
    expect(within(screen.getByRole('table', { name: en.pages.account.formatsTitle })).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('posts tab drill-down', () => {
  const row: PostView = { id: '42', mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: null, caption: 'Hi', reach: 500, views: null, likes: 40, comments: 5, saves: 3, shares: 2, engagementRate: 0.1, tags: [] };
  it('each post opens its single-item level in the Explorer, with no range (ux-polish §8 call 1)', () => {
    wrap(<PostsTab posts={[row]} total={1} page={1} state={{ dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null }} tags={[]} today="2026-10-17" scope={{ from: '90d' }} accountId={A} setPostTags={vi.fn()} />);
    const links = screen.getAllByRole('link', { name: /^Reel · 7 Oct 2026 20:00$/ }); // table (md+) and card list (phones)
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=REELS&item=42`);
  });
});
