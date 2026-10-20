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

### Task 2: i18n — every new key (additions only)

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts` (existing: parity, non-empty, placeholders, no copy-pasted English) and `tests/ui-standards.test.ts` (14a: no `7d`-style values) must pass.

**Interfaces:**
- Produces (exact keys later tasks read): `pagination.{label,first,previous,next,last,status}` (new top-level namespace, after `table`); `pages.account.stories.{filters,sort,sorts.{newest,views,exit},measured,measuredOptions.{all,yes,no},emptyFiltered,list}`; `pages.account.posts.{filters,search,searchChip,sort,sorts.{newest,oldest,reach,reach_asc,views,views_asc,engagement,engagement_asc},range}`; `pages.account.lists.{posted,postedWith,postedTitle,quick,presets.{7d,30d,90d,year,all},custom,from,to,show,between}` (new object after `posts`).

- [ ] **Step 1: Insert the keys** — three text edits per file (Edit tool; replace the anchor exactly; every other line stays byte-identical).

`messages/en.json`:

(a) anchor (3 lines, the end of `table` and the start of `nav`):
```json
    "showMore": "Show more"
  },
  "nav": {
```
replace with:
```json
    "showMore": "Show more"
  },
  "pagination": {
    "label": "Pages",
    "first": "First page",
    "previous": "Previous page",
    "next": "Next page",
    "last": "Last page",
    "status": "Page {page} of {pages}"
  },
  "nav": {
```
(b) anchor `        "day": "{date} · {count, plural, one {# Story} other {# Stories}}"` → replace with:
```json
        "day": "{date} · {count, plural, one {# Story} other {# Stories}}",
        "filters": "Story filters",
        "sort": "Sort",
        "sorts": { "newest": "Newest first", "views": "Most views", "exit": "Highest exit rate" },
        "measured": "Numbers",
        "measuredOptions": { "all": "All Stories", "yes": "Measured", "no": "Not measured (under 5 viewers)" },
        "emptyFiltered": "No Stories match these filters",
        "list": "Stories"
```
(c) anchor (2 lines, the end of `pages.account.posts`):
```json
        "table": "Table"
      }
```
replace with:
```json
        "table": "Table",
        "filters": "Post filters",
        "search": "Search captions and tags",
        "searchChip": "Search: {q}",
        "sort": "Sort",
        "sorts": {
          "newest": "Newest first",
          "oldest": "Oldest first",
          "reach": "Most reach",
          "reach_asc": "Least reach",
          "views": "Most views",
          "views_asc": "Fewest views",
          "engagement": "Best engagement",
          "engagement_asc": "Lowest engagement"
        },
        "range": "{first}–{last} of {total} posts"
      },
      "lists": {
        "posted": "Posted",
        "postedWith": "Posted: {range}",
        "postedTitle": "Posted date",
        "quick": "Quick dates",
        "presets": { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "year": "This year", "all": "All time" },
        "custom": "Custom dates",
        "from": "From",
        "to": "To",
        "show": "Show these dates",
        "between": "{from} – {to}"
      }
```

`messages/zh-CN.json` (same places):

(a) anchor:
```json
    "showMore": "显示更多"
  },
  "nav": {
```
replace with:
```json
    "showMore": "显示更多"
  },
  "pagination": {
    "label": "分页",
    "first": "第一页",
    "previous": "上一页",
    "next": "下一页",
    "last": "最后一页",
    "status": "第 {page} 页，共 {pages} 页"
  },
  "nav": {
```
(b) anchor `        "day": "{date} · {count, plural, other {# 条快拍}}"` → replace with:
```json
        "day": "{date} · {count, plural, other {# 条快拍}}",
        "filters": "快拍筛选",
        "sort": "排序",
        "sorts": { "newest": "最新优先", "views": "浏览最多", "exit": "退出率最高" },
        "measured": "数据",
        "measuredOptions": { "all": "全部快拍", "yes": "有数据", "no": "无数据（观看不足 5 人）" },
        "emptyFiltered": "没有符合筛选条件的快拍",
        "list": "快拍"
```
(c) anchor:
```json
        "table": "表格"
      }
```
replace with:
```json
        "table": "表格",
        "filters": "帖子筛选",
        "search": "搜索文案和标签",
        "searchChip": "搜索：{q}",
        "sort": "排序",
        "sorts": {
          "newest": "最新优先",
          "oldest": "最早优先",
          "reach": "覆盖最多",
          "reach_asc": "覆盖最少",
          "views": "浏览最多",
          "views_asc": "浏览最少",
          "engagement": "互动率最高",
          "engagement_asc": "互动率最低"
        },
        "range": "第 {first}–{last} 篇，共 {total} 篇帖子"
      },
      "lists": {
        "posted": "发布时间",
        "postedWith": "发布时间：{range}",
        "postedTitle": "发布日期",
        "quick": "快捷日期",
        "presets": { "7d": "最近 7 天", "30d": "最近 30 天", "90d": "最近 90 天", "year": "今年", "all": "全部时间" },
        "custom": "自定义日期",
        "from": "开始日期",
        "to": "结束日期",
        "show": "显示这些日期",
        "between": "{from} 至 {to}"
      }
```

- [ ] **Step 2: Run the catalog tests**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts` and `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"`
Expected: PASS; the parse prints nothing. `git diff --stat messages` shows only insertions plus the three anchor lines per file that gained a comma (`"day"` and `"table"`; the `showMore` anchor line is unchanged).

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): Posts and Stories filters, sort orders, pagination" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: List state + TypeScript mirror (`lib/dashboard/lists.ts`); `storyView` and search in `content.ts`

**Files:**
- Create: `lib/dashboard/lists.ts`, `tests/lists.test.ts`
- Modify: `lib/dashboard/content.ts`, `tests/dashboard-content.test.ts`
- Existing tests that must keep passing: `tests/dashboard-covers.test.ts`, `tests/stories-filmstrip.test.tsx`, `tests/stories-audience.test.tsx`, `tests/export-report.test.ts`, `tests/export-workbook.test.ts` (they call `buildStories`, whose output is unchanged).

**Interfaces:**
- Consumes: `FEED_FORMATS` (`lib/analysis/posts.ts`), `parsePostsView`, `storyDays`, `FeedFormat`, `PostsView`, `PostView`, `StoryView` (`content.ts`), `addDays` (`lib/sync/time.ts`), `isUuid` (`lib/tags.ts`), `MAX_DAYS` (`lib/time-scope/scope.ts`).
- Produces in `lib/dashboard/content.ts`: `export function parseDay(v: unknown): string | null` (was module-local); `PostFilters.q?: string` (buildPosts keeps posts whose WHOLE caption or one of whose tag names contains it, case-insensitive); `export interface StoryFinal extends CoverFields { id; postedAt; expiresAt: string | null; permalink: string | null; final: StorySnapshot | null; snapshots: number; progression: (number | null)[] }`; `export function storyView(s: StoryFinal, now: Date): StoryView` (the only place the exit rate is computed); `buildStories` unchanged in behaviour, now built on `storyView`.
- Produces in `lib/dashboard/lists.ts` (consumed by Tasks 4, 7, 8, 9): `LIST_PRESETS`, `ListPreset`, `ListDates`, `ALL_TIME`, `POST_SORTS`, `PostSort`, `PostSortKey`, `STORY_SORTS`, `StorySort`, `POST_GRID_PAGE` (24), `POST_TABLE_PAGE` (50), `STORY_DAYS_PER_PAGE` (7), `STORY_PAGE_SIZE` (48), `SEARCH_MAX` (100), `PostListState`, `StoryListState`, `LIST_KEYS`, `cleanSearch`, `parsePostList`, `parseStoryList`, `postListParams`, `storyListParams`, `listHref`, `postHref(s, patch, keep?)`, `storyHref(s, patch, keep?)`, `listWindow(d, today)`, `postPageSize(view)`, `storyPageSize(sort)`, `pageCount(total, size)`, `samePlace(page, from, to)`, `postSortOf(sort)`, `postSortFor(key, asc)`, `sortPosts`, `sortStories`, `pagePosts(posts, { sort, page, view })` → `{ posts, total, page }`, `pageStories(stories, state, tz)` → `{ stories, items, days, page }`.

- [ ] **Step 1: Write the failing tests** — create `tests/lists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPosts, buildStories, storyDays } from '@/lib/dashboard/content';
import type { PostRow, StoryRow } from '@/lib/dashboard/detail-read';
import {
  ALL_TIME,
  cleanSearch,
  listWindow,
  pageCount,
  pagePosts,
  pageStories,
  parsePostList,
  parseStoryList,
  postHref,
  postListParams,
  postPageSize,
  postSortFor,
  postSortOf,
  POST_SORTS,
  samePlace,
  sortPosts,
  sortStories,
  storyHref,
  storyListParams,
  storyPageSize,
  type PostListState,
  type StoryListState,
} from '@/lib/dashboard/lists';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const KL = 'Asia/Kuala_Lumpur';
const POSTS: PostListState = { dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null };
const STORIES: StoryListState = { dates: ALL_TIME, measured: null, sort: 'newest', page: 1 };

describe('parsePostList / parseStoryList', () => {
  it('defaults: All time, no search or filters, newest first, page 1, automatic view', () => {
    expect(parsePostList({})).toEqual(POSTS);
    expect(parseStoryList({})).toEqual(STORIES);
  });

  it('keeps valid values (a tag id lower-cased; custom dates win over a preset; reversed dates swapped)', () => {
    expect(parsePostList({ pr: '30d', q: '  launch   day ', format: 'REELS', tag: T1.toUpperCase(), sort: 'engagement_asc', page: '3', view: 'grid' })).toEqual({ dates: { pr: '30d', from: null, to: null }, q: 'launch day', format: 'REELS', tag: T1, sort: 'engagement_asc', page: 3, view: 'grid' });
    expect(parsePostList({ pr: '7d', pfrom: '2026-10-31', pto: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: '2026-10-31' });
    expect(parsePostList({ pfrom: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: null });
    expect(parsePostList({ tag: 'untagged' }).tag).toBe('untagged');
    expect(parseStoryList({ pr: 'year', measured: 'no', sort: 'exit', page: '2' })).toEqual({ dates: { pr: 'year', from: null, to: null }, measured: false, sort: 'exit', page: 2 });
    expect(parseStoryList({ measured: 'yes' }).measured).toBe(true);
  });

  it('drops invalid values, never echoes them; the old ?from&to are not list dates', () => {
    expect(parsePostList({ pr: '1y', pfrom: '2026-02-31', pto: '20261001', format: 'STORY', tag: "x' or 1=1", sort: 'likes', page: '0', view: 'list', from: '2026-09-01', to: '2026-09-30' })).toEqual(POSTS);
    for (const page of ['-1', 'abc', '1e3', '9999999', '2.5', ''] as const) expect(parsePostList({ page }).page, page).toBe(1);
    expect(parsePostList({ q: ['a', 'b'], format: ['REELS'] })).toEqual(POSTS);
    expect(parseStoryList({ measured: 'maybe', sort: 'reach', from: '7d' })).toEqual(STORIES);
  });

  it('search text: whitespace collapsed, at most 100 code points, emoji never split', () => {
    expect(cleanSearch(' a \n b ')).toBe('a b');
    expect([...cleanSearch('😀'.repeat(150))]).toHaveLength(100);
    expect(cleanSearch(null)).toBe('');
  });
});

describe('list links', () => {
  const keep = { from: '90d', cmp: 'yoy' }; // the page's Time Scope rides along untouched

  it('a fixed order, defaults left out, the scope last', () => {
    expect(postListParams(POSTS)).toEqual({ tab: 'posts' });
    const s: PostListState = { dates: { pr: null, from: '2026-10-01', to: '2026-10-31' }, q: '50% off', format: 'IMAGE', tag: 'untagged', sort: 'reach', page: 2, view: 'table' };
    expect(new URLSearchParams(postListParams(s, keep)).toString()).toBe('tab=posts&pfrom=2026-10-01&pto=2026-10-31&q=50%25+off&format=IMAGE&tag=untagged&sort=reach&page=2&view=table&from=90d&cmp=yoy');
    expect(new URLSearchParams(storyListParams({ dates: { pr: '7d', from: null, to: null }, measured: true, sort: 'views', page: 4 }, keep)).toString()).toBe('tab=stories&pr=7d&measured=yes&sort=views&page=4&from=90d&cmp=yoy');
  });

  it('a change goes back to page 1 and keeps every other filter; an explicit page is kept', () => {
    const s: PostListState = { ...POSTS, q: 'cat', format: 'REELS', sort: 'views', page: 5 };
    expect(postHref(s, { tag: T1 }, keep)).toBe(`?tab=posts&q=cat&format=REELS&tag=${T1}&sort=views&from=90d&cmp=yoy`);
    expect(postHref(s, { page: 6 })).toBe('?tab=posts&q=cat&format=REELS&sort=views&page=6');
    expect(storyHref({ ...STORIES, measured: false, page: 3 }, { sort: 'exit' })).toBe('?tab=stories&measured=no&sort=exit');
  });
});

describe('listWindow', () => {
  const today = '2026-10-17';
  it('presets end today; This year starts on 1 January; All time and open ends reach back MAX_DAYS', () => {
    expect(listWindow({ pr: '7d', from: null, to: null }, today)).toEqual({ from: '2026-10-11', to: today });
    expect(listWindow({ pr: '30d', from: null, to: null }, today)).toEqual({ from: '2026-09-18', to: today });
    expect(listWindow({ pr: '90d', from: null, to: null }, today)).toEqual({ from: '2026-07-20', to: today });
    expect(listWindow({ pr: 'year', from: null, to: null }, today)).toEqual({ from: '2026-01-01', to: today });
    expect(listWindow(ALL_TIME, today)).toEqual({ from: '2021-10-14', to: today }); // = the Time Scope's "all" list range
    expect(listWindow({ pr: null, from: '2026-10-01', to: null }, today)).toEqual({ from: '2026-10-01', to: today });
    expect(listWindow({ pr: null, from: null, to: '2026-01-31' }, today)).toEqual({ from: '2021-10-14', to: '2026-01-31' });
  });
});

describe('page sizes and sort keys', () => {
  it('24 in the grid, 50 in the table and the automatic view; 7 days or 48 Stories; at least one page', () => {
    expect([postPageSize('grid'), postPageSize('table'), postPageSize(null)]).toEqual([24, 50, 50]);
    expect([storyPageSize('newest'), storyPageSize('views'), storyPageSize('exit')]).toEqual([7, 48, 48]);
    expect([pageCount(0, 50), pageCount(50, 50), pageCount(51, 50)]).toEqual([1, 1, 2]);
    expect([samePlace(3, 50, 24), samePlace(3, 24, 50), samePlace(1, 24, 50)]).toEqual([5, 1, 1]); // table page 3 starts at post 101 = grid page 5; grid page 3 starts at post 49 = table page 1
  });

  it('every sort maps to a SQL key and direction and back', () => {
    for (const s of POST_SORTS) {
      const { key, asc } = postSortOf(s);
      expect(postSortFor(key, asc), s).toBe(s);
    }
    expect(postSortOf('newest')).toEqual({ key: 'date', asc: false });
    expect(postSortOf('views_asc')).toEqual({ key: 'views', asc: true });
  });
});

// The fixture of the plan's SQL dry run (latest snapshots as post_list reads them). The expected orders below are the
// orders post_list returned for it on PostgreSQL: the TypeScript mirror must agree exactly.
const row = (id: string, day: number, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: `2026-10-0${day}T10:00:00Z`, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, caption: null, tagIds: [], ...o });
const FIXTURE = [
  row('p3', 3, { likes: 1 }), // no reach
  row('p7', 7), // no snapshot
  row('p1', 1, { reach: 100, likes: 10, views: 300 }),
  row('p5', 5, { mediaType: 'REELS', reach: 50, likes: 1, saves: 2, views: 70 }), // (1 + 2) / 50
  row('p8', 8, { likes: 60, views: 6 }), // the latest snapshot has no reach (an older one had)
  row('p2', 2, { mediaType: 'REELS', reach: 0, likes: 5, views: 10 }),
  row('p6', 6, { reach: 100, likes: 10, views: 300 }), // ties p1: newest first
  row('p4', 4, { mediaType: 'CAROUSEL_ALBUM', reach: 200, views: 900 }), // reach but no interaction parts
];

describe('sortPosts / sortStories: the TypeScript mirror orders the dry-run fixture exactly as the SQL did', () => {
  const views = buildPosts(FIXTURE, [], { format: null, tag: null, from: null, to: null }, 'UTC');
  it.each([
    ['newest', ['p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2', 'p1']],
    ['oldest', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']],
    ['engagement', ['p6', 'p1', 'p5', 'p8', 'p7', 'p4', 'p3', 'p2']],
    ['engagement_asc', ['p5', 'p6', 'p1', 'p8', 'p7', 'p4', 'p3', 'p2']],
    ['reach', ['p4', 'p6', 'p1', 'p5', 'p2', 'p8', 'p7', 'p3']],
    ['reach_asc', ['p2', 'p5', 'p6', 'p1', 'p4', 'p8', 'p7', 'p3']],
    ['views', ['p4', 'p6', 'p1', 'p5', 'p2', 'p8', 'p7', 'p3']],
  ] as const)('%s', (sort, ids) => {
    expect(sortPosts(views, sort).map((p) => p.id)).toEqual(ids);
  });

  // Stories of the dry run (Kuala Lumpur days): s1 + s2 on 15 Oct, s3 13 Oct, s4 12 Oct (never measured), s5 10 Oct (no expires_at)
  const snap = (capturedAt: string, views: number, exits: number | null) => ({ capturedAt, reach: views, views, replies: null, shares: null, interactions: null, tapsForward: null, tapsBack: null, exits });
  const story = (id: string, postedAt: string, expiresAt: string | null, snapshots: ReturnType<typeof snap>[]): StoryRow => ({ id, postedAt, expiresAt, permalink: null, snapshots });
  const STORY_FIXTURE = buildStories(
    [
      story('s5', '2026-10-10T02:00:00Z', null, [snap('2026-10-11T05:00:00Z', 30, null)]), // only snapshot is after posted + 1 day: still the final
      story('s3', '2026-10-13T02:00:00Z', '2026-10-14T02:00:00Z', [snap('2026-10-13T12:00:00Z', 50, 5), snap('2026-10-14T05:00:00Z', 99, 0)]), // after expiry: ignored
      story('s1', '2026-10-14T23:30:00Z', '2026-10-15T23:30:00Z', [snap('2026-10-15T00:00:00Z', 10, 1), snap('2026-10-15T20:00:00Z', 40, 2)]),
      story('s4', '2026-10-12T02:00:00Z', '2026-10-13T02:00:00Z', []),
      story('s2', '2026-10-15T01:00:00Z', '2026-10-16T01:00:00Z', [snap('2026-10-15T02:00:00Z', 20, 4)]),
    ],
    new Date('2026-10-20T00:00:00Z'),
  );
  it.each([
    ['newest', ['s2', 's1', 's3', 's4', 's5']],
    ['views', ['s3', 's1', 's5', 's2', 's4']],
    ['exit', ['s2', 's3', 's1', 's4', 's5']],
  ] as const)('stories: %s', (sort, ids) => {
    expect(sortStories(STORY_FIXTURE, sort).map((s) => s.id)).toEqual(ids);
  });

  it('stories: measured / not measured and the counts (5 Stories on 4 days, as story_list returned)', () => {
    expect(pageStories(STORY_FIXTURE, STORIES, KL)).toMatchObject({ items: 5, days: 4, page: 1 });
    expect(pageStories(STORY_FIXTURE, { ...STORIES, measured: true }, KL).stories.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's5']);
    expect(pageStories(STORY_FIXTURE, { ...STORIES, measured: false }, KL)).toMatchObject({ items: 1, days: 1 });
    expect(pageStories(STORY_FIXTURE, { ...STORIES, sort: 'exit' }, KL).stories.map((s) => s.id)).toEqual(['s2', 's3', 's1', 's4', 's5']);
  });
});

describe('pagePosts / pageStories (the fallback before the migration)', () => {
  const many = buildPosts(
    Array.from({ length: 60 }, (_, i) => row(`m${i}`, 1, { postedAt: new Date(Date.UTC(2026, 8, 1) + i * 3_600_000).toISOString(), reach: i })),
    [],
    { format: null, tag: null, from: null, to: null },
    'UTC',
  );
  it('cuts the sorted list by the view’s page size; a page past the end is page 1', () => {
    expect(pagePosts(many, { sort: 'newest', page: 1, view: null })).toMatchObject({ total: 60, page: 1 });
    expect(pagePosts(many, { sort: 'newest', page: 2, view: null }).posts.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `m${9 - i}`));
    expect(pagePosts(many, { sort: 'reach_asc', page: 3, view: 'grid' }).posts.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `m${48 + i}`));
    expect(pagePosts(many, { sort: 'newest', page: 4, view: 'grid' })).toMatchObject({ page: 1, total: 60 });
  });

  it('Stories by newest: whole days, 7 per page, never split; other sorts: 48 Stories per page', () => {
    // 9 days, one Story on each, a second Story on the newest day
    const rows: StoryRow[] = Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, postedAt: `2026-10-${String(10 + i).padStart(2, '0')}T04:00:00Z`, expiresAt: null, permalink: null, snapshots: [] }));
    rows.push({ id: 'd8b', postedAt: '2026-10-18T06:00:00Z', expiresAt: null, permalink: null, snapshots: [] });
    const list = buildStories(rows, new Date('2026-10-20T00:00:00Z'));
    const first = pageStories(list, STORIES, KL);
    expect(first).toMatchObject({ items: 10, days: 9, page: 1 });
    expect(storyDays(first.stories, KL).map((d) => [d.day, d.stories.length])).toEqual([['2026-10-18', 2], ['2026-10-17', 1], ['2026-10-16', 1], ['2026-10-15', 1], ['2026-10-14', 1], ['2026-10-13', 1], ['2026-10-12', 1]]);
    expect(storyDays(pageStories(list, { ...STORIES, page: 2 }, KL).stories, KL).map((d) => d.day)).toEqual(['2026-10-11', '2026-10-10']);
    expect(pageStories(list, { ...STORIES, page: 3 }, KL).page).toBe(1);
    expect(pageStories(list, { ...STORIES, sort: 'views' }, KL).stories).toHaveLength(10);
  });
});
```

and in `tests/dashboard-content.test.ts` apply this patch (adds the search and `storyView` tests; the `parsePostFilters` tests stay until Task 10):

```diff
diff --git a/tests/dashboard-content.test.ts b/tests/dashboard-content.test.ts
index bb41ee6..a4d985c 100644
--- a/tests/dashboard-content.test.ts
+++ b/tests/dashboard-content.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from 'vitest';
 import type { Tag } from '@/lib/analysis/types';
-import { buildPosts, buildStories, buildTagStats, MIN_TAG_POSTS, parsePostFilters, snippet } from '@/lib/dashboard/content';
+import { buildPosts, buildStories, buildTagStats, MIN_TAG_POSTS, parsePostFilters, snippet, storyView } from '@/lib/dashboard/content';
 import type { PostRow, StoryRow, StorySnapshot } from '@/lib/dashboard/detail-read';
 
 const KL = 'Asia/Kuala_Lumpur';
@@ -63,6 +63,16 @@ describe('buildPosts', () => {
     expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, KL).map((p) => p.id)).toEqual(['b']);
     expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, 'UTC').map((p) => p.id)).toEqual([]);
   });
+
+  it('search: a case-insensitive substring of the whole caption or of a tag name (as post_list), % and _ plain', () => {
+    const f = { format: null, tag: null, from: null, to: null };
+    const long = row('d', { caption: `${'x'.repeat(120)} Sale 50%_off` }); // past the 80-character snippet
+    const all = [...rows, long];
+    expect(buildPosts(all, TAGS, { ...f, q: 'sale' }, KL).map((p) => p.id)).toEqual(['d']); // past the snippet
+    expect(buildPosts(all, TAGS, { ...f, q: 'BEHIND' }, KL).map((p) => p.id)).toEqual(['a', 'c']); // tag name
+    expect(buildPosts(all, TAGS, { ...f, q: '50%_off' }, KL).map((p) => p.id)).toEqual(['d']);
+    expect(buildPosts(all, TAGS, { ...f, q: '' }, KL)).toHaveLength(4);
+  });
 });
 
 describe('buildStories', () => {
@@ -84,6 +94,17 @@ describe('buildStories', () => {
   });
 });
 
+describe('storyView', () => {
+  it('a final row (story_list) gives exactly what buildStories derives from the snapshots', () => {
+    const NOW = new Date('2026-10-15T04:00:00Z');
+    const snaps = [snap('2026-10-13T08:30:00Z', { views: 10, exits: 1 }), snap('2026-10-14T07:30:00Z', { views: 40, exits: 4 }), snap('2026-10-14T08:30:00Z', { views: 41, exits: 9 })];
+    const head = { id: 's1', postedAt: '2026-10-13T08:00:00Z', expiresAt: '2026-10-14T08:00:00Z', permalink: null, cover: 'ok' as const };
+    const [built] = buildStories([{ ...head, snapshots: snaps }], NOW);
+    expect(storyView({ ...head, final: snaps[1], snapshots: 3, progression: [10, 40, 41] }, NOW)).toEqual(built);
+    expect(storyView({ ...head, final: null, snapshots: 0, progression: [] }, NOW)).toMatchObject({ reason: 'needs_5_viewers', exitRate: null, live: false });
+  });
+});
+
 describe('buildTagStats', () => {
   it('per-tag stats, an untagged bucket, and the few-posts guard', () => {
     const posts = [...Array.from({ length: MIN_TAG_POSTS }, (_, i) => row(`p${i}`, { tagIds: [T1], reach: 200 })), row('u1'), row('u2', { tagIds: [] }), row('t2', { tagIds: [T2] })];
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lists.test.ts tests/dashboard-content.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/dashboard/lists"`; `storyView` is not exported; the search test keeps every post.

- [ ] **Step 3: Implement**

`lib/dashboard/content.ts` — apply this patch (`git apply`, see implementer rules for patch files):

```diff
diff --git a/lib/dashboard/content.ts b/lib/dashboard/content.ts
index 19a57d3..5b09b04 100644
--- a/lib/dashboard/content.ts
+++ b/lib/dashboard/content.ts
@@ -12,12 +12,13 @@ export interface PostFilters {
   tag: string | 'untagged' | null; // a tag id (lower-case uuid), 'untagged', or no filter
   from: string | null; // 'YYYY-MM-DD' owner-timezone day, inclusive
   to: string | null;
+  q?: string; // search: a case-insensitive substring of the caption or of a tag name ('' or absent = none)
 }
 
 type Params = Record<string, string | string[] | undefined>;
 const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
 /** A real calendar day 'YYYY-MM-DD' or null: '2026-02-31' and '2026-13-01' are rejected (they do not round-trip). */
-function parseDay(v: unknown): string | null {
+export function parseDay(v: unknown): string | null {
   if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
   const t = Date.parse(`${v}T00:00:00Z`);
   return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
@@ -68,12 +69,16 @@ export interface PostView extends CoverFields {
   tags: Tag[]; // sorted by name
 }
 
+/** The search of post_list: the caption or a tag name contains `q` (already lower-case). */
+const matches = (p: PostRow, q: string, byId: Map<string, Tag>) => (p.caption ?? '').toLowerCase().includes(q) || p.tagIds.some((id) => byId.get(id)?.name.toLowerCase().includes(q) ?? false);
+
 export function buildPosts(rows: PostRow[], tags: Tag[], f: PostFilters, tz: string): PostView[] {
   const byId = new Map(tags.map((t) => [t.id, t]));
   return rows
     .filter((p) => p.mediaType !== 'STORY')
     .filter((p) => !f.format || p.mediaType === f.format)
     .filter((p) => (f.tag === null ? true : f.tag === 'untagged' ? p.tagIds.length === 0 : p.tagIds.includes(f.tag)))
+    .filter((p) => !f.q || matches(p, f.q.toLowerCase(), byId))
     .filter((p) => {
       if (!f.from && !f.to) return true;
       const day = localDay(new Date(p.postedAt), tz);
@@ -115,24 +120,42 @@ export interface StoryView extends CoverFields {
 
 const DAY_MS = 86_400_000;
 
+/** A Story with its final snapshot already chosen: what story_list returns, and what buildStories derives from the snapshots. */
+export interface StoryFinal extends CoverFields {
+  id: string;
+  postedAt: string;
+  expiresAt: string | null;
+  permalink: string | null;
+  final: StorySnapshot | null; // null = Instagram never shared numbers (under 5 viewers)
+  snapshots: number;
+  progression: (number | null)[]; // views per snapshot, oldest first
+}
+
+const expiryOf = (s: { postedAt: string; expiresAt: string | null }) => (s.expiresAt ? Date.parse(s.expiresAt) : Date.parse(s.postedAt) + DAY_MS);
+
+/** The Stories tab's view of one Story; the exit rate lives here only (SPEC section 7). */
+export function storyView(s: StoryFinal, now: Date): StoryView {
+  const views = s.final?.views ?? null;
+  return {
+    id: s.id,
+    postedAt: s.postedAt,
+    permalink: s.permalink,
+    cover: s.cover,
+    live: now.getTime() < expiryOf(s),
+    final: s.final,
+    exitRate: s.final && s.final.exits !== null && views !== null && views > 0 ? s.final.exits / views : null,
+    progression: s.progression,
+    snapshots: s.snapshots,
+    reason: s.final ? null : 'needs_5_viewers',
+  };
+}
+
+/** final = the last snapshot before expiry, else the last one (the same rule as story_list in SQL). */
 export function buildStories(stories: StoryRow[], now: Date): StoryView[] {
   return stories.map((s) => {
-    const expires = s.expiresAt ? Date.parse(s.expiresAt) : Date.parse(s.postedAt) + DAY_MS;
-    const before = s.snapshots.filter((x) => Date.parse(x.capturedAt) <= expires);
+    const before = s.snapshots.filter((x) => Date.parse(x.capturedAt) <= expiryOf(s));
     const final = before[before.length - 1] ?? s.snapshots[s.snapshots.length - 1] ?? null;
-    const views = final?.views ?? null;
-    return {
-      id: s.id,
-      postedAt: s.postedAt,
-      permalink: s.permalink,
-      cover: s.cover,
-      live: now.getTime() < expires,
-      final,
-      exitRate: final && final.exits !== null && views !== null && views > 0 ? final.exits / views : null,
-      progression: s.snapshots.map((x) => x.views),
-      snapshots: s.snapshots.length,
-      reason: final ? null : 'needs_5_viewers',
-    };
+    return storyView({ id: s.id, postedAt: s.postedAt, expiresAt: s.expiresAt, permalink: s.permalink, cover: s.cover, final, snapshots: s.snapshots.length, progression: s.snapshots.map((x) => x.views) }, now);
   });
 }
 
```

`lib/dashboard/lists.ts` — create with exactly this content:

```ts
// Posts and Stories tab lists (ux-polish design §4.2, §8 calls 1–3): the URL state, the posted-date window, page sizes
// and the TypeScript mirror of the SQL order (post_list / story_list, supabase/migrations/20261027000001_post_story_lists.sql).
// The mirror serves the tabs while that migration is not applied and is the tested reference of the SQL order
// (tests/lists.test.ts uses the fixture the plan's dry run ran through the SQL). Pure: today and tz are inputs.
import { FEED_FORMATS } from '@/lib/analysis/posts';
import { parseDay, parsePostsView, storyDays, type FeedFormat, type PostsView, type PostView, type StoryView } from '@/lib/dashboard/content';
import { addDays } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';
import { MAX_DAYS } from '@/lib/time-scope/scope';

type Params = Record<string, string | string[] | undefined>;

export const LIST_PRESETS = ['7d', '30d', '90d', 'year'] as const;
export type ListPreset = (typeof LIST_PRESETS)[number];
/** The posted-date filter: a preset, custom days (either end may be open), or neither = All time. */
export interface ListDates {
  pr: ListPreset | null;
  from: string | null;
  to: string | null;
}
export const ALL_TIME: ListDates = { pr: null, from: null, to: null };

export const POST_SORTS = ['newest', 'oldest', 'reach', 'reach_asc', 'views', 'views_asc', 'engagement', 'engagement_asc'] as const;
export type PostSort = (typeof POST_SORTS)[number];
export type PostSortKey = 'date' | 'reach' | 'views' | 'engagement';
export const STORY_SORTS = ['newest', 'views', 'exit'] as const;
export type StorySort = (typeof STORY_SORTS)[number];

export const POST_GRID_PAGE = 24;
export const POST_TABLE_PAGE = 50; // also the automatic view (no ?view): the server cannot know the width; desktop-first
export const STORY_DAYS_PER_PAGE = 7;
export const STORY_PAGE_SIZE = 48;
export const SEARCH_MAX = 100;

export interface PostListState {
  dates: ListDates;
  q: string; // '' = no search
  format: FeedFormat | null;
  tag: string | null; // a tag id (lower-case uuid), 'untagged', or no filter
  sort: PostSort;
  page: number; // 1-based
  view: PostsView | null;
}
export interface StoryListState {
  dates: ListDates;
  measured: boolean | null; // null = all Stories
  sort: StorySort;
  page: number; // 1-based: days (newest) or Stories (other sorts)
}

/** Every URL key the two lists own. The account page's Suspense key ignores them, so the toolbar never remounts. */
export const LIST_KEYS = ['pr', 'pfrom', 'pto', 'q', 'format', 'tag', 'sort', 'page', 'measured', 'view'] as const;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
const pick = <T extends string>(all: readonly T[], v: string | null): T | null => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : null);
const parsePage = (v: string | string[] | undefined) => {
  const s = one(v);
  return s !== null && /^\d{1,6}$/.test(s) && Number(s) >= 1 ? Number(s) : 1;
};

function parseDates(sp: Params): ListDates {
  let from = parseDay(sp.pfrom);
  let to = parseDay(sp.pto);
  if (from && to && from > to) [from, to] = [to, from];
  if (from || to) return { pr: null, from, to }; // custom dates win over a preset
  return { pr: pick(LIST_PRESETS, one(sp.pr)), from: null, to: null };
}

/** Search text: inner whitespace collapsed, trimmed, at most SEARCH_MAX code points (emoji never split). */
export const cleanSearch = (v: unknown): string => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, SEARCH_MAX).join('').trim() : '');

/** Posts list state from the URL. Invalid values are dropped (defaults), never echoed back. */
export function parsePostList(sp: Params): PostListState {
  const tag = one(sp.tag);
  return {
    dates: parseDates(sp),
    q: cleanSearch(one(sp.q)),
    format: pick(FEED_FORMATS, one(sp.format)),
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    sort: pick(POST_SORTS, one(sp.sort)) ?? 'newest',
    page: parsePage(sp.page),
    view: parsePostsView(sp.view),
  };
}

/** Stories list state from the URL. Invalid values are dropped (defaults), never echoed back. */
export function parseStoryList(sp: Params): StoryListState {
  const m = one(sp.measured);
  return { dates: parseDates(sp), measured: m === 'yes' ? true : m === 'no' ? false : null, sort: pick(STORY_SORTS, one(sp.sort)) ?? 'newest', page: parsePage(sp.page) };
}

const dateParams = (d: ListDates): Record<string, string> => (d.from || d.to ? { ...(d.from ? { pfrom: d.from } : {}), ...(d.to ? { pto: d.to } : {}) } : d.pr ? { pr: d.pr } : {});

/** The Posts tab's query, fixed order, defaults left out, then `keep` (the page's Time Scope params, carried untouched). */
export function postListParams(s: PostListState, keep: Record<string, string> = {}): Record<string, string> {
  return {
    tab: 'posts',
    ...dateParams(s.dates),
    ...(s.q ? { q: s.q } : {}),
    ...(s.format ? { format: s.format } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.sort !== 'newest' ? { sort: s.sort } : {}),
    ...(s.page > 1 ? { page: String(s.page) } : {}),
    ...(s.view ? { view: s.view } : {}),
    ...keep,
  };
}

/** The Stories tab's query, fixed order, defaults left out, then `keep`. */
export function storyListParams(s: StoryListState, keep: Record<string, string> = {}): Record<string, string> {
  return {
    tab: 'stories',
    ...dateParams(s.dates),
    ...(s.measured !== null ? { measured: s.measured ? 'yes' : 'no' } : {}),
    ...(s.sort !== 'newest' ? { sort: s.sort } : {}),
    ...(s.page > 1 ? { page: String(s.page) } : {}),
    ...keep,
  };
}

export const listHref = (params: Record<string, string>): string => `?${new URLSearchParams(params)}`;
/** The Posts list with `patch` applied. Any change goes back to page 1 unless the patch sets the page. */
export const postHref = (s: PostListState, patch: Partial<PostListState>, keep: Record<string, string> = {}): string => listHref(postListParams({ ...s, page: 1, ...patch }, keep));
/** The Stories list with `patch` applied. Any change goes back to page 1 unless the patch sets the page. */
export const storyHref = (s: StoryListState, patch: Partial<StoryListState>, keep: Record<string, string> = {}): string => listHref(storyListParams({ ...s, page: 1, ...patch }, keep));

/** The days a posted-date filter covers (owner timezone, inclusive). All time and open custom ends reach back MAX_DAYS (the app-wide floor). */
export function listWindow(d: ListDates, today: string): { from: string; to: string } {
  const floor = addDays(today, -(MAX_DAYS - 1));
  if (d.from || d.to) return { from: d.from ?? floor, to: d.to ?? today };
  switch (d.pr) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: floor, to: today };
  }
}

export const postPageSize = (view: PostsView | null): number => (view === 'grid' ? POST_GRID_PAGE : POST_TABLE_PAGE);
export const storyPageSize = (sort: StorySort): number => (sort === 'newest' ? STORY_DAYS_PER_PAGE : STORY_PAGE_SIZE);
export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));
/** The page of size `to` that holds the first item of `page` at size `from` (Grid | Table keeps the place). */
export const samePlace = (page: number, from: number, to: number): number => Math.floor(((page - 1) * from) / to) + 1;

export function postSortOf(s: PostSort): { key: PostSortKey; asc: boolean } {
  if (s === 'newest' || s === 'oldest') return { key: 'date', asc: s === 'oldest' };
  const [key, dir] = s.split('_') as [Exclude<PostSortKey, 'date'>, string | undefined];
  return { key, asc: dir === 'asc' };
}

export const postSortFor = (key: PostSortKey, asc: boolean): PostSort => (key === 'date' ? (asc ? 'oldest' : 'newest') : ((asc ? `${key}_asc` : key) as PostSort));

// The SQL order: nulls last in both directions, ties newest first (posted_at desc, id desc); oldest = posted_at, id ascending.
type Dated = { id: string; postedAt: string };
const newest = (a: Dated, b: Dated) => Date.parse(b.postedAt) - Date.parse(a.postedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const oldest = (a: Dated, b: Dated) => -newest(a, b);
function byValue<T extends Dated>(get: (x: T) => number | null, asc: boolean) {
  return (a: T, b: T) => {
    const x = get(a);
    const y = get(b);
    if (x === null || y === null) return x === y ? newest(a, b) : x === null ? 1 : -1;
    return (asc ? x - y : y - x) || newest(a, b);
  };
}
const POST_VALUES: Record<Exclude<PostSortKey, 'date'>, (p: PostView) => number | null> = { reach: (p) => p.reach, views: (p) => p.views, engagement: (p) => p.engagementRate };

export function sortPosts(posts: PostView[], sort: PostSort): PostView[] {
  const { key, asc } = postSortOf(sort);
  return [...posts].sort(key === 'date' ? (asc ? oldest : newest) : byValue(POST_VALUES[key], asc));
}

export function sortStories(stories: StoryView[], sort: StorySort): StoryView[] {
  return [...stories].sort(sort === 'views' ? byValue((s: StoryView) => s.final?.views ?? null, false) : sort === 'exit' ? byValue((s: StoryView) => s.exitRate, false) : newest);
}

/** One page of already-filtered posts (the fallback read): sorted, cut; a page past the end is page 1 (as the reader does). */
export function pagePosts(posts: PostView[], s: Pick<PostListState, 'sort' | 'page' | 'view'>): { posts: PostView[]; total: number; page: number } {
  const size = postPageSize(s.view);
  const page = s.page > pageCount(posts.length, size) ? 1 : s.page;
  return { posts: sortPosts(posts, s.sort).slice((page - 1) * size, page * size), total: posts.length, page };
}

/** One page of Stories (the fallback read): the measured filter, then whole owner-timezone days (newest) or sorted Stories. */
export function pageStories(stories: StoryView[], s: StoryListState, tz: string): { stories: StoryView[]; items: number; days: number; page: number } {
  const kept = s.measured === null ? stories : stories.filter((x) => (x.reason === null) === s.measured);
  const groups = storyDays(kept, tz);
  const size = storyPageSize(s.sort);
  const page = s.page > pageCount(s.sort === 'newest' ? groups.length : kept.length, size) ? 1 : s.page;
  const cut = s.sort === 'newest' ? groups.slice((page - 1) * size, page * size).flatMap((d) => d.stories) : sortStories(kept, s.sort).slice((page - 1) * size, page * size);
  return { stories: cut, items: kept.length, days: groups.length, page };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/lists.test.ts tests/dashboard-content.test.ts tests/dashboard-covers.test.ts tests/stories-filmstrip.test.tsx tests/stories-audience.test.tsx tests/export-report.test.ts tests/export-workbook.test.ts` and `npx tsc --noEmit` and `npx eslint lib/dashboard/lists.ts lib/dashboard/content.ts tests/lists.test.ts tests/dashboard-content.test.ts`
Expected: PASS (`lists`: 22 tests; `dashboard-content` gains 2); typecheck and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/lists.ts lib/dashboard/content.ts tests/lists.test.ts tests/dashboard-content.test.ts
git commit -m "feat(lists): Posts/Stories list URL state, date window, TypeScript mirror of the SQL order; storyView" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Readers `loadPostPage` / `loadStoryPage`; shared `MISSING_FUNCTION`

**Files:**
- Modify: `lib/dashboard/detail-read.ts`, `lib/dashboard/read.ts`, `lib/post-lab/read.ts` (one import, the local constant removed)
- Test: `tests/detail-read.test.ts` (6 new tests); `tests/post-lab-read.test.ts`, `tests/post-lab-page.test.tsx` pass unchanged.

**Interfaces:**
- Consumes: Task 1's function and argument names; Task 3's `StoryFinal`, `FeedFormat` (types from `content.ts`), `PostSortKey`, `StorySort` (types from `lists.ts`); `rowToPost`, `safeLink` (`read.ts`).
- Produces:
  - `lib/dashboard/read.ts`: `export const MISSING_FUNCTION: readonly string[] = ['PGRST202', '42883'];` (the Post Lab imports it).
  - `lib/dashboard/detail-read.ts`: `interface PostPageArgs { fromIso; toIso; q: string; format: FeedFormat | null; tag: string | null; sort: { key: PostSortKey; asc: boolean }; page: number; size: number }`, `loadPostPage(db, accountId, a): Promise<{ rows: PostRow[]; total: number; page: number } | null>`; `interface StoryPageArgs { fromIso; toIso; tz: string; measured: boolean | null; sort: StorySort; page: number; size: number }`, `loadStoryPage(db, accountId, a): Promise<{ stories: StoryFinal[]; items: number; days: number; page: number } | null>`. `null` = the SQL function is missing. `loadStories`/`loadPostRows` unchanged (exports, Tags page, fallback); `rowToStory` now uses a shared `snapshotOf(row)`.

- [ ] **Step 1: Write the failing tests** — apply this patch to `tests/detail-read.test.ts`:

```diff
diff --git a/tests/detail-read.test.ts b/tests/detail-read.test.ts
index ef68919..2deba5c 100644
--- a/tests/detail-read.test.ts
+++ b/tests/detail-read.test.ts
@@ -1,5 +1,5 @@
 import { describe, expect, it } from 'vitest';
-import { CALENDAR_LIMIT, loadAudience, loadMonthMedia, loadOnline, loadPostRows, loadStories, loadTags, STORY_LIMIT } from '@/lib/dashboard/detail-read';
+import { CALENDAR_LIMIT, loadAudience, loadMonthMedia, loadOnline, loadPostPage, loadPostRows, loadStories, loadStoryPage, loadTags, STORY_LIMIT, type PostPageArgs, type StoryPageArgs } from '@/lib/dashboard/detail-read';
 import { MEDIA_LIMIT } from '@/lib/dashboard/read';
 
 type Call = { table: string; select: string; ops: unknown[][] };
@@ -155,3 +155,65 @@ describe('loadOnline, loadTags, loadMonthMedia', () => {
     expect((await loadStories(s.db, 'a1', 'x', 'y')).stories.map((r) => r.permalink)).toEqual([null, 'https://www.instagram.com/stories/x/']);
   });
 });
+
+/** Fake owner-session client for the list functions: each rpc takes the next result queued for its name; calls recorded. */
+function rpcDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
+  const calls: [string, Record<string, unknown>][] = [];
+  const db = { rpc: (name: string, args: Record<string, unknown>) => (calls.push([name, args]), Promise.resolve(results[name]?.shift() ?? { data: [], error: null })) };
+  return { db: db as never, calls };
+}
+
+describe('loadPostPage', () => {
+  const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
+  const args: PostPageArgs = { fromIso: '2021-10-13T16:00:00.000Z', toIso: '2026-10-17T16:00:00.000Z', q: '', format: null, tag: null, sort: { key: 'date', asc: false }, page: 1, size: 50 };
+  const post = (id: string, o: Record<string, unknown> = {}) => ({ id, media_type: 'REELS', posted_at: '2026-10-10T10:00:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hi', cover_status: 'ok', children_count: null, reach: 50, views: 70, likes: 3, comments: null, saves: 1, shares: null, tag_ids: [T1], n: 51, total: 120, ...o });
+
+  it('calls post_list with this account, the window, the filters, the sort and the page; maps rows like loadPostRows', async () => {
+    const f = rpcDb({ post_list: [{ data: [post('m1'), post('m2', { media_type: 'IMAGE', permalink: 'javascript:x', caption: null, cover_status: 'weird', tag_ids: null, reach: null })], error: null }] });
+    const r = await loadPostPage(f.db, 'a1', { ...args, q: '50% off', format: 'REELS', tag: T1, sort: { key: 'engagement', asc: true }, page: 2 });
+    expect(f.calls).toEqual([['post_list', { p_account: 'a1', p_from: args.fromIso, p_to: args.toIso, p_q: '50% off', p_format: 'REELS', p_tag: T1, p_untagged: false, p_sort: 'engagement', p_asc: true, p_offset: 50, p_limit: 50 }]]);
+    expect(r).toMatchObject({ total: 120, page: 2 });
+    expect(r!.rows[0]).toEqual({ id: 'm1', accountId: 'a1', mediaType: 'REELS', postedAt: '2026-10-10T10:00:00Z', permalink: 'https://www.instagram.com/reel/x/', reach: 50, views: 70, likes: 3, comments: null, shares: null, saves: 1, caption: 'Hi', tagIds: [T1], cover: 'ok', slides: null });
+    expect(r!.rows[1]).toMatchObject({ id: 'm2', permalink: null, caption: null, tagIds: [], cover: 'pending', reach: null });
+  });
+
+  it('no search = null; untagged is its own flag; an empty first page is a total of 0', async () => {
+    const f = rpcDb({});
+    expect(await loadPostPage(f.db, 'a1', { ...args, tag: 'untagged' })).toEqual({ rows: [], total: 0, page: 1 });
+    expect(f.calls[0][1]).toMatchObject({ p_q: null, p_tag: null, p_untagged: true });
+  });
+
+  it('a page past the end (stale link) is read again as page 1', async () => {
+    const f = rpcDb({ post_list: [{ data: [], error: null }, { data: [post('m1', { n: 1, total: 1 })], error: null }] });
+    const r = await loadPostPage(f.db, 'a1', { ...args, page: 9 });
+    expect(f.calls.map(([, a]) => a.p_offset)).toEqual([400, 0]);
+    expect(r).toMatchObject({ total: 1, page: 1 });
+  });
+
+  it('a missing function (migration not applied) is null; any other error is a fixed message', async () => {
+    for (const code of ['PGRST202', '42883']) expect(await loadPostPage(rpcDb({ post_list: [{ error: { code, message: 'x' } }] }).db, 'a1', args)).toBeNull();
+    await expect(loadPostPage(rpcDb({ post_list: [{ error: { code: '42501', message: 'secret detail' } }] }).db, 'a1', args)).rejects.toThrow(/^dashboard read: post page failed$/);
+  });
+});
+
+describe('loadStoryPage', () => {
+  const args: StoryPageArgs = { fromIso: 'a', toIso: 'b', tz: 'Asia/Kuala_Lumpur', measured: null, sort: 'newest', page: 1, size: 7 };
+  const row = (id: string, o: Record<string, unknown> = {}) => ({ id, posted_at: '2026-10-15T01:00:00Z', expires_at: '2026-10-16T01:00:00Z', permalink: null, cover_status: 'ok', captured_at: '2026-10-15T20:00:00Z', reach: 39, views: 40, replies: 1, shares: 0, total_interactions: 2, taps_forward: 7, taps_back: 0, exits: 2, snapshots: 2, progression: [10, 40], n: 1, items: 12, days: 5, ...o });
+
+  it('calls story_list with this account, the window, the timezone, the filter, the sort and the page; final numbers, count and series', async () => {
+    const f = rpcDb({ story_list: [{ data: [row('s1'), row('s2', { captured_at: null, reach: null, views: null, exits: null, snapshots: 0, progression: [] })], error: null }] });
+    const r = await loadStoryPage(f.db, 'a1', { ...args, measured: false, sort: 'exit', page: 3, size: 48 });
+    expect(f.calls).toEqual([['story_list', { p_account: 'a1', p_from: 'a', p_to: 'b', p_tz: 'Asia/Kuala_Lumpur', p_measured: false, p_sort: 'exit', p_offset: 96, p_limit: 48 }]]);
+    expect(r).toMatchObject({ items: 12, days: 5, page: 3 });
+    expect(r!.stories[0]).toEqual({ id: 's1', postedAt: '2026-10-15T01:00:00Z', expiresAt: '2026-10-16T01:00:00Z', permalink: null, cover: 'ok', final: { capturedAt: '2026-10-15T20:00:00Z', reach: 39, views: 40, replies: 1, shares: 0, interactions: 2, tapsForward: 7, tapsBack: 0, exits: 2 }, snapshots: 2, progression: [10, 40] });
+    expect(r!.stories[1]).toMatchObject({ final: null, snapshots: 0, progression: [] });
+  });
+
+  it('a stale page is read again as page 1; a missing function is null; other errors are fixed text', async () => {
+    const f = rpcDb({ story_list: [{ data: [] }, { data: [row('s1')] }] });
+    expect(await loadStoryPage(f.db, 'a1', { ...args, page: 4 })).toMatchObject({ page: 1, days: 5 });
+    expect(f.calls.map(([, a]) => a.p_offset)).toEqual([21, 0]);
+    expect(await loadStoryPage(rpcDb({ story_list: [{ error: { code: 'PGRST202' } }] }).db, 'a1', args)).toBeNull();
+    await expect(loadStoryPage(rpcDb({ story_list: [{ error: { code: 'XX000', message: 'secret' } }] }).db, 'a1', args)).rejects.toThrow(/^dashboard read: story page failed$/);
+  });
+});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/detail-read.test.ts`
Expected: FAIL — `loadPostPage is not a function` (and the `PostPageArgs`/`StoryPageArgs` type imports do not resolve for `tsc`).

- [ ] **Step 3: Implement** — apply this patch (three files):

```diff
diff --git a/lib/dashboard/detail-read.ts b/lib/dashboard/detail-read.ts
index d13486a..4d19872 100644
--- a/lib/dashboard/detail-read.ts
+++ b/lib/dashboard/detail-read.ts
@@ -2,7 +2,9 @@
 // limits, fixed error messages (Supabase messages can echo values). Never the admin client, never account_tokens.
 import type { SupabaseClient } from '@supabase/supabase-js';
 import type { OnlineFollowersRow, Post, Tag } from '@/lib/analysis/types';
-import { MEDIA_LIMIT, PAGE, reaches, readPages, rowToPost, safeLink } from '@/lib/dashboard/read';
+import type { FeedFormat, StoryFinal } from '@/lib/dashboard/content';
+import type { PostSortKey, StorySort } from '@/lib/dashboard/lists';
+import { MEDIA_LIMIT, MISSING_FUNCTION, PAGE, reaches, readPages, rowToPost, safeLink } from '@/lib/dashboard/read';
 import type { AudienceKind } from '@/lib/instagram/metrics';
 import type { MediaKind } from '@/lib/instagram/parse';
 import type { CoverStatus } from '@/lib/sync/covers';
@@ -95,9 +97,9 @@ export async function loadPostRows(db: SupabaseClient, accountId: string, since:
 }
 
 /** Stories posted in [fromIso, toIso), newest first, with every snapshot (oldest first); at most STORY_LIMIT, `truncated` when there are more.
- *  ponytail: snapshots are embedded without a per-story cap, so 200 stories x 30-minute snapshots is the ceiling;
- *  lifting it needs a `story_finals` SQL function (final snapshot + count + views series per Story, security invoker),
- *  applied BEFORE the code that calls it (Plan 13a kept the cap: see its Decisions). */
+ *  ponytail: snapshots are embedded without a per-story cap, so 200 stories x 30-minute snapshots is the ceiling. The
+ *  Stories TAB reads loadStoryPage (story_list, no cap, Plan 14b); this capped read remains for the exports and as the
+ *  tab's fallback until migration 20261027000001 is applied. */
 export async function loadStories(db: SupabaseClient, accountId: string, fromIso: string, toIso: string): Promise<{ stories: StoryRow[]; truncated: boolean }> {
   const { data, error } = await db
     .from('media')
@@ -114,6 +116,18 @@ export async function loadStories(db: SupabaseClient, accountId: string, fromIso
   return { stories: rows.slice(0, STORY_LIMIT).map(rowToStory), truncated: rows.length > STORY_LIMIT };
 }
 
+const snapshotOf = (m: Row): StorySnapshot => ({
+  capturedAt: String(m.captured_at),
+  reach: num(m.reach),
+  views: num(m.views),
+  replies: num(m.replies),
+  shares: num(m.shares),
+  interactions: num(m.total_interactions),
+  tapsForward: num(m.taps_forward),
+  tapsBack: num(m.taps_back),
+  exits: num(m.exits),
+});
+
 function rowToStory(r: Row): StoryRow {
   return {
     id: String(r.id),
@@ -121,17 +135,85 @@ function rowToStory(r: Row): StoryRow {
     expiresAt: str(r.expires_at),
     permalink: safeLink(r.permalink),
     cover: coverOf(r.cover_status),
-    snapshots: (Array.isArray(r.media_metrics) ? (r.media_metrics as Row[]) : []).map((m) => ({
-      capturedAt: String(m.captured_at),
-      reach: num(m.reach),
-      views: num(m.views),
-      replies: num(m.replies),
-      shares: num(m.shares),
-      interactions: num(m.total_interactions),
-      tapsForward: num(m.taps_forward),
-      tapsBack: num(m.taps_back),
-      exits: num(m.exits),
+    snapshots: (Array.isArray(r.media_metrics) ? (r.media_metrics as Row[]) : []).map(snapshotOf),
+  };
+}
+
+const missing = (e: unknown) => MISSING_FUNCTION.includes(String((e as { code?: unknown }).code));
+
+export interface PostPageArgs {
+  fromIso: string;
+  toIso: string;
+  q: string; // '' = no search
+  format: FeedFormat | null;
+  tag: string | null; // a tag id, 'untagged', or no filter
+  sort: { key: PostSortKey; asc: boolean };
+  page: number; // 1-based
+  size: number;
+}
+
+/** One page of an account's feed posts, filtered, sorted and counted by `post_list` (migration 20261027000001), each with
+ *  its latest snapshot and tag ids. A page past the end (a stale link) is read again as page 1.
+ *  null = the function does not exist yet: the caller falls back to loadPostRows. */
+export async function loadPostPage(db: SupabaseClient, accountId: string, a: PostPageArgs): Promise<{ rows: PostRow[]; total: number; page: number } | null> {
+  const { data, error } = await db.rpc('post_list', {
+    p_account: accountId,
+    p_from: a.fromIso,
+    p_to: a.toIso,
+    p_q: a.q || null,
+    p_format: a.format,
+    p_tag: a.tag && a.tag !== 'untagged' ? a.tag : null,
+    p_untagged: a.tag === 'untagged',
+    p_sort: a.sort.key,
+    p_asc: a.sort.asc,
+    p_offset: (a.page - 1) * a.size,
+    p_limit: a.size,
+  });
+  if (error) return missing(error) ? null : fail('post page');
+  const rows = (data ?? []) as Row[];
+  if (rows.length === 0 && a.page > 1) return loadPostPage(db, accountId, { ...a, page: 1 });
+  return {
+    rows: rows.flatMap((r) => {
+      const p = rowToPost({ ...r, account_id: accountId, media_metrics: [r] }); // the row carries the latest snapshot's columns
+      return p ? [{ ...p, caption: str(r.caption), tagIds: Array.isArray(r.tag_ids) ? r.tag_ids.map(String) : [], cover: coverOf(r.cover_status), slides: num(r.children_count) }] : [];
+    }),
+    total: Number(rows[0]?.total ?? 0),
+    page: a.page,
+  };
+}
+
+export interface StoryPageArgs {
+  fromIso: string;
+  toIso: string;
+  tz: string; // owner timezone: the days of the "newest" pages
+  measured: boolean | null;
+  sort: StorySort;
+  page: number; // 1-based: days (newest) or Stories
+  size: number;
+}
+
+/** One page of an account's Stories with their final numbers, by `story_list` (migration 20261027000001): whole
+ *  owner-timezone days for "newest", Stories for the other sorts. A page past the end is read again as page 1.
+ *  null = the function does not exist yet: the caller falls back to loadStories (capped). */
+export async function loadStoryPage(db: SupabaseClient, accountId: string, a: StoryPageArgs): Promise<{ stories: StoryFinal[]; items: number; days: number; page: number } | null> {
+  const { data, error } = await db.rpc('story_list', { p_account: accountId, p_from: a.fromIso, p_to: a.toIso, p_tz: a.tz, p_measured: a.measured, p_sort: a.sort, p_offset: (a.page - 1) * a.size, p_limit: a.size });
+  if (error) return missing(error) ? null : fail('story page');
+  const rows = (data ?? []) as Row[];
+  if (rows.length === 0 && a.page > 1) return loadStoryPage(db, accountId, { ...a, page: 1 });
+  return {
+    stories: rows.map((r) => ({
+      id: String(r.id),
+      postedAt: String(r.posted_at),
+      expiresAt: str(r.expires_at),
+      permalink: safeLink(r.permalink),
+      cover: coverOf(r.cover_status),
+      final: r.captured_at ? snapshotOf(r) : null, // no snapshot: Instagram never shared numbers
+      snapshots: num(r.snapshots) ?? 0,
+      progression: Array.isArray(r.progression) ? r.progression.map(num) : [],
     })),
+    items: Number(rows[0]?.items ?? 0),
+    days: Number(rows[0]?.days ?? 0),
+    page: a.page,
   };
 }
 
diff --git a/lib/dashboard/read.ts b/lib/dashboard/read.ts
index d83dcbe..8584950 100644
--- a/lib/dashboard/read.ts
+++ b/lib/dashboard/read.ts
@@ -14,6 +14,8 @@ export const MEDIA_LIMIT = 500;
 export const PAGE = 1000;
 /** Safety stop for one paged read. ponytail: 10,000 posts per account in one scope is far beyond any real account; raise it if one ever gets close. */
 export const MAX_ROWS = 10_000;
+/** PostgREST / Postgres codes for "this SQL function does not exist": a migration that is not applied yet (callers degrade, never crash). */
+export const MISSING_FUNCTION: readonly string[] = ['PGRST202', '42883'];
 
 type Row = Record<string, unknown>;
 const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
diff --git a/lib/post-lab/read.ts b/lib/post-lab/read.ts
index 2012dc5..cc86406 100644
--- a/lib/post-lab/read.ts
+++ b/lib/post-lab/read.ts
@@ -4,7 +4,7 @@
 // supabase/migrations/20261026000001_post_lab.sql. Fixed error messages only (Supabase messages can echo values).
 import type { SupabaseClient } from '@supabase/supabase-js';
 import { CHECKPOINTS, PEER_MAX, type CheckpointId, type LabInput, type LabItem, type LabValues } from '@/lib/analysis/post-lab';
-import { safeLink } from '@/lib/dashboard/read';
+import { MISSING_FUNCTION, safeLink } from '@/lib/dashboard/read';
 import { LINK_TAP_ACTION } from '@/lib/instagram/metrics';
 import type { MediaKind } from '@/lib/instagram/parse';
 import type { CoverStatus } from '@/lib/sync/covers';
@@ -15,8 +15,6 @@ export const DAY_STORIES_MAX = 100;
 const MEDIA_COLUMNS = 'id,account_id,media_type,posted_at,expires_at,gone_at,permalink,caption,cover_status,children_count,media_tags(tag_id)';
 const COVERS: readonly string[] = ['pending', 'ok', 'unavailable', 'failed'];
 const KINDS: readonly string[] = ['IMAGE', 'CAROUSEL_ALBUM', 'REELS', 'STORY'];
-/** PostgREST "function not found" / Postgres undefined_function: the Post Lab migration is not applied yet. */
-const MISSING_FUNCTION = ['PGRST202', '42883'];
 
 export type PostLabRead = { kind: 'ok'; input: LabInput } | { kind: 'not_found' } | { kind: 'needs_migration' };
 
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/detail-read.test.ts tests/post-lab-read.test.ts tests/post-lab-page.test.tsx tests/export-read.test.ts` and `npx tsc --noEmit` and `npx eslint lib/dashboard/detail-read.ts lib/dashboard/read.ts lib/post-lab/read.ts tests/detail-read.test.ts`
Expected: PASS; typecheck and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/detail-read.ts lib/dashboard/read.ts lib/post-lab/read.ts tests/detail-read.test.ts
git commit -m "feat(lists): page readers over post_list/story_list (null when the migration is missing)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
