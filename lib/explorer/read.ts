// Explorer reads. OWNER SESSION client only: the SQL functions are `security invoker`, so RLS decides what comes back.
// Never the admin client. Every ExplorerState maps to fixed RPCs with typed arguments (rollupArgs): nothing from the URL
// reaches SQL as text. Fixed error messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeLink } from '@/lib/dashboard/read';
import type { ExplorerState } from '@/lib/explorer/state';
import type { MediaKind } from '@/lib/instagram/parse';
import { METRICS, type Parts } from '@/lib/metrics';
import type { WeekStart } from '@/lib/prefs';
import { addDays, dayStart } from '@/lib/sync/time';

/** Single posts are the newest ITEM_LIMIT in the range; one more is read to know whether the list was cut. */
export const ITEM_LIMIT = 500;

export type Grain = 'day' | 'week' | 'month';

export interface RollupQuery {
  accounts: string[]; // live account ids in scope (resolved by the page from the state's account/group filters)
  from: string; // first owner-timezone day, inclusive ('YYYY-MM-DD')
  to: string; // last owner-timezone day, inclusive
  tz: string; // the owner's timezone (prefs; the sync writes days in it too)
  weekStart: WeekStart;
  grain: Grain; // bucket size when grouping by time (the Time Scope's effective granularity)
}

export interface ItemRow {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string;
  permalink: string | null;
  caption: string | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`explorer read: ${op} failed`);
}

/** The arguments of explorer_media (shared by the post rollup and the single-posts list). */
function mediaArgs(s: ExplorerState, q: RollupQuery) {
  return {
    p_accounts: q.accounts,
    p_from: dayStart(q.from, q.tz).toISOString(),
    p_to: dayStart(addDays(q.to, 1), q.tz).toISOString(),
    p_tz: q.tz,
    p_format: s.format,
    p_stories: s.format === 'STORY' || s.by === 'format',
    p_tag: s.tag !== null && s.tag !== 'untagged' ? s.tag : null,
    p_untagged: s.tag === 'untagged',
    p_weekday: s.weekday,
    p_hour: s.hour,
  };
}

/** Which RPCs a state needs, with their exact arguments. Pure: the tests pin the mapping. */
export function rollupArgs(s: ExplorerState, q: RollupQuery) {
  const sources = new Set(s.metrics.map((id) => METRICS[id].source));
  const sqlBy = s.by === 'group' ? 'account' : s.by; // groups are summed from accounts in TypeScript
  const daily =
    sources.has('daily') && s.by !== 'post'
      ? { p_accounts: q.accounts, p_from: q.from, p_to: q.to, p_by: sqlBy === 'time' ? 'time' : 'account', p_grain: q.grain, p_week_start: q.weekStart }
      : null;
  const posts = sources.has('posts') && s.by !== 'post' ? { ...mediaArgs(s, q), p_by: sqlBy, p_grain: q.grain, p_week_start: q.weekStart } : null;
  return { daily, posts, media: mediaArgs(s, q) };
}

/** One row per key (account id, group-less bucket, format, tag id / 'untagged', weekday, hour) with its additive parts. */
export async function loadRollup(db: SupabaseClient, s: ExplorerState, q: RollupQuery): Promise<Map<string, Parts>> {
  const out = new Map<string, Parts>();
  if (q.accounts.length === 0) return out;
  const args = rollupArgs(s, q);
  const [d, p] = await Promise.all([args.daily ? db.rpc('explorer_daily', args.daily) : null, args.posts ? db.rpc('explorer_posts', args.posts) : null]);
  if (d?.error) fail('daily');
  if (p?.error) fail('posts');
  const at = (key: string) => out.get(key) ?? out.set(key, { daily: null, posts: null }).get(key)!;
  for (const r of (d?.data ?? []) as Row[]) {
    at(String(r.key)).daily = { reach: num(r.reach), views: num(r.views), interactions: num(r.interactions), erInteractions: num(r.er_interactions), erReach: num(r.er_reach), netFollows: num(r.net_follows), followers: num(r.followers) };
  }
  for (const r of (p?.data ?? []) as Row[]) {
    at(String(r.key)).posts = {
      posts: num(r.posts) ?? 0,
      measured: num(r.measured) ?? 0,
      reachSum: num(r.reach_sum),
      viewsSum: num(r.views_sum),
      viewsN: num(r.views_n) ?? 0,
      likes: num(r.likes),
      comments: num(r.comments),
      saves: num(r.saves),
      shares: num(r.shares),
      erInteractions: num(r.er_interactions),
      erReach: num(r.er_reach),
    };
  }
  return out;
}

/** The newest ITEM_LIMIT media in scope (same filters as the post rollup), newest first; truncated = there were more. */
export async function loadItems(db: SupabaseClient, s: ExplorerState, q: RollupQuery): Promise<{ items: ItemRow[]; truncated: boolean }> {
  if (q.accounts.length === 0) return { items: [], truncated: false };
  const { data, error } = await db
    .rpc('explorer_media', rollupArgs(s, q).media)
    .select('id,account_id,media_type,posted_at,permalink,caption,reach,views,likes,comments,saves,shares')
    .order('posted_at', { ascending: false })
    .limit(ITEM_LIMIT + 1);
  if (error) fail('items');
  const rows = ((data ?? []) as Row[]).filter((r) => KINDS.includes(r.media_type as string));
  return {
    truncated: rows.length > ITEM_LIMIT,
    items: rows.slice(0, ITEM_LIMIT).map((r) => ({
      id: String(r.id),
      accountId: String(r.account_id),
      mediaType: r.media_type as MediaKind,
      postedAt: String(r.posted_at),
      permalink: safeLink(r.permalink), // rendered as a link: https only
      caption: str(r.caption),
      reach: num(r.reach),
      views: num(r.views),
      likes: num(r.likes),
      comments: num(r.comments),
      saves: num(r.saves),
      shares: num(r.shares),
    })),
  };
}
