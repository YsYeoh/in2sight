// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyTagRules, loadRuleMedia, loadRules } from '@/lib/tag-rules/apply';
import type { RuleMedia, TagRule } from '@/lib/tag-rules/rules';
import { supabaseSyncStore } from '@/lib/sync/store';

type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][] };

/** Records every query-builder call; each awaited query resolves to the next queued result (default: ok, no data). */
function recorder(results: { data?: unknown; error?: unknown }[] = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = (...a: unknown[]) => ((call.op = op), call.args.push(...a), chain);
      chain.select = (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain);
      for (const f of ['eq', 'neq', 'in', 'order', 'range', 'limit']) chain[f] = (...a: unknown[]) => (call.filters.push([f, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const R: TagRule = { id: 'r1', tagId: 't1', kind: 'hashtag', value: 'food', createdAt: '2026-10-01T00:00:00.000Z' };
const post = (id: string, caption: string | null, kind = 'IMAGE'): RuleMedia => ({ id, caption, kind, postedAt: '2026-10-10T00:00:00.000Z' });

describe('loadRules', () => {
  it('maps the rows oldest first, capped, and drops unknown kinds', async () => {
    const r = recorder([{ data: [{ id: 'r1', tag_id: 't1', kind: 'hashtag', value: 'food', created_at: '2026-10-01T00:00:00+00:00' }, { id: 'r2', tag_id: 't1', kind: 'regex', value: '.*', created_at: 'x' }] }]);
    expect(await loadRules(r.db)).toEqual([{ id: 'r1', tagId: 't1', kind: 'hashtag', value: 'food', createdAt: '2026-10-01T00:00:00+00:00' }]);
    expect(r.calls[0]).toMatchObject({ table: 'tag_rules', filters: [['order', 'created_at', { ascending: true }], ['limit', 200]] });
  });

  it('null without the migration; any other error throws a fixed message', async () => {
    expect(await loadRules(recorder([{ error: { code: 'PGRST205' } }]).db)).toBeNull();
    expect(await loadRules(recorder([{ error: { code: '42P01' } }]).db)).toBeNull();
    await expect(loadRules(recorder([{ error: { code: '500', message: 'secret value' } }]).db)).rejects.toThrow(/^tag rules: read failed$/);
  });
});

describe('loadRuleMedia', () => {
  it('reads feed posts and Reels of every account (never Stories) in ordered 1,000-row pages', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, caption: i ? null : '#food', media_type: 'IMAGE', posted_at: 'T' }));
    const r = recorder([{ data: page }, { data: [{ id: 'z', caption: 7, media_type: 'REELS', posted_at: 'T' }] }]);
    const m = await loadRuleMedia(r.db);
    expect(m).toHaveLength(1001);
    expect(m[0]).toEqual({ id: 'm0', caption: '#food', kind: 'IMAGE', postedAt: 'T' });
    expect(m[1000]).toEqual({ id: 'z', caption: null, kind: 'REELS', postedAt: 'T' });
    expect(r.calls[0].filters).toEqual([['neq', 'media_type', 'STORY'], ['order', 'id', { ascending: true }], ['range', 0, 999]]);
    expect(r.calls[1].filters).toContainEqual(['range', 1000, 1999]);
    await expect(loadRuleMedia(recorder([{ error: { message: 'secret' } }]).db)).rejects.toThrow(/^tag rules: media read failed$/);
  });
});

describe('applyTagRules', () => {
  it('no post matches: no database call at all', async () => {
    const r = recorder();
    expect(await applyTagRules(r.db, { media: [post('p1', 'nothing')], rules: [R], scope: 'all', dryRun: false })).toEqual({ posts: 0, tags: 0 });
    expect(r.calls).toEqual([]);
  });

  it('reads tags and removals only for the matching posts, by id, then inserts the rest as auto (never overwriting)', async () => {
    const r = recorder([{ data: [{ media_id: 'p2', tag_id: 't1' }] }, { data: [{ media_id: 'p3', tag_id: 't1' }] }, { error: null }]);
    const media = [post('p1', '#food'), post('p2', '#food'), post('p3', '#food'), post('p4', 'no')];
    expect(await applyTagRules(r.db, { media, rules: [R], scope: 'all', dryRun: false })).toEqual({ posts: 1, tags: 1 });
    expect(r.calls.map((c) => [c.table, c.op])).toEqual([['media_tags', 'select'], ['media_tag_rejections', 'select'], ['media_tags', 'upsert']]);
    expect(r.calls[0].filters).toEqual([['in', 'media_id', ['p1', 'p2', 'p3']]]);
    expect(r.calls[2].args).toEqual([[{ media_id: 'p1', tag_id: 't1', source: 'auto' }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true }]);
  });

  it('dry run (the preview) counts without writing', async () => {
    const r = recorder();
    expect(await applyTagRules(r.db, { media: [post('p1', '#food'), post('p2', '#FOOD')], rules: [R], scope: 'all', dryRun: true })).toEqual({ posts: 2, tags: 2 });
    expect(r.calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('reads in chunks of 100 posts (PostgREST answers at most 1,000 rows)', async () => {
    const r = recorder();
    const media = Array.from({ length: 150 }, (_, i) => post(`p${i}`, '#food'));
    await applyTagRules(r.db, { media, rules: [R], scope: 'all', dryRun: true });
    const reads = r.calls.filter((c) => c.op === 'select');
    expect(reads.map((c) => [c.table, (c.filters[0][2] as string[]).length])).toEqual([['media_tags', 100], ['media_tag_rejections', 100], ['media_tags', 50], ['media_tag_rejections', 50]]);
  });

  it('a read or write error throws a fixed message (never the Supabase text)', async () => {
    await expect(applyTagRules(recorder([{ error: { message: 'secret' } }]).db, { media: [post('p1', '#food')], rules: [R], scope: 'all', dryRun: false })).rejects.toThrow(/^tag rules: media_tags read failed$/);
    await expect(applyTagRules(recorder([{ data: [] }, { data: [] }, { error: { message: 'secret' } }]).db, { media: [post('p1', '#food')], rules: [R], scope: 'all', dryRun: false })).rejects.toThrow(/^tag rules: media_tags write failed$/);
  });
});

describe('supabaseSyncStore.autoTag (the sync, admin client)', () => {
  const item = (id: string, kind: 'IMAGE' | 'REELS' | 'STORY', caption: string | null) => ({ id, kind, caption, permalink: null, postedAt: '2026-10-10T00:00:00.000Z' });

  it('Stories only, no rules, or no migration: stops early', async () => {
    const none = recorder();
    await supabaseSyncStore(none.db).autoTag([item('s1', 'STORY', '#food')]);
    expect(none.calls).toEqual([]);
    const noRules = recorder([{ data: [] }]);
    await supabaseSyncStore(noRules.db).autoTag([item('p1', 'IMAGE', '#food')]);
    expect(noRules.calls.map((c) => c.table)).toEqual(['tag_rules']);
    const missing = recorder([{ error: { code: 'PGRST205' } }]);
    await supabaseSyncStore(missing.db).autoTag([item('p1', 'IMAGE', '#food')]);
    expect(missing.calls.map((c) => c.table)).toEqual(['tag_rules']);
  });

  it('tags the listed posts published after the rule was written', async () => {
    const r = recorder([{ data: [{ id: 'r1', tag_id: 't1', kind: 'hashtag', value: 'food', created_at: '2026-10-05T00:00:00.000Z' }] }, { data: [] }, { data: [] }, { error: null }]);
    await supabaseSyncStore(r.db).autoTag([item('p1', 'IMAGE', '#Food'), { ...item('old', 'IMAGE', '#food'), postedAt: '2026-10-01T00:00:00.000Z' }, item('s1', 'STORY', '#food')]);
    expect(r.calls.at(-1)).toMatchObject({ table: 'media_tags', op: 'upsert', args: [[{ media_id: 'p1', tag_id: 't1', source: 'auto' }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true }] });
  });
});
