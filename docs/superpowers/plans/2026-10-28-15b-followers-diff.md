# Plan 15b: Followers diff by export upload (the by-name part of the Followers & Growth Center) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** For one account at a time, the owner uploads the `followers_N.json` and `following.json` files of Instagram's "Download your information" export; the app keeps them as dated snapshots (usernames and timestamps only) and compares any two: **new followers, unfollowers, people who don't follow you back, people you don't follow back, mutuals** — searchable, paged on the server, exportable to Excel, clearly labelled "snapshot-based". A guided "how to get the file" panel (en / zh-CN) explains the exact Instagram path. Nothing is crawled or scraped (creator-toolkit design §0b: by-name crawling was DECLINED; the export upload is the only by-name route).

**Architecture:** The export files are read and parsed **in the browser** by a pure, size-capped, shape-validating parser (`lib/followers/parse.ts`: `JSON.parse` only, never executes anything, tolerant of the known format variants, error KEYS not prose). Only the extracted minimum — lower-cased usernames with their follow timestamps — is sent as a compact JSON payload to an owner-only route handler (`POST /api/accounts/[id]/followers`) that checks the owner (`assertOwner`) first, then the same-origin `Origin`, the content type and a hard byte cap BEFORE reading or parsing, and re-validates every value with a strict validator (`lib/followers/payload.ts`). A snapshot is ONE row per upload in a new owner-authored table `follower_exports` (array columns: usernames `text[]`, timestamps `bigint[]`; RLS `is_owner()` for all; `on delete cascade` from `accounts`). The diff is a pure TypeScript set computation (`lib/followers/diff.ts`, 50k × 50k in milliseconds) run on the server for the requested page only; the tab gets 50 rows at a time. One choke point touches the table: `lib/followers/read.ts` (a test enforces it). Without the migration the tab says "needs a database update" and the upload answers `notReady` — nothing else breaks.

**Tech Stack:** Next.js 16.4 App Router (route handler + server action), React 19.3, TypeScript strict, Supabase Postgres (RLS), `@supabase/supabase-js` owner-session client, next-intl 4, shadcn/Radix via the shared pieces (`ResponsiveDialog*`, `FilterToolbar`/`FilterSearch`/`FilterSelect`, `Pagination`, `DataTable` server mode, `ConfirmDialog`, `EmptyState`, `LoadingButton`), `write-excel-file` (already installed, through `lib/export/workbook.ts`), Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b (export upload = the only by-name route, on demand, reminder off by default, "the app does the work"), §2 (no follower-list API; verify the file shape on a real export), §6 "Followers diff (export upload)", §8 (owner-authored tables with `is_owner()` policies; privacy of third-party usernames; i18n, tokens, responsive, a11y, no heavy dependencies), §10 (export file names: unconfirmed). UX rules: `docs/superpowers/specs/2026-10-20-ux-polish-and-tabs-design.md` and `docs/UI_STANDARDS.md` (rules 1–13). Project rules: `CLAUDE.md` (binding). Plan 15a (growth analytics, written in parallel) is independent: see "Coordination with Plan 15a".

**Dry run:** none. The parser and the diff are fully specified with tests below; the file format assumptions are listed in "Assumptions about the Instagram export" and confirmed by the owner's real export in `docs/RUNBOOK_FOLLOWERS.md` §2 BEFORE the feature is called done.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **Placement: a fourth account tab, "Followers"** (`?tab=followers`, after Overview / Posts / Stories). Why: snapshots belong to one account (the export is per profile), the by-name lists are a list page (search, pages, export — UI standard 12), and the account page is the per-account home whose tab bar already streams one tab at a time. Not a section of Overview (trend page with the range bar; rule 4 says lists never show it), not a new top-level page (the owner works account by account; a portfolio page of names is YAGNI). The tab never shows the range bar; the Time Scope params ride along in its links untouched, like Posts/Stories.
- **The browser parses the files; the server receives only usernames and timestamps.** Reasons: (1) **platform limit** — Vercel Functions reject request bodies over 4.5 MB, and a 50,000-follower `followers_1.json` is ~8–13 MB raw (each entry ≈ 150–250 bytes with `href`, `title`, `media_list_data`, indentation), so uploading the raw file cannot work for the accounts that need this most; the compact payload is ≈ 25–47 bytes per person (≤ 2.8 MB at the caps); (2) **privacy** — the raw files (hrefs, unknown future fields) never leave the device; (3) the parser is pure and shared, so the browser shows a preview ("2,341 followers, 512 following, 3 entries skipped") before anything is sent. The server **never trusts** the browser: it re-validates every value with a separate strict validator (`validateUpload`), so a hand-crafted request gains nothing over the UI.
- **Route handler, not a server action, for the upload:** `POST /api/accounts/[id]/followers`. Server actions are capped at 1 MB by default and raising `serverActions.bodySizeLimit` would raise it for EVERY action; a route handler gets its own limit. Order of checks (each fails closed with a fixed error key and no body echo): `assertOwner(h)` → account id is a uuid → `Origin` header equals the app's origin (CSRF: the session cookie is the credential) → `content-type` is `application/json` → `content-length` present and ≤ `MAX_BODY_BYTES` → the body is read through a byte-counting reader that aborts past `MAX_BODY_BYTES` (a lying or missing length cannot get more in) → strict UTF-8 decode → `JSON.parse` → `validateUpload` → the account is live (owner session, RLS) → snapshot cap → insert (owner session, RLS). Delete is a server action (`deleteFollowerSnapshotAction`, tiny payload, `requireOwner` first) like tags/saved views.
- **Limits (one constants block in `lib/followers/parse.ts`, imported by the server validator):** `MAX_FILES = 10` per upload; `MAX_FILE_BYTES = 32 MiB` per file and `MAX_TOTAL_BYTES = 64 MiB` (checked from `File.size` BEFORE a byte is read: a hostile or wrong file cannot freeze the tab); `MAX_FOLLOWERS = 50_000` and `MAX_FOLLOWING = 10_000` people (Instagram caps following at 7,500); `MAX_BODY_BYTES = 4_000_000` on the server (under Vercel's 4.5 MB; the payload at both caps with 30-character names is ≈ 2.8 MB); `MAX_SNAPSHOTS = 60` per account (5 years monthly or ~1 year weekly). ⚠ Accounts above 50,000 followers get the clear error `tooManyFollowers` (Open question 1).
- ⚠ **No .zip upload in this plan ("later").** Instagram delivers a .zip; the owner unzips it and picks `followers_1.json` (+ `followers_2.json` …) and `following.json` (multi-select in one file picker; the guide says where they are). Reading a zip safely needs a central-directory parser plus `DecompressionStream('deflate-raw')` with per-entry and total inflated-size caps (zip-bomb guard) — ~100 lines of security-sensitive code, or a new dependency (`fflate`). Not worth it before the plain JSON path is proven on a real export. Choosing a `.zip` gives the error `zipNotSupported` ("Unzip the file first, then choose the JSON files inside"). Open question 2.
- **What the parser accepts** (`parseExportFiles`, pure; every variant has a test):
  - a top-level **array** of entries (the `followers_N.json` form) — the file name decides the kind: `followers.json` / `followers_<n>.json` → followers, `following.json` / `following_<n>.json` → following; any other name → `unknownFile`;
  - a top-level **object** wrapping the entries: `relationships_followers` → followers, `relationships_following` → following; an object whose keys all start with `relationships_` but is neither (e.g. `recently_unfollowed_profiles.json` = `relationships_unfollowed_users`, `pending_follow_requests.json` = `relationships_follow_requests_sent`, close friends, blocked …) is **recognised and skipped** (listed under "Not needed" in the preview, never sent);
  - followers split across `followers_1.json`, `followers_2.json`, …: merged (union);
  - per entry, the username is the first valid of: `string_list_data[0].value`, the entry's `title` (newer `following.json` exports put the name there and leave `value` out), the last path segment of `string_list_data[0].href` (`https://www.instagram.com/<name>` or `…/_u/<name>`); it is trimmed, a leading `@` dropped, lower-cased, and must match `^[a-z0-9._]{1,30}$` (Instagram's username alphabet) — otherwise the entry is **skipped and counted** (never an error: one odd entry must not block 40,000 good ones); the timestamp is `string_list_data[0].timestamp` when it is an integer of seconds in [2010-01-01, now + 1 day], else null; unknown fields are ignored; duplicates keep the first entry (and fill a missing timestamp from a later one);
  - **rejected with an error key** (the whole upload stops, the file is named): not `.json` (`notJson`), `.zip` (`zipNotSupported`), `.html` or content starting with `<` (`htmlFormat`: "choose JSON when you create the export"), invalid JSON (`badJson`), JSON of another shape (`badShape` / `unknownFile`), too many files / bytes / people (`tooManyFiles`, `fileTooLarge`, `totalTooLarge`, `tooManyFollowers`, `tooManyFollowing`), no followers file at all (`needFollowers`: the diff needs the followers list; `following.json` alone is useless).
  - **never executes content:** `JSON.parse` without a reviver, no `eval`/`Function`/`innerHTML`; usernames are kept in `Map`/`Set` (so names like `__proto__`, which match the alphabet, are plain keys) and rendered as React text.
- **Storage: ONE row per snapshot with array columns** — table `follower_exports (id, account_id → accounts on delete cascade, taken_on date, followers text[], followers_at bigint[], following text[] null, following_at bigint[] null, follower_count / following_count generated from cardinality, created_at)`. Size at 50,000 followers + 7,500 following: one row per username would be ≈ 110 bytes each (24-byte tuple header, 4-byte line pointer, 16-byte snapshot uuid, the name, an 8-byte timestamp, plus a btree entry on `(snapshot, name)`) ≈ **6.3 MB per snapshot ≈ 330 MB per year of weekly uploads** — most of the Supabase Free plan's 500 MB for ONE account; the array row is ≈ 1.3 MB of array data before compression (≈ 20 bytes per name element, 8 per timestamp) and TOAST-compressed (pglz) to roughly **0.8–1 MB per snapshot ≈ 50 MB per year**, with no per-name index, and it is read in ONE round trip. The arrays are never queried element-wise in SQL (the diff is TypeScript), so per-name rows buy nothing. The list of snapshots reads only the small columns (`id, taken_on, follower_count, following_count, created_at`); the arrays stay in TOAST until a diff needs them. Timestamps are epoch **seconds** as `bigint` (no 2038 limit; JSON numbers in PostgREST) with NULL for "unknown".
- **Snapshot date (`taken_on`)**: chosen in the upload dialog (a native `<input type="date">`, default today in the owner's timezone, never in the future, not before 2010-10-06) — the date the owner requested the export, which orders the snapshots. Two snapshots on one day are allowed (ordered by `created_at`).
- **RLS and privacy:** owner-authored data, like `tags` / `explorer_views`: `for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))`, `revoke all … from anon`. Reads and writes use the OWNER-SESSION client (never the admin client). Third-party usernames are personal data: owner-only; never logged (fixed `console.error` texts only, nothing from the payload or the database); never in `sync_runs`, alerts, push, the workbook/PDF exports or the shareable report; only in this tab and its own explicit "Export list" (the owner's choice). Deleted with the account (`on delete cascade`: the confirmed "Delete all data permanently" action of SPEC §7c removes the account row) and individually from the snapshot list. Archiving an account keeps them (history kept, SPEC §7c). `tests/followers-privacy.test.ts` pins: only `lib/followers/read.ts` names the table; no `console.log` / `console.info` / `console.warn` in `lib/followers/*`, the upload route or the export route, and their `console.error` calls take one string literal.
- **The diff (`diffSnapshots(newer, older)`)**, sets on lower-cased names: new followers = newer.followers − older.followers; unfollowers ("lost") = older.followers − newer.followers; they don't follow you back = newer.following − newer.followers; you don't follow back = newer.followers − newer.following; mutuals = newer.followers ∩ newer.following. Without an older snapshot, new/lost are unavailable ("upload a second export to see changes"); without `following.json` in the newer snapshot, the three following-based lists are unavailable. Each person carries the timestamp from the file the list comes from (followed you on / you followed on). Lists sort by that timestamp, newest first, unknown last, then by name. Search = case-insensitive substring of the username (lower-cased query, at most 30 characters — a username's length).
- **Snapshot-based labelling:** every list shows "Snapshot-based: only people who followed or unfollowed between these two files ({older} → {newer}). Renamed and deactivated accounts can appear as unfollowers." (and the export carries the same note on an "About" sheet).
- **Server pages:** 50 rows per page (`FOLLOWER_PAGE = 50`), `Pagination` + a count line, `DataTable` in server mode (rows as given, no client sort, phone cards). The diff runs on the server per request (two single-row reads ≈ 1–2 MB from PostgREST for the biggest account, Set operations in milliseconds); only the page's 50 rows reach the browser. `ponytail:` re-reads both snapshots on every page/search change; add a per-snapshot cache (or a SQL `unnest … except` function) only if the runbook's timing check fails.
- **URL state** (validated on the server, invalid values dropped): `snap` (uuid of the newer snapshot; default the newest), `vs` (uuid of the snapshot to compare with; default the one just before `snap`; two given ids are ordered by date so "newer" is always the later one), `list` ∈ `new` | `lost` | `theyDontFollow` | `iDontFollow` | `mutual` (default `new` when there is a comparison, else `theyDontFollow`), `q`, `page`. A list, snapshot or search change drops `page`; the search chip and "Clear all" remove only `q`.
- **Reminder:** ⚠ no notification and no setting (spec §0b: reminder off by default, "no recurring chores"). The tab itself shows a quiet line when the newest snapshot is older than 30 days ("Your newest export is 45 days old. Upload a new one to see recent changes.") — no badge, no push. Open question 4.
- **Not stored (YAGNI + less personal data):** `recently_unfollowed_profiles.json` (accounts the OWNER unfollowed) and pending follow requests (requests the OWNER sent): they describe the owner's own actions, the five lists do not need them, and storing them would add third-party names with no use. The parser recognises and skips them. Open question 3.
- **Missing migration = a clear note, not an error page:** PostgREST `PGRST205` / Postgres `42P01` (table not found) → `listFollowerSnapshots` returns `null` → the tab shows the guide plus "Followers needs a database update (docs/RUNBOOK_FOLLOWERS.md §0)" and no upload button; the route answers 503 `notReady`. Every other error → the normal error screen / `unexpected`.
- **No integration hooks** (commenters × followers is Plan 15c). **No new dependencies, no Meta calls, no sync changes, no new design tokens.**

## Open questions for the owner (the plan implements the default shown)

1. Accounts above **50,000 followers** get "This export has more than 50,000 followers; that is more than in2sight can compare yet"? **Default: yes.** Upgrade path (no dependency): the browser gzips the payload with the native `CompressionStream`, the route inflates with `DecompressionStream` under an inflated-size cap — ~150,000 followers within Vercel's 4.5 MB.
2. **No .zip upload** for now: unzip, then pick the JSON files? **Default: yes ("later").**
3. Ignore `recently_unfollowed_profiles.json` and pending follow requests (your own actions, not needed for the five lists)? **Default: yes** (recognised and skipped, never stored).
4. Reminder: only a quiet line in the Followers tab when the newest export is older than 30 days — no push, no setting? **Default: yes** (spec §0b: reminder off by default).
5. At most **60 snapshots per account** (delete old ones to upload more)? **Default: yes** (~1 MB each for a 50,000-follower account).
6. "Followers" as a fourth account tab? **Default: yes.**
7. The snapshot date is picked in the upload dialog (default today) rather than guessed from the files (the files carry no export date)? **Default: yes.**
8. Unfollowers include renamed and deactivated accounts (the export only has usernames; there is no way to tell them apart) — labelled on the list? **Default: yes.**

## Assumptions about the Instagram export (UNCONFIRMED until the owner's real export — RUNBOOK_FOLLOWERS §2)

Taken from public descriptions of the "Download your information" JSON export (2023–2026) and the spec §2/§10; Instagram changes this format without notice, which is why the parser is tolerant and every variant is a test fixture:

- E1. Path in the app: profile → menu (☰) → **Accounts Center** → **Your information and permissions** → **Export your information** (older label: "Download your information") → **Create export** → pick the profile → **Export to device** → **Customize information**: only **Followers and following** (under "Connections") → **Date range: All time** → **Format: JSON** → **Start export**; a notification/email when ready; the download link expires after a few days.
- E2. Inside the zip: `connections/followers_and_following/` (older exports: `followers_and_following/`) holds `followers_1.json` (more files `followers_2.json` … for big accounts), `following.json`, and optional files such as `recently_unfollowed_profiles.json`, `pending_follow_requests.json`, `recent_follow_requests.json`, `close_friends.json`, `blocked_profiles.json`, `restricted_profiles.json`, `removed_suggestions.json`, `hide_story_from.json`.
- E3. `followers_N.json` = a top-level array of `{ "title": "", "media_list_data": [], "string_list_data": [{ "href": "https://www.instagram.com/<name>", "value": "<name>", "timestamp": <unix seconds> }] }`; some exports wrap it as `{ "relationships_followers": [ … ] }`.
- E4. `following.json` = `{ "relationships_following": [ … ] }` with the same entries; newer exports put the name in `title` and leave `value` out, with `href` like `https://www.instagram.com/_u/<name>`.
- E5. The optional files are objects with one `relationships_*` key (`relationships_unfollowed_users`, `relationships_follow_requests_sent`, …).
- E6. Usernames in the file are already lower-case and match `[a-z0-9._]{1,30}`; timestamps are seconds since 1970 (UTC) of when the follow happened.
- E7. Text is UTF-8 JSON, sometimes with mojibake in `title` fields (Latin-1 re-encoding of UTF-8) — irrelevant here because usernames are ASCII by Instagram's rules.
- E8. An HTML-format export has `followers_1.html` etc. → the parser says "choose JSON".

If the real export differs, the fix is a new fixture + a branch in `entryName`/`kindOf` (Task 3), nothing else.

## Assumptions about the current code (`main` at `0cee097`, read for this plan)

- Migrations through `20261027000001_post_story_lists.sql` are applied live (docs/HANDOVER.md). `public.is_owner()` (`20261014000001`), `public.accounts (id uuid pk, username, status 'active'|'needs_reconnect'|'archived', …)` with owner-select RLS (`20261014000002`). Owner-authored tables `tags` (`20261017000001`) and `explorer_views` (`20261024000001`: `for all to authenticated using (public.is_owner()) with check (public.is_owner())`, `revoke all on public.explorer_views from anon`). A table named **`follower_snapshots` already exists** (`20261019000001_capture_v2.sql`: the follower COUNT per sync tick, read-only for the owner) — hence the new name `follower_exports`. `tests/migrations.test.ts` (generic: timestamp names, RLS + a policy per table, policies `to authenticated` only, `(select auth.uid())`) and `tests/post-lab-migration.test.ts` / `tests/lists-migration.test.ts` (text assertions, comments stripped) are the models.
- "Delete all data permanently" (SPEC §7c) = `deleteAccountPermanently` (`lib/accounts/service.ts`) → `store.remove(id)` → `db.from('accounts').delete().eq('id', id)` (`lib/accounts/supabase-store.ts`, admin client) → every `on delete cascade` child goes with it. There is no app-wide "delete everything" action yet; the Settings "Data & privacy" section (spec §7) must list `follower_exports` when it is built (SPEC note in Task 9).
- `lib/auth/assert-owner.ts`: `assertOwner(responseHeaders?: Headers): Promise<boolean>` (fail closed). `lib/auth/require-owner.ts`: `requireOwner()` (redirects by throwing; called outside try/catch). `lib/supabase/server.ts`: `createServerSupabase({ responseHeaders }?)` (owner session). Route handler model: `app/api/media/[id]/cover/route.ts` (`ctx: { params: Promise<{ id: string }> }`, `private, no-store` + `nosniff` headers, fixed error JSON) and its test `tests/cover-route.test.ts` (`// @vitest-environment node`, `vi.hoisted` state, mocked `assertOwner` and `createServerSupabase`). Server action model: `app/(app)/tags/actions.ts`, `app/(app)/explorer/actions.ts` (owner session, `isUuid`, `revalidatePath('/accounts/[id]', 'page')`), tested by `tests/tag-actions.test.ts` (chainable fake db with a result queue).
- **No file upload exists anywhere in the repo** (no `<input type="file">`, no `formData()` / `request.json()` body reads in route handlers; every existing route is GET or a signed Meta callback). This plan adds the first one.
- `next.config.ts` sets no `serverActions.bodySizeLimit` (default 1 MB) — unchanged by this plan.
- Export pieces: `lib/export/workbook.ts` (`sheet<R>(name, cols: Col<R>[], rows, { prefs })`, `Col<R> { header; kind: 'text'|'count'|'avg'|'percent'|'date'|'datetime'; width; get }` — text cells go through `safeText` (the formula-injection guard of `lib/export/cells.ts`), `translator(locale)`, `writeWorkbook(sheets)`, `WorkbookSheet`), `lib/export/cells.ts` (`sheetNames`, `safeText`), `lib/export/request.ts` (`exportHeaders()`, `exportError(h, status, error)`, `exportFile(h, body, type, disposition)`), `lib/export/filename.ts` (`contentDisposition(base, 'xlsx')`), `lib/export/download.ts` (`downloadExport(url, 'xlsx')` → `{ ok } | { ok: false; error }` with `export.errors.*` keys `bad_params | unauthorized | not_found | unexpected`). Model route: `app/api/export/explorer/route.ts`; model sheet: `lib/export/explorer.ts`.
- Account page: `lib/dashboard/account.ts` `TABS = ['overview', 'posts', 'stories'] as const`, `parseTab`; `components/account/AccountView.tsx` maps `TABS` to `TabsList variant="line"` triggers labelled `t(\`tab.${v}\`)` (`pages.account.tab.*`); `components/account/TabSkeleton.tsx` (`switch (tab)`); `app/(app)/accounts/[id]/(tabs)/page.tsx` `TabContent` `switch (tab)` with `case 'posts'` / `case 'stories'` / `default`, the Suspense key ignores `LIST_KEYS` (`lib/dashboard/lists.ts`: `pr, pfrom, pto, q, format, tag, sort, page, measured, view` — so `q` and `page` of this tab also keep the toolbar mounted). Tests pinning the tab list: `tests/dashboard-account.test.ts` ("accepts the three tabs only …"), `tests/account-view.test.tsx` (line 84: `['Overview', 'Posts', 'Stories']`); page tests in `tests/account-page.test.tsx` (mocks `@/lib/dashboard/detail-read`, `@/lib/dashboard/read`, `@/lib/supabase/server`, a `streamTab` helper).
- Shared UI: `FilterToolbar({ label, children, advanced?, advancedCount?, end?, chips?, clearHref? })`, `FilterSearch({ id, label, value, placeholder?, hrefFor })`, `FilterSelect({ id, label, value, options: FilterOption[], hrefFor })`, `useApply()` (`components/shared/FilterToolbar.tsx`; they call `useRouter`); `Pagination({ page, pages, hrefFor })`; `DataTable({ rows, columns, rowKey, caption, empty, serverSort })` with `ServerSort { current; href(key) }`; `ResponsiveDialog`, `ResponsiveDialogTrigger/Content/Header/Title/Description/Footer/Close`; `ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, busy, error, onConfirm, onClose })`; `EmptyState({ icon?, title, description?, action? })` (role status); `LoadingButton({ pending, … })`; `FormField({ id, label, hint?, error?, required?, children })`; `usePrefs()` → `{ prefs }` (`components/providers/PrefsProvider.tsx`); `startProgress(href)`.
- Helpers: `isUuid` (`lib/tags.ts`), `localDay(at, tz)` / `addDays(day, n)` (`lib/sync/time.ts`), `getPrefs()` (`lib/prefs.server.ts`, `timezone`, `locale`), `DEFAULT_PREFS` (`lib/prefs.ts`, timezone `Asia/Kuala_Lumpur`), `formatDate(v, prefs)` (accepts epoch **milliseconds**), `formatNumber(n, prefs, { maximumFractionDigits })`, `MISSING_FUNCTION` (`lib/dashboard/read.ts`; this plan needs the TABLE codes instead, `PGRST205` / `42P01`, kept local in `lib/followers/read.ts`).
- `messages/*.json`: `pages.account.tab` is the one-line object `"tab": { "overview": "Overview", "posts": "Posts", "stories": "Stories" },` (zh-CN: `"tab": { "overview": "概览", "posts": "帖子", "stories": "快拍" },`) at 6-space indentation; `tests/messages.test.ts` (parity, placeholders, no copy-pasted English with 4+ letters), `tests/ui-standards.test.ts` rule 6 (no `\d{1,3}[dwmyh]` in values: write "30 days", never "30d").

## Coordination with Plan 15a (growth analytics, planned in parallel)

The two plans are independent and may run in either order. Shared touch points and the rule for each:
- **Migration timestamp:** this plan uses `20261028000002_follower_exports.sql` so Plan 15a can use `20261028000001_*`; Supabase orders by the number only (a gap is harmless; an equal number would collide).
- **`lib/dashboard/account.ts` `TABS`, the page's `switch`, `TabSkeleton`, `AccountView`-pinning tests, the messages files, SPEC/TODO/HANDOVER:** every edit in this plan is an anchored text edit (an exact line to find, the text to put), never a whole-file replacement. If Plan 15a landed first and changed an anchor line, the implementer makes the equivalent edit by hand (implementer rules §3) and lists it as a deviation. If 15a added a tab, `followers` stays LAST in `TABS`.

## Out of scope

Zip upload; gzip payload (> 50,000 followers); storing recently-unfollowed / pending requests; notification or push reminders and their setting; commenters × followers (Plan 15c); follower-count charts and follow-flow analytics (Plan 15a); a portfolio-wide (all accounts) follower view; rename detection; Settings "Data & privacy" (spec §7, later plan).

## Global Constraints

- Ponytail: smallest thing that works. Pure logic in `lib/followers/` with Vitest tests; components wire only. **No new dependencies.** No new design tokens. Inline first: the guide panel and the snapshot list live inside `FollowersTab` (one user each).
- TypeScript strict. No Meta metric names touched.
- DB: ONE new migration `supabase/migrations/20261028000002_follower_exports.sql`. **Implementers never apply it** (no `supabase`, `psql`, `db push`); it is applied later on the owner's go-ahead (runbook §0), and the code works before and after.
- Security (the focus): the route checks the owner FIRST, then origin, type and size BEFORE reading the body; the body is read with a byte cap; nothing from the request or the database is ever echoed in an error or logged; only the OWNER-SESSION client (never `createAdminSupabase`, never `account_tokens`); every query is filtered by the URL's account id AND the snapshot id; error answers are fixed keys (`unauthorized | invalid | tooLarge | notFound | notReady | tooManySnapshots | unexpected`).
- Every UI string via next-intl; ALL new keys are added by Task 2 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation `，：（）。`). The parser and the route return error KEYS; the UI translates them.
- UI standards (`docs/UI_STANDARDS.md`): `FilterToolbar` for the list (search + snapshot selects; no range bar), the URL is the state and picks apply at once (search after 400 ms), underline tabs (`TabsList variant="line"`) for the five lists, one control height per row (`size="default"` buttons, `h-[var(--ctl)]` native selects and date input), panels are `ResponsiveDialog`s, server pages with `Pagination` and a count line, full-word labels. Theming: semantic tokens only. Responsive 360 / 768 / 1280: the toolbar wraps, the table becomes cards on phones (`DataTable`), no sideways page scroll, CSS breakpoints only. a11y: the file input has a visible label, errors are `role="alert"`, the parse preview is `aria-live="polite"`, external profile links say they open Instagram.
- Dates and numbers only via `lib/format.ts` (`formatDate`, `formatDay`, `formatNumber`); pure functions take `today` / `nowSec` as inputs (no `new Date()` inside `lib/followers/*` except where a signature says so).
- Tests: Vitest timeout 20 s; jsdom 29 (`Blob` has no `.stream()`; `File.text()` exists — the upload component reads files with `file.text()`); route tests run with `// @vitest-environment node`; components that use `FilterToolbar` pieces mock `next/navigation` (below). Never chain a commit after a piped command.
- `npm run check` passes after every wave. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **Untrusted file input:** the parser accepts exactly the documented variants, skips odd entries, rejects everything else with a key, never executes content, caps files/bytes/people before and while parsing → Task 3 tests (`followers-parse`, `followers-payload`).
2. **DoS and size limits enforced server-side before parsing:** owner → origin → content type → `content-length` → byte-counting reader → decode → parse → validate → cap → insert, each failure a fixed key → Task 5 route tests ("order of checks", "a body larger than the cap is never parsed", "a lying content-length is cut off").
3. **RLS, deletion and privacy:** the table's policies, cascade, revoke from anon; owner-session client only; one choke point; no logging of names; not in other exports → Task 1 migration test, Task 5 privacy test, runbook §5.
4. **Diff correctness and honest labelling:** the five set formulas, unavailable lists, sort, search, paging, "snapshot-based" note on screen and in the export → Task 4 tests, Task 7 and Task 8 tests.
5. **Shippable without the migration:** `PGRST205`/`42P01` → `null` → the tab's "needs a database update" note; the route's 503 `notReady` → Task 5 read/route tests, Task 7 page test.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261028000002_follower_exports.sql` (new), `tests/followers-migration.test.ts` (new) | the `follower_exports` table, RLS, index, cascade |
| `messages/en.json`, `messages/zh-CN.json` | every new key (Task 2 only) |
| `lib/followers/parse.ts` (new), `tests/followers-parse.test.ts` (new) | limits, `USERNAME_RE`, `checkFiles`, `parseExportFiles` (browser side) |
| `lib/followers/payload.ts` (new), `tests/followers-payload.test.ts` (new) | `toPayload` (browser), `validateUpload` (server) |
| `lib/followers/diff.ts` (new), `tests/followers-diff.test.ts` (new) | `diffSnapshots`, `pageList`, `defaultList`, `FOLLOWER_PAGE` |
| `lib/followers/state.ts` (new), `tests/followers-state.test.ts` (new) | URL state: `parseFollowerState`, `resolvePair`, `followerHref` |
| `lib/followers/read.ts` (new), `tests/followers-read.test.ts` (new) | the ONLY module that names `follower_exports`: list, load, count, insert, delete |
| `app/api/accounts/[id]/followers/route.ts` (new), `tests/followers-route.test.ts` (new) | `POST` upload |
| `app/(app)/accounts/followers-actions.ts` (new), `tests/followers-actions.test.ts` (new) | `deleteFollowerSnapshotAction` |
| `tests/followers-privacy.test.ts` (new) | choke point + no-logging guard |
| `components/account/FollowerUpload.tsx` (new), `tests/follower-upload.test.tsx` (new) | the upload dialog |
| `components/account/FollowersTab.tsx` (new), `tests/followers-tab.test.tsx` (new) | guide, toolbar, list tabs, table, pages, snapshot list, export button |
| `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | the fourth tab, its skeleton and its `case` |
| `lib/export/followers.ts` (new), `app/api/export/followers/route.ts` (new), `tests/export-followers.test.ts` (new) | the list export |
| `docs/RUNBOOK_FOLLOWERS.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/UI_STANDARDS.md` | live + privacy checks, spec section, ticks, lessons, the upload rule |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys.

**Mocking the router in component tests** (the `FilterToolbar` pieces and the upload dialog call `useRouter`): `const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));` and `vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));`.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | `supabase/migrations/20261028000002_follower_exports.sql`, `tests/followers-migration.test.ts` | 2, 3, 4 |
| 2 | i18n: every new key | — | `messages/en.json`, `messages/zh-CN.json` | 1, 3, 4 |
| 3 | Parser + payload (pure) | — | `lib/followers/parse.ts`, `lib/followers/payload.ts`, `tests/followers-parse.test.ts`, `tests/followers-payload.test.ts` | 1, 2, 4 |
| 4 | Diff + URL state (pure) | — | `lib/followers/diff.ts`, `lib/followers/state.ts`, `tests/followers-diff.test.ts`, `tests/followers-state.test.ts` | 1, 2, 3 |
| 5 | Reads/writes, upload route, delete action, privacy guard | 1 (names), 3 | `lib/followers/read.ts`, `app/api/accounts/[id]/followers/route.ts`, `app/(app)/accounts/followers-actions.ts`, `tests/followers-read.test.ts`, `tests/followers-route.test.ts`, `tests/followers-actions.test.ts`, `tests/followers-privacy.test.ts` | 6 |
| 6 | Upload dialog | 2, 3 | `components/account/FollowerUpload.tsx`, `tests/follower-upload.test.tsx` | 5 |
| 7 | Followers tab end to end (component, `TABS`, skeleton, page `case`) | 2, 4, 5, 6 | `components/account/FollowersTab.tsx`, `tests/followers-tab.test.tsx`, `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | 8 |
| 8 | List export (sheet + route) | 2, 4, 5 | `lib/export/followers.ts`, `app/api/export/followers/route.ts`, `tests/export-followers.test.ts` | 7 |
| 9 | Docs, final check | all | `docs/RUNBOOK_FOLLOWERS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/UI_STANDARDS.md` | — |

Run order: **wave A = 1, 2, 3, 4 · wave B = 5, 6 · wave C = 7, 8 · wave D = 9.** Tasks in one wave touch disjoint files. Each task leaves `main` green: the new modules are unused until Task 7 wires the tab (which adds `followers` to `TABS` and its message in the same commit as the page `case`, the skeleton and the three pinned tests); the export route of Task 8 is reachable only from the tab's button (Task 7 builds the URL by string, so 7 and 8 do not import each other).

---

### Task 1: Migration `20261028000002_follower_exports.sql` + migration test

**Files:**
- Create: `supabase/migrations/20261028000002_follower_exports.sql`, `tests/followers-migration.test.ts`
- Existing tests that must keep passing: `tests/migrations.test.ts` (generic rules for every migration).

**Interfaces:**
- Consumes: `public.accounts (id)`, `public.is_owner()`.
- Produces (Task 5 reads and writes exactly these): table `public.follower_exports (id uuid, account_id uuid, taken_on date, followers text[], followers_at bigint[], following text[] null, following_at bigint[] null, follower_count int generated, following_count int generated, created_at timestamptz)`; index `follower_exports_account_idx (account_id, taken_on desc, created_at desc)`; policy `follower_exports_owner_all`.

- [ ] **Step 1: Write the failing test** — create `tests/followers-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261028000002_follower_exports.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.follower_exports\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('follower exports migration', () => {
  it('is additive: one table, its index, RLS, one policy and a revoke; no other statement; never account_tokens', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('one row per snapshot: names and timestamps as parallel arrays, following optional, counts generated', () => {
    const t = table();
    expect(t).toMatch(exact('id uuid primary key default gen_random_uuid()'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data permanently" removes them
    expect(t).toMatch(exact("taken_on date not null check (taken_on >= date '2010-10-06')"));
    expect(t).toMatch(exact('followers text[] not null'));
    expect(t).toMatch(exact('followers_at bigint[] not null'));
    expect(t).toMatch(/\bfollowing\s+text\[\]\s*,/i); // nullable: an upload without following.json
    expect(t).toMatch(/\bfollowing_at\s+bigint\[\]\s*,/i);
    expect(t).toMatch(exact('follower_count int generated always as (cardinality(followers)) stored'));
    expect(t).toMatch(exact('following_count int generated always as (cardinality(following)) stored'));
    expect(t).toMatch(exact('created_at timestamptz not null default now()'));
  });

  it('size sanity in the database too: the caps of lib/followers/parse.ts, equal lengths, no null names', () => {
    const t = table();
    expect(t).toMatch(exact('check (cardinality(followers) <= 50000 and cardinality(followers_at) = cardinality(followers) and array_position(followers, null) is null)'));
    expect(t).toMatch(exact('check ((following is null) = (following_at is null))'));
    expect(t).toMatch(exact('check (following is null or (cardinality(following) <= 10000 and cardinality(following_at) = cardinality(following) and array_position(following, null) is null))'));
  });

  it('owner-authored data: RLS on, one policy for the owner session (is_owner, InitPlan form), nothing for anon', () => {
    expect(sql).toMatch(exact('alter table public.follower_exports enable row level security'));
    expect(sql).toMatch(exact('create policy follower_exports_owner_all on public.follower_exports for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.follower_exports from anon'));
  });

  it('the snapshot list of an account is one index range, newest first', () => {
    expect(sql).toMatch(exact('create index follower_exports_account_idx on public.follower_exports (account_id, taken_on desc, created_at desc)'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/followers-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory … 20261028000002_follower_exports.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261028000002_follower_exports.sql` (exactly this):

```sql
-- Plan 15b: follower / following snapshots the owner uploads from Instagram's "Download your information" export
-- (creator-toolkit design §6). No API gives follower names and crawling was declined (design §0b), so this upload is
-- the only by-name route.
--
-- Owner-authored data (like tags and explorer_views): the owner session selects, inserts and deletes under RLS; the
-- app never uses the admin client for this table, and lib/followers/read.ts is the only module that names it.
-- Third-party usernames are personal data: owner-only, never logged, deleted with the account (on delete cascade =
-- SPEC §7c "Delete all data permanently") or one snapshot at a time from the Followers tab.
--
-- ONE row per snapshot with array columns instead of one row per username: at 50,000 followers a row per name costs
-- ~110 bytes each with its index entry (~6 MB per snapshot), the arrays ~1 MB after TOAST compression, read in one
-- round trip. The arrays are never queried element-wise (the diff is TypeScript, lib/followers/diff.ts).
-- followers_at / following_at: when each follow happened, seconds since 1970 UTC as in the file, NULL = unknown; same
-- length and order as the name arrays. following / following_at are NULL when the upload had no following.json.
-- The caps equal MAX_FOLLOWERS / MAX_FOLLOWING in lib/followers/parse.ts (the app checks them first).
create table public.follower_exports (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  taken_on        date not null check (taken_on >= date '2010-10-06'),
  followers       text[] not null,
  followers_at    bigint[] not null,
  following       text[],
  following_at    bigint[],
  follower_count  int generated always as (cardinality(followers)) stored,
  following_count int generated always as (cardinality(following)) stored,
  created_at      timestamptz not null default now(),
  check (cardinality(followers) <= 50000 and cardinality(followers_at) = cardinality(followers) and array_position(followers, null) is null),
  check ((following is null) = (following_at is null)),
  check (following is null or (cardinality(following) <= 10000 and cardinality(following_at) = cardinality(following) and array_position(following, null) is null))
);
-- the Followers tab lists an account's snapshots newest first; the cascade from accounts uses it too
create index follower_exports_account_idx on public.follower_exports (account_id, taken_on desc, created_at desc);
alter table public.follower_exports enable row level security;
create policy follower_exports_owner_all on public.follower_exports
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.follower_exports from anon;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/followers-migration.test.ts tests/migrations.test.ts`
Expected: PASS (5 tests in the new file; the generic suite unchanged — it finds the new table's RLS line and policy, the policy is `to authenticated`). Do NOT apply the migration anywhere (implementer rules §7).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028000002_follower_exports.sql tests/followers-migration.test.ts
git commit -m "feat(db): follower_exports (owner-uploaded follower/following snapshots, RLS, cascade)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: i18n — every new key (additions only)

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts` (parity, non-empty, placeholders, no copy-pasted English) and `tests/ui-standards.test.ts` (rule 6) must pass.

**Interfaces:**
- Produces (exact keys later tasks read): `pages.account.tab.followers`; the new object `pages.account.followerDiff` with `intro`, `guide.{title,s1…s7,privacy}`, `upload.{open,title,description,files,filesHint,date,dateHint,reading,preview,previewNoFollowing,skipped,ignored,submit,cancel,done}`, `errors.{notJson,zipNotSupported,htmlFormat,badJson,badShape,unknownFile,tooManyFiles,fileTooLarge,totalTooLarge,tooManyFollowers,tooManyFollowing,needFollowers,noFiles,badDate,unauthorized,invalid,tooLarge,notFound,notReady,tooManySnapshots,unexpected}`, `lists.{label,new,lost,theyDontFollow,iDontFollow,mutual}`, `withCount`, `hints.{new,lost,theyDontFollow,iDontFollow,mutual}`, `snapshotBased`, `needTwo`, `needFollowing`, `toolbar`, `search`, `searchChip`, `snapshot`, `compare`, `snapshotOption`, `cols.{username,followedYou,youFollowed}`, `range`, `emptyList`, `emptySearch`, `openProfile`, `export`, `stale`, `empty`, `emptyHint`, `notReady`, `notReadyHint`, `snapshots.{title,date,followers,following,uploaded,delete,deleteLabel,deleteTitle,deleteBody,confirm,cancel,notUploaded}`, `sheet.{about,field,value,account,list,newer,older,note,profile}`. (Named `followerDiff`, not `followers`, so it cannot collide with anything Plan 15a adds for follower counts.)
- Placeholders: `{username}` (guide s1, s3; upload.description; openProfile), `{file}` (the file errors), `{max}` (tooManyFiles, fileTooLarge, totalTooLarge, tooManyFollowers, tooManyFollowing, tooManySnapshots), `{followers}`/`{following}`/`{count}` plurals, `{files}`, `{label}`, `{older}`/`{newer}`, `{q}`, `{date}`, `{first}`/`{last}`/`{total}`, `{days}`. Every number passed in is already formatted by `formatNumber` (CLAUDE.md formats rule), except the plural selectors.

- [ ] **Step 1: Insert the keys** — one text edit per file (Edit tool; the anchor line occurs once; every other line stays byte-identical).

`messages/en.json` — anchor (line 383, 6-space indentation):
```json
      "tab": { "overview": "Overview", "posts": "Posts", "stories": "Stories" },
```
replace with:
```json
      "tab": { "overview": "Overview", "posts": "Posts", "stories": "Stories", "followers": "Followers" },
      "followerDiff": {
        "intro": "Compare two exports of your follower list to see who followed, who unfollowed and who doesn't follow back. Instagram shares no follower names through its API, so this works only with files you download from Instagram yourself.",
        "guide": {
          "title": "How to get the files",
          "s1": "On your phone, open Instagram as @{username}, go to your profile and tap the menu (☰), then Accounts Center.",
          "s2": "Tap Your information and permissions, then Export your information (older versions: Download your information).",
          "s3": "Tap Create export, choose @{username}, then Export to device.",
          "s4": "Tap Customize information, clear everything, then tick only Followers and following.",
          "s5": "Set Date range to All time and Format to JSON (not HTML), then tap Start export.",
          "s6": "Instagram tells you when the file is ready (minutes to a few days). Download the .zip before the link expires and unzip it.",
          "s7": "Open the folder connections › followers_and_following and upload followers_1.json (plus followers_2.json and so on, if there are more) and following.json here.",
          "privacy": "The files are read on this device. Only usernames and follow dates are sent to in2sight; only you can see them, and they are deleted with the account or when you delete the snapshot."
        },
        "upload": {
          "open": "Upload export",
          "title": "Upload an Instagram export",
          "description": "Choose followers_1.json (and followers_2.json and so on, if there are more) and following.json from the unzipped export of @{username}.",
          "files": "Export files",
          "filesHint": "JSON files from the unzipped export. Choose several at once.",
          "date": "Export date",
          "dateHint": "The day you requested the export. It puts your snapshots in order.",
          "reading": "Reading the files…",
          "preview": "{followers, plural, one {# follower} other {# followers}} and {following, plural, one {# account} other {# accounts}} you follow",
          "previewNoFollowing": "{followers, plural, one {# follower} other {# followers}}. No following.json, so the follow-back lists stay empty for this snapshot.",
          "skipped": "{count, plural, one {# entry is} other {# entries are}} not a valid username and will be skipped.",
          "ignored": "Not needed, skipped: {files}",
          "submit": "Upload",
          "cancel": "Cancel",
          "done": "Snapshot saved"
        },
        "errors": {
          "notJson": "{file} is not a JSON file. Choose the .json files from the export.",
          "zipNotSupported": "{file} is a zip file. Unzip it first, then choose the JSON files inside (connections › followers_and_following).",
          "htmlFormat": "{file} comes from an HTML export. Create the export again with Format: JSON.",
          "badJson": "{file} could not be read as JSON. Download the export again.",
          "badShape": "{file} doesn't look like a followers or following file.",
          "unknownFile": "{file} is not a followers or following file. Choose followers_1.json and following.json.",
          "tooManyFiles": "Choose at most {max} files.",
          "fileTooLarge": "{file} is larger than {max} MB.",
          "totalTooLarge": "The files together are larger than {max} MB.",
          "tooManyFollowers": "This export has more than {max} followers. in2sight can compare up to {max} for now.",
          "tooManyFollowing": "This export follows more than {max} accounts, more than Instagram allows. Check the files.",
          "needFollowers": "Add followers_1.json: the comparison needs the followers list.",
          "noFiles": "Choose the export files first.",
          "badDate": "Choose an export date that is not in the future.",
          "unauthorized": "Your session has ended. Sign in again.",
          "invalid": "The upload was not accepted. Choose the files again.",
          "tooLarge": "The upload is too large.",
          "notFound": "This account no longer exists.",
          "notReady": "Followers needs a database update first.",
          "tooManySnapshots": "This account already has {max} snapshots. Delete old ones to upload more.",
          "unexpected": "Something went wrong. Try again."
        },
        "lists": { "label": "Follower lists", "new": "New followers", "lost": "Unfollowed you", "theyDontFollow": "Don't follow you back", "iDontFollow": "You don't follow back", "mutual": "Mutuals" },
        "withCount": "{label} ({count})",
        "hints": {
          "new": "They follow you in the export of {newer} but not in the one of {older}.",
          "lost": "They followed you in the export of {older} but not in the one of {newer}. Renamed and deactivated accounts show up here too.",
          "theyDontFollow": "You follow them in the export of {newer}; they don't follow you.",
          "iDontFollow": "They follow you in the export of {newer}; you don't follow them.",
          "mutual": "You follow each other in the export of {newer}."
        },
        "snapshotBased": "Snapshot-based: only people who followed or unfollowed between these two files, not everything in between.",
        "needTwo": "Upload a second export later to see who followed and unfollowed in between.",
        "needFollowing": "This snapshot has no following.json, so this list is empty. Upload both files next time.",
        "toolbar": "Follower list filters",
        "search": "Search usernames",
        "searchChip": "Search: {q}",
        "snapshot": "Snapshot",
        "compare": "Compare with",
        "snapshotOption": "{date} · {count, plural, one {# follower} other {# followers}}",
        "cols": { "username": "Username", "followedYou": "Followed you on", "youFollowed": "You followed on" },
        "range": "{first}–{last} of {total} people",
        "emptyList": "Nobody in this list",
        "emptySearch": "No usernames match this search",
        "openProfile": "Open @{username} on Instagram",
        "export": "Export list",
        "stale": "Your newest export is {days} days old. Upload a new one to see recent changes.",
        "empty": "No exports uploaded yet",
        "emptyHint": "Follow the steps above, then upload the files.",
        "notReady": "Followers needs a database update",
        "notReadyHint": "Ask the assistant to apply the migration (docs/RUNBOOK_FOLLOWERS.md §0).",
        "snapshots": {
          "title": "Your snapshots",
          "date": "Export date",
          "followers": "Followers",
          "following": "Following",
          "uploaded": "Uploaded",
          "delete": "Delete",
          "deleteLabel": "Delete the snapshot of {date}",
          "deleteTitle": "Delete this snapshot?",
          "deleteBody": "The usernames of the export of {date} are removed for good. Other snapshots stay.",
          "confirm": "Delete snapshot",
          "cancel": "Cancel",
          "notUploaded": "Not uploaded"
        },
        "sheet": { "about": "About", "field": "Field", "value": "Value", "account": "Account", "list": "List", "newer": "Newer export", "older": "Older export", "note": "Note", "profile": "Profile link" }
      },
```

`messages/zh-CN.json` — anchor (line 383):
```json
      "tab": { "overview": "概览", "posts": "帖子", "stories": "快拍" },
```
replace with:
```json
      "tab": { "overview": "概览", "posts": "帖子", "stories": "快拍", "followers": "粉丝" },
      "followerDiff": {
        "intro": "比较两份粉丝列表导出文件，查看谁关注了你、谁取消了关注、谁没有回关。Instagram 的 API 不提供粉丝名单，所以这里只能使用你自己从 Instagram 下载的文件。",
        "guide": {
          "title": "如何获取文件",
          "s1": "在手机上以 @{username} 打开 Instagram，进入个人主页，点按菜单（☰），然后点按“账户中心”。",
          "s2": "点按“你的信息和权限”，然后点按“导出你的信息”（旧版本：“下载你的信息”）。",
          "s3": "点按“创建导出”，选择 @{username}，然后点按“导出到设备”。",
          "s4": "点按“自定义信息”，取消全部勾选，然后只勾选“粉丝和关注”。",
          "s5": "将“日期范围”设为“所有时间”，“格式”设为 JSON（不要选 HTML），然后点按“开始导出”。",
          "s6": "文件准备好后 Instagram 会通知你（几分钟到几天不等）。请在链接过期前下载 .zip 文件并解压。",
          "s7": "打开 connections › followers_and_following 文件夹，在这里上传 followers_1.json（如还有 followers_2.json 等，也一起上传）和 following.json。",
          "privacy": "文件在本设备上读取。只有用户名和关注日期会发送到 in2sight；只有你能看到它们，删除账号或删除该快照时会一并删除。"
        },
        "upload": {
          "open": "上传导出文件",
          "title": "上传 Instagram 导出文件",
          "description": "从 @{username} 解压后的导出文件中选择 followers_1.json（如还有 followers_2.json 等，也一起选择）和 following.json。",
          "files": "导出文件",
          "filesHint": "解压后导出文件中的 JSON 文件，可一次选择多个。",
          "date": "导出日期",
          "dateHint": "你申请导出的日期，用于给快照排序。",
          "reading": "正在读取文件…",
          "preview": "{followers, plural, other {# 位粉丝}}，你关注了 {following, plural, other {# 个账号}}",
          "previewNoFollowing": "{followers, plural, other {# 位粉丝}}。没有 following.json，因此该快照的回关列表为空。",
          "skipped": "{count, plural, other {# 条记录}}不是有效的用户名，将被跳过。",
          "ignored": "不需要，已跳过：{files}",
          "submit": "上传",
          "cancel": "取消",
          "done": "快照已保存"
        },
        "errors": {
          "notJson": "{file} 不是 JSON 文件。请选择导出中的 .json 文件。",
          "zipNotSupported": "{file} 是压缩文件。请先解压，再选择其中的 JSON 文件（connections › followers_and_following）。",
          "htmlFormat": "{file} 来自 HTML 格式的导出。请重新创建导出，并将格式设为 JSON。",
          "badJson": "无法将 {file} 读取为 JSON。请重新下载导出文件。",
          "badShape": "{file} 看起来不是粉丝或关注文件。",
          "unknownFile": "{file} 不是粉丝或关注文件。请选择 followers_1.json 和 following.json。",
          "tooManyFiles": "最多选择 {max} 个文件。",
          "fileTooLarge": "{file} 超过 {max} MB。",
          "totalTooLarge": "文件总大小超过 {max} MB。",
          "tooManyFollowers": "该导出的粉丝超过 {max} 位。in2sight 目前最多可比较 {max} 位。",
          "tooManyFollowing": "该导出关注的账号超过 {max} 个，超出了 Instagram 的上限。请检查文件。",
          "needFollowers": "请加上 followers_1.json：比较需要粉丝列表。",
          "noFiles": "请先选择导出文件。",
          "badDate": "请选择不晚于今天的导出日期。",
          "unauthorized": "你的会话已结束，请重新登录。",
          "invalid": "上传未被接受。请重新选择文件。",
          "tooLarge": "上传的内容太大。",
          "notFound": "该账号已不存在。",
          "notReady": "粉丝功能需要先更新数据库。",
          "tooManySnapshots": "该账号已有 {max} 个快照。请删除旧快照后再上传。",
          "unexpected": "出了点问题，请重试。"
        },
        "lists": { "label": "粉丝列表", "new": "新粉丝", "lost": "取消关注你的人", "theyDontFollow": "没有回关你的人", "iDontFollow": "你没有回关的人", "mutual": "互相关注" },
        "withCount": "{label}（{count}）",
        "hints": {
          "new": "在 {newer} 的导出中关注了你，但在 {older} 的导出中没有。",
          "lost": "在 {older} 的导出中关注了你，但在 {newer} 的导出中没有。改名或停用的账号也会出现在这里。",
          "theyDontFollow": "在 {newer} 的导出中你关注了他们，但他们没有关注你。",
          "iDontFollow": "在 {newer} 的导出中他们关注了你，但你没有关注他们。",
          "mutual": "在 {newer} 的导出中你们互相关注。"
        },
        "snapshotBased": "基于快照：只显示这两份文件之间关注或取消关注的人，不包括期间的所有变化。",
        "needTwo": "以后再上传一份导出文件，即可查看期间谁关注了你、谁取消了关注。",
        "needFollowing": "该快照没有 following.json，因此这个列表为空。下次请同时上传两个文件。",
        "toolbar": "粉丝列表筛选",
        "search": "搜索用户名",
        "searchChip": "搜索：{q}",
        "snapshot": "快照",
        "compare": "对比快照",
        "snapshotOption": "{date} · {count, plural, other {# 位粉丝}}",
        "cols": { "username": "用户名", "followedYou": "关注你的日期", "youFollowed": "你关注的日期" },
        "range": "第 {first}–{last} 位，共 {total} 位",
        "emptyList": "这个列表里没有人",
        "emptySearch": "没有符合搜索的用户名",
        "openProfile": "在 Instagram 上打开 @{username}",
        "export": "导出列表",
        "stale": "你最新的导出已是 {days} 天前的。上传新的导出即可查看最近的变化。",
        "empty": "还没有上传任何导出",
        "emptyHint": "按照上面的步骤操作，然后上传文件。",
        "notReady": "粉丝功能需要更新数据库",
        "notReadyHint": "请让助手应用数据库迁移（docs/RUNBOOK_FOLLOWERS.md §0）。",
        "snapshots": {
          "title": "你的快照",
          "date": "导出日期",
          "followers": "粉丝",
          "following": "关注",
          "uploaded": "上传时间",
          "delete": "删除",
          "deleteLabel": "删除 {date} 的快照",
          "deleteTitle": "删除这个快照？",
          "deleteBody": "{date} 导出中的用户名将被永久删除，其他快照保留。",
          "confirm": "删除快照",
          "cancel": "取消",
          "notUploaded": "未上传"
        },
        "sheet": { "about": "说明", "field": "项目", "value": "内容", "account": "账号", "list": "列表", "newer": "较新的导出", "older": "较早的导出", "note": "备注", "profile": "主页链接" }
      },
```

- [ ] **Step 2: Run the catalog tests**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts` and `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"`
Expected: PASS; the parse prints nothing. `git diff --stat messages` shows insertions plus the one changed `"tab"` line per file.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): Followers tab, export guide, upload and diff lists (en, zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
