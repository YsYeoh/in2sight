import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { CalendarView } from '@/components/calendar/CalendarView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildCalendar } from '@/lib/dashboard/calendar';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';

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

const A1 = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const A2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const ACCOUNTS = [
  { id: A1, username: 'brand.one' },
  { id: A2, username: 'brand.two' },
];
const m = (id: string, postedAt: string, mediaType: MonthMedia['mediaType'] = 'IMAGE', accountId = A1): MonthMedia => ({ id, accountId, mediaType, postedAt, permalink: id === 'p1' ? 'https://www.instagram.com/p/p1/' : null, caption: id === 'p1' ? 'Launch day' : null });
const KL = { weekStart: 'mon' as const, tz: 'Asia/Kuala_Lumpur', today: '2026-10-15' };
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), KL.today, '2026-01-01');
const OCT = scopeOf('month=2026-10');
const model = buildCalendar({ from: '2026-10-01', to: '2026-10-31' }, [m('p1', '2026-10-15T02:00:00Z'), m('s1', '2026-10-15T03:00:00Z', 'STORY', A2), m('p2', '2026-09-30T16:30:00Z')], KL);

function view(account: string | null = null, locale: 'en' | 'zh-CN' = 'en', mdl = model, truncated = false, scope: ResolvedScope = OCT) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <CalendarView model={mdl} scope={scope} today={KL.today} accounts={ACCOUNTS} account={account} truncated={truncated} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('CalendarView', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('header: the account select is a full-height control (one control height per row)', () => {
    view(A1);
    expect(screen.getByRole('combobox', { name: en.pages.calendar.account })).toHaveClass('h-[var(--ctl)]', 'text-sm');
  });

  it('month title; the arrows step whole months and keep the account; no step into the future', () => {
    view(A1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('October 2026');
    expect(screen.getByRole('link', { name: en.timeScope.previous })).toHaveAttribute('href', `?account=${A1}&from=2026-09-01&to=2026-09-30`);
    expect(screen.getByRole('button', { name: en.timeScope.next })).toBeDisabled(); // November starts after today
    const select = screen.getByRole('combobox', { name: en.pages.calendar.account });
    expect(select).toHaveValue(A1);
    expect(Object.fromEntries([...select.closest('form')!.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((i) => [i.name, i.value]))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(screen.getByRole('navigation', { name: en.timeScope.presets })).toBeInTheDocument(); // the shared bar
  });

  it('a rolling 30 days: titled by the preset, the arrows step 30 days back', () => {
    view(null, 'en', buildCalendar({ from: '2026-09-16', to: '2026-10-15' }, [], KL), false, scopeOf(''));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Last 30 days');
    expect(screen.getByRole('link', { name: en.timeScope.previous })).toHaveAttribute('href', '?from=2026-08-17&to=2026-09-15');
  });

  it('grid: weekday headers from the week start, day cells with counts; today selected and listed', () => {
    view();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const today = within(table).getByRole('button', { name: /^15 Oct 2026: 1 post, 1 story/ });
    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Launch day').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Story · @brand\.two/).length).toBeGreaterThan(0); // all accounts: the account is named
  });

  it('tapping a day shows its list (a post just after midnight local is on 1 Oct)', async () => {
    const user = userEvent.setup();
    view();
    expect(screen.getAllByRole('heading', { level: 3, name: '1 Oct 2026' })).toHaveLength(1); // phone agenda only
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /^1 Oct 2026: 1 post, 0 stories/ }));
    expect(screen.getAllByRole('heading', { level: 3, name: '1 Oct 2026' })).toHaveLength(2); // + the md+ day card
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: /^2 Oct 2026/ }));
    expect(screen.getAllByText(en.pages.calendar.nothing).length).toBeGreaterThan(0);
  });

  it('phones: an agenda of only the days with items; external links use noopener', () => {
    view();
    const agenda = screen.getAllByRole('region').filter((r) => r.getAttribute('aria-label') !== en.timeScope.label); // not the bar
    expect(agenda.map((r) => r.getAttribute('aria-label'))).toEqual([expect.stringContaining('1 Oct 2026'), expect.stringContaining('15 Oct 2026')]);
    for (const a of screen.getAllByRole('link', { name: en.pages.calendar.open })) expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the truncation note only when the read was capped', () => {
    const { unmount } = view();
    expect(screen.queryByText(en.pages.calendar.truncated)).toBeNull();
    unmount();
    view(null, 'en', model, true);
    expect(screen.getByText(en.pages.calendar.truncated)).toBeInTheDocument();
  });

  it('empty month (zh-CN): the agenda says so', () => {
    view(null, 'zh-CN', buildCalendar({ from: '2026-08-01', to: '2026-08-31' }, [], KL), false, scopeOf('month=2026-08'));
    expect(screen.getByText(zh.pages.calendar.emptyMonth)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('2026年8月');
  });
});
