import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { TagsView, type TagsViewProps } from '@/components/tags/TagsView';
import type { Tag } from '@/lib/analysis/types';
import { buildTagStats } from '@/lib/dashboard/content';
import type { PostRow } from '@/lib/dashboard/detail-read';
import { DEFAULT_PREFS } from '@/lib/prefs';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const LONG = 'A really long tag name that is forty ch'; // 39 characters
const TAGS: Tag[] = [
  { id: T1, name: 'عروض', color: 'chart-2' },
  { id: T2, name: LONG, color: 'chart-3' },
];
const row = (id: string, tagIds: string[], reach = 100): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-01T00:00:00Z', permalink: null, reach, views: null, likes: 5, comments: null, shares: null, saves: null, caption: null, tagIds });
const POSTS = [...Array.from({ length: 5 }, (_, i) => row(`p${i}`, [T1], 300)), row('x', [T2]), row('u', [])];
const ok = async () => ({ ok: true as const });

function view(o: Partial<TagsViewProps> = {}) {
  const props: TagsViewProps = { tags: TAGS, stats: buildTagStats(POSTS, TAGS), create: vi.fn(ok), rename: vi.fn(ok), remove: vi.fn(ok), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <TagsView {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

describe('TagsView', () => {
  it('per-tag performance with the untagged bucket and the few-posts note', () => {
    view();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('عروض'), expect.stringContaining(LONG), expect.stringContaining(en.pages.tags.untagged)]);
    expect(rows[0]).not.toHaveTextContent(en.analysis.reasons.few_posts);
    expect(rows[1]).toHaveTextContent(en.analysis.reasons.few_posts);
  });

  it('create: sends the raw text (the server normalises), clears on success, shows the translated error key', async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValueOnce({ ok: false, error: 'duplicate' }).mockResolvedValueOnce({ ok: true });
    view({ create });
    const input = screen.getByLabelText(en.pages.tags.newTag);
    await user.type(input, 'PROMO');
    await user.click(screen.getByRole('button', { name: en.pages.tags.add }));
    expect(create).toHaveBeenCalledWith('PROMO');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.pages.tags.errors.duplicate);
    await user.click(screen.getByRole('button', { name: en.pages.tags.add }));
    expect(input).toHaveValue('');
  });

  it('the add button stays disabled for a blank name; 40 emoji are not cut by maxLength', () => {
    view();
    expect(screen.getByRole('button', { name: en.pages.tags.add })).toBeDisabled();
    const input = screen.getByLabelText(en.pages.tags.newTag);
    expect(input).not.toHaveAttribute('maxlength');
  });

  it('rename and delete call their actions with the tag id', async () => {
    const user = userEvent.setup();
    const props = view();
    const table = screen.getByRole('table');
    await user.click(within(table).getByRole('button', { name: `Rename ${LONG}` }));
    const field = screen.getByLabelText(en.pages.tags.name);
    await user.clear(field);
    await user.type(field, 'Shorter');
    await user.click(screen.getByRole('button', { name: en.pages.tags.save }));
    expect(props.rename).toHaveBeenCalledWith(T2, 'Shorter');
    await user.click(within(table).getByRole('button', { name: 'Delete عروض' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: en.pages.tags.delete }));
    expect(props.remove).toHaveBeenCalledWith(T1);
  });

  it('no tags yet: empty state, the create form and the untagged row', () => {
    view({ tags: [], stats: buildTagStats([row('u', [])], []) });
    expect(screen.getByRole('status')).toHaveTextContent(en.pages.tags.empty);
    expect(screen.getByLabelText(en.pages.tags.newTag)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  });
});
