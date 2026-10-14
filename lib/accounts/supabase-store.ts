import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountPatch, AccountsStore, NewAccount, StoredAccount } from '@/lib/accounts/types';

type Row = Record<string, unknown>;

export function rowToAccount(r: Row): StoredAccount {
  return {
    id: r.id as string,
    igUserId: r.ig_user_id as string,
    username: r.username as string,
    displayName: (r.display_name as string | null) ?? null,
    accountType: (r.account_type as string | null) ?? null,
    profilePictureUrl: (r.profile_picture_url as string | null) ?? null,
    groupName: (r.group_name as string | null) ?? null,
    status: r.status as StoredAccount['status'],
    archivedAt: (r.archived_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    tokenExpiresAt: (r.token_expires_at as string | null) ?? null,
    connectedAt: r.connected_at as string,
  };
}

const PATCH_COLUMNS: Record<string, string> = {
  username: 'username',
  displayName: 'display_name',
  accountType: 'account_type',
  profilePictureUrl: 'profile_picture_url',
  groupName: 'group_name',
  status: 'status',
  archivedAt: 'archived_at',
  lastError: 'last_error',
  tokenExpiresAt: 'token_expires_at',
};

export function patchToRow(patch: AccountPatch): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) if (k in PATCH_COLUMNS) out[PATCH_COLUMNS[k]] = v;
  return out;
}

export function newToRow(a: NewAccount): Row {
  return {
    ig_user_id: a.igUserId,
    username: a.username,
    display_name: a.displayName,
    account_type: a.accountType,
    profile_picture_url: a.profilePictureUrl,
    group_name: a.groupName,
    token_expires_at: a.tokenExpiresAt,
  };
}

function fail(op: string): never {
  // never include the Supabase message: it can echo values (including tokens)
  throw new Error(`accounts store: ${op} failed`);
}

export function supabaseAccountsStore(db: SupabaseClient): AccountsStore {
  return {
    async list() {
      const { data, error } = await db.from('accounts').select('*').order('connected_at', { ascending: true });
      if (error) fail('list');
      return ((data ?? []) as Row[]).map(rowToAccount);
    },
    async getById(id) {
      const { data, error } = await db.from('accounts').select('*').eq('id', id).maybeSingle();
      if (error) fail('getById');
      return data ? rowToAccount(data as Row) : null;
    },
    async findByIgUserId(igUserId) {
      const { data, error } = await db.from('accounts').select('*').eq('ig_user_id', igUserId).maybeSingle();
      if (error) fail('findByIgUserId');
      return data ? rowToAccount(data as Row) : null;
    },
    async insert(a) {
      const { data, error } = await db.from('accounts').insert(newToRow(a)).select('*').single();
      if (error || !data) fail('insert');
      return rowToAccount(data as Row);
    },
    async update(id, patch) {
      const { data, error } = await db.from('accounts').update(patchToRow(patch)).eq('id', id).select('*').single();
      if (error || !data) fail('update');
      return rowToAccount(data as Row);
    },
    async saveToken(accountId, token) {
      const { error } = await db.from('account_tokens').upsert({ account_id: accountId, access_token: token.accessToken, expires_at: token.expiresAt, refreshed_at: new Date().toISOString() });
      if (error) fail('saveToken');
    },
    async remove(id) {
      const { error } = await db.from('accounts').delete().eq('id', id);
      if (error) fail('remove');
    },
  };
}
