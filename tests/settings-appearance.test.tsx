import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';
import { DEFAULT_PREFS, MODES } from '@/lib/prefs';

function setup(locale: 'en' | 'zh-CN' = 'en') {
  const persist = vi.fn(async () => ({ ok: true }));
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={persist}>
        <AppearanceSection />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return persist;
}
const P = en.prefs;
const A = en.settings.appearance;

describe('AppearanceSection', () => {
  it('four groups, each one segmented control with its current value pressed (no pill wall)', () => {
    setup();
    for (const name of [P.theme, P.mode, P.density, P.radius]) expect(screen.getByRole('group', { name })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: P.theme })).getByRole('button', { name: 'Ink' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: P.mode })).getAllByRole('button')).toHaveLength(MODES.length);
    expect(within(screen.getByRole('group', { name: P.radius })).getByRole('button', { name: P.soft })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(A.modeHint)).toBeInTheDocument();
  });

  it('a pick applies to the page at once and saves only that key', async () => {
    const persist = setup();
    await userEvent.click(within(screen.getByRole('group', { name: P.theme })).getByRole('button', { name: 'Sunset' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(persist).toHaveBeenLastCalledWith({ theme: 'sunset' });
    await userEvent.click(within(screen.getByRole('group', { name: P.density })).getByRole('button', { name: P.comfortable }));
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
    expect(persist).toHaveBeenLastCalledWith({ density: 'comfortable' });
  });

  it('the preview shows real pieces with formatted numbers and the six chart colours', () => {
    setup();
    expect(screen.getByText(A.previewTitle)).toBeInTheDocument();
    expect(screen.getByText('12,480')).toBeInTheDocument();
    expect(screen.getByText('+8.2%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: A.previewPrimary })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: A.previewInput })).toBeInTheDocument();
    const bars = screen.getByRole('img', { name: A.previewChart }).children;
    expect([...bars].map((b) => [...b.classList].find((c) => c.startsWith('bg-chart-')))).toEqual(['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5', 'bg-chart-6']);
  });

  it('zh-CN: translated labels, theme names stay proper nouns', () => {
    setup('zh-CN');
    expect(screen.getByRole('group', { name: zh.prefs.mode })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: zh.prefs.dark })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forest' })).toBeInTheDocument();
  });
});
