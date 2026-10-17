import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const state = vi.hoisted(() => ({ deleted: { ok: true } as { ok: boolean; error?: string }, removed: [] as string[] }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => undefined }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => ({ __admin: true }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({}) }));
vi.mock('@/lib/accounts/service', () => ({ deleteAccountPermanently: async () => state.deleted, archiveAccount: vi.fn(), restoreAccount: vi.fn(), setAccountGroup: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/sync/store', async (orig) => ({ ...(await orig<typeof import('@/lib/sync/store')>()), removeAccountCovers: async (_db: unknown, id: string) => (state.removed.push(id), 0) }));

import { deleteAccountAction } from '@/app/(app)/accounts/actions';

beforeEach(() => {
  state.deleted = { ok: true };
  state.removed = [];
});

describe('permanent delete removes the account\'s cover objects', () => {
  it('after a successful delete only (archive keeps them; a refused delete removes nothing)', async () => {
    expect(await deleteAccountAction(ID)).toEqual({ ok: true });
    expect(state.removed).toEqual([ID]);
    state.deleted = { ok: false, error: 'not_archived' };
    state.removed = [];
    expect(await deleteAccountAction(ID)).toEqual({ ok: false, error: 'not_archived' });
    expect(state.removed).toEqual([]);
  });
});

describe('removeAccountCovers', () => {
  it('lists the account prefix and removes in batches until empty; never throws', async () => {
    const { removeAccountCovers: real } = await vi.importActual<typeof import('@/lib/sync/store')>('@/lib/sync/store');
    const pages = [[{ name: '1.jpg' }, { name: '2.jpg' }], [{ name: '3.jpg' }], []];
    const removed: string[][] = [];
    const lists: unknown[][] = [];
    const db = { storage: { from: (b: string) => ({ list: async (...a: unknown[]) => (lists.push([b, ...a]), { data: pages.shift(), error: null }), remove: async (paths: string[]) => (removed.push(paths), { data: [], error: null }) }) } };
    expect(await real(db as never, ID)).toBe(3);
    expect(lists[0]).toEqual(['covers', ID, { limit: 1000 }]);
    expect(removed).toEqual([[`${ID}/1.jpg`, `${ID}/2.jpg`], [`${ID}/3.jpg`]]);
    const broken = { storage: { from: () => ({ list: async () => Promise.reject(new Error('storage down')) }) } };
    expect(await real(broken as never, ID)).toBe(0);
    const failing = { storage: { from: () => ({ list: async () => ({ data: [{ name: 'x.jpg' }], error: null }), remove: async () => ({ data: null, error: { message: 'no' } }) }) } };
    expect(await real(failing as never, ID)).toBe(0); // stops instead of looping forever
  });
});
