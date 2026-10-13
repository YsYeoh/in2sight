import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { VerifyForm } from '@/components/auth/VerifyForm';

const wrap = (ui: React.ReactNode) => <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;

describe('VerifyForm', () => {
  it('is a numeric one-time-code field', () => {
    render(wrap(<VerifyForm action={async () => ({})} />));
    const input = screen.getByLabelText('Verification code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', '7');
  });

  it('submits the code', async () => {
    const action = vi.fn(async () => ({}));
    render(wrap(<VerifyForm action={action} />));
    await userEvent.type(screen.getByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(((action.mock.calls[0] as unknown[])[1] as FormData).get('code')).toBe('123456');
  });

  it('shows the invalid-code message as an alert', async () => {
    render(wrap(<VerifyForm action={async () => ({ error: 'invalid_code' as const })} />));
    await userEvent.type(screen.getByLabelText('Verification code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
  });

  it('maps a rate-limit error to its own message', async () => {
    render(wrap(<VerifyForm action={async () => ({ error: 'rate_limited' as const })} />));
    await userEvent.type(screen.getByLabelText('Verification code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });
});
