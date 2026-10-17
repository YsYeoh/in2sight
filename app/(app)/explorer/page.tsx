import { ExplorerView } from '@/components/explorer/ExplorerView';
import { deleteViewAction, renameViewAction, saveViewAction } from '@/app/(app)/explorer/actions';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { loadExplorer } from '@/lib/explorer/load';
import { loadViews } from '@/lib/explorer/views';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  // owner session: RLS applies (inside the security-invoker rollups too), never the admin client
  const [prefs, db, accounts, sync] = await Promise.all([getPrefs(), createServerSupabase(), loadAccounts(), loadSyncStatus()]);
  const today = localDay(new Date(), prefs.timezone);
  const [data, views] = await Promise.all([loadExplorer(db, sp, { today, tz: prefs.timezone, weekStart: prefs.weekStart, accounts, sync }), loadViews(db, prefs.weekStart)]);
  // imported server actions are passed straight through to the client view (never wrapped in a closure here)
  return <ExplorerView data={data} today={today} views={views} save={saveViewAction} rename={renameViewAction} remove={deleteViewAction} />;
}
