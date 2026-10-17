import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AccountsView } from '@/components/accounts/AccountsView';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const ALL = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'];
const acct = (o: Partial<StoredAccount> & { id: string; username: string }): StoredAccount => ({
  igUserId: o.id, displayName: null, accountType: 'MEDIA_CREATOR', profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: new Date(Date.now() + 50 * 86_400_000).toISOString(), connectedAt: '2026-10-02T00:00:00Z', ...o,
});
const ok = async () => ({ ok: true });

function view(accounts: StoredAccount[], locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <AccountsView accounts={accounts} actions={{ archive: vi.fn(ok), restore: vi.fn(ok), remove: vi.fn(ok), setGroup: vi.fn(ok), syncNow: vi.fn(ok) }} now={new Date().toISOString()} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('"Reconnect to enable comments" hint', () => {
  it('shows for an active account without the comments scope and links to the reconnect flow (keeps the group)', () => {
    view([acct({ id: '1', username: 'old', groupName: 'Brand X', grantedScopes: ALL.slice(0, 2) })]);
    const links = screen.getAllByRole('link', { name: 'Reconnect to enable comments' }); // table (desktop) + card (phone)
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20X');
  });

  it('unknown scopes (null) also show the hint; a granted scope hides it', () => {
    view([acct({ id: '1', username: 'unknown', grantedScopes: null }), acct({ id: '2', username: 'granted', grantedScopes: ALL })]);
    const links = screen.getAllByRole('link', { name: 'Reconnect to enable comments' });
    expect(links.length).toBe(2); // only account 1, once in the table and once in the card
  });

  it('not shown for archived or needs-reconnect accounts', () => {
    view([acct({ id: '1', username: 'a', status: 'needs_reconnect' }), acct({ id: '2', username: 'b', status: 'archived', archivedAt: '2026-10-10T00:00:00Z' })]);
    expect(screen.queryByRole('link', { name: 'Reconnect to enable comments' })).toBeNull();
  });

  it('is translated', () => {
    view([acct({ id: '1', username: 'old' })], 'zh-CN');
    expect(screen.getAllByRole('link', { name: '重新连接以启用评论读取' }).length).toBeGreaterThan(0);
  });
});
