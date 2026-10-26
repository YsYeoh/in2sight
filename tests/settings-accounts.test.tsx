import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const server = vi.hoisted(() => ({ accounts: [] as unknown[], sync: {} as Record<string, unknown>, calls: [] as string[] }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (server.calls.push('owner'), { userId: 'u1', email: null }) }));
vi.mock('@/lib/dashboard/cached', () => ({ loadAccounts: async () => (server.calls.push('accounts'), server.accounts), loadSyncStatus: async () => server.sync }));
vi.mock('@/app/(app)/accounts/actions', () => ({ syncNowAction: vi.fn() }));

import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AccountsOverview, type AccountsOverviewProps } from '@/components/settings/AccountsOverview';
import { AccountsSection } from '@/components/settings/sections/AccountsSection';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

const S = en.settings.accountsSync;
const NOW = '2026-10-26T00:00:00Z';
const acc = (o: Partial<StoredAccount>): StoredAccount => ({ id: 'a1', igUserId: '1', username: 'yseny_', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-10-01T00:00:00Z', grantedScopes: [COMMENTS_SCOPE], ...o });
const ACCOUNTS = [acc({}), acc({ id: 'a2', username: 'penangclowns', status: 'needs_reconnect', groupName: 'Clients', grantedScopes: [] })];

function view(o: Partial<AccountsOverviewProps> = {}) {
  const props: AccountsOverviewProps = { accounts: ACCOUNTS, sync: { a1: { lastSuccessAt: '2026-10-25T10:00:00Z', lastErrorKey: null, consecutiveFailures: 0 } }, now: NOW, syncNow: vi.fn(async () => ({ ok: true })), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <AccountsOverview {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

beforeEach(() => {
  refresh.mockReset();
  server.calls.length = 0;
});

describe('AccountsOverview', () => {
  it('one card per account: name, status, token, last sync; Manage accounts links to /accounts', () => {
    view();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('@yseny_')).toBeInTheDocument();
    expect(within(cards[0]).getByText(en.accounts.status.active)).toBeInTheDocument();
    expect(within(cards[1]).getAllByText(en.accounts.status.reconnect)).toHaveLength(2); // the status badge and the Reconnect link
    expect(within(cards[0]).getByText(en.accounts.columns.token)).toBeInTheDocument();
    expect(within(cards[1]).getByText(en.accounts.sync.never)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: S.manage })).toHaveAttribute('href', '/accounts');
  });

  it('Sync now only for active accounts; Reconnect always, leaving the tab frame', () => {
    view();
    const [a, b] = screen.getAllByRole('listitem');
    expect(within(a).getByRole('button', { name: S.syncNow })).toBeEnabled();
    expect(within(b).queryByRole('button', { name: S.syncNow })).toBeNull();
    const re = within(b).getByRole('link', { name: S.reconnect });
    expect(re).toHaveAttribute('target', '_top');
    expect(re.getAttribute('href')).toContain('Clients');
  });

  it('the comments hint shows only for an active account without the scope', () => {
    view({ accounts: [acc({ grantedScopes: [] })] });
    expect(screen.getByRole('link', { name: en.accounts.commentsHint })).toHaveAttribute('target', '_top');
  });

  it('Sync now runs the action, announces the result and refreshes', async () => {
    const p = view();
    await userEvent.click(screen.getByRole('button', { name: S.syncNow }));
    expect(p.syncNow).toHaveBeenCalledWith('a1');
    expect(await screen.findByText('Synced @yseny_')).toHaveAttribute('role', 'status');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('a refused sync shows the translated error key', async () => {
    view({ syncNow: vi.fn(async () => ({ ok: false, error: 'busy' })) });
    await userEvent.click(screen.getByRole('button', { name: S.syncNow }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en.accounts.errors.busy));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('no accounts: an empty state with a link to connect one', () => {
    view({ accounts: [] });
    expect(screen.getByText(S.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: S.emptyAction })).toHaveAttribute('href', '/accounts');
  });
});

describe('AccountsSection (server)', () => {
  it('checks the owner first and leaves archived accounts out', async () => {
    server.accounts = [...ACCOUNTS, acc({ id: 'a3', username: 'old', status: 'archived' })];
    const el = (await AccountsSection()) as React.ReactElement<AccountsOverviewProps>;
    expect(server.calls[0]).toBe('owner');
    expect(el.props.accounts.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(typeof el.props.syncNow).toBe('function');
  });
});
