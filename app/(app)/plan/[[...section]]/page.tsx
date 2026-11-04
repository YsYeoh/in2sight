import { notFound, redirect } from 'next/navigation';
import { DigestView } from '@/components/plan/DigestView';
import { GoalsView } from '@/components/plan/GoalsView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { loadGoals } from '@/lib/plan/goals';
import { buildDigest, buildGoals, parseDigestPeriod, periodScope, planReadFrom } from '@/lib/plan/model';
import { routePlan } from '@/lib/plan/sections';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { saveGoalsAction } from '@/app/(app)/plan/actions';

// Plan 17d: /plan -> /plan/digest; /plan/digest?week=|month= and /plan/goals. Pages = wiring; logic in lib/plan.
export default async function PlanSectionPage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const route = routePlan(section);
  if (!route) notFound();
  if ('redirect' in route) redirect(route.redirect);
  const prefs = await getPrefs();
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const goals = await loadGoals(db, prefs.timezone); // null = the 17d migration is not applied yet
  const period = parseDigestPeriod(sp, today, prefs.weekStart);
  const input = await loadOverviewInput(db, planReadFrom(periodScope(period), today, prefs.weekStart, goals ?? []), prefs.timezone);
  const o = { today, now, tz: prefs.timezone, locale: prefs.locale, weekStart: prefs.weekStart };
  if (route.section === 'goals') return <GoalsView accounts={buildGoals(input, goals ?? [], o)} ready={goals !== null} today={today} save={saveGoalsAction} />;
  return <DigestView model={buildDigest(input, goals ?? [], { ...o, period })} today={today} goalsReady={goals !== null} />;
}
