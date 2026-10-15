import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PostsTab, POSTS_PAGE } from '@/components/account/PostsTab';
import type { SetPostTags } from '@/components/account/TagPicker';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Tag } from '@/lib/analysis/types';
import type { PostFilters, PostView } from '@/lib/dashboard/content';
import { DEFAULT_PREFS } from '@/lib/prefs';

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

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TAGS: Tag[] = [{ id: T1, name: '🔥 Promo', color: 'chart-2' }];
const NONE: PostFilters = { format: null, tag: null, from: null, to: null };
const post = (i: number, o: Partial<PostView> = {}): PostView => ({ id: `m${i}`, mediaType: 'IMAGE', postedAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), permalink: `https://www.instagram.com/p/m${i}/`, caption: `Caption ${i}`, reach: 100 + i, views: null, likes: i, comments: null, saves: null, shares: null, engagementRate: 0.01, tags: [], ...o });

function view(posts: PostView[], o: { tags?: Tag[]; filters?: PostFilters; setPostTags?: SetPostTags } = {}) {
  const setPostTags = o.setPostTags ?? vi.fn<SetPostTags>(async () => ({ ok: true }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <PostsTab posts={posts} total={posts.length} tags={o.tags ?? TAGS} filters={o.filters ?? NONE} setPostTags={setPostTags} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return { setPostTags };
}

describe('PostsTab', () => {
  it('500 posts render 50 rows then show more (sorted newest first)', async () => {
    const user = userEvent.setup();
    view(Array.from({ length: 500 }, (_, i) => post(i)));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(POSTS_PAGE + 1); // + header row
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Caption 499');
    expect(screen.getByText('Showing 500 of 500 posts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.table.showMore }));
    expect(within(table).getAllByRole('row')).toHaveLength(2 * POSTS_PAGE + 1);
  });

  it('null caption and permalink: placeholder text, no external link; a permalink opens with noopener', () => {
    view([post(1, { caption: null, permalink: null }), post(2)]);
    const table = screen.getByRole('table');
    expect(within(table).getByText(en.pages.account.posts.noCaption)).toBeInTheDocument();
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(links[0]).toHaveAttribute('href', 'https://www.instagram.com/p/m2/');
  });

  it('filters are a GET form that keeps the tab and shows the current values', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <PostsTab posts={[]} total={3} tags={TAGS} filters={{ format: 'REELS', tag: T1, from: '2026-10-01', to: null }} setPostTags={vi.fn()} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const form = container.querySelector('form')!;
    expect(form.method).toBe('get'); // next/form: a GET form without a method attribute
    expect(form.querySelector('input[name="tab"]')).toHaveValue('posts');
    expect(screen.getByLabelText(en.pages.account.posts.format)).toHaveValue('REELS');
    expect(screen.getByLabelText(en.pages.account.posts.tag)).toHaveValue(T1);
    expect(screen.getByLabelText(en.pages.account.posts.from)).toHaveValue('2026-10-01');
    expect(screen.getByRole('link', { name: en.pages.account.posts.reset })).toHaveAttribute('href', '?tab=posts');
    expect(screen.getAllByText(en.pages.account.posts.empty).length).toBeGreaterThan(0);
  });

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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('no tags yet: the picker links to the Tags page', async () => {
    const user = userEvent.setup();
    view([post(1)], { tags: [] });
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /Edit tags of/ }));
    expect(screen.getByRole('link', { name: en.pages.account.posts.manageTags })).toHaveAttribute('href', '/tags');
  });
});
