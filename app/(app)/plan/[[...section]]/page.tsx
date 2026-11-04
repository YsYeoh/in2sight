import { notFound, redirect } from 'next/navigation';
import { DigestView } from '@/components/plan/DigestView';
import { GoalsView } from '@/components/plan/GoalsView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadUnansweredCounts } from '@/lib/comments/read';
import { loadDismissals } from '@/lib/dashboard/dismissals';
import { loadOverviewInput } from '@/lib/dashboard/read';
import { todayFindings } from '@/lib/dashboard/today';
import { loadGoals } from '@/lib/plan/goals';
import { buildDigest, buildGoals, digestFindings, parseDigestPeriod, periodScope, planReadFrom } from '@/lib/plan/model';
import { routePlan } from '@/lib/plan/sections';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
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
  const model = buildDigest(input, goals ?? [], { ...o, period });
  // the insights feed of Plan 17b, "now" (the Overview's sequence): the rules over the digest's own cards, then the dismissals of the keys on screen
  const cards = model.overview.sections.flatMap((s) => s.cards);
  const unanswered = await loadUnansweredCounts(db, input.accounts, today, prefs.timezone); // never throws
  const found = todayFindings(input, cards, unanswered, o);
  const dismissals = await loadDismissals(db, Object.values(found).flat().map((f) => f.key)); // null = migration missing: no dismiss buttons
  return <DigestView model={model} today={today} goalsReady={goals !== null} findings={digestFindings(cards.map((c) => c.id), found, dismissals, now)} dismiss={dismissFindingAction} />;
}
