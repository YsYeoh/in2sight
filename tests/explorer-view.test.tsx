import { existsSync, readFileSync } from 'node:fs';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ExplorerView } from '@/components/explorer/ExplorerView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildExplorer, type ScopeAccount } from '@/lib/analysis/explorer';
import type { ExplorerData } from '@/lib/explorer/load';
import { parseExplorerState } from '@/lib/explorer/state';
import type { Parts } from '@/lib/metrics';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
const download = vi.fn(async () => ({ ok: true as const }));
vi.mock('@/lib/export/download', () => ({ downloadExport: (...a: unknown[]) => download(...(a as [])) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
  download.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-17';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const LIVE: ScopeAccount[] = [{ id: A, username: 'alpha', groupName: 'Food' }, { id: B, username: 'beta', groupName: null }];
const daily = (reach: number): Parts => ({ daily: { reach, views: null, interactions: null, erInteractions: null, erReach: null, netFollows: null, followers: null }, posts: null });

function data(q: Record<string, string>, o: Partial<ExplorerData> = {}): ExplorerData {
  const state = parseExplorerState(q);
  const scope = resolveScope(parseTimeScope(q), TODAY, '2026-01-01');
  const window = { current: { from: '2026-09-16', to: '2026-10-15' }, compare: scope.scope.cmp === 'none' ? null : { from: '2026-08-17', to: '2026-09-15' } };
  const model = buildExplorer({ state, window, current: new Map([[A, daily(300)], [B, daily(100)]]), prior: window.compare ? new Map([[A, daily(200)]]) : null, accounts: LIVE, items: [], gran: scope.gran, weekStart: 'mon' });
  return { state, scope, window, live: LIVE, accounts: LIVE, groups: ['Food'], tags: [], model, items: [], truncated: false, item: null, ...o };
}

function view(d: ExplorerData) {
  const actions = { save: vi.fn(async () => ({ ok: true as const })), rename: vi.fn(async () => ({ ok: true as const })), remove: vi.fn(async () => ({ ok: true as const })) };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ExplorerView data={d} today={TODAY} views={[]} {...actions} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return actions;
}

describe('ExplorerView: results', () => {
  it('rows link one level deeper and keep the scope; values show their change; the chart is titled by metric and dimension', () => {
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    const table = screen.getByRole('table', { name: 'Explorer results' });
    expect(within(table).getByRole('link', { name: 'Show @alpha in detail' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=format&acc=${A}&from=90d`); // reach has no format split: post metrics take over
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('+50.0%'); // 300 vs 200
    expect(screen.getByRole('heading', { name: 'Reach by Account' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Drill-down path' })).toHaveTextContent('All accounts');
    expect(screen.getByText('Data from 16 Sep 2026 to 15 Oct 2026 · compared with 17 Aug 2026 to 15 Sep 2026')).toBeInTheDocument();
  });

  it('the Time Scope bar keeps the Explorer parameters in every preset link', () => {
    view(data({ m: 'reach', by: 'account' }));
    expect(screen.getByRole('link', { name: en.timeScope.preset['7d'] })).toHaveAttribute('href', '?m=reach&by=account&from=7d');
  });

  it('export sends the canonical view query; the item level has no export button', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    expect(screen.getByRole('button', { name: 'Export view' })).toHaveAttribute('data-size', 'default');
    await user.click(screen.getByRole('button', { name: 'Export view' }));
    expect(download).toHaveBeenCalledWith('/api/export/explorer?m=reach&by=account&from=90d', 'xlsx');
  });

  it('filter chips remove one filter and keep the rest; weekday/hour views say there is no hourly reach', () => {
    view(data({ m: 'posts', by: 'hour', wd: '3', from: '90d' }));
    expect(screen.getByRole('link', { name: 'Remove filter Wed' })).toHaveAttribute('href', '/explorer?m=posts&by=hour&from=90d');
    expect(screen.getByText(/no hourly reach/)).toBeInTheDocument();
  });

  it('single posts: no chart, the cut is explained', () => {
    view(data({ by: 'post' }, { truncated: true, items: [], model: { rows: [], partial: [] } }));
    expect(screen.queryByRole('heading', { name: /by Single posts/ })).toBeNull();
    expect(screen.getByText(/Showing the newest 0 posts/)).toBeInTheDocument();
  });

  it('no accounts yet: an empty state that links to Accounts', () => {
    view(data({}, { live: [], accounts: [] }));
    expect(screen.getByRole('link', { name: en.pages.overview.addAccount })).toHaveAttribute('href', '/accounts');
  });
});

describe('ExplorerView: toolbar', () => {
  it('always visible: Break down by, metrics, accounts, saved views, Advanced and Reset; no Apply button; no left column', () => {
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    const bar = screen.getByRole('group', { name: 'Explorer settings' });
    expect(within(bar).getByRole('combobox', { name: 'Break down by' })).toHaveValue('account');
    for (const name of ['1 metric', 'All accounts', 'Saved views', 'Advanced']) expect(within(bar).getByRole('button', { name })).toHaveAttribute('data-size', 'default');
    expect(within(bar).getByRole('link', { name: 'Reset' })).toHaveAttribute('href', '/explorer?m=reach%2CengagementRate%2Cposts%2CavgReach&by=account&from=90d');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Tag' })).toBeNull(); // under Advanced
    expect(document.querySelector('aside')).toBeNull();
  });

  it('Break down by applies as picked; metrics the new breakdown cannot show are dropped', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach,likes', by: 'account' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Break down by' }), 'format');
    expect(push).toHaveBeenCalledWith('/explorer?m=likes&by=format', { scroll: false });
  });

  it('metrics: each tick applies at once and the panel stays open; the last metric cannot be removed', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    await user.click(screen.getByRole('button', { name: '1 metric' }));
    const dialog = await screen.findByRole('dialog', { name: 'Metrics' });
    expect(within(dialog).getByRole('checkbox', { name: 'Reach' })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Likes' }));
    expect(push).toHaveBeenCalledWith('/explorer?m=reach%2Clikes&by=account&from=90d', { scroll: false });
    expect(within(dialog).getByRole('checkbox', { name: 'Likes' })).toBeChecked(); // ticks at once
    expect(screen.getByRole('dialog', { name: 'Metrics' })).toBeInTheDocument();
  });

  it('accounts: ticking one applies at once; picked accounts are named on the button and as chips', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account', from: '90d' }));
    await user.click(screen.getByRole('button', { name: 'All accounts' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Accounts' })).getByRole('checkbox', { name: '@beta' }));
    expect(push).toHaveBeenCalledWith(`/explorer?m=reach&by=account&acc=${B}&from=90d`, { scroll: false });
    cleanup();
    view(data({ m: 'reach', by: 'account', acc: B }));
    expect(screen.getByRole('button', { name: '1 account picked' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('link', { name: 'Remove filter @beta' })).toHaveAttribute('href', '/explorer?m=reach&by=account');
  });

  it('Advanced: a badge counts the active filters; a pick applies at once; chips remove one filter and keep the rest; Clear all', async () => {
    const user = userEvent.setup();
    view(data({ m: 'posts', by: 'hour', fmt: 'REELS', wd: '3', from: '90d' }));
    expect(screen.getByRole('link', { name: `Remove filter ${en.analysis.format.REELS}` })).toHaveAttribute('href', '/explorer?m=posts&by=hour&wd=3&from=90d');
    expect(screen.getByRole('link', { name: 'Remove filter Wed' })).toHaveAttribute('href', '/explorer?m=posts&by=hour&fmt=REELS&from=90d');
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '/explorer?m=posts&by=hour&from=90d');
    await user.click(screen.getByRole('button', { name: 'Advanced, 2 active' }));
    const dialog = await screen.findByRole('dialog', { name: en.filters.advancedTitle });
    expect(within(dialog).getByRole('combobox', { name: 'Weekday posted' })).toHaveValue('3');
    expect(within(within(dialog).getByRole('combobox', { name: 'Format' })).getByRole('option', { name: en.analysis.format.STORY })).toBeInTheDocument(); // the Stories opt-in
    expect(within(dialog).getByRole('combobox', { name: 'Group' })).toBeInTheDocument(); // data has a group
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Hour posted' }), '9');
    expect(push).toHaveBeenCalledWith('/explorer?m=posts&by=hour&fmt=REELS&wd=3&hr=9&from=90d', { scroll: false });
  });

  it('saved views live in their own panel', async () => {
    const user = userEvent.setup();
    view(data({ m: 'reach', by: 'account' }));
    await user.click(screen.getByRole('button', { name: en.explorer.views.title }));
    const dialog = await screen.findByRole('dialog', { name: en.explorer.views.title });
    expect(within(dialog).getByRole('button', { name: en.explorer.views.save })).toBeInTheDocument();
  });
});

describe('ExplorerView: item level', () => {
  it('shows the post with breadcrumbs down to its day and links to the account tab with the scope', () => {
    const item = { item: { id: '42', accountId: A, mediaType: 'REELS' as const, postedAt: '2026-10-05T01:00:00Z', permalink: null, caption: null, reach: 10, views: null, likes: 1, comments: 0, saves: 0, shares: 0 }, measuredAt: null, day: '2026-10-05', followers: [], audience: null };
    view(data({ m: 'likes', by: 'post', acc: A, fmt: 'REELS', item: '42', from: '90d' }, { item }));
    const crumbs = screen.getByRole('navigation', { name: 'Drill-down path' });
    expect(within(crumbs).getByRole('link', { name: '@alpha' })).toHaveAttribute('href', `/explorer?m=likes&by=format&acc=${A}&from=90d`);
    expect(within(crumbs).getByText('5 Oct 2026')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Open in Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts&from=90d`);
    expect(screen.queryByRole('button', { name: 'Export view' })).toBeNull();
  });
});

// The view is a client component: its runtime imports must never reach the server readers, stores or Excel writer.
const RUNTIME_IMPORT = /^import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](@\/[^'"]+)['"]/gm;
function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const file = ['.ts', '.tsx'].map((e) => `${entry.replace('@/', '')}${e}`).find(existsSync);
  if (!file) return seen;
  for (const m of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) graph(m[1], seen);
  return seen;
}

describe('client module graph', () => {
  it('ExplorerView never pulls the Explorer readers, the stores, the actions or the workbook writer', () => {
    const mods = [...graph('@/components/explorer/ExplorerView')];
    expect(mods).toContain('@/lib/analysis/explorer');
    expect(mods.filter((m) => /explorer\/(read|item|load|views)|explorer\/actions|sync\/store|supabase|dashboard\/(read|detail-read|cached)|export\/workbook/.test(m))).toEqual([]);
  });
});
