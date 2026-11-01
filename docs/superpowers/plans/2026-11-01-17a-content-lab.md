# Plan 17a: Content lab (account tab "Content": leaderboards, formats and times, hashtags, cadence) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** one new account tab, **Content** (`?tab=content`), that answers "what works" from data already synced: **Leaderboards** (best posts by reach, saves, shares, save rate, share rate, follows per 1,000 reach or profile visits; format filter; group by none / tag / week; "Repeat this" badges; a "Retire this" list), **Formats and times** (median reach by format, by owner-timezone time of day, by caption length, and posts per week vs reach; a link to the existing best-time heatmap on Overview), **Hashtags** (per hashtag of the owner's own captions: posts, median reach and saves, last used, sample guards) and **Cadence** (posts per week, longest and usual gap, "no post for N days" warning, current and best weekly streak, Story days).

**Architecture:** no migration, no new SQL, no sync or Meta change, no new dependency. The server reads the feed posts of the Time Scope's days with `loadPostRows` (caption, tags, cover) and their **latest KNOWN** numbers with the existing `post_lab_latest(ids)` (by ids, chunks of 100: the roadmap's "latest-snapshot trap" for follows / profile visits is avoided), plus Story days with `loadStoryDays`. A pure model (`lib/dashboard/content-lab.ts`) builds the pick-independent sections; the leaderboard runs in the browser on the model's posts because its picks only change what is shown (section, metric, format, group = URL state via `history.replaceState`, UI standard 14, the Growth tab's pattern). Pure analysis in four small files under `lib/analysis/` with Vitest.

**Tech stack:** Next.js App Router (TS strict), next-intl, Vitest + Testing Library, Supabase owner session (RLS). Rules from the roadmap apply unchanged: `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §3 "Rules that apply to EVERY plan" (they are not repeated here).

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

Assumed from roadmap §4 (the owner approved the recommended defaults as working assumptions; only Q8 matters for 17a):
- **⚠ Q8 placement (assumed from roadmap §4, with the owner's wording of 2026-10-27):** a new account tab **Content placed after Posts / Stories**: Overview, Growth, Posts, Stories, **Content**, Comments, Moderation, Followers. The side navigation is untouched. NOTE: roadmap §3 "17a" wrote "inserted after Growth"; the owner's brief says "after Posts/Stories". This plan follows the owner's brief (it groups the content tabs). Switching is one array order in `TABS` (`lib/dashboard/account.ts`) plus the two tab-order assertions of Task 5 (Open question 1).
- Q1-Q7 do not touch 17a.

This plan's own decisions:
- **Range = the Time Scope** (`RangeBar` on the tab, `keep={{ tab: 'content' }}`, UI standard 4: it is an analysis page). The days are `scope.listRange` (so "All time" means every stored post, like the post lists); for "All time" the analysed range starts at the oldest post in it, not at the 5-year read floor (otherwise Cadence would count years of empty weeks). A range change drops the tab's own picks (section, metric, format, group), as the Growth tab drops `day` / `why`.
- **Numbers = `post_lab_latest`** (latest KNOWN value per column; migration 20261026000001, applied live 2026-10-19), formulas reused from `LAB_METRICS` (`lib/analysis/post-lab.ts`), so every number equals the post's Post Lab scorecard. Follows per 1,000 reach and profile visits are not reported for Reels (`LAB_METRICS.*.unsupported`): Reels are left out of those rankings and the card says so. A missing number is never ranked as 0.
- **Feed posts only** (images, carousels, Reels). Stories appear only as "Story days" in Cadence (their numbers have their own Stories tab and Post Lab).
- **Leaderboard:** top 10 (`BOARD_TOP`); ties = newer first, then id. Group by tag (a post counts for each of its tags; no tag = "Untagged") or by owner-timezone week (week-start setting), each group with posts, median (from 5 posts, else "Under 5 posts") and its best post. **Repeat this** = top quartile (mid-rank percentile >= 75 among >= 5 posts with that number, the Post Lab guard `MIN_PRIOR_POSTS`) in **two or more kinds** of number; a count and its rate are ONE kind (saves + save rate is not two). **Retire this** = a format (only when no format filter is set) or a tag (never "Untagged") with >= 5 posts whose median is below the range's 25th percentile (nearest rank, `rank` exported from `lib/analysis/trend.ts`).
- **Formats and times:** median reach per post (robust; the Overview format table keeps its averages) by format, day-part (owner timezone via `localHour`, DST-safe: night 0-5, morning 6-11, afternoon 12-17, evening 18-23) and caption length band (none; short <= 125 characters = what the feed shows before "more"; medium <= 500; long). A median needs 5 posts with reach. **Posts per week vs reach:** complete weeks of the range only, grouped by posts that week (1, 2, ..., "5 or more"), median reach per post of those weeks; hidden below 8 complete weeks with a post (roadmap §5: "not below 8 weeks"; a table, no fitted curve). The best-time heatmap stays on Overview (a link, no duplicate).
- **Hashtags:** from `captionFeatures(caption).hashtags` (the one hashtag rule; 17c reuses it), full captions on the server only. Guards as the caption lab: no per-hashtag rows below 20 posts with reach in the range (`CAPTION_MIN_POSTS`), no median below 5 posts of one hashtag (`CAPTION_MIN_SIDE`). Sorted best median first, then most used; at most 50 rows, the rest counted. Hashtags render as text. No Meta hashtag API.
- **Cadence:** posts per week = posts ÷ (days ÷ 7); gaps between posting days (two posts on one day are one day); usual gap = median of >= 4 gaps; "No post for N days" when the days since the newest post (also one before the range) exceed 2 × the usual gap; streak = weeks in a row with a post (the running week does not break it before it ends; "current" only when the range ends today). **Story days** count only from the latest of: the range start, the account's connect day (`accounts.connected_at`; Stories cannot be read before it) and the first complete day of a capped Story read.
- **Privacy:** only the owner's own captions are read; the browser gets an 80-character snippet per post (the cover's alt text), never the full caption; no comment data; nothing logged.
- **Performance:** three reads in parallel (`loadPostRows`, `loadStoryDays`, `loadTags`), then `post_lab_latest` over the range's post ids in parallel chunks of 100 (one row per id). PGlite dry run (below): 500 ids × 80 snapshots in 0.55 s single-threaded WASM; the live check is `docs/RUNBOOK_CONTENT.md` §3 ("All time").

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_CONTENT.md`)

1. **Tab position** (Decisions, first bullet). **Default: after Stories.** Alternative (roadmap text): after Growth, next to the other range-bar tabs.
2. **Sample guards.** **Default: 5 posts for any median / percentile (the Post Lab guard), 20 posts with reach for the hashtag table (caption lab), 8 complete weeks for posts-per-week vs reach.** With the default range (Last 30 Days) an account posting 3 times a week sees "Needs 20 posts…" on Hashtags: the hint says to pick a longer range.
3. **Caption bands** 0 / <= 125 / <= 500 / longer. Alternative: thirds of the account's own lengths (data-driven, harder to read).
4. **L1 — numbers match Post Lab** for 3 posts (one Reel) on the live data, and follows / profile visits are not dashes when Post Lab shows them (the latest-known read). RUNBOOK §1.
5. **L2 — speed:** `post_lab_latest` over every post of "All time" (several hundred ids, ~5 chunks in parallel) stays inside the 1.2 s page budget. RUNBOOK §3. Upgrade if not: a `security invoker` rollup (needs a migration: stop and ask).

## Owner prerequisites

None. No migration, no external resource. (`post_lab_latest` is already applied; without it the tab says "needs a database update".)

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- `lib/dashboard/account.ts:16` `export const TABS = ['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers'] as const; // Growth: Plan 15a. …` (one line, the comment continues on it); `parseTab` allow-lists `TABS`. `tests/dashboard-account.test.ts:19-21` pins the list; `tests/route-loading.test.tsx:51` runs `it.each(TABS)` over `TabSkeleton`.
- `components/account/AccountView.tsx:79` the range bar line: `{v === 'overview' || v === 'growth' ? <RangeBar scope={scope} today={today} keep={v === 'growth' ? { tab: v } : undefined} /> : null}`; tabs from `TABS` with labels `pages.account.tab.<id>`. `tests/account-view.test.tsx:58` `frame(tab: 'overview' | 'growth' | …)`, `:72` the tab-name list, `:120-126` the Growth range-bar test (the last test of the `AccountView` describe).
- `components/account/TabSkeleton.tsx:20-22` `case 'comments': case 'moderation': case 'followers':` share one skeleton (the default case is Overview's).
- `app/(app)/accounts/[id]/(tabs)/page.tsx`: imports at `:7` (`CommentsTab`) and `:26` (`buildPosts, buildStories, storyView` from `@/lib/dashboard/content`); `TabContent` switch with `case 'growth': {` at `:87`; in scope there: `db`, `prefs`, `now`, `today`, `tz`, `account` (`StoredAccount`, has `connectedAt`), `scope` (`ResolvedScope`); `loadTags`, `daysToIso` already imported. The Suspense key is built from `sp` minus `LIST_KEYS`/`FOLLOWER_KEYS`/`COMMENT_KEYS`: the Content picks never reach the server (replaceState), so the key needs no change. No new route segment: no new `loading.tsx`.
- `lib/dashboard/detail-read.ts:75` `loadPostRows(db, accountId, since)`: feed posts newest first (newest 500, then back to `since`), `PostRow` = `Post` + `caption`, `tagIds`, `cover`, `slides`; paged under the 1,000-row cap.
- `lib/dashboard/growth-read.ts:88` `loadStoryDays(db, accountId, fromIso, toIso, tz): Promise<DayCounts>` (`{ days, from }`, capped at 5,000 Stories, `from` = first complete day when capped).
- `lib/post-lab/read.ts:56` private `function toValues(r: Row): LabValues` (maps a `post_lab_latest` row; skip rate ÷ 100; link taps from `profile_activity`). `supabase/migrations/20261026000001_post_lab.sql` `post_lab_latest(p_ids text[])`: one row per media id with a snapshot, `security invoker`, `authenticated` only.
- `lib/analysis/post-lab.ts` exports `LAB_METRICS` (`saveRate`, `shareRate`, `followsPer1k`, `profileVisits` with `unsupported: ['REELS']` on the last two; `value(v, ctx)`), `percentile` (mid-rank), `LabValues`. `lib/analysis/flags.ts:9` `MIN_PRIOR_POSTS = 5`. `lib/analysis/trend.ts:59` private `const rank = (sorted, p) => …` (nearest rank). `lib/analysis/caption.ts` `captionFeatures`, `CAPTION_MIN_POSTS = 20`, `CAPTION_MIN_SIDE = 5`. `lib/analysis/posts.ts` `median`, `FEED_FORMATS`. `lib/dashboard/content.ts` `snippet` (80 code points + `…`), `FeedFormat`. `lib/time-scope/range.ts` `weekOf`, `bucketStart`, `daysBetween`, `daysIn`. `lib/sync/time.ts` `localDay`, `localHour`, `addDays`.
- `components/shared/FilterToolbar.tsx:184-212` `FilterSelect({ id, label, value, options, hrefFor })`, `onChange={(e) => apply(hrefFor(e.target.value))}` (navigates). `tests/filter-toolbar.test.tsx` covers it.
- `components/account/GrowthTab.tsx:46-54` the replaceState pattern (`useSearchParams` for the first state, local state, `window.history.replaceState(null, '', href)`).
- `messages/en.json` / `zh-CN.json`: line 634 `      "tab": { "overview": "Overview", "growth": "Growth", "posts": "Posts", "stories": "Stories", "comments": "Comments", "followers": "Followers", "moderation": "Moderation" },` (zh: `"stories": "快拍", "comments": "评论"`); line 934 `      "growth": {` followed by `        "kpis": "Growth numbers",` (zh `"kpis": "增长数据",`) inside `pages.account`. `analysis.format.<MediaKind>` exists.
- `tests/ui-standards.test.ts`: rule 4 lists the files that render `<RangeBar` (AccountView is already one: unchanged); rule 7 every `<TabsList` has `variant="line"`; rule 6 no `\d{1,3}[dwmyh]` in any message.

## Out of scope

Cross-account leaderboards (Explorer covers them), video length, other people's hashtags, any write, a fitted frequency curve, moving the best-time heatmap, Story leaderboards, exports of the tab, 17b findings.

## Global Constraints

- Roadmap §3 "Rules that apply to EVERY plan" (link, not repeated). Ponytail: **no migration, no new dependency, no new design token**; four small pure files instead of one abstraction.
- TypeScript strict. Reads with the owner session only (`createServerSupabase`), never the admin client; fixed error messages (`content lab read: latest failed`), never a Supabase message.
- Every UI string via next-intl; ALL new keys are added by Task 1 in BOTH catalogs (real Simplified Chinese, full-width punctuation).
- Tests: Vitest; lib tests may use `// @vitest-environment node`; fakes only; never connect to Supabase.
- `npm run check` passes after every wave. Commits: conventional, `git add` the listed paths only, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus (opus read-only review after the last wave)

1. **Latest-known vs latest-snapshot trap:** every number of the tab comes from `post_lab_latest` (`lib/dashboard/content-lab-read.ts`), never from `loadPostRows`' embedded snapshot (`PostRow.reach` etc. must be unused by the model: grep `r.reach`, `r.saves` in `lib/dashboard/content-lab.ts`); formulas from `LAB_METRICS` (test `boardValue … uses the Post Lab formulas`).
2. **Sample guards:** 5 for medians / quartiles / percentiles, 20 for hashtag rows, 8 complete weeks for frequency, 4 gaps for the usual gap; below a guard the UI shows the reason, never a number or 0.
3. **Owner-timezone day-parts and weeks:** `localHour` / `localDay` with `tz` (DST tests: Europe/London both switches; KL week across UTC Sunday); the client leaderboard uses `prefs.timezone` / `prefs.weekStart`: the same prefs `getPrefs()` gave the server.
4. **Tab order and `keep`:** `TABS`, the range bar's `keep={{ tab: 'content' }}` (test), Post Lab links carry `scope.query`, the Overview link carries it too; picks never trigger a server render (replaceState only; `FilterSelect` `onPick`).
5. **Performance / 1,000-row cap:** `post_lab_latest` by ids in chunks of 100 (one row per id), parallel; `loadPostRows` pages; "All time" over hundreds of posts (RUNBOOK §3).
6. **Privacy:** full captions never leave the server (only `snippet`); hashtags rendered as text; no comment table read; no logging in the new files.
7. **Empty / degraded states:** no posts, all-null extras, missing `post_lab_latest` (`PGRST202` / `42883` → "needs a database update"), other errors throw the fixed message (the page's error boundary).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | `pages.account.tab.content`, `pages.account.content.*` |
| `lib/analysis/leaderboard.ts` (new), `tests/analysis-leaderboard.test.ts` (new), `lib/analysis/trend.ts`, `lib/analysis/hashtags.ts` (new), `tests/analysis-hashtags.test.ts` (new) | 2 | ranking, repeat / retire, groups; hashtag lab; `rank` exported |
| `lib/analysis/cadence.ts` (new), `tests/analysis-cadence.test.ts` (new), `lib/analysis/splits.ts` (new), `tests/analysis-splits.test.ts` (new) | 3 | cadence + posts-per-week vs reach; day-parts, caption bands, median splits |
| `lib/dashboard/content-lab-read.ts` (new), `lib/dashboard/content-lab.ts` (new), `lib/post-lab/read.ts`, `tests/content-lab.test.ts` (new) | 4 | the read (owner session), the model, URL picks |
| `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `components/account/TabSkeleton.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx` | 5 | the tab in the frame, range bar, skeleton |
| `components/account/ContentTab.tsx` (new), `components/shared/FilterToolbar.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/content-tab.test.tsx` (new) | 6 | the tab UI and its wiring |
| `docs/RUNBOOK_CONTENT.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md` | 7 | runbook and docs |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor with the block shown), never by re-serialising the JSON. Keep every other line byte-identical; both locales get the same keys.

**Editing existing files:** exact old → new text for the Edit tool. The working copies are CRLF; the Edit tool matches either; do not convert line endings. New files: use the Write tool (they contain regexes, `…` and Chinese).

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 leaderboard + hashtags | — | `lib/analysis/leaderboard.ts`, `lib/analysis/hashtags.ts`, `lib/analysis/trend.ts`, `tests/analysis-leaderboard.test.ts`, `tests/analysis-hashtags.test.ts` | 1, 3 |
| 3 cadence + splits | — | `lib/analysis/cadence.ts`, `lib/analysis/splits.ts`, `tests/analysis-cadence.test.ts`, `tests/analysis-splits.test.ts` | 1, 2 |
| 4 read + model | 2, 3 | `lib/dashboard/content-lab-read.ts`, `lib/dashboard/content-lab.ts`, `lib/post-lab/read.ts`, `tests/content-lab.test.ts` | 5 |
| 5 tab frame | 1 | `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `components/account/TabSkeleton.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx` | 4 |
| 6 Content tab UI + wiring | 1, 4, 5 | `components/account/ContentTab.tsx`, `components/shared/FilterToolbar.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/content-tab.test.tsx` | 7 |
| 7 docs | — | `docs/RUNBOOK_CONTENT.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md` | 6 |

**Waves (at most 3 sonnet worktree agents at a time; check free disk first, `Get-PSDrive C`):** 1 = Tasks 1, 2, 3 → 2 = Tasks 4, 5 → 3 = Tasks 6, 7. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log` and READ it (implementer rules, orchestrator checklist). Every wave leaves `main` green: wave 1 adds unused keys and pure functions; wave 2 adds an unused read/model and the tab in the strip (until wave 3 the Content tab renders the Overview data through the page's `default:` case: harmless, never pushed in between); wave 3 wires the tab. Then the opus review (Review Focus), ONE fix wave, check, docs ticks.

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

- [ ] **Step 1 — en tab label.** In `messages/en.json` replace the exact text (line 634)

```json
"stories": "Stories", "comments": "Comments"
```

with

```json
"stories": "Stories", "content": "Content", "comments": "Comments"
```

- [ ] **Step 2 — en block.** In `messages/en.json` replace the exact two lines (line 934, inside `pages.account`)

```json
      "growth": {
        "kpis": "Growth numbers",
```

with the block below followed by those same two lines unchanged:

```json
      "content": {
        "sections": { "label": "Content sections", "leaderboards": "Leaderboards", "formats": "Formats and times", "hashtags": "Hashtags", "cadence": "Cadence" },
        "source": "Your feed posts from {from} to {to}: {count, plural, one {# post} other {# posts}}, {measured} with reach. Each post's latest numbers from Instagram.",
        "notReady": "The Content tab needs a database update",
        "notReadyHint": "Apply the migration 20261026000001_post_lab.sql (docs/RUNBOOK_POSTLAB.md §0), then reload this page.",
        "empty": "No posts in this range",
        "emptyHint": "Pick a longer range above to see what works.",
        "postedOn": "Posted {date}",
        "toolbar": "Leaderboard options",
        "metricLabel": "Rank by",
        "formatLabel": "Format",
        "allFormats": "All formats",
        "group": { "label": "Group by", "none": "No grouping", "tag": "Tag", "week": "Week" },
        "metric": { "reach": "Reach", "saves": "Saves", "shares": "Shares", "saveRate": "Save rate", "shareRate": "Share rate", "followsPer1k": "Follows per 1,000 reach", "profileVisits": "Profile visits" },
        "boardTitle": "Best posts by {metric}",
        "boardSource": "{n} of {posts} posts have this number; posts without it are left out, never counted as zero.",
        "notForReels": "Instagram does not report it for Reels.",
        "repeatHint": "Repeat this = in your top quarter for at least two kinds of number (reach, saves, shares, follows, profile visits). A pattern, not proof.",
        "noValues": "No post in this range has this number yet.",
        "post": "Post",
        "repeat": "Repeat this",
        "median": "Median",
        "best": "Best post",
        "weekOf": "Week of {day}",
        "untagged": "Untagged",
        "fewer": "Under 5 posts",
        "retireTitle": "Retire this",
        "retireSource": "Formats and tags with 5 or more posts whose median sits below your 25th percentile ({value}). A pattern, not proof.",
        "retireNone": "Nothing sits clearly below your usual numbers.",
        "retireRow": "{name}: median {median} over {n} posts",
        "splitKey": "Group",
        "splitSource": "Median reach per post, in your timezone. A median needs 5 posts with reach.",
        "posts": "Posts",
        "measured": "With reach",
        "medianReach": "Median reach",
        "formatsTitle": "By format",
        "daypartsTitle": "By time of day",
        "captionsTitle": "By caption length",
        "daypart": { "night": "Night (00:00 to 05:59)", "morning": "Morning (06:00 to 11:59)", "afternoon": "Afternoon (12:00 to 17:59)", "evening": "Evening (18:00 to 23:59)" },
        "band": { "none": "No caption", "short": "Short (up to 125 characters)", "medium": "Medium (126 to 500 characters)", "long": "Long (over 500 characters)" },
        "frequencyTitle": "Posts per week and reach",
        "frequencySource": "{weeks} complete weeks with a post, grouped by how many posts they had; median reach per post. A pattern, not proof.",
        "frequencyNone": "Needs 8 complete weeks with a post in the range.",
        "postsPerWeek": "Posts per week",
        "perWeek": "{count, plural, one {# post a week} other {# posts a week}}",
        "perWeekCap": "{count} or more posts a week",
        "weeks": "Weeks",
        "bestTimeLink": "The best-time heatmap is on the Overview tab.",
        "hashtagsTitle": "Your hashtags",
        "hashtagsSource": "Hashtags in your own captions ({withHashtags} of {posts} posts). Median reach of all posts with reach: {baseline}.",
        "hashtagsFew": "Needs 20 posts with reach in the range ({measured} so far). Pick a longer range above.",
        "hashtagsNone": "No hashtags in this range.",
        "hashtag": "Hashtag",
        "medianSaves": "Median saves",
        "lastUsed": "Last used",
        "hashtagsMore": "{count, plural, one {# more hashtag not shown} other {# more hashtags not shown}}",
        "cadenceTitle": "Cadence",
        "cadenceSource": "Feed posts from {from} to {to} ({count, plural, one {# post} other {# posts}}), in your timezone.",
        "days": "{count, plural, one {# day} other {# days}}",
        "weeksCount": "{count, plural, one {# week} other {# weeks}}",
        "longestGap": "Longest gap",
        "gapDates": "{from} to {to}",
        "usualGap": "Usual gap",
        "usualGapFew": "Needs 5 posting days",
        "sinceLast": "Since the last post",
        "never": "No post yet",
        "streak": "Current streak",
        "streakHint": "Weeks in a row with a post; this week counts once it has one.",
        "noCurrent": "Only for ranges that end today",
        "bestStreak": "Best streak",
        "warn": "No post for {days} days: more than twice your usual gap of {usual} days.",
        "storyDays": "Story days",
        "storyLine": "{days} of {total} days had a Story ({perWeek} a week), counted from {from}.",
        "storyNone": "Stories are only known from the day the account was connected, which is after this range."
      },
      "growth": {
        "kpis": "Growth numbers",
```

- [ ] **Step 3 — zh-CN tab label.** In `messages/zh-CN.json` replace `"stories": "快拍", "comments": "评论"` with `"stories": "快拍", "content": "内容", "comments": "评论"`.

- [ ] **Step 4 — zh-CN block.** In `messages/zh-CN.json` replace the exact two lines (line 934)

```json
      "growth": {
        "kpis": "增长数据",
```

with:

```json
      "content": {
        "sections": { "label": "内容分区", "leaderboards": "排行榜", "formats": "形式与时间", "hashtags": "话题标签", "cadence": "发帖节奏" },
        "source": "你在 {from} 至 {to} 发布的动态：{count, plural, other {# 条}}，其中 {measured} 条有覆盖数据。每条使用 Instagram 最新报告的数字。",
        "notReady": "内容标签页需要更新数据库",
        "notReadyHint": "请应用迁移 20261026000001_post_lab.sql（docs/RUNBOOK_POSTLAB.md §0），然后重新加载此页面。",
        "empty": "此范围内没有帖子",
        "emptyHint": "在上方选择更长的范围，看看哪些内容有效。",
        "postedOn": "发布于 {date}",
        "toolbar": "排行榜选项",
        "metricLabel": "排序依据",
        "formatLabel": "形式",
        "allFormats": "全部形式",
        "group": { "label": "分组方式", "none": "不分组", "tag": "标签", "week": "周" },
        "metric": { "reach": "覆盖人数", "saves": "收藏数", "shares": "分享数", "saveRate": "收藏率", "shareRate": "分享率", "followsPer1k": "每 1,000 覆盖带来的关注", "profileVisits": "主页访问" },
        "boardTitle": "按{metric}排名的最佳帖子",
        "boardSource": "{posts} 条帖子中有 {n} 条有此数字；没有的不参与排名，绝不按零计算。",
        "notForReels": "Instagram 不为 Reels 报告此数字。",
        "repeatHint": "值得重复 = 至少两类数字（覆盖、收藏、分享、关注、主页访问）位于你的前四分之一。这是规律，不是证据。",
        "noValues": "此范围内还没有帖子有这个数字。",
        "post": "帖子",
        "repeat": "值得重复",
        "median": "中位数",
        "best": "最佳帖子",
        "weekOf": "{day} 起的一周",
        "untagged": "未加标签",
        "fewer": "不足 5 条",
        "retireTitle": "可以停用",
        "retireSource": "有 5 条或以上帖子、且中位数低于你第 25 百分位（{value}）的形式和标签。这是规律，不是证据。",
        "retireNone": "没有明显低于你平常水平的内容。",
        "retireRow": "{name}：{n} 条帖子的中位数为 {median}",
        "splitKey": "分组",
        "splitSource": "每条帖子的覆盖中位数，按你的时区。中位数需要 5 条有覆盖数据的帖子。",
        "posts": "帖子",
        "measured": "有覆盖数据",
        "medianReach": "覆盖中位数",
        "formatsTitle": "按形式",
        "daypartsTitle": "按时段",
        "captionsTitle": "按文案长度",
        "daypart": { "night": "夜间（00:00 至 05:59）", "morning": "上午（06:00 至 11:59）", "afternoon": "下午（12:00 至 17:59）", "evening": "晚上（18:00 至 23:59）" },
        "band": { "none": "无文案", "short": "短（不超过 125 个字符）", "medium": "中（126 至 500 个字符）", "long": "长（超过 500 个字符）" },
        "frequencyTitle": "每周发帖数与覆盖",
        "frequencySource": "{weeks} 个有发帖的完整周，按当周发帖数分组；每条帖子的覆盖中位数。这是规律，不是证据。",
        "frequencyNone": "需要此范围内有 8 个有发帖的完整周。",
        "postsPerWeek": "每周发帖数",
        "perWeek": "{count, plural, other {每周 # 条}}",
        "perWeekCap": "每周 {count} 条或以上",
        "weeks": "周数",
        "bestTimeLink": "最佳发帖时间热力图在概览标签页。",
        "hashtagsTitle": "你的话题标签",
        "hashtagsSource": "你自己文案中的话题标签（{posts} 条帖子中有 {withHashtags} 条）。所有有覆盖数据的帖子的覆盖中位数：{baseline}。",
        "hashtagsFew": "需要此范围内有 20 条有覆盖数据的帖子（目前 {measured} 条）。请在上方选择更长的范围。",
        "hashtagsNone": "此范围内没有话题标签。",
        "hashtag": "话题标签",
        "medianSaves": "收藏中位数",
        "lastUsed": "最近使用",
        "hashtagsMore": "{count, plural, other {另有 # 个话题标签未显示}}",
        "cadenceTitle": "发帖节奏",
        "cadenceSource": "{from} 至 {to} 的动态（{count, plural, other {# 条}}），按你的时区。",
        "days": "{count, plural, other {# 天}}",
        "weeksCount": "{count, plural, other {# 周}}",
        "longestGap": "最长间隔",
        "gapDates": "{from} 至 {to}",
        "usualGap": "通常间隔",
        "usualGapFew": "需要 5 个发帖日",
        "sinceLast": "距上次发帖",
        "never": "还没有帖子",
        "streak": "当前连续",
        "streakHint": "连续有发帖的周数；本周发帖后才计入。",
        "noCurrent": "仅适用于截至今天的范围",
        "bestStreak": "最长连续",
        "warn": "已 {days} 天没有发帖：超过你通常间隔 {usual} 天的两倍。",
        "storyDays": "快拍天数",
        "storyLine": "{total} 天中有 {days} 天发了快拍（每周 {perWeek} 天），从 {from} 起计算。",
        "storyNone": "快拍只能从账户连接当天起获知，而连接日在此范围之后。"
      },
      "growth": {
        "kpis": "增长数据",
```

- [ ] **Step 5 — verify.** `node -e "for (const f of ['messages/en.json','messages/zh-CN.json']) { const j=JSON.parse(require('fs').readFileSync(f,'utf8')); console.log(f, Object.keys(j.pages.account.content).length, j.pages.account.tab.content) }"` prints `73 Content` and `73 内容`. `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts` passes (`git diff --stat` shows only additions plus the one changed tab line per file).

- [ ] **Step 6 — commit.** `git add messages/en.json messages/zh-CN.json` → `git commit -m "feat(i18n): Content tab keys (en, zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 2: leaderboard and hashtag lab (pure, TDD)

**Files:** Create `lib/analysis/leaderboard.ts`, `lib/analysis/hashtags.ts`, `tests/analysis-leaderboard.test.ts`, `tests/analysis-hashtags.test.ts`; modify `lib/analysis/trend.ts`.

- [ ] **Step 1 — export `rank`.** In `lib/analysis/trend.ts` (line 59) replace `const rank = (sorted: number[], p: number) =>` with `export const rank = (sorted: number[], p: number) =>` (nothing else on the line changes).

- [ ] **Step 2 — failing tests.** Write `tests/analysis-leaderboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOARD_MIN, boardValue, leaderboard, repeatIds, type BoardPost } from '@/lib/analysis/leaderboard';
import { LAB_METRICS, type LabValues } from '@/lib/analysis/post-lab';

const KL = 'Asia/Kuala_Lumpur';
const V = (o: Partial<LabValues> = {}): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const P = (id: string, day: string, v: Partial<LabValues> | null, o: Partial<BoardPost> = {}): BoardPost => ({ id, mediaType: 'IMAGE', postedAt: `${day}T04:00:00Z`, tagIds: [], values: v === null ? null : V(v), ...o });
const base = { metric: 'reach' as const, format: null, group: 'none' as const, tz: KL, weekStart: 'mon' as const };

describe('boardValue', () => {
  it('uses the Post Lab formulas (same number as the scorecard)', () => {
    const v = V({ reach: 200, saves: 10, shares: 4, follows: 3, profileVisits: 7 });
    const ctx = { er: 'reach' as const, followers: null, story: false };
    expect(boardValue('reach', 'IMAGE', v)).toBe(200);
    expect(boardValue('saves', 'IMAGE', v)).toBe(10);
    expect(boardValue('shares', 'IMAGE', v)).toBe(4);
    expect(boardValue('saveRate', 'IMAGE', v)).toBe(LAB_METRICS.saveRate.value(v, ctx));
    expect(boardValue('saveRate', 'IMAGE', v)).toBeCloseTo(0.05);
    expect(boardValue('shareRate', 'IMAGE', v)).toBeCloseTo(0.02);
    expect(boardValue('followsPer1k', 'IMAGE', v)).toBeCloseTo(15);
    expect(boardValue('profileVisits', 'CAROUSEL_ALBUM', v)).toBe(7);
  });

  it('missing stays missing: never measured, no reach for a rate, not reported for Reels', () => {
    expect(boardValue('reach', 'IMAGE', null)).toBeNull();
    expect(boardValue('saveRate', 'IMAGE', V({ reach: 0, saves: 3 }))).toBeNull();
    expect(boardValue('followsPer1k', 'REELS', V({ reach: 100, follows: 2 }))).toBeNull();
    expect(boardValue('profileVisits', 'REELS', V({ profileVisits: 9 }))).toBeNull();
    expect(boardValue('profileVisits', 'IMAGE', V({ reach: 100 }))).toBeNull(); // extras not captured: null, never 0
  });
});

describe('leaderboard', () => {
  it('ranks high to low; ties newer first; leaves out posts without the number and Stories; counts both', () => {
    const b = leaderboard([P('a', '2026-10-01', { reach: 50 }), P('b', '2026-10-02', { reach: 80 }), P('c', '2026-10-03', { reach: 80 }), P('d', '2026-10-04', null), P('e', '2026-10-04', { reach: 999 }, { mediaType: 'STORY' })], base);
    expect(b.top.map((r) => [r.post.id, r.value])).toEqual([['c', 80], ['b', 80], ['a', 50]]);
    expect([b.posts, b.n]).toEqual([4, 3]);
    expect(b.groups).toBeNull();
    expect(b.q25).toBeNull(); // below BOARD_MIN values
  });

  it('no posts, all-null extras: an empty board, no quartile, nothing to retire', () => {
    expect(leaderboard([], base)).toEqual({ metric: 'reach', posts: 0, n: 0, q25: null, top: [], groups: null, retire: [] });
    const b = leaderboard(Array.from({ length: 8 }, (_, i) => P(`p${i}`, '2026-10-01', { reach: 100 + i })), { ...base, metric: 'profileVisits' });
    expect([b.posts, b.n, b.top.length, b.q25]).toEqual([8, 0, 0, null]);
  });

  it('format filter and the top-10 limit', () => {
    const posts = [...Array.from({ length: 12 }, (_, i) => P(`r${i}`, '2026-10-01', { reach: i }, { mediaType: 'REELS' })), P('img', '2026-10-01', { reach: 1000 })];
    const b = leaderboard(posts, { ...base, format: 'REELS' });
    expect(b.posts).toBe(12);
    expect(b.top).toHaveLength(10);
    expect(b.top[0].post.id).toBe('r11');
    expect(leaderboard(posts, { ...base, limit: 3 }).top.map((r) => r.post.id)).toEqual(['img', 'r11', 'r10']);
  });

  it('group by tag: untagged is a group, a post counts for each of its tags, median only from BOARD_MIN, best first', () => {
    const posts = [
      ...Array.from({ length: 5 }, (_, i) => P(`a${i}`, '2026-10-01', { reach: 100 + i }, { tagIds: ['tA'] })),
      P('both', '2026-10-02', { reach: 500 }, { tagIds: ['tA', 'tB'] }),
      P('none', '2026-10-02', { reach: 10 }),
    ];
    const g = leaderboard(posts, { ...base, group: 'tag' }).groups!;
    expect(g.map((x) => [x.key, x.posts, x.n, x.median, x.best?.post.id])).toEqual([
      ['tA', 6, 6, 102.5, 'both'],
      ['tB', 1, 1, null, 'both'],
      ['untagged', 1, 1, null, 'none'],
    ]);
  });

  it('group by week: the owner-timezone week (week start setting), newest week first', () => {
    // 2026-10-04T17:00Z is Sunday in UTC but Monday 01:00 in Kuala Lumpur
    const posts = [P('late', '2026-10-04', { reach: 5 }, { postedAt: '2026-10-04T17:00:00Z' }), P('early', '2026-09-30', { reach: 7 })];
    expect(leaderboard(posts, { ...base, group: 'week' }).groups!.map((g) => [g.key, g.best?.post.id])).toEqual([['2026-10-05', 'late'], ['2026-09-28', 'early']]);
    expect(leaderboard(posts, { ...base, group: 'week', tz: 'UTC' }).groups!.map((g) => g.key)).toEqual(['2026-09-28']);
    expect(leaderboard(posts, { ...base, group: 'week', weekStart: 'sun' }).groups!.map((g) => g.key)).toEqual(['2026-10-04', '2026-09-27']);
  });

  it('retire this: a format or tag whose median (n >= 5) sits below the 25th percentile; never "untagged"; no formats under a format filter', () => {
    const low = Array.from({ length: 5 }, (_, i) => P(`i${i}`, '2026-10-01', { reach: 10 + i }, { tagIds: ['tLow'] }));
    const high = Array.from({ length: 10 }, (_, i) => P(`r${i}`, '2026-10-01', { reach: 100 + i }, { mediaType: 'REELS' }));
    const b = leaderboard([...low, ...high], base);
    expect(b.q25).toBe(13); // nearest rank of 15 values
    expect(b.retire).toEqual([
      { kind: 'format', key: 'IMAGE', n: 5, median: 12 },
      { kind: 'tag', key: 'tLow', n: 5, median: 12 },
    ]);
    const untagged = leaderboard([...low.map((p) => ({ ...p, tagIds: [] })), ...high.map((p) => ({ ...p, tagIds: ['tHigh'] }))], base);
    expect(untagged.retire.map((r) => r.key)).toEqual(['IMAGE']);
    expect(leaderboard([...low, ...high], { ...base, format: 'IMAGE' }).retire).toEqual([]); // only the tag is left, and its median (12) is not below its own range's 25th percentile (11)
  });
});

describe('repeatIds', () => {
  const many = (n: number, o: (i: number) => Partial<LabValues>) => Array.from({ length: n }, (_, i) => P(`p${i}`, '2026-10-01', { reach: 100, saves: 1, shares: 1, ...o(i) }));

  it('top quartile in two kinds of number = repeat this', () => {
    const posts = [...many(7, () => ({})), P('star', '2026-10-02', { reach: 900, saves: 1, shares: 9 })];
    expect([...repeatIds(posts)]).toEqual(['star']);
  });

  it('a count and its rate are one kind: top in saves and save rate only is not enough', () => {
    const posts = [...many(7, () => ({})), P('saver', '2026-10-02', { reach: 100, saves: 40, shares: 1 })];
    expect(repeatIds(posts).size).toBe(0);
  });

  it(`below ${BOARD_MIN} posts with a number, that number does not count`, () => {
    expect(repeatIds([P('x', '2026-10-01', { reach: 900, shares: 9 }), P('y', '2026-10-01', { reach: 1, shares: 1 })]).size).toBe(0);
  });

  it('equal values are not a top quartile (mid-rank 50)', () => {
    expect(repeatIds(many(8, () => ({}))).size).toBe(0);
  });
});
```

and `tests/analysis-hashtags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { captionFeatures, CAPTION_MIN_POSTS } from '@/lib/analysis/caption';
import { hashtagLab, HASHTAG_ROWS } from '@/lib/analysis/hashtags';

const post = (caption: string, reach: number | null, saves: number | null = null, postedAt = '2026-10-01T04:00:00Z') => ({ hashtags: captionFeatures(caption).hashtags, postedAt, reach, saves });

describe('hashtagLab', () => {
  it(`below ${CAPTION_MIN_POSTS} measured posts: counts and the baseline only, no per-hashtag rows`, () => {
    const lab = hashtagLab([post('#a', 100), post('#a #b', 300), post('no tags', null), post('#c', 0)]);
    expect(lab).toEqual({ posts: 4, measured: 2, withHashtags: 3, baseline: 200, rows: null, more: 0 });
  });

  it('per hashtag: posts, measured, median reach and saves from 5 posts, last used; best median first, then most used', () => {
    const posts = [
      ...Array.from({ length: 6 }, (_, i) => post('Sunset #Travel #travel', 200, 10, `2026-10-0${i + 1}T04:00:00Z`)), // one hashtag counted once per post
      ...Array.from({ length: 5 }, () => post('#food', 50, null)),
      ...Array.from({ length: 3 }, () => post('#穿搭', 400, 40)),
      ...Array.from({ length: 6 }, () => post('plain', 100, 5)),
    ];
    const lab = hashtagLab(posts);
    expect([lab.measured, lab.withHashtags, lab.baseline]).toEqual([20, 14, 100]);
    expect(lab.rows).toEqual([
      { tag: 'travel', posts: 6, n: 6, medianReach: 200, medianSaves: 10, lastUsed: '2026-10-06T04:00:00Z' },
      { tag: 'food', posts: 5, n: 5, medianReach: 50, medianSaves: null, lastUsed: '2026-10-01T04:00:00Z' },
      { tag: '穿搭', posts: 3, n: 3, medianReach: null, medianSaves: null, lastUsed: '2026-10-01T04:00:00Z' },
    ]);
  });

  it(`at most ${HASHTAG_ROWS} rows; the rest is counted`, () => {
    const posts = Array.from({ length: 52 }, (_, i) => post(`#tag${i}`, 100));
    const lab = hashtagLab(posts);
    expect(lab.rows).toHaveLength(HASHTAG_ROWS);
    expect(lab.more).toBe(2);
  });
});
```

Run `npx vitest run tests/analysis-leaderboard.test.ts tests/analysis-hashtags.test.ts`: FAIL (modules not found).

- [ ] **Step 3 — implementation.** Write `lib/analysis/leaderboard.ts`:

```ts
// Leaderboards of the Content tab (Plan 17a; creator-toolkit design §6 "Leaderboards"): the account's own feed posts of
// a range ranked by one number, optionally grouped by tag or week, with "repeat this" (top quartile in 2+ kinds of
// number) and "retire this" (a format or tag whose median sits below the range's 25th percentile, n >= 5). Pure.
// Values are the latest KNOWN numbers of each post (post_lab_latest), computed with the Post Lab's own formulas, so a
// post shows the same number here as on its scorecard. A missing number is left out, never ranked as 0.
import { MIN_PRIOR_POSTS } from '@/lib/analysis/flags';
import { LAB_METRICS, percentile, type LabValues } from '@/lib/analysis/post-lab';
import { median } from '@/lib/analysis/posts';
import { rank } from '@/lib/analysis/trend';
import type { MediaKind } from '@/lib/instagram/parse';
import type { WeekStart } from '@/lib/prefs';
import { localDay } from '@/lib/sync/time';
import { bucketStart } from '@/lib/time-scope/range';

export const BOARD_METRICS = ['reach', 'saves', 'shares', 'saveRate', 'shareRate', 'followsPer1k', 'profileVisits'] as const;
export type BoardMetric = (typeof BOARD_METRICS)[number];
export const BOARD_GROUPS = ['none', 'tag', 'week'] as const;
export type BoardGroupBy = (typeof BOARD_GROUPS)[number];
export type BoardKind = 'count' | 'percent' | 'per1k';
export const BOARD_KIND: Record<BoardMetric, BoardKind> = { reach: 'count', saves: 'count', shares: 'count', saveRate: 'percent', shareRate: 'percent', followsPer1k: 'per1k', profileVisits: 'count' };
/** Numbers Instagram does not report for Reels (Post Lab: "not reported for this format"); the UI says so. */
export const NOT_FOR_REELS: readonly BoardMetric[] = ['followsPer1k', 'profileVisits'];
/** Kinds of number for "repeat this": a count and its rate are one kind, so saves + save rate is not "two numbers". */
const FAMILY: Record<BoardMetric, string> = { reach: 'reach', saves: 'saves', saveRate: 'saves', shares: 'shares', shareRate: 'shares', followsPer1k: 'follows', profileVisits: 'visits' };

export const BOARD_TOP = 10;
/** Values a percentile, a quartile or a median needs: the Post Lab peer guard (MIN_PRIOR_POSTS). */
export const BOARD_MIN = MIN_PRIOR_POSTS;
export const REPEAT_KINDS = 2;
export const TOP_QUARTILE = 75; // mid-rank percentile from which a post is in the top quartile

export interface BoardPost {
  id: string;
  mediaType: MediaKind;
  postedAt: string; // ISO
  tagIds: string[];
  values: LabValues | null; // post_lab_latest; null = never measured
}
export interface Ranked<P> {
  post: P;
  value: number;
  repeat: boolean;
}
export interface BoardGroup<P> {
  key: string; // tag id, 'untagged', or the first day of the week
  posts: number; // posts in the group
  n: number; // posts that have the number
  median: number | null; // null below BOARD_MIN
  best: Ranked<P> | null;
  retire: boolean;
}
export interface Retire {
  kind: 'format' | 'tag';
  key: string; // MediaKind or tag id
  n: number;
  median: number;
}
export interface Board<P> {
  metric: BoardMetric;
  posts: number; // feed posts after the format filter
  n: number; // of them with the number
  q25: number | null; // the range's 25th percentile (nearest rank); null below BOARD_MIN
  top: Ranked<P>[];
  groups: BoardGroup<P>[] | null; // null when not grouped
  retire: Retire[]; // lowest median first
}

const FEED_CTX = { er: 'reach', followers: null, story: false } as const;

/** One number of one post; null when it was never captured or Instagram does not report it for the format. */
export function boardValue(metric: BoardMetric, mediaType: MediaKind, v: LabValues | null): number | null {
  if (!v) return null;
  if (metric === 'saves') return v.saves;
  if (metric === 'shares') return v.shares;
  const d = LAB_METRICS[metric];
  return d.unsupported?.includes(mediaType) ? null : d.value(v, FEED_CTX);
}

/** Ids of the posts in the top quartile (percentile >= 75 among at least BOARD_MIN posts with that number) in REPEAT_KINDS or more kinds of number. */
export function repeatIds(posts: BoardPost[]): Set<string> {
  const kinds = new Map<string, Set<string>>();
  for (const m of BOARD_METRICS) {
    const vals = posts.flatMap((p) => {
      const v = boardValue(m, p.mediaType, p.values);
      return v === null ? [] : [{ id: p.id, v }];
    });
    if (vals.length < BOARD_MIN) continue;
    const all = vals.map((x) => x.v);
    for (const x of vals) if ((percentile(x.v, all) ?? 0) >= TOP_QUARTILE) kinds.set(x.id, (kinds.get(x.id) ?? new Set()).add(FAMILY[m]));
  }
  return new Set([...kinds].filter(([, k]) => k.size >= REPEAT_KINDS).map(([id]) => id));
}

/** Higher first; equal values: newer first, then id (deterministic). */
const order = <P extends BoardPost>(a: Ranked<P>, b: Ranked<P>) =>
  b.value - a.value || (a.post.postedAt === b.post.postedAt ? (a.post.id < b.post.id ? -1 : 1) : a.post.postedAt > b.post.postedAt ? -1 : 1);

export function leaderboard<P extends BoardPost>(all: P[], o: { metric: BoardMetric; format: MediaKind | null; group: BoardGroupBy; tz: string; weekStart: WeekStart; limit?: number }): Board<P> {
  const posts = all.filter((p) => p.mediaType !== 'STORY' && (o.format === null || p.mediaType === o.format));
  const repeat = repeatIds(posts);
  const ranked = posts
    .flatMap((post) => {
      const value = boardValue(o.metric, post.mediaType, post.values);
      return value === null ? [] : [{ post, value, repeat: repeat.has(post.id) }];
    })
    .sort(order);
  const q25 = ranked.length >= BOARD_MIN ? rank(ranked.map((r) => r.value).sort((a, b) => a - b), 0.25) : null;
  const groupBy = (keysOf: (p: P) => string[]): BoardGroup<P>[] => {
    const acc = new Map<string, { posts: number; ranked: Ranked<P>[] }>();
    for (const p of posts) for (const k of keysOf(p)) acc.set(k, { posts: (acc.get(k)?.posts ?? 0) + 1, ranked: acc.get(k)?.ranked ?? [] });
    for (const r of ranked) for (const k of keysOf(r.post)) acc.get(k)!.ranked.push(r); // ranked is sorted, so [0] is each group's best
    return [...acc].map(([key, g]) => {
      const med = g.ranked.length >= BOARD_MIN ? median(g.ranked.map((r) => r.value)) : null;
      return { key, posts: g.posts, n: g.ranked.length, median: med, best: g.ranked[0] ?? null, retire: med !== null && q25 !== null && med < q25 };
    });
  };
  const tagsOf = (p: P) => (p.tagIds.length ? p.tagIds : ['untagged']);
  const byMedian = (a: BoardGroup<P>, b: BoardGroup<P>) => (b.median ?? -Infinity) - (a.median ?? -Infinity) || b.n - a.n || (a.key < b.key ? -1 : 1);
  const tagGroups = groupBy(tagsOf);
  const groups =
    o.group === 'tag' ? tagGroups.sort(byMedian) : o.group === 'week' ? groupBy((p) => [bucketStart(localDay(new Date(p.postedAt), o.tz), 'week', o.weekStart)]).sort((a, b) => (a.key < b.key ? 1 : -1)) : null;
  const retire: Retire[] = [
    ...(o.format === null ? groupBy((p) => [p.mediaType]).map((g) => ({ kind: 'format' as const, g })) : []),
    ...tagGroups.filter((g) => g.key !== 'untagged').map((g) => ({ kind: 'tag' as const, g })),
  ]
    .filter(({ g }) => g.retire)
    .map(({ kind, g }) => ({ kind, key: g.key, n: g.n, median: g.median! }))
    .sort((a, b) => a.median - b.median || (a.key < b.key ? -1 : 1));
  return { metric: o.metric, posts: posts.length, n: ranked.length, q25, top: ranked.slice(0, o.limit ?? BOARD_TOP), groups, retire };
}
```

and `lib/analysis/hashtags.ts`:

```ts
// Hashtag lab of the Content tab (Plan 17a; creator-toolkit design §6): the hashtags of the account's OWN captions and
// how the posts that used each one did. Pure. Hashtags come from captionFeatures (lib/analysis/caption.ts, the one
// hashtag rule; 17c's auto-tagging reuses it). No Meta hashtag API. Guards as the caption lab: nothing below
// CAPTION_MIN_POSTS measured posts in the range, no median below CAPTION_MIN_SIDE posts of one hashtag.
import { CAPTION_MIN_POSTS, CAPTION_MIN_SIDE } from '@/lib/analysis/caption';
import { median } from '@/lib/analysis/posts';

export const HASHTAG_ROWS = 50;

export interface HashtagRow {
  tag: string; // lower case, without '#'
  posts: number;
  n: number; // measured posts (reach > 0)
  medianReach: number | null; // null below CAPTION_MIN_SIDE
  medianSaves: number | null; // over measured posts that have saves; null below CAPTION_MIN_SIDE
  lastUsed: string; // ISO of the newest post with it
}
export interface HashtagLab {
  posts: number;
  measured: number;
  withHashtags: number; // posts with at least one hashtag
  baseline: number | null; // median reach of every measured post: the line each hashtag is read against
  rows: HashtagRow[] | null; // null below CAPTION_MIN_POSTS measured posts; best median first, then most used
  more: number; // hashtags not shown (past HASHTAG_ROWS)
}

const measured = (r: number | null): r is number => typeof r === 'number' && r > 0;

export function hashtagLab(posts: { hashtags: string[]; postedAt: string; reach: number | null; saves: number | null }[]): HashtagLab {
  const reach = posts.flatMap((p) => (measured(p.reach) ? [p.reach] : []));
  const head = { posts: posts.length, measured: reach.length, withHashtags: posts.filter((p) => p.hashtags.length > 0).length, baseline: median(reach) };
  if (reach.length < CAPTION_MIN_POSTS) return { ...head, rows: null, more: 0 };
  const by = new Map<string, typeof posts>();
  for (const p of posts) for (const tag of new Set(p.hashtags)) by.set(tag, [...(by.get(tag) ?? []), p]);
  const rows = [...by].map(([tag, list]): HashtagRow => {
    const r = list.flatMap((p) => (measured(p.reach) ? [p.reach] : []));
    const s = list.flatMap((p) => (measured(p.reach) && typeof p.saves === 'number' ? [p.saves] : []));
    return {
      tag,
      posts: list.length,
      n: r.length,
      medianReach: r.length >= CAPTION_MIN_SIDE ? median(r) : null,
      medianSaves: s.length >= CAPTION_MIN_SIDE ? median(s) : null,
      lastUsed: list.reduce((m, p) => (Date.parse(p.postedAt) > Date.parse(m) ? p.postedAt : m), list[0].postedAt),
    };
  });
  rows.sort((a, b) => (b.medianReach ?? -1) - (a.medianReach ?? -1) || b.posts - a.posts || (a.tag < b.tag ? -1 : 1));
  return { ...head, rows: rows.slice(0, HASHTAG_ROWS), more: Math.max(0, rows.length - HASHTAG_ROWS) };
}
```

- [ ] **Step 4 — verify.** `npx vitest run tests/analysis-leaderboard.test.ts tests/analysis-hashtags.test.ts tests/analysis-trend.test.ts` (15 new tests pass; trend unchanged), `npx tsc --noEmit`, `npx eslint lib/analysis/leaderboard.ts lib/analysis/hashtags.ts lib/analysis/trend.ts tests/analysis-leaderboard.test.ts tests/analysis-hashtags.test.ts`.

- [ ] **Step 5 — commit.** `git add lib/analysis/leaderboard.ts lib/analysis/hashtags.ts lib/analysis/trend.ts tests/analysis-leaderboard.test.ts tests/analysis-hashtags.test.ts` → `git commit -m "feat(analysis): content leaderboards (repeat / retire) and hashtag lab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 3: cadence and splits (pure, TDD)

**Files:** Create `lib/analysis/cadence.ts`, `lib/analysis/splits.ts`, `tests/analysis-cadence.test.ts`, `tests/analysis-splits.test.ts`.

- [ ] **Step 1 — failing tests.** Write `tests/analysis-cadence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cadence, frequency, FREQ_MIN_WEEKS } from '@/lib/analysis/cadence';
import { addDays } from '@/lib/sync/time';

const RANGE = { from: '2026-10-01', to: '2026-10-28' }; // Thursday to Wednesday: 4 weeks
const base = { postDays: [] as string[], lastPostDay: null as string | null, storyDays: {} as Record<string, number>, storiesFrom: '2026-10-01', range: RANGE, today: '2026-10-28', weekStart: 'mon' as const };

describe('cadence', () => {
  it('posts per week, longest and usual gap, the "no post for N days" warning, streaks', () => {
    const c = cadence({ ...base, postDays: ['2026-10-12', '2026-10-02', '2026-10-02', '2026-10-05', '2026-10-09', '2026-10-20', '2026-09-20'], lastPostDay: '2026-10-20' });
    expect(c.posts).toBe(6); // 2026-09-20 is outside the range
    expect(c.perWeek).toBeCloseTo(1.5);
    expect(c.longestGap).toEqual({ days: 8, from: '2026-10-12', to: '2026-10-20' });
    expect(c.usualGap).toBe(3.5); // gaps 3, 4, 3, 8 between posting days (two posts on one day are one day)
    expect(c.sinceLast).toBe(8);
    expect(c.warn).toBe(true); // 8 > 2 × 3.5
    expect(c.streak).toEqual({ current: 4, best: 4 }); // the running week (from 2026-10-26) has no post yet and does not break it
  });

  it('a post in the running week counts; a range that does not end today has no current streak', () => {
    const days = ['2026-10-02', '2026-10-27'];
    expect(cadence({ ...base, postDays: days, lastPostDay: '2026-10-27' }).streak).toEqual({ current: 1, best: 1 });
    expect(cadence({ ...base, postDays: days, lastPostDay: '2026-10-27', range: { from: '2026-10-01', to: '2026-10-27' } }).streak.current).toBeNull();
  });

  it('no posts: nothing to measure, never a fake zero gap', () => {
    const c = cadence(base);
    expect([c.posts, c.perWeek, c.longestGap, c.usualGap, c.sinceLast, c.warn]).toEqual([0, 0, null, null, null, false]);
    expect(c.streak).toEqual({ current: 0, best: 0 });
  });

  it('under 5 posting days there is no usual gap and no warning', () => {
    const c = cadence({ ...base, postDays: ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07'], lastPostDay: '2026-10-07' });
    expect(c.usualGap).toBeNull();
    expect(c.warn).toBe(false);
    expect(c.sinceLast).toBe(21);
  });

  it('Story days count only from the first day Stories are known', () => {
    const c = cadence({ ...base, storyDays: { '2026-09-30': 3, '2026-10-05': 1, '2026-10-10': 2, '2026-10-11': 0, '2026-10-20': 1 }, storiesFrom: '2026-10-08' });
    expect(c.stories).toEqual({ range: { from: '2026-10-08', to: '2026-10-28' }, days: 2, perWeek: 2 / 3 });
    expect(cadence({ ...base, storiesFrom: '2026-10-29' }).stories).toBeNull();
    expect(cadence({ ...base, storiesFrom: '2020-01-01' }).stories?.range.from).toBe('2026-10-01');
  });
});

describe('frequency', () => {
  const MON = '2026-08-03'; // a Monday: 9 complete weeks to 2026-10-04
  const range = { from: MON, to: '2026-10-04' };
  const week = (i: number, n: number, reach: number | null) => Array.from({ length: n }, () => ({ day: addDays(MON, i * 7 + 1), reach }));

  it('complete weeks grouped by posts per week (5 or more is one row), median reach per post from 5 measured posts', () => {
    const posts = [0, 1, 2].flatMap((i) => week(i, 1, 100)).concat([3, 4, 5].flatMap((i) => week(i, 2, 200)), [6, 7, 8].flatMap((i) => week(i, 6, 50)));
    expect(frequency(posts, range, 'mon')).toEqual({
      weeks: 9,
      rows: [
        { perWeek: 1, weeks: 3, measured: 3, medianReach: null },
        { perWeek: 2, weeks: 3, measured: 6, medianReach: 200 },
        { perWeek: 5, weeks: 3, measured: 18, medianReach: 50 },
      ],
    });
  });

  it(`null below ${FREQ_MIN_WEEKS} complete weeks with a post; a partial week at either end is left out`, () => {
    const posts = [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => week(i, 1, 100));
    expect(frequency(posts, { from: addDays(MON, 2), to: '2026-10-04' }, 'mon')?.weeks).toBe(8); // the range starts on a Wednesday: that week is left out
    expect(frequency(posts, { from: addDays(MON, 2), to: '2026-10-03' }, 'mon')).toBeNull(); // and ends on a Saturday: 7 complete weeks
    expect(frequency(posts.slice(1), range, 'mon')?.weeks).toBe(8);
  });
});
```

and `tests/analysis-splits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bandOf, daypartAt, splitBy, SPLIT_MIN } from '@/lib/analysis/splits';

describe('daypartAt', () => {
  it('owner-timezone hour bands: night 0-5, morning 6-11, afternoon 12-17, evening 18-23', () => {
    const KL = 'Asia/Kuala_Lumpur'; // UTC+8
    expect(daypartAt('2026-10-01T21:59:00Z', KL)).toBe('night'); // 05:59
    expect(daypartAt('2026-10-01T22:00:00Z', KL)).toBe('morning'); // 06:00
    expect(daypartAt('2026-10-01T04:00:00Z', KL)).toBe('afternoon'); // 12:00
    expect(daypartAt('2026-10-01T10:00:00Z', KL)).toBe('evening'); // 18:00
    expect(daypartAt('2026-10-01T15:59:00Z', KL)).toBe('evening'); // 23:59
  });

  it('follows daylight saving time (Europe/London)', () => {
    expect(daypartAt('2026-03-28T05:30:00Z', 'Europe/London')).toBe('night'); // 05:30 GMT
    expect(daypartAt('2026-03-29T05:30:00Z', 'Europe/London')).toBe('morning'); // 06:30 BST (clocks went forward at 01:00 UTC)
    expect(daypartAt('2026-10-24T05:30:00Z', 'Europe/London')).toBe('morning'); // 06:30 BST
    expect(daypartAt('2026-10-25T05:30:00Z', 'Europe/London')).toBe('night'); // 05:30 GMT (clocks went back at 01:00 UTC)
  });
});

describe('bandOf', () => {
  it('none, short up to 125, medium up to 500, long', () => {
    expect([0, 1, 125, 126, 500, 501].map(bandOf)).toEqual(['none', 'short', 'short', 'medium', 'medium', 'long']);
  });
});

describe('splitBy', () => {
  const p = (k: string, reach: number | null) => ({ k, reach });

  it('rows in key order, empty keys left out, median only from SPLIT_MIN measured posts (reach 0 or missing is not measured)', () => {
    const posts = [...Array.from({ length: SPLIT_MIN }, (_, i) => p('b', 10 * (i + 1))), p('b', 0), p('b', null), p('a', 7)];
    expect(splitBy(posts, ['a', 'b', 'c'] as const, (x) => x.k as 'a' | 'b' | 'c')).toEqual([
      { key: 'a', posts: 1, n: 1, medianReach: null },
      { key: 'b', posts: 7, n: 5, medianReach: 30 },
    ]);
    expect(splitBy([], ['a'] as const, () => 'a')).toEqual([]);
  });
});
```

Run them: FAIL (modules not found).

- [ ] **Step 2 — implementation.** Write `lib/analysis/cadence.ts`:

```ts
// Cadence & consistency of the Content tab (Plan 17a; creator-toolkit design §6): how regularly the account posts, and
// how many posts a week went with what reach. Pure; every day is an owner-timezone 'YYYY-MM-DD'.
import { median } from '@/lib/analysis/posts';
import type { WeekStart } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { daysBetween, daysIn, weekOf, type DayRange } from '@/lib/time-scope/range';

export const GAP_WARN_FACTOR = 2; // "no post for N days" once the gap since the newest post passes 2 x the usual gap
export const GAP_MIN = 4; // gaps (5 posting days) a usual gap needs
export const FREQ_MIN_WEEKS = 8; // complete weeks with a post before "posts per week vs reach" shows (a pattern, not proof)
export const FREQ_CAP = 5; // 5 or more posts in a week are one row
export const FREQ_MIN_POSTS = 5; // measured posts a row's median needs

export interface Gap {
  days: number;
  from: string; // posting day before the gap
  to: string; // posting day after it
}
export interface Cadence {
  range: DayRange;
  posts: number;
  perWeek: number; // posts ÷ (days in the range ÷ 7)
  longestGap: Gap | null; // between two posting days of the range; null below 2 posting days
  usualGap: number | null; // median gap; null below GAP_MIN gaps
  sinceLast: number | null; // days from the newest post (any, also before the range) to today; null = never posted
  warn: boolean; // sinceLast > GAP_WARN_FACTOR × usualGap
  streak: { current: number | null; best: number }; // weeks in a row with a post; current = null when the range does not end today
  stories: { range: DayRange; days: number; perWeek: number } | null; // days with a Story, from the first day Stories are known; null = none of the range is known
}

/** Week starts covering the range, oldest first. */
function weeksOf(range: DayRange, weekStart: WeekStart): string[] {
  const out: string[] = [];
  for (let w = weekOf(range.from, weekStart).from; w <= range.to; w = addDays(w, 7)) out.push(w);
  return out;
}

/**
 * `postDays` = the owner-timezone day of every feed post in the range (any order, repeats for several posts a day);
 * `lastPostDay` = the newest feed post overall; `storyDays` = Stories per day; `storiesFrom` = the first day whose
 * Stories are known (Stories are only captured since the account was connected, and a capped read starts later).
 */
export function cadence(o: { postDays: string[]; lastPostDay: string | null; storyDays: Record<string, number>; storiesFrom: string; range: DayRange; today: string; weekStart: WeekStart }): Cadence {
  const { range } = o;
  const inRange = o.postDays.filter((d) => d >= range.from && d <= range.to);
  const days = [...new Set(inRange)].sort();
  const gaps: Gap[] = days.slice(1).map((to, i) => ({ days: daysBetween(days[i], to), from: days[i], to }));
  const longestGap = gaps.reduce<Gap | null>((m, g) => (m === null || g.days > m.days ? g : m), null);
  const usualGap = gaps.length >= GAP_MIN ? median(gaps.map((g) => g.days)) : null;
  const sinceLast = o.lastPostDay === null ? null : daysBetween(o.lastPostDay, o.today);
  const posted = new Set(days.map((d) => weekOf(d, o.weekStart).from));
  const weeks = weeksOf(range, o.weekStart);
  let best = 0;
  let run = 0;
  for (const w of weeks) {
    run = posted.has(w) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current: number | null = null;
  if (range.to === o.today) {
    let i = weeks.length - 1;
    if (i >= 0 && !posted.has(weeks[i])) i--; // the running week does not break a streak before it has ended
    current = 0;
    while (i >= 0 && posted.has(weeks[i])) {
      current++;
      i--;
    }
  }
  const storyFrom = o.storiesFrom > range.from ? o.storiesFrom : range.from;
  const storyRange = storyFrom <= range.to ? { from: storyFrom, to: range.to } : null;
  const storyCount = storyRange ? Object.entries(o.storyDays).filter(([d, n]) => n > 0 && d >= storyRange.from && d <= storyRange.to).length : 0;
  return {
    range,
    posts: inRange.length,
    perWeek: inRange.length / (daysIn(range) / 7),
    longestGap,
    usualGap,
    sinceLast,
    warn: usualGap !== null && sinceLast !== null && sinceLast > GAP_WARN_FACTOR * usualGap,
    streak: { current, best },
    stories: storyRange ? { range: storyRange, days: storyCount, perWeek: storyCount / (daysIn(storyRange) / 7) } : null,
  };
}

export interface FrequencyRow {
  perWeek: number; // posts in the week; FREQ_CAP means "FREQ_CAP or more"
  weeks: number;
  measured: number; // posts of those weeks with reach > 0
  medianReach: number | null; // null below FREQ_MIN_POSTS
}

/** Complete weeks of the range with at least one post, grouped by how many posts they had, with the median reach per post. null below FREQ_MIN_WEEKS such weeks. */
export function frequency(posts: { day: string; reach: number | null }[], range: DayRange, weekStart: WeekStart): { weeks: number; rows: FrequencyRow[] } | null {
  const full = new Set(weeksOf(range, weekStart).filter((w) => w >= range.from && addDays(w, 6) <= range.to));
  const byWeek = new Map<string, { day: string; reach: number | null }[]>();
  for (const p of posts) {
    const w = weekOf(p.day, weekStart).from;
    if (full.has(w)) byWeek.set(w, [...(byWeek.get(w) ?? []), p]);
  }
  if (byWeek.size < FREQ_MIN_WEEKS) return null;
  const rows = new Map<number, { weeks: number; reach: number[] }>();
  for (const list of byWeek.values()) {
    const k = Math.min(list.length, FREQ_CAP);
    const row = rows.get(k) ?? { weeks: 0, reach: [] };
    row.weeks++;
    row.reach.push(...list.flatMap((p) => (typeof p.reach === 'number' && p.reach > 0 ? [p.reach] : [])));
    rows.set(k, row);
  }
  return {
    weeks: byWeek.size,
    rows: [...rows]
      .sort(([a], [b]) => a - b)
      .map(([perWeek, r]) => ({ perWeek, weeks: r.weeks, measured: r.reach.length, medianReach: r.reach.length >= FREQ_MIN_POSTS ? median(r.reach) : null })),
  };
}
```

and `lib/analysis/splits.ts`:

```ts
// Formats & times of the Content tab (Plan 17a; creator-toolkit design §6 "Format & time lab"): median reach per post
// split by format, owner-timezone day-part and caption length. Pure. A median needs SPLIT_MIN measured posts.
import { median } from '@/lib/analysis/posts';
import { localHour } from '@/lib/sync/time';

export const SPLIT_MIN = 5; // measured posts (reach > 0) a median needs: the Post Lab guard

/** Owner-timezone hours: night 0-5, morning 6-11, afternoon 12-17, evening 18-23. */
export const DAYPARTS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type Daypart = (typeof DAYPARTS)[number];
/** The day-part of an instant in the owner's timezone (Intl: DST-safe). */
export const daypartAt = (iso: string, tz: string): Daypart => DAYPARTS[Math.floor(localHour(new Date(iso), tz) / 6)];

/** Caption length in characters (code points): none, short = what the feed shows before "more" (125), medium to 500, long. */
export const CAPTION_BANDS = ['none', 'short', 'medium', 'long'] as const;
export type CaptionBand = (typeof CAPTION_BANDS)[number];
export const SHORT_CAPTION = 125;
export const MEDIUM_CAPTION = 500;
export const bandOf = (chars: number): CaptionBand => (chars === 0 ? 'none' : chars <= SHORT_CAPTION ? 'short' : chars <= MEDIUM_CAPTION ? 'medium' : 'long');

export interface SplitRow<K extends string> {
  key: K;
  posts: number;
  n: number; // measured posts (reach > 0)
  medianReach: number | null; // null below SPLIT_MIN
}

/** One row per key that has posts, in the order of `keys`. */
export function splitBy<K extends string, P extends { reach: number | null }>(posts: P[], keys: readonly K[], keyOf: (p: P) => K): SplitRow<K>[] {
  return keys.flatMap((key) => {
    const list = posts.filter((p) => keyOf(p) === key);
    const reach = list.flatMap((p) => (typeof p.reach === 'number' && p.reach > 0 ? [p.reach] : []));
    return list.length ? [{ key, posts: list.length, n: reach.length, medianReach: reach.length >= SPLIT_MIN ? median(reach) : null }] : [];
  });
}
```

- [ ] **Step 3 — verify.** `npx vitest run tests/analysis-cadence.test.ts tests/analysis-splits.test.ts` (11 tests), `npx tsc --noEmit`, `npx eslint` on the four files.

- [ ] **Step 4 — commit.** `git add lib/analysis/cadence.ts lib/analysis/splits.ts tests/analysis-cadence.test.ts tests/analysis-splits.test.ts` → `git commit -m "feat(analysis): cadence, posts per week vs reach, day-part and caption-length splits" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 4: the read and the model

**Files:** Create `lib/dashboard/content-lab-read.ts`, `lib/dashboard/content-lab.ts`, `tests/content-lab.test.ts`; modify `lib/post-lab/read.ts`.

- [ ] **Step 1 — export `toValues`.** In `lib/post-lab/read.ts` (line 56) replace `function toValues(r: Row): LabValues {` with `export function toValues(r: Row): LabValues {`.

- [ ] **Step 2 — failing test.** Write `tests/content-lab.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabValues } from '@/lib/analysis/post-lab';
import { buildContentLab, contentHref, parseContentPicks } from '@/lib/dashboard/content-lab';
import { LATEST_CHUNK, loadContentLab, type ContentRow } from '@/lib/dashboard/content-lab-read';
import type { PostRow } from '@/lib/dashboard/detail-read';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const reads = vi.hoisted(() => ({ rows: [] as unknown[], stories: { days: {}, from: null } as unknown }));
vi.mock('@/lib/dashboard/detail-read', async (orig) => ({ ...(await orig<object>()), loadPostRows: vi.fn(async () => reads.rows) }));
vi.mock('@/lib/dashboard/growth-read', async (orig) => ({ ...(await orig<object>()), loadStoryDays: vi.fn(async () => reads.stories) }));

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-28';
const row = (id: string, postedAt: string, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: 1, views: null, likes: null, comments: null, shares: null, saves: null, caption: null, tagIds: [], cover: 'ok', slides: null, ...o });
const V = (o: Partial<LabValues>): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const scopeOf = (q: string) => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-09-01');

function fakeDb(answer: (ids: string[]) => { data: unknown; error: unknown }) {
  const calls: string[][] = [];
  return { calls, db: { rpc: async (name: string, a: { p_ids: string[] }) => (expect(name).toBe('post_lab_latest'), calls.push(a.p_ids), answer(a.p_ids)) } as never };
}

describe('loadContentLab', () => {
  beforeEach(() => {
    reads.stories = { days: { '2026-10-10': 1 }, from: null };
  });

  it('keeps the posts of [from, to), reads their latest KNOWN numbers by ids in chunks of 100, and the newest post overall', async () => {
    reads.rows = [row('new', '2026-10-28T20:00:00Z'), ...Array.from({ length: 150 }, (_, i) => row(`p${i}`, '2026-10-10T04:00:00+00:00')), row('old', '2026-09-01T04:00:00Z')];
    const f = fakeDb((ids) => ({ data: ids.map((id) => ({ media_id: id, reach: 10, follows: 2, profile_visits: null })), error: null }));
    const r = await loadContentLab(f.db, 'a1', '2026-09-30T16:00:00.000Z', '2026-10-28T16:00:00.000Z', KL);
    expect(r!.rows).toHaveLength(150); // 'new' is after the range, 'old' before it (dates compared as instants, not strings)
    expect(f.calls.map((c) => c.length)).toEqual([LATEST_CHUNK, 50]);
    expect(r!.rows[0].latest).toMatchObject({ reach: 10, follows: 2, profileVisits: null });
    expect(r!.lastPostAt).toBe('2026-10-28T20:00:00Z');
    expect(r!.stories).toEqual({ days: { '2026-10-10': 1 }, from: null });
  });

  it('a post without any snapshot has latest null; no posts = no call', async () => {
    reads.rows = [row('x', '2026-10-10T04:00:00Z')];
    const f = fakeDb(() => ({ data: [], error: null }));
    expect((await loadContentLab(f.db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL))!.rows[0].latest).toBeNull();
    reads.rows = [];
    const g = fakeDb(() => ({ data: [], error: null }));
    expect(await loadContentLab(g.db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).toEqual({ rows: [], lastPostAt: null, stories: reads.stories });
    expect(g.calls).toEqual([]);
  });

  it('missing function = null (needs a database update); any other error throws a fixed message', async () => {
    reads.rows = [row('x', '2026-10-10T04:00:00Z')];
    expect(await loadContentLab(fakeDb(() => ({ data: null, error: { code: 'PGRST202', message: 'secret detail' } })).db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).toBeNull();
    await expect(loadContentLab(fakeDb(() => ({ data: null, error: { code: '57014', message: 'secret detail' } })).db, 'a1', '2026-09-30T16:00:00Z', '2026-10-28T16:00:00Z', KL)).rejects.toThrow(/^content lab read: latest failed$/);
  });
});

describe('buildContentLab', () => {
  const content = (id: string, postedAt: string, latest: Partial<LabValues> | null, o: Partial<PostRow> = {}): ContentRow => ({ ...row(id, postedAt, o), latest: latest && V(latest) });
  const input = (rows: ContentRow[]) => ({ rows, lastPostAt: rows[0]?.postedAt ?? null, stories: { days: { '2026-10-05': 2, '2026-10-20': 1 }, from: null }, tags: [], connectedAt: '2026-10-15T00:00:00Z' });
  const opts = (q: string) => ({ scope: scopeOf(q), today: TODAY, tz: KL, weekStart: 'mon' as const });

  it('the range in the owner timezone; snippets only; splits, hashtags, cadence from the same posts', () => {
    const long = `${'x'.repeat(200)} #Travel`;
    const rows = [
      content('a', '2026-10-27T23:30:00Z', { reach: 300, saves: 9 }, { caption: long, mediaType: 'REELS' }), // 07:30 on 10-28 in KL
      content('b', '2026-10-01T15:30:00Z', { reach: 100 }, { caption: 'hi #travel' }), // 23:30 on 10-01
      content('c', '2026-09-28T15:30:00Z', { reach: 50 }), // 23:30 on 09-28 in KL: the day before the 30-day range
    ];
    const m = buildContentLab(input(rows), opts('from=30d'));
    expect(m.range).toEqual({ from: '2026-09-29', to: TODAY });
    expect(m.posts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(m.posts[0].caption).toHaveLength(81); // 80 characters + the ellipsis: the whole caption never reaches the browser
    expect(m.posts[0].values?.reach).toBe(300);
    expect(m.measured).toBe(2);
    expect(m.formats.map((r) => [r.key, r.posts])).toEqual([['REELS', 1], ['IMAGE', 1]]);
    expect(m.dayparts.map((r) => r.key)).toEqual(['morning', 'evening']);
    expect(m.captions.map((r) => r.key)).toEqual(['short', 'medium']);
    expect([m.hashtags.posts, m.hashtags.withHashtags, m.hashtags.rows]).toEqual([2, 2, null]);
    expect(m.cadence.posts).toBe(2);
    expect(m.cadence.stories?.range.from).toBe('2026-10-15'); // Stories are known from the connect day
    expect(m.cadence.stories?.days).toBe(1);
    expect(m.frequency).toBeNull();
  });

  it('"All time" starts at the oldest post, not the 5-year floor', () => {
    const m = buildContentLab(input([content('a', '2026-10-20T04:00:00Z', null), content('b', '2025-06-02T04:00:00Z', null)]), opts('from=all'));
    expect(m.range).toEqual({ from: '2025-06-02', to: TODAY });
    expect(buildContentLab(input([]), opts('from=all')).range).toEqual({ from: TODAY, to: TODAY });
  });
});

describe('content picks', () => {
  it('allow-listed, defaults left out of the URL, other params kept', () => {
    expect(parseContentPicks(new URLSearchParams('section=hashtags&metric=saveRate&fmt=REELS&group=tag'))).toEqual({ section: 'hashtags', metric: 'saveRate', format: 'REELS', group: 'tag' });
    expect(parseContentPicks(new URLSearchParams('section=x&metric=__proto__&fmt=STORY&group=tag&group=week'))).toEqual({ section: 'leaderboards', metric: 'reach', format: null, group: 'none' });
    const sp = new URLSearchParams('tab=content&from=90d&metric=saves');
    expect(contentHref(sp, { section: 'cadence', metric: 'reach', format: 'IMAGE', group: 'none' })).toBe('?tab=content&from=90d&section=cadence&fmt=IMAGE');
  });
});
```

Run `npx vitest run tests/content-lab.test.ts`: FAIL (modules not found).

- [ ] **Step 3 — the read.** Write `lib/dashboard/content-lab-read.ts`:

```ts
// Content tab reads (Plan 17a). OWNER SESSION client only (RLS; never the admin client). No new SQL: the feed posts of
// the range come from loadPostRows (caption, tags, cover) and their numbers from post_lab_latest (migration
// 20261026000001: the latest KNOWN value of every column, so follows and profile visits, which a busy tick can leave
// out of the newest snapshot, are not read as missing), called by ids in chunks of LATEST_CHUNK (one row per id: far
// under PostgREST's 1,000-row cap). Story days: loadStoryDays (Plan 15a). Fixed error messages only.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LabValues } from '@/lib/analysis/post-lab';
import { loadPostRows, type PostRow } from '@/lib/dashboard/detail-read';
import { loadStoryDays, type DayCounts } from '@/lib/dashboard/growth-read';
import { MISSING_FUNCTION } from '@/lib/dashboard/read';
import { toValues } from '@/lib/post-lab/read';

export const LATEST_CHUNK = 100;

export interface ContentRow extends PostRow {
  latest: LabValues | null; // null = never measured
}
export interface ContentRead {
  rows: ContentRow[]; // feed posts published in [fromIso, toIso), newest first
  lastPostAt: string | null; // the newest feed post of the account, also when it is outside the range
  stories: DayCounts; // Stories per owner-timezone day of the range
}

/** null = post_lab_latest does not exist (the migration is not applied): the tab says "needs a database update". */
export async function loadContentLab(db: SupabaseClient, accountId: string, fromIso: string, toIso: string, tz: string): Promise<ContentRead | null> {
  const [all, stories] = await Promise.all([loadPostRows(db, accountId, fromIso), loadStoryDays(db, accountId, fromIso, toIso, tz)]);
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const rows = all.filter((r) => {
    const t = Date.parse(r.postedAt);
    return t >= from && t < to;
  });
  const chunks: string[][] = [];
  for (let i = 0; i < rows.length; i += LATEST_CHUNK) chunks.push(rows.slice(i, i + LATEST_CHUNK).map((r) => r.id));
  const answers = await Promise.all(chunks.map((ids) => db.rpc('post_lab_latest', { p_ids: ids })));
  const latest = new Map<string, LabValues>();
  for (const { data, error } of answers) {
    if (error) {
      if (MISSING_FUNCTION.includes(String((error as { code?: unknown }).code))) return null;
      throw new Error('content lab read: latest failed');
    }
    for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) latest.set(String(r.media_id), toValues(r));
  }
  return { rows: rows.map((r) => ({ ...r, latest: latest.get(r.id) ?? null })), lastPostAt: all[0]?.postedAt ?? null, stories };
}
```

- [ ] **Step 4 — the model.** Write `lib/dashboard/content-lab.ts`:

```ts
// Content tab model (Plan 17a): "what works" from the account's own feed posts of the range. Pure: today/tz are inputs.
// The server builds everything that does not depend on a pick (formats & times, hashtags, cadence); the leaderboard is
// computed in the browser from `posts` (lib/analysis/leaderboard.ts) because its picks only change what is shown.
// Captions stay on the server: the browser gets an 80-character snippet per post (the cover's alt text).
import { captionFeatures } from '@/lib/analysis/caption';
import { cadence, frequency, type Cadence, type FrequencyRow } from '@/lib/analysis/cadence';
import { hashtagLab, type HashtagLab } from '@/lib/analysis/hashtags';
import { BOARD_GROUPS, BOARD_METRICS, type BoardGroupBy, type BoardMetric, type BoardPost } from '@/lib/analysis/leaderboard';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import { bandOf, CAPTION_BANDS, DAYPARTS, daypartAt, splitBy, type CaptionBand, type Daypart, type SplitRow } from '@/lib/analysis/splits';
import type { Tag } from '@/lib/analysis/types';
import { snippet, type FeedFormat } from '@/lib/dashboard/content';
import type { ContentRow } from '@/lib/dashboard/content-lab-read';
import type { CoverFields } from '@/lib/dashboard/detail-read';
import type { DayCounts } from '@/lib/dashboard/growth-read';
import type { WeekStart } from '@/lib/prefs';
import { localDay } from '@/lib/sync/time';
import type { DayRange } from '@/lib/time-scope/range';
import type { ResolvedScope } from '@/lib/time-scope/scope';

export const CONTENT_SECTIONS = ['leaderboards', 'formats', 'hashtags', 'cadence'] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];

export interface ContentPost extends BoardPost, CoverFields {
  mediaType: FeedFormat;
  caption: string | null; // snippet (80 characters), never the whole caption
}
export interface ContentLabModel {
  range: DayRange; // the days analysed ("All time": from the oldest post)
  posts: ContentPost[]; // newest first
  measured: number; // posts with reach > 0
  tags: Tag[];
  formats: SplitRow<FeedFormat>[];
  dayparts: SplitRow<Daypart>[];
  captions: SplitRow<CaptionBand>[];
  frequency: { weeks: number; rows: FrequencyRow[] } | null;
  hashtags: HashtagLab;
  cadence: Cadence;
}

export function buildContentLab(
  input: { rows: ContentRow[]; lastPostAt: string | null; stories: DayCounts; tags: Tag[]; connectedAt: string },
  o: { scope: ResolvedScope; today: string; tz: string; weekStart: WeekStart },
): ContentLabModel {
  const all = input.rows.filter((r) => r.mediaType !== 'STORY').map((r) => ({ r, day: localDay(new Date(r.postedAt), o.tz) }));
  const list = o.scope.listRange;
  const oldest = all.reduce<string | null>((m, x) => (m === null || x.day < m ? x.day : m), null);
  // "All time" reads back to the 5-year floor: start at the oldest post, so the years before it are not empty weeks
  const range = { from: o.scope.preset === 'all' ? (oldest ?? list.to) : list.from, to: list.to };
  const inRange = all.filter((x) => x.day >= range.from && x.day <= range.to);
  const rich = inRange.map(({ r, day }) => ({ r, day, f: captionFeatures(r.caption), reach: r.latest?.reach ?? null }));
  const connectDay = localDay(new Date(input.connectedAt), o.tz);
  const storiesFrom = [range.from, connectDay, input.stories.from ?? range.from].reduce((a, b) => (b > a ? b : a));
  return {
    range,
    posts: rich.map(({ r }) => ({ id: r.id, mediaType: r.mediaType as FeedFormat, postedAt: r.postedAt, tagIds: r.tagIds, values: r.latest, cover: r.cover, slides: r.slides, caption: snippet(r.caption) })),
    measured: rich.filter((x) => typeof x.reach === 'number' && x.reach > 0).length,
    tags: input.tags,
    formats: splitBy(rich, FEED_FORMATS, (x) => x.r.mediaType as FeedFormat),
    dayparts: splitBy(rich, DAYPARTS, (x) => daypartAt(x.r.postedAt, o.tz)),
    captions: splitBy(rich, CAPTION_BANDS, (x) => bandOf(x.f.length)),
    frequency: frequency(rich, range, o.weekStart),
    hashtags: hashtagLab(rich.map((x) => ({ hashtags: x.f.hashtags, postedAt: x.r.postedAt, reach: x.reach, saves: x.r.latest?.saves ?? null }))),
    cadence: cadence({
      postDays: rich.map((x) => x.day),
      lastPostDay: input.lastPostAt === null ? null : localDay(new Date(input.lastPostAt), o.tz),
      storyDays: input.stories.days,
      storiesFrom,
      range,
      today: o.today,
      weekStart: o.weekStart,
    }),
  };
}

// URL state of the tab's picks (UI standard 14: a pick that only changes what is shown is written with
// history.replaceState). Allow-listed; anything else falls back to the default and is never echoed.
export interface ContentPicks {
  section: ContentSection;
  metric: BoardMetric;
  format: FeedFormat | null; // URL key `fmt` (the Posts tab owns `format`)
  group: BoardGroupBy;
}
const pick = <T extends string>(all: readonly T[], sp: URLSearchParams, key: string): T | null => {
  const v = sp.getAll(key);
  return v.length === 1 && (all as readonly string[]).includes(v[0]) ? (v[0] as T) : null;
};
export function parseContentPicks(sp: URLSearchParams): ContentPicks {
  return { section: pick(CONTENT_SECTIONS, sp, 'section') ?? 'leaderboards', metric: pick(BOARD_METRICS, sp, 'metric') ?? 'reach', format: pick(FEED_FORMATS, sp, 'fmt'), group: pick(BOARD_GROUPS, sp, 'group') ?? 'none' };
}
/** The same URL with the picks set (defaults removed); every other parameter kept. Returns '?…'. */
export function contentHref(sp: URLSearchParams, p: ContentPicks): string {
  const q = new URLSearchParams(sp);
  const set = (k: string, v: string | null, dflt: string | null) => (v === null || v === dflt ? q.delete(k) : q.set(k, v));
  set('section', p.section, 'leaderboards');
  set('metric', p.metric, 'reach');
  set('fmt', p.format, null);
  set('group', p.group, 'none');
  return `?${q.toString()}`;
}
```

- [ ] **Step 5 — verify.** `npx vitest run tests/content-lab.test.ts tests/post-lab-read.test.ts` (6 new tests; Post Lab read unchanged), `npx tsc --noEmit`, `npx eslint lib/dashboard/content-lab-read.ts lib/dashboard/content-lab.ts lib/post-lab/read.ts tests/content-lab.test.ts`.

- [ ] **Step 6 — commit.** `git add lib/dashboard/content-lab-read.ts lib/dashboard/content-lab.ts lib/post-lab/read.ts tests/content-lab.test.ts` → `git commit -m "feat(content): Content tab read (latest known numbers by ids) and model" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 5: the tab in the account frame

**Files:** Modify `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `components/account/TabSkeleton.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`.

- [ ] **Step 1 — tests first.** In `tests/dashboard-account.test.ts` replace

```ts
  it('accepts the six tabs only; the old Audience tab and injections fall back to overview', () => {
    expect(TABS).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers']);
    expect(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers', 'audience', 'GROWTH'].map(parseTab)).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers', 'overview', 'overview']);
```

with

```ts
  it('accepts the eight tabs only; the old Audience tab and injections fall back to overview', () => {
    expect(TABS).toEqual(['overview', 'growth', 'posts', 'stories', 'content', 'comments', 'moderation', 'followers']);
    expect(['overview', 'growth', 'posts', 'stories', 'content', 'comments', 'moderation', 'followers', 'audience', 'GROWTH', 'CONTENT'].map(parseTab)).toEqual(['overview', 'growth', 'posts', 'stories', 'content', 'comments', 'moderation', 'followers', 'overview', 'overview', 'overview']);
```

In `tests/account-view.test.tsx`: (a) replace `const frame = (tab: 'overview' | 'growth' | 'posts' | 'stories' | 'comments' | 'moderation' | 'followers', q = '', children = <p>panel</p>) => (` with `const frame = (tab: 'overview' | 'growth' | 'posts' | 'stories' | 'content' | 'comments' | 'moderation' | 'followers', q = '', children = <p>panel</p>) => (`; (b) replace `expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Growth', 'Posts', 'Stories', 'Comments', 'Moderation', 'Followers']);` with `expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Growth', 'Posts', 'Stories', 'Content', 'Comments', 'Moderation', 'Followers']);`; (c) replace the end of the Growth test and of the `AccountView` describe

```tsx
    expect(screen.getByRole('tab', { name: 'Growth' })).toHaveAttribute('aria-selected', 'true');
  });
});
```

with

```tsx
    expect(screen.getByRole('tab', { name: 'Growth' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Content (Plan 17a): the range bar shows inside its panel and every range link keeps the tab', () => {
    wrap(frame('content', 'from=90d'));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('navigation', { name: en.timeScope.presets })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: en.timeScope.preset['7d'] })).toHaveAttribute('href', '?tab=content&from=7d');
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');
  });
});
```

(that `});` + `});` pair occurs once: the Growth test is the last of the describe). Run `npx vitest run tests/dashboard-account.test.ts tests/account-view.test.tsx`: FAIL (no Content tab).

- [ ] **Step 2 — `TABS`.** In `lib/dashboard/account.ts` replace `export const TABS = ['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers'] as const; // Growth: Plan 15a.` with `export const TABS = ['overview', 'growth', 'posts', 'stories', 'content', 'comments', 'moderation', 'followers'] as const; // Growth: Plan 15a. Content (Plan 17a): what works, after the post lists.` (the rest of the line's comment stays).

- [ ] **Step 3 — range bar.** In `components/account/AccountView.tsx` replace

```tsx
                {v === 'overview' || v === 'growth' ? <RangeBar scope={scope} today={today} keep={v === 'growth' ? { tab: v } : undefined} /> : null}
```

with

```tsx
                {v === 'overview' || v === 'growth' || v === 'content' ? <RangeBar scope={scope} today={today} keep={v === 'overview' ? undefined : { tab: v }} /> : null}
```

- [ ] **Step 4 — skeleton.** In `components/account/TabSkeleton.tsx` replace

```tsx
    case 'comments':
    case 'moderation':
```

with

```tsx
    case 'content':
    case 'comments':
    case 'moderation':
```

- [ ] **Step 5 — verify.** `npx vitest run tests/dashboard-account.test.ts tests/account-view.test.tsx tests/route-loading.test.tsx tests/ui-standards.test.ts`, `npx tsc --noEmit`, `npx eslint lib/dashboard/account.ts components/account/AccountView.tsx components/account/TabSkeleton.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx`.

- [ ] **Step 6 — commit.** `git add lib/dashboard/account.ts components/account/AccountView.tsx components/account/TabSkeleton.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx` → `git commit -m "feat(account): Content tab in the account frame with the range bar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 6: the Content tab UI and its wiring

**Files:** Create `components/account/ContentTab.tsx`, `tests/content-tab.test.tsx`; modify `components/shared/FilterToolbar.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`.

- [ ] **Step 1 — failing test.** Write `tests/content-tab.test.tsx`:

```tsx
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { ContentTab } from '@/components/account/ContentTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { LabValues } from '@/lib/analysis/post-lab';
import { buildContentLab } from '@/lib/dashboard/content-lab';
import type { ContentRow } from '@/lib/dashboard/content-lab-read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }), useSearchParams: () => new URLSearchParams(search.value) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const replaceState = vi.fn();
beforeEach(() => {
  search.value = '';
  replaceState.mockReset();
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window.history, 'replaceState').mockImplementation(replaceState);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-28';
const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const V = (o: Partial<LabValues>): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const row = (i: number, latest: Partial<LabValues>, caption = `Post number ${i}`): ContentRow => ({ id: `m${i}`, accountId: ID, mediaType: 'IMAGE', postedAt: `${addDays('2026-10-20', -i)}T04:00:00Z`, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, caption, tagIds: [], cover: 'pending', slides: null, latest: V(latest) });
const scope = resolveScope(parseTimeScope(new URLSearchParams('from=30d')), TODAY, '2026-01-01');
const modelOf = (rows: ContentRow[]) => buildContentLab({ rows, lastPostAt: rows[0]?.postedAt ?? null, stories: { days: {}, from: null }, tags: [], connectedAt: '2026-01-01T00:00:00Z' }, { scope, today: TODAY, tz: 'Asia/Kuala_Lumpur', weekStart: 'mon' });
// 8 posts, every 2 days from 2026-10-20 back; m0 is the star (top in reach and shares)
const rows = [row(0, { reach: 900, shares: 9, saves: 1 }, 'Star post #sunset'), ...Array.from({ length: 7 }, (_, i) => row((i + 1) * 2, { reach: 100 + i, shares: 1, saves: 1 }))];

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const c = en.pages.account.content;

describe('ContentTab', () => {
  it('without the Post Lab functions: "needs a database update"; without posts: a hint to pick a longer range', () => {
    wrap(<ContentTab model={null} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('status')).toHaveTextContent(c.notReady);
    cleanup();
    wrap(<ContentTab model={modelOf([])} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('status')).toHaveTextContent(c.empty);
  });

  it('four underline sections; the leaderboard ranks by reach, links to the Post Lab with the scope, marks "Repeat this"', () => {
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="from=30d" />);
    const list = screen.getByRole('tablist', { name: c.sections.label });
    expect(list).toHaveAttribute('data-variant', 'line');
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual([c.sections.leaderboards, c.sections.formats, c.sections.hashtags, c.sections.cadence]);
    expect(screen.getByRole('heading', { name: 'Best posts by Reach' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Star post/ });
    expect(links[0]).toHaveAttribute('href', `/accounts/${ID}/media/m0?from=30d`);
    expect(screen.getAllByText(c.repeat, { selector: '[data-slot="badge"]' }).length).toBeGreaterThan(0);
  });

  it('a pick changes what is shown and writes the URL with replaceState (no navigation)', async () => {
    const user = userEvent.setup();
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="" />);
    await user.selectOptions(screen.getByLabelText(c.metricLabel), 'profileVisits');
    expect(screen.getByRole('heading', { name: 'Best posts by Profile visits' })).toBeInTheDocument();
    expect(screen.getAllByText(c.noValues).length).toBeGreaterThan(0); // extras never captured: no ranking, never zeros
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '?metric=profileVisits');
    await user.click(screen.getByRole('tab', { name: c.sections.hashtags }));
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '?section=hashtags&metric=profileVisits');
    expect(screen.getByText(c.hashtagsFew.replace('{measured}', '8'))).toBeInTheDocument();
  });

  it('opens on the section of the URL; Cadence warns after twice the usual gap', () => {
    search.value = 'section=cadence';
    const old = [10, 12, 14, 16, 18].map((d) => row(d, { reach: 100 })); // posting days every 2 days, newest 2026-10-10: 18 days ago
    wrap(<ContentTab model={modelOf(old)} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('tab', { name: c.sections.cadence })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('No post for 18 days');
  });

  it('every section renders in Simplified Chinese', async () => {
    const user = userEvent.setup();
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="" />, 'zh-CN');
    const z = zh.pages.account.content;
    for (const s of ['formats', 'hashtags', 'cadence', 'leaderboards'] as const) {
      await user.click(screen.getByRole('tab', { name: z.sections[s] }));
      expect(screen.getByRole('tab', { name: z.sections[s] })).toHaveAttribute('aria-selected', 'true');
    }
    expect(screen.getByRole('heading', { name: '按覆盖人数排名的最佳帖子' })).toBeInTheDocument();
  });
});
```

Run it: FAIL (module not found).

- [ ] **Step 2 — `FilterSelect` view-only picks.** In `components/shared/FilterToolbar.tsx` (function `FilterSelect`, line 184) replace

```tsx
  options,
  hrefFor,
}: {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  hrefFor: (value: string) => string;
}) {
  const apply = useApply();
```

with

```tsx
  options,
  hrefFor,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  hrefFor: (value: string) => string;
  onPick?: (value: string) => void; // a view-only pick (UI standard 14): the caller writes the URL with history.replaceState, no navigation
}) {
  const apply = useApply();
```

and replace `        onChange={(e) => apply(hrefFor(e.target.value))}` with `        onChange={(e) => (onPick ? onPick(e.target.value) : apply(hrefFor(e.target.value)))}`. (The `options,\n  hrefFor,\n}: {` block occurs only in `FilterSelect`; `FilterSearch` has `placeholder,` before `hrefFor`.)

- [ ] **Step 3 — the component.** Write `components/account/ContentTab.tsx`:

```tsx
'use client';

// The Content tab (Plan 17a): "what works", from the account's own feed posts of the range. Four underline sections:
// Leaderboards, Formats and times, Hashtags, Cadence. Every pick here (section, ranking number, format, grouping) only
// changes what is shown: local state + history.replaceState (UI standard 14; GrowthTab pattern), no server round trip.
// The leaderboard runs in the browser on the model's posts (pure lib/analysis/leaderboard.ts). Every card states its
// source and sample; a missing number shows a dash with its reason, never 0.
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Database, ImageOff, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSelect, FilterToolbar } from '@/components/shared/FilterToolbar';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FREQ_CAP } from '@/lib/analysis/cadence';
import { BOARD_GROUPS, BOARD_KIND, BOARD_METRICS, leaderboard, NOT_FOR_REELS, type BoardGroup, type BoardMetric, type Ranked } from '@/lib/analysis/leaderboard';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import type { SplitRow } from '@/lib/analysis/splits';
import { CONTENT_SECTIONS, contentHref, parseContentPicks, type ContentLabModel, type ContentPicks, type ContentPost } from '@/lib/dashboard/content-lab';
import type { FeedFormat } from '@/lib/dashboard/content';
import { formatDate, formatDay, formatNumber, formatPercent } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { daysIn } from '@/lib/time-scope/range';

export function ContentTab({ model, accountId, scopeQuery }: { model: ContentLabModel | null; accountId: string; scopeQuery: string }) {
  const t = useTranslations('pages.account.content');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const search = useSearchParams();
  const [picks, setPicks] = useState<ContentPicks>(() => parseContentPicks(new URLSearchParams(search?.toString() ?? '')));

  if (!model) return <EmptyState icon={<Database aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />;
  if (model.posts.length === 0) return <EmptyState icon={<ImageOff aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} />;

  const choose = (patch: Partial<ContentPicks>) => {
    const next = { ...picks, ...patch };
    setPicks(next);
    window.history.replaceState(null, '', contentHref(new URLSearchParams(window.location.search), next));
  };
  const hrefOf = (patch: Partial<ContentPicks>) => contentHref(new URLSearchParams(search?.toString() ?? ''), { ...picks, ...patch });
  const whole = (v: number | null) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const value = (m: BoardMetric, v: number | null) => (BOARD_KIND[m] === 'percent' ? formatPercent(v, prefs) : formatNumber(v, prefs, { maximumFractionDigits: BOARD_KIND[m] === 'per1k' ? 1 : 0 }));
  const tagName = (id: string) => (id === 'untagged' ? t('untagged') : (model.tags.find((x) => x.id === id)?.name ?? '—'));
  const source = <p className="text-xs text-muted-foreground">{t('source', { from: formatDay(model.range.from, prefs), to: formatDay(model.range.to, prefs), count: model.posts.length, measured: whole(model.measured) })}</p>;
  const postCell = (p: ContentPost) => (
    <Link href={postLabHref(accountId, p.id, scopeQuery)} className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline">
      <MediaThumb media={p} badges={false} className="w-10 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate">{p.caption ?? ta(`format.${p.mediaType}`)}</span>
        <span className="text-xs text-muted-foreground">{t('postedOn', { date: formatDate(p.postedAt, prefs) })}</span>
      </span>
    </Link>
  );
  const splitTable = (title: string, rows: SplitRow<string>[], label: (k: string) => string) => (
    <ChartCard title={title} subtitle={t('splitSource')}>
      <DataTable
        rows={rows}
        rowKey={(r) => r.key}
        caption={title}
        columns={[
          { key: 'key', header: t('splitKey'), cell: (r) => label(r.key) },
          { key: 'posts', header: t('posts'), cell: (r) => whole(r.posts), align: 'right' },
          { key: 'n', header: t('measured'), cell: (r) => whole(r.n), align: 'right' },
          { key: 'median', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
        ]}
      />
    </ChartCard>
  );

  function boardPanel() {
    const { metric, format, group } = picks;
    const board = leaderboard(model!.posts, { metric, format, group, tz: prefs.timezone, weekStart: prefs.weekStart });
    const name = t(`metric.${metric}`);
    const groupName = (g: BoardGroup<ContentPost>) => (group === 'week' ? t('weekOf', { day: formatDay(g.key, prefs) }) : tagName(g.key));
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        <FilterToolbar label={t('toolbar')}>
          <FilterSelect id="content-metric" label={t('metricLabel')} value={metric} options={BOARD_METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))} hrefFor={(v) => hrefOf({ metric: v as BoardMetric })} onPick={(v) => choose({ metric: v as BoardMetric })} />
          <FilterSelect id="content-format" label={t('formatLabel')} value={format ?? ''} options={[{ value: '', label: t('allFormats') }, ...FEED_FORMATS.map((f) => ({ value: f, label: ta(`format.${f}`) }))]} hrefFor={(v) => hrefOf({ format: (v || null) as FeedFormat | null })} onPick={(v) => choose({ format: (v || null) as FeedFormat | null })} />
          <FilterSelect id="content-group" label={t('group.label')} value={group} options={BOARD_GROUPS.map((g) => ({ value: g, label: t(`group.${g}`) }))} hrefFor={(v) => hrefOf({ group: v as ContentPicks['group'] })} onPick={(v) => choose({ group: v as ContentPicks['group'] })} />
        </FilterToolbar>
        {source}
        <ChartCard title={t('boardTitle', { metric: name })} subtitle={`${t('boardSource', { n: whole(board.n), posts: whole(board.posts) })}${NOT_FOR_REELS.includes(metric) ? ` ${t('notForReels')}` : ''} ${t('repeatHint')}`}>
          {board.groups === null ? (
            <DataTable<Ranked<ContentPost>>
              rows={board.top}
              rowKey={(r) => r.post.id}
              caption={t('boardTitle', { metric: name })}
              empty={t('noValues')}
              columns={[
                { key: 'post', header: t('post'), cell: (r) => postCell(r.post) },
                { key: 'value', header: name, cell: (r) => value(metric, r.value), align: 'right' },
                { key: 'repeat', header: t('repeat'), cell: (r) => (r.repeat ? <Badge variant="secondary">{t('repeat')}</Badge> : null) },
              ]}
            />
          ) : (
            <DataTable<BoardGroup<ContentPost>>
              rows={board.groups}
              rowKey={(g) => g.key}
              caption={t('boardTitle', { metric: name })}
              empty={t('noValues')}
              columns={[
                { key: 'group', header: t(`group.${group}`), cell: groupName },
                { key: 'posts', header: t('posts'), cell: (g) => whole(g.posts), align: 'right' },
                { key: 'median', header: t('median'), cell: (g) => (g.median === null ? t('fewer') : value(metric, g.median)), align: 'right' },
                { key: 'best', header: t('best'), cell: (g) => (g.best ? postCell(g.best.post) : '—') },
              ]}
            />
          )}
        </ChartCard>
        <ChartCard title={t('retireTitle')} subtitle={t('retireSource', { value: value(metric, board.q25) })}>
          {board.retire.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('retireNone')}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {board.retire.map((r) => (
                <li key={`${r.kind}:${r.key}`} className="break-words">
                  {t('retireRow', { name: r.kind === 'format' ? ta(`format.${r.key}`) : tagName(r.key), median: value(metric, r.median), n: r.n })}
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    );
  }

  function formatsPanel() {
    const f = model!.frequency;
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {source}
        <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
          {splitTable(t('formatsTitle'), model!.formats, (k) => ta(`format.${k}`))}
          {splitTable(t('daypartsTitle'), model!.dayparts, (k) => t(`daypart.${k}`))}
          {splitTable(t('captionsTitle'), model!.captions, (k) => t(`band.${k}`))}
          <ChartCard title={t('frequencyTitle')} subtitle={f ? t('frequencySource', { weeks: f.weeks }) : t('frequencyNone')}>
            {f ? (
              <DataTable
                rows={f.rows}
                rowKey={(r) => String(r.perWeek)}
                caption={t('frequencyTitle')}
                columns={[
                  { key: 'perWeek', header: t('postsPerWeek'), cell: (r) => (r.perWeek >= FREQ_CAP ? t('perWeekCap', { count: FREQ_CAP }) : t('perWeek', { count: r.perWeek })) },
                  { key: 'weeks', header: t('weeks'), cell: (r) => whole(r.weeks), align: 'right' },
                  { key: 'median', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
                ]}
              />
            ) : null}
          </ChartCard>
        </div>
        <p className="text-sm">
          <Link href={`?tab=overview${scopeQuery ? `&${scopeQuery}` : ''}`} className="underline underline-offset-4">
            {t('bestTimeLink')}
          </Link>
        </p>
      </div>
    );
  }

  function hashtagsPanel() {
    const h = model!.hashtags;
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {source}
        <ChartCard title={t('hashtagsTitle')} subtitle={t('hashtagsSource', { withHashtags: whole(h.withHashtags), posts: whole(h.posts), baseline: whole(h.baseline) })}>
          {h.rows === null ? (
            <p className="text-sm text-muted-foreground">{t('hashtagsFew', { measured: whole(h.measured) })}</p>
          ) : (
            <>
              <DataTable
                rows={h.rows}
                rowKey={(r) => r.tag}
                caption={t('hashtagsTitle')}
                empty={t('hashtagsNone')}
                columns={[
                  { key: 'tag', header: t('hashtag'), cell: (r) => <span className="break-words">#{r.tag}</span> },
                  { key: 'posts', header: t('posts'), cell: (r) => whole(r.posts), align: 'right' },
                  { key: 'reach', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
                  { key: 'saves', header: t('medianSaves'), cell: (r) => (r.medianSaves === null ? t('fewer') : whole(r.medianSaves)), align: 'right' },
                  { key: 'last', header: t('lastUsed'), cell: (r) => formatDate(r.lastUsed, prefs) },
                ]}
              />
              {h.more > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t('hashtagsMore', { count: h.more })}</p> : null}
            </>
          )}
        </ChartCard>
      </div>
    );
  }

  function cadencePanel() {
    const c = model!.cadence;
    const days = (n: number | null) => (n === null ? '—' : t('days', { count: n }));
    const weeks = (n: number) => t('weeksCount', { count: n });
    const item = (label: string, v: string, note?: string) => (
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-lg font-medium tabular-nums">{v}</dd>
        {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
      </div>
    );
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {c.warn && c.sinceLast !== null && c.usualGap !== null ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
            {t('warn', { days: c.sinceLast, usual: formatNumber(c.usualGap, prefs, { maximumFractionDigits: 1 }) })}
          </p>
        ) : null}
        <ChartCard title={t('cadenceTitle')} subtitle={t('cadenceSource', { from: formatDay(c.range.from, prefs), to: formatDay(c.range.to, prefs), count: c.posts })}>
          <dl className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3">
            {item(t('postsPerWeek'), formatNumber(c.perWeek, prefs, { maximumFractionDigits: 1 }))}
            {item(t('longestGap'), days(c.longestGap?.days ?? null), c.longestGap ? t('gapDates', { from: formatDay(c.longestGap.from, prefs), to: formatDay(c.longestGap.to, prefs) }) : undefined)}
            {item(t('usualGap'), c.usualGap === null ? '—' : t('days', { count: c.usualGap }), c.usualGap === null ? t('usualGapFew') : undefined)}
            {item(t('sinceLast'), c.sinceLast === null ? t('never') : days(c.sinceLast))}
            {item(t('streak'), c.streak.current === null ? '—' : weeks(c.streak.current), c.streak.current === null ? t('noCurrent') : t('streakHint'))}
            {item(t('bestStreak'), weeks(c.streak.best))}
          </dl>
        </ChartCard>
        <ChartCard title={t('storyDays')}>
          <p className="text-sm">
            {c.stories ? t('storyLine', { days: c.stories.days, total: daysIn(c.stories.range), perWeek: formatNumber(c.stories.perWeek, prefs, { maximumFractionDigits: 1 }), from: formatDay(c.stories.range.from, prefs) }) : t('storyNone')}
          </p>
        </ChartCard>
      </div>
    );
  }

  const panel = { leaderboards: boardPanel, formats: formatsPanel, hashtags: hashtagsPanel, cadence: cadencePanel };
  return (
    <Tabs value={picks.section} onValueChange={(v) => choose({ section: v as ContentPicks['section'] })} className="min-w-0">
      <TabsList variant="line" aria-label={t('sections.label')}>
        {CONTENT_SECTIONS.map((s) => (
          <TabsTrigger key={s} value={s} className="flex-none">
            {t(`sections.${s}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {CONTENT_SECTIONS.map((s) => (
        <TabsContent key={s} value={s} className="min-w-0 pt-[var(--gp)]">
          {s === picks.section ? panel[s]() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 4 — wiring.** In `app/(app)/accounts/[id]/(tabs)/page.tsx`: (a) replace `import { CommentsTab, type CommentsData } from '@/components/account/CommentsTab';` with

```tsx
import { CommentsTab, type CommentsData } from '@/components/account/CommentsTab';
import { ContentTab } from '@/components/account/ContentTab';
```

(b) replace `import { buildPosts, buildStories, storyView } from '@/lib/dashboard/content';` with

```tsx
import { buildPosts, buildStories, storyView } from '@/lib/dashboard/content';
import { buildContentLab } from '@/lib/dashboard/content-lab';
import { loadContentLab } from '@/lib/dashboard/content-lab-read';
```

(c) replace `    case 'growth': {` with

```tsx
    case 'content': {
      // Plan 17a: the feed posts of the Time Scope's days with their latest KNOWN numbers (post_lab_latest); "All time"
      // reads every stored post (listRange). null = the Post Lab migration is missing: the tab says so.
      const { fromIso, toIso } = daysToIso(scope.listRange.from, scope.listRange.to, tz);
      const [read, tags] = await Promise.all([loadContentLab(db, account.id, fromIso, toIso, tz), loadTags(db)]);
      const model = read ? buildContentLab({ ...read, tags, connectedAt: account.connectedAt }, { scope, today, tz, weekStart: prefs.weekStart }) : null;
      return <ContentTab model={model} accountId={account.id} scopeQuery={scope.query} />;
    }
    case 'growth': {
```

- [ ] **Step 5 — verify.** `npx vitest run tests/content-tab.test.tsx tests/filter-toolbar.test.tsx tests/account-page.test.tsx tests/ui-standards.test.ts tests/messages.test.ts`, `npx tsc --noEmit`, `npx eslint components/account/ContentTab.tsx components/shared/FilterToolbar.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/content-tab.test.tsx`. Then by hand (`npm run dev`, any account, `?tab=content`): 360 / 768 / 1280 px, light and dark of two themes, keyboard through the sections and the three selects.

- [ ] **Step 6 — commit.** `git add components/account/ContentTab.tsx components/shared/FilterToolbar.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/content-tab.test.tsx` → `git commit -m "feat(content): Content tab (leaderboards, formats and times, hashtags, cadence)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

### Task 7: runbook and docs

**Files:** Create `docs/RUNBOOK_CONTENT.md`; modify `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md`. Docs are CRLF: Edit tool only.

- [ ] **Step 1 — runbook.** Write `docs/RUNBOOK_CONTENT.md`:

````markdown
# Runbook: Content tab (Plan 17a) — live checks

Status: code done, NOT verified live. No migration (the tab reads `post_lab_latest`, applied 2026-10-19). Do these with the owner, signed in with 2FA, on the deployed app. Report numbers and yes/no only.

## 0. Before you start
- The account has at least 20 feed posts in the last 12 months (else Hashtags shows "Needs 20 posts…": correct, but nothing to check).
- Open the account page → **Content** (after Stories). The range bar shows; "Last 30 Days" is the default.

## 1. Numbers match the Post Lab (L1: the latest-known read)
1. Leaderboards, Rank by **Reach**, range "Last 12 months": open the top post (the row links to its Post Lab). Reach on the Post Lab scorecard = reach in the row. Repeat for one Reel and one carousel.
2. Rank by **Profile visits**, then **Follows per 1,000 reach**: for an image post whose Post Lab shows profile visits / follows, the row shows the same number (never a dash while the Post Lab shows one). Reels never appear in these two rankings, and the card says Instagram does not report them for Reels.
3. Rank by **Save rate**: the row's percentage = the Post Lab's save rate.
4. Format = Reels: only Reels are listed. Group by **Tag** and **Week**: each group's best post is the highest of that group; "Week of" follows the week-start setting.

## 2. Guards and empty states
1. Range "Last 7 Days" with few posts: medians say "Under 5 posts", Hashtags says "Needs 20 posts with reach…", "Posts per week and reach" says it needs 8 complete weeks. Nothing shows 0 where a number is unknown.
2. A range with no posts: "No posts in this range".
3. Cadence: posts per week = posts in the range ÷ (days ÷ 7); the longest gap's dates are real posting days; "Since the last post" counts days to today in your timezone; the warning shows only when that is more than twice the usual gap. Story days start at the connect day for an account connected inside the range.
4. Section, Rank by, Format and Group by change the URL (`section`, `metric`, `fmt`, `group`) without the top progress bar; reload keeps them; a range change resets them.

## 3. Speed (L2)
Range "All time" on the account with the most posts: DevTools → Network → the document request → Server-Timing / total time. Expect the tab to stream within the 1.2 s budget of `docs/RUNBOOK_PERF.md` on a warm load. Record the time and the number of posts in the source line. If it is slower, note it (upgrade = a SQL rollup with a migration: a new plan, owner's go-ahead).

## 4. Phone, themes, language
1. 360 px: section tabs scroll sideways, the three selects wrap, tables become cards, no horizontal page scroll. 768 and 1280 px: the Formats and times cards sit two per row from 1024 px.
2. Light and dark of two themes: badges, warning icon and muted text readable.
3. Switch to 简体中文: every label, plural and hint is Chinese.

## Known limits (by design)
Feed posts only (Stories appear as Story days); hashtags from your captions only (not the first comment); medians from 5 posts, hashtag rows from 20 posts with reach, posts-per-week vs reach from 8 complete weeks; the best-time heatmap stays on Overview.
````

- [ ] **Step 2 — SPEC.** In `docs/SPEC.md` replace the line `## 8. UI (v1)` with:

```markdown
## 7l. Content lab (Plan 17a; creator-toolkit design §6 "Content intelligence")
Status: code done, NOT verified live (`docs/RUNBOOK_CONTENT.md`). No migration, no new SQL, no sync or Meta change.

Account page → **Content** tab (Overview, Growth, Posts, Stories, Content, Comments, Moderation, Followers) with the range bar (`keep={{ tab: 'content' }}`). It analyses the account's FEED posts published in the Time Scope's days (`listRange`; "All time" starts at the oldest post), each with its latest KNOWN numbers from `post_lab_latest` (read by ids in chunks of 100), computed with the Post Lab formulas (`LAB_METRICS`), so every number equals the post's scorecard; a missing number is never 0. Four underline sections; every pick (`section`, `metric`, `fmt`, `group`) is URL state written with `history.replaceState` (a range change resets them):
- **Leaderboards:** top 10 by reach, saves, shares, save rate, share rate, follows per 1,000 reach or profile visits (the last two not for Reels); format filter; group by tag (no tag = Untagged) or owner-timezone week, each group with posts, median (from 5 posts) and best post. **Repeat this** = top quartile (mid-rank >= 75 among >= 5 posts) in two or more kinds of number (a count and its rate are one kind). **Retire this** = a format or tag with >= 5 posts whose median is below the range's 25th percentile.
- **Formats and times:** median reach per post (from 5 posts with reach) by format, day-part (owner timezone: night 0-5, morning 6-11, afternoon 12-17, evening 18-23) and caption length (none, <= 125, <= 500, longer); posts per week vs median reach over complete weeks (from 8 such weeks with a post; "5 or more" is one row). The best-time heatmap stays on Overview (linked).
- **Hashtags:** hashtags of the owner's own captions (`captionFeatures`), per hashtag posts, median reach and saves (from 5 posts), last used; nothing below 20 posts with reach in the range; at most 50 rows.
- **Cadence:** posts per week, longest gap (between posting days), usual gap (median of >= 4 gaps), days since the newest post with a warning past 2 × the usual gap, current and best weekly streak (current only when the range ends today), Story days from the connect day.
Pure analysis: `lib/analysis/{leaderboard,hashtags,cadence,splits}.ts`; read `lib/dashboard/content-lab-read.ts`; model `lib/dashboard/content-lab.ts`. Only an 80-character caption snippet reaches the browser.

## 8. UI (v1)
```

- [ ] **Step 3 — TODO.** In `docs/TODO.md` replace the line `## 6b. Next (Plan 14/15 Settings)` with:

```markdown
## 6r. Content lab (Plan 17a)
- [x] Content tab: leaderboards (repeat / retire), formats and times, hashtags, cadence (code done; live verification pending: docs/RUNBOOK_CONTENT.md)
- [ ] RUNBOOK_CONTENT §1–§4 walked through by the owner (L1 numbers match Post Lab, L2 speed at "All time")
- Known: feed posts only (Stories as Story days); medians from 5 posts, hashtag rows from 20 posts with reach, posts-per-week vs reach from 8 complete weeks; a range change resets the tab's picks.

## 6b. Next (Plan 14/15 Settings)
```

- [ ] **Step 4 — PROGRESS.** In `docs/PROGRESS.md`: (a) after the line starting `- **16c: Data & privacy (pushed, NOT verified live).**` (and its indented continuation lines, up to the line before `Account page tabs now:`), insert `- **17a: Content lab (code done, NOT verified live; no migration).** Account tab Content (after Stories): leaderboards with repeat / retire, formats and times, hashtags, cadence; numbers from post_lab_latest. Plan: docs/superpowers/plans/2026-11-01-17a-content-lab.md. Runbook: docs/RUNBOOK_CONTENT.md.`; (b) replace `Account page tabs now: **Overview, Growth, Posts, Stories, Comments, Moderation, Followers** (the range bar shows on Overview and Growth only; list pages have their own filters).` with `Account page tabs now: **Overview, Growth, Posts, Stories, Content, Comments, Moderation, Followers** (the range bar shows on Overview, Growth and Content; list pages have their own filters).`; (c) after the line starting `9. **docs/RUNBOOK_DATA.md** (Plan 16c)` insert `10. **docs/RUNBOOK_CONTENT.md** (Plan 17a): §1 numbers match Post Lab (L1), §2 guards and empty states, §3 speed at "All time" (L2), §4 phone and themes.`; (d) after the line starting `- 16c: delete all keeps login` insert `- 17a: Content tab after Stories (the roadmap said after Growth), medians from 5 posts, hashtag rows from 20, frequency from 8 complete weeks, caption bands 125 / 500, repeat = top quarter in 2 kinds of number, retire = median below the 25th percentile with 5+ posts, picks via replaceState (a range change resets them).`

- [ ] **Step 5 — UI standards.** In `docs/UI_STANDARDS.md` rule 4 replace `Overview, account Overview and Growth, Calendar,` with `Overview, account Overview, Growth and Content, Calendar,`.

- [ ] **Step 6 — commit.** `git add docs/RUNBOOK_CONTENT.md docs/SPEC.md docs/TODO.md docs/PROGRESS.md docs/UI_STANDARDS.md` → `git commit -m "docs(content): runbook, spec, todo, progress for the Content tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

## Scratch-run result (2026-10-27, throwaway clone OUTSIDE the repo)

Every code block and every exact edit of Tasks 1-6 was applied to a fresh clone of `main` at `81054d7` in the session scratchpad (own `npm ci`; the repo's `node_modules` was never touched; disk free 26 GB). The plan's code blocks are generated from those clone files, so they are byte-identical to what was run.
- New tests: `analysis-leaderboard` 12, `analysis-hashtags` 3, `analysis-cadence` 7, `analysis-splits` 4, `content-lab` 6 (read with a fake RPC + mocked `loadPostRows` / `loadStoryDays`, the model, URL picks), `content-tab` 5 (needs-update and empty states, sections, Post Lab links with the scope, Repeat badge, a pick → `replaceState` and no ranking without extras, URL section on open, cadence warning, every section in zh-CN), plus the updated `dashboard-account` and `account-view` (Content tab, range bar `keep`). Two fixture mistakes of the first draft were fixed in the tests (a median of 6 values; a KL-midnight boundary), none in the code.
- Full suite in the clone: **309 files, 3,122 tests passed**; `tsc --noEmit` 0; `eslint` (all) 0; `next build` compiled. `tests/ui-standards.test.ts` (underline tabs, range bar file list, no `7d`-style labels), `tests/messages.test.ts` (same keys, placeholders, Chinese differs) and `tests/route-loading.test.tsx` (`it.each(TABS)` incl. `content`) green.
- **SQL (no migration):** the applied `post_lab_latest` from `supabase/migrations/20261026000001_post_lab.sql` on PGlite with 500 media × 80 snapshots: 5 calls of 100 ids → 500 rows (one per id, far under the 1,000-row cap) in 0.55 s single-threaded WASM; a media whose newest snapshot lacks `profile_visits` / `follows` returns the previous known value (the latest-known behaviour the tab relies on).
- Not run: a browser at 360 / 768 / 1280 in every theme (Task 6 Step 5, RUNBOOK §4) and anything live (L1, L2).

## Self-review

- Every roadmap 17a "In" item is covered (leaderboards with the seven metrics, format filter, group by none / tag / week, repeat / retire; formats & times with day-parts, caption bands, posts per week vs reach and the heatmap linked; hashtags with both guards; cadence with posts/week, Story days/week, longest gap, current and best streak, the 2 × median warning). "Out" items are untouched. No migration (the roadmap's condition for 17a holds).
- Type and name consistency checked by the clone's `tsc`: `BoardPost` ⊂ `ContentPost`, `ContentRow` from the read, `rank` / `toValues` exports, `FilterSelect.onPick`.
- Ponytail: four pure files of 40-110 lines, one read, one model, one component; one shared component gains one optional prop; nothing speculative.
