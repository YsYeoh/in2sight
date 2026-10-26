// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_CHARS, LOG_PAGE, ModerationStoreError, autoHideAccounts, countWordRules, displayResult, finishLog, getActionComment, insertLog, loadModeration,
  markUndone, removeComment, setCommentHidden, setSpamRow, snippet, undoKind,
} from '@/lib/moderation/store';

type Res = { data?: unknown; error?: { code?: string } | null; count?: number | null };
const calls: unknown[][] = [];
let results: Record<string, Res[]> = {};

/** Records every builder call; each awaited query resolves to the next queued result of its table. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'in', 'not', 'gte', 'order', 'range', 'limit', 'maybeSingle', 'single'])
        chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve((results[table] ?? []).shift() ?? { data: null, error: null }).then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const R = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const Q = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const NOW = new Date('2026-10-29T10:00:00Z');
const logRow = (o: Record<string, unknown> = {}) => ({ id: 1, comment_id: 'c1', action: 'hide', actor: 'owner', result: 'ok', target_id: null, undo_of: null, created_at: '2026-10-29T09:00:00Z', undone_at: null, ...o });

beforeEach(() => {
  calls.length = 0;
  results = {};
});

describe('pure helpers', () => {
  it('undoKind: an ok hide can be unhidden, an ok reply with an id can be deleted; nothing else, nothing twice', () => {
    const r = { action: 'hide' as const, result: 'ok', targetId: null, undoneAt: null };
    expect(undoKind(r)).toBe('unhide');
    expect(undoKind({ ...r, action: 'reply', targetId: '1790' })).toBe('delete_reply');
    expect(undoKind({ ...r, action: 'reply' })).toBeNull(); // reply id unknown
    expect(undoKind({ ...r, undoneAt: '2026-10-29T09:30:00Z' })).toBeNull();
    expect(undoKind({ ...r, result: 'pending' })).toBeNull();
    expect(undoKind({ ...r, action: 'delete' })).toBeNull(); // irreversible
    expect(undoKind({ ...r, action: 'unhide' })).toBeNull();
  });

  it('displayResult: a pending row older than 2 minutes is shown as unknown', () => {
    expect(displayResult({ result: 'pending', createdAt: '2026-10-29T09:59:00Z' }, NOW)).toBe('pending');
    expect(displayResult({ result: 'pending', createdAt: '2026-10-29T09:57:59Z' }, NOW)).toBe('unknown');
    expect(displayResult({ result: 'rate_limited', createdAt: '2026-10-29T09:00:00Z' }, NOW)).toBe('rate_limited');
  });

  it('snippet: whitespace collapsed, clipped to 80 characters (code points) with an ellipsis', () => {
    expect(snippet(null)).toBeNull();
    expect(snippet('  hi \n there ')).toBe('hi there');
    const s = snippet('😀'.repeat(100))!;
    expect([...s]).toHaveLength(CONTEXT_CHARS);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('log writes', () => {
  it('insertLog stores ids only and returns the new id', async () => {
    results.moderation_log = [{ data: { id: 7 }, error: null }];
    expect(await insertLog(fakeDb(), { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: R })).toBe(7);
    const payload = calls.find((c) => c[0] === 'insert')![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['account_id', 'action', 'actor', 'comment_id', 'request_id']);
  });

  it('insertLog: a repeated request id is "duplicate", a missing table "missing"; the message is fixed', async () => {
    results.moderation_log = [{ data: null, error: { code: '23505' } }, { data: null, error: { code: 'PGRST205' } }, { data: null, error: { code: 'XX000' } }];
    const run = () => insertLog(fakeDb(), { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: R });
    await expect(run()).rejects.toMatchObject({ reason: 'duplicate', message: 'moderation store: insertLog failed' });
    await expect(run()).rejects.toMatchObject({ reason: 'missing' });
    await expect(run()).rejects.toBeInstanceOf(ModerationStoreError);
  });

  it('finishLog writes the result (and the reply id when given) by row id', async () => {
    await finishLog(fakeDb(), 7, 'ok', '1790');
    expect(has('update', { result: 'ok', target_id: '1790' })).toBe(true);
    expect(has('eq', 'id', 7)).toBe(true);
    calls.length = 0;
    await finishLog(fakeDb(), 7, 'rate_limited');
    expect(has('update', { result: 'rate_limited' })).toBe(true);
  });

  it('markUndone only once, only for this account', async () => {
    results.moderation_log = [{ data: [{ id: 7 }], error: null }, { data: [], error: null }];
    expect(await markUndone(fakeDb(), A, 7, NOW.toISOString())).toBe(true);
    expect(has('eq', 'account_id', A) && has('is', 'undone_at', null)).toBe(true);
    expect(await markUndone(fakeDb(), A, 7, NOW.toISOString())).toBe(false);
  });
});

describe('comments: every read and write is filtered by the comment id AND the account id', () => {
  it.each([
    ['getActionComment', () => getActionComment(fakeDb(), A, 'c1')],
    ['setCommentHidden', () => setCommentHidden(fakeDb(), A, 'c1', true)],
    ['removeComment', () => removeComment(fakeDb(), A, 'c1')],
  ])('%s', async (_n, run) => {
    await run();
    expect(has('from', 'comments')).toBe(true);
    expect(has('eq', 'id', 'c1')).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
  });

  it('getActionComment maps the row; null when absent', async () => {
    results.comments = [{ data: { id: 'c1', author_username: 'fan', hidden: true }, error: null }, { data: null, error: null }];
    expect(await getActionComment(fakeDb(), A, 'c1')).toEqual({ id: 'c1', authorUsername: 'fan', hidden: true });
    expect(await getActionComment(fakeDb(), A, 'c2')).toBeNull();
  });
});

describe('rules and settings', () => {
  it('countWordRules counts the word rows of this account only (head count)', async () => {
    results.moderation_rules = [{ data: null, count: 199, error: null }];
    expect(await countWordRules(fakeDb(), A)).toBe(199);
    expect(has('eq', 'account_id', A) && has('eq', 'kind', 'word')).toBe(true);
  });

  it('a spam pattern switched on twice stays one row (the unique index answers 23505)', async () => {
    results.moderation_rules = [{ data: null, error: { code: '23505' } }];
    await expect(setSpamRow(fakeDb(), A, 'link', true)).resolves.toBeUndefined();
    await setSpamRow(fakeDb(), A, 'link', false);
    expect(has('delete')).toBe(true);
    expect(has('eq', 'kind', 'link')).toBe(true);
  });
});

describe('loadModeration (the tab)', () => {
  const seed = () => {
    results.moderation_settings = [{ data: { auto_hide: true, paused_at: null, pause_reason: null }, error: null }];
    results.moderation_rules = [{ data: [{ id: R, kind: 'word', pattern: 'spam', whole_word: false }, { id: Q, kind: 'bogus', pattern: null, whole_word: false }], error: null }];
    results.moderation_log = [
      { data: [logRow(), logRow({ id: 2, comment_id: 'gone', action: 'reply', target_id: '1790', result: 'pending', created_at: '2026-10-29T09:00:00Z' })], count: 2, error: null },
      { data: [{ comment_id: 'c9', actor: 'owner', result: 'ok' }], error: null }, // marks: c9 touched
    ];
    results.comments = [
      { data: [{ id: 'c1', author_username: 'fan', text: 'buy spam now' }], error: null }, // context of the log page
      { data: [{ id: 'c3', author_username: 'x', text: 'spam!', hidden: false }, { id: 'c9', author_username: 'y', text: 'spam', hidden: false }, { id: 'c4', author_username: 'z', text: 'nice', hidden: false }], error: null }, // visible
    ];
  };

  it('settings, valid rules only, a log page with context, display state and undo, and the preview', async () => {
    seed();
    const d = (await loadModeration(fakeDb(), A, 'me', 1, NOW))!;
    expect(d.settings).toEqual({ autoHide: true, pausedAt: null, pauseReason: null });
    expect(d.rules).toEqual([{ id: R, kind: 'word', pattern: 'spam', wholeWord: false }]);
    expect(d.log.total).toBe(2);
    expect(d.log.pages).toBe(1);
    expect(d.log.rows[0]).toMatchObject({ id: 1, commentId: 'c1', shown: 'ok', undo: 'unhide', context: { authorUsername: 'fan', snippet: 'buy spam now' } });
    expect(d.log.rows[1]).toMatchObject({ id: 2, shown: 'unknown', undo: null, context: null });
    expect(d.preview).toMatchObject({ count: 1, scanned: 3 });
    expect(d.preview.sample.map((s) => s.id)).toEqual(['c3']);
    expect(has('range', 0, LOG_PAGE - 1)).toBe(true);
  });

  it('a page past the end (PostgREST 416, PGRST103) reads page 1 instead', async () => {
    seed();
    results.moderation_log.unshift({ data: null, error: { code: 'PGRST103' } });
    const d = (await loadModeration(fakeDb(), A, 'me', 9, NOW))!;
    expect(d.log.page).toBe(1);
    expect(has('range', 0, LOG_PAGE - 1)).toBe(true);
  });

  it('null before the migration (a missing table)', async () => {
    results.moderation_settings = [{ data: null, error: { code: 'PGRST205' } }];
    expect(await loadModeration(fakeDb(), A, 'me', 1, NOW)).toBeNull();
  });
});

describe('the tick reads', () => {
  it('autoHideAccounts: accounts with auto-hide on and not paused, with their rules; null before the migration', async () => {
    results.moderation_settings = [{ data: [{ account_id: A }], error: null }];
    results.moderation_rules = [{ data: [{ id: R, account_id: A, kind: 'link', pattern: null, whole_word: false }], error: null }];
    expect(await autoHideAccounts(fakeDb())).toEqual([{ accountId: A, rules: [{ id: R, kind: 'link', pattern: null, wholeWord: false }] }]);
    expect(has('eq', 'auto_hide', true) && has('is', 'paused_at', null)).toBe(true);
    results.moderation_settings = [{ data: null, error: { code: '42P01' } }];
    expect(await autoHideAccounts(fakeDb())).toBeNull();
  });
});
