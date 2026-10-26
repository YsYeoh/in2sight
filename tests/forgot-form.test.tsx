import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { ForgotForm } from '@/components/auth/ForgotForm';
import { RecoveryConfirmForm } from '@/components/auth/RecoveryConfirmForm';
import type { ConfirmState, ForgotState } from '@/lib/auth/recovery';

const wrap = (ui: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') => (
  <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
    {ui}
  </NextIntlClientProvider>
);

describe('ForgotForm', () => {
  it('a labelled email field (autocomplete email) and the submit button', () => {
    render(wrap(<ForgotForm action={async () => ({})} />));
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('submits the email and announces the generic answer', async () => {
    const action = vi.fn<(p: ForgotState, f: FormData) => Promise<ForgotState>>(async () => ({ status: 'sent' }));
    render(wrap(<ForgotForm action={action} />));
    await userEvent.type(screen.getByLabelText('Email'), 'o@x.io');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent("If that email belongs to the owner's account");
    expect(action.mock.calls[0][1].get('email')).toBe('o@x.io');
  });

  it('cooldown is a status, a bad email an alert on the field', async () => {
    const { unmount } = render(wrap(<ForgotForm action={async () => ({ status: 'cooldown' })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Wait a minute');
    unmount();
    render(wrap(<ForgotForm action={async () => ({ error: 'invalid_email' })} />));
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address.');
  });

  it('renders in Simplified Chinese', () => {
    render(wrap(<ForgotForm action={async () => ({})} />, 'zh-CN'));
    expect(screen.getByRole('button', { name: '发送重置链接' })).toBeInTheDocument();
  });
});

describe('RecoveryConfirmForm', () => {
  it('posts only the token hash, and shows link_invalid with a link to ask again', async () => {
    const action = vi.fn<(p: ConfirmState, f: FormData) => Promise<ConfirmState>>(async () => ({ error: 'link_invalid' }));
    render(wrap(<RecoveryConfirmForm action={action} tokenHash={'a'.repeat(56)} />));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0][1];
    expect([...fd.keys()]).toEqual(['token_hash']);
    expect(fd.get('token_hash')).toBe('a'.repeat(56));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link has expired or was already used.');
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/login/forgot');
  });
});
