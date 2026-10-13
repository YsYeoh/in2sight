import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const requireOwner = vi.fn();
const createServerSupabase = vi.fn();
const startEnroll = vi.fn();
const confirmEnroll = vi.fn();
const disableFactor = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => createServerSupabase() }));
vi.mock('@/lib/auth/mfa', () => ({
  startEnroll: (...a: unknown[]) => startEnroll(...a),
  confirmEnroll: (...a: unknown[]) => confirmEnroll(...a),
  disableFactor: (...a: unknown[]) => disableFactor(...a),
}));

import { confirmEnrollAction, disableAction, startEnrollAction } from '@/app/(app)/settings/actions';

const actions = {
  startEnrollAction: () => startEnrollAction(),
  confirmEnrollAction: () => confirmEnrollAction('f1', '123456'),
  disableAction: () => disableAction('f1'),
};

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('requireOwner'));
  createServerSupabase.mockReset().mockImplementation(async () => (calls.push('client'), {}));
  for (const m of [startEnroll, confirmEnroll, disableFactor]) m.mockReset().mockImplementation(async () => (calls.push('mfa'), { ok: true }));
});

describe.each(Object.entries(actions))('%s', (_name, run) => {
  it('authorizes the owner before touching Supabase or MFA', async () => {
    await run();
    expect(calls.slice(0, 2)).toEqual(['requireOwner', 'client']);
    expect(calls).toContain('mfa');
  });

  it('does nothing further when requireOwner redirects or throws', async () => {
    requireOwner.mockRejectedValue(new Error('REDIRECT:/auth/signout'));
    await expect(run()).rejects.toThrow('REDIRECT');
    expect(calls).toEqual([]);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });
});
