import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PostedFilter } from '@/components/account/PostedFilter';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PROGRESS_START_EVENT } from '@/components/shared/NavigationProgress';
import { ALL_TIME, listHref, type ListDates } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

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

const TODAY = '2026-10-17';
const HIDDEN = { tab: 'posts', q: 'cat', sort: 'reach', from: '90d' }; // the rest of the list + the Time Scope
const hrefFor = (d: ListDates) => listHref({ tab: 'posts', ...(d.pr ? { pr: d.pr } : {}), q: 'cat', sort: 'reach', from: '90d' });
function view(dates: ListDates, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <PostedFilter id="posted" dates={dates} today={TODAY} hrefFor={hrefFor} hidden={HIDDEN} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('PostedFilter', () => {
  it('All time: a quiet default-size button that names the window', () => {
    view(ALL_TIME);
    const button = screen.getByRole('button', { name: 'Posted: All time' });
    expect(button).toHaveAttribute('data-variant', 'outline');
    expect(button).toHaveAttribute('data-size', 'default');
  });

  it('a preset or custom days are named on the highlighted button (nothing hidden)', () => {
    const { unmount } = view({ pr: '30d', from: null, to: null });
    expect(screen.getByRole('button', { name: 'Posted: Last 30 days' })).toHaveAttribute('data-variant', 'secondary');
    unmount();
    view({ pr: null, from: '2026-10-01', to: '2026-10-15' });
    expect(screen.getByRole('button', { name: 'Posted: 1 Oct 2026 – 15 Oct 2026' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('the quick choices are links that keep the other filters and the scope; the current one is marked', async () => {
    const user = userEvent.setup();
    view({ pr: '7d', from: null, to: null });
    await user.click(screen.getByRole('button', { name: 'Posted: Last 7 days' }));
    const dialog = await screen.findByRole('dialog', { name: en.pages.account.lists.postedTitle });
    const links = within(within(dialog).getByRole('navigation', { name: en.pages.account.lists.quick })).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['Last 7 days', '?tab=posts&pr=7d&q=cat&sort=reach&from=90d', 'true'],
      ['Last 30 days', '?tab=posts&pr=30d&q=cat&sort=reach&from=90d', null],
      ['Last 90 days', '?tab=posts&pr=90d&q=cat&sort=reach&from=90d', null],
      ['This year', '?tab=posts&pr=year&q=cat&sort=reach&from=90d', null],
      ['All time', '?tab=posts&q=cat&sort=reach&from=90d', null],
    ]);
  });

  it('custom dates: a GET form with the other params hidden; submitting starts the top bar and closes the panel', async () => {
    const user = userEvent.setup();
    const started = vi.fn();
    window.addEventListener(PROGRESS_START_EVENT, started);
    try {
      view({ pr: null, from: '2026-10-01', to: '2026-10-15' });
      await user.click(screen.getByRole('button', { name: /^Posted:/ }));
      const form = within(await screen.findByRole('dialog')).getByRole('form', { name: en.pages.account.lists.custom }) as HTMLFormElement;
      expect(form.method).toBe('get');
      expect(Object.fromEntries([...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((i) => [i.name, i.value]))).toEqual(HIDDEN);
      expect(within(form).getByLabelText(en.pages.account.lists.from)).toHaveValue('2026-10-01');
      expect(within(form).getByLabelText(en.pages.account.lists.to)).toHaveValue('2026-10-15');
      expect(within(form).getByLabelText(en.pages.account.lists.to)).toHaveAttribute('max', TODAY);
      fireEvent.submit(form);
      expect(started).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    } finally {
      window.removeEventListener(PROGRESS_START_EVENT, started);
    }
  });

  it('zh-CN', () => {
    view({ pr: 'year', from: null, to: null }, 'zh-CN');
    expect(screen.getByRole('button', { name: '发布时间：今年' })).toBeInTheDocument();
  });
});
