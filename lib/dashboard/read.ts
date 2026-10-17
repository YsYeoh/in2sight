// Dashboard reads. Always the OWNER SESSION client (createServerSupabase): RLS lets the owner select, nothing else.
// Never the admin client here. Errors carry fixed messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { MediaKind } from '@/lib/instagram/parse';
import { listSyncStatus, type SyncStatus } from '@/lib/sync/store';
import { dayStart } from '@/lib/sync/time';

/** Post reads always include the newest 500 (SPEC §7c backfill size; flags and heatmaps use them), then reach back as far as the Time Scope needs. */
export const MEDIA_LIMIT = 500;
/** PostgREST answers at most 1,000 rows per request (Supabase's default max-rows): a shorter page is the last page. */
export const PAGE = 1000;
/** Safety stop for one paged read. ponytail: 10,000 posts per account in one scope is far beyond any real account; raise it if one ever gets close. */
export const MAX_ROWS = 10_000;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MEDIA_KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

/**
 * Reads page after page with `.range(from, to)` until a page comes back short, `enough(rows)` says so, or `max` rows
 * are in (truncated = stopped there with possibly more left). The query must be ordered, so pages never overlap.
 */
export async function readPages(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  op: string,
  o: { size?: number; max?: number; enough?: (rows: Row[]) => boolean } = {},
): Promise<{ rows: Row[]; truncated: boolean }> {
  const size = o.size ?? PAGE;
  const max = o.max ?? MAX_ROWS;
  const rows: Row[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + size - 1);
    if (error) fail(op);
    const got = Array.isArray(data) ? (data as Row[]) : [];
    rows.push(...got);
    if (got.length < size || o.enough?.(rows)) return { rows, truncated: false };
    if (rows.length >= max) return { rows, truncated: true };
  }
}

/** A newest-first media read is complete once it holds the newest `n` rows and reaches back past `since` (an ISO instant). */
export const reaches = (n: number, since: string | null) => (rows: Row[]) => rows.length >= n && (since === null || Date.parse(String(rows[rows.length - 1].posted_at)) < Date.parse(since));

export function rowToDaily(r: Row): DailyRow {
  return {
    day: String(r.day),
    followers: num(r.followers),
    reach: num(r.reach),
    views: num(r.views),
    accountsEngaged: num(r.accounts_engaged),
    interactions: num(r.total_interactions),
    follows: num(r.follows),
    unfollows: num(r.unfollows),
    linkTaps: num(r.link_taps),
  };
}

/** Permalinks are rendered as external links: keep only https URLs (a stored `javascript:` value must never reach an href). */
export const safeLink = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//i.test(v) ? v : null);

/** A media row with its embedded latest media_metrics snapshot (array of 0 or 1). Unknown media types are dropped. */
export function rowToPost(r: Row): Post | null {
  if (!MEDIA_KINDS.includes(r.media_type as string)) return null;
  const m = (Array.isArray(r.media_metrics) ? (r.media_metrics[0] as Row | undefined) : undefined) ?? {};
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    mediaType: r.media_type as MediaKind,
    postedAt: String(r.posted_at),
    permalink: safeLink(r.permalink),
    reach: num(m.reach),
    views: num(m.views),
    likes: num(m.likes),
    comments: num(m.comments),
    shares: num(m.shares),
    saves: num(m.saves),
  };
}

/** Every account_daily row from `fromDay` to today, oldest first (paged: a year or "all" is more than one page). */
export async function loadDaily(db: SupabaseClient, accountId: string, fromDay: string): Promise<DailyRow[]> {
  const { rows } = await readPages(
    (from, to) =>
      db
        .from('account_daily')
        .select('day,followers,reach,views,accounts_engaged,total_interactions,follows,unfollows,link_taps')
        .eq('account_id', accountId)
        .gte('day', fromDay)
        .order('day', { ascending: true })
        .range(from, to),
    'daily',
  );
  return rows.map(rowToDaily);
}

/**
 * Feed posts + reels (stories excluded), newest first, with ONLY their latest metrics snapshot: the newest `newest`
 * (at most MEDIA_LIMIT) and, when `since` is given, every older one back to that instant (paged in steps of `newest`).
 */
export async function loadPosts(db: SupabaseClient, accountId: string, newest = MEDIA_LIMIT, since: string | null = null): Promise<Post[]> {
  const n = Math.min(newest, MEDIA_LIMIT);
  const { rows } = await readPages(
    (from, to) =>
      db
        .from('media')
        .select('id,account_id,media_type,posted_at,permalink,media_metrics(captured_at,reach,views,likes,comments,shares,saves)')
        .eq('account_id', accountId)
        .neq('media_type', 'STORY')
        .order('posted_at', { ascending: false })
        .order('id', { ascending: false })
        .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
        .range(from, to)
        .limit(1, { referencedTable: 'media_metrics' }),
    'posts',
    { size: n, enough: reaches(n, since) },
  );
  return rows.map(rowToPost).filter((p): p is Post => p !== null);
}

export interface OverviewInput {
  accounts: StoredAccount[]; // archived accounts are hidden from every view (SPEC §7c)
  sync: Record<string, SyncStatus>;
  daily: Record<string, DailyRow[]>;
  posts: Record<string, Post[]>;
}

/** Everything the Overview needs: 1 + 1 + 2 × accounts queries (more pages for long scopes), run in parallel. Posts reach back to `fromDay` in the owner's timezone. */
export async function loadOverviewInput(db: SupabaseClient, fromDay: string, tz: string): Promise<OverviewInput> {
  const [all, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
  const accounts = all.filter((a) => a.status !== 'archived');
  const since = dayStart(fromDay, tz).toISOString();
  const per = await Promise.all(accounts.map((a) => Promise.all([loadDaily(db, a.id, fromDay), loadPosts(db, a.id, MEDIA_LIMIT, since)])));
  return {
    accounts,
    sync,
    daily: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][0]])),
    posts: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][1]])),
  };
}
