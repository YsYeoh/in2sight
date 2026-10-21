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



### Task 3: Parser and payload (pure) — `lib/followers/parse.ts`, `lib/followers/payload.ts`

**Files:**
- Create: `lib/followers/parse.ts`, `lib/followers/payload.ts`, `tests/followers-parse.test.ts`, `tests/followers-payload.test.ts`

**Interfaces:**
- Consumes: nothing from the app (pure; `parse.ts` imports nothing, `payload.ts` imports only `parse.ts`). Both run in the browser AND on the server (no `server-only`, no Node APIs).
- Produces (exact names later tasks import):
  - `parse.ts`: `MAX_FILES = 10`, `MAX_FILE_BYTES = 32 MiB`, `MAX_TOTAL_BYTES = 64 MiB`, `MAX_FOLLOWERS = 50_000`, `MAX_FOLLOWING = 10_000`, `MIN_TS`, `USERNAME_RE`; types `FollowKind`, `ParseError`, `Person { username; at }`, `ParseFailure { ok: false; error; file? }`, `Parsed { ok: true; followers; following; skipped; ignored }`; `checkFiles(files: { name; size }[]): ParseFailure | null`; `cleanUsername(v)`, `cleanTimestamp(v, nowSec)`; `parseExportFiles(files: { name; text }[], nowSec: number): Parsed | ParseFailure`.
  - `payload.ts`: `PAYLOAD_VERSION = 1`, `MAX_BODY_BYTES = 4_000_000`, `FIRST_DAY = '2010-10-06'`, `MAX_SNAPSHOTS = 60` (per account; here so the browser dialog and the server share it without importing the database module), `interface Upload { takenOn; followers: Person[]; following: Person[] | null }`, `toPayload(u: Upload): string`, `validateUpload(body: unknown, today: string, nowSec: number): Upload | null`.
- Every `ParseError` value is a key of `pages.account.followerDiff.errors` (Task 2).

- [ ] **Step 1: Write the failing tests** — create `tests/followers-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkFiles, cleanTimestamp, cleanUsername, MAX_FILE_BYTES, MAX_FOLLOWERS, MAX_FOLLOWING, parseExportFiles, type Parsed } from '@/lib/followers/parse';

const NOW = 1_793_000_000; // 2026-10-26
const T1 = 1_700_000_000;
const T2 = 1_710_000_000;
/** One entry the way followers_1.json writes it (E3). */
const entry = (name: string, ts: unknown = T1) => ({ title: '', media_list_data: [], string_list_data: [{ href: `https://www.instagram.com/${name}`, value: name, timestamp: ts }] });
/** One entry the way newer following.json files write it: name in title, no value, /_u/ links (E4). */
const titled = (name: string, ts: unknown = T2) => ({ title: name, string_list_data: [{ href: `https://www.instagram.com/_u/${name}`, timestamp: ts }] });
const file = (name: string, json: unknown) => ({ name, text: JSON.stringify(json, null, 2) });
const ok = (r: ReturnType<typeof parseExportFiles>): Parsed => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as Parsed;
};

describe('checkFiles (before any byte is read)', () => {
  it('accepts up to 10 .json files of at most 32 MB each and 64 MB together', () => {
    expect(checkFiles([{ name: 'followers_1.json', size: 10 }, { name: 'C:\\fakepath\\FOLLOWING.JSON', size: 10 }])).toBeNull();
    expect(checkFiles([{ name: 'followers_1.json', size: MAX_FILE_BYTES }])).toBeNull();
  });

  it('names the problem with a key (and the file where there is one)', () => {
    expect(checkFiles([])).toEqual({ ok: false, error: 'noFiles' });
    expect(checkFiles(Array.from({ length: 11 }, (_, i) => ({ name: `followers_${i}.json`, size: 1 })))).toEqual({ ok: false, error: 'tooManyFiles' });
    expect(checkFiles([{ name: 'instagram-me-2026.zip', size: 1 }])).toEqual({ ok: false, error: 'zipNotSupported', file: 'instagram-me-2026.zip' });
    expect(checkFiles([{ name: 'followers_1.html', size: 1 }])).toEqual({ ok: false, error: 'htmlFormat', file: 'followers_1.html' });
    expect(checkFiles([{ name: 'followers.txt', size: 1 }])).toEqual({ ok: false, error: 'notJson', file: 'followers.txt' });
    expect(checkFiles([{ name: 'followers', size: 1 }])).toEqual({ ok: false, error: 'notJson', file: 'followers' });
    expect(checkFiles([{ name: '/tmp/followers_1.json', size: MAX_FILE_BYTES + 1 }])).toEqual({ ok: false, error: 'fileTooLarge', file: 'followers_1.json' });
    expect(checkFiles([1, 2, 3].map((i) => ({ name: `followers_${i}.json`, size: 30 * 1024 * 1024 })))).toEqual({ ok: false, error: 'totalTooLarge' });
  });
});

describe('cleanUsername / cleanTimestamp', () => {
  it('usernames: trimmed, no leading @, lower-cased, Instagram alphabet, at most 30 characters', () => {
    expect(['  @Some.User_1 ', 'abc', 'a'.repeat(30), '__proto__'].map(cleanUsername)).toEqual(['some.user_1', 'abc', 'a'.repeat(30), '__proto__']);
    for (const bad of ['', '@', 'a'.repeat(31), 'with space', 'ümlaut', 'a/b', '<script>', '名字', 42, null, undefined, {}]) expect(cleanUsername(bad), String(bad)).toBeNull();
  });

  it('timestamps: whole seconds from 2010-01-01 to one day after now, else unknown', () => {
    expect(cleanTimestamp(T1, NOW)).toBe(T1);
    expect(cleanTimestamp(NOW + 86_400, NOW)).toBe(NOW + 86_400);
    for (const bad of [NOW + 86_401, 1_262_303_999, 1.5e9 + 0.5, '1700000000', -1, null, T1 * 1000]) expect(cleanTimestamp(bad, NOW), String(bad)).toBeNull();
  });
});

describe('parseExportFiles: the accepted variants', () => {
  it('followers_1.json as a bare array (E3): value, timestamp; names lower-cased', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice'), entry('Bob.B', T2)])], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }, { username: 'bob.b', at: T2 }]);
    expect(r.following).toBeNull();
    expect(r).toMatchObject({ skipped: 0, ignored: [] });
  });

  it('the wrapped form {relationships_followers: [...]} and following.json {relationships_following: [...]}', () => {
    const r = ok(parseExportFiles([file('anything.json', { relationships_followers: [entry('alice')] }), file('following.json', { relationships_following: [entry('carol', T2)] })], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }]);
    expect(r.following).toEqual([{ username: 'carol', at: T2 }]);
  });

  it('newer following.json (E4): the name only in title, /_u/ links; a bare following.json array works too', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice')]), file('following.json', { relationships_following: [titled('dave'), titled('Eve')] })], NOW));
    expect(r.following).toEqual([{ username: 'dave', at: T2 }, { username: 'eve', at: T2 }]);
    const bare = ok(parseExportFiles([file('followers_1.json', []), file('following.json', [titled('dave')])], NOW));
    expect(bare.following).toEqual([{ username: 'dave', at: T2 }]);
  });

  it('the href is the last resort for the name (with or without /_u/, trailing slash, query)', () => {
    const viaHref = (href: string) => ({ title: '', string_list_data: [{ href, timestamp: T1 }] });
    const r = ok(parseExportFiles([file('followers_1.json', [viaHref('https://www.instagram.com/frank'), viaHref('https://instagram.com/_u/Gina/'), viaHref('https://www.instagram.com/hank?igsh=x'), viaHref('https://evil.example/ivan')])], NOW));
    expect(r.followers.map((p) => p.username)).toEqual(['frank', 'gina', 'hank']);
    expect(r.skipped).toBe(1);
  });

  it('followers split over followers_1.json, followers_2.json … are merged; a duplicate keeps the first entry and fills a missing time', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice'), entry('bob', 'x')]), file('followers_2.json', [entry('bob', T2), entry('alice', T2), entry('carl')])], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }, { username: 'bob', at: T2 }, { username: 'carl', at: T1 }]);
  });

  it('odd entries are skipped and counted, never an error; unknown fields are ignored; a BOM is fine', () => {
    const odd = [null, 42, 'alice', [], {}, { string_list_data: 'x' }, { string_list_data: [null] }, entry('bad name'), entry('a'.repeat(31)), { ...entry('ok.name', 'not a number'), extra: { deep: [1, 2] } }];
    const r = ok(parseExportFiles([{ name: 'followers_1.json', text: `\uFEFF${JSON.stringify(odd)}` }], NOW));
    expect(r.followers).toEqual([{ username: 'ok.name', at: null }]);
    expect(r.skipped).toBe(9);
  });

  it('other files of the export folder are recognised and skipped, not stored (recently unfollowed, pending requests …)', () => {
    const r = ok(
      parseExportFiles(
        [file('followers_1.json', [entry('alice')]), file('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [entry('zed')] }), file('pending_follow_requests.json', { relationships_follow_requests_sent: [entry('yan')] })],
        NOW,
      ),
    );
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }]);
    expect(r.following).toBeNull();
    expect(r.ignored).toEqual(['recently_unfollowed_profiles.json', 'pending_follow_requests.json']);
  });

  it('names are plain data: "__proto__" is an ordinary follower and nothing is polluted', () => {
    const r = ok(parseExportFiles([{ name: 'followers_1.json', text: '[{"string_list_data":[{"value":"__proto__","timestamp":1700000000}]},{"__proto__":{"polluted":1},"title":"x"}]' }], NOW));
    expect(r.followers).toEqual([{ username: '__proto__', at: T1 }, { username: 'x', at: null }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('parseExportFiles: rejected input (error key + file)', () => {
  const err = (files: { name: string; text: string }[]) => parseExportFiles(files, NOW);

  it('HTML exports, broken JSON and other shapes', () => {
    expect(err([{ name: 'followers_1.json', text: ' <html><body>followers</body></html>' }])).toEqual({ ok: false, error: 'htmlFormat', file: 'followers_1.json' });
    expect(err([{ name: 'followers_1.json', text: '[{"string_list_data": [' }])).toEqual({ ok: false, error: 'badJson', file: 'followers_1.json' });
    expect(err([file('close_friends.json', [entry('alice')])])).toEqual({ ok: false, error: 'unknownFile', file: 'close_friends.json' });
    expect(err([file('followers_1.json', { data: [entry('alice')] })])).toEqual({ ok: false, error: 'unknownFile', file: 'followers_1.json' });
    expect(err([file('followers_1.json', {})])).toEqual({ ok: false, error: 'unknownFile', file: 'followers_1.json' });
    expect(err([file('followers_1.json', { relationships_followers: { alice: 1 } })])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
    expect(err([file('followers_1.json', 42)])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
    expect(err([file('followers_1.json', null)])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
  });

  it('the comparison needs a followers list', () => {
    expect(err([])).toEqual({ ok: false, error: 'noFiles' });
    expect(err([file('following.json', { relationships_following: [entry('carol')] })])).toEqual({ ok: false, error: 'needFollowers' });
    expect(err([file('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [] })])).toEqual({ ok: false, error: 'needFollowers' });
  });

  it('people caps: 50,000 followers and 10,000 following are fine, one more is not (counted across files)', () => {
    const names = (n: number, p: string) => Array.from({ length: n }, (_, i) => entry(`${p}${i}`));
    expect(ok(parseExportFiles([file('followers_1.json', names(MAX_FOLLOWERS, 'f'))], NOW)).followers).toHaveLength(MAX_FOLLOWERS);
    expect(err([file('followers_1.json', names(MAX_FOLLOWERS, 'f')), file('followers_2.json', names(1, 'g'))])).toEqual({ ok: false, error: 'tooManyFollowers' });
    expect(err([file('followers_1.json', []), file('following.json', names(MAX_FOLLOWING + 1, 'h'))])).toEqual({ ok: false, error: 'tooManyFollowing' });
  });
});
```

and `tests/followers-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_FOLLOWERS, MAX_FOLLOWING } from '@/lib/followers/parse';
import { MAX_BODY_BYTES, toPayload, validateUpload, type Upload } from '@/lib/followers/payload';

const NOW = 1_793_000_000;
const TODAY = '2026-10-26';
const T1 = 1_700_000_000;
const upload: Upload = { takenOn: '2026-10-20', followers: [{ username: 'alice', at: T1 }, { username: 'bob', at: null }], following: [{ username: 'carol', at: T1 }] };
const body = (patch: Record<string, unknown> = {}) => ({ ...JSON.parse(toPayload(upload)), ...patch });

describe('toPayload → validateUpload', () => {
  it('round-trips the compact form: names with their times as pairs, following optional', () => {
    expect(JSON.parse(toPayload(upload))).toEqual({ v: 1, takenOn: '2026-10-20', followers: [['alice', T1], ['bob', null]], following: [['carol', T1]] });
    expect(validateUpload(JSON.parse(toPayload(upload)), TODAY, NOW)).toEqual(upload);
    const noFollowing = { ...upload, following: null };
    expect(validateUpload(JSON.parse(toPayload(noFollowing)), TODAY, NOW)).toEqual(noFollowing);
    expect(validateUpload(body({ followers: [] }), TODAY, NOW)).toEqual({ ...upload, followers: [] });
  });

  it('both lists at their caps with 30-character names stay under the body cap (and under Vercel\'s 4.5 MB)', () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ username: `${p}${String(i).padStart(29, '0')}`, at: 1_790_000_000 }));
    const big = toPayload({ takenOn: TODAY, followers: many(MAX_FOLLOWERS, 'a'), following: many(MAX_FOLLOWING, 'b') });
    expect(new TextEncoder().encode(big).length).toBeLessThan(MAX_BODY_BYTES);
    expect(MAX_BODY_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('validateUpload rejects anything else (null, nothing repaired)', () => {
  it.each([
    ['not an object', null],
    ['an array', []],
    ['a string', 'x'],
    ['an extra key', body({ extra: 1 })],
    ['a missing key', JSON.parse(toPayload(upload).replace(',"following":[["carol",1700000000]]', ''))],
    ['a "__proto__" key', JSON.parse(toPayload(upload).replace('{"v":1', '{"__proto__":{"x":1},"v":1'))],
    ['another version', body({ v: 2 })],
    ['a date that does not exist', body({ takenOn: '2026-02-30' })],
    ['a date in the future', body({ takenOn: '2026-10-27' })],
    ['a date before Instagram', body({ takenOn: '2010-10-05' })],
    ['a date with a time', body({ takenOn: '2026-10-20T00:00:00Z' })],
    ['followers not a list', body({ followers: { alice: 1 } })],
    ['followers null', body({ followers: null })],
    ['an upper-case name', body({ followers: [['Alice', T1]] })],
    ['a name with a space', body({ followers: [['al ice', T1]] })],
    ['a 31-character name', body({ followers: [['a'.repeat(31), T1]] })],
    ['a duplicate name', body({ followers: [['alice', T1], ['alice', null]] })],
    ['a pair of three', body({ followers: [['alice', T1, 'x']] })],
    ['a time as text', body({ followers: [['alice', '1700000000']] })],
    ['a time in milliseconds', body({ followers: [['alice', T1 * 1000]] })],
    ['a fractional time', body({ followers: [['alice', T1 + 0.5]] })],
    ['a time before 2010', body({ followers: [['alice', 1_000_000_000]] })],
    ['a bad following entry', body({ following: [['carol', T1], 42] })],
    ['too many followers', body({ followers: Array.from({ length: MAX_FOLLOWERS + 1 }, (_, i) => [`u${i}`, null]) })],
    ['too many following', body({ following: Array.from({ length: MAX_FOLLOWING + 1 }, (_, i) => [`u${i}`, null]) })],
  ])('%s', (_name, b) => {
    expect(validateUpload(b, TODAY, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/followers-parse.test.ts tests/followers-payload.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/followers/parse"` (and `…/payload`).

- [ ] **Step 3: Write `lib/followers/parse.ts`** (exactly this; the parser is the algorithm under review — Review Focus 1):

```ts
// Instagram "Download your information" export → follower / following lists (Plan 15b). Runs in the BROWSER on the
// files the owner picked; only the result (usernames + follow times) is uploaded. Pure: no I/O, no clock (nowSec is
// an input). Untrusted input: JSON.parse only (no reviver), nothing is executed or rendered as HTML, names live in
// Maps (so "__proto__" is a plain key), sizes are capped before reading (checkFiles) and while reading (the people caps).
// Instagram changes this format without notice: each accepted variant is a fixture in tests/followers-parse.test.ts.

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 32 * 1024 * 1024; // a 50,000-follower followers_1.json is ~8–13 MB
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_FOLLOWERS = 50_000; // = the check in supabase/migrations/20261028000002_follower_exports.sql
export const MAX_FOLLOWING = 10_000; // Instagram caps following at 7,500
export const MIN_TS = 1_262_304_000; // 2010-01-01T00:00:00Z: no Instagram follow is older
export const USERNAME_RE = /^[a-z0-9._]{1,30}$/; // Instagram's username alphabet, lower-cased

export type FollowKind = 'followers' | 'following';
export type ParseError =
  | 'noFiles'
  | 'tooManyFiles'
  | 'notJson'
  | 'zipNotSupported'
  | 'htmlFormat'
  | 'fileTooLarge'
  | 'totalTooLarge'
  | 'badJson'
  | 'badShape'
  | 'unknownFile'
  | 'tooManyFollowers'
  | 'tooManyFollowing'
  | 'needFollowers';
/** One person: the lower-cased username and when the follow happened (seconds since 1970 UTC; null = unknown). */
export interface Person {
  username: string;
  at: number | null;
}
export interface ParseFailure {
  ok: false;
  error: ParseError;
  file?: string; // the owner's own file name, shown in the message
}
export interface Parsed {
  ok: true;
  followers: Person[];
  following: Person[] | null; // null = no following file was chosen
  skipped: number; // entries without a valid username
  ignored: string[]; // recognised export files that are not needed (recently_unfollowed_profiles.json, …)
}

/** "C:\fakepath\followers_1.json" → "followers_1.json". */
const baseName = (name: string): string => name.split(/[\\/]/).pop() ?? name;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// https://www.instagram.com/<name> or …/_u/<name>, optional trailing slash, query or fragment
const HREF = /^https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([^/?#]+)\/?(?:[?#].*)?$/i;

/** Before a byte is read: how many files, their extensions and sizes. null = fine. */
export function checkFiles(files: { name: string; size: number }[]): ParseFailure | null {
  if (files.length === 0) return { ok: false, error: 'noFiles' };
  if (files.length > MAX_FILES) return { ok: false, error: 'tooManyFiles' };
  let total = 0;
  for (const f of files) {
    const file = baseName(f.name);
    const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toLowerCase() : '';
    if (ext === 'zip') return { ok: false, error: 'zipNotSupported', file };
    if (ext === 'html' || ext === 'htm') return { ok: false, error: 'htmlFormat', file };
    if (ext !== 'json') return { ok: false, error: 'notJson', file };
    if (f.size > MAX_FILE_BYTES) return { ok: false, error: 'fileTooLarge', file };
    total += f.size;
  }
  return total > MAX_TOTAL_BYTES ? { ok: false, error: 'totalTooLarge' } : null;
}

/** A username as Instagram allows it (trimmed, without a leading @, lower-cased); null for anything else. */
export function cleanUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(s) ? s : null;
}

/** Whole seconds between 2010-01-01 and one day after now; anything else is unknown. */
export function cleanTimestamp(v: unknown, nowSec: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_TS && v <= nowSec + 86_400 ? v : null;
}

/** One list entry → a person: the name from string_list_data[0].value, else title, else the href's last segment. */
function entryPerson(e: unknown, nowSec: number): Person | null {
  if (!isObject(e)) return null;
  const list = e.string_list_data;
  const first = Array.isArray(list) && isObject(list[0]) ? list[0] : {};
  const fromHref = typeof first.href === 'string' ? HREF.exec(first.href)?.[1] : undefined;
  const username = cleanUsername(first.value) ?? cleanUsername(e.title) ?? cleanUsername(fromHref);
  return username ? { username, at: cleanTimestamp(first.timestamp, nowSec) } : null;
}

type Found = { kind: FollowKind | 'ignored'; entries: unknown };

/** Which list a file holds: a bare array is named by its file name; an object by its relationships_* key. */
function kindOf(file: string, root: unknown): Found | ParseError {
  if (Array.isArray(root)) {
    if (/^followers(_\d+)?\.json$/i.test(file)) return { kind: 'followers', entries: root };
    if (/^following(_\d+)?\.json$/i.test(file)) return { kind: 'following', entries: root };
    return 'unknownFile';
  }
  if (!isObject(root)) return 'badShape';
  if ('relationships_followers' in root) return { kind: 'followers', entries: root.relationships_followers };
  if ('relationships_following' in root) return { kind: 'following', entries: root.relationships_following };
  const keys = Object.keys(root);
  // another file of the same export folder (recently unfollowed, pending requests, close friends, blocked …)
  return keys.length > 0 && keys.every((k) => k.startsWith('relationships_')) ? { kind: 'ignored', entries: [] } : 'unknownFile';
}

const CAPS: Record<FollowKind, [number, ParseError]> = { followers: [MAX_FOLLOWERS, 'tooManyFollowers'], following: [MAX_FOLLOWING, 'tooManyFollowing'] };

/**
 * The chosen files (already size-checked by checkFiles) → the followers and following lists. Several followers files
 * are merged; a duplicate keeps its first entry (and takes a timestamp a later one has); entries without a valid
 * username are skipped and counted, never an error. Any file that is not a known export file stops everything.
 */
export function parseExportFiles(files: { name: string; text: string }[], nowSec: number): Parsed | ParseFailure {
  if (files.length === 0) return { ok: false, error: 'noFiles' };
  const lists: Record<FollowKind, Map<string, number | null> | null> = { followers: null, following: null };
  const ignored: string[] = [];
  let skipped = 0;
  for (const f of files) {
    const file = baseName(f.name);
    const text = f.text.replace(/^\uFEFF/, '');
    if (/^\s*</.test(text)) return { ok: false, error: 'htmlFormat', file };
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      return { ok: false, error: 'badJson', file };
    }
    const found = kindOf(file, root);
    if (typeof found === 'string') return { ok: false, error: found, file };
    if (found.kind === 'ignored') {
      ignored.push(file);
      continue;
    }
    if (!Array.isArray(found.entries)) return { ok: false, error: 'badShape', file };
    const map = (lists[found.kind] ??= new Map());
    const [max, tooMany] = CAPS[found.kind];
    for (const e of found.entries) {
      const p = entryPerson(e, nowSec);
      if (!p) {
        skipped++;
        continue;
      }
      if (map.has(p.username)) {
        if (map.get(p.username) === null && p.at !== null) map.set(p.username, p.at);
        continue;
      }
      if (map.size >= max) return { ok: false, error: tooMany };
      map.set(p.username, p.at);
    }
  }
  if (!lists.followers) return { ok: false, error: 'needFollowers' };
  const out = (m: Map<string, number | null>): Person[] => [...m].map(([username, at]) => ({ username, at }));
  return { ok: true, followers: out(lists.followers), following: lists.following ? out(lists.following) : null, skipped, ignored };
}
```

- [ ] **Step 4: Write `lib/followers/payload.ts`** (exactly this):

```ts
// The compact upload of Plan 15b: built in the browser (toPayload) from the parsed export, checked on the server
// (validateUpload) as untrusted input — exactly four keys, every name and time re-checked, nothing repaired.
import { MAX_FOLLOWERS, MAX_FOLLOWING, MIN_TS, USERNAME_RE, type Person } from '@/lib/followers/parse';

export const PAYLOAD_VERSION = 1;
// Vercel Functions reject request bodies over 4.5 MB; both lists at their caps with 30-character names are ≈ 2.8 MB
export const MAX_BODY_BYTES = 4_000_000;
export const FIRST_DAY = '2010-10-06'; // Instagram's launch: no export is older
export const MAX_SNAPSHOTS = 60; // per account: ~1 MB each at 50,000 followers (5 years monthly, ~1 year weekly)

type Pair = [string, number | null];
export interface Upload {
  takenOn: string; // YYYY-MM-DD
  followers: Person[];
  following: Person[] | null;
}

/** The request body: `{"v":1,"takenOn":"…","followers":[["name",1690000000],…],"following":[…]|null}`. */
export function toPayload(u: Upload): string {
  const pairs = (l: Person[]): Pair[] => l.map((p) => [p.username, p.at]);
  return JSON.stringify({ v: PAYLOAD_VERSION, takenOn: u.takenOn, followers: pairs(u.followers), following: u.following ? pairs(u.following) : null });
}

const realDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function people(v: unknown, max: number, nowSec: number): Person[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [username, at] = p as unknown[];
    if (typeof username !== 'string' || !USERNAME_RE.test(username) || seen.has(username)) return null;
    if (at !== null && !(typeof at === 'number' && Number.isInteger(at) && at >= MIN_TS && at <= nowSec + 86_400)) return null;
    seen.add(username);
    out.push({ username, at });
  }
  return out;
}

/** Server side: the parsed JSON body → the upload, or null for anything that is not exactly what toPayload builds. */
export function validateUpload(body: unknown, today: string, nowSec: number): Upload | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  if (Object.keys(body).sort().join(',') !== 'followers,following,takenOn,v') return null;
  const b = body as Record<string, unknown>;
  if (b.v !== PAYLOAD_VERSION || typeof b.takenOn !== 'string' || !realDay(b.takenOn) || b.takenOn < FIRST_DAY || b.takenOn > today) return null;
  const followers = people(b.followers, MAX_FOLLOWERS, nowSec);
  if (!followers) return null;
  if (b.following === null) return { takenOn: b.takenOn, followers, following: null };
  const following = people(b.following, MAX_FOLLOWING, nowSec);
  return following ? { takenOn: b.takenOn, followers, following } : null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/followers-parse.test.ts tests/followers-payload.test.ts`, then `npx tsc --noEmit` and `npx eslint lib/followers tests/followers-parse.test.ts tests/followers-payload.test.ts`
Expected: PASS (15 + 27 tests, as in the plan author's scratch run), tsc and eslint clean.

- [ ] **Step 6: Commit**

```bash
git add lib/followers/parse.ts lib/followers/payload.ts tests/followers-parse.test.ts tests/followers-payload.test.ts
git commit -m "feat(followers): export parser (size-capped, shape-validated) and the strict upload payload" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Diff and URL state (pure) — `lib/followers/diff.ts`, `lib/followers/state.ts`

**Files:**
- Create: `lib/followers/diff.ts`, `lib/followers/state.ts`, `tests/followers-diff.test.ts`, `tests/followers-state.test.ts`

**Interfaces:**
- Consumes: `Person` (type only, `lib/followers/parse.ts` — Task 3, same wave: `import type` is erased, but `tsc` needs the file; if Task 3 has not merged yet when you run `tsc`, the only error is that missing module — merge order A puts 3 before 4; report it rather than stubbing), `isUuid` (`lib/tags.ts`).
- Produces:
  - `diff.ts`: `FOLLOWER_LISTS = ['new', 'lost', 'theyDontFollow', 'iDontFollow', 'mutual'] as const`, `type FollowerList`, `FOLLOWER_PAGE = 50`, `SEARCH_MAX = 30`, `interface Snapshot { followers; following }`, `type Diff = Record<FollowerList, Person[] | null>`, `diffSnapshots(newer, older | null): Diff`, `defaultList(d): FollowerList`, `sinceKey(l): 'followedYou' | 'youFollowed'`, `byRecent(a, b)`, `filterList(people, q)`, `interface ListPage { rows; total; page; pages }`, `pageList(people, q, page, size = FOLLOWER_PAGE): ListPage`, `interface FollowersView { list; counts: Record<FollowerList, number | null>; page: ListPage | null }`, `followersView(newer, older | null, { list, q, page }): FollowersView` (the page passes its result to the tab).
  - `state.ts`: `interface SnapshotMeta { id; takenOn; followerCount; followingCount: number | null; createdAt }`, `interface FollowerState { snap; vs; list; q; page }`, `STALE_DAYS = 30`, `FOLLOWER_KEYS = ['snap', 'vs', 'list', 'q', 'page'] as const` (the account page's Suspense key ignores them, Task 7), `parseFollowerState(sp, snapshots): FollowerState`, `resolvePair(s, snapshots): { newer; older }`, `followerHref(s, patch, keep = {}): string`, `staleDays(snapshots, today): number | null`.

> **Dependency note for the orchestrator:** Task 4 imports the TYPE `Person` from Task 3's file. Both are wave A; cherry-pick Task 3 before Task 4. An implementer of Task 4 whose worktree lacks `lib/followers/parse.ts` runs the vitest files (they pass: Vitest strips types) and reports the `tsc` error for that one import as expected.

- [ ] **Step 1: Write the failing tests** — create `tests/followers-diff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { byRecent, defaultList, diffSnapshots, filterList, FOLLOWER_PAGE, followersView, pageList, sinceKey, type Snapshot } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';

const p = (username: string, at: number | null = null): Person => ({ username, at });
const names = (l: Person[] | null) => (l === null ? null : l.map((x) => x.username).sort());

// older: a, b, c follow you. newer: b, c, d, e follow you; you follow c, d, x.
const older: Snapshot = { followers: [p('a', 10), p('b', 20), p('c', 30)], following: [p('c', 5)] };
const newer: Snapshot = { followers: [p('b', 20), p('c', 30), p('d', 40), p('e', 50)], following: [p('c', 31), p('d', 41), p('x', 42)] };

describe('diffSnapshots', () => {
  it('the five lists by name', () => {
    const d = diffSnapshots(newer, older);
    expect(names(d.new)).toEqual(['d', 'e']);
    expect(names(d.lost)).toEqual(['a']);
    expect(names(d.theyDontFollow)).toEqual(['x']);
    expect(names(d.iDontFollow)).toEqual(['b', 'e']);
    expect(names(d.mutual)).toEqual(['c', 'd']);
  });

  it('each person keeps the time from the file the list comes from', () => {
    const d = diffSnapshots(newer, older);
    expect(d.lost).toEqual([p('a', 10)]); // when a had followed (older followers)
    expect(d.theyDontFollow).toEqual([p('x', 42)]); // when you followed x (newer following)
    expect(d.mutual).toEqual([p('c', 30), p('d', 40)]); // when they followed you
  });

  it('unavailable lists are null: no older snapshot → no new/lost; no following.json → no follow-back lists', () => {
    const first = diffSnapshots(newer, null);
    expect([first.new, first.lost]).toEqual([null, null]);
    expect(names(first.mutual)).toEqual(['c', 'd']);
    const noFollowing = diffSnapshots({ followers: newer.followers, following: null }, older);
    expect([noFollowing.theyDontFollow, noFollowing.iDontFollow, noFollowing.mutual]).toEqual([null, null, null]);
    expect(names(noFollowing.new)).toEqual(['d', 'e']);
    // the OLDER snapshot's following.json is never needed
    expect(names(diffSnapshots(newer, { followers: older.followers, following: null }).lost)).toEqual(['a']);
  });

  it('identical snapshots: nobody new, nobody lost', () => {
    const d = diffSnapshots(newer, newer);
    expect([d.new, d.lost]).toEqual([[], []]);
  });

  it('defaultList: the changes when there is a comparison, else who doesn\'t follow back; sinceKey per list', () => {
    expect(defaultList(diffSnapshots(newer, older))).toBe('new');
    expect(defaultList(diffSnapshots(newer, null))).toBe('theyDontFollow');
    expect(defaultList(diffSnapshots({ followers: newer.followers, following: null }, null))).toBe('new');
    expect(sinceKey('theyDontFollow')).toBe('youFollowed');
    for (const l of ['new', 'lost', 'iDontFollow', 'mutual'] as const) expect(sinceKey(l)).toBe('followedYou');
  });

  it('50,000 × 50,000 with 7,500 following: correct counts, fast (Sets, no nested loops)', () => {
    const N = 50_000;
    const big = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => p(`user.${from + i}`, 1_700_000_000 + from + i));
    const a: Snapshot = { followers: big(0, N), following: null };
    const b: Snapshot = { followers: big(1_000, N + 1_000), following: big(40_000, 47_500) };
    const t0 = performance.now();
    const d = diffSnapshots(b, a);
    const page = pageList(d.iDontFollow!, 'user.4', 3);
    const ms = performance.now() - t0;
    expect([d.new!.length, d.lost!.length, d.theyDontFollow!.length, d.iDontFollow!.length, d.mutual!.length]).toEqual([1_000, 1_000, 0, 42_500, 7_500]);
    expect(page.rows).toHaveLength(FOLLOWER_PAGE);
    expect(ms).toBeLessThan(1_500); // ~30 ms on a laptop; generous for a loaded CI machine
  });
});

describe('ordering, search, pages', () => {
  const people = [p('zoe', 100), p('amy', null), p('bob', 300), p('cat', 300), p('dan', null), p('eve', 200)];

  it('byRecent: newest follow first, unknown times last, ties by name', () => {
    expect([...people].sort(byRecent).map((x) => x.username)).toEqual(['bob', 'cat', 'eve', 'zoe', 'amy', 'dan']);
  });

  it('filterList: a substring of the username, sorted; never mutates its input', () => {
    const before = people.map((x) => x.username);
    expect(filterList(people, 'a').map((x) => x.username)).toEqual(['cat', 'amy', 'dan']);
    expect(filterList(people, '').map((x) => x.username)).toEqual(['bob', 'cat', 'eve', 'zoe', 'amy', 'dan']);
    expect(people.map((x) => x.username)).toEqual(before);
  });

  it('pageList: pages of the given size, the total after the search, a stale page shows page 1, an empty list is one page', () => {
    expect(pageList(people, '', 2, 4)).toEqual({ rows: [p('amy', null), p('dan', null)], total: 6, page: 2, pages: 2 });
    expect(pageList(people, '', 9, 4)).toMatchObject({ page: 1, pages: 2, total: 6 });
    expect(pageList(people, 'zz', 1, 4)).toEqual({ rows: [], total: 0, page: 1, pages: 1 });
    expect(pageList(Array.from({ length: 120 }, (_, i) => p(`u${i}`, i)), '', 3)).toMatchObject({ total: 120, page: 3, pages: 3 });
  });
});

describe('followersView', () => {
  it('the default list, the size of every list (null = unavailable) and one page of the chosen list', () => {
    expect(followersView(newer, older, { list: null, q: '', page: 1 })).toEqual({
      list: 'new',
      counts: { new: 2, lost: 1, theyDontFollow: 1, iDontFollow: 2, mutual: 2 },
      page: { rows: [p('e', 50), p('d', 40)], total: 2, page: 1, pages: 1 },
    });
    expect(followersView(newer, null, { list: 'mutual', q: 'c', page: 1 })).toEqual({
      list: 'mutual',
      counts: { new: null, lost: null, theyDontFollow: 1, iDontFollow: 2, mutual: 2 },
      page: { rows: [p('c', 30)], total: 1, page: 1, pages: 1 },
    });
  });

  it('a list the snapshots cannot answer has no page', () => {
    expect(followersView(newer, null, { list: 'lost', q: '', page: 1 })).toMatchObject({ list: 'lost', page: null });
  });
});
```

and `tests/followers-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FOLLOWER_KEYS, followerHref, parseFollowerState, resolvePair, staleDays, type FollowerState, type SnapshotMeta } from '@/lib/followers/state';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const meta = (n: number, takenOn: string): SnapshotMeta => ({ id: id(n), takenOn, followerCount: 100 + n, followingCount: n === 2 ? null : 50, createdAt: `${takenOn}T10:00:00Z` });
// newest first, as listFollowerSnapshots returns them
const SNAPS = [meta(3, '2026-10-20'), meta(2, '2026-09-20'), meta(1, '2026-08-20')];
const BASE: FollowerState = { snap: null, vs: null, list: null, q: '', page: 1 };

describe('parseFollowerState', () => {
  it('nothing in the URL → every default', () => {
    expect(parseFollowerState({}, SNAPS)).toEqual(BASE);
  });

  it('keeps valid values (ids lower-cased), drops everything else', () => {
    expect(parseFollowerState({ snap: id(2).toUpperCase(), vs: id(1), list: 'lost', q: '  @Some.User ', page: '3' }, SNAPS)).toEqual({ snap: id(2), vs: id(1), list: 'lost', q: 'some.user', page: 3 });
    expect(parseFollowerState({ snap: id(9), vs: 'not-a-uuid', list: 'everyone', page: '0' }, SNAPS)).toEqual(BASE);
    expect(parseFollowerState({ snap: [id(2), id(1)], list: ['new', 'lost'], page: '1.5' }, SNAPS)).toEqual(BASE);
    expect(parseFollowerState({ list: '__proto__', page: '-2' }, SNAPS)).toEqual(BASE);
  });

  it('a snapshot compared with itself is no comparison; the search is cut at 30 characters without spaces', () => {
    expect(parseFollowerState({ snap: id(2), vs: id(2) }, SNAPS)).toMatchObject({ snap: id(2), vs: null });
    expect(parseFollowerState({ q: `a b ${'c'.repeat(40)}` }, SNAPS).q).toBe(`ab${'c'.repeat(28)}`);
  });
});

describe('resolvePair', () => {
  const pair = (s: Partial<FollowerState>) => {
    const r = resolvePair({ ...BASE, ...s }, SNAPS);
    return [r.newer?.id ?? null, r.older?.id ?? null];
  };

  it('defaults: the newest against the one just before', () => {
    expect(pair({})).toEqual([id(3), id(2)]);
    expect(pair({ snap: id(2) })).toEqual([id(2), id(1)]);
    expect(pair({ snap: id(1) })).toEqual([id(1), null]); // the oldest has nothing before it
  });

  it('any two snapshots, always in date order', () => {
    expect(pair({ snap: id(3), vs: id(1) })).toEqual([id(3), id(1)]);
    expect(pair({ snap: id(1), vs: id(3) })).toEqual([id(3), id(1)]);
    expect(pair({ vs: id(1) })).toEqual([id(3), id(1)]);
    expect(pair({ vs: id(3) })).toEqual([id(3), id(2)]); // vs = the default newer: compare with the one before
  });

  it('one snapshot → no comparison; none → nothing', () => {
    expect(resolvePair(BASE, [SNAPS[0]])).toEqual({ newer: SNAPS[0], older: null });
    expect(resolvePair(BASE, [])).toEqual({ newer: null, older: null });
  });
});

describe('followerHref', () => {
  const keep = { from: '2026-09-01', to: '2026-09-30' };

  it('the tab first, defaults omitted, the Time Scope kept untouched', () => {
    expect(followerHref(BASE, {}, keep)).toBe('?tab=followers&from=2026-09-01&to=2026-09-30');
    expect(followerHref({ ...BASE, snap: id(3), vs: id(1), list: 'lost', q: 'ann' }, {}, keep)).toBe(`?tab=followers&snap=${id(3)}&vs=${id(1)}&list=lost&q=ann&from=2026-09-01&to=2026-09-30`);
  });

  it('writes only FOLLOWER_KEYS (and tab) of its own', () => {
    const href = followerHref({ snap: id(3), vs: id(1), list: 'lost', q: 'ann', page: 2 }, { page: 2 });
    expect([...new URLSearchParams(href.slice(1)).keys()]).toEqual(['tab', ...FOLLOWER_KEYS]);
  });

  it('any change goes back to page 1; only a page link carries page; the scope never overrides the tab', () => {
    const s = { ...BASE, list: 'new' as const, page: 4 };
    expect(followerHref(s, { list: 'mutual' })).toBe('?tab=followers&list=mutual');
    expect(followerHref(s, { page: 5 })).toBe('?tab=followers&list=new&page=5');
    expect(followerHref(s, { q: '' }, { tab: 'posts' })).toBe('?tab=followers&list=new');
  });
});

describe('staleDays', () => {
  it('the newest export\'s age when it is more than 30 days, else null', () => {
    expect(staleDays(SNAPS, '2026-11-19')).toBeNull(); // 30 days
    expect(staleDays(SNAPS, '2026-11-20')).toBe(31);
    expect(staleDays([], '2026-11-20')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/followers-diff.test.ts tests/followers-state.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/followers/diff"` (and `…/state`).

- [ ] **Step 3: Write `lib/followers/diff.ts`** (exactly this; the second algorithm under review — Review Focus 4):

```ts
// The follower diff of Plan 15b: two snapshots of an account's export → five lists by name. Pure set arithmetic on
// lower-cased usernames (Sets: 50,000 × 50,000 in milliseconds). Snapshot-based: it only knows the two files, not
// what happened in between (someone who followed and unfollowed between them appears in neither).
import type { Person } from '@/lib/followers/parse';

export const FOLLOWER_LISTS = ['new', 'lost', 'theyDontFollow', 'iDontFollow', 'mutual'] as const;
export type FollowerList = (typeof FOLLOWER_LISTS)[number];
export const FOLLOWER_PAGE = 50;
export const SEARCH_MAX = 30; // a username is at most 30 characters

export interface Snapshot {
  followers: Person[];
  following: Person[] | null; // null = that upload had no following.json
}
/** Each list, or null when it needs data the snapshots don't have (an older snapshot, or following.json). */
export type Diff = Record<FollowerList, Person[] | null>;

const names = (l: Person[]): Set<string> => new Set(l.map((p) => p.username));
const minus = (a: Person[], b: Set<string>): Person[] => a.filter((p) => !b.has(p.username));

/**
 * new = newer.followers − older.followers · lost = older.followers − newer.followers (their time: when they had
 * followed) · theyDontFollow = newer.following − newer.followers (time: when you followed) · iDontFollow =
 * newer.followers − newer.following · mutual = newer.followers ∩ newer.following (time: when they followed you).
 */
export function diffSnapshots(newer: Snapshot, older: Snapshot | null): Diff {
  const followers = names(newer.followers);
  const following = newer.following ? names(newer.following) : null;
  const before = older ? names(older.followers) : null;
  return {
    new: before ? minus(newer.followers, before) : null,
    lost: older ? minus(older.followers, followers) : null,
    theyDontFollow: newer.following ? minus(newer.following, followers) : null,
    iDontFollow: following ? minus(newer.followers, following) : null,
    mutual: following ? newer.followers.filter((p) => following.has(p.username)) : null,
  };
}

/** The list shown when the URL names none: the changes when there is a comparison, else who doesn't follow back. */
export const defaultList = (d: Diff): FollowerList => (d.new === null && d.theyDontFollow !== null ? 'theyDontFollow' : 'new');

/** Which date the list's time column means (the i18n key under followerDiff.cols). */
export const sinceKey = (l: FollowerList): 'followedYou' | 'youFollowed' => (l === 'theyDontFollow' ? 'youFollowed' : 'followedYou');

/** Newest follow first, unknown times last, then by name: the order of the screen and of the export. */
export function byRecent(a: Person, b: Person): number {
  if (a.at !== b.at) return a.at === null ? 1 : b.at === null ? -1 : b.at - a.at;
  return a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
}

/** The list filtered by a (lower-cased) substring of the username, sorted byRecent. A new array. */
export function filterList(people: Person[], q: string): Person[] {
  return (q ? people.filter((p) => p.username.includes(q)) : [...people]).sort(byRecent);
}

export interface ListPage {
  rows: Person[];
  total: number; // after the search
  page: number; // a page past the end shows page 1
  pages: number;
}

export function pageList(people: Person[], q: string, page: number, size = FOLLOWER_PAGE): ListPage {
  const all = filterList(people, q);
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = page > pages ? 1 : page;
  return { rows: all.slice((p - 1) * size, p * size), total: all.length, page: p, pages };
}

/** What the tab shows for one comparison: the chosen list (or the default), every list's size, and one page of the chosen one. */
export interface FollowersView {
  list: FollowerList;
  counts: Record<FollowerList, number | null>; // null = unavailable
  page: ListPage | null; // null = the chosen list is unavailable
}

export function followersView(newer: Snapshot, older: Snapshot | null, s: { list: FollowerList | null; q: string; page: number }): FollowersView {
  const d = diffSnapshots(newer, older);
  const list = s.list ?? defaultList(d);
  const people = d[list];
  const counts = Object.fromEntries(FOLLOWER_LISTS.map((l) => [l, d[l]?.length ?? null])) as Record<FollowerList, number | null>;
  return { list, counts, page: people ? pageList(people, s.q, s.page) : null };
}
```

- [ ] **Step 4: Write `lib/followers/state.ts`** (exactly this):

```ts
// URL state of the Followers tab (Plan 15b; docs/UI_STANDARDS.md rule 3: the URL is the state). Parsed on the server,
// every value validated: snapshot ids must belong to this account's list, the list name to the allow-list.
import { FOLLOWER_LISTS, SEARCH_MAX, type FollowerList } from '@/lib/followers/diff';
import { isUuid } from '@/lib/tags';

/** One snapshot without its arrays (what the snapshot list and the selects show). */
export interface SnapshotMeta {
  id: string;
  takenOn: string; // YYYY-MM-DD
  followerCount: number;
  followingCount: number | null; // null = no following.json
  createdAt: string; // ISO
}
export interface FollowerState {
  snap: string | null; // the newer snapshot; null = the newest
  vs: string | null; // the snapshot to compare with; null = the one just before
  list: FollowerList | null; // null = defaultList()
  q: string; // lower-cased, no spaces, no leading @, at most 30 characters
  page: number;
}
export const STALE_DAYS = 30;
/** The tab's own URL keys: the account page's Suspense key ignores them, so the toolbar stays mounted while a page streams. */
export const FOLLOWER_KEYS = ['snap', 'vs', 'list', 'q', 'page'] as const;

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);

/** `snapshots` newest first (as listFollowerSnapshots returns them). */
export function parseFollowerState(sp: Params, snapshots: SnapshotMeta[]): FollowerState {
  const known = (v: string | null): string | null => (v !== null && isUuid(v) && snapshots.some((s) => s.id === v.toLowerCase()) ? v.toLowerCase() : null);
  const snap = known(one(sp.snap));
  const vs = known(one(sp.vs));
  const list = one(sp.list);
  const q = [...(one(sp.q) ?? '').replace(/\s+/g, '').replace(/^@/, '').toLowerCase()].slice(0, SEARCH_MAX).join('');
  const n = Number(one(sp.page));
  return {
    snap,
    vs: vs === snap ? null : vs,
    list: list !== null && (FOLLOWER_LISTS as readonly string[]).includes(list) ? (list as FollowerList) : null,
    q,
    page: Number.isInteger(n) && n >= 1 ? n : 1,
  };
}

/** The two snapshots to compare: newer = snap (default the newest), older = vs (default the next older one); two given ids are put in date order. */
export function resolvePair(s: FollowerState, snapshots: SnapshotMeta[]): { newer: SnapshotMeta | null; older: SnapshotMeta | null } {
  const at = (id: string | null) => (id === null ? -1 : snapshots.findIndex((x) => x.id === id));
  let a = Math.max(0, at(s.snap));
  let b = at(s.vs);
  if (b >= 0 && b < a) [a, b] = [b, a]; // vs is the later export: it becomes the newer one
  if (b < 0 || b === a) b = a + 1;
  return { newer: snapshots[a] ?? null, older: snapshots[b] ?? null };
}

/** A link inside the tab: the patch applied, page back to 1 unless patched, defaults omitted; `keep` = the Time Scope params (they ride along untouched). */
export function followerHref(s: FollowerState, patch: Partial<FollowerState>, keep: Record<string, string> = {}): string {
  const n = { ...s, page: 1, ...patch };
  const p: Record<string, string> = { tab: 'followers' };
  if (n.snap) p.snap = n.snap;
  if (n.vs) p.vs = n.vs;
  if (n.list) p.list = n.list;
  if (n.q) p.q = n.q;
  if (n.page > 1) p.page = String(n.page);
  const q = new URLSearchParams(p);
  for (const [k, v] of Object.entries(keep)) if (!q.has(k)) q.set(k, v); // never overrides the tab's own params
  return `?${q}`;
}

/** Days since the newest export when that is more than 30, else null (the quiet reminder line). */
export function staleDays(snapshots: SnapshotMeta[], today: string): number | null {
  const newest = snapshots[0];
  if (!newest) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest.takenOn}T00:00:00Z`)) / 86_400_000);
  return days > STALE_DAYS ? days : null;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/followers-diff.test.ts tests/followers-state.test.ts`, `npx tsc --noEmit`, `npx eslint lib/followers/diff.ts lib/followers/state.ts tests/followers-diff.test.ts tests/followers-state.test.ts`
Expected: PASS (11 + 10 tests), tsc and eslint clean. The 50,000-person test takes well under a second.

- [ ] **Step 6: Commit**

```bash
git add lib/followers/diff.ts lib/followers/state.ts tests/followers-diff.test.ts tests/followers-state.test.ts
git commit -m "feat(followers): snapshot diff (five lists), search and pages; Followers tab URL state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reads and writes, the upload route, the delete action, the privacy guard

**Files:**
- Create: `lib/followers/read.ts`, `app/api/accounts/[id]/followers/route.ts`, `app/(app)/accounts/followers-actions.ts`, `tests/followers-read.test.ts`, `tests/followers-route.test.ts`, `tests/followers-actions.test.ts`, `tests/followers-privacy.test.ts`
- Quote the paths with brackets/parentheses in every shell command.

**Interfaces:**
- Consumes: Task 1's table and columns (by name only: nothing runs against a database), Task 3's `Upload`, `validateUpload`, `MAX_BODY_BYTES`, `MAX_SNAPSHOTS`, `Person`, Task 4's `Snapshot`, `SnapshotMeta` (types); `assertOwner`, `requireOwner`, `createServerSupabase`, `supabaseAccountsStore(db).getById`, `getPrefs`, `localDay`, `isUuid`, `revalidatePath`.
- Produces:
  - `lib/followers/read.ts` (uses `MAX_SNAPSHOTS` from `payload.ts`): `MISSING_TABLE = ['PGRST205', '42P01']`, `listFollowerSnapshots(db, accountId): Promise<SnapshotMeta[] | null>` (null = migration missing), `loadFollowerSnapshot(db, accountId, id): Promise<Snapshot | null>`, `type SaveResult = 'ok' | 'tooManySnapshots' | 'notReady'`, `saveFollowerSnapshot(db, accountId, u: Upload): Promise<SaveResult>`, `deleteFollowerSnapshot(db, accountId, id): Promise<boolean>`. Thrown errors carry fixed messages `followers <op> failed`.
  - `POST /api/accounts/[id]/followers` (`export async function POST(request: Request, ctx: { params: Promise<{ id: string }> })`, `export type UploadError`): 201 `{ ok: true }`; errors `{ error: UploadError }` with 401 `unauthorized` (not the owner) · 404 `notFound` (bad id, unknown or archived account) · 403 `unauthorized` (another origin) · 415 `invalid` (not JSON) · 411 `invalid` (no length) · 413 `tooLarge` · 400 `invalid` · 409 `tooManySnapshots` · 503 `notReady` · 500 `unexpected`. Task 6 posts to it.
  - `app/(app)/accounts/followers-actions.ts`: `deleteFollowerSnapshotAction(accountId, snapshotId): Promise<SnapshotResult>`, `type SnapshotResult = { ok: true } | { ok: false; error: 'notFound' | 'unexpected' }`. Task 7 passes it to the tab.

- [ ] **Step 1: Write the failing tests** — create `tests/followers-read.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_SNAPSHOTS } from '@/lib/followers/payload';
import { deleteFollowerSnapshot, listFollowerSnapshots, loadFollowerSnapshot, saveFollowerSnapshot } from '@/lib/followers/read';

type Op = unknown[];
const calls: Op[] = [];
const queue: { data?: unknown; error?: unknown; count?: number | null }[] = [];

/** Owner-session fake: records every call; each awaited query (or maybeSingle) resolves to the next queued result. */
function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'delete', 'eq', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      const next = () => Promise.resolve(queue.shift() ?? { data: [], error: null });
      chain.maybeSingle = () => (calls.push(['maybeSingle']), next());
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SNAP = '00000000-0000-4000-8000-000000000001';
const SECRET = { code: 'XX000', message: 'row contains alice.secret' };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
});

describe('listFollowerSnapshots', () => {
  it('the account\'s snapshots, newest first, without the arrays', async () => {
    queue.push({ data: [{ id: SNAP, taken_on: '2026-10-20', follower_count: 3, following_count: null, created_at: '2026-10-20T10:00:00Z' }], error: null });
    expect(await listFollowerSnapshots(fakeDb(), ACC)).toEqual([{ id: SNAP, takenOn: '2026-10-20', followerCount: 3, followingCount: null, createdAt: '2026-10-20T10:00:00Z' }]);
    expect(calls).toEqual([
      ['from', 'follower_exports'],
      ['select', 'id,taken_on,follower_count,following_count,created_at'],
      ['eq', 'account_id', ACC],
      ['order', 'taken_on', { ascending: false }],
      ['order', 'created_at', { ascending: false }],
      ['limit', MAX_SNAPSHOTS],
    ]);
  });

  it('table missing (migration not applied) → null; any other error → a fixed message that never echoes the database', async () => {
    for (const code of ['PGRST205', '42P01']) {
      queue.push({ data: null, error: { code } });
      expect(await listFollowerSnapshots(fakeDb(), ACC)).toBeNull();
    }
    queue.push({ data: null, error: SECRET });
    const e = await listFollowerSnapshots(fakeDb(), ACC).catch((x: Error) => x);
    expect((e as Error).message).toBe('followers list failed');
    expect(String((e as Error).message)).not.toContain('alice');
  });
});

describe('loadFollowerSnapshot', () => {
  it('reads one snapshot of THIS account and pairs names with their times (null kept)', async () => {
    queue.push({ data: { followers: ['alice', 'bob'], followers_at: [1_700_000_000, null], following: ['carol'], following_at: [1_710_000_000] }, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toEqual({
      followers: [{ username: 'alice', at: 1_700_000_000 }, { username: 'bob', at: null }],
      following: [{ username: 'carol', at: 1_710_000_000 }],
    });
    expect(calls).toEqual([['from', 'follower_exports'], ['select', 'followers,followers_at,following,following_at'], ['eq', 'id', SNAP], ['eq', 'account_id', ACC], ['maybeSingle']]);
  });

  it('no following.json → following null; not found → null; an error → fixed message', async () => {
    queue.push({ data: { followers: [], followers_at: [], following: null, following_at: null }, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toEqual({ followers: [], following: null });
    queue.push({ data: null, error: null });
    expect(await loadFollowerSnapshot(fakeDb(), ACC, SNAP)).toBeNull();
    queue.push({ data: null, error: SECRET });
    await expect(loadFollowerSnapshot(fakeDb(), ACC, SNAP)).rejects.toThrow(/^followers load failed$/);
  });
});

describe('saveFollowerSnapshot', () => {
  const upload = { takenOn: '2026-10-20', followers: [{ username: 'alice', at: 1_700_000_000 }, { username: 'bob', at: null }], following: null };

  it('counts the account\'s snapshots, then inserts parallel arrays (nothing selected back)', async () => {
    queue.push({ count: 3, error: null }, { error: null });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('ok');
    expect(calls).toEqual([
      ['from', 'follower_exports'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'account_id', ACC],
      ['from', 'follower_exports'],
      ['insert', { account_id: ACC, taken_on: '2026-10-20', followers: ['alice', 'bob'], followers_at: [1_700_000_000, null], following: null, following_at: null }],
    ]);
  });

  it('at the cap → tooManySnapshots without inserting; table missing → notReady; other errors → fixed messages', async () => {
    queue.push({ count: MAX_SNAPSHOTS, error: null });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('tooManySnapshots');
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
    queue.push({ count: null, error: { code: 'PGRST205' } });
    expect(await saveFollowerSnapshot(fakeDb(), ACC, upload)).toBe('notReady');
    queue.push({ count: 0, error: null }, { error: SECRET });
    await expect(saveFollowerSnapshot(fakeDb(), ACC, upload)).rejects.toThrow(/^followers insert failed$/);
  });
});

describe('deleteFollowerSnapshot', () => {
  it('deletes by snapshot id AND account id; false when nothing matched', async () => {
    queue.push({ data: [{ id: SNAP }], error: null });
    expect(await deleteFollowerSnapshot(fakeDb(), ACC, SNAP)).toBe(true);
    expect(calls).toEqual([['from', 'follower_exports'], ['delete'], ['eq', 'id', SNAP], ['eq', 'account_id', ACC], ['select', 'id']]);
    queue.push({ data: [], error: null });
    expect(await deleteFollowerSnapshot(fakeDb(), ACC, SNAP)).toBe(false);
  });
});
```

`tests/followers-route.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, toPayload } from '@/lib/followers/payload';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const state = vi.hoisted(() => ({
  owner: true,
  account: { id: '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b', status: 'active' } as { id: string; status: string } | null,
  save: 'ok' as string | Error,
  order: [] as string[],
  saved: [] as unknown[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    state.order.push('assertOwner');
    h?.set('x-from-supabase', 'kept');
    return state.owner;
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (state.order.push('ownerSession'), {}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => state.order.push('ADMIN') }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (state.order.push('prefs'), (await import('@/lib/prefs')).DEFAULT_PREFS) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ getById: async (id: string) => (state.order.push(`account:${id}`), state.account) }) }));
vi.mock('@/lib/followers/read', () => ({
  saveFollowerSnapshot: async (_db: unknown, accountId: string, u: unknown) => {
    state.order.push('save');
    state.saved.push([accountId, u]);
    if (state.save instanceof Error) throw state.save;
    return state.save;
  },
}));

import { POST } from '@/app/api/accounts/[id]/followers/route';

const GOOD = toPayload({ takenOn: '2026-10-01', followers: [{ username: 'alice', at: 1_700_000_000 }], following: null });
const URL_ = `https://app.test/api/accounts/${ACC}/followers`;
const headersFor = (body: string, extra: Record<string, string> = {}) => ({ origin: 'https://app.test', host: 'app.test', 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length), ...extra });
const call = (body: BodyInit | null, headers: Record<string, string>, id = ACC) => POST(new Request(URL_, { method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit), { params: Promise.resolve({ id }) });
const err = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  state.owner = true;
  state.account = { id: ACC, status: 'active' };
  state.save = 'ok';
  state.order = [];
  state.saved = [];
});

describe('POST /api/accounts/[id]/followers', () => {
  it('stores a valid upload for the live account: 201, private no-store, nosniff, the owner session headers kept', async () => {
    const res = await call(GOOD, headersFor(GOOD));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-from-supabase')).toBe('kept');
    expect(state.order).toEqual(['assertOwner', 'prefs', 'ownerSession', `account:${ACC}`, 'save']);
    expect(state.saved).toEqual([[ACC, { takenOn: '2026-10-01', followers: [{ username: 'alice', at: 1_700_000_000 }], following: null }]]);
  });

  it('the owner check comes first: a stranger gets 401 and nothing else runs', async () => {
    state.owner = false;
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(state.order).toEqual(['assertOwner']);
  });

  it('then the account id, the origin and the content type, before the body is touched', async () => {
    expect(await err(await call(GOOD, headersFor(GOOD), 'not-a-uuid'))).toEqual({ status: 404, body: { error: 'notFound' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { origin: 'https://evil.example' })))).toEqual({ status: 403, body: { error: 'unauthorized' } });
    const noOrigin: Record<string, string> = headersFor(GOOD);
    delete noOrigin.origin;
    expect(await err(await call(GOOD, noOrigin))).toEqual({ status: 403, body: { error: 'unauthorized' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-type': 'text/plain' })))).toEqual({ status: 415, body: { error: 'invalid' } });
    expect(state.order.every((s) => s === 'assertOwner')).toBe(true);
  });

  it('behind a proxy the forwarded host is the one compared', async () => {
    const res = await call(GOOD, headersFor(GOOD, { origin: 'https://in2sight.example', host: 'internal:3000', 'x-forwarded-host': 'in2sight.example' }));
    expect(res.status).toBe(201);
  });

  it('size: a declared length over the cap is refused before reading (413); no length → 411', async () => {
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-length': String(MAX_BODY_BYTES + 1) })))).toEqual({ status: 413, body: { error: 'tooLarge' } });
    expect(await err(await call(GOOD, headersFor(GOOD, { 'content-length': '0' })))).toEqual({ status: 411, body: { error: 'invalid' } });
    expect(state.order).not.toContain('prefs');
  });

  it('a lying content-length cannot get more in: the reader stops at the cap and nothing is parsed or saved', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32); // 1 MB of spaces
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        if (pulled > 50) c.close();
        else c.enqueue(chunk);
      },
    });
    expect(await err(await call(stream, headersFor('', { 'content-length': '100' })))).toEqual({ status: 413, body: { error: 'tooLarge' } });
    expect(pulled).toBeLessThan(10); // stopped right after passing 4 MB, not after 50 MB
    expect(state.order).toEqual(['assertOwner']);
  });

  it('not UTF-8, not JSON or not the exact payload → 400 invalid, nothing saved', async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    expect(await err(await call(bytes, { ...headersFor(''), 'content-length': '4' }))).toEqual({ status: 400, body: { error: 'invalid' } });
    for (const body of ['{"v":1', '[]', GOOD.replace('"v":1', '"v":1,"extra":true'), GOOD.replace('alice', 'Alice'), GOOD.replace('2026-10-01', '2099-01-01')])
      expect(await err(await call(body, headersFor(body))), body.slice(0, 40)).toEqual({ status: 400, body: { error: 'invalid' } });
    expect(state.order).not.toContain('save');
  });

  it('unknown or archived account → 404; cap → 409; migration missing → 503', async () => {
    state.account = null;
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 404, body: { error: 'notFound' } });
    state.account = { id: ACC, status: 'archived' };
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 404, body: { error: 'notFound' } });
    state.account = { id: ACC, status: 'active' };
    state.save = 'tooManySnapshots';
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 409, body: { error: 'tooManySnapshots' } });
    state.save = 'notReady';
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 503, body: { error: 'notReady' } });
  });

  it('a failure is a fixed 500 and a fixed log line: no error object, no usernames', async () => {
    state.save = new Error('insert failed for alice');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await err(await call(GOOD, headersFor(GOOD)))).toEqual({ status: 500, body: { error: 'unexpected' } });
    expect(log.mock.calls).toEqual([['followers upload failed']]);
    log.mockRestore();
  });

  it('never the admin client', async () => {
    await call(GOOD, headersFor(GOOD));
    expect(state.order).not.toContain('ADMIN');
  });
});
```

`tests/followers-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, result } = vi.hoisted(() => ({ calls: [] as unknown[][], requireOwner: vi.fn(), result: { deleted: true as boolean | Error } }));

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => (calls.push(['requireOwner']), requireOwner()) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), { db: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/followers/read', () => ({
  deleteFollowerSnapshot: async (db: unknown, accountId: string, id: string) => {
    calls.push(['delete', db, accountId, id]);
    if (result.deleted instanceof Error) throw result.deleted;
    return result.deleted;
  },
}));

import { deleteFollowerSnapshotAction } from '@/app/(app)/accounts/followers-actions';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SNAP = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset();
  result.deleted = true;
});

describe('deleteFollowerSnapshotAction', () => {
  it('owner first, then the owner-session delete of THIS account\'s snapshot, then the account page revalidates', async () => {
    expect(await deleteFollowerSnapshotAction(ACC.toUpperCase(), SNAP)).toEqual({ ok: true });
    expect(calls).toEqual([['requireOwner'], ['session'], ['delete', { db: true }, ACC, SNAP], ['revalidate', '/accounts/[id]', 'page']]);
  });

  it('a non-owner never reaches the database (requireOwner redirects by throwing)', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT /auth/signout'));
    await expect(deleteFollowerSnapshotAction(ACC, SNAP)).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([['requireOwner']]);
  });

  it('bad ids or nothing deleted → notFound; a failure → unexpected; never the admin client', async () => {
    expect(await deleteFollowerSnapshotAction('x', SNAP)).toEqual({ ok: false, error: 'notFound' });
    expect(await deleteFollowerSnapshotAction(ACC, "1' or '1'='1")).toEqual({ ok: false, error: 'notFound' });
    result.deleted = false;
    expect(await deleteFollowerSnapshotAction(ACC, SNAP)).toEqual({ ok: false, error: 'notFound' });
    result.deleted = new Error('db down');
    expect(await deleteFollowerSnapshotAction(ACC, SNAP)).toEqual({ ok: false, error: 'unexpected' });
    expect(calls.some((c) => c[0] === 'ADMIN' || c[0] === 'revalidate')).toBe(false);
  });
});
```

`tests/followers-privacy.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Third-party usernames (follower snapshots, Plan 15b) are personal data: owner-only, never logged, never in another
// export, never through the admin client. These guards hold for every file that exists now and every later one.
const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, readFileSync(join(root, f), 'utf8')] as const);
/** Files that handle follower lists: lib/followers/* and everything that imports from it. */
const followerFiles = src.filter(([f, s]) => f.startsWith('lib/followers/') || /from '@\/lib\/followers\//.test(s));

describe('follower lists privacy', () => {
  it('only lib/followers/read.ts names the follower_exports table in code (comments may mention it)', () => {
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src.filter(([, s]) => /follower_exports/.test(code(s))).map(([f]) => f)).toEqual(['lib/followers/read.ts']);
  });

  it('no file that handles follower lists logs anything but one fixed string', () => {
    expect(followerFiles.length).toBeGreaterThanOrEqual(5);
    for (const [f, s] of followerFiles) {
      expect(s, f).not.toMatch(/console\.(log|info|warn|debug|trace|dir|table)\s*\(/);
      for (const m of s.matchAll(/console\.error\s*\(([^)]*)\)/g)) expect(m[1], f).toMatch(/^'[^'`$]*'$/);
    }
  });

  it('never through the admin client', () => {
    for (const [f, s] of followerFiles) expect(s, f).not.toMatch(/lib\/supabase\/admin|createAdminSupabase|account_tokens/);
  });

  it('the account exports (Excel workbook, PDF report) and the sync never touch follower lists', () => {
    for (const [f, s] of src)
      if (/^lib\/(export\/(read|workbook|report|pdf)|sync\/|alerts\/|push\/)/.test(f) || f.startsWith('app/api/cron/')) expect(s, f).not.toMatch(/lib\/followers\//);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/followers-read.test.ts tests/followers-route.test.ts tests/followers-actions.test.ts tests/followers-privacy.test.ts`
Expected: FAIL — the three modules do not resolve; the privacy test fails on "only lib/followers/read.ts names the follower_exports table" (`[]`) and on `followerFiles.length >= 5` (wave A left four files in `lib/followers/`).

- [ ] **Step 3: Write `lib/followers/read.ts`** (exactly this):

```ts
// Reads and writes of follower_exports (Plan 15b). The ONLY module that names that table (tests/followers-privacy.test.ts).
// Owner-session client only: RLS (follower_exports_owner_all, is_owner()) applies to every call; never the admin
// client. Every query is filtered by the account id AND (for one snapshot) the snapshot id. Errors are fixed texts:
// a Supabase error can echo row values, i.e. third-party usernames.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Snapshot } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';
import { MAX_SNAPSHOTS, type Upload } from '@/lib/followers/payload';
import type { SnapshotMeta } from '@/lib/followers/state';

/** PostgREST / Postgres "table not found": the migration 20261028000002 is not applied yet. */
export const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];

const TABLE = 'follower_exports';
type Row = Record<string, unknown>;
const missing = (e: unknown): boolean => MISSING_TABLE.includes(String((e as { code?: unknown } | null)?.code));
const fail = (op: string): never => {
  throw new Error(`followers ${op} failed`);
};

const toMeta = (r: Row): SnapshotMeta => ({
  id: String(r.id),
  takenOn: String(r.taken_on),
  followerCount: Number(r.follower_count),
  followingCount: r.following_count === null || r.following_count === undefined ? null : Number(r.following_count),
  createdAt: String(r.created_at),
});

/** The account's snapshots without their arrays, newest first. null = the table does not exist yet. */
export async function listFollowerSnapshots(db: SupabaseClient, accountId: string): Promise<SnapshotMeta[] | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('id,taken_on,follower_count,following_count,created_at')
    .eq('account_id', accountId)
    .order('taken_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_SNAPSHOTS);
  if (error) return missing(error) ? null : fail('list');
  return ((data ?? []) as Row[]).map(toMeta);
}

const people = (names: unknown, times: unknown): Person[] => {
  if (!Array.isArray(names)) return [];
  const at = Array.isArray(times) ? times : [];
  return names.map((u, i) => ({ username: String(u), at: typeof at[i] === 'number' ? at[i] : null }));
};

/** One snapshot's lists, only when it belongs to this account; null = no such snapshot. */
export async function loadFollowerSnapshot(db: SupabaseClient, accountId: string, id: string): Promise<Snapshot | null> {
  const { data, error } = await db.from(TABLE).select('followers,followers_at,following,following_at').eq('id', id).eq('account_id', accountId).maybeSingle();
  if (error) return fail('load');
  if (!data) return null;
  const r = data as Row;
  return { followers: people(r.followers, r.followers_at), following: r.following === null ? null : people(r.following, r.following_at) };
}

export type SaveResult = 'ok' | 'tooManySnapshots' | 'notReady';

/** Stores one validated upload (lib/followers/payload.ts validateUpload) as a snapshot; at most MAX_SNAPSHOTS per account. */
export async function saveFollowerSnapshot(db: SupabaseClient, accountId: string, u: Upload): Promise<SaveResult> {
  const { count, error } = await db.from(TABLE).select('id', { count: 'exact', head: true }).eq('account_id', accountId);
  if (error) return missing(error) ? 'notReady' : fail('count');
  if ((count ?? 0) >= MAX_SNAPSHOTS) return 'tooManySnapshots';
  const { error: insertError } = await db.from(TABLE).insert({
    account_id: accountId,
    taken_on: u.takenOn,
    followers: u.followers.map((p) => p.username),
    followers_at: u.followers.map((p) => p.at),
    following: u.following ? u.following.map((p) => p.username) : null,
    following_at: u.following ? u.following.map((p) => p.at) : null,
  }); // no .select(): nothing comes back
  if (insertError) return missing(insertError) ? 'notReady' : fail('insert');
  return 'ok';
}

/** Deletes one snapshot of this account; false = there was none. */
export async function deleteFollowerSnapshot(db: SupabaseClient, accountId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from(TABLE).delete().eq('id', id).eq('account_id', accountId).select('id');
  if (error) return fail('delete');
  return (data ?? []).length > 0;
}
```

- [ ] **Step 4: Write `app/api/accounts/[id]/followers/route.ts`** (exactly this — the size and order checks are Review Focus 2):

```ts
import { NextResponse } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { MAX_BODY_BYTES, validateUpload } from '@/lib/followers/payload';
import { saveFollowerSnapshot } from '@/lib/followers/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export type UploadError = 'unauthorized' | 'invalid' | 'tooLarge' | 'notFound' | 'notReady' | 'tooManySnapshots' | 'unexpected';

/** The body as bytes, or null as soon as it passes `max` (a missing or lying content-length cannot get more in). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The browser's Origin must be this host (CSRF: the session cookie is the credential), as Next checks for server actions. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /api/accounts/[id]/followers — one follower snapshot from the Followers tab's upload dialog (Plan 15b). Owner
 * session only (proxy + assertOwner; NOT a public exemption). The body is the compact payload of lib/followers/payload.ts
 * (usernames + follow times; the raw export files never leave the browser). Checked in this order, each failing closed
 * with a fixed key and nothing echoed: owner → account id → same origin → JSON content type → content-length ≤
 * MAX_BODY_BYTES → the body read with the same cap → UTF-8 → JSON → validateUpload → the account is live → at most
 * MAX_SNAPSHOTS → insert (owner session, RLS). Never logs the body, the names or an error object.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  const fail = (status: number, error: UploadError) => NextResponse.json({ error }, { status, headers: h });
  if (!(await assertOwner(h))) return fail(401, 'unauthorized');
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, 'notFound');
  if (!sameOrigin(request)) return fail(403, 'unauthorized');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415, 'invalid');
  const length = Number(request.headers.get('content-length'));
  if (!Number.isInteger(length) || length <= 0) return fail(411, 'invalid');
  if (length > MAX_BODY_BYTES) return fail(413, 'tooLarge');
  try {
    const bytes = await readCapped(request, MAX_BODY_BYTES);
    if (!bytes) return fail(413, 'tooLarge');
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return fail(400, 'invalid');
    }
    const now = new Date();
    const upload = validateUpload(body, localDay(now, (await getPrefs()).timezone), Math.floor(now.getTime() / 1000));
    if (!upload) return fail(400, 'invalid');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies, never the admin client
    const account = await supabaseAccountsStore(db).getById(id.toLowerCase());
    if (!account || account.status === 'archived') return fail(404, 'notFound');
    const saved = await saveFollowerSnapshot(db, account.id, upload);
    if (saved === 'notReady') return fail(503, 'notReady');
    if (saved === 'tooManySnapshots') return fail(409, 'tooManySnapshots');
    return NextResponse.json({ ok: true }, { status: 201, headers: h });
  } catch {
    console.error('followers upload failed'); // fixed text: never the error object (it can carry usernames)
    return fail(500, 'unexpected');
  }
}
```

- [ ] **Step 5: Write `app/(app)/accounts/followers-actions.ts`** (exactly this):

```ts
'use server';

// Follower snapshots are owner-authored data: this action uses the OWNER-SESSION client, so RLS
// (follower_exports_owner_all, gated on is_owner()) applies. Never the admin client here. Uploads go through the route
// handler app/api/accounts/[id]/followers (a server action's 1 MB body limit is too small for big accounts).
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { deleteFollowerSnapshot } from '@/lib/followers/read';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid } from '@/lib/tags';

export type SnapshotResult = { ok: true } | { ok: false; error: 'notFound' | 'unexpected' };

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function deleteFollowerSnapshotAction(accountId: string, snapshotId: string): Promise<SnapshotResult> {
  await requireOwner();
  if (!isUuid(accountId) || !isUuid(snapshotId)) return { ok: false, error: 'notFound' };
  try {
    const db = await createServerSupabase();
    if (!(await deleteFollowerSnapshot(db, accountId.toLowerCase(), snapshotId.toLowerCase()))) return { ok: false, error: 'notFound' };
    revalidatePath('/accounts/[id]', 'page');
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/followers-read.test.ts tests/followers-route.test.ts tests/followers-actions.test.ts tests/followers-privacy.test.ts tests/followers-payload.test.ts`, `npx tsc --noEmit`, `npx eslint lib/followers/read.ts "app/api/accounts/[id]/followers/route.ts" "app/(app)/accounts/followers-actions.ts" tests/followers-read.test.ts tests/followers-route.test.ts tests/followers-actions.test.ts tests/followers-privacy.test.ts`
Expected: PASS (7 + 10 + 3 + 4 tests in the plan author's scratch run), tsc and eslint clean. The route test runs in the node environment (`// @vitest-environment node`: a real `ReadableStream` body for the "lying content-length" case).

- [ ] **Step 7: Commit**

```bash
git add lib/followers/read.ts "app/api/accounts/[id]/followers/route.ts" "app/(app)/accounts/followers-actions.ts" tests/followers-read.test.ts tests/followers-route.test.ts tests/followers-actions.test.ts tests/followers-privacy.test.ts
git commit -m "feat(followers): snapshot reads/writes, owner-only capped upload route, delete action, privacy guard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The upload dialog — `components/account/FollowerUpload.tsx`

**Files:**
- Create: `components/account/FollowerUpload.tsx`, `tests/follower-upload.test.tsx`

**Interfaces:**
- Consumes: Task 2 keys (`pages.account.followerDiff.upload.*`, `.errors.*`), Task 3 (`checkFiles`, `parseExportFiles`, `MAX_FILES`, `MAX_FOLLOWERS`, `MAX_FOLLOWING`, `ParseError`, `Parsed`, `toPayload`, `FIRST_DAY`, `MAX_BODY_BYTES`, `MAX_SNAPSHOTS`), the route contract of Task 5 (URL `/api/accounts/<id>/followers`, 201 on success, `{ error: <key> }` otherwise — by string, no import), `ResponsiveDialog*`, `FormField`, `LoadingButton`, `Input`, `Button`, `usePrefs`, `formatNumber`, `useRouter().refresh`.
- Produces: `FollowerUpload({ accountId, username, today }: { accountId: string; username: string; today: string })` — a default-size "Upload export" button that opens the dialog. Task 7 renders it in the tab's toolbar `end` slot.
- Behaviour: choosing files runs `checkFiles` on names/sizes BEFORE reading (`File.text()` only after it passes), then `parseExportFiles` with the browser clock; the preview is `aria-live="polite"`; Upload is disabled until a parse succeeded; the date input is native (`min` 2010-10-06, `max` today, default today); a payload over `MAX_BODY_BYTES` is refused in the browser too; on 201 the dialog closes, resets and `router.refresh()` shows the new snapshot; a server error key (from the allow-list) is translated, anything else → `unexpected`; numbers in messages go through `formatNumber`.

- [ ] **Step 1: Write the failing test** — create `tests/follower-upload.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));

import { FollowerUpload } from '@/components/account/FollowerUpload';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const T = en.pages.account.followerDiff;
const entry = (name: string) => ({ title: '', media_list_data: [], string_list_data: [{ href: `https://www.instagram.com/${name}`, value: name, timestamp: 1_700_000_000 }] });
const json = (name: string, v: unknown) => new File([JSON.stringify(v)], name, { type: 'application/json' });
const fetchMock = vi.fn();

function view(locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <FollowerUpload accountId={ACC} username="shop.one" today="2026-10-21" />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? T.upload.open : zh.pages.account.followerDiff.upload.open }));
  return screen.getByRole('dialog');
}
const choose = (...files: File[]) => fireEvent.change(screen.getByLabelText(T.upload.files), { target: { files } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('FollowerUpload', () => {
  it('a dialog: title, the account in the description, a labelled multi-file JSON input and a date (today, never later)', () => {
    const dialog = view();
    expect(dialog).toHaveTextContent(T.upload.title);
    expect(dialog).toHaveTextContent('@shop.one');
    const input = screen.getByLabelText(T.upload.files);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', '.json,application/json');
    const date = screen.getByLabelText(T.upload.date);
    expect(date).toHaveValue('2026-10-21');
    expect(date).toHaveAttribute('max', '2026-10-21');
    expect(screen.getByRole('button', { name: T.upload.submit })).toBeDisabled();
  });

  it('reads the files in the browser and previews the counts, skipped entries and skipped files', async () => {
    view();
    choose(json('followers_1.json', [entry('alice'), entry('bob'), { junk: true }]), json('following.json', { relationships_following: [entry('carol')] }), json('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [] }));
    expect(await screen.findByText('2 followers and 1 account you follow')).toBeInTheDocument();
    expect(screen.getByText('1 entry is not a valid username and will be skipped.')).toBeInTheDocument();
    expect(screen.getByText('Not needed, skipped: recently_unfollowed_profiles.json')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.upload.submit })).toBeEnabled();
  });

  it('wrong files are refused before reading, with the file named and the limit formatted', async () => {
    view();
    choose(new File(['x'], 'instagram-shop.one.zip'));
    expect(await screen.findByRole('alert')).toHaveTextContent('instagram-shop.one.zip is a zip file. Unzip it first');
    choose(...Array.from({ length: 11 }, (_, i) => json(`followers_${i}.json`, [])));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at most 10 files.');
    choose(json('following.json', { relationships_following: [entry('carol')] }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.needFollowers);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads ONLY usernames and times to the owner route, then closes and refreshes the page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } }));
    view();
    choose(json('followers_1.json', [entry('Alice')]));
    await screen.findByText(/1 follower\./);
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/accounts/${ACC}/followers`);
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin' });
    expect(JSON.parse(String(init.body))).toEqual({ v: 1, takenOn: '2026-10-01', followers: [['alice', 1_700_000_000]], following: null });
    expect(String(init.body)).not.toContain('instagram.com'); // the raw file stays on the device
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a future date is refused; a server error key is shown translated; anything else is "unexpected"', async () => {
    view();
    choose(json('followers_1.json', [entry('alice')]));
    await screen.findByText(/1 follower\./);
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-22' } });
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.badDate);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(T.upload.date), { target: { value: '2026-10-21' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'tooManySnapshots' }), { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account already has 60 snapshots.');
    fetchMock.mockResolvedValueOnce(new Response('<html>login</html>', { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: T.upload.submit }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(T.errors.unexpected));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('zh-CN: the preview and errors are translated', async () => {
    view('zh-CN');
    fireEvent.change(screen.getByLabelText(zh.pages.account.followerDiff.upload.files), { target: { files: [json('followers_1.json', [entry('alice'), entry('bob')])] } });
    expect(await screen.findByText('2 位粉丝。没有 following.json，因此该快照的回关列表为空。')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/follower-upload.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/account/FollowerUpload"`.

- [ ] **Step 3: Write `components/account/FollowerUpload.tsx`** (exactly this):

```tsx
'use client';

// The upload dialog of the Followers tab (Plan 15b). The chosen export files are size-checked BEFORE they are read and
// parsed HERE, in the browser (lib/followers/parse.ts); only usernames and follow times are posted (as the compact
// payload of lib/followers/payload.ts) to the owner-only route, which checks everything again. The raw files never
// leave the device. Errors are keys of pages.account.followerDiff.errors.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatNumber } from '@/lib/format';
import { checkFiles, MAX_FILES, MAX_FOLLOWERS, MAX_FOLLOWING, parseExportFiles, type ParseError, type Parsed } from '@/lib/followers/parse';
import { FIRST_DAY, MAX_BODY_BYTES, MAX_SNAPSHOTS, toPayload } from '@/lib/followers/payload';

type ErrorKey = ParseError | 'badDate' | 'unauthorized' | 'invalid' | 'tooLarge' | 'notFound' | 'notReady' | 'tooManySnapshots' | 'unexpected';
const SERVER_ERRORS: readonly string[] = ['unauthorized', 'invalid', 'tooLarge', 'notFound', 'notReady', 'tooManySnapshots', 'unexpected'];
const MAX: Partial<Record<ErrorKey, number>> = { tooManyFiles: MAX_FILES, fileTooLarge: 32, totalTooLarge: 64, tooManyFollowers: MAX_FOLLOWERS, tooManyFollowing: MAX_FOLLOWING, tooManySnapshots: MAX_SNAPSHOTS };

export function FollowerUpload({ accountId, username, today }: { accountId: string; username: string; today: string }) {
  const t = useTranslations('pages.account.followerDiff');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<{ key: ErrorKey; file?: string } | null>(null);
  const [busy, setBusy] = useState<'reading' | 'sending' | null>(null);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });

  const reset = () => {
    setParsed(null);
    setError(null);
    setDate(today);
    setBusy(null);
  };

  async function read(list: File[]) {
    setParsed(null);
    setError(null);
    const bad = checkFiles(list.map((f) => ({ name: f.name, size: f.size }))); // before a byte is read
    if (bad) return setError({ key: bad.error, file: bad.file });
    setBusy('reading');
    try {
      const files = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
      const r = parseExportFiles(files, Math.floor(Date.now() / 1000));
      if (r.ok) setParsed(r);
      else setError({ key: r.error, file: r.file });
    } catch {
      setError({ key: 'badJson' });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!parsed) return setError({ key: 'noFiles' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < FIRST_DAY) return setError({ key: 'badDate' });
    const body = toPayload({ takenOn: date, followers: parsed.followers, following: parsed.following });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return setError({ key: 'tooLarge' });
    setBusy('sending');
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/followers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin' });
      if (res.status === 201) {
        setOpen(false);
        reset();
        router.refresh(); // the new snapshot appears in the tab
        return;
      }
      const key = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
      setError({ key: typeof key === 'string' && SERVER_ERRORS.includes(key) ? (key as ErrorKey) : res.redirected ? 'unauthorized' : 'unexpected' });
    } catch {
      setError({ key: 'unexpected' });
    }
    setBusy(null);
  }

  const message = error ? t(`errors.${error.key}`, { file: error.file ?? '', max: n(MAX[error.key] ?? 0) }) : null;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button type="button">
          <Upload aria-hidden="true" />
          {t('upload.open')}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('upload.title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('upload.description', { username })}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid gap-[var(--gp)]">
          <FormField id="follower-files" label={t('upload.files')} hint={t('upload.filesHint')}>
            {(p) => <Input {...p} type="file" multiple accept=".json,application/json" onChange={(e) => void read([...(e.target.files ?? [])])} />}
          </FormField>
          <div aria-live="polite" className="grid gap-1 text-sm">
            {busy === 'reading' ? <p className="text-muted-foreground">{t('upload.reading')}</p> : null}
            {parsed ? (
              <>
                <p>{parsed.following ? t('upload.preview', { followers: parsed.followers.length, following: parsed.following.length }) : t('upload.previewNoFollowing', { followers: parsed.followers.length })}</p>
                {parsed.skipped ? <p className="text-xs text-muted-foreground">{t('upload.skipped', { count: parsed.skipped })}</p> : null}
                {parsed.ignored.length ? <p className="text-xs text-muted-foreground">{t('upload.ignored', { files: parsed.ignored.join(', ') })}</p> : null}
              </>
            ) : null}
          </div>
          <FormField id="follower-date" label={t('upload.date')} hint={t('upload.dateHint')}>
            {(p) => <Input {...p} type="date" min={FIRST_DAY} max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          {message ? (
            <p role="alert" className="text-xs text-destructive">
              {message}
            </p>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">
              {t('upload.cancel')}
            </Button>
          </ResponsiveDialogClose>
          <LoadingButton type="button" pending={busy === 'sending'} disabled={!parsed || busy !== null} onClick={() => void send()}>
            {t('upload.submit')}
          </LoadingButton>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/follower-upload.test.tsx tests/messages.test.ts`, `npx tsc --noEmit`, `npx eslint components/account/FollowerUpload.tsx tests/follower-upload.test.tsx`
Expected: PASS (6 tests), tsc and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add components/account/FollowerUpload.tsx tests/follower-upload.test.tsx
git commit -m "feat(followers): upload dialog (files parsed on the device, only usernames and dates sent)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Followers tab end to end — component, `TABS`, skeleton, the page's `case 'followers'`

**Files:**
- Create: `components/account/FollowersTab.tsx`, `tests/followers-tab.test.tsx`
- Modify (anchored text edits below): `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx`
- Existing tests that must keep passing: `tests/account-page.test.tsx`, `tests/account-view.test.tsx`, `tests/dashboard-account.test.ts`, `tests/ui-standards.test.ts` (rule 7: the new `TabsList` is `variant="line"`; rule 4: no `RangeBar` added), `tests/followers-privacy.test.ts` (the new files import `lib/followers` and log nothing), `tests/route-loading.test.tsx`.

**Interfaces:**
- Consumes: Task 2 keys; Task 4 (`FOLLOWER_LISTS`, `FOLLOWER_PAGE`, `sinceKey`, `followersView`, `FollowersView`, `FollowerList`, `parseFollowerState`, `resolvePair`, `followerHref`, `staleDays`, `FOLLOWER_KEYS`, `FollowerState`, `SnapshotMeta`); Task 5 (`listFollowerSnapshots`, `loadFollowerSnapshot`, `deleteFollowerSnapshotAction`); Task 6 (`FollowerUpload`); shared `FilterToolbar`/`FilterSearch`/`FilterSelect`/`useApply`/`FilterChip`, `DataTable` (`serverSort` mode: rows as given, phone cards), `Pagination`, `EmptyState`, `ConfirmDialog`, `LoadingButton`, `Tabs*`, `downloadExport`, `formatDate`/`formatDateTime`/`formatDay`/`formatNumber`. The export URL `/api/export/followers?account&snap&vs&list&q` is Task 8's contract (by string; no import).
- Produces: `FollowersTab(props: FollowersTabProps)`, `interface FollowersTabProps { accountId; username; today; scope?; ready; snapshots; state; newer; older; view; deleteSnapshot }`; `TABS = ['overview', 'posts', 'stories', 'followers']`; `TabSkeleton` `case 'followers'`.
- Screen (mobile-first, one column; every row wraps): intro line → the guide as a native `<details>` (open while there is no snapshot; seven numbered steps naming the account; the privacy note) → the quiet "export is N days old" line when > 30 days → `FilterToolbar` (search, Snapshot, Compare with — only with 2+ snapshots; `end`: Export list + Upload export; a search chip + Clear all) → the five lists as underline tabs "New followers (2)" … (manual activation, a click navigates with the progress bar) → the list's hint with both dates, the snapshot-based note on New/Unfollowed, the count line, the table (Username links to `https://www.instagram.com/<name>/` in a new tab with `rel="noopener noreferrer"`; the date column named by `sinceKey`), `Pagination` → "Your snapshots" (date, followers, following or "Not uploaded", uploaded at, a Delete icon button with a full-sentence label → `ConfirmDialog` → `deleteSnapshot` → `router.refresh()`). Without the migration: intro + guide + "needs a database update". Without snapshots: intro + guide + the empty state with the Upload button.

- [ ] **Step 1: Write the failing component test** — create `tests/followers-tab.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { FollowersTab, type FollowersTabProps } from '@/components/account/FollowersTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { followersView, type Snapshot } from '@/lib/followers/diff';
import { parseFollowerState, type SnapshotMeta } from '@/lib/followers/state';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));
const { download } = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('@/lib/export/download', () => ({ downloadExport: download }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const f of [push, replace, refresh, download]) f.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.followerDiff;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const meta = (n: number, takenOn: string, followers: number, following: number | null): SnapshotMeta => ({ id: id(n), takenOn, followerCount: followers, followingCount: following, createdAt: `${takenOn}T10:00:00Z` });
const NEW_META = meta(2, '2026-10-20', 4, 3);
const OLD_META = meta(1, '2026-09-20', 3, null);
const at = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000;
const NEWER: Snapshot = {
  followers: [{ username: 'bob', at: at('2026-01-02') }, { username: 'cat', at: at('2026-01-03') }, { username: 'dan', at: at('2026-10-05') }, { username: 'eve', at: null }],
  following: [{ username: 'cat', at: at('2025-05-01') }, { username: 'dan', at: at('2025-06-01') }, { username: 'xavier', at: at('2025-07-01') }],
};
const OLDER: Snapshot = { followers: [{ username: 'amy', at: at('2025-12-01') }, { username: 'bob', at: at('2026-01-02') }, { username: 'cat', at: at('2026-01-03') }], following: null };
const SCOPE = { from: '2026-09-01', to: '2026-09-30' };
/** The list's table (the snapshot list below is a second table). */
const listTable = () => within(screen.getByRole('tabpanel')).getByRole('table');

function props(sp: Record<string, string> = {}, o: Partial<FollowersTabProps> = {}): FollowersTabProps {
  const snapshots = [NEW_META, OLD_META];
  const state = parseFollowerState(sp, snapshots);
  return { accountId: ACC, username: 'shop.one', today: '2026-10-21', scope: SCOPE, ready: true, snapshots, state, newer: NEW_META, older: OLD_META, view: followersView(NEWER, OLDER, state), deleteSnapshot: vi.fn(async () => ({ ok: true as const })), ...o };
}
function view(p: FollowersTabProps, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <FollowersTab {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('FollowersTab', () => {
  it('migration missing: the guide and the "needs a database update" note, no upload', () => {
    view(props({}, { ready: false, snapshots: [], newer: null, older: null, view: null }));
    expect(screen.getByText(T.notReady)).toBeInTheDocument();
    expect(screen.getByText(T.guide.title)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.upload.open })).toBeNull();
  });

  it('no snapshot yet: the guide is open with the exact steps for this account, and the upload button', () => {
    view(props({}, { snapshots: [], newer: null, older: null, view: null }));
    const guide = screen.getByText(T.guide.title).closest('details')!;
    expect(guide).toHaveAttribute('open');
    const steps = within(guide).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toHaveLength(7);
    expect(steps[0]).toContain('@shop.one');
    expect(steps[4]).toContain('JSON');
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: T.upload.open })).toBeInTheDocument();
  });

  it('the five lists as underline tabs with their sizes; New followers by default, newest follow first, snapshot-based note', () => {
    view(props());
    const tabs = within(screen.getByRole('tablist', { name: T.lists.label })).getAllByRole('tab');
    expect(screen.getByRole('tablist', { name: T.lists.label })).toHaveAttribute('data-variant', 'line');
    expect(tabs.map((t) => t.textContent)).toEqual(['New followers (2)', 'Unfollowed you (1)', "Don't follow you back (1)", "You don't follow back (2)", 'Mutuals (2)']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveTextContent('They follow you in the export of 2026-10-20 but not in the one of 2026-09-20.');
    expect(panel).toHaveTextContent(T.snapshotBased);
    expect(panel).toHaveTextContent('1–2 of 2 people');
    const table = within(panel).getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([['@dan', '2026-10-05'], ['@eve', '—']]);
    expect(within(table).getByRole('columnheader', { name: T.cols.followedYou })).toBeInTheDocument();
  });

  it('names link to Instagram in a new tab, safely', () => {
    view(props());
    const link = within(listTable()).getByRole('link', { name: 'Open @dan on Instagram' });
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/dan/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('choosing a list navigates (scope kept, page dropped); the time column follows the list', async () => {
    const user = userEvent.setup();
    view(props({ list: 'theyDontFollow', page: '1' }));
    expect(within(listTable()).getByRole('columnheader', { name: T.cols.youFollowed })).toBeInTheDocument();
    expect(within(listTable()).getByText('@xavier')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Mutuals (2)' }));
    expect(push).toHaveBeenCalledWith('?tab=followers&list=mutual&from=2026-09-01&to=2026-09-30', { scroll: false });
  });

  it('toolbar: search, the snapshot and the comparison (named by date and size), export and upload; a search chip', () => {
    view(props({ q: 'da' }));
    const toolbar = screen.getByRole('group', { name: T.toolbar });
    expect(within(toolbar).getByRole('searchbox', { name: T.search })).toHaveValue('da');
    const snap = within(toolbar).getByLabelText(T.snapshot);
    expect(within(snap).getAllByRole('option').map((o) => o.textContent)).toEqual(['2026-10-20 · 4 followers', '2026-09-20 · 3 followers']);
    expect(within(toolbar).getByLabelText(T.compare)).toHaveValue(id(1));
    expect(within(toolbar).getByRole('button', { name: T.export })).toBeEnabled();
    expect(within(toolbar).getByRole('button', { name: T.upload.open })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Remove filter Search: da' })).toHaveAttribute('href', '?tab=followers&from=2026-09-01&to=2026-09-30');
    expect(within(listTable()).getAllByRole('row')).toHaveLength(2); // header + dan
  });

  it('a list the snapshots cannot answer says why (no second export / no following.json)', async () => {
    const state = parseFollowerState({ list: 'lost' }, [NEW_META]);
    view(props({}, { snapshots: [NEW_META], older: null, state, view: followersView(NEWER, null, state) }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(T.needTwo);
    expect(screen.queryByLabelText(T.compare)).toBeNull(); // one snapshot: nothing to compare with
    expect(screen.getByRole('button', { name: T.export })).toBeDisabled();
  });

  it('export downloads the current list through the safe xlsx route; an error key is shown translated', async () => {
    const user = userEvent.setup();
    download.mockResolvedValueOnce({ ok: false, error: 'unauthorized' });
    view(props({ list: 'lost', q: 'am' }));
    await user.click(screen.getByRole('button', { name: T.export }));
    expect(download).toHaveBeenCalledWith(`/api/export/followers?account=${ACC}&snap=${id(2)}&vs=${id(1)}&list=lost&q=am`, 'xlsx');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.export.errors.unauthorized);
  });

  it('snapshots: date, counts, "Not uploaded" without following.json; delete asks first, then refreshes', async () => {
    const user = userEvent.setup();
    const p = props();
    view(p);
    const section = screen.getByRole('region', { name: T.snapshots.title });
    expect(section).toHaveTextContent(T.snapshots.notUploaded);
    await user.click(within(section).getAllByRole('button', { name: 'Delete the snapshot of 2026-09-20' })[0]); // the table and the phone cards both render it
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('The usernames of the export of 2026-09-20 are removed for good.');
    await user.click(within(dialog).getByRole('button', { name: T.snapshots.confirm }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(p.deleteSnapshot).toHaveBeenCalledWith(ACC, id(1));
  });

  it('an export older than 30 days gets one quiet line, nothing more', () => {
    view(props({}, { today: '2026-11-25' }));
    expect(screen.getByText('Your newest export is 36 days old. Upload a new one to see recent changes.')).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view(props(), 'zh-CN');
    expect(screen.getByRole('tab', { name: '新粉丝（2）' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/followers-tab.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/account/FollowersTab"`.

- [ ] **Step 3: Write `components/account/FollowersTab.tsx`** (exactly this):

```tsx
'use client';

// The Followers tab (Plan 15b): follower lists BY NAME from Instagram exports the owner uploads (no API gives names).
// Guide → toolbar (search, the two snapshots, export, upload) → the five lists as underline tabs with counts → one
// server page of the chosen list → the snapshot list (delete). Everything is URL state (lib/followers/state.ts); the
// server computed the page (lib/followers/diff.ts followersView), so at most FOLLOWER_PAGE names reach the browser.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, ExternalLink, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FollowerUpload } from '@/components/account/FollowerUpload';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSearch, FilterSelect, FilterToolbar, useApply, type FilterChip } from '@/components/shared/FilterToolbar';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadExport } from '@/lib/export/download';
import { formatDate, formatDateTime, formatDay, formatNumber } from '@/lib/format';
import { FOLLOWER_LISTS, FOLLOWER_PAGE, sinceKey, type FollowerList, type FollowersView } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';
import { followerHref, staleDays, type FollowerState, type SnapshotMeta } from '@/lib/followers/state';

const GUIDE_STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;

export interface FollowersTabProps {
  accountId: string;
  username: string;
  today: string;
  scope?: Record<string, string>; // the Time Scope params: carried in every link, never used here
  ready: boolean; // false = the migration is not applied yet
  snapshots: SnapshotMeta[]; // newest first
  state: FollowerState;
  newer: SnapshotMeta | null;
  older: SnapshotMeta | null;
  view: FollowersView | null;
  deleteSnapshot: (accountId: string, snapshotId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function FollowersTab({ accountId, username, today, scope = {}, ready, snapshots, state, newer, older, view, deleteSnapshot }: FollowersTabProps) {
  const t = useTranslations('pages.account.followerDiff');
  const te = useTranslations('export.errors');
  const { prefs } = usePrefs();
  const router = useRouter();
  const apply = useApply();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [target, setTarget] = useState<SnapshotMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const day = (d: string) => formatDay(d, prefs);
  const href = (patch: Partial<FollowerState>) => followerHref(state, patch, scope);

  const guide = (
    <details open={snapshots.length === 0} className="rounded-md border bg-card p-[var(--gp)] text-sm">
      <summary className="cursor-pointer font-medium">{t('guide.title')}</summary>
      <ol className="mt-2 grid list-decimal gap-1.5 ps-5">
        {GUIDE_STEPS.map((s) => (
          <li key={s}>{t(`guide.${s}`, { username })}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">{t('guide.privacy')}</p>
    </details>
  );
  const intro = <p className="max-w-prose text-sm text-muted-foreground">{t('intro')}</p>;

  if (!ready)
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {intro}
        {guide}
        <EmptyState icon={<Users aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />
      </div>
    );
  const upload = <FollowerUpload accountId={accountId} username={username} today={today} />;
  if (!newer || !view)
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {intro}
        {guide}
        <EmptyState icon={<Users aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} action={upload} />
      </div>
    );

  const stale = staleDays(snapshots, today);
  const option = (s: SnapshotMeta) => ({ value: s.id, label: t('snapshotOption', { date: day(s.takenOn), count: s.followerCount }) });
  const chips: FilterChip[] = state.q ? [{ id: 'q', label: t('searchChip', { q: state.q }), href: href({ q: '' }) }] : [];
  const exportQuery = new URLSearchParams({ account: accountId, snap: newer.id, ...(older ? { vs: older.id } : {}), list: view.list, ...(state.q ? { q: state.q } : {}) });
  const exportButton = (
    <LoadingButton
      type="button"
      variant="outline"
      pending={exporting}
      disabled={!view.page?.total}
      onClick={async () => {
        setExporting(true);
        const r = await downloadExport(`/api/export/followers?${exportQuery}`, 'xlsx');
        setExporting(false);
        setExportError(r.ok ? null : te(r.error));
      }}
    >
      <Download aria-hidden="true" />
      {t('export')}
    </LoadingButton>
  );
  const columns: Column<Person>[] = [
    {
      key: 'username',
      header: t('cols.username'),
      cell: (p) => (
        <a href={`https://www.instagram.com/${encodeURIComponent(p.username)}/`} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: p.username })} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          @{p.username}
          <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </a>
      ),
    },
    { key: 'at', header: t(`cols.${sinceKey(view.list)}`), cell: (p) => formatDate(p.at === null ? null : p.at * 1000, prefs) },
  ];
  const label = (l: FollowerList) => (view.counts[l] === null ? t(`lists.${l}`) : t('withCount', { label: t(`lists.${l}`), count: n(view.counts[l]!) }));
  const unavailable = (l: FollowerList) => (l === 'new' || l === 'lost' ? t('needTwo') : t('needFollowing'));
  const page = view.page;
  const dates = { newer: day(newer.takenOn), older: older ? day(older.takenOn) : '' };

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      {intro}
      {guide}
      {stale !== null ? <p className="text-sm text-muted-foreground">{t('stale', { days: n(stale) })}</p> : null}
      <FilterToolbar label={t('toolbar')} chips={chips} clearHref={state.q ? href({ q: '' }) : undefined} end={<>{exportButton}{upload}</>}>
        <FilterSearch id="followers-q" label={t('search')} placeholder={t('search')} value={state.q} hrefFor={(q) => href({ q })} />
        <FilterSelect id="followers-snap" label={t('snapshot')} value={newer.id} options={snapshots.map(option)} hrefFor={(v) => href({ snap: v })} />
        {snapshots.length > 1 ? <FilterSelect id="followers-vs" label={t('compare')} value={older?.id ?? ''} options={snapshots.filter((s) => s.id !== newer.id).map(option)} hrefFor={(v) => href({ vs: v })} /> : null}
      </FilterToolbar>
      {exportError ? (
        <p role="alert" className="text-xs text-destructive">
          {exportError}
        </p>
      ) : null}
      <Tabs value={view.list} activationMode="manual" onValueChange={(v) => apply(href({ list: v as FollowerList }))} className="min-w-0">
        <TabsList variant="line" aria-label={t('lists.label')}>
          {FOLLOWER_LISTS.map((l) => (
            <TabsTrigger key={l} value={l} className="flex-none">
              {label(l)}
            </TabsTrigger>
          ))}
        </TabsList>
        {FOLLOWER_LISTS.map((l) => (
          <TabsContent key={l} value={l} className="grid min-w-0 gap-2 pt-[var(--gp)]">
            {l !== view.list ? null : !page ? (
              <p className="text-sm text-muted-foreground">{unavailable(l)}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t(`hints.${l}`, dates)}</p>
                {l === 'new' || l === 'lost' ? <p className="text-xs text-muted-foreground">{t('snapshotBased')}</p> : null}
                {page.total > 0 ? (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {t('range', { first: n((page.page - 1) * FOLLOWER_PAGE + 1), last: n((page.page - 1) * FOLLOWER_PAGE + page.rows.length), total: n(page.total) })}
                  </p>
                ) : null}
                <DataTable
                  rows={page.rows}
                  columns={columns}
                  rowKey={(p) => p.username}
                  caption={t(`lists.${l}`)}
                  empty={<EmptyState title={state.q ? t('emptySearch') : t('emptyList')} />}
                  serverSort={{ current: null, href: () => null }}
                />
                <Pagination page={page.page} pages={page.pages} hrefFor={(p) => href({ page: p })} />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <section aria-labelledby="follower-snapshots" className="grid min-w-0 gap-2">
        <h2 id="follower-snapshots" className="text-sm font-medium">
          {t('snapshots.title')}
        </h2>
        <DataTable
          rows={snapshots}
          rowKey={(s) => s.id}
          caption={t('snapshots.title')}
          serverSort={{ current: null, href: () => null }}
          columns={[
            { key: 'date', header: t('snapshots.date'), cell: (s) => day(s.takenOn) },
            { key: 'followers', header: t('snapshots.followers'), align: 'right', cell: (s) => n(s.followerCount) },
            { key: 'following', header: t('snapshots.following'), align: 'right', cell: (s) => (s.followingCount === null ? t('snapshots.notUploaded') : n(s.followingCount)) },
            { key: 'uploaded', header: t('snapshots.uploaded'), cell: (s) => formatDateTime(s.createdAt, prefs) },
            {
              key: 'delete',
              header: t('snapshots.delete'),
              cell: (s) => (
                <Button type="button" variant="ghost" size="icon" aria-label={t('snapshots.deleteLabel', { date: day(s.takenOn) })} onClick={() => (setDeleteError(null), setTarget(s))}>
                  <Trash2 aria-hidden="true" />
                </Button>
              ),
            },
          ]}
        />
      </section>
      <ConfirmDialog
        open={target !== null}
        title={t('snapshots.deleteTitle')}
        body={target ? t('snapshots.deleteBody', { date: day(target.takenOn) }) : ''}
        confirmLabel={t('snapshots.confirm')}
        cancelLabel={t('snapshots.cancel')}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          setDeleting(true);
          const r = await deleteSnapshot(accountId, target.id);
          setDeleting(false);
          if (!r.ok) return setDeleteError(t(`errors.${r.error === 'notFound' ? 'notFound' : 'unexpected'}`, { max: '', file: '' }));
          setTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/followers-tab.test.tsx` → PASS (11 tests).

- [ ] **Step 5: Add the tab** — four anchored edits (Edit tool; each anchor occurs once).

`lib/dashboard/account.ts` — replace
```ts
// Audience is the last section of Overview (ux-polish design §4.2); ?tab=audience redirects there
export const TABS = ['overview', 'posts', 'stories'] as const;
```
with
```ts
// Audience is the last section of Overview (ux-polish design §4.2); ?tab=audience redirects there. Followers (Plan 15b) = the
// by-name lists from uploaded Instagram exports; it stays the LAST tab.
export const TABS = ['overview', 'posts', 'stories', 'followers'] as const;
```
(If Plan 15a already added a tab, keep its entry and put `'followers'` last; list it as a deviation.)

`components/account/TabSkeleton.tsx` — insert directly before the line `    default:` (the only one):
```tsx
    case 'followers':
      return (
        <div aria-busy="true" className="grid min-w-0 gap-[var(--gp)]">
          <SkeletonGrid count={1} itemClassName="h-[calc(var(--ctl)*1.8)] rounded-md" />
          <SkeletonTable rows={8} />
        </div>
      );
```

`tests/dashboard-account.test.ts` — replace
```ts
  it('accepts the three tabs only; the old Audience tab and injections fall back to overview', () => {
    expect(TABS).toEqual(['overview', 'posts', 'stories']);
    expect(['overview', 'posts', 'stories', 'audience'].map(parseTab)).toEqual(['overview', 'posts', 'stories', 'overview']);
```
with
```ts
  it('accepts the four tabs only; the old Audience tab and injections fall back to overview', () => {
    expect(TABS).toEqual(['overview', 'posts', 'stories', 'followers']);
    expect(['overview', 'posts', 'stories', 'followers', 'audience'].map(parseTab)).toEqual(['overview', 'posts', 'stories', 'followers', 'overview']);
```

`tests/account-view.test.tsx` — three one-line replacements:
- `  const frame = (tab: 'overview' | 'posts' | 'stories', q = '', children = <p>panel</p>) => (` → `  const frame = (tab: 'overview' | 'posts' | 'stories' | 'followers', q = '', children = <p>panel</p>) => (`
- `    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Posts', 'Stories']);` → `    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Posts', 'Stories', 'Followers']);`
- `    for (const tab of ['posts', 'stories'] as const) {` → `    for (const tab of ['posts', 'stories', 'followers'] as const) {` (no range bar on the Followers tab either)

- [ ] **Step 6: Wire the page** — `app/(app)/accounts/[id]/(tabs)/page.tsx`, five anchored edits:

(a) after the line `import { AccountView } from '@/components/account/AccountView';` insert
```tsx
import { FollowersTab } from '@/components/account/FollowersTab';
```
(b) after the line `import { setPostTagsAction } from '@/app/(app)/tags/actions';` insert
```tsx
import { deleteFollowerSnapshotAction } from '@/app/(app)/accounts/followers-actions';
```
(c) after the line `import { exportScopes } from '@/lib/export/params';` insert
```tsx
import { followersView } from '@/lib/followers/diff';
import { listFollowerSnapshots, loadFollowerSnapshot } from '@/lib/followers/read';
import { FOLLOWER_KEYS, parseFollowerState, resolvePair } from '@/lib/followers/state';
```
(d) insert directly before the line `    default: {` in `TabContent`:
```tsx
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
```
(e) the Suspense key ignores the tab's own params too (the search box keeps focus while a page streams): replace
`      <Suspense key={JSON.stringify({ ...sp, ...Object.fromEntries(LIST_KEYS.map((k) => [k, undefined])) })} fallback={<TabSkeleton tab={tab} />}>`
with
`      <Suspense key={JSON.stringify({ ...sp, ...Object.fromEntries([...LIST_KEYS, ...FOLLOWER_KEYS].map((k) => [k, undefined])) })} fallback={<TabSkeleton tab={tab} />}>`
and in the comment above it `params of Posts/Stories (LIST_KEYS, incl. the Grid/Table view): the toolbar stays mounted` → `params of Posts/Stories/Followers (LIST_KEYS, incl. the Grid/Table view, and FOLLOWER_KEYS): the toolbar stays mounted`.

- [ ] **Step 7: Page tests** — `tests/account-page.test.tsx`, two insertions:

(a) after the line `vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push('ADMIN') }));` insert
```tsx
const followers = vi.hoisted(() => ({ snapshots: [] as Record<string, unknown>[] | null, data: {} as Record<string, unknown>, loads: [] as string[] }));
vi.mock('@/lib/followers/read', () => ({
  listFollowerSnapshots: async (_db: unknown, accountId: string) => (calls.push(`followerSnapshots:${accountId}`), followers.snapshots),
  loadFollowerSnapshot: async (_db: unknown, _accountId: string, id: string) => (calls.push('followerSnapshot'), followers.loads.push(id), followers.data[id] ?? null),
}));
```
(b) append at the end of the file (after the last `});`):
```tsx

describe('account page: the Followers tab (Plan 15b)', () => {
  const S1 = '00000000-0000-4000-8000-000000000001';
  const S2 = '00000000-0000-4000-8000-000000000002';
  const meta = (id: string, takenOn: string) => ({ id, takenOn, followerCount: 2, followingCount: 1, createdAt: `${takenOn}T10:00:00Z` });
  type FollowersProps = { ready: boolean; snapshots: unknown[]; newer: { id: string } | null; older: { id: string } | null; view: { list: string; counts: Record<string, number | null>; page: { rows: { username: string }[] } | null } | null; scope: Record<string, string>; deleteSnapshot: unknown; username: string };
  const followersTab = async (sp: Record<string, string> = {}) => ((await streamTab(await run(ID, { tab: 'followers', ...sp }))) as ReactElement<FollowersProps>).props;

  beforeEach(() => {
    followers.snapshots = [meta(S2, '2026-10-20'), meta(S1, '2026-09-20')];
    followers.data = { [S2]: { followers: [{ username: 'bob', at: null }, { username: 'cat', at: null }], following: [{ username: 'cat', at: null }] }, [S1]: { followers: [{ username: 'amy', at: null }, { username: 'bob', at: null }], following: null } };
    followers.loads = [];
    accounts.push(acct(ID));
  });

  it('reads the snapshot list, then the two compared snapshots with the owner session, and hands one diffed page to the tab', async () => {
    const p = await followersTab();
    expect(p.ready).toBe(true);
    expect(followers.loads).toEqual([S2, S1]);
    expect([p.newer?.id, p.older?.id]).toEqual([S2, S1]);
    expect(p.view?.list).toBe('new');
    expect(p.view?.counts).toEqual({ new: 1, lost: 1, theyDontFollow: 0, iDontFollow: 1, mutual: 1 });
    expect(p.view?.page?.rows.map((r) => r.username)).toEqual(['cat']);
    expect(p.username).toBe(acct(ID).username);
    expect(typeof p.deleteSnapshot).toBe('function');
    expect(calls).toContain(`followerSnapshots:${ID}`);
    expect(calls).not.toContain('ADMIN');
  });

  it('URL state: a chosen list, a search; invalid snapshot ids fall back to the newest pair', async () => {
    const p = await followersTab({ list: 'lost', q: 'AM', snap: 'not-a-uuid' });
    expect(p.view?.list).toBe('lost');
    expect(p.view?.page?.rows.map((r) => r.username)).toEqual(['amy']);
    expect([p.newer?.id, p.older?.id]).toEqual([S2, S1]);
  });

  it('before migration 20261028000002 (table missing): the tab says so, nothing else is read', async () => {
    followers.snapshots = null;
    const p = await followersTab();
    expect(p.ready).toBe(false);
    expect(p.view).toBeNull();
    expect(followers.loads).toEqual([]);
  });

  it('no snapshot yet → no view; one snapshot → no comparison', async () => {
    followers.snapshots = [];
    expect((await followersTab()).view).toBeNull();
    followers.snapshots = [meta(S2, '2026-10-20')];
    const one = await followersTab();
    expect(one.older).toBeNull();
    expect(one.view?.list).toBe('theyDontFollow');
  });

  it('the Suspense key ignores the follower params (the toolbar stays mounted); the scope rides along to the tab', async () => {
    const key = async (sp: Record<string, string>) => (await run(ID, sp)).props.children.key;
    expect(await key({ tab: 'followers', snap: S1, vs: S2, list: 'mutual', q: 'x', page: '2' })).toBe(await key({ tab: 'followers' }));
    expect((await followersTab({ from: '2026-09-01', to: '2026-09-30' })).scope).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/followers-tab.test.tsx tests/account-page.test.tsx tests/account-view.test.tsx tests/dashboard-account.test.ts tests/ui-standards.test.ts tests/followers-privacy.test.ts tests/route-loading.test.tsx`, `npx tsc --noEmit`, `npx eslint components/account/FollowersTab.tsx components/account/TabSkeleton.tsx lib/dashboard/account.ts "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/followers-tab.test.tsx tests/account-page.test.tsx tests/account-view.test.tsx tests/dashboard-account.test.ts`
Expected: PASS (the page test file gains 5 tests; in the plan author's scratch run `account-page` + `account-view` + `dashboard-account` = 36 passed), tsc and eslint clean.

- [ ] **Step 9: Commit**

```bash
git add components/account/FollowersTab.tsx tests/followers-tab.test.tsx lib/dashboard/account.ts components/account/TabSkeleton.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx
git commit -m "feat(followers): Followers account tab (guide, lists by name, server pages, snapshots)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The list export — `lib/export/followers.ts`, `GET /api/export/followers`

**Files:**
- Create: `lib/export/followers.ts`, `app/api/export/followers/route.ts`, `tests/export-followers.test.ts`
- Existing tests that must keep passing: `tests/followers-privacy.test.ts` (both files import `lib/followers`; one fixed `console.error` line), `tests/export-workbook.test.ts`, `tests/export-cells.test.ts`.

**Interfaces:**
- Consumes: Task 2 keys (`pages.account.followerDiff.lists.*`, `.cols.*`, `.hints.*`, `.snapshotBased`, `.sheet.*`); Task 4 (`diffSnapshots`, `filterList`, `sinceKey`, `FOLLOWER_LISTS`, `parseFollowerState`, `resolvePair`); Task 5 (`listFollowerSnapshots`, `loadFollowerSnapshot`); `sheet`, `translator`, `writeWorkbook`, `WorkbookSheet`, `Translate` (`lib/export/workbook.ts`), `sheetNames` (`lib/export/cells.ts`), `exportHeaders`/`exportError`/`exportFile` (`lib/export/request.ts`), `contentDisposition`, `assertOwner`, `supabaseAccountsStore`, `getPrefs`, `formatDay`, `isUuid`.
- Produces: `buildFollowerSheets(d: FollowerSheetInput, t: Translate, prefs: FormatPrefs): WorkbookSheet[]` (the list sheet: Username, the list's date column, Profile link; an "About" sheet: account, list, both export dates, the list hint + the snapshot-based note); `GET /api/export/followers?account=<uuid>&snap=<uuid>[&vs=<uuid>]&list=<list>[&q=<text>]` → 200 xlsx (`private, no-store`, `nosniff`, `in2sight-<account>-<list>-<newer day>.xlsx`) · 401 `unauthorized` · 400 `bad_params` (unknown/repeated key, bad id, unknown list, a list the snapshots cannot answer) · 404 `not_found` (archived/unknown account, unknown snapshot, migration missing) · 500 `unexpected` — the `export.errors.*` keys `downloadExport` already knows.

- [ ] **Step 1: Write the failing test** — create `tests/export-followers.test.ts`:

```ts
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellObject } from 'write-excel-file/node';
import { buildFollowerSheets } from '@/lib/export/followers';
import type { WorkbookSheet } from '@/lib/export/workbook';
import { DEFAULT_PREFS } from '@/lib/prefs';

const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const state = vi.hoisted(() => ({
  owner: true,
  account: null as Record<string, unknown> | null,
  snapshots: null as Record<string, unknown>[] | null,
  data: {} as Record<string, unknown>,
  written: [] as WorkbookSheet[][],
  order: [] as string[],
}));
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => (state.order.push('assertOwner'), state.owner) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (state.order.push('ownerSession'), {}) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => state.order.push('ADMIN') }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => ({ ...(await import('@/lib/prefs')).DEFAULT_PREFS, dateFormat: 'YYYY-MM-DD' }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ getById: async () => state.account }) }));
vi.mock('@/lib/followers/read', () => ({
  listFollowerSnapshots: async () => state.snapshots,
  loadFollowerSnapshot: async (_db: unknown, _a: string, id: string) => state.data[id] ?? null,
}));
vi.mock('@/lib/export/workbook', async (orig) => ({
  ...(await orig<object>()),
  writeWorkbook: async (sheets: WorkbookSheet[]) => (state.written.push(sheets), Buffer.from('xlsx')),
}));

import { GET } from '@/app/api/export/followers/route';
import { translator } from '@/lib/export/workbook';

const PREFS = { ...DEFAULT_PREFS, dateFormat: 'YYYY-MM-DD' as const };
const T1 = Date.parse('2026-10-05T04:00:00Z') / 1000;
const values = (s: WorkbookSheet) => s.data.map((r) => (r as (CellObject | null)[]).map((c) => (c === null ? null : c.value instanceof Date ? c.value.toISOString() : c.value)));
const call = (q: string) => GET(new NextRequest(`https://app.test/api/export/followers?${q}`));
const meta = (id: string, takenOn: string) => ({ id, takenOn, followerCount: 2, followingCount: 1, createdAt: `${takenOn}T10:00:00Z` });

beforeEach(() => {
  state.owner = true;
  state.account = { id: ACC, username: 'shop.one', status: 'active' };
  state.snapshots = [meta(S2, '2026-10-20'), meta(S1, '2026-09-20')];
  state.data = {
    [S2]: { followers: [{ username: 'bob', at: null }, { username: 'dan', at: T1 }, { username: 'ann.b', at: T1 - 60 }], following: [{ username: 'dan', at: T1 }] },
    [S1]: { followers: [{ username: 'amy', at: T1 - 999 }, { username: 'bob', at: null }], following: null },
  };
  state.written = [];
  state.order = [];
});

describe('buildFollowerSheets', () => {
  it('the list sheet: username text cells, real date-time cells (empty when unknown), a profile link; an About sheet', () => {
    const [list, about] = buildFollowerSheets({ account: '=evil', list: 'new', newer: '2026-10-20', older: '2026-09-20', people: [{ username: 'dan', at: T1 }, { username: 'eve', at: null }] }, translator('en'), PREFS);
    expect(list.sheet).toBe('New followers');
    expect(list.stickyRowsCount).toBe(1);
    expect(values(list)).toEqual([
      ['Username', 'Followed you on', 'Profile link'],
      ['dan', '2026-10-05T12:00:00.000Z', 'https://www.instagram.com/dan/'], // the owner's wall clock (Kuala Lumpur, UTC+8) as the cell value
      ['eve', null, 'https://www.instagram.com/eve/'],
    ]);
    expect((list.data[1] as CellObject[])[1]).toMatchObject({ type: Date, format: 'yyyy-mm-dd hh:mm' });
    expect(about.sheet).toBe('About');
    const rows = values(about);
    expect(rows[1]).toEqual(['Account', "'=evil"]); // the formula-injection guard of lib/export/cells.ts
    expect(rows[5][1]).toBe('They follow you in the export of 2026-10-20 but not in the one of 2026-09-20. Snapshot-based: only people who followed or unfollowed between these two files, not everything in between.');
  });

  it('the time column follows the list; zh-CN sheet names', () => {
    const [list] = buildFollowerSheets({ account: 'a', list: 'theyDontFollow', newer: 'x', older: null, people: [] }, translator('en'), PREFS);
    expect(values(list)[0][1]).toBe('You followed on');
    const zh = buildFollowerSheets({ account: 'a', list: 'mutual', newer: 'x', older: null, people: [] }, translator('zh-CN'), { ...PREFS, locale: 'zh-CN' });
    expect(zh.map((s) => s.sheet)).toEqual(['互相关注', '说明']);
  });
});

describe('GET /api/export/followers', () => {
  it('the whole filtered list as xlsx: private, nosniff, a clean file name; owner first, never the admin client', async () => {
    const res = await call(`account=${ACC}&snap=${S2}&vs=${S1}&list=new&q=NN`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toContain('in2sight-shop.one-new-2026-10-20.xlsx');
    expect(values(state.written[0][0]).slice(1).map((r) => r[0])).toEqual(['ann.b']); // "NN" → lower-cased search; dan and ann.b are new, only ann.b matches
    expect(state.order[0]).toBe('assertOwner');
    expect(state.order).not.toContain('ADMIN');
  });

  it('every list, sorted as on screen (newest follow first, unknown last)', async () => {
    await call(`account=${ACC}&snap=${S2}&list=iDontFollow`);
    expect(values(state.written[0][0]).slice(1).map((r) => r[0])).toEqual(['ann.b', 'bob']);
  });

  it('a stranger gets 401 before anything is read', async () => {
    state.owner = false;
    const res = await call(`account=${ACC}&snap=${S2}&list=new`);
    expect([res.status, await res.json()]).toEqual([401, { error: 'unauthorized' }]);
    expect(state.order).toEqual(['assertOwner']);
  });

  it.each([
    ['no parameters', ''],
    ['an unknown key', `account=${ACC}&snap=${S2}&list=new&from=2026-01-01`],
    ['a repeated key', `account=${ACC}&snap=${S2}&list=new&list=lost`],
    ['a bad account id', `account=x&snap=${S2}&list=new`],
    ['a bad snapshot id', `account=${ACC}&snap=${S2}'--&list=new`],
    ['an unknown list', `account=${ACC}&snap=${S2}&list=everyone`],
    ['a list these snapshots cannot answer', `account=${ACC}&snap=${S1}&list=mutual`],
  ])('%s → 400 bad_params', async (_n, q) => {
    const res = await call(q);
    expect([res.status, await res.json()]).toEqual([400, { error: 'bad_params' }]);
    expect(state.written).toEqual([]);
  });

  it('another account, an archived one, an unknown snapshot or the migration missing → 404', async () => {
    const q = `account=${ACC}&snap=${S2}&list=new`;
    state.account = { id: ACC, username: 'shop.one', status: 'archived' };
    expect((await call(q)).status).toBe(404);
    state.account = { id: ACC, username: 'shop.one', status: 'active' };
    expect((await call(`account=${ACC}&snap=00000000-0000-4000-8000-000000000009&list=new`)).status).toBe(404);
    state.snapshots = null;
    expect((await call(q)).status).toBe(404);
    state.account = null;
    expect((await call(q)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/export-followers.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/export/followers"`.

- [ ] **Step 3: Write `lib/export/followers.ts`** (exactly this):

```ts
// The Excel export of ONE follower list (Plan 15b), on the owner's explicit click in the Followers tab; follower names
// are never part of the account workbook/PDF exports. Same cell rules as every export sheet (lib/export/workbook.ts):
// text goes through safeText (the formula-injection guard), follow times are real date-time cells in the owner's
// format, an unknown time is an EMPTY cell. A second sheet says what the list is and that it is snapshot-based.
import { sheetNames } from '@/lib/export/cells';
import { sheet, type Translate, type WorkbookSheet } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';
import { sinceKey, type FollowerList } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';

export interface FollowerSheetInput {
  account: string; // the account's username
  list: FollowerList;
  newer: string; // the newer export's date, already formatted (lib/format.ts formatDay)
  older: string | null; // the older one's, null = no comparison
  people: Person[]; // already filtered and sorted (lib/followers/diff.ts filterList)
}

type AboutRow = { field: string; value: string | null };

export function buildFollowerSheets(d: FollowerSheetInput, t: Translate, prefs: FormatPrefs): WorkbookSheet[] {
  const k = (key: string, values?: Record<string, string | number>) => t(`pages.account.followerDiff.${key}`, values);
  const listName = k(`lists.${d.list}`);
  const people = sheet<Person>(
    listName,
    [
      { header: k('cols.username'), kind: 'text', width: 32, get: (p) => p.username },
      { header: k(`cols.${sinceKey(d.list)}`), kind: 'datetime', width: 18, get: (p) => (p.at === null ? null : new Date(p.at * 1000).toISOString()) },
      { header: k('sheet.profile'), kind: 'text', width: 44, get: (p) => `https://www.instagram.com/${p.username}/` },
    ],
    d.people,
    { prefs },
  );
  const hint = d.older === null && (d.list === 'new' || d.list === 'lost') ? '' : k(`hints.${d.list}`, { newer: d.newer, older: d.older ?? '' });
  const about = sheet<AboutRow>(
    k('sheet.about'),
    [
      { header: k('sheet.field'), kind: 'text', width: 18, get: (r) => r.field },
      { header: k('sheet.value'), kind: 'text', width: 90, get: (r) => r.value },
    ],
    [
      { field: k('sheet.account'), value: d.account },
      { field: k('sheet.list'), value: listName },
      { field: k('sheet.newer'), value: d.newer },
      { field: k('sheet.older'), value: d.older },
      { field: k('sheet.note'), value: `${hint} ${k('snapshotBased')}`.trim() },
    ],
    { prefs },
  );
  const names = sheetNames([people.name, about.name]);
  return [people, about].map((s, i) => ({ sheet: names[i], data: s.data, columns: s.columns, stickyRowsCount: s.stickyRowsCount }));
}
```

- [ ] **Step 4: Write `app/api/export/followers/route.ts`** (exactly this):

```ts
import type { NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { buildFollowerSheets } from '@/lib/export/followers';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportFile, exportHeaders } from '@/lib/export/request';
import { translator, writeWorkbook } from '@/lib/export/workbook';
import { formatDay } from '@/lib/format';
import { diffSnapshots, filterList, FOLLOWER_LISTS, type FollowerList } from '@/lib/followers/diff';
import { listFollowerSnapshots, loadFollowerSnapshot } from '@/lib/followers/read';
import { parseFollowerState, resolvePair } from '@/lib/followers/state';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid } from '@/lib/tags';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const KEYS = new Set(['account', 'snap', 'vs', 'list', 'q']);

/**
 * GET /api/export/followers?account=<uuid>&snap=<uuid>[&vs=<uuid>]&list=<list>[&q=<search>] — one follower list of the
 * Followers tab as Excel (Plan 15b). Owner session only (assertOwner first; RLS on every read; never the admin
 * client). Only these keys, each once; the snapshots must belong to the live account. The whole filtered list, sorted
 * as on screen. Never logs names or error objects.
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const keys = [...q.keys()];
    if (keys.some((k) => !KEYS.has(k)) || new Set(keys).size !== keys.length) return exportError(h, 400, 'bad_params');
    const [account, snap, vs, list] = [q.get('account'), q.get('snap'), q.get('vs'), q.get('list')];
    if (!isUuid(account) || !isUuid(snap) || (vs !== null && !isUuid(vs)) || !(FOLLOWER_LISTS as readonly (string | null)[]).includes(list)) return exportError(h, 400, 'bad_params');
    const prefs = await getPrefs();
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const acct = await supabaseAccountsStore(db).getById(account.toLowerCase());
    if (!acct || acct.status === 'archived') return exportError(h, 404, 'not_found');
    const snapshots = await listFollowerSnapshots(db, acct.id);
    const state = parseFollowerState({ snap, vs: vs ?? undefined, list: list ?? undefined, q: q.get('q') ?? undefined }, snapshots ?? []);
    if (!snapshots || !state.snap || (vs !== null && !state.vs)) return exportError(h, 404, 'not_found');
    const pair = resolvePair(state, snapshots);
    const [newer, older] = await Promise.all([pair.newer && loadFollowerSnapshot(db, acct.id, pair.newer.id), pair.older && loadFollowerSnapshot(db, acct.id, pair.older.id)]);
    if (!pair.newer || !newer) return exportError(h, 404, 'not_found');
    const people = diffSnapshots(newer, older ?? null)[list as FollowerList];
    if (!people) return exportError(h, 400, 'bad_params'); // a list these snapshots cannot answer
    const sheets = buildFollowerSheets(
      { account: acct.username, list: list as FollowerList, newer: formatDay(pair.newer.takenOn, prefs), older: older && pair.older ? formatDay(pair.older.takenOn, prefs) : null, people: filterList(people, state.q) },
      translator(prefs.locale),
      prefs,
    );
    return exportFile(h, await writeWorkbook(sheets), XLSX, contentDisposition(`in2sight-${acct.username}-${list}-${pair.newer.takenOn}`, 'xlsx'));
  } catch {
    console.error('followers export failed'); // fixed text: never the error object (it can carry usernames)
    return exportError(h, 500, 'unexpected');
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/export-followers.test.ts tests/followers-privacy.test.ts tests/export-workbook.test.ts`, `npx tsc --noEmit`, `npx eslint lib/export/followers.ts app/api/export/followers/route.ts tests/export-followers.test.ts`
Expected: PASS (13 tests in the new file), tsc and eslint clean.

- [ ] **Step 6: Commit**

```bash
git add lib/export/followers.ts app/api/export/followers/route.ts tests/export-followers.test.ts
git commit -m "feat(followers): export one follower list to Excel (owner-only, formula-guarded, snapshot-based note)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, final check

**Files:**
- Create: `docs/RUNBOOK_FOLLOWERS.md`
- Modify: `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/UI_STANDARDS.md`

**Interfaces:**
- Consumes: everything above. Produces: no code API; the docs below.

- [ ] **Step 1: `docs/RUNBOOK_FOLLOWERS.md`** — create with exactly this content:

````markdown
# Runbook — Followers by name (Plan 15b)

Live checks for the owner (with the assistant). Everything was tested with fakes only; the Instagram export format is
UNCONFIRMED until §2 passes on a real export. **Privacy first:** the follower lists are other people's personal data.
Never paste usernames, export files or screenshots of the lists into chats, issues or logs; the checks below are
designed to report counts and structure only.

## 0. The migration (apply BEFORE or right after deploying; the owner says go)

`supabase/migrations/20261028000002_follower_exports.sql` adds ONE table, `follower_exports` (owner-only RLS, deleted
with its account). Until it is applied, the Followers tab shows the guide and "Followers needs a database update", and
the upload answers `notReady`; nothing else changes. Apply:

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §0 "How it was applied")
npx supabase migration list            # expect only 20261028000002 pending (and Plan 15a's 20261028000001 if it exists), nothing remote-only
npx supabase db push --dry-run --password "$SUPABASE_DB_PASSWORD"   # expect exactly the pending file(s)
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Confirm in the Supabase SQL editor:

```sql
select relname, relrowsecurity from pg_class where relname = 'follower_exports';            -- 1 row, true
select polname, polcmd from pg_policy where polrelid = 'public.follower_exports'::regclass;  -- follower_exports_owner_all, *
select confdeltype from pg_constraint where conrelid = 'public.follower_exports'::regclass and contype = 'f';  -- c (cascade)
```

Then Supabase dashboard → Advisors → Security and Performance: no new warning for `follower_exports`.

## 1. Layout: 360 / 768 / 1280 × themes, keyboard

Account page → Followers, in each width (DevTools device toolbar) and each theme in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| Tabs Overview / Posts / Stories / Followers fit or scroll sideways without a visible bar | | | |
| The guide opens and closes; the seven steps are readable | | | |
| Toolbar wraps; search, the two selects and the buttons are the same height; no sideways page scroll | | | |
| The five list tabs scroll sideways on a phone; the active one is underlined | | | |
| The list is cards on a phone, a table from 768; page navigation wraps and stays centred | | | |
| Upload opens as a bottom sheet (phone) / a dialog (wider); Esc and Cancel close it; focus returns to the button | | | |
| No range bar on the Followers tab | | | |

Keyboard only: Tab through the guide summary → search → Snapshot → Compare with → Export list → Upload export → the
list tabs (arrow keys move, Enter opens) → the profile links → the page buttons → the Delete buttons.

## 2. Confirm the export format on a REAL export (gate: do this before relying on the feature)

1. Follow the guide in the tab on the phone (the owner's account). Note any step whose wording differs from the guide
   (Instagram renames menus) and tell the assistant the exact labels (en and, if used, zh-CN).
2. Unzip the download. Note the folder path and the file names under `connections/followers_and_following/` (or
   wherever they are). Expected: `followers_1.json` (+ `followers_2.json` …), `following.json`.
3. Print the STRUCTURE only (no usernames) of each file — run this in a terminal in the unzipped folder (Node is
   installed with the app):

```bash
node -e "for (const f of process.argv.slice(1)) { const j = JSON.parse(require('fs').readFileSync(f, 'utf8')); const list = Array.isArray(j) ? j : Object.values(j)[0]; const e = Array.isArray(list) ? list[0] : null; const s = e && Array.isArray(e.string_list_data) ? e.string_list_data[0] : null; console.log(f, '| root:', Array.isArray(j) ? 'array' : 'object keys=' + Object.keys(j).join(','), '| entries:', Array.isArray(list) ? list.length : '?', '| entry keys:', e ? Object.keys(e).join(',') : '-', '| title empty:', e ? e.title === '' : '-', '| item keys:', s ? Object.keys(s).join(',') : '-', '| timestamp type:', s ? typeof s.timestamp : '-'); }" followers_1.json following.json
```

   Expected (the plan's assumptions E3/E4): followers = `root: array` (or `object keys=relationships_followers`),
   item keys `href,value,timestamp`, timestamp `number`; following = `object keys=relationships_following`, item keys
   `href,value,timestamp` or `href,timestamp` with a non-empty title. Send the assistant these lines (they contain no
   names). Anything else: the parser needs a new fixture (lib/followers/parse.ts `entryPerson` / `kindOf`).
4. Upload the files in the tab. The preview's follower count should be close to the profile's follower number on
   Instagram (people who followed or left since the export was made explain a small gap); "entries are not a valid
   username" should be 0 or tiny. Note both numbers (counts only).

## 3. Upload and errors

- Choose the `.zip` itself → "is a zip file. Unzip it first". Choose a `.html` file → "comes from an HTML export".
  Choose `following.json` alone → "Add followers_1.json". Choose `recently_unfollowed_profiles.json` with the
  followers file → listed under "Not needed, skipped".
- DevTools → Network on Upload: ONE `POST /api/accounts/<id>/followers`, request size well under 4 MB (≈ 25–47 bytes
  per person), answer 201; the request body contains `followers` pairs and NO `instagram.com` links.
- Upload the same export again with another date: the snapshot list shows both; New followers and Unfollowed you are
  empty when comparing them (same people).

## 4. The lists

1. With two real exports some days apart: New followers and Unfollowed you list the changes, each with "Snapshot-based".
   Spot-check two names per list on Instagram (do not paste them anywhere).
2. Don't follow you back / You don't follow back / Mutuals: the three add up — Mutuals + You don't follow back = the
   newer snapshot's followers; Mutuals + Don't follow you back = its following.
3. Search narrows the list as you type (after a short pause), the chip removes it; pages: First / Previous / Next /
   Last keep the search; `page=999` in the URL shows page 1.
4. Snapshot / Compare with: pick an older pair; the dates in the hint follow; choosing them "the wrong way round"
   still compares older → newer.
5. Export list: the .xlsx opens in Excel / Numbers / LibreOffice: the list sheet (Username, the date column, Profile
   link) and an About sheet with both dates and the snapshot-based note.
6. Delete a snapshot: it asks first; afterwards the list and the selects no longer show it.

## 5. Privacy and security (run all; report only yes/no and counts)

```sql
-- sizes: about 1 MB or less per 50,000 followers
select taken_on, follower_count, following_count, pg_column_size(followers) + pg_column_size(followers_at) + coalesce(pg_column_size(following) + pg_column_size(following_at), 0) as bytes from public.follower_exports order by taken_on desc;

-- nobody but the owner gets rows
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.follower_exports;   -- 0
rollback;
begin;
set local role anon;
select count(*) from public.follower_exports;   -- ERROR: permission denied for table follower_exports
rollback;
```

- Vercel → the project → Logs, the hour of an upload and an export: search for one follower's username you know is in
  the file → **no match** (only the fixed lines `followers upload failed` / `followers export failed` may ever appear).
- `select count(*) from public.sync_runs where error ilike '%<a known follower username>%';` → 0 (the sync never sees
  these lists).
- The account Excel/PDF exports (Export dialog) contain no follower names (only counts, as before).
- Delete all data: when an ARCHIVED test account is deleted permanently (Accounts → Delete all data), its snapshots
  go with it: `select count(*) from public.follower_exports where account_id = '<that id>';` → 0. Do not delete a
  real account for this check; it is pinned by the migration test (`on delete cascade`) if no test account exists.

## 6. Speed (the biggest account)

DevTools → Network on a list change (another tab, a search, a page) for the account with the most followers: "Waiting
for server response" within the 1.2 s budget of docs/RUNBOOK_PERF.md. Note: ____ ms. Each change re-reads the two
compared snapshots (~1–2 MB from the database for 50,000 followers); if it is slower than the budget, tell the
assistant (the upgrade is a per-snapshot cache or an SQL diff function).

## 7. Known limits (by design)

- Only by-name route: no API gives follower names; nothing is crawled. Lists are as good as the two files.
- Snapshot-based: someone who followed and unfollowed between two exports appears in neither list; renamed and
  deactivated accounts appear as "Unfollowed you".
- At most 50,000 followers and 10,000 following per export; at most 60 snapshots per account. No .zip upload yet.
- No reminder notification; only the quiet "export is N days old" line after 30 days.

## What to send if it fails

The URL (without tokens), the width and theme, the step, the error text shown, counts (never names), and for §2 the
structure lines printed by the command.
````

- [ ] **Step 2: `docs/UI_STANDARDS.md`** — insert after the line that starts with `13. **Lists have their own date filter.**`:

```markdown
14. **Uploads are parsed in the browser and re-checked on the server.** A file the owner picks is size-checked by name and size BEFORE it is read, parsed by a pure, capped, shape-validating function (JSON.parse only, error keys, odd entries skipped and counted), previewed, and only the minimum the feature needs is sent — to a route handler that checks the owner, the origin, the content type and the byte size before reading, reads with a byte cap and validates every value again. Raw files never leave the device; nothing from them is logged. → `lib/followers/parse.ts`, `lib/followers/payload.ts`, `app/api/accounts/[id]/followers/route.ts`, `components/account/FollowerUpload.tsx`.
```

- [ ] **Step 3: SPEC, TODO, HANDOVER**

`docs/SPEC.md`: insert directly before the line `## 8. UI (v1)` a new section (use the next free letter after the last `## 7x.` heading — `7g` unless Plan 15a already added one):

```markdown
## 7g. Followers by name (Plan 15b; creator-toolkit design §6, §0b)
No API gives follower names and crawling was declined (§0b), so the only by-name route is the owner's own Instagram export ("Export your information" → Followers and following → JSON). Account page → **Followers** tab: a guide with the exact steps (en/zh-CN), an upload dialog, five lists comparing two snapshots — **new followers, unfollowed you, don't follow you back, you don't follow back, mutuals** — searchable (username substring), 50 per page from the server, exportable to Excel (one list + an About sheet, formula-guarded), always labelled snapshot-based. Upload: the browser checks names/sizes (≤ 10 files, ≤ 32 MB each, ≤ 64 MB total), parses the JSON (`followers_N.json` arrays or `relationships_followers`, `following.json` `relationships_following` with the name in `value`, `title` or the link; other `relationships_*` files skipped; ≤ 50,000 followers, ≤ 10,000 following) and sends only lower-cased usernames + follow times to `POST /api/accounts/[id]/followers` (owner → origin → JSON → ≤ 4 MB before and while reading → strict validation → live account → ≤ 60 snapshots). Storage: `follower_exports` (migration `20261028000002`), ONE row per snapshot with parallel arrays (`followers text[]`, `followers_at bigint[]`, optional `following`/`following_at`), owner-authored RLS (`is_owner()` for all), `on delete cascade` from `accounts` (part of "Delete all data permanently"; a future Settings "Data & privacy" must list it), never logged, never in `sync_runs`, alerts, push or the account exports; only `lib/followers/read.ts` names the table. Diff = TypeScript set arithmetic on the server per request; only one page reaches the browser. No reminder notification (off by default, §0b); the tab notes an export older than 30 days. Without the migration the tab shows the guide and "needs a database update". Zip upload, > 50,000 followers (gzip payload) and storing recently-unfollowed / pending requests are later.
```

`docs/TODO.md`: insert directly before the line `## 6b. Next (Plan 14/15 Settings)` (next free letter after the last `## 6x.` section — `6k` unless Plan 15a took it):

```markdown
## 6k. Followers by name — export upload diff (Plan 15b)
- [x] Migration `20261028000002_follower_exports.sql` (one row per snapshot, arrays, owner RLS, cascade) _(written and tested; NOT applied — owner go-ahead, docs/RUNBOOK_FOLLOWERS.md §0)_
- [x] Browser-side parser (size caps, known format variants, error keys) + strict server validation; owner-only capped upload route; delete action; privacy guard test
- [x] Followers tab: guide (en/zh-CN), upload dialog, five lists with search and server pages, snapshot list, Excel export of a list; quiet "older than 30 days" line
- [ ] Owner: apply the migration (runbook §0); **confirm the export format on a real export (RUNBOOK_FOLLOWERS §2 — gate)**; live and privacy checks (§1, §3–§6); confirm the plan's open questions (50,000 cap, no zip yet, ignore recently-unfollowed/pending, no reminder push, 60 snapshots, fourth tab, owner-picked date, renamed accounts as unfollowers)
- [ ] Later: .zip upload (DecompressionStream + inflated-size caps), gzip payload for > 50,000 followers, commenters × followers (Plan 15c)
```

`docs/HANDOVER.md` §0: insert after the paragraph that starts with `**Plan 14c state (shell tabs):**`:

```markdown
**Plan 15b (Followers by name) — lessons:** the first file upload in the app. Parse untrusted files in the BROWSER with a pure, capped parser (sizes checked before reading; `JSON.parse` only; skip-and-count odd entries; error keys) and send only the minimum; the server never trusts that: a route handler (not a server action: those are capped at 1 MB and raising the limit raises it for every action) checks owner → origin → content type → content-length → a byte-counting read → strict validation. Vercel Functions reject bodies over 4.5 MB, which is why raw exports cannot be uploaded. Personal data of third parties: one module names the table (a test enforces it), fixed log lines only, owner-session client only, cascade with the account. Store a snapshot as one row of arrays (~6× smaller than a row per name). Migration `20261028000002` is written but NOT applied; the export format is UNCONFIRMED until RUNBOOK_FOLLOWERS §2 passes on a real export.
```

and update the "**Where we stopped:**" sentence to say Plan 15b is implemented on local `main` (not pushed) with its migration not applied and the export format unconfirmed — check `git log` for the real state before writing it.

- [ ] **Step 4: Final check** — remove finished worktrees first (implementer rules, orchestrator checklist), then `rm -rf .next` and run `npm run check > check.log 2>&1; echo "CHECK_EXIT=$?" >> check.log` and read the log. Expected: lint, typecheck, every test file and the build pass (`CHECK_EXIT=0`; the build lists `/api/accounts/[id]/followers` and `/api/export/followers`). Also `git diff --stat <base> -- app/globals.css components/ui` → empty; `grep -rn "follower_exports" app components lib` → only `lib/followers/read.ts` (and comments); `grep -rn "console\.\(log\|info\|warn\)" lib/followers app/api/accounts app/api/export/followers components/account/Follower*` → nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/RUNBOOK_FOLLOWERS.md docs/UI_STANDARDS.md docs/SPEC.md docs/TODO.md docs/HANDOVER.md
git commit -m "docs(followers): runbook (real-export gate, privacy checks), UI standard 14, SPEC 7g, TODO, lessons" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
