import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AccountsView } from '@/components/accounts/AccountsView';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import { buildOverview } from '@/lib/dashboard/overview';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';
import { DEFAULT_PREFS } from '@/lib/prefs';
import type { AccountProgress } from '@/lib/sync/progress';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const acct = (id: string, username: string): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: 'MEDIA_CREATOR', profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-10-14T00:00:00Z' });
const accounts = [acct('a1', 'fresh.one'), acct('a2', 'settled')];
const importing: AccountProgress = {
  accountId: 'a1',
  phase: 'failed',
  percent: 40,
  stages: [{ stage: 'profile', state: 'done', done: null, total: null, reason: null }, { stage: 'account_days', state: 'failed', done: 36, total: 90, reason: 'instagram_unavailable' }],
  current: null,
  startedAt: '2026-10-14T02:00:00Z',
  elapsedMs: 120_000,
  etaMs: null,
  resumeInMs: null,
  errorKey: 'instagram_unavailable',
  summary: { days: 36, posts: 0 },
};
const PROGRESS = [importing];

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('progress on the Accounts page', () => {
  it('shows the panel after connect next to the connected notice, a badge on the importing account only, and Retry runs Sync now', async () => {
    const ok = async () => ({ ok: true });
    const actions = { archive: vi.fn(ok), restore: vi.fn(ok), remove: vi.fn(ok), setGroup: vi.fn(ok), syncNow: vi.fn(ok) };
    wrap(<AccountsView accounts={accounts} actions={actions} now="2026-10-14T02:00:00Z" notice={{ connected: 'fresh.one' }} progress={PROGRESS} />);
    expect(screen.getByText('Connected @fresh.one')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Importing @fresh.one' })).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const freshRow = rows.find((r) => within(r).queryByText('@fresh.one'))!;
    const settledRow = rows.find((r) => within(r).queryByText('@settled'))!;
    expect(within(freshRow).getByText('Importing… 40%')).toBeInTheDocument();
    expect(within(settledRow).queryByText(/Importing…/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.syncNow).toHaveBeenCalledWith('a1');
  });

  it('nothing importing: no panel, no badge', () => {
    const ok = async () => ({ ok: true });
    wrap(<AccountsView accounts={accounts} actions={{ archive: ok, restore: ok, remove: ok, setGroup: ok, syncNow: ok }} now="2026-10-14T02:00:00Z" />);
    expect(screen.queryByRole('heading', { name: /^Importing @/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Importing…/)).not.toBeInTheDocument();
  });
});

describe('progress on Overview cards', () => {
  it('the importing account card carries the badge; the settled one does not', () => {
    const scope = resolveScope(parseTimeScope({ from: '7d' }), '2026-10-14');
    const model = buildOverview({ accounts, sync: {}, daily: { a1: [], a2: [] }, posts: {} }, { scope, today: '2026-10-14', now: new Date('2026-10-14T02:00:00Z'), tz: 'Asia/Kuala_Lumpur', locale: 'en', weekStart: 'mon' });
    wrap(<OverviewView model={model} today="2026-10-14" progress={PROGRESS} />);
    const fresh = screen.getByRole('heading', { name: '@fresh.one' }).closest('li')!;
    const settled = screen.getByRole('heading', { name: '@settled' }).closest('li')!;
    expect(within(fresh).getByText('Importing… 40%')).toBeInTheDocument();
    expect(within(settled).queryByText(/Importing…/)).not.toBeInTheDocument();
  });
});
