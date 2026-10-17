import { describe, expect, it } from 'vitest';
import { igData, type IgData } from '@/lib/instagram/data';
import { InstagramApiError } from '@/lib/instagram/oauth';
import { parseMediaDetails } from '@/lib/instagram/parse';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const CDN = 'https://scontent-sin6-1.cdninstagram.com/v/t51/abc.jpg?oe=AAAA&_nc_sig=secret';

describe('parseMediaDetails', () => {
  it('reads counts, product type, Reels flag, URLs and the first 10 children; keeps the real child count', () => {
    const children = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, media_type: i % 2 ? 'VIDEO' : 'IMAGE', media_url: `${CDN}&i=${i}` }));
    const d = parseMediaDetails({ media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', like_count: 12, comments_count: 0, children: { data: children } });
    expect(d).toMatchObject({ mediaType: 'CAROUSEL_ALBUM', productType: 'FEED', likeCount: 12, commentsCount: 0, isSharedToFeed: null, childrenCount: 12 });
    expect(d.children).toHaveLength(10);
    expect(d.children![1]).toEqual({ mediaType: 'VIDEO', mediaUrl: `${CDN}&i=1`, thumbnailUrl: null });
  });
  it('missing or malformed values are null, never 0', () => {
    expect(parseMediaDetails({ like_count: '5', is_shared_to_feed: 'yes' })).toEqual({ mediaType: null, productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null });
    expect(parseMediaDetails(null).likeCount).toBeNull();
  });
});

describe('listing requests', () => {
  function record(body: unknown) {
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), json(body))) as typeof fetch;
    return { fn, seen };
  }
  it('listMedia asks the extended fields and attaches the details to each item', async () => {
    const f = record({ data: [{ id: 'r1', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-10-13T10:00:00+0000', like_count: 3, comments_count: 1, is_shared_to_feed: true }] });
    const [item] = await igData('v25.0', f.fn).listMedia('t', 10);
    expect(f.seen[0].searchParams.get('fields')).toContain('like_count,comments_count,is_shared_to_feed,children{media_type}');
    expect(item).toMatchObject({ id: 'r1', kind: 'REELS', details: { likeCount: 3, commentsCount: 1, isSharedToFeed: true, productType: 'REELS' } });
  });
  it('listStories asks the URL fields by default and only the base fields when told so', async () => {
    const f = record({ data: [] });
    const ig = igData('v25.0', f.fn);
    await ig.listStories('t');
    await ig.listStories('t', false);
    expect(f.seen[0].searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url');
    expect(f.seen[1].searchParams.get('fields')).toBe('id,caption,media_type,media_product_type,permalink,timestamp');
  });
});

describe('Story field fallback', () => {
  function ctx(state: Partial<SyncState> = {}) {
    const ig = fakeIg();
    const acc = account({ id: 'a1' });
    const c: RunContext = { ig, store: memoryStore().store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: { ...emptyState('a1'), ...state }, tz: 'UTC', now: new Date('2026-10-14T02:00:00Z'), deadline: 1, clock: () => 0 };
    return { c, ig };
  }
  it('"nonexisting field" on the URL fields: Stories are listed again with the base fields, and that is remembered', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockImplementation((async (_t: string, withUrls?: boolean) => {
      if (withUrls !== false) throw new InstagramApiError('data', 400, 100, undefined, true);
      return [];
    }) as IgData['listStories']);
    const { result, patch } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(ig.listStories.mock.calls.map((a) => a[1])).toEqual([true, false]);
    expect(patch.capabilities!['stories:url_fields']).toBe(false);

    const next = ctx({ capabilities: patch.capabilities });
    await runAccount(next.c, ['stories']);
    expect(next.ig.listStories.mock.calls.map((a) => a[1])).toEqual([false]);
  });
  it('any other error is not a reason to retry: a rate limit still stops the job', async () => {
    const { c, ig } = ctx();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 80002));
    const { result, patch } = await runAccount(c, ['stories']);
    expect(ig.listStories).toHaveBeenCalledTimes(1);
    expect(result.errorKey).toBe('rate_limited');
    expect(patch.capabilities).toEqual({});
  });
});

describe('store: media fields and carousel children', () => {
  it('upserts the listing details (never the CDN URLs) and one children row per position', async () => {
    const calls: { table: string; rows: Record<string, unknown>[]; opts: unknown }[] = [];
    const db = { from: (table: string) => ({ upsert: async (rows: Record<string, unknown>[], opts: unknown) => (calls.push({ table, rows, opts }), { error: null }) }) };
    const details = { mediaType: 'CAROUSEL_ALBUM', productType: 'FEED', likeCount: 4, commentsCount: 2, isSharedToFeed: null, mediaUrl: CDN, thumbnailUrl: null, childrenCount: 2, children: [{ mediaType: 'IMAGE', mediaUrl: CDN, thumbnailUrl: null }, { mediaType: 'VIDEO', mediaUrl: null, thumbnailUrl: CDN }] };
    await supabaseSyncStore(db as never).upsertMedia('a1', [{ id: 'c1', kind: 'CAROUSEL_ALBUM', caption: null, permalink: null, postedAt: '2026-10-10T00:00:00.000Z', details }, { id: 'p1', kind: 'IMAGE', caption: null, permalink: null, postedAt: '2026-10-09T00:00:00.000Z' }]);
    // PostgREST bulk upsert writes NULL for keys only some rows carry: rows with and without details go in separate calls
    const mediaCalls = calls.filter((x) => x.table === 'media');
    expect(mediaCalls).toHaveLength(2);
    for (const m of mediaCalls) for (const r of m.rows) expect(Object.keys(r).sort()).toEqual(Object.keys(m.rows[0]).sort());
    expect(mediaCalls[0].rows[0]).toMatchObject({ id: 'c1', media_product_type: 'FEED', like_count: 4, comments_count: 2, is_shared_to_feed: null, children_count: 2 });
    expect(mediaCalls[1].rows).toHaveLength(1);
    expect(mediaCalls[1].rows[0]).toMatchObject({ id: 'p1' });
    expect(mediaCalls[1].rows[0]).not.toHaveProperty('like_count'); // no details -> stored values untouched
    expect(JSON.stringify(calls)).not.toContain('cdninstagram');
    expect(mediaCalls[0].rows[0]).not.toHaveProperty('cover_status');
    expect(calls[2]).toEqual({ table: 'media_children', rows: [{ media_id: 'c1', position: 0, media_type: 'IMAGE' }, { media_id: 'c1', position: 1, media_type: 'VIDEO' }], opts: { onConflict: 'media_id,position' } });
  });
});
