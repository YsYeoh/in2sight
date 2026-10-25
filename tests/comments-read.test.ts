import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QUESTION_PATTERN } from '@/lib/comments/question';
import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample, toCommentView, type CommentPageArgs } from '@/lib/comments/read';
import { COMMENT_PAGE, FAN_PAGE, TOPIC_SAMPLE } from '@/lib/comments/view';

type Op = unknown[];
const calls: Op[] = [];
const queue: { data?: unknown; error?: unknown }[] = [];
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
      for (const op of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SECRET = { code: 'XX000', message: 'row contains alice.secret' };
const ARGS: CommentPageArgs = { fromIso: '2026-09-30T16:00:00.000Z', toIso: '2026-10-25T16:00:00.000Z', q: '', media: null, questions: false, unanswered: false, fansOnly: false, owner: 'me', page: 1 };
const ROW = { id: '1801', media_id: '1790', author_username: 'amy', body: 'Where is this?', like_count: 2, commented_at: '2026-10-20T08:00:00+00:00', hidden: false, replied: false, media_type: 'REELS', posted_at: '2026-10-19T10:00:00+00:00', caption: 'Penang trip', n: 1, total: 3 };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});

describe('toCommentView', () => {
  it('maps a comment_list row; the question badge is the rule; false hidden / replied are unknown (null), never false', () => {
    expect(toCommentView(ROW)).toEqual({
      id: '1801',
      mediaId: '1790',
      authorUsername: 'amy',
      text: 'Where is this?',
      postedAt: '2026-10-20T08:00:00+00:00',
      likeCount: 2,
      isQuestion: true,
      hidden: null,
      repliedByOwner: null,
      post: { id: '1790', type: 'REELS', postedAt: '2026-10-19T10:00:00+00:00', caption: 'Penang trip' },
    });
    expect(toCommentView({ ...ROW, hidden: true, replied: true })).toMatchObject({ hidden: true, repliedByOwner: true });
    expect(toCommentView({ ...ROW, body: null, author_username: null, like_count: null, posted_at: null })).toMatchObject({ text: '', authorUsername: null, likeCount: null, isQuestion: false, post: null });
  });
});

describe('loadCommentPage', () => {
  it('calls comment_list with the filters; no filter = nulls; the page and the total', async () => {
    queue.push({ data: [ROW], error: null });
    expect(await loadCommentPage(fakeDb(), ACC, ARGS)).toEqual({ rows: [toCommentView(ROW)], total: 3, page: 1 });
    expect(calls).toEqual([
      ['rpc', 'comment_list', { p_account: ACC, p_from: ARGS.fromIso, p_to: ARGS.toIso, p_q: null, p_media: null, p_question_re: null, p_unanswered: false, p_fan_min: null, p_owner: 'me', p_offset: 0, p_limit: COMMENT_PAGE }],
    ]);
  });

  it('questions pass the ONE question pattern; fans pass the fan minimum; page 3 is offset 100', async () => {
    queue.push({ data: [ROW], error: null });
    await loadCommentPage(fakeDb(), ACC, { ...ARGS, q: 'where', media: '1790', questions: true, unanswered: true, fansOnly: true, page: 3 });
    expect(calls[0][2]).toMatchObject({ p_q: 'where', p_media: '1790', p_question_re: QUESTION_PATTERN, p_unanswered: true, p_fan_min: 3, p_offset: 100, p_limit: 50 });
  });

  it('a page past the end reads page 1 again', async () => {
    queue.push({ data: [], error: null }, { data: [ROW], error: null });
    expect((await loadCommentPage(fakeDb(), ACC, { ...ARGS, page: 9 }))?.page).toBe(1);
    expect(calls.map((c) => (c[2] as { p_offset: number }).p_offset)).toEqual([400, 0]);
  });

  it('function missing (migration not applied) → null; any other error → a fixed message that never echoes the database', async () => {
    for (const code of ['PGRST202', '42883']) {
      queue.push({ data: null, error: { code } });
      expect(await loadCommentPage(fakeDb(), ACC, ARGS)).toBeNull();
    }
    queue.push({ data: null, error: SECRET });
    await expect(loadCommentPage(fakeDb(), ACC, ARGS)).rejects.toThrow(/^comments comment_list failed$/);
  });
});

describe('loadFans / loadOutsiders', () => {
  it('comment_fans gets the mode, the clock and the fan rules; bigint counts arrive as strings or numbers', async () => {
    queue.push({ data: [{ username: 'amy', comments: '12', likes: 30, first_at: '2026-08-01T00:00:00Z', last_at: '2026-10-20T00:00:00Z', posts_since: null, n: 1, total: '7' }], error: null });
    const now = new Date('2026-10-25T08:00:00Z');
    expect(await loadFans(fakeDb(), ACC, { owner: 'me', mode: 'quiet', now, page: 2 })).toEqual({
      rows: [{ username: 'amy', comments: 12, likes: 30, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-10-20T00:00:00Z', postsSince: null }],
      total: 7,
      page: 2,
    });
    expect(calls[0]).toEqual(['rpc', 'comment_fans', { p_account: ACC, p_owner: 'me', p_mode: 'quiet', p_now: '2026-10-25T08:00:00.000Z', p_fan_min: 3, p_new_min: 2, p_days: 30, p_quiet_posts: 3, p_offset: FAN_PAGE, p_limit: FAN_PAGE }]);
  });

  it('comment_outsiders: the page; null when missing', async () => {
    queue.push({ data: [{ username: 'bob', comments: 4, last_at: '2026-10-01T00:00:00Z', n: 1, total: 1 }], error: null });
    expect(await loadOutsiders(fakeDb(), ACC, { owner: 'me', page: 1 })).toEqual({ rows: [{ username: 'bob', comments: 4, lastAt: '2026-10-01T00:00:00Z' }], total: 1, page: 1 });
    expect(calls[0]).toEqual(['rpc', 'comment_outsiders', { p_account: ACC, p_owner: 'me', p_offset: 0, p_limit: FAN_PAGE }]);
    queue.push({ data: null, error: { code: 'PGRST202' } });
    expect(await loadOutsiders(fakeDb(), ACC, { owner: 'me', page: 1 })).toBeNull();
  });
});

describe('table reads (work before the migration)', () => {
  it('loadTopicSample: the newest comments of the window, capped, the owner left out, names lower-cased', async () => {
    queue.push({ data: [{ text: 'Nice', author_username: 'Amy' }, { text: 'thanks!', author_username: 'ME' }, { text: null, author_username: null }], error: null });
    expect(await loadTopicSample(fakeDb(), ACC, { fromIso: 'F', toIso: 'T', owner: 'me' })).toEqual([{ text: 'Nice', author: 'amy' }, { text: null, author: null }]);
    expect(calls).toEqual([
      ['from', 'comments'],
      ['select', 'text,author_username'],
      ['eq', 'account_id', ACC],
      ['gte', 'commented_at', 'F'],
      ['lt', 'commented_at', 'T'],
      ['order', 'commented_at', { ascending: false }],
      ['limit', TOPIC_SAMPLE],
    ]);
  });

  it('loadCommentPosts: the newest 50 feed posts with comments; loadCommentStart: the earliest first_seen_at', async () => {
    queue.push({ data: [{ id: '1790', media_type: 'IMAGE', posted_at: '2026-10-19T10:00:00Z', caption: null }], error: null });
    expect(await loadCommentPosts(fakeDb(), ACC)).toEqual([{ id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: null }]);
    expect(calls.slice(1)).toEqual([
      ['select', 'id,media_type,posted_at,caption'],
      ['eq', 'account_id', ACC],
      ['neq', 'media_type', 'STORY'],
      ['gt', 'comments_count', 0],
      ['order', 'posted_at', { ascending: false }],
      ['limit', 50],
    ]);
    calls.length = 0;
    queue.push({ data: [{ first_seen_at: '2026-10-02T03:00:00Z' }], error: null }, { data: [], error: null });
    expect(await loadCommentStart(fakeDb(), ACC)).toBe('2026-10-02T03:00:00Z');
    expect(await loadCommentStart(fakeDb(), ACC)).toBeNull();
    expect(calls.slice(0, 5)).toEqual([['from', 'comments'], ['select', 'first_seen_at'], ['eq', 'account_id', ACC], ['order', 'first_seen_at', { ascending: true }], ['limit', 1]]);
  });

  it('errors are fixed texts', async () => {
    queue.push({ data: null, error: SECRET }, { data: null, error: SECRET }, { data: null, error: SECRET });
    await expect(loadTopicSample(fakeDb(), ACC, { fromIso: 'F', toIso: 'T', owner: 'me' })).rejects.toThrow(/^comments topics failed$/);
    await expect(loadCommentPosts(fakeDb(), ACC)).rejects.toThrow(/^comments posts failed$/);
    await expect(loadCommentStart(fakeDb(), ACC)).rejects.toThrow(/^comments start failed$/);
  });
});
