// Dashboard reads. Always the OWNER SESSION client (createServerSupabase): RLS lets the owner select, nothing else.
// Never the admin client here. Errors carry fixed messages only (Supabase messages can echo values).
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { MediaKind } from '@/lib/instagram/parse';
import { listSyncStatus, type SyncStatus } from '@/lib/sync/store';

/** SPEC §7c: the backfill stops at 500 posts, so reads never need more per account (also under PostgREST's 1000-row cap). */
export const MEDIA_LIMIT = 500;
/** 2 × 90-day windows + today; keeps a daily read well under PostgREST's 1000-row cap. */
export const DAILY_LIMIT = 200;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MEDIA_KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

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

export async function loadDaily(db: SupabaseClient, accountId: string, fromDay: string): Promise<DailyRow[]> {
  const { data, error } = await db
    .from('account_daily')
    .select('day,followers,reach,views,accounts_engaged,total_interactions,follows,unfollows,link_taps')
    .eq('account_id', accountId)
    .gte('day', fromDay)
    .order('day', { ascending: true })
    .limit(DAILY_LIMIT);
  if (error) fail('daily');
  return ((data ?? []) as Row[]).map(rowToDaily);
}

/** Newest feed posts + reels (stories excluded) with ONLY their latest metrics snapshot (one row per post). */
export async function loadPosts(db: SupabaseClient, accountId: string, limit = MEDIA_LIMIT): Promise<Post[]> {
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,media_metrics(captured_at,reach,views,likes,comments,shares,saves)')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(Math.min(limit, MEDIA_LIMIT))
    .limit(1, { referencedTable: 'media_metrics' });
  if (error) fail('posts');
  return ((data ?? []) as Row[]).map(rowToPost).filter((p): p is Post => p !== null);
}

export interface OverviewInput {
  accounts: StoredAccount[]; // archived accounts are hidden from every view (SPEC §7c)
  sync: Record<string, SyncStatus>;
  daily: Record<string, DailyRow[]>;
  posts: Record<string, Post[]>;
}

/** Everything the Overview needs: 1 + 1 + 2 × accounts queries, run in parallel. */
export async function loadOverviewInput(db: SupabaseClient, fromDay: string): Promise<OverviewInput> {
  const [all, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
  const accounts = all.filter((a) => a.status !== 'archived');
  const per = await Promise.all(accounts.map((a) => Promise.all([loadDaily(db, a.id, fromDay), loadPosts(db, a.id)])));
  return {
    accounts,
    sync,
    daily: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][0]])),
    posts: Object.fromEntries(accounts.map((a, i) => [a.id, per[i][1]])),
  };
}
