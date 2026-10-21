// Reads and writes of follower_exports (Plan 15b). The ONLY module that names that table (tests/followers-privacy.test.ts).
// Owner-session client only: RLS (follower_exports_owner_all, is_owner()) applies to every call; never the admin
// client. Every query is filtered by the account id AND (for one snapshot) the snapshot id. Errors are fixed texts:
// a Supabase error can echo row values, i.e. third-party usernames.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Snapshot } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';
import { MAX_SNAPSHOTS, type Upload } from '@/lib/followers/payload';
import type { SnapshotMeta } from '@/lib/followers/state';

/** PostgREST / Postgres "table not found": the migration 20261028000002 is not applied yet. */
export const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];

const TABLE = 'follower_exports';
type Row = Record<string, unknown>;
const missing = (e: unknown): boolean => MISSING_TABLE.includes(String((e as { code?: unknown } | null)?.code));
const fail = (op: string): never => {
  throw new Error(`followers ${op} failed`);
};

const toMeta = (r: Row): SnapshotMeta => ({
  id: String(r.id),
  takenOn: String(r.taken_on),
  followerCount: Number(r.follower_count),
  followingCount: r.following_count === null || r.following_count === undefined ? null : Number(r.following_count),
  createdAt: String(r.created_at),
});

/** The account's snapshots without their arrays, newest first. null = the table does not exist yet. */
export async function listFollowerSnapshots(db: SupabaseClient, accountId: string): Promise<SnapshotMeta[] | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('id,taken_on,follower_count,following_count,created_at')
    .eq('account_id', accountId)
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_SNAPSHOTS);
  if (error) return missing(error) ? null : fail('list');
  return ((data ?? []) as Row[]).map(toMeta);
}

const people = (names: unknown, times: unknown): Person[] => {
  if (!Array.isArray(names)) return [];
  const at = Array.isArray(times) ? times : [];
  return names.map((u, i) => ({ username: String(u), at: typeof at[i] === 'number' ? at[i] : null }));
};

/** One snapshot's lists, only when it belongs to this account; null = no such snapshot. */
export async function loadFollowerSnapshot(db: SupabaseClient, accountId: string, id: string): Promise<Snapshot | null> {
  const { data, error } = await db.from(TABLE).select('followers,followers_at,following,following_at').eq('id', id).eq('account_id', accountId).maybeSingle();
  if (error) return fail('load');
  if (!data) return null;
  const r = data as Row;
  return { followers: people(r.followers, r.followers_at), following: r.following === null ? null : people(r.following, r.following_at) };
}

export type SaveResult = 'ok' | 'tooManySnapshots' | 'notReady';

/** Stores one validated upload (lib/followers/payload.ts validateUpload) as a snapshot; at most MAX_SNAPSHOTS per account. */
export async function saveFollowerSnapshot(db: SupabaseClient, accountId: string, u: Upload): Promise<SaveResult> {
  const { count, error } = await db.from(TABLE).select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (error) return missing(error) ? 'notReady' : fail('count');
  if ((count ?? 0) >= MAX_SNAPSHOTS) return 'tooManySnapshots';
  const { error: insertError } = await db.from(TABLE).insert({
    account_id: accountId,
    taken_on: u.takenOn,
    followers: u.followers.map((p) => p.username),
    followers_at: u.followers.map((p) => p.at),
    following: u.following ? u.following.map((p) => p.username) : null,
    following_at: u.following ? u.following.map((p) => p.at) : null,
  }); // no .select(): nothing comes back
  if (insertError) return missing(insertError) ? 'notReady' : fail('insert');
  return 'ok';
}

/** Deletes one snapshot of this account; false = there was none. */
export async function deleteFollowerSnapshot(db: SupabaseClient, accountId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from(TABLE).delete().eq('id', id).eq('account_id', accountId).select('id');
  if (error) return fail('delete');
  return (data ?? []).length > 0;
}
