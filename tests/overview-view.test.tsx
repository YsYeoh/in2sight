import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number, followers = 1000): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
const LONG = 'a_really_long_instagram_handle_that_goes_on_and_on_forever';
const hit: Post = { id: 'hit', accountId: 'brand.one', mediaType: 'REELS', postedAt: '2026-10-13T00:00:00Z', permalink: 'https://www.instagram.com/reel/hit/', reach: 900, views: null, likes: null, comments: null, shares: null, saves: null };
const history: Post[] = Array.from({ length: 6 }, (_, i) => ({ ...hit, id: `h${i}`, mediaType: 'IMAGE', postedAt: `${addDays('2026-09-20', i)}T00:00:00Z`, reach: 100 }));

const input: OverviewInput = {
  accounts: [acct('brand.one', { groupName: 'Brand X' }), acct('brand.two', { groupName: 'Brand X' }), acct(LONG), acct('broken', { status: 'needs_reconnect' }), acct('fresh')],
  sync: { 'brand.one': synced, 'brand.two': synced, [LONG]: synced, broken: { ...synced, lastErrorKey: 'token_invalid', consecutiveFailures: 3 } },
  daily: { 'brand.one': days(14, 100), 'brand.two': days(14, 0, 0), [LONG]: days(3, 5), broken: days(14, 10), fresh: [] },
  posts: { 'brand.one': [...history, hit] },
};

function view(model = buildOverview(input, { period: 7, today: TODAY, now: NOW, tz: 'Asia/Kuala_Lumpur', locale: 'en' }), locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <OverviewView model={model} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('OverviewView', () => {
  it('no accounts: empty state linking to /accounts, period selector still there', () => {
    view(buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, { period: 30, today: TODAY, now: NOW, tz: 'UTC', locale: 'en' }));
    expect(screen.getByRole('status')).toHaveTextContent(en.pages.overview.empty);
    expect(screen.getByRole('link', { name: en.pages.overview.addAccount })).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute('aria-current', 'page');
  });

  it('totals with comparisons, group sections then isolated accounts', () => {
    view();
    const totals = screen.getByRole('region', { name: en.pages.overview.allAccounts });
    expect(within(totals).getByText(en.metrics.reach)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([expect.stringContaining('Brand X'), expect.stringContaining(en.pages.overview.isolated)]);
    // each group section is named by its own heading, even for names with spaces and the isolated group
    expect(screen.getByRole('region', { name: /Brand X/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: new RegExp(en.pages.overview.isolated) })).toBeInTheDocument();
  });

  it('card states: reconnect badge + link, backfilling note, sync error, taking-off flag linking to the post', () => {
    view();
    const broken = screen.getByRole('heading', { name: '@broken' }).closest('li')!;
    expect(within(broken).getByText(en.pages.overview.needsReconnect)).toBeInTheDocument();
    expect(within(broken).getByRole('link', { name: en.pages.overview.reconnectHint })).toHaveAttribute('href', '/accounts');
    expect(within(broken).getByText(new RegExp(en.accounts.errors.token_invalid.slice(0, 20)))).toBeInTheDocument();
    const fresh = screen.getByRole('heading', { name: '@fresh' }).closest('li')!;
    expect(within(fresh).getByText(/of this period imported so far/)).toHaveTextContent(`${en.analysis.reasons.backfilling} · 0% of this period imported so far`);
    expect(within(fresh).getByText(en.pages.overview.neverSynced)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Post taking off: 9× median reach/ })).toHaveAttribute('href', hit.permalink);
  });

  it('comparison: scoped to the group first, widen to all accounts', async () => {
    view();
    const group = screen.getByRole('group', { name: en.pages.overview.scope });
    expect(within(group).getByRole('button', { name: 'Brand X' })).toHaveAttribute('aria-pressed', 'true');
    const table = () => screen.getByRole('table', { name: en.pages.overview.compareTitle });
    expect(within(table()).getAllByRole('row')).toHaveLength(3);
    await userEvent.click(within(group).getByRole('button', { name: en.pages.overview.allAccounts }));
    expect(within(table()).getAllByRole('row')).toHaveLength(6);
  });

  it('zero followers, missing data and very long names render without NaN/Infinity and truncate', () => {
    const { container } = view();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByRole('heading', { name: `@${LONG}` }).className).toContain('truncate');
  });

  it('each card links to its account detail page', () => {
    view();
    expect(screen.getByRole('link', { name: '@brand.one' })).toHaveAttribute('href', '/accounts/brand.one');
    expect(screen.getByRole('link', { name: `@${LONG}` })).toHaveAttribute('href', `/accounts/${LONG}`);
  });

  it('shows the export button passed by the page in the header, also with no accounts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <OverviewView model={buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, { period: 30, today: TODAY, now: NOW, tz: 'UTC', locale: 'en' })} exportButton={<button type="button">Export</button>} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders in Simplified Chinese', () => {
    view(undefined, 'zh-CN');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('总览');
    expect(screen.getByRole('link', { name: '7 天' })).toBeInTheDocument();
    expect(screen.getAllByText('对比前 7 天').length).toBeGreaterThan(0);
  });
});
