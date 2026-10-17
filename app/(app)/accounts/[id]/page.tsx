import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { ExportDialog } from '@/components/export/ExportDialog';
import { AccountOverview } from '@/components/account/AccountOverview';
import { AccountView } from '@/components/account/AccountView';
import { AudienceTab } from '@/components/account/AudienceTab';
import { PostsTab } from '@/components/account/PostsTab';
import { StoriesTab } from '@/components/account/StoriesTab';
import { TabSkeleton } from '@/components/account/TabSkeleton';
import { setPostTagsAction } from '@/app/(app)/tags/actions';
import type { StoredAccount } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildAccountOverview, parseTab, poolFor, type Tab } from '@/lib/dashboard/account';
import { buildAudience } from '@/lib/dashboard/audience';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { buildPosts, buildStories, parsePostFilters } from '@/lib/dashboard/content';
import { loadAudience, loadOnline, loadPostRows, loadStories, loadTags } from '@/lib/dashboard/detail-read';
import { fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import { exportScopes } from '@/lib/export/params';
import { loadDaily, loadPosts } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, daysToIso, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

type SearchParams = Record<string, string | string[] | undefined>;

/** Live (non-archived) accounts: archived ones are hidden (SPEC §7c). Shared by the header and the tab (one query). */
const liveAccounts = async () => (await loadAccounts()).filter((a) => a.status !== 'archived');

/** One tab's data, streamed inside <Suspense>: the header and tab bar are already on screen. Each tab loads only its own data. */
async function TabContent({ tab, account, sp }: { tab: Tab; account: StoredAccount; sp: SearchParams }) {
  const [db, prefs] = await Promise.all([createServerSupabase(), getPrefs()]); // owner session: RLS applies, never the admin client
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  switch (tab) {
    case 'posts': {
      const [rows, tags] = await Promise.all([loadPostRows(db, account.id), loadTags(db)]);
      const filters = parsePostFilters(sp);
      // the imported server action is passed straight to the client component (never wrapped in a closure here)
      return <PostsTab posts={buildPosts(rows, tags, filters, prefs.timezone)} total={rows.length} tags={tags} filters={filters} setPostTags={setPostTagsAction} />;
    }
    case 'stories': {
      const { fromIso, toIso } = daysToIso(addDays(today, -13), today, prefs.timezone); // today + the 13 days before it
      return <StoriesTab stories={buildStories((await loadStories(db, account.id, fromIso, toIso)).stories, now)} />;
    }
    case 'audience':
      return <AudienceTab model={buildAudience(await loadAudience(db, account.id))} />;
    default: {
      const period = parsePeriod(sp.period);
      const pool = poolFor(account, await liveAccounts());
      const others = pool.filter((a) => a.id !== account.id);
      const [daily, posts, sync, online, otherPosts] = await Promise.all([
        loadDaily(db, account.id, fromDayFor(period, today)),
        loadPosts(db, account.id),
        loadSyncStatus(),
        loadOnline(db, pool.map((a) => a.id), addDays(today, -30)), // Instagram keeps 30 days of online_followers
        Promise.all(others.map((a) => loadPosts(db, a.id))),
      ]);
      const model = buildAccountOverview(
        { account, sync: sync[account.id], daily, posts, online: online[account.id] ?? [], pooled: { accounts: pool.length, posts: [...posts, ...otherPosts.flat()], online: Object.values(online).flat() } },
        { period, today, now, tz: prefs.timezone, weekStart: prefs.weekStart },
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
  const accounts = await liveAccounts();
  const account = accounts.find((a) => a.id === id.toLowerCase());
  if (!account) notFound();
  return (
    <AccountView
      account={{ id: account.id, username: account.username, displayName: account.displayName, groupName: account.groupName }}
      tab={tab}
      exportButton={<ExportDialog scopes={exportScopes(accounts)} defaultScope={`a:${account.id}`} period={parsePeriod(sp.period)} />}
    >
      {/* key: a new tab, period or filter is a new boundary, so its skeleton shows instead of the stale tab */}
      <Suspense key={JSON.stringify(sp)} fallback={<TabSkeleton tab={tab} />}>
        <TabContent tab={tab} account={account} sp={sp} />
      </Suspense>
    </AccountView>
  );
}
