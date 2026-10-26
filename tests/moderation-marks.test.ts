// @vitest-environment node
// Safety review C1: PostgREST caps every response at 1,000 rows no matter what .limit() asks for. The "touched" marks
// (an owner's unhide, finished or retried rule attempts) must therefore be read for the candidate ids only, in small
// chunks, never as "the newest N log rows".
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import type { ModerationRule } from '@/lib/moderation/rules';
import { account } from './fixtures/sync-fakes';

vi.mock('@/lib/moderation/store', async (orig) => {
  const real = await orig<typeof import('@/lib/moderation/store')>();
  return { ...real, autoHideAccounts: vi.fn(), insertLog: vi.fn(), finishLog: vi.fn(async () => {}), setCommentHidden: vi.fn(async () => {}), removeComment: vi.fn(async () => {}), pauseAutoHide: vi.fn(async () => {}) };
});

import * as S from '@/lib/moderation/store';
import { runAutoHide } from '@/lib/moderation/auto';

type Row = Record<string, unknown>;
const CAP = 1000;
const RULE: ModerationRule = { id: '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e', kind: 'word', pattern: 'spam', wholeWord: false };
const NOW = new Date('2026-10-29T10:00:00Z');
const A = 'a1';

/** An in-memory client that answers like PostgREST: filters, order, limit/range, and NEVER more than 1,000 rows. */
function fakeDb(tables: Record<string, Row[]>) {
  const seen = { maxIn: 0, inCalls: 0 };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const order: { col: string; asc: boolean }[] = [];
    let limit = Infinity;
    let range: [number, number] | null = null;
    let single = false;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (k: string, v: unknown) => (filters.push((r) => r[k] === v), chain);
    chain.is = (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), chain);
    chain.in = (k: string, vs: unknown[]) => (seen.inCalls++, (seen.maxIn = Math.max(seen.maxIn, vs.length)), filters.push((r) => vs.includes(r[k])), chain);
    chain.order = (col: string, o?: { ascending?: boolean }) => (order.push({ col, asc: o?.ascending !== false }), chain);
    chain.limit = (n: number) => ((limit = n), chain);
    chain.range = (a: number, b: number) => ((range = [a, b]), chain);
    chain.maybeSingle = () => ((single = true), chain);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const { col, asc } of [...order].reverse()) rows = [...rows].sort((x, y) => (x[col]! < y[col]! ? -1 : x[col]! > y[col]! ? 1 : 0) * (asc ? 1 : -1));
      const count = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      rows = rows.slice(0, Math.min(limit, CAP));
      return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count }).then(res, rej);
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, seen };
}

/** 250 stored comments (newest first by commented_at): the target and a fresh match on top, then harmless ones. */
function commentRows(): Row[] {
  const mk = (id: string, text: string, i: number): Row => ({ id, account_id: A, author_username: 'bot', text, hidden: false, commented_at: `2026-10-28T${String(23 - Math.floor(i / 60)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}:00Z` });
  return [mk('target', 'spam spam', 0), mk('fresh', 'spam here', 1), ...Array.from({ length: 248 }, (_, i) => mk(`ok${i}`, 'lovely photo', i + 2))];
}

/** 1,500 log rows of the account; the owner's unhide of `target` is the OLDEST, 1,499 newer rows are about other comments. */
function logRows(): Row[] {
  const row = (id: number, commentId: string, actor: string, action: string, createdAt: string): Row => ({ id, account_id: A, comment_id: commentId, action, actor, result: 'ok', created_at: createdAt, undone_at: null, target_id: null, undo_of: null });
  return [
    row(1, 'target', 'owner', 'unhide', '2026-10-01T00:00:00Z'),
    ...Array.from({ length: 1499 }, (_, i) => row(i + 2, `old${i}`, `rule:${RULE.id}`, 'hide', `2026-10-${String(2 + Math.floor(i / 100)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`)),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(S.autoHideAccounts).mockResolvedValue([{ accountId: A, rules: [RULE] }]);
  let n = 100;
  vi.mocked(S.insertLog).mockImplementation(async () => ++n);
});

describe('logMarks reads the marks of the given comments only', () => {
  it('an old mark is found even when the account has more than 1,000 log rows; ids go in chunks of at most 100', async () => {
    const { db, seen } = fakeDb({ moderation_log: logRows() });
    const ids = ['target', ...Array.from({ length: 249 }, (_, i) => `x${i}`)];
    const marks = await S.logMarks(db, A, ids);
    expect(marks).toEqual([{ commentId: 'target', actor: 'owner', result: 'ok' }]);
    expect(seen.maxIn).toBeLessThanOrEqual(100);
    expect(seen.inCalls).toBe(3);
  });

  it('no ids, no query', async () => {
    const { db, seen } = fakeDb({ moderation_log: logRows() });
    expect(await S.logMarks(db, A, [])).toEqual([]);
    expect(seen.inCalls).toBe(0);
  });
});

describe('the unhide mark that fell outside the newest 1,000 log rows still protects the comment', () => {
  it('tick pass: the owner-unhidden comment is NOT hidden again, the other match is', async () => {
    const { db, seen } = fakeDb({ comments: commentRows(), moderation_log: logRows() });
    const hide = vi.fn(async () => {});
    const ctx = { accounts: [account({ id: A, username: 'shop', grantedScopes: [COMMENTS_SCOPE] })], now: NOW, deadline: Infinity, clock: () => 0 };
    const out = await runAutoHide({ db, ig: { hide }, token: async () => 'tok', newId: () => 'req' }, ctx);
    expect(out).toEqual({ hidden: 1, failed: 0, paused: 0 });
    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledWith('tok', 'fresh', true);
    expect(seen.maxIn).toBeLessThanOrEqual(100);
  });

  it('preview: the same comment is not counted', async () => {
    const { db, seen } = fakeDb({
      moderation_settings: [{ account_id: A, auto_hide: false, paused_at: null, pause_reason: null }],
      moderation_rules: [{ id: RULE.id, account_id: A, kind: 'word', pattern: 'spam', whole_word: false, created_at: '2026-10-01T00:00:00Z' }],
      moderation_log: logRows(),
      comments: commentRows(),
    });
    const d = (await S.loadModeration(db, A, 'shop', 1, NOW))!;
    expect(d.preview.sample.map((s) => s.id)).toEqual(['fresh']);
    expect(d.preview.count).toBe(1);
    expect(seen.maxIn).toBeLessThanOrEqual(100);
  });

  it('the pass and the preview look at the same window: the newest CANDIDATE_SCAN visible comments', async () => {
    const { db } = fakeDb({
      moderation_settings: [{ account_id: A, auto_hide: false, paused_at: null, pause_reason: null }],
      moderation_rules: [{ id: RULE.id, account_id: A, kind: 'word', pattern: 'spam', whole_word: false, created_at: '2026-10-01T00:00:00Z' }],
      moderation_log: [],
      comments: commentRows(),
    });
    const d = (await S.loadModeration(db, A, 'shop', 1, NOW))!;
    expect(d.preview.scanned).toBe(S.CANDIDATE_SCAN);
    expect(S.CANDIDATE_SCAN).toBe(200);
  });
});
