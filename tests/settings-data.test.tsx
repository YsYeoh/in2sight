import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { Usage } from '@/lib/data/usage';

const A = '11111111-1111-1111-1111-111111111111';
const server = vi.hoisted(() => ({ calls: [] as string[], usage: null as Usage | null, action: vi.fn(), download: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (server.calls.push('owner'), { userId: 'u1', email: 'o@x.y' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (await import('@/lib/prefs')).DEFAULT_PREFS }));
vi.mock('@/lib/data/usage', () => ({ readUsage: async () => (server.calls.push('usage'), server.usage) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ list: async () => [{ id: A, username: 'yseny_' }] }) }));
vi.mock('@/lib/data/delete', () => ({ DELETE_PHRASE: 'DELETE' }));
vi.mock('@/app/(app)/settings/data-actions', () => ({ deleteAllDataAction: (...a: unknown[]) => server.action(...a) }));
vi.mock('@/lib/export/download', () => ({ downloadExport: (...a: unknown[]) => server.download(...a) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: server.refresh }) }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en.json')).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) };
});

import { DataSection } from '@/components/settings/sections/DataSection';

const D = en.settings.data;
const show = async () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {await DataSection()}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  server.calls.length = 0;
  server.usage = {
    database: 50 * 1024 * 1024,
    groups: [
      { id: 'insights', rows: 1200, bytes: 2 * 1024 * 1024 },
      { id: 'posts', rows: null, bytes: 1024 },
      { id: 'comments', rows: 3, bytes: 0 },
      { id: 'followers', rows: 1, bytes: 1536 },
      { id: 'other', rows: 9, bytes: 512 },
    ],
    covers: [
      { folder: A, files: 12, bytes: 3 * 1024 * 1024 },
      { folder: '22222222-2222-2222-2222-222222222222', files: 1, bytes: 100 },
    ],
  };
  server.action.mockReset().mockResolvedValue({ ok: true, accounts: 2, coversDone: true });
  server.download.mockReset().mockResolvedValue({ ok: true });
  server.refresh.mockReset();
});

describe('Settings -> Data & privacy', () => {
  it('checks the owner first, then shows what is stored, storage used, export and delete', async () => {
    await show();
    expect(server.calls[0]).toBe('owner');
    expect(screen.getByText(D.privacy)).toBeInTheDocument();
    expect(screen.getByText('50 MB')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: D.usage.groups.insights })).toBeInTheDocument();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // unknown row count, never 0
    expect(screen.getByText('@yseny_')).toBeInTheDocument();
    expect(screen.getByText(D.usage.unlinked)).toBeInTheDocument();
    expect(screen.getByText(/12 images · 3 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: D.export.all })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: D.deleteAll.open })).toBeInTheDocument();
    expect(screen.queryByText(/coming/)).toBeNull(); // the 16a placeholder line is gone
  });

  it('without the migration the storage card says it needs a database update', async () => {
    server.usage = null;
    await show();
    expect(screen.getByText(D.usage.needsUpdate)).toBeInTheDocument();
  });

  it('Download all fetches one table at a time and leaves out other people’s data unless ticked', async () => {
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: D.export.all }));
    const urls = server.download.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(18);
    expect(urls.some((u) => /table=(comments|follower_exports)\b/.test(u))).toBe(false);
    expect(server.download.mock.calls.every((c) => c[1] === 'json')).toBe(true);
    expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();

    server.download.mockClear();
    await user.click(screen.getByRole('checkbox', { name: D.export.others }));
    await user.click(screen.getByRole('button', { name: D.export.all }));
    expect(server.download.mock.calls).toHaveLength(20);
  });

  it('a failed file stops the run and shows the export error', async () => {
    const user = userEvent.setup();
    server.download.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'unexpected' });
    await show();
    await user.click(screen.getByRole('button', { name: D.export.all }));
    expect(server.download).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.export.errors.unexpected);
  });

  it('delete: the confirm button stays disabled until the exact word is typed; success closes and refreshes', async () => {
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: D.deleteAll.open }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: D.deleteAll.confirm });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(D.deleteAll.password), 'the owner password');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(confirm).toBeEnabled();
    await act(async () => user.click(confirm));
    const fd = server.action.mock.calls[0][1] as FormData;
    expect(fd.get('phrase')).toBe('DELETE');
    expect(fd.get('password')).toBe('the owner password');
    expect(await screen.findByText('All data of 2 accounts was deleted.')).toBeInTheDocument();
    expect(server.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a wrong password shows on the password field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    server.action.mockResolvedValueOnce({ error: 'wrong_password' });
    await show();
    await user.click(screen.getByRole('button', { name: D.deleteAll.open }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(D.deleteAll.password), 'nope');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await act(async () => user.click(within(dialog).getByRole('button', { name: D.deleteAll.confirm })));
    expect(await within(dialog).findByText(D.deleteAll.errors.wrong_password)).toBeInTheDocument();
    expect(server.refresh).not.toHaveBeenCalled();
  });
});
