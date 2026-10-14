// Account detail, Tags and Calendar reads. OWNER SESSION client only (RLS: owner select); explicit columns, hard
// limits, fixed error messages (Supabase messages can echo values). Never the admin client, never account_tokens.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnlineFollowersRow, Post, Tag } from '@/lib/analysis/types';
import { MEDIA_LIMIT, rowToPost, safeLink } from '@/lib/dashboard/read';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { MediaKind } from '@/lib/instagram/parse';

/** Stories are read for the last 14 days; ~10 a day is already a heavy poster. */
export const STORY_LIMIT = 200;
export const TAG_LIMIT = 500;
/** One month of posts + stories over 3-4 accounts stays far below this (PostgREST's default cap is 1000). */
const MONTH_LIMIT = 1000;
const ONLINE_LIMIT = 1000;
const AUDIENCE_KINDS: AudienceKind[] = ['age_gender', 'country', 'city'];

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

export interface PostRow extends Post {
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

export interface StoryRow {
  id: string;
  postedAt: string;
  expiresAt: string | null;
  permalink: string | null;
  snapshots: StorySnapshot[]; // oldest first; empty when Instagram never shared metrics (under 5 viewers)
}

export type AudienceSnapshots = Record<AudienceKind, { day: string; data: Record<string, number> } | null>;

export interface MonthMedia {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string;
  permalink: string | null;
  caption: string | null;
}

/** Feed posts + reels (no stories), newest first, each with its latest metrics snapshot, caption and tag ids. */
export async function loadPostRows(db: SupabaseClient, accountId: string): Promise<PostRow[]> {
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption,media_metrics(captured_at,reach,views,likes,comments,shares,saves),media_tags(tag_id)')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(MEDIA_LIMIT)
    .limit(1, { referencedTable: 'media_metrics' });
  if (error) fail('post rows');
  return ((data ?? []) as Row[]).flatMap((r) => {
    const p = rowToPost(r);
    if (!p || p.mediaType === 'STORY') return [];
    const tags = Array.isArray(r.media_tags) ? (r.media_tags as Row[]) : [];
    return [{ ...p, caption: str(r.caption), tagIds: tags.map((t) => str(t.tag_id)).filter((t): t is string => t !== null) }];
  });
}

/** Stories posted since `sinceIso`, newest first, with every snapshot (oldest first).
 *  ponytail: snapshots are embedded without a per-story cap, so 200 stories x 30-minute snapshots is the ceiling;
 *  if that gets heavy, read only the latest snapshot for finished stories. */
export async function loadStories(db: SupabaseClient, accountId: string, sinceIso: string): Promise<StoryRow[]> {
  const { data, error } = await db
    .from('media')
    .select('id,posted_at,expires_at,permalink,media_metrics(captured_at,reach,views,replies,shares,total_interactions,taps_forward,taps_back,exits)')
    .eq('account_id', accountId)
    .eq('media_type', 'STORY')
    .gte('posted_at', sinceIso)
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: true, referencedTable: 'media_metrics' })
    .limit(STORY_LIMIT);
  if (error) fail('stories');
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    postedAt: String(r.posted_at),
    expiresAt: str(r.expires_at),
    permalink: safeLink(r.permalink),
    snapshots: (Array.isArray(r.media_metrics) ? (r.media_metrics as Row[]) : []).map((m) => ({
      capturedAt: String(m.captured_at),
      reach: num(m.reach),
      views: num(m.views),
      replies: num(m.replies),
      shares: num(m.shares),
      interactions: num(m.total_interactions),
      tapsForward: num(m.taps_forward),
      tapsBack: num(m.taps_back),
      exits: num(m.exits),
    })),
  }));
}

const isCounts = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The latest snapshot of each audience kind (one small query per kind, in parallel). Non-numeric values are dropped. */
export async function loadAudience(db: SupabaseClient, accountId: string): Promise<AudienceSnapshots> {
  const rows = await Promise.all(
    AUDIENCE_KINDS.map(async (kind) => {
      const { data, error } = await db.from('audience_snapshots').select('day,data').eq('account_id', accountId).eq('kind', kind).order('day', { ascending: false }).limit(1);
      if (error) fail('audience');
      const r = ((data ?? []) as Row[])[0];
      if (!r || !isCounts(r.data)) return null;
      const counts = Object.fromEntries(Object.entries(r.data).flatMap(([k, v]) => (num(v) !== null ? [[k, v as number]] : [])));
      return { day: String(r.day), data: counts };
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

/** Every media item (posts AND stories) published in [fromIso, toIso) for the given accounts, oldest first.
 *  `truncated`: the read hit MONTH_LIMIT rows, so the latest days of the month may be missing. */
export async function loadMonthMedia(db: SupabaseClient, accountIds: string[], fromIso: string, toIso: string): Promise<{ media: MonthMedia[]; truncated: boolean }> {
  if (accountIds.length === 0) return { media: [], truncated: false };
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption')
    .in('account_id', accountIds)
    .gte('posted_at', fromIso)
    .lt('posted_at', toIso)
    .order('posted_at', { ascending: true })
    .limit(MONTH_LIMIT);
  if (error) fail('month media');
  const rows = (data ?? []) as Row[];
  const media = rows.flatMap((r) => {
    const p = rowToPost({ ...r, media_metrics: [] });
    return p ? [{ id: p.id, accountId: p.accountId, mediaType: p.mediaType, postedAt: p.postedAt, permalink: p.permalink, caption: str(r.caption) }] : [];
  });
  return { media, truncated: rows.length >= MONTH_LIMIT };
}
