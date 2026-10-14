import { notFound } from 'next/navigation';
import { AccountOverview } from '@/components/account/AccountOverview';
import { AccountView } from '@/components/account/AccountView';
import { PostsTab } from '@/components/account/PostsTab';
import { setPostTagsAction } from '@/app/(app)/tags/actions';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import type { StoredAccount } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildAccountOverview, parseTab, poolFor, type Tab } from '@/lib/dashboard/account';
import { buildPosts, parsePostFilters } from '@/lib/dashboard/content';
import { loadOnline, loadPostRows, loadTags } from '@/lib/dashboard/detail-read';
import { fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import { loadDaily, loadPosts } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { listSyncStatus } from '@/lib/sync/store';
import { addDays, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

type SearchParams = Record<string, string | string[] | undefined>;
type Ctx = { db: Awaited<ReturnType<typeof createServerSupabase>>; account: StoredAccount; accounts: StoredAccount[]; sp: SearchParams; now: Date; today: string; prefs: Awaited<ReturnType<typeof getPrefs>> };

/** Each tab loads only its own data. */
async function tabContent(tab: Tab, c: Ctx) {
  switch (tab) {
    case 'posts': {
      const [rows, tags] = await Promise.all([loadPostRows(c.db, c.account.id), loadTags(c.db)]);
      const filters = parsePostFilters(c.sp);
      // the imported server action is passed straight to the client component (never wrapped in a closure here)
      return <PostsTab posts={buildPosts(rows, tags, filters, c.prefs.timezone)} total={rows.length} tags={tags} filters={filters} setPostTags={setPostTagsAction} />;
    }
    default: {
      const period = parsePeriod(c.sp.period);
      const pool = poolFor(c.account, c.accounts);
      const others = pool.filter((a) => a.id !== c.account.id);
      const [daily, posts, sync, online, otherPosts] = await Promise.all([
        loadDaily(c.db, c.account.id, fromDayFor(period, c.today)),
        loadPosts(c.db, c.account.id),
        listSyncStatus(c.db),
        loadOnline(c.db, pool.map((a) => a.id), addDays(c.today, -30)), // Instagram keeps 30 days of online_followers
        Promise.all(others.map((a) => loadPosts(c.db, a.id))),
      ]);
      const model = buildAccountOverview(
        { account: c.account, sync: sync[c.account.id], daily, posts, online: online[c.account.id] ?? [], pooled: { accounts: pool.length, posts: [...posts, ...otherPosts.flat()], online: Object.values(online).flat() } },
        { period, today: c.today, now: c.now, tz: c.prefs.timezone, weekStart: c.prefs.weekStart },
      );
      return <AccountOverview model={model} />;
    }
  }
}

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const prefs = await getPrefs();
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const accounts = (await supabaseAccountsStore(db).list()).filter((a) => a.status !== 'archived'); // archived = hidden (SPEC §7c)
  const account = accounts.find((a) => a.id === id.toLowerCase());
  if (!account) notFound();
  return (
    <AccountView account={{ id: account.id, username: account.username, displayName: account.displayName, groupName: account.groupName }} tab={tab}>
      {await tabContent(tab, { db, account, accounts, sp, now, today, prefs })}
    </AccountView>
  );
}
