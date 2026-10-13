import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { Gallery } from '@/app/styleguide/Gallery';

describe.each([
  ['en', en],
  ['zh-CN', zh],
] as const)('Gallery (%s)', (locale, messages) => {
  it('renders every group, a destructive button, and opens the dialog', async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={() => {}}>
          <Gallery />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    const g = messages.styleguide.gallery;
    for (const label of [g.buttons, g.inputs, g.select, g.choices, g.tabs, g.feedback, g.dialogs, g.table, g.empty, g.toast, g.loading]) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
    expect(document.querySelector('[data-variant="destructive"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: g.openDialog }));
    expect(await screen.findByRole('dialog', { name: g.dialogTitle })).toBeInTheDocument();
  });
});
