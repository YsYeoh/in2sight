import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AccountsView } from '@/components/accounts/AccountsView';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

// the live progress hook refreshes the route when an import step lands
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const acct = (o: Partial<StoredAccount> & { id: string; username: string }): StoredAccount => ({
  igUserId: o.id, displayName: null, accountType: 'Media_Creator', profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: inDays(54), connectedAt: '2026-10-02T00:00:00Z', ...o,
});
const accounts = [
  acct({ id: '1', username: 'brandx.official', groupName: 'Brand X' }),
  acct({ id: '2', username: 'brandx.shop', groupName: 'Brand X', tokenExpiresAt: inDays(5) }),
  acct({ id: '3', username: 'old.account', status: 'needs_reconnect', tokenExpiresAt: inDays(-1) }),
  acct({ id: '4', username: 'gone', status: 'archived', archivedAt: '2026-10-10T00:00:00Z', groupName: 'Brand X' }),
];

const ok = async () => ({ ok: true });
function setup(props: Partial<React.ComponentProps<typeof AccountsView>> = {}, locale: 'en' | 'zh-CN' = 'en') {
  const actions = { archive: vi.fn(ok), restore: vi.fn(ok), remove: vi.fn(ok), setGroup: vi.fn(ok), syncNow: vi.fn(ok) };
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <AccountsView accounts={accounts} actions={actions} now={new Date().toISOString()} {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return actions;
}

describe('AccountsView', () => {
  it('groups accounts under their group name, isolated ones separately, archived ones in a collapsed section', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Brand X/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Isolated accounts/ })).toBeInTheDocument();
    expect(screen.getAllByText('@brandx.official').length).toBeGreaterThan(0);
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    expect(archived).not.toHaveAttribute('open');
    expect(within(archived).getByText('@gone')).toBeInTheDocument();
  });

  it('lists named groups alphabetically and isolated accounts last', () => {
    setup({
      accounts: [
        acct({ id: '1', username: 'a', groupName: 'Zed' }),
        acct({ id: '2', username: 'b' }),
        acct({ id: '3', username: 'c', groupName: 'Alpha' }),
      ],
    });
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
    expect(names[0]).toMatch(/Alpha/);
    expect(names[1]).toMatch(/Zed/);
    expect(names[2]).toMatch(/Isolated accounts/);
  });

  it('shows status with text, not colour alone: Active, Expiring (5 days left) and Reconnect (expired)', () => {
    setup();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expiring').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Reconnect').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5 days left').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(0);
  });

  it('reconnect is a plain link to the connect route carrying the current group', async () => {
    setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    expect(await screen.findByRole('menuitem', { name: 'Reconnect' })).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20X');
  });

  it('archiving needs a confirmation, then calls the action with the id', async () => {
    const actions = setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(actions.archive).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive @brandx.official?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(actions.archive).toHaveBeenCalledWith('1');
  });

  it('restoring an archived account calls restore', async () => {
    const actions = setup();
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    await userEvent.click(within(archived).getByRole('button', { name: 'Restore' }));
    expect(actions.restore).toHaveBeenCalledWith('4');
  });

  it('permanent delete stays disabled until the exact @username is typed', async () => {
    const actions = setup();
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    await userEvent.click(within(archived).getByRole('button', { name: 'Delete permanently' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), '@gon');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'e');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(actions.remove).toHaveBeenCalledWith('4');
  });

  it('editing the group saves the trimmed text through the action', async () => {
    const actions = setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit group' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('combobox');
    await userEvent.clear(input);
    await userEvent.type(input, '  Personal ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(actions.setGroup).toHaveBeenCalledWith('1', 'Personal');
  });

  it('an action error is shown translated and the dialog stays usable', async () => {
    const actions = setup();
    actions.archive.mockResolvedValueOnce({ ok: false, error: 'unauthorized' } as never);
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('You are not allowed to do that.')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('an unknown action error code falls back to the generic message', async () => {
    const actions = setup();
    actions.restore.mockResolvedValueOnce({ ok: false, error: 'weird' } as never);
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    await userEvent.click(within(archived).getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('a rejected (non-redirect) action shows the generic error and re-enables the buttons', async () => {
    const actions = setup();
    actions.restore.mockRejectedValueOnce(new Error('boom'));
    const archived = screen.getByText(/Archived \(1\)/).closest('details')!;
    archived.setAttribute('open', '');
    const restore = within(archived).getByRole('button', { name: 'Restore' });
    await userEvent.click(restore);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(restore).toBeEnabled();
  });

  it('a group literally named like the isolated section does not collide with it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ accounts: [acct({ id: '1', username: 'a', groupName: 'Isolated accounts' }), acct({ id: '2', username: 'b' })] });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    spy.mockRestore();
  });

  it('an account without a group shows "No group", not a bare dash', () => {
    setup({ accounts: [acct({ id: '2', username: 'b' })] });
    expect(screen.getAllByText('No group').length).toBeGreaterThan(0);
  });

  it('renders hostile group names and usernames as inert text', () => {
    setup({ accounts: [acct({ id: '9', username: 'x', groupName: '<img src=x onerror=alert(1)>' })] });
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getAllByText(/<img src=x onerror=alert\(1\)>/).length).toBeGreaterThan(0);
  });

  it('shows the empty state with an add button when there are no accounts', () => {
    setup({ accounts: [] });
    expect(screen.getByText('No accounts yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add account' }).length).toBeGreaterThan(0);
  });

  it('shows a success notice for a fresh connection', () => {
    setup({ notice: { connected: 'brandx' } });
    expect(screen.getByRole('status')).toHaveTextContent('Connected @brandx');
  });
  it('shows a translated error notice for a failed connection', () => {
    setup({ notice: { error: 'not_professional' } });
    expect(screen.getByRole('alert')).toHaveTextContent('not a Creator or Business account');
  });
  it('unknown error keys are ignored', () => {
    setup({ notice: { error: 'rm -rf' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders in Simplified Chinese', () => {
    setup({}, 'zh-CN');
    expect(screen.getByText('独立账号')).toBeInTheDocument();
    expect(screen.getAllByText('正常').length).toBeGreaterThan(0);
  });

  it('while Sync now runs, a status line with the orb names the account; it disappears when the action returns', async () => {
    const actions = setup({ accounts: [acct({ id: '1', username: 'a' })] });
    let release: (v: { ok: boolean }) => void = () => {};
    actions.syncNow.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sync now' }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Syncing @a');
    expect(status.querySelector('svg.insight-orb')).not.toBeNull();
    release({ ok: true });
    await waitFor(() => expect(screen.queryByText(/Syncing @a/)).not.toBeInTheDocument());
  });

  it('the confirm button shows the orb and aria-busy while the archive action runs', async () => {
    const actions = setup();
    actions.archive.mockImplementationOnce(() => new Promise(() => {}));
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    const confirm = within(dialog).getByRole('button', { name: 'Archive' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toBeDisabled();
    expect(confirm.querySelector('svg.insight-orb')).not.toBeNull();
  });
});

describe('AccountsView sync status', () => {
  it('shows "Not synced yet" until the first sync, then the last sync time', () => {
    setup({ accounts: [acct({ id: '1', username: 'a' }), acct({ id: '2', username: 'b' })], sync: { '2': { lastSuccessAt: '2026-10-14T02:00:00Z', lastErrorKey: null, consecutiveFailures: 0 } } });
    expect(screen.getAllByText('Not synced yet').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });

  it('shows the translated error while failures are ongoing; unknown keys fall back to the generic text', () => {
    setup({ accounts: [acct({ id: '1', username: 'a' }), acct({ id: '2', username: 'b' })], sync: { '1': { lastSuccessAt: null, lastErrorKey: 'rate_limited', consecutiveFailures: 2 }, '2': { lastSuccessAt: null, lastErrorKey: '<script>', consecutiveFailures: 1 } } });
    expect(screen.getAllByText('Instagram is limiting requests. Sync retries automatically.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Something went wrong. Please try again.').length).toBeGreaterThan(0);
  });

  it('a stale error key is hidden once failures reset', () => {
    setup({ accounts: [acct({ id: '1', username: 'a' })], sync: { '1': { lastSuccessAt: '2026-10-14T02:00:00Z', lastErrorKey: 'rate_limited', consecutiveFailures: 0 } } });
    expect(screen.queryByText(/limiting requests/)).not.toBeInTheDocument();
  });

  it('"Sync now" calls the action for active accounts and is absent for accounts needing reconnect', async () => {
    const actions = setup({ accounts: [acct({ id: '1', username: 'a' }), acct({ id: '3', username: 'c', status: 'needs_reconnect' })] });
    const menus = screen.getAllByRole('button', { name: 'Account actions' });
    await userEvent.click(menus[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sync now' }));
    expect(actions.syncNow).toHaveBeenCalledWith('1');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[1]);
    expect(await screen.findByRole('menuitem', { name: 'Edit group' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('a failed sync shows its translated error', async () => {
    const actions = setup({ accounts: [acct({ id: '1', username: 'a' })] });
    actions.syncNow.mockResolvedValueOnce({ ok: false, error: 'busy' } as never);
    await userEvent.click(screen.getAllByRole('button', { name: 'Account actions' })[0]);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sync now' }));
    expect(await screen.findByText('A sync is already running for this account.')).toBeInTheDocument();
  });

  it('renders the sync column in Simplified Chinese', () => {
    setup({ accounts: [acct({ id: '1', username: 'a' })] }, 'zh-CN');
    expect(screen.getAllByText('尚未同步').length).toBeGreaterThan(0);
    expect(screen.getAllByText('上次同步').length).toBeGreaterThan(0);
  });
});
