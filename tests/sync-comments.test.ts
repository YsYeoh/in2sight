import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { igData, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { parseCommentsPage, type IgComment } from '@/lib/instagram/parse';
import { COMMENT_CALLS_PER_RUN, runAccount, type RunContext } from '@/lib/sync/run-account';
import { dueJobs, emptyState, type SyncState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { runTick } from '@/lib/sync/tick';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'];
const COMPLETE: Partial<SyncState> = { dailyDoneThrough: '2026-10-13', backfilledFrom: '2026-07-16', lastRun: { backfill: hoursAgo(10), stories: hoursAgo(0.1), daily: hoursAgo(1), mediaList: hoursAgo(0.1), mediaMetrics: hoursAgo(0.1), audience: hoursAgo(1), covers: hoursAgo(0.1) } };
const comment = (id: string, o: Partial<IgComment> = {}): IgComment => ({ id, text: `hello ${id}`, username: `fan_${id}`, likeCount: 0, commentedAt: hoursAgo(1), ...o });

function ctx(o: { scopes?: string[] | null; posts?: { id: string; count: number; synced?: number | null; ageH?: number }[] } = {}) {
  const ig = fakeIg();
  const mem = memoryStore({ media: (o.posts ?? []).map((p) => ({ id: p.id, accountId: 'a1', postedAt: hoursAgo(p.ageH ?? 5), lastMetricsAt: hoursAgo(1) })) });
  for (const p of o.posts ?? []) mem.commentCounts.set(p.id, { count: p.count, synced: p.synced ?? null });
  const acc: StoredAccount = account({ id: 'a1', grantedScopes: o.scopes === undefined ? SCOPES : o.scopes });
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...COMPLETE }, tz: 'UTC', now: NOW, deadline: 1e9, clock: () => 0 };
  return { c, ig, mem, acc };
}

describe('comments scheduling', () => {
  const input = (state: Partial<SyncState>, commentsScope?: boolean) => ({ status: 'active' as const, tokenExpiresAt: null, state: { ...emptyState('a1'), ...state }, commentsScope });
  it('only with the granted scope, only after the import, hourly, never in lane 1', () => {
    expect(dueJobs(input(COMPLETE, true), NOW, 'UTC')).toContain('comments');
    expect(dueJobs(input(COMPLETE, false), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input(COMPLETE), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input({}, true), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input({ ...COMPLETE, lastRun: { ...COMPLETE.lastRun, comments: hoursAgo(0.5) } }, true), NOW, 'UTC')).not.toContain('comments');
    expect(dueJobs(input(COMPLETE, true), NOW, 'UTC', { lane: 'regular' })).not.toContain('comments');
  });
});

describe('comments job', () => {
  it('scope missing: no Instagram call, nothing recorded (an empty list must never read as "no comments")', async () => {
    for (const scopes of [null, SCOPES.slice(0, 2)]) {
      const { c, ig, mem } = ctx({ scopes, posts: [{ id: 'p1', count: 3 }] });
      const { result } = await runAccount(c, ['comments']);
      expect(result.outcome).toBe('ok');
      expect(ig.commentsPage).not.toHaveBeenCalled();
      expect(mem.comments).toEqual([]);
      expect(mem.commentCounts.get('p1')!.synced).toBeNull();
    }
  });

  it('a tick without the scope never schedules it; after a Reconnect that grants it, the first run reads every recent post', async () => {
    const run = async (scopes: string[]) => {
      const ig = fakeIg();
      ig.commentsPage.mockResolvedValue({ items: [comment('c1')], next: null });
      const mem = memoryStore({ tokens: { a1: 'tok' }, media: [{ id: 'p1', accountId: 'a1', postedAt: hoursAgo(5), lastMetricsAt: hoursAgo(0.1) }] });
      mem.commentCounts.set('p1', { count: 1, synced: null });
      mem.states.set('a1', { ...emptyState('a1'), ...COMPLETE, leaseId: null } as SyncState & { leaseId: null });
      const s = await runTick({ store: mem.store, accounts: fakeAccounts([account({ id: 'a1', grantedScopes: scopes })]).accounts, ig, clock: () => NOW.getTime() }, { trigger: 'cron' });
      return { s, ig, mem };
    };
    const before = await run(SCOPES.slice(0, 2));
    expect(before.ig.commentsPage).not.toHaveBeenCalled();
    expect(before.s.accounts[0].jobs).not.toContain('comments');
    const after = await run(SCOPES);
    expect(after.s.accounts[0].jobs).toContain('comments');
    expect(after.mem.comments.map((x) => x.id)).toEqual(['c1']);
  });

  it('reads every page (up to the cap), upserts by id, marks the post synced at its current count; unchanged posts are skipped next time', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 3 }, { id: 'p2', count: 2, synced: 2, ageH: 6 }] });
    ig.commentsPage.mockImplementation((async (_t: string, _id: string, next?: string) =>
      next ? { items: [comment('c3')], next: null } : { items: [comment('c1'), comment('c2')], next: 'https://graph.instagram.com/v25.0/p1/comments?after=X&access_token=IGQ-secret' }) as IgData['commentsPage']);
    const { result } = await runAccount(c, ['comments']);
    expect(result).toMatchObject({ outcome: 'ok', jobs: ['comments'] });
    expect(ig.commentsPage.mock.calls.map((a) => [a[1], a[2] ? 'next' : 'first'])).toEqual([['p1', 'first'], ['p1', 'next']]); // p2 unchanged: not asked
    expect(mem.comments.map((x) => x.id)).toEqual(['c1', 'c2', 'c3']);
    expect(mem.commentCounts.get('p1')).toEqual({ count: 3, synced: 3 });
    ig.commentsPage.mockClear();
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).not.toHaveBeenCalled();
  });

  it('an empty answer for a post that has comments writes nothing and is asked again next run', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 4 }] });
    await runAccount(c, ['comments']);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(2);
    expect(mem.commentCounts.get('p1')!.synced).toBeNull();
    expect(mem.comments).toEqual([]);
  });

  it('per-run call budget across posts; per-post page cap', async () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, count: 1, ageH: i + 1 }));
    const { c, ig } = ctx({ posts });
    ig.commentsPage.mockImplementation((async (_t: string, id: string) => ({ items: [comment(`${id}-c`)], next: 'https://graph.instagram.com/more' })) as IgData['commentsPage']);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(COMMENT_CALLS_PER_RUN);
    expect(ig.commentsPage.mock.calls.filter((a) => a[1] === 'p00')).toHaveLength(4);
  });

  // three pages per post (next on pages 1 and 2, none on 3)
  const threePages = ((_t: string, id: string, next?: string) =>
    Promise.resolve(next === undefined ? { items: [comment(`${id}-1`)], next: 'https://graph.instagram.com/p?after=1' } : next.endsWith('1') ? { items: [comment(`${id}-2`)], next: 'https://graph.instagram.com/p?after=2' } : { items: [comment(`${id}-3`)], next: null })) as IgData['commentsPage'];

  it('a post cut off by the call budget keeps what was read but is not marked synced (read again next run)', async () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, count: 3, ageH: i + 1 })); // 6 x 3 pages = 18 calls; the 7th gets 2 of its 3
    const { c, ig, mem } = ctx({ posts });
    ig.commentsPage.mockImplementation(threePages);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(COMMENT_CALLS_PER_RUN);
    expect(mem.commentCounts.get('p5')!.synced).toBe(3);
    expect(mem.commentCounts.get('p6')!.synced).toBeNull();
    expect(mem.comments.filter((x) => x.mediaId === 'p6')).toHaveLength(2);
  });

  it('a post cut off by the clock keeps what was read but is not marked synced', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 3 }] });
    let now = 0;
    c.deadline = 100;
    c.clock = () => now;
    ig.commentsPage.mockImplementation(((t: string, id: string, next?: string) => ((now += 100), threePages(t, id, next))) as IgData['commentsPage']);
    await runAccount(c, ['comments']);
    expect(ig.commentsPage).toHaveBeenCalledTimes(1);
    expect(mem.comments).toHaveLength(1);
    expect(mem.commentCounts.get('p1')!.synced).toBeNull();
  });

  it('one post failing never stops the others; gone -> marked gone; rate limit -> stops; a DB failure never fails the account', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 1, ageH: 1 }, { id: 'p2', count: 1, ageH: 2 }, { id: 'p3', count: 1, ageH: 3 }] });
    ig.commentsPage.mockImplementation((async (_t: string, id: string) => {
      if (id === 'p1') throw new InstagramApiError('data', 500, 2);
      if (id === 'p2') throw new InstagramApiError('data', 400, 100, 33);
      return { items: [comment('c3')], next: null };
    }) as IgData['commentsPage']);
    expect((await runAccount(c, ['comments'])).result.outcome).toBe('ok');
    expect(mem.media.get('p2')!.gone).toBe(true);
    expect(mem.comments.map((x) => x.id)).toEqual(['c3']);

    const limited = ctx({ posts: [{ id: 'p1', count: 1 }] });
    limited.ig.commentsPage.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    expect((await runAccount(limited.c, ['comments'])).result.errorKey).toBe('rate_limited');

    const db = ctx({ posts: [{ id: 'p1', count: 1 }] });
    db.ig.commentsPage.mockResolvedValue({ items: [comment('c1')], next: null });
    db.mem.store.upsertComments = async () => {
      throw new Error('sync store: upsertComments failed');
    };
    expect((await runAccount(db.c, ['comments'])).result.outcome).toBe('ok');
  });

  it('third-party names and texts never reach progress rows', async () => {
    const { c, ig, mem } = ctx({ posts: [{ id: 'p1', count: 1 }] });
    const writes: unknown[] = [];
    c.progress = { report: async (...a) => void writes.push(a), finish: async () => undefined };
    ig.commentsPage.mockResolvedValue({ items: [comment('c1', { username: 'private.person', text: 'my phone is 123' })], next: null });
    await runAccount(c, ['comments']);
    expect(mem.comments).toHaveLength(1);
    expect(JSON.stringify(writes)).not.toMatch(/private\.person|phone/);
  });
});

describe('comments data client and store', () => {
  it('parses a page; skips items without id/timestamp; next only to Instagram\'s host', async () => {
    expect(parseCommentsPage({ data: [{ id: '1', text: '', username: 'a', like_count: 2, timestamp: '2026-10-13T10:00:00+0000' }, { id: '2' }, { text: 'x', timestamp: '2026-10-13T10:00:00+0000' }], paging: { next: 'N' } })).toEqual({
      items: [{ id: '1', text: '', username: 'a', likeCount: 2, commentedAt: '2026-10-13T10:00:00.000Z' }],
      next: 'N',
    });
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), new Response(JSON.stringify({ data: [] })))) as typeof fetch;
    const ig = igData('v25.0', fn);
    await ig.commentsPage('IGQ-secret', 'm1');
    expect(seen[0].pathname).toBe('/v25.0/m1/comments');
    expect(seen[0].searchParams.get('fields')).toBe('id,text,timestamp,username,like_count');
    expect(await ig.commentsPage('IGQ-secret', 'm1', 'https://evil.example/steal?access_token=IGQ-secret')).toEqual({ items: [], next: null });
    expect(seen).toHaveLength(1);
  });

  it('store: recent posts with comments, newest first; upsert by id without first_seen_at; synced count', async () => {
    const calls: { table: string; op: string; args: unknown[]; filters: unknown[][] }[] = [];
    const db = {
      from(table: string) {
        const c = { table, op: 'select', args: [] as unknown[], filters: [] as unknown[][] };
        calls.push(c);
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        for (const op of ['upsert', 'update']) chain[op] = (...a: unknown[]) => ((c.op = op), (c.args = a), chain);
        for (const f of ['eq', 'neq', 'is', 'gte', 'gt', 'order']) chain[f] = (...a: unknown[]) => (c.filters.push([f, ...a]), chain);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'p1', comments_count: 3, comments_synced_count: null }], error: null }).then(res);
        return chain;
      },
    };
    const s = supabaseSyncStore(db as never);
    expect(await s.mediaForComments('a1', 'SINCE')).toEqual([{ id: 'p1', commentsCount: 3, syncedCount: null }]);
    expect(calls[0].filters).toEqual([['eq', 'account_id', 'a1'], ['neq', 'media_type', 'STORY'], ['is', 'gone_at', null], ['gte', 'posted_at', 'SINCE'], ['gt', 'comments_count', 0], ['order', 'posted_at', { ascending: false }]]);
    await s.upsertComments('a1', 'p1', [comment('c1')], 'T');
    expect(calls[1]).toMatchObject({ table: 'comments', op: 'upsert', args: [[{ id: 'c1', account_id: 'a1', media_id: 'p1', author_username: 'fan_c1', text: 'hello c1', like_count: 0, commented_at: hoursAgo(1), last_seen_at: 'T' }], { onConflict: 'id' }] });
    expect((calls[1].args[0] as object[])[0]).not.toHaveProperty('first_seen_at');
    await s.upsertComments('a1', 'p1', [], 'T');
    expect(calls).toHaveLength(2);
    await s.markCommentsSynced('p1', 3);
    expect(calls[2]).toMatchObject({ table: 'media', op: 'update', args: [{ comments_synced_count: 3 }], filters: [['eq', 'id', 'p1']] });
  });
});
