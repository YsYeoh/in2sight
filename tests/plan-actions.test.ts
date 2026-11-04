// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const requireOwner = vi.fn();
const createServerSupabase = vi.fn();
const saveGoals = vi.fn();
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => createServerSupabase() }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ timezone: 'UTC' }) }));
vi.mock('@/lib/plan/goals', async (orig) => ({ ...(await orig<typeof import('@/lib/plan/goals')>()), saveGoals: (...a: unknown[]) => saveGoals(...a) }));

import { saveGoalsAction } from '@/app/(app)/plan/actions';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-29T10:00:00Z') });
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('owner'));
  createServerSupabase.mockReset().mockImplementation(async () => (calls.push('client'), {}));
  saveGoals.mockReset().mockImplementation(async () => (calls.push('save'), { ok: true }));
  revalidatePath.mockReset();
});

describe('saveGoalsAction', () => {
  it('owner first, then the owner-session client, then the save; revalidates /plan', async () => {
    expect(await saveGoalsAction(A, { posts_per_week: '3' })).toEqual({ ok: true });
    expect(calls).toEqual(['owner', 'client', 'save']);
    expect(saveGoals.mock.calls[0][1]).toBe(A);
    expect(saveGoals.mock.calls[0][2]).toEqual({ followers: null, avg_reach: null, posts_per_week: { target: 3, dueDay: null } });
    expect(revalidatePath).toHaveBeenCalledWith('/plan', 'layout');
  });

  it('stops when requireOwner throws (a redirect)', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(saveGoalsAction(A, {})).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('invalid input or a non-string id never reaches the database', async () => {
    expect(await saveGoalsAction(A, { followers: '10', followersDue: '2026-02-30' })).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoalsAction(42, {})).toEqual({ ok: false, error: 'invalid' });
    expect(calls).toEqual(['owner', 'owner']);
  });

  it('passes the store’s error key through; a throw is "unexpected"; no revalidate on failure', async () => {
    saveGoals.mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    expect(await saveGoalsAction(A, {})).toEqual({ ok: false, error: 'needs_update' });
    saveGoals.mockRejectedValueOnce(new Error('secret'));
    expect(await saveGoalsAction(A, {})).toEqual({ ok: false, error: 'unexpected' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
