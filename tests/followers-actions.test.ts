import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, result } = vi.hoisted(() => ({ calls: [] as unknown[][], requireOwner: vi.fn(), result: { deleted: true as boolean | Error } }));

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => (calls.push(['requireOwner']), requireOwner()) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), { db: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/followers/read', () => ({
  deleteFollowerSnapshot: async (db: unknown, accountId: string, id: string) => {
    calls.push(['delete', db, accountId, id]);
    if (result.deleted instanceof Error) throw result.deleted;
    return result.deleted;
  },
}));

import { deleteFollowerSnapshotAction } from '@/app/(app)/accounts/followers-actions';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SNAP = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset();
  result.deleted = true;
});

describe('deleteFollowerSnapshotAction', () => {
  it('owner first, then the owner-session delete of THIS account\'s snapshot, then the account page revalidates', async () => {
    expect(await deleteFollowerSnapshotAction(ACC.toUpperCase(), SNAP)).toEqual({ ok: true });
    expect(calls).toEqual([['requireOwner'], ['session'], ['delete', { db: true }, ACC, SNAP], ['revalidate', '/accounts/[id]', 'page']]);
  });

  it('a non-owner never reaches the database (requireOwner redirects by throwing)', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT /auth/signout'));
    await expect(deleteFollowerSnapshotAction(ACC, SNAP)).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([['requireOwner']]);
  });

  it('bad ids or nothing deleted → notFound; a failure → unexpected; never the admin client', async () => {
    expect(await deleteFollowerSnapshotAction('x', SNAP)).toEqual({ ok: false, error: 'notFound' });
    expect(await deleteFollowerSnapshotAction(ACC, "1' or '1'='1")).toEqual({ ok: false, error: 'notFound' });
    result.deleted = false;
    expect(await deleteFollowerSnapshotAction(ACC, SNAP)).toEqual({ ok: false, error: 'notFound' });
    result.deleted = new Error('db down');
    expect(await deleteFollowerSnapshotAction(ACC, SNAP)).toEqual({ ok: false, error: 'unexpected' });
    expect(calls.some((c) => c[0] === 'ADMIN' || c[0] === 'revalidate')).toBe(false);
  });
});
