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
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

// the live progress hook refreshes the route when an import step lands
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number, followers = 1000): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-09-01');
const opts = (q = 'from=7d', tz = 'Asia/Kuala_Lumpur') => ({ scope: scopeOf(q), today: TODAY, now: NOW, tz, locale: 'en', weekStart: 'mon' as const });
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

function view(model = buildOverview(input, opts()), locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <OverviewView model={model} today={TODAY} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('OverviewView', () => {
  it('no accounts: empty state linking to /accounts, time scope bar still there', () => {
    view(buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, opts('', 'UTC')));
    expect(screen.getAllByRole('status')[1]).toHaveTextContent(en.pages.overview.empty);
    expect(screen.getByRole('link', { name: en.pages.overview.addAccount })).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: '30d' })).toHaveAttribute('aria-current', 'page');
  });

  it('totals with comparisons, group sections then isolated accounts', () => {
    view();
    const totals = screen.getByRole('region', { name: en.pages.overview.allAccounts });
    expect(within(totals).getByText(en.metrics.reach)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7d' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('vs previous 7 days').length).toBeGreaterThan(0); // the cards that have a comparison
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

  it('each card links to its account detail page, carrying the time scope', () => {
    view();
    expect(screen.getByRole('link', { name: '@brand.one' })).toHaveAttribute('href', '/accounts/brand.one?from=7d');
    expect(screen.getByRole('link', { name: `@${LONG}` })).toHaveAttribute('href', `/accounts/${LONG}?from=7d`);
    view(buildOverview(input, opts('')));
    expect(screen.getAllByRole('link', { name: '@brand.one' })[1]).toHaveAttribute('href', '/accounts/brand.one'); // the default scope adds nothing
  });

  it('a fixed range by weeks: weekly comparison chart, partial weeks explained, KPIs compared with the dates', () => {
    view(buildOverview(input, opts('from=2026-10-01&to=2026-10-14&gran=week')));
    expect(screen.getByText(/for each week of the selected range/)).toBeInTheDocument();
    expect(screen.getByText('* only partly inside the range')).toBeInTheDocument();
    expect(screen.getByText(/· vs 17 Sep 2026 – 30 Sep 2026/)).toBeInTheDocument(); // the bar names the comparison days
  });

  it('shows the export button passed by the page in the header, also with no accounts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <OverviewView model={buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, opts('', 'UTC'))} today={TODAY} exportButton={<button type="button">Export</button>} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('renders in Simplified Chinese', () => {
    view(undefined, 'zh-CN');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('总览');
    expect(screen.getByRole('link', { name: '7天' })).toBeInTheDocument();
    expect(screen.getAllByText('对比前 7 天').length).toBeGreaterThan(0);
  });
});
