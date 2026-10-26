import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { SignOutOthersButton } from '@/components/auth/SignOutOthersButton';
import type { PasswordFormState } from '@/lib/auth/password-rules';

const wrap = (ui: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') => (
  <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
    {ui}
  </NextIntlClientProvider>
);
type Action = (prev: PasswordFormState, fd: FormData) => Promise<PasswordFormState>;
const GOOD = 'Correct horse battery 9';
const change = (action: Action) => render(wrap(<PasswordForm action={action} email="owner@example.com" withCurrent submitLabel="Change password" />));

describe('PasswordForm', () => {
  it('labelled password fields with the right autocomplete hints and a hidden username', () => {
    const { container } = change(async () => ({}));
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('autocomplete', 'new-password');
    for (const name of ['Current password', 'New password', 'Confirm new password']) expect(screen.getByLabelText(name)).toHaveAttribute('type', 'password');
    expect(container.querySelector('input[name="username"]')).toHaveValue('owner@example.com');
  });

  it('without withCurrent there is no current-password field', () => {
    render(wrap(<PasswordForm action={async () => ({})} email={null} withCurrent={false} submitLabel="Save new password" />));
    expect(screen.queryByLabelText('Current password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save new password' })).toBeInTheDocument();
  });

  it('the toggle shows and hides its own field (aria-pressed, constant label)', async () => {
    change(async () => ({}));
    const input = screen.getByLabelText('New password');
    const toggle = screen.getAllByRole('button', { name: 'Show password' })[1];
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('the meter appears while typing, with a text label and the broken rule', async () => {
    change(async () => ({}));
    expect(screen.queryByTestId('password-meter')).toBeNull();
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    expect(screen.getByTestId('password-meter')).toHaveTextContent('Strength: Too weak Use at least 12 characters.');
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), GOOD);
    expect(screen.getByTestId('password-meter')).toHaveTextContent('Strength: Very strong');
  });

  it('submits current, password and confirm under those names', async () => {
    const action = vi.fn<Action>(async () => ({}));
    change(action);
    await userEvent.type(screen.getByLabelText('Current password'), 'old password long');
    await userEvent.type(screen.getByLabelText('New password'), GOOD);
    await userEvent.type(screen.getByLabelText('Confirm new password'), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][1];
    expect([fd.get('current'), fd.get('password'), fd.get('confirm')]).toEqual(['old password long', GOOD, GOOD]);
  });

  it('a wrong current password is announced on that field and the typed values stay', async () => {
    change(async () => ({ error: 'wrong_password' }));
    await userEvent.type(screen.getByLabelText('Current password'), 'nope nope nope');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The current password is wrong.');
    expect(screen.getByLabelText('Current password')).toHaveValue('nope nope nope');
  });

  it('other errors are form-level alerts', async () => {
    change(async () => ({ error: 'rate_limited' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a few minutes and try again.');
  });

  it('success clears every field and announces the result', async () => {
    change(async () => ({ ok: true, othersSignedOut: true }));
    await userEvent.type(screen.getByLabelText('Current password'), 'old password long');
    await userEvent.type(screen.getByLabelText('New password'), GOOD);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Password changed. Your other devices were signed out.');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('says so when the other devices could not be signed out', async () => {
    change(async () => ({ ok: true, othersSignedOut: false }));
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('could not be signed out');
  });

  it('renders in Simplified Chinese', () => {
    render(wrap(<PasswordForm action={async () => ({})} email={null} withCurrent submitLabel="修改密码" />, 'zh-CN'));
    expect(screen.getByLabelText('当前密码')).toBeInTheDocument();
    expect(screen.getByLabelText('新密码')).toBeInTheDocument();
  });
});

describe('SignOutOthersButton', () => {
  it('runs the action and announces success', async () => {
    const action = vi.fn(async () => ({ ok: true }));
    render(wrap(<SignOutOthersButton action={action} />));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your other devices were signed out.');
    expect(action).toHaveBeenCalledTimes(1);
  });
  it('announces a failure as an alert', async () => {
    render(wrap(<SignOutOthersButton action={async () => ({ ok: false })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Signing out the other devices failed. Try again.');
  });
});
