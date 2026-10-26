import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { LanguageSection, SAMPLE_AT, SAMPLE_NUMBER } from '@/components/settings/sections/LanguageSection';
import { formatNumber } from '@/lib/format';
import { DEFAULT_PREFS } from '@/lib/prefs';

function setup() {
  const persist = vi.fn(async () => ({ ok: true }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persist}>
        <LanguageSection />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return persist;
}
const P = en.prefs;
const L = en.settings.language;
const sample = (date: string, prefs = DEFAULT_PREFS) => L.sample.replace('{date}', date).replace('{number}', formatNumber(SAMPLE_NUMBER, prefs));

describe('LanguageSection', () => {
  it('fixed sample instant (server and client render the same text)', () => {
    expect(SAMPLE_AT).toBe('2026-03-14T23:30:00Z');
  });

  it('date and number formats are labelled selects whose options are rendered samples', () => {
    setup();
    const date = screen.getByLabelText(P.dateFormat);
    expect(within(date).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026-03-15', '15/03/2026', '03/15/2026', '15 Mar 2026']);
    expect(date).toHaveValue('D MMM YYYY');
    const num = screen.getByLabelText(P.numberFormat);
    expect(within(num).getAllByRole('option')[1]).toHaveTextContent('1.234.567,89');
    for (const el of [date, num]) expect(el.classList.contains('h-[var(--ctl)]')).toBe(true);
  });

  it('time format and week start are segmented controls; time labels are samples', () => {
    setup();
    const time = screen.getByRole('group', { name: P.timeFormat });
    expect(within(time).getAllByRole('button').map((b) => b.textContent)).toEqual(['07:30', '7:30 AM']);
    expect(within(screen.getByRole('group', { name: P.weekStart })).getByRole('button', { name: P.mon })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the timezone explanation is plain and the live sample follows every change', async () => {
    const persist = setup();
    expect(screen.getByText(L.timezoneHint)).toBeInTheDocument();
    expect(screen.getByText(sample('15 Mar 2026 07:30'))).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(P.timezone), 'UTC');
    expect(persist).toHaveBeenLastCalledWith({ timezone: 'UTC' });
    expect(screen.getByText(sample('14 Mar 2026 23:30'))).toBeInTheDocument(); // the day moved back: where days start changed
    await userEvent.selectOptions(screen.getByLabelText(P.dateFormat), 'YYYY-MM-DD');
    expect(persist).toHaveBeenLastCalledWith({ dateFormat: 'YYYY-MM-DD' });
    expect(screen.getByText(sample('2026-03-14 23:30'))).toBeInTheDocument();
  });

  it('language: proper names, saved like any preference', async () => {
    const persist = setup();
    const group = screen.getByRole('group', { name: P.language });
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: '简体中文' }));
    expect(persist).toHaveBeenLastCalledWith({ locale: 'zh-CN' });
    expect(screen.getByText(L.languageHint)).toBeInTheDocument();
  });
});
