import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { Pagination } from '@/components/shared/Pagination';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const hrefFor = (p: number) => `?tab=posts&q=cat${p > 1 ? `&page=${p}` : ''}&from=90d`;
function view(page: number, pages: number, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Pagination', () => {
  it('a named nav: first / previous / "Page X of Y" / next / last, links keep every other parameter', () => {
    view(3, 12);
    const nav = screen.getByRole('navigation', { name: en.pagination.label });
    expect(within(nav).getAllByRole('link').map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual([
      [en.pagination.first, '?tab=posts&q=cat&from=90d'],
      [en.pagination.previous, '?tab=posts&q=cat&page=2&from=90d'],
      [en.pagination.next, '?tab=posts&q=cat&page=4&from=90d'],
      [en.pagination.last, '?tab=posts&q=cat&page=12&from=90d'],
    ]);
    expect(nav).toHaveTextContent('Page 3 of 12');
    for (const a of within(nav).getAllByRole('link')) expect(a).toHaveAttribute('data-size', 'icon'); // --ctl high, like every control in the row
  });

  it('at the edges the buttons are disabled, not links', () => {
    const { unmount } = view(1, 4);
    expect(screen.getByRole('button', { name: en.pagination.first })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.pagination.previous })).toBeDisabled();
    expect(screen.getByRole('link', { name: en.pagination.last })).toHaveAttribute('href', '?tab=posts&q=cat&page=4&from=90d');
    unmount();
    view(4, 4);
    expect(screen.getByRole('button', { name: en.pagination.next })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.pagination.last })).toBeDisabled();
  });

  it('one page: nothing at all', () => {
    const { container } = view(1, 1);
    expect(container).toBeEmptyDOMElement();
  });

  it('big numbers go through the format settings; zh-CN reads in Chinese', () => {
    view(1200, 3400, 'zh-CN');
    expect(screen.getByRole('navigation', { name: zh.pagination.label })).toHaveTextContent('第 1,200 页，共 3,400 页');
  });
});
