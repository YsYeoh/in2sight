// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

type Op = unknown[];
const { calls, queue, requireOwner } = vi.hoisted(() => ({ calls: [] as Op[], queue: [] as { data?: unknown; error?: unknown }[], requireOwner: vi.fn() }));
const next = () => Promise.resolve(queue.shift() ?? { data: [], error: null });

/** Owner-session fake: records every call; each awaited query or rpc resolves to the next queued result. */
function fakeDb(): SupabaseClient {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(['rpc', fn, args]);
      return next();
    },
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'in', 'upsert']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));

import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
import { loadUnansweredCounts } from '@/lib/comments/read';
import { QUESTION_PATTERN } from '@/lib/comments/question';
import { loadDismissals, saveDismissal } from '@/lib/dashboard/dismissals';
import { EXPORT_TABLES } from '@/lib/data/export';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const KEY = `best_slot:${A}:2:evening`;
const NOW = new Date('2026-10-15T04:00:00Z');

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('loadDismissals', () => {
  it('reads by the keys on screen, in chunks of 50, deduplicated', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `k${i}`);
    queue.push({ data: [{ finding_key: 'k1', until: null }], error: null }, { data: [{ finding_key: 'k60', until: '2026-10-20T00:00:00+00:00' }], error: null }, { data: [], error: null });
    expect(await loadDismissals(fakeDb(), [...keys, 'k1'])).toEqual([{ key: 'k1', until: null }, { key: 'k60', until: '2026-10-20T00:00:00+00:00' }]);
    const ins = calls.filter((c) => c[0] === 'in');
    expect(ins.map((c) => (c[2] as string[]).length)).toEqual([50, 50, 20]);
    expect(calls).toContainEqual(['from', 'insight_dismissals']);
    expect(calls).toContainEqual(['select', 'finding_key,until']);
  });

  it('no keys = no request; any error (a missing table too) = null, never a throw', async () => {
    expect(await loadDismissals(fakeDb(), [])).toEqual([]);
    expect(calls).toEqual([]);
    queue.push({ data: null, error: { code: 'PGRST205', message: 'secret' } });
    expect(await loadDismissals(fakeDb(), ['a'])).toBeNull();
    queue.push({ data: null, error: { code: 'XX000' } });
    expect(await loadDismissals(fakeDb(), ['a'])).toBeNull();
  });
});

describe('saveDismissal', () => {
  it('dismiss = until null; snooze = 7 days; one upsert on the key', async () => {
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: true });
    expect(calls).toContainEqual(['upsert', { finding_key: KEY, account_id: A, until: null }, { onConflict: 'finding_key' }]);
    calls.length = 0;
    await saveDismissal(fakeDb(), KEY, A, 'snooze', NOW);
    expect(calls).toContainEqual(['upsert', { finding_key: KEY, account_id: A, until: '2026-10-22T04:00:00.000Z' }, { onConflict: 'finding_key' }]);
  });

  it('errors are keys: missing table, unknown account, anything else', async () => {
    queue.push({ error: { code: 'PGRST205' } }, { error: { code: '23503' } }, { error: { code: 'XX000', message: 'secret' } });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'needs_update' });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'unexpected' });
  });
});

describe('dismissFindingAction', () => {
  it('requireOwner first, then the owner session (never the admin client)', async () => {
    expect(await dismissFindingAction(KEY, 'snooze')).toEqual({ ok: true });
    expect(calls[0]).toEqual(['requireOwner']);
    expect(calls).toContainEqual(['session']);
    expect(calls).not.toContainEqual(['ADMIN']);
  });

  it('a redirect from requireOwner propagates and nothing is written', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(dismissFindingAction(KEY, 'dismiss')).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('refuses a bad key or mode before touching the database', async () => {
    for (const [k, m] of [[`nope:${A}:1`, 'dismiss'], [KEY, 'forever'], [42, 'dismiss']] as const) expect(await dismissFindingAction(k as string, m as 'dismiss')).toEqual({ ok: false, error: 'invalid' });
    expect(calls.filter((c) => c[0] !== 'requireOwner')).toEqual([]);
  });
});

describe('loadUnansweredCounts', () => {
  const acc = (id: string, scopes: string[] | null) => ({ id, username: 'Me.Shop', grantedScopes: scopes });
  it('one comment_list call of one row per account with the comments scope; counts only', async () => {
    queue.push({ data: [{ id: 'c', author_username: 'amy', body: 'where?', total: 4 }], error: null });
    const out = await loadUnansweredCounts(fakeDb(), [acc(A, ['instagram_business_manage_comments']), acc('b', null)], '2026-10-15', 'Asia/Kuala_Lumpur');
    expect(out).toEqual({ [A]: 4, b: null });
    expect(calls).toEqual([
      ['rpc', 'comment_list', { p_account: A, p_from: '2026-10-08T16:00:00.000Z', p_to: '2026-10-15T16:00:00.000Z', p_q: null, p_media: null, p_question_re: QUESTION_PATTERN, p_unanswered: true, p_fan_min: null, p_owner: 'me.shop', p_offset: 0, p_limit: 1 }],
    ]);
  });

  it('no rows = 0; a missing function or a failed read = null (the page never breaks)', async () => {
    const one = [acc(A, ['instagram_business_manage_comments'])];
    queue.push({ data: [], error: null }, { data: null, error: { code: 'PGRST202' } }, { data: null, error: { code: 'XX000' } });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: 0 });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: null });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: null });
  });
});

describe('export', () => {
  it('"Export your data" includes the dismissals (owner-authored, not third-party)', () => {
    expect(EXPORT_TABLES.find((t) => t.name === 'insight_dismissals')).toEqual({ name: 'insight_dismissals', keys: ['finding_key'] });
  });
});
