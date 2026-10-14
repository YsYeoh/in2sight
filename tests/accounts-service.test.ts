import { describe, expect, it } from 'vitest';
import type { AccountPatch, AccountsStore, NewAccount, StoredAccount } from '@/lib/accounts/types';
import { archiveAccount, connectAccount, deleteAccountPermanently, markNeedsReconnect, restoreAccount, setAccountGroup } from '@/lib/accounts/service';

function memoryStore() {
  const rows = new Map<string, StoredAccount>();
  const tokens = new Map<string, { accessToken: string; expiresAt: string }>();
  let n = 0;
  const store: AccountsStore = {
    list: async () => [...rows.values()],
    getById: async (id) => rows.get(id) ?? null,
    findByIgUserId: async (ig) => [...rows.values()].find((r) => r.igUserId === ig) ?? null,
    insert: async (a: NewAccount) => {
      const row: StoredAccount = { id: `a${++n}`, ...a, status: 'active', archivedAt: null, lastError: null, connectedAt: '2026-10-14T00:00:00Z' };
      rows.set(row.id, row);
      return row;
    },
    update: async (id, patch: AccountPatch) => {
      const next = { ...rows.get(id)!, ...patch };
      rows.set(id, next);
      return next;
    },
    saveToken: async (id, t) => void tokens.set(id, t),
    remove: async (id) => void (rows.delete(id), tokens.delete(id)),
  };
  return { store, rows, tokens };
}

const input = { igUserId: '1784', username: 'brandx', displayName: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: null, accessToken: 'tok1', expiresAt: '2026-12-13T00:00:00Z' };

describe('connectAccount', () => {
  it('creates a new active account with its token', async () => {
    const { store, tokens } = memoryStore();
    const r = await connectAccount(store, { ...input, groupName: 'Brand X' });
    expect(r.outcome).toBe('created');
    expect(r.account).toMatchObject({ igUserId: '1784', username: 'brandx', status: 'active', groupName: 'Brand X', tokenExpiresAt: '2026-12-13T00:00:00Z' });
    expect(tokens.get(r.account.id)).toEqual({ accessToken: 'tok1', expiresAt: '2026-12-13T00:00:00Z' });
  });

  it('a new account without a group is isolated (null)', async () => {
    const { store } = memoryStore();
    expect((await connectAccount(store, input)).account.groupName).toBeNull();
  });

  it('connecting again updates the same row and token, never duplicating by ig_user_id', async () => {
    const { store, rows, tokens } = memoryStore();
    const first = await connectAccount(store, { ...input, groupName: 'G' });
    const again = await connectAccount(store, { ...input, username: 'brandx_new', accessToken: 'tok2' });
    expect(again.outcome).toBe('updated');
    expect(again.account.id).toBe(first.account.id);
    expect(rows.size).toBe(1);
    expect(again.account.username).toBe('brandx_new');
    expect(again.account.groupName).toBe('G'); // undefined group keeps the existing one
    expect(tokens.get(first.account.id)?.accessToken).toBe('tok2');
  });

  it('an explicit null group isolates an account, a string regroups it', async () => {
    const { store } = memoryStore();
    await connectAccount(store, { ...input, groupName: 'G' });
    expect((await connectAccount(store, { ...input, groupName: null })).account.groupName).toBeNull();
    expect((await connectAccount(store, { ...input, groupName: 'H' })).account.groupName).toBe('H');
  });

  it('reconnecting an archived account restores the SAME row, clears the error, keeps history identity', async () => {
    const { store, rows } = memoryStore();
    const first = await connectAccount(store, { ...input, groupName: 'G' });
    await archiveAccount(store, first.account.id);
    await store.update(first.account.id, { lastError: 'old' });
    const again = await connectAccount(store, input);
    expect(again.outcome).toBe('restored');
    expect(again.account).toMatchObject({ id: first.account.id, status: 'active', archivedAt: null, lastError: null, groupName: 'G' });
    expect(rows.size).toBe(1);
  });

  it('reconnecting a needs_reconnect account makes it active again', async () => {
    const { store } = memoryStore();
    const first = await connectAccount(store, input);
    await markNeedsReconnect(store, '1784', 'token revoked');
    const again = await connectAccount(store, input);
    expect(again.outcome).toBe('updated');
    expect(again.account).toMatchObject({ id: first.account.id, status: 'active', lastError: null });
  });
});

describe('archive / restore / delete', () => {
  it('archive hides the account but keeps the row; idempotent', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await archiveAccount(store, account.id)).toEqual({ ok: true });
    expect(rows.get(account.id)).toMatchObject({ status: 'archived' });
    expect(rows.get(account.id)!.archivedAt).toBeTruthy();
    expect(await archiveAccount(store, account.id)).toEqual({ ok: true });
  });

  it('unknown ids are not_found', async () => {
    const { store } = memoryStore();
    expect(await archiveAccount(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await restoreAccount(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteAccountPermanently(store, 'zzz')).toEqual({ ok: false, error: 'not_found' });
    expect(await setAccountGroup(store, 'zzz', 'G')).toEqual({ ok: false, error: 'not_found' });
  });

  it('restore only works on archived accounts', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await restoreAccount(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    await archiveAccount(store, account.id);
    expect(await restoreAccount(store, account.id)).toEqual({ ok: true });
    expect(rows.get(account.id)).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('permanent delete refuses anything that is not archived, and removes row + token when archived', async () => {
    const { store, rows, tokens } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    expect(rows.size).toBe(1);
    await markNeedsReconnect(store, '1784', 'x');
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: false, error: 'not_archived' });
    await archiveAccount(store, account.id);
    expect(await deleteAccountPermanently(store, account.id)).toEqual({ ok: true });
    expect(rows.size).toBe(0);
    expect(tokens.size).toBe(0);
  });
});

describe('setAccountGroup', () => {
  it('sets, clears and rejects invalid groups', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    expect(await setAccountGroup(store, account.id, ' Brand  X ')).toEqual({ ok: true });
    expect(rows.get(account.id)!.groupName).toBe('Brand X');
    expect(await setAccountGroup(store, account.id, '')).toEqual({ ok: true });
    expect(rows.get(account.id)!.groupName).toBeNull();
    expect(await setAccountGroup(store, account.id, 'x'.repeat(41))).toEqual({ ok: false, error: 'invalid_group' });
    expect(await setAccountGroup(store, account.id, 'a\u0000')).toEqual({ ok: false, error: 'invalid_group' });
    expect(rows.get(account.id)!.groupName).toBeNull();
  });
});

describe('markNeedsReconnect', () => {
  it('flags an active account with a truncated reason', async () => {
    const { store, rows } = memoryStore();
    const { account } = await connectAccount(store, input);
    await markNeedsReconnect(store, '1784', 'r'.repeat(500));
    expect(rows.get(account.id)).toMatchObject({ status: 'needs_reconnect' });
    expect(rows.get(account.id)!.lastError).toHaveLength(200);
  });

  it('does nothing for unknown accounts and never resurrects an archived one', async () => {
    const { store, rows } = memoryStore();
    await markNeedsReconnect(store, 'nope', 'x'); // must not throw
    const { account } = await connectAccount(store, input);
    await archiveAccount(store, account.id);
    await markNeedsReconnect(store, '1784', 'revoked');
    expect(rows.get(account.id)!.status).toBe('archived');
  });
});
