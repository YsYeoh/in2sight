# in2sight — TODO

> **NEXT UP (2026-10-23; full picture in [PROGRESS.md](PROGRESS.md)).** Plans 1 to 15b are built, pushed, and all 12 migrations are applied. Nothing from Plans 11b to 15b is verified live yet.
> 1. Owner live checks, in this order: RUNBOOK_TABS §1-§3 (Gate B) -> RUNBOOK_GROWTH §2 -> RUNBOOK_FOLLOWERS §2 (real export file) -> RUNBOOK_LISTS, TIMESCOPE, COVERS, POSTLAB, EXPLORER, CAPTURE (PROGRESS §6).
> 2. Build next, in the owner's order: Plan 15c comments, fans and moderation -> Settings redesign + change/forgot password -> weekly planning tools -> later items (AI summary, report links, Today briefing, auto-tagging) (PROGRESS §7).
> 3. Owner idea, not designed: make the product impressive for investors (demo mode with sample data, Today briefing): brainstorm first (PROGRESS §7.5).

Status: all roadmap plans 1–9 built and live on https://in2sight.yongsen.space; Supabase migrations applied (5/5); cron-job.org tick configured. Now building the creator toolkit (docs/superpowers/specs/2026-10-15-creator-toolkit-design.md): Plan 10 loading → 11 covers → 12 Post Lab → 13 toolkit → 14 settings. "code done; live verification pending" means the owner still has to look at it on the deployed site. Check items off as done.

## 0. Owner actions (Claude can't do these)
- [x] Convert each Instagram account to **Creator** (Settings → Account type and tools → Switch to professional account)
- [x] Create a Meta developer account at developers.facebook.com (free; phone verification)
- [x] Create a Meta app, add the **Instagram** product → "API setup with Instagram login"
- [x] Add each account as **Instagram Tester**, accept the invite in each account (Settings → Apps and websites → Tester invites)
- [x] Deploy to Vercel, create the Supabase project, fill `.env.local`, run `npm run check:env` — follow `docs/SETUP.md` and `docs/SETUP_SUPABASE.md`
- [x] Approve `docs/SPEC.md` (done 2026-10-13)

See `docs/META_SETUP.md` for click-by-click notes.

## 1. Foundation
- [x] Next.js (TS, App Router) scaffold
- [x] Deploy to Vercel (done by owner, live at https://in2sight.yongsen.space)
- [x] Supabase migrations: all tables + RLS (5 migrations applied to the live project 2026-10-14/15 via `npx supabase db push`; local and remote lists match)
- [x] Supabase Auth: single owner login (sign-ups disabled); middleware guards all pages (code done; live verification pending — docs/RUNBOOK_AUTH.md)
- [x] 2FA: TOTP enroll/verify UI in Settings → Account; middleware enforces AAL2 once enrolled (code done; live verification pending — docs/RUNBOOK_AUTH.md)
- [x] `profiles` table: language, timezone, date/time/number format, week start, theme, density, radius (code done; live verification pending — docs/RUNBOOK_AUTH.md)

## 2. Connect accounts
- [x] `lib/instagram.ts`: authorize URL, code→token, long-lived exchange, refresh (lives in `lib/instagram/oauth.ts`; the refresh job itself is Plan 5) (code done; live verification pending — docs/RUNBOOK_META.md)
- [x] `/accounts` page + OAuth callback route (code done; live verification pending — docs/RUNBOOK_META.md)
- [ ] Verify with 1 real account, then connect all

## 3. Sync
- [x] Verify current metric names (feed, Reels, **Stories**) vs Meta docs; put in one constants file (`lib/instagram/metrics.ts`; UNCERTAIN items re-verified live by `npm run record:fixtures` — docs/RUNBOOK_SYNC.md §3)
- [x] `/api/cron/tick` every 30 min: Stories every tick, post metrics hourly (<48h) / daily (<30d), account day + audience daily, token refresh (code done; live verification pending — docs/RUNBOOK_SYNC.md)
- [x] Scheduler (owner confirmed configured): cron-job.org calling `/api/cron/tick` every 30 min with `Authorization: Bearer CRON_SECRET` (owner — docs/RUNBOOK_SYNC.md §5; pg_cron/pg_net fallback §6)
- [x] Per-account error isolation + `needs_reconnect` flag
- [ ] **Start daily snapshots as early as possible** — account insights only reach back ~90 days
- [x] First-connect backfill (90d account insights + up to 500 media with lifetime metrics) (code done; live verification pending — docs/RUNBOOK_SYNC.md)
- [x] Accounts page: last synced, sync error, Sync now (code done; live verification pending — docs/RUNBOOK_SYNC.md)
- [x] Applied migration `20261015000001_sync.sql` (`npx supabase db push`; on the owner's go-ahead — docs/RUNBOOK_SYNC.md §0)
- [ ] Record real Instagram fixtures (docs/RUNBOOK_SYNC.md §4)
- [x] Archive / restore / permanent-delete for accounts (code done; live verification pending — docs/RUNBOOK_META.md)

## 3b. Alerts
- [x] Plan 8 written: `docs/superpowers/plans/2026-10-18-08-alerts-pwa.md`
- [x] Rule evaluation after each sync (token expiring, needs reconnect, sync failing, reach drop, post taking off) with dedupe keys (code done; live verification pending — docs/RUNBOOK_ALERTS.md)
- [x] `notifications` table + bell/notification centre UI (code done; live verification pending — docs/RUNBOOK_ALERTS.md)
- [x] Web Push: `push_subscriptions`, `web-push` sender, subscribe/unsubscribe in Settings, per-type toggles + thresholds (code done; no push has been sent to a real device yet — docs/RUNBOOK_ALERTS.md §2–4)
- [x] VAPID keys in `.env.local` and Vercel (done; owner — docs/RUNBOOK_ALERTS.md §1)
- [x] Applied migration `20261018000001_alerts.sql` (`npx supabase db push`; on the owner's go-ahead, BEFORE the deployed code runs a tick — docs/RUNBOOK_ALERTS.md §0)

## 3c. Exports
- [x] Plan 9 written: `docs/superpowers/plans/2026-10-19-09-exports.md`
- [x] `/api/export/xlsx` (write-excel-file) with the six sheets, user date format, localized headers (code done; live verification pending — not yet opened in Excel/LibreOffice with real data — docs/RUNBOOK_EXPORTS.md §1)
- [x] Report page (Overview + per account) with section options; print CSS for A4 (code done; live verification pending — preview not yet viewed with real data — docs/RUNBOOK_EXPORTS.md §2)
- [x] `/api/export/pdf` (puppeteer-core + @sparticuz/chromium), bundled Noto Sans SC; report data handed to Chromium over the DevTools protocol instead of a signed token (owner decision in Plan 9) (code done; live verification pending — Chromium has never run, tests use a fake browser — docs/RUNBOOK_EXPORTS.md §3)

## 4. Analysis
- [x] Plan 6 part 1 (analysis + Overview) written: `docs/superpowers/plans/2026-10-16-06-analysis-overview.md` (part 1 implemented; part 2 pending)
- [x] `lib/analysis`: growth, top posts, format comparison, best-time heatmap, per-tag (tags arrive in Plan 6 part 2), flags (+ vitest) (Plan 6 part 1)
- [x] Plan 7 (account detail, tags, calendar = Plan 6 part 2) written and implemented: `docs/superpowers/plans/2026-10-17-07-account-detail.md`

## 5. UI foundation (before pages)
- [x] Tailwind + shadcn/ui, FormField/PageHeader/EmptyState/ResponsiveDialog/AppShell (Plan 2)
- [x] DataTable, StatCard, ChartCard (Plan 6)
- [x] /styleguide gallery: primitives (Plan 2); stat cards, charts, heatmap, data table (Plan 6) — code done; visual matrix pending in docs/RUNBOOK_DASHBOARDS.md
- [x] Theme tokens + 4 themes (Ink, Sunset, Forest, Mono) × light/dark; radius presets; text-contrast test (chart colours are checked visually in the styleguide)
- [x] next-intl with en + zh-CN, key/placeholder parity test, language switcher (PrefsBar)
- [x] `lib/format.ts` (date/time/number per user settings)
- [x] `lib/metrics.ts` registry (Plan 6)
- [x] Responsive shell: bottom tab bar / icon rail / sidebar; bottom-sheet dialogs; touch targets (dialog close X is 16px — known gap)
- [x] DataTable card mode (Plan 6)
- [x] Motion gating helper (`lib/motion.ts`: reduced-motion, coarse pointer, Save-Data) (Plan 6)
- [x] PWA: manifest, icons, service worker (static + offline page only), install prompt (code done; not yet installed on a real phone — docs/RUNBOOK_ALERTS.md §3, §7)

## 6. UI pages (use `frontend-design`)
- [x] Overview (grouped cards, totals, comparison, Time Scope bar since Plan 12a) — code done; visual verification with real data pending (docs/RUNBOOK_DASHBOARDS.md, docs/RUNBOOK_TIMESCOPE.md)
- [x] Account detail (Overview / Posts / Stories / Audience with globe), Tags page, Calendar (Plan 7) — code done; the tags migration and visual verification with real data pending (the globe and the new pages have not been viewed in a browser yet; docs/RUNBOOK_DASHBOARDS.md §4)
- [x] Applied migration `20261017000001_tags.sql` (`npx supabase db push`; on the owner's go-ahead, BEFORE the deployed code is used — docs/RUNBOOK_DASHBOARDS.md §4.0)

## 6b. Loading feedback and speed (Plan 10)
- [x] Insight Orb loader, top progress bar, inline pending orb on nav items and buttons, Sync now status line — code + tests done; not yet seen on the deployed site (docs/RUNBOOK_PERF.md §2–3)
- [x] Page-shaped `loading.tsx` for every route (test-enforced), account tab streamed in Suspense, notification bell streamed — code done; streaming not yet observed live (docs/RUNBOOK_PERF.md §4)
- [x] One owner check per request (React.cache, parallel RPC), per-request accounts/sync-status reads, `Server-Timing` from the proxy — code done
- [ ] Measure before/after on production and fill docs/RUNBOOK_PERF.md §5 (owner, signed in)

## 6a. Onboarding sync — BUG + feature (owner, 2026-10-16) — do early (Plan 11)
- [x] **FIXED 2026-10-16 (code; verify on the next connect): connecting/reconnecting an account now syncs it immediately** (`lib/sync/connect-sync.ts`, called from the OAuth callback via `after()`, then continues through the chain). Original report: **connecting a new account does not start a sync.** Today the first data appears only at the next cron tick (up to 30 min), and the 90-day backfill then needs several ticks (35 s budget each; observed 3–5 runs) so a new account looks empty for 1–2 h with no explanation. Fix: the OAuth callback (and reconnect) must trigger an immediate sync of THAT account (mark it due + run it in `after()`), and while a backfill has work left the app keeps going without waiting 30 min (e.g. the progress page triggers the next pass via the existing owner-only sync action, or the run re-schedules itself), still inside the per-account lease and call budget.
- [x] **Sync progress experience (professional UX).** _(Plan 11a: code done; live verification pending — docs/RUNBOOK_SYNC.md §8. Not built yet: bell/push notification on completion; "Cover images" and "Comments" are reserved stage names for later plans.)_ After adding an account, show a progress panel (and a compact badge on every account row/card and on Overview while syncing):
  - overall % and a stage checklist with live state: Profile → Account metrics (e.g. "48 / 90 days") → Post list → Post metrics ("12 / 42 posts") → Stories → Audience → Cover images → Comments; each stage pending / running (Insight Orb) / done / skipped (with reason) / failed (with a plain-language reason and Retry);
  - what it is doing right now ("Pulling reach for 12 Aug…"), time elapsed and an honest estimate ("usually 5–10 minutes; you can leave this page, we will notify you");
  - survives reloads and closing the tab (progress is server state, not client state); polls every 2–3 s while visible (or Supabase Realtime), stops when done;
  - rate-limit and error states explained ("Instagram asked us to slow down; resuming in ~12 min"), never a silent stall; needs-reconnect state links to Reconnect;
  - completion: summary ("Imported 90 days, 42 posts, 3 Stories, audience data"), bell/push notification, "Open dashboard" button;
  - requires per-stage progress counters written by the sync runners (new table/columns, e.g. `sync_progress`: account_id, stage, done, total, state, detail_key, updated_at; append-only run log kept), i18n en/zh-CN, a11y live region, works on desktop first and on phone;
  - applies equally to reconnect and to "Sync now".
- [x] **Progressive backfill: newest first, fastest value first (owner, 2026-10-16).** _(Plan 11a: code done; live verification pending. Backward edge `sync_state.backfilled_from`; Overview shows "Importing history… · N%" with real partial numbers. Deliberately skipped: the 90-day `time_series` reach call — one path, resumable per day; revisit only if Meta's rate limit bites. Covers/comments steps arrive with their plans.)_ Today the 90-day backfill walks oldest → newest (`daily_done_through` is a forward cursor), so Overview stays blank until the last ticks. New order of work per new account, each step visible in Overview as soon as it lands:
  1. profile + current follower count (1 call) → the account card appears with followers;
  2. last 7 days of account metrics (newest day first) → KPIs + 7-day sparkline;
  3. post list + metrics for the newest ~10 posts → top posts / formats start to fill;
  4. live Stories now, audience snapshot;
  5. days 8–30, then 31–90 in newest → oldest chunks; then older post metrics (newest first), cover images, comments;
  6. use `time_series` multi-day calls where Meta allows (reach: one 90-day call verified) to cut the call count; per-day `total_value` calls only for the rest.
  Needs: a backward-moving coverage cursor (e.g. `backfilled_from` + coverage ranges) instead of `daily_done_through`; analysis and UI must handle partial coverage (growth windows with gaps show "importing older history", cards show coverage %, never fake zeros or drops); the sync progress panel reflects this order; tests that a half-finished backfill renders sensible Overview numbers.
- [x] **Chain continuation DONE 2026-10-16** (`lib/sync/chain.ts`, `app/api/cron/tick/route.ts`, `TickSummary.more`; tests/cron-tick-chain.test.ts): a pass that stops on its time budget with work left starts the next pass itself (same origin, same secret, depth-capped at 10, never when Meta throttled the app). Still open from this item: (b) fair lanes, (c) fair slicing, (d) per-stage progress in `sync_runs.summary`.
- [x] **Chain continuation + fair lanes (remaining parts b–d) (found by debugging account 2, 2026-10-16).** _(Plan 11a: (b) lanes and (c) equal slices done in `lib/sync/tick.ts`; (d) per-stage progress lives in `sync_progress` (live) + `sync_state` (coverage) instead of `sync_runs.summary`. Code done; live verification pending.)_ Evidence: A2 connected 06:43 UTC; manual pass 06:56 (37 s, stopped early), cron 07:00 (39 s, stopped early, 0 jobs completed), manual 07:18 finished everything with 0 failures — i.e. nothing crashed; each pass just hit the 35 s budget and the next pass waited up to 30 min. Fixes: (a) when a tick stops early with due work left, it must trigger a continuation pass right away (self-call of `/api/cron/tick` via `after()`, authenticated with `CRON_SECRET`, bounded chain depth ~10, respects leases so passes never overlap); (b) separate lanes so a new account's backfill can never starve regular jobs (Stories, recent post metrics) of existing accounts — regular lane first with its own small budget, then backfill lane; (c) fair slicing across accounts when several are backfilling; (d) `sync_runs.summary` should record progress per stage (days done/total, posts done/total) so the progress panel and debugging don't have to infer it.
- Since Plan 11a no workaround is needed: the import chains by itself and the panel shows it; **Retry** on the panel (= Sync now) restarts a stalled import.

## 6c. Data Capture v2 progress
- [x] **Follower / following / media counts every tick** (`follower_snapshots`, written by the Stories job; migration 20261019000001 applied 2026-10-16) — intraday follower curve accumulates from now; UI comes later (Plan 14).
- [x] **Daily reach + views by follower type × format** (`account_daily_breakdown`; written by the daily job incl. backfill; combined breakdown verified live) — non-follower share of Stories/Reels/feed accumulates from now; UI later.
- [x] One-off backfill of `account_daily_breakdown` for the last 89 days done 2026-10-16 for both accounts (1,221 rows, 0 errors); from here the daily job keeps it current (it re-fetches the last 3 days once a day after 06:00 local).
- [x] **Story extras** _(Plan 11b: code done; live verification pending — docs/RUNBOOK_CAPTURE.md §3 "post a Story and run a probe")_: SWIPE_FORWARD kept (`media_metrics.swipe_forward`); `follows`, `profile_visits`, `profile_activity` each in a SEPARATE non-fatal call after the core Story snapshot, every 2 h of a Story's life + its last hour; support learned at runtime (`sync_state.capabilities`), never assumed.
- [x] **Per-media extras** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §4)_: feed/carousel follows + profile visits + profile activity, Reels avg/total watch time + skip rate, separate non-fatal calls after the core loop, 20 extra calls per account run, + the 7-day checkpoint snapshot.
- [x] **Media fields** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §5)_: `media_product_type`, `like_count`, `comments_count`, `is_shared_to_feed`, `children_count` + `media_children`.
- [x] **Cover capture** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §6)_: private bucket `covers`, Stories on first sight, posts/Reels backfilled newest first in lane 2 after the import, CDN allowlist/size/type/timeout, owner-only `GET /api/media/[id]/cover`, permanent delete removes the objects. `MediaThumb` UI: Plan 13a (§6f). Not yet: carousel child covers.
- [x] **Comments ingestion** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §1 + §7; **each account must Reconnect once** to grant `instagram_business_manage_comments`)_: read only, gated on the scope stored at connect (`accounts.granted_scopes`), incremental by comment count, recent 30 days. Not yet: replies, hidden flag, moderation.
- [x] **Raw API response archive** _(Plan 11b: code done; live verification pending — RUNBOOK_CAPTURE §8)_: `api_snapshots` (account insights + audience bodies, deduped by hash, <= 64 KB, kept forever, `paging` links stripped).
- [x] Migration `20261022000001_capture_v2b.sql` applied to the live project before the 11b deploy (tables and columns confirmed present 2026-10-17).
- [ ] Owner: post a Story and run the probe (RUNBOOK_CAPTURE §3); Reconnect both accounts for comments (§1); then record the results in docs/META_PROBE_RESULTS.md. Full list: docs/OWNER_ACTIONS.md.

## 6d. Time Scope (Plan 12a)
- [x] **Shared Time Scope bar** on Overview, account pages (not Audience) and Calendar: presets 7d/14d/30d/90d/6m/1y/YTD/all, custom range, week/month/quarter pickers, compare (previous period / same period last year / custom days / none), granularity auto/day/week/month; URL-only state (`?from&to&cmp&gran`), old `?period=` and `?month=` links still work — code done; live verification pending (docs/RUNBOOK_TIMESCOPE.md)
- [x] KPI windows from any range with an optional comparison (rolling presets keep the old 7/30/90 numbers); null-safe day/week/month buckets with partial buckets marked — code done; live verification pending
- [x] Paged owner-session reads (no 200-day or 1,000-row cut for 1 year / all); Stories capped at 200 per account per range and the tab says so — code done; live verification pending
- [x] Exports (Excel + PDF) follow the page's scope; strict parameters; file names and Summary state the days — code done; live verification pending (docs/RUNBOOK_TIMESCOPE.md §9)
- [ ] Owner: run docs/RUNBOOK_TIMESCOPE.md (360/768/1280 × themes, 1 year, compare, DST range if the owner timezone has DST, old links)
- [ ] Plan 12b: rollups, Explorer, drill-down, saved views; a Stories "final numbers" rollup lifts the 200-per-range cap

## 6e. Explorer, rollups, drill-down (Plan 12b)
- [x] SQL rollups (`explorer_daily`, `explorer_media`, `explorer_posts`, `explorer_followers`; security invoker; InitPlan owner check) + `explorer_views` _(code done; migration `20261024000001_explorer.sql` applied to the live project 2026-10-19 (anon probe: objects exist, EXECUTE revoked from anon); owner-path live verification pending — docs/RUNBOOK_EXPLORER.md §0, §5)_
- [x] Metric/dimension registry, `/explorer` (linked chart + table, comparison, filters, breadcrumbs, item level, saved views, Excel export) _(code done; live verification pending — RUNBOOK_EXPLORER §1–§4, §6)_
- [x] Drill-down from Overview (tiles, groups, comparison rows/chart) and account pages (formats, best-time cells, Posts) _(code done; live verification pending — RUNBOOK_EXPLORER §3)_
- [ ] Owner: fill the 1-year Server-Timing numbers in RUNBOOK_EXPLORER §4; confirm the open questions in the plan (Stories opt-in, 500-post cap, 6-tab phone bar)

Follow-ups from the Plan 12b review (not done):
- [ ] The weekday filter select is always Sunday-first (it ignores the week-start preference)
- [ ] The Overview comparison chart's bucket drill works by mouse only (no keyboard path)
- [ ] The breadcrumb trail drops the tag, weekday and hour filters
- [ ] Measure the Explorer's real speed on the live database with Server-Timing at 1 and 2 years (the reviewer's local run: daily rollups 50-380 ms, heaviest calls 0.7-1.0 s at 1.33 M snapshots)
- [ ] Owner: the three open defaults (Stories opt-in, 500-post cap, 6 items on the phone tab bar)

## 6f. Covers UI (Plan 13a)
- [x] `MediaThumb` (owner-only cover route, skeleton, placeholder for pending / unavailable / failed / load error, format badge, play glyph, slide count, "Expired" ribbon) and `MediaDrawer` (cover, caption snippet, owner-timezone date, numbers, tags, Instagram link, `action` slot for the Post Lab) _(code done; live verification pending — docs/RUNBOOK_COVERS.md §1–§3, §6)_
- [x] Posts tab Grid | Table (`?view=`; automatic = grid on phones, table from tablet width), Stories filmstrip per day, Calendar covers (day list; cells in month views) _(code done; live verification pending — RUNBOOK_COVERS §1, §4, §5)_
- [ ] Owner: run docs/RUNBOOK_COVERS.md; confirm the plan's open questions (automatic view, 4:5 tiles, 80-character drawer caption, 200-Stories cap, no Calendar drawer)
- [ ] Later: lift the 200-Stories cap with a `story_finals` SQL function (applied before the code that calls it); carousel child covers; the Tags page and audience history on the Time Scope

## 6g. Post Lab (Plan 13b)
- [x] SQL `post_lab_latest` + `post_lab_points` (security invoker) _(code done; migration `20261026000001_post_lab.sql` applied to the live project 2026-10-19; owner-path live verification pending — docs/RUNBOOK_POSTLAB.md §0, §6)_
- [x] `/accounts/[id]/media/[mediaId]`: header with cover and editable tags, scorecard with percentiles and verdict (sample guard 5), velocity vs the median curve, Reels watch time, Story funnel + day sequence, caption lab (20-post guard), similar posts _(code done; live verification pending — RUNBOOK_POSTLAB §1–§5, §7)_
- [x] Links in: Posts grid/table + drawer, Stories filmstrip + drawer, Calendar day list, Explorer item level _(code done; live verification pending — RUNBOOK_POSTLAB §1)_
- [ ] Owner: confirm the plan's open questions (peers = 30/90 earlier posts of the format, guard 5, verdict on reach, "too early" before day 7, caption lab per format)
- [ ] Later: lift the Stories tab's 200 cap with `post_lab_latest` (each Story's final numbers per id); a per-followers engagement rate in the Explorer registry

- [ ] Known, left from the Plan 13 reviews (Minor): Calendar phone agenda renders a thumb per item even on desktop with "all" (up to 5000 hidden instances; cap or gate on `covers` if profiling shows it); Auto view mounts two drawer roots per post (capped at 50 by "Show more"); the Post Lab fallback page (migration missing) always links back to Posts, also for a Story (moot now the migration is live); skip rate shows the raw percentile although lower is better (decide: show 100 - p, or a hint); feed interactions treat a missing saves/shares part as 0 (undercounts instead of null; fine while those columns are always captured); the emoji count includes ©, ® and ™.

## 6h. UI foundation (Plan 14a)
- [x] Standard scrollbar, one control height per row, underline section tabs, full-word range labels (en + zh-CN) _(code done; live check pending — docs/RUNBOOK_TIMESCOPE.md §"Plan 14a")_
- [x] `RangeBar` (Last 7 / 14 / 30 Days + More ranges) on Overview, account Overview, Calendar, Explorer; `FilterToolbar` pattern (`components/shared/FilterToolbar.tsx`)
- [x] Account page: Overview / Posts / Stories, Audience inside Overview (`?tab=audience` redirects), range bar on Overview only; Posts and Stories read All time until Plan 14b
- [x] Explorer toolbar (apply as you pick, Advanced, chips, Clear all); `docs/UI_STANDARDS.md`, CLAUDE.md "UI standards", guard tests
- [ ] Owner: live check (RUNBOOK_TIMESCOPE §"Plan 14a"); confirm the plan's open questions (dialog/sheet panels, "Last 12 months", interim All time on Posts/Stories, title case on the three presets, Clear all vs Reset)
- [x] Plan 14b: Posts and Stories filters + pagination (replaces the interim All time lists) _(Plan 14b, see §6i)_

- [ ] Known, left from the Plan 14a review (Minor): removing a filter chip drops keyboard focus to the page (move it to the next chip or the toolbar group); the underline tabs' fade mask always covers the last 1.5 rem even when nothing overflows, and the underline may sit about half a pixel above the rule (check visually in /styleguide); the guard test for one control height only covers the account page, export dialog and Explorer (Calendar's period arrows and Overview's account chips are small controls in rows of their own)

## 6i. Posts and Stories lists (Plan 14b)
- [x] Migration `20261027000001_post_story_lists.sql`: `post_list`, `story_list` (security invoker; filter, sort, page, count; Story final numbers) _(written, tested and APPLIED to the live database 2026-10-21; the runtime check after applying is docs/RUNBOOK_LISTS.md, incl. a non-ASCII search)_
- [x] Posts: search, posted date, Format, Tag, Sort, chips, Clear all, server pages (24 grid / 50 table), table headers on the server sort
- [x] Stories: posted date, Sort, measured; 7 days per page for Newest, 48 per page for the other sorts; no 200 cap (once the migration is applied)
- [x] Fallback to the capped reads while the migration is missing; `Pagination`, `PostedFilter`, `DataTable` server sort; `docs/UI_STANDARDS.md` rules 12–13
- [ ] Owner: apply the migration (runbook §0), live checks (RUNBOOK_LISTS §1–§6), confirm the plan's open questions (eight sort orders, 50 per page in the automatic view, 7 days / 48 Stories per page, fallback before the migration, plain substring search)

## 6j. App-shell tabs (Plan 14c; UX polish design §4.3)
- [x] Spike: Sec-Fetch-Dest hint + client-side frame check, per-tab history, service-worker fix, memory (~40 MB per frame of a chart page) — Gate A passed while planning
- [x] Tabs in the header row: one frame per tab kept alive (8 live, 3 on touch devices, LRU), titles from the page heading, Back/Forward/Refresh per tab, keyboard tablist, phone "Tabs (N)" sheet, saved tab list, address bar follows the active tab _(code done; NOT verified live — docs/RUNBOOK_TABS.md)_
- [x] Sidebar = jump to the section's tab or open one; bottom bar = navigate the current tab; ctrl/middle-click and the window icon (Overview account cards, Post Lab links) = new tab or jump to that exact page; bell and Web Push open/jump tabs _(code done; NOT verified live — RUNBOOK_TABS §1, §6, §7)_
- [x] Break-outs (login, 2FA, setup, sign-out, report preview never inside a tab), `frame-ancestors 'self'`, worker leaves tab frames alone _(code done; NOT verified live — RUNBOOK_TABS §2)_
- [x] Preferences (theme, mode, language, formats) follow across tabs and the shell via `BroadcastChannel` _(code done; NOT verified live — RUNBOOK_TABS §8)_
- [ ] Owner: run docs/RUNBOOK_TABS.md (Gate B: §1–§3 must pass before relying on the tabs / pushing to production); confirm the plan's open questions (Back re-renders the earlier page, titles from the heading, icon placement, phone Back in the sheet, 30-minute stale mark, live cap 3 on touch devices)
- [x] Status (2026-10-23): Plans 14a, 14b and 14c are pushed to `main` and the 14b migration `20261027000001_post_story_lists.sql` is APPLIED to the live database (2026-10-21). Nothing from 14a-14c is verified live yet: the owner's checks are the open items above (tabs first).

## 6k. Growth tab (Plan 15a; creator-toolkit design §6)
- [x] Followers (daily, hourly for ≤ 7 days), change over the range, 7/30/90-day projection with method and confidence _(code done; NOT verified live — docs/RUNBOOK_GROWTH.md §3)_
- [x] Follows vs unfollows (Instagram's, or the follower-count change under 100 followers), churn, best and worst days with what was published _(code done; NOT verified live)_
- [x] Followers vs non-followers reached over time and per format; audience then vs now with highlighted changes _(code done; NOT verified live)_
- [x] "Why did this change?": unusual days (same-weekday robust z-score) and rule-based reasons with evidence, sample and confidence; `?day`/`?why` in the URL _(code done; NOT verified live — RUNBOOK_GROWTH §4)_
- [ ] Owner: run docs/RUNBOOK_GROWTH.md (§2 checks the uncertain FOLLOWER/NON_FOLLOWER mapping first); confirm the plan's open questions (own tab, no Overview roll-up, reach summed over formats, projection method, anomaly thresholds, then-vs-now audience, follow mapping check, no SQL)
- [ ] Not captured (needs a sync change if wanted): engaged-audience demographics; demographics for `last_30_days` / `last_90_days`
- [x] Status (2026-10-23): Plan 15a is pushed to `main` (2026-10-22, `77a5db0`); no migration in 15a; nothing verified live yet (RUNBOOK_GROWTH §2 first).

## 6l. Followers by name — export upload diff (Plan 15b)
- [x] Migration `20261028000002_follower_exports.sql` (one row per snapshot, arrays, owner RLS, cascade) _(written and tested; APPLIED to the live database 2026-10-22; older wording: NOT applied to the live database — owner go-ahead, BEFORE deploying code that needs it, docs/RUNBOOK_FOLLOWERS.md §0)_
- [x] Browser-side parser (size caps, known format variants, error keys) + strict server validation; owner-only capped upload route; delete action; privacy guard test _(code done; NOT verified live)_
- [x] Followers tab (last tab: Overview, Growth, Posts, Stories, Followers): guide (en/zh-CN), upload dialog, five lists with search and server pages, snapshot list, Excel export of a list; quiet "older than 30 days" line _(code done; NOT verified live; without the migration the tab says "needs a database update" and shows no upload button)_
- [ ] Owner: apply the migration (runbook §0); **confirm the export format on a real export (RUNBOOK_FOLLOWERS §2 — gate; the folder names, file names and JSON shapes are assumptions until then)**; live and privacy checks (§1, §3–§6); confirm the plan's open questions (50,000 cap, no zip yet, ignore recently-unfollowed/pending, no reminder push, 60 snapshots, fourth tab, owner-picked date, renamed accounts as unfollowers)
- [ ] Later: .zip upload (DecompressionStream + inflated-size caps), gzip payload for > 50,000 followers _(commenters × followers: Plan 15c, see 6m)_
- [x] Status (2026-10-23): Plan 15b is pushed to `main` (2026-10-22, `77a5db0`) and its migration `20261028000002_follower_exports.sql` is APPLIED to the live database (2026-10-22); nothing verified live yet (RUNBOOK_FOLLOWERS §2 with a real export is the gate).

## 6m. Comment insights (Plan 15c, read-only)
- [x] Migration `20261029000001_comment_insights.sql` (`comment_list`, `comment_fans`, `comment_outsiders`, comments policy InitPlan) _(written and tested; APPLIED to the live database on 2026-10-26 (older wording: NOT applied) — owner go-ahead, BEFORE deploying, docs/RUNBOOK_COMMENTS.md §0; it also rewrites the existing `comments_owner_select` policy into InitPlan form)_
- [x] Comments tab (Overview, Growth, Posts, Stories, Comments, Followers; Plan 15d later put Moderation between Comments and Followers): All comments with search / comment date / post / show only and server pages, Unanswered questions, Fans (top, new, gone quiet), Topics (en + zh, no AI), Not following you (newest follower export); "Reconnect to enable comments" without the scope _(code done on local `main`, NOT pushed; NOT verified live)_
- [ ] Owner: apply the migration (runbook §0); Reconnect each account once (§1); a real comment from another account (§2, gate); views, layout, privacy, speed (§3–§6); confirm the plan's open questions (fifth tab before Followers, fan rules, derived "reply seen", no export, question words, topics from the newest 1,000)
- [x] Plan 15d (moderation) is built: see 6n. Still open: read thread replies and the hidden flag (makes "Unanswered questions" exact; a small follow-up plan after probe P5, NOT in 15d)

## 6n. Comment moderation (Plan 15d)
- [x] Migration `20261029000002_comment_moderation.sql` (code done; APPLIED to the live database on 2026-10-26 (older wording: NOT applied): owner go-ahead, after or together with `20261029000001`, BEFORE deploying; RUNBOOK_MODERATION §0)
- [x] Meta write client + error keys; service (log first, double-submit guard, wrong-account guard); server actions _(code done on local `main`, NOT pushed; nothing has ever been sent to Instagram)_
- [x] Rules (words + 4 spam patterns), preview, auto-hide pass in the tick (capped, idempotent, pauses; OFF by default), `moderation_paused` alert
- [x] Comment row menu (reply / hide / unhide / delete), Moderation tab (auto-hide, rules, log with Undo and pages); tab order Overview, Growth, Posts, Stories, Comments, Moderation, Followers
- [ ] Owner: apply the migration (15c's first or together); Reconnect each account once for the comments scope
- [ ] Live probes P1–P8 on a throwaway comment of the owner's own test post (RUNBOOK_MODERATION §1) — BEFORE switching auto-hide on; this WRITES to the real Instagram account
- [ ] Layout, rules/auto-hide and privacy checks (RUNBOOK_MODERATION §2–§5)
- [ ] Watch the tick duration after auto-hide is on (35 s sync + 10 s alerts + up to 5 s auto-hide of a 60 s route limit; Server-Timing / `sync_runs` durations, RUNBOOK_MODERATION §4)
- Known: hides done in the Instagram app are not seen (P5); no Simplified/Traditional folding; auto-hide only sees stored comments (last 30 days of posts).

## 6o. Settings redesign (Plan 16a)
- [x] Sections with their own URLs (`/settings/<section>`), section list / phone select, old tab names redirect (code done on local `main`, NOT pushed; live verification pending — docs/RUNBOOK_SETTINGS.md §1)
- [x] One save model: preferences instant with a toast and Retry on failure (PrefsProvider no longer swallows errors); forms with dirty tracking, sticky save bar, unsaved-changes guard (code done; live verification pending — §2, §3)
- [x] Appearance with live preview and Auto mode; Language & formats with samples and the timezone explanation (code done; live verification pending — §2)
- [x] Notifications: test notification to this device, devices list with remove (code done; live verification pending — §3)
- [x] Accounts & sync overview with Sync now / Reconnect (code done; live verification pending — §4)
- [ ] Apply migration `20261030000001_prefs_auto_mode` (owner go-ahead, before deploying; RUNBOOK_SETTINGS §0; NOT applied: until then choosing Auto shows a save-failed toast with Retry)
- [x] Security section: password and sessions added by Plan 16b (see 6p); [x] Data & privacy (Plan 16c, see 6q)
- Known: the unsaved-changes guard does not cover the shell's own navigation; the devices list does not mark this device.

## 6p. Security (Plan 16b)
- [x] Change password, forgot / reset password, sign out other devices (code done on local `main`, NOT pushed; no migration; live verification pending: docs/RUNBOOK_SECURITY.md)
- [ ] Owner prerequisites (RUNBOOK_SECURITY §0: SMTP, template, Site URL, password minimum, sign-ups off); forgot / reset cannot work before these
- [ ] RUNBOOK_SECURITY §1–§6 walked through by the owner
- [ ] Open questions L1, L2, L4, L8, L9 answered live (plan 2026-10-30-16b)
- Known: no session list (Supabase has no API for it), no durable lockout and no CAPTCHA (cookie friction + Supabase limits only), no breached-password check; another device keeps working up to 1 hour after "Sign out other devices", a change or a reset.

## 6q. Data & privacy (Plan 16c)
- [x] Storage used, export your data (JSON per table), delete all data (password + typed word) (code done on local `main`, NOT pushed; live verification pending: docs/RUNBOOK_DATA.md)
- [x] Apply migration `20261031000001_data_privacy` (applied and pushed 2026-10-27)
- [ ] RUNBOOK_DATA §1–§5 walked through by the owner (§3.3, the real delete, only when the owner wants everything gone)
- [ ] Live checks L1 (keyset on the real PostgREST), L2 (data_usage reads storage.objects), L3 (pg-safeupdate with `where true`), L5 (Instagram app removal) (plan 2026-10-31-16c)
- Known: no zip and no cover images in the export; one table per request within 50 s; no per-account database bytes; the Instagram grant is removed by the owner in Instagram; a sync mid-run can leave one cover image (shown as "Not linked to an account", removed by the next run).

## 6b. Next (Plan 14/15 Settings)
- [x] **Forgot / reset password** (Plan 16b; code done, live verification pending: docs/RUNBOOK_SECURITY.md) (login page link → Supabase recovery email → `/login/reset` set-new-password page). Needs: Auth Site URL + redirect URL set to the real domain, custom SMTP (Supabase default mail is rate-limited and often spam-filtered), recovery link opens a session at aal1 so 2FA is still required afterwards, rate-limit + generic response (never reveal whether the email exists), expiry, i18n en/zh-CN, tests
- [x] Settings → Security: **change password** form (current + new, strength meter), active sessions / sign out everywhere (Plan 16b; code done, live verification pending: docs/RUNBOOK_SECURITY.md; no session list is possible, one "Sign out other devices" button) (owner currently changes it via the Auth admin API on request)

## 7. Later
- [ ] (C) Weekly AI summary per account via Claude API
- [x] Alerts when a token needs reconnect (Plan 8 `needs_reconnect` + `token_expiring` rules)
