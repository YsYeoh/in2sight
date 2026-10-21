// Growth tab reads (Plan 15a). OWNER SESSION client only (RLS: owner select); explicit columns, hard row caps, fixed
// error messages (Supabase messages can echo values). Never the admin client, never account_tokens.
// No SQL on purpose: one account's reach breakdown is ~8 rows a day, so everything here is a handful of requests.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUDIENCE_KINDS, audienceRow, type AudienceSnapshots } from '@/lib/dashboard/detail-read';
import { MISSING_FUNCTION, readPages } from '@/lib/dashboard/read';
import { addDays, localDay } from '@/lib/sync/time';

/** 5 years x ~8 rows a day, newest first. */
export const BREAKDOWN_LIMIT = 20_000;
export const DAY_COUNT_LIMIT = 5000;

export interface BreakdownRow {
  day: string;
  followType: string;
  productType: string;
  value: number;
}

/** `from` = the first owner-timezone day counted completely when the read stopped at DAY_COUNT_LIMIT (older days are unknown); null = the whole window is counted. */
export interface DayCounts {
  days: Record<string, number>;
  from: string | null;
}

type Row = Record<string, unknown>;

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

/** Reach by follow type and format, one row per (day, follow type, product type).
 *  ponytail: ~8 rows a day, 15 requests for 5 years; a `security invoker` rollup function is the upgrade if Server-Timing says so. */
export async function loadReachBreakdown(db: SupabaseClient, accountId: string, fromDay: string, toDay: string): Promise<BreakdownRow[]> {
  const { rows } = await readPages(
    (from, to) =>
      db
        .from('account_daily_breakdown')
        .select('day,follow_type,product_type,value')
        .eq('account_id', accountId)
        .eq('metric', 'reach')
        .gte('day', fromDay)
        .lte('day', toDay)
        .order('day', { ascending: false })
        .order('follow_type', { ascending: true })
        .order('product_type', { ascending: true })
        .range(from, to),
    'reach breakdown',
    { max: BREAKDOWN_LIMIT },
  );
  return rows.flatMap((r) => (typeof r.value === 'number' && Number.isFinite(r.value) ? [{ day: String(r.day), followType: String(r.follow_type), productType: String(r.product_type), value: r.value }] : []));
}

/** The hourly follower curve (last value per owner-timezone hour) from `explorer_followers`; null = the function does not exist yet. */
export async function loadFollowerCurve(db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string): Promise<{ at: string; followers: number }[] | null> {
  const { data, error } = await db.rpc('explorer_followers', { p_account: accountId, p_from: fromIso, p_to: toIso, p_tz: tz, p_hourly: true });
  if (error) return MISSING_FUNCTION.includes(String((error as { code?: unknown }).code)) ? null : fail('follower curve');
  return ((data ?? []) as Row[]).flatMap((r) => (typeof r.at === 'string' && typeof r.followers === 'number' && Number.isFinite(r.followers) ? [{ at: r.at, followers: r.followers }] : []));
}

/** Rows per owner-timezone day, newest first, capped at DAY_COUNT_LIMIT; the oldest counted day of a capped read may be cut, so it is dropped. */
async function dayCounts(db: SupabaseClient, table: 'media' | 'comments', column: 'posted_at' | 'commented_at', op: string, accountId: string, fromIso: string, toIso: string, tz: string): Promise<DayCounts> {
  const { rows, truncated } = await readPages(
    (from, to) => {
      const q = db.from(table).select(column).eq('account_id', accountId);
      return (table === 'media' ? q.eq('media_type', 'STORY') : q).gte(column, fromIso).lt(column, toIso).order(column, { ascending: false }).range(from, to);
    },
    op,
    { max: DAY_COUNT_LIMIT },
  );
  const days: Record<string, number> = {};
  let oldest: string | null = null;
  for (const r of rows) {
    const t = new Date(String(r[column]));
    if (Number.isNaN(t.getTime())) continue;
    const d = localDay(t, tz);
    days[d] = (days[d] ?? 0) + 1;
    oldest = d;
  }
  if (!truncated || oldest === null) return { days, from: null };
  delete days[oldest];
  return { days, from: addDays(oldest, 1) };
}

export const loadStoryDays = (db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string) => dayCounts(db, 'media', 'posted_at', 'story days', accountId, fromIso, toIso, tz);
export const loadCommentDays = (db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string) => dayCounts(db, 'comments', 'commented_at', 'comment days', accountId, fromIso, toIso, tz);

/** Per audience kind, the first and the latest snapshot inside the day window (6 single-row reads). */
export async function loadAudienceEnds(db: SupabaseClient, accountId: string, fromDay: string, toDay: string): Promise<{ first: AudienceSnapshots; last: AudienceSnapshots }> {
  const end = async (kind: string, ascending: boolean) => {
    const { data, error } = await db.from('audience_snapshots').select('day,data').eq('account_id', accountId).eq('kind', kind).gte('day', fromDay).lte('day', toDay).order('day', { ascending }).limit(1);
    if (error) fail('audience ends');
    return audienceRow(((data ?? []) as Row[])[0]);
  };
  const [age, country, city] = await Promise.all(AUDIENCE_KINDS.map((kind) => Promise.all([end(kind, true), end(kind, false)])));
  return {
    first: { age_gender: age[0], country: country[0], city: city[0] },
    last: { age_gender: age[1], country: country[1], city: city[1] },
  };
}
