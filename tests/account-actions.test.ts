import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, service } = vi.hoisted(() => ({
  calls: [] as string[],
  requireOwner: vi.fn(),
  service: {
    archiveAccount: vi.fn(),
    restoreAccount: vi.fn(),
    deleteAccountPermanently: vi.fn(),
    setAccountGroup: vi.fn(),
  },
}));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('admin'), {}) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ __fake: true }) }));
vi.mock('@/lib/accounts/service', () => service);
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => calls.push(`revalidate:${p}`) }));

import { archiveAccountAction, deleteAccountAction, restoreAccountAction, setGroupAction } from '@/app/(app)/accounts/actions';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('requireOwner'));
  for (const f of Object.values(service)) f.mockReset().mockImplementation(async () => (calls.push('service'), { ok: true }));
});

const cases = [
  ['archive', (id: unknown) => archiveAccountAction(id as string), 'archiveAccount'],
  ['restore', (id: unknown) => restoreAccountAction(id as string), 'restoreAccount'],
  ['delete', (id: unknown) => deleteAccountAction(id as string), 'deleteAccountPermanently'],
  ['setGroup', (id: unknown) => setGroupAction(id as string, 'G'), 'setAccountGroup'],
] as const;

describe.each(cases)('%s action', (_name, run, fn) => {
  it('authorizes the owner before the admin client or the service', async () => {
    await run(ID);
    expect(calls.slice(0, 3)).toEqual(['requireOwner', 'admin', 'service']);
  });

  it('rejects and touches nothing when requireOwner redirects or throws', async () => {
    requireOwner.mockRejectedValue(new Error('REDIRECT:/auth/signout'));
    await expect(run(ID)).rejects.toThrow('REDIRECT');
    expect(calls).toEqual([]);
    expect(service[fn]).not.toHaveBeenCalled();
  });

  it('runs the service and revalidates /accounts on success', async () => {
    expect(await run(ID)).toEqual({ ok: true });
    expect(service[fn]).toHaveBeenCalledTimes(1);
    expect(service[fn].mock.calls[0][1]).toBe(ID);
    expect(calls).toContain('revalidate:/accounts');
  });

  it('passes service error codes through without revalidating', async () => {
    service[fn].mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect(await run(ID)).toEqual({ ok: false, error: 'not_found' });
    expect(calls).not.toContain('revalidate:/accounts');
  });

  it('an unexpected exception becomes a generic error with no message', async () => {
    service[fn].mockRejectedValueOnce(new Error('db password hunter2'));
    const r = await run(ID);
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(calls).not.toContain('revalidate:/accounts');
  });

  it.each([['a1'], [''], [undefined], [null], [{ toString: (): string => ID }], [`${ID}x`]])('a non-uuid id (%j) is not_found and never reaches the store', async (bad) => {
    expect(await run(bad)).toEqual({ ok: false, error: 'not_found' });
    expect(calls).not.toContain('admin');
    expect(service[fn]).not.toHaveBeenCalled();
  });
});

describe('setGroupAction', () => {
  it('normalises the group before the service sees it', async () => {
    await setGroupAction(ID, '  Brand \t X ');
    expect(service.setAccountGroup.mock.calls[0][2]).toBe('Brand X');
  });

  it('a blank group clears it (null)', async () => {
    await setGroupAction(ID, '   ');
    expect(service.setAccountGroup.mock.calls[0][2]).toBeNull();
  });

  it.each([['x'.repeat(41)], ['bad\u0007'], [42 as unknown as string], [{} as unknown as string]])('an invalid group (%j) is invalid_group and never reaches the store', async (bad) => {
    expect(await setGroupAction(ID, bad)).toEqual({ ok: false, error: 'invalid_group' });
    expect(calls).not.toContain('admin');
    expect(service.setAccountGroup).not.toHaveBeenCalled();
  });
});
