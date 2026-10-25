# Plan 15d: Comment moderation (reply, hide, delete, banned-word and spam auto-hide, undo log) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** From the account page the owner can **reply** to a comment, **hide / unhide** it and **delete** it on Instagram, each behind a confirm dialog; every action (the owner's and the automation's) lands in an append-only **moderation log** with an **Undo** for hide (unhide) and reply (delete the reply); per account the owner writes **banned words** and switches on four built-in **spam patterns** (links, many @mentions, repeated characters, emoji floods), sees a **preview** of what would be hidden, and may switch on **auto-hide**, which the sync tick runs after everything else, capped, idempotent, never fighting a manual decision, and pausing itself (one notification) when Instagram refuses. **Delete is irreversible on Instagram and is never automated.**

**Architecture:** One server-side Meta write module, `lib/instagram/moderation.ts` (plain `fetch` through the existing `call()` of `lib/instagram/oauth.ts`; fixed error messages; tokens only in the request; a 5 s timeout), and one error classifier `classifyModerationError` mapping Meta answers to UI error KEYS. Owner actions are server actions (`app/(app)/accounts/moderation-actions.ts`: `requireOwner()` first) that call the pure-ish service `lib/moderation/service.ts`: validate → account (owner session: active, comments scope) → the comment belongs to THAT account (owner session) → per-minute cap → **log row first** (`result = 'pending'`, unique `request_id` from the dialog = double-submit guard) → token (admin client, `account_tokens`, server only) → Meta → finish the log row (`ok` / error key) → local state (`comments.hidden`, or the row removed after a delete). Every SQL statement on the new tables lives in ONE module, `lib/moderation/store.ts` (functions taking a Supabase client: the owner session for the app, the admin client for the tick). Rule matching is a pure function (`lib/moderation/rules.ts`: `fold`, `matchRule`, `pickAutoHide`, `touchedIds`). Auto-hide is a separate pass of the tick, `runAutoHide` (`lib/moderation/auto.ts`), started **after the alerts** with its own budget, reading only comments already ingested by the existing comments job, never throwing. A pause becomes ONE notification through the existing alert pipeline (new kind `moderation_paused`, dedupe key per pause). UI: `CommentActions` (a row menu for 15c's `CommentsTab` `renderActions` slot) and a new account tab **Moderation** (`ModerationTab`: auto-hide, rules, preview, log with pages). One migration (`20261029000002_comment_moderation.sql`); without it the tab says "needs a database update", the actions answer `not_ready` and the tick skips moderation.

**Tech Stack:** Next.js 16.4 App Router (server actions), React 19.3, TypeScript strict, Supabase Postgres (RLS), next-intl 4, shadcn/Radix via the shared pieces (`ConfirmDialog` with `requireText`, `ResponsiveDialog*`, `DropdownMenu`, `Switch`, `Textarea`, `Input`, `Checkbox`, `EmptyState`, `LoadingButton`, `Pagination`, `FormField`), Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Comments: read + reply/hide/delete from the app … every action confirmed and logged"; round 3 "auto-hide with banned words + spam patterns, every action reversible and listed in an undo log"), §2 (commenter usernames need `instagram_business_manage_comments`), §8 (owner-authored tables with `is_owner()`; third-party data owner-only, never logged, deleted with the account; scope change → "Reconnect to enable comments"; features degrade without the scope). UX rules: `docs/UI_STANDARDS.md` (1–15). Project rules: `CLAUDE.md` (binding). Built **after Plan 15c** (read-only comment insights and the Comments tab; `docs/superpowers/plans/2026-10-29-15c-comment-insights.md`): see "Contract with Plan 15c".

**Scratch run:** see "Scratch-run result" at the end (what was executed in a throwaway clone outside the repo, and what was not: the SQL on a real database, the build, a browser, and every Meta write call — those are live probes, `docs/RUNBOOK_MODERATION.md` §1, BEFORE auto-hide is switched on).

## Meta endpoints this plan relies on (Instagram API with Instagram Login, host `graph.instagram.com`, version `IG_API_VERSION`, default `v25.0`)

Sources (read 2026-10-25): IG Comment reference <https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment> (also `/docs/instagram-platform/instagram-graph-api/reference/ig-comment`), Comment Moderation guide <https://developers.facebook.com/documentation/instagram-platform/comment-moderation>, error handling <https://developers.facebook.com/docs/graph-api/guides/error-handling/>, rate limiting <https://developers.facebook.com/docs/graph-api/overview/rate-limiting/>.

| Action | Request | Documented response | Documented rules |
|---|---|---|---|
| Hide / unhide | `POST /{ig-comment-id}?hide=true` / `hide=false` | `{"success": true}` | token of "the user who owns the media object that was commented on"; "Comments made by media object owners on their own media objects will always be displayed"; live-video comments not supported |
| Reply | `POST /{ig-comment-id}/replies` with `message` | `{"id": "<new comment id>"}` | creates an IG Comment on the IG Comment |
| Delete | `DELETE /{ig-comment-id}` | `{"success": true}` | "A comment can only be deleted by the owner of the object upon which the comment was made"; live-video comments not supported |
| Permissions | `instagram_business_basic` + `instagram_business_manage_comments` (Instagram User token; Standard Access for accounts the owner manages, no App Review) | | already in `IG_SCOPES` (`lib/instagram/oauth.ts`); stored per account in `accounts.granted_scopes` |
| Errors | Graph error object `{ error: { code, error_subcode, message } }`; `190`/`102`/`200–299` auth or permission, `10` permission denied, `4` app rate limit, `17`/`32`/`613`/`80002` rate limits, `100`+subcode `33` object missing (already `IG_ERROR` in `lib/instagram/metrics.ts`) | | rate limits for these writes are NOT documented separately (Instagram BUC: calls per 24 h scale with impressions; the guide recommends webhooks "to prevent rate limiting") |

Everything not in this table is an **Open question with a live probe** (below, P1–P8).

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **What "every action reversible" means here** (Meta forces it): **hide ⇄ unhide** (Undo = unhide), **reply → delete the reply** (Undo = `DELETE /{reply-id}`), **delete = irreversible on Instagram**: a stronger confirm (type the word `DELETE` / `删除`) that states it cannot be undone, and **never done by automation** (auto-hide only hides). The log lists every action either way.
- **Order of writes and the repair rule (partial failure).** Each action = (1) insert the log row with `result = 'pending'` and the dialog's `request_id` (unique) → (2) Meta call → (3) update the row to `ok` or an error key (and `target_id` = the reply's id) → (4) local state. Consequences: **no Instagram write without a log row** (if (1) fails, nothing is sent: `unexpected`/`not_ready`); **a double submit cannot write twice** (the second insert hits the unique `request_id` → `duplicate`, no Meta call); **Meta OK but (3) failed** → the row stays `pending`; after `PENDING_STALE_MS = 120_000` the log shows it as **"Outcome unknown — check on Instagram"**, the comment counts as touched for auto-hide (never retried automatically), hide/unhide can simply be repeated by the owner (idempotent on Instagram, P3), a reply in that state has no Undo (no id). **Meta failed but (3) failed too** → same `pending` → "unknown"; nothing else is retried. (4) failing only leaves the local `hidden` flag stale until the next action; it never fails the action.
- **Wrong account / wrong comment guard:** the action takes `(accountId, commentId)`; the server re-reads the comment with **both** filters through the owner session (`comments.id = commentId and account_id = accountId`) and refuses with `not_found` otherwise; the token is read for THAT account id only; undo targets (`comment_id`, `target_id`) come only from the stored log row (selected with `account_id`), never from the browser. Instagram itself refuses a token of another account (owner of the media only).
- **Stale comment id:** Meta `100/33` → `comment_gone`: the log row records it and the local comment row is removed (it no longer exists on Instagram; less third-party data kept).
- **Local hidden state:** `comments.hidden` (exists since 11b, default false, never written by the sync's upsert — `upsertComments` does not send the column, so a re-ingest keeps our value) is set by our own actions only. Comments hidden or unhidden inside the Instagram app are NOT seen (the read does not request `hidden`; P5 decides whether to add it later). ⚠ Open question 5.
- **Own comments:** the account's own comments (author = the account's username, case-insensitive) cannot be hidden ("always displayed" per Meta): the Hide item is disabled with a reason, the server answers `not_allowed` without calling Meta, and auto-hide skips them. Reply and delete stay available.
- **Rules are owner-authored rows** (table `moderation_rules`, RLS `is_owner()`): `word` rows (pattern ≤ 50 characters, "whole word only" flag, at most `MAX_WORD_RULES = 200` per account) and at most one row per spam kind (`link`, `mentions`, `repeat`, `emoji`; a row = switched on). Rule ids appear in the log as the actor `rule:<uuid>`; a deleted rule shows as "a removed rule". Thresholds are constants, not settings (YAGNI): `REPEAT_MIN = 8` same characters in a row, `MENTIONS_MIN = 4` @mentions, `EMOJI_MIN = 10` emoji with at most `EMOJI_TEXT_MAX = 3` letters/digits. ⚠ Open question 6.
- **Matching (`matchRule`, pure, exact algorithm in Task 3):** text and patterns are folded the same way: Unicode **NFKC** (full-width ＡＢＣ１２３／． → ASCII; half-width katakana → full-width), `toLowerCase()`, zero-width characters (`U+200B–U+200D`, `U+2060`, `U+FEFF`) removed, whitespace runs collapsed to one space, trimmed. A word rule is a **substring** match unless "whole word only" is on AND the pattern has no CJK character (Han, Hiragana, Katakana, Hangul have no word spaces: always substring); whole word = no letter, digit or `_` directly before or after. Simplified ⇄ Traditional Chinese folding is NOT done (a `后` rule does not catch `後`; the owner adds both) — ⚠ Open question 7. First match wins in the order: word rules (oldest first), then `link`, `mentions`, `repeat`, `emoji`.
- **Auto-hide (default OFF per account; table `moderation_settings`):** switching it on opens a confirm with the **preview count** ("{count} comments that are already here would be hidden, up to 20 every 30 minutes"); the tab always shows the current matches (count + up to 5 examples). It applies to **every ingested visible comment that matches** (also older ones the preview showed), ⚠ Open question 4. It runs **only** when the account is `active`, has `instagram_business_manage_comments` in `granted_scopes`, auto-hide is on and not paused.
- **The tick pass (exact algorithm in Task 8):** after lane 1, lane 2 AND the alerts, so it can never take time from sync or alerts; window = until `TICK_BUDGET_MS + ALERT_BUDGET_MS + MODERATION_BUDGET_MS` = 35 + 10 + 5 = **50 s** after the tick start, each call times out after **5 s** (worst case 55 s < the route's `maxDuration = 60`). Per account and tick at most `AUTO_HIDE_PER_TICK = 20` hides, scanning the newest `CANDIDATE_SCAN = 200` visible comments. **Idempotent and never fighting the owner:** a comment is skipped ("touched", `touchedIds`) when ANY log row of the owner exists for it (a manual unhide therefore exempts it forever; so does a manual hide, reply or delete), when any row ended in a non-retryable result (`ok`, `pending`, `not_allowed`, `comment_gone`, `reconnect`, `unexpected`, …), or after `MAX_AUTO_TRIES = 3` rule attempts; only `rate_limited` / `instagram_unavailable` rule attempts are retried on a later tick. **Stops:** a rate limit stops that account for this tick (an app-wide one stops the pass); a permission answer **pauses** auto-hide (`pause_reason = 'reconnect'`); `FAIL_LIMIT = 3` failures in a row **pause** it (`'failing'`). A pause is lifted only by the owner (switching it on again). **Failures are isolated per account** (try/catch per account; the pass never throws; the tick wraps it once more).
- **One notification per pause, not a storm:** the alert rules (next tick) see `moderation_settings.paused_at` and create `moderation_paused` with the dedupe key `moderation_paused:<account>:<paused_at>`; push follows the owner's per-kind toggle (new switch in Settings → Notifications, default on). The payload carries only `{ username }` (the account's own name): no comment text, no commenter name, no counts.
- **Manual-action cap:** at most `MANUAL_PER_MINUTE = 30` owner actions per account per rolling minute (a UI bug or a stuck key cannot hammer Instagram): `too_many`. No bulk actions (YAGNI).
- **Reply:** 1 to `REPLY_MAX = 2200` characters after trimming (Instagram's comment length, P6), sent as `message`; the reply text is **not stored** (the log keeps the reply's id for Undo) and never logged. A reply whose outcome is unknown (network error, 5xx, timeout: Instagram may have posted it) answers `unknown_outcome` ("It may have been posted. Check on Instagram before sending again.") instead of inviting a duplicate.
- **Errors are keys** (`ModerationError`): `invalid | not_found | not_active | reconnect | duplicate | too_many | already_done | cannot_undo | not_ready | rate_limited | comment_gone | not_allowed | instagram_unavailable | unknown_outcome | unexpected`. A manual action never changes the account's status (the sync owns `needs_reconnect`); `reconnect` tells the owner to reconnect.
- **The log stores the minimum:** account, comment id, action, actor, request id, result, target id (reply id), undo link, times. **No comment text, no author name, no reply text.** The log view joins `comments` by id for context (author + the first 80 characters) while the comment is still stored; otherwise "Comment no longer stored". Rows are append-only from the app (select/insert for the owner, update only of `result`, `target_id`, `undone_at`; no delete grant); they go with the account (`on delete cascade`).
- **Placement:** Reply / Hide / Delete live on each comment row of 15c's Comments tab (one "Moderate" menu button per row, `size="sm"` inside the dense list, UI standard 5); rules, auto-hide, preview and the log live in a new account tab **Moderation** (`?tab=moderation`, after `comments`), ⚠ Open question 8. No range bar there (list page, UI standard 4).
- **Scope gating:** without the scope (or for a non-active account) the row menu is not rendered and the Moderation tab shows "Reconnect to enable comments" with a link to `/accounts`; the server refuses with `reconnect` regardless of the UI.
- **No new dependencies, no new design tokens, no changes to `COMMENT_FIELDS` or the comments ingest, no webhooks** (the tick reads what the hourly comments job already stored; webhooks would need a public endpoint and app review of the `comments` field: later).

## Open questions for the owner (the plan implements the default shown; P = needs a live probe BEFORE auto-hide is enabled, `docs/RUNBOOK_MODERATION.md` §1)

1. **P1** — Do hide / unhide / reply / delete work with the current Instagram Login tokens of the reconnected accounts (scope granted, Standard Access)? **Default: assume yes; Runbook §1 tests each on a throwaway comment on the owner's own test post FIRST.** If a write answers a permission error, the feature stays off (the code already maps it to `reconnect`).
2. **P2** — Rate limits for writes (undocumented): **default caps 20 automatic hides per account per tick (≤ 960 a day) and 30 manual actions per minute.** The calls run on the server, so the runbook cannot see Meta's usage headers; it watches the log for `rate_limited` instead (Runbook §4) and the caps are lowered if it ever appears.
3. **P3** — Hiding an already hidden comment (or unhiding a visible one): `success: true` or an error? **Default: our own state short-circuits (`already_done`, no call); if Meta answers an error the classifier maps it to `not_allowed`.**
4. Auto-hide also hides matching comments that arrived BEFORE it was switched on (the preview shows them)? **Default: yes.** Alternative: only comments first seen after switching on (one `first_seen_at` filter).
5. **P5** — Does `GET /{media-id}/comments` return hidden comments, and with which `hidden` value? If yes, a follow-up can add `hidden` to `COMMENT_FIELDS` so hides done inside the Instagram app show here. **Default: not in this plan** (no change to the sync read).
6. Spam thresholds 8 repeated characters / 4 @mentions / 10 emoji with ≤ 3 letters? **Default: yes** (constants in `lib/moderation/rules.ts`).
7. No Simplified ⇄ Traditional Chinese folding (add both forms)? **Default: yes** (folding tables would be a dependency).
8. Moderation as its own account tab (rather than a section of the Comments tab)? **Default: yes.**
9. **P4** — Does a reply count in the post's `comments_count` (it would make the comments job re-read the post)? **Default: harmless either way** (the job upserts by id; replies are not top-level).
10. **P6** — Reply length: 2,200 characters accepted? Emoji, `@mentions` and hashtags in replies accepted? **Default: 2,200, sent as typed.**
11. **P7** — `message` sent form-encoded in the POST body (the guide shows JSON) and `access_token` in the query like every existing call: accepted? **Default: yes** (the Graph API accepts both encodings; the probe confirms).
12. **P8** — Deleting the owner's own reply with `DELETE /{reply-id}` (Undo of a reply) works with the same token? **Default: yes** (the owner created it and owns the media).

## Assumptions about the current code (`main` at `222efd1`, read for this plan)

- `lib/instagram/oauth.ts`: `call(kind, fetchFn, url, init?)` (throws `InstagramApiError(kind, status?, code?, subcode?, unsupported)` with fixed messages; never the body), `InstagramApiError`, `graphInit()` (10 s timeout, `redirect: 'error'`), `IG_SCOPES` (already includes `instagram_business_manage_comments`). `lib/instagram/data.ts`: `classifyIgError(e): 'auth' | 'app_rate_limit' | 'rate_limit' | 'no_data' | 'gone' | 'transient' | 'other'` (auth = 190/102/200–299 or HTTP 401; `no_data` = code 10 or 100/2108006 — for WRITES code 10 means "permission denied", so `classifyModerationError` checks 10 first), `HOST` is module-private (`https://graph.instagram.com`). `lib/instagram/metrics.ts`: `IG_ERROR`, `COMMENT_FIELDS = 'id,text,timestamp,username,like_count'` (unchanged here). `lib/env.ts`: `getInstagramEnv()` → `{ apiVersion }` (default `v25.0`), throws `EnvError`.
- `lib/accounts/scopes.ts`: `COMMENTS_SCOPE`, `hasScope(account, scope)`. `lib/accounts/types.ts`: `StoredAccount { id, username, status: 'active' | 'needs_reconnect' | 'archived', grantedScopes?, … }`; `supabaseAccountsStore(db).list()` maps `granted_scopes` (so `loadAccounts()` in the page carries it).
- Comments: table `public.comments (id text pk, account_id, media_id, parent_id, author_username, author_id, text, like_count, commented_at, hidden boolean not null default false, first_seen_at, last_seen_at)`, owner **select** only (`revoke all … from anon, authenticated; grant select … to authenticated`), cascade from accounts and media (`20261022000001_capture_v2b.sql`). The sync's `upsertComments` (`lib/sync/store.ts`) writes `id, account_id, media_id, author_username, text, like_count, commented_at, last_seen_at` — never `hidden`.
- Sync: `runTick(deps: TickDeps, opts)` (`lib/sync/tick.ts`): `TICK_BUDGET_MS = 35_000`, lanes, then `runAlerts(...)` with `deadline + ALERT_BUDGET_MS` (`lib/alerts/run.ts`, `ALERT_BUDGET_MS = 10_000`), then `recordRun({ summary })` into `sync_runs` (counts only). `TickDeps { store, accounts, ig, alerts?, clock?, newId?, cdnFetch? }`; `createSyncDeps()` (`lib/sync/deps.ts`) builds them with ONE admin client. `SyncStore.getToken(accountId)` reads `account_tokens` (admin client only). Route `app/api/cron/tick/route.ts` `maxDuration = 60`.
- Alerts: `ALERT_KINDS` / `DEFAULT_ALERT_SETTINGS` / `parseAlertSettings` (`lib/alerts/settings.ts`), `evaluateRules(RuleInput)` with `RULES` (`lib/alerts/rules.ts`), `AlertStore` + `supabaseAlertStore` (`lib/alerts/store.ts`), `runAlerts` (`lib/alerts/run.ts`: per-account `Promise.all([daily, posts, lastReachDropAt])`), `alertHref` (`lib/alerts/message.ts`), `rowToNotification` drops unknown kinds (`lib/alerts/read.ts`), `AlertSettingsForm` renders one switch per `ALERT_KINDS` labelled `notifications.kinds.<kind>.title`. DB: `notifications.kind` has the inline check `kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off')` (`20261018000001_alerts.sql`; Postgres names it `notifications_kind_check`). Tests pinning the kind list: `tests/alert-settings.test.ts` line 14 (exact `push` object), `tests/alerts-migration.test.ts` (reads only the 2026-10-18 file: unchanged), `tests/alert-message.test.ts` (every kind has messages), `tests/settings-notifications.test.tsx` (switches by name).
- Auth and actions: `requireOwner()` (redirects by throwing, called outside try/catch), `createServerSupabase()` (owner session), `createAdminSupabase()` (`server-only`), the action pattern and fake-db test pattern of `app/(app)/tags/actions.ts` / `tests/tag-actions.test.ts` and `app/(app)/accounts/followers-actions.ts`; `isUuid`, `isMediaId` (`/^\w{1,64}$/`) in `lib/tags.ts`; `revalidatePath('/accounts/[id]', 'page')`.
- UI: `ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, busy, error, requireText?, onConfirm, onClose })` (AlertDialog; destructive confirm button; `role="alert"` error), `ResponsiveDialog*`, `components/ui/dropdown-menu.tsx`, `switch.tsx`, `textarea.tsx`, `checkbox.tsx`, `input.tsx`, `alert.tsx`, `EmptyState`, `LoadingButton({ pending })`, `FormField({ id, label, hint?, error?, children: (p) => … })`, `Pagination({ page, pages, hrefFor })`, `usePrefs()`, `formatDateTime(v, prefs)` / `formatNumber(n, prefs)` (`lib/format.ts`). Account tabs: `TABS` in `lib/dashboard/account.ts` (`['overview', 'growth', 'posts', 'stories', 'followers']` today; 15c inserts `comments` before `followers`), `TabSkeleton`, the page's `switch (tab)` in `app/(app)/accounts/[id]/(tabs)/page.tsx` (server actions are passed straight to client tabs, e.g. `deleteSnapshot: deleteFollowerSnapshotAction`); `LIST_KEYS` includes `page`. Tabs are client components (`FollowersTab` is `'use client'`).
- `messages/*.json`: `pages.account.tab` one-line object at line 383 (6 spaces); `notifications.kinds.taking_off` is the last kind (lines 840–843). `tests/messages.test.ts` (parity, placeholders, no copy-pasted English), `tests/ui-standards.test.ts`.
- Migrations: 12 applied; Plan 15c may add `20261029000001_*`. This plan uses **`20261029000002_comment_moderation.sql`**. `tests/migrations.test.ts` (generic rules).

## Contract with Plan 15c (read-only comment insights; planned in parallel, built first)

The 15c plan was read while this plan was written (its Tasks 1–7 were on disk; its Task 8, the tab itself, was not yet). What it defines and this plan relies on — **the implementer of Task 12 reads the merged 15c code first and adapts names (listing every adaptation as a deviation):**
- `lib/comments/view.ts` exports `CommentView { id, mediaId, authorUsername: string | null, text: string, postedAt, likeCount: number | null, isQuestion, hidden: boolean | null (true only when stored as hidden, else null), repliedByOwner: boolean | null, post: CommentPost | null }` ("Plan 15d contract: keep these names").
- `components/account/CommentRow.tsx` has an `actions` slot (empty in 15c) and a `status` prop (`'visible' | 'hidden'`; "Hidden" badge). `components/account/CommentsTab.tsx` (15c Task 8) takes `renderActions?: (c: CommentView) => React.ReactNode` (orchestrator contract; not yet visible in the 15c file when read).
- 15c migration `20261029000001_comment_insights.sql` rewrites `comments_owner_select` to the InitPlan form and adds `comment_list` (which returns `hidden`); this plan's migration adds separate update/delete policies and does not touch that select policy.
- `TABS` after 15c: `['overview', 'growth', 'posts', 'stories', 'comments', 'followers']` (Followers stays LAST). This plan inserts `moderation` right after `comments`: `[…, 'comments', 'moderation', 'followers']`. `pages.account.tab.comments` exists in both catalogs; 15c's own strings live under `pages.account.comments` (this plan uses `pages.account.moderation`, no collision).
- `repliedByOwner` is DERIVED by 15c (a later top-level comment of the account mentioning `@author`); this plan does not change it (a reply sent from the app is a thread reply, which 15c does not read — the log shows it instead).
- `CommentsTab` is a CLIENT component (like every other tab), so a function prop cannot come from the server page: Task 12 adds a tiny client wrapper `ModeratedCommentsTab` that passes `renderActions` client-side. If 15c made `CommentsTab` a server component, the page passes `renderActions` directly instead (both variants are spelled out in Task 12).
- Nothing in Tasks 1–11 imports any 15c module: the moderation pieces take plain props (`commentId`, `hidden`, `own`), so 15c renames touch Task 12 only.

## Out of scope

Webhooks; bulk actions; a "hidden comments" inbox; reading `hidden` from Instagram (P5); replies list / threads; private replies (DMs); Simplified ⇄ Traditional folding; regex rules typed by the owner (ReDoS risk; the four built-in patterns cover spam); per-rule thresholds; moderation across all accounts at once; AI classification; changes to `COMMENT_FIELDS` or the comments job; deleting by automation (never).

## Global Constraints

- Ponytail: smallest thing that works. Pure logic in `lib/moderation/rules.ts` with Vitest tests; SQL only in `lib/moderation/store.ts` (plus the one `moderation_settings` read in `lib/alerts/store.ts`); components wire only. **No new dependencies, no new design tokens.** Inline first: the rules editor, the preview and the log live inside `ModerationTab` (one user each).
- TypeScript strict. No Meta METRIC names touched; the write endpoints live in `lib/instagram/moderation.ts` (a comment block cites the Meta docs and the date they were read).
- DB: ONE new migration `supabase/migrations/20261029000002_comment_moderation.sql`. **Implementers never apply it** (no `supabase`, `psql`, `db push`); it is applied later on the owner's go-ahead (runbook §0), and the code works before and after: a missing table (`PGRST205` / `42P01`) → readers return `null`, actions `not_ready`, the tick pass does nothing.
- **Writes to a third-party platform on the owner's accounts — the focus.** Owner first (`requireOwner()` outside try/catch), then validation, then the account and the comment re-read with BOTH ids through the owner session, then the log row, and only then the token (admin client, read inside the call, never returned, never logged, never in an error) and Meta. Tokens never leave the server: no `NEXT_PUBLIC_`, no token in any return value, the admin client only inside `token()` and the tick. Every Instagram error becomes a fixed key (no Meta message text, no URL, no body).
- **Privacy:** comment text, commenter names and reply text are third-party/owner personal data: never logged (`console.error` with one fixed string literal only, nothing interpolated), never in `sync_runs` (the tick summary holds counts only), never in notifications (payload `{ username }` = the account's own name), never stored in the log table. Owner-only RLS; deleted with the account (cascade).
- Every UI string via next-intl; ALL new keys are added by Task 2 in BOTH catalogs (real Simplified Chinese, full-width punctuation `，：（）。`). Services return error KEYS; the UI translates them.
- UI standards (`docs/UI_STANDARDS.md`): one control height per row (`size="default"` in the tab's forms and header rows; the per-row "Moderate" menu button is `size="sm"` inside the dense comment list — rule 5 allows it there and nowhere else), panels and confirms are dialogs (`ConfirmDialog`, `ResponsiveDialog`; bottom sheet on phones), underline tabs only for page sections, server pages with `Pagination` and a count line for the log, no range bar on the Moderation tab, full-word labels ("30 minutes", never "30m"). Theming: semantic tokens only (`text-destructive`, `bg-muted`, …). Responsive 360 / 768 / 1280: cards stack, rows wrap, no sideways page scroll, CSS breakpoints only. a11y: every dialog traps focus and returns it to the row's menu button; results are announced (`role="status"`), errors `role="alert"`; switches and the word input have visible labels.
- Dates and numbers only via `lib/format.ts`. Pure functions take `now` as an input.
- Tests: Vitest timeout 20 s; Meta calls ONLY through mocked `fetch` (no network); server-action tests use `// @vitest-environment node` and the hoisted fake db of `tests/tag-actions.test.ts`; component tests mock the actions as `vi.fn()` props and `next/navigation` (below). Never chain a commit after a piped command.
- `npm run check` passes after every wave. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **Wrong account / wrong comment:** the comment is re-read with `id` AND `account_id`; the token is the account's; undo targets come from the stored row only → Task 7 tests "a comment of another account is not_found and nothing is sent", "undo uses the stored comment and reply ids, never the browser's".
2. **Double submit / replays:** unique `request_id` → the second call returns `duplicate` with no Meta call; the dialog keeps one id per opening and disables the button while busy → Task 7 "the same requestId twice sends once", Task 10 "a double click sends once".
3. **Stale comment id:** `100/33` → `comment_gone`, log row records it, local row removed → Task 4 classifier, Task 7.
4. **Partial failure:** log insert fails → no Meta call; Meta ok + log update fails → `{ ok: true, logged: false }`, row stays `pending` → "Outcome unknown"; Meta fails + log update fails → still the Meta error key → Task 7 tests for each order, Task 5 `displayResult`.
5. **Automation loops and storms:** never twice per comment (touched set), never after an owner action, max 3 retries only for retryable errors, ≤ 20 per account per tick, stop on rate limit, stop the whole pass on an app-wide limit, pause after a permission error or 3 failures in a row, one notification per pause → Task 3 `touchedIds`/`pickAutoHide`, Task 8 lane tests, Task 6 alert rule.
6. **Token / scope loss:** no scope or not active → `reconnect`/`not_active` without a call; a permission answer → `reconnect` (manual) or pause (auto); the account's sync status is never changed by moderation → Task 7, Task 8.
7. **Sync isolation:** the pass runs after alerts with its own window, never throws, per-account try/catch, tick summary counts only, a missing migration does nothing → Task 8 tick tests.
8. **Privacy:** no text/names in log rows, notifications, `sync_runs` or console → Task 9 privacy guard, Task 1 migration test.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261029000002_comment_moderation.sql` (new), `tests/moderation-migration.test.ts` (new) | `moderation_settings`, `moderation_rules`, `moderation_log`, owner update/delete on `comments`, the `notifications` kind list |
| `messages/en.json`, `messages/zh-CN.json` | every new key (Task 2 only) |
| `lib/moderation/rules.ts` (new), `tests/moderation-rules.test.ts` (new) | `fold`, `matchRule`, `validateWord`, `touchedIds`, `pickAutoHide`, the constants (incl. `REPLY_MAX`) |
| `lib/instagram/moderation.ts` (new), `tests/instagram-moderation.test.ts` (new) | `igModeration` (hide, reply, remove), `classifyModerationError`, `MODERATION_TIMEOUT_MS` |
| `lib/moderation/store.ts` (new), `tests/moderation-store.test.ts` (new) | the ONLY module naming `moderation_log` / `moderation_rules` (and writing `comments`); `loadModeration`, log writes, rule/settings writes, the tick reads; pure `undoKind`, `displayResult` |
| `lib/moderation/service.ts` (new), `tests/moderation-service.test.ts` (new) | `moderate`, `undoAction`, `saveWordRule`, `setSpamRule`, `deleteRule`, `setAutoHide` |
| `lib/moderation/auto.ts` (new), `lib/sync/tick.ts`, `lib/sync/deps.ts`, `tests/moderation-auto.test.ts` (new), `tests/sync-tick-moderation.test.ts` (new) | `runAutoHide` and its place in the tick |
| `lib/alerts/settings.ts`, `lib/alerts/rules.ts`, `lib/alerts/store.ts`, `lib/alerts/run.ts`, `lib/alerts/message.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts` (new) | the `moderation_paused` kind, rule, read and link |
| `app/(app)/accounts/moderation-actions.ts` (new), `tests/moderation-actions.test.ts` (new), `tests/moderation-privacy.test.ts` (new) | the server actions; choke point + no-logging guard |
| `components/account/CommentActions.tsx` (new), `tests/comment-actions.test.tsx` (new) | the per-comment menu and its three dialogs; `ModeratedCommentsTab` wrapper is added in Task 12 |
| `components/account/ModerationTab.tsx` (new), `tests/moderation-tab.test.tsx` (new) | auto-hide, preview, rules, log |
| `lib/dashboard/account.ts`, `lib/dashboard/lists.ts` (export `parsePage`), `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `components/account/CommentActions.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | the `moderation` tab, the actions in the Comments tab |
| `docs/RUNBOOK_MODERATION.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md`, `docs/META_SETUP.md` | live checks, spec section, ticks, handover lines, rule 16, the write-permission note |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys. If Plan 15c changed an anchor line (it adds `"comments"` to the `tab` object), find the CURRENT `"tab": {` line of `pages.account` and add `"moderation"` as its last entry by hand (deviation).

**Mocking the router in component tests:** `const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));` and `vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, prefetch: vi.fn(), back: vi.fn() }) }));`. Component tests render inside `NextIntlClientProvider locale="en" messages={en}` and the prefs provider the same way `tests/followers-tab.test.tsx` does (copy its `renderWith` helper).

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | Migration + migration test | — | `supabase/migrations/20261029000002_comment_moderation.sql`, `tests/moderation-migration.test.ts` | 2, 3, 4 |
| 2 | i18n: every new key | 15c merged (anchor) | `messages/en.json`, `messages/zh-CN.json` | 1, 3, 4 |
| 3 | Rule matching (pure) | — | `lib/moderation/rules.ts`, `tests/moderation-rules.test.ts` | 1, 2, 4 |
| 4 | Meta write client + error classifier | — | `lib/instagram/moderation.ts`, `tests/instagram-moderation.test.ts` | 1, 2, 3 |
| 5 | Store (the SQL choke point) | 1 (names), 3 | `lib/moderation/store.ts`, `tests/moderation-store.test.ts` | 6 |
| 6 | Alerts: `moderation_paused` | 1 (names), 2 | `lib/alerts/settings.ts`, `lib/alerts/rules.ts`, `lib/alerts/store.ts`, `lib/alerts/run.ts`, `lib/alerts/message.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts` | 5 |
| 7 | Service: moderate, undo, rules, auto-hide switch | 3, 4, 5 | `lib/moderation/service.ts`, `tests/moderation-service.test.ts` | 8 |
| 8 | Auto-hide pass in the tick | 3, 4, 5 | `lib/moderation/auto.ts`, `lib/sync/tick.ts`, `lib/sync/deps.ts`, `tests/moderation-auto.test.ts`, `tests/sync-tick-moderation.test.ts` | 7 |
| 9 | Server actions + privacy guard | 7, 8 | `app/(app)/accounts/moderation-actions.ts`, `tests/moderation-actions.test.ts`, `tests/moderation-privacy.test.ts` | 10 |
| 10 | Comment row menu + dialogs (+ the shared `useModerationRun` hook) | 2, 7 (types) | `components/account/CommentActions.tsx`, `tests/comment-actions.test.tsx` | 9 |
| 11 | Moderation tab component | 2, 5, 7 (types), 10 (`useModerationRun`) | `components/account/ModerationTab.tsx`, `tests/moderation-tab.test.tsx` | — |
| 12 | Wiring: tab, page cases, Comments tab actions | 9, 10, 11 (+ 15c) | `lib/dashboard/account.ts`, `lib/dashboard/lists.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `components/account/CommentActions.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | — |
| 13 | Docs, final check | all | `docs/RUNBOOK_MODERATION.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md`, `docs/META_SETUP.md` | — |

Run order: **wave A = 1, 2, 3, 4 · wave B = 5, 6 · wave C = 7, 8 · wave D = 9, 10 · wave E = 11 · wave F = 12 · wave G = 13.** Tasks in one wave touch disjoint files. Each task leaves `main` green: the new modules are unused until Task 12 wires them (Task 8 wires the tick pass, which does nothing until the migration exists AND the owner switches auto-hide on; Task 6's alert kind needs its messages from Task 2, hence wave B). Tasks 10 and 11 take the server actions as PROPS (the page passes them, like `deleteSnapshot` in 15b), so they import only types from Tasks 5/7 and Task 10 runs beside Task 9; Task 11 reuses Task 10's `useModerationRun` hook (CLAUDE.md: extract on the second use), hence its own wave.

---

### Task 1: Migration `20261029000002_comment_moderation.sql` + migration test

**Files:**
- Create: `supabase/migrations/20261029000002_comment_moderation.sql`, `tests/moderation-migration.test.ts`
- Existing tests that must keep passing: `tests/migrations.test.ts` (generic rules), `tests/alerts-migration.test.ts` (reads only `20261018000001_alerts.sql`: unaffected).

**Interfaces:**
- Consumes: `public.accounts (id)`, `public.comments (id, account_id, hidden)`, `public.notifications (kind)`, `public.is_owner()`.
- Produces (Task 5 and Task 6 use exactly these): `moderation_settings (account_id pk, auto_hide, paused_at, pause_reason, updated_at)`, `moderation_rules (id, account_id, kind, pattern, whole_word, created_at)`, `moderation_log (id bigint, account_id, comment_id, action, actor, request_id, result, target_id, undo_of, created_at, undone_at)`; owner `update (hidden)` and `delete` on `comments`; kind `moderation_paused` allowed in `notifications`.

- [ ] **Step 1: Write the failing test** — create `tests/moderation-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261029000002_comment_moderation.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = (name: string) => sql.match(new RegExp(`create\\s+table\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] ?? '';

describe('comment moderation migration', () => {
  it('is additive: three tables, no drop except the one notifications check it re-creates, never account_tokens', () => {
    expect(sql.match(/create\s+table/gi)).toHaveLength(3);
    expect(sql.match(/\bdrop\b/gi)).toHaveLength(1);
    expect(sql).toMatch(exact('alter table public.notifications drop constraint notifications_kind_check'));
    expect(sql).not.toMatch(/\b(truncate|security\s+definer)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('settings: one row per account, off by default, a pause always has a reason', () => {
    const t = table('moderation_settings');
    expect(t).toMatch(exact('account_id uuid primary key references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact('auto_hide boolean not null default false'));
    expect(t).toMatch(exact("pause_reason text check (pause_reason in ('reconnect', 'failing'))"));
    expect(t).toMatch(exact('check ((paused_at is null) = (pause_reason is null))'));
  });

  it('rules: words with a pattern, spam kinds without, each spam kind at most once per account', () => {
    const t = table('moderation_rules');
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact("kind text not null check (kind in ('word', 'link', 'mentions', 'repeat', 'emoji'))"));
    expect(t).toMatch(exact('pattern text check (char_length(pattern) between 1 and 50)'));
    expect(t).toMatch(exact("check ((kind = 'word') = (pattern is not null))"));
    expect(sql).toMatch(exact("create unique index moderation_rules_spam_once on public.moderation_rules (account_id, kind) where kind <> 'word'"));
  });

  it('log: ids only (no comment text, no author, no reply text), constrained actions and actors, unique request id', () => {
    const t = table('moderation_log');
    expect(t).not.toMatch(/\b(text|author|username|message)\b\s+text/i);
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact("action text not null check (action in ('reply', 'hide', 'unhide', 'delete', 'delete_reply'))"));
    expect(t).toMatch(exact("actor text not null check (actor = 'owner' or actor ~ '^rule:[0-9a-f-]{36}$')"));
    expect(t).toMatch(exact('request_id uuid not null unique'));
    expect(t).toMatch(exact("result text not null default 'pending' check (result ~ '^[a-z_]{1,40}$')"));
    expect(t).toMatch(exact('undo_of bigint references public.moderation_log (id) on delete set null'));
    expect(sql).toMatch(exact('create index moderation_log_account_idx on public.moderation_log (account_id, created_at desc)'));
    expect(sql).toMatch(exact('create index moderation_log_comment_idx on public.moderation_log (account_id, comment_id)'));
  });

  it('owner-authored settings and rules: RLS, one policy for the owner (InitPlan form), nothing for anon', () => {
    for (const t of ['moderation_settings', 'moderation_rules']) {
      expect(sql).toMatch(exact(`alter table public.${t} enable row level security`));
      expect(sql).toMatch(exact(`create policy ${t}_owner_all on public.${t} for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))`));
      expect(sql).toMatch(exact(`revoke all on public.${t} from anon`));
    }
  });

  it('log is append-only for the owner: select + insert (as owner only) + update of three columns, no delete', () => {
    expect(sql).toMatch(exact('alter table public.moderation_log enable row level security'));
    expect(sql).toMatch(exact('create policy moderation_log_owner_select on public.moderation_log for select to authenticated using ((select public.is_owner()))'));
    expect(sql).toMatch(exact("create policy moderation_log_owner_insert on public.moderation_log for insert to authenticated with check ((select public.is_owner()) and actor = 'owner')"));
    expect(sql).toMatch(exact('create policy moderation_log_owner_update on public.moderation_log for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.moderation_log from anon, authenticated'));
    expect(sql).toMatch(exact('grant select, insert on public.moderation_log to authenticated'));
    expect(sql).toMatch(exact('grant update (result, target_id, undone_at) on public.moderation_log to authenticated'));
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*moderation_log/i);
  });

  it('comments: the owner may flip hidden and remove a deleted comment, nothing else', () => {
    expect(sql).toMatch(exact('create policy comments_owner_update on public.comments for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('create policy comments_owner_delete on public.comments for delete to authenticated using ((select public.is_owner()))'));
    expect(sql).toMatch(exact('grant update (hidden) on public.comments to authenticated'));
    expect(sql).toMatch(exact('grant delete on public.comments to authenticated'));
    expect(sql).not.toMatch(/grant\s+(insert|update\s+on|all)[^;]*public\.comments/i);
  });

  it('notifications accept the new kind next to the five existing ones', () => {
    expect(sql).toMatch(exact("alter table public.notifications add constraint notifications_kind_check check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused'))"));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/moderation-migration.test.ts`
Expected: FAIL — `ENOENT: no such file or directory … 20261029000002_comment_moderation.sql`.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20261029000002_comment_moderation.sql` (exactly this):

```sql
-- Plan 15d: comment moderation (reply / hide / delete from the app, banned-word and spam auto-hide, undo log).
-- Creator-toolkit design §0b: every action confirmed and logged; hide is reversible (unhide), a reply can be deleted,
-- delete is irreversible on Instagram and never automated.
--
-- Owner-authored settings and rules (like tags): the owner session reads and writes them under RLS; the sync tick
-- (admin client) reads them and sets paused_at. lib/moderation/store.ts is the only app module that names these tables
-- (plus the paused_at read in lib/alerts/store.ts).

create table public.moderation_settings (
  account_id   uuid primary key references public.accounts (id) on delete cascade,
  auto_hide    boolean not null default false,
  paused_at    timestamptz,
  pause_reason text check (pause_reason in ('reconnect', 'failing')),
  updated_at   timestamptz not null default now(),
  check ((paused_at is null) = (pause_reason is null))
);
alter table public.moderation_settings enable row level security;
create policy moderation_settings_owner_all on public.moderation_settings
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.moderation_settings from anon;

-- word = a banned word or phrase (pattern, as typed; matched folded, lib/moderation/rules.ts); the spam kinds have no
-- pattern and exist at most once per account (a row = switched on). The caps match PATTERN_MAX / MAX_WORD_RULES.
create table public.moderation_rules (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind       text not null check (kind in ('word', 'link', 'mentions', 'repeat', 'emoji')),
  pattern    text check (char_length(pattern) between 1 and 50),
  whole_word boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'word') = (pattern is not null))
);
create index moderation_rules_account_idx on public.moderation_rules (account_id, created_at);
create unique index moderation_rules_spam_once on public.moderation_rules (account_id, kind) where kind <> 'word';
alter table public.moderation_rules enable row level security;
create policy moderation_rules_owner_all on public.moderation_rules
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.moderation_rules from anon;

-- One row per action, written BEFORE the Instagram call (result 'pending', request_id from the dialog = the
-- double-submit guard) and finished after it ('ok' or an error key). Ids only: no comment text, no commenter name, no
-- reply text (third-party / personal data). target_id = the reply's id (Undo deletes it). comment_id has no foreign key:
-- the comment may be gone (deleted on Instagram) while its log row stays. Append-only for the app: no delete grant;
-- rows go with the account (cascade). Owner inserts must be actor 'owner'; rule rows come from the tick (admin client).
create table public.moderation_log (
  id         bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  comment_id text not null check (comment_id ~ '^\w{1,64}$'),
  action     text not null check (action in ('reply', 'hide', 'unhide', 'delete', 'delete_reply')),
  actor      text not null check (actor = 'owner' or actor ~ '^rule:[0-9a-f-]{36}$'),
  request_id uuid not null unique,
  result     text not null default 'pending' check (result ~ '^[a-z_]{1,40}$'),
  target_id  text check (target_id ~ '^\w{1,64}$'),
  undo_of    bigint references public.moderation_log (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
-- the log page (newest first) and "was this comment touched?" (auto-hide)
create index moderation_log_account_idx on public.moderation_log (account_id, created_at desc);
create index moderation_log_comment_idx on public.moderation_log (account_id, comment_id);
alter table public.moderation_log enable row level security;
create policy moderation_log_owner_select on public.moderation_log
  for select to authenticated
  using ((select public.is_owner()));
create policy moderation_log_owner_insert on public.moderation_log
  for insert to authenticated
  with check ((select public.is_owner()) and actor = 'owner');
create policy moderation_log_owner_update on public.moderation_log
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.moderation_log from anon, authenticated;
grant select, insert on public.moderation_log to authenticated;
grant update (result, target_id, undone_at) on public.moderation_log to authenticated;

-- comments (Plan 11b: owner select only): after a hide/unhide the owner session sets hidden; after a delete on
-- Instagram (or a "comment gone" answer) it removes the row. Nothing else becomes writable.
create policy comments_owner_update on public.comments
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
create policy comments_owner_delete on public.comments
  for delete to authenticated
  using ((select public.is_owner()));
grant update (hidden) on public.comments to authenticated;
grant delete on public.comments to authenticated;

-- One notification per auto-hide pause (lib/alerts/rules.ts, dedupe key moderation_paused:<account>:<paused_at>).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused'));
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-migration.test.ts tests/migrations.test.ts tests/alerts-migration.test.ts`
Expected: PASS (8 tests in the new file; the generic suite finds RLS + a policy for each new table, every policy `to authenticated`). Do NOT apply the migration anywhere (implementer rules §7).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261029000002_comment_moderation.sql tests/moderation-migration.test.ts
git commit -m "feat(db): comment moderation tables (settings, rules, append-only log), owner hide/delete on comments, moderation_paused kind" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: i18n — every new key (additions only)

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts` (parity, non-empty, placeholders, no copy-pasted English) and `tests/ui-standards.test.ts` (rule 6) must pass.

**Interfaces:**
- Produces (exact keys later tasks read): `pages.account.tab.moderation`; the object `pages.account.moderation` (menu, row actions, the three dialogs, `done.*`, `errors.*` = every `ModerationError` and `RuleError` key, `intro`, `noScope.*`, `notReady.*`, `auto.*`, `preview.*`, `rules.*`, `ruleLabel.*`, `log.*`); `notifications.kinds.moderation_paused.{title,body}`.
- Placeholders: `{username}`, `{count}` (a plural SELECTOR in `auto.enableBody` / `preview.count`, whose shown number is `{n}`; elsewhere a formatted count), `{n}`, `{max}`, `{word}`, `{rule}`, `{date}`, `{first}`/`{last}`/`{total}`. Every shown number is formatted with `formatNumber` (the owner's number format); `#` is never used.

- [ ] **Step 1: Insert the account keys** — one text edit per file. Anchor = the `"tab": {` line of `pages.account` (after 15c it ends with `"comments": "…" },`). Add `, "moderation": "Moderation"` (zh-CN `, "moderation": "评论管理"`) as its last entry and insert the object below directly AFTER that line (6-space indentation).

`messages/en.json` — the inserted object:
```json
      "moderation": {
        "menu": "Moderate comment",
        "reply": "Reply",
        "hide": "Hide",
        "unhide": "Unhide",
        "delete": "Delete",
        "ownHint": "Instagram always shows your own comments, so they can't be hidden.",
        "cancel": "Cancel",
        "replyDialog": {
          "title": "Reply to @{username}",
          "titleNoName": "Reply to this comment",
          "description": "Your reply appears under this comment on Instagram. You can delete it later from the moderation log.",
          "label": "Your reply",
          "count": "{count} of {max} characters",
          "send": "Send reply"
        },
        "hideDialog": {
          "title": "Hide this comment?",
          "body": "A hidden comment stays on Instagram, but only you and the person who wrote it can see it. You can unhide it at any time.",
          "confirm": "Hide"
        },
        "unhideDialog": {
          "title": "Unhide this comment?",
          "body": "Everyone can see this comment again. Auto-hide will never hide it again.",
          "confirm": "Unhide"
        },
        "deleteDialog": {
          "title": "Delete this comment for good?",
          "body": "Deleting removes the comment from Instagram for everyone. It cannot be undone, not on Instagram and not here. To keep it out of sight but recoverable, hide it instead. Type {word} to confirm.",
          "word": "DELETE",
          "confirm": "Delete permanently"
        },
        "done": { "hide": "Comment hidden.", "unhide": "Comment visible again.", "delete": "Comment deleted.", "reply": "Reply posted.", "undo": "Undone." },
        "errors": {
          "invalid": "Something in this request is not valid. Reload the page and try again.",
          "not_found": "This comment is no longer here. Reload the page.",
          "not_active": "This account is archived. Restore it to moderate comments.",
          "reconnect": "Instagram did not allow this. Reconnect the account on the Accounts page, then try again.",
          "duplicate": "This was already sent.",
          "too_many": "Too many actions in a minute. Wait a moment, then try again.",
          "already_done": "Already done. The page now shows the current state.",
          "cannot_undo": "This action cannot be undone.",
          "not_ready": "Moderation needs a database update first.",
          "rate_limited": "Instagram is limiting requests right now. Try again later.",
          "comment_gone": "This comment no longer exists on Instagram.",
          "not_allowed": "Instagram does not allow this for this comment.",
          "instagram_unavailable": "Instagram did not answer. Try again in a moment.",
          "unknown_outcome": "Instagram did not confirm. The reply may have been posted: check on Instagram before sending it again.",
          "unexpected": "Something went wrong. Nothing was changed here; check on Instagram before trying again.",
          "invalid_word": "Enter a word or phrase of 1 to 50 characters.",
          "duplicate_rule": "This word is already on the list.",
          "too_many_rules": "You have reached the limit of banned words for this account.",
          "no_rules": "Add a banned word or switch on a spam pattern first."
        },
        "intro": "Reply to, hide and delete comments from the Comments tab. Here you set the rules that hide spam automatically and see everything that was done.",
        "noScope": {
          "title": "Reconnect to enable comments",
          "body": "This account was connected before in2sight asked for the comments permission, or Instagram no longer accepts the connection. Reconnect it once on the Accounts page to reply, hide and delete.",
          "link": "Open Accounts"
        },
        "notReady": {
          "title": "Moderation needs a database update",
          "body": "Apply the moderation migration first (docs/RUNBOOK_MODERATION.md §0)."
        },
        "auto": {
          "title": "Auto-hide",
          "description": "Hides comments that match your rules, up to 20 every 30 minutes. It never deletes anything and never hides a comment you have unhidden.",
          "switch": "Hide matching comments automatically",
          "pausedReconnect": "Auto-hide is paused: Instagram refused the permission. Reconnect the account, then switch it on again.",
          "pausedFailing": "Auto-hide is paused after repeated errors from Instagram. Switch it on again to retry.",
          "pausedSince": "Paused since {date}",
          "enableTitle": "Switch on auto-hide?",
          "enableBody": "{count, plural, =0 {No comment matches your rules right now.} one {{n} comment that is already here will be hidden.} other {{n} comments that are already here will be hidden.}} After that, new matching comments are hidden within about an hour, up to 20 every 30 minutes. Every hide is listed in the log and can be undone.",
          "enableConfirm": "Switch on",
          "noRules": "Add a banned word or switch on a spam pattern first."
        },
        "preview": {
          "title": "Matching now",
          "count": "{count, plural, =0 {No visible comment matches your rules.} one {{n} visible comment matches your rules.} other {{n} visible comments match your rules.}}",
          "basis": "Checked against the newest {count} stored comments.",
          "by": "Matches: {rule}"
        },
        "rules": {
          "title": "Rules",
          "description": "Words and patterns that mark a comment as spam. Upper and lower case and full-width characters count as the same.",
          "spamTitle": "Spam patterns",
          "link": { "label": "Links", "hint": "Web addresses such as www…, https://… or name.com" },
          "mentions": { "label": "Many mentions", "hint": "4 or more @mentions in one comment" },
          "repeat": { "label": "Repeated characters", "hint": "The same character 8 or more times in a row" },
          "emoji": { "label": "Emoji floods", "hint": "10 or more emoji with almost no text" },
          "wordsTitle": "Banned words",
          "wordLabel": "Word or phrase",
          "wordHint": "Up to 50 characters. Chinese, Japanese and Korean words always match inside longer text.",
          "wholeWord": "Whole word only",
          "add": "Add",
          "remove": "Remove {word}",
          "empty": "No banned words yet.",
          "count": "{count} of {max} words",
          "wholeBadge": "whole word"
        },
        "ruleLabel": { "word": "“{word}”", "link": "Links", "mentions": "Many mentions", "repeat": "Repeated characters", "emoji": "Emoji floods", "removed": "a removed rule" },
        "log": {
          "title": "Moderation log",
          "description": "Every reply, hide, unhide and delete, by you or by a rule. The comment is shown only while it is still stored.",
          "empty": "Nothing has been done yet.",
          "range": "{first}–{last} of {total}",
          "actions": { "reply": "Replied", "hide": "Hidden", "unhide": "Unhidden", "delete": "Deleted", "delete_reply": "Reply deleted" },
          "byOwner": "By you",
          "byRule": "By rule: {rule}",
          "results": { "ok": "Done", "pending": "In progress", "unknown": "Outcome unknown — check on Instagram" },
          "gone": "Comment no longer stored",
          "undone": "Undone {date}",
          "undo": { "unhide": "Unhide", "delete_reply": "Delete reply" },
          "undoTitle": { "unhide": "Unhide this comment?", "delete_reply": "Delete your reply?" },
          "undoBody": {
            "unhide": "Everyone can see this comment again. Auto-hide will never hide it again.",
            "delete_reply": "Your reply is removed from Instagram. This cannot be undone."
          }
        }
      },
```

`messages/zh-CN.json` — the inserted object:
```json
      "moderation": {
        "menu": "管理评论",
        "reply": "回复",
        "hide": "隐藏",
        "unhide": "取消隐藏",
        "delete": "删除",
        "ownHint": "Instagram 总会显示你自己的评论，因此无法隐藏。",
        "cancel": "取消",
        "replyDialog": {
          "title": "回复 @{username}",
          "titleNoName": "回复这条评论",
          "description": "你的回复会显示在 Instagram 上这条评论的下方。之后可以在管理记录中删除。",
          "label": "你的回复",
          "count": "{count} / {max} 个字符",
          "send": "发送回复"
        },
        "hideDialog": {
          "title": "隐藏这条评论？",
          "body": "被隐藏的评论仍留在 Instagram 上，但只有你和评论者本人能看到。你可以随时取消隐藏。",
          "confirm": "隐藏"
        },
        "unhideDialog": {
          "title": "取消隐藏这条评论？",
          "body": "所有人都会再次看到这条评论。自动隐藏不会再隐藏它。",
          "confirm": "取消隐藏"
        },
        "deleteDialog": {
          "title": "永久删除这条评论？",
          "body": "删除会让所有人在 Instagram 上都看不到这条评论，且无法撤销（Instagram 和这里都不能）。如果只想让它不被看到并可以恢复，请改用隐藏。输入 {word} 以确认。",
          "word": "删除",
          "confirm": "永久删除"
        },
        "done": { "hide": "评论已隐藏。", "unhide": "评论已重新显示。", "delete": "评论已删除。", "reply": "回复已发布。", "undo": "已撤销。" },
        "errors": {
          "invalid": "此请求中有无效内容。请刷新页面后重试。",
          "not_found": "这条评论已不在这里。请刷新页面。",
          "not_active": "此账号已归档。恢复后才能管理评论。",
          "reconnect": "Instagram 不允许此操作。请在“账号”页面重新连接此账号后重试。",
          "duplicate": "已经发送过了。",
          "too_many": "一分钟内的操作过多。请稍候再试。",
          "already_done": "已经完成。页面现在显示的是最新状态。",
          "cannot_undo": "此操作无法撤销。",
          "not_ready": "评论管理需要先更新数据库。",
          "rate_limited": "Instagram 目前正在限制请求。请稍后再试。",
          "comment_gone": "这条评论在 Instagram 上已不存在。",
          "not_allowed": "Instagram 不允许对这条评论执行此操作。",
          "instagram_unavailable": "Instagram 没有响应。请稍后重试。",
          "unknown_outcome": "Instagram 没有确认。回复可能已经发布：再次发送前请先在 Instagram 上查看。",
          "unexpected": "出了点问题。这里没有任何改动；重试前请先在 Instagram 上查看。",
          "invalid_word": "请输入 1 到 50 个字符的词或短语。",
          "duplicate_rule": "这个词已在列表中。",
          "too_many_rules": "此账号的屏蔽词已达上限。",
          "no_rules": "请先添加屏蔽词或开启一种垃圾评论模式。"
        },
        "intro": "在“评论”标签页中回复、隐藏和删除评论。在这里设置自动隐藏垃圾评论的规则，并查看所有已执行的操作。",
        "noScope": {
          "title": "重新连接以启用评论功能",
          "body": "此账号连接时 in2sight 尚未请求评论权限，或 Instagram 已不再接受此连接。请在“账号”页面重新连接一次，即可回复、隐藏和删除评论。",
          "link": "打开账号页面"
        },
        "notReady": {
          "title": "评论管理需要更新数据库",
          "body": "请先应用评论管理的数据库迁移（docs/RUNBOOK_MODERATION.md §0）。"
        },
        "auto": {
          "title": "自动隐藏",
          "description": "隐藏符合规则的评论，每 30 分钟最多 20 条。它从不删除任何内容，也不会隐藏你已取消隐藏的评论。",
          "switch": "自动隐藏符合规则的评论",
          "pausedReconnect": "自动隐藏已暂停：Instagram 拒绝了权限。请重新连接此账号，然后再次开启。",
          "pausedFailing": "Instagram 多次返回错误，自动隐藏已暂停。再次开启即可重试。",
          "pausedSince": "暂停于 {date}",
          "enableTitle": "开启自动隐藏？",
          "enableBody": "{count, plural, =0 {目前没有评论符合你的规则。} =1 {现有的 {n} 条评论将被隐藏。} other {现有的 {n} 条评论将被隐藏。}}之后，新的符合规则的评论会在大约一小时内被隐藏，每 30 分钟最多 20 条。每次隐藏都会记录在管理记录中，并可撤销。",
          "enableConfirm": "开启",
          "noRules": "请先添加屏蔽词或开启一种垃圾评论模式。"
        },
        "preview": {
          "title": "当前符合的评论",
          "count": "{count, plural, =0 {没有可见评论符合你的规则。} =1 {有 {n} 条可见评论符合你的规则。} other {有 {n} 条可见评论符合你的规则。}}",
          "basis": "已检查最新存储的 {count} 条评论。",
          "by": "符合：{rule}"
        },
        "rules": {
          "title": "规则",
          "description": "把评论标记为垃圾评论的词和模式。大小写和全角字符视为相同。",
          "spamTitle": "垃圾评论模式",
          "link": { "label": "链接", "hint": "网址，例如 www…、https://… 或 name.com" },
          "mentions": { "label": "大量提及", "hint": "一条评论中有 4 个或更多 @提及" },
          "repeat": { "label": "重复字符", "hint": "同一个字符连续出现 8 次或更多" },
          "emoji": { "label": "表情刷屏", "hint": "10 个或更多表情，几乎没有文字" },
          "wordsTitle": "屏蔽词",
          "wordLabel": "词或短语",
          "wordHint": "最多 50 个字符。中文、日文和韩文词语在较长的文字中也会匹配。",
          "wholeWord": "仅匹配完整单词",
          "add": "添加",
          "remove": "删除 {word}",
          "empty": "还没有屏蔽词。",
          "count": "{count} / {max} 个词",
          "wholeBadge": "完整单词"
        },
        "ruleLabel": { "word": "「{word}」", "link": "链接", "mentions": "大量提及", "repeat": "重复字符", "emoji": "表情刷屏", "removed": "已删除的规则" },
        "log": {
          "title": "管理记录",
          "description": "你或规则执行的每一次回复、隐藏、取消隐藏和删除。仅在评论仍被存储时显示评论内容。",
          "empty": "还没有任何操作。",
          "range": "第 {first}–{last} 条，共 {total} 条",
          "actions": { "reply": "已回复", "hide": "已隐藏", "unhide": "已取消隐藏", "delete": "已删除", "delete_reply": "回复已删除" },
          "byOwner": "由你执行",
          "byRule": "由规则执行：{rule}",
          "results": { "ok": "完成", "pending": "进行中", "unknown": "结果未知——请在 Instagram 上查看" },
          "gone": "评论已不再存储",
          "undone": "已于 {date} 撤销",
          "undo": { "unhide": "取消隐藏", "delete_reply": "删除回复" },
          "undoTitle": { "unhide": "取消隐藏这条评论？", "delete_reply": "删除你的回复？" },
          "undoBody": {
            "unhide": "所有人都会再次看到这条评论。自动隐藏不会再隐藏它。",
            "delete_reply": "你的回复会从 Instagram 上删除。此操作无法撤销。"
          }
        }
      },
```

Note: `tests/messages.test.ts` compares the sorted placeholder LISTS, so the zh-CN plural messages repeat `{n}` in an `=1` branch to match the English `one`/`other` pair; `ruleLabel.word` uses 「」 in zh-CN (an identical `“{word}”` would trip the copy-paste guard, which sees the 4 letters of `word`).

- [ ] **Step 2: Insert the notification kind** — anchor (both files, lines 840–843, 6/8-space indentation): the `"taking_off": { … }` block followed by `    }`. Replace the closing `      }` of `taking_off` with `      },` and add after it:

`messages/en.json`:
```json
      "moderation_paused": {
        "title": "Auto-hide paused",
        "body": "Auto-hide for @{username} is paused because Instagram refused to hide a comment. Open Moderation to see why and switch it on again."
      }
```
`messages/zh-CN.json`:
```json
      "moderation_paused": {
        "title": "自动隐藏已暂停",
        "body": "Instagram 拒绝隐藏评论，@{username} 的自动隐藏已暂停。打开“评论管理”查看原因并重新开启。"
      }
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts tests/alert-message.test.ts`
Expected: PASS (parity holds: both files got the same keys; `alert-message` iterates `ALERT_KINDS`, which does not list the new kind until Task 6). Also run `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` → no output.

- [ ] **Step 4: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): comment moderation strings (en, zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Rule matching (pure) — `lib/moderation/rules.ts`

**Files:**
- Create: `lib/moderation/rules.ts`, `tests/moderation-rules.test.ts`

**Interfaces (Produces):**
```ts
export const RULE_KINDS = ['word', 'link', 'mentions', 'repeat', 'emoji'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const SPAM_KINDS = ['link', 'mentions', 'repeat', 'emoji'] as const satisfies readonly RuleKind[];
export type SpamKind = (typeof SPAM_KINDS)[number];
export const PATTERN_MAX = 50, MAX_WORD_RULES = 200, REPEAT_MIN = 8, MENTIONS_MIN = 4, EMOJI_MIN = 10, EMOJI_TEXT_MAX = 3, MAX_AUTO_TRIES = 3;
export const REPLY_MAX = 2_200; // here (pure, client-safe) so the reply dialog can count without importing the Meta client
export const RETRYABLE: readonly string[]; // ['rate_limited', 'instagram_unavailable']
export interface ModerationRule { id: string; kind: RuleKind; pattern: string | null; wholeWord: boolean }
export interface Candidate { id: string; authorUsername: string | null; text: string | null; hidden: boolean }
export interface LogMark { commentId: string; actor: string; result: string }
export function fold(s: string): string;
export function matchRule(text: string | null, rules: readonly ModerationRule[]): ModerationRule | null;
export function validateWord(raw: unknown, existing: readonly ModerationRule[]): { ok: true; pattern: string } | { ok: false; error: 'invalid_word' | 'duplicate_rule' | 'too_many_rules' };
export function touchedIds(marks: readonly LogMark[]): Set<string>;
export function pickAutoHide(cands: readonly Candidate[], rules: readonly ModerationRule[], opts: { ownUsername: string; touched: ReadonlySet<string>; limit: number }): { comment: Candidate; rule: ModerationRule }[];
```

- [ ] **Step 1: Write the failing test** — create `tests/moderation-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fold, matchRule, MAX_WORD_RULES, pickAutoHide, touchedIds, validateWord, type Candidate, type ModerationRule } from '@/lib/moderation/rules';

const R = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const word = (pattern: string, wholeWord = false, id = R): ModerationRule => ({ id, kind: 'word', pattern, wholeWord });
const spam = (kind: ModerationRule['kind'], id = R): ModerationRule => ({ id, kind, pattern: null, wholeWord: false });
const c = (id: string, text: string | null, o: Partial<Candidate> = {}): Candidate => ({ id, authorUsername: 'fan', text, hidden: false, ...o });

describe('fold', () => {
  it('NFKC (full-width to ASCII), lower case, zero-width removed, whitespace collapsed', () => {
    expect(fold('ＦＲＥＥ　ｆｏｌｌｏｗｅｒｓ！')).toBe('free followers!');
    expect(fold('Fr​ee⁠ \n\t  Gift﻿')).toBe('free gift');
    expect(fold('  ＣＬＩＣＫ  ')).toBe('click');
  });
});

describe('matchRule', () => {
  it('null text or no rules never match', () => {
    expect(matchRule(null, [word('spam')])).toBeNull();
    expect(matchRule('spam', [])).toBeNull();
  });

  it('a word is a substring match by default, on folded text', () => {
    expect(matchRule('Buy CHEAP followers', [word('cheap')])?.kind).toBe('word');
    expect(matchRule('ｃｈｅａｐ!!', [word('Cheap')])).not.toBeNull();
    expect(matchRule('cheapest', [word('cheap')])).not.toBeNull();
  });

  it('whole word only: no letter, digit or underscore directly before or after', () => {
    const r = [word('cheap', true)];
    expect(matchRule('so cheap!', r)).not.toBeNull();
    expect(matchRule('cheap', r)).not.toBeNull();
    expect(matchRule('cheapest deal', r)).toBeNull();
    expect(matchRule('xcheap', r)).toBeNull();
    expect(matchRule('cheap_deal', r)).toBeNull();
    expect(matchRule('cheap123', r)).toBeNull();
    expect(matchRule('(cheap)', r)).not.toBeNull();
    expect(matchRule('très cheap.', r)).not.toBeNull();
  });

  it('CJK patterns always match inside longer text, whole word or not', () => {
    expect(matchRule('这个代购很便宜', [word('代购', true)])).not.toBeNull();
    expect(matchRule('全場代購', [word('代购')])).toBeNull(); // no Simplified/Traditional folding (Open question 7)
    expect(matchRule('ﾌｫﾛﾜｰ', [word('フォロワー')])).not.toBeNull(); // half-width katakana folds to full-width
  });

  it('regex characters in a pattern are literal', () => {
    expect(matchRule('a.b', [word('.')])).not.toBeNull();
    expect(matchRule('ab', [word('a.b')])).toBeNull();
    expect(matchRule('price $$$ now', [word('$$$', true)])).not.toBeNull();
  });

  it('link: scheme, www., or a bare domain with a common ending; full-width folded; e-mail-like and decimals are not links', () => {
    const r = [spam('link')];
    for (const t of ['see https://x.co', 'go to www.spam', 'bit.ly/abc', 'DM t.me/deals', 'ｗｗｗ．ｓｐａｍ．ｃｏｍ', 'shop at Cheap-Deals.SHOP now'])
      expect(matchRule(t, r), t).not.toBeNull();
    for (const t of ['hello.world', 'pi is 3.14', 'mail me at me@mail.com', 'great.....', 'nice pic'])
      expect(matchRule(t, r), t).toBeNull();
  });

  it('mentions: 4 or more @names; e-mail addresses do not count', () => {
    const r = [spam('mentions')];
    expect(matchRule('@a @b @c @d', r)).not.toBeNull();
    expect(matchRule('@a @b @c love it', r)).toBeNull();
    expect(matchRule('x@a.com y@b.com z@c.com w@d.com', r)).toBeNull();
  });

  it('repeat: the same character 8 or more times in a row', () => {
    const r = [spam('repeat')];
    expect(matchRule('wowwwwwwww', r)).not.toBeNull();
    expect(matchRule('!!!!!!!!', r)).not.toBeNull();
    expect(matchRule('哈哈哈哈哈哈哈哈', r)).not.toBeNull();
    expect(matchRule('!!!!!!!', r)).toBeNull();
    expect(matchRule('hahahahahahaha', r)).toBeNull();
    expect(matchRule('        spaced', r)).toBeNull(); // whitespace is collapsed by fold
  });

  it('emoji: 10 or more emoji with at most 3 letters or digits', () => {
    const r = [spam('emoji')];
    expect(matchRule('🔥'.repeat(10), r)).not.toBeNull();
    expect(matchRule('❤️'.repeat(10) + ' wow', r)).not.toBeNull();
    expect(matchRule('🔥'.repeat(9), r)).toBeNull();
    expect(matchRule('🔥'.repeat(12) + ' love this so much', r)).toBeNull();
  });

  it('first match wins: words (in the given order) before link, mentions, repeat, emoji', () => {
    const w1 = word('free', false, 'w1');
    const w2 = word('gift', false, 'w2');
    expect(matchRule('free gift www.x.com', [spam('link', 'l'), w2, w1])?.id).toBe('w2');
    expect(matchRule('@a @b @c @d www.x.com', [spam('mentions', 'm'), spam('link', 'l')])?.id).toBe('l');
  });
});

describe('validateWord', () => {
  it('trims, requires 1–50 folded characters, rejects non-strings', () => {
    expect(validateWord('  Spam  ', [])).toEqual({ ok: true, pattern: 'Spam' });
    expect(validateWord('   ', [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord('x'.repeat(51), [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord(42, [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord('​', [])).toEqual({ ok: false, error: 'invalid_word' });
  });

  it('duplicates are compared folded; the cap counts word rules only', () => {
    expect(validateWord('ＳＰＡＭ', [word('spam')])).toEqual({ ok: false, error: 'duplicate_rule' });
    const many = Array.from({ length: MAX_WORD_RULES }, (_, i) => word(`w${i}`));
    expect(validateWord('new', many)).toEqual({ ok: false, error: 'too_many_rules' });
    expect(validateWord('new', [...many.slice(1), spam('link')])).toEqual({ ok: true, pattern: 'new' });
  });
});

describe('touchedIds (auto-hide never acts twice, never after the owner)', () => {
  const rule = `rule:${R}`;
  it('any owner row, any non-retryable result, or 3 rule attempts mark a comment as touched', () => {
    const t = touchedIds([
      { commentId: 'owner', actor: 'owner', result: 'rate_limited' },
      { commentId: 'ok', actor: rule, result: 'ok' },
      { commentId: 'pending', actor: rule, result: 'pending' },
      { commentId: 'refused', actor: rule, result: 'not_allowed' },
      { commentId: 'retry', actor: rule, result: 'rate_limited' },
      { commentId: 'retry', actor: rule, result: 'instagram_unavailable' },
      { commentId: 'three', actor: rule, result: 'rate_limited' },
      { commentId: 'three', actor: rule, result: 'rate_limited' },
      { commentId: 'three', actor: rule, result: 'instagram_unavailable' },
    ]);
    expect([...t].sort()).toEqual(['ok', 'owner', 'pending', 'refused', 'three']);
  });
});

describe('pickAutoHide', () => {
  const rules = [word('spam')];
  it('visible, not the account itself (any case), not touched, matching; in input order, capped', () => {
    const cands = [
      c('1', 'spam one'),
      c('2', 'nice'),
      c('3', 'spam hidden', { hidden: true }),
      c('4', 'SPAM by me', { authorUsername: 'MyShop' }),
      c('5', 'spam touched'),
      c('6', null),
      c('7', 'spam two'),
      c('8', 'spam three'),
    ];
    const out = pickAutoHide(cands, rules, { ownUsername: 'myshop', touched: new Set(['5']), limit: 2 });
    expect(out.map((p) => p.comment.id)).toEqual(['1', '7']);
    expect(out[0].rule.id).toBe(R);
  });

  it('a comment without an author name is still checked', () => {
    expect(pickAutoHide([c('1', 'spam', { authorUsername: null })], rules, { ownUsername: 'me', touched: new Set(), limit: 20 })).toHaveLength(1);
  });

  it('no rules: nothing', () => {
    expect(pickAutoHide([c('1', 'spam')], [], { ownUsername: 'me', touched: new Set(), limit: 20 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/moderation-rules.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/moderation/rules"`.

- [ ] **Step 3: Write the module** — create `lib/moderation/rules.ts` (use the Write tool: regexes and non-ASCII):

```ts
// Banned words and spam patterns (Plan 15d). Pure: no I/O, no clock. The tick (lib/moderation/auto.ts) and the
// Moderation tab's preview use the same functions, so the preview shows exactly what auto-hide would do.
// Comment text is third-party personal data: it is only compared here, never logged or returned in errors.

export const RULE_KINDS = ['word', 'link', 'mentions', 'repeat', 'emoji'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
/** Built-in patterns, checked after the words in this order. A row of the kind = switched on. */
export const SPAM_KINDS = ['link', 'mentions', 'repeat', 'emoji'] as const satisfies readonly RuleKind[];
export type SpamKind = (typeof SPAM_KINDS)[number];

export const PATTERN_MAX = 50; // = the migration's check
export const MAX_WORD_RULES = 200;
export const REPEAT_MIN = 8; // the same character this many times in a row
export const MENTIONS_MIN = 4; // @mentions in one comment
export const EMOJI_MIN = 10; // emoji in one comment ...
export const EMOJI_TEXT_MAX = 3; // ... with at most this many letters or digits
export const MAX_AUTO_TRIES = 3; // rule attempts per comment (only retryable failures get a second one)
/** Instagram's comment length (Open question P6). Lives here (pure, client-safe) so the reply dialog can count it. */
export const REPLY_MAX = 2_200;
/** Rule attempts that ended like this are tried again on a later tick; everything else is final. */
export const RETRYABLE: readonly string[] = ['rate_limited', 'instagram_unavailable'];

export interface ModerationRule {
  id: string;
  kind: RuleKind;
  pattern: string | null; // words only, as the owner typed it (trimmed)
  wholeWord: boolean;
}

export interface Candidate {
  id: string;
  authorUsername: string | null;
  text: string | null;
  hidden: boolean;
}

/** One moderation_log row, as far as auto-hide cares. */
export interface LogMark {
  commentId: string;
  actor: string; // 'owner' | 'rule:<uuid>'
  result: string;
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
/** NFKC (full-width -> ASCII, half-width katakana -> full-width), lower case, zero-width removed, whitespace collapsed. */
export const fold = (s: string): string => s.normalize('NFKC').toLowerCase().replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_CHAR = '[\\p{L}\\p{N}_]';
/** A scheme or www., or a bare domain ending in a common TLD (not preceded by a letter, digit, @ . _ or -). */
const LINK = /(?:https?:\/\/|www\.)\S|(?<![\p{L}\p{N}@._-])[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.(?:com|net|org|info|biz|io|co|me|ly|xyz|top|shop|store|site|online|link|click|app|live|vip|club|cn|ru|my|sg)(?![\p{L}\p{N}])/u;
const MENTION = /(?<![\p{L}\p{N}_.])@[a-z0-9._]{1,30}/gu;
const REPEAT = new RegExp(`(\\S)\\1{${REPEAT_MIN - 1},}`, 'u');
const EMOJI = /\p{Extended_Pictographic}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

function wordMatches(text: string, rule: ModerationRule): boolean {
  const p = rule.pattern === null ? '' : fold(rule.pattern);
  if (p === '') return false;
  if (!rule.wholeWord || CJK.test(p)) return text.includes(p);
  return new RegExp(`(?<!${WORD_CHAR})${escape(p)}(?!${WORD_CHAR})`, 'u').test(text);
}

const SPAM: Record<SpamKind, (text: string) => boolean> = {
  link: (t) => LINK.test(t),
  mentions: (t) => count(MENTION, t) >= MENTIONS_MIN,
  repeat: (t) => REPEAT.test(t),
  emoji: (t) => count(EMOJI, t) >= EMOJI_MIN && count(LETTER_OR_DIGIT, t) <= EMOJI_TEXT_MAX,
};

/** The first rule the comment breaks: word rules in the given order, then link, mentions, repeat, emoji. */
export function matchRule(text: string | null, rules: readonly ModerationRule[]): ModerationRule | null {
  if (text === null || rules.length === 0) return null;
  const t = fold(text);
  if (t === '') return null;
  for (const r of rules) if (r.kind === 'word' && wordMatches(t, r)) return r;
  for (const kind of SPAM_KINDS) {
    const r = rules.find((x) => x.kind === kind);
    if (r && SPAM[kind](t)) return r;
  }
  return null;
}

/** A new banned word: trimmed, 1–PATTERN_MAX characters folded, not already listed (folded), under the cap. */
export function validateWord(raw: unknown, existing: readonly ModerationRule[]): { ok: true; pattern: string } | { ok: false; error: 'invalid_word' | 'duplicate_rule' | 'too_many_rules' } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_word' };
  const pattern = raw.trim();
  const folded = fold(pattern);
  if (folded === '' || [...pattern].length > PATTERN_MAX) return { ok: false, error: 'invalid_word' };
  const words = existing.filter((r) => r.kind === 'word');
  if (words.some((r) => r.pattern !== null && fold(r.pattern) === folded)) return { ok: false, error: 'duplicate_rule' };
  if (words.length >= MAX_WORD_RULES) return { ok: false, error: 'too_many_rules' };
  return { ok: true, pattern };
}

/**
 * Comments auto-hide must leave alone: the owner acted on it (any row: a manual unhide exempts it for good), a rule
 * attempt ended in a final result (ok, pending = outcome unknown, refused, gone, …), or MAX_AUTO_TRIES rule attempts.
 */
export function touchedIds(marks: readonly LogMark[]): Set<string> {
  const out = new Set<string>();
  const tries = new Map<string, number>();
  for (const m of marks) {
    if (m.actor === 'owner' || !RETRYABLE.includes(m.result)) out.add(m.commentId);
    const n = (tries.get(m.commentId) ?? 0) + 1;
    tries.set(m.commentId, n);
    if (n >= MAX_AUTO_TRIES) out.add(m.commentId);
  }
  return out;
}

/** What auto-hide would hide now, in the given (newest-first) order, at most `limit`. */
export function pickAutoHide(cands: readonly Candidate[], rules: readonly ModerationRule[], opts: { ownUsername: string; touched: ReadonlySet<string>; limit: number }): { comment: Candidate; rule: ModerationRule }[] {
  const own = opts.ownUsername.toLowerCase();
  const out: { comment: Candidate; rule: ModerationRule }[] = [];
  if (rules.length === 0) return out;
  for (const comment of cands) {
    if (out.length >= opts.limit) break;
    if (comment.hidden || opts.touched.has(comment.id) || comment.authorUsername?.toLowerCase() === own) continue;
    const rule = matchRule(comment.text, rules);
    if (rule) out.push({ comment, rule });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-rules.test.ts`
Expected: PASS (16 tests). Then `npx tsc --noEmit` and `npx eslint lib/moderation/rules.ts tests/moderation-rules.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/moderation/rules.ts tests/moderation-rules.test.ts
git commit -m "feat(moderation): banned-word and spam matching (fold, matchRule, touchedIds, pickAutoHide)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Meta write client + error classifier — `lib/instagram/moderation.ts`

**Files:**
- Create: `lib/instagram/moderation.ts`, `tests/instagram-moderation.test.ts`

**Interfaces:**
- Consumes: `call`, `InstagramApiError` (`lib/instagram/oauth.ts`), `classifyIgError` (`lib/instagram/data.ts`).
- Produces:
```ts
export const MODERATION_TIMEOUT_MS = 5_000;
export type ModerationErrorKey = 'reconnect' | 'rate_limited' | 'comment_gone' | 'not_allowed' | 'instagram_unavailable' | 'unknown_outcome' | 'unexpected';
export function classifyModerationError(e: unknown, write?: 'reply' | 'other'): ModerationErrorKey;
export function igModeration(apiVersion: string, fetchFn?: typeof fetch): {
  hide(token: string, commentId: string, hide: boolean): Promise<void>;
  reply(token: string, commentId: string, message: string): Promise<string | null>; // the reply's id; null = Meta said OK without an id
  remove(token: string, commentId: string): Promise<void>;
};
export type IgModeration = ReturnType<typeof igModeration>;
```

- [ ] **Step 1: Write the failing test** — create `tests/instagram-moderation.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { classifyModerationError, igModeration, MODERATION_TIMEOUT_MS } from '@/lib/instagram/moderation';
import { InstagramApiError } from '@/lib/instagram/oauth';

const TOKEN = 'IGAAsecret-token';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const setup = (res: () => Response | Promise<Response>) => {
  const fetchFn = vi.fn<typeof fetch>(async () => res());
  return { fetchFn, ig: igModeration('v25.0', fetchFn) };
};
const req = (f: ReturnType<typeof setup>['fetchFn'], i = 0) => ({ url: new URL(String(f.mock.calls[i][0])), init: f.mock.calls[i][1]! });

describe('igModeration: the three writes (graph.instagram.com, Instagram Login)', () => {
  it('hide: POST /{comment-id}?hide=true with the token in the query, a 5 s timeout and no redirects', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.hide(TOKEN, '17881770991003328', true);
    const { url, init } = req(fetchFn);
    expect(`${url.origin}${url.pathname}`).toBe('https://graph.instagram.com/v25.0/17881770991003328');
    expect(url.searchParams.get('hide')).toBe('true');
    expect(url.searchParams.get('access_token')).toBe(TOKEN);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(MODERATION_TIMEOUT_MS).toBe(5_000);
  });

  it('unhide: hide=false', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.hide(TOKEN, '1789', false);
    expect(req(fetchFn).url.searchParams.get('hide')).toBe('false');
  });

  it('reply: POST /{comment-id}/replies with a form-encoded message; returns the new id (null when Meta sends none)', async () => {
    const { fetchFn, ig } = setup(() => json({ id: '17873440459141029' }));
    expect(await ig.reply(TOKEN, '1789', 'Thank you 🙏 & see you')).toBe('17873440459141029');
    const { url, init } = req(fetchFn);
    expect(url.pathname).toBe('/v25.0/1789/replies');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(String(init.body)).get('message')).toBe('Thank you 🙏 & see you');
    expect(String(init.body)).not.toContain(TOKEN);
    const odd = setup(() => json({ ok: 1 }));
    expect(await odd.ig.reply(TOKEN, '1789', 'hi')).toBeNull();
  });

  it('remove: DELETE /{comment-id}', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await ig.remove(TOKEN, '1789');
    expect(req(fetchFn).init.method).toBe('DELETE');
    expect(req(fetchFn).url.pathname).toBe('/v25.0/1789');
  });

  it('a 200 without success:true is a failure (never assumed done)', async () => {
    const { ig } = setup(() => json({ success: false }));
    await expect(ig.hide(TOKEN, '1789', true)).rejects.toBeInstanceOf(InstagramApiError);
    await expect(ig.remove(TOKEN, '1789')).rejects.toBeInstanceOf(InstagramApiError);
  });

  it('an id that is not an Instagram id is refused before any request', async () => {
    const { fetchFn, ig } = setup(() => json({ success: true }));
    await expect(ig.hide(TOKEN, '../me', true)).rejects.toBeInstanceOf(InstagramApiError);
    await expect(ig.remove(TOKEN, '1789?x=1')).rejects.toBeInstanceOf(InstagramApiError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('errors carry no token, URL, body or Meta message', async () => {
    const { ig } = setup(() => json({ error: { code: 100, error_subcode: 33, message: `secret ${TOKEN}` } }, 400));
    const e = await ig.hide(TOKEN, '1789', true).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InstagramApiError);
    expect(`${String((e as Error).message)} ${JSON.stringify(e)} ${String((e as Error).stack)}`).not.toMatch(/IGAAsecret|graph\.instagram|secret/);
  });
});

describe('classifyModerationError', () => {
  const err = (status: number, code?: number, subcode?: number) => new InstagramApiError('data', status, code, subcode);
  it.each([
    ['token invalid (190)', err(400, 190), 'reconnect'],
    ['permission range (200)', err(403, 200), 'reconnect'],
    ['permission denied for the action (10)', err(400, 10), 'reconnect'],
    ['HTTP 401', err(401), 'reconnect'],
    ['HTTP 403 without a code', err(403), 'reconnect'],
    ['app rate limit (4)', err(400, 4), 'rate_limited'],
    ['user rate limit (17)', err(400, 17), 'rate_limited'],
    ['BUC throttle (80002)', err(400, 80002), 'rate_limited'],
    ['HTTP 429', err(429), 'rate_limited'],
    ['object missing (100/33)', err(400, 100, 33), 'comment_gone'],
    ['other invalid parameter (100)', err(400, 100), 'not_allowed'],
    ['HTTP 500', err(500), 'instagram_unavailable'],
    ['network / timeout', new InstagramApiError('network'), 'instagram_unavailable'],
    ['not an Instagram error', new Error('boom'), 'unexpected'],
  ])('%s', (_n, e, key) => {
    expect(classifyModerationError(e)).toBe(key);
  });

  it('a reply whose outcome Instagram did not confirm is unknown_outcome, never "try again"', () => {
    expect(classifyModerationError(new InstagramApiError('network'), 'reply')).toBe('unknown_outcome');
    expect(classifyModerationError(err(502), 'reply')).toBe('unknown_outcome');
    expect(classifyModerationError(err(400, 100), 'reply')).toBe('not_allowed');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/instagram-moderation.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/instagram/moderation"`.

- [ ] **Step 3: Write the module** — create `lib/instagram/moderation.ts`:

```ts
// Comment moderation writes (Plan 15d): hide / unhide, reply, delete. Instagram API with Instagram Login
// (graph.instagram.com, Instagram User token, instagram_business_basic + instagram_business_manage_comments).
// Read 2026-10-25 from https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment
// and https://developers.facebook.com/documentation/instagram-platform/comment-moderation:
//   POST   /{ig-comment-id}?hide=true|false  -> {"success": true}  (owner of the media; the owner's own comments are always shown)
//   POST   /{ig-comment-id}/replies message  -> {"id": "..."}
//   DELETE /{ig-comment-id}                  -> {"success": true}  (owner of the media)
// Rate limits for these writes are not documented (Open question P2); the callers cap their own volume.
// SERVER ONLY: the token is a request parameter; errors are InstagramApiError with fixed messages (never a URL or body).
import { classifyIgError } from '@/lib/instagram/data';
import { call, InstagramApiError } from '@/lib/instagram/oauth';

const HOST = 'https://graph.instagram.com';
/** Shorter than the sync's 10 s: the tick pass must end before the route's 60 s (lib/moderation/auto.ts). */
export const MODERATION_TIMEOUT_MS = 5_000;
/** Graph API "permission denied" for an action. (For READS the sync meets 10 as "not enough viewers".) */
const PERMISSION_DENIED = 10;
const ID = /^\w{1,64}$/;

export type ModerationErrorKey = 'reconnect' | 'rate_limited' | 'comment_gone' | 'not_allowed' | 'instagram_unavailable' | 'unknown_outcome' | 'unexpected';

/**
 * What a failed write means for the owner. `write = 'reply'`: a timeout or 5xx may still have posted the reply, so it is
 * unknown_outcome (the UI says "check on Instagram before sending again") instead of an invitation to retry.
 */
export function classifyModerationError(e: unknown, write: 'reply' | 'other' = 'other'): ModerationErrorKey {
  if (!(e instanceof InstagramApiError)) return 'unexpected';
  const k = classifyIgError(e);
  if (k === 'rate_limit' || k === 'app_rate_limit') return 'rate_limited';
  if (k === 'auth' || (e.kind !== 'network' && (e.code === PERMISSION_DENIED || e.status === 403))) return 'reconnect';
  if (k === 'gone') return 'comment_gone';
  if (k === 'transient') return write === 'reply' ? 'unknown_outcome' : 'instagram_unavailable';
  return 'not_allowed';
}

const init = (method: 'POST' | 'DELETE', form?: Record<string, string>): RequestInit => ({
  method,
  signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
  redirect: 'error', // the token is in the query: never follow a redirect anywhere
  ...(form ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() } : {}),
});

export function igModeration(apiVersion: string, fetchFn: typeof fetch = fetch) {
  const url = (commentId: string, edge: string, params: Record<string, string>, token: string) => {
    if (!ID.test(commentId)) throw new InstagramApiError('data'); // never build a path from anything else
    const u = new URL(`${HOST}/${apiVersion}/${commentId}${edge}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('access_token', token);
    return u.toString();
  };
  const success = (b: Record<string, unknown>) => {
    if (b.success !== true) throw new InstagramApiError('data');
  };
  return {
    async hide(token: string, commentId: string, hide: boolean): Promise<void> {
      success(await call('data', fetchFn, url(commentId, '', { hide: String(hide) }, token), init('POST')));
    },
    async reply(token: string, commentId: string, message: string): Promise<string | null> {
      const b = await call('data', fetchFn, url(commentId, '/replies', {}, token), init('POST', { message }));
      return typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
    },
    async remove(token: string, commentId: string): Promise<void> {
      success(await call('data', fetchFn, url(commentId, '', {}, token), init('DELETE')));
    },
  };
}

export type IgModeration = ReturnType<typeof igModeration>;
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/instagram-moderation.test.ts tests/instagram-data.test.ts` (the second only if it exists; `ls tests | grep instagram`), `npx tsc --noEmit`, `npx eslint lib/instagram/moderation.ts tests/instagram-moderation.test.ts`.
Expected: PASS (7 + 15 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/instagram/moderation.ts tests/instagram-moderation.test.ts
git commit -m "feat(instagram): comment moderation writes (hide, reply, delete) and their error keys" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Store — `lib/moderation/store.ts` (the SQL choke point)

**Files:**
- Create: `lib/moderation/store.ts`, `tests/moderation-store.test.ts`

**Interfaces:**
- Consumes: Task 1 tables/columns; Task 3 `RULE_KINDS`, `SPAM_KINDS`, `MAX_WORD_RULES`, `pickAutoHide`, `touchedIds`, types.
- Produces (Tasks 7, 8, 11, 12 use exactly these):
```ts
export const LOG_PAGE = 50, PREVIEW_SCAN = 1000, CANDIDATE_SCAN = 200, MARK_SCAN = 10_000, PENDING_STALE_MS = 120_000, CONTEXT_CHARS = 80, PREVIEW_SAMPLE = 5;
export type LogAction = 'reply' | 'hide' | 'unhide' | 'delete' | 'delete_reply';
export type UndoKind = 'unhide' | 'delete_reply';
export interface LogRow { id: number; commentId: string; action: LogAction; actor: string; result: string; targetId: string | null; undoOf: number | null; createdAt: string; undoneAt: string | null }
export interface LogEntry extends LogRow { shown: string; undo: UndoKind | null; context: { authorUsername: string | null; snippet: string | null } | null }
export interface ModerationSettings { autoHide: boolean; pausedAt: string | null; pauseReason: 'reconnect' | 'failing' | null }
export interface ModerationData {
  settings: ModerationSettings;
  rules: ModerationRule[];
  log: { rows: LogEntry[]; total: number; page: number; pages: number; size: number }; // size = LOG_PAGE (the client cannot import it)
  preview: { count: number; scanned: number; sample: { id: string; authorUsername: string | null; snippet: string | null; rule: ModerationRule }[] };
}
export interface ActionAccount { id: string; username: string; status: AccountStatus; grantedScopes: string[] | null }
export class ModerationStoreError extends Error { reason: 'missing' | 'duplicate' | 'not_found' | 'other' }
// pure
export function undoKind(r: Pick<LogRow, 'action' | 'result' | 'targetId' | 'undoneAt'>): UndoKind | null;
export function displayResult(r: Pick<LogRow, 'result' | 'createdAt'>, now: Date): string;
export function snippet(text: string | null): string | null;
// the tab (owner session)
export function loadModeration(db: SupabaseClient, accountId: string, ownUsername: string, page: number, now: Date): Promise<ModerationData | null>;
// actions (owner session; the tick passes the admin client)
export function getActionAccount(db, accountId): Promise<ActionAccount | null>;
export function getActionComment(db, accountId, commentId): Promise<{ id: string; authorUsername: string | null; hidden: boolean } | null>;
export function countRecentOwnerActions(db, accountId, sinceIso): Promise<number>;
export function insertLog(db, row: { accountId: string; commentId: string; action: LogAction; actor: string; requestId: string; undoOf?: number; targetId?: string }): Promise<number>;
export function finishLog(db, id: number, result: string, targetId?: string | null): Promise<void>;
export function getLog(db, accountId, id: number): Promise<LogRow | null>;
export function markUndone(db, accountId, id: number, atIso: string): Promise<boolean>;
export function setCommentHidden(db, accountId, commentId, hidden: boolean): Promise<void>;
export function removeComment(db, accountId, commentId): Promise<void>;
export function loadRules(db, accountId): Promise<ModerationRule[]>;
export function insertWordRule(db, accountId, pattern: string, wholeWord: boolean): Promise<void>;
export function setSpamRow(db, accountId, kind: SpamKind, on: boolean): Promise<void>;
export function deleteRuleRow(db, accountId, ruleId): Promise<boolean>;
export function saveAutoHide(db, accountId, enabled: boolean, nowIso: string): Promise<void>;
// the tick (admin client)
export function autoHideAccounts(db): Promise<{ accountId: string; rules: ModerationRule[] }[] | null>;
export function visibleComments(db, accountId, limit: number): Promise<Candidate[]>;
export function logMarks(db, accountId): Promise<LogMark[]>;
export function pauseAutoHide(db, accountId, reason: 'reconnect' | 'failing', atIso: string): Promise<void>;
```
Every write throws `ModerationStoreError` (fixed message `moderation store: <op> failed`, a `reason` from the Postgres/PostgREST code: `PGRST205`/`42P01` → `missing`, `23505` → `duplicate`, `23503` → `not_found`, else `other`); Supabase's own message is never used. Every query on `comments` and `moderation_log` filters by `account_id` (and the row id where there is one).

- [ ] **Step 1: Write the failing test** — create `tests/moderation-store.test.ts`:

```ts
// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTEXT_CHARS, LOG_PAGE, ModerationStoreError, autoHideAccounts, displayResult, finishLog, getActionComment, insertLog, loadModeration,
  markUndone, removeComment, setCommentHidden, setSpamRow, snippet, undoKind,
} from '@/lib/moderation/store';

type Res = { data?: unknown; error?: { code?: string } | null; count?: number | null };
const calls: unknown[][] = [];
let results: Record<string, Res[]> = {};

/** Records every builder call; each awaited query resolves to the next queued result of its table. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'in', 'not', 'gte', 'order', 'range', 'limit', 'maybeSingle', 'single'])
        chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve((results[table] ?? []).shift() ?? { data: null, error: null }).then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const R = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const Q = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const NOW = new Date('2026-10-29T10:00:00Z');
const logRow = (o: Record<string, unknown> = {}) => ({ id: 1, comment_id: 'c1', action: 'hide', actor: 'owner', result: 'ok', target_id: null, undo_of: null, created_at: '2026-10-29T09:00:00Z', undone_at: null, ...o });

beforeEach(() => {
  calls.length = 0;
  results = {};
});

describe('pure helpers', () => {
  it('undoKind: an ok hide can be unhidden, an ok reply with an id can be deleted; nothing else, nothing twice', () => {
    const r = { action: 'hide' as const, result: 'ok', targetId: null, undoneAt: null };
    expect(undoKind(r)).toBe('unhide');
    expect(undoKind({ ...r, action: 'reply', targetId: '1790' })).toBe('delete_reply');
    expect(undoKind({ ...r, action: 'reply' })).toBeNull(); // reply id unknown
    expect(undoKind({ ...r, undoneAt: '2026-10-29T09:30:00Z' })).toBeNull();
    expect(undoKind({ ...r, result: 'pending' })).toBeNull();
    expect(undoKind({ ...r, action: 'delete' })).toBeNull(); // irreversible
    expect(undoKind({ ...r, action: 'unhide' })).toBeNull();
  });

  it('displayResult: a pending row older than 2 minutes is shown as unknown', () => {
    expect(displayResult({ result: 'pending', createdAt: '2026-10-29T09:59:00Z' }, NOW)).toBe('pending');
    expect(displayResult({ result: 'pending', createdAt: '2026-10-29T09:57:59Z' }, NOW)).toBe('unknown');
    expect(displayResult({ result: 'rate_limited', createdAt: '2026-10-29T09:00:00Z' }, NOW)).toBe('rate_limited');
  });

  it('snippet: whitespace collapsed, clipped to 80 characters (code points) with an ellipsis', () => {
    expect(snippet(null)).toBeNull();
    expect(snippet('  hi \n there ')).toBe('hi there');
    const s = snippet('😀'.repeat(100))!;
    expect([...s]).toHaveLength(CONTEXT_CHARS);
    expect(s.endsWith('…')).toBe(true);
  });
});

describe('log writes', () => {
  it('insertLog stores ids only and returns the new id', async () => {
    results.moderation_log = [{ data: { id: 7 }, error: null }];
    expect(await insertLog(fakeDb(), { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: R })).toBe(7);
    const payload = calls.find((c) => c[0] === 'insert')![1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['account_id', 'action', 'actor', 'comment_id', 'request_id']);
  });

  it('insertLog: a repeated request id is "duplicate", a missing table "missing"; the message is fixed', async () => {
    results.moderation_log = [{ data: null, error: { code: '23505' } }, { data: null, error: { code: 'PGRST205' } }, { data: null, error: { code: 'XX000' } }];
    const run = () => insertLog(fakeDb(), { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: R });
    await expect(run()).rejects.toMatchObject({ reason: 'duplicate', message: 'moderation store: insertLog failed' });
    await expect(run()).rejects.toMatchObject({ reason: 'missing' });
    await expect(run()).rejects.toBeInstanceOf(ModerationStoreError);
  });

  it('finishLog writes the result (and the reply id when given) by row id', async () => {
    await finishLog(fakeDb(), 7, 'ok', '1790');
    expect(has('update', { result: 'ok', target_id: '1790' })).toBe(true);
    expect(has('eq', 'id', 7)).toBe(true);
    calls.length = 0;
    await finishLog(fakeDb(), 7, 'rate_limited');
    expect(has('update', { result: 'rate_limited' })).toBe(true);
  });

  it('markUndone only once, only for this account', async () => {
    results.moderation_log = [{ data: [{ id: 7 }], error: null }, { data: [], error: null }];
    expect(await markUndone(fakeDb(), A, 7, NOW.toISOString())).toBe(true);
    expect(has('eq', 'account_id', A) && has('is', 'undone_at', null)).toBe(true);
    expect(await markUndone(fakeDb(), A, 7, NOW.toISOString())).toBe(false);
  });
});

describe('comments: every read and write is filtered by the comment id AND the account id', () => {
  it.each([
    ['getActionComment', () => getActionComment(fakeDb(), A, 'c1')],
    ['setCommentHidden', () => setCommentHidden(fakeDb(), A, 'c1', true)],
    ['removeComment', () => removeComment(fakeDb(), A, 'c1')],
  ])('%s', async (_n, run) => {
    await run();
    expect(has('from', 'comments')).toBe(true);
    expect(has('eq', 'id', 'c1')).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
  });

  it('getActionComment maps the row; null when absent', async () => {
    results.comments = [{ data: { id: 'c1', author_username: 'fan', hidden: true }, error: null }, { data: null, error: null }];
    expect(await getActionComment(fakeDb(), A, 'c1')).toEqual({ id: 'c1', authorUsername: 'fan', hidden: true });
    expect(await getActionComment(fakeDb(), A, 'c2')).toBeNull();
  });
});

describe('rules and settings', () => {
  it('a spam pattern switched on twice stays one row (the unique index answers 23505)', async () => {
    results.moderation_rules = [{ data: null, error: { code: '23505' } }];
    await expect(setSpamRow(fakeDb(), A, 'link', true)).resolves.toBeUndefined();
    await setSpamRow(fakeDb(), A, 'link', false);
    expect(has('delete')).toBe(true);
    expect(has('eq', 'kind', 'link')).toBe(true);
  });
});

describe('loadModeration (the tab)', () => {
  const seed = () => {
    results.moderation_settings = [{ data: { auto_hide: true, paused_at: null, pause_reason: null }, error: null }];
    results.moderation_rules = [{ data: [{ id: R, kind: 'word', pattern: 'spam', whole_word: false }, { id: Q, kind: 'bogus', pattern: null, whole_word: false }], error: null }];
    results.moderation_log = [
      { data: [logRow(), logRow({ id: 2, comment_id: 'gone', action: 'reply', target_id: '1790', result: 'pending', created_at: '2026-10-29T09:00:00Z' })], count: 2, error: null },
      { data: [{ comment_id: 'c9', actor: 'owner', result: 'ok' }], error: null }, // marks: c9 touched
    ];
    results.comments = [
      { data: [{ id: 'c1', author_username: 'fan', text: 'buy spam now' }], error: null }, // context of the log page
      { data: [{ id: 'c3', author_username: 'x', text: 'spam!', hidden: false }, { id: 'c9', author_username: 'y', text: 'spam', hidden: false }, { id: 'c4', author_username: 'z', text: 'nice', hidden: false }], error: null }, // visible
    ];
  };

  it('settings, valid rules only, a log page with context, display state and undo, and the preview', async () => {
    seed();
    const d = (await loadModeration(fakeDb(), A, 'me', 1, NOW))!;
    expect(d.settings).toEqual({ autoHide: true, pausedAt: null, pauseReason: null });
    expect(d.rules).toEqual([{ id: R, kind: 'word', pattern: 'spam', wholeWord: false }]);
    expect(d.log.total).toBe(2);
    expect(d.log.pages).toBe(1);
    expect(d.log.rows[0]).toMatchObject({ id: 1, commentId: 'c1', shown: 'ok', undo: 'unhide', context: { authorUsername: 'fan', snippet: 'buy spam now' } });
    expect(d.log.rows[1]).toMatchObject({ id: 2, shown: 'unknown', undo: null, context: null });
    expect(d.preview).toMatchObject({ count: 1, scanned: 3 });
    expect(d.preview.sample.map((s) => s.id)).toEqual(['c3']);
    expect(has('range', 0, LOG_PAGE - 1)).toBe(true);
  });

  it('a page past the end (PostgREST 416, PGRST103) reads page 1 instead', async () => {
    seed();
    results.moderation_log.unshift({ data: null, error: { code: 'PGRST103' } });
    const d = (await loadModeration(fakeDb(), A, 'me', 9, NOW))!;
    expect(d.log.page).toBe(1);
    expect(has('range', 0, LOG_PAGE - 1)).toBe(true);
  });

  it('null before the migration (a missing table)', async () => {
    results.moderation_settings = [{ data: null, error: { code: 'PGRST205' } }];
    expect(await loadModeration(fakeDb(), A, 'me', 1, NOW)).toBeNull();
  });
});

describe('the tick reads', () => {
  it('autoHideAccounts: accounts with auto-hide on and not paused, with their rules; null before the migration', async () => {
    results.moderation_settings = [{ data: [{ account_id: A }], error: null }];
    results.moderation_rules = [{ data: [{ id: R, account_id: A, kind: 'link', pattern: null, whole_word: false }], error: null }];
    expect(await autoHideAccounts(fakeDb())).toEqual([{ accountId: A, rules: [{ id: R, kind: 'link', pattern: null, wholeWord: false }] }]);
    expect(has('eq', 'auto_hide', true) && has('is', 'paused_at', null)).toBe(true);
    results.moderation_settings = [{ data: null, error: { code: '42P01' } }];
    expect(await autoHideAccounts(fakeDb())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/moderation-store.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/moderation/store"`.

- [ ] **Step 3: Write the module** — create `lib/moderation/store.ts`:

```ts
// Moderation persistence (Plan 15d). The ONLY module that names moderation_settings / moderation_rules /
// moderation_log and writes comments (tests/moderation-privacy.test.ts). Every function takes the client to use: the
// OWNER SESSION from the app (RLS applies), the ADMIN client from the sync tick. Every comments / log query is filtered
// by account_id. Errors are ModerationStoreError with a fixed message and a reason; Supabase's message is never used
// (it can echo values). Comment text is read only for the preview and the log context; it is never written anywhere.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountStatus } from '@/lib/accounts/types';
import { MAX_WORD_RULES, pickAutoHide, RULE_KINDS, SPAM_KINDS, touchedIds, type Candidate, type LogMark, type ModerationRule, type RuleKind, type SpamKind } from '@/lib/moderation/rules';

export const LOG_PAGE = 50;
export const PREVIEW_SCAN = 1000; // newest stored comments the preview checks
export const CANDIDATE_SCAN = 200; // newest stored comments one tick checks per account
export const MARK_SCAN = 10_000; // ponytail: newest log rows read for "touched"; an account with more needs a SQL anti-join
export const PENDING_STALE_MS = 120_000;
export const CONTEXT_CHARS = 80;
export const PREVIEW_SAMPLE = 5;

export type LogAction = 'reply' | 'hide' | 'unhide' | 'delete' | 'delete_reply';
export type UndoKind = 'unhide' | 'delete_reply';
export interface LogRow {
  id: number;
  commentId: string;
  action: LogAction;
  actor: string;
  result: string;
  targetId: string | null;
  undoOf: number | null;
  createdAt: string;
  undoneAt: string | null;
}
export interface LogEntry extends LogRow {
  shown: string; // displayResult
  undo: UndoKind | null;
  context: { authorUsername: string | null; snippet: string | null } | null; // null = the comment is no longer stored
}
export interface ModerationSettings {
  autoHide: boolean;
  pausedAt: string | null;
  pauseReason: 'reconnect' | 'failing' | null;
}
export interface ModerationData {
  settings: ModerationSettings;
  rules: ModerationRule[];
  log: { rows: LogEntry[]; total: number; page: number; pages: number; size: number };
  preview: { count: number; scanned: number; sample: { id: string; authorUsername: string | null; snippet: string | null; rule: ModerationRule }[] };
}
export interface ActionAccount {
  id: string;
  username: string;
  status: AccountStatus;
  grantedScopes: string[] | null;
}

type Reason = 'missing' | 'duplicate' | 'not_found' | 'other';
type DbError = { code?: string } | null | undefined;
export class ModerationStoreError extends Error {
  constructor(op: string, public reason: Reason) {
    super(`moderation store: ${op} failed`);
    this.name = 'ModerationStoreError';
  }
}
const reasonOf = (e: DbError): Reason => (e?.code === 'PGRST205' || e?.code === '42P01' ? 'missing' : e?.code === '23505' ? 'duplicate' : e?.code === '23503' ? 'not_found' : 'other');
function check(op: string, e: DbError): void {
  if (e) throw new ModerationStoreError(op, reasonOf(e));
}
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const ACTIONS: readonly string[] = ['reply', 'hide', 'unhide', 'delete', 'delete_reply'];
const LOG_COLUMNS = 'id,comment_id,action,actor,result,target_id,undo_of,created_at,undone_at';

const toLog = (r: Row): LogRow | null =>
  typeof r.id === 'number' && typeof r.comment_id === 'string' && ACTIONS.includes(r.action as string) && typeof r.created_at === 'string'
    ? { id: r.id, commentId: r.comment_id, action: r.action as LogAction, actor: String(r.actor), result: String(r.result), targetId: str(r.target_id), undoOf: typeof r.undo_of === 'number' ? r.undo_of : null, createdAt: r.created_at, undoneAt: str(r.undone_at) }
    : null;
const toRule = (r: Row): ModerationRule | null =>
  typeof r.id === 'string' && (RULE_KINDS as readonly string[]).includes(r.kind as string) ? { id: r.id, kind: r.kind as RuleKind, pattern: str(r.pattern), wholeWord: r.whole_word === true } : null;
const rulesOf = (rows: Row[]) => rows.map(toRule).filter((r): r is ModerationRule => r !== null);
const toCandidate = (r: Row): Candidate => ({ id: String(r.id), authorUsername: str(r.author_username), text: str(r.text), hidden: r.hidden === true });

/** What the log can undo: an ok hide (unhide) and an ok reply whose id is known (delete it). Delete never. Once only. */
export function undoKind(r: Pick<LogRow, 'action' | 'result' | 'targetId' | 'undoneAt'>): UndoKind | null {
  if (r.result !== 'ok' || r.undoneAt !== null) return null;
  if (r.action === 'hide') return 'unhide';
  if (r.action === 'reply' && r.targetId !== null) return 'delete_reply';
  return null;
}

/** A row still 'pending' after PENDING_STALE_MS never got its outcome written (see the plan's repair rule): unknown. */
export const displayResult = (r: Pick<LogRow, 'result' | 'createdAt'>, now: Date): string =>
  r.result === 'pending' && now.getTime() - Date.parse(r.createdAt) > PENDING_STALE_MS ? 'unknown' : r.result;

export function snippet(text: string | null): string | null {
  if (text === null) return null;
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > CONTEXT_CHARS ? chars.slice(0, CONTEXT_CHARS - 1).join('') + '…' : chars.join('');
}

// ---- the tab (owner session) ----

export async function loadModeration(db: SupabaseClient, accountId: string, ownUsername: string, page: number, now: Date): Promise<ModerationData | null> {
  const logPage = (p: number) =>
    db.from('moderation_log').select(LOG_COLUMNS, { count: 'exact' }).eq('account_id', accountId).order('created_at', { ascending: false }).order('id', { ascending: false }).range((p - 1) * LOG_PAGE, p * LOG_PAGE - 1);
  const [s, r, first] = await Promise.all([
    db.from('moderation_settings').select('auto_hide,paused_at,pause_reason').eq('account_id', accountId).maybeSingle(),
    db.from('moderation_rules').select('id,kind,pattern,whole_word').eq('account_id', accountId).order('created_at').limit(MAX_WORD_RULES + SPAM_KINDS.length),
    logPage(page),
  ]);
  if ([s.error, r.error, first.error].some((e) => reasonOf(e) === 'missing')) return null;
  check('loadModeration', s.error);
  check('loadModeration', r.error);
  let shownPage = page;
  let log = first;
  if (log.error?.code === 'PGRST103') {
    shownPage = 1; // a stale ?page= past the end: show page 1 (UI standard 12)
    log = await logPage(1);
  }
  check('loadModeration', log.error);
  const settingsRow = (s.data ?? {}) as Row;
  const rules = rulesOf((r.data ?? []) as Row[]);
  const rows = ((log.data ?? []) as Row[]).map(toLog).filter((x): x is LogRow => x !== null);
  const ids = [...new Set(rows.map((x) => x.commentId))];
  // started in this order (each async helper reaches its query at once), so a test's queued results come back in order:
  // the log page's context, then the preview's comments, then the marks
  const [ctx, visible, marks] = await Promise.all([
    (async () => (ids.length ? await db.from('comments').select('id,author_username,text').eq('account_id', accountId).in('id', ids) : { data: [], error: null }))(),
    visibleComments(db, accountId, PREVIEW_SCAN),
    logMarks(db, accountId),
  ]);
  check('loadModeration', ctx.error);
  const byId = new Map(((ctx.data ?? []) as Row[]).map((c) => [String(c.id), c]));
  const picks = pickAutoHide(visible, rules, { ownUsername, touched: touchedIds(marks), limit: Infinity });
  const total = log.count ?? rows.length;
  return {
    settings: { autoHide: settingsRow.auto_hide === true, pausedAt: str(settingsRow.paused_at), pauseReason: settingsRow.pause_reason === 'reconnect' || settingsRow.pause_reason === 'failing' ? settingsRow.pause_reason : null },
    rules,
    log: {
      rows: rows.map((x) => {
        const c = byId.get(x.commentId);
        return { ...x, shown: displayResult(x, now), undo: undoKind(x), context: c ? { authorUsername: str(c.author_username), snippet: snippet(str(c.text)) } : null };
      }),
      total,
      page: shownPage,
      pages: Math.max(1, Math.ceil(total / LOG_PAGE)),
      size: LOG_PAGE,
    },
    preview: { count: picks.length, scanned: visible.length, sample: picks.slice(0, PREVIEW_SAMPLE).map((p) => ({ id: p.comment.id, authorUsername: p.comment.authorUsername, snippet: snippet(p.comment.text), rule: p.rule })) },
  };
}

// ---- actions ----

export async function getActionAccount(db: SupabaseClient, accountId: string): Promise<ActionAccount | null> {
  const { data, error } = await db.from('accounts').select('id,username,status,granted_scopes').eq('id', accountId).maybeSingle();
  check('getActionAccount', error);
  const r = data as Row | null;
  if (!r || typeof r.username !== 'string') return null;
  return { id: String(r.id), username: r.username, status: r.status as AccountStatus, grantedScopes: Array.isArray(r.granted_scopes) ? r.granted_scopes.filter((x): x is string => typeof x === 'string') : null };
}

export async function getActionComment(db: SupabaseClient, accountId: string, commentId: string): Promise<{ id: string; authorUsername: string | null; hidden: boolean } | null> {
  const { data, error } = await db.from('comments').select('id,author_username,hidden').eq('id', commentId).eq('account_id', accountId).maybeSingle();
  check('getActionComment', error);
  const r = data as Row | null;
  return r ? { id: String(r.id), authorUsername: str(r.author_username), hidden: r.hidden === true } : null;
}

export async function countRecentOwnerActions(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db.from('moderation_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('actor', 'owner').gte('created_at', sinceIso);
  check('countRecentOwnerActions', error);
  return count ?? 0;
}

export async function insertLog(db: SupabaseClient, row: { accountId: string; commentId: string; action: LogAction; actor: string; requestId: string; undoOf?: number; targetId?: string }): Promise<number> {
  const payload: Row = { account_id: row.accountId, comment_id: row.commentId, action: row.action, actor: row.actor, request_id: row.requestId };
  if (row.undoOf !== undefined) payload.undo_of = row.undoOf;
  if (row.targetId !== undefined) payload.target_id = row.targetId;
  const { data, error } = await db.from('moderation_log').insert(payload).select('id').single();
  check('insertLog', error);
  const id = (data as Row | null)?.id;
  if (typeof id !== 'number') throw new ModerationStoreError('insertLog', 'other');
  return id;
}

export async function finishLog(db: SupabaseClient, id: number, result: string, targetId?: string | null): Promise<void> {
  const patch: Row = { result };
  if (targetId !== undefined) patch.target_id = targetId;
  const { error } = await db.from('moderation_log').update(patch).eq('id', id);
  check('finishLog', error);
}

export async function getLog(db: SupabaseClient, accountId: string, id: number): Promise<LogRow | null> {
  const { data, error } = await db.from('moderation_log').select(LOG_COLUMNS).eq('id', id).eq('account_id', accountId).maybeSingle();
  check('getLog', error);
  return data ? toLog(data as Row) : null;
}

export async function markUndone(db: SupabaseClient, accountId: string, id: number, atIso: string): Promise<boolean> {
  const { data, error } = await db.from('moderation_log').update({ undone_at: atIso }).eq('id', id).eq('account_id', accountId).is('undone_at', null).select('id');
  check('markUndone', error);
  return ((data ?? []) as Row[]).length > 0;
}

export async function setCommentHidden(db: SupabaseClient, accountId: string, commentId: string, hidden: boolean): Promise<void> {
  const { error } = await db.from('comments').update({ hidden }).eq('id', commentId).eq('account_id', accountId);
  check('setCommentHidden', error);
}

/** After a delete on Instagram (or "comment gone"): our copy goes too (third-party data we no longer need). */
export async function removeComment(db: SupabaseClient, accountId: string, commentId: string): Promise<void> {
  const { error } = await db.from('comments').delete().eq('id', commentId).eq('account_id', accountId);
  check('removeComment', error);
}

// ---- rules and settings (owner session) ----

export async function loadRules(db: SupabaseClient, accountId: string): Promise<ModerationRule[]> {
  const { data, error } = await db.from('moderation_rules').select('id,kind,pattern,whole_word').eq('account_id', accountId).order('created_at').limit(MAX_WORD_RULES + SPAM_KINDS.length);
  check('loadRules', error);
  return rulesOf((data ?? []) as Row[]);
}

export async function insertWordRule(db: SupabaseClient, accountId: string, pattern: string, wholeWord: boolean): Promise<void> {
  const { error } = await db.from('moderation_rules').insert({ account_id: accountId, kind: 'word', pattern, whole_word: wholeWord });
  check('insertWordRule', error);
}

/** On = a row (the partial unique index keeps it single: a second insert's 23505 means "already on"); off = no row. */
export async function setSpamRow(db: SupabaseClient, accountId: string, kind: SpamKind, on: boolean): Promise<void> {
  if (on) {
    const { error } = await db.from('moderation_rules').insert({ account_id: accountId, kind });
    if (reasonOf(error) !== 'duplicate') check('setSpamRow', error);
    return;
  }
  const { error } = await db.from('moderation_rules').delete().eq('account_id', accountId).eq('kind', kind);
  check('setSpamRow', error);
}

export async function deleteRuleRow(db: SupabaseClient, accountId: string, ruleId: string): Promise<boolean> {
  const { data, error } = await db.from('moderation_rules').delete().eq('id', ruleId).eq('account_id', accountId).select('id');
  check('deleteRuleRow', error);
  return ((data ?? []) as Row[]).length > 0;
}

/** Switching on (again) also lifts a pause; switching off clears it too. */
export async function saveAutoHide(db: SupabaseClient, accountId: string, enabled: boolean, nowIso: string): Promise<void> {
  const { error } = await db.from('moderation_settings').upsert({ account_id: accountId, auto_hide: enabled, paused_at: null, pause_reason: null, updated_at: nowIso }, { onConflict: 'account_id' });
  check('saveAutoHide', error);
}

// ---- the tick (admin client) ----

export async function autoHideAccounts(db: SupabaseClient): Promise<{ accountId: string; rules: ModerationRule[] }[] | null> {
  const s = await db.from('moderation_settings').select('account_id').eq('auto_hide', true).is('paused_at', null);
  if (reasonOf(s.error) === 'missing') return null;
  check('autoHideAccounts', s.error);
  const ids = ((s.data ?? []) as Row[]).map((r) => String(r.account_id));
  if (ids.length === 0) return [];
  const r = await db.from('moderation_rules').select('id,account_id,kind,pattern,whole_word').in('account_id', ids).order('created_at');
  check('autoHideAccounts', r.error);
  const rows = (r.data ?? []) as Row[];
  return ids.map((accountId) => ({ accountId, rules: rulesOf(rows.filter((x) => x.account_id === accountId)) }));
}

/** Stored comments not hidden by us, newest first. */
export async function visibleComments(db: SupabaseClient, accountId: string, limit: number): Promise<Candidate[]> {
  const { data, error } = await db.from('comments').select('id,author_username,text,hidden').eq('account_id', accountId).eq('hidden', false).order('commented_at', { ascending: false }).limit(limit);
  check('visibleComments', error);
  return ((data ?? []) as Row[]).map(toCandidate);
}

export async function logMarks(db: SupabaseClient, accountId: string): Promise<LogMark[]> {
  const { data, error } = await db.from('moderation_log').select('comment_id,actor,result').eq('account_id', accountId).order('created_at', { ascending: false }).limit(MARK_SCAN);
  check('logMarks', error);
  return ((data ?? []) as Row[]).map((r) => ({ commentId: String(r.comment_id), actor: String(r.actor), result: String(r.result) }));
}

/** Only the first pause counts (its paused_at is the notification's dedupe key). */
export async function pauseAutoHide(db: SupabaseClient, accountId: string, reason: 'reconnect' | 'failing', atIso: string): Promise<void> {
  const { error } = await db.from('moderation_settings').update({ paused_at: atIso, pause_reason: reason, updated_at: atIso }).eq('account_id', accountId).is('paused_at', null);
  check('pauseAutoHide', error);
}
```

Note for the implementer: `CANDIDATE_SCAN` lives here (Task 8 imports it) so the tick and the preview read comments the same way.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-store.test.ts`, `npx tsc --noEmit`, `npx eslint lib/moderation/store.ts tests/moderation-store.test.ts`.
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/moderation/store.ts tests/moderation-store.test.ts
git commit -m "feat(moderation): store (log, rules, settings, tab read, tick reads) as the one SQL choke point" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Alerts — the `moderation_paused` kind (one notification per pause)

**Files:**
- Modify: `lib/alerts/settings.ts`, `lib/alerts/rules.ts`, `lib/alerts/store.ts`, `lib/alerts/run.ts`, `lib/alerts/message.ts`, `tests/alert-settings.test.ts`
- Create: `tests/alerts-moderation.test.ts`
- Existing tests that must keep passing: `tests/alert-message.test.ts` (every kind has messages: Task 2 added them), `tests/alert-rules.test.ts`, `tests/alert-run.test.ts`, `tests/sync-tick-alerts.test.ts`, `tests/settings-notifications.test.tsx` (one switch per kind: a sixth switch appears, labelled "Auto-hide paused"), `tests/notification-bell.test.tsx`, `tests/push-actions.test.ts`.

**Interfaces:**
- Produces: `ALERT_KINDS` ends with `'moderation_paused'`; `DEFAULT_ALERT_SETTINGS.push.moderation_paused = true`; `RuleInput.moderationPausedAt?: string | null`; `AlertStore.moderationPausedAt?(accountId: string): Promise<string | null>` (OPTIONAL, so every existing fake store stays valid); `alertHref('moderation_paused', id) = '/accounts/<id>?tab=moderation'`.

- [ ] **Step 1: Write the failing test** — create `tests/alerts-moderation.test.ts`:

```ts
// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { alertHref } from '@/lib/alerts/message';
import { pushMessage } from '@/lib/alerts/push-message';
import { evaluateRules, type RuleInput } from '@/lib/alerts/rules';
import { runAlerts } from '@/lib/alerts/run';
import { ALERT_KINDS, DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
import { supabaseAlertStore } from '@/lib/alerts/store';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { memoryAlertStore } from './fixtures/alert-fakes';
import { account, fakeAccounts } from './fixtures/sync-fakes';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const AT = '2026-10-14T01:30:00.000Z';
const NOW = new Date('2026-10-14T02:00:00Z');
const input = (o: Partial<RuleInput> = {}): RuleInput => ({
  account: { id: A, username: 'cafe', status: 'active', tokenExpiresAt: null },
  sync: { consecutiveFailures: 0, lastSuccessAt: null },
  daily: [],
  posts: [],
  lastReachDropAt: null,
  settings: DEFAULT_ALERT_SETTINGS,
  now: NOW,
  tz: 'Asia/Kuala_Lumpur',
  ...o,
});

describe('moderation_paused alert', () => {
  it('is a known kind, pushed by default, kept by the settings parser', () => {
    expect(ALERT_KINDS.at(-1)).toBe('moderation_paused');
    expect(DEFAULT_ALERT_SETTINGS.push.moderation_paused).toBe(true);
    expect(parseAlertSettings({ push: { moderation_paused: false } }).push.moderation_paused).toBe(false);
  });

  it('one warning per pause: the dedupe key carries the pause time; payload = the account name only', () => {
    expect(evaluateRules(input({ moderationPausedAt: AT })).filter((a) => a.kind === 'moderation_paused')).toEqual([
      { kind: 'moderation_paused', accountId: A, severity: 'warning', dedupeKey: `moderation_paused:${A}:${AT}`, payload: { username: 'cafe' } },
    ]);
    expect(evaluateRules(input({ moderationPausedAt: null })).some((a) => a.kind === 'moderation_paused')).toBe(false);
    expect(evaluateRules(input()).some((a) => a.kind === 'moderation_paused')).toBe(false);
    expect(evaluateRules(input({ moderationPausedAt: AT, account: { id: A, username: 'cafe', status: 'archived', tokenExpiresAt: null } }))).toEqual([]);
  });

  it('runAlerts reads the pause per account; a store without the method (older fakes) simply has none', async () => {
    const mem = memoryAlertStore();
    const ctx = { accounts: fakeAccounts([account({ id: A, username: 'cafe' })]).accounts, sync: { loadStates: async () => new Map() }, now: NOW, tz: 'UTC', deadline: Infinity, clock: () => NOW.getTime() };
    await runAlerts({ store: { ...mem.store, moderationPausedAt: vi.fn(async () => AT) }, push: null }, ctx);
    expect(mem.rows.map((r) => r.dedupeKey)).toContain(`moderation_paused:${A}:${AT}`);
    const plain = memoryAlertStore();
    await expect(runAlerts({ store: plain.store, push: null }, ctx)).resolves.toMatchObject({ failed: 0 });
    expect(plain.rows.some((r) => r.kind === 'moderation_paused')).toBe(false);
  });

  it('the store reads paused_at of an enabled account; null before the migration; a fixed error otherwise', async () => {
    const calls: unknown[][] = [];
    const db = (res: { data: unknown; error: { code?: string } | null }) =>
      ({
        from: (t: string) => {
          calls.push(['from', t]);
          const chain: Record<string, unknown> = {};
          for (const op of ['select', 'eq', 'not', 'maybeSingle']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
          chain.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r);
          return chain;
        },
      }) as unknown as SupabaseClient;
    expect(await supabaseAlertStore(db({ data: { paused_at: AT }, error: null })).moderationPausedAt!(A)).toBe(AT);
    expect(calls).toContainEqual(['from', 'moderation_settings']);
    expect(calls).toContainEqual(['eq', 'auto_hide', true]);
    expect(calls).toContainEqual(['not', 'paused_at', 'is', null]);
    expect(await supabaseAlertStore(db({ data: null, error: { code: 'PGRST205' } })).moderationPausedAt!(A)).toBeNull();
    await expect(supabaseAlertStore(db({ data: null, error: { code: 'XX000' } })).moderationPausedAt!(A)).rejects.toThrow('alert store: moderationPausedAt failed');
  });

  it('opens the Moderation tab; the text names the account and nothing else', () => {
    expect(alertHref('moderation_paused', A)).toBe(`/accounts/${A}?tab=moderation`);
    const m = pushMessage({ kind: 'moderation_paused', accountId: A, payload: { username: 'cafe' } }, { ...DEFAULT_PREFS, locale: 'en' });
    expect(m.title).toBe('Auto-hide paused');
    expect(m.body).toContain('@cafe');
    expect(m.url).toBe(`/accounts/${A}?tab=moderation`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/alerts-moderation.test.ts`
Expected: FAIL — `expected 'taking_off' to be 'moderation_paused'` (and the other assertions).

- [ ] **Step 3: Make the edits** (anchored text edits; every other line unchanged)

`lib/alerts/settings.ts`:
```ts
export const ALERT_KINDS = ['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused'] as const;
```
and in `DEFAULT_ALERT_SETTINGS.push` add `moderation_paused: true` after `taking_off: false`.

`lib/alerts/rules.ts` — in `RuleInput` after `lastReachDropAt`:
```ts
  /** moderation_settings.paused_at of an account whose auto-hide is on but paused (Plan 15d); null/absent = not paused. */
  moderationPausedAt?: string | null;
```
add the rule before `const RULES`:
```ts
/** Key: moderation_paused:<account>:<paused_at>. One alert per pause; switching auto-hide on again clears paused_at. */
const moderationPaused: Rule = ({ account: a, moderationPausedAt }) =>
  a.status === 'active' && moderationPausedAt
    ? [{ kind: 'moderation_paused', accountId: a.id, severity: 'warning', dedupeKey: `moderation_paused:${a.id}:${moderationPausedAt}`, payload: { username: a.username } }]
    : [];
```
and `const RULES: Rule[] = [needsReconnect, tokenExpiring, syncFailing, reachDropRule, takingOffRule, moderationPaused];`

`lib/alerts/store.ts` — in `AlertStore` after `lastReachDropAt`:
```ts
  /** Plan 15d: paused_at when auto-hide is on but paused, else null; null before the moderation migration. Optional for fakes. */
  moderationPausedAt?(accountId: string): Promise<string | null>;
```
and in `supabaseAlertStore` after `lastReachDropAt(…) {…},`:
```ts
    async moderationPausedAt(accountId) {
      const { data, error } = await db.from('moderation_settings').select('paused_at').eq('account_id', accountId).eq('auto_hide', true).not('paused_at', 'is', null).maybeSingle();
      if (error?.code === 'PGRST205' || error?.code === '42P01') return null; // the moderation migration is not applied yet
      if (error) fail('moderationPausedAt');
      const at = (data as Row | null)?.paused_at;
      return isStr(at) ? at : null;
    },
```

`lib/alerts/run.ts` — replace the per-account read and the `evaluateRules` call:
```ts
        const [daily, posts, lastReachDropAt, moderationPausedAt] = await Promise.all([deps.store.daily(a.id, fromDay), deps.store.posts(a.id), deps.store.lastReachDropAt(a.id), deps.store.moderationPausedAt?.(a.id) ?? null]);
        const s = states.get(a.id);
        found.push(...evaluateRules({ account: a, sync: { consecutiveFailures: s?.consecutiveFailures ?? 0, lastSuccessAt: s?.lastSuccessAt ?? null }, daily, posts, lastReachDropAt, moderationPausedAt, settings, now: c.now, tz: c.tz }));
```

`lib/alerts/message.ts` — in `alertHref`, before `if (kind === 'reach_drop')`:
```ts
  if (kind === 'moderation_paused') return `/accounts/${accountId}?tab=moderation`;
```

`tests/alert-settings.test.ts` — line 9 (`expect(DEFAULT_ALERT_SETTINGS.push).toEqual({ … })`) and line 14 both spell out the full `push` object: add `moderation_paused: true` as the last entry of each. Line 14 becomes:
```ts
    expect(s).toEqual({ push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: false, taking_off: true, moderation_paused: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4 });
```
(Line 9 gets the same `, moderation_paused: true` before its closing `}`.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alerts-moderation.test.ts tests/alert-settings.test.ts tests/alert-message.test.ts tests/alert-rules.test.ts tests/alert-run.test.ts tests/sync-tick-alerts.test.ts tests/settings-notifications.test.tsx tests/notification-bell.test.tsx tests/push-actions.test.ts`, `npx tsc --noEmit`, `npx eslint lib/alerts tests/alerts-moderation.test.ts tests/alert-settings.test.ts`.
Expected: PASS. (`rowToNotification` accepts the new kind because it checks `ALERT_KINDS`.)

- [ ] **Step 5: Commit**

```bash
git add lib/alerts/settings.ts lib/alerts/rules.ts lib/alerts/store.ts lib/alerts/run.ts lib/alerts/message.ts tests/alert-settings.test.ts tests/alerts-moderation.test.ts
git commit -m "feat(alerts): moderation_paused (one notification per auto-hide pause)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Service — `lib/moderation/service.ts` (moderate, undo, rules, the auto-hide switch)

**Files:**
- Create: `lib/moderation/service.ts`, `tests/moderation-service.test.ts`

**Interfaces:**
- Consumes: Task 3 (`validateWord`, `SPAM_KINDS`, `REPLY_MAX`), Task 4 (`classifyModerationError`, `IgModeration`), Task 5 (every function named below), `hasScope`/`COMMENTS_SCOPE`, `isUuid`/`isMediaId`.
- Produces (Tasks 9, 10, 11 use exactly these):
```ts
export const MANUAL_PER_MINUTE = 30;
export type ModerationError = ModerationErrorKey | 'invalid' | 'not_found' | 'not_active' | 'duplicate' | 'too_many' | 'already_done' | 'cannot_undo' | 'not_ready';
export type ModerationResult = { ok: true; logged: boolean } | { ok: false; error: ModerationError };
export type RuleError = 'invalid' | 'not_found' | 'not_active' | 'reconnect' | 'not_ready' | 'invalid_word' | 'duplicate_rule' | 'too_many_rules' | 'no_rules' | 'unexpected';
export type RuleResult = { ok: true } | { ok: false; error: RuleError };
export interface ServiceDeps { db: SupabaseClient; token: (accountId: string) => Promise<string | null>; ig: Pick<IgModeration, 'hide' | 'reply' | 'remove'>; now?: () => Date }
export interface ManualInput { kind: 'hide' | 'unhide' | 'delete' | 'reply'; accountId: string; commentId: string; requestId: string; message?: string }
export function moderate(deps: ServiceDeps, input: ManualInput): Promise<ModerationResult>;
export function undoAction(deps: ServiceDeps, input: { accountId: string; logId: number; requestId: string }): Promise<ModerationResult>;
export function saveWordRule(db: SupabaseClient, accountId: string, pattern: unknown, wholeWord: unknown): Promise<RuleResult>;
export function setSpamRule(db: SupabaseClient, accountId: string, kind: unknown, on: unknown): Promise<RuleResult>;
export function deleteRule(db: SupabaseClient, accountId: string, ruleId: unknown): Promise<RuleResult>;
export function setAutoHide(db: SupabaseClient, accountId: string, enabled: unknown, now?: Date): Promise<RuleResult>;
```
Every function validates its inputs itself (the server actions pass values straight from the browser) and never throws.

**The algorithm of one action (`execute`, internal; `moderate` and `undoAction` both end in it):**
1. `countRecentOwnerActions(db, accountId, now − 60 s) >= MANUAL_PER_MINUTE` → `too_many`.
2. `insertLog(db, { …, actor: 'owner', requestId, undoOf?, targetId? (delete_reply: the reply id) })` — throws `duplicate` / `missing` / other → `duplicate` / `not_ready` / `unexpected` (**no Meta call without a row**).
3. `token(accountId)`: null → `finishLog(id, 'reconnect')` → `reconnect`; throws → `finishLog(id, 'unexpected')` → `unexpected`.
4. Meta: hide/unhide → `ig.hide(token, commentId, action === 'hide')`; delete → `ig.remove(token, commentId)`; delete_reply → `ig.remove(token, targetId)`; reply → `ig.reply(token, commentId, message)`.
5. Meta threw → `key = classifyModerationError(e, reply ? 'reply' : 'other')`; `finishLog(id, key)` (a failure here is swallowed); `comment_gone` (except for delete_reply) → `removeComment` (swallowed); return `key`.
6. Meta ok → `finishLog(id, 'ok', reply ? replyId : undefined)`; a failure → `logged = false` (the row stays `pending`: "Outcome unknown"). Then the local mirror: hide/unhide → `setCommentHidden`, delete → `removeComment` (failures swallowed). Return `{ ok: true, logged }`.

- [ ] **Step 1: Write the failing test** — create `tests/moderation-service.test.ts`:

```ts
// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';

const { order, state } = vi.hoisted(() => ({ order: [] as string[], state: { account: null as unknown, comment: null as unknown, log: null as unknown } }));
vi.mock('@/lib/moderation/store', async (orig) => {
  const real = await orig<typeof import('@/lib/moderation/store')>();
  const f = (name: string, impl: (...a: unknown[]) => unknown = () => undefined) => vi.fn(async (...a: unknown[]) => (order.push(name), impl(...a)));
  return {
    ...real,
    getActionAccount: f('account', () => state.account),
    getActionComment: f('comment', () => state.comment),
    countRecentOwnerActions: f('count', () => 0),
    insertLog: f('insertLog', () => 7),
    finishLog: f('finishLog'),
    getLog: f('getLog', () => state.log),
    markUndone: f('markUndone', () => true),
    setCommentHidden: f('setHidden'),
    removeComment: f('removeComment'),
    loadRules: f('loadRules', () => []),
    insertWordRule: f('insertWord'),
    setSpamRow: f('setSpam'),
    deleteRuleRow: f('deleteRule', () => true),
    saveAutoHide: f('saveAutoHide'),
  };
});

import * as S from '@/lib/moderation/store';
import { MANUAL_PER_MINUTE, moderate, saveWordRule, setAutoHide, setSpamRule, undoAction, type ServiceDeps } from '@/lib/moderation/service';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const REQ = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const RULE = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const NOW = new Date('2026-10-29T10:00:00Z');
const db = {} as SupabaseClient;
const ACCOUNT = { id: A, username: 'MyShop', status: 'active' as const, grantedScopes: ['instagram_business_basic', 'instagram_business_manage_comments'] };
const m = vi.mocked(S);

function deps(o: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    db,
    token: vi.fn(async () => (order.push('token'), 'tok-secret')),
    ig: {
      hide: vi.fn(async (_t: string, _c: string, h: boolean) => void order.push(`meta:${h ? 'hide' : 'unhide'}`)),
      reply: vi.fn(async () => (order.push('meta:reply'), '1790')),
      remove: vi.fn(async (_t: string, id: string) => void order.push(`meta:remove:${id}`)),
    },
    now: () => NOW,
    ...o,
  };
}
const hide = (o: Record<string, unknown> = {}) => ({ kind: 'hide' as const, accountId: A, commentId: 'c1', requestId: REQ, ...o });

beforeEach(() => {
  order.length = 0;
  vi.resetAllMocks(); // back to each vi.fn's own implementation (a test's mockResolvedValue must not leak)
  state.account = ACCOUNT;
  state.comment = { id: 'c1', authorUsername: 'fan', hidden: false };
  state.log = null;
});

describe('moderate: the order of writes', () => {
  it('account → comment (both ids) → cap → log row → token → Meta → result → local state', async () => {
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: true, logged: true });
    expect(order).toEqual(['account', 'comment', 'count', 'insertLog', 'token', 'meta:hide', 'finishLog', 'setHidden']);
    expect(m.getActionComment).toHaveBeenCalledWith(db, A, 'c1');
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: REQ });
    expect(m.countRecentOwnerActions).toHaveBeenCalledWith(db, A, '2026-10-29T09:59:00.000Z');
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'ok', undefined);
    expect(m.setCommentHidden).toHaveBeenCalledWith(db, A, 'c1', true);
  });

  it('unhide and delete mirror locally; reply stores the reply id, sends the trimmed text', async () => {
    state.comment = { id: 'c1', authorUsername: 'fan', hidden: true };
    expect(await moderate(deps(), hide({ kind: 'unhide' }))).toEqual({ ok: true, logged: true });
    expect(m.setCommentHidden).toHaveBeenCalledWith(db, A, 'c1', false);
    const d = deps();
    await moderate(d, hide({ kind: 'delete' }));
    expect(d.ig.remove).toHaveBeenCalledWith('tok-secret', 'c1');
    expect(m.removeComment).toHaveBeenCalledWith(db, A, 'c1');
    const r = deps();
    await moderate(r, hide({ kind: 'reply', message: '  Thanks!  ' }));
    expect(r.ig.reply).toHaveBeenCalledWith('tok-secret', 'c1', 'Thanks!');
    expect(m.finishLog).toHaveBeenLastCalledWith(db, 7, 'ok', '1790');
  });
});

describe('moderate: refusals send nothing to Instagram', () => {
  it.each([
    ['bad account id', hide({ accountId: 'x' })],
    ['bad request id', hide({ requestId: 'nope' })],
    ['bad comment id', hide({ commentId: '../1' })],
    ['unknown kind', hide({ kind: 'ban' })],
    ['empty reply', hide({ kind: 'reply', message: '   ' })],
    ['reply too long', hide({ kind: 'reply', message: 'x'.repeat(2201) })],
    ['reply not a string', hide({ kind: 'reply', message: 42 })],
  ])('%s → invalid, nothing read', async (_n, input) => {
    expect(await moderate(deps(), input as never)).toEqual({ ok: false, error: 'invalid' });
    expect(order).toEqual([]);
  });

  it.each([
    ['no such account', null, 'not_found'],
    ['archived', { ...ACCOUNT, status: 'archived' as const }, 'not_active'],
    ['needs reconnect', { ...ACCOUNT, status: 'needs_reconnect' as const }, 'reconnect'],
    ['no comments scope', { ...ACCOUNT, grantedScopes: ['instagram_business_basic'] }, 'reconnect'],
  ])('%s → %s', async (_n, acc, error) => {
    state.account = acc;
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error });
    expect(order).toEqual(['account']);
  });

  it('a comment of another account (or gone) is not_found: no log row, no token, no Meta', async () => {
    state.comment = null;
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'not_found' });
    expect(order).toEqual(['account', 'comment']);
  });

  it("the account's own comment cannot be hidden (any case); a reply to it is fine", async () => {
    state.comment = { id: 'c1', authorUsername: 'myshop', hidden: false };
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'not_allowed' });
    expect(order).not.toContain('insertLog');
    expect(await moderate(deps(), hide({ kind: 'reply', message: 'hi' }))).toEqual({ ok: true, logged: true });
  });

  it('already hidden → already_done without a call', async () => {
    state.comment = { id: 'c1', authorUsername: 'fan', hidden: true };
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'already_done' });
    expect(order).not.toContain('insertLog');
  });

  it(`more than ${MANUAL_PER_MINUTE} actions a minute → too_many before any log row`, async () => {
    m.countRecentOwnerActions.mockResolvedValueOnce(MANUAL_PER_MINUTE);
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'too_many' });
    expect(order).not.toContain('insertLog');
  });

  it('the same request id twice sends once: the unique request_id answers duplicate', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'duplicate'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'duplicate' });
    expect(d.ig.hide).not.toHaveBeenCalled();
    expect(d.token).not.toHaveBeenCalled();
  });

  it('no log row → no Instagram write (missing table: not_ready; any other failure: unexpected)', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'missing'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'not_ready' });
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'other'));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'unexpected' });
    expect(d.ig.hide).not.toHaveBeenCalled();
  });

  it('no stored token → the row says reconnect, nothing is sent', async () => {
    const d = deps({ token: vi.fn(async () => null) });
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'reconnect' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'reconnect');
    expect(d.ig.hide).not.toHaveBeenCalled();
  });
});

describe('moderate: partial failures', () => {
  it('Meta says the comment is gone → logged, our copy removed', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 100, 33));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'comment_gone' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'comment_gone');
    expect(m.removeComment).toHaveBeenCalledWith(db, A, 'c1');
    expect(m.setCommentHidden).not.toHaveBeenCalled();
  });

  it('Meta rate limit → logged, nothing mirrored', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 17));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'rate_limited' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'rate_limited');
    expect(m.setCommentHidden).not.toHaveBeenCalled();
  });

  it('Meta ok but the result write fails → ok with logged:false (the row stays pending = "outcome unknown"); the mirror still runs', async () => {
    m.finishLog.mockRejectedValueOnce(new S.ModerationStoreError('finishLog', 'other'));
    expect(await moderate(deps(), hide())).toEqual({ ok: true, logged: false });
    expect(m.setCommentHidden).toHaveBeenCalled();
  });

  it('Meta failed and the result write fails too → still the Meta error key', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 190));
    m.finishLog.mockRejectedValueOnce(new Error('db down'));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'reconnect' });
  });

  it('a reply Instagram did not confirm is unknown_outcome (never "try again")', async () => {
    const d = deps();
    vi.mocked(d.ig.reply).mockRejectedValueOnce(new InstagramApiError('network'));
    expect(await moderate(d, hide({ kind: 'reply', message: 'hi' }))).toEqual({ ok: false, error: 'unknown_outcome' });
  });

  it('the mirror failing never fails the action; the token never appears in a result', async () => {
    m.setCommentHidden.mockRejectedValueOnce(new Error('db down'));
    const r = await moderate(deps(), hide());
    expect(r).toEqual({ ok: true, logged: true });
    expect(JSON.stringify(r)).not.toContain('tok-');
  });
});

describe('undoAction', () => {
  const row = (o: Partial<S.LogRow> = {}): S.LogRow => ({ id: 3, commentId: 'c9', action: 'hide', actor: `rule:${RULE}`, result: 'ok', targetId: null, undoOf: null, createdAt: '2026-10-29T09:00:00Z', undoneAt: null, ...o });

  it('a hide (also a rule\'s) is undone by an unhide of the STORED comment, linked to the row, then marked undone', async () => {
    state.log = row();
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: true, logged: true });
    expect(m.getLog).toHaveBeenCalledWith(db, A, 3);
    expect(d.ig.hide).toHaveBeenCalledWith('tok-secret', 'c9', false);
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c9', action: 'unhide', actor: 'owner', requestId: REQ, undoOf: 3 });
    expect(m.markUndone).toHaveBeenCalledWith(db, A, 3, NOW.toISOString());
  });

  it('a reply is undone by deleting the STORED reply id', async () => {
    state.log = row({ action: 'reply', actor: 'owner', targetId: '1790' });
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: true, logged: true });
    expect(d.ig.remove).toHaveBeenCalledWith('tok-secret', '1790');
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c9', action: 'delete_reply', actor: 'owner', requestId: REQ, undoOf: 3, targetId: '1790' });
    expect(m.removeComment).not.toHaveBeenCalled(); // the parent comment stays
  });

  it('a reply already gone on Instagram counts as undone (answers comment_gone)', async () => {
    state.log = row({ action: 'reply', actor: 'owner', targetId: '1790' });
    const d = deps();
    vi.mocked(d.ig.remove).mockRejectedValueOnce(new InstagramApiError('data', 400, 100, 33));
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'comment_gone' });
    expect(m.markUndone).toHaveBeenCalled();
  });

  it.each([
    ['not this account / absent', null, 'not_found'],
    ['already undone', row({ undoneAt: '2026-10-29T09:30:00Z' }), 'already_done'],
    ['a delete', row({ action: 'delete' }), 'cannot_undo'],
    ['a failed hide', row({ result: 'rate_limited' }), 'cannot_undo'],
    ['a reply without its id', row({ action: 'reply' }), 'cannot_undo'],
  ])('%s → %s, nothing sent', async (_n, r, error) => {
    state.log = r;
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error });
    expect(d.token).not.toHaveBeenCalled();
  });

  it('invalid ids → invalid, nothing read', async () => {
    expect(await undoAction(deps(), { accountId: A, logId: 1.5, requestId: REQ })).toEqual({ ok: false, error: 'invalid' });
    expect(await undoAction(deps(), { accountId: A, logId: 0, requestId: REQ })).toEqual({ ok: false, error: 'invalid' });
    expect(order).toEqual([]);
  });
});

describe('rules and the auto-hide switch', () => {
  it('a word is validated against the stored rules; the unique index duplicate maps to duplicate_rule', async () => {
    expect(await saveWordRule(db, A, '  Spam ', true)).toEqual({ ok: true });
    expect(m.insertWordRule).toHaveBeenCalledWith(db, A, 'Spam', true);
    m.loadRules.mockResolvedValueOnce([{ id: RULE, kind: 'word', pattern: 'spam', wholeWord: false }]);
    expect(await saveWordRule(db, A, 'SPAM', false)).toEqual({ ok: false, error: 'duplicate_rule' });
    expect(await saveWordRule(db, A, 'x', 'yes')).toEqual({ ok: false, error: 'invalid' });
    m.loadRules.mockRejectedValueOnce(new S.ModerationStoreError('loadRules', 'missing'));
    expect(await saveWordRule(db, A, 'x', false)).toEqual({ ok: false, error: 'not_ready' });
  });

  it('spam kinds are whitelisted', async () => {
    expect(await setSpamRule(db, A, 'link', true)).toEqual({ ok: true });
    expect(m.setSpamRow).toHaveBeenCalledWith(db, A, 'link', true);
    expect(await setSpamRule(db, A, 'word', true)).toEqual({ ok: false, error: 'invalid' });
    expect(await setSpamRule(db, A, 'link', 'on')).toEqual({ ok: false, error: 'invalid' });
  });

  it('switching auto-hide ON needs an active account with the scope and at least one rule; OFF always works', async () => {
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: false, error: 'no_rules' });
    m.loadRules.mockResolvedValueOnce([{ id: RULE, kind: 'link', pattern: null, wholeWord: false }]);
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: true });
    expect(m.saveAutoHide).toHaveBeenCalledWith(db, A, true, NOW.toISOString());
    state.account = { ...ACCOUNT, grantedScopes: null };
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: false, error: 'reconnect' });
    order.length = 0;
    expect(await setAutoHide(db, A, false, NOW)).toEqual({ ok: true });
    expect(order).toEqual(['saveAutoHide']);
    expect(await setAutoHide(db, A, 'true', NOW)).toEqual({ ok: false, error: 'invalid' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/moderation-service.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/moderation/service"`.

- [ ] **Step 3: Write the module** — create `lib/moderation/service.ts`:

```ts
// Owner moderation actions (Plan 15d). Called by the server actions AFTER requireOwner(); validates everything itself
// (values come straight from the browser) and never throws. Order of one action (the plan's repair rule): account
// gate -> the comment re-read with BOTH ids -> per-minute cap -> log row ('pending', unique request id) -> token ->
// Instagram -> the row's result -> the local mirror. No Instagram write without a log row; a repeated request id is
// refused by the database before anything is sent. The token stays inside this call: never returned, never logged.
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { classifyModerationError, type IgModeration, type ModerationErrorKey } from '@/lib/instagram/moderation';
import { REPLY_MAX, SPAM_KINDS, validateWord, type SpamKind } from '@/lib/moderation/rules';
import * as S from '@/lib/moderation/store';
import { isMediaId, isUuid } from '@/lib/tags';

export const MANUAL_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

export type ModerationError = ModerationErrorKey | 'invalid' | 'not_found' | 'not_active' | 'duplicate' | 'too_many' | 'already_done' | 'cannot_undo' | 'not_ready';
export type ModerationResult = { ok: true; logged: boolean } | { ok: false; error: ModerationError };
export type RuleError = 'invalid' | 'not_found' | 'not_active' | 'reconnect' | 'not_ready' | 'invalid_word' | 'duplicate_rule' | 'too_many_rules' | 'no_rules' | 'unexpected';
export type RuleResult = { ok: true } | { ok: false; error: RuleError };

export interface ServiceDeps {
  db: SupabaseClient; // owner session
  token: (accountId: string) => Promise<string | null>; // admin client, account_tokens: server only
  ig: Pick<IgModeration, 'hide' | 'reply' | 'remove'>;
  now?: () => Date;
}
export interface ManualInput {
  kind: 'hide' | 'unhide' | 'delete' | 'reply';
  accountId: string;
  commentId: string;
  requestId: string;
  message?: string;
}

const KINDS: readonly string[] = ['hide', 'unhide', 'delete', 'reply'];
const fail = <E extends string>(error: E) => ({ ok: false as const, error });
const storeKey = (e: unknown): 'not_ready' | 'duplicate' | 'not_found' | 'unexpected' =>
  e instanceof S.ModerationStoreError ? (e.reason === 'missing' ? 'not_ready' : e.reason === 'other' ? 'unexpected' : e.reason) : 'unexpected';

/** Active, with the comments scope; otherwise the error to show. */
async function gate(db: SupabaseClient, accountId: string): Promise<S.ActionAccount | 'not_found' | 'not_active' | 'reconnect'> {
  const a = await S.getActionAccount(db, accountId);
  if (!a) return 'not_found';
  if (a.status === 'archived') return 'not_active';
  if (a.status !== 'active' || !hasScope(a, COMMENTS_SCOPE)) return 'reconnect';
  return a;
}

interface Step {
  accountId: string;
  commentId: string;
  action: S.LogAction;
  requestId: string;
  message?: string;
  undoOf?: number;
  target?: string; // delete_reply: the reply id, from the stored log row
}

/** Steps 1–6 of the plan's algorithm. Store errors before Instagram propagate to the caller's catch. */
async function execute(deps: ServiceDeps, a: Step): Promise<ModerationResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  if ((await S.countRecentOwnerActions(db, a.accountId, new Date(now.getTime() - MINUTE_MS).toISOString())) >= MANUAL_PER_MINUTE) return fail('too_many');
  const logId = await S.insertLog(db, {
    accountId: a.accountId,
    commentId: a.commentId,
    action: a.action,
    actor: 'owner',
    requestId: a.requestId,
    ...(a.undoOf !== undefined ? { undoOf: a.undoOf } : {}),
    ...(a.action === 'delete_reply' && a.target ? { targetId: a.target } : {}),
  });
  let token: string | null;
  try {
    token = await deps.token(a.accountId);
  } catch {
    await S.finishLog(db, logId, 'unexpected').catch(() => {});
    return fail('unexpected');
  }
  if (!token) {
    await S.finishLog(db, logId, 'reconnect').catch(() => {});
    return fail('reconnect');
  }
  let replyId: string | null = null;
  try {
    if (a.action === 'hide' || a.action === 'unhide') await deps.ig.hide(token, a.commentId, a.action === 'hide');
    else if (a.action === 'delete') await deps.ig.remove(token, a.commentId);
    else if (a.action === 'delete_reply') await deps.ig.remove(token, a.target!);
    else replyId = await deps.ig.reply(token, a.commentId, a.message!);
  } catch (e) {
    const key = classifyModerationError(e, a.action === 'reply' ? 'reply' : 'other');
    await S.finishLog(db, logId, key).catch(() => {});
    if (key === 'comment_gone' && a.action !== 'delete_reply') await S.removeComment(db, a.accountId, a.commentId).catch(() => {});
    return fail(key);
  }
  let logged = true;
  await S.finishLog(db, logId, 'ok', a.action === 'reply' ? replyId : undefined).catch(() => {
    logged = false; // Instagram did it; the row stays 'pending' and shows "Outcome unknown"
  });
  const mirror =
    a.action === 'delete' ? S.removeComment(db, a.accountId, a.commentId) : a.action === 'hide' || a.action === 'unhide' ? S.setCommentHidden(db, a.accountId, a.commentId, a.action === 'hide') : Promise.resolve();
  await mirror.catch(() => {}); // the local copy only; the next action or sync corrects it
  return { ok: true, logged };
}

export async function moderate(deps: ServiceDeps, input: ManualInput): Promise<ModerationResult> {
  const { kind, accountId, commentId, requestId } = input;
  if (!KINDS.includes(kind) || !isUuid(accountId) || !isUuid(requestId) || !isMediaId(commentId)) return fail('invalid');
  let message: string | undefined;
  if (kind === 'reply') {
    message = typeof input.message === 'string' ? input.message.trim() : '';
    if (message === '' || [...message].length > REPLY_MAX) return fail('invalid');
  }
  try {
    const account = await gate(deps.db, accountId);
    if (typeof account === 'string') return fail(account);
    const comment = await S.getActionComment(deps.db, accountId, commentId); // both ids: a comment of another account is "not found"
    if (!comment) return fail('not_found');
    if (kind === 'hide' || kind === 'unhide') {
      if (comment.authorUsername?.toLowerCase() === account.username.toLowerCase()) return fail('not_allowed'); // Meta always shows the owner's own comments
      if (comment.hidden === (kind === 'hide')) return fail('already_done');
    }
    return await execute(deps, { accountId, commentId, action: kind, requestId, message });
  } catch (e) {
    return fail(storeKey(e));
  }
}

/** Undo a hide (unhide) or a reply (delete it). Targets come from the stored row only, selected with the account id. */
export async function undoAction(deps: ServiceDeps, input: { accountId: string; logId: number; requestId: string }): Promise<ModerationResult> {
  const { accountId, logId, requestId } = input;
  if (!isUuid(accountId) || !isUuid(requestId) || !Number.isSafeInteger(logId) || logId < 1) return fail('invalid');
  try {
    const account = await gate(deps.db, accountId);
    if (typeof account === 'string') return fail(account);
    const row = await S.getLog(deps.db, accountId, logId);
    if (!row) return fail('not_found');
    if (row.undoneAt !== null) return fail('already_done');
    const kind = S.undoKind(row);
    if (!kind) return fail('cannot_undo');
    const r = await execute(deps, { accountId, commentId: row.commentId, action: kind, requestId, undoOf: row.id, target: row.targetId ?? undefined });
    // a reply already deleted on Instagram is undone too
    if (r.ok || r.error === 'comment_gone') await S.markUndone(deps.db, accountId, row.id, (deps.now?.() ?? new Date()).toISOString()).catch(() => {});
    return r;
  } catch (e) {
    return fail(storeKey(e));
  }
}

const ruleKey = (e: unknown): RuleError => {
  const k = storeKey(e);
  return k === 'duplicate' ? 'duplicate_rule' : k;
};

export async function saveWordRule(db: SupabaseClient, accountId: string, pattern: unknown, wholeWord: unknown): Promise<RuleResult> {
  if (!isUuid(accountId) || typeof wholeWord !== 'boolean') return fail('invalid');
  try {
    const v = validateWord(pattern, await S.loadRules(db, accountId));
    if (!v.ok) return fail(v.error);
    await S.insertWordRule(db, accountId, v.pattern, wholeWord);
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}

export async function setSpamRule(db: SupabaseClient, accountId: string, kind: unknown, on: unknown): Promise<RuleResult> {
  if (!isUuid(accountId) || !(SPAM_KINDS as readonly unknown[]).includes(kind) || typeof on !== 'boolean') return fail('invalid');
  try {
    await S.setSpamRow(db, accountId, kind as SpamKind, on);
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}

export async function deleteRule(db: SupabaseClient, accountId: string, ruleId: unknown): Promise<RuleResult> {
  if (!isUuid(accountId) || !isUuid(ruleId)) return fail('invalid');
  try {
    return (await S.deleteRuleRow(db, accountId, ruleId)) ? { ok: true } : fail('not_found');
  } catch (e) {
    return fail(ruleKey(e));
  }
}

/** On: active + scope + at least one rule (the Moderation tab showed the preview in its confirm). Off: always. */
export async function setAutoHide(db: SupabaseClient, accountId: string, enabled: unknown, now: Date = new Date()): Promise<RuleResult> {
  if (!isUuid(accountId) || typeof enabled !== 'boolean') return fail('invalid');
  try {
    if (enabled) {
      const account = await gate(db, accountId);
      if (typeof account === 'string') return fail(account);
      if ((await S.loadRules(db, accountId)).length === 0) return fail('no_rules');
    }
    await S.saveAutoHide(db, accountId, enabled, now.toISOString());
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-service.test.ts`, `npx tsc --noEmit`, `npx eslint lib/moderation/service.ts tests/moderation-service.test.ts`.
Expected: PASS (38 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/moderation/service.ts tests/moderation-service.test.ts
git commit -m "feat(moderation): owner actions (log first, then Instagram), undo, rules and the auto-hide switch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The auto-hide pass in the tick — `lib/moderation/auto.ts`, `lib/sync/tick.ts`, `lib/sync/deps.ts`

**Files:**
- Create: `lib/moderation/auto.ts`, `tests/moderation-auto.test.ts`, `tests/sync-tick-moderation.test.ts`
- Modify: `lib/sync/tick.ts`, `lib/sync/deps.ts`
- Existing tests that must keep passing: `tests/sync-tick.test.ts`, `tests/sync-tick-alerts.test.ts`, `tests/sync-lanes.test.ts`, `tests/cron-tick-route.test.ts`, `tests/sync-now-action.test.ts` (none of them passes `moderation`, so nothing changes for them).

**Interfaces:**
- Consumes: Task 3 (`pickAutoHide`, `touchedIds`), Task 4 (`classifyModerationError`, `IgModeration`, `igModeration`), Task 5 (`autoHideAccounts`, `visibleComments`, `logMarks`, `insertLog`, `finishLog`, `setCommentHidden`, `removeComment`, `pauseAutoHide`, `CANDIDATE_SCAN`), `classifyIgError`, `hasScope`, `ALERT_BUDGET_MS`.
- Produces:
```ts
export const AUTO_HIDE_PER_TICK = 20, MODERATION_BUDGET_MS = 5_000, FAIL_LIMIT = 3;
export interface AutoHideDeps { db: SupabaseClient; ig: Pick<IgModeration, 'hide'>; token: (accountId: string) => Promise<string | null>; newId?: () => string }
export interface AutoHideSummary { hidden: number; failed: number; paused: number } // counts only: this goes into sync_runs
export interface AutoHideContext { accounts: StoredAccount[]; now: Date; deadline: number; clock: () => number; accountId?: string }
export function runAutoHide(deps: AutoHideDeps, c: AutoHideContext): Promise<AutoHideSummary>; // never throws
// lib/sync/tick.ts
TickDeps.moderation?: AutoHideDeps;   TickSummary.moderation?: AutoHideSummary;
```

**The algorithm (exact):**
- `runAutoHide`: `autoHideAccounts(db)` (throws → `{ failed: 1 }`; `null` = no migration → zeros). For each `{ accountId, rules }` in order: stop when `clock() >= deadline`; skip when `c.accountId` is set and differs; skip unless the account is in `c.accounts` (a FRESH list), `status === 'active'`, `hasScope(account, COMMENTS_SCOPE)` and `rules.length > 0`; run the account inside `try/catch` (a throw = `failed + 1`, next account); add its counts; `stopAll` (app-wide rate limit) ends the pass.
- One account: `visibleComments(db, id, CANDIDATE_SCAN)` and `logMarks(db, id)` → `pickAutoHide(cands, rules, { ownUsername: account.username, touched: touchedIds(marks), limit: AUTO_HIDE_PER_TICK })`; nothing → done (no token read). `token(id)`: null → done (the sync owns `needs_reconnect`). For each pick, stop when `clock() >= deadline`, then:
  1. `insertLog(db, { accountId, commentId, action: 'hide', actor: 'rule:<rule id>', requestId: newId() })` — a throw propagates (this account stops: **never an unlogged hide**);
  2. `ig.hide(token, commentId, true)`;
  3. error → `key = classifyModerationError(e)`; `finishLog(logId, key)` (swallowed); `comment_gone` → `removeComment` (swallowed), continue (not a failure); otherwise `failed + 1` and: `reconnect` → `pauseAutoHide(id, 'reconnect', now)`, `paused`, stop the account; `rate_limited` → stop the account (`stopAll = classifyIgError(e) === 'app_rate_limit'`); else `streak + 1`, at `FAIL_LIMIT` → `pauseAutoHide(id, 'failing', now)`, `paused`, stop the account;
  4. success → `streak = 0`, `finishLog(logId, 'ok')` (swallowed: the row stays `pending` = touched, never retried), `setCommentHidden(id, commentId, true)` (swallowed), `hidden + 1`.
- Tick: after `runAlerts`, `if (deps.moderation && !appLimited)`: `runAutoHide(deps.moderation, { accounts: await deps.accounts.list(), now: new Date(clock()), deadline: deadline + ALERT_BUDGET_MS + MODERATION_BUDGET_MS, clock, accountId: opts.accountId })`, with `.catch(() => ({ hidden: 0, failed: 1, paused: 0 }))` around the whole expression; the result goes into the summary as `moderation` (before `recordRun`).

- [ ] **Step 1: Write the failing tests** — create `tests/moderation-auto.test.ts`:

```ts
// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import { InstagramApiError } from '@/lib/instagram/oauth';
import type { Candidate, ModerationRule } from '@/lib/moderation/rules';
import { account } from './fixtures/sync-fakes';

const { order } = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock('@/lib/moderation/store', async (orig) => {
  const real = await orig<typeof import('@/lib/moderation/store')>();
  const f = (name: string) => vi.fn(async (): Promise<unknown> => void order.push(name));
  return { ...real, autoHideAccounts: vi.fn(), visibleComments: vi.fn(), logMarks: vi.fn(), insertLog: vi.fn(), finishLog: f('finishLog'), setCommentHidden: f('setHidden'), removeComment: f('removeComment'), pauseAutoHide: f('pause') };
});

import * as S from '@/lib/moderation/store';
import { AUTO_HIDE_PER_TICK, FAIL_LIMIT, runAutoHide, type AutoHideContext, type AutoHideDeps } from '@/lib/moderation/auto';

const m = vi.mocked(S);
const RULE: ModerationRule = { id: '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e', kind: 'word', pattern: 'spam', wholeWord: false };
const NOW = new Date('2026-10-29T10:00:00Z');
const db = {} as SupabaseClient;
const spam = (id: string, o: Partial<Candidate> = {}): Candidate => ({ id, authorUsername: 'bot', text: `spam ${id}`, hidden: false, ...o });
const scoped = (id: string, o = {}) => account({ id, username: `shop_${id}`, grantedScopes: [COMMENTS_SCOPE], ...o });
let comments: Record<string, Candidate[]>;

function setup(o: { ig?: AutoHideDeps['ig']; ctx?: Partial<AutoHideContext> } = {}) {
  let req = 0;
  const deps: AutoHideDeps = {
    db,
    ig: o.ig ?? { hide: vi.fn(async (_t: string, id: string) => void order.push(`hide:${id}`)) },
    token: vi.fn(async (id: string) => `tok-${id}`),
    newId: () => `req-${++req}`,
  };
  const ctx: AutoHideContext = { accounts: [scoped('a1'), scoped('a2')], now: NOW, deadline: Infinity, clock: () => 0, ...o.ctx };
  return { deps, ctx };
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  comments = { a1: [spam('c1'), spam('c2')], a2: [spam('d1')] };
  m.autoHideAccounts.mockResolvedValue([{ accountId: 'a1', rules: [RULE] }, { accountId: 'a2', rules: [RULE] }]);
  m.visibleComments.mockImplementation(async (_db, id) => comments[id] ?? []);
  m.logMarks.mockResolvedValue([]);
  let n = 0;
  m.insertLog.mockImplementation(async () => (order.push('insertLog'), ++n));
});

describe('runAutoHide', () => {
  it('per comment: log row (actor rule:<id>) → hide → ok → local hidden; counts only in the summary', async () => {
    const { deps, ctx } = setup();
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 3, failed: 0, paused: 0 });
    expect(order.slice(0, 4)).toEqual(['insertLog', 'hide:c1', 'finishLog', 'setHidden']);
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: 'a1', commentId: 'c1', action: 'hide', actor: `rule:${RULE.id}`, requestId: 'req-1' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'ok');
    expect(m.visibleComments).toHaveBeenCalledWith(db, 'a1', S.CANDIDATE_SCAN);
  });

  it(`at most ${AUTO_HIDE_PER_TICK} hides per account per tick`, async () => {
    comments.a1 = Array.from({ length: 25 }, (_, i) => spam(`c${i}`));
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    expect((await runAutoHide(deps, ctx)).hidden).toBe(AUTO_HIDE_PER_TICK);
  });

  it('never touches what the owner acted on, what a rule already did, or the account itself', async () => {
    comments.a1 = [spam('c1'), spam('c2'), spam('c3', { authorUsername: 'SHOP_A1' }), spam('c4', { hidden: true })];
    m.logMarks.mockResolvedValue([{ commentId: 'c1', actor: 'owner', result: 'ok' }, { commentId: 'c2', actor: `rule:${RULE.id}`, result: 'pending' }]);
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(deps.token).not.toHaveBeenCalled(); // nothing to do: no token read
  });

  it('skips accounts that are not active, lack the scope, are not in the fresh list, or have no rules', async () => {
    m.autoHideAccounts.mockResolvedValue([
      { accountId: 'a1', rules: [RULE] },
      { accountId: 'a2', rules: [RULE] },
      { accountId: 'gone', rules: [RULE] },
      { accountId: 'a3', rules: [] },
    ]);
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1', { status: 'needs_reconnect' }), account({ id: 'a2' }), scoped('a3')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(m.visibleComments).not.toHaveBeenCalled();
  });

  it('a permission answer pauses that account (reason reconnect) and the next account still runs', async () => {
    const ig = { hide: vi.fn(async (t: string, id: string) => {
      if (t === 'tok-a1') throw new InstagramApiError('data', 403, 200);
      order.push(`hide:${id}`);
    }) };
    const { deps, ctx } = setup({ ig });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 1, paused: 1 });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'reconnect');
    expect(m.pauseAutoHide).toHaveBeenCalledWith(db, 'a1', 'reconnect', NOW.toISOString());
    expect(ig.hide).toHaveBeenCalledTimes(2); // c1 of a1 (refused), d1 of a2
  });

  it(`${FAIL_LIMIT} failures in a row pause the account (reason failing); a success in between resets the count`, async () => {
    comments.a1 = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((id) => spam(id));
    let call = 0;
    const ig = { hide: vi.fn(async () => {
      call++;
      if (call !== 3) throw new InstagramApiError('data', 400, 100); // not_allowed, except the 3rd
    }) };
    const { deps, ctx } = setup({ ig, ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 5, paused: 1 }); // fail, fail, ok, fail, fail, fail -> pause; c7 untouched
    expect(ig.hide).toHaveBeenCalledTimes(6);
    expect(m.pauseAutoHide).toHaveBeenCalledWith(db, 'a1', 'failing', NOW.toISOString());
  });

  it('a rate limit stops that account only; an app-wide one stops the pass', async () => {
    const user = { hide: vi.fn(async (t: string) => { if (t === 'tok-a1') throw new InstagramApiError('data', 400, 17); }) };
    const a = setup({ ig: user });
    expect(await runAutoHide(a.deps, a.ctx)).toEqual({ hidden: 1, failed: 1, paused: 0 });
    expect(m.pauseAutoHide).not.toHaveBeenCalled();
    const app = { hide: vi.fn(async () => { throw new InstagramApiError('data', 400, 4); }) };
    const b = setup({ ig: app });
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 1, paused: 0 });
    expect(app.hide).toHaveBeenCalledTimes(1);
  });

  it('a comment already gone on Instagram is logged, removed here, and is not a failure', async () => {
    const ig = { hide: vi.fn(async (_t: string, id: string) => { if (id === 'c1') throw new InstagramApiError('data', 400, 100, 33); }) };
    const { deps, ctx } = setup({ ig, ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 0, paused: 0 });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'comment_gone');
    expect(m.removeComment).toHaveBeenCalledWith(db, 'a1', 'c1');
  });

  it('no log row → no hide: the account stops, the next one runs', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'other'));
    const { deps, ctx } = setup();
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 1, paused: 0 });
    expect(deps.ig.hide).toHaveBeenCalledTimes(1);
    expect(deps.ig.hide).toHaveBeenCalledWith('tok-a2', 'd1', true);
  });

  it('no stored token: nothing is sent for that account', async () => {
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    vi.mocked(deps.token).mockResolvedValue(null);
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(m.insertLog).not.toHaveBeenCalled();
  });

  it('stops at the deadline; honours a single-account (manual) run; never throws', async () => {
    let t = 0;
    const a = setup({ ctx: { deadline: 2, clock: () => t++ } });
    expect((await runAutoHide(a.deps, a.ctx)).hidden).toBeLessThan(3);
    const b = setup({ ctx: { accountId: 'a2' } });
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 1, failed: 0, paused: 0 });
    m.autoHideAccounts.mockRejectedValueOnce(new Error('db down'));
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 1, paused: 0 });
    m.autoHideAccounts.mockResolvedValueOnce(null); // before the migration
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
  });
});
```

and `tests/sync-tick-moderation.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';

const { runAutoHide } = vi.hoisted(() => ({ runAutoHide: vi.fn() }));
vi.mock('@/lib/moderation/auto', async (orig) => ({ ...(await orig<object>()), runAutoHide }));

import { runTick, type TickDeps } from '@/lib/sync/tick';
import { memoryAlertStore } from './fixtures/alert-fakes';
import { account, fakeAccounts, fakeIg, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z');
function setup() {
  const ig = fakeIg();
  const mem = memoryStore({ tokens: { a1: 'tok-a1' } });
  const alerts = memoryAlertStore();
  const deps: TickDeps = {
    store: mem.store,
    accounts: fakeAccounts([account({ id: 'a1' })]).accounts,
    ig,
    clock: () => T0,
    newId: () => 'lease',
    alerts: { store: alerts.store, push: null },
    moderation: { db: {} as never, ig: { hide: vi.fn() }, token: vi.fn() },
  };
  return { ig, mem, alerts, deps };
}

describe('runTick + auto-hide', () => {
  it('runs after the alerts in its own window (35 + 10 + 5 s) with a fresh account list; counts land in the summary and sync_runs', async () => {
    runAutoHide.mockReset().mockResolvedValue({ hidden: 2, failed: 0, paused: 0 });
    const { deps, alerts, mem } = setup();
    const s = await runTick(deps, { trigger: 'cron' });
    expect(vi.mocked(alerts.store.context).mock.invocationCallOrder[0]).toBeLessThan(runAutoHide.mock.invocationCallOrder[0]);
    const ctx = runAutoHide.mock.calls[0][1];
    expect(ctx.deadline).toBe(T0 + 50_000);
    expect(ctx.accounts.map((a: { id: string }) => a.id)).toEqual(['a1']);
    expect(s.moderation).toEqual({ hidden: 2, failed: 0, paused: 0 });
    expect(mem.runs[0].summary).toMatchObject({ moderation: { hidden: 2, failed: 0, paused: 0 } });
  });

  it('a failing pass never fails the tick or the recorded run', async () => {
    runAutoHide.mockReset().mockRejectedValue(new Error('boom'));
    const { deps, mem } = setup();
    const s = await runTick(deps, { trigger: 'cron' });
    expect(s.accounts.map((a) => a.outcome)).toEqual(['ok']);
    expect(s.moderation).toEqual({ hidden: 0, failed: 1, paused: 0 });
    expect(mem.runs).toHaveLength(1);
  });

  it('a manual run for one account passes its id', async () => {
    runAutoHide.mockReset().mockResolvedValue({ hidden: 0, failed: 0, paused: 0 });
    const { deps } = setup();
    await runTick(deps, { trigger: 'manual', accountId: 'a1' });
    expect(runAutoHide.mock.calls[0][1].accountId).toBe('a1');
  });

  it('an app-wide Instagram rate limit in the sync skips the pass', async () => {
    runAutoHide.mockReset();
    const { deps, ig } = setup();
    ig.listStories.mockRejectedValue(new InstagramApiError('data', 400, 4));
    const s = await runTick(deps, { trigger: 'cron' });
    expect(runAutoHide).not.toHaveBeenCalled();
    expect(s).not.toHaveProperty('moderation');
  });

  it('without moderation deps nothing runs and the summary has no moderation field', async () => {
    runAutoHide.mockReset();
    const { deps } = setup();
    const s = await runTick({ ...deps, moderation: undefined }, { trigger: 'cron' });
    expect(runAutoHide).not.toHaveBeenCalled();
    expect(s).not.toHaveProperty('moderation');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/moderation-auto.test.ts tests/sync-tick-moderation.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/moderation/auto"`.

- [ ] **Step 3: Write `lib/moderation/auto.ts`**

```ts
// Auto-hide (Plan 15d): a pass of the sync tick that runs AFTER the lanes and the alerts, in its own window, so it can
// never take time from either. It reads only comments the comments job already stored, hides at most
// AUTO_HIDE_PER_TICK per account, logs every hide (actor rule:<id>) BEFORE sending it, never acts on a comment the
// owner touched or a rule already finished (touchedIds), never deletes, and pauses itself on a permission answer or
// FAIL_LIMIT failures in a row (one notification per pause: lib/alerts/rules.ts). Never throws; one account's trouble
// never stops the others. Counts only leave this module (they go into sync_runs).
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { classifyIgError } from '@/lib/instagram/data';
import { classifyModerationError, type IgModeration } from '@/lib/instagram/moderation';
import { pickAutoHide, touchedIds, type ModerationRule } from '@/lib/moderation/rules';
import * as S from '@/lib/moderation/store';

export const AUTO_HIDE_PER_TICK = 20;
/** After the alerts' window: 35 s sync + 10 s alerts + 5 s here; each write times out after 5 s (route maxDuration 60 s). */
export const MODERATION_BUDGET_MS = 5_000;
export const FAIL_LIMIT = 3;

export interface AutoHideDeps {
  db: SupabaseClient; // admin client (the tick has no owner session)
  ig: Pick<IgModeration, 'hide'>;
  token: (accountId: string) => Promise<string | null>;
  newId?: () => string;
}
export interface AutoHideSummary {
  hidden: number;
  failed: number;
  paused: number;
}
export interface AutoHideContext {
  accounts: StoredAccount[]; // fresh: an account flipped to needs_reconnect in this tick is skipped
  now: Date;
  deadline: number; // ms epoch
  clock: () => number;
  accountId?: string; // manual "Sync now" for one account
}

interface AccountRun {
  hidden: number;
  failed: number;
  paused: boolean;
  stopAll: boolean; // app-wide rate limit: every further call would fail too
}

async function hideForAccount(deps: AutoHideDeps, account: StoredAccount, rules: ModerationRule[], c: AutoHideContext): Promise<AccountRun> {
  const out: AccountRun = { hidden: 0, failed: 0, paused: false, stopAll: false };
  const [cands, marks] = await Promise.all([S.visibleComments(deps.db, account.id, S.CANDIDATE_SCAN), S.logMarks(deps.db, account.id)]);
  const picks = pickAutoHide(cands, rules, { ownUsername: account.username, touched: touchedIds(marks), limit: AUTO_HIDE_PER_TICK });
  if (picks.length === 0) return out;
  const token = await deps.token(account.id);
  if (!token) return out; // the sync flags a missing token
  const nowIso = c.now.toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let streak = 0;
  for (const { comment, rule } of picks) {
    if (c.clock() >= c.deadline) break;
    // the row first: an insert failure throws and stops this account, so there is never an unlogged hide
    const logId = await S.insertLog(deps.db, { accountId: account.id, commentId: comment.id, action: 'hide', actor: `rule:${rule.id}`, requestId: newId() });
    try {
      await deps.ig.hide(token, comment.id, true);
    } catch (e) {
      const key = classifyModerationError(e);
      await S.finishLog(deps.db, logId, key).catch(() => {});
      if (key === 'comment_gone') {
        await S.removeComment(deps.db, account.id, comment.id).catch(() => {});
        continue;
      }
      out.failed++;
      if (key === 'reconnect') {
        await S.pauseAutoHide(deps.db, account.id, 'reconnect', nowIso);
        out.paused = true;
        return out;
      }
      if (key === 'rate_limited') {
        out.stopAll = classifyIgError(e) === 'app_rate_limit';
        return out;
      }
      if (++streak >= FAIL_LIMIT) {
        await S.pauseAutoHide(deps.db, account.id, 'failing', nowIso);
        out.paused = true;
        return out;
      }
      continue;
    }
    streak = 0;
    await S.finishLog(deps.db, logId, 'ok').catch(() => {}); // left 'pending' = touched: never retried automatically
    await S.setCommentHidden(deps.db, account.id, comment.id, true).catch(() => {});
    out.hidden++;
  }
  return out;
}

export async function runAutoHide(deps: AutoHideDeps, c: AutoHideContext): Promise<AutoHideSummary> {
  const out: AutoHideSummary = { hidden: 0, failed: 0, paused: 0 };
  let list: Awaited<ReturnType<typeof S.autoHideAccounts>>;
  try {
    list = await S.autoHideAccounts(deps.db);
  } catch {
    out.failed++;
    return out;
  }
  if (!list) return out; // the moderation migration is not applied
  for (const { accountId, rules } of list) {
    if (c.clock() >= c.deadline) break;
    if (c.accountId && accountId !== c.accountId) continue;
    const account = c.accounts.find((a) => a.id === accountId);
    if (!account || account.status !== 'active' || !hasScope(account, COMMENTS_SCOPE) || rules.length === 0) continue;
    try {
      const r = await hideForAccount(deps, account, rules, c);
      out.hidden += r.hidden;
      out.failed += r.failed;
      if (r.paused) out.paused++;
      if (r.stopAll) break;
    } catch {
      out.failed++;
    }
  }
  return out;
}
```

- [ ] **Step 4: Wire the tick** — anchored edits in `lib/sync/tick.ts`:

imports (after the alerts import):
```ts
import { MODERATION_BUDGET_MS, runAutoHide, type AutoHideDeps, type AutoHideSummary } from '@/lib/moderation/auto';
```
`TickDeps`, after `alerts?: AlertDeps; …`:
```ts
  moderation?: AutoHideDeps; // omitted: no auto-hide pass (tests of the sync itself)
```
`TickSummary`, after `alerts?: AlertRunSummary; // counts only`:
```ts
  moderation?: AutoHideSummary; // counts only
```
between the `const alerts = …;` statement and `const summary: TickSummary = …`:
```ts
  // Plan 15d: auto-hide runs last, in its own window after the alerts' (35 + 10 + 5 s; its calls time out after 5 s, the
  // route allows 60 s). Skipped when Meta throttled the whole app. Never throws; the catch is a second net for the tick.
  const moderation =
    deps.moderation && !appLimited
      ? await deps.accounts
          .list()
          .then((accounts) => runAutoHide(deps.moderation!, { accounts, now: new Date(clock()), deadline: deadline + ALERT_BUDGET_MS + MODERATION_BUDGET_MS, clock, accountId: opts.accountId }))
          .catch(() => ({ hidden: 0, failed: 1, paused: 0 }))
      : undefined;
```
and in the `summary` object literal, after `...(alerts ? { alerts } : {})`: `, ...(moderation ? { moderation } : {})`.

`lib/sync/deps.ts` — import `import { igModeration } from '@/lib/instagram/moderation';` and replace the returned object with:
```ts
  const store = supabaseSyncStore(db);
  return {
    store,
    accounts: supabaseAccountsStore(db),
    ig: igData(apiVersion),
    alerts: { store: supabaseAlertStore(db), push: vapid ? webPushTransport(vapid) : null },
    // Plan 15d auto-hide: the same admin client; the token read stays server-side (account_tokens)
    moderation: { db, ig: igModeration(apiVersion), token: (id) => store.getToken(id) },
  };
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/moderation-auto.test.ts tests/sync-tick-moderation.test.ts tests/sync-tick.test.ts tests/sync-tick-alerts.test.ts tests/sync-lanes.test.ts tests/cron-tick-route.test.ts tests/sync-now-action.test.ts`, `npx tsc --noEmit`, `npx eslint lib/moderation/auto.ts lib/sync/tick.ts lib/sync/deps.ts tests/moderation-auto.test.ts tests/sync-tick-moderation.test.ts`.
Expected: PASS (11 + 5 new tests; the existing tick suites unchanged).

- [ ] **Step 6: Commit**

```bash
git add lib/moderation/auto.ts lib/sync/tick.ts lib/sync/deps.ts tests/moderation-auto.test.ts tests/sync-tick-moderation.test.ts
git commit -m "feat(moderation): auto-hide pass after the alerts (capped, idempotent, pauses itself, never throws)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Server actions + privacy guard — `app/(app)/accounts/moderation-actions.ts`

**Files:**
- Create: `app/(app)/accounts/moderation-actions.ts`, `tests/moderation-actions.test.ts`, `tests/moderation-privacy.test.ts`

**Interfaces:**
- Consumes: Task 7 (every service function and type), Task 4 `igModeration`, `getInstagramEnv`, `supabaseSyncStore(...).getToken`, `createAdminSupabase`, `createServerSupabase`, `requireOwner`.
- Produces (Task 12 passes them to the client components; the props of Tasks 10/11 have exactly these shapes):
```ts
export async function hideCommentAction(accountId: string, commentId: string, hide: boolean, requestId: string): Promise<ModerationResult>;
export async function replyCommentAction(accountId: string, commentId: string, message: string, requestId: string): Promise<ModerationResult>;
export async function deleteCommentAction(accountId: string, commentId: string, requestId: string): Promise<ModerationResult>;
export async function undoModerationAction(accountId: string, logId: number, requestId: string): Promise<ModerationResult>;
export async function saveWordRuleAction(accountId: string, pattern: string, wholeWord: boolean): Promise<RuleResult>;
export async function setSpamRuleAction(accountId: string, kind: SpamKind, on: boolean): Promise<RuleResult>;
export async function deleteRuleAction(accountId: string, ruleId: string): Promise<RuleResult>;
export async function setAutoHideAction(accountId: string, enabled: boolean): Promise<RuleResult>;
```

- [ ] **Step 1: Write the failing tests** — create `tests/moderation-actions.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, svc } = vi.hoisted(() => ({
  calls: [] as string[],
  requireOwner: vi.fn(),
  svc: {
    moderate: vi.fn(),
    undoAction: vi.fn(),
    saveWordRule: vi.fn(),
    setSpamRule: vi.fn(),
    deleteRule: vi.fn(),
    setAutoHide: vi.fn(),
  },
}));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push('session'), { session: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('ADMIN'), { admin: true }) }));
vi.mock('@/lib/sync/store', () => ({ supabaseSyncStore: () => ({ getToken: async () => (calls.push('getToken'), 'tok-secret') }) }));
vi.mock('@/lib/env', () => ({ getInstagramEnv: () => (calls.push('env'), { apiVersion: 'v25.0' }) }));
vi.mock('@/lib/instagram/moderation', () => ({ igModeration: () => ({ hide: vi.fn(), reply: vi.fn(), remove: vi.fn() }) }));
vi.mock('@/lib/moderation/service', () => svc);
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(`revalidate:${a.join(',')}`) }));

import {
  deleteCommentAction, deleteRuleAction, hideCommentAction, replyCommentAction, saveWordRuleAction, setAutoHideAction, setSpamRuleAction, undoModerationAction,
} from '@/app/(app)/accounts/moderation-actions';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const R = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('requireOwner'));
  for (const f of Object.values(svc)) f.mockReset().mockResolvedValue({ ok: true, logged: true });
});

describe('moderation actions', () => {
  it.each([
    ['hide', () => hideCommentAction(A, 'c1', true, R)],
    ['reply', () => replyCommentAction(A, 'c1', 'hi', R)],
    ['delete', () => deleteCommentAction(A, 'c1', R)],
    ['undo', () => undoModerationAction(A, 3, R)],
    ['saveWord', () => saveWordRuleAction(A, 'spam', false)],
    ['setSpam', () => setSpamRuleAction(A, 'link', true)],
    ['deleteRule', () => deleteRuleAction(A, R)],
    ['setAutoHide', () => setAutoHideAction(A, true)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toBe('requireOwner');
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
    expect(Object.values(svc).reduce((n, f) => n + f.mock.calls.length, 0)).toBe(1); // only the first, authorised call
  });

  it('maps each action to the service input (the browser picks no kind it should not)', async () => {
    await hideCommentAction(A, 'c1', true, R);
    await hideCommentAction(A, 'c1', false, R);
    await replyCommentAction(A, 'c1', 'hi', R);
    await deleteCommentAction(A, 'c1', R);
    expect(svc.moderate.mock.calls.map((c) => c[1])).toEqual([
      { kind: 'hide', accountId: A, commentId: 'c1', requestId: R },
      { kind: 'unhide', accountId: A, commentId: 'c1', requestId: R },
      { kind: 'reply', accountId: A, commentId: 'c1', requestId: R, message: 'hi' },
      { kind: 'delete', accountId: A, commentId: 'c1', requestId: R },
    ]);
    expect(await hideCommentAction(A, 'c1', 'yes' as never, R)).toEqual({ ok: false, error: 'invalid' });
    await undoModerationAction(A, 3, R);
    expect(svc.undoAction.mock.calls[0][1]).toEqual({ accountId: A, logId: 3, requestId: R });
  });

  it('the admin client exists only inside token(), and only when the service asks for it', async () => {
    await hideCommentAction(A, 'c1', true, R);
    expect(calls).not.toContain('ADMIN');
    svc.moderate.mockImplementationOnce(async (deps: { token: (id: string) => Promise<string | null> }) => {
      await deps.token(A);
      return { ok: true, logged: true };
    });
    const r = await hideCommentAction(A, 'c1', true, R);
    expect(calls.slice(-3)).toEqual(['ADMIN', 'getToken', `revalidate:/accounts/[id],page`]);
    expect(JSON.stringify(r)).not.toContain('tok-');
  });

  it('rule actions use only the owner session (no admin client, no Instagram env)', async () => {
    await saveWordRuleAction(A, 'spam', true);
    await setSpamRuleAction(A, 'emoji', false);
    await deleteRuleAction(A, R);
    await setAutoHideAction(A, false);
    expect(calls).not.toContain('ADMIN');
    expect(calls).not.toContain('env');
    expect(svc.saveWordRule.mock.calls[0].slice(1)).toEqual([A, 'spam', true]);
    expect(svc.setAutoHide.mock.calls[0].slice(1, 3)).toEqual([A, false]);
  });

  it('revalidates the account page only after a success', async () => {
    svc.moderate.mockResolvedValueOnce({ ok: false, error: 'rate_limited' });
    expect(await hideCommentAction(A, 'c1', true, R)).toEqual({ ok: false, error: 'rate_limited' });
    expect(calls.some((c) => c.startsWith('revalidate'))).toBe(false);
  });
});
```

and `tests/moderation-privacy.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sources = ['lib', 'app', 'components']
  .flatMap((d) => readdirSync(join(root, d), { recursive: true, encoding: 'utf8' }).map((f) => join(d, f).replaceAll('\\', '/')))
  .filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const naming = (re: RegExp) => sources.filter((f) => re.test(read(f))).sort();
const MODERATION_FILES = [
  'lib/moderation/rules.ts',
  'lib/moderation/store.ts',
  'lib/moderation/service.ts',
  'lib/moderation/auto.ts',
  'lib/instagram/moderation.ts',
  'app/(app)/accounts/moderation-actions.ts',
  'components/account/CommentActions.tsx',
  'components/account/ModerationTab.tsx',
].filter((f) => existsSync(join(root, f))); // the two components land in the same wave

describe('moderation privacy and choke points', () => {
  it('only lib/moderation/store.ts names the log and the rules; settings also in the alert store (paused_at only)', () => {
    expect(naming(/['"`]moderation_log['"`]/)).toEqual(['lib/moderation/store.ts']);
    expect(naming(/['"`]moderation_rules['"`]/)).toEqual(['lib/moderation/store.ts']);
    expect(naming(/['"`]moderation_settings['"`]/)).toEqual(['lib/alerts/store.ts', 'lib/moderation/store.ts']);
  });

  it('only lib/moderation/store.ts updates or deletes comments', () => {
    expect(naming(/from\(\s*['"]comments['"]\s*\)\s*\.(update|delete)\(/)).toEqual(['lib/moderation/store.ts']);
  });

  it('no console output except console.error with ONE fixed string literal (no text, names, ids or tokens)', () => {
    for (const f of MODERATION_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.(log|info|warn|debug|trace)\s*\(/);
      for (const m of src.matchAll(/console\.error\(([^)]*)\)/g)) expect(m[1].trim(), f).toMatch(/^'[^'${}]*'$/);
    }
  });

  it('no token or secret reaches client code; the admin client stays in server modules', () => {
    for (const f of MODERATION_FILES.filter((x) => x.startsWith('components/'))) {
      const src = read(f);
      expect(src, f).not.toMatch(/access_token|NEXT_PUBLIC_|createAdminSupabase|account_tokens/);
      // types only (erased at build time): a VALUE import of a server module would pull it into the client bundle
      expect(src, f).not.toMatch(/^import (?!type )[^;]*from '@\/lib\/(moderation\/(store|auto|service)|instagram\/moderation)'/m);
    }
    expect(read('lib/moderation/service.ts')).not.toMatch(/createAdminSupabase/);
  });

  it('log rows carry ids only: the insert payload never names a text or author column', () => {
    const store = read('lib/moderation/store.ts');
    const insert = store.slice(store.indexOf('export async function insertLog'), store.indexOf('export async function finishLog'));
    expect(insert).not.toMatch(/\b(text|author_username|message)\b/);
  });
});
```

Note: the client components import from `@/lib/moderation/store` / `service` with `import type` only (the guard rejects value imports of server modules); pure values (`REPLY_MAX`, `SPAM_KINDS`, `PATTERN_MAX`, `MAX_WORD_RULES`, rule labels) come from `@/lib/moderation/rules`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/moderation-actions.test.ts tests/moderation-privacy.test.ts`
Expected: the actions test FAILS — `Failed to resolve import "@/app/(app)/accounts/moderation-actions"`. The privacy test may already pass (it is a guard over what Tasks 1–8 merged; missing files are skipped by `existsSync`).

- [ ] **Step 3: Write the actions** — create `app/(app)/accounts/moderation-actions.ts`:

```ts
'use server';

// Comment moderation server actions (Plan 15d). Server actions are public endpoints: requireOwner() FIRST (outside
// try/catch: it redirects by throwing); lib/moderation/service.ts then validates every value and never throws. The
// OWNER-SESSION client carries RLS for every read and write; the admin client is created only inside token() to read
// this one account's token (account_tokens is service-role only) and never leaves the server.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { getInstagramEnv } from '@/lib/env';
import { igModeration } from '@/lib/instagram/moderation';
import type { SpamKind } from '@/lib/moderation/rules';
import { deleteRule, moderate, saveWordRule, setAutoHide, setSpamRule, undoAction, type ModerationResult, type RuleResult, type ServiceDeps } from '@/lib/moderation/service';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { supabaseSyncStore } from '@/lib/sync/store';

async function deps(): Promise<ServiceDeps> {
  return {
    db: await createServerSupabase(),
    token: (accountId) => supabaseSyncStore(createAdminSupabase()).getToken(accountId),
    ig: igModeration(getInstagramEnv().apiVersion),
  };
}

function done<R extends { ok: boolean }>(r: R): R {
  if (r.ok) revalidatePath('/accounts/[id]', 'page');
  return r;
}

const UNEXPECTED = { ok: false as const, error: 'unexpected' as const };

export async function hideCommentAction(accountId: string, commentId: string, hide: boolean, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  if (typeof hide !== 'boolean') return { ok: false, error: 'invalid' };
  try {
    return done(await moderate(await deps(), { kind: hide ? 'hide' : 'unhide', accountId, commentId, requestId }));
  } catch {
    return UNEXPECTED; // missing Instagram env (EnvError) or a client that could not be created
  }
}

export async function replyCommentAction(accountId: string, commentId: string, message: string, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await moderate(await deps(), { kind: 'reply', accountId, commentId, requestId, message }));
  } catch {
    return UNEXPECTED;
  }
}

export async function deleteCommentAction(accountId: string, commentId: string, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await moderate(await deps(), { kind: 'delete', accountId, commentId, requestId }));
  } catch {
    return UNEXPECTED;
  }
}

export async function undoModerationAction(accountId: string, logId: number, requestId: string): Promise<ModerationResult> {
  await requireOwner();
  try {
    return done(await undoAction(await deps(), { accountId, logId, requestId }));
  } catch {
    return UNEXPECTED;
  }
}

export async function saveWordRuleAction(accountId: string, pattern: string, wholeWord: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await saveWordRule(await createServerSupabase(), accountId, pattern, wholeWord));
  } catch {
    return UNEXPECTED;
  }
}

export async function setSpamRuleAction(accountId: string, kind: SpamKind, on: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await setSpamRule(await createServerSupabase(), accountId, kind, on));
  } catch {
    return UNEXPECTED;
  }
}

export async function deleteRuleAction(accountId: string, ruleId: string): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await deleteRule(await createServerSupabase(), accountId, ruleId));
  } catch {
    return UNEXPECTED;
  }
}

export async function setAutoHideAction(accountId: string, enabled: boolean): Promise<RuleResult> {
  await requireOwner();
  try {
    return done(await setAutoHide(await createServerSupabase(), accountId, enabled));
  } catch {
    return UNEXPECTED;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-actions.test.ts tests/moderation-privacy.test.ts tests/followers-privacy.test.ts`, `npx tsc --noEmit`, `npx eslint "app/(app)/accounts/moderation-actions.ts" tests/moderation-actions.test.ts tests/moderation-privacy.test.ts`.
Expected: PASS (12 + 5 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/accounts/moderation-actions.ts" tests/moderation-actions.test.ts tests/moderation-privacy.test.ts
git commit -m "feat(moderation): owner-only server actions and the privacy guard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The comment row menu and its dialogs — `components/account/CommentActions.tsx`

**Files:**
- Create: `components/account/CommentActions.tsx`, `tests/comment-actions.test.tsx`

**Interfaces:**
- Consumes: Task 2 keys (`pages.account.moderation.*`), `REPLY_MAX` (Task 3), `type ModerationResult` (Task 7), `ConfirmDialog`, `ResponsiveDialog*`, `DropdownMenu*`, `Textarea`, `FormField`, `LoadingButton`, `usePrefs`, `formatNumber`.
- Produces (Task 11 imports the hook; Task 12 renders the component in the Comments tab):
```ts
export function useModerationRun(): {
  busy: boolean;
  error: string | null; // already translated
  run: (call: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => Promise<void>;
  clearError: () => void;
};
export interface CommentActionsProps {
  accountId: string;
  commentId: string;
  authorUsername: string | null;
  hidden: boolean | null;
  own: boolean; // the account's own comment: Hide/Unhide disabled (Instagram always shows it)
  hide: (accountId: string, commentId: string, hide: boolean, requestId: string) => Promise<ModerationResult>;
  reply: (accountId: string, commentId: string, message: string, requestId: string) => Promise<ModerationResult>;
  remove: (accountId: string, commentId: string, requestId: string) => Promise<ModerationResult>;
}
export function CommentActions(props: CommentActionsProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test** — create `tests/comment-actions.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CommentActions, type CommentActionsProps } from '@/components/account/CommentActions';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, prefetch: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses (same stubs as tests/followers-tab.test.tsx)
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.moderation;
const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OK = { ok: true as const, logged: true };

function renderIt(o: Partial<CommentActionsProps> = {}) {
  const props: CommentActionsProps = { accountId: A, commentId: 'c1', authorUsername: 'fan', hidden: false, own: false, hide: vi.fn(async () => OK), reply: vi.fn(async () => OK), remove: vi.fn(async () => OK), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <CommentActions {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}
const menu = () => screen.getByRole('button', { name: T.menu });
async function pick(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(menu());
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${item}`) }));
}

describe('CommentActions', () => {
  it('hide: confirm, one request with a fresh id, announced, refreshed, focus back on the menu button', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.hide);
    expect(await screen.findByRole('alertdialog', { name: T.hideDialog.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: T.hideDialog.confirm }));
    await waitFor(() => expect(p.hide).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.hide).mock.calls[0].slice(0, 3)).toEqual([A, 'c1', true]);
    expect(vi.mocked(p.hide).mock.calls[0][3]).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent(T.done.hide);
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(menu()).toHaveFocus());
  });

  it('a hidden comment offers Unhide', async () => {
    const user = userEvent.setup();
    const p = renderIt({ hidden: true });
    await pick(user, T.unhide);
    await user.click(await screen.findByRole('button', { name: T.unhideDialog.confirm }));
    await waitFor(() => expect(vi.mocked(p.hide).mock.calls[0][2]).toBe(false));
  });

  it("the account's own comment: Hide is disabled and says why", async () => {
    const user = userEvent.setup();
    renderIt({ own: true });
    await user.click(menu());
    const item = await screen.findByRole('menuitem', { name: new RegExp(`^${T.hide}`) });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent(T.ownHint);
  });

  it('delete: says it cannot be undone and needs the typed word before the button works', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.delete);
    const dialog = await screen.findByRole('alertdialog', { name: T.deleteDialog.title });
    expect(dialog).toHaveTextContent('cannot be undone');
    const confirm = screen.getByRole('button', { name: T.deleteDialog.confirm });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(T.deleteDialog.word), T.deleteDialog.word);
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(p.remove).toHaveBeenCalledWith(A, 'c1', expect.stringMatching(UUID)));
  });

  it('reply: counts characters, refuses empty text, sends the text', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.reply);
    expect(await screen.findByRole('dialog', { name: 'Reply to @fan' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: T.replyDialog.send });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(T.replyDialog.label), 'Thanks!');
    expect(screen.getByText('7 of 2,200 characters')).toBeInTheDocument();
    await user.click(send);
    await waitFor(() => expect(p.reply).toHaveBeenCalledWith(A, 'c1', 'Thanks!', expect.stringMatching(UUID)));
  });

  it('an error key is shown translated in the open dialog; nothing is refreshed', async () => {
    const user = userEvent.setup();
    renderIt({ hide: vi.fn(async () => ({ ok: false as const, error: 'rate_limited' as const })) });
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.hideDialog.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.rate_limited);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a double click sends once; each new dialog is a new request id', async () => {
    const user = userEvent.setup();
    let resolve!: (v: typeof OK) => void;
    const hide = vi.fn<CommentActionsProps['hide']>(() => new Promise<typeof OK>((r) => (resolve = r)));
    renderIt({ hide });
    await pick(user, T.hide);
    const confirm = await screen.findByRole('button', { name: T.hideDialog.confirm });
    await user.dblClick(confirm);
    expect(hide).toHaveBeenCalledTimes(1);
    resolve(OK);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.hideDialog.confirm }));
    await waitFor(() => expect(hide).toHaveBeenCalledTimes(2));
    expect(hide.mock.calls[1][3]).not.toBe(hide.mock.calls[0][3]);
  });

  it('Cancel closes without a request and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.cancel }));
    await waitFor(() => expect(menu()).toHaveFocus());
    expect(p.hide).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/comment-actions.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/account/CommentActions"`.

- [ ] **Step 3: Write the component** — create `components/account/CommentActions.tsx`:

```tsx
'use client';

// One comment's moderation menu (Plan 15d) for the Comments tab's renderActions slot: Reply, Hide/Unhide, Delete, each
// behind its own dialog. Opening a dialog = one intent = one request id (the server refuses a repeated id); a call in
// flight blocks a second one (double click); afterwards focus returns to this menu button and the result is announced.
// The server actions arrive as PROPS (the page passes them), so this file imports no server code.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog, ResponsiveDialogClose, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/format';
import { REPLY_MAX } from '@/lib/moderation/rules';
import type { ModerationResult } from '@/lib/moderation/service';

/** Runs one moderation call at a time; translates the error key; refreshes the page when the state changed. */
export function useModerationRun() {
  const t = useTranslations('pages.account.moderation');
  const router = useRouter();
  const inFlight = useRef(false); // a ref, not state: a double click lands before the re-render
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(call: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (r.ok) {
        onOk?.();
        router.refresh();
        return;
      }
      setError(r.error && t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t('errors.unexpected'));
      if (r.error === 'already_done' || r.error === 'comment_gone') router.refresh(); // show the current state
    } catch {
      setError(t('errors.unexpected'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

export interface CommentActionsProps {
  accountId: string;
  commentId: string;
  authorUsername: string | null;
  hidden: boolean | null;
  own: boolean;
  hide: (accountId: string, commentId: string, hide: boolean, requestId: string) => Promise<ModerationResult>;
  reply: (accountId: string, commentId: string, message: string, requestId: string) => Promise<ModerationResult>;
  remove: (accountId: string, commentId: string, requestId: string) => Promise<ModerationResult>;
}

type Open = 'reply' | 'hide' | 'delete' | null;

export function CommentActions({ accountId, commentId, authorUsername, hidden, own, hide, reply, remove }: CommentActionsProps) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const { busy, error, run, clearError } = useModerationRun();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [requestId, setRequestId] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const isHidden = hidden === true;
  const length = [...message.trim()].length;

  const start = (o: Exclude<Open, null>) => {
    setRequestId(crypto.randomUUID()); // one dialog = one intent = one id
    clearError();
    setStatus('');
    setOpen(o);
  };
  const close = () => {
    setOpen(null);
    setMessage('');
    clearError();
    requestAnimationFrame(() => trigger.current?.focus()); // after Radix's own focus restore
  };
  const finish = (done: 'hide' | 'unhide' | 'delete' | 'reply') => () => {
    setStatus(t(`done.${done}`));
    close();
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} type="button" variant="ghost" size="sm" aria-label={t('menu')}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => start('reply')}>{t('reply')}</DropdownMenuItem>
          <DropdownMenuItem disabled={own} onSelect={() => start('hide')} className="flex-col items-start">
            {t(isHidden ? 'unhide' : 'hide')}
            {own ? <span className="text-xs text-muted-foreground">{t('ownHint')}</span> : null}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => start('delete')}>
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {status}
      </span>

      <ConfirmDialog
        open={open === 'hide'}
        title={t(isHidden ? 'unhideDialog.title' : 'hideDialog.title')}
        body={t(isHidden ? 'unhideDialog.body' : 'hideDialog.body')}
        confirmLabel={t(isHidden ? 'unhideDialog.confirm' : 'hideDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => run(() => hide(accountId, commentId, !isHidden, requestId), finish(isHidden ? 'unhide' : 'hide'))}
        onClose={close}
      />
      <ConfirmDialog
        open={open === 'delete'}
        title={t('deleteDialog.title')}
        body={t('deleteDialog.body', { word: t('deleteDialog.word') })}
        requireText={t('deleteDialog.word')}
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => run(() => remove(accountId, commentId, requestId), finish('delete'))}
        onClose={close}
      />
      <ResponsiveDialog open={open === 'reply'} onOpenChange={(o) => !o && close()}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{authorUsername ? t('replyDialog.title', { username: authorUsername }) : t('replyDialog.titleNoName')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('replyDialog.description')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <form
            className="flex flex-col gap-[var(--gp)]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => reply(accountId, commentId, message, requestId), finish('reply'));
            }}
          >
            <FormField id={`reply-${commentId}`} label={t('replyDialog.label')} hint={t('replyDialog.count', { count: formatNumber(length, prefs), max: formatNumber(REPLY_MAX, prefs) })} error={error ?? undefined}>
              {(p) => <Textarea {...p} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}
            </FormField>
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose asChild>
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              </ResponsiveDialogClose>
              <LoadingButton type="submit" pending={busy} disabled={length === 0 || length > REPLY_MAX}>
                {t('replyDialog.send')}
              </LoadingButton>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
```

Notes for the implementer: the error shown in the reply dialog uses `FormField`'s `error` (it renders `role="alert"`); `ConfirmDialog` renders its own `role="alert"`. If `t.has` with a template key fails the typed-messages check, cast the key as the other tabs do (`GrowthTab` uses the same `t.has(\`…${x}\`)` pattern).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/comment-actions.test.tsx tests/messages.test.ts tests/ui-standards.test.ts`, `npx tsc --noEmit`, `npx eslint components/account/CommentActions.tsx tests/comment-actions.test.tsx`.
Expected: PASS (8 tests). If the first test's focus assertion is flaky under load, rerun the file alone once (implementer rules §5) before concluding anything.

- [ ] **Step 5: Commit**

```bash
git add components/account/CommentActions.tsx tests/comment-actions.test.tsx
git commit -m "feat(moderation): comment row menu with confirmed reply, hide/unhide and delete" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The Moderation tab component — `components/account/ModerationTab.tsx`

**Files:**
- Create: `components/account/ModerationTab.tsx`, `tests/moderation-tab.test.tsx`

**Interfaces:**
- Consumes: `type ModerationData`, `type LogEntry` (Task 5, `import type`), `type ModerationResult`, `type RuleResult` (Task 7, `import type`), `SPAM_KINDS`, `MAX_WORD_RULES`, `type ModerationRule`, `type SpamKind` (Task 3), `useModerationRun` (Task 10), `ConfirmDialog`, `EmptyState`, `Pagination`, `FormField`, `LoadingButton`, `Card*`, `Switch`, `Checkbox`, `Label`, `Input`, `Badge`, `Alert*`, `usePrefs`, `formatDateTime`, `formatNumber`.
- Produces (Task 12 renders it):
```ts
export interface ModerationActions {
  saveWord: (accountId: string, pattern: string, wholeWord: boolean) => Promise<RuleResult>;
  setSpam: (accountId: string, kind: SpamKind, on: boolean) => Promise<RuleResult>;
  deleteRule: (accountId: string, ruleId: string) => Promise<RuleResult>;
  setAutoHide: (accountId: string, enabled: boolean) => Promise<RuleResult>;
  undo: (accountId: string, logId: number, requestId: string) => Promise<ModerationResult>;
}
export interface ModerationTabProps {
  accountId: string;
  allowed: boolean; // active + comments scope
  data: ModerationData | null; // null = the migration is not applied
  scope?: Record<string, string>; // the Time Scope params: carried in the page links, never used here
  actions: ModerationActions;
}
export function ModerationTab(props: ModerationTabProps): JSX.Element;
```
Layout (mobile-first, one column; `lg:grid-cols-2` for the Auto-hide and Rules cards, the log full width below): **without the scope** an `EmptyState` (`noScope.*`, a link-button to `/accounts`) and nothing else; **without the migration** an `EmptyState` (`notReady.*`). Otherwise: the intro line; the **Auto-hide** card (paused `Alert` with its reason and `pausedSince`, the `Switch` labelled `auto.switch` — checked = on and not paused; disabled with the `auto.noRules` hint while there are no rules and it is off; switching ON opens a `ConfirmDialog` with `auto.enableBody` (`count` = preview count, `n` = formatted) and only the confirm calls `setAutoHide(true)`; switching OFF calls `setAutoHide(false)` at once; the **preview** below: `preview.count`, `preview.basis`, up to 5 examples `@author` + snippet + `preview.by`); the **Rules** card (four spam switches with label + hint, the word form: `FormField` + `Input`, then a row with the "Whole word only" `Checkbox` and the default-size Add button, the count line, the word chips with a remove icon button each); the **Log** card (an ordered list; each row: action, time (`formatDateTime`), actor (`log.byOwner` / `log.byRule` with the rule's label or `ruleLabel.removed`), result (`log.results.ok|pending|unknown` or the translated error key), context (`@author: snippet` or `log.gone`), `log.undone` or an Undo button (`size="sm"`, dense list) that opens a `ConfirmDialog` (`log.undoTitle.*` / `log.undoBody.*`) with a fresh request id; the range line and `Pagination` (`hrefFor(p) = '?' + URLSearchParams({ tab: 'moderation', ...scope, page: p > 1 ? p : (omitted) })`).

- [ ] **Step 1: Write the failing test** — create `tests/moderation-tab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, prefetch: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses (same stubs as tests/followers-tab.test.tsx)
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

import { ModerationTab, type ModerationActions, type ModerationTabProps } from '@/components/account/ModerationTab';
import type { ModerationData } from '@/lib/moderation/store';

const T = en.pages.account.moderation;
const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const RULE = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const word = { id: RULE, kind: 'word' as const, pattern: 'spam', wholeWord: false };

const DATA = (o: Partial<ModerationData> = {}): ModerationData => ({
  settings: { autoHide: false, pausedAt: null, pauseReason: null },
  rules: [word],
  log: {
    rows: [
      { id: 1, commentId: 'c1', action: 'hide', actor: `rule:${RULE}`, result: 'ok', targetId: null, undoOf: null, createdAt: '2026-10-29T09:00:00Z', undoneAt: null, shown: 'ok', undo: 'unhide', context: { authorUsername: 'bot', snippet: 'buy spam' } },
      { id: 2, commentId: 'c2', action: 'reply', actor: 'owner', result: 'pending', targetId: null, undoOf: null, createdAt: '2026-10-29T08:00:00Z', undoneAt: null, shown: 'unknown', undo: null, context: null },
      { id: 3, commentId: 'c3', action: 'hide', actor: 'rule:00000000-0000-4000-8000-000000000000', result: 'rate_limited', targetId: null, undoOf: null, createdAt: '2026-10-29T07:00:00Z', undoneAt: null, shown: 'rate_limited', undo: null, context: null },
    ],
    total: 120,
    page: 1,
    pages: 3,
    size: 50,
  },
  preview: { count: 2, scanned: 40, sample: [{ id: 'c9', authorUsername: 'bot2', snippet: 'spam again', rule: word }] },
  ...o,
});

function renderTab(o: Partial<ModerationTabProps> = {}) {
  const ok = async () => ({ ok: true as const });
  const actions: ModerationActions = { saveWord: vi.fn(ok), setSpam: vi.fn(ok), deleteRule: vi.fn(ok), setAutoHide: vi.fn(ok), undo: vi.fn(async () => ({ ok: true as const, logged: true })) };
  const props: ModerationTabProps = { accountId: A, allowed: true, data: DATA(), scope: { from: '2026-10-01' }, actions, ...o };
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ModerationTab {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return { ...view, actions: props.actions };
}

describe('ModerationTab', () => {
  it('without the comments scope: only the reconnect explanation with a link to Accounts', () => {
    renderTab({ allowed: false });
    expect(screen.getByText(T.noScope.title)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: T.noScope.link })).toHaveAttribute('href', '/accounts');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('before the migration: the database-update note', () => {
    renderTab({ data: null });
    expect(screen.getByText(T.notReady.title)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('switching auto-hide on shows the preview count in a confirm; only the confirm enables it', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.click(screen.getByRole('switch', { name: T.auto.switch }));
    const dialog = await screen.findByRole('alertdialog', { name: T.auto.enableTitle });
    expect(dialog).toHaveTextContent('2 comments that are already here will be hidden.');
    expect(actions.setAutoHide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: T.auto.enableConfirm }));
    await waitFor(() => expect(actions.setAutoHide).toHaveBeenCalledWith(A, true));
  });

  it('switching it off needs no confirm', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab({ data: DATA({ settings: { autoHide: true, pausedAt: null, pauseReason: null } }) });
    await user.click(screen.getByRole('switch', { name: T.auto.switch }));
    await waitFor(() => expect(actions.setAutoHide).toHaveBeenCalledWith(A, false));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('no rules: the switch is disabled with a hint; a pause shows its reason', () => {
    renderTab({ data: DATA({ rules: [], preview: { count: 0, scanned: 0, sample: [] } }) });
    expect(screen.getByRole('switch', { name: T.auto.switch })).toBeDisabled();
    expect(screen.getAllByText(T.auto.noRules).length).toBeGreaterThan(0);
  });

  it('a paused auto-hide explains why and reads as off', () => {
    renderTab({ data: DATA({ settings: { autoHide: true, pausedAt: '2026-10-29T06:00:00Z', pauseReason: 'reconnect' } }) });
    expect(screen.getByText(new RegExp(T.auto.pausedReconnect.slice(0, 30)))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: T.auto.switch })).not.toBeChecked();
  });

  it('the preview lists matches with their rule', () => {
    renderTab();
    expect(screen.getByText('2 visible comments match your rules.')).toBeInTheDocument();
    expect(screen.getByText('Checked against the newest 40 stored comments.')).toBeInTheDocument();
    expect(screen.getByText('spam again')).toBeInTheDocument();
    expect(screen.getAllByText('Matches: “spam”').length).toBe(1);
  });

  it('rules: add a whole-word word, remove one, switch a spam pattern; error keys are translated', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.type(screen.getByLabelText(T.rules.wordLabel), 'cheap');
    await user.click(screen.getByRole('checkbox', { name: T.rules.wholeWord }));
    await user.click(screen.getByRole('button', { name: T.rules.add }));
    await waitFor(() => expect(actions.saveWord).toHaveBeenCalledWith(A, 'cheap', true));
    await user.click(screen.getByRole('button', { name: 'Remove spam' }));
    await waitFor(() => expect(actions.deleteRule).toHaveBeenCalledWith(A, RULE));
    await user.click(screen.getByRole('switch', { name: T.rules.link.label }));
    await waitFor(() => expect(actions.setSpam).toHaveBeenCalledWith(A, 'link', true));
    vi.mocked(actions.saveWord).mockResolvedValueOnce({ ok: false, error: 'duplicate_rule' });
    await user.type(screen.getByLabelText(T.rules.wordLabel), 'spam');
    await user.click(screen.getByRole('button', { name: T.rules.add }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.duplicate_rule);
  });

  it('the log: who, what, result, context; unknown outcomes and removed rules are named', () => {
    renderTab();
    expect(screen.getByText(T.log.title)).toBeInTheDocument();
    expect(screen.getAllByText('By rule: “spam”', { exact: false }).length).toBe(1);
    expect(screen.getByText(new RegExp(`${T.log.byOwner}.*${T.log.results.unknown}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`By rule: ${T.ruleLabel.removed}.*${T.errors.rate_limited.slice(0, 20)}`))).toBeInTheDocument();
    expect(screen.getByText('@bot: buy spam')).toBeInTheDocument();
    expect(screen.getAllByText(T.log.gone)).toHaveLength(2);
    expect(screen.getByText('1–50 of 120')).toBeInTheDocument();
  });

  it('undo: confirm, then one call with the row id and a fresh request id', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.click(screen.getByRole('button', { name: T.log.undo.unhide }));
    await screen.findByRole('alertdialog', { name: T.log.undoTitle.unhide });
    await user.dblClick(screen.getAllByRole('button', { name: T.log.undo.unhide }).at(-1)!);
    await waitFor(() => expect(actions.undo).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.undo).mock.calls[0].slice(0, 2)).toEqual([A, 1]);
    expect(vi.mocked(actions.undo).mock.calls[0][2]).toMatch(UUID);
  });

  it('page links keep the Time Scope and the tab', () => {
    const { container } = renderTab();
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('?tab=moderation&from=2026-10-01&page=2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/moderation-tab.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/account/ModerationTab"`.

- [ ] **Step 3: Write the component** — create `components/account/ModerationTab.tsx`:

```tsx
'use client';

// The Moderation tab (Plan 15d): auto-hide (off by default; switching on shows the preview count first), the rules
// (four built-in spam patterns + banned words) with the live preview, and the moderation log with Undo and server
// pages. The server actions arrive as props; only TYPES come from the server modules (tests/moderation-privacy.test.ts).
import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useModerationRun } from '@/components/account/CommentActions';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Pagination } from '@/components/shared/Pagination';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatNumber } from '@/lib/format';
import { MAX_WORD_RULES, SPAM_KINDS, type ModerationRule, type SpamKind } from '@/lib/moderation/rules';
import type { ModerationResult, RuleResult } from '@/lib/moderation/service';
import type { LogEntry, ModerationData } from '@/lib/moderation/store';

export interface ModerationActions {
  saveWord: (accountId: string, pattern: string, wholeWord: boolean) => Promise<RuleResult>;
  setSpam: (accountId: string, kind: SpamKind, on: boolean) => Promise<RuleResult>;
  deleteRule: (accountId: string, ruleId: string) => Promise<RuleResult>;
  setAutoHide: (accountId: string, enabled: boolean) => Promise<RuleResult>;
  undo: (accountId: string, logId: number, requestId: string) => Promise<ModerationResult>;
}

export interface ModerationTabProps {
  accountId: string;
  allowed: boolean;
  data: ModerationData | null;
  scope?: Record<string, string>;
  actions: ModerationActions;
}

function useRuleName() {
  const t = useTranslations('pages.account.moderation');
  return (rule: ModerationRule | undefined) => (!rule ? t('ruleLabel.removed') : rule.kind === 'word' ? t('ruleLabel.word', { word: rule.pattern ?? '' }) : t(`ruleLabel.${rule.kind}`));
}

function AutoHideCard({ accountId, data, setAutoHide }: { accountId: string; data: ModerationData; setAutoHide: ModerationActions['setAutoHide'] }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const ruleName = useRuleName();
  const { busy, error, run } = useModerationRun();
  const [confirm, setConfirm] = useState(false);
  const { settings: s, preview: p } = data;
  const paused = s.pausedAt !== null;
  const on = s.autoHide && !paused;
  const noRules = data.rules.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auto.title')}</CardTitle>
        <CardDescription>{t('auto.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {paused ? (
          <Alert>
            <AlertDescription>
              {t(s.pauseReason === 'reconnect' ? 'auto.pausedReconnect' : 'auto.pausedFailing')} {t('auto.pausedSince', { date: formatDateTime(s.pausedAt!, prefs) })}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="mod-auto">{t('auto.switch')}</Label>
          <Switch
            id="mod-auto"
            checked={on}
            disabled={busy || (noRules && !on)}
            aria-describedby={noRules ? 'mod-auto-hint' : undefined}
            onCheckedChange={(v) => (v ? setConfirm(true) : void run(() => setAutoHide(accountId, false)))}
          />
        </div>
        {noRules ? (
          <p id="mod-auto-hint" className="text-sm text-muted-foreground">
            {t('auto.noRules')}
          </p>
        ) : null}
        {error && !confirm ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <section aria-labelledby="mod-preview" className="flex flex-col gap-2">
          <h3 id="mod-preview" className="text-sm font-medium">
            {t('preview.title')}
          </h3>
          <p aria-live="polite" className="text-sm">
            {t('preview.count', { count: p.count, n: formatNumber(p.count, prefs) })}
          </p>
          <p className="text-xs text-muted-foreground">{t('preview.basis', { count: formatNumber(p.scanned, prefs) })}</p>
          {p.sample.length ? (
            <ul className="flex flex-col gap-2">
              {p.sample.map((x) => (
                <li key={x.id} className="rounded-md border p-2 text-sm">
                  <span className="font-medium">@{x.authorUsername ?? '—'}</span> <span className="break-words">{x.snippet}</span>
                  <span className="block text-xs text-muted-foreground">{t('preview.by', { rule: ruleName(x.rule) })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title={t('auto.enableTitle')}
        body={t('auto.enableBody', { count: p.count, n: formatNumber(p.count, prefs) })}
        confirmLabel={t('auto.enableConfirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={confirm ? error : null}
        onConfirm={() => void run(() => setAutoHide(accountId, true), () => setConfirm(false))}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}

function RulesCard({ accountId, rules, actions }: { accountId: string; rules: ModerationRule[]; actions: ModerationActions }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const { busy, error, run } = useModerationRun();
  const [word, setWord] = useState('');
  const [whole, setWhole] = useState(false);
  const words = rules.filter((r) => r.kind === 'word');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rules.title')}</CardTitle>
        <CardDescription>{t('rules.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gp)]">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t('rules.spamTitle')}</legend>
          {SPAM_KINDS.map((k) => (
            <div key={k} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor={`mod-spam-${k}`}>{t(`rules.${k}.label`)}</Label>
                <p id={`mod-spam-${k}-hint`} className="text-xs text-muted-foreground">
                  {t(`rules.${k}.hint`)}
                </p>
              </div>
              <Switch id={`mod-spam-${k}`} checked={rules.some((r) => r.kind === k)} disabled={busy} aria-describedby={`mod-spam-${k}-hint`} onCheckedChange={(v) => void run(() => actions.setSpam(accountId, k, v))} />
            </div>
          ))}
        </fieldset>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => actions.saveWord(accountId, word, whole), () => {
              setWord('');
              setWhole(false);
            });
          }}
        >
          <h3 className="text-sm font-medium">{t('rules.wordsTitle')}</h3>
          <FormField id="mod-word" label={t('rules.wordLabel')} hint={t('rules.wordHint')}>
            {(p) => <Input {...p} value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />}
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-[var(--ctl)] items-center gap-2">
              <Checkbox id="mod-whole" checked={whole} onCheckedChange={(v) => setWhole(v === true)} />
              <Label htmlFor="mod-whole">{t('rules.wholeWord')}</Label>
            </div>
            <LoadingButton type="submit" pending={busy} disabled={word.trim() === ''}>
              {t('rules.add')}
            </LoadingButton>
          </div>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('rules.count', { count: formatNumber(words.length, prefs), max: formatNumber(MAX_WORD_RULES, prefs) })}</p>
        {words.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rules.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {words.map((w) => (
              <li key={w.id} className="flex max-w-full items-center gap-1 rounded-md border py-1 pl-2 text-sm">
                <span className="break-all">{t('ruleLabel.word', { word: w.pattern ?? '' })}</span>
                {w.wholeWord ? <Badge variant="secondary">{t('rules.wholeBadge')}</Badge> : null}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rules.remove', { word: w.pattern ?? '' })} disabled={busy} onClick={() => void run(() => actions.deleteRule(accountId, w.id))}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LogCard({ accountId, data, scope, undo }: { accountId: string; data: ModerationData; scope?: Record<string, string>; undo: ModerationActions['undo'] }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const ruleName = useRuleName();
  const { busy, error, run, clearError } = useModerationRun();
  const [target, setTarget] = useState<LogEntry | null>(null);
  const [requestId, setRequestId] = useState('');
  const { rows, total, page, pages, size } = data.log;
  const hrefFor = (p: number) => `?${new URLSearchParams({ tab: 'moderation', ...(scope ?? {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const actor = (a: string) => (a === 'owner' ? t('log.byOwner') : t('log.byRule', { rule: ruleName(data.rules.find((r) => `rule:${r.id}` === a)) }));
  const result = (shown: string) =>
    shown === 'ok' || shown === 'pending' || shown === 'unknown' ? t(`log.results.${shown}`) : t.has(`errors.${shown}`) ? t(`errors.${shown}`) : t('errors.unexpected');
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('log.title')}</CardTitle>
        <CardDescription>{t('log.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('log.empty')}</p>
        ) : (
          <ol className="flex flex-col divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{t(`log.actions.${r.action}`)}</span>
                  <time dateTime={r.createdAt} className="text-xs text-muted-foreground">
                    {formatDateTime(r.createdAt, prefs)}
                  </time>
                </div>
                <p className="text-sm">
                  {actor(r.actor)} · {result(r.shown)}
                </p>
                <p className="break-words text-sm text-muted-foreground">{r.context ? `@${r.context.authorUsername ?? '—'}: ${r.context.snippet ?? ''}` : t('log.gone')}</p>
                {r.undoneAt ? (
                  <p className="text-xs text-muted-foreground">{t('log.undone', { date: formatDateTime(r.undoneAt, prefs) })}</p>
                ) : r.undo ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearError();
                        setRequestId(crypto.randomUUID());
                        setTarget(r);
                      }}
                    >
                      {t(`log.undo.${r.undo}`)}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {total > 0 ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t('log.range', { first: formatNumber(first, prefs), last: formatNumber(Math.min(page * size, total), prefs), total: formatNumber(total, prefs) })}
          </p>
        ) : null}
        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </CardContent>
      <ConfirmDialog
        open={target !== null && target.undo !== null}
        title={target?.undo ? t(`log.undoTitle.${target.undo}`) : ''}
        body={target?.undo ? t(`log.undoBody.${target.undo}`) : ''}
        confirmLabel={target?.undo ? t(`log.undo.${target.undo}`) : ''}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => target && void run(() => undo(accountId, target.id, requestId), () => setTarget(null))}
        onClose={() => setTarget(null)}
      />
    </Card>
  );
}

export function ModerationTab({ accountId, allowed, data, scope, actions }: ModerationTabProps) {
  const t = useTranslations('pages.account.moderation');
  if (!allowed)
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden="true" />}
        title={t('noScope.title')}
        description={t('noScope.body')}
        action={
          <Button asChild variant="outline">
            <Link href="/accounts">{t('noScope.link')}</Link>
          </Button>
        }
      />
    );
  if (!data) return <EmptyState icon={<ShieldAlert aria-hidden="true" />} title={t('notReady.title')} description={t('notReady.body')} />;
  return (
    <div className="flex flex-col gap-[var(--gp)]">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid gap-[var(--gp)] lg:grid-cols-2">
        <AutoHideCard accountId={accountId} data={data} setAutoHide={actions.setAutoHide} />
        <RulesCard accountId={accountId} rules={data.rules} actions={actions} />
        <LogCard accountId={accountId} data={data} scope={scope} undo={actions.undo} />
      </div>
    </div>
  );
}
```

Notes for the implementer: `ConfirmDialog`'s confirm button and the row's Undo button share a label; the test clicks the last one (the dialog's). `size="icon-sm"` is a `Button` variant (`components/ui/button.tsx`); if the density CSS ignores it, keep it (the chip is a dense list). The "Whole word only" row and the Add button are both `--ctl` high (UI standard 5).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/moderation-tab.test.tsx tests/comment-actions.test.tsx tests/moderation-privacy.test.ts tests/ui-standards.test.ts`, `npx tsc --noEmit`, `npx eslint components/account/ModerationTab.tsx tests/moderation-tab.test.tsx`.
Expected: PASS (11 tests in the new file; the privacy guard now also scans both components).

- [ ] **Step 5: Commit**

```bash
git add components/account/ModerationTab.tsx tests/moderation-tab.test.tsx
git commit -m "feat(moderation): Moderation tab (auto-hide with preview, rules, log with undo and pages)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Wiring — the `moderation` tab, its page `case`, and the actions in the Comments tab

**Files:**
- Modify: `lib/dashboard/account.ts`, `lib/dashboard/lists.ts` (export `parsePage` only), `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `components/account/CommentActions.tsx` (adds `ModeratedCommentsTab`), `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx`
- Existing tests that must keep passing: `tests/route-loading.test.tsx` (`it.each(TABS)`: the new tab needs its skeleton), `tests/comments-tab.test.tsx` (15c), `tests/comment-actions.test.tsx`, `tests/moderation-tab.test.tsx`.

**First:** read the merged 15c files `components/account/CommentsTab.tsx`, `lib/comments/view.ts`, the page's `case 'comments'` and the CURRENT `TABS` line. Adapt every name below to what 15c actually exported (list each adaptation as a deviation). If `CommentsTab` does NOT start with `'use client'` (a server component), skip the wrapper and pass `renderActions` directly from the page (a server component may pass a function to a server component) — same props as below.

**Interfaces:**
- `TABS` = 15c's list with `'moderation'` inserted right after `'comments'` (Followers stays LAST): `['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers']`.
- `ModeratedCommentsTab(props: ComponentProps<typeof CommentsTab> & { moderation: ModerationRowActions | null })` with `ModerationRowActions = { ownUsername: string } & Pick<CommentActionsProps, 'hide' | 'reply' | 'remove'>`; `moderation = null` (no scope / not active) renders the plain `CommentsTab` (no menu at all).

- [ ] **Step 1: Update the pinned tests first (they fail until Step 2)**

`tests/dashboard-account.test.ts` — the two `TABS` lines (as 15c left them) gain `'moderation'` after `'comments'`:
```ts
    expect(TABS).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers']);
    expect(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers', 'audience', 'GROWTH'].map(parseTab)).toEqual(['overview', 'growth', 'posts', 'stories', 'comments', 'moderation', 'followers', 'overview', 'overview']);
```
`tests/account-view.test.tsx` — the tab names line gains `'Moderation'` after `'Comments'` (`[…, 'Comments', 'Moderation', 'Followers']`); add to its "no range bar on list tabs" assertion (15c added `comments` there) the `moderation` tab the same way.

`tests/account-page.test.tsx` — add the hoisted state and mocks next to the followers ones:
```ts
const moderation = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loads: [] as unknown[][] }));
vi.mock('@/lib/moderation/store', () => ({
  loadModeration: async (...a: unknown[]) => (calls.push('moderation'), moderation.loads.push(a.slice(1)), moderation.data),
}));
```
and a describe block at the end:
```ts
describe('moderation tab (Plan 15d)', () => {
  const SCOPED = { grantedScopes: ['instagram_business_basic', 'instagram_business_manage_comments'] };
  type ModProps = { accountId: string; allowed: boolean; data: unknown; actions: Record<string, unknown>; scope?: Record<string, string> };
  const modTab = async (sp: Record<string, string> = {}) => ((await streamTab(await run(ID, { tab: 'moderation', ...sp }))) as ReactElement<ModProps>).props;
  beforeEach(() => {
    moderation.data = { settings: {}, rules: [], log: { rows: [], total: 0, page: 1, pages: 1, size: 50 }, preview: { count: 0, scanned: 0, sample: [] } };
    moderation.loads = [];
  });

  it('with the scope: one owner-session read (account, own name, page, now) and the five actions passed straight through', async () => {
    accounts.push(acct(ID, 'active', SCOPED));
    const p = await modTab({ page: '2' });
    expect(p.allowed).toBe(true);
    expect(p.data).toBe(moderation.data);
    expect(moderation.loads[0].slice(0, 3)).toEqual([ID, `u${ID.slice(0, 4)}`, 2]);
    expect(Object.keys(p.actions).sort()).toEqual(['deleteRule', 'saveWord', 'setAutoHide', 'setSpam', 'undo']);
    expect(calls).not.toContain('ADMIN');
  });

  it('without the comments scope: no read, the reconnect state', async () => {
    accounts.push(acct(ID));
    const p = await modTab();
    expect(p.allowed).toBe(false);
    expect(p.data).toBeNull();
    expect(calls).not.toContain('moderation');
  });

  it('a bad ?page= reads page 1; the Suspense key ignores page', async () => {
    accounts.push(acct(ID, 'active', SCOPED));
    await modTab({ page: 'x' });
    expect(moderation.loads[0][2]).toBe(1);
    const key = async (sp: Record<string, string>) => (await run(ID, sp)).props.children.key;
    expect(await key({ tab: 'moderation', page: '3' })).toBe(await key({ tab: 'moderation' }));
  });
});
```
and, inside 15c's comments-tab tests of this file, one more test (adapt the helper name 15c used, e.g. `commentsTab`):
```ts
  it('the Comments tab gets the moderation menu only with the scope, with the account name for "own" comments', async () => {
    accounts.push(acct(ID, 'active', { grantedScopes: ['instagram_business_manage_comments'] }));
    const withScope = (await streamTab(await run(ID, { tab: 'comments' }))) as ReactElement<{ moderation: { ownUsername: string; hide: unknown } | null }>;
    expect(withScope.props.moderation?.ownUsername).toBe(`u${ID.slice(0, 4)}`);
    expect(typeof withScope.props.moderation?.hide).toBe('function');
    accounts.length = 0;
    accounts.push(acct(ID));
    const without = (await streamTab(await run(ID, { tab: 'comments' }))) as ReactElement<{ moderation: unknown }>;
    expect(without.props.moderation).toBeNull();
  });
```

Run: `npx vitest run tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx` → FAIL (the tab does not exist yet).

- [ ] **Step 2: Make the edits**

`lib/dashboard/account.ts` — the `TABS` line: insert `'moderation'` after `'comments'`; extend its trailing comment with `Moderation (Plan 15d): rules, auto-hide, log`.

`lib/dashboard/lists.ts` — `const parsePage = …` becomes `export const parsePage = …` (nothing else).

`components/account/TabSkeleton.tsx` — add `case 'moderation':` directly above `case 'followers':` so both share the followers shape (cards and a list).

`components/account/CommentActions.tsx` — append (adapt the import path / prop names to 15c):
```tsx
import type { ComponentProps } from 'react';
import { CommentsTab } from '@/components/account/CommentsTab';

export type ModerationRowActions = { ownUsername: string } & Pick<CommentActionsProps, 'hide' | 'reply' | 'remove'>;

/** The Comments tab with the moderation menu on every row (a client wrapper: functions cannot come from the server page). */
export function ModeratedCommentsTab({ moderation, ...props }: ComponentProps<typeof CommentsTab> & { moderation: ModerationRowActions | null }) {
  if (!moderation) return <CommentsTab {...props} />;
  const own = moderation.ownUsername.toLowerCase();
  return (
    <CommentsTab
      {...props}
      renderActions={(c) => (
        <CommentActions accountId={props.accountId} commentId={c.id} authorUsername={c.authorUsername} hidden={c.hidden} own={c.authorUsername?.toLowerCase() === own} hide={moderation.hide} reply={moderation.reply} remove={moderation.remove} />
      )}
    />
  );
}
```
(`import` lines go to the top of the file with the others.)

`app/(app)/accounts/[id]/(tabs)/page.tsx`:
- imports:
```ts
import { ModeratedCommentsTab } from '@/components/account/CommentActions';
import { ModerationTab } from '@/components/account/ModerationTab';
import { deleteCommentAction, deleteRuleAction, hideCommentAction, replyCommentAction, saveWordRuleAction, setAutoHideAction, setSpamRuleAction, undoModerationAction } from '@/app/(app)/accounts/moderation-actions';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { loadModeration } from '@/lib/moderation/store';
```
  and add `parsePage` to the existing `@/lib/dashboard/lists` import.
- in `TabContent`, right after `const tz = prefs.timezone;`:
```ts
  const canModerate = account.status === 'active' && hasScope(account, COMMENTS_SCOPE); // Plan 15d: the server checks again
```
- 15c's `case 'comments'`: render `ModeratedCommentsTab` instead of `CommentsTab`, with every prop 15c passes plus
```tsx
moderation={canModerate ? { ownUsername: account.username, hide: hideCommentAction, reply: replyCommentAction, remove: deleteCommentAction } : null}
```
- a new case before `case 'followers'`:
```tsx
    case 'moderation': {
      // Plan 15d: auto-hide, rules, preview and the log (owner session; nothing is read without the scope). The imported
      // server actions are passed straight to the client component (never wrapped in a closure here).
      const data = canModerate ? await loadModeration(db, account.id, account.username, parsePage(sp.page), now) : null;
      const actions = { saveWord: saveWordRuleAction, setSpam: setSpamRuleAction, deleteRule: deleteRuleAction, setAutoHide: setAutoHideAction, undo: undoModerationAction };
      return <ModerationTab accountId={account.id} allowed={canModerate} data={data} scope={scope.params} actions={actions} />;
    }
```
- the `CommentsTab` import 15c added stays only if still used elsewhere in the file; otherwise remove it (eslint `no-unused-vars`).

Note: `ModerationTab` receives `data = null` for "not ready" AND for "not allowed"; it checks `allowed` first, so the reconnect state wins.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx tests/route-loading.test.tsx tests/comments-tab.test.tsx tests/comment-actions.test.tsx tests/moderation-tab.test.tsx tests/moderation-privacy.test.ts`, `rm -rf .next` is NOT needed (no route moved), `npx tsc --noEmit`, `npx eslint lib/dashboard/account.ts lib/dashboard/lists.ts components/account/TabSkeleton.tsx components/account/CommentActions.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/account.ts lib/dashboard/lists.ts components/account/TabSkeleton.tsx components/account/CommentActions.tsx "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/dashboard-account.test.ts tests/account-view.test.tsx tests/account-page.test.tsx
git commit -m "feat(moderation): Moderation tab and the comment menu in the Comments tab" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docs, final check

**Files:**
- Create: `docs/RUNBOOK_MODERATION.md`
- Modify: `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md`, `docs/META_SETUP.md`

- [ ] **Step 1: `docs/RUNBOOK_MODERATION.md`** (new; use the Write tool; the block below is fenced with FOUR backticks because it contains code blocks — write only its content):

````markdown
# Runbook — Comment moderation (Plan 15d)

Reply, hide/unhide and delete from the app, banned-word and spam auto-hide, the moderation log with Undo. Every check
below is done WITH the owner (2FA login, real Instagram accounts). Never paste comment texts, commenter names, tokens or
URLs with `access_token` into chat, tickets or this file: write yes/no, counts and error keys only.

## 0. The migration (apply BEFORE deploying the code that needs it; the owner says go)
File `supabase/migrations/20261029000002_comment_moderation.sql` (needs 15c's `20261029000001` applied first or in the same push).
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only the new file(s) pending
node --env-file=.env.local scripts/db-probe.mjs table:moderation_log table:moderation_rules table:moderation_settings   # before: 404 PGRST205
node --env-file=.env.local scripts/sb.mjs db push --dry-run
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs table:moderation_log table:moderation_rules table:moderation_settings   # after: 401 / 42501 (exists, anon denied)
```
Before the migration the Moderation tab says "needs a database update", the row menu answers `not_ready`, the tick skips auto-hide.

## 1. Live probes on a THROWAWAY comment first (gate: before trusting anything below, and before auto-hide)
Use the owner's own test post (or a new post you delete afterwards). From a SECOND Instagram account (or ask a friend),
write three comments: "probe one", "probe two www.example.com", "probe three". Wait for the hourly comments read (or
Sync now), then in in2sight → the account → Comments:
| # | Probe (Open question) | Do | Expect | Result |
|---|---|---|---|---|
| P1 | write permission | Hide "probe one" | "Comment hidden."; on Instagram (the app, logged in as the owner) the comment shows as hidden; the log shows Hidden · By you · Done | |
| P3 | hide twice | Instagram app: unhide it there; in2sight: Hide again | either "Already done" (our state) or Done; never an error page | |
| P1 | unhide | Log → Unhide | visible again on Instagram; the log row says "Undone …" | |
| P6/P7 | reply | Reply "thanks 🙏 @ownaccount #test" to "probe two" | "Reply posted."; the reply appears on Instagram with the emoji, mention and hashtag | |
| P8 | undo a reply | Log → Delete reply | the reply is gone on Instagram | |
| P1 | delete | Delete "probe three" (type DELETE) | gone on Instagram; the row disappears from Comments; the log shows Deleted (no Undo) | |
| P5 | hidden in reads | after hiding "probe one" again, Sync now; Supabase SQL: `select hidden from comments where id = '<id>'` | true (our value survives the re-read); note whether the comment still came back in the read (count only) | |
| P4 | reply counted | `select comments_count, comments_synced_count from media where id = '<post id>'` before and after the reply | write down whether comments_count changed | |
| — | stale id | delete a comment in the Instagram app, then Hide it in in2sight (before the next sync) | "This comment no longer exists on Instagram."; the row disappears | |
| — | permission loss | (only if the owner agrees) remove the comments permission in Instagram → Settings → Website permissions → in2sight, then Hide | "Instagram did not allow this. Reconnect …"; the account's sync status is unchanged; Reconnect restores it | |
Record any answer that differs in `docs/META_PROBE_RESULTS.md` ("Moderation writes", counts and codes only).

## 2. Layout: 360 / 768 / 1280 × light/dark, keyboard
| Check | 360 | 768 | 1280 |
|---|---|---|---|
| Comment row: the Moderate (⋯) button is visible, does not push the text sideways | | | |
| The three dialogs: bottom sheet / dialog; Esc and Cancel close; focus returns to the ⋯ button | | | |
| Delete dialog: the confirm stays disabled until DELETE / 删除 is typed | | | |
| Moderation tab: cards stack on phones, two columns from 1024; no sideways page scroll; no range bar | | | |
| Switches and the word form keyboard-operable; errors read by a screen reader (role alert) | | | |
| zh-CN: all strings Chinese, full-width punctuation | | | |

## 3. Rules, preview and auto-hide (after §1 passed)
1. Moderation tab → Rules: add "probe" (not whole word). The preview counts the visible probe comments (count only).
2. Switch on "Links": the preview count rises if "probe two www.example.com" is visible.
3. Switch auto-hide ON: the confirm shows the same count. Confirm. Within one tick (≤ 30 min): those comments are hidden
   on Instagram; the log shows "Hidden · By rule: …".
4. Unhide one of them from the log: it stays visible after the next two ticks (never re-hidden).
5. Remove the rules, switch auto-hide off.

## 4. Failure handling
- Rate limits: after a busy day, `select result, count(*) from moderation_log where created_at > now() - interval '1 day' group by 1;`
  — any `rate_limited` → lower `AUTO_HIDE_PER_TICK` / `MANUAL_PER_MINUTE` (Open question P2) and tell the assistant.
- Pause: if auto-hide pauses, ONE notification "Auto-hide paused" arrives (not one per comment); switching it on again lifts the pause.
- `pending` rows older than 2 minutes show "Outcome unknown — check on Instagram": check that comment on Instagram by hand.
- Sync isolation: `select summary->'moderation' from sync_runs order by started_at desc limit 5;` → counts only; sync outcomes unaffected.

## 5. Privacy and security (report yes/no and counts only)
- `select column_name from information_schema.columns where table_name = 'moderation_log';` → no text/author/message column.
- `select count(*) from notifications where kind = 'moderation_paused' and (payload - 'username') <> '{}'::jsonb;` → 0 (the payload has only `username`).
- Vercel logs for a day of moderation: no comment text, no names, no `access_token` (search for the probe words: 0 hits).
- Logged out (private window): every server action answers a redirect to /login; nothing changes.
- Deleting an account permanently removes its `moderation_*` rows (cascade): `select count(*) from moderation_log where account_id = '<id>';` → 0.

## 6. Known limits (by design)
Hides and unhides done inside the Instagram app are not seen (P5); replies are not listed as threads (15c reads top-level
comments only); Simplified/Traditional Chinese are different words; delete is never automated and never undoable;
auto-hide sees only comments the hourly read stored (posts of the last 30 days).

## What to send if it fails
The step number, the error text shown, the `moderation_log.result` value, and the time. Never the comment text or names.
````

- [ ] **Step 2: `docs/SPEC.md`** — add after the last 7-section (15c adds `7i`; use the next letter, `7j`):
```markdown
## 7j. Comment moderation (Plan 15d; creator-toolkit design §0b, round 3)
Reply / hide / unhide / delete from the Comments tab (one ⋯ menu per row, a confirm for each; delete needs the typed word
and says it cannot be undone). Server actions: requireOwner → validation → the comment re-read with comment id AND
account id (owner session) → per-minute cap (30) → `moderation_log` row FIRST (`pending`, unique `request_id` from the
dialog) → token (admin, server only) → Instagram (`POST /{comment-id}?hide=`, `POST /{comment-id}/replies`,
`DELETE /{comment-id}`; `lib/instagram/moderation.ts`) → result → local mirror (`comments.hidden`, row removed after a
delete). Undo: hide → unhide, reply → delete the reply; delete is irreversible and never automated. Rules per account
(`moderation_rules`: banned words, built-in link / mentions ≥ 4 / repeat ≥ 8 / emoji ≥ 10 patterns; NFKC + case + zero-width
folding; CJK words match inside text) with a live preview; auto-hide (`moderation_settings`, default off) runs after the
alerts in the tick (≤ 20 per account per tick, own 5 s window, never re-hides, never acts after the owner, pauses on a
permission answer or 3 failures in a row → one `moderation_paused` notification). The Moderation tab shows the rules,
the preview and the log (50 per page, Undo). Log rows hold ids only (no text, no names). Runbook: `docs/RUNBOOK_MODERATION.md`.
```
and in §5 (data model) one line: "`moderation_settings`, `moderation_rules` (owner-authored), `moderation_log` (append-only, ids only) — Plan 15d; `comments` gains owner update (`hidden`) and delete."

- [ ] **Step 3: `docs/TODO.md`** — a new section after 15c's (`6m` → use `6n`):
```markdown
## 6n. Comment moderation (Plan 15d)
- [x] Migration `20261029000002_comment_moderation.sql` (code done; NOT applied: owner go-ahead, RUNBOOK_MODERATION §0)
- [x] Meta write client + error keys; service (log first, double-submit guard, wrong-account guard); server actions
- [x] Rules (words + 4 spam patterns), preview, auto-hide pass in the tick (capped, idempotent, pauses), `moderation_paused` alert
- [x] Comment row menu (reply / hide / unhide / delete), Moderation tab (auto-hide, rules, log with Undo and pages)
- [ ] Live probes P1–P8 on a throwaway comment (RUNBOOK_MODERATION §1) — BEFORE switching auto-hide on
- [ ] Layout, rules/auto-hide and privacy checks (RUNBOOK_MODERATION §2–§5)
- Known: hides done in the Instagram app are not seen (P5); no Simplified/Traditional folding; auto-hide only sees stored comments (last 30 days of posts).
```
and remove "moderation" from the still-open comments bullet of `docs/PROGRESS.md` §7 item 1 (it is built: "code done; live verification pending").

- [ ] **Step 4: `docs/UI_STANDARDS.md`** — add rule 16:
```markdown
16. **Writes to Instagram are confirmed, logged and reversible where Instagram allows.** Every action that changes something on Instagram opens a confirm (`ConfirmDialog`; an irreversible one needs a typed word via `requireText` and says it cannot be undone), sends one request per dialog opening (a request id the server refuses to repeat), keeps the button busy while it runs, announces the result (`role="status"`), shows errors as translated keys (`role="alert"`), returns focus to the button that opened it, and appears in the moderation log with Undo where possible. Automation never deletes. → `components/account/CommentActions.tsx` (`useModerationRun`), `lib/moderation/service.ts`.
```

- [ ] **Step 5: `docs/META_SETUP.md`** — in Part 5b add: "Plan 15d uses the same permission for WRITES (reply, hide, delete) on the owner's own media; no extra permission, no App Review (Standard Access). Probe it on a throwaway comment first: `docs/RUNBOOK_MODERATION.md` §1." **`docs/HANDOVER.md`** / **`docs/PROGRESS.md`**: one line each in the "what is built" list ("15d: comment moderation — reply/hide/delete with confirms, rules + auto-hide in the tick, undo log; RUNBOOK_MODERATION; migration 20261029000002 NOT applied"), the migration table row, and §6 live checks item "RUNBOOK_MODERATION §1 probes BEFORE auto-hide".

- [ ] **Step 6: Final check** (orchestrator, after all waves merged and worktrees removed): `rm -rf .next`, `npm run check > log 2>&1; rc=$?; echo "CHECK_EXIT=$rc" >> log`, READ the log. Expected: lint, tsc, all tests, build green.

- [ ] **Step 7: Commit**

```bash
git add docs/RUNBOOK_MODERATION.md docs/SPEC.md docs/TODO.md docs/HANDOVER.md docs/PROGRESS.md docs/UI_STANDARDS.md docs/META_SETUP.md
git commit -m "docs(moderation): runbook (live probes first), SPEC 7j, TODO 6n, UI standard 16, handover lines" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

<!-- PLAN CONTINUES -->
