import { CalendarView } from '@/components/calendar/CalendarView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts } from '@/lib/dashboard/cached';
import { buildMonth, monthRange, parseMonth } from '@/lib/dashboard/calendar';
import { loadMonthMedia } from '@/lib/dashboard/detail-read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  // independent reads in parallel; the month query needs the live account ids, so it comes after
  const [prefs, all, db] = await Promise.all([getPrefs(), loadAccounts(), createServerSupabase()]); // owner session: RLS applies, never the admin client
  const today = localDay(new Date(), prefs.timezone);
  const month = parseMonth(sp.month, today);
  const accounts = all.filter((a) => a.status !== 'archived'); // archived = hidden (SPEC §7c)
  const wanted = isUuid(sp.account) ? sp.account.toLowerCase() : null;
  const account = wanted && accounts.some((a) => a.id === wanted) ? wanted : null; // unknown/archived id → all accounts
  const { fromIso, toIso } = monthRange(month, prefs.weekStart, prefs.timezone);
  const { media, truncated } = await loadMonthMedia(db, account ? [account] : accounts.map((a) => a.id), fromIso, toIso);
  // key: the selected-day state lives in CalendarView, so a new month or account must remount it
  return <CalendarView key={`${month}|${account ?? ''}`} truncated={truncated} model={buildMonth(month, media, { weekStart: prefs.weekStart, tz: prefs.timezone, today })} accounts={accounts.map((a) => ({ id: a.id, username: a.username }))} account={account} />;
}
