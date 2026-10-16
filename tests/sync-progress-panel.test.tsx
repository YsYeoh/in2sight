import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { SyncBadge } from '@/components/accounts/SyncBadge';
import { SyncProgressPanel } from '@/components/accounts/SyncProgressPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';
import type { AccountProgress, StageView } from '@/lib/sync/progress';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const acct: StoredAccount = { id: 'a1', igUserId: 'a1', username: 'brand.one', displayName: null, accountType: null, profilePictureUrl: null, groupName: 'Brand X', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-10-14T00:00:00Z' };
const st = (stage: StageView['stage'], state: StageView['state'], o: Partial<StageView> = {}): StageView => ({ stage, state, done: null, total: null, reason: null, ...o });
const base: AccountProgress = {
  accountId: 'a1',
  phase: 'running',
  percent: 21,
  stages: [st('profile', 'done'), st('stories', 'done'), st('account_days', 'running', { done: 30, total: 90 }), st('posts_list', 'pending'), st('post_metrics', 'pending'), st('audience', 'pending')],
  current: { stage: 'account_days', day: '2026-09-14', done: 30, total: 90 },
  startedAt: '2026-10-14T02:00:00Z',
  elapsedMs: 150_000,
  etaMs: null,
  resumeInMs: null,
  errorKey: null,
  summary: { days: 30, posts: 0 },
};

function view(progress: AccountProgress[], locale: 'en' | 'zh-CN' = 'en', onRetry = vi.fn()) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <SyncProgressPanel progress={progress} accounts={[acct]} onRetry={onRetry} />
        <SyncBadge p={progress[0]} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return onRetry;
}

describe('SyncProgressPanel', () => {
  it('running: title, percent bar, what it is doing now, stage checklist with counts, elapsed + estimating', () => {
    view([base]);
    expect(screen.getByRole('heading', { name: 'Importing @brand.one' })).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Import progress for @brand.one' });
    expect(bar).toHaveAttribute('aria-valuenow', '21');
    expect(bar).toHaveAttribute('aria-valuetext', '21% done');
    expect(screen.getByText(/^Pulling insights for .+…$/)).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(within(list).getByText('30 / 90 days')).toBeInTheDocument();
    expect(within(list).getAllByText('Done')).toHaveLength(2);
    expect(screen.getByText(/Running for 3 min · Estimating…/)).toBeInTheDocument();
    expect(screen.getByText('Importing… 21%')).toBeInTheDocument(); // the badge
  });

  it('shows an honest estimate once known', () => {
    view([{ ...base, etaMs: 7 * 60_000 }]);
    expect(screen.getByText(/About 7 min left/)).toBeInTheDocument();
  });

  it('rate limited: explains the slow-down and when it resumes', () => {
    view([{ ...base, phase: 'rate_limited', current: null, resumeInMs: 12 * 60_000 }]);
    expect(screen.getByText('Instagram asked us to slow down; resuming in about 12 min.')).toBeInTheDocument();
  });

  it('failed and stalled offer Retry; failed names the reason in plain language', async () => {
    const onRetry = view([{ ...base, phase: 'failed', current: null, errorKey: 'instagram_unavailable', stages: base.stages.map((s) => (s.stage === 'account_days' ? { ...s, state: 'failed', reason: 'instagram_unavailable' } : s)) }]);
    expect(screen.getByText(`The last batch failed: ${en.accounts.errors.instagram_unavailable}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('a1');
  });

  it('stalled is never shown as running', () => {
    view([{ ...base, phase: 'stalled', current: null }]);
    expect(screen.getByText(en.sync.phase.stalled)).toBeInTheDocument();
    expect(screen.queryByText(/Pulling insights/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('needs reconnect links to the reconnect flow (keeps the group)', () => {
    view([{ ...base, phase: 'needs_reconnect', current: null, errorKey: 'token_invalid' }]);
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute('href', expect.stringContaining('/api/instagram/connect'));
    expect(screen.getByText(en.sync.phase.needs_reconnect)).toBeInTheDocument();
  });

  it('done: summary and a link to the dashboard; the badge disappears', () => {
    view([{ ...base, phase: 'done', percent: 100, current: null, summary: { days: 90, posts: 42 }, stages: base.stages.map((s) => ({ ...s, state: 'done' as const })) }]);
    expect(screen.getByRole('heading', { name: '@brand.one is ready' })).toBeInTheDocument();
    expect(screen.getByText('Imported 90 days of account metrics and 42 posts.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open dashboard' })).toHaveAttribute('href', '/accounts/a1');
    expect(screen.queryByText(/Importing…/)).not.toBeInTheDocument();
  });

  it('skipped stages say why', () => {
    view([{ ...base, stages: [...base.stages.slice(0, 5), st('audience', 'skipped', { reason: 'needs_100_followers' })] }]);
    expect(screen.getByText(en.sync.skip.needs_100_followers)).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
  });

  it('one polite live region per card, announcing the stage (not every percent tick)', () => {
    view([base]);
    const live = document.querySelector('[aria-live="polite"].sr-only')!;
    expect(live.textContent).toBe('@brand.one: Account metrics');
    expect(live.textContent).not.toMatch(/%/);
  });

  it('zh-CN: real Chinese text, no raw keys', () => {
    view([base], 'zh-CN');
    expect(screen.getByRole('heading', { name: '正在导入 @brand.one' })).toBeInTheDocument();
    expect(screen.getByText('30 / 90 天')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sync\.|stages\.|activity\./);
  });

  it('renders nothing for accounts it does not know (archived/removed)', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <SyncProgressPanel progress={[{ ...base, accountId: 'other' }]} accounts={[acct]} onRetry={vi.fn()} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
