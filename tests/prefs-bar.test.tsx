import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { DATE_FORMATS, DEFAULT_PREFS } from '@/lib/prefs';

function setup(persist = vi.fn(), locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={persist}>
        <PrefsBar />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return persist;
}

describe('PrefsBar', () => {
  it('marks the current theme as pressed and switches theme on click', async () => {
    const persist = setup();
    expect(screen.getByRole('button', { name: 'Ink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sunset' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Sunset' }));
    expect(screen.getByRole('button', { name: 'Sunset' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(persist).toHaveBeenCalledWith({ theme: 'sunset' });
  });

  it('switches mode and writes data-mode on <html>', async () => {
    const persist = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(persist).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('offers every date format and persists the chosen one', async () => {
    const persist = setup();
    for (const f of DATE_FORMATS) expect(screen.getByRole('button', { name: f })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'DD/MM/YYYY' }));
    expect(persist).toHaveBeenCalledWith({ dateFormat: 'DD/MM/YYYY' });
  });

  it('persists the chosen time format, number format and week start', async () => {
    const persist = setup();
    await userEvent.click(screen.getByRole('button', { name: '12h' }));
    expect(persist).toHaveBeenLastCalledWith({ timeFormat: '12h' });
    await userEvent.click(screen.getByRole('button', { name: '1.234,5' }));
    expect(persist).toHaveBeenLastCalledWith({ numberFormat: '1.234,5' });
    await userEvent.click(screen.getByRole('button', { name: 'Sunday' }));
    expect(persist).toHaveBeenLastCalledWith({ weekStart: 'sun' });
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the current timezone, including one that is not in the list', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'Africa/Nairobi' }} persist={vi.fn()}>
          <PrefsBar />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('Africa/Nairobi');
  });

  it('choosing a timezone persists it', async () => {
    // jsdom lacks the pointer-capture / scroll APIs Radix Select uses
    Object.assign(Element.prototype, { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} });
    const persist = setup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Timezone' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Europe/London' }));
    expect(persist).toHaveBeenLastCalledWith({ timezone: 'Europe/London' });
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveTextContent('Europe/London');
  });

  it('renders translated labels in Chinese', () => {
    setup(vi.fn(), 'zh-CN');
    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '紧凑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '简体中文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '周日' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '时区' })).toBeInTheDocument();
  });
});
