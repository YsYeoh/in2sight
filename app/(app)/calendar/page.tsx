import { CalendarView } from '@/components/calendar/CalendarView';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildMonth, monthRange, parseMonth } from '@/lib/dashboard/calendar';
import { loadMonthMedia } from '@/lib/dashboard/detail-read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const prefs = await getPrefs();
  const today = localDay(new Date(), prefs.timezone);
  const month = parseMonth(sp.month, today);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const accounts = (await supabaseAccountsStore(db).list()).filter((a) => a.status !== 'archived'); // archived = hidden (SPEC §7c)
  const wanted = isUuid(sp.account) ? sp.account.toLowerCase() : null;
  const account = wanted && accounts.some((a) => a.id === wanted) ? wanted : null; // unknown/archived id → all accounts
  const { fromIso, toIso } = monthRange(month, prefs.weekStart, prefs.timezone);
  const media = await loadMonthMedia(db, account ? [account] : accounts.map((a) => a.id), fromIso, toIso);
  return <CalendarView model={buildMonth(month, media, { weekStart: prefs.weekStart, tz: prefs.timezone, today })} accounts={accounts.map((a) => ({ id: a.id, username: a.username }))} account={account} />;
}
