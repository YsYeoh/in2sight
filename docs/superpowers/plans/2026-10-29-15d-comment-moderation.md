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
- UI: `ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, busy, error, requireText?, onConfirm, onClose })` (AlertDialog; destructive confirm button; `role="alert"` error), `ResponsiveDialog*`, `components/ui/dropdown-menu.tsx`, `switch.tsx`, `textarea.tsx`, `checkbox.tsx`, `input.tsx`, `alert.tsx`, `EmptyState`, `LoadingButton({ pending })`, `FormField({ id, label, hint?, error?, children: (p) => … })`, `Pagination({ page, pages, hrefFor })`, `usePrefs()`, `formatDateTime(v, prefs)` / `formatNumber(n, prefs)` (`lib/format.ts`). Account tabs: `TABS` in `lib/dashboard/account.ts` (`['overview', 'growth', 'posts', 'stories', 'followers']` today; 15c adds `comments`), `TabSkeleton`, the page's `switch (tab)` in `app/(app)/accounts/[id]/(tabs)/page.tsx` (server actions are passed straight to client tabs, e.g. `deleteSnapshot: deleteFollowerSnapshotAction`); `LIST_KEYS` includes `page`. Tabs are client components (`FollowersTab` is `'use client'`).
- `messages/*.json`: `pages.account.tab` one-line object at line 383 (6 spaces); `notifications.kinds.taking_off` is the last kind (lines 840–843). `tests/messages.test.ts` (parity, placeholders, no copy-pasted English), `tests/ui-standards.test.ts`.
- Migrations: 12 applied; Plan 15c may add `20261029000001_*`. This plan uses **`20261029000002_comment_moderation.sql`**. `tests/migrations.test.ts` (generic rules).

## Contract with Plan 15c (read-only comment insights; planned in parallel, built first)

At the time of writing, `docs/superpowers/plans/2026-10-29-15c-comment-insights.md` did not exist yet; this plan uses the contract the orchestrator gave both planners. **The implementer of Task 12 reads the merged 15c code first and adapts names (listing every adaptation as a deviation):**
- `components/account/CommentsTab.tsx` exports `CommentsTab` with an optional `renderActions?: (c: CommentView) => React.ReactNode`; `CommentRow` has an optional `actions?: React.ReactNode` slot and `status?: 'visible' | 'hidden'`.
- `CommentView` carries `id, mediaId, authorUsername, text, postedAt, likeCount, isQuestion, hidden: boolean | null, repliedByOwner: boolean | null`.
- The account tab `comments` exists in `TABS`, with its `case 'comments'` in the page and `pages.account.tab.comments` in both catalogs.
- `CommentsTab` is a CLIENT component (like every other tab), so a function prop cannot come from the server page: Task 12 adds a tiny client wrapper `ModeratedCommentsTab` that passes `renderActions` client-side. If 15c made `CommentsTab` a server component, the page passes `renderActions` directly instead (both variants are spelled out in Task 12).
- Nothing in Tasks 1–11 imports any 15c module: the moderation pieces take plain props (`commentId`, `hidden`, `own`), so 15c renames touch Task 12 only.
- `repliedByOwner`: if 15c leaves it `null` (replies are not ingested), it stays `null`; this plan does not derive it from the log (Open question for a later plan).

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
| `lib/moderation/rules.ts` (new), `tests/moderation-rules.test.ts` (new) | `fold`, `matchRule`, `validateWord`, `touchedIds`, `pickAutoHide`, the constants |
| `lib/instagram/moderation.ts` (new), `tests/instagram-moderation.test.ts` (new) | `igModeration` (hide, reply, remove), `classifyModerationError`, `REPLY_MAX`, `MODERATION_TIMEOUT_MS` |
| `lib/moderation/store.ts` (new), `tests/moderation-store.test.ts` (new) | the ONLY module naming `moderation_log` / `moderation_rules` (and writing `comments`); `loadModeration`, log writes, rule/settings writes, the tick reads; pure `undoKind`, `displayResult` |
| `lib/moderation/service.ts` (new), `tests/moderation-service.test.ts` (new) | `moderate`, `undoAction`, `saveWordRule`, `setSpamRule`, `deleteRule`, `setAutoHide` |
| `lib/moderation/auto.ts` (new), `lib/sync/tick.ts`, `lib/sync/deps.ts`, `tests/moderation-auto.test.ts` (new) | `runAutoHide` and its place in the tick |
| `lib/alerts/settings.ts`, `lib/alerts/rules.ts`, `lib/alerts/store.ts`, `lib/alerts/run.ts`, `lib/alerts/message.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts` (new) | the `moderation_paused` kind, rule, read and link |
| `app/(app)/accounts/moderation-actions.ts` (new), `tests/moderation-actions.test.ts` (new), `tests/moderation-privacy.test.ts` (new) | the server actions; choke point + no-logging guard |
| `components/account/CommentActions.tsx` (new), `tests/comment-actions.test.tsx` (new) | the per-comment menu and its three dialogs; `ModeratedCommentsTab` wrapper is added in Task 12 |
| `components/account/ModerationTab.tsx` (new), `tests/moderation-tab.test.tsx` (new) | auto-hide, preview, rules, log |
| `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `components/account/CommentActions.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | the `moderation` tab, the actions in the Comments tab |
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
| 8 | Auto-hide pass in the tick | 3, 4, 5 | `lib/moderation/auto.ts`, `lib/sync/tick.ts`, `lib/sync/deps.ts`, `tests/moderation-auto.test.ts` | 7 |
| 9 | Server actions + privacy guard | 7, 8 | `app/(app)/accounts/moderation-actions.ts`, `tests/moderation-actions.test.ts`, `tests/moderation-privacy.test.ts` | 10, 11 |
| 10 | Comment row menu + dialogs | 2, 7 (types) | `components/account/CommentActions.tsx`, `tests/comment-actions.test.tsx` | 9, 11 |
| 11 | Moderation tab component | 2, 5, 7 (types) | `components/account/ModerationTab.tsx`, `tests/moderation-tab.test.tsx` | 9, 10 |
| 12 | Wiring: tab, page cases, Comments tab actions | 9, 10, 11 (+ 15c) | `lib/dashboard/account.ts`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `components/account/CommentActions.tsx`, `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` | — |
| 13 | Docs, final check | all | `docs/RUNBOOK_MODERATION.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/HANDOVER.md`, `docs/PROGRESS.md`, `docs/UI_STANDARDS.md`, `docs/META_SETUP.md` | — |

Run order: **wave A = 1, 2, 3, 4 · wave B = 5, 6 · wave C = 7, 8 · wave D = 9, 10, 11 · wave E = 12 · wave F = 13.** Tasks in one wave touch disjoint files. Each task leaves `main` green: the new modules are unused until Task 12 wires them (Task 8 wires the tick pass, which does nothing until the migration exists AND the owner switches auto-hide on; Task 6's alert kind needs its messages from Task 2, hence wave B). Tasks 10 and 11 take the server actions as PROPS (the page passes them, like `deleteSnapshot` in 15b), so they import only types from Task 7 and run beside Task 9.

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

<!-- PLAN CONTINUES -->
