// The single-item level of the drill-down: one post or Story with its latest numbers, the account's follower curve
// around the posting time (follower_snapshots, the only intraday data we have) and an audience slice (that day's
// account-level reach of the item's format, followers vs non-followers). OWNER SESSION client only (RLS).
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeLink } from '@/lib/dashboard/read';
import type { ItemRow } from '@/lib/explorer/read';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, dayStart, localDay } from '@/lib/sync/time';

/** media_type → the media_product_type value of account_daily_breakdown (verified live, docs/META_PROBE_RESULTS.md).
 *  ponytail: an old feed video stored as REELS is a POST there; use media.media_product_type if that ever matters. */
export const PRODUCT_TYPE: Record<MediaKind, string> = { IMAGE: 'POST', CAROUSEL_ALBUM: 'CAROUSEL_CONTAINER', REELS: 'REEL', STORY: 'STORY' };

export interface ItemDetail {
  item: ItemRow;
  measuredAt: string | null; // when the latest snapshot was taken
  day: string; // owner-timezone day it was published
  followers: { at: string; followers: number }[]; // last value per owner-timezone hour, day −1 … day +2
  audience: { follower: number; nonFollower: number } | null; // that day's account reach of this format
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`explorer read: ${op} failed`);
}

/** One media item of the given (live, in-scope) accounts; null when it is not one of them. */
export async function loadItem(db: SupabaseClient, id: string, accounts: string[], tz: string): Promise<ItemDetail | null> {
  if (accounts.length === 0) return null;
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption,media_metrics(captured_at,reach,views,likes,comments,saves,shares)')
    .eq('id', id)
    .in('account_id', accounts)
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(1, { referencedTable: 'media_metrics' })
    .limit(1);
  if (error) fail('item');
  const r = ((data ?? []) as Row[])[0];
  if (!r || !KINDS.includes(r.media_type as string)) return null;
  const m = (Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Row | undefined) : undefined) ?? {};
  const item: ItemRow = {
    id: String(r.id),
    accountId: String(r.account_id),
    mediaType: r.media_type as MediaKind,
    postedAt: String(r.posted_at),
    permalink: safeLink(r.permalink),
    caption: typeof r.caption === 'string' ? r.caption : null,
    reach: num(m.reach),
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
    saves: num(m.saves),
    shares: num(m.shares),
  };
  const day = localDay(new Date(item.postedAt), tz);
  const [f, b] = await Promise.all([
    db.rpc('explorer_followers', { p_account: item.accountId, p_from: dayStart(addDays(day, -1), tz).toISOString(), p_to: dayStart(addDays(day, 3), tz).toISOString(), p_tz: tz, p_hourly: true }),
    db.from('account_daily_breakdown').select('follow_type,value').eq('account_id', item.accountId).eq('day', day).eq('metric', 'reach').eq('product_type', PRODUCT_TYPE[item.mediaType]),
  ]);
  if (f.error) fail('followers');
  if (b.error) fail('audience');
  const split = ((b.data ?? []) as Row[]).reduce<{ follower: number; nonFollower: number }>((acc, x) => {
    const v = num(x.value) ?? 0;
    if (x.follow_type === 'FOLLOWER') acc.follower += v;
    else if (x.follow_type === 'NON_FOLLOWER') acc.nonFollower += v;
    return acc;
  }, { follower: 0, nonFollower: 0 });
  return {
    item,
    measuredAt: typeof m.captured_at === 'string' ? m.captured_at : null,
    day,
    followers: ((f.data ?? []) as Row[]).flatMap((x) => (typeof x.at === 'string' && num(x.followers) !== null ? [{ at: x.at, followers: num(x.followers)! }] : [])),
    audience: (b.data ?? []).length ? split : null,
  };
}
