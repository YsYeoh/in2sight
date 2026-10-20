import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { FilterOptions, FilterPanel, FilterSearch, FilterSelect, FilterToolbar, SEARCH_DEBOUNCE_MS } from '@/components/shared/FilterToolbar';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) }); // lets Testing Library drive vitest fake timers
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
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

const intl = (ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') => (
  <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
    {ui}
  </NextIntlClientProvider>
);
const wrap = (ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') => render(intl(ui, locale));
const FORMATS = [
  { value: '', label: 'All formats' },
  { value: 'REELS', label: 'Reels' },
];
const searchBox = (value: string) => <FilterSearch id="q" label="Search captions" value={value} hrefFor={(q) => (q ? `?q=${encodeURIComponent(q)}` : '?')} />;

describe('FilterToolbar', () => {
  it('a labelled row of equal-height controls; Advanced with a count badge; removable chips and Clear all', () => {
    wrap(
      <FilterToolbar
        label="Post filters"
        advanced={<p>more</p>}
        advancedCount={2}
        chips={[
          { id: 'format', label: 'Reels', href: '?tab=posts' },
          { id: 'tag', label: 'Launch', href: '?tab=posts&format=REELS' },
        ]}
        clearHref="?tab=posts"
        end={<a href="?">Reset</a>}
      >
        <FilterSelect id="f-format" label="Format" value="" options={FORMATS} hrefFor={(v) => `?format=${v}`} />
        <FilterPanel label="Tags" title="Pick tags">
          <p>tags</p>
        </FilterPanel>
      </FilterToolbar>,
    );
    const bar = screen.getByRole('group', { name: 'Post filters' });
    const adv = within(bar).getByRole('button', { name: 'Advanced, 2 active' });
    expect(adv).toHaveAttribute('data-variant', 'secondary');
    expect(within(adv).getByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(new Set(within(bar).getAllByRole('button').map((b) => b.getAttribute('data-size')))).toEqual(new Set(['default']));
    expect(within(bar).getByRole('combobox', { name: 'Format' })).toHaveClass('h-[var(--ctl)]');
    const chips = within(bar).getByRole('list', { name: en.filters.active });
    expect(within(chips).getByRole('link', { name: 'Remove filter Reels' })).toHaveAttribute('href', '?tab=posts');
    expect(within(chips).getByRole('link', { name: 'Remove filter Launch' })).toHaveAttribute('href', '?tab=posts&format=REELS');
    expect(within(bar).getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=posts');
    expect(within(bar).getByRole('link', { name: 'Reset' })).toBeInTheDocument();
  });

  it('no chips: no list and no Clear all; a quiet Advanced has no badge; no `advanced`: no Advanced button', () => {
    const { unmount } = wrap(
      <FilterToolbar label="F" advanced={<p>x</p>} clearHref="?">
        <span />
      </FilterToolbar>,
    );
    expect(screen.getByRole('button', { name: en.filters.advanced })).toHaveAttribute('data-variant', 'outline');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('link', { name: en.filters.clearAll })).toBeNull();
    unmount();
    wrap(
      <FilterToolbar label="F">
        <span />
      </FilterToolbar>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('zh-CN: the count reads in Chinese', () => {
    wrap(
      <FilterToolbar label="F" advanced={<p>x</p>} advancedCount={1}>
        <span />
      </FilterToolbar>,
      'zh-CN',
    );
    expect(screen.getByRole('button', { name: '高级，已启用 1 项' })).toBeInTheDocument();
  });
});

describe('FilterPanel and FilterOptions', () => {
  it('opens a dialog titled by the panel (a bottom sheet on phones); Done closes it and focus returns to the button', async () => {
    const user = userEvent.setup();
    wrap(
      <FilterPanel label="2 metrics" title="Metrics">
        <input type="checkbox" aria-label="Reach" />
      </FilterPanel>,
    );
    const trigger = screen.getByRole('button', { name: '2 metrics' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('data-size', 'default');
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Metrics' });
    expect(within(dialog).getByRole('checkbox', { name: 'Reach' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.filters.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('options are links; the current one is marked and highlighted', async () => {
    const user = userEvent.setup();
    wrap(
      <FilterPanel label="Posted" title="Posted">
        <FilterOptions
          label="Quick dates"
          options={[
            { href: '?pr=7d', label: 'Last 7 days' },
            { href: '?', label: 'All time', current: true },
          ]}
        />
      </FilterPanel>,
    );
    await user.click(screen.getByRole('button', { name: 'Posted' }));
    const nav = within(await screen.findByRole('dialog', { name: 'Posted' })).getByRole('navigation', { name: 'Quick dates' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['Last 7 days', '?pr=7d', null],
      ['All time', '?', 'true'],
    ]);
    expect(links[1]).toHaveAttribute('data-variant', 'secondary');
  });
});

describe('FilterSelect', () => {
  it('applies the picked value at once (no scroll jump); the value follows the URL and focus stays', async () => {
    const user = userEvent.setup();
    const select = (value: string) => <FilterSelect id="s" label="Format" value={value} options={FORMATS} hrefFor={(v) => (v ? `?format=${v}` : '?')} />;
    const { rerender } = wrap(select(''));
    const el = screen.getByRole('combobox', { name: 'Format' });
    el.focus();
    await user.selectOptions(el, 'REELS');
    expect(push).toHaveBeenCalledWith('?format=REELS', { scroll: false });
    rerender(intl(select('REELS'))); // the navigation commits
    const after = screen.getByRole('combobox', { name: 'Format' });
    expect(after).toBe(el);
    expect(after).toHaveValue('REELS');
    expect(document.activeElement).toBe(after);
  });
});

describe('FilterSearch', () => {
  it('text applies after a pause with replace (typing adds no history entries); Enter applies at once and cancels the pause', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      wrap(searchBox(''));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, 'cat');
      expect(replace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('?q=cat', { scroll: false });
      await user.type(box, 's{Enter}');
      expect(replace).toHaveBeenLastCalledWith('?q=cats', { scroll: false });
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows the URL when a chip or Clear all changes it, but not while its own text is arriving', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = wrap(searchBox(''));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, 'cat');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      await user.type(box, 's'); // "cats" typed, not applied yet
      rerender(intl(searchBox('cat'))); // the URL catches up with "cat"
      expect(box).toHaveValue('cats');
      rerender(intl(searchBox(''))); // a chip or Clear all removed the search
      expect(box).toHaveValue('');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(1); // the pending "cats" was dropped
    } finally {
      vi.useRealTimers();
    }
  });

  it('blank or unchanged text never navigates', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      wrap(searchBox('cat'));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, ' ');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      await user.type(box, '{Enter}');
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
