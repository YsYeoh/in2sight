// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagRule } from '@/lib/tag-rules/rules';

type Op = unknown[];
const { calls, requireOwner, queue, apply } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
  apply: { rules: [] as TagRule[] | null, result: { posts: 0, tags: 0 } },
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'delete', 'eq']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/tag-rules/apply', async (orig) => ({
  ...(await orig<typeof import('@/lib/tag-rules/apply')>()),
  loadRules: async () => (calls.push(['loadRules']), apply.rules),
  loadRuleMedia: async () => (calls.push(['loadRuleMedia']), [{ id: 'p1', caption: '#food', kind: 'IMAGE', postedAt: 'T' }]),
  applyTagRules: async (_db: unknown, o: { rules: TagRule[]; scope: string; dryRun: boolean }) => (calls.push(['apply', o.rules.map((r) => r.id), o.scope, o.dryRun]), apply.result),
}));

import { addTagRuleAction, applyTagRulesAction, deleteTagRuleAction, previewTagRulesAction } from '@/app/(app)/tags/actions';
import { MAX_RULES } from '@/lib/tag-rules/rules';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const rule = (id: string, tagId: string): TagRule => ({ id, tagId, kind: 'hashtag', value: 'food', createdAt: 'T' });
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  apply.rules = [];
  apply.result = { posts: 0, tags: 0 };
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('tag rule actions: authorization and validation', () => {
  it.each([
    ['add', () => addTagRuleAction(T1, 'hashtag', 'food')],
    ['delete', () => deleteTagRuleAction(T1)],
    ['preview', () => previewTagRulesAction(T1)],
    ['apply', () => applyTagRulesAction(T1)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('bad input returns a key without opening a database client; never the admin client', async () => {
    expect(await addTagRuleAction('nope', 'hashtag', 'food')).toEqual({ ok: false, error: 'not_found' });
    expect(await addTagRuleAction(T1, 'regex', '.*')).toEqual({ ok: false, error: 'not_found' });
    expect(await addTagRuleAction(T1, 'hashtag', 'two words')).toEqual({ ok: false, error: 'invalid_hashtag' });
    expect(await addTagRuleAction(T1, 'word', 'ab')).toEqual({ ok: false, error: 'rule_too_short' });
    expect(await addTagRuleAction(T1, 'format', 'STORY')).toEqual({ ok: false, error: 'invalid_format' });
    expect(await deleteTagRuleAction("1' or 1=1")).toEqual({ ok: false, error: 'not_found' });
    expect(await previewTagRulesAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session' || c[0] === 'ADMIN')).toBe(false);
  });
});

describe('addTagRuleAction / deleteTagRuleAction', () => {
  it('stores the normalised value and revalidates the Tags page', async () => {
    expect(await addTagRuleAction(T1, 'hashtag', '#Food')).toEqual({ ok: true });
    expect(has('insert', { tag_id: T1, kind: 'hashtag', value: 'food' })).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
  });

  it('needs_update without the migration, too_many_rules at the cap, duplicate_rule on 23505, unexpected otherwise', async () => {
    apply.rules = null;
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'needs_update' });
    apply.rules = Array.from({ length: MAX_RULES }, (_, i) => rule(`r${i}`, T1));
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'too_many_rules' });
    apply.rules = [];
    queue.push({ error: { code: '23505', message: 'tag_rules_tag_kind_value_key' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'duplicate_rule' });
    queue.push({ error: { code: '23503' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'not_found' });
    queue.push({ error: { message: 'secret' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'unexpected' });
  });

  it('delete: by id; gone = not_found; the missing table = needs_update', async () => {
    queue.push({ data: [{ id: T2 }] });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: true });
    expect(has('eq', 'id', T2)).toBe(true);
    queue.push({ data: [] });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: false, error: 'not_found' });
    queue.push({ error: { code: 'PGRST205' } });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: false, error: 'needs_update' });
  });
});

describe('preview / apply to existing posts', () => {
  it("preview runs only this tag's rules over every post as a dry run and writes nothing", async () => {
    apply.rules = [rule('r1', T1), rule('r2', T2)];
    apply.result = { posts: 23, tags: 23 };
    expect(await previewTagRulesAction(T1)).toEqual({ ok: true, posts: 23 });
    expect(has('apply', ['r1'], 'all', true)).toBe(true);
    expect(calls.some((c) => c[0] === 'revalidate')).toBe(false);
  });

  it('apply writes and revalidates; a tag without rules changes nothing; errors are keys', async () => {
    apply.rules = [rule('r1', T1)];
    apply.result = { posts: 2, tags: 2 };
    expect(await applyTagRulesAction(T1)).toEqual({ ok: true, posts: 2 });
    expect(has('apply', ['r1'], 'all', false)).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
    calls.length = 0;
    expect(await applyTagRulesAction(T2)).toEqual({ ok: true, posts: 0 });
    expect(calls.some((c) => c[0] === 'loadRuleMedia')).toBe(false);
    apply.rules = null;
    expect(await applyTagRulesAction(T1)).toEqual({ ok: false, error: 'needs_update' });
  });
});
