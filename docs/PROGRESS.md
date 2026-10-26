# in2sight: progress update and handover (2026-10-23, updated 2026-10-26 for Plans 15c, 15d, 16a and 16b)

Written to hand the project to a fresh session (or computer). Read this first, then `CLAUDE.md` (rules), `docs/HANDOVER.md` (history and
older details), `docs/TODO.md` (checklist), `docs/SPEC.md` (design). When this file and an older paragraph elsewhere disagree, this file wins;
the older paragraphs are history.

## 1. What this is and where it lives
Private Instagram insights dashboard for ONE owner with several Instagram accounts (two connected today: `@yseny_`, `@penangclowns`).
Next.js (TypeScript, App Router) on Vercel, Supabase (Postgres + Auth + Storage). Sync is driven by an external caller hitting
`/api/cron/tick` every 30 minutes (cron-job.org). Owner access only (email + password + TOTP 2FA; sign-ups are disabled).

- Repo: https://github.com/YsYeoh/in2sight (`main`, linear history, about 520 commits). Pushing `main` auto-deploys on Vercel.
- Live: https://in2sight.yongsen.space. Supabase project ref `fwfbqlgxyrnxprxjzwhb`.
- Secrets are NOT in git. `.env.local` must be recreated from the owner (names in `.env.example`; `npm run check:env` validates names only).
- The Supabase MCP connector cannot see this project (it only sees two unrelated ones: never touch those). Use the CLI scripts in section 9.

## 2. State at a glance (2026-10-26)
| Item | State |
|---|---|
| Code on `origin/main` | everything through Plan 15d, including all review fixes and the security upgrade of 2026-10-25 (next and eslint-config-next 16.4.0 -> 16.4.3, puppeteer-core 25.11.0 -> 25.16.0) |
| `npm run check` | green on the final merged `main` before the push (2026-10-26): 269 test files, 2618 tests, lint, tsc, build |
| Live database | all 14 migrations applied (`migration list`: 14 local / 14 remote / 0 mismatched). Last applied: 15c `20261029000001` and 15d `20261029000002` (2026-10-26, applied in that order, then pushed). The anon probe answers 401 `42501` for the 3 `comment_*` functions and the 3 `moderation_*` tables (they exist, anon is denied) |
| Verified in a browser by the owner | **nothing from Plans 11b to 15d has been verified live yet** (see section 6). The owner glanced at the app and said it "looks good", no runbook was walked through. **Nothing has ever been sent to Instagram by Plan 15d** |
| Unpushed work | none (Plans 15c and 15d were pushed on 2026-10-26 after the migrations). **Auto-hide is OFF and must stay off until RUNBOOK_MODERATION §1 (probes P1-P8) has passed on a throwaway comment; each account must Reconnect once for the comments scope** |
| Plan 16a (Settings redesign) | **code complete on local `main`, NOT pushed, nothing verified live.** Its migration `20261030000001_prefs_auto_mode` (Auto theme mode) is **NOT applied**: apply only on the owner's go-ahead, BEFORE deploying; until then choosing Auto applies on the device and the profile save fails with a visible toast + Retry (`docs/RUNBOOK_SETTINGS.md` §0) |
| Plan 16b (Security) | **code complete on local `main`, NOT pushed, nothing verified live. NO migration.** Change password, forgot / reset password, sign out other devices. **Owner prerequisites first (code cannot do them; forgot / reset does not work without them):** custom SMTP in Supabase, Auth Site URL and Redirect URLs set to `https://in2sight.yongsen.space`, the Reset Password email template linking to `/auth/confirm?token_hash=...&type=recovery` (one bilingual template), email rate limit 10 per hour, minimum password length 12, sign-ups kept off (`docs/RUNBOOK_SECURITY.md` §0) |
| Open agents / worktrees | none expected after the 15c merge; check `git worktree list` and remove leftovers (section 10) |

## 3. What is built (all merged and pushed, except Plans 16a and 16b: local `main` only)
Each line: plan, what it gives, where to read more.
- **1 to 10 (2026-10-13 to 10-20): the product core.** Foundation (tokens, themes, prefs, i18n en + zh-CN, `lib/format.ts`), UI kit, auth + TOTP 2FA,
  Instagram connect (OAuth, tokens service-role only), sync engine (30-minute tick, leases, backfill, Stories, media metrics, audience), analysis +
  Overview, account detail (tabs, globe, Tags, Calendar), alerts + Web Push + PWA, Excel and PDF exports, loading feedback (Insight Orb, skeletons, Server-Timing).
- **11a/11b: onboarding sync and data capture v2.** Newest-first progressive backfill with live progress; Story extras, per-media extras, 7-day checkpoints,
  covers into a private Storage bucket, comments ingested read-only, raw API archive. Runbooks: `RUNBOOK_SYNC`, `RUNBOOK_CAPTURE`.
- **12a: Time Scope.** One shared range filter (presets, custom, week/month/quarter, compare, granularity) in the URL. `RUNBOOK_TIMESCOPE`.
- **12b: Explorer.** Whitelisted metric/dimension registry, SQL rollups, saved views, drill-down, Excel export. `RUNBOOK_EXPLORER`.
- **13a/13b: covers UI and Post Lab.** Cover thumbnails, grid/table, drawers, Stories filmstrip; per-post/Story page with scorecard, verdict, velocity,
  caption lab, Story funnel. `RUNBOOK_COVERS`, `RUNBOOK_POSTLAB`.
- **14a: UI foundation (the owner's polish request).** One control height, thin themed scrollbar, underline tabs, full-word range labels
  (Last 7/14/30 Days + "More ranges"), `RangeBar`, `FilterToolbar` (Advanced button, chips), Explorer as a toolbar, Audience merged into Overview,
  written standard `docs/UI_STANDARDS.md` with guard tests (`tests/ui-standards.test.ts`).
- **14b: Posts and Stories lists.** Own filters (search, posted date, format, tag, sort), All time newest first, real pagination, SQL
  `post_list` / `story_list`; the 200-Stories cap is gone on the migrated path. `RUNBOOK_LISTS`.
- **14c: app-shell tabs.** Browser-style tabs in the header (sidebar kept), each tab a kept-alive iframe; per-tab Back/Forward; phone "Tabs" sheet.
  `RUNBOOK_TABS` (Gate B). Architecture in section 4.
- **15a: Growth tab.** Followers curve with projection (method and confidence stated), follow flow, loyalty vs discovery, demographic changes,
  "Why did this change?" with unusual-day detection. No migration. `RUNBOOK_GROWTH`.
- **15b: Followers tab.** Upload of the owner's Instagram export (parsed on the device), snapshots, five diff lists by name, Excel export of a list.
  `RUNBOOK_FOLLOWERS`.
- **15c: Comments tab (read-only; local `main`, NOT pushed, nothing verified live).** All comments (search, comment date, post, pages), unanswered questions (rule-based),
  fans (top / new / gone quiet), topics (en + zh, no AI), commenters who don't follow you (newest follower export). Migration `20261029000001` APPLIED to the live database on 2026-10-26 (older wording: NOT applied)
  (it also rewrites the `comments_owner_select` RLS policy into InitPlan form). `RUNBOOK_COMMENTS`.
- **15d: comment moderation (local `main`, NOT pushed, nothing verified live, NOTHING has ever been sent to Instagram by it).** Reply / hide / unhide / delete from a menu on each comment (a confirm for each;
  delete needs a typed word), banned-word and spam rules with a live preview, an auto-hide pass in the sync tick (OFF by default), a moderation log with Undo, a `moderation_paused` alert,
  and the **Moderation** tab. Migration `20261029000002` APPLIED to the live database on 2026-10-26 (older wording: NOT applied) (needs 15c's first or together). `RUNBOOK_MODERATION` (probes P1-P8 first). Plan:
  `docs/superpowers/plans/2026-10-29-15d-comment-moderation.md`. It does NOT read thread replies or Instagram's hidden flag (follow-up after probe P5).
  Watch: the auto-hide pass runs up to 50 s into a tick limited to 60 s (35 s sync + 10 s alerts + 5 s auto-hide): after enabling it, look at Server-Timing and the `sync_runs` durations.
- **16a: Settings redesign (shell, sections, save model; local `main`, NOT pushed, NOT verified live).** `/settings/<section>` (`/settings` redirects to `/settings/appearance`; old `?tab=` names redirect): **appearance**
  (theme, light / dark / auto, density, corners, live preview), **language** (language, formats with samples, timezone explanation), **notifications** (this device, test push to this device only, alert rules with a
  sticky save bar, devices list with remove), **accounts** (overview with Sync now / Reconnect; management stays on `/accounts`), **security** (email, 2FA, and since Plan 16b change password and sign out other devices) and **data** (placeholder until Plan 16c).
  Desktop = left section list, phone = a "Section" select. One save model (UI standard 18): preferences instant with a "Saved" toast or an error toast with Retry (`PrefsProvider` no longer swallows errors),
  forms explicit with dirty tracking, `SaveBar` and an unsaved-changes guard. Migration `20261030000001_prefs_auto_mode` (Auto mode) NOT applied (owner applies before deploying). Runbook: `RUNBOOK_SETTINGS`.
  Plan: `docs/superpowers/plans/2026-10-30-16a-settings-shell.md`; Plan 16b (`2026-10-30-16b-security.md`) replaces `SecuritySection.tsx`.
- **16b: Security (code done on local `main`, NOT pushed, NOT verified live; no migration).** Change password (Settings → Security: current + new + confirm, strength meter, show / hide; the current password is re-checked on a
  separate memory-only client, then every OTHER session is signed out), forgot / reset password (login page link → `/login/forgot` → Supabase recovery email → `/auth/confirm` "Continue" (POST) → the existing 2FA step → `/login/reset`
  within 15 minutes → every session signed out → `/login`), and one "Sign out other devices" button (Supabase has no API to list sessions, so there is no session list). Needs the owner's Supabase settings first
  (`RUNBOOK_SECURITY` §0). Plan: `docs/superpowers/plans/2026-10-30-16b-security.md`. Guard: `tests/auth-security-guard.test.ts`.
  Opus security review (no Critical): the "current password" check and "code before a new password" are enforced by OUR server actions only; a session token can call Supabase Auth directly (SSR cookie is JS-readable),
  so they are UI-level protection, not a Supabase boundary. Data stays behind `is_owner()` (aal2) either way. **Before enabling the reset template: enrol 2FA, and run `RUNBOOK_SECURITY` §7 (L10 `PUT /user` and L11 `POST /factors` at aal1 must be refused; if L11 is allowed, do NOT enable it).**

Account page tabs now: **Overview, Growth, Posts, Stories, Comments, Moderation, Followers** (the range bar shows on Overview and Growth only; list pages have their own filters).

## 4. Architecture notes a new session needs
- **Pages = wiring, logic in `lib/`.** Analysis is pure functions in `lib/analysis/` with Vitest tests. Reads use the OWNER session (RLS); the
  service role is server-only and used by sync. `account_tokens` is service-role only.
- **Metrics registry:** `lib/metrics.ts` (a new metric = one entry). Meta metric names live only in `lib/instagram/metrics.ts` (re-verify against
  Meta docs when touching them).
- **URL is the state** everywhere (Time Scope params `from,to,cmp,cfrom,cto,gran`; list params `pr/pfrom/pto,q,format,tag,sort,page`; `tab`, `view`).
- **Migrations:** SQL files only, RLS on every table, `security invoker` functions, new file for every change (applied ones are never edited). Code
  must degrade gracefully when a newer migration is missing (the 14b/15b readers return null and the UI shows "needs a database update").
- **Shell tabs (14c):** the top-level document is the shell plus a `TabHost`; each tab is a same-origin `<iframe>`, hidden when inactive (8 live
  frames, 3 on touch). A framed page renders chromeless (the layout reads `Sec-Fetch-Dest: iframe`; the client `isFramed()` wins after hydration).
  Frames talk to the shell by validated `postMessage` (`lib/tabs/protocol.ts`; origin AND sender checked; URLs normalised by `tabUrl`). Non-tab
  pages (`/login`, `/setup`, `/auth/*`, reports, Instagram connect links with `target="_top"`) break out to the top window
  (`components/shared/FrameBreakout.tsx`). `frame-ancestors 'self'` is set in `next.config.ts`; the service worker leaves iframe navigations alone.
  The tab model is a pure reducer (`lib/tabs/model.ts`). If the tabs fail the live check, `git revert` the 14c commits (shell, root layout,
  `next.config.ts`, `public/sw.js`, `NavigationProgress`, new files only; no data).
- **UI standards** (`docs/UI_STANDARDS.md`, rules 1 to 18 plus guard tests; rule 17: writes to Instagram are confirmed, logged and reversible where possible; rule 18: settings save instantly with a toast and Retry, or explicitly with a save bar, never silently): one control height per row, `FilterToolbar` for every filter UI,
  `RangeBar` only on trend pages, underline tabs for sections, scrollbar only via `styles/scrollbar.css`, no abbreviated range labels, tokens only.

## 5. Migrations (all applied to the live database, except the last row; Plan 16b adds NONE: nothing is stored, the attempt counters are cookies and the sessions live in Supabase Auth)
| File | Content |
|---|---|
| 20261014000001_owner_and_profiles | owner claim, profiles, RLS helpers (`is_owner()`) |
| 20261014000002_accounts | accounts, tokens (service-role only), Meta callbacks |
| 20261015000001_sync | sync tables, leases, daily/media/audience snapshots |
| 20261017000001_tags | tags and media tags |
| 20261018000001_alerts | alerts, notifications, push subscriptions |
| 20261019000001_capture_v2 | follower snapshots, daily breakdown by follow type x format |
| 20261021000001_sync_progress | onboarding progress |
| 20261022000001_capture_v2b | scopes, capabilities, covers bucket, comments, children, raw archive |
| 20261024000001_explorer | explorer rollup functions, RLS InitPlan rewrite, saved views |
| 20261026000001_post_lab | `post_lab_latest`, `post_lab_points` |
| 20261027000001_post_story_lists | `post_list`, `story_list` (filter, sort, page, count; Story finals) |
| 20261028000002_follower_exports | `follower_exports` (owner-uploaded follower/following snapshots, RLS, cascade) |
| 20261029000001_comment_insights | `comment_list`, `comment_fans`, `comment_outsiders` and the `comments_owner_select` policy rewritten into InitPlan form (written and tested as of Plan 15c; **APPLIED to the live database on 2026-10-26 (older wording: NOT applied)**: owner go-ahead, apply BEFORE deploying, and BEFORE (or together with) the next row; `docs/RUNBOOK_COMMENTS.md` §0) |
| 20261029000002_comment_moderation | `moderation_settings`, `moderation_rules`, `moderation_log` (RLS, cascade from `accounts`) , owner update (`hidden` only)/delete on `comments`, and `moderation_paused` added to the `notifications` kind check (written and tested as of Plan 15d; **APPLIED to the live database on 2026-10-26 (older wording: NOT applied)**: owner go-ahead, apply BEFORE deploying the 15d code and AFTER (or together with) `20261029000001`; `docs/RUNBOOK_MODERATION.md` §0) |
| 20261030000001_prefs_auto_mode | `profiles.mode` CHECK list gains `'auto'` (Plan 16a; **NOT applied**: owner go-ahead, apply BEFORE deploying; `docs/RUNBOOK_SETTINGS.md` §0) |

## 6. NOT verified live: the owner's live checks (do these together, in this order)
Nothing below has been tried in a browser with real data. An assistant cannot do these alone (login with 2FA, real Instagram data); do them with
the owner. Each runbook lists exact steps.
1. **`docs/RUNBOOK_TABS.md` §1 to §3 (Gate B) FIRST.** The tabs change how EVERY page renders. Switching keeps state, login break-out, memory with real pages
   (about 150 MB per tab target), `Sec-Fetch-Dest` arriving on Vercel, Instagram Connect from the Accounts page inside a tab, Alt+Left once in the strip,
   double-click Back. If it fails: revert 14c (section 4).
2. **`docs/RUNBOOK_GROWTH.md` §2** (the Instagram follows/unfollows mapping is marked uncertain in `lib/instagram/metrics.ts`: check before trusting the
   follow-flow numbers), then §1, §3 to §7.
3. **`docs/RUNBOOK_FOLLOWERS.md` §2** with a REAL Instagram export file (folder names, file names, JSON shapes in the upload guide are assumptions
   until a real file passes; the runbook has a command that prints only the file structure, never names), then the privacy checks.
4. **`docs/RUNBOOK_COMMENTS.md` (Plan 15c), then `docs/RUNBOOK_MODERATION.md` (Plan 15d).** §0 first: apply the migration `20261029000001` ONLY on the owner's go-ahead and BEFORE deploying the 15c code (it also rewrites one
   existing RLS policy on `comments`); then §1 Reconnect each account once for the comments scope, §2 a real comment from another account (the gate), then §3 to §6.
   Report only yes/no and counts: commenter names and texts are third-party data.
   **Then `docs/RUNBOOK_MODERATION.md`, probes first. WARNING: this WRITES to the owner's real Instagram accounts (replies are posted, comments hidden or deleted); nothing from it has ever been sent to Instagram.**
   §0 apply migration `20261029000002` (after or together with `20261029000001`, owner's go-ahead, BEFORE deploying), Reconnect each account once for the comments scope, then **§1 probes P1-P8
   on a throwaway comment of the owner's own test post** (writes allowed, write rate limits, hiding twice, hidden flag on reads, replies in `comments_count`, 2,200-character reply limit,
   form-encoded message, deleting a reply). Only after they pass: §2 layout, §3 rules and auto-hide (**auto-hide is OFF by default; do not switch it on before §1 has passed**), §4 failure
   handling (including the tick-duration watch: the auto-hide pass runs up to 50 s into a 60 s tick), §5 privacy.
5. `docs/RUNBOOK_LISTS.md` (includes a non-ASCII search to confirm the database matches case like the page does), `RUNBOOK_TIMESCOPE`, `RUNBOOK_COVERS`,
   `RUNBOOK_POSTLAB`, `RUNBOOK_EXPLORER` (Server-Timing at 1 and 2 years), `RUNBOOK_CAPTURE`.
6. Older owner items (`docs/OWNER_ACTIONS.md`): post a Story so the Story-extras probe can run; Reconnect both accounts once to grant the comments
   scope; PDF export on real Chromium; performance before/after table in `RUNBOOK_PERF`; set Supabase Auth Site URL to the real domain.
7. **`docs/RUNBOOK_SETTINGS.md`** (Plan 16a): §0 migration first (owner's go-ahead), then §1 to §6.
8. **`docs/RUNBOOK_SECURITY.md`** (Plan 16b): §0 the owner's Supabase settings FIRST (custom SMTP, Reset Password template, Site URL, minimum length 12, sign-ups off; a real inbox and a second device are needed), then §1 to §6:
   the reset email end to end, the recovery session sees no data before the TOTP code, wrong current password, the rate limits, link expiry and single use, the second device. Also answers the plan's unverified Supabase
   behaviours (Open questions): the `amr` method name of a recovery session (L2), the current-password check through a separate memory-only client (L1), and the JWT expiry (L7: other devices keep working up to 1 hour after
   "Sign out other devices", a change or a reset). Until these pass, do not rely on forgot / reset; the old way (assistant + Auth admin API) still works.
Record outcomes in the runbooks and TODO ("code done; live verification pending" becomes ticked only after the owner has looked).

## 7. What is left to build (priority order; the owner's order is data and analysis first, planning last)
Every item has an approved design in `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` (section numbers below). Per CLAUDE.md a design
change goes through `superpowers:brainstorming` and SPEC first; an item already in the approved spec goes straight to `superpowers:writing-plans`.
1. **Plans 15c and 15d are BUILT, not live (the next step is the owner's go-ahead, not code).** 15c (read-only Comments tab) and 15d (comment moderation: reply / hide / delete with confirms,
   banned-word and spam rules, auto-hide OFF by default, undo log) are on local `main`, NOT pushed, their migrations (`20261029000001`, then `20261029000002`) APPLIED to the live database on 2026-10-26 (older wording: NOT applied), nothing verified live and
   nothing ever sent to Instagram. Order: owner's go-ahead -> apply both migrations -> push/deploy -> Reconnect each account once -> RUNBOOK_COMMENTS -> RUNBOOK_MODERATION §1 probes P1-P8 on a
   throwaway comment -> only then consider switching auto-hide on, and watch the tick durations (section 3, 15d). Third-party personal data: owner-only, never logged, deleted with the account.
   **Follow-up (small, NOT started, needs its own plan): reading thread replies and Instagram's hidden flag** (adds fields to `COMMENT_FIELDS`; one unsupported field would fail the whole comments read, so it is
   probe-gated on P5). It makes "Unanswered questions" exact and shows hides done inside the Instagram app.
2. **Settings redesign + password** (spec §7, TODO "6b. Next"): sections with their own URLs and one consistent save model (**built in Plan 16a**, NOT pushed); **change password, forgot / reset password and "Sign out other devices" are built
   (Plan 16b)**, NOT pushed, NOT verified live, needing the owner's Supabase settings first (custom SMTP, template, Site URL: `RUNBOOK_SECURITY` §0). A real session list (device, last seen) is NOT possible without a service-role read of `auth.sessions`
   (Supabase has no API for it): not built. Still to build: storage / export all / delete all (Plan 16c).
3. **Weekly planning tools** (spec §6 "Content intelligence"): insights feed, leaderboards, format and time lab, cadence, hashtag lab, compare accounts,
   goals, planner board (no publishing to Instagram), weekly/monthly digest.
4. **Later:** weekly AI summary per account (use the `claude-api` skill), shareable report links (frozen snapshot, expiring token, spec §0b), "Today
   briefing" Overview, smart alerts with one daily digest, auto-tagging from hashtags.
5. **Pitch readiness (owner idea, NOT designed):** on 2026-10-22 the owner said they want to show the system to investors "about the overall idea"
   and asked to finish the TODO features first. The assistant's untested guess for later: a demo mode with realistic sample accounts (never show real
   people's names), a "Today briefing" screen, the Why-did-this-change and Growth views (built), the AI weekly summary, and a one-sentence story
   (who pays, what it saves). Brainstorm with the owner before building anything for this.
6. **Small leftovers** are in `docs/TODO.md` (look for "Known" bullets): weekday filter ignores the week-start setting; Overview comparison chart
   drill is mouse-only; breadcrumbs drop tag/weekday/hour filters; Stories/export "final numbers" still capped in the exports; carousel slides after
   the first have no covers; the Tags page and audience history do not follow the Time Scope; Explorer registry lacks engagement rate per followers
   (Post Lab has the toggle); skip-rate percentile reads raw although lower is better; focus after removing a filter chip; tab strip fade mask.

## 8. Decisions waiting on the owner (the recommended default is implemented in each case; the owner has accepted all defaults so far)
- 13: peers = 30/90 earlier posts of the format, guard 5, verdict on reach, "too early" before day 7, caption lab per format; covers: automatic view,
  4:5 tiles, 80-character drawer caption, no Calendar drawer.
- 14a: panels open as a dialog (bottom sheet on phones) rather than a popover; one-year preset reads "Last 12 months"; Posts/Stories interim (since replaced by 14b).
- 14b: eight sort orders, 50 per page in the automatic view, 7 days / 48 Stories per page, fallback before the migration (moot now), plain substring search.
- 14c: Back re-renders the earlier page (scroll resets, drawers close), titles from the page heading, "open in new tab" icon only on Overview account
  cards and Post Lab links, phone Back/Forward inside the Tabs sheet, stale after 30 minutes, 3 live tabs on touch devices.
- 15a: Growth is its own tab, no all-accounts roll-up on Overview, loyalty uses reach summed over formats, projection = median slope of the last 28 days
  (at least 14 days, low/medium confidence only), unusual day = same-weekday robust z >= 3.5 over 8 weeks (at least 4 samples), audience = first snapshot in
  range vs latest.
- 15b: 50,000 followers per export, no .zip upload (the owner unzips), recently-unfollowed and pending-request files ignored, no reminder push (a quiet
  line after 30 days), 60 snapshots per account, snapshot date picked in the dialog, renamed/deactivated accounts show as unfollowers.
- 15c: Comments as the fifth tab (before Followers), fan rules 3 / 2 in 30 days / 3 posts, "reply seen" derived from your own @mentions, no comment export, English question words at the start only, topics from the newest 1,000 comments of the range.
- 15d: auto-hide off by default and gated by the probes, at most 20 automatic hides per account per tick and 30 manual actions per minute, delete never automated and never undoable, Undo = unhide / delete the reply, built-in spam patterns (links, 4+ mentions, repeats, emoji floods) instead of owner-typed regexes, thread replies and the hidden flag NOT read in 15d (follow-up after probe P5), Moderation as its own tab between Comments and Followers.
- 16a: section ids appearance / language / notifications / accounts / security / data, phone section select, Auto mode with one migration, Accounts & sync as an overview (management on /accounts), devices list without a this-device mark, "Saved" toast on every preference change, guard only on reload and the settings nav.
- 16b: password minimum 12 characters (at most 72 bytes, 5 distinct, not the email name), cookie friction plus Supabase's own limits (no lockout table, no CAPTCHA, no breached-password check), a 15-minute window to set the password after the link, a reset signs out every device (sign in again with the new password), no session list (one "Sign out other devices" button), one bilingual reset email template, `/login/forgot` and `/auth/confirm` as the only new public paths.

## 9. How to work here
**Commands:** `npm run dev`, `npm test`, `npm run check` (lint + tsc + tests + build; must pass before anything is called done), `npm run check:env`.
**Method that worked (used for Plans 13 to 15b):**
1. Plan: an opus planner writes `docs/superpowers/plans/<date>-<plan>.md` incrementally (commits early), dry-runs it in a throwaway clone OUTSIDE the repo.
   Model it on `2026-10-27-14b-posts-stories-lists.md`. The plan has a task table (depends on / files owned / parallel with) and waves.
2. Build: one sonnet agent per task, each with `isolation: "worktree"`, prompt starting "First read docs/superpowers/implementer-rules.md and follow it exactly.
   YOUR TASK: Plan X Task N ... BASE SHA ... files you own ... running in parallel (do not touch their files) ...". Tasks of one wave touch disjoint files.
3. After each wave: `git cherry-pick <sha>...` the commits onto `main`, remove ALL worktrees (see pitfalls), `rm -rf .next`, run `npm run check > log` and READ the log.
4. After the last wave: an opus read-only whole-change review (brief it with focus lists like the earlier ones), then ONE fix wave by one sonnet agent, then check, commit.
5. Update TODO/SPEC/RUNBOOK/HANDOVER honestly ("code done; live verification pending").
**Migrations (needs the owner's explicit go-ahead; apply BEFORE deploying code that needs it):** the CLI is linked on the owner's machine. Use the scripts (they
keep secrets in the process environment and mask them in the output; never print `.env.local`):
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only the new file pending, nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs table:NAME rpc:NAME:'{"real_arg":1}'   # baseline: 404 PGRST205/PGRST202 = absent
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs ...             # after: 401 with code 42501 = exists, anon denied
```
**Commits and pushes:** do not commit or push unless the owner asks (CLAUDE.md). Commit messages end with the `Co-Authored-By` line from the harness. Never
force-push `main`. A push to `main` deploys to Vercel.
**Never:** run `npx shadcn init`; touch `turbopack.rules["*.css"]` in `next.config.ts`; print or log tokens/secrets; create external resources
(Supabase/Vercel/Meta changes) without explicit confirmation; read the live DB with the service-role key (the auto-mode classifier blocks it: the
owner, or the assistant with explicit permission, runs such queries).

## 10. Lessons learned (reuse them)
Process
- Parallel worktree agents take 30 to 40 minutes a round on this machine because five `npm ci` run at once. Do not run an opus review and a full check at
  the same time: vitest then prints "Failed to start forks worker / Timeout waiting for worker to respond". That is load, not a code failure: rerun on a
  quiet machine (or add `--pool=threads --no-file-parallelism`).
- Removing worktrees: `git worktree remove` is slow and can leave read-only files. In PowerShell: `git worktree unlock <dir>`, `attrib -r <dir>\* /s /d`,
  `rmdir /s /q <dir>`, then `git worktree prune` and `git branch -D worktree-agent-*`. Do it BEFORE the full check (eslint/vitest scan `.claude/worktrees`).
- After moving or adding routes, `rm -rf .next` before the check (stale `.next/types/validator.ts` fails `tsc`).
- A new worktree can start from an old commit: agents must `git merge --ff-only main` and verify the BASE SHA. Agents that hit the session rate limit keep their
  work: resume them with `SendMessage` after the reset instead of starting over; a planner's dry-run in a clone once deleted part of the real
  `node_modules` (`npm ci` restored it): planners must not symlink or delete the real one.
- The disk filled up (0 bytes free) when 5 agents ran `npm ci` at once (each worktree has about 1.5 GB of `node_modules`): run at most 3 agents at a time and check free space (`Get-PSDrive C`) before launching a wave.
- Leftover `bash.exe` processes of a finished agent can lock its worktree folder: find them by a command line containing the worktree name and stop only those PIDs, then remove the worktree.
- Read the log, never trust a wrapper's exit status (`cmd; echo exit=$?` reports echo's code). Never chain `git commit` after a piped command.
Technical
- Match whole class tokens in tests: a loose regex (`/after:bg-primary/`) passed on a typo with a missing space; three reviews found such Tailwind typos.
- Under vitest, `user-event` with fake timers needs `vi.stubGlobal('jest', { advanceTimersByTime: ... })` in `beforeEach`.
- When a prop is removed, grep the TESTS for it (the `keep` prop survived in one test and would have failed `tsc`).
- A key on a list component that changes with the URL remounts it and drops keyboard focus: sync local state from props in place instead.
- Guard tests pay off: `ui-standards.test.ts` caught a real violation (tab strip hiding its own scrollbar) on the first run after 14c.
- Docs are CRLF; messages JSON are edited by TEXT insertion only (hand-formatted, one stray CR); use the Write tool for files with backslashes/non-ASCII.
- jsdom 29 `Blob` has no `.stream()`: build `Response` bodies from strings in tests.
- Next.js 16.4 refuses to BUILD on a version with a published security advisory ("SecurityFatalError"), which makes `npm run check` fail even though nothing in our code changed. Found 2026-10-25: Next 16.0.0-16.4.0 was critical (image optimizer RCE with SVG, Server Actions DoS, `use cache` RCE); fixed by the pinned bump to 16.4.3 (+ `eslint-config-next` 16.4.3, `puppeteer-core` 25.16.0). Run `npm audit --omit=dev` now and then; keep every pin exact; `eslint-config-next` tracks the Next version. Do not run the build tool's own `next upgrade --agent=...` suggestion: verify with `npm audit` and bump the pins by hand.
- PostgREST caps EVERY response at 1,000 rows regardless of `.limit()`. The 15d safety review found that the 'never re-hide a comment the owner unhid' memory (log rows) silently fell out of the newest 1,000 after about a day of auto-hiding: read per-candidate (`.in('comment_id', chunk of 100)`), never by a big scan. Any 'has this id been seen before' check must be keyed by the ids, not by recency.
- Moderation log known limits (15d, unapplied migration): `target_id` and a finished, not-yet-undone row's `result` stay editable by the OWNER session (finishing a reply writes the reply id; closing it needs a trigger, deliberately not added: single-owner app, stolen-session risk only).
- Meta returns error 100/33 both for 'does not exist' and for 'cannot be loaded / unsupported operation': never treat it as 'comment gone' (it is `not_allowed`; the local row is kept).
- Rolling-window analytics: leave today's partial day and the unsettled days out of anomaly scans; unknown is `null`, never 0; compare posts of the same age.

## 11. Security and privacy (do not weaken)
- Owner-only everywhere; `requireOwner()` for pages and server actions, `assertOwner(headers)` first in route handlers. Public routes are exact-path
  exemptions in `lib/auth/route-policy.ts` (Meta callbacks, cron tick with `CRON_SECRET`, offline/manifest/sw). New routes are NOT public.
- Third-party personal data (commenter names, follower snapshots): owner-only RLS, never logged, never in `sync_runs`, deleted with the account
  (`ON DELETE CASCADE`), not exported unless the owner chooses. The follower search text travels in the URL (`?q=`) and therefore appears in request logs.
- Writes to Instagram (Plan 15d): owner-only server actions; the `moderation_log` row is written BEFORE the call and holds ids and result keys only (no comment text, names or tokens); the reply text is not stored;
  automation never deletes; auto-hide is off until the owner has run the probes.
- Auth (Plan 16b): the only new signed-out paths are the exact `/login/forgot` and `/auth/confirm`; `/login/reset` has no exemption (owner + aal2 + a fresh recovery claim on the page AND the action); the forgot answer is identical for every valid email (2 s floor, no account lookup); no `next` / `redirectTo` parameter anywhere and only literal redirect targets; no logging in the auth files; no service role in any auth flow; the current-password check client keeps nothing; passwords only in server-action POST bodies, never returned or logged (`tests/auth-security-guard.test.ts` enforces most of this).
- Uploads: size cap enforced before parsing and while streaming, strict shape validation, error KEYS only, Origin check; the server never trusts the client's parse.
- No Instagram follower/unfollower names, viewers, or visitors exist in any official API, and scraping/crawling was declined (breaches Meta terms): the
  export upload is the only by-name route. History before the connect day cannot be recovered.

## 12. Where things are
`docs/SPEC.md` (design), `docs/TODO.md` (checklist, sections 6c to 6p are the recent work), `docs/HANDOVER.md` (history), `docs/UI_STANDARDS.md`,
`docs/RUNBOOK_*.md` (live checks), `docs/OWNER_ACTIONS.md`, `docs/META_SETUP.md`, `docs/META_PROBE_RESULTS.md`,
`docs/superpowers/specs/` (approved designs: creator toolkit; UX polish and tabs), `docs/superpowers/plans/` (every plan, task by task, with its dry-run notes),
`docs/superpowers/implementer-rules.md` (the rules each implementer agent follows), `scripts/` (`sb.mjs`, `db-probe.mjs`, `check-env.mjs`, fixtures recorder).
