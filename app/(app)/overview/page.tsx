import { ExportDialog } from '@/components/export/ExportDialog';
import { OverviewView } from '@/components/overview/OverviewView';
import { requireOwner } from '@/lib/auth/require-owner';
import { exportScopes } from '@/lib/export/params';
import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
import { INSIGHTS } from '@/lib/analysis/insights';
import { loadUnansweredCounts } from '@/lib/comments/read';
import { loadDismissals } from '@/lib/dashboard/dismissals';
import { buildOverview } from '@/lib/dashboard/overview';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';
import { buildToday, todayFindings } from '@/lib/dashboard/today';
import { addDays, localDay } from '@/lib/sync/time';
import { minDay } from '@/lib/time-scope/range';
import { earliestDay, parseTimeScope, readFrom, resolveScope } from '@/lib/time-scope/scope';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const prefs = await getPrefs(); // timezone = the owner's (synced to profiles); the sync writes days in it too
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const time = parseTimeScope(sp, prefs.weekStart); // the URL is the only state; junk falls back to the default
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  // at least INSIGHTS.readDays back: Today compares the latest day with the same weekday of the 8 weeks before
  const input = await loadOverviewInput(db, minDay(readFrom(time, today), addDays(today, -INSIGHTS.readDays)), prefs.timezone);
  const scope = resolveScope(time, today, earliestDay(Object.values(input.daily)));
  const model = buildOverview(input, { scope, today, now, tz: prefs.timezone, locale: prefs.locale, weekStart: prefs.weekStart });
  const o = { today, now, tz: prefs.timezone };
  // both never throw: [] when nothing imports; null per account when the unanswered count cannot be read
  const [progress, unanswered] = await Promise.all([loadSyncProgress(db, input.accounts, now), loadUnansweredCounts(db, input.accounts, today, prefs.timezone)]);
  const cards = model.sections.flatMap((s) => s.cards);
  const found = todayFindings(input, cards, unanswered, o);
  const dismissals = await loadDismissals(db, Object.values(found).flat().map((f) => f.key)); // null = migration missing: no dismiss buttons
  const briefing = buildToday(input, cards, found, dismissals, o);
  return <OverviewView model={model} today={today} progress={progress} briefing={briefing} dismiss={dismissFindingAction} exportButton={<ExportDialog scopes={exportScopes(input.accounts)} defaultScope="all" time={scope} />} />;
}
