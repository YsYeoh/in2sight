import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DashboardGallery } from '@/app/styleguide/DashboardGallery';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe.each([
  ['en', en],
  ['zh-CN', zh],
] as const)('DashboardGallery (%s)', (locale, messages) => {
  it('shows stat cards, the three chart kinds, the heatmap and the data table', () => {
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={() => {}}>
          <DashboardGallery />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const g = messages.styleguide.gallery;
    for (const label of [g.stats, g.charts, g.lineChart, g.areaChart, g.barChart, g.dataTable]) expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: g.heatmap })).toBeInTheDocument();
    expect(screen.getAllByText(messages.analysis.weekday['1']).length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
});
