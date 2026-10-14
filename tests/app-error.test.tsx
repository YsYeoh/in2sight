import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import AppError from '@/app/(app)/error';
import en from '@/messages/en.json';

describe('app error boundary', () => {
  it('shows a translated message (never error.message), retries and links to accounts', async () => {
    const reset = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AppError error={new Error('secret db detail')} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.pages.error.title)).toBeInTheDocument();
    expect(screen.queryByText(/secret db detail/)).toBeNull();
    expect(screen.getByRole('link', { name: en.pages.error.accounts })).toHaveAttribute('href', '/accounts');
    await userEvent.click(screen.getByRole('button', { name: en.pages.error.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
