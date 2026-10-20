# Plan 14b: Posts and Stories — own filters, server pagination, SQL list functions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** The account page's Posts and Stories tabs get their own filters (never the range bar) and real page-numbered pagination read from the database: Posts = search (caption and tag names), posted date (Last 7 / 30 / 90 days, This year, All time, custom dates), Format, Tag, Sort (newest, most reach, best engagement and their siblings), chips and Clear all, Grid | Table kept, 24 per page in the grid and 50 in the table, sortable table headers that use the same server sort; Stories = posted date, Sort (newest, most views, highest exit rate), a measured / not measured filter, the day-grouped filmstrip paged by 7 days so a day is never split, a flat list paged by Story for the other sorts. Both open on All time, newest first. The 200-Stories cap goes away.

**Architecture:** One additive migration adds two `security invoker` SQL functions: `post_list` (filter, sort, page and total count of one account's feed posts, each with its latest snapshot and tag ids) and `story_list` (the same for Stories with their FINAL numbers — the `story_finals` idea — plus the snapshot count and views series for the returned page only). The SQL decides filter, order and page; every number shown is still computed by the existing TypeScript (`engagementRate`, a `storyView` builder shared with `buildStories`), and the SQL sort keys are the same formulas, pinned by text assertions and by a TypeScript mirror tested on the fixture the plan's dry run ran through the SQL. List state lives in the URL (`pr`/`pfrom`/`pto`, `q`, `format`, `tag`, `sort`, `page`, `measured`, `view`), parsed and serialised by pure helpers in `lib/dashboard/lists.ts`; the Time Scope params ride along untouched (switching back to Overview keeps its range) but never filter these lists. The tabs are built from Plan 14a's `FilterToolbar` pieces, a new shared `Pagination`, a shared `PostedFilter`, and a server-sort mode of `DataTable`. Without the migration the readers report "missing" and the page falls back to the capped reads with the same state applied in TypeScript, so deploying code before the migration never breaks the tabs.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, Supabase Postgres (SQL functions, RLS), `@supabase/supabase-js` owner-session client (`db.rpc`), next-intl 4, shadcn/Radix via Plan 14a's `FilterToolbar`/`ResponsiveDialog`, lucide-react, Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-20-ux-polish-and-tabs-design.md` (approved): §3 (owner decisions: Posts/Stories filters, All time newest first, pagination not "Show more", the cap lift), §4.2 "Posts tab" and "Stories tab", §5 (constraints: a NEW migration applied on the owner's go-ahead before the code that uses it), §6 step 3, §8 calls 1 (own date params, old `?from&to` ignored, links to Explorer/Post Lab carry no range), 2 (Stories sort and paging), 3 (server paging SQL, formulas not duplicated in the UI), 7 (table headers use the server sort). Plan 14a (`docs/superpowers/plans/2026-10-27-14a-ui-foundation.md`) is executed BEFORE this plan (see "Assumptions about Plan 14a"). Plan 14c (shell tabs) is independent. Project rules: `CLAUDE.md` (binding).

**Dry run:** the SQL was run on a throwaway PostgreSQL (PGlite 0.5.10 = PostgreSQL 18.6 in WASM, in a scratch folder outside the repo) — see "Dry-run result" at the end. The TypeScript was not dry-run in a clone (Plan 14a is not on `main` yet); every name was checked against `main` and against Plan 14a's "What Plan 14b consumes".

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **Two SQL functions, one call per page.** `post_list(p_account, p_from, p_to, p_q, p_format, p_tag, p_untagged, p_sort, p_asc, p_offset, p_limit)` and `story_list(p_account, p_from, p_to, p_tz, p_measured, p_sort, p_offset, p_limit)`, `language sql stable security invoker set search_path = ''`, execute for `authenticated` only (the 12b/13b pattern). Rows are numbered `n` = 1..total in the chosen order and every row carries the total (`count(*) over ()`), so one call returns the page and the "N posts" count. No new table, policy or index: `media_account_posted_idx (account_id, posted_at desc)` and the `media_metrics` primary key `(media_id, captured_at)` serve every lookup (dry-run timings below).
- **The SQL decides filter, order and page only; the numbers shown stay TypeScript.** `post_list` returns the raw latest-snapshot columns, the page maps them through the existing `rowToPost` + `buildPosts` (so `engagementRate` is computed by `lib/analysis/posts.ts` as today); `story_list` returns the final snapshot, the snapshot count and the views series, mapped through a `storyView` builder that `buildStories` now also uses (exit rate computed in one place). **Sort keys = the same formulas:** engagement = `(likes + comments + saves + shares) / reach`, missing parts as 0, null without reach > 0 or when all four parts are missing (`num_nonnulls`); reach/views = the latest snapshot's (as `loadPostRows` reads it, not the newest non-null); Story views/exit rate from the final snapshot (newest before `expires_at`, else `posted_at + 1 day`, else the newest; exit = exits ÷ views, null without views > 0 or exits). Nulls always last, ties newest first (`posted_at desc, id desc`) — the same order the client sort gave (stable on a newest-first list). Pinned three ways: the migration test asserts these exact SQL expressions; `tests/lists.test.ts` runs the TypeScript mirror (`sortPosts`, `sortStories`) on the dry-run fixture and expects the exact id orders the SQL produced in the dry run; the runbook repeats the dry-run assertions for anyone with a throwaway database.
- **Search** (`q`): trimmed, inner whitespace collapsed, at most 100 characters; matches a case-insensitive substring of the caption OR of a tag name of the post (`strpos(lower(…), lower(q)) > 0`: no LIKE pattern, so `%` and `_` are plain characters and nothing needs escaping). No accent or width folding (Open question 5).
- ⚠ **Posts sort = 4 keys × 2 directions** so the table headers can toggle: URL `sort` = `newest` (default, omitted) · `oldest` · `reach` · `reach_asc` · `views` · `views_asc` · `engagement` · `engagement_asc`. The Sort select lists all eight in full words ("Newest first", "Oldest first", "Most reach", "Least reach", "Most views", "Fewest views", "Best engagement", "Lowest engagement"). Table headers Post (date), Reach, Views, Engagement rate are links: first click = descending (date: newest), click on the active one = the other direction; Likes, Comments, Saves, Shares and Tags are not sortable (spec call 7). Open question 1.
- **Stories sort:** `newest` (default) pages by owner-timezone **days, 7 per page** (`STORY_DAYS_PER_PAGE`), every Story of those days on the page, newest day first (the filmstrip as today); `views` (most final views) and `exit` (highest exit rate) are a flat list of **48 per page** (`STORY_PAGE_SIZE`), each frame showing its date and time (spec call 2). Days are computed in SQL with the owner's timezone (`p_tz`, as `explorer_media` does), so a day of the filmstrip equals a page boundary.
- ⚠ **Page sizes:** Posts grid 24, table 50; the automatic view (no `?view`, grid on phones and table from `md`, CSS only) uses **50** — the server cannot know the width and the app is desktop-first. Open question 2.
- **URL state, separate from the Time Scope (spec call 1):** `pr` ∈ `7d` | `30d` | `90d` | `year` (omitted = All time) or custom `pfrom`/`pto` (`YYYY-MM-DD`, real days only, swapped when reversed, a missing end = All time's floor / today; custom wins over `pr`), `q`, `format`, `tag` (uuid or `untagged`), `sort`, `page` (integer ≥ 1, else 1), `measured` (`yes` | `no`, Stories), `view` (Posts, as today). Invalid values are dropped, never echoed. The old `?from&to` (and every other Time Scope key) no longer filters these lists, but the canonical Time Scope params (`scope.params`) are carried in every list link, so going back to Overview keeps its range (no silent reset). "All time" reaches back `MAX_DAYS` (1830 days, the app-wide floor of `lib/time-scope/scope.ts`); "This year" = 1 January of today's year to today; "Last 7 days" = today and the 6 days before (owner timezone).
- **Paging rules:** every filter or sort change drops `page` (back to page 1: a filter change resets the page, never another filter); Clear all removes search, dates, format, tag and measured and keeps sort, view and the scope; switching Grid | Table keeps the first visible post on screen (`page' = floor((page − 1) × size ÷ size') + 1`). A page past the end (a stale link) is re-read as page 1 by the reader and shown as page 1.
- **Links from the lists to the Explorer and the Post Lab carry no range** (spec call 1): `explorerHref(…, '')`, `postLabHref(accountId, id)`.
- **The toolbar does not remount on a filter change.** The tab's Suspense key ignores the list params (it already ignored `view`), so the search box keeps its focus and text while the next page streams; the old page stays on screen with the top progress bar running (spec §4.1 "existing loading feedback"). A tab change still re-keys the boundary and shows the skeleton.
- ⚠ **Missing migration = fallback, not an error page:** if PostgREST answers "function not found" (`PGRST202` / `42883`) the readers return `null` and the page reads as Plan 14a did — Posts: every post of the date window (`loadPostRows`, up to `MAX_ROWS`), Stories: the newest 200 of the window (`loadStories`, the existing "Showing the newest N Stories." note) — then applies the same search, filters, sort and page in TypeScript (`pagePosts`, `pageStories`). So deploying the code before the migration never breaks the tabs; the only visible difference is the Stories cap note. The TypeScript mirror stays after the migration as the tested reference of the SQL order. Open question 4.
- **`Pagination`** (`components/shared/Pagination.tsx`): `nav` with First / Previous / "Page 3 of 12" / Next / Last; links built by the caller's `hrefFor(page)` (so every other param is kept); default-size icon buttons with names (one control height); at the edges the buttons are disabled (not links); nothing rendered for one page.
- **`DataTable` server-sort mode** (`serverSort: { current, href }`): headers with an `href` are links with `aria-sort`; rows are shown in the given order; no client sort, no phone "Sort by" select, no "Show more". The existing client mode is unchanged for every other table.
- **`PostedFilter`** (`components/account/PostedFilter.tsx`, two users: Posts and Stories): a `FilterPanel` named after the current window ("All time", "Last 30 days", "1 Oct 2026 – 15 Oct 2026"; highlighted unless All time) with the quick choices as `FilterOptions` and a custom-dates GET form (`next/form`, hidden fields keep every other param; it closes the panel on submit).
- **Stories "measured"** is a `FilterSelect` ("Numbers": All Stories / Measured / Not measured (under 5 viewers)); Instagram shares no numbers below 5 viewers, so "measured" = the Story has at least one snapshot (the same rule as `buildStories`' `needs_5_viewers` reason).
- **Final snapshot lookup** = two index probes (the newest snapshot before expiry, else the newest), ordered by an explicit priority (`order by k limit 1` over a `union all`): measured 3.5× faster in the dry run than sorting every snapshot of every Story, and deterministic (no reliance on `union all` order).
- **`MISSING_FUNCTION`** (`['PGRST202', '42883']`) moves from `lib/post-lab/read.ts` to `lib/dashboard/read.ts` (second user; the Post Lab imports it).
- **No new dependencies; no Meta calls; no capture or sync changes; Time Scope URL contract unchanged.**

## Open questions for the owner (the plan implements the default shown)

1. Posts Sort lists eight orders (newest/oldest, most/least reach, most/fewest views, best/lowest engagement) so the table headers can toggle direction? **Default: yes.** Alternative: only the spec's three (+ views), headers descending only.
2. Without an explicit Grid/Table choice, 50 posts per page (the table's size; phones see 50 tiles)? **Default: yes** (desktop-first; an explicit Grid is 24).
3. Stories: 7 days per page for "Newest", 48 Stories per page for the other sorts? **Default: yes.**
4. Before the migration is applied, the tabs fall back to the capped reads (Stories: newest 200 of the chosen dates) instead of showing "needs a database update"? **Default: yes** (deploying first never breaks a core page).
5. Search is a case-insensitive substring of the caption or a tag name, no accent folding ("cafe" does not find "café")? **Default: yes** (folding needs `unaccent`, an extension).
6. Run the SQL tests on a real PostgreSQL in Vitest (would add `@electric-sql/pglite` as a devDependency)? **Default: no** — the repo's migration tests are text assertions (as 12b/13b); the dry run and the runbook cover behaviour.

## Assumptions about the current code (`main` at `1693300`, read for this plan)

- `supabase/migrations/20261015000001_sync.sql`, `20261022000001_capture_v2b.sql` (applied live): `media (id text, account_id uuid, media_type IMAGE|CAROUSEL_ALBUM|REELS|STORY, permalink, caption, posted_at, expires_at, cover_status text not null, children_count int, …)`, index `media_account_posted_idx (account_id, posted_at desc)`; `media_metrics (media_id, captured_at, reach, views, likes, comments, shares, saves, total_interactions, replies, taps_forward, taps_back, exits, …)` PK `(media_id, captured_at)`; `20261017000001_tags.sql`: `tags (id uuid, name)`, `media_tags (media_id, tag_id)` PK `(media_id, tag_id)`, all owner-only RLS; `20261024000001_explorer.sql` (applied live) rewrote the media/media_metrics/media_tags policies to the `(select public.is_owner())` InitPlan form. Every migration through `20261026000001_post_lab.sql` is applied live (docs/HANDOVER.md). `tests/migrations.test.ts` checks every migration generically; `tests/post-lab-migration.test.ts` is the model for a function migration test.
- `lib/dashboard/detail-read.ts`: `STORY_LIMIT = 200`, `loadPostRows(db, accountId, since?)` (newest `MEDIA_LIMIT` + back to `since`, paged, latest snapshot per post), `loadStories(db, accountId, fromIso, toIso)` → `{ stories: StoryRow[]; truncated }`, `PostRow`, `StoryRow`, `StorySnapshot`, `coverOf`, local `num`/`str`/`fail`, `type Row`. Both loaders are also used by `lib/export/read.ts` and `app/(app)/tags/page.tsx` (unchanged by this plan).
- `lib/dashboard/read.ts`: `MEDIA_LIMIT = 500`, `rowToPost(r)` (reads `r.media_metrics[0]`), `safeLink`, `readPages`. `lib/post-lab/read.ts` has a module-local `const MISSING_FUNCTION = ['PGRST202', '42883'];` used once (`MISSING_FUNCTION.includes(String((e as { code?: unknown }).code))`).
- `lib/dashboard/content.ts`: `PostFilters { format; tag; from; to }`, `parsePostFilters`, module-local `parseDay`, `PostsView`, `parsePostsView`, `snippet`, `PostView`, `buildPosts(rows, tags, f, tz)` (filters format/tag/day window), `StoryView`, `buildStories(stories, now)`, `storyDays(stories, tz)`, `FeedFormat`.
- `lib/analysis/posts.ts`: `engagementRate(p)`, `FEED_FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE']`. `lib/time-scope/scope.ts`: `MAX_DAYS = 1830`. `lib/sync/time.ts`: `addDays`, `dayStart`, `daysToIso(from, to, tz)` → `{ fromIso, toIso }`, `localDay`. `lib/tags.ts`: `isUuid`. `lib/format.ts`: `formatDay`, `formatNumber`. `lib/post-lab/params.ts`: `postLabHref(accountId, mediaId, query = '')`. `lib/explorer/state.ts`: `explorerHref(s, scopeQuery)`, `parseExplorerState`.
- `components/shared/DataTable.tsx`: `Column<T> { key, header, cell, sortValue?, align? }`, `sortRows`, `DataTable({ rows, columns, rowKey, caption, empty, loading, initialSort, pageSize, tile, view })` with a phone "Sort by" select and "Show more". Other users of `DataTable` keep the client mode.
- `components/account/PostsTab.tsx` (`POSTS_PAGE = 50`, a GET filter form with Apply/Reset, `ViewToggle`, `detail()` drawer, tiles, columns, Explorer and Post Lab links with the scope) and `StoriesTab.tsx` (`Frame({ s, lab })`, `StoriesTab({ stories, truncated, accountId, scope })`, `storyDays` sections) as on `main`; Plan 14a does not change either file. Tests that render them: `tests/posts-tab.test.tsx`, `posts-grid.test.tsx`, `account-drill.test.tsx` (last describe), `navigation-start.test.tsx` (the Posts form case), `post-lab-links.test.tsx` (Posts and Stories describes), `stories-filmstrip.test.tsx`, `stories-audience.test.tsx` (StoriesTab describe).
- `components/shared/NavigationProgress.tsx`: link clicks start the top bar by themselves (one capture-phase listener); `startProgress(href)` and `formHref(form)` for forms.
- `messages/*.json`: `pages.account.posts.{caption,count,empty,format,tag,all,untagged,apply,reset,…,view,grid,table}` and `pages.account.stories.{empty,emptyHint,summary,truncated,…,day}`; one stray `\r` per file (14a note).

## Assumptions about Plan 14a (executed before this plan; names from its "What Plan 14b consumes")

- `components/shared/FilterToolbar.tsx` exports `FilterToolbar({ label, children, advanced?, advancedCount?, end?, chips?, clearHref? })`, `interface FilterChip { id; label; href }`, `FilterPanel({ label, title, description?, active?, badge?, open?, onOpenChange?, children })`, `FilterOptions({ label, options: { href; label; current? }[] })` (inside a `FilterPanel` only), `FilterSelect({ id, label, value, options: FilterOption[], hrefFor })`, `interface FilterOption { value; label }`, `FilterSearch({ id, label, value, placeholder?, hrefFor })` (navigates with `replace` after `SEARCH_DEBOUNCE_MS` = 400 or Enter; blank or unchanged text never navigates — so `hrefFor('')` is reached only through a chip or Clear all), `useApply()`. They navigate with `useRouter` from `next/navigation`, so component tests mock it (copy 14a's mock line).
- i18n `filters.{advanced,advancedTitle,withCount,active,remove,clearAll,done}` exist (14a Task 1). `pages.account.stories.{empty,summary,truncated}` read "No Stories captured yet", "{count} Stories", "Showing the newest {count} Stories." (14a Task 6). `pages.account.posts.apply`/`reset`/`count` are still in the files (14a Task 9 keeps `posts.apply` because the old form uses it; this plan's Task 10 deletes the three).
- The account page after 14a Task 6: `app/(app)/accounts/[id]/(tabs)/page.tsx` has no top-level `filters`/`view`/`keep`; `TabContent`'s `case 'posts'` and `case 'stories'` read `allTime = resolveScope({ range: 'all', cmp: 'none', gran: 'auto' }, today, scope.earliest).listRange` with `loadPostRows(db, account.id, dayStart(allTime.from, tz).toISOString())` + `buildPosts(rows, tags, { ...parsePostFilters(sp), from: allTime.from, to: allTime.to }, tz)` and `daysToIso(allTime.from, allTime.to, tz)` + `loadStories`; both tabs get `scope={scope.params}`; the Suspense key is `JSON.stringify({ ...sp, view: undefined })`; `AccountView` has no `keep` prop. `tests/account-page.test.tsx` holds 14a's "Posts and Stories read All time, newest first, whatever the scope (…Plan 14b)" test, a `storiesFrom` hoisted array and a `redirect` mock. Tasks 8 and 9 replace the two `case` blocks wholesale, so small drifts in 14a's text do not matter.
- `docs/UI_STANDARDS.md` (14a Task 9) exists with rules 1–11 and the closing "**A new list page:** …" paragraph; `tests/ui-standards.test.ts` guards abbreviations in messages (values only: `Last 7 days` passes; URL values such as `pr=7d` are not messages), `<RangeBar` users (none added here), `TabsList variant="line"`, no `size="sm"` in four named files (none of them changed here), no per-component scrollbar CSS.
- **14a gap to check:** 14a Task 6 drops `AccountView`'s `keep` prop but does not list `tests/navigation-start.test.tsx`, which passes `keep={{ tab: 'overview' }}` (a type error). If it is still there when Task 9 runs, Task 9 removes that prop in the same file (listed as a deviation).

## Out of scope

The range bar, `FilterToolbar` itself and the account page restructure (Plan 14a); the shell tabs (Plan 14c); the Stories cap of the exports (`lib/export/*` keep `loadStories` and `STORY_LIMIT`; `story_list` is their upgrade path, not wired here); the Tags page; anything in the sync, the analysis formulas, the Explorer, the Post Lab (except one import line), the Time Scope URL contract; an `unaccent` search; new indexes.

## Global Constraints

- Ponytail: smallest thing that works. New shared pieces have two users each (`Pagination`: Posts + Stories; `PostedFilter`: Posts + Stories; `MISSING_FUNCTION`: Post Lab + lists). The TypeScript fallback (`pagePosts`/`pageStories`) is the tested mirror of the SQL order as well as the missing-migration path. **No new dependencies.** No new design tokens.
- TypeScript strict. No Meta metric names touched.
- DB: ONE new migration `supabase/migrations/20261027000001_post_story_lists.sql` (named after `20261026000001`; never edit applied migrations). Functions: `language sql stable security invoker set search_path = ''`, typed parameters, no dynamic SQL, text inputs only compared or passed to `strpos`/`at time zone`; `revoke execute … from public, anon; grant execute … to authenticated`. No table, policy or index change. **Implementers never apply it** (no `supabase`, `psql`, `db push`); it is applied later on the owner's go-ahead (runbook §0), and the code works before and after.
- Reads: OWNER SESSION client (`createServerSupabase`) only, under RLS; never the admin client, never `account_tokens`. Fixed error messages (`dashboard read: <op> failed`) that never echo Supabase errors. Every list read is filtered by the URL's account id (`p_account`).
- Every UI string via next-intl; ALL new keys are added by Task 2 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation); Task 10 deletes the three keys nobody uses any more. `tests/messages.test.ts` enforces parity and placeholders; `tests/ui-standards.test.ts` (14a) forbids `7d`-style labels in message VALUES (URL values are not messages).
- UI standard (`docs/UI_STANDARDS.md`, 14a): list pages use `FilterToolbar` (never the range bar); one control height per row (`size="default"`, `h-[var(--ctl)]` selects; `size="sm"` only inside the Grid | Table segmented frame); the URL is the state and picks apply at once (text after 400 ms); panels are `ResponsiveDialog`s. Theming: semantic tokens only. Responsive 360 / 768 / 1280: toolbars and pagination wrap, no sideways page scroll, CSS breakpoints only.
- Dates and numbers only via `lib/format.ts` (`formatDay`, `formatNumber`, `formatDateTime`, `formatTime`, …). Pure list logic in `lib/dashboard/lists.ts` takes `today`/`tz` as inputs (no `new Date()` there).
- Tests: Vitest timeout 20 s; jsdom 29; components that use 14a's pieces mock `next/navigation`'s `useRouter` and copy the Radix stubs block (pointer capture, `scrollIntoView`, `ResizeObserver`) from `tests/posts-tab.test.tsx`; rerun a file alone on "worker start timeout" (`tests/posts-tab.test.tsx` is known slow); never chain a commit after a piped command.
- `npm run check` passes after every wave. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **SQL order = TypeScript formulas, and RLS holds:** the sort keys (engagement, latest reach/views, final Story views and exit rate, nulls last, ties newest first) and the filters (search in caption or tag names with `%`/`_` literal, format, tag/untagged, measured, the `[from, to)` window, owner-timezone days) → Task 1 migration test (text) + the dry-run assertions (runbook §6), Task 3 "the TypeScript mirror orders the dry-run fixture exactly as the SQL did".
2. **A filter change never silently resets another filter, and nothing is hidden:** every href keeps the other list params and the scope; a filter change drops only `page`; chips remove one filter; Clear all keeps sort, view and the scope; a non-default posted window names the Posted button → Task 3 href tests, Tasks 7, 8, 9 chip / Clear all tests.
3. **Paging is honest:** "Page X of Y" and "1–50 of 1,234 posts" from the count; a day is never split across Stories pages; a stale page shows page 1; first/prev/next/last keep every param and are disabled at the edges → Tasks 3, 4, 5, 8, 9.
4. **Missing migration ≠ broken tab:** `PGRST202`/`42883` → `null` → the capped fallback with the same state applied in TypeScript; any other error → the normal error screen with fixed text → Task 4 reader tests, Tasks 8 and 9 page tests.
5. **The search box keeps focus while results stream:** the Suspense key ignores list params (the toolbar is not remounted); a tab change still shows the skeleton → Task 8 "the Suspense key ignores the list params".

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261027000001_post_story_lists.sql` (new), `tests/lists-migration.test.ts` (new) | `post_list`, `story_list`; migration lint |
| `messages/en.json`, `messages/zh-CN.json` | new keys (Task 2), three dead keys removed (Task 10) |
| `lib/dashboard/lists.ts` (new), `tests/lists.test.ts` (new) | list URL state (parse/serialise), date window, page sizes, sort mapping, the TypeScript mirror (`sortPosts`, `sortStories`, `pagePosts`, `pageStories`) |
| `lib/dashboard/content.ts`, `tests/dashboard-content.test.ts` | `parseDay` exported, `PostFilters.q`, `StoryFinal` + `storyView` (shared by `buildStories`); later `parsePostFilters` removed |
| `lib/dashboard/detail-read.ts`, `lib/dashboard/read.ts`, `lib/post-lab/read.ts`, `tests/detail-read.test.ts` | `loadPostPage`, `loadStoryPage`; `MISSING_FUNCTION` shared |
| `components/shared/Pagination.tsx` (new), `tests/pagination.test.tsx` (new) | page navigation |
| `components/shared/DataTable.tsx`, `tests/data-table-server-sort.test.tsx` (new) | server-sort mode |
| `components/account/PostedFilter.tsx` (new), `tests/posted-filter.test.tsx` (new) | the posted-date panel |
| `components/account/StoriesTab.tsx`, `tests/stories-list.test.tsx` (new), `tests/stories-filmstrip.test.tsx`, `tests/stories-audience.test.tsx`, `tests/post-lab-links.test.tsx` (Stories describe) | Stories toolbar, day pages, flat list |
| `components/account/PostsTab.tsx`, `tests/posts-tab.test.tsx`, `tests/posts-grid.test.tsx`, `tests/account-drill.test.tsx`, `tests/navigation-start.test.tsx`, `tests/post-lab-links.test.tsx` (Posts describe) | Posts toolbar, server sort and pages |
| `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/account-page.test.tsx` | wiring (Task 8 Stories + Suspense key, Task 9 Posts): parse, read (or fall back), render |
| `docs/RUNBOOK_LISTS.md` (new), `docs/UI_STANDARDS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md` | live checks, the list rules, spec section, ticks, lessons |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys; zh-CN uses full-width punctuation (`，：（）。`).

**Mocking the router in component tests** (14a's pieces call `useRouter`): `const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));` and `vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));`.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | `supabase/migrations/20261027000001_post_story_lists.sql`, `tests/lists-migration.test.ts` | 2, 3, 6 |
| 2 | i18n: every new key (additions only) | 14a (same files, merged before) | `messages/en.json`, `messages/zh-CN.json` | 1, 3, 6 |
| 3 | List state + TypeScript mirror; `storyView` | — | `lib/dashboard/lists.ts`, `lib/dashboard/content.ts`, `tests/lists.test.ts`, `tests/dashboard-content.test.ts` | 1, 2, 6 |
| 4 | Readers `loadPostPage` / `loadStoryPage`; shared `MISSING_FUNCTION` | 1 (names), 3 | `lib/dashboard/detail-read.ts`, `lib/dashboard/read.ts`, `lib/post-lab/read.ts`, `tests/detail-read.test.ts` | 5, 7 |
| 5 | `Pagination` | 2 | `components/shared/Pagination.tsx`, `tests/pagination.test.tsx` | 4, 7 |
| 6 | `DataTable` server-sort mode | — | `components/shared/DataTable.tsx`, `tests/data-table-server-sort.test.tsx` | 1, 2, 3 |
| 7 | `PostedFilter` | 2, 3, 14a Task 3 | `components/account/PostedFilter.tsx`, `tests/posted-filter.test.tsx` | 4, 5 |
| 8 | Stories tab end to end (component, page `case 'stories'`, Suspense key) | 2–5, 7 | `components/account/StoriesTab.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/stories-list.test.tsx` (new), `tests/stories-filmstrip.test.tsx`, `tests/stories-audience.test.tsx`, `tests/post-lab-links.test.tsx` (Stories describe), `tests/account-page.test.tsx` | — (wave C alone) |
| 9 | Posts tab end to end (component, page `case 'posts'`) | 2–7, 8 | `components/account/PostsTab.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/posts-tab.test.tsx`, `tests/posts-grid.test.tsx`, `tests/account-drill.test.tsx`, `tests/navigation-start.test.tsx`, `tests/post-lab-links.test.tsx` (Posts describe), `tests/account-page.test.tsx` | — (wave D alone) |
| 10 | Clean-up, docs, final check | all | `lib/dashboard/content.ts`, `tests/dashboard-content.test.ts`, `messages/en.json`, `messages/zh-CN.json`, `docs/RUNBOOK_LISTS.md`, `docs/UI_STANDARDS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md` | — |

Run order: wave A = 1, 2, 3, 6 · wave B = 4, 5, 7 · wave C = 8 · wave D = 9 · wave E = 10. Tasks in one wave touch disjoint files. Tasks 8 and 9 each change a tab's props AND its one caller (the account page) AND the page test in the same commit, so `tsc` and the suite stay green after each wave; they share `page.tsx`, `tests/account-page.test.tsx` and `tests/post-lab-links.test.tsx` (different `case` blocks / tests / describes), hence two waves. The messages are edited by Task 2 and Task 10 only; `lib/dashboard/content.ts` and `tests/dashboard-content.test.ts` by Task 3 and Task 10.

---

### Task 1: Migration `20261027000001_post_story_lists.sql` + migration test

**Files:**
- Create: `supabase/migrations/20261027000001_post_story_lists.sql`
- Test: `tests/lists-migration.test.ts` (new). `tests/migrations.test.ts` (generic rules for every migration) must keep passing.

**Interfaces:**
- Consumes: tables `media` (`id`, `account_id`, `media_type`, `permalink`, `caption`, `posted_at`, `expires_at`, `cover_status`, `children_count`), `media_metrics` (`media_id`, `captured_at`, `reach`, `views`, `likes`, `comments`, `saves`, `shares`, `total_interactions`, `replies`, `taps_forward`, `taps_back`, `exits`), `media_tags` (`media_id`, `tag_id`), `tags` (`id`, `name`) and their owner-only policies.
- Produces (exact names, argument names and columns Task 4 calls through `db.rpc`):
  - `public.post_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_format text, p_tag uuid, p_untagged boolean, p_sort text, p_asc boolean, p_offset int, p_limit int)` → `(id text, media_type text, posted_at timestamptz, permalink text, caption text, cover_status text, children_count int, reach int, views int, likes int, comments int, saves int, shares int, tag_ids uuid[], n bigint, total bigint)` — `p_sort` ∈ `date` | `reach` | `views` | `engagement` (anything else = date), `p_asc` true = ascending; `n` = position 1..total; rows `n ∈ (p_offset, p_offset + p_limit]`, ordered by `n`.
  - `public.story_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_measured boolean, p_sort text, p_offset int, p_limit int)` → `(id text, posted_at timestamptz, expires_at timestamptz, permalink text, cover_status text, captured_at timestamptz, reach int, views int, replies int, shares int, total_interactions int, taps_forward int, taps_back int, exits int, snapshots int, progression int[], n bigint, items bigint, days bigint)` — `p_sort` ∈ `newest` (page = days ranked `(p_offset, p_offset + p_limit]`) | `views` | `exit` (page = Stories `n ∈ (p_offset, p_offset + p_limit]`); `captured_at` … `exits` = the final snapshot (all null when the Story has none); `items` = Stories matching, `days` = owner-timezone days holding them.

- [ ] **Step 1: Write the failing test** — create `tests/lists-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261027000001_post_story_lists.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = { post_list: 'uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int', story_list: 'uuid, timestamptz, timestamptz, text, boolean, text, int, int' };
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('post/story list migration', () => {
  it('is additive: two functions, no tables, indexes, policies or column changes, never account_tokens', () => {
    expect(sql).not.toMatch(/\b(drop|alter|create\s+table|create\s+index|create\s+policy|insert|update|delete)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect([...sql.matchAll(/create\s+or\s+replace\s+function/gi)]).toHaveLength(2);
  });

  it.each(Object.keys(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL, one account and one window', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const [, head, body] = m!;
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).not.toMatch(/security\s+definer/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\|\||\blike\b/i); // nothing spliced into SQL text; no LIKE patterns
    expect(body).toMatch(exact('where m.account_id = p_account'));
    expect(body).toMatch(exact('and m.posted_at >= p_from and m.posted_at < p_to'));
    expect(body).toMatch(/count\(\*\)\s+over\s+\(\)/i); // the total rides on every row
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('post_list: feed posts only, the LATEST snapshot, search in caption or tag names without patterns, format/tag/untagged', () => {
    const body = fn('post_list')![2];
    expect(body).toMatch(exact("and m.media_type <> 'STORY'"));
    expect(body).toMatch(exact('where x.media_id = m.id order by x.captured_at desc limit 1')); // as loadPostRows / the tab
    expect(body).toMatch(exact("strpos(lower(coalesce(m.caption, '')), lower(p_q)) > 0"));
    expect(body).toMatch(exact('join public.tags g on g.id = t.tag_id where t.media_id = m.id and strpos(lower(g.name), lower(p_q)) > 0'));
    expect(body).toMatch(exact('(p_format is null or m.media_type = p_format)'));
    expect(body).toMatch(exact('(p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))'));
    expect(body).toMatch(exact('(p_untagged is not true or not exists (select 1 from public.media_tags t where t.media_id = m.id))'));
  });

  it('post_list: the engagement sort key is engagementRate (lib/analysis/posts.ts); nulls last both ways; ties newest first; the page', () => {
    const body = fn('post_list')![2];
    expect(body).toMatch(
      exact(`case when s.reach > 0 and num_nonnulls(s.likes, s.comments, s.saves, s.shares) > 0
             then (coalesce(s.likes, 0) + coalesce(s.comments, 0) + coalesce(s.saves, 0) + coalesce(s.shares, 0))::numeric / s.reach
        end as er`),
    );
    for (const [key, col] of [['reach', 'reach'], ['views', 'views'], ['engagement', 'er']]) {
      expect(body, key).toMatch(exact(`case when p_sort = '${key}' and p_asc is not true then f.${col} end desc nulls last`));
      expect(body, key).toMatch(exact(`case when p_sort = '${key}' and p_asc then f.${col} end asc nulls last`));
    }
    expect(body).toMatch(exact("case when p_sort = 'date' and p_asc then f.posted_at end asc, case when p_sort = 'date' and p_asc then f.id end asc, f.posted_at desc, f.id desc) as n"));
    expect(body).toMatch(exact('where r.n > p_offset and r.n <= p_offset + p_limit order by r.n'));
    expect(body).toMatch(exact('array(select t.tag_id from public.media_tags t where t.media_id = r.id order by t.tag_id)')); // tags for the page only
  });

  it('story_list: Stories only; FINAL numbers = newest snapshot before expiry, else the newest (buildStories); exit rate; measured', () => {
    const body = fn('story_list')![2];
    expect(body).toMatch(exact("and m.media_type = 'STORY'"));
    expect(body).toMatch(exact("where x.media_id = m.id and x.captured_at <= coalesce(m.expires_at, m.posted_at + interval '1 day') order by x.captured_at desc limit 1)"));
    expect(body).toMatch(exact('where x.media_id = m.id order by x.captured_at desc limit 1)) u order by u.k limit 1'));
    expect(body).toMatch(exact('case when s.exits is not null and s.views > 0 then s.exits::numeric / s.views end as exit_rate'));
    expect(body).toMatch(exact('(p_measured is null or (s.captured_at is not null) = p_measured)'));
  });

  it('story_list: owner-timezone days, newest pages by whole days, other sorts by Story; nulls last, ties newest first; series for the page only', () => {
    const body = fn('story_list')![2];
    expect(body).toMatch(exact('(m.posted_at at time zone p_tz)::date as day'));
    expect(body).toMatch(exact('dense_rank() over (order by f.day desc) as day_n'));
    expect(body).toMatch(exact("case when p_sort = 'views' then f.views end desc nulls last, case when p_sort = 'exit' then f.exit_rate end desc nulls last, f.posted_at desc, f.id desc) as n"));
    expect(body).toMatch(exact("where case when p_sort = 'newest' then r.day_n > p_offset and r.day_n <= p_offset + p_limit else r.n > p_offset and r.n <= p_offset + p_limit end"));
    expect(body).toMatch(exact('(select coalesce(max(r2.day_n), 0) from r r2) as days'));
    const [, after] = body.split(/\)\s+select\s+p\.id/i); // the final select, after the page was cut
    expect(after).toMatch(exact('array_agg(x.views order by x.captured_at) as progression'));
    expect(body.split(/\)\s+select\s+p\.id/i)[0]).not.toMatch(/array_agg/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lists-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory … 20261027000001_post_story_lists.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261027000001_post_story_lists.sql` (exactly this; it is the text the plan's dry run executed):

```sql
-- Plan 14b: one page of an account's Posts or Stories, filtered and sorted in the database. Additive (two functions,
-- nothing else). Apply BEFORE deploying the code that calls them; until then the Posts and Stories tabs fall back to
-- their capped reads (docs/RUNBOOK_LISTS.md §0), so the order is safe either way.
--
-- Both functions are `security invoker`: they run with the caller's rights, so the owner-only RLS policies of media,
-- media_metrics, media_tags and tags still apply (any other session gets no rows). Execute is revoked from public/anon
-- and granted to `authenticated` only. Inputs are typed; the text inputs are only compared (p_sort, p_format) or
-- searched with strpos (p_q: no pattern, so % and _ are plain characters), never concatenated into SQL.
-- The SQL decides filter, order and page only. The numbers shown are computed by the TypeScript from the returned
-- columns (lib/analysis/posts.ts engagementRate, lib/dashboard/content.ts storyView); the sort keys below are the same
-- formulas and are pinned by tests/lists-migration.test.ts and tests/lists.test.ts.
-- Rows are numbered 1..total in the chosen order (n); the page is n in (p_offset, p_offset + p_limit]; every row
-- carries the total, so one call returns the page and the count.

-- 1. Feed posts and Reels (no Stories) of one account posted in [p_from, p_to), each with its LATEST snapshot (as the
-- Posts tab shows it). Filters: p_q in the caption or a tag name (case-insensitive), format, tag or untagged (null /
-- false = no filter). Sort p_sort 'date' | 'reach' | 'views' | 'engagement', p_asc = ascending; nulls always last;
-- ties newest first. engagement = (likes + comments + saves + shares) / reach, missing parts as 0, null without reach
-- or when all four parts are missing (= engagementRate in lib/analysis/posts.ts).
create or replace function public.post_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_format text, p_tag uuid, p_untagged boolean, p_sort text, p_asc boolean, p_offset int, p_limit int)
returns table (id text, media_type text, posted_at timestamptz, permalink text, caption text, cover_status text, children_count int, reach int, views int, likes int, comments int, saves int, shares int, tag_ids uuid[], n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select m.id, m.media_type, m.posted_at, m.permalink, m.caption, m.cover_status, m.children_count,
           s.reach, s.views, s.likes, s.comments, s.saves, s.shares,
           case when s.reach > 0 and num_nonnulls(s.likes, s.comments, s.saves, s.shares) > 0
                then (coalesce(s.likes, 0) + coalesce(s.comments, 0) + coalesce(s.saves, 0) + coalesce(s.shares, 0))::numeric / s.reach
           end as er
      from public.media m
      left join lateral (
        select x.reach, x.views, x.likes, x.comments, x.saves, x.shares
          from public.media_metrics x
         where x.media_id = m.id
         order by x.captured_at desc
         limit 1
      ) s on true
     where m.account_id = p_account
       and m.media_type <> 'STORY'
       and m.posted_at >= p_from and m.posted_at < p_to
       and (p_format is null or m.media_type = p_format)
       and (p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))
       and (p_untagged is not true or not exists (select 1 from public.media_tags t where t.media_id = m.id))
       and (p_q is null
            or strpos(lower(coalesce(m.caption, '')), lower(p_q)) > 0
            or exists (select 1 from public.media_tags t join public.tags g on g.id = t.tag_id where t.media_id = m.id and strpos(lower(g.name), lower(p_q)) > 0))
  ),
  r as (
    select f.*,
           row_number() over (order by
             case when p_sort = 'reach' and p_asc is not true then f.reach end desc nulls last,
             case when p_sort = 'reach' and p_asc then f.reach end asc nulls last,
             case when p_sort = 'views' and p_asc is not true then f.views end desc nulls last,
             case when p_sort = 'views' and p_asc then f.views end asc nulls last,
             case when p_sort = 'engagement' and p_asc is not true then f.er end desc nulls last,
             case when p_sort = 'engagement' and p_asc then f.er end asc nulls last,
             case when p_sort = 'date' and p_asc then f.posted_at end asc,
             case when p_sort = 'date' and p_asc then f.id end asc,
             f.posted_at desc, f.id desc) as n,
           count(*) over () as total
      from f
  )
  select r.id, r.media_type, r.posted_at, r.permalink, r.caption, r.cover_status, r.children_count,
         r.reach, r.views, r.likes, r.comments, r.saves, r.shares,
         array(select t.tag_id from public.media_tags t where t.media_id = r.id order by t.tag_id),
         r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset + p_limit
   order by r.n
$$;

-- 2. Stories of one account posted in [p_from, p_to) with their FINAL numbers: the newest snapshot taken before the
-- Story expired (expires_at, else posted_at + 1 day), else the newest one (= buildStories in lib/dashboard/content.ts);
-- "measured" = it has a snapshot (Instagram shares no numbers under 5 viewers). p_measured null = all.
-- p_sort 'newest' pages by owner-timezone DAYS (p_tz): the page is the days ranked (p_offset, p_offset + p_limit],
-- newest day first, with every Story of those days, so a day is never split. 'views' (final views) and 'exit' (final
-- exits / final views, null without views) page by Story; nulls last, ties newest first.
-- The snapshot count and the views series (oldest first) are read for the returned page only.
create or replace function public.story_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_measured boolean, p_sort text, p_offset int, p_limit int)
returns table (id text, posted_at timestamptz, expires_at timestamptz, permalink text, cover_status text, captured_at timestamptz, reach int, views int, replies int, shares int, total_interactions int, taps_forward int, taps_back int, exits int, snapshots int, progression int[], n bigint, items bigint, days bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select m.id, m.posted_at, m.expires_at, m.permalink, m.cover_status,
           (m.posted_at at time zone p_tz)::date as day,
           s.captured_at, s.reach, s.views, s.replies, s.shares, s.total_interactions, s.taps_forward, s.taps_back, s.exits,
           case when s.exits is not null and s.views > 0 then s.exits::numeric / s.views end as exit_rate
      from public.media m
      left join lateral (
        select u.captured_at, u.reach, u.views, u.replies, u.shares, u.total_interactions, u.taps_forward, u.taps_back, u.exits
          from ((select 1 as k, x.captured_at, x.reach, x.views, x.replies, x.shares, x.total_interactions, x.taps_forward, x.taps_back, x.exits
                   from public.media_metrics x
                  where x.media_id = m.id and x.captured_at <= coalesce(m.expires_at, m.posted_at + interval '1 day')
                  order by x.captured_at desc
                  limit 1)
                union all
                (select 2, x.captured_at, x.reach, x.views, x.replies, x.shares, x.total_interactions, x.taps_forward, x.taps_back, x.exits
                   from public.media_metrics x
                  where x.media_id = m.id
                  order by x.captured_at desc
                  limit 1)) u
         order by u.k
         limit 1
      ) s on true
     where m.account_id = p_account
       and m.media_type = 'STORY'
       and m.posted_at >= p_from and m.posted_at < p_to
       and (p_measured is null or (s.captured_at is not null) = p_measured)
  ),
  r as (
    select f.*,
           dense_rank() over (order by f.day desc) as day_n,
           row_number() over (order by
             case when p_sort = 'views' then f.views end desc nulls last,
             case when p_sort = 'exit' then f.exit_rate end desc nulls last,
             f.posted_at desc, f.id desc) as n,
           count(*) over () as items
      from f
  ),
  p as (
    select r.*, (select coalesce(max(r2.day_n), 0) from r r2) as days
      from r
     where case when p_sort = 'newest' then r.day_n > p_offset and r.day_n <= p_offset + p_limit
                else r.n > p_offset and r.n <= p_offset + p_limit end
  )
  select p.id, p.posted_at, p.expires_at, p.permalink, p.cover_status, p.captured_at, p.reach, p.views, p.replies,
         p.shares, p.total_interactions, p.taps_forward, p.taps_back, p.exits,
         coalesce(c.snapshots, 0), coalesce(c.progression, '{}'), p.n, p.items, p.days
    from p
    left join lateral (
      select count(*)::int as snapshots, array_agg(x.views order by x.captured_at) as progression
        from public.media_metrics x
       where x.media_id = p.id
    ) c on true
   order by p.n
$$;

revoke execute on function public.post_list(uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int) from public, anon;
revoke execute on function public.story_list(uuid, timestamptz, timestamptz, text, boolean, text, int, int) from public, anon;
grant execute on function public.post_list(uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int) to authenticated;
grant execute on function public.story_list(uuid, timestamptz, timestamptz, text, boolean, text, int, int) to authenticated;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lists-migration.test.ts tests/migrations.test.ts`
Expected: PASS (9 tests in the new file; the generic suite unchanged). Do NOT apply the migration anywhere (implementer rules §7); the owner applies it later (runbook §0).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261027000001_post_story_lists.sql tests/lists-migration.test.ts
git commit -m "feat(db): post_list and story_list (filter, sort, page and count in SQL; Story final numbers)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
