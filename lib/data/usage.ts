import type { SupabaseClient } from '@supabase/supabase-js';

// "Storage used" (Plan 16c): the rows of public.data_usage() (migration 20261031000001) folded into a few groups the
// owner understands. Sizes include indexes; row counts are the planner's estimate (null = not measured yet).
export const USAGE_GROUPS = ['insights', 'posts', 'comments', 'followers', 'other'] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];

const GROUP_OF: Readonly<Record<string, UsageGroup>> = {
  account_daily: 'insights',
  account_daily_breakdown: 'insights',
  audience_snapshots: 'insights',
  online_followers: 'insights',
  follower_snapshots: 'insights',
  api_snapshots: 'insights',
  media: 'posts',
  media_metrics: 'posts',
  media_children: 'posts',
  comments: 'comments',
  moderation_settings: 'comments',
  moderation_rules: 'comments',
  moderation_log: 'comments',
  follower_exports: 'followers',
};

export interface UsageRow {
  kind: string;
  label: string | null;
  row_count: number | string | null;
  bytes: number | string | null;
}

export interface Usage {
  database: number | null;
  groups: { id: UsageGroup; rows: number | null; bytes: number }[];
  /** One entry per folder of the private "covers" bucket; the folder is an account id. */
  covers: { folder: string; files: number; bytes: number }[];
}

// bigint columns arrive as numbers or strings depending on the driver
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function summariseUsage(rows: readonly UsageRow[]): Usage {
  const groups = USAGE_GROUPS.map((id) => ({ id, rows: 0 as number | null, bytes: 0 }));
  const covers: Usage['covers'] = [];
  let database: number | null = null;
  for (const r of rows) {
    if (r.kind === 'table' && r.label) {
      const g = groups.find((x) => x.id === (GROUP_OF[r.label as string] ?? 'other'))!;
      const n = num(r.row_count);
      g.rows = g.rows === null || n === null ? null : g.rows + n; // one unknown table makes the group's count unknown
      g.bytes += num(r.bytes) ?? 0;
    } else if (r.kind === 'covers' && r.label) {
      covers.push({ folder: r.label, files: num(r.row_count) ?? 0, bytes: num(r.bytes) ?? 0 });
    } else if (r.kind === 'database') {
      database = num(r.bytes);
    }
  }
  return { database, groups, covers: covers.sort((a, b) => b.bytes - a.bytes) };
}

/** Owner session (the function itself checks is_owner()). null = the migration is missing or the call failed. */
export async function readUsage(db: SupabaseClient): Promise<Usage | null> {
  try {
    const { data, error } = await db.rpc('data_usage');
    if (error || !Array.isArray(data)) return null;
    return summariseUsage(data as UsageRow[]);
  } catch {
    return null;
  }
}
