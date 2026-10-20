import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PostsTab } from '@/components/account/PostsTab';
import type { SetPostTags } from '@/components/account/TagPicker';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Tag } from '@/lib/analysis/types';
import type { PostsView, PostView } from '@/lib/dashboard/content';
import { ALL_TIME, type PostListState } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) })); // the toolbar's selects navigate

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); // Radix Checkbox measures itself
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TAGS: Tag[] = [{ id: T1, name: 'Promo', color: 'chart-2' }];
const NEWEST: PostListState = { dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null };
// a Reel published 7 Oct 2026, 20:00 in Kuala Lumpur (12:00 UTC), with a stored cover
const reel: PostView = { id: '42', mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: 'https://www.instagram.com/reel/42/', caption: 'Behind the scenes', reach: 1200, views: 3400, likes: 40, comments: 5, saves: 3, shares: 2, engagementRate: 0.0417, cover: 'ok', slides: null, tags: [] };
const LABEL = 'Reel · 7 Oct 2026 20:00';

function tab(o: { view?: PostsView | null; state?: Partial<PostListState>; accountId?: string; setPostTags?: SetPostTags; posts?: PostView[] } = {}) {
  const setPostTags = o.setPostTags ?? vi.fn<SetPostTags>(async () => ({ ok: true }));
  const r = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur' }} persist={vi.fn()}>
        <PostsTab posts={o.posts ?? [reel]} total={1} page={1} state={{ ...NEWEST, ...o.state, view: o.view ?? null }} tags={TAGS} today="2026-10-17" scope={{ from: '90d', cmp: 'yoy' }} accountId={o.accountId} setPostTags={setPostTags} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return { ...r, setPostTags };
}

describe('Posts tab: Grid | Table', () => {
  it('grid: cover tiles with date and key numbers, no table; the cover is the owner-only route', () => {
    tab({ view: 'grid' });
    expect(screen.queryByRole('table')).toBeNull();
    const grid = screen.getByRole('list', { name: en.pages.account.posts.caption });
    const tile = within(grid).getByRole('listitem');
    expect(within(tile).getByRole('button', { name: `Details of ${LABEL}` })).toBeInTheDocument();
    expect(within(tile).getByRole('img', { name: 'Behind the scenes' })).toHaveAttribute('src', '/api/media/42/cover');
    expect(within(tile).getByText('7 Oct 2026 20:00')).toBeInTheDocument();
    expect(within(tile).getByText('1.2K')).toBeInTheDocument();
    expect(within(tile).getByText('4.2%')).toBeInTheDocument();
  });

  it('table: the table with a small square cover button per row (also on the phone cards); no tiles', () => {
    tab({ view: 'table' });
    expect(within(screen.getByRole('table')).getByRole('button', { name: `Details of ${LABEL}` })).toBeInTheDocument();
    const thumbs = [...document.querySelectorAll('[data-slot="media-thumb"]')];
    expect(thumbs).toHaveLength(2); // the table row + the phone card (CSS shows one of them)
    for (const th of thumbs) expect(th).toHaveClass('aspect-square', 'w-9');
  });

  it('the toggle is two links that keep the tab, the filters and the Time Scope; the current view is marked', () => {
    tab({ view: 'grid', state: { format: 'REELS', tag: T1 } });
    const group = screen.getByRole('group', { name: en.pages.account.posts.view });
    const grid = within(group).getByRole('link', { name: en.pages.account.posts.grid });
    const table = within(group).getByRole('link', { name: en.pages.account.posts.table });
    expect(grid).toHaveAttribute('aria-current', 'true');
    expect(table).not.toHaveAttribute('aria-current');
    expect(table).toHaveAttribute('href', `?tab=posts&format=REELS&tag=${T1}&view=table&from=90d&cmp=yoy`);
  });

  it('automatic (no ?view): one toggle per width, grid below md, table from md (CSS only)', () => {
    tab();
    const [phone, wide] = screen.getAllByRole('group', { name: en.pages.account.posts.view });
    expect(phone).toHaveClass('md:hidden');
    expect(within(phone).getByRole('link', { name: en.pages.account.posts.grid })).toHaveAttribute('aria-current', 'true');
    expect(wide).toHaveClass('max-md:hidden');
    expect(within(wide).getByRole('link', { name: en.pages.account.posts.table })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: en.pages.account.posts.caption }).parentElement).toHaveClass('md:hidden');
  });

  it('a chosen view is kept by every list link (here a chip and Clear all)', () => {
    tab({ view: 'grid', state: { format: 'REELS' } });
    expect(screen.getByRole('link', { name: 'Remove filter Reel' })).toHaveAttribute('href', '?tab=posts&view=grid&from=90d&cmp=yoy');
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=posts&view=grid&from=90d&cmp=yoy');
  });

  it('with an account, the tile date drills into the Explorer item level (no range: ux-polish §8 call 1)', () => {
    tab({ view: 'grid', accountId: A });
    expect(screen.getByRole('link', { name: '7 Oct 2026 20:00' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=REELS&item=42`);
  });
});

describe('Posts tab: detail drawer', () => {
  it('a tile opens the drawer (title, caption, numbers, Instagram link); Esc returns focus to the tile', async () => {
    const user = userEvent.setup();
    tab({ view: 'grid' });
    const trigger = screen.getByRole('button', { name: `Details of ${LABEL}` });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: LABEL });
    expect(dialog).toHaveAccessibleDescription('Behind the scenes');
    expect(within(dialog).getByText(en.metrics.views).nextSibling).toHaveTextContent('3.4K');
    expect(within(dialog).getByRole('link', { name: en.media.open })).toHaveAttribute('href', 'https://www.instagram.com/reel/42/');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('tags are assignable from the drawer (grid view has no Tags column)', async () => {
    const user = userEvent.setup();
    const { setPostTags } = tab({ view: 'grid' });
    await user.click(screen.getByRole('button', { name: `Details of ${LABEL}` }));
    const dialog = await screen.findByRole('dialog', { name: LABEL });
    await user.click(within(dialog).getByRole('button', { name: `Edit tags of ${LABEL}` }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: en.pages.account.posts.save }));
    expect(setPostTags).toHaveBeenCalledWith('42', [T1]);
  });

  it('a post without a stored cover shows the format placeholder, never an image request', () => {
    tab({ view: 'grid', posts: [{ ...reel, cover: 'unavailable', caption: null }] });
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: `Details of ${LABEL}` })).toBeInTheDocument();
  });
});
