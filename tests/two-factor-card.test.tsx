import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';

const wrap = (ui: React.ReactNode) => <NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>;
const noop = { startEnrollAction: vi.fn(), confirmEnrollAction: vi.fn(), disableAction: vi.fn() };

describe('TwoFactorCard — not enrolled', () => {
  it('offers to enable, then shows the QR code, the secret and a code field', async () => {
    const start = vi.fn(async () => ({ ok: true as const, factorId: 'f1', qrSvg: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'JBSWY3DPEHPK3PXP' }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={start} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /QR/i })).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'));
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
  });

  it('confirms with the typed code and the factor id', async () => {
    const start = vi.fn(async () => ({ ok: true as const, factorId: 'f1', qrSvg: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S' }));
    const confirm = vi.fn(async () => ({ ok: true }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={start} confirmEnrollAction={confirm} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('f1', '123456'));
  });

  it('a wrong code shows an error and keeps the form open', async () => {
    const start = vi.fn(async () => ({ ok: true as const, factorId: 'f1', qrSvg: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S' }));
    const confirm = vi.fn(async () => ({ ok: false, error: 'invalid_code' }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={start} confirmEnrollAction={confirm} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await userEvent.type(await screen.findByLabelText('Verification code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work");
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
  });

  it('cancelling returns to the initial state', async () => {
    const start = vi.fn(async () => ({ ok: true as const, factorId: 'f1', qrSvg: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S' }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={start} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Enable two-factor' })).toBeInTheDocument();
  });

  it('a failed start shows the generic error', async () => {
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={async () => ({ ok: false as const })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('TwoFactorCard — enrolled', () => {
  it('shows the enabled badge and the recovery hint, and disabling needs a confirmation', async () => {
    const disable = vi.fn(async () => ({ ok: true }));
    render(wrap(<TwoFactorCard enrolled={{ factorId: 'f9' }} {...noop} disableAction={disable} />));
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText(/Lost your device/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(disable).not.toHaveBeenCalled(); // not yet: a confirmation dialog first
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(disable).toHaveBeenCalledWith('f9'));
  });
});

describe('TwoFactorCard — failures', () => {
  const started = async () => ({ ok: true as const, factorId: 'f1', qrSvg: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S' });

  it('a rate-limited confirm shows the rate-limit message', async () => {
    const confirm = vi.fn(async () => ({ ok: false, error: 'rate_limited' }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={started} confirmEnrollAction={confirm} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('a failed disable shows the generic error', async () => {
    render(wrap(<TwoFactorCard enrolled={{ factorId: 'f9' }} {...noop} disableAction={async () => ({ ok: false })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('the secret is dropped from the page after cancelling', async () => {
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={started} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByText('S')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('S')).toBeNull();
  });

  it('a failed disable with needs_aal2 shows the matching message', async () => {
    render(wrap(<TwoFactorCard enrolled={{ factorId: 'f9' }} {...noop} disableAction={async () => ({ ok: false, error: 'needs_aal2' })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again with your authenticator code');
  });

  it('a refused start with needs_aal2 shows the matching message', async () => {
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={async () => ({ ok: false as const, error: 'needs_aal2' })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again with your authenticator code');
  });

  it('accepts a pasted code with spaces and links the code error to the field', async () => {
    const confirm = vi.fn(async () => ({ ok: false, error: 'invalid_code' }));
    render(wrap(<TwoFactorCard enrolled={null} {...noop} startEnrollAction={started} confirmEnrollAction={confirm} />));
    await userEvent.click(screen.getByRole('button', { name: 'Enable two-factor' }));
    const input = await screen.findByLabelText('Verification code');
    expect(input).not.toHaveAttribute('maxlength');
    await userEvent.click(input);
    await userEvent.paste(' 123 456 ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and enable' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('f1', ' 123 456 '));
    const alert = await screen.findByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });
});
