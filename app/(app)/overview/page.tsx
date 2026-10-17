import { ExportDialog } from '@/components/export/ExportDialog';
import { OverviewView } from '@/components/overview/OverviewView';
import { requireOwner } from '@/lib/auth/require-owner';
import { exportScopes } from '@/lib/export/params';
import { buildOverview } from '@/lib/dashboard/overview';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';
import { localDay } from '@/lib/sync/time';
import { earliestDay, parseTimeScope, readFrom, resolveScope } from '@/lib/time-scope/scope';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const prefs = await getPrefs(); // timezone = the owner's (synced to profiles); the sync writes days in it too
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const time = parseTimeScope(sp, prefs.weekStart); // the URL is the only state; junk falls back to the default
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const input = await loadOverviewInput(db, readFrom(time, today), prefs.timezone);
  const scope = resolveScope(time, today, earliestDay(Object.values(input.daily)));
  const model = buildOverview(input, { scope, today, now, tz: prefs.timezone, locale: prefs.locale, weekStart: prefs.weekStart });
  const progress = await loadSyncProgress(db, input.accounts, now); // never throws; [] when nothing imports
  return <OverviewView model={model} today={today} progress={progress} exportButton={<ExportDialog scopes={exportScopes(input.accounts)} defaultScope="all" time={scope} />} />;
}
