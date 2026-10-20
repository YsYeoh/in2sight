import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { RangeBar, useBucketFormat } from '@/components/shared/RangeBar';
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

function view(q = '', o: { keep?: Record<string, string>; earliest?: string | null; locale?: 'en' | 'zh-CN' } = {}) {
  const locale = o.locale ?? 'en';
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : deepMerge(en, zh)}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <RangeBar scope={scope(q, o.earliest === undefined ? '2025-01-01' : o.earliest)} today={TODAY} keep={o.keep} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const hidden = (form: HTMLElement) => Object.fromEntries([...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((i) => [i.name, i.value]));
const links = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]);
async function openMore(name: string) {
  await userEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: en.timeScope.customTitle });
}

describe('RangeBar', () => {
  it('shows Last 7 / 14 / 30 Days and "More ranges" only; links keep the page parameters; one summary line', () => {
    view('', { keep: { tab: 'posts', format: 'REELS' } });
    expect(links(screen.getByRole('navigation', { name: 'Quick ranges' }))).toEqual([
      ['Last 7 Days', '?tab=posts&format=REELS&from=7d', null],
      ['Last 14 Days', '?tab=posts&format=REELS&from=14d', null],
      ['Last 30 Days', '?tab=posts&format=REELS', 'page'],
    ]);
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'outline');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Last 30 days · vs previous 30 days');
    expect(document.body.textContent).not.toMatch(/\b\d+[dwmy]\b|YTD/);
  });

  it('one control height: the presets are one segmented control; "More ranges" is a default-size button', () => {
    view();
    const nav = screen.getByRole('navigation', { name: 'Quick ranges' });
    expect(nav).toHaveClass('h-[var(--ctl)]');
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm']);
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-size', 'default');
  });

  it('a range that is not one of the three is named on the button, which is highlighted', () => {
    view('from=6m');
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Last 6 months' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('status')).toHaveTextContent('Last 6 months · vs previous 182 days');
  });

  it('a month: the button and the summary name it', () => {
    view('month=2026-09&cmp=yoy');
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('status')).toHaveTextContent('September 2026 · vs September 2025');
  });

  it('a visible preset with a fixed Group by still highlights "More ranges" (nothing chosen inside is hidden)', () => {
    view('from=7d&gran=week');
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('More ranges: other presets, Compare with and Group by are links that keep the rest of the scope and the page parameters', async () => {
    view('from=90d&cmp=yoy&gran=month', { keep: { account: 'x' } });
    const dialog = await openMore('Last 90 days');
    expect(links(within(dialog).getByRole('navigation', { name: 'Other ranges' }))).toEqual([
      ['Last 90 days', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
      ['Last 6 months', '?account=x&from=6m&cmp=yoy&gran=month', null],
      ['Last 12 months', '?account=x&from=1y&cmp=yoy&gran=month', null],
      ['Year to date', '?account=x&from=ytd&cmp=yoy&gran=month', null],
      ['All time', '?account=x&from=all&gran=month', null],
    ]);
    expect(links(within(dialog).getByRole('navigation', { name: 'Compare with' }))).toEqual([
      ['Previous period', '?account=x&from=90d&gran=month', null],
      ['Same period last year', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
      ['No comparison', '?account=x&from=90d&cmp=none&gran=month', null],
    ]);
    expect(links(within(dialog).getByRole('navigation', { name: 'Group by' }))).toEqual([
      ['Auto (Day)', '?account=x&from=90d&cmp=yoy', null],
      ['Day', '?account=x&from=90d&cmp=yoy&gran=day', null],
      ['Week', '?account=x&from=90d&cmp=yoy&gran=week', null],
      ['Month', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
    ]);
  });

  it('custom dates: range, week, month and quarter GET forms carry the page parameters, compare and group-by', async () => {
    view('from=90d&cmp=yoy&gran=month', { keep: { account: 'x' } });
    const dialog = await openMore('Last 90 days');
    expect(dialog).toHaveTextContent(en.timeScope.customDates);
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

  it('"All time": no comparison links or form, a hint instead; the visible presets compare again', async () => {
    view('from=all', { earliest: '2026-03-01' });
    expect(screen.getByRole('status')).toHaveTextContent(/^All time$/);
    expect(screen.getByRole('link', { name: 'Last 30 Days' })).toHaveAttribute('href', '?');
    const dialog = await openMore('All time');
    expect(within(dialog).queryByRole('navigation', { name: 'Compare with' })).toBeNull();
    expect(within(dialog).queryByRole('form', { name: 'Compare with other days' })).toBeNull();
    expect(dialog).toHaveTextContent(en.timeScope.compareAllHint);
  });

  it('a custom comparison: highlighted button, none of the three compare links current, the form holds the days', async () => {
    view('from=30d&cfrom=2025-01-01&cto=2025-01-30');
    expect(screen.getByRole('status')).toHaveTextContent('vs 1 Jan 2025 – 30 Jan 2025');
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'secondary');
    const dialog = await openMore('More ranges');
    expect(within(within(dialog).getByRole('navigation', { name: 'Compare with' })).queryByRole('link', { current: true })).toBeNull();
    expect(within(dialog).getByRole('form', { name: 'Compare with other days' }).querySelector('input[name=cfrom]')).toHaveValue('2025-01-01');
  });

  it('coverage: says where the data starts, or that nothing was captured yet', () => {
    view('from=1y', { earliest: '2026-08-01' });
    expect(screen.getByRole('status')).toHaveTextContent('Data starts 1 Aug 2026: earlier days in this range have no data.');
    view('from=7d', { earliest: null });
    expect(screen.getAllByRole('status')[1]).toHaveTextContent('No data captured yet.');
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

  it('zh-CN: full words', () => {
    view('', { locale: 'zh-CN' });
    expect(within(screen.getByRole('navigation', { name: zh.timeScope.presets })).getAllByRole('link').map((a) => a.textContent)).toEqual(['最近 7 天', '最近 14 天', '最近 30 天']);
    expect(screen.getByRole('button', { name: zh.timeScope.more })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('最近 30 天 · 对比前 30 天');
  });
});
