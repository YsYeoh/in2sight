// Everything an export needs for the accounts in scope, read with the OWNER SESSION client (RLS) through the existing
// dashboard readers (explicit columns, hard limits, fixed error messages). Never the admin client, never account_tokens.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, OnlineFollowersRow, Period, Tag } from '@/lib/analysis/types';
import { loadAudience, loadOnline, loadPostRows, loadStories, loadTags, type AudienceSnapshots, type PostRow, type StoryRow } from '@/lib/dashboard/detail-read';
import { fromDayFor } from '@/lib/dashboard/overview';
import { loadDaily } from '@/lib/dashboard/read';
import { listSyncStatus, type SyncStatus } from '@/lib/sync/store';
import { exportWindow } from '@/lib/export/params';
import { addDays, dayStart } from '@/lib/sync/time';

export interface ExportData {
  accounts: StoredAccount[]; // the scope, sorted by username (resolveScope)
  sync: Record<string, SyncStatus>;
  daily: Record<string, DailyRow[]>; // two windows + lag (fromDayFor), so KPIs can compare
  posts: Record<string, PostRow[]>; // newest first, at most 500 per account (MEDIA_LIMIT), with caption + tag ids
  stories: Record<string, StoryRow[]>; // posted inside the export window
  audience: Record<string, AudienceSnapshots>;
  online: Record<string, OnlineFollowersRow[]>; // last 30 days (what Instagram keeps)
  tags: Tag[];
}

const byId = <T>(accounts: StoredAccount[], values: T[]): Record<string, T> => Object.fromEntries(accounts.map((a, i) => [a.id, values[i]]));

/** 5 queries per account + 3 shared, all in parallel. Any failed read throws (the route answers with an error key). */
export async function loadExportData(db: SupabaseClient, accounts: StoredAccount[], o: { period: Period; today: string; tz: string }): Promise<ExportData> {
  const ids = accounts.map((a) => a.id);
  const since = dayStart(exportWindow(o.period, o.today).from, o.tz).toISOString();
  const [sync, tags, online, per] = await Promise.all([
    listSyncStatus(db),
    loadTags(db),
    loadOnline(db, ids, addDays(o.today, -30)),
    Promise.all(accounts.map((a) => Promise.all([loadDaily(db, a.id, fromDayFor(o.period, o.today)), loadPostRows(db, a.id), loadStories(db, a.id, since), loadAudience(db, a.id)]))),
  ]);
  return {
    accounts,
    sync,
    daily: byId(accounts, per.map((p) => p[0])),
    posts: byId(accounts, per.map((p) => p[1])),
    stories: byId(accounts, per.map((p) => p[2])),
    audience: byId(accounts, per.map((p) => p[3])),
    online,
    tags,
  };
}
