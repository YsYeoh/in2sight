import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
// Recharts draws nothing in jsdom (no layout): a stand-in exposes the chart's click handler as buttons
vi.mock('@/components/charts/SeriesChart', () => ({
  SeriesChart: ({ data, onPointClick }: { data: { day: string }[]; onPointClick?: (i: number) => void }) => (
    <div>
      {data.map((d, i) => (
        <button key={d.day} type="button" onClick={() => onPointClick?.(i)}>
          {`bucket ${d.day}`}
        </button>
      ))}
    </div>
  ),
}));

const TODAY = '2026-10-15';
const acct = (id: string, groupName: string | null): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z' });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

function view(q: string) {
  const scope = resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-09-01');
  const model = buildOverview(
    { accounts: [acct('brand.one', 'Brand X'), acct('brand.two', 'Brand X')], sync: { 'brand.one': synced, 'brand.two': synced }, daily: { 'brand.one': days(14, 100), 'brand.two': days(14, 50) }, posts: {} },
    { scope, today: TODAY, now: new Date('2026-10-15T04:00:00Z'), tz: 'UTC', locale: 'en', weekStart: 'mon' },
  );
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <OverviewView model={model} today={TODAY} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Overview drill-down into the Explorer (the scope is kept)', () => {
  it('each total tile opens the Explorer on that metric at the portfolio level', () => {
    view('from=7d');
    const totals = screen.getByRole('region', { name: en.pages.overview.allAccounts });
    expect(within(totals).getByRole('link', { name: /Explore Reach in the Explorer/ })).toHaveAttribute('href', '/explorer?m=reach&by=group&from=7d');
    expect(within(totals).getByRole('link', { name: /Explore Engagement in the Explorer/ })).toHaveAttribute('href', '/explorer?m=engagementRate&by=group&from=7d');
  });

  it('a group heading opens its accounts; a comparison row opens the account page', () => {
    view('from=7d&cmp=yoy');
    expect(screen.getByRole('link', { name: 'Brand X' })).toHaveAttribute('href', '/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account&grp=Brand+X&from=7d&cmp=yoy');
    const table = screen.getByRole('table', { name: en.pages.overview.compareTitle });
    expect(within(table).getByRole('link', { name: 'Open @brand.one' })).toHaveAttribute('href', '/accounts/brand.one?from=7d&cmp=yoy');
  });

  it('a click on a chart bucket opens the Explorer on those days, the group compared side by side', async () => {
    const user = userEvent.setup();
    view('from=7d');
    await user.click(screen.getByRole('button', { name: 'bucket 2026-10-08' }));
    expect(push).toHaveBeenCalledWith('/explorer?m=reach&by=account&grp=Brand+X&from=2026-10-08&to=2026-10-08');
  });
});
