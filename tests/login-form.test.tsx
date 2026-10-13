import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { LoginForm } from '@/components/auth/LoginForm';

const wrap = (ui: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') => (
  <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
    {ui}
  </NextIntlClientProvider>
);

describe('LoginForm', () => {
  it('has labelled email and password fields and a submit button', () => {
    render(wrap(<LoginForm action={async () => ({})} />));
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('autocomplete hints let password managers work', () => {
    render(wrap(<LoginForm action={async () => ({})} />));
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('submits the typed values to the action', async () => {
    const action = vi.fn(async () => ({}));
    render(wrap(<LoginForm action={action} />));
    await userEvent.type(screen.getByLabelText('Email'), 'o@x.y');
    await userEvent.type(screen.getByLabelText('Password'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = (action.mock.calls[0] as unknown[])[1] as FormData;
    expect(fd.get('email')).toBe('o@x.y');
    expect(fd.get('password')).toBe('secret');
  });

  it('shows the translated error returned by the action, announced as an alert', async () => {
    render(wrap(<LoginForm action={async () => ({ error: 'invalid_credentials' as const })} />));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.c');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('renders in Simplified Chinese', () => {
    render(wrap(<LoginForm action={async () => ({})} />, 'zh-CN'));
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument();
  });
});
