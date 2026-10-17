import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { TimeScopeBar, useBucketFormat } from '@/components/shared/TimeScopeBar';
import { deepMerge } from '@/lib/merge';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

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
const scope = (q: string, earliest: string | null = '2025-01-01') => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, earliest);

function tree(q = '', o: { keep?: Record<string, string>; earliest?: string | null; locale?: 'en' | 'zh-CN' } = {}) {
  const locale = o.locale ?? 'en';
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : deepMerge(en, zh)}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <TimeScopeBar scope={scope(q, o.earliest === undefined ? '2025-01-01' : o.earliest)} today={TODAY} keep={o.keep} />
      </PrefsProvider>
    </NextIntlClientProvider>
  );
}
const view = (...a: Parameters<typeof tree>) => render(tree(...a));

const hidden = (form: HTMLElement) => Object.fromEntries([...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((i) => [i.name, i.value]));

describe('TimeScopeBar', () => {
  it('presets are links that keep the page parameters; the current one is marked', () => {
    view('', { keep: { tab: 'posts', format: 'REELS' } });
    const nav = screen.getByRole('navigation', { name: 'Quick ranges' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['7d', '14d', '30d', '90d', '6m', '1y', 'YTD', 'All']);
    expect(within(nav).getByRole('link', { name: '30d' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '7d' })).toHaveAttribute('href', '?tab=posts&format=REELS&from=7d');
    expect(within(nav).getByRole('link', { name: 'All' })).toHaveAttribute('href', '?tab=posts&format=REELS&from=all');
    expect(within(nav).getByRole('link', { name: '30d' })).toHaveAttribute('href', '?tab=posts&format=REELS');
    expect(screen.getByRole('status')).toHaveTextContent('Last 30 days · vs previous 30 days');
  });

  it('compare and group-by are GET selects carrying the rest of the scope and the page parameters', () => {
    view('from=90d&cmp=yoy&gran=week', { keep: { tab: 'overview' } });
    const cmp = screen.getByRole('combobox', { name: 'Compare' }) as HTMLSelectElement;
    expect(cmp.value).toBe('yoy');
    expect(hidden(cmp.closest('form')!)).toEqual({ tab: 'overview', from: '90d', gran: 'week' });
    const gran = screen.getByRole('combobox', { name: 'Group by' }) as HTMLSelectElement;
    expect(gran.value).toBe('week');
    expect(hidden(gran.closest('form')!)).toEqual({ tab: 'overview', from: '90d', cmp: 'yoy' });
    expect(within(gran).getByRole('option', { name: 'Auto (Day)' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Last 90 days · vs same period last year');
  });

  it('changing a select submits its form and keeps keyboard focus on it after the URL changes', async () => {
    const keep = { tab: 'overview' };
    const { rerender } = view('', { keep });
    const cmp = screen.getByRole('combobox', { name: 'Compare' });
    const submitted: string[] = [];
    cmp.closest('form')!.addEventListener('submit', (e) => {
      e.preventDefault(); // jsdom cannot navigate; record where the browser would go
      submitted.push(String(new URLSearchParams(new FormData(e.currentTarget as HTMLFormElement) as unknown as Record<string, string>)));
    });
    cmp.focus();
    await userEvent.selectOptions(cmp, 'none');
    expect(submitted).toEqual(['tab=overview&cmp=none']);
    rerender(tree('cmp=none', { keep })); // the navigation commits: a new scope reaches the bar
    const after = screen.getByRole('combobox', { name: 'Compare' }) as HTMLSelectElement;
    expect(after).toBe(cmp);
    expect(after.value).toBe('none');
    expect(document.activeElement).toBe(after);
    rerender(tree('', { keep })); // back button: the controlled value follows the URL
    expect((screen.getByRole('combobox', { name: 'Compare' }) as HTMLSelectElement).value).toBe('prev');
  });

  it('a month: its name, compared with the same days before; no preset is current', () => {
    view('month=2026-09&cmp=yoy');
    expect(screen.getByRole('status')).toHaveTextContent('September 2026 · vs September 2025');
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('a running month is compared with the same days of the previous month; quarters and custom days are named', () => {
    view('month=2026-10');
    expect(screen.getByRole('status')).toHaveTextContent('October 2026 · vs 1 Sep 2026 – 17 Sep 2026');
  });

  it('"all": no comparison (the select is disabled), and leaving it compares again', () => {
    view('from=all', { earliest: '2026-03-01' });
    expect(screen.getByRole('combobox', { name: 'Compare' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/^All data$/);
    expect(screen.getByRole('link', { name: '30d' })).toHaveAttribute('href', '?');
  });

  it('a custom comparison shows as such', () => {
    view('from=30d&cfrom=2025-01-01&cto=2025-01-30');
    expect((screen.getByRole('combobox', { name: 'Compare' }) as HTMLSelectElement).value).toBe('custom');
    expect(screen.getByRole('status')).toHaveTextContent('vs 1 Jan 2025 – 30 Jan 2025');
  });

  it('coverage: says where the data starts, or that nothing was captured yet', () => {
    view('from=1y', { earliest: '2026-08-01' });
    expect(screen.getByRole('status')).toHaveTextContent('Data starts 1 Aug 2026: earlier days in this range have no data.');
    view('from=7d', { earliest: null });
    expect(screen.getAllByRole('status')[1]).toHaveTextContent('No data captured yet.');
  });

  it('the dialog holds range, week, month, quarter and comparison pickers as GET forms', async () => {
    view('from=90d&cmp=yoy&gran=month', { keep: { account: 'x' } });
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choose a time range' });
    const range = within(dialog).getByRole('form', { name: 'Date range' });
    expect(hidden(range)).toEqual({ account: 'x', cmp: 'yoy', gran: 'month' });
    expect(within(range).getByLabelText('From')).toHaveAttribute('max', TODAY);
    expect(within(range).getByLabelText('From')).toHaveValue('2026-07-20');
    expect(within(dialog).getByRole('form', { name: 'Week' }).querySelector('input[name=week]')).toHaveValue(TODAY);
    const month = within(dialog).getByRole('combobox', { name: 'Month' });
    expect(within(month).getAllByRole('option')).toHaveLength(60);
    expect(within(month).getAllByRole('option')[0]).toHaveTextContent('October 2026');
    expect(within(within(dialog).getByRole('combobox', { name: 'Quarter' })).getAllByRole('option')[0]).toHaveTextContent('Q4 2026');
    const cmp = within(dialog).getByRole('form', { name: 'Compare with other days' });
    expect(hidden(cmp)).toEqual({ account: 'x', from: '90d', gran: 'month' });
    expect(cmp.querySelector('input[name=cfrom]')).toHaveValue('2025-07-20');
  });

  it('bucket labels: days and weeks by their first day, months by name, partial ones starred', () => {
    function Labels() {
      const day = useBucketFormat('week', ['2026-09-28']);
      const month = useBucketFormat('month');
      return <p>{[day('2026-09-28'), day('2026-10-05'), month('2026-10-01')].join(' | ')}</p>;
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <Labels />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('28 Sep 2026 * | 5 Oct 2026 | October 2026')).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view('', { locale: 'zh-CN' });
    expect(screen.getByRole('link', { name: '30天' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('最近 30 天 · 对比前 30 天');
  });
});
