// Account detail, Tags and Calendar reads. OWNER SESSION client only (RLS: owner select); explicit columns, hard
// limits, fixed error messages (Supabase messages can echo values). Never the admin client, never account_tokens.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnlineFollowersRow, Post, Tag } from '@/lib/analysis/types';
import type { FeedFormat, StoryFinal } from '@/lib/dashboard/content';
import type { PostSortKey, StorySort } from '@/lib/dashboard/lists';
import { MEDIA_LIMIT, MISSING_FUNCTION, PAGE, reaches, readPages, rowToPost, safeLink } from '@/lib/dashboard/read';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { MediaKind } from '@/lib/instagram/parse';
import type { CoverStatus } from '@/lib/sync/covers';

/** Newest Stories per account per range: each carries every snapshot (~48), so a year of Stories would be megabytes. The tab says when it is capped. */
export const STORY_LIMIT = 200;
export const TAG_LIMIT = 500;
/** Calendar items (posts + Stories of every account in scope) read for one range, in 1,000-row pages; past this the page says "too many". */
export const CALENDAR_LIMIT = 5000;
const ONLINE_LIMIT = 1000;
export const AUDIENCE_KINDS: AudienceKind[] = ['age_gender', 'country', 'city'];

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

const COVER_STATUSES: readonly string[] = ['pending', 'ok', 'unavailable', 'failed'];
/** media.cover_status as stored (Plan 11b); any other value counts as "not saved yet", so the UI never requests it. */
export const coverOf = (v: unknown): CoverStatus => (COVER_STATUSES.includes(v as string) ? (v as CoverStatus) : 'pending');

/** What the cover UI needs from a media row (optional: hand-built rows and the exports leave them out = no cover). */
export interface CoverFields {
  cover?: CoverStatus;
  slides?: number | null; // children_count of a carousel; null = unknown
}

export interface PostRow extends Post, CoverFields {
  caption: string | null;
  tagIds: string[];
}

export interface StorySnapshot {
  capturedAt: string;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  interactions: number | null;
  tapsForward: number | null;
  tapsBack: number | null;
  exits: number | null;
}

export interface StoryRow extends CoverFields {
  id: string;
  postedAt: string;
  expiresAt: string | null;
  permalink: string | null;
  snapshots: StorySnapshot[]; // oldest first; empty when Instagram never shared metrics (under 5 viewers)
}

export type AudienceSnapshots = Record<AudienceKind, { day: string; data: Record<string, number> } | null>;

export interface MonthMedia extends CoverFields {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string;
  permalink: string | null;
  caption: string | null;
}

/** Feed posts + reels (no stories), newest first, each with its latest metrics snapshot, caption and tag ids: the newest MEDIA_LIMIT and, with `since`, every older one back to that instant. */
export async function loadPostRows(db: SupabaseClient, accountId: string, since: string | null = null): Promise<PostRow[]> {
  const { rows } = await readPages(
    (from, to) =>
      db
        .from('media')
        .select('id,account_id,media_type,posted_at,permalink,caption,cover_status,children_count,media_metrics(captured_at,reach,views,likes,comments,shares,saves),media_tags(tag_id)')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .order('posted_at', { ascending: false })
        .order('id', { ascending: false })
        .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
        .range(from, to)
        .limit(1, { referencedTable: 'media_metrics' }),
    'post rows',
    { size: MEDIA_LIMIT, enough: reaches(MEDIA_LIMIT, since) },
  );
  return rows.flatMap((r) => {
    const p = rowToPost(r);
    if (!p || p.mediaType === 'STORY') return [];
    const tags = Array.isArray(r.media_tags) ? (r.media_tags as Row[]) : [];
    return [{ ...p, caption: str(r.caption), tagIds: tags.map((t) => str(t.tag_id)).filter((t): t is string => t !== null), cover: coverOf(r.cover_status), slides: num(r.children_count) }];
  });
}

/** Stories posted in [fromIso, toIso), newest first, with every snapshot (oldest first); at most STORY_LIMIT, `truncated` when there are more.
 *  ponytail: snapshots are embedded without a per-story cap, so 200 stories x 30-minute snapshots is the ceiling. The
 *  Stories TAB reads loadStoryPage (story_list, no cap, Plan 14b); this capped read remains for the exports and as the
 *  tab's fallback until migration 20261027000001 is applied. */
export async function loadStories(db: SupabaseClient, accountId: string, fromIso: string, toIso: string): Promise<{ stories: StoryRow[]; truncated: boolean }> {
  const { data, error } = await db
    .from('media')
    .select('id,posted_at,expires_at,permalink,cover_status,media_metrics(captured_at,reach,views,replies,shares,total_interactions,taps_forward,taps_back,exits)')
    .eq('account_id', accountId)
    .eq('media_type', 'STORY')
    .gte('posted_at', fromIso)
    .lt('posted_at', toIso)
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: true, referencedTable: 'media_metrics' })
    .limit(STORY_LIMIT + 1);
  if (error) fail('stories');
  const rows = (data ?? []) as Row[];
  return { stories: rows.slice(0, STORY_LIMIT).map(rowToStory), truncated: rows.length > STORY_LIMIT };
}

const snapshotOf = (m: Row): StorySnapshot => ({
  capturedAt: String(m.captured_at),
  reach: num(m.reach),
  views: num(m.views),
  replies: num(m.replies),
  shares: num(m.shares),
  interactions: num(m.total_interactions),
  tapsForward: num(m.taps_forward),
  tapsBack: num(m.taps_back),
  exits: num(m.exits),
});

function rowToStory(r: Row): StoryRow {
  return {
    id: String(r.id),
    postedAt: String(r.posted_at),
    expiresAt: str(r.expires_at),
    permalink: safeLink(r.permalink),
    cover: coverOf(r.cover_status),
    snapshots: (Array.isArray(r.media_metrics) ? (r.media_metrics as Row[]) : []).map(snapshotOf),
  };
}

const missing = (e: unknown) => MISSING_FUNCTION.includes(String((e as { code?: unknown }).code));

export interface PostPageArgs {
  fromIso: string;
  toIso: string;
  q: string; // '' = no search
  format: FeedFormat | null;
  tag: string | null; // a tag id, 'untagged', or no filter
  sort: { key: PostSortKey; asc: boolean };
  page: number; // 1-based
  size: number;
}

/** One page of an account's feed posts, filtered, sorted and counted by `post_list` (migration 20261027000001), each with
 *  its latest snapshot and tag ids. A page past the end (a stale link) is read again as page 1.
 *  null = the function does not exist yet: the caller falls back to loadPostRows. */
export async function loadPostPage(db: SupabaseClient, accountId: string, a: PostPageArgs): Promise<{ rows: PostRow[]; total: number; page: number } | null> {
  const { data, error } = await db.rpc('post_list', {
    p_account: accountId,
    p_from: a.fromIso,
    p_to: a.toIso,
    p_q: a.q || null,
    p_format: a.format,
    p_tag: a.tag && a.tag !== 'untagged' ? a.tag : null,
    p_untagged: a.tag === 'untagged',
    p_sort: a.sort.key,
    p_asc: a.sort.asc,
    p_offset: (a.page - 1) * a.size,
    p_limit: a.size,
  });
  if (error) return missing(error) ? null : fail('post page');
  const rows = (data ?? []) as Row[];
  if (rows.length === 0 && a.page > 1) return loadPostPage(db, accountId, { ...a, page: 1 });
  return {
    rows: rows.flatMap((r) => {
      const p = rowToPost({ ...r, account_id: accountId, media_metrics: [r] }); // the row carries the latest snapshot's columns
      return p ? [{ ...p, caption: str(r.caption), tagIds: Array.isArray(r.tag_ids) ? r.tag_ids.map(String) : [], cover: coverOf(r.cover_status), slides: num(r.children_count) }] : [];
    }),
    total: Number(rows[0]?.total ?? 0),
    page: a.page,
  };
}

export interface StoryPageArgs {
  fromIso: string;
  toIso: string;
  tz: string; // owner timezone: the days of the "newest" pages
  measured: boolean | null;
  sort: StorySort;
  page: number; // 1-based: days (newest) or Stories
  size: number;
}

/** One page of an account's Stories with their final numbers, by `story_list` (migration 20261027000001): whole
 *  owner-timezone days for "newest", Stories for the other sorts. A page past the end is read again as page 1.
 *  null = the function does not exist yet: the caller falls back to loadStories (capped). */
export async function loadStoryPage(db: SupabaseClient, accountId: string, a: StoryPageArgs): Promise<{ stories: StoryFinal[]; items: number; days: number; page: number } | null> {
  const { data, error } = await db.rpc('story_list', { p_account: accountId, p_from: a.fromIso, p_to: a.toIso, p_tz: a.tz, p_measured: a.measured, p_sort: a.sort, p_offset: (a.page - 1) * a.size, p_limit: a.size });
  if (error) return missing(error) ? null : fail('story page');
  const rows = (data ?? []) as Row[];
  if (rows.length === 0 && a.page > 1) return loadStoryPage(db, accountId, { ...a, page: 1 });
  return {
    stories: rows.map((r) => ({
      id: String(r.id),
      postedAt: String(r.posted_at),
      expiresAt: str(r.expires_at),
      permalink: safeLink(r.permalink),
      cover: coverOf(r.cover_status),
      final: r.captured_at ? snapshotOf(r) : null, // no snapshot: Instagram never shared numbers
      snapshots: num(r.snapshots) ?? 0,
      progression: Array.isArray(r.progression) ? r.progression.map(num) : [],
    })),
    items: Number(rows[0]?.items ?? 0),
    days: Number(rows[0]?.days ?? 0),
    page: a.page,
  };
}

const isCounts = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One audience_snapshots row as { day, data }: null without a row or when `data` is not a plain object; non-numeric counts are dropped. */
export function audienceRow(r: Row | undefined): { day: string; data: Record<string, number> } | null {
  if (!r || !isCounts(r.data)) return null;
  const counts = Object.fromEntries(Object.entries(r.data).flatMap(([k, v]) => (num(v) !== null ? [[k, v as number]] : [])));
  return { day: String(r.day), data: counts };
}

/** The latest snapshot of each audience kind (one small query per kind, in parallel). Non-numeric values are dropped. */
export async function loadAudience(db: SupabaseClient, accountId: string): Promise<AudienceSnapshots> {
  const rows = await Promise.all(
    AUDIENCE_KINDS.map(async (kind) => {
      const { data, error } = await db.from('audience_snapshots').select('day,data').eq('account_id', accountId).eq('kind', kind).order('day', { ascending: false }).limit(1);
      if (error) fail('audience');
      return audienceRow(((data ?? []) as Row[])[0]);
    }),
  );
  return { age_gender: rows[0], country: rows[1], city: rows[2] };
}

/** online_followers rows from `fromDay` on for the given accounts, grouped by account. */
export async function loadOnline(db: SupabaseClient, accountIds: string[], fromDay: string): Promise<Record<string, OnlineFollowersRow[]>> {
  const out: Record<string, OnlineFollowersRow[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (accountIds.length === 0) return out;
  const { data, error } = await db.from('online_followers').select('account_id,day,hourly').in('account_id', accountIds).gte('day', fromDay).order('day', { ascending: true }).limit(ONLINE_LIMIT);
  if (error) fail('online followers');
  for (const r of (data ?? []) as Row[]) {
    const id = String(r.account_id);
    out[id]?.push({ day: String(r.day), hourly: Array.isArray(r.hourly) ? r.hourly.map(num) : [] });
  }
  return out;
}

export async function loadTags(db: SupabaseClient): Promise<Tag[]> {
  const { data, error } = await db.from('tags').select('id,name,color').order('name', { ascending: true }).limit(TAG_LIMIT);
  if (error) fail('tags');
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), color: String(r.color) }));
}

/** Every media item (posts AND stories) published in [fromIso, toIso) for the given accounts, oldest first, in pages.
 *  `truncated`: the read stopped at CALENDAR_LIMIT rows, so the latest days of the range may be missing. */
export async function loadMonthMedia(db: SupabaseClient, accountIds: string[], fromIso: string, toIso: string): Promise<{ media: MonthMedia[]; truncated: boolean }> {
  if (accountIds.length === 0) return { media: [], truncated: false };
  const { rows, truncated } = await readPages(
    (from, to) =>
      db
        .from('media')
        .select('id,account_id,media_type,posted_at,permalink,caption,cover_status,children_count')
        .in('account_id', accountIds)
        .gte('posted_at', fromIso)
        .lt('posted_at', toIso)
        .order('posted_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    'month media',
    { size: PAGE, max: CALENDAR_LIMIT },
  );
  const media = rows.flatMap((r) => {
    const p = rowToPost({ ...r, media_metrics: [] });
    return p ? [{ id: p.id, accountId: p.accountId, mediaType: p.mediaType, postedAt: p.postedAt, permalink: p.permalink, caption: str(r.caption), cover: coverOf(r.cover_status), slides: num(r.children_count) }] : [];
  });
  return { media, truncated };
}
