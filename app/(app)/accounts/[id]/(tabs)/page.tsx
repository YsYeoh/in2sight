import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { ExportDialog } from '@/components/export/ExportDialog';
import { AccountOverview } from '@/components/account/AccountOverview';
import { AccountView } from '@/components/account/AccountView';
import { ModeratedCommentsTab } from '@/components/account/CommentActions';
import { CommentsTab, type CommentsData } from '@/components/account/CommentsTab';
import { FollowersTab } from '@/components/account/FollowersTab';
import { GrowthTab } from '@/components/account/GrowthTab';
import { ModerationTab } from '@/components/account/ModerationTab';
import { PostsTab } from '@/components/account/PostsTab';
import { StoriesTab } from '@/components/account/StoriesTab';
import { TabSkeleton } from '@/components/account/TabSkeleton';
import { setPostTagsAction } from '@/app/(app)/tags/actions';
import { deleteFollowerSnapshotAction } from '@/app/(app)/accounts/followers-actions';
import { deleteCommentAction, deleteRuleAction, hideCommentAction, replyCommentAction, saveWordRuleAction, setAutoHideAction, setSpamRuleAction, undoModerationAction } from '@/app/(app)/accounts/moderation-actions';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample } from '@/lib/comments/read';
import { COMMENT_KEYS, parseCommentState } from '@/lib/comments/state';
import { topics } from '@/lib/comments/topics';
import { buildAccountOverview, parseTab, poolFor, type Tab } from '@/lib/dashboard/account';
import { buildAudience } from '@/lib/dashboard/audience';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { buildPosts, buildStories, storyView } from '@/lib/dashboard/content';
import { buildGrowth, growthReadFrom, HOURLY_MAX_DAYS } from '@/lib/dashboard/growth';
import { loadAudienceEnds, loadCommentDays, loadFollowerCurve, loadReachBreakdown, loadStoryDays } from '@/lib/dashboard/growth-read';
import { loadAudience, loadOnline, loadPostPage, loadPostRows, loadStoryPage, loadStories, loadTags } from '@/lib/dashboard/detail-read';
import { LIST_KEYS, listWindow, pagePosts, parsePage, pageStories, parsePostList, parseStoryList, postPageSize, postSortOf, storyPageSize } from '@/lib/dashboard/lists';
import { exportScopes } from '@/lib/export/params';
import { followersView } from '@/lib/followers/diff';
import { listFollowerSnapshots, loadFollowerSnapshot } from '@/lib/followers/read';
import { FOLLOWER_KEYS, parseFollowerState, resolvePair } from '@/lib/followers/state';
import { loadModeration } from '@/lib/moderation/store';
import { loadDaily, loadFirstDay, loadPosts, MEDIA_LIMIT } from '@/lib/dashboard/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, dayStart, daysToIso, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';
import { daysIn } from '@/lib/time-scope/range';
import { parseTimeScope, readFrom, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';

type SearchParams = Record<string, string | string[] | undefined>;

const NO_FILTERS = { format: null, tag: null, from: null, to: null }; // post_list already filtered the page

/** Live (non-archived) accounts: archived ones are hidden (SPEC §7c). Shared by the header and the tab (one query). */
const liveAccounts = async () => (await loadAccounts()).filter((a) => a.status !== 'archived');

/** One tab's data, streamed inside <Suspense>: the header and tab bar are already on screen. Each tab loads only its own data, for the scope's days. */
async function TabContent({ tab, account, sp, scope }: { tab: Tab; account: StoredAccount; sp: SearchParams; scope: ResolvedScope }) {
  const [db, prefs] = await Promise.all([createServerSupabase(), getPrefs()]); // owner session: RLS applies, never the admin client
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const tz = prefs.timezone;
  const canModerate = account.status === 'active' && hasScope(account, COMMENTS_SCOPE); // Plan 15d: the server actions check again
  switch (tab) {
    case 'posts': {
      // own list params, never the Time Scope (ux-polish design §8 calls 1-3); one page from post_list
      const state = parsePostList(sp);
      const win = listWindow(state.dates, today);
      const { fromIso, toIso } = daysToIso(win.from, win.to, tz);
      const [read, tags] = await Promise.all([
        loadPostPage(db, account.id, { fromIso, toIso, q: state.q, format: state.format, tag: state.tag, sort: postSortOf(state.sort), page: state.page, size: postPageSize(state.view) }),
        loadTags(db),
      ]);
      // the imported server action is passed straight to the client component (never wrapped in a closure here)
      const props = { tags, state, today, scope: scope.params, accountId: account.id, setPostTags: setPostTagsAction };
      if (read) return <PostsTab posts={buildPosts(read.rows, tags, NO_FILTERS, tz)} total={read.total} page={read.page} {...props} />;
      // before migration 20261027000001 is applied: every post of the window (loadPostRows), the same state applied in TypeScript
      const rows = await loadPostRows(db, account.id, fromIso);
      return <PostsTab {...pagePosts(buildPosts(rows, tags, { format: state.format, tag: state.tag, from: win.from, to: win.to, q: state.q }, tz), state)} {...props} />;
    }
    case 'stories': {
      // own list params, never the Time Scope (ux-polish design §8 calls 1-3); one page from story_list
      const state = parseStoryList(sp);
      const win = listWindow(state.dates, today);
      const { fromIso, toIso } = daysToIso(win.from, win.to, tz);
      const read = await loadStoryPage(db, account.id, { fromIso, toIso, tz, measured: state.measured, sort: state.sort, page: state.page, size: storyPageSize(state.sort) });
      const props = { state, today, accountId: account.id, scope: scope.params };
      if (read) return <StoriesTab stories={read.stories.map((x) => storyView(x, now))} items={read.items} days={read.days} page={read.page} {...props} />;
      // before migration 20261027000001 is applied: the capped read of the window, the same state applied in TypeScript
      const { stories, truncated } = await loadStories(db, account.id, fromIso, toIso);
      return <StoriesTab {...pageStories(buildStories(stories, now), state, tz)} truncated={truncated} {...props} />;
    }
    case 'growth': {
      // the range + 90 days before it (same-weekday history, Why baselines) + the last 28 days (projection); Plan 15a
      const fromDay = growthReadFrom(scope, today);
      const { fromIso, toIso } = daysToIso(fromDay, scope.range.to, tz);
      const range = daysToIso(scope.range.from, scope.range.to, tz);
      const [daily, posts, breakdown, stories, comments, curve, audience] = await Promise.all([
        loadDaily(db, account.id, fromDay),
        loadPosts(db, account.id, MEDIA_LIMIT, fromIso),
        loadReachBreakdown(db, account.id, fromDay, scope.range.to),
        loadStoryDays(db, account.id, fromIso, toIso, tz),
        loadCommentDays(db, account.id, fromIso, toIso, tz),
        daysIn(scope.range) <= HOURLY_MAX_DAYS ? loadFollowerCurve(db, account.id, range.fromIso, range.toIso, tz) : null,
        loadAudienceEnds(db, account.id, scope.range.from, scope.range.to),
      ]);
      return <GrowthTab model={buildGrowth({ daily, posts, breakdown, stories, comments, curve, audience }, { scope, today, tz, weekStart: prefs.weekStart })} />;
    }
    case 'comments': {
      // read-only comment insights (Plan 15c): ONE view's page per request; nothing is read without the comments scope
      // (Instagram then answers an empty list, so empty would not mean "no comments"). The Time Scope rides along in links.
      const state = parseCommentState(sp);
      const props = { accountId: account.id, username: account.username, groupName: account.groupName, today, scope: scope.params, state };
      if (!hasScope(account, COMMENTS_SCOPE)) return <CommentsTab {...props} start={null} data={{ kind: 'noScope' }} />;
      const owner = account.username.toLowerCase();
      const win = listWindow(state.dates, today);
      const { fromIso, toIso } = daysToIso(win.from, win.to, tz);
      const section = state.section;
      const read = async (): Promise<CommentsData> => {
        if (section === 'topics') return { kind: 'topics', topics: topics(await loadTopicSample(db, account.id, { fromIso, toIso, owner })) };
        if (section === 'fans') {
          const page = await loadFans(db, account.id, { owner, mode: state.fans, now, page: state.page });
          return page ? { kind: 'fans', page } : { kind: 'notReady' };
        }
        if (section === 'outsiders') {
          const snapshots = await listFollowerSnapshots(db, account.id); // newest first; null = the 15b table is missing
          if (!snapshots) return { kind: 'notReady' };
          if (!snapshots[0]) return { kind: 'noSnapshot' };
          const page = await loadOutsiders(db, account.id, { owner, page: state.page });
          return page ? { kind: 'outsiders', page, snapshot: { takenOn: snapshots[0].takenOn, followerCount: snapshots[0].followerCount } } : { kind: 'notReady' };
        }
        const questions = section === 'questions';
        const [page, posts] = await Promise.all([
          loadCommentPage(db, account.id, { fromIso, toIso, q: state.q, media: state.media, questions: questions || state.only === 'questions', unanswered: questions, fansOnly: !questions && state.only === 'fans', owner, page: state.page }),
          loadCommentPosts(db, account.id),
        ]);
        return page ? { kind: 'comments', page, posts } : { kind: 'notReady' };
      };
      const [data, start] = await Promise.all([read(), loadCommentStart(db, account.id)]);
      const moderation = canModerate ? { ownUsername: account.username, hide: hideCommentAction, reply: replyCommentAction, remove: deleteCommentAction } : null; // the imported actions go straight to the client wrapper
      return <ModeratedCommentsTab {...props} start={start} data={data} moderation={moderation} />;
    }
    case 'moderation': {
      // Plan 15d: auto-hide, rules, preview and the log (owner session; nothing is read without the scope; null = migration not applied).
      // The imported server actions are passed straight to the client component (never wrapped in a closure here).
      const data = canModerate ? await loadModeration(db, account.id, account.username, parsePage(sp.page), now) : null;
      const actions = { saveWord: saveWordRuleAction, setSpam: setSpamRuleAction, deleteRule: deleteRuleAction, setAutoHide: setAutoHideAction, undo: undoModerationAction };
      return <ModerationTab accountId={account.id} allowed={canModerate} data={data} scope={scope.params} actions={actions} />;
    }
    case 'followers': {
      // by-name lists from uploaded exports (Plan 15b): the snapshot list, then the two compared snapshots, diffed here;
      // only one page of names goes to the browser. The Time Scope is carried in links, never used.
      const snapshots = await listFollowerSnapshots(db, account.id);
      const props = { accountId: account.id, username: account.username, today, scope: scope.params, deleteSnapshot: deleteFollowerSnapshotAction };
      const state = parseFollowerState(sp, snapshots ?? []);
      // before migration 20261028000002 is applied: the guide and a "needs a database update" note, no upload
      if (!snapshots) return <FollowersTab ready={false} snapshots={[]} state={state} newer={null} older={null} view={null} {...props} />;
      const pair = resolvePair(state, snapshots);
      const [newer, older] = await Promise.all([pair.newer && loadFollowerSnapshot(db, account.id, pair.newer.id), pair.older && loadFollowerSnapshot(db, account.id, pair.older.id)]);
      const view = pair.newer && newer ? followersView(newer, older ?? null, state) : null;
      return <FollowersTab ready snapshots={snapshots} state={state} newer={view ? pair.newer : null} older={older ? pair.older : null} view={view} {...props} />;
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
      {/* key: a new tab or Time Scope is a new boundary, so its skeleton shows instead of the stale tab. Not the list
          params of Posts/Stories/Comments/Followers (LIST_KEYS, incl. the Grid/Table view, COMMENT_KEYS and FOLLOWER_KEYS): the toolbar stays mounted (the search box keeps
          its focus) and the shown page stays until the next one streams in, with the top progress bar running. */}
      <Suspense key={JSON.stringify({ ...sp, ...Object.fromEntries([...LIST_KEYS, ...FOLLOWER_KEYS, ...COMMENT_KEYS].map((k) => [k, undefined])) })} fallback={<TabSkeleton tab={tab} />}>
        <TabContent tab={tab} account={account} sp={sp} scope={scope} />
      </Suspense>
    </AccountView>
  );
}
