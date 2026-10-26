import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const server = vi.hoisted(() => ({ calls: [] as string[], mfa: { enrolled: false, factorId: null as string | null } }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (server.calls.push('owner'), { userId: 'u1', email: 'o@x.y' }) }));
vi.mock('@/lib/auth/mfa', () => ({ getMfaStatus: async () => (server.calls.push('mfa'), server.mfa) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/app/(app)/settings/actions', () => ({ startEnrollAction: vi.fn(), confirmEnrollAction: vi.fn(), disableAction: vi.fn() }));
vi.mock('@/app/(app)/settings/security-actions', () => ({ changePasswordAction: vi.fn(), signOutOthersAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en.json')).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) };
});

import { SecuritySection } from '@/components/settings/sections/SecuritySection';

const S = en.auth.security;
const show = async () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {await SecuritySection()}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  server.calls.length = 0;
  server.mfa = { enrolled: false, factorId: null };
});

describe('Settings -> Security section', () => {
  it('checks the owner first, then renders email, two-factor, password and other devices', async () => {
    await show();
    expect(server.calls).toEqual(['owner', 'mfa']);
    expect(screen.getByText(en.settings.account.email)).toBeInTheDocument();
    expect(screen.getByText('o@x.y')).toBeInTheDocument();
    expect(screen.getByText(en.settings.twoFactor.title)).toBeInTheDocument();
    expect(screen.getByText(S.passwordTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.passwordSubmit })).toBeInTheDocument();
    expect(screen.getByText(S.sessionsTitle)).toBeInTheDocument();
    expect(screen.getByText(S.sessionsNote)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: S.signOutOthers })).toBeInTheDocument();
  });

  it('the password form asks for the current password and the owner email is only a hidden username', async () => {
    const { container } = await show();
    expect(container.querySelector('input[name="username"]')).toHaveValue('o@x.y');
    expect(container.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
  });

  it('renders for an enrolled owner without showing any factor secret', async () => {
    server.mfa = { enrolled: true, factorId: 'f1' };
    const { container } = await show();
    expect(container.textContent).not.toContain('f1');
    expect(screen.getByText(en.settings.twoFactor.title)).toBeInTheDocument();
  });
});
