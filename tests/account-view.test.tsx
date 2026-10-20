import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { AccountOverview } from '@/components/account/AccountOverview';
import { AccountView } from '@/components/account/AccountView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildAccountOverview, type AccountOverviewInput } from '@/lib/dashboard/account';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  push.mockReset();
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
const NOW = new Date('2026-10-15T04:00:00Z');
const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (o: Partial<StoredAccount> = {}): StoredAccount => ({ id: ID, igUserId: '1', username: 'brand.one', displayName: 'Brand One', accountType: null, profilePictureUrl: null, groupName: 'Brand X', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null }));
const post = (id: string, day: string, reach: number): Post => ({ id, accountId: ID, mediaType: 'REELS', postedAt: `${day}T02:00:00Z`, permalink: `https://www.instagram.com/reel/${id}/`, reach, views: null, likes: 10, comments: null, shares: null, saves: null });
const empty: AccountOverviewInput = { account: acct(), sync: undefined, daily: [], posts: [], online: [], pooled: { accounts: 1, posts: [], online: [] } };
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-01-01');
const opts = { scope: scopeOf('from=7d'), today: TODAY, now: NOW, tz: 'Asia/Kuala_Lumpur', weekStart: 'mon' as const };

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('AccountView', () => {
  const head = { id: ID, username: 'brand.one', displayName: 'Brand One', groupName: 'Brand X' };
  const frame = (tab: 'overview' | 'posts' | 'audience', q = '', children = <p>panel</p>) => (
    <AccountView account={head} tab={tab} scope={scopeOf(q)} today={TODAY} keep={{ tab }}>
      {children}
    </AccountView>
  );

  it('header, back link, calendar link, external Instagram link with noopener', () => {
    wrap(frame('overview'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('@brand.one');
    expect(screen.getByText('Brand One · Brand X')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.pages.account.back })).toHaveAttribute('href', '/overview');
    expect(screen.getByRole('link', { name: en.pages.account.calendar })).toHaveAttribute('href', `/calendar?account=${ID}`);
    const ig = screen.getByRole('link', { name: en.pages.account.instagram });
    expect(ig).toHaveAttribute('href', 'https://www.instagram.com/brand.one/');
    expect(ig).toHaveAttribute('rel', 'noopener noreferrer');
    expect(ig).toHaveAttribute('target', '_blank');
  });

  it('tabs have tablist/tab/tabpanel roles; only the active panel holds the content', () => {
    wrap(frame('posts', '', <p>posts panel</p>));
    const list = screen.getByRole('tablist', { name: en.pages.account.tabs });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Posts', 'Stories', 'Audience']);
    expect(within(list).getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('posts panel');
  });

  it('choosing a tab (click or keyboard) navigates to ?tab=…', async () => {
    const user = userEvent.setup();
    wrap(frame('overview'));
    await user.click(screen.getByRole('tab', { name: 'Audience' }));
    expect(push).toHaveBeenCalledWith('?tab=audience', { scroll: false });
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}'); // manual activation: arrows move focus only
    expect(screen.getByRole('tab', { name: 'Posts' })).toHaveFocus();
    expect(push).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(push).toHaveBeenLastCalledWith('?tab=posts', { scroll: false });
  });

  it('the time scope travels: tabs, back link, calendar link and the bar keep it; Audience has no bar', async () => {
    const user = userEvent.setup();
    wrap(frame('overview', 'from=2026-09-01&to=2026-09-30&cmp=yoy'));
    const q = 'from=2026-09-01&to=2026-09-30&cmp=yoy';
    expect(screen.getByRole('link', { name: en.pages.account.back })).toHaveAttribute('href', `/overview?${q}`);
    expect(screen.getByRole('link', { name: en.pages.account.calendar })).toHaveAttribute('href', `/calendar?account=${ID}&${q}`);
    expect(screen.getByRole('link', { name: en.timeScope.preset['7d'] })).toHaveAttribute('href', '?tab=overview&from=7d&cmp=yoy');
    await user.click(screen.getByRole('tab', { name: 'Posts' }));
    expect(push).toHaveBeenCalledWith(`?tab=posts&${q}`, { scroll: false });
    cleanup();
    wrap(frame('audience', 'from=90d'));
    expect(screen.queryByRole('navigation', { name: en.timeScope.presets })).toBeNull();
  });
});

describe('AccountOverview', () => {
  it('KPIs with comparison, charts, formats, flags and the best-time toggles', async () => {
    const user = userEvent.setup();
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, addDays('2026-09-20', i), 100));
    const model = buildAccountOverview({ ...empty, sync: { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' }, daily: days(14), posts: [...history, post('hit', '2026-10-12', 900)], pooled: { accounts: 3, posts: history, online: [] } }, opts);
    wrap(<AccountOverview model={model} />);
    const kpis = screen.getByRole('region', { name: en.pages.account.kpis });
    expect(within(kpis).getAllByText(en.timeScope.vsPrevious.replace('{days}', '7')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: en.pages.account.trendTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Post taking off/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText(en.analysis.format.REELS).length).toBeGreaterThan(0);
    // default = followers online (SPEC §7); no online data → the reason shows
    expect(screen.getByRole('button', { name: en.pages.account.bestTimeOnline })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(en.analysis.reasons.needs_100_followers)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.pages.account.bestTimePosts }));
    expect(screen.getByText(en.analysis.reasons.not_enough_posts)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '3 accounts pooled' }));
    expect(screen.getByRole('button', { name: '3 accounts pooled' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('account with no data renders every reason and no NaN (zh-CN)', () => {
    const { container } = wrap(<AccountOverview model={buildAccountOverview(empty, opts)} />, 'zh-CN');
    expect(screen.getAllByText(zh.analysis.reasons.backfilling).length).toBeGreaterThan(0); // the state note and the KPI reasons
    expect(screen.getByText(zh.pages.account.noFlags)).toBeInTheDocument();
    expect(screen.getByText(zh.pages.overview.neverSynced)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
});
