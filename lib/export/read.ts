// Everything an export needs for the accounts in scope, read with the OWNER SESSION client (RLS) through the existing
// dashboard readers (explicit columns, hard limits, fixed error messages). Never the admin client, never account_tokens.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, OnlineFollowersRow, Tag } from '@/lib/analysis/types';
import { loadAudience, loadOnline, loadPostRows, loadStories, loadTags, type AudienceSnapshots, type PostRow, type StoryRow } from '@/lib/dashboard/detail-read';
import { loadDaily } from '@/lib/dashboard/read';
import { listSyncStatus, type SyncStatus } from '@/lib/sync/store';
import { addDays, dayStart, daysToIso } from '@/lib/sync/time';
import { earliestDay, readFrom, resolveScope, type ResolvedScope, type TimeScope } from '@/lib/time-scope/scope';

export interface ExportData {
  accounts: StoredAccount[]; // the scope, sorted by username (resolveScope)
  scope: ResolvedScope; // the Time Scope, resolved with the first captured day of these accounts
  sync: Record<string, SyncStatus>;
  daily: Record<string, DailyRow[]>; // from readFrom(): both windows + lag, so KPIs can compare
  posts: Record<string, PostRow[]>; // newest first: the newest 500 per account and every post back to readFrom(), with caption + tag ids
  stories: Record<string, StoryRow[]>; // posted inside the range (newest STORY_LIMIT per account)
  audience: Record<string, AudienceSnapshots>;
  online: Record<string, OnlineFollowersRow[]>; // last 30 days (what Instagram keeps)
  tags: Tag[];
}

const byId = <T>(accounts: StoredAccount[], values: T[]): Record<string, T> => Object.fromEntries(accounts.map((a, i) => [a.id, values[i]]));

/**
 * 4 queries per account + 3 shared in parallel, then the Stories of the resolved range (it needs the first captured
 * day for "all"). Any failed read throws (the route answers with an error key).
 */
export async function loadExportData(db: SupabaseClient, accounts: StoredAccount[], o: { time: TimeScope; today: string; tz: string }): Promise<ExportData> {
  const ids = accounts.map((a) => a.id);
  const fromDay = readFrom(o.time, o.today);
  const since = dayStart(fromDay, o.tz).toISOString();
  const [sync, tags, online, per] = await Promise.all([
    listSyncStatus(db),
    loadTags(db),
    loadOnline(db, ids, addDays(o.today, -30)),
    Promise.all(accounts.map((a) => Promise.all([loadDaily(db, a.id, fromDay), loadPostRows(db, a.id, since), loadAudience(db, a.id)]))),
  ]);
  const scope = resolveScope(o.time, o.today, earliestDay(per.map((p) => p[0])));
  const { fromIso, toIso } = daysToIso(scope.range.from, scope.range.to, o.tz);
  const stories = await Promise.all(accounts.map((a) => loadStories(db, a.id, fromIso, toIso)));
  return {
    accounts,
    scope,
    sync,
    daily: byId(accounts, per.map((p) => p[0])),
    posts: byId(accounts, per.map((p) => p[1])),
    stories: byId(accounts, stories.map((s) => s.stories)),
    audience: byId(accounts, per.map((p) => p[2])),
    online,
    tags,
  };
}
