// Content tab reads (Plan 17a). OWNER SESSION client only (RLS; never the admin client). No new SQL: the feed posts of
// the range come from loadPostRows (caption, tags, cover) and their numbers from post_lab_latest (migration
// 20261026000001: the latest KNOWN value of every column, so follows and profile visits, which a busy tick can leave
// out of the newest snapshot, are not read as missing), called by ids in chunks of LATEST_CHUNK (one row per id: far
// under PostgREST's 1,000-row cap). Story days: loadStoryDays (Plan 15a). Fixed error messages only.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LabValues } from '@/lib/analysis/post-lab';
import { loadPostRows, type PostRow } from '@/lib/dashboard/detail-read';
import { loadStoryDays, type DayCounts } from '@/lib/dashboard/growth-read';
import { MISSING_FUNCTION } from '@/lib/dashboard/read';
import { toValues } from '@/lib/post-lab/read';

export const LATEST_CHUNK = 100;

export interface ContentRow extends PostRow {
  latest: LabValues | null; // null = never measured
}
export interface ContentRead {
  rows: ContentRow[]; // feed posts published in [fromIso, toIso), newest first
  lastPostAt: string | null; // the newest feed post of the account, also when it is outside the range
  stories: DayCounts; // Stories per owner-timezone day of the range
}

/** null = post_lab_latest does not exist (the migration is not applied): the tab says "needs a database update". */
export async function loadContentLab(db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string): Promise<ContentRead | null> {
  const [all, stories] = await Promise.all([loadPostRows(db, accountId, fromIso), loadStoryDays(db, accountId, fromIso, toIso, tz)]);
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const rows = all.filter((r) => {
    const t = Date.parse(r.postedAt);
    return t >= from && t < to;
  });
  const chunks: string[][] = [];
  for (let i = 0; i < rows.length; i += LATEST_CHUNK) chunks.push(rows.slice(i, i + LATEST_CHUNK).map((r) => r.id));
  const answers = await Promise.all(chunks.map((ids) => db.rpc('post_lab_latest', { p_ids: ids })));
  const latest = new Map<string, LabValues>();
  for (const { data, error } of answers) {
    if (error) {
      if (MISSING_FUNCTION.includes(String((error as { code?: unknown }).code))) return null;
      throw new Error('content lab read: latest failed');
    }
    for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) latest.set(String(r.media_id), toValues(r));
  }
  return { rows: rows.map((r) => ({ ...r, latest: latest.get(r.id) ?? null })), lastPostAt: all[0]?.postedAt ?? null, stories };
}
