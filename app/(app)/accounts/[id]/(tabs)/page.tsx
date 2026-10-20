import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { ExportDialog } from '@/components/export/ExportDialog';
import { AccountOverview } from '@/components/account/AccountOverview';
import { AccountView } from '@/components/account/AccountView';
import { PostsTab } from '@/components/account/PostsTab';
import { StoriesTab } from '@/components/account/StoriesTab';
import { TabSkeleton } from '@/components/account/TabSkeleton';
import { setPostTagsAction } from '@/app/(app)/tags/actions';
import type { StoredAccount } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildAccountOverview, parseTab, poolFor, type Tab } from '@/lib/dashboard/account';
import { buildAudience } from '@/lib/dashboard/audience';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { buildPosts, buildStories, parsePostFilters, parsePostsView } from '@/lib/dashboard/content';
import { loadAudience, loadOnline, loadPostRows, loadStories, loadTags } from '@/lib/dashboard/detail-read';
import { exportScopes } from '@/lib/export/params';
import { loadDaily, loadFirstDay, loadPosts, MEDIA_LIMIT } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, dayStart, daysToIso, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';
import { parseTimeScope, readFrom, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';

type SearchParams = Record<string, string | string[] | undefined>;

/** Live (non-archived) accounts: archived ones are hidden (SPEC §7c). Shared by the header and the tab (one query). */
const liveAccounts = async () => (await loadAccounts()).filter((a) => a.status !== 'archived');

/** One tab's data, streamed inside <Suspense>: the header and tab bar are already on screen. Each tab loads only its own data, for the scope's days. */
async function TabContent({ tab, account, sp, scope }: { tab: Tab; account: StoredAccount; sp: SearchParams; scope: ResolvedScope }) {
  const [db, prefs] = await Promise.all([createServerSupabase(), getPrefs()]); // owner session: RLS applies, never the admin client
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const tz = prefs.timezone;
  // Posts and Stories have no range of their own until Plan 14b: All time, newest first (the "all" list range, MAX_DAYS back)
  const allTime = resolveScope({ range: 'all', cmp: 'none', gran: 'auto' }, today, scope.earliest).listRange;
  switch (tab) {
    case 'posts': {
      const [rows, tags] = await Promise.all([loadPostRows(db, account.id, dayStart(allTime.from, tz).toISOString()), loadTags(db)]);
      const filters = { ...parsePostFilters(sp), from: allTime.from, to: allTime.to };
      // the imported server action is passed straight to the client component (never wrapped in a closure here)
      return <PostsTab posts={buildPosts(rows, tags, filters, tz)} total={rows.length} tags={tags} filters={filters} scope={scope.params} accountId={account.id} view={parsePostsView(sp.view)} setPostTags={setPostTagsAction} />;
    }
    case 'stories': {
      const { fromIso, toIso } = daysToIso(allTime.from, allTime.to, tz);
      const { stories, truncated } = await loadStories(db, account.id, fromIso, toIso);
      return <StoriesTab stories={buildStories(stories, now)} truncated={truncated} accountId={account.id} scope={scope.params} />;
    }
    default: {
      const fromDay = readFrom(scope.scope, today);
      const pool = poolFor(account, await liveAccounts());
      const others = pool.filter((a) => a.id !== account.id);
      const [daily, posts, sync, online, otherPosts, audience] = await Promise.all([
        loadDaily(db, account.id, fromDay),
        loadPosts(db, account.id, MEDIA_LIMIT, dayStart(fromDay, tz).toISOString()),
        loadSyncStatus(),
        loadOnline(db, pool.map((a) => a.id), addDays(today, -30)), // Instagram keeps 30 days of online_followers
        Promise.all(others.map((a) => loadPosts(db, a.id))), // best time pools the newest posts, whatever the scope
        loadAudience(db, account.id),
      ]);
      const model = buildAccountOverview(
        { account, sync: sync[account.id], daily, posts, online: online[account.id] ?? [], pooled: { accounts: pool.length, posts: [...posts, ...otherPosts.flat()], online: Object.values(online).flat() } },
        { scope, today, now, tz, weekStart: prefs.weekStart },
      );
      return <AccountOverview model={model} account={{ id: account.id, groupName: account.groupName }} audience={buildAudience(audience)} />;
    }
  }
}

export default async function AccountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  // the first captured day is one indexed row; it runs alongside the accounts list (RLS: only the owner's rows exist)
  const [accounts, prefs, first] = await Promise.all([liveAccounts(), getPrefs(), createServerSupabase().then((db) => loadFirstDay(db, [id.toLowerCase()]))]);
  const account = accounts.find((a) => a.id === id.toLowerCase());
  if (!account) notFound();
  const today = localDay(new Date(), prefs.timezone);
  const scope = resolveScope(parseTimeScope(sp, prefs.weekStart), today, first);
  // old ?tab=audience links: Audience is the last section of Overview now (the scope rides along)
  if (sp.tab === 'audience') redirect(`/accounts/${account.id}${scope.query ? `?${scope.query}` : ''}#audience`);
  return (
    <AccountView
      account={{ id: account.id, username: account.username, displayName: account.displayName, groupName: account.groupName }}
      tab={tab}
      scope={scope}
      today={today}
      exportButton={<ExportDialog scopes={exportScopes(accounts)} defaultScope={`a:${account.id}`} time={scope} />}
    >
      {/* key: a new tab, scope or filter is a new boundary, so its skeleton shows instead of the stale tab. Not the
          Grid/Table view: the same posts stay on screen until the other view streams in. */}
      <Suspense key={JSON.stringify({ ...sp, view: undefined })} fallback={<TabSkeleton tab={tab} />}>
        <TabContent tab={tab} account={account} sp={sp} scope={scope} />
      </Suspense>
    </AccountView>
  );
}
