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
