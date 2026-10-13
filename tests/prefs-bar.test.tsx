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

  it('renders translated labels in Chinese', () => {
    setup(vi.fn(), 'zh-CN');
    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '紧凑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '简体中文' })).toBeInTheDocument();
  });
});
