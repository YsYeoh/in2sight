// Post Lab reads. OWNER SESSION client only (RLS decides what exists; never the admin client, never account_tokens).
// Plain selects for the media row, its same-format predecessors (peers), the day's Stories and the posting-day follower
// counts; the latest values and the velocity checkpoints come from the two `security invoker` functions of
// supabase/migrations/20261026000001_post_lab.sql. Fixed error messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { CHECKPOINTS, PEER_MAX, type CheckpointId, type LabInput, type LabItem, type LabValues } from '@/lib/analysis/post-lab';
import { safeLink } from '@/lib/dashboard/read';
import { LINK_TAP_ACTION } from '@/lib/instagram/metrics';
import type { MediaKind } from '@/lib/instagram/parse';
import type { CoverStatus } from '@/lib/sync/covers';
import { addDays, dayStart, localDay } from '@/lib/sync/time';

/** The day's Stories read for the sequence view (Instagram allows 100 live Stories). */
export const DAY_STORIES_MAX = 100;
const MEDIA_COLUMNS = 'id,account_id,media_type,posted_at,expires_at,gone_at,permalink,caption,cover_status,children_count,media_tags(tag_id)';
const COVERS: readonly string[] = ['pending', 'ok', 'unavailable', 'failed'];
const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];
/** PostgREST "function not found" / Postgres undefined_function: the Post Lab migration is not applied yet. */
const MISSING_FUNCTION = ['PGRST202', '42883'];

export type PostLabRead = { kind: 'ok'; input: LabInput } | { kind: 'not_found' } | { kind: 'needs_migration' };

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const rows = (data: unknown) => (Array.isArray(data) ? (data as Row[]) : []);

function fail(op: string): never {
  throw new Error(`post lab read: ${op} failed`);
}

function toItem(r: Row): LabItem {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    mediaType: r.media_type as MediaKind,
    postedAt: String(r.posted_at),
    expiresAt: str(r.expires_at),
    goneAt: str(r.gone_at),
    permalink: safeLink(r.permalink),
    caption: str(r.caption),
    tagIds: rows(r.media_tags).flatMap((t) => (typeof t.tag_id === 'string' ? [t.tag_id] : [])),
    cover: COVERS.includes(r.cover_status as string) ? (r.cover_status as CoverStatus) : 'pending',
    slides: num(r.children_count),
    measuredAt: null,
    latest: null,
    points: {},
  };
}

/** profile_activity → link taps: the BIO_LINK_CLICKED count, whatever the key's case. */
function linkTaps(activity: unknown): number | null {
  if (activity === null || typeof activity !== 'object' || Array.isArray(activity)) return null;
  const hit = Object.entries(activity as Row).find(([k]) => k.toUpperCase() === LINK_TAP_ACTION);
  return hit ? num(hit[1]) : null;
}

function toValues(r: Row): LabValues {
  const skip = num(r.skip_rate);
  return {
    reach: num(r.reach),
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    saves: num(r.saves),
    shares: num(r.shares),
    interactions: num(r.total_interactions),
    replies: num(r.replies),
    tapsForward: num(r.taps_forward),
    tapsBack: num(r.taps_back),
    exits: num(r.exits),
    swipeForward: num(r.swipe_forward),
    follows: num(r.follows),
    profileVisits: num(r.profile_visits),
    linkTaps: linkTaps(r.profile_activity),
    avgWatchMs: num(r.avg_watch_ms),
    totalWatchMs: num(r.total_watch_ms),
    skipRate: skip === null ? null : skip / 100, // reels_skip_rate is a percent
  };
}

/**
 * Everything the Post Lab needs for one media item of one account: not_found when the item is not that account's
 * (or not visible under RLS), needs_migration when the SQL functions do not exist yet.
 */
export async function loadPostLab(db: SupabaseClient, accountId: string, mediaId: string, tz: string): Promise<PostLabRead> {
  const head = await db.from('media').select(MEDIA_COLUMNS).eq('id', mediaId).eq('account_id', accountId).limit(1);
  if (head.error) fail('item');
  const first = rows(head.data)[0];
  if (!first || !KINDS.includes(first.media_type as string)) return { kind: 'not_found' };
  const base = toItem(first);
  const day = localDay(new Date(base.postedAt), tz);
  const [peerRes, dayRes] = await Promise.all([
    db
      .from('media')
      .select(MEDIA_COLUMNS)
      .eq('account_id', accountId)
      .eq('media_type', base.mediaType)
      .lt('posted_at', base.postedAt)
      .order('posted_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PEER_MAX),
    base.mediaType === 'STORY'
      ? db
          .from('media')
          .select(MEDIA_COLUMNS)
          .eq('account_id', accountId)
          .eq('media_type', 'STORY')
          .gte('posted_at', dayStart(day, tz).toISOString())
          .lt('posted_at', dayStart(addDays(day, 1), tz).toISOString())
          .order('posted_at', { ascending: true })
          .limit(DAY_STORIES_MAX)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (peerRes.error) fail('peers');
  if (dayRes.error) fail('day');
  const peers = rows(peerRes.data).map(toItem);
  const dayItems = rows(dayRes.data).map(toItem);
  const ids = [...new Set([base, ...peers, ...dayItems].map((m) => m.id))];
  const days = [...new Set([base, ...peers].map((m) => localDay(new Date(m.postedAt), tz)))];
  const [latest, points, daily] = await Promise.all([
    db.rpc('post_lab_latest', { p_ids: ids }),
    db.rpc('post_lab_points', { p_ids: [base, ...peers].map((m) => m.id), p_marks: CHECKPOINTS.map((c) => c.min), p_tols: CHECKPOINTS.map((c) => c.tol) }),
    db.from('account_daily').select('day,followers').eq('account_id', accountId).in('day', days),
  ]);
  for (const e of [latest.error, points.error]) if (e && MISSING_FUNCTION.includes(String((e as { code?: unknown }).code))) return { kind: 'needs_migration' };
  if (latest.error) fail('latest');
  if (points.error) fail('points');
  if (daily.error) fail('followers');

  const byId = new Map(rows(latest.data).map((r) => [String(r.media_id), r]));
  const marks = new Map<number, CheckpointId>(CHECKPOINTS.map((c) => [c.min, c.id]));
  const curve = new Map<string, LabItem['points']>();
  for (const r of rows(points.data)) {
    const id = marks.get(Number(r.mark));
    if (!id) continue;
    const key = String(r.media_id);
    curve.set(key, { ...curve.get(key), [id]: { reach: num(r.reach), views: num(r.views) } });
  }
  const fill = (m: LabItem): LabItem => {
    const r = byId.get(m.id);
    return { ...m, measuredAt: r ? str(r.captured_at) : null, latest: r ? toValues(r) : null, points: curve.get(m.id) ?? {} };
  };
  const followers: Record<string, number> = {};
  for (const r of rows(daily.data)) {
    const f = num(r.followers);
    if (f !== null && typeof r.day === 'string') followers[r.day] = f;
  }
  return { kind: 'ok', input: { item: fill(base), peers: peers.map(fill), day: dayItems.map(fill), followers } };
}
