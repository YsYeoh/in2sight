# Plan 16c: Settings → Data & privacy (storage used, export all, delete all) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** Settings → Data & privacy (Plan 16a's placeholder) becomes four cards: (1) **What in2sight stores** (the existing list, plus one line saying tokens, passwords and device keys are never shown, exported or logged); (2) **Storage used**: database total, five table groups (rows as an estimate, bytes including indexes) and the private `covers` bucket per account, read-only, owner-only; (3) **Export your data**: one JSON file per table, streamed page by page through the OWNER session (never the service role, so `account_tokens` cannot be read even by mistake), "Download all files" fetches them one after another, other people's personal data (commenter names and texts, follower lists) only when the owner ticks a box or picks that single file; (4) **Delete all data**: a destructive button → a dialog asking for the password (re-checked on the memory-only client of Plan 16b) and the typed word `DELETE` → one service-role-only SQL function deletes every account (cascade) and the owner rows without an account in ONE transaction, then the cover images are removed with the Storage API; idempotent and resumable (run it again and it finishes); the login, 2FA, preferences, alert rules and push devices stay.

**Architecture:** One migration `supabase/migrations/20261031000001_data_privacy.sql` with two functions and no table: `data_usage()` (SECURITY DEFINER, `search_path = ''`, returns nothing unless `is_owner()`; literal table list, `pg_class.reltuples` estimates, `pg_total_relation_size`, `storage.objects` sizes of the `covers` bucket grouped by folder, the database size; no dynamic SQL; granted to `authenticated`, revoked from `public, anon`) and `delete_all_data()` (security invoker, `where true` on every delete for pg-safeupdate, executable by `service_role` ONLY: the browser session cannot call it, so the password re-check in the server action is a real boundary, not UI-level). Pure / small libs in `lib/data/`: `usage.ts` (`summariseUsage`, `readUsage`), `export.ts` (`EXPORT_TABLES` allow-list with primary keys, `afterFilter` keyset filter, `exportPages` async generator that pages until an EMPTY page, `jsonArrayStream` that errors the stream on any failure or past a 50 s budget so a broken download is never saved as a cut-off file), `delete.ts` (`DELETE_PHRASE`, `DeleteState`, `deleteAllData(admin)`, `removeAllCovers(admin)` listing the bucket, not the accounts table). Route `GET /api/export/data?table=<name>` (assertOwner first, one allow-listed parameter, owner-session client, `maxDuration = 60`). Server action `deleteAllDataAction` in `app/(app)/settings/data-actions.ts` (requireOwner → phrase → shared wrong-password cookie limit → `checkPassword` → `createAdminSupabase()` → `deleteAllData` → `revalidatePath('/', 'layout')`). Plan 16b's password check is extracted (second use): `checkPassword` in `lib/auth/password.ts` (used by `changePassword` too, same call order) and the memory-only client moves from `security-actions.ts` to `lib/auth/check-client.ts` (a `'use server'` file cannot export a plain helper). UI: `components/settings/DataExport.tsx`, `components/settings/DeleteAllData.tsx` (ResponsiveDialog + form + `useActionState`), `components/settings/sections/DataSection.tsx` (replaced; same file name and export). `formatBytes` joins `lib/format.ts`; `downloadExport` / the file-name helpers accept `json` and treat a stream that breaks off as an error.

**Tech Stack:** Next.js 16.4 App Router (route handler streaming a `ReadableStream`, server actions), React 19.3 (`useActionState`), TypeScript strict, `@supabase/supabase-js` 2.117.3 / `@supabase/ssr` (already installed), next-intl 4, shadcn via the shared pieces (`Card`, `Checkbox`, `Label`, `Badge`, `Button`, `Input`, `FormField`, `LoadingButton`, `ResponsiveDialog*`, `PasswordInput` of 16b), Vitest + Testing Library + jsdom. **New dependencies: none** (no zip library: one file per table, see Decisions).

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §7 ("Data & privacy (storage used by covers, follower snapshots, export all, delete all, what we store)"), §4 ("add a size dashboard in Settings → Data"; "Permanent account delete removes Storage objects … on deauthorize+delete callbacks → delete covers too"), §8 ("third-party usernames … included in 'delete all data'"); `docs/SPEC.md` §7c ("Delete all data permanently"), §7h (follower exports "part of Delete all data permanently; a future Settings Data & privacy must list it"), §7k. Project rules: `CLAUDE.md` (binding). Built **after Plans 16a and 16b** (both on local `main`; `DataSection.tsx` is 16a's placeholder, `checkPassword` reuses 16b's check client).

**Scratch run:** every code block of Tasks 1–6 was written into a throwaway `git clone` of `main` at `e126028` in the session scratchpad (own `npm ci`; the real `node_modules` untouched) and the migration was executed on PGlite 0.3 (Postgres 17 in WASM) on top of all 15 existing migrations with stubbed `auth` / `storage` schemas and the Supabase roles. Results: see "Scratch-run result" at the end. Not executed: a real PostgREST (the keyset filter syntax), Supabase Storage, a browser, Vercel.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **⚠ Delete all = everything Instagram-derived and owner-authored, not the login.** `delete_all_data()` deletes every row of `accounts` (any status). `ON DELETE CASCADE` (verified for every table in the PGlite run) removes `account_tokens`, `account_daily`, `account_daily_breakdown`, `media` (→ `media_metrics`, `media_children`, `media_tags`, `comments`), `comments`, `audience_snapshots`, `online_followers`, `follower_snapshots`, `api_snapshots`, `follower_exports`, `moderation_settings`, `moderation_rules`, `moderation_log`, `sync_state`, `sync_progress` and the account's `notifications`. Then the rows with no account: `tags`, `explorer_views`, the remaining `notifications`, `sync_runs`. **Kept:** `auth.users`, `owners`, the 2FA factor, `profiles` (preferences + alert rules), `push_subscriptions` (the owner's devices). The app afterwards is "freshly set up, still signed in"; connecting an account again starts a new history. Per-account deletion stays where it is (`/accounts`: archive → delete permanently, `deleteAccountAction`), not duplicated here.
- **⚠ Confirmation = the password + the typed word `DELETE`, behind aal2.** `requireOwner()` already demands aal2 when 2FA is on. The password is re-checked by the same memory-only client as "Change password" (`checkPassword`, extracted from 16b's `changePassword`; the check session is revoked at once). The word is the same in both languages (an English word in a Chinese UI is common for destructive confirms; the label says "Type DELETE to confirm" / "输入 DELETE 以确认") and is checked on the server again. Wrong passwords bump the SAME cookie counter as change password (`in2s_pw_attempts`, 5 per 15 minutes: friction only, Supabase's `/token` limit is the real one). **No extra TOTP prompt** (Open question 2). **No cooldown** (the action is idempotent; a second run deletes nothing). **No audit table** (it would be deleted by the same action or need a migration and its own RLS): Supabase's API log keeps a line for every `POST /rest/v1/rpc/delete_all_data` (time, status) outside the reach of the browser session; Vercel's log has the server-action POST. The runbook shows where.
- **The delete is a real boundary, not UI-level.** Plan 16b's review found that a stolen session can call Supabase directly. `delete_all_data()` is executable by `service_role` only (`revoke execute … from public, anon, authenticated`; PGlite run: `authenticated` at aal2 gets "permission denied"), so the only way to run it is the server action, after `requireOwner()` and the password check. (A stolen aal2 session can still delete owner-authored rows it already could before this plan: tags, saved views, follower exports, comments rows: unchanged.)
- **Order of operations and partial failure.** (1) owner, (2) phrase, (3) cookie limit, (4) password, (5) `delete_all_data()`: ONE transaction, all or nothing (PGlite run: a failure injected on the 3rd delete left accounts and tags in place), (6) covers: list the bucket's top-level folders (account ids, including folders of accounts deleted earlier), remove each with the existing `removeAccountCovers`, list again → `coversDone`. A failure in (5) deletes nothing and says "Try again: running it again is safe". A failure in (6) leaves the database empty and some images (private, unreferenced); the UI says "Run Delete all data again in a minute"; the second run's (5) returns zeros and (6) finishes. The Storage card shows any leftover folder as "Not linked to an account".
- **No sync pause flag.** The tick only syncs `status = 'active'` accounts it listed at its start; once the rows are gone, every write of a tick that is mid-run for a deleted account fails on its foreign key (isolated per account by design) and nothing can recreate an `accounts` row except the owner's own OAuth connect. The one thing a mid-run tick CAN recreate is a cover object uploaded after step (6) (Storage has no foreign keys): it shows as "Not linked to an account" and the next "Delete all data" removes it (bucket-wide, not account-based). A pause flag would need a migration and a tick change for a window of at most one tick (≤ 60 s): not built (`ponytail:` note in `lib/data/delete.ts` header comment).
- **⚠ Instagram authorisation is not revoked by the app.** The Instagram API with Instagram Login used here has no endpoint this app calls to revoke a user's grant (Facebook Login's `DELETE /{user-id}/permissions` is a different product); deleting `account_tokens` makes the app unable to call Instagram for those accounts. The card says the app stays listed in the owner's Instagram settings (Apps and websites) until removed there. Meta's deauthorize / data-deletion callbacks (`app/api/instagram/deauthorize`, `…/delete`) only call `markNeedsReconnect`, which is a no-op for an account that no longer exists (`findByIgUserId` → null → return): nothing to change or duplicate. Open question 5.
- **⚠ Export = one JSON file per table, no zip.** A zip writer would be a new dependency or ~80 lines of CRC / header code, and one request for everything would hit Vercel's function duration on a large history. One file per table keeps every request short (each table its own streamed GET, ≤ 50 s budget), needs no dependency and opens anywhere. JSON, not CSV: `jsonb`, arrays (`follower_exports`, `granted_scopes`) and nested `profile_activity` do not fit CSV cells. "Download all files" fetches the files one after another (never in parallel; the browser asks once to allow several downloads). File names: `in2sight-<table>-<YYYY-MM-DD>.json`. **Cover images are not exported** (binary; would need a zip). Open question 3.
- **What is exported** (`EXPORT_TABLES`, 20 tables, all through the OWNER session under RLS, `select('*')`): `accounts`, `account_daily`, `account_daily_breakdown`, `audience_snapshots`, `online_followers`, `follower_snapshots`, `api_snapshots`, `media`, `media_metrics`, `media_children`, `tags`, `media_tags`, `explorer_views`, `notifications`, `moderation_settings`, `moderation_rules`, `moderation_log`, `profiles`, and, marked third-party, `comments`, `follower_exports`. **Never:** `account_tokens` (tokens; the owner session has no privilege on it at all), `push_subscriptions` (an endpoint + its keys let anyone push to the device), `owners`, `sync_state` / `sync_progress` / `sync_runs` (bookkeeping). `select('*')` instead of column lists: a column list would be a second copy of the schema that fails only at runtime; instead `tests/data-export.test.ts` scans EVERY column of every exported table in all migrations (create + add column) and fails on `token|secret|password|keys|endpoint|refresh|credential` except the two reviewed ones (`accounts.token_expires_at` = a date, `api_snapshots.endpoint` = an API path without the token, `lib/sync/store.ts`), so a future secret column fails the build.
- **⚠ Other people's data in the export.** `comments` (commenter usernames, ids, texts) and `follower_exports` (follower / following usernames) are personal data of third parties (SPEC: "not exported unless the owner chooses"). Default: left out of "Download all files"; included when the owner ticks "Include other people's data…" (with a hint to keep the files private and delete them when done) or downloads that single file (marked "Other people's data"). `moderation_log` holds comment ids and result keys only: exported normally. Open question 4.
- **PostgREST's 1,000-row cap → keyset pagination on the primary key.** Every table is read in primary-key order; page N+1 is `or=(k1.gt.V1,and(k1.eq.V1,k2.gt.V2),…)` from the last row of page N, every value double-quoted with `\` and `"` escaped (timestamps contain `:` `.` `+`, which are reserved in PostgREST filters). The loop ends on an EMPTY page, never on a short one (a lower server cap would otherwise end the file silently). A page that repeats the previous cursor row throws (a filter the server ignored would loop forever). Page sizes: 1,000; `api_snapshots` 100 (bodies up to 64 KB); `follower_exports` 5 (a row can hold 50,000 names, about 1 MB). The primary keys are checked against the migrations by a test. Live check L1 compares a > 1,000-row table's file with `count(*)`.
- **Streaming, memory and time on Vercel.** The route returns a `ReadableStream` (Node runtime streams on Vercel): `[` at once, then one page per `pull`, `]` only after the last page. A read error or passing the 50 s budget (`maxDuration = 60`) calls `controller.error()`: the browser's `res.blob()` rejects (verified: Node `Response.blob()` rejects on an errored stream) and `downloadExport` returns `unexpected` instead of saving a cut-off file (the closing `]` is missing anyway, so a partial file never parses). Memory per request ≈ one page. **Ceiling:** a single table needing more than ~50 s (about 250,000 rows of `media_metrics` at ~200 ms per 1,000-row page) cannot be exported in one file (`ponytail:` comment in the route: add `?after=` parts when the runbook ever sees it). Expected sizes today (2 accounts): a few thousand to a few tens of thousands of rows per table.
- **Token refresh mid-stream.** `assertOwner()` runs `getSession` first, which refreshes a token expiring within auth-js's margin; the stream then runs ≤ 50 s on that token, so no refresh (and no rotated refresh-token cookie that could not reach the browser after the headers are sent) happens mid-stream. Stated in Review Focus 9.
- **CSRF and framing.** The export is a GET that changes nothing (allowed: it only reads, the answer goes to the owner's own browser, it has no CORS headers, and the session cookie is `SameSite=Lax`, so a cross-site `<img>` / `fetch` is not authenticated). The delete is a server action (POST, Origin-checked by Next.js), triggered only by the submit button of a dialog form (no `useEffect`, no `requestSubmit`, no auto action: guard test); `frame-ancestors 'self'` (14c) stops clickjacking from other origins; inside the app's own tab frames the dialog works like any form.
- **Storage used.** Table groups (`lib/data/usage.ts`): insights (`account_daily`, `account_daily_breakdown`, `audience_snapshots`, `online_followers`, `follower_snapshots`, `api_snapshots`), posts (`media`, `media_metrics`, `media_children`), comments (`comments`, `moderation_*`), followers (`follower_exports`), other (everything else listed). Rows = the planner's estimate (`reltuples`; never-analysed → unknown, shown as "—", never 0); sizes include indexes and TOAST (`pg_total_relation_size`). Covers per account (bytes + image count from `storage.objects.metadata.size`), labelled `@username` or "Not linked to an account". The database total (`pg_database_size`) includes Postgres' own tables. **Per-account database bytes are not shown** (tables are not partitioned by account; exact per-account counts would need a `count(*)` per table per account on every page view). Open question 6.
- **Why SECURITY DEFINER for `data_usage`.** The `covers` bucket has no storage policy (only the service role reads it, Plan 11b); the owner session cannot see `storage.objects` rows. The function is owned by the migration role, pins `search_path = ''`, qualifies every name, checks `public.is_owner()` before anything (returns no rows otherwise: PGlite run: a non-owner and an aal1 session with a verified factor get 0 rows), reads only, uses no dynamic SQL (literal table array). Executable by `authenticated` only. Live check L2: that the definer can read `storage.objects` on Supabase (the PGlite stub cannot prove Supabase's grants).
- **`formatBytes`** (1 KB = 1,024 bytes, `B / KB / MB / GB / TB`, the number via `formatNumber` in the owner's number format; unit symbols are not translated, like `%`). Row estimates via `formatCompact`.
- **UI:** four cards in one column (`grid gap-[var(--gp)]`, full width at 360 / 768 / 1280), tokens only (`text-muted-foreground`, `text-destructive`, `border-destructive/50`, `divide-y`), one control height per row (default-size buttons; the per-table "Download" buttons are `size="sm"` inside the single-files list, allowed by UI standard 5 "inside a dense list"), full-word labels, results `role="status"` / errors `role="alert"`. The delete dialog is a `ResponsiveDialog` (bottom sheet on phones) with `FormField` + `PasswordInput` + the word field; Cancel / "Delete everything" (destructive, disabled until the word matches). No `SaveBar` (nothing here is a settings form: the export and delete are one-shot actions, like 16b's password form). A hidden `username` field lets password managers offer the right entry.
- **Errors are keys**, never Supabase text: route `unauthorized | bad_params | unexpected` (shown via the existing `export.errors.*`); delete `phrase | missing_password | wrong_password | rate_limited | needs_update | unexpected`. Without the migration: the Storage card says "Storage figures need a database update", the delete answers `needs_update` (PostgREST `PGRST202`) and deletes nothing; the export works without it.
- **No logging** in any Data & privacy file (guard test). The route never logs (the existing exports log a fixed text; this one does not need to).

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_DATA.md` before relying on it)

1. **Scope of "Delete all data"** (Decisions, first bullet). **Default: every account and its data + tags, saved views, notifications, sync history; keep login, 2FA, preferences, alert rules, push devices.** Alternative: also reset preferences (`profiles` back to defaults) and remove push devices.
2. **A fresh TOTP code on top of the password?** The session is already aal2; a stolen session cookie does not give the password. **Default: password + typed word only.** Adding the code means one more field and an `mfa.challengeAndVerify` call before the delete.
3. **Export format.** **Default: one JSON file per table, no zip, no cover images.** Alternative: one zip of all tables + covers (a zip library would become a direct runtime dependency; `fflate` is only present transitively today) in one long request that runs into the function duration.
4. **Other people's data in "Download all".** **Default: off unless ticked; single files always available, marked.** Alternative: never exported at all.
5. **L — Instagram authorisation.** **Default: the app does not call Meta; the owner removes in2sight in the Instagram app (Settings → Website permissions → Apps and websites; the label may differ) after deleting.** The runbook checks that the deauthorize callback then fires harmlessly (no account → no-op).
6. **Storage figures.** **Default: table groups + covers per account + database total; no per-account database bytes; row counts are estimates.**
7. **L1 — keyset filter on the real PostgREST** (quoting of timestamps and composite keys). Unit-tested string only. RUNBOOK §2.4 compares a > 1,000-row file with `count(*)`. **Safe failure:** a wrong filter either errors (the download fails, "The export failed") or repeats a page (the repeat check throws): never a silently short or duplicated file.
8. **L2 — `data_usage()` reading `storage.objects` on Supabase.** If the migration role cannot read it, the function errors and the whole card shows "needs a database update" (readUsage → null): visible, harmless. RUNBOOK §1.
9. **L3 — `where true` and pg-safeupdate.** Supabase loads pg-safeupdate for PostgREST sessions; `delete … where true` has a WHERE clause and passes. Only the real delete proves it (RUNBOOK §3.3). **Safe failure:** the transaction errors and nothing is deleted (`unexpected`).

## Owner prerequisites

1. **Apply the migration `20261031000001_data_privacy.sql`** (owner's explicit go-ahead; `docs/RUNBOOK_DATA.md` §0) BEFORE relying on Storage used / Delete all. The code degrades without it (Decisions, "Errors are keys"). It adds two functions only; nothing existing changes.
2. Apply order with the other pending migration: `20261030000001_prefs_auto_mode` (16a) first, then this one (`sb.mjs db push` applies both in order; independent of each other).

## Assumptions about the current code (`main` at `e126028`, read for this plan)

- `components/settings/sections/DataSection.tsx` (16a): zero-prop async server component, export `DataSection`, keys `settings.data.{title,insights,covers,comments,delete,soon}`; mapped in `app/(app)/settings/[[...section]]/page.tsx` (`maxDuration = 60`, which server actions of the page inherit). `tests/settings-page.test.tsx` mocks it (unchanged).
- `messages/en.json` / `zh-CN.json` line 379: `      "soon": "Export and delete-everything tools are coming."` / `      "soon": "导出和全部删除工具即将推出。"` directly followed by `    },` (end of `settings.data`). `export.errors.{bad_params,unauthorized,not_found,pdf_failed,not_configured,unexpected}` exist (line ~1275).
- `lib/auth/password.ts`: `changePassword(session, checkClient, input)` with the inline check (`signInWithPassword` → `quietSignOut(check, 'local')` → same-user check), private `quietSignOut`, imports `isRateLimited`. `app/(app)/settings/security-actions.ts` has a private `checkClient()` with `createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. `tests/auth-security-guard.test.ts` pins `createClient` and that option string to `security-actions.ts` (Task 5 moves both pins to `lib/auth/check-client.ts`).
- `lib/auth/attempts.ts`: `PASSWORD_COOKIE`, `PASSWORD_LIMIT`, `readAttempts`, `isLimited`, `bumpAttempts`, `attemptCookieOptions`.
- `lib/auth/assert-owner.ts` `assertOwner(h)`; `lib/auth/require-owner.ts` `requireOwner()` → `{ userId, email }` (throws redirects; never inside try/catch).
- `lib/export/request.ts` `exportHeaders()`, `exportError(h, status, key)`; `lib/export/filename.ts` `contentDisposition(base, 'xlsx' | 'pdf')`, `filenameFromDisposition` (xlsx / pdf only); `lib/export/download.ts` `downloadExport(url, format, fetcher)` (`KNOWN` keys, content-type check, `await res.blob()` not guarded).
- `lib/sync/store.ts` `removeAccountCovers(db, accountId): Promise<number>` (never throws; up to 50 rounds of list 1,000 + remove); `lib/sync/covers.ts` `COVERS_BUCKET = 'covers'`; objects are `{account_id}/{media_id}.jpg`.
- `lib/supabase/admin.ts` `createAdminSupabase()` (server-only); `lib/supabase/server.ts` `createServerSupabase({ responseHeaders })`; `lib/prefs.server.ts` `getPrefs()`; `lib/sync/time.ts` `localDay(date, tz)`; `lib/format.ts` `formatNumber`, `formatCompact`, private `isNum`, `DASH = '—'`, `FormatPrefs`.
- `lib/accounts/supabase-store.ts` `supabaseAccountsStore(db).list()` (throws on error). Account delete path (`app/(app)/accounts/actions.ts` `deleteAccountAction`): admin store `remove` (cascade) then `removeAccountCovers`: the same two halves this plan runs for all accounts.
- `tests/migrations.test.ts`: every SECURITY DEFINER function pins `search_path` (ours does).
- Every table's primary key as in the migrations (Task 4 test reads them).

## Out of scope

A zip download and exporting cover images (Open question 3); CSV; per-account database bytes; a sync pause flag; an audit table; revoking the Instagram grant through Meta; deleting the login / owner / 2FA (account closure); a fresh-TOTP step (Open question 2); exporting `push_subscriptions` or any bookkeeping table; changing the per-account delete on `/accounts`; a `?after=` multi-part export for tables over the 50 s budget.

## Global Constraints

- Ponytail: smallest thing that works. **No new dependency, no new design token, one migration with two functions and no table.** Extract on the second use only (`checkPassword`, `checkClient`).
- TypeScript strict. Every Supabase result read defensively; every call in try/catch EXCEPT `requireOwner()` (throws redirects on purpose).
- **Security (the focus):** the export uses ONLY the owner-session client (`createServerSupabase`), never `createAdminSupabase` (guard test, also through imports). The service role appears in the data files ONLY in `app/(app)/settings/data-actions.ts`, after `requireOwner()` + the phrase + the limit + `checkPassword` (guard test checks the order by text position). `delete_all_data()` is executable by `service_role` only. No `console.*` / logger in any Data & privacy file. No GET route can delete (guard). Errors are keys; no Supabase message, row value or error object reaches a response or a log.
- Every UI string via next-intl; ALL new keys are added by Task 1 in BOTH catalogs (real Simplified Chinese, full-width punctuation), keys only in libs.
- UI standards 5, 6, 10, 11, 16, 17-spirit (destructive = confirmed, typed word, says it cannot be undone), 18 (no SaveBar: one-shot actions). Dates/numbers only via `lib/format.ts`. Responsive at 360 / 768 / 1280, CSS only. Checked in light and dark.
- Tests: Vitest; lib / route / action tests `// @vitest-environment node`; fakes only; never connect to Supabase. Migration files are NEVER applied by an implementer.
- `npm run check` passes after every wave. Commits: conventional, `git add` the listed paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus (opus security review: data exfiltration and destruction)

1. **Token leakage in the export:** the route and `lib/data/export.ts` use the owner session only (RLS; `authenticated` has NO privilege on `account_tokens`: `revoke all … from anon, authenticated`, 20261014000002); `account_tokens` / `push_subscriptions` are not in `EXPORT_TABLES`; no exported table has a secret-looking column in any migration (scan test with a two-entry reviewed allow-list) → Task 4 tests, Task 6 guard (`no service-role client, also not through an imported module`; `the export code never names the token or push tables`).
2. **Data exfiltration:** `assertOwner` first (aal2 when enrolled; `is_owner()` again in RLS); exactly one allow-listed `table` parameter (`findExportTable`: `__proto__`, `toString`, case variants, NUL refused); `private, no-store`, `nosniff`, `attachment` → Task 4 route tests.
3. **Delete without re-auth:** `deleteAllDataAction` order requireOwner → phrase → limit → `checkPassword` (session user id + email, never form values) → admin → `deleteAllData`; `delete_all_data()` not executable by `authenticated` (direct PostgREST call refused) → Task 5 action tests, Task 2 migration test, PGlite run, RUNBOOK §0 `has_function_privilege` query.
4. **CSRF / auto actions:** POST server action only (Origin-checked by Next.js); the dialog has no `useEffect` / `requestSubmit` / `fetch` (guard); no route handler imports the delete code (guard); the export GET performs no write method (guard).
5. **Partial delete:** one SQL transaction (PGlite: injected failure → full rollback); covers by bucket listing (folders of already-deleted accounts too); `coversDone` reported; idempotent second run (PGlite: zeros) → Task 5 `deleteAllData` tests.
6. **Cross-owner:** single-owner app; `data_usage()` returns no rows unless `is_owner()` (PGlite: other user 0 rows, aal1-with-factor 0 rows); export under RLS; delete is global by design but reachable only by the owner after the password.
7. **DoS by export:** owner-only; one table per request; ≤ 50 s budget then the stream errors; ≈ one page in memory; "Download all" is sequential; page sizes 1,000 / 100 / 5.
8. **Timing:** password check timing is the same as 16b's change password (owner-only, behind aal2); the phrase is compared before the password check (no oracle: the phrase is public).
9. **Session during a stream:** no refresh mid-stream (token fresh at start, ≤ 50 s); a cookie set after the headers would be lost → see Decisions.
10. **Third-party data:** excluded from "Download all" by default (Task 6 component test: 18 of 20 files without the box, 20 with it); never logged; the section renders no third-party text.
11. **SECURITY DEFINER hygiene:** `search_path = ''`, qualified names, owner check before the first query, literal table list, no `execute`/`format` (migration test).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1, 6 | Task 1: `settings.data.{privacy, usage.*, export.*, tables.*, deleteAll.*}`; Task 6 removes the placeholder `settings.data.soon` |
| `supabase/migrations/20261031000001_data_privacy.sql` (new), `tests/data-privacy-migration.test.ts` (new) | 2 | `data_usage()`, `delete_all_data()`, grants |
| `lib/format.ts`, `tests/format-bytes.test.ts` (new), `lib/auth/check-client.ts` (new), `lib/auth/password.ts`, `app/(app)/settings/security-actions.ts`, `tests/auth-security-guard.test.ts`, `tests/check-password.test.ts` (new) | 3 | `formatBytes`; `checkPassword` and the memory-only check client shared by change password and delete all |
| `lib/data/usage.ts` (new), `lib/data/export.ts` (new), `app/api/export/data/route.ts` (new), `lib/export/download.ts`, `lib/export/filename.ts`, `tests/data-usage.test.ts` (new), `tests/data-export.test.ts` (new), `tests/data-export-route.test.ts` (new), `tests/data-download.test.ts` (new), `tests/comments-privacy.test.ts`, `tests/followers-privacy.test.ts`, `tests/moderation-privacy.test.ts` | 4 | usage summary, export registry, keyset pages, JSON stream, the route, JSON downloads; the three privacy guards admit the owner export |
| `lib/data/delete.ts` (new), `tests/data-delete.test.ts` (new), `app/(app)/settings/data-actions.ts` (new), `tests/data-actions.test.ts` (new) | 5 | delete library and the server action |
| `components/settings/DataExport.tsx` (new), `components/settings/DeleteAllData.tsx` (new), `components/settings/sections/DataSection.tsx` (replaced), `tests/settings-data.test.tsx` (new), `tests/data-privacy-guard.test.ts` (new) | 6 | the section UI and the guard |
| `docs/RUNBOOK_DATA.md` (new), `docs/RUNBOOK_SETTINGS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/OWNER_ACTIONS.md` | 7 | runbook and docs |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line with the block shown), never by re-serialising the JSON. Keep every other line byte-identical; both locales get the same keys.

**Editing existing files** (`lib/format.ts`, `lib/export/download.ts`, `lib/export/filename.ts`, `lib/auth/password.ts`, `app/(app)/settings/security-actions.ts`, `tests/auth-security-guard.test.ts`, `tests/comments-privacy.test.ts`, `tests/followers-privacy.test.ts`, `tests/moderation-privacy.test.ts`, `components/settings/sections/DataSection.tsx`): exact old → new text for the Edit tool, or a whole-file replacement where stated. The working copies are CRLF; the Edit tool matches either; do not convert line endings.

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261031000001_data_privacy.sql`, `tests/data-privacy-migration.test.ts` | 1, 3 |
| 3 shared helpers | — | `lib/format.ts`, `tests/format-bytes.test.ts`, `lib/auth/check-client.ts`, `lib/auth/password.ts`, `app/(app)/settings/security-actions.ts`, `tests/auth-security-guard.test.ts`, `tests/check-password.test.ts` | 1, 2 |
| 4 usage + export | — | `lib/data/usage.ts`, `tests/data-usage.test.ts`, `lib/data/export.ts`, `app/api/export/data/route.ts`, `lib/export/download.ts`, `lib/export/filename.ts`, `tests/data-export.test.ts`, `tests/data-export-route.test.ts`, `tests/data-download.test.ts`, `tests/comments-privacy.test.ts`, `tests/followers-privacy.test.ts`, `tests/moderation-privacy.test.ts` | 5 |
| 5 delete | 3 | `lib/data/delete.ts`, `tests/data-delete.test.ts`, `app/(app)/settings/data-actions.ts`, `tests/data-actions.test.ts` | 4 |
| 6 section UI + guard | 1, 3, 4, 5 | `components/settings/DataExport.tsx`, `components/settings/DeleteAllData.tsx`, `components/settings/sections/DataSection.tsx`, `tests/settings-data.test.tsx`, `tests/data-privacy-guard.test.ts`, `messages/en.json` + `messages/zh-CN.json` (removes `settings.data.soon`) | 7 |
| 7 docs | 2 | `docs/RUNBOOK_DATA.md`, `docs/RUNBOOK_SETTINGS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/OWNER_ACTIONS.md` | 6 |

**Waves (at most 3 sonnet worktree agents at a time; check free disk space first, `Get-PSDrive C`):** 1 = Tasks 1, 2, 3 → 2 = Tasks 4, 5 → 3 = Tasks 6, 7. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log` and READ it (implementer rules, orchestrator checklist). Every wave leaves `main` green: wave 1 adds unused keys (allowed), an unapplied migration and the `checkPassword` extraction (behaviour unchanged); wave 2 adds the route (reachable, owner-only, works without the migration) and an action no page imports yet; wave 3 wires the section. Then: an opus read-only security review with the Review Focus above, ONE fix wave, check, commit (orchestrator).

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

- [ ] **Step 1 — en.** Edit `messages/en.json`: replace the exact line (inside `settings.data`, line 379; the next line `    },` closes `settings.data` and stays)

```json
      "soon": "Export and delete-everything tools are coming."
```

with the same line plus a comma, followed by the new keys (the placeholder line stays until Task 6 replaces the section that reads it, so `main` renders correctly after every wave):

```json
      "soon": "Export and delete-everything tools are coming.",
      "privacy": "Access tokens, passwords and device keys are never shown, exported or logged.",
      "usage": {
        "title": "Storage used",
        "hint": "How much space your data takes in the database and in private file storage.",
        "database": "Database in total",
        "databaseHint": "Includes indexes and the database's own tables. Row counts are estimates.",
        "group": "Data",
        "rows": "Rows",
        "size": "Size",
        "groups": {
          "insights": "Insights and audience",
          "posts": "Posts, Stories and their numbers",
          "comments": "Comments and moderation",
          "followers": "Follower exports you uploaded",
          "other": "Accounts, tags, saved views and settings"
        },
        "covers": "Cover images",
        "images": "{count, plural, one {# image} other {# images}}",
        "unlinked": "Not linked to an account",
        "noCovers": "No cover images are stored.",
        "needsUpdate": "Storage figures need a database update."
      },
      "export": {
        "title": "Export your data",
        "hint": "Download what in2sight stores as JSON files, one file per table.",
        "others": "Include other people's data (commenter names and comment texts, follower lists you uploaded)",
        "othersHint": "This is personal data of other people. Keep these files private and delete them when you no longer need them.",
        "all": "Download all files",
        "browserHint": "Your browser may ask once to allow several downloads.",
        "progress": "Downloading file {done} of {total}…",
        "done": "{count, plural, one {# file downloaded.} other {# files downloaded.}}",
        "single": "Single files",
        "download": "Download",
        "thirdParty": "Other people's data"
      },
      "tables": {
        "accounts": "Accounts",
        "account_daily": "Daily account insights",
        "account_daily_breakdown": "Daily reach and views by follower type and format",
        "audience_snapshots": "Audience snapshots",
        "online_followers": "Followers online by hour",
        "follower_snapshots": "Follower counts over time",
        "api_snapshots": "Raw insight answers from Instagram",
        "media": "Posts and Stories",
        "media_metrics": "Post and Story numbers over time",
        "media_children": "Carousel slides",
        "tags": "Tags",
        "media_tags": "Tags on posts",
        "explorer_views": "Saved Explorer views",
        "notifications": "Notifications",
        "moderation_settings": "Moderation settings",
        "moderation_rules": "Moderation rules",
        "moderation_log": "Moderation log",
        "profiles": "Preferences",
        "comments": "Comments",
        "follower_exports": "Follower exports"
      },
      "deleteAll": {
        "title": "Delete all data",
        "hint": "Removes every connected account and everything synced or uploaded for it. This cannot be undone.",
        "removes": "Deleted: the accounts and their Instagram access, insights, posts, Stories, cover images, comments, follower exports, moderation rules and log, tags, saved views, notifications and the sync history.",
        "keeps": "Kept: your sign-in, two-step verification, preferences, alert rules and push notifications on your devices.",
        "instagram": "in2sight stays listed in your Instagram settings until you remove it there (Apps and websites).",
        "open": "Delete all data…",
        "dialogTitle": "Delete all data permanently?",
        "dialogBody": "Every account and all of its data are deleted at once. Export first if you want a copy.",
        "password": "Your password",
        "phrase": "Type {phrase} to confirm",
        "confirm": "Delete everything",
        "cancel": "Cancel",
        "done": "{count, plural, =0 {There was nothing left to delete.} one {All data of # account was deleted.} other {All data of # accounts was deleted.}}",
        "coversLeft": "Some cover images could not be removed yet. Run Delete all data again in a minute.",
        "errors": {
          "phrase": "Type the word exactly as shown.",
          "missing_password": "Enter your password.",
          "wrong_password": "The password is wrong.",
          "rate_limited": "Too many attempts. Wait a few minutes and try again.",
          "needs_update": "This needs a database update first. Nothing was deleted.",
          "unexpected": "Something went wrong. Try again: running it again is safe."
        }
      }
```

- [ ] **Step 2 — zh-CN.** Edit `messages/zh-CN.json`: replace the exact line

```json
      "soon": "导出和全部删除工具即将推出。"
```

with:

```json
      "soon": "导出和全部删除工具即将推出。",
      "privacy": "访问令牌、密码和设备密钥永远不会被显示、导出或写入日志。",
      "usage": {
        "title": "已用存储空间",
        "hint": "你的数据在数据库和私有文件存储中占用了多少空间。",
        "database": "数据库总计",
        "databaseHint": "包括索引和数据库自身的表。行数为估算值。",
        "group": "数据",
        "rows": "行数",
        "size": "大小",
        "groups": {
          "insights": "洞察与受众",
          "posts": "帖子、快拍及其数据",
          "comments": "评论与审核",
          "followers": "你上传的粉丝导出文件",
          "other": "账号、标签、已保存视图和设置"
        },
        "covers": "封面图片",
        "images": "{count, plural, other {# 张图片}}",
        "unlinked": "未关联任何账号",
        "noCovers": "没有存储封面图片。",
        "needsUpdate": "存储数据需要先更新数据库。"
      },
      "export": {
        "title": "导出你的数据",
        "hint": "将 in2sight 存储的数据下载为 JSON 文件，每个表一个文件。",
        "others": "包含他人的数据（评论者名称和评论内容、你上传的粉丝名单）",
        "othersHint": "这些是他人的个人数据。请妥善保管这些文件，不再需要时请删除。",
        "all": "下载全部文件",
        "browserHint": "浏览器可能会询问一次是否允许下载多个文件。",
        "progress": "正在下载第 {done} 个文件，共 {total} 个…",
        "done": "{count, plural, other {已下载 # 个文件。}}",
        "single": "单个文件",
        "download": "下载",
        "thirdParty": "他人的数据"
      },
      "tables": {
        "accounts": "账号",
        "account_daily": "每日账号洞察",
        "account_daily_breakdown": "按粉丝类型和形式划分的每日覆盖与浏览",
        "audience_snapshots": "受众快照",
        "online_followers": "按小时统计的在线粉丝",
        "follower_snapshots": "粉丝数随时间变化",
        "api_snapshots": "Instagram 返回的原始洞察数据",
        "media": "帖子和快拍",
        "media_metrics": "帖子和快拍数据随时间变化",
        "media_children": "轮播图片",
        "tags": "标签",
        "media_tags": "帖子上的标签",
        "explorer_views": "已保存的探索视图",
        "notifications": "通知",
        "moderation_settings": "审核设置",
        "moderation_rules": "审核规则",
        "moderation_log": "审核日志",
        "profiles": "偏好设置",
        "comments": "评论",
        "follower_exports": "粉丝导出文件"
      },
      "deleteAll": {
        "title": "删除全部数据",
        "hint": "删除所有已连接的账号，以及为它们同步或上传的全部内容。此操作无法撤销。",
        "removes": "将删除：账号及其 Instagram 访问权限、洞察、帖子、快拍、封面图片、评论、粉丝导出文件、审核规则和日志、标签、已保存视图、通知以及同步记录。",
        "keeps": "将保留：你的登录信息、两步验证、偏好设置、提醒规则以及设备上的推送通知。",
        "instagram": "在你于 Instagram 设置中移除之前，in2sight 仍会显示在其中（应用和网站）。",
        "open": "删除全部数据…",
        "dialogTitle": "永久删除全部数据？",
        "dialogBody": "所有账号及其全部数据将被一次性删除。如需保留副本，请先导出。",
        "password": "你的密码",
        "phrase": "输入 {phrase} 以确认",
        "confirm": "全部删除",
        "cancel": "取消",
        "done": "{count, plural, =0 {没有可删除的数据。} other {已删除 # 个账号的全部数据。}}",
        "coversLeft": "部分封面图片暂时无法删除。请一分钟后再次运行“删除全部数据”。",
        "errors": {
          "phrase": "请完全按照所示输入该词。",
          "missing_password": "请输入你的密码。",
          "wrong_password": "密码错误。",
          "rate_limited": "尝试次数过多，请等待几分钟后再试。",
          "needs_update": "需要先更新数据库。没有删除任何数据。",
          "unexpected": "出了点问题。请重试：再次运行是安全的。"
        }
      }
```

- [ ] **Verify:** `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` → no error; `npx vitest run tests/messages.test.ts` → pass.
- [ ] **Commit:** `git add messages/en.json messages/zh-CN.json`, `git commit -m "feat(i18n): data and privacy keys (storage, export, delete all)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 2: the migration (two functions, no table)

**Files:** Create `supabase/migrations/20261031000001_data_privacy.sql`, `tests/data-privacy-migration.test.ts`. **Never apply it** (no `supabase`, `psql`, `db push`).

- [ ] **Step 1 — the failing test.** Write `tests/data-privacy-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261031000001_data_privacy.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const fn = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';

describe('data & privacy migration', () => {
  it('two functions and their grants, nothing else: no table, no policy change, no drop', () => {
    const heads = sql
      .replace(/\$\$[\s\S]*?\$\$/g, '$$body$$') // function bodies hold their own semicolons
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create or', 'revoke execute', 'grant execute', 'create or', 'revoke execute', 'grant execute']);
    expect(sql).not.toMatch(/\b(drop|truncate|alter|create\s+table|create\s+policy)\b/i);
  });

  it('data_usage: security definer with an empty search_path, owner check first, read-only, no dynamic SQL', () => {
    const f = fn('data_usage');
    expect(f).toMatch(exact('returns table (kind text, label text, row_count bigint, bytes bigint)'));
    expect(f).toMatch(/\bstable\b/i);
    expect(f).toMatch(exact('security definer'));
    expect(f).toMatch(exact("set search_path = ''"));
    expect(f.indexOf('if not public.is_owner() then')).toBeGreaterThan(-1);
    expect(f.indexOf('if not public.is_owner() then')).toBeLessThan(f.indexOf('return query'));
    expect(f).not.toMatch(/\b(execute|format)\s*\(|\bexecute\s+'|\b(insert|update|delete)\b/i);
    expect(f).toMatch(/pg_catalog\.pg_total_relation_size\(c\.oid\)/);
    expect(f).toMatch(/c\.reltuples/); // an estimate, never count(*) over a table
    expect(f).not.toMatch(/account_tokens/);
    expect(f).toMatch(exact("where o.bucket_id = 'covers'"));
  });

  it('data_usage lists every owner-data table by name (and exactly these)', () => {
    const list = fn('data_usage').match(/array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? '';
    const names = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual(
      [
        'accounts', 'account_daily', 'account_daily_breakdown', 'audience_snapshots', 'online_followers', 'follower_snapshots', 'api_snapshots', 'media', 'media_metrics', 'media_children',
        'comments', 'moderation_settings', 'moderation_rules', 'moderation_log', 'follower_exports', 'tags', 'media_tags', 'explorer_views', 'notifications', 'push_subscriptions',
        'profiles', 'sync_state', 'sync_progress', 'sync_runs',
      ].sort(),
    );
  });

  it('data_usage: anon and public cannot execute it, the owner session can', () => {
    expect(sql).toMatch(exact('revoke execute on function public.data_usage() from public, anon'));
    expect(sql).toMatch(exact('grant execute on function public.data_usage() to authenticated'));
  });

  it('delete_all_data: security invoker, executable by service_role ONLY (the browser session cannot call it)', () => {
    const f = fn('delete_all_data');
    expect(f).toMatch(exact('security invoker'));
    expect(f).toMatch(exact("set search_path = ''"));
    expect(sql).toMatch(exact('revoke execute on function public.delete_all_data() from public, anon, authenticated'));
    expect(sql).toMatch(exact('grant execute on function public.delete_all_data() to service_role'));
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.delete_all_data\(\)\s+to\s+(authenticated|anon|public)/i);
  });

  it('delete_all_data deletes accounts (cascade) and the account-less owner rows, each with an explicit where (pg-safeupdate), and keeps the login', () => {
    const f = fn('delete_all_data');
    const deletes = [...f.matchAll(/delete from public\.(\w+) where true;/g)].map((m) => m[1]);
    expect(deletes).toEqual(['accounts', 'tags', 'explorer_views', 'notifications', 'sync_runs']);
    expect(f.match(/\bdelete\b/gi)).toHaveLength(deletes.length);
    expect(f).not.toMatch(/profiles|owners|push_subscriptions|auth\.|storage\./);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/data-privacy-migration.test.ts` → FAILS (ENOENT: the migration does not exist).
- [ ] **Step 3 — the migration.** Write `supabase/migrations/20261031000001_data_privacy.sql` (use the Write tool):

```sql
-- Plan 16c: Settings -> Data & privacy. Two functions, no table, no change to any existing object.
--
-- 1. data_usage(): what the owner's data occupies, for the "Storage used" card. SECURITY DEFINER because the cover
--    objects (storage.objects, bucket "covers") have no storage policy at all: only a privileged role can see their sizes.
--    It returns nothing unless public.is_owner() (owner + aal2 once 2FA is on). Read-only; no dynamic SQL: the table
--    list is a literal array, sizes come from pg_class / pg_total_relation_size, row counts are the planner's estimate
--    (reltuples; -1 = never analysed -> NULL), never count(*). account_tokens is NOT in the list.
create or replace function public.data_usage()
returns table (kind text, label text, row_count bigint, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    return;
  end if;
  return query
    select 'table'::text, c.relname::text,
           case when c.reltuples < 0 then null else c.reltuples::bigint end,
           pg_catalog.pg_total_relation_size(c.oid)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname = any (array[
         'accounts', 'account_daily', 'account_daily_breakdown', 'audience_snapshots', 'online_followers',
         'follower_snapshots', 'api_snapshots', 'media', 'media_metrics', 'media_children', 'comments',
         'moderation_settings', 'moderation_rules', 'moderation_log', 'follower_exports', 'tags', 'media_tags',
         'explorer_views', 'notifications', 'push_subscriptions', 'profiles', 'sync_state', 'sync_progress', 'sync_runs'
       ]::text[]);
  return query
    select 'covers'::text, pg_catalog.split_part(o.name, '/', 1), count(*)::bigint,
           coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
      from storage.objects o
     where o.bucket_id = 'covers'
     group by 2;
  return query
    select 'database'::text, null::text, null::bigint, pg_catalog.pg_database_size(pg_catalog.current_database());
end;
$$;
revoke execute on function public.data_usage() from public, anon;
grant execute on function public.data_usage() to authenticated;

-- 2. delete_all_data(): "Delete all data permanently" (SPEC §7c), the database half, in ONE transaction (all or
--    nothing). security invoker and executable by service_role ONLY: the owner browser session cannot call it through
--    PostgREST, so the server action's password re-check (lib/data/delete.ts, after requireOwner()) is the only way in.
--    Deleting the accounts cascades to account_tokens and every synced or owner-authored per-account row (media,
--    metrics, children, media_tags, comments, follower_exports, moderation_*, snapshots, sync_state, sync_progress,
--    notifications of the account). Then the owner-authored rows without an account: tags, saved views, the remaining
--    notifications, the sync run log. Kept: the login (auth.users, owners, 2FA), profiles (preferences, alert rules)
--    and push_subscriptions (this device's notifications). `where true` because PostgREST sessions load pg-safeupdate,
--    which refuses a DELETE without a WHERE clause. Idempotent: a second call deletes nothing and returns zeros.
--    Cover images (Storage) cannot be deleted in SQL: lib/data/delete.ts removes them with the Storage API afterwards.
create or replace function public.delete_all_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n_accounts bigint;
  n_tags bigint;
  n_views bigint;
begin
  delete from public.accounts where true;
  get diagnostics n_accounts = row_count;
  delete from public.tags where true;
  get diagnostics n_tags = row_count;
  delete from public.explorer_views where true;
  get diagnostics n_views = row_count;
  delete from public.notifications where true;
  delete from public.sync_runs where true;
  return pg_catalog.jsonb_build_object('accounts', n_accounts, 'tags', n_tags, 'views', n_views);
end;
$$;
revoke execute on function public.delete_all_data() from public, anon, authenticated;
grant execute on function public.delete_all_data() to service_role;
```

- [ ] **Verify:** `npx vitest run tests/data-privacy-migration.test.ts tests/migrations.test.ts` → pass.
- [ ] **Commit:** `git add supabase/migrations/20261031000001_data_privacy.sql tests/data-privacy-migration.test.ts`, `git commit -m "feat(db): data_usage and delete_all_data functions (not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 3: shared helpers: `formatBytes` and the password check (second use)

**Files:** Modify `lib/format.ts`, `lib/auth/password.ts`, `app/(app)/settings/security-actions.ts`, `tests/auth-security-guard.test.ts`. Create `tests/format-bytes.test.ts`, `lib/auth/check-client.ts`, `tests/check-password.test.ts`.

- [ ] **Step 1 — failing tests.** Write `tests/format-bytes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatBytes, type FormatPrefs } from '@/lib/format';

const en: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
const eu: FormatPrefs = { ...en, numberFormat: '1.234,5' };

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1,023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [1024 * 1024 - 1, '1 MB'], // 1,023.999 KB never shows as "1,024 KB"
    [230 * 1024 * 1024, '230 MB'],
    [1.25 * 1024 ** 3, '1.3 GB'],
  ])('%d -> %s', (n, out) => {
    expect(formatBytes(n, en)).toBe(out);
  });

  it('uses the owner’s number format', () => {
    expect(formatBytes(1536, eu)).toBe('1,5 KB');
  });

  it('unknown or negative is a dash, never 0', () => {
    for (const v of [null, undefined, Number.NaN, -1]) expect(formatBytes(v, en)).toBe('—');
  });
});
```

and `tests/check-password.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkPassword } from '@/lib/auth/password';

function client(o: { error?: { status?: number; code?: string } | null; userId?: string; throws?: boolean } = {}) {
  const calls: string[] = [];
  const c = {
    auth: {
      signInWithPassword: vi.fn(async () => {
        calls.push('signIn');
        if (o.throws) throw new Error('network');
        return o.error ? { data: { user: null }, error: o.error } : { data: { user: { id: o.userId ?? 'owner-1' } }, error: null };
      }),
      signOut: vi.fn(async (a: { scope: string }) => (calls.push(`signOut:${a.scope}`), { error: null })),
    },
  };
  return { c, calls };
}
const input = { userId: 'owner-1', email: 'owner@example.com', password: 'the owner password' };

describe('checkPassword', () => {
  it('ok: signs in on the separate client, then revokes that session locally', async () => {
    const { c, calls } = client();
    expect(await checkPassword(() => c as never, input)).toBe('ok');
    expect(c.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.com', password: 'the owner password' });
    expect(calls).toEqual(['signIn', 'signOut:local']);
  });

  it('wrong password, rate limit, another user, no email, a throw', async () => {
    expect(await checkPassword(() => client({ error: { status: 400, code: 'invalid_credentials' } }).c as never, input)).toBe('wrong_password');
    expect(await checkPassword(() => client({ error: { status: 429 } }).c as never, input)).toBe('rate_limited');
    const other = client({ userId: 'someone-else' });
    expect(await checkPassword(() => other.c as never, input)).toBe('unexpected');
    expect(other.calls).toEqual(['signIn', 'signOut:local']); // revoked even then
    const none = client();
    expect(await checkPassword(() => none.c as never, { ...input, email: null })).toBe('unexpected');
    expect(none.calls).toEqual([]);
    expect(await checkPassword(() => client({ throws: true }).c as never, input)).toBe('unexpected');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/format-bytes.test.ts tests/check-password.test.ts` → FAIL (`formatBytes` and `checkPassword` are not exported).
- [ ] **Step 3 — `lib/format.ts`.** Edit: replace the exact line

```ts
export function formatPercent(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
```

with:

```ts
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size in bytes: "512 B", "1.5 KB", "230 MB" (1 KB = 1,024 bytes), the number in the owner's number format. */
export function formatBytes(n: number | null | undefined, p: FormatPrefs): string {
  if (!isNum(n) || n < 0) return DASH;
  let i = 0;
  let v = n;
  while (i < BYTE_UNITS.length - 1 && v >= 1024) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  // 1,023.96 KB rounds to "1,024 KB": roll over to "1 MB"
  if (i < BYTE_UNITS.length - 1 && Number(v.toFixed(digits)) >= 1024) return `${formatNumber(1, p, { maximumFractionDigits: 0 })} ${BYTE_UNITS[i + 1]}`;
  return `${formatNumber(v, p, { maximumFractionDigits: digits })} ${BYTE_UNITS[i]}`;
}

export function formatPercent(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
```

- [ ] **Step 4 — `lib/auth/check-client.ts`** (new; the helper moves here because a `'use server'` file may only export async actions, and "Delete all data" needs it too):

```ts
import { createClient } from '@supabase/supabase-js';
import { getSupabasePublic } from '@/lib/env';

/**
 * A memory-only client for re-checking the owner's password (change password, delete all data): no cookies, no
 * refresh, nothing written to the browser, never the owner's session. Callers sign it out at once (checkPassword).
 */
export function checkClient() {
  const { url, publishableKey } = getSupabasePublic();
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
```

- [ ] **Step 5 — `app/(app)/settings/security-actions.ts`.** Remove the line `import { createClient } from '@supabase/supabase-js';`; replace `import { changePassword } from '@/lib/auth/password';` with the two lines `import { checkClient } from '@/lib/auth/check-client';` and `import { changePassword } from '@/lib/auth/password';`; remove the line `import { getSupabasePublic } from '@/lib/env';`; remove this block and the blank line after it:

```ts
// A memory-only client for the current-password check: no cookies, no refresh, never the owner's session.
function checkClient() {
  const { url, publishableKey } = getSupabasePublic();
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
```

  Nothing else changes (`changePassword(await createServerSupabase(), checkClient, …)` now uses the imported function).
- [ ] **Step 6 — `lib/auth/password.ts`: extract `checkPassword`.** Replace the whole block from the line `/**` that starts ` * Proves the CURRENT password on a separate, memory-only client` down to, NOT including, the `/**` that starts ` * The reset page's save` (the doc comment and the whole `changePassword` function) with:

```ts
export type CheckResult = 'ok' | 'wrong_password' | 'rate_limited' | 'unexpected';

/**
 * Proves `password` is the owner's on a separate, memory-only client (`checkClient()`: never the cookie session) and
 * revokes that check session at once. Never throws. Used by change password and by "Delete all data" (Plan 16c).
 */
export async function checkPassword(checkClient: () => SupabaseClient, input: { userId: string; email: string | null; password: string }): Promise<CheckResult> {
  if (!input.email) return 'unexpected';
  try {
    const check = checkClient();
    const { data, error } = await check.auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) return isRateLimited(error) ? 'rate_limited' : 'wrong_password';
    const sameUser = data?.user?.id === input.userId;
    await quietSignOut(check, 'local'); // the check session must not linger
    return sameUser ? 'ok' : 'unexpected';
  } catch {
    return 'unexpected';
  }
}

/**
 * Proves the CURRENT password (checkPassword), then updates the owner session's password and signs every OTHER
 * session out (`others` revokes the check session again).
 */
export async function changePassword(session: SupabaseClient, checkClient: () => SupabaseClient, input: ChangeInput): Promise<PasswordResult> {
  if (!input.current) return { ok: false, error: 'missing_fields' };
  const invalid = validate(input.next, input.confirm, input.email);
  if (invalid) return { ok: false, error: invalid };
  if (input.next === input.current) return { ok: false, error: 'same_password' };
  const checked = await checkPassword(checkClient, { userId: input.userId, email: input.email, password: input.current });
  if (checked !== 'ok') return { ok: false, error: checked };
  try {
    const { error: updateErr } = await session.auth.updateUser({ password: input.next });
    if (updateErr) return { ok: false, error: updateError(updateErr) };
    return { ok: true, othersSignedOut: await quietSignOut(session, 'others') };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

```

  `changePassword` behaves exactly as before (call order `check.signIn → check.signOut:local → updateUser → signOut:others`, same error keys): `tests/password-change.test.ts` and `tests/security-actions.test.ts` must pass UNTOUCHED.
- [ ] **Step 7 — `tests/auth-security-guard.test.ts`** (the 16b guard follows the move). Three edits: in `NAMED`, after `  'lib/auth/password.ts',` add the line `  'lib/auth/check-client.ts',`; replace

```ts
  it('createClient (the memory-only check client) appears in the security actions only', () => {
    for (const f of FILES.filter((x) => x !== 'app/(app)/settings/security-actions.ts')) {
```

with

```ts
  it('createClient (the memory-only check client) appears in lib/auth/check-client.ts only', () => {
    for (const f of FILES.filter((x) => x !== 'lib/auth/check-client.ts')) {
```

and replace `    expect(src('app/(app)/settings/security-actions.ts')).toMatch(/persistSession: false, autoRefreshToken: false, detectSessionInUrl: false/);` with `    expect(src('lib/auth/check-client.ts')).toMatch(/persistSession: false, autoRefreshToken: false, detectSessionInUrl: false/);`.
- [ ] **Verify:** `npx vitest run tests/format-bytes.test.ts tests/format.test.ts tests/check-password.test.ts tests/password-change.test.ts tests/security-actions.test.ts tests/auth-security-guard.test.ts tests/settings-security.test.tsx` → pass; `npx tsc --noEmit`; `npx eslint lib/format.ts lib/auth/check-client.ts lib/auth/password.ts "app/(app)/settings/security-actions.ts" tests/format-bytes.test.ts tests/check-password.test.ts tests/auth-security-guard.test.ts`.
- [ ] **Commit:** `git add lib/format.ts tests/format-bytes.test.ts lib/auth/check-client.ts lib/auth/password.ts "app/(app)/settings/security-actions.ts" tests/auth-security-guard.test.ts tests/check-password.test.ts`, `git commit -m "refactor(auth): checkPassword and the check client shared; formatBytes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 4: storage usage, export library, the route, JSON downloads, the privacy guards

**Files:** Create `lib/data/usage.ts`, `tests/data-usage.test.ts`, `lib/data/export.ts`, `app/api/export/data/route.ts`, `tests/data-export.test.ts`, `tests/data-export-route.test.ts`, `tests/data-download.test.ts`. Modify `lib/export/download.ts`, `lib/export/filename.ts`, `tests/comments-privacy.test.ts`, `tests/followers-privacy.test.ts`, `tests/moderation-privacy.test.ts`.

- [ ] **Step 1 — failing tests.** Write `tests/data-usage.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readUsage, summariseUsage, USAGE_GROUPS } from '@/lib/data/usage';

const A = '11111111-1111-1111-1111-111111111111';

describe('summariseUsage', () => {
  it('folds tables into groups (unknown tables go to "other"), covers per folder, the database total', () => {
    const u = summariseUsage([
      { kind: 'table', label: 'media', row_count: 10, bytes: 1000 },
      { kind: 'table', label: 'media_metrics', row_count: '90', bytes: '9000' },
      { kind: 'table', label: 'comments', row_count: 5, bytes: 500 },
      { kind: 'table', label: 'follower_exports', row_count: 2, bytes: 2_000_000 },
      { kind: 'table', label: 'tags', row_count: 3, bytes: 300 },
      { kind: 'table', label: 'something_new', row_count: 1, bytes: 100 },
      { kind: 'covers', label: A, row_count: 4, bytes: 4096 },
      { kind: 'covers', label: 'b', row_count: 1, bytes: 9000 },
      { kind: 'database', label: null, row_count: null, bytes: '12345678' },
    ]);
    expect(u.groups.map((g) => g.id)).toEqual([...USAGE_GROUPS]);
    expect(u.groups.find((g) => g.id === 'posts')).toEqual({ id: 'posts', rows: 100, bytes: 10_000 });
    expect(u.groups.find((g) => g.id === 'comments')).toEqual({ id: 'comments', rows: 5, bytes: 500 });
    expect(u.groups.find((g) => g.id === 'followers')).toEqual({ id: 'followers', rows: 2, bytes: 2_000_000 });
    expect(u.groups.find((g) => g.id === 'other')).toEqual({ id: 'other', rows: 4, bytes: 400 });
    expect(u.groups.find((g) => g.id === 'insights')).toEqual({ id: 'insights', rows: 0, bytes: 0 });
    expect(u.covers).toEqual([
      { folder: 'b', files: 1, bytes: 9000 },
      { folder: A, files: 4, bytes: 4096 },
    ]);
    expect(u.database).toBe(12_345_678);
  });

  it('a table never analysed (null estimate) makes its group’s row count unknown, never 0', () => {
    const u = summariseUsage([
      { kind: 'table', label: 'media', row_count: null, bytes: 100 },
      { kind: 'table', label: 'media_metrics', row_count: 5, bytes: 100 },
    ]);
    expect(u.groups.find((g) => g.id === 'posts')).toEqual({ id: 'posts', rows: null, bytes: 200 });
    expect(u.database).toBeNull();
  });
});

describe('readUsage', () => {
  it('calls the data_usage function on the given (owner) client', async () => {
    const calls: string[] = [];
    const db = { rpc: async (fn: string) => (calls.push(fn), { data: [{ kind: 'database', label: null, row_count: null, bytes: 1 }], error: null }) };
    expect((await readUsage(db as never))?.database).toBe(1);
    expect(calls).toEqual(['data_usage']);
  });

  it('null when the migration is missing, the call fails or throws', async () => {
    expect(await readUsage({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) } as never)).toBeNull();
    expect(await readUsage({ rpc: async () => ({ data: 'x', error: null }) } as never)).toBeNull();
    expect(
      await readUsage({
        rpc: async () => {
          throw new Error('down');
        },
      } as never),
    ).toBeNull();
  });
});
```

`tests/data-export.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterFilter, EXPORT_TABLES, exportPages, findExportTable, jsonArrayStream, PAGE_ROWS, quoteValue, type Row } from '@/lib/data/export';

/** A fake owner-session client: answers the queued pages in order and records every query it was asked. */
function fakeDb(pages: (Row[] | { error: true })[]) {
  const calls: { table: string; select: string; order: string[]; or: string | null; limit: number }[] = [];
  const db = {
    from(table: string) {
      const call = { table, select: '', order: [] as string[], or: null as string | null, limit: 0 };
      calls.push(call);
      const q = {
        select(s: string) {
          call.select = s;
          return q;
        },
        order(k: string, o: { ascending: boolean }) {
          call.order.push(`${k}:${o.ascending ? 'asc' : 'desc'}`);
          return q;
        },
        or(f: string) {
          call.or = f;
          return q;
        },
        async limit(n: number) {
          call.limit = n;
          const next = pages.shift() ?? [];
          return 'error' in next ? { data: null, error: { message: 'secret value 123' } } : { data: next, error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const collect = async (it: AsyncIterable<Row[]>) => {
  const out: Row[][] = [];
  for await (const p of it) out.push(p);
  return out;
};

describe('export registry', () => {
  it('never lists the token, push or bookkeeping tables', () => {
    const names = EXPORT_TABLES.map((t) => t.name);
    for (const n of ['account_tokens', 'push_subscriptions', 'owners', 'sync_state', 'sync_progress', 'sync_runs']) expect(names).not.toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks exactly the tables with other people’s personal data', () => {
    expect(EXPORT_TABLES.filter((t) => 'thirdParty' in t && t.thirdParty).map((t) => t.name)).toEqual(['comments', 'follower_exports']);
  });

  it('each table’s keys are its primary key as written in the migrations', () => {
    const sql = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .sort()
      .map((f) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8'))
      .join('\n');
    for (const t of EXPORT_TABLES) {
      const body = sql.match(new RegExp(`create table public\\.${t.name} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
      expect(body, t.name).not.toBe('');
      const composite = body.match(/primary key \(([^)]+)\)/)?.[1];
      const pk = composite ? composite.split(',').map((s) => s.trim()) : [body.match(/^\s*(\w+)\s[^\n]*primary key/m)?.[1]];
      expect(t.keys, t.name).toEqual(pk);
    }
  });

  it('no exported table has a secret-looking column in any migration', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const sql = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, ''))
      .join('\n');
    // reviewed by hand: an expiry date, and an API path (+ sorted query, never the token: lib/sync/store.ts)
    const ALLOWED = new Set(['accounts.token_expires_at', 'api_snapshots.endpoint']);
    let seen = 0;
    for (const t of EXPORT_TABLES) {
      const created = [...(sql.match(new RegExp(`create table public\\.${t.name} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '').matchAll(/^\s*(\w+)\s/gm)].map((m) => m[1]);
      const added = [...sql.matchAll(/alter table public\.(\w+)([^;]*);/g)].filter((m) => m[1] === t.name).flatMap((m) => [...m[2].matchAll(/add column (\w+)/g)].map((a) => a[1]));
      for (const c of [...created, ...added]) {
        seen++;
        if (!ALLOWED.has(`${t.name}.${c}`)) expect(`${t.name}.${c}`).not.toMatch(/token|secret|password|keys|endpoint|refresh|credential/i);
      }
    }
    expect(seen).toBeGreaterThan(150); // the scan really read the columns (a broken regex would pass vacuously)
  });

  it('findExportTable accepts listed names only', () => {
    expect(findExportTable('media')?.name).toBe('media');
    for (const bad of [null, '', 'account_tokens', 'MEDIA', 'media;drop', '__proto__', 'toString']) expect(findExportTable(bad)).toBeNull();
  });
});

describe('keyset filter', () => {
  it('one key: strictly greater', () => {
    expect(afterFilter(['id'], { id: 'abc' })).toBe('id.gt."abc"');
  });

  it('composite keys: (a > A) or (a = A and b > B) or (a = A and b = B and c > C)', () => {
    expect(afterFilter(['a', 'b', 'c'], { a: 'x', b: '2026-10-01', c: 3 })).toBe('a.gt."x",and(a.eq."x",b.gt."2026-10-01"),and(a.eq."x",b.eq."2026-10-01",c.gt."3")');
  });

  it('quotes reserved characters: timestamps, commas, parentheses, quotes and backslashes', () => {
    expect(afterFilter(['media_id', 'captured_at'], { media_id: '17', captured_at: '2026-10-01T10:00:00.123456+00:00' })).toBe('media_id.gt."17",and(media_id.eq."17",captured_at.gt."2026-10-01T10:00:00.123456+00:00")');
    expect(quoteValue('a,b(c)"d\\e')).toBe('"a,b(c)\\"d\\\\e"');
  });
});

describe('exportPages', () => {
  it('pages in key order with the cursor of the last row, until an EMPTY page (a short page is not the end)', async () => {
    const t = findExportTable('media_metrics')!;
    const { db, calls } = fakeDb([[{ media_id: '1', captured_at: 't1' }, { media_id: '1', captured_at: 't2' }], [{ media_id: '2', captured_at: 't1' }], []]);
    expect(await collect(exportPages(db, t))).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ table: 'media_metrics', select: '*', order: ['media_id:asc', 'captured_at:asc'], or: null, limit: PAGE_ROWS });
    expect(calls[1].or).toBe('media_id.gt."1",and(media_id.eq."1",captured_at.gt."t2")');
    expect(calls[2].or).toBe('media_id.gt."2",and(media_id.eq."2",captured_at.gt."t1")');
  });

  it('uses the table’s own page size', async () => {
    const { db, calls } = fakeDb([[]]);
    await collect(exportPages(db, findExportTable('follower_exports')!));
    expect(calls[0].limit).toBe(5);
  });

  it('a read error throws a fixed message (never the Supabase text)', async () => {
    const { db } = fakeDb([[{ id: 'a' }], { error: true }]);
    await expect(collect(exportPages(db, findExportTable('media')!))).rejects.toThrow(/^export read failed$/);
  });

  it('stops when the server ignores the cursor (the same page again) instead of looping forever', async () => {
    const { db } = fakeDb([[{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]]);
    await expect(collect(exportPages(db, findExportTable('media')!))).rejects.toThrow(/did not advance/);
  });
});

async function* gen(pages: Row[][], failAt?: number) {
  for (let i = 0; i < pages.length; i++) {
    if (i === failAt) throw new Error('db said: secret');
    yield pages[i];
  }
}

describe('jsonArrayStream', () => {
  it('writes one valid JSON array over all pages', async () => {
    const text = await new Response(jsonArrayStream(gen([[{ a: 1 }, { a: 2 }], [{ a: 3 }]]), Date.now() + 60_000)).text();
    expect(JSON.parse(text)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('an empty table is []', async () => {
    expect(JSON.parse(await new Response(jsonArrayStream(gen([]), Date.now() + 60_000)).text())).toEqual([]);
  });

  it('a failure midway errors the stream, so the download fails instead of saving a cut-off file', async () => {
    await expect(new Response(jsonArrayStream(gen([[{ a: 1 }], [{ a: 2 }]], 1), Date.now() + 60_000)).blob()).rejects.toThrow();
  });

  it('past the time budget the stream errors too', async () => {
    let t = 0;
    const s = jsonArrayStream(gen([[{ a: 1 }], [{ a: 2 }]]), 10, () => (t += 6));
    await expect(new Response(s).text()).rejects.toThrow();
  });
});
```

`tests/data-export-route.test.ts`:

```ts
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS } from '@/lib/prefs';

const state = vi.hoisted(() => ({ owner: true, tables: [] as string[], pages: [] as unknown[][], fail: false, admin: 0 }));
vi.mock('@/lib/auth/assert-owner', () => ({
  assertOwner: async (h?: Headers) => {
    h?.set('cache-control', 'private, no-store');
    return state.owner;
  },
}));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ ...DEFAULT_PREFS, timezone: 'UTC' }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (state.admin++, {}) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from(table: string) {
      state.tables.push(table);
      const q = { select: () => q, order: () => q, or: () => q, limit: async () => (state.fail ? { data: null, error: { message: 'row secret' } } : { data: state.pages.shift() ?? [], error: null }) };
      return q;
    },
  }),
}));

import { GET } from '@/app/api/export/data/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/data?${qs}`, 'https://app.test')));
beforeEach(() => {
  state.owner = true;
  state.tables = [];
  state.pages = [];
  state.fail = false;
  state.admin = 0;
});

describe('GET /api/export/data', () => {
  it('401 for anyone but the owner, uncached, nothing read', async () => {
    state.owner = false;
    const res = await get('table=media');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(state.tables).toEqual([]);
  });

  it.each(['', 'table=account_tokens', 'table=push_subscriptions', 'table=sync_runs', 'table=media&table=tags', 'table=media&x=1', 'table=Media', 'table=media%00'])('400 for %s, nothing read', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_params' });
    expect(state.tables).toEqual([]);
  });

  it('streams the whole table as one JSON array file, private and uncached, on the owner session (never the admin client)', async () => {
    state.pages = [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], []];
    const res = await get('table=media');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="in2sight-media-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(JSON.parse(await res.text())).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(state.tables).toEqual(['media', 'media', 'media']);
    expect(state.admin).toBe(0);
  });

  it('a read failure breaks the download instead of saving a partial file, and never leaks the error', async () => {
    state.fail = true;
    const res = await get('table=comments');
    expect(res.status).toBe(200); // headers are already sent when the first page is read
    await expect(res.text()).rejects.toThrow(/^export failed$/);
  });
});
```

`tests/data-download.test.ts` (the default jsdom environment; the tested paths return before touching `document`):

```ts
import { describe, expect, it } from 'vitest';
import { downloadExport } from '@/lib/export/download';
import { contentDisposition, filenameFromDisposition } from '@/lib/export/filename';

const broken = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('[{"a":1}'));
    },
    pull(c) {
      c.error(new Error('export failed'));
    },
  });

describe('JSON downloads (Plan 16c)', () => {
  it('a file name with the .json extension survives both directions', () => {
    const h = contentDisposition('in2sight-media-2026-10-31', 'json');
    expect(h).toContain('filename="in2sight-media-2026-10-31.json"');
    expect(filenameFromDisposition(h, 'x.json')).toBe('in2sight-media-2026-10-31.json');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''evil.exe", 'x.json')).toBe('x.json');
  });

  it('a streamed answer that breaks off midway is an error, never a saved half file', async () => {
    const fetcher = (async () => new Response(broken(), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })) as typeof fetch;
    expect(await downloadExport('/api/export/data?table=media', 'json', fetcher)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('a JSON download refuses an HTML answer (a session that ended mid-way)', async () => {
    const fetcher = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    expect(await downloadExport('/api/export/data?table=media', 'json', fetcher)).toEqual({ ok: false, error: 'unauthorized' });
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/data-usage.test.ts tests/data-export.test.ts tests/data-export-route.test.ts tests/data-download.test.ts` → FAIL (modules missing; the broken-stream download is not caught yet).
- [ ] **Step 3 — `lib/data/usage.ts`** (new):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// "Storage used" (Plan 16c): the rows of public.data_usage() (migration 20261031000001) folded into a few groups the
// owner understands. Sizes include indexes; row counts are the planner's estimate (null = not measured yet).
export const USAGE_GROUPS = ['insights', 'posts', 'comments', 'followers', 'other'] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];

const GROUP_OF: Readonly<Record<string, UsageGroup>> = {
  account_daily: 'insights',
  account_daily_breakdown: 'insights',
  audience_snapshots: 'insights',
  online_followers: 'insights',
  follower_snapshots: 'insights',
  api_snapshots: 'insights',
  media: 'posts',
  media_metrics: 'posts',
  media_children: 'posts',
  comments: 'comments',
  moderation_settings: 'comments',
  moderation_rules: 'comments',
  moderation_log: 'comments',
  follower_exports: 'followers',
};

export interface UsageRow {
  kind: string;
  label: string | null;
  row_count: number | string | null;
  bytes: number | string | null;
}

export interface Usage {
  database: number | null;
  groups: { id: UsageGroup; rows: number | null; bytes: number }[];
  /** One entry per folder of the private "covers" bucket; the folder is an account id. */
  covers: { folder: string; files: number; bytes: number }[];
}

// bigint columns arrive as numbers or strings depending on the driver
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function summariseUsage(rows: readonly UsageRow[]): Usage {
  const groups = USAGE_GROUPS.map((id) => ({ id, rows: 0 as number | null, bytes: 0 }));
  const covers: Usage['covers'] = [];
  let database: number | null = null;
  for (const r of rows) {
    if (r.kind === 'table' && r.label) {
      const g = groups.find((x) => x.id === (GROUP_OF[r.label as string] ?? 'other'))!;
      const n = num(r.row_count);
      g.rows = g.rows === null || n === null ? null : g.rows + n; // one unknown table makes the group's count unknown
      g.bytes += num(r.bytes) ?? 0;
    } else if (r.kind === 'covers' && r.label) {
      covers.push({ folder: r.label, files: num(r.row_count) ?? 0, bytes: num(r.bytes) ?? 0 });
    } else if (r.kind === 'database') {
      database = num(r.bytes);
    }
  }
  return { database, groups, covers: covers.sort((a, b) => b.bytes - a.bytes) };
}

/** Owner session (the function itself checks is_owner()). null = the migration is missing or the call failed. */
export async function readUsage(db: SupabaseClient): Promise<Usage | null> {
  try {
    const { data, error } = await db.rpc('data_usage');
    if (error || !Array.isArray(data)) return null;
    return summariseUsage(data as UsageRow[]);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4 — `lib/data/export.ts`** (new):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

// "Export all" (Plan 16c): every table that holds the owner's data, read through the OWNER session (RLS), one JSON file
// per table, streamed page by page. Never the admin client, so account_tokens is out of reach by privilege, not by care.
// NOT exported, on purpose: account_tokens (access tokens), push_subscriptions (a push endpoint and its keys are
// credentials for this device), owners, sync_state / sync_progress / sync_runs (bookkeeping, no insight).
export type Row = Record<string, unknown>;

export interface ExportTable {
  name: string;
  /** The primary key columns: the sort order and the keyset cursor (PostgREST answers at most 1,000 rows per request). */
  keys: readonly string[];
  /** Rows per request; smaller for tables with big rows (a follower export holds up to 50,000 names). */
  page?: number;
  /** Other people's personal data: left out of "Download all" unless the owner ticks the box. */
  thirdParty?: boolean;
}

export const EXPORT_TABLES = [
  { name: 'accounts', keys: ['id'] },
  { name: 'account_daily', keys: ['account_id', 'day'] },
  { name: 'account_daily_breakdown', keys: ['account_id', 'day', 'metric', 'follow_type', 'product_type'] },
  { name: 'audience_snapshots', keys: ['account_id', 'day', 'kind'] },
  { name: 'online_followers', keys: ['account_id', 'day'] },
  { name: 'follower_snapshots', keys: ['account_id', 'captured_at'] },
  { name: 'api_snapshots', keys: ['id'], page: 100 },
  { name: 'media', keys: ['id'] },
  { name: 'media_metrics', keys: ['media_id', 'captured_at'] },
  { name: 'media_children', keys: ['media_id', 'position'] },
  { name: 'tags', keys: ['id'] },
  { name: 'media_tags', keys: ['media_id', 'tag_id'] },
  { name: 'explorer_views', keys: ['id'] },
  { name: 'notifications', keys: ['id'] },
  { name: 'moderation_settings', keys: ['account_id'] },
  { name: 'moderation_rules', keys: ['id'] },
  { name: 'moderation_log', keys: ['id'] },
  { name: 'profiles', keys: ['user_id'] },
  { name: 'comments', keys: ['id'], thirdParty: true },
  { name: 'follower_exports', keys: ['id'], page: 5, thirdParty: true },
] as const satisfies readonly ExportTable[];

export type ExportTableName = (typeof EXPORT_TABLES)[number]['name'];

export const PAGE_ROWS = 1000;

export function findExportTable(name: string | null): ExportTable | null {
  return EXPORT_TABLES.find((t) => t.name === name) ?? null;
}

/** A PostgREST filter value, always double-quoted (timestamps contain `:` `.` `+`), `\` and `"` escaped. */
export const quoteValue = (v: unknown): string => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Rows strictly after `last` in key order: (a > A) or (a = A and b > B) or … — the body of a PostgREST `or=(…)`. */
export function afterFilter(keys: readonly string[], last: Row): string {
  return keys
    .map((k, i) => {
      const gt = `${k}.gt.${quoteValue(last[k])}`;
      return i === 0 ? gt : `and(${[...keys.slice(0, i).map((e) => `${e}.eq.${quoteValue(last[e])}`), gt].join(',')})`;
    })
    .join(',');
}

const sameKey = (keys: readonly string[], a: Row, b: Row) => keys.every((k) => String(a[k]) === String(b[k]));

/**
 * Every row of one table in key order, one page per request, until a page comes back EMPTY (never "shorter than
 * asked": a lower server row cap would otherwise end the file early). Throws a fixed message on any read error (never
 * the Supabase text) and when a page repeats the previous cursor row (a filter the server ignored would loop forever).
 */
export async function* exportPages(db: SupabaseClient, t: ExportTable): AsyncGenerator<Row[]> {
  const size = t.page ?? PAGE_ROWS;
  let last: Row | null = null;
  for (;;) {
    let q = db.from(t.name).select('*');
    for (const k of t.keys) q = q.order(k, { ascending: true });
    if (last) q = q.or(afterFilter(t.keys, last));
    const { data, error } = await q.limit(size);
    if (error || !Array.isArray(data)) throw new Error('export read failed');
    if (data.length === 0) return;
    const rows = data as Row[];
    if (last && rows.some((r) => sameKey(t.keys, r, last as Row))) throw new Error('export cursor did not advance');
    yield rows;
    last = rows[rows.length - 1];
  }
}

/**
 * A JSON array streamed page by page. The closing `]` is written only after the last page, and any failure (a read
 * error, the time budget) ERRORS the stream, so the browser's download fails instead of saving a cut-off file.
 */
export function jsonArrayStream(pages: AsyncIterable<Row[]>, deadlineMs: number, now: () => number = Date.now): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = pages[Symbol.asyncIterator]();
  let first = true;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('['));
    },
    async pull(c) {
      try {
        if (now() > deadlineMs) throw new Error('export took too long');
        const r = await it.next();
        if (r.done) {
          c.enqueue(enc.encode(first ? ']\n' : '\n]\n'));
          c.close();
          return;
        }
        c.enqueue(enc.encode((first ? '\n' : ',\n') + r.value.map((row) => JSON.stringify(row)).join(',\n')));
        first = false;
      } catch {
        c.error(new Error('export failed')); // fixed text: never the cause (it could quote a value)
        void it.return?.(undefined);
      }
    },
    cancel() {
      void it.return?.(undefined);
    },
  });
}
```

- [ ] **Step 5 — `app/api/export/data/route.ts`** (new):

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { assertOwner } from '@/lib/auth/assert-owner';
import { exportPages, findExportTable, jsonArrayStream } from '@/lib/data/export';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportHeaders } from '@/lib/export/request';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export const maxDuration = 60;
/** Stop well inside maxDuration: an unfinished file must fail in the browser, not be cut off by the platform. */
// ponytail: one table = one request within 50 s; add ?after=<cursor> parts if a table ever outgrows it (RUNBOOK_DATA §2).
const BUDGET_MS = 50_000;

/**
 * GET /api/export/data?table=<name> — one table of "Export all" (Settings → Data & privacy, Plan 16c) as a JSON array,
 * streamed page by page. Owner session only (assertOwner first; RLS on every read; never the admin client, so
 * account_tokens cannot be read even by mistake). Exactly one parameter, an allow-listed table name. A GET reads only;
 * nothing changes. Never logs rows or error objects.
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const table = findExportTable(q.get('table'));
    if ([...q.keys()].length !== 1 || !table) return exportError(h, 400, 'bad_params');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const day = localDay(new Date(), (await getPrefs()).timezone);
    h.set('content-type', 'application/json; charset=utf-8');
    h.set('content-disposition', contentDisposition(`in2sight-${table.name}-${day}`, 'json'));
    h.set('x-content-type-options', 'nosniff');
    return new NextResponse(jsonArrayStream(exportPages(db, table), Date.now() + BUDGET_MS), { status: 200, headers: h });
  } catch {
    return exportError(h, 500, 'unexpected');
  }
}
```

- [ ] **Step 6 — `lib/export/filename.ts`.** Two edits: replace `export function contentDisposition(base: string, ext: 'xlsx' | 'pdf'): string {` with `export function contentDisposition(base: string, ext: 'xlsx' | 'pdf' | 'json'): string {`; in `filenameFromDisposition` replace ``  return ext === 'xlsx' || ext === 'pdf' ? `${clean(name.slice(0, dot))}.${ext}` : fallback;`` with ``  return ext === 'xlsx' || ext === 'pdf' || ext === 'json' ? `${clean(name.slice(0, dot))}.${ext}` : fallback;``.
- [ ] **Step 7 — `lib/export/download.ts`.** Four edits:
  1. after the line `export type ExportFormat = 'xlsx' | 'pdf';` insert
     ```ts
     /** What downloadExport can save: the dialog's formats plus the JSON files of Settings → Data & privacy (Plan 16c). */
     export type DownloadFormat = ExportFormat | 'json';
     ```
  2. replace `const TYPES: Record<ExportFormat, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };` with `const TYPES: Record<DownloadFormat, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', json: 'application/json' };`
  3. replace `export async function downloadExport(url: string, format: ExportFormat, fetcher` with `export async function downloadExport(url: string, format: DownloadFormat, fetcher`; in its doc comment replace `` * `export.errors.*` key. A session`` with `` * `export.errors.*` key, and so does a streamed answer that breaks off midway (never saved half). A session``
  4. replace `  const href = URL.createObjectURL(await res.blob());` with
     ```ts
       let blob: Blob;
       try {
         blob = await res.blob(); // a streamed file that broke off midway rejects here: nothing is saved
       } catch {
         return { ok: false, error: 'unexpected' };
       }
       const href = URL.createObjectURL(blob);
     ```
- [ ] **Step 8 — the three privacy guards admit the owner's export and the size reader (a deliberate, reviewed policy change: Decisions "Other people's data", Review Focus 10).** `lib/data/export.ts` selects every row of `comments`, `follower_exports` and the `moderation_*` tables through the OWNER session when the owner downloads them; `lib/data/usage.ts` only names `follower_exports` (and the others as unquoted keys) for their sizes.
  - `tests/comments-privacy.test.ts`: replace
    ```ts
      it("only lib/comments/read.ts (reads), lib/moderation/store.ts (moderation) and lib/sync/store.ts (the sync's writes) query the comments table", () => {
        expect(src.filter(([, s]) => commentAccess(s, aliases).table).map(([f]) => f)).toEqual(['lib/comments/read.ts', 'lib/moderation/store.ts', 'lib/sync/store.ts']);
    ```
    with
    ```ts
      // lib/data/export.ts (Plan 16c): the owner's "Export your data", owner session only, comments only when the owner picks them
      it("only lib/comments/read.ts (reads), lib/data/export.ts (the owner's export), lib/moderation/store.ts (moderation) and lib/sync/store.ts (the sync's writes) query the comments table", () => {
        expect(src.filter(([, s]) => commentAccess(s, aliases).table).map(([f]) => f)).toEqual(['lib/comments/read.ts', 'lib/data/export.ts', 'lib/moderation/store.ts', 'lib/sync/store.ts']);
    ```
  - `tests/followers-privacy.test.ts`: replace
    ```ts
      it('only lib/followers/read.ts names the follower_exports table in code (comments may mention it)', () => {
    ```
    with
    ```ts
      // Plan 16c: lib/data/export.ts (the owner's "Export your data", owner session only, follower lists only when the owner picks them)
      // and lib/data/usage.ts (the table's size in "Storage used", a name only, no rows)
      it('only lib/followers/read.ts, lib/data/export.ts (the owner export) and lib/data/usage.ts (its size) name the follower_exports table in code (comments may mention it)', () => {
    ```
    and, two lines below, `.toEqual(['lib/followers/read.ts']);` with `.toEqual(['lib/data/export.ts', 'lib/data/usage.ts', 'lib/followers/read.ts']);`.
  - `tests/moderation-privacy.test.ts`: replace
    ```ts
      it('only lib/moderation/store.ts names the log and the rules; settings also in the alert store (paused_at only)', () => {
        expect(naming(/['"`]moderation_log['"`]/)).toEqual(['lib/moderation/store.ts']);
        expect(naming(/['"`]moderation_rules['"`]/)).toEqual(['lib/moderation/store.ts']);
        expect(naming(/['"`]moderation_settings['"`]/)).toEqual(['lib/alerts/store.ts', 'lib/moderation/store.ts']);
    ```
    with
    ```ts
      it('only lib/moderation/store.ts names the log and the rules; settings also in the alert store (paused_at only); the owner export reads all three (Plan 16c)', () => {
        const DATA = ['lib/data/export.ts']; // owner-session select of every row: the owner's "Export your data" (lib/data/usage.ts only uses the names as unquoted keys)
        expect(naming(/['"`]moderation_log['"`]/)).toEqual([...DATA, 'lib/moderation/store.ts']);
        expect(naming(/['"`]moderation_rules['"`]/)).toEqual([...DATA, 'lib/moderation/store.ts']);
        expect(naming(/['"`]moderation_settings['"`]/)).toEqual(['lib/alerts/store.ts', ...DATA, 'lib/moderation/store.ts']);
    ```
- [ ] **Verify:** `npx vitest run tests/data-usage.test.ts tests/data-export.test.ts tests/data-export-route.test.ts tests/data-download.test.ts tests/export-params.test.ts tests/export-dialog.test.tsx tests/explorer-view.test.tsx tests/followers-tab.test.tsx tests/comments-privacy.test.ts tests/followers-privacy.test.ts tests/moderation-privacy.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/data/usage.ts lib/data/export.ts app/api/export/data/route.ts lib/export/download.ts lib/export/filename.ts tests/data-usage.test.ts tests/data-export.test.ts tests/data-export-route.test.ts tests/data-download.test.ts tests/comments-privacy.test.ts tests/followers-privacy.test.ts tests/moderation-privacy.test.ts`.
- [ ] **Commit:** `git add lib/data/usage.ts tests/data-usage.test.ts lib/data/export.ts app/api/export/data/route.ts lib/export/download.ts lib/export/filename.ts tests/data-export.test.ts tests/data-export-route.test.ts tests/data-download.test.ts tests/comments-privacy.test.ts tests/followers-privacy.test.ts tests/moderation-privacy.test.ts`, `git commit -m "feat(export): storage usage and export all data as streamed JSON per table" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 5: delete library and the server action

**Files:** Create `lib/data/delete.ts`, `tests/data-delete.test.ts`, `app/(app)/settings/data-actions.ts`, `tests/data-actions.test.ts`. Depends on Task 3 (`checkPassword`, `checkClient`).

- [ ] **Step 1 — failing tests.** Write `tests/data-delete.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deleteAllData, removeAllCovers } from '@/lib/data/delete';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

/** A fake service-role client: an rpc answer and a covers bucket held as a Map of folder -> file names. */
function fakeAdmin(o: { rpc?: { data: unknown; error: unknown } | 'throw'; files?: Record<string, string[]>; listFails?: boolean; removeFails?: boolean }) {
  const files = new Map(Object.entries(o.files ?? {}));
  const calls: string[] = [];
  const bucket = {
    async list(prefix: string, opts: { limit: number }) {
      calls.push(`list:${prefix || '/'}`);
      if (o.listFails) return { data: null, error: { message: 'down' } };
      if (prefix === '') return { data: [...files.keys()].map((name) => ({ name, id: null })), error: null };
      return { data: (files.get(prefix) ?? []).slice(0, opts.limit).map((name) => ({ name, id: 'x' })), error: null };
    },
    async remove(paths: string[]) {
      calls.push(`remove:${paths.length}`);
      if (o.removeFails) return { data: null, error: { message: 'down' } };
      for (const p of paths) {
        const [folder, name] = p.split('/');
        const left = (files.get(folder) ?? []).filter((n) => n !== name);
        if (left.length) files.set(folder, left);
        else files.delete(folder);
      }
      return { data: [], error: null };
    },
  };
  const admin = {
    async rpc(fn: string) {
      calls.push(`rpc:${fn}`);
      if (o.rpc === 'throw') throw new Error('network');
      return o.rpc ?? { data: { accounts: 2, tags: 1, views: 0 }, error: null };
    },
    storage: { from: (b: string) => (calls.push(`bucket:${b}`), bucket) },
  };
  return { admin: admin as never, calls, files };
}

describe('deleteAllData', () => {
  it('the database first (one rpc), then every cover folder of the bucket, then a check that it is empty', async () => {
    const f = fakeAdmin({ files: { [A]: ['m1.jpg', 'm2.jpg'], [B]: ['m3.jpg'] } });
    expect(await deleteAllData(f.admin)).toEqual({ ok: true, accounts: 2, coversDone: true });
    expect(f.calls[0]).toBe('rpc:delete_all_data');
    expect(f.calls.filter((c) => c.startsWith('rpc:'))).toHaveLength(1);
    expect(f.calls.every((c) => !c.startsWith('bucket:') || c === 'bucket:covers')).toBe(true);
    expect(f.files.size).toBe(0);
  });

  it('a failed rpc deletes nothing else (no Storage call) and maps a missing function to needs_update', async () => {
    const missing = fakeAdmin({ rpc: { data: null, error: { code: 'PGRST202' } }, files: { [A]: ['m1.jpg'] } });
    expect(await deleteAllData(missing.admin)).toEqual({ ok: false, error: 'needs_update' });
    expect(missing.calls).toEqual(['rpc:delete_all_data']);
    const failed = fakeAdmin({ rpc: { data: null, error: { code: '57014', message: 'secret' } } });
    expect(await deleteAllData(failed.admin)).toEqual({ ok: false, error: 'unexpected' });
    expect(await deleteAllData(fakeAdmin({ rpc: 'throw' }).admin)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('a second run is harmless: zero accounts, an empty bucket', async () => {
    const f = fakeAdmin({ rpc: { data: { accounts: 0, tags: 0, views: 0 }, error: null } });
    expect(await deleteAllData(f.admin)).toEqual({ ok: true, accounts: 0, coversDone: true });
  });

  it('a malformed rpc answer counts as 0 accounts, not NaN', async () => {
    expect(await deleteAllData(fakeAdmin({ rpc: { data: null, error: null } }).admin)).toEqual({ ok: true, accounts: 0, coversDone: true });
  });
});

describe('removeAllCovers', () => {
  it('also removes folders of accounts that no longer exist; ignores names that are not account ids', async () => {
    const f = fakeAdmin({ files: { [B]: ['old.jpg'], 'not-an-id': ['x'] } });
    expect(await removeAllCovers(f.admin)).toBe(true); // only uuid folders count as "left"
    expect(f.files.has(B)).toBe(false);
    expect(f.files.has('not-an-id')).toBe(true);
  });

  it('reports false when the bucket cannot be listed or a remove fails (the owner runs it again)', async () => {
    expect(await removeAllCovers(fakeAdmin({ listFails: true }).admin)).toBe(false);
    expect(await removeAllCovers(fakeAdmin({ files: { [A]: ['m1.jpg'] }, removeFails: true }).admin)).toBe(false);
  });
});
```

and `tests/data-actions.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), delete: vi.fn() }));
const requireOwner = vi.fn();
const checkPassword = vi.fn();
const deleteAllData = vi.fn();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name) } : undefined),
    set: (...a: unknown[]) => jar.set(...a),
    delete: (...a: unknown[]) => jar.delete(...a),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(`revalidate:${a.join(',')}`) }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/auth/check-client', () => ({ checkClient: () => ({}) }));
vi.mock('@/lib/auth/password', () => ({ checkPassword: (...a: unknown[]) => checkPassword(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('admin'), { admin: true }) }));
vi.mock('@/lib/data/delete', async (orig) => ({ ...(await orig<object>()), deleteAllData: (...a: unknown[]) => deleteAllData(...a) }));

import { deleteAllDataAction } from '@/app/(app)/settings/data-actions';
import { PASSWORD_COOKIE } from '@/lib/auth/attempts';

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const good = { phrase: 'DELETE', password: 'the owner password', email: 'attacker@evil.test', userId: 'someone-else' };
const run = (o: Record<string, string> = good) => deleteAllDataAction(null, form(o));

beforeEach(() => {
  calls.length = 0;
  jar.values.clear();
  jar.set.mockReset();
  jar.delete.mockReset();
  requireOwner.mockReset().mockImplementation(async () => (calls.push('requireOwner'), { userId: 'owner-1', email: 'owner@example.com' }));
  checkPassword.mockReset().mockImplementation(async () => (calls.push('check'), 'ok'));
  deleteAllData.mockReset().mockImplementation(async () => (calls.push('delete'), { ok: true, accounts: 2, coversDone: true }));
});

describe('deleteAllDataAction', () => {
  it('does nothing when requireOwner redirects (signed out, 2FA owed, not the owner)', async () => {
    for (const to of ['/login', '/login/verify', '/auth/signout']) {
      requireOwner.mockImplementationOnce(async () => {
        throw new Error(`REDIRECT:${to}`);
      });
      await expect(run()).rejects.toThrow(`REDIRECT:${to}`);
    }
    expect(calls).toEqual([]);
  });

  it('order: owner, password check (with the SESSION user and email, never the form values), service-role delete, revalidate', async () => {
    expect(await run()).toEqual({ ok: true, accounts: 2, coversDone: true });
    expect(calls).toEqual(['requireOwner', 'check', 'admin', 'delete', 'revalidate:/,layout']);
    expect(checkPassword.mock.calls[0][1]).toEqual({ userId: 'owner-1', email: 'owner@example.com', password: 'the owner password' });
    expect(deleteAllData).toHaveBeenCalledWith({ admin: true });
    expect(jar.delete).toHaveBeenCalledWith(PASSWORD_COOKIE);
  });

  it.each([
    [{ ...good, phrase: 'delete' }, 'phrase'],
    [{ ...good, phrase: ' DELETE' }, 'phrase'],
    [{ password: 'x' }, 'phrase'],
    [{ ...good, password: '' }, 'missing_password'],
    [{ phrase: 'DELETE' }, 'missing_password'],
  ])('refuses %j with %s before any password check or delete', async (fields, error) => {
    expect(await run(fields as Record<string, string>)).toEqual({ error });
    expect(calls).toEqual(['requireOwner']);
  });

  it('a wrong password counts an attempt and deletes nothing', async () => {
    checkPassword.mockImplementationOnce(async () => (calls.push('check'), 'wrong_password'));
    expect(await run()).toEqual({ error: 'wrong_password' });
    expect(calls).toEqual(['requireOwner', 'check']);
    expect(jar.set).toHaveBeenCalledWith(PASSWORD_COOKIE, expect.stringMatching(/^1\.\d+$/), expect.objectContaining({ httpOnly: true }));
  });

  it.each(['rate_limited', 'unexpected'])('a %s check deletes nothing and counts no attempt', async (r) => {
    checkPassword.mockImplementationOnce(async () => (calls.push('check'), r));
    expect(await run()).toEqual({ error: r });
    expect(calls).toEqual(['requireOwner', 'check']);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('five wrong passwords in the window: refused without checking (the counter is shared with change password)', async () => {
    jar.values.set(PASSWORD_COOKIE, `5.${Date.now() - 1000}`);
    expect(await run()).toEqual({ error: 'rate_limited' });
    expect(calls).toEqual(['requireOwner']);
  });

  it('a failed delete reports its key and revalidates nothing', async () => {
    deleteAllData.mockImplementationOnce(async () => (calls.push('delete'), { ok: false, error: 'needs_update' }));
    expect(await run()).toEqual({ error: 'needs_update' });
    expect(calls).toEqual(['requireOwner', 'check', 'admin', 'delete']);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/data-delete.test.ts tests/data-actions.test.ts` → FAIL (modules missing).
- [ ] **Step 3 — `lib/data/delete.ts`** (new):

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { COVERS_BUCKET } from '@/lib/sync/covers';
import { removeAccountCovers } from '@/lib/sync/store';

// "Delete all data permanently" (Plan 16c; SPEC §7c). The caller (deleteAllDataAction) has already run requireOwner()
// and re-checked the password; `admin` is the service-role client, the only role allowed to run delete_all_data().
// Order: the database first, in ONE transaction (public.delete_all_data: all or nothing), then the cover images with
// the Storage API (SQL cannot delete Storage objects). Idempotent and resumable: run it again and it finishes the job.
// ponytail: no sync pause flag; a tick that is mid-run can still upload one cover after the wipe (Storage has no foreign
// keys): it shows as "Not linked to an account" in Storage used and the next run removes it. Add a flag if that is ever seen.

/** What the owner types to confirm; the same in every language (checked again on the server). */
export const DELETE_PHRASE = 'DELETE';

export type DeleteError = 'phrase' | 'missing_password' | 'wrong_password' | 'rate_limited' | 'needs_update' | 'unexpected';
export type DeleteState = { ok: true; accounts: number; coversDone: boolean } | { error: DeleteError } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account folders of the covers bucket (every one, also of accounts already deleted); null = could not list. */
async function coverFolders(admin: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await admin.storage.from(COVERS_BUCKET).list('', { limit: 1000 });
    if (error || !Array.isArray(data)) return null;
    return data.map((f) => f.name).filter((n) => UUID.test(n));
  } catch {
    return null;
  }
}

/**
 * Removes every cover image, folder by folder (the bucket, not the accounts table, is the list: a folder left behind
 * by an earlier, interrupted run or by a sync tick that was mid-upload is found too). true = the bucket is empty now.
 */
export async function removeAllCovers(admin: SupabaseClient): Promise<boolean> {
  const folders = await coverFolders(admin);
  if (!folders) return false;
  for (const f of folders) await removeAccountCovers(admin, f); // never throws
  return (await coverFolders(admin))?.length === 0;
}

export async function deleteAllData(admin: SupabaseClient): Promise<{ ok: true; accounts: number; coversDone: boolean } | { ok: false; error: 'needs_update' | 'unexpected' }> {
  try {
    const { data, error } = await admin.rpc('delete_all_data');
    if (error) return { ok: false, error: error.code === 'PGRST202' ? 'needs_update' : 'unexpected' }; // the transaction rolled back: nothing deleted
    const n = Number((data as { accounts?: unknown } | null)?.accounts);
    return { ok: true, accounts: Number.isFinite(n) ? n : 0, coversDone: await removeAllCovers(admin) };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
```

- [ ] **Step 4 — `app/(app)/settings/data-actions.ts`** (new; Write tool, the path has parentheses):

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { PASSWORD_COOKIE, PASSWORD_LIMIT, attemptCookieOptions, bumpAttempts, isLimited, readAttempts } from '@/lib/auth/attempts';
import { checkClient } from '@/lib/auth/check-client';
import { checkPassword } from '@/lib/auth/password';
import { requireOwner } from '@/lib/auth/require-owner';
import { DELETE_PHRASE, deleteAllData, type DeleteState } from '@/lib/data/delete';
import { createAdminSupabase } from '@/lib/supabase/admin';

/**
 * Settings → Data & privacy → "Delete all data" (Plan 16c). A POST-only server action (Next.js checks the Origin), in
 * this order: owner + aal2 (requireOwner), the typed phrase, the wrong-password cookie limit shared with change
 * password, the password re-checked on a memory-only client, and only then the service-role delete. Nothing is logged:
 * Supabase's API log records the delete_all_data call (time, status) out of reach of the browser session.
 */
export async function deleteAllDataAction(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const { userId, email } = await requireOwner();
  if (formData.get('phrase') !== DELETE_PHRASE) return { error: 'phrase' };
  const password = formData.get('password');
  if (typeof password !== 'string' || !password) return { error: 'missing_password' };
  const store = await cookies();
  const attempts = readAttempts(store.get(PASSWORD_COOKIE)?.value, Date.now(), PASSWORD_LIMIT);
  if (isLimited(attempts, PASSWORD_LIMIT)) return { error: 'rate_limited' };
  const checked = await checkPassword(checkClient, { userId, email, password });
  if (checked !== 'ok') {
    if (checked === 'wrong_password') store.set(PASSWORD_COOKIE, bumpAttempts(attempts), attemptCookieOptions(PASSWORD_LIMIT));
    return { error: checked };
  }
  store.delete(PASSWORD_COOKIE);
  const r = await deleteAllData(createAdminSupabase());
  if (!r.ok) return { error: r.error };
  revalidatePath('/', 'layout'); // every page showed the deleted accounts
  return { ok: true, accounts: r.accounts, coversDone: r.coversDone };
}
```

- [ ] **Verify:** `npx vitest run tests/data-delete.test.ts tests/data-actions.test.ts tests/comments-privacy.test.ts tests/moderation-privacy.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/data/delete.ts "app/(app)/settings/data-actions.ts" tests/data-delete.test.ts tests/data-actions.test.ts`.
- [ ] **Commit:** `git add lib/data/delete.ts tests/data-delete.test.ts "app/(app)/settings/data-actions.ts" tests/data-actions.test.ts`, `git commit -m "feat(data): delete all data behind the password re-check" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 6: the Data & privacy section and the guard

**Files:** Create `components/settings/DataExport.tsx`, `components/settings/DeleteAllData.tsx`, `tests/settings-data.test.tsx`, `tests/data-privacy-guard.test.ts`. Replace `components/settings/sections/DataSection.tsx` (whole file; same name, same export, zero props). Modify `messages/en.json`, `messages/zh-CN.json` (remove one placeholder line each).

- [ ] **Step 1 — failing tests.** Write `tests/settings-data.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { Usage } from '@/lib/data/usage';

const A = '11111111-1111-1111-1111-111111111111';
const server = vi.hoisted(() => ({ calls: [] as string[], usage: null as Usage | null, action: vi.fn(), download: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (server.calls.push('owner'), { userId: 'u1', email: 'o@x.y' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (await import('@/lib/prefs')).DEFAULT_PREFS }));
vi.mock('@/lib/data/usage', () => ({ readUsage: async () => (server.calls.push('usage'), server.usage) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ list: async () => [{ id: A, username: 'yseny_' }] }) }));
vi.mock('@/lib/data/delete', () => ({ DELETE_PHRASE: 'DELETE' }));
vi.mock('@/app/(app)/settings/data-actions', () => ({ deleteAllDataAction: (...a: unknown[]) => server.action(...a) }));
vi.mock('@/lib/export/download', () => ({ downloadExport: (...a: unknown[]) => server.download(...a) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: server.refresh }) }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en.json')).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) };
});

import { DataSection } from '@/components/settings/sections/DataSection';

const D = en.settings.data;
const show = async () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {await DataSection()}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  server.calls.length = 0;
  server.usage = {
    database: 50 * 1024 * 1024,
    groups: [
      { id: 'insights', rows: 1200, bytes: 2 * 1024 * 1024 },
      { id: 'posts', rows: null, bytes: 1024 },
      { id: 'comments', rows: 3, bytes: 0 },
      { id: 'followers', rows: 1, bytes: 1536 },
      { id: 'other', rows: 9, bytes: 512 },
    ],
    covers: [
      { folder: A, files: 12, bytes: 3 * 1024 * 1024 },
      { folder: '22222222-2222-2222-2222-222222222222', files: 1, bytes: 100 },
    ],
  };
  server.action.mockReset().mockResolvedValue({ ok: true, accounts: 2, coversDone: true });
  server.download.mockReset().mockResolvedValue({ ok: true });
  server.refresh.mockReset();
});

describe('Settings -> Data & privacy', () => {
  it('checks the owner first, then shows what is stored, storage used, export and delete', async () => {
    await show();
    expect(server.calls[0]).toBe('owner');
    expect(screen.getByText(D.privacy)).toBeInTheDocument();
    expect(screen.getByText('50 MB')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: D.usage.groups.insights })).toBeInTheDocument();
    expect(screen.getByText('1.2K')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // unknown row count, never 0
    expect(screen.getByText('@yseny_')).toBeInTheDocument();
    expect(screen.getByText(D.usage.unlinked)).toBeInTheDocument();
    expect(screen.getByText(/12 images · 3 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: D.export.all })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: D.deleteAll.open })).toBeInTheDocument();
    expect(screen.queryByText(/coming/)).toBeNull(); // the 16a placeholder line is gone
  });

  it('without the migration the storage card says it needs a database update', async () => {
    server.usage = null;
    await show();
    expect(screen.getByText(D.usage.needsUpdate)).toBeInTheDocument();
  });

  it('Download all fetches one table at a time and leaves out other people’s data unless ticked', async () => {
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: D.export.all }));
    const urls = server.download.mock.calls.map((c) => c[0] as string);
    expect(urls).toHaveLength(18);
    expect(urls.some((u) => /table=(comments|follower_exports)\b/.test(u))).toBe(false);
    expect(server.download.mock.calls.every((c) => c[1] === 'json')).toBe(true);
    expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();

    server.download.mockClear();
    await user.click(screen.getByRole('checkbox', { name: D.export.others }));
    await user.click(screen.getByRole('button', { name: D.export.all }));
    expect(server.download.mock.calls).toHaveLength(20);
  });

  it('a failed file stops the run and shows the export error', async () => {
    const user = userEvent.setup();
    server.download.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'unexpected' });
    await show();
    await user.click(screen.getByRole('button', { name: D.export.all }));
    expect(server.download).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.export.errors.unexpected);
  });

  it('delete: the confirm button stays disabled until the exact word is typed; success closes and refreshes', async () => {
    const user = userEvent.setup();
    await show();
    await user.click(screen.getByRole('button', { name: D.deleteAll.open }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: D.deleteAll.confirm });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(D.deleteAll.password), 'the owner password');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText('Type DELETE to confirm'));
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(confirm).toBeEnabled();
    await act(async () => user.click(confirm));
    const fd = server.action.mock.calls[0][1] as FormData;
    expect(fd.get('phrase')).toBe('DELETE');
    expect(fd.get('password')).toBe('the owner password');
    expect(await screen.findByText('All data of 2 accounts was deleted.')).toBeInTheDocument();
    expect(server.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a wrong password shows on the password field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    server.action.mockResolvedValueOnce({ error: 'wrong_password' });
    await show();
    await user.click(screen.getByRole('button', { name: D.deleteAll.open }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(D.deleteAll.password), 'nope');
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    await act(async () => user.click(within(dialog).getByRole('button', { name: D.deleteAll.confirm })));
    expect(await within(dialog).findByText(D.deleteAll.errors.wrong_password)).toBeInTheDocument();
    expect(server.refresh).not.toHaveBeenCalled();
  });
});
```

and `tests/data-privacy-guard.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Plan 16c: the Data & privacy files never log, the export never touches the service role (so account_tokens is out of
// reach by privilege), only the delete action uses it and only after requireOwner + the password check, and nothing
// reachable by a GET can delete.
const root = process.cwd();
const src = (f: string) => readFileSync(join(root, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // comments may name what is excluded

const NAMED = [
  'lib/data/export.ts',
  'lib/data/usage.ts',
  'lib/data/delete.ts',
  'app/api/export/data/route.ts',
  'app/(app)/settings/data-actions.ts',
  'components/settings/DataExport.tsx',
  'components/settings/DeleteAllData.tsx',
  'components/settings/sections/DataSection.tsx',
];
const EXPORT_SIDE = ['lib/data/export.ts', 'lib/data/usage.ts', 'app/api/export/data/route.ts', 'components/settings/DataExport.tsx', 'components/settings/sections/DataSection.tsx'];

function walk(dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .map((p) => `${dir}/${p.replace(/\\/g, '/')}`)
    .filter((f) => /\.tsx?$/.test(f));
}
const FILES = [...new Set([...NAMED, ...walk('lib/data')])];
const ADMIN = /createAdminSupabase|supabase\/admin|SECRET_KEY|service_role|serviceRole/;

describe('data & privacy guard (Plan 16c)', () => {
  it('the guard really scans the files', () => {
    for (const f of NAMED) expect(existsSync(join(root, f)), f).toBe(true);
  });

  it.each(FILES)('%s: no logging', (f) => {
    expect(src(f)).not.toMatch(/\bconsole\b|\blogger\b|process\.std(out|err)/);
  });

  it.each(EXPORT_SIDE)('%s: no service-role client, also not through an imported module', (f) => {
    expect(src(f)).not.toMatch(ADMIN);
    for (const m of src(f).matchAll(/from '@\/([^']+)'/g)) {
      if (m[1] === 'app/(app)/settings/data-actions') continue; // the section passes the action to a client component; it is checked below
      const target = ['.ts', '.tsx', '/index.ts'].map((e) => `${m[1]}${e}`).find((p) => existsSync(join(root, p)));
      if (target) expect(src(target), `${f} -> ${target}`).not.toMatch(/createAdminSupabase|supabase\/admin|service_role/);
    }
  });

  it('the export code never names the token or push tables (outside comments)', () => {
    for (const f of EXPORT_SIDE) expect(code(f), f).not.toMatch(/account_tokens|push_subscriptions|access_token/);
  });

  it('the service role appears only in the delete action; lib/data/delete.ts receives the client as a parameter', () => {
    const users = [...walk('lib'), ...walk('app'), ...walk('components')].filter((f) => /createAdminSupabase/.test(src(f)) && /data/.test(f));
    expect(users).toEqual(['app/(app)/settings/data-actions.ts']);
    expect(src('lib/data/delete.ts')).not.toMatch(ADMIN);
  });

  it('delete_all_data is called from lib/data/delete.ts only, and deleteAllData only from the server action', () => {
    const all = [...walk('lib'), ...walk('app'), ...walk('components')];
    expect(all.filter((f) => /delete_all_data/.test(code(f)))).toEqual(['lib/data/delete.ts']);
    expect(all.filter((f) => /\bdeleteAllData\(/.test(code(f))).sort()).toEqual(['app/(app)/settings/data-actions.ts', 'lib/data/delete.ts']);
  });

  it('every exported action authorizes first, then the phrase, the password, and only then the delete', () => {
    const f = 'app/(app)/settings/data-actions.ts';
    const s = src(f);
    expect(s.startsWith("'use server';")).toBe(true);
    const lines = s.split(/\r?\n/);
    const heads = lines.flatMap((l, i) => (/^export async function \w+\(/.test(l) ? [i] : []));
    expect(heads).toHaveLength(1);
    expect(s).not.toMatch(/^export (async )?const /m);
    const first = lines.slice(heads[0] + 1).find((l) => l.trim() && !l.trim().startsWith('//'));
    expect(first).toMatch(/^\s*const \{ userId, email \} = await requireOwner\(\);/);
    const at = (x: string) => {
      const i = s.indexOf(x);
      expect(i, x).toBeGreaterThan(-1);
      return i;
    };
    expect(at('await requireOwner()')).toBeLessThan(at('DELETE_PHRASE)'));
    expect(at('DELETE_PHRASE)')).toBeLessThan(at('isLimited('));
    expect(at('isLimited(')).toBeLessThan(at('checkPassword('));
    expect(at('checkPassword(')).toBeLessThan(at('createAdminSupabase()'));
    expect(at("if (checked !== 'ok')")).toBeLessThan(at('deleteAllData('));
  });

  it('no GET handler can delete: the export route reads only, and no route handler imports the delete code', () => {
    const route = code('app/api/export/data/route.ts');
    expect(route).toMatch(/export async function GET\(/);
    expect(route).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
    expect(route).not.toMatch(/\.(delete|insert|update|upsert|remove|rpc)\(/);
    expect(route.indexOf('assertOwner(')).toBeLessThan(route.indexOf('createServerSupabase('));
    for (const f of walk('app').filter((x) => /\/route\.ts$/.test(x))) expect(src(f), f).not.toMatch(/lib\/data\/delete|data-actions|delete_all_data/);
  });

  it('the export reads only with select (no write method anywhere in lib/data/export.ts)', () => {
    const s = code('lib/data/export.ts');
    expect(s).toMatch(/\.select\('\*'\)/);
    expect(s).not.toMatch(/\.(delete|insert|update|upsert|remove|rpc)\(/);
  });

  it('the delete dialog is a form posting the server action (no fetch, no GET, no auto-submit)', () => {
    const s = code('components/settings/DeleteAllData.tsx');
    expect(s).toMatch(/<form action=\{formAction\}/);
    expect(s).not.toMatch(/\bfetch\(|requestSubmit|\.submit\(\)|useEffect/);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/settings-data.test.tsx tests/data-privacy-guard.test.ts` → FAIL (the components do not exist; the placeholder section has no Storage card).
- [ ] **Step 3 — `components/settings/DataExport.tsx`** (new):

```tsx
'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { downloadExport } from '@/lib/export/download';

export interface ExportItem {
  name: string;
  label: string;
  thirdParty: boolean;
}

const urlFor = (name: string) => `/api/export/data?${new URLSearchParams({ table: name })}`;

/**
 * "Export your data" (Plan 16c): one JSON file per table, fetched one after another (never in parallel: each file is
 * one streamed request on the server). Other people's data only when the owner ticks the box (Download all) or picks
 * that single file. Results: `role="status"` for progress and success, `role="alert"` for an error.
 */
export function DataExport({ items }: { items: ExportItem[] }) {
  const t = useTranslations('settings.data.export');
  const te = useTranslations('export.errors');
  const [others, setOthers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // 'all' or a table name
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(list: ExportItem[], key: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    for (let i = 0; i < list.length; i++) {
      setProgress({ done: i + 1, total: list.length });
      const r = await downloadExport(urlFor(list[i].name), 'json');
      if (!r.ok) {
        setError(r.error);
        setProgress(null);
        setBusy(null);
        return;
      }
    }
    setProgress(null);
    setDone(list.length);
    setBusy(null);
  }

  return (
    <div className="grid gap-[var(--gp)]">
      <div className="flex items-start gap-2">
        <Checkbox id="export-others" checked={others} onCheckedChange={(v) => setOthers(v === true)} disabled={busy !== null} aria-describedby="export-others-hint" />
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="export-others">{t('others')}</Label>
          <p id="export-others-hint" className="text-sm text-muted-foreground">
            {t('othersHint')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[var(--gp)]">
        <LoadingButton type="button" pending={busy === 'all'} disabled={busy !== null} onClick={() => void run(items.filter((x) => others || !x.thirdParty), 'all')}>
          <Download aria-hidden="true" />
          {t('all')}
        </LoadingButton>
        <p className="text-sm text-muted-foreground">{t('browserHint')}</p>
      </div>
      <p role="status" className="text-sm">
        {progress ? t('progress', progress) : done !== null ? t('done', { count: done }) : null}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {te(error)}
        </p>
      ) : null}
      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t('single')}</summary>
        <ul className="divide-y">
          {items.map((x) => (
            <li key={x.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="break-words">{x.label}</span>
                {x.thirdParty ? <Badge variant="outline">{t('thirdParty')}</Badge> : null}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} aria-label={`${t('download')}: ${x.label}`} onClick={() => void run([x], x.name)}>
                <Download aria-hidden="true" />
                {t('download')}
              </Button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

- [ ] **Step 4 — `components/settings/DeleteAllData.tsx`** (new):

```tsx
'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@/components/auth/PasswordInput';
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
import type { DeleteState } from '@/lib/data/delete';

type Action = (prev: DeleteState, formData: FormData) => Promise<DeleteState>;
type Done = Extract<DeleteState, { ok: true }>;

// Lives inside the dialog content, which unmounts on close: the password, the typed word and an old error never linger.
function DeleteForm({ action, email, phrase, onDone }: { action: Action; email: string | null; phrase: string; onDone: (d: Done) => void }) {
  const t = useTranslations('settings.data.deleteAll');
  // success is reported from inside the action (no effect: it would fire again on every re-render while closing)
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r && 'ok' in r) onDone(r);
    return r;
  }, null);
  const [typed, setTyped] = useState('');
  const error = state && 'error' in state ? state.error : null;
  return (
    <form action={formAction} className="grid gap-[var(--gp)]">
      {/* lets a password manager offer the right entry; the server never reads it */}
      <input type="text" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
      <FormField id="delete-password" label={t('password')} error={error === 'wrong_password' || error === 'missing_password' ? t(`errors.${error}`) : undefined}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" required />}
      </FormField>
      <FormField id="delete-phrase" label={t('phrase', { phrase })} error={error === 'phrase' ? t('errors.phrase') : undefined}>
        {(p) => <Input {...p} name="phrase" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />}
      </FormField>
      {error && !['wrong_password', 'missing_password', 'phrase'].includes(error) ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t('cancel')}
          </Button>
        </ResponsiveDialogClose>
        <LoadingButton type="submit" variant="destructive" pending={pending} disabled={typed !== phrase}>
          {t('confirm')}
        </LoadingButton>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** "Delete all data" (Plan 16c): a destructive button, then a dialog asking for the password and a typed word. */
export function DeleteAllData({ action, email, phrase }: { action: Action; email: string | null; phrase: string }) {
  const t = useTranslations('settings.data.deleteAll');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  return (
    <div className="grid gap-[var(--gp)]">
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogTrigger asChild>
          <Button type="button" variant="destructive" className="justify-self-start">
            {t('open')}
          </Button>
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('dialogTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('dialogBody')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <DeleteForm
            action={action}
            email={email}
            phrase={phrase}
            onDone={(d) => {
              setDone(d);
              setOpen(false);
              router.refresh();
            }}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <div role="status" className="grid gap-1 text-sm">
        {done ? <p>{t('done', { count: done.accounts })}</p> : null}
        {done && !done.coversDone ? <p className="text-destructive">{t('coversLeft')}</p> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5 — `components/settings/sections/DataSection.tsx`** (replace the whole file):

```tsx
import { getTranslations } from 'next-intl/server';
import { DataExport } from '@/components/settings/DataExport';
import { DeleteAllData } from '@/components/settings/DeleteAllData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteAllDataAction } from '@/app/(app)/settings/data-actions';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { DELETE_PHRASE } from '@/lib/data/delete';
import { EXPORT_TABLES } from '@/lib/data/export';
import { readUsage } from '@/lib/data/usage';
import { formatBytes, formatCompact } from '@/lib/format';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';

const ITEMS = ['insights', 'covers', 'comments', 'delete', 'privacy'] as const;

/** Settings -> Data & privacy (Plan 16c): what is stored, storage used, export all, delete all. */
export async function DataSection() {
  const { email } = await requireOwner();
  const [t, prefs, db] = await Promise.all([getTranslations('settings.data'), getPrefs(), createServerSupabase()]);
  const [usage, accounts] = await Promise.all([readUsage(db), supabaseAccountsStore(db).list().catch(() => [])]);
  const username = new Map(accounts.map((a) => [a.id, `@${a.username}`]));
  return (
    <div className="grid gap-[var(--gp)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {ITEMS.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('usage.title')}</CardTitle>
          <CardDescription>{t('usage.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)] text-sm">
          {usage ? (
            <>
              <p>
                <span className="font-medium">{t('usage.database')}: </span>
                <span className="tabular-nums">{formatBytes(usage.database, prefs)}</span>
                <span className="block text-muted-foreground">{t('usage.databaseHint')}</span>
              </p>
              <table className="w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-normal">{t('usage.group')}</th>
                    <th scope="col" className="py-1 pr-2 text-right font-normal">{t('usage.rows')}</th>
                    <th scope="col" className="py-1 text-right font-normal">{t('usage.size')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usage.groups.map((g) => (
                    <tr key={g.id}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal break-words">{t(`usage.groups.${g.id}`)}</th>
                      <td className="py-1 pr-2 text-right tabular-nums">{formatCompact(g.rows, prefs)}</td>
                      <td className="py-1 text-right tabular-nums">{formatBytes(g.bytes, prefs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid gap-1">
                <p className="font-medium">{t('usage.covers')}</p>
                {usage.covers.length === 0 ? (
                  <p className="text-muted-foreground">{t('usage.noCovers')}</p>
                ) : (
                  <ul className="divide-y">
                    {usage.covers.map((c) => (
                      <li key={c.folder} className="flex flex-wrap justify-between gap-x-2 py-1">
                        <span className="min-w-0 break-words">{username.get(c.folder) ?? t('usage.unlinked')}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {t('usage.images', { count: c.files })} · {formatBytes(c.bytes, prefs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t('usage.needsUpdate')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('export.title')}</CardTitle>
          <CardDescription>{t('export.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataExport items={EXPORT_TABLES.map((x) => ({ name: x.name, label: t(`tables.${x.name}`), thirdParty: 'thirdParty' in x && x.thirdParty === true }))} />
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>{t('deleteAll.title')}</CardTitle>
          <CardDescription>{t('deleteAll.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)] text-sm">
          <p>{t('deleteAll.removes')}</p>
          <p>{t('deleteAll.keeps')}</p>
          <p className="text-muted-foreground">{t('deleteAll.instagram')}</p>
          <DeleteAllData action={deleteAllDataAction} email={email} phrase={DELETE_PHRASE} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6 — remove the placeholder key** (only the old section read it): in `messages/en.json` delete the line `      "soon": "Export and delete-everything tools are coming.",` and in `messages/zh-CN.json` the line `      "soon": "导出和全部删除工具即将推出。",` (text edits; nothing else changes).
- [ ] **Step 7 — look at it** (`npm run dev`, owner session needed; if no login is available locally, `/styleguide` cannot show it: then rely on the tests and say so in the report): 360 / 768 / 1280 px, light and dark of two themes; no horizontal scroll (long zh-CN table names wrap; the single-files rows wrap their button under the label at 360 px); the dialog is a bottom sheet below `md`.
- [ ] **Verify:** `npx vitest run tests/settings-data.test.tsx tests/data-privacy-guard.test.ts tests/settings-page.test.tsx tests/ui-standards.test.ts tests/messages.test.ts tests/comments-privacy.test.ts tests/followers-privacy.test.ts tests/moderation-privacy.test.ts` → pass; `npx tsc --noEmit`; `npx eslint components/settings/DataExport.tsx components/settings/DeleteAllData.tsx components/settings/sections/DataSection.tsx tests/settings-data.test.tsx tests/data-privacy-guard.test.ts`.
- [ ] **Commit:** `git add components/settings/DataExport.tsx components/settings/DeleteAllData.tsx components/settings/sections/DataSection.tsx tests/settings-data.test.tsx tests/data-privacy-guard.test.ts messages/en.json messages/zh-CN.json`, `git commit -m "feat(settings): Data & privacy with storage used, export all and delete all" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 7: runbook and docs

**Files:** Create `docs/RUNBOOK_DATA.md`. Modify `docs/RUNBOOK_SETTINGS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/OWNER_ACTIONS.md`. Docs are CRLF; use the Edit / Write tools.

- [ ] **Step 1 — `docs/RUNBOOK_DATA.md`** (new, exactly):

````markdown
# Runbook: Data & privacy (Plan 16c) — live checks

Plan 16c is code complete on local `main`, NOT pushed. Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app, in this order. Report yes/no and counts only (file contents hold other people's names: never paste them into a chat or an issue).

## 0. The migration — on the owner's go-ahead, before relying on Storage used or Delete all
`supabase/migrations/20261031000001_data_privacy.sql` adds two functions and nothing else: `data_usage()` (owner-only sizes, SECURITY DEFINER) and `delete_all_data()` (executable by the service role only). It is NOT applied.
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect 20261031000001 pending (and 20261030000001 if 16a's is still pending), nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs rpc:data_usage:'{}'          # before: 404 PGRST202 (does not exist)
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file(s)
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs rpc:data_usage:'{}'          # after: 401 with code 42501 (exists, anon is denied)
```
Then, Supabase dashboard → SQL editor (read-only queries; the owner runs them):
```sql
select r, has_function_privilege(r, 'public.delete_all_data()', 'execute') as can_delete,
          has_function_privilege(r, 'public.data_usage()', 'execute') as can_read_usage
  from unnest(array['anon', 'authenticated', 'service_role']) as r;
```
Expected: `anon` false / false, `authenticated` **false** / true, `service_role` true / true. If `authenticated` can execute `delete_all_data`, STOP and report (the password re-check would then be UI-level only). Do NOT run `select public.delete_all_data()` in the SQL editor: it deletes everything.

Without the migration: Storage used says "Storage figures need a database update", Delete all answers "This needs a database update first. Nothing was deleted.", the export works.

## 1. Storage used (L2: the definer reads Storage)
1. Settings → Data & privacy: four cards (What in2sight stores, Storage used, Export your data, Delete all data).
2. Storage used shows the database total, five groups with rows and sizes, and "Cover images" per account (`@username`, image count, size). Compare: Supabase → Reports / Database size (about the same as "Database in total"); Storage → `covers` bucket size ≈ the sum of the cover lines. If the whole card says "needs a database update" although §0 passed: the function cannot read `storage.objects` (L2): report the error from Supabase → Logs → Postgres.
3. A row count "—" means the table was never analysed: normal for a new, small table.
4. A line "Not linked to an account" = cover images of an account that no longer exists (left by an interrupted delete or a sync that was mid-run): Delete all data removes them; nothing else reads them.

## 2. Export your data (L1: keyset paging on the real PostgREST)
1. Leave "Include other people's data" unticked → "Download all files". The browser may ask once to allow several downloads: allow. Progress "Downloading file 3 of 18…", then "18 files downloaded."
2. The download folder has 18 files `in2sight-<table>-<date>.json`, NO `comments` and NO `follower_exports` file.
3. **No secrets:** in PowerShell in the download folder: `Select-String -Path in2sight-*.json -Pattern 'access_token','IGAA','EAA','p256dh','refresh_token' -List` → no output. (`api_snapshots` has an `endpoint` field: an API path without a token, by design.)
4. **Paging is complete (L1).** Pick the biggest file (usually `media_metrics` or `follower_snapshots`; it must have more than 1,000 rows to prove anything): `(Get-Content in2sight-media_metrics-*.json -Raw | ConvertFrom-Json).Count` and, SQL editor, `select count(*) from public.media_metrics;` → the same number (a sync may add a few rows in between: run both within a minute, or compare again). Also check no duplicates: `$r = Get-Content in2sight-media_metrics-*.json -Raw | ConvertFrom-Json; ($r | ForEach-Object { "$($_.media_id)|$($_.captured_at)" } | Sort-Object -Unique).Count` equals the count. Different numbers = L1 failed: stop and report (the export is then not trustworthy).
5. Each file opens as valid JSON (`ConvertFrom-Json` above did not error).
6. Single files: open "Single files", download `comments` (marked "Other people's data"): one file. Tick the box and "Download all files" again: 20 files. **Delete the files with other people's data when done.**
7. Time: DevTools → Network, the slowest `/api/export/data?table=…` request: note its time. Over 40 s = close to the 50 s budget: report it (the plan's `?after=` follow-up).
8. Signed out (private window), open `/api/export/data?table=media` → no file (sign-in page or 401). `/api/export/data?table=account_tokens` signed in → `{"error":"bad_params"}`.

## 3. Delete all data (DESTRUCTIVE)
### 3.1 Refusals (safe: nothing is deleted)
1. "Delete all data…" opens a dialog (bottom sheet on a phone). "Delete everything" stays disabled until `DELETE` is typed exactly (`delete`, ` DELETE` keep it disabled).
2. A wrong password + `DELETE` → "The password is wrong." on the password field; the dialog stays open; nothing changed (Accounts page still lists every account).
3. Five wrong passwords → "Too many attempts. Wait a few minutes and try again." (a cookie limit shared with Change password; a private window resets it: expected).
4. Cancel / Esc closes the dialog; reopening shows empty fields and no old error.
### 3.2 Before a real delete
1. Export first (§2) if you want a copy. 2. Decide whether you are done with in2sight's Instagram access (§3.4).
### 3.3 The real delete (only when you want everything gone; L3: pg-safeupdate)
1. Password + `DELETE` → "All data of N accounts was deleted." The dialog closes.
2. Accounts page: empty (Connect again works and starts a NEW history). Overview: the empty state. Settings → Data & privacy → Storage used: groups near zero rows, "No cover images are stored." Supabase → Storage → `covers`: empty.
3. Kept: you are still signed in, 2FA still asked at the next sign-in, theme / language / alert rules unchanged, push notifications still allowed on this device.
4. "Some cover images could not be removed yet…" → run Delete all data again after a minute (it deletes nothing else and finishes the images).
5. An error "Something went wrong…" → nothing was deleted from the database (one transaction); report the time; check Supabase → Logs → API for `POST /rest/v1/rpc/delete_all_data` and its status (a 400 mentioning "DELETE requires a WHERE clause" would mean L3 failed: the code already sends `where true`, so report it).
6. Audit: Supabase → Logs → API shows the `POST /rest/v1/rpc/delete_all_data` line with the time (this is the record of the delete); Vercel → Logs shows the POST to `/settings/data`.
### 3.4 Instagram (L5)
in2sight does not revoke its Instagram access itself. In the Instagram app: Settings → Website permissions → Apps and websites (labels may differ) → remove in2sight. Meta then calls the app's deauthorize URL: it finds no account and does nothing (check Vercel → Logs: a 200 on `/api/instagram/deauthorize`, nothing else).

## 4. Inside a tab frame and on a phone
1. Settings → Data & privacy opened as a shell tab: Download all files works from inside the frame (files arrive); the delete dialog works.
2. 360 / 768 / 1280 px, light and dark of two themes: no horizontal scroll; long Chinese table names wrap; the "Download" buttons wrap under their label on a phone; the dialog is a bottom sheet below 768 px.

## 5. Privacy and logs
- Vercel → Logs: only request lines (`GET /api/export/data?table=…`, the settings POST); no row content, no names, no error objects.
- The export files hold your data and, if chosen, other people's names: keep them private; delete them when done.

## Known limits (by design)
No zip and no cover images in the export; one table per request within 50 s; row counts are estimates; no per-account database size; the app does not revoke the Instagram grant; a sync that is mid-run during a delete can leave one cover image ("Not linked to an account"; the next run removes it).

Record the outcomes here and tick `docs/TODO.md` §6q only after the owner has looked.
````

- [ ] **Step 2 — the other docs** (short, honest; "code done; live verification pending"):
  - `docs/RUNBOOK_SETTINGS.md` §5: replace the sentence `Data & privacy shows the "What in2sight stores" card; it is a placeholder until Plan 16c.` with `Data & privacy (Plan 16c): storage used, export your data and delete all data; live checks in docs/RUNBOOK_DATA.md.` (also replace the stale `it is a placeholder until Plan 16b adds password and sessions` with `password and sessions: docs/RUNBOOK_SECURITY.md`).
  - `docs/SPEC.md` §7k: replace `**Data & privacy** (what is stored; placeholder until Plan 16c adds storage, export all, delete all)` with `**Data & privacy** (Plan 16c: what is stored; storage used = table groups with estimated rows and sizes, cover images per account, database total via the owner-only SECURITY DEFINER function data_usage(); export = one JSON file per table streamed through the owner session (GET /api/export/data?table=, keyset pages, never tokens, push keys or bookkeeping; commenter names and follower lists only when the owner ticks the box or picks the file); delete all data = password re-check + typed DELETE → the service-role-only function delete_all_data() deletes every account (cascade), tags, saved views, notifications and the sync log in one transaction, then the cover images; keeps the login, 2FA, preferences, alert rules and push devices; docs/RUNBOOK_DATA.md)`. In §7c after "hard-deletes an archived account's rows (cascade)." add ` Settings → Data & privacy → Delete all data does the same for every account at once (Plan 16c).`
  - `docs/TODO.md` §6o: replace `[ ] Data & privacy is a placeholder until Plan 16c` with `[x] Data & privacy (Plan 16c, see 6q)`; add after the `## 6p` section:
    ```
    ## 6q. Data & privacy (Plan 16c)
    - [x] Storage used, export your data (JSON per table), delete all data (password + typed word) (code done on local `main`, NOT pushed; live verification pending: docs/RUNBOOK_DATA.md)
    - [ ] Apply migration `20261031000001_data_privacy` (owner go-ahead; RUNBOOK_DATA §0)
    - [ ] RUNBOOK_DATA §1–§5 walked through by the owner (§3.3, the real delete, only when the owner wants everything gone)
    - [ ] Live checks L1 (keyset on the real PostgREST), L2 (data_usage reads storage.objects), L3 (pg-safeupdate with `where true`), L5 (Instagram app removal) (plan 2026-10-31-16c)
    - Known: no zip and no cover images in the export; one table per request within 50 s; no per-account database bytes; the Instagram grant is removed by the owner in Instagram; a sync mid-run can leave one cover image (shown as "Not linked to an account", removed by the next run).
    ```
  - `docs/PROGRESS.md`: §2 table add a row `| Plan 16c (Data & privacy) | **code complete on local main, NOT pushed, nothing verified live.** Migration 20261031000001_data_privacy (two functions) NOT applied: apply on the owner's go-ahead (RUNBOOK_DATA §0); without it Storage used says "needs a database update" and Delete all refuses with nothing deleted; the export works without it |`; §3 add `- **16c: Data & privacy (code done on local main, NOT pushed, NOT verified live).** Storage used (data_usage(), SECURITY DEFINER, owner-only), export your data (one streamed JSON file per table through the owner session; third-party data only when chosen), delete all data (password + DELETE → service-role-only delete_all_data() in one transaction, then covers; idempotent). Plan: docs/superpowers/plans/2026-10-31-16c-data-privacy.md. Guard: tests/data-privacy-guard.test.ts.`; §5 add the row `| 20261031000001_data_privacy | data_usage() (owner-only sizes) and delete_all_data() (service_role only) (Plan 16c; **NOT applied**: owner go-ahead; RUNBOOK_DATA §0) |`; §6 add `9. **docs/RUNBOOK_DATA.md** (Plan 16c): §0 migration, §1 storage, §2 export (L1 keyset), §4 refusal paths; §3.3 the real delete only when the owner wants everything gone.`; §7 item 2: replace `Still to build: storage / export all / delete all (Plan 16c).` with `Storage / export all / delete all are built (Plan 16c), NOT pushed.`; §8 add `- 16c: delete all keeps login, 2FA, preferences, alert rules and push devices; password + typed DELETE (no extra TOTP); JSON per table, no zip, no covers in the export; third-party data only when ticked; the app does not revoke the Instagram grant; table groups + covers per account, no per-account database bytes.`; §11 add `- Data (16c): the export uses the owner session only (never the service role; account_tokens and push_subscriptions are never exported; a migration-scanning test refuses secret-looking columns); delete_all_data() is executable by service_role only, reached only through deleteAllDataAction after requireOwner + the password; no logging in the data files (tests/data-privacy-guard.test.ts).`
  - `docs/HANDOVER.md` START HERE block: one line `2026-10-31: Plan 16c (Data & privacy) built, not live; migration 20261031000001 NOT applied (RUNBOOK_DATA §0).`
  - `docs/OWNER_ACTIONS.md`: add `- Apply migration 20261031000001_data_privacy (Plan 16c) on your go-ahead, then RUNBOOK_DATA. After a "Delete all data", remove in2sight in Instagram (Settings → Apps and websites) if you are done with it.`
- [ ] **Verify:** the Markdown renders (tables intact); `npx vitest run tests/ui-standards.test.ts` (it reads docs/UI_STANDARDS.md only; unchanged).
- [ ] **Commit:** `git add docs/RUNBOOK_DATA.md docs/RUNBOOK_SETTINGS.md docs/SPEC.md docs/TODO.md docs/PROGRESS.md docs/HANDOVER.md docs/OWNER_ACTIONS.md`, `git commit -m "docs(data): runbook, spec, todo, progress for data and privacy" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

## Scratch-run result (2026-10-27, throwaway clone and PGlite OUTSIDE the repo)

**Code (clone of `main` at `e126028`, own `npm ci`, the real `node_modules` untouched):** every file of Tasks 1–6 written as in this plan (end state of Task 6: `settings.data.soon` removed). `npm run check`: **lint clean, `tsc` clean, 303 test files / 3,077 tests green, `next build` green** (the route list shows `ƒ /api/export/data`). Verified along the way: `Response.blob()` / `.text()` REJECT when the stream is errored midway (so a broken export is never saved), a failed page never leaks the Supabase message, the keyset filter strings, the empty-page stop and the repeated-cursor stop, the action order, `changePassword` unchanged (16b's tests untouched and green).

**Found by the dry run and fixed in this plan:** (1) three existing privacy guards (`tests/comments-privacy.test.ts`, `tests/followers-privacy.test.ts`, `tests/moderation-privacy.test.ts`) deliberately forbid any new module touching `comments`, `follower_exports` and the `moderation_*` tables: Task 4 Step 8 admits `lib/data/export.ts` (and `lib/data/usage.ts` for the follower table's name) as a reviewed policy change; (2) moving `checkClient` out of the `'use server'` file required re-pinning two 16b guard assertions (Task 3 Step 7); (3) the first `formatBytes` draft rolled 1,023.96 KB into "1,024 KB" (test row added); (4) the migration test's statement split must ignore the semicolons inside `$$` bodies.

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; all 15 existing migrations, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.mfa_factors` / `storage.objects`; roles `anon`, `authenticated`, `service_role` (bypassrls) with Supabase-like default privileges), 20 of 20 checks passed:**
- the migration applies on top of the existing 15; `data_usage()` as the owner: 24 table rows (no `account_tokens`), each with a size, row estimate 2 for `accounts` after `analyze`, covers grouped per account folder (other buckets ignored), one database row; a non-owner: 0 rows; the owner at aal1 with a verified factor: 0 rows; at aal2: all 27 rows; `anon`: permission denied;
- `delete_all_data()`: `authenticated` at aal2 → permission denied, `anon` → permission denied, `service_role` → `{"accounts": 2, "tags": 1, "views": 1}`; afterwards all 23 data tables empty (incl. `account_tokens`, `comments`, `follower_exports`, `moderation_*`, `media_tags` via `media`, the account-less notification, `sync_runs`); kept: `owners` 1, `profiles` 1, `push_subscriptions` 1, `auth.users` 1, the 2FA factor 1, `storage.objects` untouched (4); a second call returns zeros; a failure injected on the third delete (a trigger on `explorer_views`) rolled back the earlier deletes of `accounts` and `tags` (one transaction).

**Not executed:** a real PostgREST (L1: the `or=(…)` keyset syntax with quoted timestamps; the 1,000-row cap), Supabase's grants on `storage.objects` for the definer (L2), pg-safeupdate (L3; PGlite does not load it), Supabase Storage list/remove (faked in tests), a browser (multiple-download prompt, the dialog at 360 px), Vercel streaming and its duration limit, any Meta call.

## Self-review

- Spec coverage: storage used (Task 2 `data_usage`, Task 3 `formatBytes`, Task 4 `usage.ts`, Task 6 card), export all with third-party choice, 1,000-row cap, streaming, time and size limits, no tokens (Tasks 4, 6), delete all with re-auth, typed word, order, atomic SQL, idempotent covers, service-role-only (Tasks 2, 5, 6), i18n en + zh-CN (Task 1), guard (Task 6), runbook and docs (Task 7). Meta callbacks: read, reused as-is (no-op after delete).
- Names checked against the code by grep: `requireOwner`, `assertOwner`, `createServerSupabase({ responseHeaders })`, `createAdminSupabase`, `getPrefs`, `localDay`, `exportHeaders`, `exportError`, `contentDisposition`, `filenameFromDisposition`, `downloadExport`, `removeAccountCovers`, `COVERS_BUCKET`, `supabaseAccountsStore().list`, `PASSWORD_COOKIE`, `PASSWORD_LIMIT`, `readAttempts`, `isLimited`, `bumpAttempts`, `attemptCookieOptions`, `isRateLimited`, `PasswordInput`, `FormField`, `LoadingButton`, `ResponsiveDialog*`, `Checkbox`, `Label`, `Badge`, `formatNumber`, `formatCompact`, `isNum`, `DASH`, `export.errors.*`.
- Type consistency: `DeleteState` / `DELETE_PHRASE` live in `lib/data/delete.ts` (Task 5); the client component imports the TYPE only and gets the phrase as a prop from the server section (no server module in the client bundle). `DownloadFormat` widens only `downloadExport`, not the export dialog's `ExportFormat`.
- Cross-task file edits: `messages/*.json` by Task 1 (wave 1, adds) and Task 6 (wave 3, removes the placeholder line); the three privacy guards only by Task 4; `lib/auth/password.ts` only by Task 3 (Task 5 imports it, wave 2).
