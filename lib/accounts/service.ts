import { normalizeGroup } from '@/lib/accounts/group';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';

export interface ConnectInput {
  igUserId: string;
  username: string;
  displayName?: string | null;
  accountType?: string | null;
  profilePictureUrl?: string | null;
  groupName?: string | null; // undefined = keep the existing group
  accessToken: string;
  expiresAt: string;
  /** What Meta granted with THIS token (null = not reported). Always overwritten: an old token's scopes no longer apply. */
  grantedScopes?: string[] | null;
}

export async function connectAccount(store: AccountsStore, input: ConnectInput): Promise<{ account: StoredAccount; outcome: 'created' | 'updated' | 'restored' }> {
  const profile = {
    username: input.username,
    displayName: input.displayName ?? null,
    accountType: input.accountType ?? null,
    profilePictureUrl: input.profilePictureUrl ?? null,
    tokenExpiresAt: input.expiresAt,
    grantedScopes: input.grantedScopes ?? null,
  };
  const existing = await store.findByIgUserId(input.igUserId);
  let account: StoredAccount;
  let outcome: 'created' | 'updated' | 'restored';
  if (!existing) {
    account = await store.insert({ igUserId: input.igUserId, ...profile, groupName: input.groupName ?? null });
    outcome = 'created';
  } else {
    outcome = existing.status === 'archived' ? 'restored' : 'updated';
    account = await store.update(existing.id, {
      ...profile,
      status: 'active',
      archivedAt: null,
      lastError: null,
      ...(input.groupName !== undefined ? { groupName: input.groupName } : {}),
    });
  }
  await store.saveToken(account.id, { accessToken: input.accessToken, expiresAt: input.expiresAt });
  return { account, outcome };
}

type Simple = { ok: true } | { ok: false; error: 'not_found' | 'not_archived' };

export async function archiveAccount(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') await store.update(id, { status: 'archived', archivedAt: new Date().toISOString() });
  return { ok: true };
}

export async function restoreAccount(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') return { ok: false, error: 'not_archived' };
  await store.update(id, { status: 'active', archivedAt: null });
  return { ok: true };
}

export async function deleteAccountPermanently(store: AccountsStore, id: string): Promise<Simple> {
  const a = await store.getById(id);
  if (!a) return { ok: false, error: 'not_found' };
  if (a.status !== 'archived') return { ok: false, error: 'not_archived' };
  await store.remove(id);
  return { ok: true };
}

export async function setAccountGroup(store: AccountsStore, id: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'invalid_group' }> {
  const g = normalizeGroup(raw);
  if (!g.ok) return { ok: false, error: 'invalid_group' };
  if (!(await store.getById(id))) return { ok: false, error: 'not_found' };
  await store.update(id, { groupName: g.value });
  return { ok: true };
}

export async function markNeedsReconnect(store: AccountsStore, igUserId: string, reason: string): Promise<void> {
  const a = await store.findByIgUserId(igUserId);
  if (!a || a.status === 'archived') return;
  await store.update(a.id, { status: 'needs_reconnect', lastError: reason.slice(0, 200) });
}
