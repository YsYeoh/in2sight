import { describe, expect, it } from 'vitest';
import { igData } from '@/lib/instagram/data';
import type { MediaDetails } from '@/lib/instagram/parse';
import { runAccount, type RunContext } from '@/lib/sync/run-account';
import { emptyState } from '@/lib/sync/schedule';
import { supabaseSyncStore } from '@/lib/sync/store';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const NOW = new Date('2026-10-14T02:00:00Z');
const ACC = 'a1';
const URL1 = 'https://scontent-sin6-1.cdninstagram.com/v/story1.jpg?oe=1&_nc_sig=SECRET';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 0xff, 0xd9]);
const details = (o: Partial<MediaDetails> = {}): MediaDetails => ({ mediaType: 'IMAGE', productType: 'STORY', likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: URL1, thumbnailUrl: null, childrenCount: null, children: null, ...o });
const story = (id: string, d?: MediaDetails, ageMin = 45) => ({ id, kind: 'STORY' as const, caption: null, permalink: null, postedAt: new Date(NOW.getTime() - ageMin * 60_000).toISOString(), details: d });

function ctx(cdn: (url: string) => Response | Promise<Response>) {
  const ig = fakeIg();
  const mem = memoryStore();
  const acc = account({ id: ACC });
  const seen: string[] = [];
  const cdnFetch = (async (input: string | URL) => (seen.push(String(input)), cdn(String(input)))) as typeof fetch;
  const c: RunContext = { ig, store: mem.store, accounts: fakeAccounts([acc]).accounts, account: acc, token: 'IGQ-secret', state: emptyState(ACC), tz: 'UTC', now: NOW, deadline: 1, clock: () => 0, cdnFetch };
  return { c, ig, mem, seen };
}
const jpeg = () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });

describe('Story covers on first sight', () => {
  it('copies a live Story cover into {account}/{media}.jpg once; the next pass does not fetch it again', async () => {
    const { c, ig, mem, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('s1', details())]);
    const { result } = await runAccount(c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(mem.uploads).toEqual([{ path: 'a1/s1.jpg', bytes: JPEG.byteLength, contentType: 'image/jpeg' }]);
    expect(mem.covers.get('s1')).toEqual({ status: 'ok', attempts: 1, triedAt: NOW.toISOString(), path: 'a1/s1.jpg' });
    await runAccount(c, ['stories']);
    expect(seen).toHaveLength(1);
  });

  it('video Story: the thumbnail is copied, never the video', async () => {
    const { c, ig, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('v1', details({ mediaType: 'VIDEO', mediaUrl: 'https://scontent.cdninstagram.com/v.mp4', thumbnailUrl: URL1 }))]);
    await runAccount(c, ['stories']);
    expect(seen).toEqual([URL1]);
  });

  it('expired link or a redirect to a foreign host: a failed attempt, the Story snapshot is unaffected', async () => {
    for (const cdn of [() => new Response('gone', { status: 403 }), () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x.jpg' } })]) {
      const { c, ig, mem, seen } = ctx(cdn);
      ig.listStories.mockResolvedValue([story('s1', details())]);
      const { result } = await runAccount(c, ['stories']);
      expect(result.outcome).toBe('ok');
      expect(mem.metrics).toHaveLength(1);
      expect(mem.covers.get('s1')).toMatchObject({ status: 'failed', attempts: 1 });
      expect(seen.some((u) => u.includes('evil.example'))).toBe(false);
    }
  });

  it('retried on every live pass, then given up after 5 attempts', async () => {
    const { c, ig, mem } = ctx(() => new Response('x', { status: 500 }));
    ig.listStories.mockResolvedValue([story('s1', details())]);
    for (let i = 0; i < 6; i++) await runAccount(c, ['stories']);
    expect(mem.covers.get('s1')).toMatchObject({ status: 'unavailable', attempts: 5 });
  });

  it('no URL offered (Story URL fields unsupported): no attempt counted; once expired it becomes unavailable', async () => {
    const { c, ig, mem, seen } = ctx(jpeg);
    ig.listStories.mockResolvedValue([story('s1')]);
    await runAccount(c, ['stories']);
    expect(seen).toHaveLength(0);
    expect(mem.covers.get('s1')).toBeUndefined();
    const later: RunContext = { ...c, now: new Date(NOW.getTime() + 25 * 3_600_000) };
    ig.listStories.mockResolvedValue([]);
    await runAccount(later, ['stories']);
    expect(mem.covers.get('s1')).toMatchObject({ status: 'unavailable' });
  });

  it('Storage down: a failed attempt; database down: the Story capture still succeeds', async () => {
    const storage = ctx(jpeg);
    storage.ig.listStories.mockResolvedValue([story('s1', details())]);
    storage.mem.store.uploadCover = async () => {
      throw new Error('sync store: uploadCover failed');
    };
    expect((await runAccount(storage.c, ['stories'])).result.outcome).toBe('ok');
    expect(storage.mem.covers.get('s1')).toMatchObject({ status: 'failed', attempts: 1 });

    const db = ctx(jpeg);
    db.ig.listStories.mockResolvedValue([story('s1', details())]);
    db.mem.store.coverRefs = async () => {
      throw new Error('sync store: coverRefs failed');
    };
    const { result } = await runAccount(db.c, ['stories']);
    expect(result.outcome).toBe('ok');
    expect(db.mem.metrics).toHaveLength(1);
  });
});

describe('cover persistence', () => {
  type Call = { table: string; op: string; row?: unknown; filters: unknown[][] };
  function recorder(storageError: unknown = null, data: unknown = []) {
    const calls: Call[] = [];
    const uploads: unknown[][] = [];
    const db = {
      from(table: string) {
        const c: Call = { table, op: 'select', filters: [] };
        calls.push(c);
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.update = (row: unknown) => ((c.op = 'update'), (c.row = row), chain);
        for (const f of ['eq', 'in', 'is', 'neq', 'lt', 'order', 'limit']) chain[f] = (...a: unknown[]) => (c.filters.push([f, ...a]), chain);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res);
        return chain;
      },
      storage: { from: (bucket: string) => ({ upload: async (...a: unknown[]) => (uploads.push([bucket, ...a]), { data: null, error: storageError }) }) },
    };
    return { db: db as never, calls, uploads };
  }

  it('coverRefs: pending/failed, not gone; Stories by id, otherwise feed + Reels; newest first, limited', async () => {
    const r = recorder(null, [{ id: 'p1', media_type: 'IMAGE', posted_at: 'x', cover_status: 'failed', cover_attempts: 2, cover_tried_at: 'y' }]);
    const s = supabaseSyncStore(r.db);
    expect(await s.coverRefs(ACC, { limit: 25 })).toEqual([{ id: 'p1', kind: 'IMAGE', postedAt: 'x', status: 'failed', attempts: 2, triedAt: 'y' }]);
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', ACC], ['in', 'cover_status', ['pending', 'failed']], ['is', 'gone_at', null], ['neq', 'media_type', 'STORY'], ['order', 'posted_at', { ascending: false }], ['limit', 25]]);
    await s.coverRefs(ACC, { ids: ['s1'], limit: 1 });
    expect(r.calls[1].filters).toContainEqual(['in', 'id', ['s1']]);
    expect(r.calls[1].filters).not.toContainEqual(['neq', 'media_type', 'STORY']);
  });

  it('markCover: ok stores path + captured time; a failure only the attempt', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.markCover('p1', { status: 'ok', attempts: 1, triedAt: 'T', path: 'a1/p1.jpg' });
    await s.markCover('p2', { status: 'failed', attempts: 2, triedAt: 'T' });
    expect(r.calls[0].row).toEqual({ cover_status: 'ok', cover_attempts: 1, cover_tried_at: 'T', cover_path: 'a1/p1.jpg', cover_captured_at: 'T' });
    expect(r.calls[1].row).toEqual({ cover_status: 'failed', cover_attempts: 2, cover_tried_at: 'T' });
  });

  it('uploadCover: private bucket, never overwrites, an existing object counts as stored, anything else throws', async () => {
    const ok = recorder();
    await supabaseSyncStore(ok.db).uploadCover('a1/p1.jpg', JPEG, 'image/jpeg');
    expect(ok.uploads[0]).toEqual(['covers', 'a1/p1.jpg', JPEG, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }]);
    await expect(supabaseSyncStore(recorder({ statusCode: '409', message: 'The resource already exists' }).db).uploadCover('p', JPEG, 'image/jpeg')).resolves.toBeUndefined();
    await expect(supabaseSyncStore(recorder({ statusCode: '500', message: 'boom' }).db).uploadCover('p', JPEG, 'image/jpeg')).rejects.toThrow('sync store: uploadCover failed');
  });

  it('expireStoryCovers only touches unfinished Stories past their expiry', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).expireStoryCovers(ACC, NOW.toISOString());
    expect(r.calls[0]).toMatchObject({ op: 'update', row: { cover_status: 'unavailable' } });
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', ACC], ['eq', 'media_type', 'STORY'], ['in', 'cover_status', ['pending', 'failed']], ['lt', 'expires_at', NOW.toISOString()]]);
  });

  it('mediaCover asks the cover fields of one media item', async () => {
    const seen: URL[] = [];
    const fn = (async (input: string | URL) => (seen.push(new URL(String(input))), new Response(JSON.stringify({ media_type: 'VIDEO', thumbnail_url: URL1 })))) as typeof fetch;
    expect(await igData('v25.0', fn).mediaCover('t', 'm1')).toMatchObject({ mediaType: 'VIDEO', thumbnailUrl: URL1 });
    expect(seen[0].pathname).toBe('/v25.0/m1');
    expect(seen[0].searchParams.get('fields')).toBe('media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}');
  });
});
