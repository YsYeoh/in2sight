import { ExportDialog } from '@/components/export/ExportDialog';
import { OverviewView } from '@/components/overview/OverviewView';
import { requireOwner } from '@/lib/auth/require-owner';
import { exportScopes } from '@/lib/export/params';
import { buildOverview, fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';
import { localDay } from '@/lib/sync/time';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const period = parsePeriod((await searchParams).period);
  const prefs = await getPrefs(); // timezone = the owner's (synced to profiles); the sync writes days in it too
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const input = await loadOverviewInput(db, fromDayFor(period, today), prefs.timezone);
  const model = buildOverview(input, { period, today, now, tz: prefs.timezone, locale: prefs.locale });
  const progress = await loadSyncProgress(db, input.accounts, now); // never throws; [] when nothing imports
  return <OverviewView model={model} progress={progress} exportButton={<ExportDialog scopes={exportScopes(input.accounts)} defaultScope="all" period={period} />} />;
}
