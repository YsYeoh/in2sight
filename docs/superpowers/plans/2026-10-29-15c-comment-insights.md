# Plan 15c: Comment insights (READ-ONLY: comments, fans, questions, topics, commenters who don't follow you) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** A new account tab **Comments** that turns the comments the sync already stores (Plan 11b, read-only) into five views: **All comments** (newest first, server-side search and filters, pages, a link to each post's Post Lab), **Unanswered questions** (rule-based question detection, no reply seen from the owner), **Fans** (top commenters, new fans, gone quiet — stated rules and counts), **Topics** (rule-based frequent words, emoji and hashtags, English and Chinese, min-sample guard; no AI) and **Not following you** (commenters missing from the latest follower export of Plan 15b, clearly snapshot-based). The tab explains "Reconnect to enable comments" when the account lacks the comments scope, and never calls an empty list "no comments" without it. Nothing here calls Instagram or writes anything (moderation is Plan 15d, built after this plan on the interfaces at the end).

**Architecture:** One additive migration adds three `security invoker` SQL functions (`comment_list`, `comment_fans`, `comment_outsiders`: filter, aggregate, page and count in the database, because PostgREST caps a read at 1,000 rows and an account can hold thousands of comments) and rewrites the `comments` RLS policy to the InitPlan form (`(select public.is_owner())`, as 12b did for the other tables) so those aggregates do not call `is_owner()` per row. The question rule is ONE pattern string in TypeScript (`lib/comments/question.ts`) that the page passes to `comment_list` as a parameter (`~*` in SQL, `RegExp(…, 'i')` in TypeScript), so the SQL filter and the badge on each row can never disagree. Topics are pure TypeScript over a capped read (the newest 1,000 comments of the range; `Intl.Segmenter` for Chinese words, tested). URL state is parsed and serialised by pure functions (`lib/comments/state.ts`, reusing the list date filter of 14b). One module names the table and the functions (`lib/comments/read.ts`, guarded by a privacy test like 15b's). The tab is a client component wired by the account page's `case 'comments'`; without the migration it says "needs a database update" and only Topics works.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, Supabase Postgres (RLS), `@supabase/supabase-js` owner-session client, next-intl 4, the shared pieces (`FilterToolbar`/`FilterSearch`/`FilterSelect`/`FilterOptions`, `PostedFilter`, `Pagination`, `DataTable` server mode, `EmptyState`, `Badge`, `Card`, underline `Tabs`), Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.** `Intl.Segmenter` is built into Node 24 (full ICU) and every current browser; it only runs on the server here.

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b (comments: read + later reply/hide/delete; comment insights "top fans, unanswered questions, recurring topics — rule-based, no AI"; "commenters cross-checked against the latest follower-export snapshot"; churn-risk list of regular commenters who went quiet "a signal, not proof"), §2 (commenter usernames need `instagram_business_manage_comments`), §6 "Top commenters (fans)", §8 (RLS, privacy of third-party usernames, scope change → "Reconnect to enable comments", features degrade without the scope; i18n, tokens, responsive, a11y). UX rules: `docs/UI_STANDARDS.md` rules 1–15. Project rules: `CLAUDE.md` (binding). Current state and lessons: `docs/PROGRESS.md`.

**Scratch run:** see "Scratch-run result" at the end (every TypeScript code block of Tasks 3–8 executed in a throwaway clone outside the repo). Not executed: the SQL on a real database (no database may be touched), the build, a browser, real comments — `docs/RUNBOOK_COMMENTS.md` (Task 9) has the live checks.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- ⚠ **Placement: a sixth account tab "Comments", BEFORE Followers** (`TABS = ['overview', 'growth', 'posts', 'stories', 'comments', 'followers']`, `?tab=comments`). Why before, not after: comments are a daily job ("new comments to answer", spec §0b Today briefing) and belong with the content tabs (Posts, Stories) whose items they hang off; Followers is an on-demand upload tool and Plan 15b fixed "Followers stays the LAST tab" (`lib/dashboard/account.ts` comment). Not a section of Posts (a list page with its own filters already; comments need five views), not a top-level page (comments belong to one account; a portfolio-wide fans board is spec "across accounts" — later, Open question 1). The tab never shows the range bar (list page, rule 4); the Time Scope params ride along in its links untouched.
- **Five views as underline tabs inside the tab** (`?section=`; `TabsList variant="line"`, rule 7), the same pattern as the Followers tab's five lists: `comments` (default) · `questions` · `fans` · `topics` · `outsiders`. Each view is ONE server read (pages of 50), so the tab stays fast.
- **The existing `comments` table suffices; no new table, no new column, no sync change.** What is stored (Plan 11b, `20261022000001_capture_v2b.sql`, `lib/sync/store.ts upsertComments`): `id, account_id, media_id, author_username, text, like_count, commented_at, first_seen_at, last_seen_at`, plus `parent_id` (always NULL: replies are not ingested), `author_id` (always NULL: not requested, `COMMENT_FIELDS = 'id,text,timestamp,username,like_count'`) and `hidden` (always the default `false`: not requested from Instagram). Only top-level comments of feed posts and Reels posted in the last 30 days are read (hourly, 4 pages × 50 per post, 20 calls per run); Stories have no comments in the API (Story replies are private messages). See "What data is NOT stored".
- **One migration `20261029000001_comment_insights.sql`, additive:** (1) `alter policy comments_owner_select … using ((select public.is_owner()))` (InitPlan: `is_owner()` reads `auth.mfa_factors`; per row it would run thousands of times inside an aggregate); (2) `comment_list` (one page of comments with filters and the derived "reply seen" flag), (3) `comment_fans` (per-commenter aggregates: top / new / quiet), (4) `comment_outsiders` (commenters not in the newest follower export, hash anti-join against `unnest(followers)`). All three: `language sql stable security invoker set search_path = ''`, typed inputs, nothing spliced into SQL text (`strpos` for search, `~*` only with the app's pattern parameter), every row carries the total (`count(*) over ()`), page size capped at 200 in SQL, execute revoked from `public, anon` and granted to `authenticated`. **No index:** the aggregates scan one account's comments through `comments_account_idx` (thousands of rows: milliseconds); `ponytail:` add `(account_id, lower(author_username))` only if the runbook's timing check (§6) fails. The functions need `public.follower_exports` (15b, applied live 2026-10-22) to exist at creation.
- **Missing migration = a clear note, not an error:** `PGRST202` / `42883` (function not found, `MISSING_FUNCTION` in `lib/dashboard/read.ts`) → the reader returns `null` → the tab shows "Comments needs a database update (docs/RUNBOOK_COMMENTS.md §0)" for All comments, Questions, Fans and Not following you; **Topics still works** (it reads the table directly). Every other error throws a fixed message (Supabase errors can echo values) → the normal error screen.
- **Scope gating:** `hasScope(account, COMMENTS_SCOPE)` (`lib/accounts/scopes.ts`; unknown = not granted). Without it the tab reads NOTHING and shows "Comments are off for @name" with the reason (connected before the scope was requested; Instagram then answers an EMPTY list with no error, so empty is not "no comments") and the existing reconnect link (`connectHref(groupName)` from `components/accounts/ConnectDialog.tsx`, `target="_top"` so it leaves the shell's iframe tab; same text as the Accounts page hint, `accounts.commentsHint`). With the scope and no rows: "No comments in this range yet — comments arrive hourly for posts of the last 30 days", plus the "Comments read since {date}" line (earliest `first_seen_at`).
- **All comments (list):** newest first (`commented_at desc, id desc`), 50 per page (`COMMENT_PAGE`), `Pagination` + a count line. Toolbar (rule 1, three visible controls): search (substring of the text OR the username, case-insensitive, `strpos`, no patterns, 100 code points as `cleanSearch`), **comment date** (the 14b `PostedFilter`, labelled "Commented: …" — URL `pr` / `pfrom` / `pto`, default All time = the `MAX_DAYS` floor), **post** (a `FilterSelect` of the newest 50 feed posts/Reels with comments; a deep-linked older post shows as "This post"); under **Advanced**: "Show only" = Questions | From fans. Every filter is a chip; Clear all keeps the section. **Not offered** (not stored): replied/unreplied as a filter on this list (the Questions view uses the derived rule below), hidden, Story (Stories have no comments).
- **Rows:** `CommentRow` (`components/account/CommentRow.tsx`): `@author` (link to the Instagram profile, new tab), date and time (`formatDateTime`), likes, badges (Question · Reply seen · Hidden when `status="hidden"`), the text as React text only (`whitespace-pre-wrap break-words`, never HTML), **capped at 500 code points** with "…" (`TEXT_CAP`; Instagram allows 2,200; emoji never split), and "On your post of {date}" linking to that post's Post Lab (`postLabHref(accountId, mediaId, scopeQuery)`). An `actions` slot (empty in 15c) and a `status` prop for Plan 15d.
- **Question rule (`isQuestion`, exact):** a comment is a question when its text matches, case-insensitively, `QUESTION_PATTERN` = a question mark anywhere (`?`, full-width `？`, `❓`), OR (after optional leading @mentions and spaces) it STARTS with an English question word (`how what when where why who which whose can could do does did is are will would should any anyone`, followed by a non-letter or the end), OR it contains a Chinese question word anywhere (simplified and traditional: `吗 嗎 什么 什麼 怎么 怎麼 怎样 怎樣 为什么 為什麼 哪里 哪裡 哪儿 哪個 哪个 多少 几时 幾時 是不是 有没有 有沒有 能不能 可不可以 请问 請問`). English words count only at the start because "this is great" and "show me" are not questions; Chinese words are unambiguous enough anywhere. Rule-based, labelled as such. The pattern uses only syntax that means the same in JavaScript and PostgreSQL regular expressions (literals, `|`, `( )`, bracket sets, `^`, `$`, `*`, `+`, `\s`); a test pins that.
- **"Reply seen" (`repliedByOwner`) is DERIVED, because replies are not stored:** `true` when a LATER top-level comment on the same post by the account's own username mentions `@author` (case-insensitive `strpos`); otherwise `null` (unknown), **never `false`**: owners usually reply inside the thread, and thread replies are not read (`parent_id` is always NULL), so "no reply seen" is not "unanswered". The Questions view lists questions with no reply seen, excluding the owner's own comments, and says exactly this limit on screen. Prefix collision (`@amy` also matches `@amy2`) is accepted (`ponytail:` note in SQL). Reading thread replies needs a sync change + Meta probe: Plan 15d (Open question 3).
- **Fans (exact rules; constants in `lib/comments/view.ts FAN_RULES`, passed to SQL as parameters so there is one source):** grouped by lower-cased username (`author_id` is not stored, so a renamed account starts over), the owner's own comments left out, all comments ever stored (not the date filter: "first seen" needs all history). Per person: comments, likes on their comments (sum, missing as 0), first and latest comment. **Top fans** = everyone, ranked by comments, then likes, then latest comment, then name. **New fans** = first comment within the last 30 days (`windowDays`) AND at least 2 comments (`newFanMin`), newest first-comment first. **Gone quiet** = at least 3 comments (`fanMin`), none in the last 30 days, AND at least 3 feed posts/Reels published after their latest comment (`quietPosts`: you kept posting, they stopped commenting), ranked like Top; labelled "a signal, not proof". **"From fans" filter** = authors with at least 3 comments. Each view shows its rule with the numbers and the count of people ("1–50 of 312 people" = the sample size).
- **Topics (exact; `lib/comments/topics.ts`):** input = the newest 1,000 comments of the comment-date range (`TOPIC_SAMPLE`; one capped read, the basis line says "From the newest {n} comments"), the owner's own left out. Per comment, lower-cased: URLs and @mentions removed; **hashtags** `#[\p{L}\p{N}_]+`; **emoji** `\p{Extended_Pictographic}` (one code point each, so ❤️ and ❤ are the same); **words** = `Intl.Segmenter('zh', { granularity: 'word' })` segments that are word-like, at least 2 code points (drops single letters and single Chinese characters such as 的/了/我), not all digits, not in `STOP_WORDS` (≈ 70 English + ≈ 40 Chinese two-character function words, in the file). Each term counts **once per comment**, and is kept only when it appears in **at least 3 comments from at least 2 different people** (one spammer cannot make a topic). Top 10 per kind by comment count, then term. **Guard:** fewer than 20 comments in the sample → no topics, "At least 20 comments are needed; this range has {n}". `Intl.Segmenter` (dictionary-based for Chinese, built in) over character n-grams: it is the simplest that gives real words (`照片`, `哪里`) and is tested with Chinese text; n-grams would need their own overlap rules.
- **Not following you (exact):** commenters (all stored comments, lower-cased, owner left out) whose username is NOT in the `followers` array of the account's NEWEST follower export (`order by taken_on desc, created_at desc limit 1`; usernames there are lower-cased by the 15b parser). Ranked by comments, then latest comment. The view says "Compared with your follower export of {date} ({count} followers). Snapshot-based: people who followed after that export show up here too." No export → "Upload a follower export first" with a link to `?tab=followers`; the snapshot list comes from the existing `listFollowerSnapshots` (null = 15b table missing → the database-update note). The SQL function reads `follower_exports` under its RLS (owner only); the TypeScript never names that table (the 15b guard `tests/followers-privacy.test.ts` stays green).
- **URL state** (validated on the server, invalid values dropped, defaults omitted): `section` ∈ `comments | questions | fans | topics | outsiders` (default `comments`), the 14b date keys `pr | pfrom | pto` (comment date), `q`, `media` (a numeric Instagram media id, `^\d{1,32}$`), `only` ∈ `questions | fans`, `fans` ∈ `top | new | quiet` (default `top`), `page`. A section, filter or mode change goes back to page 1; switching sections keeps the other filters (rule 3: never reset another filter). `COMMENT_KEYS = ['section', 'media', 'only', 'fans']` join `LIST_KEYS` (which already holds `pr, pfrom, pto, q, page`) in the account page's Suspense key, so the toolbar never remounts while a page streams.
- **Privacy (third-party personal data: commenter usernames and texts):** owner-only RLS (`comments_owner_select`, now InitPlan form); the functions are `security invoker` (RLS applies inside); reads only through the OWNER-SESSION client and only in `lib/comments/read.ts` (a new guard test: only it and the sync store name the table, only it calls the three functions, nothing in `lib/comments/*` or the tab logs, never the admin client, never `account_tokens`, and the workbook / PDF / report exports, the sync, alerts and push never import `lib/comments/`); never in `sync_runs` (unchanged sync); deleted with the account (`on delete cascade` from `accounts` and `media`, unchanged); **no export in this plan** (Open question 4; if added later: the owner's explicit choice, `safeText` on every text cell like `lib/export/followers.ts`). URLs carry only the owner's own search text (`?q=`, which appears in Vercel request logs — documented in the runbook like the Followers search) and a media id; never a commenter's name. Comment text is rendered as text (React escapes it), never `dangerouslySetInnerHTML`, capped in the UI.
- **No new dependencies, no Meta calls, no sync changes, no new design tokens, no new shared component** (the post-date filter gets two optional label props; `CommentRow` is new but is the 15d contract).

## Open questions for the owner (the plan implements the default shown)

1. **Comments as the fifth tab, before Followers** (Overview, Growth, Posts, Stories, Comments, Followers)? **Default: yes.** A fans board across all accounts (spec §6 "and across accounts") is left for later: the owner works account by account, and a cross-account board needs a portfolio page.
2. **Fan rules:** fan = 3+ comments; new fan = first comment in the last 30 days and 2+ comments; gone quiet = 3+ comments, none in 30 days, while you published 3+ posts since? **Default: yes** (constants in one place, `FAN_RULES`).
3. **"Reply seen" is derived** (a later top-level comment of yours that @mentions them) and **thread replies are not read**, so Unanswered questions over-reports questions you answered inside the thread. Read thread replies (`replies{id,username,timestamp,text}` on each comment, or `parent_id` filled) in Plan 15d, which needs reply data and a Meta probe anyway? **Default: yes, in 15d** (15c stays read-only with no sync change).
4. **No Excel export of comments or fans in 15c?** **Default: no export** (third-party data stays in the app unless asked; adding one later = a sheet with `safeText` like `lib/export/followers.ts`).
5. **Question words:** English words at the start only, Chinese words anywhere, plus `?`, `？`, `❓`. Add Malay (`berapa`, `bila`, `mana`, `boleh`) or sales phrases (`price`, `pm`)? **Default: no** (one pattern constant to extend).
6. **Topics from the newest 1,000 comments of the range** (one capped read) rather than every comment? **Default: yes** (the basis line states the sample; a SQL tokenizer for Chinese is not worth it).

## What data is NOT stored (a feature would need it)

| Missing | Effect in 15c | Who adds it |
|---|---|---|
| Thread replies (`parent_id` always NULL, no `replies` field requested) | "Reply seen" is derived from top-level @mentions only; Unanswered questions over-reports; no replied/unreplied filter on the list | Plan 15d (sync field + Meta probe) |
| `hidden` from Instagram (column stays the default `false`, the field is not requested) | `CommentView.hidden` is `null` unless the column is `true` (only 15d's own hide action would set it); no Hidden filter | Plan 15d |
| `author_id` (column always NULL) | Fans are grouped by lower-cased username; a renamed account counts as a new person | 15d or later (add `from{id}` to the fields) |
| Comments on posts older than 30 days at first read, and before the scope was granted | Fans, first-seen and gone quiet only know history since the Reconnect; the "Comments read since" line says so | cannot be recovered beyond what Instagram still lists |
| Story replies (private messages, not comments) | Stories have no comments here; the intro says so | not available in the API used |
| More than 200 comments per post (4 pages × 50 cap per post) | very busy posts are partly read | sync budget, later |

## Assumptions about the current code (`main` at `222efd1`, read for this plan)

- Migrations through `20261028000002_follower_exports.sql` are applied live (PROGRESS §5). `public.comments` (`20261022000001_capture_v2b.sql`): columns above; `comments_media_idx (media_id, commented_at desc)`, `comments_account_idx (account_id, commented_at desc)`; `revoke all … from anon, authenticated; grant select … to authenticated`; policy `comments_owner_select for select to authenticated using (public.is_owner())` (NOT yet InitPlan form: `20261024000001_explorer.sql` rewrote five other policies, not this one). `public.media (id text pk, account_id, media_type 'IMAGE'|'CAROUSEL_ALBUM'|'REELS'|'STORY', posted_at, caption, comments_count, gone_at, …)`. `public.follower_exports (account_id, taken_on, followers text[] lower-case, created_at, …)` with owner-only RLS (InitPlan form). `public.accounts.granted_scopes text[]`.
- Sync (`lib/sync/run-account.ts` job `comments`, `lib/sync/store.ts` `mediaForComments` / `upsertComments`): only with `hasScope(account, COMMENTS_SCOPE)`; feed + Reels (`media_type <> 'STORY'`), not gone, posted in the last 30 days, `comments_count > 0` and changed since the last read; upsert by comment id sets `id, account_id, media_id, author_username, text, like_count, commented_at, last_seen_at` (NOT `author_id`, `parent_id`, `hidden`). Owner's own top-level comments arrive with the account's username.
- `lib/accounts/scopes.ts`: `COMMENTS_SCOPE = 'instagram_business_manage_comments'`, `hasScope(a, scope)`. `components/accounts/ConnectDialog.tsx`: `export function connectHref(group: string | null | undefined): string`. `messages/*.json` `accounts.commentsHint` = "Reconnect to enable comments" / zh.
- `lib/dashboard/read.ts`: `MISSING_FUNCTION = ['PGRST202', '42883']`. `lib/dashboard/lists.ts`: `LIST_KEYS` (`pr, pfrom, pto, q, format, tag, sort, page, measured, view`), `ListDates`, `ALL_TIME`, `cleanSearch`, `listWindow(dates, today)`, `listHref`, `pageCount`; `parseDates` and `dateParams` exist but are NOT exported (Task 5 exports them). `lib/sync/time.ts`: `daysToIso(fromDay, toDay, tz)`, `localDay`. `lib/post-lab/params.ts`: `postLabHref(accountId, mediaId, query = '')`. `lib/followers/read.ts`: `listFollowerSnapshots(db, accountId): Promise<SnapshotMeta[] | null>` (newest first; null = table missing).
- Account page: `lib/dashboard/account.ts` `TABS = ['overview', 'growth', 'posts', 'stories', 'followers'] as const`; `components/account/AccountView.tsx` maps `TABS` to underline triggers `t(\`tab.${v}\`)` and shows `RangeBar` only on overview/growth; `components/account/TabSkeleton.tsx` `switch (tab)` (default = the Overview shape); `app/(app)/accounts/[id]/(tabs)/page.tsx` `TabContent` `switch (tab)` (`case 'followers'` is the model), Suspense key ignores `[...LIST_KEYS, ...FOLLOWER_KEYS]`. Pinned by `tests/dashboard-account.test.ts` (line 20–21), `tests/account-view.test.tsx` (line 84 tab names, line 113 no range bar), `tests/route-loading.test.tsx` (`it.each(TABS)` skeleton), `tests/account-page.test.tsx` (module mocks + `streamTab`).
- Shared UI (signatures as in Plan 15b's assumptions, unchanged): `FilterToolbar({ label, children, advanced?, advancedCount?, end?, chips?, clearHref? })`, `FilterSearch({ id, label, value, placeholder?, hrefFor })`, `FilterSelect({ id, label, value, options, hrefFor })`, `FilterOptions({ label, options: { href, label, current? }[] })`, `useApply()`; `PostedFilter({ id, dates, today, hrefFor, hidden })` + `usePostedName(dates, today)` (`components/account/PostedFilter.tsx`, strings `pages.account.lists.*`: the button reads "Posted: {range}"); `Pagination({ page, pages, hrefFor })`; `DataTable({ rows, columns, rowKey, caption, empty, serverSort })`; `EmptyState({ icon?, title, description?, action? })`; `Badge` (`components/ui/badge.tsx`, variants incl. `secondary`, `outline`); `Card`, `CardHeader`, `CardTitle`, `CardContent` (`components/ui/card.tsx`); `usePrefs()`; `formatDateTime`, `formatDate`, `formatDay`, `formatNumber` (`lib/format.ts`).
- `tests/messages.test.ts`: same keys, non-empty, same `{placeholders}`, zh differs from en wherever en has 4+ ASCII letters (placeholder names count: `"{date} · {caption}"` copied verbatim would FAIL). `tests/ui-standards.test.ts` rule 6 (no `7d`-style labels in values).

## Out of scope

Replying, hiding, deleting, banned words, spam auto-hide, the undo log (Plan 15d); reading thread replies or the `hidden` field (15d, sync change); a cross-account fans board; comment exports; notifications for new comments or questions; AI summaries or sentiment; per-comment drawers; search inside Fans / Not following you (pages of 50 ranked rows; add when asked); Settings "Data & privacy" listing (spec §7, later plan: `comments` must be listed there).

## Global Constraints

- Ponytail: smallest thing that works. Pure logic in `lib/comments/` with Vitest tests; components wire only. **No new dependencies.** No new design tokens. Inline first: the five views live inside `CommentsTab`.
- TypeScript strict. No Meta metric names touched (`lib/instagram/metrics.ts` unchanged).
- DB: ONE new migration `supabase/migrations/20261029000001_comment_insights.sql` (Plan 15d uses `20261029000002_*` or later). **Implementers never apply it** (no `supabase`, `psql`, `db push`); it is applied on the owner's go-ahead (runbook §0) BEFORE deploying, and the code works before and after.
- Security / privacy: owner-session client only (never `createAdminSupabase`, never `account_tokens`); every read filtered by the URL's account id; fixed error messages (`comments <op> failed`); no logging of anything from a comment; comment text rendered as React text only; no third-party names in URLs.
- Every UI string via next-intl; ALL new keys are added by Task 2 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation `，：（）。`). Numbers passed to messages are already formatted by `formatNumber`, except plural selectors (`count` in `{count, plural, …}`).
- UI standards: `FilterToolbar` for every filter row (no range bar on this list tab), URL is the state (apply at once, search after 400 ms), underline tabs for the five views, one control height per row (no `size="sm"` beside default controls), `Pagination` + count line, full-word labels, analysis states its basis (source line, sample `n`, rules with numbers, "a signal, not proof"), tokens only, dates/numbers via `lib/format.ts`. Responsive 360 / 768 / 1280: the toolbar wraps, rows are cards (`CommentRow`) at every width, tables become cards on phones (`DataTable`), the three Topics cards stack on phones (`grid gap-[var(--gp)] lg:grid-cols-3`), no fixed widths, no sideways page scroll, CSS breakpoints only. a11y: each row is an `<article>` with an accessible name, external profile links say they open Instagram, the count line is `aria-live="polite"`.
- Tests: Vitest timeout 20 s; components using `FilterToolbar` pieces mock `next/navigation` (below). Never chain a commit after a piped command.
- `npm run check` passes after every wave. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **SQL correctness and safety:** the three functions are `security invoker`, `stable`, `search_path = ''`, typed, no dynamic SQL, `strpos` search, page capped, revoked from anon; the policy rewrite is the only change to an existing object → Task 1 test. Reviewer: run the SQL mentally against the "Scratch-run result" fixture (the functions were NOT executed on a database).
2. **One question rule in two engines:** `QUESTION_PATTERN` uses only the shared regex subset; the page passes the same string to `comment_list` → Task 3 tests ("only the shared subset"), Task 6 test (the rpc gets `p_question_re: QUESTION_PATTERN`).
3. **Honest labels:** `repliedByOwner` is `true` or `null`, never `false`; `hidden` is `true` or `null`; empty without the scope is never "no comments"; every analysis view states its rule, sample and source → Task 6, Task 7, Task 8 tests.
4. **Privacy:** one module names the table and functions, no logging, no admin client, not in exports/sync/alerts, text rendered as text and capped, nothing third-party in URLs → Task 6 privacy test, Task 7 tests.
5. **Shippable without the migration:** `PGRST202`/`42883` → `null` → the database-update note; Topics keeps working → Task 6 and Task 8 tests.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261029000001_comment_insights.sql` (new), `tests/comments-migration.test.ts` (new) | policy rewrite + `comment_list`, `comment_fans`, `comment_outsiders` |
| `messages/en.json`, `messages/zh-CN.json` | every new key (Task 2 only) |
| `lib/comments/view.ts` (new), `lib/comments/question.ts` (new), `tests/comments-question.test.ts` (new) | shared types (`CommentView`, `CommentPost`, `Fan`, `Outsider`, `Paged`), constants (`COMMENT_PAGE`, `FAN_PAGE`, `TEXT_CAP`, `FAN_RULES`, `TOPIC_SAMPLE`), `capText`; `QUESTION_PATTERN`, `isQuestion` |
| `lib/comments/topics.ts` (new), `tests/comments-topics.test.ts` (new) | `STOP_WORDS`, `terms`, `topics` |
| `lib/comments/state.ts` (new), `tests/comments-state.test.ts` (new), `lib/dashboard/lists.ts` (export two helpers) | URL state: `parseCommentState`, `commentHref`, `COMMENT_KEYS` |
| `lib/comments/read.ts` (new), `tests/comments-read.test.ts` (new), `tests/comments-privacy.test.ts` (new) | the ONLY module that names `comments` (besides the sync store) and the three functions |
| `components/account/CommentRow.tsx` (new), `tests/comment-row.test.tsx` (new) | one comment (the 15d contract) |
| `components/account/CommentsTab.tsx` (new), `tests/comments-tab.test.tsx` (new), `components/account/PostedFilter.tsx` (two optional label props), `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | the tab, its skeleton and its `case` |
| `docs/RUNBOOK_COMMENTS.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md` | live + privacy checks, spec §7i, ticks, handover lines, the comment-text rule |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys.

**Editing existing files** (`lib/dashboard/lists.ts`, `PostedFilter.tsx`, `account.ts`, `TabSkeleton.tsx`, `page.tsx`, the three pinned tests, docs): every edit is an anchored text edit (an exact line to find, the text to put). If Plan 15d or a fix landed first and changed an anchor, make the equivalent edit by hand (implementer rules §3) and list it as a deviation.

**Mocking the router in component tests** (the `FilterToolbar` pieces call `useRouter`): `const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));` and `vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));`.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | `supabase/migrations/20261029000001_comment_insights.sql`, `tests/comments-migration.test.ts` | 2, 3, 4, 5 |
| 2 | i18n: every new key | — | `messages/en.json`, `messages/zh-CN.json` | 1, 3, 4, 5 |
| 3 | Shared types + question rule (pure) | — | `lib/comments/view.ts`, `lib/comments/question.ts`, `tests/comments-question.test.ts` | 1, 2, 4, 5 |
| 4 | Topics (pure) | — | `lib/comments/topics.ts`, `tests/comments-topics.test.ts` | 1, 2, 3, 5 |
| 5 | URL state (pure) | — | `lib/comments/state.ts`, `tests/comments-state.test.ts`, `lib/dashboard/lists.ts` | 1, 2, 3, 4 |
| 6 | Readers + privacy guard | 1 (names), 3, 4, 5 | `lib/comments/read.ts`, `tests/comments-read.test.ts`, `tests/comments-privacy.test.ts` | 7 |
| 7 | `CommentRow` | 2, 3 | `components/account/CommentRow.tsx`, `tests/comment-row.test.tsx` | 6 |
| 8 | Comments tab end to end (component, `TABS`, skeleton, page `case`, PostedFilter labels) | 2–7 | `components/account/CommentsTab.tsx`, `tests/comments-tab.test.tsx`, `components/account/PostedFilter.tsx`, `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | — |
| 9 | Docs, final check | all | `docs/RUNBOOK_COMMENTS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md` | — |

Run order: **wave A = 1, 2, 3, 4, 5 · wave B = 6, 7 · wave C = 8 · wave D = 9.** Tasks in one wave touch disjoint files. Each task leaves `main` green: the new modules are unused until Task 8 wires the tab (which adds `comments` to `TABS` in the same commit as the page `case`, the skeleton and the pinned tests; the `tab.comments` message from Task 2 is unused until then, which is harmless); Task 5's `export` of two `lists.ts` helpers changes no behaviour.

---

### Task 1: Migration `20261029000001_comment_insights.sql` + migration test

**Files:**
- Create: `supabase/migrations/20261029000001_comment_insights.sql`, `tests/comments-migration.test.ts`
- Existing tests that must keep passing: `tests/migrations.test.ts` (generic rules for every migration), `tests/capture-v2b-migration.test.ts` (reads the earlier file only).

**Interfaces:**
- Consumes: `public.comments`, `public.media`, `public.follower_exports`, `public.is_owner()`.
- Produces (Task 6 calls exactly these):
  - `public.comment_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_media text, p_question_re text, p_unanswered boolean, p_fan_min int, p_owner text, p_offset int, p_limit int)` → `(id text, media_id text, author_username text, body text, like_count int, commented_at timestamptz, hidden boolean, replied boolean, media_type text, posted_at timestamptz, caption text, n bigint, total bigint)`
  - `public.comment_fans(p_account uuid, p_owner text, p_mode text, p_now timestamptz, p_fan_min int, p_new_min int, p_days int, p_quiet_posts int, p_offset int, p_limit int)` → `(username text, comments bigint, likes bigint, first_at timestamptz, last_at timestamptz, posts_since bigint, n bigint, total bigint)`
  - `public.comment_outsiders(p_account uuid, p_owner text, p_offset int, p_limit int)` → `(username text, comments bigint, last_at timestamptz, n bigint, total bigint)`
  - The comment text column is named `body` (an output column named `text` reads like the type).

- [ ] **Step 1: Write the failing test** — create `tests/comments-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261029000001_comment_insights.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = {
  comment_list: 'uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int',
  comment_fans: 'uuid, text, text, timestamptz, int, int, int, int, int, int',
  comment_outsiders: 'uuid, text, int, int',
};
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
/** The statements outside function bodies. */
const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, 'BODY').split(';').map((s) => s.trim()).filter(Boolean);

describe('comment insights migration', () => {
  it('is additive: one policy rewrite, three functions, their revokes and grants; nothing else; never account_tokens', () => {
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual([
      'alter policy', 'create or', 'create or', 'create or', 'revoke execute', 'revoke execute', 'revoke execute', 'grant execute', 'grant execute', 'grant execute',
    ]);
    expect(sql).not.toMatch(/\b(drop|truncate|create\s+table|create\s+index|create\s+policy|security\s+definer)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('the comments policy reads is_owner() once per query (InitPlan form)', () => {
    expect(sql).toMatch(exact('alter policy comments_owner_select on public.comments using ((select public.is_owner()))'));
  });

  it.each(Object.keys(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL, one account, a capped page with the total', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const [, head, body] = m!;
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\blike\b|\bilike\b/i); // nothing spliced into SQL text; no LIKE patterns
    expect(body).toMatch(exact('where c.account_id = p_account'));
    expect(body).toMatch(/count\(\*\)\s+over\s+\(\)\s+as\s+total/i);
    expect(body).toMatch(exact('where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)'));
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('comment_list: window, post, search without patterns, the question pattern as a parameter, fans, newest first', () => {
    const body = fn('comment_list')![2];
    expect(body).toMatch(exact('and c.commented_at >= p_from and c.commented_at < p_to'));
    expect(body).toMatch(exact('and (p_media is null or c.media_id = p_media)'));
    expect(body).toMatch(exact("and (p_q is null or strpos(lower(coalesce(c.text, '')), lower(p_q)) > 0 or strpos(lower(coalesce(c.author_username, '')), lower(p_q)) > 0)"));
    expect(body).toMatch(exact("and (p_question_re is null or coalesce(c.text, '') ~* p_question_re)"));
    expect(body).toMatch(exact('group by 1 having count(*) >= p_fan_min'));
    expect(body).toMatch(exact('row_number() over (order by f.commented_at desc, f.id desc) as n'));
  });

  it('comment_list: "replied" = a LATER top-level comment by the owner on the same post that @mentions the author; unanswered leaves the owner out', () => {
    const body = fn('comment_list')![2];
    expect(body).toMatch(
      exact(`exists (
             select 1 from public.comments o
              where o.media_id = c.media_id
                and lower(o.author_username) = lower(p_owner)
                and o.commented_at > c.commented_at
                and strpos(lower(coalesce(o.text, '')), '@' || lower(c.author_username)) > 0
           ) as replied`),
    );
    expect(body).toMatch(exact('where p_unanswered is not true or (not f.replied and f.author_username is not null and lower(f.author_username) <> lower(p_owner))'));
    expect(body).toMatch(exact('left join public.media m on m.id = r.media_id'));
  });

  it('comment_fans: by lower-cased name without the owner; the three modes with the parameters; quiet counts feed posts since', () => {
    const body = fn('comment_fans')![2];
    expect(body).toMatch(exact('select lower(c.author_username) as username, count(*) as comments, coalesce(sum(c.like_count), 0)::bigint as likes'));
    expect(body).toMatch(exact('and c.author_username is not null and lower(c.author_username) <> lower(p_owner)'));
    expect(body).toMatch(exact("or (p_mode = 'new' and b.first_at >= p_now - p_days * interval '1 day' and b.comments >= p_new_min)"));
    expect(body).toMatch(exact("or (p_mode = 'quiet' and b.comments >= p_fan_min and b.last_at < p_now - p_days * interval '1 day' and b.posts_since >= p_quiet_posts)"));
    expect(body).toMatch(exact("where m.account_id = p_account and m.media_type <> 'STORY' and m.posted_at > a.last_at and m.posted_at <= p_now"));
    expect(body).toMatch(exact("order by case when p_mode = 'new' then f.first_at end desc, f.comments desc, f.likes desc, f.last_at desc, f.username"));
  });

  it('comment_outsiders: the NEWEST follower export of this account only; anti-join on the unnested names; nothing without an export', () => {
    const body = fn('comment_outsiders')![2];
    expect(body).toMatch(exact('from public.follower_exports e where e.account_id = p_account order by e.taken_on desc, e.created_at desc limit 1'));
    expect(body).toMatch(exact('select unnest(s.followers) as u from s'));
    expect(body).toMatch(exact('where exists (select 1 from s) and not exists (select 1 from f where f.u = a.username)'));
    expect(body).toMatch(exact('row_number() over (order by o.comments desc, o.last_at desc, o.username) as n'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comments-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory … 20261029000001_comment_insights.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261029000001_comment_insights.sql` (exactly this):

```sql
-- Plan 15c: comment insights (READ-ONLY): one page of comments, fans, commenters who don't follow you. Additive: one
-- policy rewrite and three functions, nothing else. Apply BEFORE deploying the code that calls them; until then the
-- Comments tab says "needs a database update" (docs/RUNBOOK_COMMENTS.md §0) and only Topics works, so the order is
-- safe either way. Needs public.follower_exports (Plan 15b, 20261028000002) to exist: SQL function bodies are checked
-- at creation.
--
-- Third-party personal data (commenter usernames and texts): the functions are `security invoker`, so the owner-only
-- RLS of comments, media and follower_exports applies inside them (any other session gets no rows). Execute is revoked
-- from public/anon and granted to `authenticated` only. Inputs are typed; text inputs are only compared or searched
-- with strpos (p_q: no pattern, so % and _ are plain characters); p_question_re is the app's own constant
-- (lib/comments/question.ts QUESTION_PATTERN) used with ~*, never concatenated into SQL. Rows are numbered 1..total in
-- the order shown (n); the page is n in (p_offset, p_offset + p_limit], at most 200; every row carries the total.

-- 1. The comments policy in InitPlan form (is_owner() once per query, not once per row; 20261024000001 did the same
-- for five other tables). Same meaning: select for the owner only.
alter policy comments_owner_select on public.comments using ((select public.is_owner()));

-- 2. One page of an account's comments in [p_from, p_to), newest first. Filters (null / not true = none): p_media one
-- post; p_q in the text or the username (case-insensitive); p_question_re the question rule; p_fan_min only authors
-- with at least that many comments ever (the owner left out); p_unanswered only comments with no reply seen, not the
-- owner's own. "replied" is DERIVED (thread replies are not stored): a LATER top-level comment on the same post by the
-- account's username (p_owner) that @mentions the author. ponytail: @amy also matches @amy2; good enough for a hint.
create or replace function public.comment_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_media text, p_question_re text, p_unanswered boolean, p_fan_min int, p_owner text, p_offset int, p_limit int)
returns table (id text, media_id text, author_username text, body text, like_count int, commented_at timestamptz, hidden boolean, replied boolean, media_type text, posted_at timestamptz, caption text, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select c.id, c.media_id, c.author_username, c.text, c.like_count, c.commented_at, c.hidden,
           exists (
             select 1 from public.comments o
              where o.media_id = c.media_id
                and lower(o.author_username) = lower(p_owner)
                and o.commented_at > c.commented_at
                and strpos(lower(coalesce(o.text, '')), '@' || lower(c.author_username)) > 0
           ) as replied
      from public.comments c
     where c.account_id = p_account
       and c.commented_at >= p_from and c.commented_at < p_to
       and (p_media is null or c.media_id = p_media)
       and (p_q is null or strpos(lower(coalesce(c.text, '')), lower(p_q)) > 0 or strpos(lower(coalesce(c.author_username, '')), lower(p_q)) > 0)
       and (p_question_re is null or coalesce(c.text, '') ~* p_question_re)
       and (p_fan_min is null or lower(c.author_username) in (
             select lower(x.author_username) from public.comments x
              where x.account_id = p_account and x.author_username is not null and lower(x.author_username) <> lower(p_owner)
              group by 1 having count(*) >= p_fan_min))
  ),
  r as (
    select f.*,
           row_number() over (order by f.commented_at desc, f.id desc) as n,
           count(*) over () as total
      from f
     where p_unanswered is not true or (not f.replied and f.author_username is not null and lower(f.author_username) <> lower(p_owner))
  )
  select r.id, r.media_id, r.author_username, r.text, r.like_count, r.commented_at, r.hidden, r.replied,
         m.media_type, m.posted_at, left(m.caption, 100), r.n, r.total
    from r
    left join public.media m on m.id = r.media_id
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

-- 3. Commenters of one account over every stored comment, by lower-cased username (author_id is not stored), the
-- owner (p_owner) left out: comments, likes on their comments (missing as 0), first and latest comment. p_mode:
-- 'top' everyone, by comments, likes, latest, name; 'new' first comment within p_days of p_now and at least p_new_min
-- comments, newest first comment first; 'quiet' at least p_fan_min comments, none within p_days, and at least
-- p_quiet_posts feed posts/Reels published after their latest comment (posts_since; only computed for 'quiet').
-- The rule values come from lib/comments/view.ts FAN_RULES (one source).
create or replace function public.comment_fans(p_account uuid, p_owner text, p_mode text, p_now timestamptz, p_fan_min int, p_new_min int, p_days int, p_quiet_posts int, p_offset int, p_limit int)
returns table (username text, comments bigint, likes bigint, first_at timestamptz, last_at timestamptz, posts_since bigint, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with a as (
    select lower(c.author_username) as username, count(*) as comments, coalesce(sum(c.like_count), 0)::bigint as likes,
           min(c.commented_at) as first_at, max(c.commented_at) as last_at
      from public.comments c
     where c.account_id = p_account
       and c.author_username is not null and lower(c.author_username) <> lower(p_owner)
     group by 1
  ),
  b as (
    select a.*,
           case when p_mode = 'quiet' then (
             select count(*) from public.media m
              where m.account_id = p_account and m.media_type <> 'STORY' and m.posted_at > a.last_at and m.posted_at <= p_now
           ) end as posts_since
      from a
  ),
  f as (
    select b.* from b
     where (p_mode = 'top')
        or (p_mode = 'new' and b.first_at >= p_now - p_days * interval '1 day' and b.comments >= p_new_min)
        or (p_mode = 'quiet' and b.comments >= p_fan_min and b.last_at < p_now - p_days * interval '1 day' and b.posts_since >= p_quiet_posts)
  ),
  r as (
    select f.*,
           row_number() over (order by case when p_mode = 'new' then f.first_at end desc, f.comments desc, f.likes desc, f.last_at desc, f.username) as n,
           count(*) over () as total
      from f
  )
  select r.username, r.comments, r.likes, r.first_at, r.last_at, r.posts_since, r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

-- 4. Commenters (every stored comment, lower-cased, the owner left out) whose username is NOT in the followers of the
-- account's NEWEST follower export (Plan 15b; names there are lower-cased by lib/followers/parse.ts). Snapshot-based.
-- The anti-join runs on the unnested array (a hash join over up to 50,000 names), never `= any(array)` per commenter.
-- No export = no rows (the app checks listFollowerSnapshots first and says "upload an export").
create or replace function public.comment_outsiders(p_account uuid, p_owner text, p_offset int, p_limit int)
returns table (username text, comments bigint, last_at timestamptz, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select e.followers
      from public.follower_exports e
     where e.account_id = p_account
     order by e.taken_on desc, e.created_at desc
     limit 1
  ),
  f as (
    select unnest(s.followers) as u from s
  ),
  a as (
    select lower(c.author_username) as username, count(*) as comments, max(c.commented_at) as last_at
      from public.comments c
     where c.account_id = p_account
       and c.author_username is not null and lower(c.author_username) <> lower(p_owner)
     group by 1
  ),
  o as (
    select a.* from a
     where exists (select 1 from s) and not exists (select 1 from f where f.u = a.username)
  ),
  r as (
    select o.*,
           row_number() over (order by o.comments desc, o.last_at desc, o.username) as n,
           count(*) over () as total
      from o
  )
  select r.username, r.comments, r.last_at, r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

revoke execute on function public.comment_list(uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int) from public, anon;
revoke execute on function public.comment_fans(uuid, text, text, timestamptz, int, int, int, int, int, int) from public, anon;
revoke execute on function public.comment_outsiders(uuid, text, int, int) from public, anon;
grant execute on function public.comment_list(uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int) to authenticated;
grant execute on function public.comment_fans(uuid, text, text, timestamptz, int, int, int, int, int, int) to authenticated;
grant execute on function public.comment_outsiders(uuid, text, int, int) to authenticated;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/comments-migration.test.ts tests/migrations.test.ts tests/capture-v2b-migration.test.ts`
Expected: PASS (12 tests in the new file; the generic suites unchanged — no new table, no new policy). Do NOT apply the migration anywhere (implementer rules §7).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261029000001_comment_insights.sql tests/comments-migration.test.ts
git commit -m "feat(db): comment_list, comment_fans, comment_outsiders (security invoker) + comments policy InitPlan form" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: i18n — every new key (additions only)

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts` (parity, non-empty, placeholders, no copy-pasted English) and `tests/ui-standards.test.ts` (rule 6) must pass.

**Interfaces:**
- Produces (exact keys Tasks 7 and 8 read): `pages.account.tab.comments`; the new object `pages.account.commentInsights` with `intro`, `since`, `noScope.{title,body,action}`, `notReady`, `notReadyHint`, `sections.{label,comments,questions,fans,topics,outsiders}`, `toolbar`, `search`, `searchChip`, `commented`, `commentedTitle`, `post`, `allPosts`, `postOption`, `noCaption`, `thisPost`, `postChip`, `only.{label,all,questions,fans}`, `onlyChip.{questions,fans}`, `range`, `people`, `empty`, `emptyHint`, `emptySearch`, `emptyQuestions`, `questionsNote`, `openProfile`, `cols.{username,comments,likes,first,last,postsSince}`, `fans.{toolbar,show,top,new,quiet,topRule,newRule,quietRule,empty}`, `topics.{basis,ruleBased,words,emoji,hashtags,inComments,none,tooFew,tooFewHint}`, `outsiders.{basis,noSnapshot,noSnapshotHint,openFollowers,empty}`, `row.{label,unknownAuthor,openProfile,likes,question,replied,hidden,more,onPost,postGone}`. (Named `commentInsights`, not `comments`: `pages.account.*.comments` keys already exist as metric labels, and Plan 15d can add its own sibling object.)
- Placeholders: `{username}`, `{date}`, `{q}`, `{range}`, `{caption}`, `{first}`/`{last}`/`{total}`, `{days}`/`{min}`/`{posts}`, `{count}` (plural selector in `topics.inComments` and `row.likes`; a formatted number elsewhere), `{authors}`, `{author}`. Every number passed in is already formatted by `formatNumber`, except the plural selectors. `postOption` differs between locales on purpose (`{date} · {caption}` / `{date}｜{caption}`): `tests/messages.test.ts` flags identical values with 4+ ASCII letters, placeholder names included.

- [ ] **Step 1: Insert the keys** — one text edit per file (Edit tool; the anchor line occurs once, at 6-space indentation; every other line stays byte-identical). Use the Edit tool (non-ASCII text: never a shell heredoc).

`messages/en.json` — anchor (line 383):
```json
      "tab": { "overview": "Overview", "growth": "Growth", "posts": "Posts", "stories": "Stories", "followers": "Followers" },
```
replace with:
```json
      "tab": { "overview": "Overview", "growth": "Growth", "posts": "Posts", "stories": "Stories", "comments": "Comments", "followers": "Followers" },
      "commentInsights": {
        "intro": "Comments on your posts and Reels, read every hour for posts of the last 30 days. Stories have no comments here (Story replies are private messages), and replies inside a comment thread are not read yet.",
        "since": "Comments read since {date}.",
        "noScope": {
          "title": "Comments are off for @{username}",
          "body": "This account was connected before in2sight asked for permission to read comments. Reconnect it once and approve every permission; comments then arrive within the hour. Until then nothing is read, so an empty list would not mean there are no comments.",
          "action": "Reconnect to enable comments"
        },
        "notReady": "Comments needs a database update (docs/RUNBOOK_COMMENTS.md §0)",
        "notReadyHint": "Until it is applied, only Topics works here.",
        "sections": { "label": "Comment views", "comments": "All comments", "questions": "Unanswered questions", "fans": "Fans", "topics": "Topics", "outsiders": "Not following you" },
        "toolbar": "Comment filters",
        "search": "Search comments and usernames",
        "searchChip": "Search: {q}",
        "commented": "Commented: {range}",
        "commentedTitle": "Comment date",
        "post": "Post",
        "allPosts": "All posts",
        "postOption": "{date} · {caption}",
        "noCaption": "No caption",
        "thisPost": "This post",
        "postChip": "One post",
        "only": { "label": "Show only", "all": "All comments", "questions": "Questions", "fans": "From fans" },
        "onlyChip": { "questions": "Questions only", "fans": "From fans only" },
        "range": "{first}–{last} of {total} comments",
        "people": "{first}–{last} of {total} people",
        "empty": "No comments in this range yet",
        "emptyHint": "Comments arrive hourly for posts of the last 30 days.",
        "emptySearch": "No comments match these filters",
        "emptyQuestions": "No unanswered questions in this range",
        "questionsNote": "Rule-based: a question mark or a question word (English or Chinese), and no later comment from @{username} that mentions the person. Replies inside a comment thread are not read yet, so a question you answered there can still show here.",
        "openProfile": "Open @{username} on Instagram",
        "cols": { "username": "Username", "comments": "Comments", "likes": "Likes on their comments", "first": "First comment", "last": "Latest comment", "postsSince": "Posts since" },
        "fans": {
          "toolbar": "Fan list",
          "show": "Show",
          "top": "Top fans",
          "new": "New fans",
          "quiet": "Gone quiet",
          "topRule": "Everyone who commented, ranked by comments, then by likes on their comments. Your own comments are left out.",
          "newRule": "First comment in the last {days} days and at least {min} comments.",
          "quietRule": "At least {min} comments, none in the last {days} days, while you published {posts} or more posts since. A signal, not proof: they may still watch without commenting.",
          "empty": "Nobody here yet"
        },
        "topics": {
          "basis": "From the newest {count} comments in this range (yours left out). A term counts once per comment and must come from at least {authors} people.",
          "ruleBased": "Rule-based word counts, no AI; single letters, single characters and common words are skipped.",
          "words": "Words",
          "emoji": "Emoji",
          "hashtags": "Hashtags",
          "inComments": "{count, plural, one {in # comment} other {in # comments}}",
          "none": "Nothing repeats often enough yet",
          "tooFew": "Too few comments for topics",
          "tooFewHint": "At least {min} comments are needed; this range has {count}."
        },
        "outsiders": {
          "basis": "Compared with your follower export of {date} ({count} followers). Snapshot-based: people who followed you after that export show up here too.",
          "noSnapshot": "Upload a follower export first",
          "noSnapshotHint": "This list compares the people who comment with the newest follower list you uploaded in the Followers tab.",
          "openFollowers": "Open Followers",
          "empty": "Everyone who comments follows you in that export"
        },
        "row": {
          "label": "Comment by {author}",
          "unknownAuthor": "Unknown account",
          "openProfile": "Open @{username} on Instagram",
          "likes": "{count, plural, one {# like} other {# likes}}",
          "question": "Question",
          "replied": "Reply seen",
          "hidden": "Hidden",
          "more": "Shortened",
          "onPost": "On your post of {date}",
          "postGone": "The post is no longer listed"
        }
      },
```

`messages/zh-CN.json` — anchor (line 383):
```json
      "tab": { "overview": "概览", "growth": "增长", "posts": "帖子", "stories": "快拍", "followers": "粉丝" },
```
replace with:
```json
      "tab": { "overview": "概览", "growth": "增长", "posts": "帖子", "stories": "快拍", "comments": "评论", "followers": "粉丝" },
      "commentInsights": {
        "intro": "你的帖子和 Reels 收到的评论，每小时读取一次，只读取最近 30 天内发布的帖子。快拍在这里没有评论（快拍回复是私信），评论下的回复暂时不读取。",
        "since": "自 {date} 起读取评论。",
        "noScope": {
          "title": "@{username} 的评论功能未开启",
          "body": "此账号连接时 in2sight 还没有申请读取评论的权限。重新连接一次并同意所有权限，评论会在一小时内出现。在此之前不会读取任何评论，所以列表为空并不代表没有评论。",
          "action": "重新连接以启用评论"
        },
        "notReady": "评论功能需要更新数据库（docs/RUNBOOK_COMMENTS.md §0）",
        "notReadyHint": "更新完成之前，这里只有“话题”可用。",
        "sections": { "label": "评论视图", "comments": "全部评论", "questions": "未回答的问题", "fans": "粉丝榜", "topics": "话题", "outsiders": "未关注你的人" },
        "toolbar": "评论筛选",
        "search": "搜索评论和用户名",
        "searchChip": "搜索：{q}",
        "commented": "评论时间：{range}",
        "commentedTitle": "评论日期",
        "post": "帖子",
        "allPosts": "全部帖子",
        "postOption": "{date}｜{caption}",
        "noCaption": "无文案",
        "thisPost": "此帖子",
        "postChip": "单个帖子",
        "only": { "label": "只显示", "all": "全部评论", "questions": "问题", "fans": "来自粉丝" },
        "onlyChip": { "questions": "只看问题", "fans": "只看粉丝" },
        "range": "第 {first}–{last} 条，共 {total} 条评论",
        "people": "第 {first}–{last} 位，共 {total} 位",
        "empty": "此范围内还没有评论",
        "emptyHint": "最近 30 天内发布的帖子的评论每小时读取一次。",
        "emptySearch": "没有符合这些筛选条件的评论",
        "emptyQuestions": "此范围内没有未回答的问题",
        "questionsNote": "按规则判断：含问号或疑问词（英文或中文），且之后没有 @{username} 提到此人的评论。评论下的回复暂时不读取，所以你在回复里答过的问题仍可能出现在这里。",
        "openProfile": "在 Instagram 上打开 @{username}",
        "cols": { "username": "用户名", "comments": "评论数", "likes": "其评论获得的赞", "first": "首次评论", "last": "最近评论", "postsSince": "此后的帖子" },
        "fans": {
          "toolbar": "粉丝列表",
          "show": "显示",
          "top": "铁粉榜",
          "new": "新粉丝",
          "quiet": "沉寂的粉丝",
          "topRule": "所有评论过的人，按评论数排序，其次按其评论获得的赞。不含你自己的评论。",
          "newRule": "最近 {days} 天内首次评论，且至少 {min} 条评论。",
          "quietRule": "至少 {min} 条评论，最近 {days} 天没有评论，而你在此期间发布了 {posts} 条或更多帖子。这只是信号，不是证据：他们可能仍在看，只是没有评论。",
          "empty": "暂时没有人"
        },
        "topics": {
          "basis": "取自此范围内最新的 {count} 条评论（不含你自己的）。一个词在每条评论里只算一次，且至少来自 {authors} 个人。",
          "ruleBased": "按规则统计词语，不使用 AI；单个字母、单个汉字和常用词会被跳过。",
          "words": "词语",
          "emoji": "表情",
          "hashtags": "话题标签",
          "inComments": "{count, plural, other {出现在 # 条评论中}}",
          "none": "暂时没有经常重复的内容",
          "tooFew": "评论太少，无法分析话题",
          "tooFewHint": "至少需要 {min} 条评论；此范围内有 {count} 条。"
        },
        "outsiders": {
          "basis": "与你 {date} 的粉丝导出文件比较（{count} 位粉丝）。基于快照：在那次导出之后才关注你的人也会出现在这里。",
          "noSnapshot": "请先上传粉丝导出文件",
          "noSnapshotHint": "此列表把评论者与你在“粉丝”标签页上传的最新粉丝名单进行比较。",
          "openFollowers": "打开粉丝",
          "empty": "在那份导出文件中，所有评论者都关注了你"
        },
        "row": {
          "label": "{author} 的评论",
          "unknownAuthor": "未知账号",
          "openProfile": "在 Instagram 上打开 @{username}",
          "likes": "{count, plural, other {# 个赞}}",
          "question": "问题",
          "replied": "已见回复",
          "hidden": "已隐藏",
          "more": "已截断",
          "onPost": "在你 {date} 的帖子下",
          "postGone": "该帖子已不在列表中"
        }
      },
```

(The block ends with `},` because `"followerDiff": {` follows on the next line, unchanged.)

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts tests/account-view.test.tsx` → PASS (the new `tab.comments` label is unused until Task 8; `account-view` still sees five tabs). `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): Comments tab strings (en, zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared types + the question rule (pure)

**Files:**
- Create: `lib/comments/view.ts`, `lib/comments/question.ts`, `tests/comments-question.test.ts`

**Interfaces:**
- Produces: types `CommentPost`, `CommentView` (Plan 15d contract), `Fan`, `Outsider`, `Paged<T>`; constants `COMMENT_PAGE = 50`, `FAN_PAGE = 50`, `TEXT_CAP = 500`, `TOPIC_SAMPLE = 1000`, `FAN_RULES = { fanMin: 3, newFanMin: 2, windowDays: 30, quietPosts: 3 }`; `capText(s, max = TEXT_CAP): { text: string; cut: boolean }`; `QUESTION_PATTERN: string`, `isQuestion(text: string | null): boolean`.

- [ ] **Step 1: Write the failing test** — create `tests/comments-question.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isQuestion, QUESTION_PATTERN } from '@/lib/comments/question';
import { capText, FAN_RULES, TEXT_CAP } from '@/lib/comments/view';

describe('isQuestion', () => {
  it.each([
    ['Where did you buy this?', true],
    ['好看吗？', true],
    ['price？', true], // full-width question mark
    ['❓', true],
    ['How much', true],
    ['how much', true],
    ['WHERE is this', true],
    ['@amy what time does it open', true],
    ['  @amy @bob  can you share the recipe', true],
    ['Is it open today', true],
    ['what', true], // the word at the very end
    ['这个在哪里买', true],
    ['多少钱', true],
    ['有沒有優惠', true],
    ['请问几点开门', true],
  ])('%s → question', (text, want) => expect(isQuestion(text)).toBe(want));

  it.each([
    ['This is great', false], // English words count only at the start
    ['Show me more', false], // "how" inside a word
    ['whatever', false], // a question word must end at a non-letter
    ['Anyway love it', false],
    ['Love it 😍', false],
    ['好看', false],
    ['太棒了！', false],
    ['@what_is_this nice', false], // a mention is skipped, not read as a word
    ['', false],
  ])('%s → not a question', (text, want) => expect(isQuestion(text)).toBe(want));

  it('null is not a question', () => expect(isQuestion(null)).toBe(false));

  it('the pattern uses only syntax shared by JavaScript and PostgreSQL regular expressions (the SQL filter uses it with ~*)', () => {
    expect([...QUESTION_PATTERN.matchAll(/\\(.)/g)].map((m) => m[1])).toEqual(['s', 's']); // the only escape is \s
    expect(QUESTION_PATTERN).not.toMatch(/\(\?|\{\d|\\[bBdDwW]|\[\^?\]/); // no lookarounds, counted repeats, \b \d \w, empty sets
    expect(QUESTION_PATTERN.length).toBeLessThan(400);
  });
});

describe('capText', () => {
  it('keeps short text as it is', () => expect(capText('hello')).toEqual({ text: 'hello', cut: false }));

  it(`cuts at ${TEXT_CAP} code points, never inside an emoji`, () => {
    const long = '😀'.repeat(TEXT_CAP + 1);
    const r = capText(long);
    expect(r.cut).toBe(true);
    expect([...r.text]).toHaveLength(TEXT_CAP);
    expect(r.text.endsWith('😀')).toBe(true);
    expect(capText('abcdef', 3)).toEqual({ text: 'abc', cut: true });
    expect(capText('ab  cd', 3)).toEqual({ text: 'ab', cut: true }); // no trailing space before the ellipsis
  });

  it('the fan rules are the values the UI and the SQL use', () => expect(FAN_RULES).toEqual({ fanMin: 3, newFanMin: 2, windowDays: 30, quietPosts: 3 }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comments-question.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/comments/question"`.

- [ ] **Step 3: Write the two modules** — create `lib/comments/view.ts`:

```ts
// Comment insights (Plan 15c): the shapes the Comments tab shows and the rule values, shared by the readers
// (lib/comments/read.ts), the SQL functions (passed as parameters: one source) and the UI. Pure, no imports.
// Commenter usernames and texts are third-party personal data: owner-only, never logged, never in URLs.

/** The post a comment belongs to (feed post or Reel; Stories have no comments). */
export interface CommentPost {
  id: string;
  type: string; // media_type: IMAGE | CAROUSEL_ALBUM | REELS
  postedAt: string; // ISO
  caption: string | null; // at most 100 characters (the SQL cuts it)
}

/** One comment as the tab shows it. Plan 15d contract: keep these names. */
export interface CommentView {
  id: string;
  mediaId: string;
  authorUsername: string | null;
  text: string; // '' when Instagram sent none
  postedAt: string; // when the comment was written (commented_at), ISO
  likeCount: number | null;
  isQuestion: boolean; // lib/comments/question.ts isQuestion
  hidden: boolean | null; // true only when stored as hidden; null = unknown (Instagram's hidden flag is not read yet)
  repliedByOwner: boolean | null; // true = a later comment of yours @mentions them; null = unknown, never false (thread replies are not read)
  post: CommentPost | null; // null = the post row is gone
}

export interface Fan {
  username: string; // lower-cased
  comments: number;
  likes: number; // likes on their comments, missing as 0
  firstAt: string; // ISO
  lastAt: string; // ISO
  postsSince: number | null; // feed posts published after their latest comment; only for "gone quiet"
}

export interface Outsider {
  username: string; // lower-cased
  comments: number;
  lastAt: string; // ISO
}

/** One server page: the rows, the total over all pages, the page actually read (a page past the end reads page 1). */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
}

export const COMMENT_PAGE = 50;
export const FAN_PAGE = 50;
/** Characters of a comment shown in a row (Instagram allows 2,200). */
export const TEXT_CAP = 500;
/** Comments read for Topics: the newest of the range (one capped read). */
export const TOPIC_SAMPLE = 1000;
/** Fans: a fan has fanMin+ comments; new fan = first comment within windowDays and newFanMin+ comments; gone quiet = fanMin+ comments, none within windowDays, quietPosts+ posts since. */
export const FAN_RULES = { fanMin: 3, newFanMin: 2, windowDays: 30, quietPosts: 3 } as const;

/** At most `max` code points (emoji and other astral characters are never split); `cut` = something was left out. */
export function capText(s: string, max = TEXT_CAP): { text: string; cut: boolean } {
  const cps = [...s];
  return cps.length > max ? { text: cps.slice(0, max).join('').trimEnd(), cut: true } : { text: s, cut: false };
}
```

Create `lib/comments/question.ts` (use the Write tool: non-ASCII):

```ts
// The question rule of the Comments tab (Plan 15c). ONE pattern for both engines: the badge on a row
// (JavaScript RegExp, flag i) and the Questions filter in SQL (comment_list p_question_re, operator ~*). It uses only
// syntax that means the same in both: literals, | ( ) [ ] ^ $ * + and \s. Rule-based, so the UI says so.
//
// A comment is a question when it has a question mark anywhere (? ？ ❓), or STARTS (after @mentions and spaces) with
// an English question word followed by a non-letter or the end, or contains a Chinese question word (simplified and
// traditional) anywhere. English words only at the start: "this is great" / "show me" are not questions.
const EN = ['how', 'what', 'when', 'where', 'why', 'who', 'which', 'whose', 'can', 'could', 'do', 'does', 'did', 'is', 'are', 'will', 'would', 'should', 'any', 'anyone'];
const ZH = ['吗', '嗎', '什么', '什麼', '怎么', '怎麼', '怎样', '怎樣', '为什么', '為什麼', '哪里', '哪裡', '哪儿', '哪个', '哪個', '多少', '几时', '幾時', '是不是', '有没有', '有沒有', '能不能', '可不可以', '请问', '請問'];

export const QUESTION_PATTERN = `[?？❓]|^\\s*(@[a-z0-9._]+\\s+)*(${EN.join('|')})([^a-z]|$)|${ZH.join('|')}`;
const QUESTION_RE = new RegExp(QUESTION_PATTERN, 'i');

export const isQuestion = (text: string | null): boolean => text !== null && QUESTION_RE.test(text);
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/comments-question.test.ts` → PASS (29 tests). Then `npx tsc --noEmit` and `npx eslint lib/comments/view.ts lib/comments/question.ts tests/comments-question.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/comments/view.ts lib/comments/question.ts tests/comments-question.test.ts
git commit -m "feat(comments): shared comment types, fan rules and the question rule" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Topics (pure)

**Files:**
- Create: `lib/comments/topics.ts`, `tests/comments-topics.test.ts`

**Interfaces:**
- Produces: `TopicInput { text: string | null; author: string | null }`, `Term { term; comments }`, `Topics { sample; enough; words; emoji; hashtags }`, `TOPIC_MIN_SAMPLE = 20`, `TOPIC_MIN_COMMENTS = 3`, `TOPIC_MIN_AUTHORS = 2`, `TOPIC_LIMIT = 10`, `STOP_WORDS`, `terms(text)`, `topics(items): Topics`.
- Note: `Intl.Segmenter` output depends on the ICU data of the runtime (Node 24 here, full ICU). The Chinese assertions were checked on this machine's Node (`v24.4.1`); if a future Node splits a word differently, adjust the expected word, never the rule.

- [ ] **Step 1: Write the failing test** — create `tests/comments-topics.test.ts` (Write tool: non-ASCII):

```ts
import { describe, expect, it } from 'vitest';
import { STOP_WORDS, terms, TOPIC_LIMIT, TOPIC_MIN_SAMPLE, topics, type TopicInput } from '@/lib/comments/topics';

/** n filler comments by distinct people that share nothing (single characters only). */
const filler = (n: number): TopicInput[] => Array.from({ length: n }, (_, i) => ({ text: `${'abcdefghijklmnopqrstuvwxyz'[i % 26]}!`, author: `f${i}` }));
const by = (author: string, text: string): TopicInput => ({ author, text });

describe('terms', () => {
  it('Chinese words by Intl.Segmenter; single characters and function words dropped', () => {
    expect([...terms('这个颜色好漂亮').words]).toEqual(['颜色', '漂亮']);
    expect([...terms('照片在哪里拍的？').words]).toEqual(expect.arrayContaining(['照片', '哪里']));
    expect([...terms('咖啡好喝').words]).toEqual(['咖啡', '好喝']);
  });

  it('English: lower-cased, once per comment, stop words, digits, mentions and links left out', () => {
    expect([...terms('love love LOVE the colours').words]).toEqual(['love', 'colours']);
    expect([...terms('@amy look https://x.co/a 123 2026').words]).toEqual(['look']);
    expect(STOP_WORDS.has('the') && STOP_WORDS.has('我们')).toBe(true);
  });

  it('hashtags (kept with #, lower-cased, not also words) and emoji (one code point, so ❤️ and ❤ are one)', () => {
    const t = terms('Love it #Penang #food_trip ❤️❤ 😍');
    expect([...t.hashtags]).toEqual(['#penang', '#food_trip']);
    expect([...t.emoji]).toEqual(['❤', '😍']);
    expect([...t.words]).toEqual(['love']);
  });

  it('text is never interpreted: markup is just characters', () => {
    expect([...terms('<script>alert(1)</script>').words]).toEqual(['script', 'alert']);
  });
});

describe('topics', () => {
  it(`fewer than ${TOPIC_MIN_SAMPLE} comments: not enough, nothing listed`, () => {
    const r = topics([...filler(TOPIC_MIN_SAMPLE - 4), by('a', '颜色'), by('b', '颜色'), by('c', '颜色')]);
    expect(r).toEqual({ sample: TOPIC_MIN_SAMPLE - 1, enough: false, words: [], emoji: [], hashtags: [] });
  });

  it('a term needs 3 comments from 2+ people; counts are comments, not repeats; most first, then the term', () => {
    const r = topics([
      ...filler(20),
      by('a', '这个颜色好漂亮 😍'),
      by('b', '颜色真的很漂亮！😍😍😍'),
      by('c', '颜色 colours #penang'),
      by('d', 'colours #penang'),
      by('d', 'colours #Penang 😍'),
      by('e', 'spam spam spam'),
      by('e', 'spam'),
      by('e', 'spam'), // 3 comments but one person: not a topic
    ]);
    expect(r.sample).toBe(28);
    expect(r.enough).toBe(true);
    expect(r.words).toEqual([
      { term: 'colours', comments: 3 },
      { term: '颜色', comments: 3 },
    ]);
    expect(r.emoji).toEqual([{ term: '😍', comments: 3 }]);
    expect(r.hashtags).toEqual([{ term: '#penang', comments: 3 }]);
  });

  it(`at most ${TOPIC_LIMIT} per kind; unknown authors count as different people; empty texts are skipped`, () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${String.fromCharCode(97 + i)}x`);
    const items: TopicInput[] = [...filler(20), { text: null, author: 'z' }];
    for (const w of words) for (let k = 0; k < 3; k++) items.push({ text: w, author: null });
    const r = topics(items);
    expect(r.words).toHaveLength(TOPIC_LIMIT);
    expect(r.words[0]).toEqual({ term: 'wordax', comments: 3 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comments-topics.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/comments/topics"`.

- [ ] **Step 3: Write the module** — create `lib/comments/topics.ts` (Write tool: non-ASCII):

```ts
// Recurring topics in comments (Plan 15c): rule-based word, emoji and hashtag counts, no AI. Pure.
// Words come from Intl.Segmenter (built in; dictionary-based for Chinese, so 照片 / 哪里 are words), English and Chinese
// in one pass. A term counts once per comment and must come from TOPIC_MIN_COMMENTS comments by TOPIC_MIN_AUTHORS
// different people, so one person repeating themselves never makes a topic. Below TOPIC_MIN_SAMPLE comments: no topics.

export interface TopicInput {
  text: string | null;
  author: string | null; // lower-cased username; null = unknown (counted as its own person)
}
export interface Term {
  term: string;
  comments: number; // comments that contain it
}
export interface Topics {
  sample: number; // comments read
  enough: boolean; // sample >= TOPIC_MIN_SAMPLE
  words: Term[];
  emoji: Term[];
  hashtags: Term[];
}

export const TOPIC_MIN_SAMPLE = 20;
export const TOPIC_MIN_COMMENTS = 3;
export const TOPIC_MIN_AUTHORS = 2;
export const TOPIC_LIMIT = 10;

// Words that say nothing about a topic. Single letters and single Chinese characters (的, 了, 我 …) are dropped by length.
// prettier-ignore
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'you', 'your', 'yours', 'this', 'that', 'these', 'those', 'with', 'for', 'from', 'are', 'was', 'were', 'is', 'it', 'its', "it's",
  'so', 'my', 'me', 'mine', 'we', 'our', 'us', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'to', 'of', 'in', 'on', 'at', 'by', 'be',
  'been', 'am', 'an', 'or', 'as', 'if', 'do', 'does', 'did', 'have', 'has', 'had', 'not', 'no', 'but', 'just', 'all', 'can', 'will', 'would',
  'what', 'how', 'when', 'where', 'why', 'who', 'which', 'there', 'here', 'too', 'very', 'really', 'more', 'some', 'any', 'one', 'get', 'got',
  'im', "i'm", 'u', 'ur', 'pls', 'please', 'haha', 'hahaha', 'lol', 'omg', 'yes', 'yeah', 'ok', 'okay',
  '我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里', '没有', '一个', '什么', '怎么', '可以', '不是',
  '就是', '真的', '自己', '因为', '所以', '但是', '还是', '已经', '然后', '那么', '还有', '一下', '一样', '大家', '现在', '时候', '哈哈', '哈哈哈',
  '嘻嘻', '呵呵', '谢谢', '好的',
]);

const URL_RE = /https?:\/\/\S+/giu;
const MENTION_RE = /@[\p{L}\p{N}._]+/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const DIGITS_RE = /^\p{N}+$/u;
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/** The distinct terms of one comment, lower-cased. */
export function terms(text: string): { words: Set<string>; emoji: Set<string>; hashtags: Set<string> } {
  const t = text.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ');
  const hashtags = new Set(t.match(HASHTAG_RE) ?? []);
  const emoji = new Set(t.match(EMOJI_RE) ?? []);
  const words = new Set<string>();
  for (const s of segmenter.segment(t.replace(HASHTAG_RE, ' '))) {
    const w = s.segment;
    if (s.isWordLike && [...w].length >= 2 && !DIGITS_RE.test(w) && !STOP_WORDS.has(w)) words.add(w);
  }
  return { words, emoji, hashtags };
}

type Kind = 'words' | 'emoji' | 'hashtags';

/** Top terms per kind: in TOPIC_MIN_COMMENTS+ comments by TOPIC_MIN_AUTHORS+ people, most comments first, then the term. */
export function topics(items: TopicInput[]): Topics {
  const sample = items.length;
  const enough = sample >= TOPIC_MIN_SAMPLE;
  const empty = { sample, enough, words: [], emoji: [], hashtags: [] };
  if (!enough) return empty;
  const seen: Record<Kind, Map<string, { comments: number; authors: Set<string> }>> = { words: new Map(), emoji: new Map(), hashtags: new Map() };
  items.forEach((it, i) => {
    if (!it.text) return;
    const author = it.author ?? `\u0000${i}`; // an unknown author is nobody else
    const found = terms(it.text);
    for (const kind of ['words', 'emoji', 'hashtags'] as const)
      for (const term of found[kind]) {
        const e = seen[kind].get(term) ?? { comments: 0, authors: new Set<string>() };
        e.comments += 1;
        e.authors.add(author);
        seen[kind].set(term, e);
      }
  });
  const top = (kind: Kind): Term[] =>
    [...seen[kind]]
      .filter(([, e]) => e.comments >= TOPIC_MIN_COMMENTS && e.authors.size >= TOPIC_MIN_AUTHORS)
      .map(([term, e]) => ({ term, comments: e.comments }))
      .sort((a, b) => b.comments - a.comments || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
      .slice(0, TOPIC_LIMIT);
  return { sample, enough, words: top('words'), emoji: top('emoji'), hashtags: top('hashtags') };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/comments-topics.test.ts` → PASS (7 tests). Then `npx tsc --noEmit` and `npx eslint lib/comments/topics.ts tests/comments-topics.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/comments/topics.ts tests/comments-topics.test.ts
git commit -m "feat(comments): rule-based topics (words via Intl.Segmenter, emoji, hashtags; min-sample guard)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: URL state (pure)

**Files:**
- Create: `lib/comments/state.ts`, `tests/comments-state.test.ts`
- Modify: `lib/dashboard/lists.ts` (export two existing helpers; no behaviour change)
- Existing tests that must keep passing: `tests/lists.test.ts`, `tests/posted-filter.test.tsx`.

**Interfaces:**
- Consumes: `cleanSearch`, `listHref`, `ListDates`, `ALL_TIME`, `LIST_KEYS`, and (exported by this task) `parseDates(sp)`, `dateParams(d)` from `lib/dashboard/lists.ts`.
- Produces: `COMMENT_SECTIONS`, `CommentSection`, `FAN_MODES`, `FanMode`, `COMMENT_ONLY`, `CommentOnly`, `CommentState`, `COMMENT_KEYS = ['section', 'media', 'only', 'fans']`, `parseCommentState(sp)`, `commentHref(s, patch, keep = {})`.

- [ ] **Step 1: Export the two helpers** — in `lib/dashboard/lists.ts` make exactly two anchored edits:
  - `function parseDates(sp: Params): ListDates {` → `export function parseDates(sp: Params): ListDates {`
  - `const dateParams = (d: ListDates): Record<string, string> =>` → `export const dateParams = (d: ListDates): Record<string, string> =>` (the rest of that line unchanged)

- [ ] **Step 2: Write the failing test** — create `tests/comments-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COMMENT_KEYS, commentHref, parseCommentState, type CommentState } from '@/lib/comments/state';
import { ALL_TIME, LIST_KEYS } from '@/lib/dashboard/lists';

const DEFAULT: CommentState = { section: 'comments', dates: ALL_TIME, q: '', media: null, only: null, fans: 'top', page: 1 };

describe('parseCommentState', () => {
  it('defaults: All comments, All time, no filters, top fans, page 1', () => expect(parseCommentState({})).toEqual(DEFAULT));

  it('reads every key', () => {
    expect(parseCommentState({ section: 'fans', pr: '30d', q: '  where   to buy ', media: '17895695668004550', only: 'questions', fans: 'quiet', page: '3' })).toEqual({
      section: 'fans',
      dates: { pr: '30d', from: null, to: null },
      q: 'where to buy',
      media: '17895695668004550',
      only: 'questions',
      fans: 'quiet',
      page: 3,
    });
    expect(parseCommentState({ pfrom: '2026-10-09', pto: '2026-10-01' }).dates).toEqual({ pr: null, from: '2026-10-01', to: '2026-10-09' }); // swapped into order
  });

  it('drops hostile or unknown values (never echoed)', () => {
    expect(
      parseCommentState({ section: 'admin', media: '12; drop table', only: 'all', fans: ['new', 'quiet'], page: '0', q: ['a', 'b'], pr: '7days' }),
    ).toEqual(DEFAULT);
    expect(parseCommentState({ media: '1'.repeat(33), page: '1e3' })).toEqual(DEFAULT);
    expect(parseCommentState({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });
});

describe('commentHref', () => {
  it('fixed order, defaults left out, page back to 1 on any change', () => {
    const s: CommentState = { ...DEFAULT, section: 'questions', dates: { pr: '7d', from: null, to: null }, q: 'price', media: '42', only: 'fans', page: 4 };
    expect(commentHref(s, {})).toBe('?tab=comments&section=questions&pr=7d&q=price&media=42&only=fans');
    expect(commentHref(s, { page: 5 })).toBe('?tab=comments&section=questions&pr=7d&q=price&media=42&only=fans&page=5');
    expect(commentHref(s, { section: 'comments', q: '', media: null, only: null, dates: ALL_TIME })).toBe('?tab=comments');
    expect(commentHref({ ...DEFAULT, section: 'fans' }, { fans: 'new' })).toBe('?tab=comments&section=fans&fans=new');
  });

  it('a section change keeps the other filters (rule 3) and custom dates win', () => {
    const s: CommentState = { ...DEFAULT, q: 'cake', dates: { pr: null, from: '2026-10-01', to: null } };
    expect(commentHref(s, { section: 'topics' })).toBe('?tab=comments&section=topics&pfrom=2026-10-01&q=cake');
  });

  it('the Time Scope rides along but never overrides the tab’s own params', () => {
    expect(commentHref({ ...DEFAULT, q: 'a b' }, {}, { from: '90d', q: 'evil', tab: 'posts' })).toBe('?tab=comments&q=a+b&from=90d');
  });

  it('its own keys are disjoint from the list keys (both are left out of the Suspense key)', () => {
    expect(COMMENT_KEYS.filter((k) => (LIST_KEYS as readonly string[]).includes(k))).toEqual([]);
    for (const k of ['pr', 'pfrom', 'pto', 'q', 'page']) expect(LIST_KEYS).toContain(k);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/comments-state.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/comments/state"`.

- [ ] **Step 4: Write the module** — create `lib/comments/state.ts`:

```ts
// URL state of the Comments tab (Plan 15c; docs/UI_STANDARDS.md rule 3: the URL is the state). Parsed on the server,
// every value validated, invalid ones dropped (never echoed back). The comment-date filter reuses the list keys of
// Plan 14b (pr | pfrom | pto), so PostedFilter works unchanged. Pure.
import { cleanSearch, dateParams, listHref, parseDates, type ListDates } from '@/lib/dashboard/lists';

type Params = Record<string, string | string[] | undefined>;

export const COMMENT_SECTIONS = ['comments', 'questions', 'fans', 'topics', 'outsiders'] as const;
export type CommentSection = (typeof COMMENT_SECTIONS)[number];
export const FAN_MODES = ['top', 'new', 'quiet'] as const;
export type FanMode = (typeof FAN_MODES)[number];
export const COMMENT_ONLY = ['questions', 'fans'] as const;
export type CommentOnly = (typeof COMMENT_ONLY)[number];

export interface CommentState {
  section: CommentSection;
  dates: ListDates; // the comment date (owner timezone days)
  q: string; // '' = no search
  media: string | null; // one post (Instagram media id, digits)
  only: CommentOnly | null; // All comments: only questions / only fans
  fans: FanMode;
  page: number; // 1-based
}

/** The tab's own URL keys besides LIST_KEYS (pr, pfrom, pto, q, page): the page's Suspense key ignores both. */
export const COMMENT_KEYS = ['section', 'media', 'only', 'fans'] as const;

const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);
const pick = <T extends string>(all: readonly T[], v: string | null): T | null => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : null);

export function parseCommentState(sp: Params): CommentState {
  const media = one(sp.media);
  const page = one(sp.page);
  return {
    section: pick(COMMENT_SECTIONS, one(sp.section)) ?? 'comments',
    dates: parseDates(sp),
    q: cleanSearch(one(sp.q)),
    media: media !== null && /^\d{1,32}$/.test(media) ? media : null,
    only: pick(COMMENT_ONLY, one(sp.only)),
    fans: pick(FAN_MODES, one(sp.fans)) ?? 'top',
    page: page !== null && /^\d{1,6}$/.test(page) && Number(page) >= 1 ? Number(page) : 1,
  };
}

/** A link inside the tab: the patch applied, page back to 1 unless patched, defaults left out, fixed order; `keep` = the Time Scope params (never override the tab's own). */
export function commentHref(s: CommentState, patch: Partial<CommentState>, keep: Record<string, string> = {}): string {
  const n = { ...s, page: 1, ...patch };
  const p: Record<string, string> = {
    tab: 'comments',
    ...(n.section !== 'comments' ? { section: n.section } : {}),
    ...dateParams(n.dates),
    ...(n.q ? { q: n.q } : {}),
    ...(n.media ? { media: n.media } : {}),
    ...(n.only ? { only: n.only } : {}),
    ...(n.fans !== 'top' ? { fans: n.fans } : {}),
    ...(n.page > 1 ? { page: String(n.page) } : {}),
  };
  for (const [k, v] of Object.entries(keep)) if (!(k in p)) p[k] = v;
  return listHref(p);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/comments-state.test.ts tests/lists.test.ts tests/posted-filter.test.tsx` → PASS (8 new tests; the others unchanged). Then `npx tsc --noEmit` and `npx eslint lib/comments/state.ts lib/dashboard/lists.ts tests/comments-state.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/comments/state.ts tests/comments-state.test.ts lib/dashboard/lists.ts
git commit -m "feat(comments): Comments tab URL state (sections, comment date, search, post, only, fan mode, page)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Readers + privacy guard

**Files:**
- Create: `lib/comments/read.ts`, `tests/comments-read.test.ts`, `tests/comments-privacy.test.ts`
- Existing tests that must keep passing: `tests/followers-privacy.test.ts` (this module never names `follower_exports`), `tests/sync-comments.test.ts`.

**Interfaces:**
- Consumes: Task 1's function names and columns (by name only; the migration is not applied anywhere), Task 3 (`isQuestion`, `QUESTION_PATTERN`, types, constants), Task 4 (`TopicInput`), Task 5 (`FanMode`), `MISSING_FUNCTION` (`lib/dashboard/read.ts`).
- Produces (Task 8 calls exactly these; all take the OWNER-SESSION client):
  - `toCommentView(row): CommentView`
  - `CommentPageArgs { fromIso; toIso; q; media; questions; unanswered; fansOnly; owner; page }`
  - `loadCommentPage(db, accountId, a: CommentPageArgs): Promise<Paged<CommentView> | null>`
  - `loadFans(db, accountId, { owner, mode, now, page }): Promise<Paged<Fan> | null>`
  - `loadOutsiders(db, accountId, { owner, page }): Promise<Paged<Outsider> | null>`
  - `loadTopicSample(db, accountId, { fromIso, toIso, owner }): Promise<TopicInput[]>`
  - `loadCommentPosts(db, accountId): Promise<CommentPost[]>`
  - `loadCommentStart(db, accountId): Promise<string | null>`
  - `null` = the SQL function is missing (`PGRST202` / `42883`); every other error throws `comments <op> failed` (fixed text).

- [ ] **Step 1: Write the failing tests** — create `tests/comments-read.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QUESTION_PATTERN } from '@/lib/comments/question';
import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample, toCommentView, type CommentPageArgs } from '@/lib/comments/read';
import { COMMENT_PAGE, FAN_PAGE, TOPIC_SAMPLE } from '@/lib/comments/view';

type Op = unknown[];
const calls: Op[] = [];
const queue: { data?: unknown; error?: unknown }[] = [];
const next = () => Promise.resolve(queue.shift() ?? { data: [], error: null });

/** Owner-session fake: records every call; each awaited query or rpc resolves to the next queued result. */
function fakeDb(): SupabaseClient {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(['rpc', fn, args]);
      return next();
    },
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SECRET = { code: 'XX000', message: 'row contains alice.secret' };
const ARGS: CommentPageArgs = { fromIso: '2026-09-30T16:00:00.000Z', toIso: '2026-10-25T16:00:00.000Z', q: '', media: null, questions: false, unanswered: false, fansOnly: false, owner: 'me', page: 1 };
const ROW = { id: '1801', media_id: '1790', author_username: 'amy', body: 'Where is this?', like_count: 2, commented_at: '2026-10-20T08:00:00+00:00', hidden: false, replied: false, media_type: 'REELS', posted_at: '2026-10-19T10:00:00+00:00', caption: 'Penang trip', n: 1, total: 3 };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});

describe('toCommentView', () => {
  it('maps a comment_list row; the question badge is the rule; false hidden / replied are unknown (null), never false', () => {
    expect(toCommentView(ROW)).toEqual({
      id: '1801',
      mediaId: '1790',
      authorUsername: 'amy',
      text: 'Where is this?',
      postedAt: '2026-10-20T08:00:00+00:00',
      likeCount: 2,
      isQuestion: true,
      hidden: null,
      repliedByOwner: null,
      post: { id: '1790', type: 'REELS', postedAt: '2026-10-19T10:00:00+00:00', caption: 'Penang trip' },
    });
    expect(toCommentView({ ...ROW, hidden: true, replied: true })).toMatchObject({ hidden: true, repliedByOwner: true });
    expect(toCommentView({ ...ROW, body: null, author_username: null, like_count: null, posted_at: null })).toMatchObject({ text: '', authorUsername: null, likeCount: null, isQuestion: false, post: null });
  });
});

describe('loadCommentPage', () => {
  it('calls comment_list with the filters; no filter = nulls; the page and the total', async () => {
    queue.push({ data: [ROW], error: null });
    expect(await loadCommentPage(fakeDb(), ACC, ARGS)).toEqual({ rows: [toCommentView(ROW)], total: 3, page: 1 });
    expect(calls).toEqual([
      ['rpc', 'comment_list', { p_account: ACC, p_from: ARGS.fromIso, p_to: ARGS.toIso, p_q: null, p_media: null, p_question_re: null, p_unanswered: false, p_fan_min: null, p_owner: 'me', p_offset: 0, p_limit: COMMENT_PAGE }],
    ]);
  });

  it('questions pass the ONE question pattern; fans pass the fan minimum; page 3 is offset 100', async () => {
    queue.push({ data: [ROW], error: null });
    await loadCommentPage(fakeDb(), ACC, { ...ARGS, q: 'where', media: '1790', questions: true, unanswered: true, fansOnly: true, page: 3 });
    expect(calls[0][2]).toMatchObject({ p_q: 'where', p_media: '1790', p_question_re: QUESTION_PATTERN, p_unanswered: true, p_fan_min: 3, p_offset: 100, p_limit: 50 });
  });

  it('a page past the end reads page 1 again', async () => {
    queue.push({ data: [], error: null }, { data: [ROW], error: null });
    expect((await loadCommentPage(fakeDb(), ACC, { ...ARGS, page: 9 }))?.page).toBe(1);
    expect(calls.map((c) => (c[2] as { p_offset: number }).p_offset)).toEqual([400, 0]);
  });

  it('function missing (migration not applied) → null; any other error → a fixed message that never echoes the database', async () => {
    for (const code of ['PGRST202', '42883']) {
      queue.push({ data: null, error: { code } });
      expect(await loadCommentPage(fakeDb(), ACC, ARGS)).toBeNull();
    }
    queue.push({ data: null, error: SECRET });
    await expect(loadCommentPage(fakeDb(), ACC, ARGS)).rejects.toThrow(/^comments comment_list failed$/);
  });
});

describe('loadFans / loadOutsiders', () => {
  it('comment_fans gets the mode, the clock and the fan rules; bigint counts arrive as strings or numbers', async () => {
    queue.push({ data: [{ username: 'amy', comments: '12', likes: 30, first_at: '2026-08-01T00:00:00Z', last_at: '2026-10-20T00:00:00Z', posts_since: null, n: 1, total: '7' }], error: null });
    const now = new Date('2026-10-25T08:00:00Z');
    expect(await loadFans(fakeDb(), ACC, { owner: 'me', mode: 'quiet', now, page: 2 })).toEqual({
      rows: [{ username: 'amy', comments: 12, likes: 30, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-10-20T00:00:00Z', postsSince: null }],
      total: 7,
      page: 2,
    });
    expect(calls[0]).toEqual(['rpc', 'comment_fans', { p_account: ACC, p_owner: 'me', p_mode: 'quiet', p_now: '2026-10-25T08:00:00.000Z', p_fan_min: 3, p_new_min: 2, p_days: 30, p_quiet_posts: 3, p_offset: FAN_PAGE, p_limit: FAN_PAGE }]);
  });

  it('comment_outsiders: the page; null when missing', async () => {
    queue.push({ data: [{ username: 'bob', comments: 4, last_at: '2026-10-01T00:00:00Z', n: 1, total: 1 }], error: null });
    expect(await loadOutsiders(fakeDb(), ACC, { owner: 'me', page: 1 })).toEqual({ rows: [{ username: 'bob', comments: 4, lastAt: '2026-10-01T00:00:00Z' }], total: 1, page: 1 });
    expect(calls[0]).toEqual(['rpc', 'comment_outsiders', { p_account: ACC, p_owner: 'me', p_offset: 0, p_limit: FAN_PAGE }]);
    queue.push({ data: null, error: { code: 'PGRST202' } });
    expect(await loadOutsiders(fakeDb(), ACC, { owner: 'me', page: 1 })).toBeNull();
  });
});

describe('table reads (work before the migration)', () => {
  it('loadTopicSample: the newest comments of the window, capped, the owner left out, names lower-cased', async () => {
    queue.push({ data: [{ text: 'Nice', author_username: 'Amy' }, { text: 'thanks!', author_username: 'ME' }, { text: null, author_username: null }], error: null });
    expect(await loadTopicSample(fakeDb(), ACC, { fromIso: 'F', toIso: 'T', owner: 'me' })).toEqual([{ text: 'Nice', author: 'amy' }, { text: null, author: null }]);
    expect(calls).toEqual([
      ['from', 'comments'],
      ['select', 'text,author_username'],
      ['eq', 'account_id', ACC],
      ['gte', 'commented_at', 'F'],
      ['lt', 'commented_at', 'T'],
      ['order', 'commented_at', { ascending: false }],
      ['limit', TOPIC_SAMPLE],
    ]);
  });

  it('loadCommentPosts: the newest 50 feed posts with comments; loadCommentStart: the earliest first_seen_at', async () => {
    queue.push({ data: [{ id: '1790', media_type: 'IMAGE', posted_at: '2026-10-19T10:00:00Z', caption: null }], error: null });
    expect(await loadCommentPosts(fakeDb(), ACC)).toEqual([{ id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: null }]);
    expect(calls.slice(1)).toEqual([
      ['select', 'id,media_type,posted_at,caption'],
      ['eq', 'account_id', ACC],
      ['neq', 'media_type', 'STORY'],
      ['gt', 'comments_count', 0],
      ['order', 'posted_at', { ascending: false }],
      ['limit', 50],
    ]);
    calls.length = 0;
    queue.push({ data: [{ first_seen_at: '2026-10-02T03:00:00Z' }], error: null }, { data: [], error: null });
    expect(await loadCommentStart(fakeDb(), ACC)).toBe('2026-10-02T03:00:00Z');
    expect(await loadCommentStart(fakeDb(), ACC)).toBeNull();
    expect(calls.slice(0, 5)).toEqual([['from', 'comments'], ['select', 'first_seen_at'], ['eq', 'account_id', ACC], ['order', 'first_seen_at', { ascending: true }], ['limit', 1]]);
  });

  it('errors are fixed texts', async () => {
    queue.push({ data: null, error: SECRET }, { data: null, error: SECRET }, { data: null, error: SECRET });
    await expect(loadTopicSample(fakeDb(), ACC, { fromIso: 'F', toIso: 'T', owner: 'me' })).rejects.toThrow(/^comments topics failed$/);
    await expect(loadCommentPosts(fakeDb(), ACC)).rejects.toThrow(/^comments posts failed$/);
    await expect(loadCommentStart(fakeDb(), ACC)).rejects.toThrow(/^comments start failed$/);
  });
});
```

Create `tests/comments-privacy.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Commenter usernames and comment texts (Plan 11b ingest, Plan 15c insights) are third-party personal data: owner-only,
// never logged, never through the admin client outside the sync, never in another export. These guards hold for every
// file that exists now and every later one (Plan 15d's moderation files included).
const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, code(readFileSync(join(root, f), 'utf8'))] as const);
/** Files that handle comments: lib/comments/* and everything that imports from it. */
const commentFiles = src.filter(([f, s]) => f.startsWith('lib/comments/') || /from '@\/lib\/comments\//.test(s));

describe('comments privacy', () => {
  it("only lib/comments/read.ts (reads) and lib/sync/store.ts (the sync's writes) query the comments table", () => {
    expect(src.filter(([, s]) => /\.from\(\s*['"]comments['"]\s*\)/.test(s)).map(([f]) => f)).toEqual(['lib/comments/read.ts', 'lib/sync/store.ts']);
  });

  it('only lib/comments/read.ts calls the comment_* functions', () => {
    expect(src.filter(([, s]) => /['"]comment_(list|fans|outsiders)['"]/.test(s)).map(([f]) => f)).toEqual(['lib/comments/read.ts']);
  });

  it('no file that handles comments logs anything but one fixed string', () => {
    expect(commentFiles.length).toBeGreaterThanOrEqual(5);
    for (const [f, s] of commentFiles) {
      expect(s, f).not.toMatch(/console\.(log|info|warn|debug|trace|dir|table)\s*\(/);
      for (const m of s.matchAll(/console\.error\s*\(([^)]*)\)/g)) expect(m[1], f).toMatch(/^'[^'`$]*'$/);
    }
  });

  it('reads and UI never use the admin client or account_tokens; nothing renders comment text as HTML', () => {
    // a server-only moderation module (Plan 15d) may need the token; the readers and every component never do
    for (const [f, s] of commentFiles) {
      if (f.startsWith('lib/comments/') || f.startsWith('components/')) expect(s, f).not.toMatch(/lib\/supabase\/admin|createAdminSupabase|account_tokens/);
      expect(s, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it('the account exports (Excel workbook, PDF report), the sync, alerts and push never touch comment insights', () => {
    for (const [f, s] of src)
      if (/^lib\/(export\/|sync\/|alerts\/|push\/)/.test(f) || f.startsWith('app/api/cron/') || f.startsWith('app/api/export/')) expect(s, f).not.toMatch(/lib\/comments\//);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/comments-read.test.ts tests/comments-privacy.test.ts`
Expected: FAIL — `comments-read`: `Failed to resolve import "@/lib/comments/read"`; `comments-privacy`: the first test lists `['lib/sync/store.ts']` instead of `['lib/comments/read.ts', 'lib/sync/store.ts']`, the second lists `[]`.

- [ ] **Step 3: Write the module** — create `lib/comments/read.ts`:

```ts
// Reads of the Comments tab (Plan 15c, READ-ONLY). Besides the sync store (lib/sync/store.ts, which writes), the ONLY
// module that names the comments table and the comment_* functions (tests/comments-privacy.test.ts). Owner-session
// client only: RLS (comments_owner_select, is_owner()) applies, inside the security-invoker functions too; never the
// admin client. Every read is filtered by the account id. Errors are fixed texts: a Supabase error can echo row values,
// i.e. third-party usernames and comment texts. Nothing here logs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isQuestion, QUESTION_PATTERN } from '@/lib/comments/question';
import type { FanMode } from '@/lib/comments/state';
import type { TopicInput } from '@/lib/comments/topics';
import { COMMENT_PAGE, FAN_PAGE, FAN_RULES, TOPIC_SAMPLE, type CommentPost, type CommentView, type Fan, type Outsider, type Paged } from '@/lib/comments/view';
import { MISSING_FUNCTION } from '@/lib/dashboard/read';

type Row = Record<string, unknown>;
const missing = (e: unknown): boolean => MISSING_FUNCTION.includes(String((e as { code?: unknown } | null)?.code));
const fail = (op: string): never => {
  throw new Error(`comments ${op} failed`);
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null); // bigint arrives as a number or a string
const offset = (page: number, size: number) => (page - 1) * size;

/** One page from a comment_* function; a page past the end is read again as page 1; null = the function is missing. */
async function paged<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>, page: number, size: number, map: (r: Row) => T): Promise<Paged<T> | null> {
  const { data, error } = await db.rpc(fn, { ...args, p_offset: offset(page, size), p_limit: size });
  if (error) return missing(error) ? null : fail(fn);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0 && page > 1) return paged(db, fn, args, 1, size, map);
  return { rows: rows.map(map), total: num(rows[0]?.total) ?? 0, page };
}

export const toCommentView = (r: Row): CommentView => {
  const text = str(r.body) ?? '';
  const postedAt = str(r.posted_at);
  return {
    id: String(r.id),
    mediaId: String(r.media_id),
    authorUsername: str(r.author_username),
    text,
    postedAt: String(r.commented_at),
    likeCount: num(r.like_count),
    isQuestion: isQuestion(text),
    hidden: r.hidden === true ? true : null, // the column defaults to false and Instagram's flag is not read yet: false is not data
    repliedByOwner: r.replied === true ? true : null, // no reply SEEN is not "unanswered" (thread replies are not read)
    post: postedAt ? { id: String(r.media_id), type: String(r.media_type), postedAt, caption: str(r.caption) } : null,
  };
};

export interface CommentPageArgs {
  fromIso: string;
  toIso: string;
  q: string; // '' = no search
  media: string | null;
  questions: boolean; // only comments that match the question rule
  unanswered: boolean; // only comments with no reply seen (and not the owner's own)
  fansOnly: boolean; // only authors with FAN_RULES.fanMin+ comments
  owner: string; // the account's username, lower-cased
  page: number;
}

/** One page of comments, newest first, by comment_list (migration 20261029000001). null = not applied yet. */
export const loadCommentPage = (db: SupabaseClient, accountId: string, a: CommentPageArgs): Promise<Paged<CommentView> | null> =>
  paged(
    db,
    'comment_list',
    {
      p_account: accountId,
      p_from: a.fromIso,
      p_to: a.toIso,
      p_q: a.q || null,
      p_media: a.media,
      p_question_re: a.questions ? QUESTION_PATTERN : null,
      p_unanswered: a.unanswered,
      p_fan_min: a.fansOnly ? FAN_RULES.fanMin : null,
      p_owner: a.owner,
    },
    a.page,
    COMMENT_PAGE,
    toCommentView,
  );

/** One page of commenters by comment_fans: top, new or gone quiet (FAN_RULES). null = not applied yet. */
export const loadFans = (db: SupabaseClient, accountId: string, a: { owner: string; mode: FanMode; now: Date; page: number }): Promise<Paged<Fan> | null> =>
  paged(
    db,
    'comment_fans',
    {
      p_account: accountId,
      p_owner: a.owner,
      p_mode: a.mode,
      p_now: a.now.toISOString(),
      p_fan_min: FAN_RULES.fanMin,
      p_new_min: FAN_RULES.newFanMin,
      p_days: FAN_RULES.windowDays,
      p_quiet_posts: FAN_RULES.quietPosts,
    },
    a.page,
    FAN_PAGE,
    (r) => ({ username: String(r.username), comments: num(r.comments) ?? 0, likes: num(r.likes) ?? 0, firstAt: String(r.first_at), lastAt: String(r.last_at), postsSince: num(r.posts_since) }),
  );

/** One page of commenters missing from the newest follower export, by comment_outsiders. null = not applied yet. */
export const loadOutsiders = (db: SupabaseClient, accountId: string, a: { owner: string; page: number }): Promise<Paged<Outsider> | null> =>
  paged(db, 'comment_outsiders', { p_account: accountId, p_owner: a.owner }, a.page, FAN_PAGE, (r) => ({ username: String(r.username), comments: num(r.comments) ?? 0, lastAt: String(r.last_at) }));

/** Topics input: the newest TOPIC_SAMPLE comments written in [fromIso, toIso), the owner's own left out (plain table read: works before the migration). */
export async function loadTopicSample(db: SupabaseClient, accountId: string, a: { fromIso: string; toIso: string; owner: string }): Promise<TopicInput[]> {
  const { data, error } = await db
    .from('comments')
    .select('text,author_username')
    .eq('account_id', accountId)
    .gte('commented_at', a.fromIso)
    .lt('commented_at', a.toIso)
    .order('commented_at', { ascending: false })
    .limit(TOPIC_SAMPLE);
  if (error) return fail('topics');
  return ((data ?? []) as Row[]).flatMap((r) => {
    const author = str(r.author_username)?.toLowerCase() ?? null;
    return author === a.owner ? [] : [{ text: str(r.text), author }];
  });
}

/** The post filter's choices: the newest 50 feed posts / Reels that have comments. */
export async function loadCommentPosts(db: SupabaseClient, accountId: string): Promise<CommentPost[]> {
  const { data, error } = await db
    .from('media')
    .select('id,media_type,posted_at,caption')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .gt('comments_count', 0)
    .order('posted_at', { ascending: false })
    .limit(50);
  if (error) return fail('posts');
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), type: String(r.media_type), postedAt: String(r.posted_at), caption: str(r.caption) }));
}

/** When comments were first read for this account (the earliest first_seen_at); null = none yet. */
export async function loadCommentStart(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from('comments').select('first_seen_at').eq('account_id', accountId).order('first_seen_at', { ascending: true }).limit(1);
  if (error) return fail('start');
  return str(((data ?? []) as Row[])[0]?.first_seen_at);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/comments-read.test.ts tests/comments-privacy.test.ts tests/followers-privacy.test.ts tests/sync-comments.test.ts` → PASS (10 + 5 new tests). Then `npx tsc --noEmit` and `npx eslint lib/comments/read.ts tests/comments-read.test.ts tests/comments-privacy.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/comments/read.ts tests/comments-read.test.ts tests/comments-privacy.test.ts
git commit -m "feat(comments): owner-session readers for comment insights + privacy guard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `CommentRow` (one comment; the Plan 15d contract)

**Files:**
- Create: `components/account/CommentRow.tsx`, `tests/comment-row.test.tsx`

**Interfaces:**
- Consumes: Task 2 keys `pages.account.commentInsights.row.*`; Task 3 (`CommentView`, `capText`); `postLabHref` (`lib/post-lab/params.ts`); `formatDate`, `formatDateTime`; `Badge`.
- Produces: `CommentRow({ comment, accountId, scopeQuery?, status?, actions? })`, `CommentRowProps`. Plan 15d passes `actions` (its buttons) and `status` (`'hidden'` shows the Hidden badge). The row is an `<article>` named "Comment by @name"; the caller wraps rows in a list.

- [ ] **Step 1: Write the failing test** — create `tests/comment-row.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { CommentRow, type CommentRowProps } from '@/components/account/CommentRow';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { TEXT_CAP, type CommentView } from '@/lib/comments/view';
import { DEFAULT_PREFS } from '@/lib/prefs';

const T = en.pages.account.commentInsights.row;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const C: CommentView = {
  id: '1801',
  mediaId: '1790',
  authorUsername: 'amy.lee',
  text: 'Where is this?',
  postedAt: '2026-10-20T08:00:00Z',
  likeCount: 2,
  isQuestion: true,
  hidden: null,
  repliedByOwner: null,
  post: { id: '1790', type: 'REELS', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang' },
};

function view(p: Partial<CommentRowProps> = {}, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <CommentRow comment={C} accountId={ACC} {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('CommentRow', () => {
  it('author (opens Instagram), time, likes, the question badge, the text and the Post Lab link with the scope', () => {
    view({ scopeQuery: 'from=90d' });
    expect(screen.getByRole('article', { name: 'Comment by @amy.lee' })).toBeInTheDocument();
    const profile = screen.getByRole('link', { name: 'Open @amy.lee on Instagram' });
    expect(profile).toHaveAttribute('href', 'https://www.instagram.com/amy.lee/');
    expect(profile).toHaveAttribute('target', '_blank');
    expect(profile).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('2 likes')).toBeInTheDocument();
    expect(screen.getByText(T.question)).toBeInTheDocument();
    expect(screen.queryByText(T.replied)).toBeNull();
    expect(screen.queryByText(T.hidden)).toBeNull();
    expect(screen.getByText('Where is this?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'On your post of 2026-10-19' })).toHaveAttribute('href', `/accounts/${ACC}/media/1790?from=90d`);
    expect(screen.getByText(/^2026-10-20/)).toHaveAttribute('dateTime', '2026-10-20T08:00:00Z');
  });

  it('text is third-party content: shown as text, never as HTML', () => {
    const { container } = view({ comment: { ...C, text: '<img src=x onerror=alert(1)><b>bold</b>' } });
    expect(container.querySelector('img, b')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)><b>bold</b>')).toBeInTheDocument();
  });

  it(`long text is cut at ${TEXT_CAP} characters with an ellipsis; line breaks are kept`, () => {
    const { container } = view({ comment: { ...C, text: `${'a'.repeat(TEXT_CAP)}TAIL` } });
    const p = container.querySelector('p')!;
    expect(p.textContent).toBe(`${'a'.repeat(TEXT_CAP)}…`);
    expect(p).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.getByTitle(T.more)).toBeInTheDocument();
  });

  it('reply seen and hidden badges only when known; no likes line for 0 or unknown; unknown author and a gone post', () => {
    view({ comment: { ...C, authorUsername: null, likeCount: 0, isQuestion: false, repliedByOwner: true, post: null }, status: 'hidden' });
    expect(screen.getByRole('article', { name: `Comment by ${T.unknownAuthor}` })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Instagram/ })).toBeNull();
    expect(screen.getByText(T.replied)).toBeInTheDocument();
    expect(screen.getByText(T.hidden)).toBeInTheDocument();
    expect(screen.queryByText(T.question)).toBeNull();
    expect(screen.queryByText(/like/)).toBeNull();
    expect(screen.getByText(T.postGone)).toBeInTheDocument();
  });

  it('the actions slot (Plan 15d) renders when given', () => {
    view({ actions: <button type="button">Hide</button> });
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view({}, 'zh-CN');
    expect(screen.getByRole('article', { name: '@amy.lee 的评论' })).toBeInTheDocument();
    expect(screen.getByText('2 个赞')).toBeInTheDocument();
    expect(screen.getByText('问题')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comment-row.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/account/CommentRow"`.

- [ ] **Step 3: Write the component** — create `components/account/CommentRow.tsx`:

```tsx
'use client';

// One comment (Plan 15c): who wrote it and when, likes, rule badges, the text, and the post it belongs to (a link to its
// Post Lab). The text is third-party content: React text only (never HTML), at most TEXT_CAP characters. Plan 15d
// contract: `actions` is the slot for moderation buttons, `status` shows a Hidden badge; keep both names.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Badge } from '@/components/ui/badge';
import { capText, type CommentView } from '@/lib/comments/view';
import { formatDate, formatDateTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

export interface CommentRowProps {
  comment: CommentView;
  accountId: string;
  scopeQuery?: string; // the Time Scope query carried into the Post Lab link
  status?: 'visible' | 'hidden';
  actions?: ReactNode;
}

export function CommentRow({ comment: c, accountId, scopeQuery = '', status, actions }: CommentRowProps) {
  const t = useTranslations('pages.account.commentInsights.row');
  const { prefs } = usePrefs();
  const author = c.authorUsername ? `@${c.authorUsername}` : t('unknownAuthor');
  const { text, cut } = capText(c.text);
  return (
    <article aria-label={t('label', { author })} className="grid min-w-0 gap-1.5 rounded-md border bg-card p-[var(--gp)] text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {c.authorUsername ? (
          <a href={`https://www.instagram.com/${encodeURIComponent(c.authorUsername)}/`} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: c.authorUsername })} className="inline-flex min-w-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
            <span className="truncate">{author}</span>
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <span className="font-medium text-muted-foreground">{author}</span>
        )}
        <time dateTime={c.postedAt} className="text-xs text-muted-foreground">
          {formatDateTime(c.postedAt, prefs)}
        </time>
        {c.likeCount !== null && c.likeCount > 0 ? <span className="text-xs text-muted-foreground">{t('likes', { count: c.likeCount })}</span> : null}
        {c.isQuestion ? <Badge variant="secondary">{t('question')}</Badge> : null}
        {c.repliedByOwner === true ? <Badge variant="outline">{t('replied')}</Badge> : null}
        {status === 'hidden' ? <Badge variant="outline">{t('hidden')}</Badge> : null}
      </div>
      <p className="break-words whitespace-pre-wrap">
        {text}
        {cut ? <span title={t('more')}>…</span> : null}
      </p>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        {c.post ? (
          <Link href={postLabHref(accountId, c.mediaId, scopeQuery)} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {t('onPost', { date: formatDate(c.post.postedAt, prefs) })}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">{t('postGone')}</span>
        )}
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/comment-row.test.tsx tests/messages.test.ts` → PASS (6 new tests). Then `npx tsc --noEmit` and `npx eslint components/account/CommentRow.tsx tests/comment-row.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add components/account/CommentRow.tsx tests/comment-row.test.tsx
git commit -m "feat(comments): CommentRow (text as text, capped; Post Lab link; actions slot and status for 15d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Comments tab end to end (component, `TABS`, skeleton, page `case`, PostedFilter labels)

**Files:**
- Create: `components/account/CommentsTab.tsx`, `tests/comments-tab.test.tsx`
- Modify: `components/account/PostedFilter.tsx`, `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx`
- Existing tests that must keep passing: `tests/posted-filter.test.tsx`, `tests/posts-tab.test.tsx`, `tests/stories-list.test.tsx`, `tests/route-loading.test.tsx` (`it.each(TABS)`: the new tab gets the Followers skeleton), `tests/ui-standards.test.ts`, `tests/followers-privacy.test.ts`, `tests/comments-privacy.test.ts`.

**Interfaces:**
- Consumes: Task 2 keys (`pages.account.tab.comments`, `pages.account.commentInsights.*`), Task 3–7 exports; `connectHref` (`components/accounts/ConnectDialog.tsx`), `PostedFilter` / `usePostedName`, `hasScope` / `COMMENTS_SCOPE`, `listFollowerSnapshots`, `listWindow`, `daysToIso`, `pageCount`, `ALL_TIME`.
- Produces: `CommentsTab(props: CommentsTabProps)`, `CommentsTabProps { accountId; username; groupName; today; scope?; state; start; data; renderActions? }`, `CommentsData` (the union below). `PostedFilter` gains optional `label?: string` and `title?: string` (default: the "Posted: …" texts, so Posts/Stories are unchanged). `TABS` becomes `['overview', 'growth', 'posts', 'stories', 'comments', 'followers']`.
- The page reads ONE view per request: `comments`/`questions` → `loadCommentPage` + `loadCommentPosts`; `fans` → `loadFans`; `topics` → `loadTopicSample` + `topics()` (server-side; the browser gets the counts only); `outsiders` → `listFollowerSnapshots` then `loadOutsiders`; plus `loadCommentStart` for every view. Without the scope: nothing is read.

- [ ] **Step 1: Write the failing tests**

(a) Create `tests/comments-tab.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { CommentsTab, type CommentsData, type CommentsTabProps } from '@/components/account/CommentsTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { parseCommentState } from '@/lib/comments/state';
import type { CommentView } from '@/lib/comments/view';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const f of [push, replace, refresh]) f.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.commentInsights;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SCOPE = { from: '2026-09-01', to: '2026-09-30' };
const comment = (i: number, o: Partial<CommentView> = {}): CommentView => ({
  id: `c${i}`,
  mediaId: '1790',
  authorUsername: `fan${i}`,
  text: `comment ${i}`,
  postedAt: '2026-10-20T08:00:00Z',
  likeCount: null,
  isQuestion: false,
  hidden: null,
  repliedByOwner: null,
  post: { id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang' },
  ...o,
});
const POSTS = [{ id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang street food, the long caption that is cut' }];

function props(sp: Record<string, string>, data: CommentsData, o: Partial<CommentsTabProps> = {}): CommentsTabProps {
  return { accountId: ACC, username: 'shop.one', groupName: 'Brand X', today: '2026-10-25', scope: SCOPE, state: parseCommentState(sp), start: '2026-10-02T03:00:00Z', data, ...o };
}
function view(p: CommentsTabProps, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <CommentsTab {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const page = <R,>(rows: R[], total = rows.length, n = 1) => ({ rows, total, page: n });

describe('CommentsTab', () => {
  it('without the comments scope: nothing else, the reason, and the reconnect link (keeps the group, leaves the frame)', () => {
    view(props({}, { kind: 'noScope' }));
    expect(screen.getByText('Comments are off for @shop.one')).toBeInTheDocument();
    expect(screen.getByText(T.noScope.body)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: T.noScope.action });
    expect(link).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20X');
    expect(link).toHaveAttribute('target', '_top');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('All comments: intro + since, five underline views, the toolbar, the count line, rows with the Post Lab link, pages that keep the scope', () => {
    view(props({ page: '2' }, { kind: 'comments', page: page([comment(1), comment(2)], 52, 2), posts: POSTS }));
    expect(screen.getByText(/Comments read since 2026-10-02\./)).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['All comments', 'Unanswered questions', 'Fans', 'Topics', 'Not following you']);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'line');
    const toolbar = screen.getByRole('group', { name: T.toolbar });
    expect(within(toolbar).getByRole('searchbox', { name: T.search })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Commented: All time' })).toBeInTheDocument();
    const post = within(toolbar).getByRole('combobox', { name: T.post });
    expect(within(post).getAllByRole('option').map((o) => o.textContent)).toEqual(['All posts', '2026-10-19 · Penang street food, the long caption tha…']);
    expect(screen.getByText('51–52 of 52 comments')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'On your post of 2026-10-19' })[0]).toHaveAttribute('href', `/accounts/${ACC}/media/1790?from=2026-09-01&to=2026-09-30`);
    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '?tab=comments&from=2026-09-01&to=2026-09-30');
  });

  it('filters become chips; Clear all keeps the section; a deep-linked older post shows as "This post"; Advanced holds Show only', () => {
    view(props({ q: 'cake', pr: '30d', media: '999', only: 'questions' }, { kind: 'comments', page: page([]), posts: POSTS }));
    const chips = screen.getByRole('list', { name: en.filters.active });
    expect(within(chips).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Search: cake', '?tab=comments&pr=30d&media=999&only=questions&from=2026-09-01&to=2026-09-30'],
      ['Commented: Last 30 days', '?tab=comments&q=cake&media=999&only=questions&from=2026-09-01&to=2026-09-30'],
      [T.postChip, '?tab=comments&pr=30d&q=cake&only=questions&from=2026-09-01&to=2026-09-30'],
      [T.onlyChip.questions, '?tab=comments&pr=30d&q=cake&media=999&from=2026-09-01&to=2026-09-30'],
    ]);
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=comments&from=2026-09-01&to=2026-09-30');
    expect(screen.getByRole('combobox', { name: T.post })).toHaveValue('999');
    expect(screen.getByRole('option', { name: T.thisPost })).toBeInTheDocument();
    expect(screen.getByText(T.emptySearch)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advanced/ })).toBeInTheDocument();
  });

  it('no comments and no filters: "none yet" with when they arrive (never "no comments ever")', () => {
    view(props({}, { kind: 'comments', page: page([]), posts: [] }));
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    expect(screen.getByText(T.emptyHint)).toBeInTheDocument();
  });

  it('choosing a view navigates with the filters kept and page 1', async () => {
    const user = userEvent.setup();
    view(props({ q: 'cake', page: '3' }, { kind: 'comments', page: page([comment(1)], 120, 3), posts: [] }));
    await user.click(screen.getByRole('tab', { name: 'Fans' }));
    expect(push).toHaveBeenLastCalledWith('?tab=comments&section=fans&q=cake&from=2026-09-01&to=2026-09-30', { scroll: false });
  });

  it('Unanswered questions: the rule and its limit on screen; no Show-only panel; renderActions fills each row (Plan 15d)', () => {
    const renderActions = vi.fn((c: CommentView) => <button type="button">{`Reply to ${c.id}`}</button>);
    view(props({ section: 'questions' }, { kind: 'comments', page: page([comment(1, { isQuestion: true })]), posts: [] }, { renderActions }));
    expect(screen.getByText(/^Rule-based: a question mark .* no later comment from @shop\.one/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advanced/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply to c1' })).toBeInTheDocument();
    expect(renderActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('Fans: the mode select, its rule with the numbers, the table, the people count', () => {
    view(props({ section: 'fans', fans: 'quiet' }, { kind: 'fans', page: page([{ username: 'amy', comments: 12, likes: 30, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-09-01T00:00:00Z', postsSince: 4 }], 1) }));
    expect(screen.getByRole('combobox', { name: T.fans.show })).toHaveValue('quiet');
    expect(screen.getByText('At least 3 comments, none in the last 30 days, while you published 3 or more posts since. A signal, not proof: they may still watch without commenting.')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1 people')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Username', 'Comments', 'Likes on their comments', 'First comment', 'Latest comment', 'Posts since']);
    expect(within(table).getByRole('link', { name: 'Open @amy on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/amy/');
    expect(within(table).getByText('2026-08-01')).toBeInTheDocument();
  });

  it('Topics: the basis with the sample, three lists; too few comments says how many are needed', () => {
    const { unmount } = view(
      props({ section: 'topics' }, { kind: 'topics', topics: { sample: 120, enough: true, words: [{ term: '颜色', comments: 5 }], emoji: [{ term: '😍', comments: 1 }], hashtags: [] } }),
    );
    expect(screen.getByText(/^From the newest 120 comments in this range/)).toBeInTheDocument();
    expect(screen.getByText('颜色')).toBeInTheDocument();
    expect(screen.getByText('in 5 comments')).toBeInTheDocument();
    expect(screen.getByText('in 1 comment')).toBeInTheDocument();
    expect(screen.getByText(T.topics.none)).toBeInTheDocument(); // no hashtags
    unmount();
    view(props({ section: 'topics' }, { kind: 'topics', topics: { sample: 7, enough: false, words: [], emoji: [], hashtags: [] } }));
    expect(screen.getByText('At least 20 comments are needed; this range has 7.')).toBeInTheDocument();
  });

  it('Not following you: snapshot-based basis line; without an export a link to the Followers tab', () => {
    const { unmount } = view(props({ section: 'outsiders' }, { kind: 'outsiders', page: page([{ username: 'bob', comments: 4, lastAt: '2026-10-01T00:00:00Z' }]), snapshot: { takenOn: '2026-10-20', followerCount: 1234 } }));
    expect(screen.getByText(/^Compared with your follower export of 2026-10-20 \(1,234 followers\)\. Snapshot-based/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'Open @bob on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/bob/');
    unmount();
    view(props({ section: 'outsiders' }, { kind: 'noSnapshot' }));
    expect(screen.getByRole('link', { name: T.outsiders.openFollowers })).toHaveAttribute('href', '?tab=followers&from=2026-09-01&to=2026-09-30');
  });

  it('migration missing: the database-update note inside the view', () => {
    view(props({ section: 'fans' }, { kind: 'notReady' }));
    expect(screen.getByText(T.notReady)).toBeInTheDocument();
    expect(screen.getByText(T.notReadyHint)).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view(props({}, { kind: 'comments', page: page([comment(1)]), posts: [] }), 'zh-CN');
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['全部评论', '未回答的问题', '粉丝榜', '话题', '未关注你的人']);
    expect(screen.getByText('第 1–1 条，共 1 条评论')).toBeInTheDocument();
  });
});
```

(b) `tests/dashboard-account.test.ts` — three anchored edits:
- `it('accepts the five tabs only;` → `it('accepts the six tabs only;`
- `expect(TABS).toEqual(['overview', 'growth', 'posts', 'stories', 'followers']);` → `expect(TABS).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'followers']);`
- `expect(['overview', 'growth', 'posts', 'stories', 'followers', 'audience', 'GROWTH'].map(parseTab)).toEqual(['overview', 'growth', 'posts', 'stories', 'followers', 'overview', 'overview']);` → `expect(['overview', 'growth', 'posts', 'stories', 'comments', 'followers', 'audience', 'GROWTH'].map(parseTab)).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'followers', 'overview', 'overview']);`

(c) `tests/account-view.test.tsx` — three anchored edits:
- `const frame = (tab: 'overview' | 'growth' | 'posts' | 'stories' | 'followers', q = ''` → `const frame = (tab: 'overview' | 'growth' | 'posts' | 'stories' | 'comments' | 'followers', q = ''`
- `expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Growth', 'Posts', 'Stories', 'Followers']);` → `expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Growth', 'Posts', 'Stories', 'Comments', 'Followers']);`
- `for (const tab of ['posts', 'stories', 'followers'] as const) {` → `for (const tab of ['posts', 'stories', 'comments', 'followers'] as const) {` (the Comments tab shows no range bar)

(d) `tests/account-page.test.tsx` — insert this block directly BEFORE the line `vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (await import('@/lib/prefs')).DEFAULT_PREFS }));`:

```ts
const comments = vi.hoisted(() => ({ args: [] as Record<string, unknown>[], migrated: true }));
vi.mock('@/lib/comments/read', () => ({
  loadCommentPage: async (_db: unknown, id: string, a: Record<string, unknown>) => (calls.push(`commentPage:${id}`), comments.args.push(a), comments.migrated ? { rows: [], total: 0, page: 1 } : null),
  loadCommentPosts: async () => (calls.push('commentPosts'), []),
  loadCommentStart: async () => (calls.push('commentStart'), '2026-10-02T03:00:00Z'),
  loadFans: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('fans'), comments.args.push(a), comments.migrated ? { rows: [], total: 0, page: 1 } : null),
  loadOutsiders: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('outsiders'), comments.args.push(a), comments.migrated ? { rows: [], total: 0, page: 1 } : null),
  loadTopicSample: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('topicSample'), comments.args.push(a), []),
}));
```

and append this block at the END of the file:

```ts

describe('account page: the Comments tab (Plan 15c)', () => {
  const SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights', 'instagram_business_manage_comments'];
  type CommentsProps = { data: { kind: string; snapshot?: unknown; topics?: { enough: boolean } }; start: string | null; state: { section: string }; scope: Record<string, string>; username: string; groupName: string | null };
  const commentsTab = async (sp: Record<string, string> = {}) => ((await streamTab(await run(ID, { tab: 'comments', ...sp }))) as ReactElement<CommentsProps>).props;
  const commentCalls = () => calls.filter((c) => /^(commentPage|commentPosts|commentStart|fans|outsiders|topicSample|followerSnapshots)/.test(c));

  beforeEach(() => {
    comments.args.length = 0;
    comments.migrated = true;
    followers.snapshots = [];
    accounts.push(acct(ID, 'active', { username: 'Shop.One', grantedScopes: SCOPES }));
  });

  it('without the comments scope: nothing is read, the tab says why (empty would not mean "no comments")', async () => {
    accounts.length = 0;
    accounts.push(acct(ID, 'active', { grantedScopes: SCOPES.slice(0, 2) }));
    const p = await commentsTab();
    expect(p.data).toEqual({ kind: 'noScope' });
    expect(p.start).toBeNull();
    expect(commentCalls()).toEqual([]);
  });

  it('All comments: one page for the comment-date window (owner timezone), the owner name lower-cased, the post choices and the start', async () => {
    const p = await commentsTab({ pr: '30d', q: 'cake', media: '1790', only: 'fans', page: '2' });
    expect(p.data.kind).toBe('comments');
    expect(p.start).toBe('2026-10-02T03:00:00Z');
    const today = localDay(new Date(), DEFAULT_PREFS.timezone);
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    expect(comments.args[0]).toEqual({ ...daysToIso(from, today, DEFAULT_PREFS.timezone), q: 'cake', media: '1790', questions: false, unanswered: false, fansOnly: true, owner: 'shop.one', page: 2 });
    expect(commentCalls().sort()).toEqual([`commentPage:${ID}`, 'commentPosts', 'commentStart']);
    expect(calls).not.toContain('ADMIN');
  });

  it('Unanswered questions: the question rule and the no-reply filter (Show only is ignored there); Show only = questions on the list', async () => {
    await commentsTab({ section: 'questions', only: 'fans' });
    expect(comments.args[0]).toMatchObject({ questions: true, unanswered: true, fansOnly: false });
    await commentsTab({ only: 'questions' });
    expect(comments.args[1]).toMatchObject({ questions: true, unanswered: false, fansOnly: false });
  });

  it('Fans: the mode, the clock and the page; before the migration the database-update note', async () => {
    const p = await commentsTab({ section: 'fans', fans: 'new', page: '3' });
    expect(p.data.kind).toBe('fans');
    expect(comments.args[0]).toMatchObject({ owner: 'shop.one', mode: 'new', page: 3 });
    expect(comments.args[0].now).toBeInstanceOf(Date);
    comments.migrated = false;
    expect((await commentsTab({ section: 'fans' })).data).toEqual({ kind: 'notReady' });
    expect((await commentsTab()).data).toEqual({ kind: 'notReady' });
  });

  it('Topics: the capped sample of the window, analysed on the server (works before the migration)', async () => {
    comments.migrated = false;
    const p = await commentsTab({ section: 'topics' });
    expect(p.data.kind).toBe('topics');
    expect(p.data.topics?.enough).toBe(false);
    expect(comments.args[0]).toMatchObject({ owner: 'shop.one' });
    expect(calls).not.toContain(`commentPage:${ID}`);
  });

  it('Not following you: needs the follower exports table and an export; then the newest export is the basis', async () => {
    followers.snapshots = null;
    expect((await commentsTab({ section: 'outsiders' })).data).toEqual({ kind: 'notReady' });
    followers.snapshots = [];
    expect((await commentsTab({ section: 'outsiders' })).data).toEqual({ kind: 'noSnapshot' });
    followers.snapshots = [
      { id: 'a', takenOn: '2026-10-20', followerCount: 1234, followingCount: null, createdAt: '2026-10-20T10:00:00Z' },
      { id: 'b', takenOn: '2026-09-20', followerCount: 1000, followingCount: null, createdAt: '2026-09-20T10:00:00Z' },
    ];
    const p = await commentsTab({ section: 'outsiders', page: '2' });
    expect(p.data).toMatchObject({ kind: 'outsiders', snapshot: { takenOn: '2026-10-20', followerCount: 1234 } });
    expect(comments.args.at(-1)).toEqual({ owner: 'shop.one', page: 2 });
  });

  it('the Suspense key ignores the comment params (the toolbar stays mounted); the scope rides along to the tab', async () => {
    const key = async (sp: Record<string, string>) => (await run(ID, sp)).props.children.key;
    expect(await key({ tab: 'comments', section: 'fans', fans: 'quiet', media: '1', only: 'questions', q: 'x', pr: '7d', page: '2' })).toBe(await key({ tab: 'comments' }));
    expect((await commentsTab({ from: '2026-09-01', to: '2026-09-30' })).scope).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/comments-tab.test.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx`
Expected: FAIL — `comments-tab`: `Failed to resolve import "@/components/account/CommentsTab"`; `dashboard-account`: `TABS` lacks `comments`; `account-view`: no "Comments" tab; `account-page`: the new describe block (`data` undefined: `?tab=comments` falls back to Overview).

- [ ] **Step 3: PostedFilter labels** — `components/account/PostedFilter.tsx`, two anchored edits:
- the two lines
  ```
  /** `hrefFor(dates)` = the list with those dates (page 1, everything else kept); `hidden` = the other params of the list,
   *  for the custom-dates form (without pr/pfrom/pto/page). */
  export function PostedFilter({ id, dates, today, hrefFor, hidden }: { id: string; dates: ListDates; today: string; hrefFor: (d: ListDates) => string; hidden: Record<string, string> }) {
  ```
  become
  ```
  /** `hrefFor(dates)` = the list with those dates (page 1, everything else kept); `hidden` = the other params of the list,
   *  for the custom-dates form (without pr/pfrom/pto/page). `label` / `title` = the button and panel names when the date is
   *  not a posting date (the Comments tab: "Commented: …"); default "Posted: …". */
  export function PostedFilter({ id, dates, today, hrefFor, hidden, label, title }: { id: string; dates: ListDates; today: string; hrefFor: (d: ListDates) => string; hidden: Record<string, string>; label?: string; title?: string }) {
  ```
- `    <FilterPanel label={t('postedWith', { range: name })} title={t('postedTitle')} active={custom || dates.pr !== null} open={open} onOpenChange={setOpen}>` → `    <FilterPanel label={label ?? t('postedWith', { range: name })} title={title ?? t('postedTitle')} active={custom || dates.pr !== null} open={open} onOpenChange={setOpen}>`

- [ ] **Step 4: The component** — create `components/account/CommentsTab.tsx`:

```tsx
'use client';

// The Comments tab (Plan 15c, READ-ONLY): five views as underline tabs (?section=): All comments, Unanswered questions,
// Fans, Topics, Not following you. Everything is URL state (lib/comments/state.ts); the server read ONE view's page
// (app/(app)/accounts/[id]/(tabs)/page.tsx), so at most one page of third-party names reaches the browser. Every
// analysis view states its source, rule and sample. Without the comments scope nothing is read and the tab says why.
// Plan 15d contract: `renderActions(comment)` fills each CommentRow's action slot.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink, MessageSquareOff, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CommentRow } from '@/components/account/CommentRow';
import { PostedFilter, usePostedName } from '@/components/account/PostedFilter';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterOptions, FilterSearch, FilterSelect, FilterToolbar, useApply, type FilterChip } from '@/components/shared/FilterToolbar';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMMENT_ONLY, COMMENT_SECTIONS, commentHref, FAN_MODES, type CommentSection, type CommentState, type FanMode } from '@/lib/comments/state';
import { TOPIC_MIN_AUTHORS, TOPIC_MIN_SAMPLE, type Term, type Topics } from '@/lib/comments/topics';
import { capText, COMMENT_PAGE, FAN_PAGE, FAN_RULES, type CommentPost, type CommentView, type Fan, type Outsider, type Paged } from '@/lib/comments/view';
import { ALL_TIME, pageCount } from '@/lib/dashboard/lists';
import { formatDate, formatDay, formatNumber } from '@/lib/format';

/** What the server read for the current section. */
export type CommentsData =
  | { kind: 'noScope' } // the token lacks the comments scope: nothing was read
  | { kind: 'notReady' } // migration 20261029000001 is not applied (or, for outsiders, the follower exports table is missing)
  | { kind: 'comments'; page: Paged<CommentView>; posts: CommentPost[] } // sections comments and questions
  | { kind: 'fans'; page: Paged<Fan> }
  | { kind: 'topics'; topics: Topics }
  | { kind: 'noSnapshot' } // outsiders without a follower export
  | { kind: 'outsiders'; page: Paged<Outsider>; snapshot: { takenOn: string; followerCount: number } };

export interface CommentsTabProps {
  accountId: string;
  username: string;
  groupName: string | null;
  today: string;
  scope?: Record<string, string>; // the Time Scope params: carried in every link, never used here
  state: CommentState;
  start: string | null; // when comments were first read (ISO); null = none yet
  data: CommentsData;
  renderActions?: (c: CommentView) => ReactNode;
}

const profile = (u: string) => `https://www.instagram.com/${encodeURIComponent(u)}/`;
/** A caption in a select option: at most 40 characters, an ellipsis when cut. */
const snippet = (s: string) => {
  const c = capText(s, 40);
  return c.cut ? `${c.text}…` : c.text;
};

export function CommentsTab({ accountId, username, groupName, today, scope = {}, state, start, data, renderActions }: CommentsTabProps) {
  const t = useTranslations('pages.account.commentInsights');
  const { prefs } = usePrefs();
  const apply = useApply();
  const postedName = usePostedName(state.dates, today);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const href = (patch: Partial<CommentState>) => commentHref(state, patch, scope);
  const scopeQuery = new URLSearchParams(scope).toString();

  if (data.kind === 'noScope')
    return (
      <EmptyState
        icon={<MessageSquareOff aria-hidden="true" />}
        title={t('noScope.title', { username })}
        description={t('noScope.body')}
        action={
          <Button asChild variant="outline">
            <a href={connectHref(groupName)} target="_top">
              {t('noScope.action')}
            </a>
          </Button>
        }
      />
    );

  const range = (p: Paged<unknown>, size: number, key: 'range' | 'people') =>
    p.total > 0 ? (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t(key, { first: n((p.page - 1) * size + 1), last: n((p.page - 1) * size + p.rows.length), total: n(p.total) })}
      </p>
    ) : null;
  const pages = (p: Paged<unknown>, size: number) => <Pagination page={p.page} pages={pageCount(p.total, size)} hrefFor={(page) => href({ page })} />;
  const dateFilter = (
    <PostedFilter
      id="comments-date"
      dates={state.dates}
      today={today}
      hrefFor={(dates) => href({ dates })}
      hidden={Object.fromEntries([...new URLSearchParams(href({ dates: ALL_TIME }).slice(1))])}
      label={t('commented', { range: postedName })}
      title={t('commentedTitle')}
    />
  );
  const datesChip: FilterChip[] = state.dates.pr || state.dates.from || state.dates.to ? [{ id: 'dates', label: t('commented', { range: postedName }), href: href({ dates: ALL_TIME }) }] : [];
  const notReady = <EmptyState icon={<MessagesSquare aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />;
  const person = (u: string) => (
    <a href={profile(u)} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: u })} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
      @{u}
      <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </a>
  );
  const day = (iso: string) => formatDate(iso, prefs);

  function commentList(section: 'comments' | 'questions') {
    if (data.kind !== 'comments') return notReady;
    const { page, posts } = data;
    const known = posts.some((p) => p.id === state.media);
    const options = [
      { value: '', label: t('allPosts') },
      ...posts.map((p) => ({ value: p.id, label: t('postOption', { date: day(p.postedAt), caption: snippet(p.caption ?? t('noCaption')) }) })),
      ...(state.media && !known ? [{ value: state.media, label: t('thisPost') }] : []),
    ];
    const chips: FilterChip[] = [
      ...(state.q ? [{ id: 'q', label: t('searchChip', { q: state.q }), href: href({ q: '' }) }] : []),
      ...datesChip,
      ...(state.media ? [{ id: 'media', label: t('postChip'), href: href({ media: null }) }] : []),
      ...(section === 'comments' && state.only ? [{ id: 'only', label: t(`onlyChip.${state.only}`), href: href({ only: null }) }] : []),
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar
          label={t('toolbar')}
          chips={chips}
          clearHref={chips.length ? href({ q: '', dates: ALL_TIME, media: null, only: null }) : undefined}
          advanced={
            section === 'comments' ? (
              <FilterOptions label={t('only.label')} options={[null, ...COMMENT_ONLY].map((o) => ({ href: href({ only: o }), label: t(`only.${o ?? 'all'}`), current: state.only === o }))} />
            ) : undefined
          }
          advancedCount={section === 'comments' && state.only ? 1 : 0}
        >
          <FilterSearch id="comments-q" label={t('search')} placeholder={t('search')} value={state.q} hrefFor={(q) => href({ q })} />
          {dateFilter}
          <FilterSelect id="comments-post" label={t('post')} value={state.media ?? ''} options={options} hrefFor={(v) => href({ media: v || null })} />
        </FilterToolbar>
        {section === 'questions' ? <p className="max-w-prose text-xs text-muted-foreground">{t('questionsNote', { username })}</p> : null}
        {range(page, COMMENT_PAGE, 'range')}
        {page.rows.length ? (
          <ul className="grid min-w-0 gap-2">
            {page.rows.map((c) => (
              <li key={c.id} className="min-w-0">
                <CommentRow comment={c} accountId={accountId} scopeQuery={scopeQuery} actions={renderActions?.(c)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<MessagesSquare aria-hidden="true" />}
            title={chips.length ? t('emptySearch') : section === 'questions' ? t('emptyQuestions') : t('empty')}
            description={chips.length ? undefined : t('emptyHint')}
          />
        )}
        {pages(page, COMMENT_PAGE)}
      </div>
    );
  }

  function fans() {
    if (data.kind !== 'fans') return notReady;
    const mode: FanMode = state.fans;
    const columns: Column<Fan>[] = [
      { key: 'username', header: t('cols.username'), cell: (f) => person(f.username) },
      { key: 'comments', header: t('cols.comments'), align: 'right', cell: (f) => n(f.comments) },
      { key: 'likes', header: t('cols.likes'), align: 'right', cell: (f) => n(f.likes) },
      { key: 'first', header: t('cols.first'), cell: (f) => day(f.firstAt) },
      { key: 'last', header: t('cols.last'), cell: (f) => day(f.lastAt) },
      ...(mode === 'quiet' ? [{ key: 'since', header: t('cols.postsSince'), align: 'right' as const, cell: (f: Fan) => (f.postsSince === null ? '' : n(f.postsSince)) }] : []),
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar label={t('fans.toolbar')}>
          <FilterSelect id="comments-fans" label={t('fans.show')} value={mode} options={FAN_MODES.map((m) => ({ value: m, label: t(`fans.${m}`) }))} hrefFor={(v) => href({ fans: v as FanMode })} />
        </FilterToolbar>
        <p className="max-w-prose text-xs text-muted-foreground">{t(`fans.${mode}Rule`, { days: n(FAN_RULES.windowDays), min: n(mode === 'new' ? FAN_RULES.newFanMin : FAN_RULES.fanMin), posts: n(FAN_RULES.quietPosts) })}</p>
        {range(data.page, FAN_PAGE, 'people')}
        <DataTable rows={data.page.rows} columns={columns} rowKey={(f) => f.username} caption={t(`fans.${mode}`)} empty={<EmptyState title={t('fans.empty')} />} serverSort={{ current: null, href: () => null }} />
        {pages(data.page, FAN_PAGE)}
      </div>
    );
  }

  function topicList(title: string, terms: Term[]) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {terms.length ? (
            <ol className="grid gap-1 text-sm">
              {terms.map((x) => (
                <li key={x.term} className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{x.term}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t('topics.inComments', { count: x.comments })}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t('topics.none')}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  function topics() {
    if (data.kind !== 'topics') return notReady;
    const tp = data.topics;
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar label={t('toolbar')} chips={datesChip} clearHref={datesChip.length ? href({ dates: ALL_TIME }) : undefined}>
          {dateFilter}
        </FilterToolbar>
        <p className="max-w-prose text-xs text-muted-foreground">
          {t('topics.basis', { count: n(tp.sample), authors: n(TOPIC_MIN_AUTHORS) })} {t('topics.ruleBased')}
        </p>
        {tp.enough ? (
          <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-3">
            {topicList(t('topics.words'), tp.words)}
            {topicList(t('topics.emoji'), tp.emoji)}
            {topicList(t('topics.hashtags'), tp.hashtags)}
          </div>
        ) : (
          <EmptyState icon={<MessagesSquare aria-hidden="true" />} title={t('topics.tooFew')} description={t('topics.tooFewHint', { min: n(TOPIC_MIN_SAMPLE), count: n(tp.sample) })} />
        )}
      </div>
    );
  }

  function outsiders() {
    if (data.kind === 'noSnapshot')
      return (
        <EmptyState
          icon={<MessagesSquare aria-hidden="true" />}
          title={t('outsiders.noSnapshot')}
          description={t('outsiders.noSnapshotHint')}
          action={
            <Button asChild variant="outline">
              <Link href={`?${new URLSearchParams({ tab: 'followers', ...scope })}`}>{t('outsiders.openFollowers')}</Link>
            </Button>
          }
        />
      );
    if (data.kind !== 'outsiders') return notReady;
    const columns: Column<Outsider>[] = [
      { key: 'username', header: t('cols.username'), cell: (o) => person(o.username) },
      { key: 'comments', header: t('cols.comments'), align: 'right', cell: (o) => n(o.comments) },
      { key: 'last', header: t('cols.last'), cell: (o) => day(o.lastAt) },
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <p className="max-w-prose text-xs text-muted-foreground">{t('outsiders.basis', { date: formatDay(data.snapshot.takenOn, prefs), count: n(data.snapshot.followerCount) })}</p>
        {range(data.page, FAN_PAGE, 'people')}
        <DataTable rows={data.page.rows} columns={columns} rowKey={(o) => o.username} caption={t('sections.outsiders')} empty={<EmptyState title={t('outsiders.empty')} />} serverSort={{ current: null, href: () => null }} />
        {pages(data.page, FAN_PAGE)}
      </div>
    );
  }

  const panel: Record<CommentSection, () => ReactNode> = { comments: () => commentList('comments'), questions: () => commentList('questions'), fans, topics, outsiders };
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="max-w-prose text-sm text-muted-foreground">
        {t('intro')} {start ? t('since', { date: formatDate(start, prefs) }) : null}
      </p>
      <Tabs value={state.section} activationMode="manual" onValueChange={(v) => apply(href({ section: v as CommentSection }))} className="min-w-0">
        <TabsList variant="line" aria-label={t('sections.label')}>
          {COMMENT_SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s} className="flex-none">
              {t(`sections.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {COMMENT_SECTIONS.map((s) => (
          <TabsContent key={s} value={s} className="min-w-0 pt-[var(--gp)]">
            {s === state.section ? panel[s]() : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 5: Wire the tab** (anchored edits)

`lib/dashboard/account.ts`:
- `export const TABS = ['overview', 'growth', 'posts', 'stories', 'followers'] as const; // Growth: Plan 15a. Followers (Plan 15b): by-name lists from uploaded Instagram exports; stays the LAST tab` → `export const TABS = ['overview', 'growth', 'posts', 'stories', 'comments', 'followers'] as const; // Growth: Plan 15a. Comments (Plan 15c): read-only comment insights, next to the content tabs. Followers (Plan 15b): by-name lists from uploaded Instagram exports; stays the LAST tab`

`components/account/TabSkeleton.tsx`: the line `    case 'followers':` → two lines `    case 'comments':` and `    case 'followers':` (same shape: a toolbar row and a table).

`app/(app)/accounts/[id]/(tabs)/page.tsx`:
- after `import { AccountView } from '@/components/account/AccountView';` add `import { CommentsTab, type CommentsData } from '@/components/account/CommentsTab';`
- before `import type { StoredAccount } from '@/lib/accounts/types';` add `import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';`
- after `import { requireOwner } from '@/lib/auth/require-owner';` add the three lines
  ```ts
  import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample } from '@/lib/comments/read';
  import { COMMENT_KEYS, parseCommentState } from '@/lib/comments/state';
  import { topics } from '@/lib/comments/topics';
  ```
- insert this block directly BEFORE the line `    case 'followers': {` (inside `TabContent`'s `switch`; `db`, `now`, `today`, `tz`, `listWindow`, `daysToIso` and `listFollowerSnapshots` are already in scope / imported):

```tsx
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
      return <CommentsTab {...props} start={start} data={data} />;
    }
```

- in the Suspense key: `[...LIST_KEYS, ...FOLLOWER_KEYS].map(` → `[...LIST_KEYS, ...FOLLOWER_KEYS, ...COMMENT_KEYS].map(`; and in the comment above it `params of Posts/Stories/Followers (LIST_KEYS, incl. the Grid/Table view, and FOLLOWER_KEYS)` → `params of Posts/Stories/Comments/Followers (LIST_KEYS, incl. the Grid/Table view, COMMENT_KEYS and FOLLOWER_KEYS)`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/comments-tab.test.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx tests/route-loading.test.tsx tests/posted-filter.test.tsx tests/posts-tab.test.tsx tests/stories-list.test.tsx tests/ui-standards.test.ts tests/messages.test.ts tests/followers-privacy.test.ts tests/comments-privacy.test.ts` → PASS (11 new in `comments-tab`, 7 new in `account-page`; `posts-tab` is known slow: rerun it alone once on a timeout). Then `npx tsc --noEmit` and `npx eslint components/account/CommentsTab.tsx components/account/PostedFilter.tsx components/account/TabSkeleton.tsx lib/dashboard/account.ts "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/comments-tab.test.tsx tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx`.

- [ ] **Step 7: Commit**

```bash
git add components/account/CommentsTab.tsx tests/comments-tab.test.tsx components/account/PostedFilter.tsx lib/dashboard/account.ts components/account/TabSkeleton.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx
git commit -m "feat(comments): Comments account tab (all comments, unanswered questions, fans, topics, not following you)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, final check

**Files:**
- Create: `docs/RUNBOOK_COMMENTS.md`
- Modify: `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md` (all anchored text insertions; the docs are LF in the working tree, keep them so)

- [ ] **Step 1: Create `docs/RUNBOOK_COMMENTS.md`** (Write tool: non-ASCII):

````markdown
# Runbook — Comment insights (Plan 15c, read-only)

The account page's **Comments** tab (Overview, Growth, Posts, Stories, **Comments**, Followers): All comments, Unanswered
questions, Fans, Topics, Not following you. It only READS what the sync already stores (Plan 11b: top-level comments of
feed posts and Reels of the last 30 days, hourly, only for accounts with the comments scope). Nothing here calls
Instagram or changes anything (reply / hide / delete is Plan 15d).

Commenter usernames and comment texts are third-party personal data. In every step below report only yes/no and counts:
never paste usernames, comment texts or screenshots that show them into chats, issues or commits.

## 0. The migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261029000001_comment_insights.sql`: the `comments` policy in InitPlan form and three
`security invoker` functions (`comment_list`, `comment_fans`, `comment_outsiders`). Additive; needs `follower_exports`
(15b, applied 2026-10-22). With `.env.local` loaded by the scripts (never print the values; PROGRESS §9):
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only 20261029000001 pending, nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs rpc:comment_outsiders:'{"p_account":"00000000-0000-0000-0000-000000000000","p_owner":"x","p_offset":0,"p_limit":1}'
                                                                # before: 404 PGRST202 (absent)
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect 13 local / 13 remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs rpc:comment_outsiders:'{"p_account":"00000000-0000-0000-0000-000000000000","p_owner":"x","p_offset":0,"p_limit":1}'
                                                                # after: 401 with code 42501 (exists, anon denied)
```
Before it is applied the tab shows "Comments needs a database update" in every view except Topics (which reads the table
directly). Rollback, if ever needed: `drop function public.comment_list(...)`, `comment_fans(...)`, `comment_outsiders(...)`
in the SQL editor (the policy rewrite has the same meaning as before and can stay).

## 1. Reconnect for the comments scope (once per account)
1. Accounts page: an account without the scope shows "Reconnect to enable comments". Its Comments tab shows "Comments are
   off for @name" with the same link, and NO list (nothing is read: Instagram answers an empty list without the scope, so
   empty would not mean "no comments").
2. Click the link (it leaves the app tab: `target="_top"`), log in to that Instagram account, approve EVERY permission.
3. SQL editor: `select username, 'instagram_business_manage_comments' = any(granted_scopes) as has_comments from accounts;`
   → true for that account. The Comments tab now shows the five views.
4. Comments arrive with the next hourly comments job (lane 2, after the history import): RUNBOOK_CAPTURE §7 has the counts query.

## 2. A real comment (gate: do this before relying on the feature)
1. From ANOTHER Instagram account, comment on a recent post (posted in the last 30 days) of the connected account:
   one plain comment ("lovely"), one English question ("where is this?"), one Chinese question ("好看吗"), one with a
   hashtag and an emoji.
2. Wait for the comments job (hourly, after the history import; "Sync now" on the Accounts page may pick it up sooner) → All comments lists them
   newest first, with the author, time (your timezone and format settings), likes, and "On your post of …" opening that
   post's Post Lab (with the page's Time Scope).
3. The two questions carry the "Question" badge; the plain one does not. Unanswered questions lists the two questions.
4. From the CONNECTED account, add a top-level comment on the same post that mentions the asker (`@name thanks!`). After the
   next comments job the question shows "Reply seen" and leaves Unanswered questions. A reply INSIDE the thread does NOT
   count (thread replies are not read; the view says so).
5. Search: a word of a comment, then part of the commenter's name (case does not matter; try a Chinese word too). Post
   filter: pick the post. Comment date: Last 7 days, then a custom range. Each is a chip; "Clear all" keeps the view.

## 3. The analysis views
- **Fans**: Top fans ranks by comments then likes; your own comments are not listed. New fans: first comment in the last
  30 days and at least 2 comments. Gone quiet: 3+ comments, none in 30 days, 3+ posts published since (empty at first: the
  history starts at the Reconnect). Each view shows its rule and "1–50 of N people".
- **Topics**: needs 20+ comments in the range ("At least 20 comments are needed; this range has N" otherwise). A word must
  appear in 3+ comments from 2+ people; Chinese words (e.g. 颜色, 照片) are counted as words, single characters skipped.
- **Not following you**: without a follower export → "Upload a follower export first" (link to the Followers tab). With one
  (RUNBOOK_FOLLOWERS §2), the basis line names that export's date and size; the people listed commented but are not in
  that export (snapshot-based: anyone who followed after it shows up too).

## 4. Layout: 360 / 768 / 1280 × themes, keyboard, zh-CN
- Every view at 360, 768, 1280 px, light and dark of each theme: no sideways page scroll; the toolbar wraps; rows are cards;
  the Fans / Not following you tables become cards on phones; the three Topics cards stack on phones.
- Keyboard only: the view tabs (arrows + Enter), search, the date panel (Esc closes, focus returns), the post select,
  Advanced → Show only, pagination, the profile and Post Lab links.
- Switch the language to 简体中文: every label, rule and count line is Chinese; dates and numbers follow the format settings.

## 5. Privacy and security (run all; report only yes/no and counts)
1. A long comment (over 500 characters) is cut with "…"; a comment containing `<b>x</b>` shows the characters, not bold text.
2. URLs: only `section`, the comment date, `q` (YOUR search text), `media` (a post id), `only`, `fans`, `page` and the Time
   Scope. No commenter name appears in a URL unless you typed it into the search box — that text then appears in Vercel's
   request logs (like the Followers search): search by words instead of names when that matters.
3. `select count(*) from sync_runs where summary::text ilike '%' || (select author_username from comments limit 1) || '%';` → 0.
4. Signed out (or another browser): `/accounts/<id>?tab=comments` → login; the anon probe of §0 → 401 `42501`.
5. Exports (Excel, PDF report) contain no comment texts or commenter names (this plan adds no export).
6. Deleting an account permanently removes its comments (`on delete cascade`, unchanged since 11b); archiving keeps them.

## 6. Speed (the biggest account)
Open each view with the account that has the most comments; Server-Timing (DevTools → Network → the document) under
1.2 s warm. If Fans or Not following you are slow at thousands of commenters, report the comment count: the planned fix
is an index on `(account_id, lower(author_username))` (a new migration).

## 7. Known limits (by design)
- Only top-level comments of feed posts and Reels posted in the last 30 days at read time, at most 200 per post per read;
  Stories have no comments here (Story replies are private messages). History starts at the Reconnect.
- Thread replies, Instagram's hidden flag and commenter ids are not read: "Reply seen" is derived from your own top-level
  @mentions; a renamed account counts as a new fan (Plan 15d reads replies and the hidden flag).
- The question rule is a rule (question marks, English question words at the start, Chinese question words anywhere):
  it misses some questions and flags some non-questions. Topics use the newest 1,000 comments of the range.

## What to send if it fails
The step number, the view, the screen width and theme, yes/no per expectation and counts. Never usernames or comment texts.
````

- [ ] **Step 2: `docs/SPEC.md`** — insert directly BEFORE the line `## 8. UI (v1)`:

```markdown
## 7i. Comment insights (Plan 15c; creator-toolkit design §6 "Top commenters", §0b)
Status: code complete, NOT verified live (`docs/RUNBOOK_COMMENTS.md`). The migration `20261029000001_comment_insights.sql` is NOT applied to the live database (owner's go-ahead, BEFORE deploying code that needs it); until then the tab says "needs a database update" except Topics.

Read-only. Account page → **Comments** tab (Overview, Growth, Posts, Stories, Comments, Followers), five views (`?section=`): **All comments** (newest first, 50 per page; search in text and username, comment date `pr|pfrom|pto`, one post, Advanced: questions only / from fans), **Unanswered questions** (question rule + no reply seen), **Fans** (top / new / gone quiet), **Topics** (words, emoji, hashtags) and **Not following you** (commenters missing from the newest follower export of §7h, snapshot-based). Source: the `comments` table of Plan 11b (top-level comments of feed posts and Reels of the last 30 days, hourly, only with `instagram_business_manage_comments`; without the scope the tab reads nothing and shows the Reconnect link, because Instagram answers an empty list). Rules (constants in `lib/comments/view.ts` and `lib/comments/question.ts`, passed to SQL as parameters): question = `?`/`？`/`❓`, an English question word at the start, or a Chinese question word anywhere; "reply seen" = a later top-level comment of the account that @mentions the author (thread replies are not stored: never "unanswered" as a fact); fan = 3+ comments; new fan = first comment within 30 days and 2+ comments; gone quiet = 3+ comments, none within 30 days, 3+ posts since; topics = `Intl.Segmenter` words of 2+ characters minus stop words, emoji and hashtags, each in 3+ comments by 2+ people, from the newest 1,000 comments of the range, none below 20 comments. SQL: `comment_list`, `comment_fans`, `comment_outsiders` (`security invoker`, revoked from anon) and the `comments` policy in InitPlan form. Privacy: owner-only RLS, only `lib/comments/read.ts` reads (guard test), never logged, never in `sync_runs`/exports/alerts, deleted with the account; comment text is rendered as text and capped at 500 characters; no third-party names in URLs (the owner's own search text `q` is in request logs). Not stored (Plan 15d or later): thread replies, Instagram's hidden flag, commenter ids.
```

- [ ] **Step 3: `docs/TODO.md`**
  - in section 6l, the line `- [ ] Later: .zip upload (DecompressionStream + inflated-size caps), gzip payload for > 50,000 followers, commenters × followers (Plan 15c)` → `- [ ] Later: .zip upload (DecompressionStream + inflated-size caps), gzip payload for > 50,000 followers _(commenters × followers: Plan 15c, see 6m)_`
  - insert directly BEFORE the line `## 6b. Next (Plan 14/15 Settings)`:

```markdown
## 6m. Comment insights (Plan 15c, read-only)
- [x] Migration `20261029000001_comment_insights.sql` (`comment_list`, `comment_fans`, `comment_outsiders`, comments policy InitPlan) _(written and tested; NOT applied to the live database — owner go-ahead, BEFORE deploying, docs/RUNBOOK_COMMENTS.md §0)_
- [x] Comments tab (Overview, Growth, Posts, Stories, Comments, Followers): All comments with search / comment date / post / show only and server pages, Unanswered questions, Fans (top, new, gone quiet), Topics (en + zh, no AI), Not following you (newest follower export); "Reconnect to enable comments" without the scope _(code done; NOT verified live)_
- [ ] Owner: apply the migration (runbook §0); Reconnect each account once (§1); a real comment from another account (§2, gate); views, layout, privacy, speed (§3–§6); confirm the plan's open questions (fifth tab before Followers, fan rules, derived "reply seen", no export, question words, topics from the newest 1,000)
- [ ] Plan 15d (moderation): reply / hide / delete, banned words + spam auto-hide with undo log; read thread replies and the hidden flag (makes "Unanswered questions" exact)
```

- [ ] **Step 4: `docs/PROGRESS.md`**
  - after the line that starts `- **15b: Followers tab.**` and its continuation line (`  \`RUNBOOK_FOLLOWERS\`.`), insert: `- **15c: Comments tab (read-only).** All comments (search, comment date, post, pages), unanswered questions (rule-based), fans (top / new / gone quiet), topics (en + zh, no AI), commenters who don't follow you (newest follower export). Migration \`20261029000001\` NOT applied yet. \`RUNBOOK_COMMENTS\`.`
  - `Account page tabs now: **Overview, Growth, Posts, Stories, Followers**` → `Account page tabs now: **Overview, Growth, Posts, Stories, Comments, Followers**`
  - in the migrations table, after the row that starts `| 20261028000002_follower_exports |`, add `| 20261029000001_comment_insights | \`comment_list\`, \`comment_fans\`, \`comment_outsiders\`, comments policy InitPlan (NOT applied yet) |`
  - in section 7, the item that starts `1. **Plan 15c: comments, fans and moderation**`: put ` Insights (fans, questions, topics, commenters who don't follow you) are built (Plan 15c, read-only); moderation is Plan 15d.` right after `Comments are already ingested read-only (11b).`
  - in section 8, after the line that starts `- 15b:`, add `- 15c: Comments as the fifth tab (before Followers), fan rules 3 / 2 in 30 days / 3 posts, "reply seen" derived from your own @mentions, no comment export, English question words at the start only, topics from the newest 1,000 comments of the range.`

- [ ] **Step 5: `docs/HANDOVER.md`** — directly AFTER the paragraph that starts `In one paragraph: Plans 1 to 15b are built`, insert a blank line and: `**Plan 15c (2026-10-29): the read-only Comments tab is code-complete (docs/superpowers/plans/2026-10-29-15c-comment-insights.md, docs/RUNBOOK_COMMENTS.md); its migration 20261029000001 is NOT applied; nothing verified live. Plan 15d (moderation) builds on CommentRow / CommentsTab renderActions / CommentView.**`

- [ ] **Step 6: `docs/UI_STANDARDS.md`** — after the line that starts `15. **Uploads are parsed in the browser`, add:

```markdown
16. **Third-party text is text.** Comments, captions and names from other people are rendered as React text (never `dangerouslySetInnerHTML`), length-capped in lists (`capText`, emoji never split) with `break-words`, and never put in a URL; what the owner types into a search box may appear in request logs, so the runbook says so. → `components/account/CommentRow.tsx`, `lib/comments/view.ts`, `tests/comments-privacy.test.ts`.
```

- [ ] **Step 7: Final check** (the orchestrator runs this after merging every task; an implementer of this task only checks the docs render and `npx vitest run tests/ui-standards.test.ts tests/messages.test.ts`)

```bash
rm -rf .next
npm run check > check.log 2>&1; echo "CHECK_EXIT=$?" >> check.log
```
Read `check.log`: lint, tsc, all tests (≈ 257 files) and the build pass. Known environment issue seen in the scratch run: `next build` compiled and generated every route, then stopped with `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability` (the Next.js 16.4.0 advisory check, unrelated to this plan; it would stop `main` too). If it appears, tell the owner (upgrading Next is a separate, approved change), do not work around it.

- [ ] **Step 8: Commit**

```bash
git add docs/RUNBOOK_COMMENTS.md docs/SPEC.md docs/TODO.md docs/HANDOVER.md docs/PROGRESS.md docs/UI_STANDARDS.md
git commit -m "docs: Plan 15c comment insights (runbook, SPEC 7i, TODO 6m, progress, UI standard 16)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
