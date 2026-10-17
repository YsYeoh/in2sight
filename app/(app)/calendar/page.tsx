import { CalendarView } from '@/components/calendar/CalendarView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts } from '@/lib/dashboard/cached';
import { buildCalendar, calendarRange } from '@/lib/dashboard/calendar';
import { loadMonthMedia } from '@/lib/dashboard/detail-read';
import { loadFirstDay } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  // independent reads in parallel; the media query needs the live account ids and the scope's days, so it comes after
  const [prefs, all, db] = await Promise.all([getPrefs(), loadAccounts(), createServerSupabase()]); // owner session: RLS applies, never the admin client
  const today = localDay(new Date(), prefs.timezone);
  const accounts = all.filter((a) => a.status !== 'archived'); // archived = hidden (SPEC §7c)
  const wanted = isUuid(sp.account) ? sp.account.toLowerCase() : null;
  const account = wanted && accounts.some((a) => a.id === wanted) ? wanted : null; // unknown/archived id → all accounts
  const ids = account ? [account] : accounts.map((a) => a.id);
  // the Time Scope of the URL (an old ?month=YYYY-MM link is the month picker's shorthand); the first captured day gives "all" its start
  const scope = resolveScope(parseTimeScope(sp, prefs.weekStart), today, await loadFirstDay(db, ids));
  // a picked month, week or range is shown whole (also when it runs past today); a rolling preset ends today
  const shown = 'last' in scope.window ? scope.range : scope.window;
  const { fromIso, toIso } = calendarRange(shown, prefs.weekStart, prefs.timezone);
  const { media, truncated } = await loadMonthMedia(db, ids, fromIso, toIso);
  // key: the selected-day state lives in CalendarView, so a new range or account must remount it
  return (
    <CalendarView
      key={`${scope.query}|${account ?? ''}`}
      truncated={truncated}
      model={buildCalendar(shown, media, { weekStart: prefs.weekStart, tz: prefs.timezone, today })}
      scope={scope}
      today={today}
      accounts={accounts.map((a) => ({ id: a.id, username: a.username }))}
      account={account}
    />
  );
}
