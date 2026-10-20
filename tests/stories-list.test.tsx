import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { StoriesTab } from '@/components/account/StoriesTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildStories, type StoryView } from '@/lib/dashboard/content';
import type { StoryRow } from '@/lib/dashboard/detail-read';
import { ALL_TIME, type StoryListState } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-15T04:00:00Z');
const NEWEST: StoryListState = { dates: ALL_TIME, measured: null, sort: 'newest', page: 1 };
const SCOPE = { from: '90d' }; // the page's Time Scope: carried, never a filter
const story = (id: string, postedAt: string, views: number | null): StoryRow => ({ id, postedAt, expiresAt: null, permalink: null, cover: 'ok', snapshots: views === null ? [] : [{ capturedAt: postedAt, reach: views, views, replies: null, shares: null, interactions: null, tapsForward: null, tapsBack: null, exits: 1 }] });
const STORIES = buildStories([story('s1', '2026-10-14T23:30:00Z', 40), story('s2', '2026-10-13T02:00:00Z', 10), story('s3', '2026-10-12T02:00:00Z', null)], NOW);

function tab(o: { stories?: StoryView[]; state?: StoryListState; items?: number; days?: number; page?: number } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <StoriesTab stories={o.stories ?? STORIES} items={o.items ?? 3} days={o.days ?? 3} page={o.page ?? 1} state={o.state ?? NEWEST} today="2026-10-15" accountId={A} scope={SCOPE} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Stories tab: filters', () => {
  it('a toolbar with Posted, Sort and Numbers (no range bar, no search); defaults All time and newest first', () => {
    tab();
    const bar = screen.getByRole('group', { name: en.pages.account.stories.filters });
    expect(within(bar).getByRole('button', { name: 'Posted: All time' })).toBeInTheDocument();
    expect(within(bar).getByRole('combobox', { name: en.pages.account.stories.sort })).toHaveValue('newest');
    expect(within(bar).getByRole('combobox', { name: en.pages.account.stories.measured })).toHaveValue('');
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('navigation', { name: en.timeScope.presets })).toBeNull();
    expect(within(bar).queryByRole('list', { name: en.filters.active })).toBeNull(); // nothing active, no chips
  });

  it('picking a sort or Numbers applies at once, back to page 1, keeping the other filters and the scope', async () => {
    const user = userEvent.setup();
    tab({ state: { ...NEWEST, dates: { pr: '30d', from: null, to: null }, page: 3 } });
    await user.selectOptions(screen.getByRole('combobox', { name: en.pages.account.stories.sort }), 'exit');
    expect(push).toHaveBeenLastCalledWith('?tab=stories&pr=30d&sort=exit&from=90d', { scroll: false });
    await user.selectOptions(screen.getByRole('combobox', { name: en.pages.account.stories.measured }), 'no');
    expect(push).toHaveBeenLastCalledWith('?tab=stories&pr=30d&measured=no&from=90d', { scroll: false });
  });

  it('active filters are chips that remove one each; Clear all keeps the sort and the scope', () => {
    tab({ state: { dates: { pr: '7d', from: null, to: null }, measured: true, sort: 'views', page: 2 } });
    const chips = screen.getByRole('list', { name: en.filters.active });
    expect(within(chips).getByRole('link', { name: 'Remove filter Last 7 days' })).toHaveAttribute('href', '?tab=stories&measured=yes&sort=views&from=90d');
    expect(within(chips).getByRole('link', { name: 'Remove filter Measured' })).toHaveAttribute('href', '?tab=stories&pr=7d&sort=views&from=90d');
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=stories&sort=views&from=90d');
  });

  it('nothing matches the filters: says so, the toolbar stays to undo them', () => {
    tab({ stories: [], items: 0, days: 0, state: { ...NEWEST, measured: false } });
    expect(screen.getByRole('status')).toHaveTextContent(en.pages.account.stories.emptyFiltered);
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toBeInTheDocument();
  });
});

describe('Stories tab: pages', () => {
  it('newest: day strips, pages count days (7 per page); the page links keep every filter and the scope', () => {
    tab({ items: 30, days: 20, page: 2, state: { ...NEWEST, measured: true, page: 2 } });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    const nav = screen.getByRole('navigation', { name: en.pagination.label });
    expect(nav).toHaveTextContent('Page 2 of 3');
    expect(within(nav).getByRole('link', { name: en.pagination.next })).toHaveAttribute('href', '?tab=stories&measured=yes&page=3&from=90d');
    expect(within(nav).getByRole('link', { name: en.pagination.first })).toHaveAttribute('href', '?tab=stories&measured=yes&from=90d');
  });

  it('other sorts: one flat list in the given order, each frame with its date; pages count Stories (48 per page)', () => {
    const byViews = [STORIES[0], STORIES[1], STORIES[2]];
    tab({ stories: byViews, items: 100, days: 3, state: { ...NEWEST, sort: 'views' } });
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    const list = screen.getByRole('list', { name: en.pages.account.stories.list });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(within(list).getAllByRole('listitem')[0]).getByText('15 Oct 2026 07:30')).toBeInTheDocument(); // date + time
    expect(screen.getByRole('navigation', { name: en.pagination.label })).toHaveTextContent('Page 1 of 3');
  });

  it('one page: no page navigation; Post Lab links carry no range', () => {
    tab();
    expect(screen.queryByRole('navigation', { name: en.pagination.label })).toBeNull();
    expect(screen.getAllByRole('link', { name: /^Open the Post Lab of/ })[0]).toHaveAttribute('href', `/accounts/${A}/media/s1`);
  });
});
