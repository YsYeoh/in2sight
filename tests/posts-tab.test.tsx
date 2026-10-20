import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PostsTab } from '@/components/account/PostsTab';
import type { SetPostTags } from '@/components/account/TagPicker';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Tag } from '@/lib/analysis/types';
import type { PostView } from '@/lib/dashboard/content';
import { ALL_TIME, type PostListState } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); // Radix Checkbox measures itself
  push.mockReset();
  replace.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TAGS: Tag[] = [{ id: T1, name: '🔥 Promo', color: 'chart-2' }];
const NEWEST: PostListState = { dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null };
const SCOPE = { from: '90d', cmp: 'yoy' }; // the page's Time Scope: carried in every list link, never a filter
const post = (i: number, o: Partial<PostView> = {}): PostView => ({ id: `m${i}`, mediaType: 'IMAGE', postedAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), permalink: `https://www.instagram.com/p/m${i}/`, caption: `Caption ${i}`, reach: 100 + i, views: null, likes: i, comments: null, saves: null, shares: null, engagementRate: 0.01, tags: [], ...o });

function view(posts: PostView[], o: { tags?: Tag[]; state?: PostListState; total?: number; page?: number; setPostTags?: SetPostTags } = {}) {
  const setPostTags = o.setPostTags ?? vi.fn<SetPostTags>(async () => ({ ok: true }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <PostsTab posts={posts} total={o.total ?? posts.length} page={o.page ?? 1} state={o.state ?? NEWEST} tags={o.tags ?? TAGS} today="2026-10-17" scope={SCOPE} setPostTags={setPostTags} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return { setPostTags };
}

describe('PostsTab: server pages', () => {
  it('shows the rows as given (one page), "51–100 of 1,234 posts", and page links that keep the filters and the scope; no "Show more"', () => {
    view(Array.from({ length: 50 }, (_, i) => post(i)), { total: 1234, page: 2, state: { ...NEWEST, format: 'IMAGE', page: 2 } });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(51); // + header row
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Caption 0'); // the server's order, not re-sorted
    expect(screen.getByText('51–100 of 1,234 posts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.table.showMore })).toBeNull();
    const nav = screen.getByRole('navigation', { name: en.pagination.label });
    expect(nav).toHaveTextContent('Page 2 of 25');
    expect(within(nav).getByRole('link', { name: en.pagination.next })).toHaveAttribute('href', '?tab=posts&format=IMAGE&page=3&from=90d&cmp=yoy');
    expect(within(nav).getByRole('link', { name: en.pagination.previous })).toHaveAttribute('href', '?tab=posts&format=IMAGE&from=90d&cmp=yoy');
  });

  it('table headers Post, Reach, Views and Engagement rate use the server sort; the active one toggles direction; Likes is not sortable', () => {
    view([post(1)], { state: { ...NEWEST, sort: 'reach' } });
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader');
    const link = (name: string) => within(screen.getByRole('table')).getByRole('link', { name });
    expect(link(en.pages.account.posts.post)).toHaveAttribute('href', '?tab=posts&from=90d&cmp=yoy'); // newest = the default
    expect(link(en.metrics.reach)).toHaveAttribute('href', '?tab=posts&sort=reach_asc&from=90d&cmp=yoy');
    expect(link(en.metrics.views)).toHaveAttribute('href', '?tab=posts&sort=views&from=90d&cmp=yoy');
    expect(link(en.metrics.engagementRate)).toHaveAttribute('href', '?tab=posts&sort=engagement&from=90d&cmp=yoy');
    expect(heads.find((h) => h.textContent === en.metrics.reach)).toHaveAttribute('aria-sort', 'descending');
    expect(within(heads.find((h) => h.textContent === en.pages.account.posts.likes)!).queryByRole('link')).toBeNull();
  });

  it('null caption and permalink: placeholder text, no external link; a permalink opens with noopener', () => {
    view([post(1, { caption: null, permalink: null }), post(2)]);
    const table = screen.getByRole('table');
    expect(within(table).getByText(en.pages.account.posts.noCaption)).toBeInTheDocument();
    const external = within(table).getAllByRole('link').filter((a) => a.getAttribute('target') === '_blank');
    expect(external).toHaveLength(1);
    expect(external[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(external[0]).toHaveAttribute('href', 'https://www.instagram.com/p/m2/');
  });
});

describe('PostsTab: filters', () => {
  it('a toolbar: search, Posted, Format, Tag, Sort (one control height) and Grid | Table; the current values are shown', () => {
    view([], { state: { ...NEWEST, q: 'cat', format: 'REELS', tag: T1, sort: 'engagement' } });
    const bar = screen.getByRole('group', { name: en.pages.account.posts.filters });
    expect(within(bar).getByRole('searchbox', { name: en.pages.account.posts.search })).toHaveValue('cat');
    expect(within(bar).getByRole('button', { name: 'Posted: All time' })).toHaveAttribute('data-size', 'default');
    expect(within(bar).getByRole('combobox', { name: en.pages.account.posts.format })).toHaveValue('REELS');
    expect(within(bar).getByRole('combobox', { name: en.pages.account.posts.tag })).toHaveValue(T1);
    expect(within(bar).getByRole('combobox', { name: en.pages.account.posts.sort })).toHaveValue('engagement');
    for (const s of within(bar).getAllByRole('combobox')) expect(s).toHaveClass('h-[var(--ctl)]');
    expect(within(bar).getAllByRole('group', { name: en.pages.account.posts.view })[0]).toHaveClass('h-[var(--ctl)]');
    expect(screen.getAllByText(en.pages.account.posts.empty).length).toBeGreaterThan(0);
  });

  it('every pick applies at once and goes back to page 1, keeping the other filters, the view and the scope', async () => {
    const user = userEvent.setup();
    view([post(1)], { page: 3, state: { ...NEWEST, q: 'cat', view: 'grid', page: 3 } });
    await user.selectOptions(screen.getByRole('combobox', { name: en.pages.account.posts.format }), 'REELS');
    expect(push).toHaveBeenLastCalledWith('?tab=posts&q=cat&format=REELS&view=grid&from=90d&cmp=yoy', { scroll: false });
    await user.selectOptions(screen.getByRole('combobox', { name: en.pages.account.posts.tag }), 'untagged');
    expect(push).toHaveBeenLastCalledWith('?tab=posts&q=cat&tag=untagged&view=grid&from=90d&cmp=yoy', { scroll: false });
    await user.selectOptions(screen.getByRole('combobox', { name: en.pages.account.posts.sort }), 'views_asc');
    expect(push).toHaveBeenLastCalledWith('?tab=posts&q=cat&sort=views_asc&view=grid&from=90d&cmp=yoy', { scroll: false });
    await user.type(screen.getByRole('searchbox', { name: en.pages.account.posts.search }), 's{Enter}');
    expect(replace).toHaveBeenLastCalledWith('?tab=posts&q=cats&view=grid&from=90d&cmp=yoy', { scroll: false }); // typing adds no history entries
  });

  it('active filters are chips that remove one each; Clear all keeps the sort, the view and the scope', () => {
    view([post(1)], { state: { dates: { pr: '90d', from: null, to: null }, q: 'cat', format: 'REELS', tag: T1, sort: 'reach', page: 2, view: 'table' } });
    const chips = screen.getByRole('list', { name: en.filters.active });
    const rest = `sort=reach&view=table&from=90d&cmp=yoy`;
    expect(within(chips).getAllByRole('link').map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual([
      ['Remove filter Search: cat', `?tab=posts&pr=90d&format=REELS&tag=${T1}&${rest}`],
      ['Remove filter Last 90 days', `?tab=posts&q=cat&format=REELS&tag=${T1}&${rest}`],
      ['Remove filter Reel', `?tab=posts&pr=90d&q=cat&tag=${T1}&${rest}`],
      ['Remove filter 🔥 Promo', `?tab=posts&pr=90d&q=cat&format=REELS&${rest}`],
    ]);
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', `?tab=posts&${rest}`);
  });
});

describe('PostsTab: tags', () => {
  it('tag picker: saves the chosen tags through the server action; an error key is translated', async () => {
    const user = userEvent.setup();
    const setPostTags = vi.fn<SetPostTags>().mockResolvedValueOnce({ ok: false, error: 'not_found' }).mockResolvedValueOnce({ ok: true });
    view([post(1)], { setPostTags });
    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: /Edit tags of/ }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: en.pages.account.posts.save }));
    expect(setPostTags).toHaveBeenCalledWith('m1', [T1]);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.pages.tags.errors.not_found);
    await user.click(screen.getByRole('button', { name: en.pages.account.posts.save }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // the save transition closes it
  });

  it('no tags yet: the picker links to the Tags page', async () => {
    const user = userEvent.setup();
    view([post(1)], { tags: [] });
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /Edit tags of/ }));
    expect(screen.getByRole('link', { name: en.pages.account.posts.manageTags })).toHaveAttribute('href', '/tags');
  });
});
