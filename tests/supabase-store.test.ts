import { describe, expect, it } from 'vitest';
import { newToRow, patchToRow, rowToAccount, supabaseAccountsStore } from '@/lib/accounts/supabase-store';

type Call = { table: string; op: string; args: unknown[]; filters: [string, unknown][] };

function recorder(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {
        select: (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain),
        insert: (...a: unknown[]) => ((call.op = 'insert'), call.args.push(...a), chain),
        update: (...a: unknown[]) => ((call.op = 'update'), call.args.push(...a), chain),
        upsert: (...a: unknown[]) => ((call.op = 'upsert'), call.args.push(...a), chain),
        delete: () => ((call.op = 'delete'), chain),
        eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
        order: () => chain,
        maybeSingle: async () => result,
        single: async () => result,
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const row = { id: 'a1', ig_user_id: '1784', username: 'brandx', display_name: 'Brand X', account_type: 'Media_Creator', profile_picture_url: null, group_name: 'G', status: 'active', archived_at: null, last_error: null, token_expires_at: '2026-12-13T00:00:00Z', connected_at: '2026-10-14T00:00:00Z' };

describe('mappers', () => {
  it('rowToAccount maps snake_case to the domain shape', () => {
    expect(rowToAccount(row)).toEqual({ id: 'a1', igUserId: '1784', username: 'brandx', displayName: 'Brand X', accountType: 'Media_Creator', profilePictureUrl: null, groupName: 'G', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-13T00:00:00Z', connectedAt: '2026-10-14T00:00:00Z', grantedScopes: null });
  });
  it('patchToRow only emits the fields present in the patch', () => {
    expect(patchToRow({ status: 'archived', archivedAt: 'x' })).toEqual({ status: 'archived', archived_at: 'x' });
    expect(patchToRow({})).toEqual({});
    expect(patchToRow({ groupName: null })).toEqual({ group_name: null });
  });
  it('newToRow maps a new account', () => {
    expect(newToRow({ igUserId: '1', username: 'u', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, tokenExpiresAt: 't' })).toMatchObject({ ig_user_id: '1', username: 'u', group_name: null, token_expires_at: 't' });
  });
});

describe('supabaseAccountsStore', () => {
  it('findByIgUserId queries accounts by ig_user_id and maps the row', async () => {
    const { db, calls } = recorder({ data: row, error: null });
    expect((await supabaseAccountsStore(db).findByIgUserId('1784'))?.username).toBe('brandx');
    expect(calls[0]).toMatchObject({ table: 'accounts', filters: [['ig_user_id', '1784']] });
  });

  it('returns null when nothing is found', async () => {
    expect(await supabaseAccountsStore(recorder({ data: null, error: null }).db).getById('x')).toBeNull();
  });

  it('update filters by id', async () => {
    const { db, calls } = recorder({ data: row, error: null });
    await supabaseAccountsStore(db).update('a1', { status: 'active' });
    expect(calls[0]).toMatchObject({ table: 'accounts', op: 'update', filters: [['id', 'a1']] });
  });

  it('saveToken upserts into account_tokens keyed by account_id', async () => {
    const { db, calls } = recorder({ data: null, error: null });
    await supabaseAccountsStore(db).saveToken('a1', { accessToken: 'tok', expiresAt: '2026-12-13T00:00:00Z' });
    expect(calls[0]).toMatchObject({ table: 'account_tokens', op: 'upsert' });
    expect(calls[0].args[0]).toMatchObject({ account_id: 'a1', access_token: 'tok', expires_at: '2026-12-13T00:00:00Z' });
  });

  it('remove deletes the account row by id (tokens cascade in the database)', async () => {
    const { db, calls } = recorder({ data: null, error: null });
    await supabaseAccountsStore(db).remove('a1');
    expect(calls[0]).toMatchObject({ table: 'accounts', op: 'delete', filters: [['id', 'a1']] });
  });

  it('list returns mapped accounts', async () => {
    const { db } = recorder({ data: [row], error: null });
    expect((await supabaseAccountsStore(db).list()).map((a) => a.id)).toEqual(['a1']);
  });

  it('a Supabase error becomes a generic error that never leaks the original message or the token', async () => {
    const { db } = recorder({ data: null, error: { message: 'duplicate key value violates unique constraint "secret-ish" tok_abc' } });
    const store = supabaseAccountsStore(db);
    for (const run of [() => store.list(), () => store.saveToken('a1', { accessToken: 'tok_abc', expiresAt: 'x' }), () => store.remove('a1')]) {
      await expect(run()).rejects.toThrow(/accounts store: \w+ failed/);
      await expect(run()).rejects.not.toThrow(/tok_abc|secret-ish/);
    }
  });
});
