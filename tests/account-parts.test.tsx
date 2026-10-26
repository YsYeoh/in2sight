import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CommentsHint, Identity, SyncInfo } from '@/components/accounts/AccountParts';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A: StoredAccount = { id: 'a1', igUserId: '1', username: 'yseny_', displayName: 'Yen', accountType: null, profilePictureUrl: null, groupName: 'Clients', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-10-01T00:00:00Z', grantedScopes: [] };

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('AccountParts (shared by /accounts and Settings)', () => {
  it('Identity: initial, @username and display name', () => {
    wrap(<Identity a={A} />);
    expect(screen.getByText('@yseny_')).toBeInTheDocument();
    expect(screen.getByText('Yen')).toBeInTheDocument();
    expect(screen.getByText('Y')).toBeInTheDocument();
  });

  it('SyncInfo: never synced, and a translated error only while failures continue', () => {
    const { unmount } = wrap(<SyncInfo />);
    expect(screen.getByText(en.accounts.sync.never)).toBeInTheDocument();
    unmount();
    wrap(<SyncInfo s={{ lastSuccessAt: null, lastErrorKey: 'not-a-key', consecutiveFailures: 2 }} />);
    expect(screen.getByText(en.accounts.errors.unexpected)).toBeInTheDocument();
  });

  it('CommentsHint: a top-level reconnect link for an active account without the scope; nothing once granted', () => {
    const { unmount } = wrap(<CommentsHint a={A} />);
    const link = screen.getByRole('link', { name: en.accounts.commentsHint });
    expect(link).toHaveAttribute('target', '_top');
    unmount();
    const { container } = wrap(<CommentsHint a={{ ...A, grantedScopes: [COMMENTS_SCOPE] }} />);
    expect(container.querySelector('a')).toBeNull();
  });
});
