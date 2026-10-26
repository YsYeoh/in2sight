import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { StandardsGallery } from '@/app/styleguide/StandardsGallery';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

describe.each([
  ['en', en],
  ['zh-CN', zh],
] as const)('StandardsGallery (%s)', (locale, messages) => {
  it('shows the range bar, the filter toolbar, underline tabs, a one-height button row and the scrollbar sample', () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={() => {}}>
          <StandardsGallery today="2026-10-17" />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const s = messages.styleguide.standards;
    for (const title of [s.title, s.rangeBar, s.filterToolbar, s.tabs, s.buttons, s.scrollbar]) expect(screen.getByText(title), title).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: messages.timeScope.presets })).getAllByRole('link')).toHaveLength(3);
    const toolbar = screen.getByRole('group', { name: s.filterToolbar });
    expect(within(toolbar).getByRole('searchbox', { name: s.sampleSearch })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: messages.filters.withCount.replace('{label}', messages.filters.advanced).replace('{count}', '1') })).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'line');
    const row = screen.getByRole('group', { name: s.buttons });
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('data-size'))).toEqual(['default', 'default', 'default']);
  });

  it('rule 18: a segmented control in a form with the save bar (Save only when changed; saving announces it)', async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={() => {}}>
          <StandardsGallery today="2026-10-17" />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const s = messages.styleguide.standards;
    expect(screen.getByText(s.saveBar)).toBeInTheDocument();
    const seg = screen.getByRole('group', { name: s.segmented });
    const save = screen.getByRole('button', { name: messages.common.save });
    expect(save).toBeDisabled();
    await userEvent.click(within(seg).getByRole('button', { name: messages.prefs.comfortable }));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(screen.getAllByRole('status').some((el) => el.textContent === messages.settings.notifications.saved)).toBe(true); // the range bar has its own status line
  });
});
