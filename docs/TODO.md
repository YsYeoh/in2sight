# in2sight — TODO

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
- [x] Overview (grouped cards, totals, comparison, period selector) — code done; visual verification with real data pending (docs/RUNBOOK_DASHBOARDS.md)
- [x] Account detail (Overview / Posts / Stories / Audience with globe), Tags page, Calendar (Plan 7) — code done; the tags migration and visual verification with real data pending (the globe and the new pages have not been viewed in a browser yet; docs/RUNBOOK_DASHBOARDS.md §4)
- [x] Applied migration `20261017000001_tags.sql` (`npx supabase db push`; on the owner's go-ahead, BEFORE the deployed code is used — docs/RUNBOOK_DASHBOARDS.md §4.0)

## 6b. Loading feedback and speed (Plan 10)
- [x] Insight Orb loader, top progress bar, inline pending orb on nav items and buttons, Sync now status line — code + tests done; not yet seen on the deployed site (docs/RUNBOOK_PERF.md §2–3)
- [x] Page-shaped `loading.tsx` for every route (test-enforced), account tab streamed in Suspense, notification bell streamed — code done; streaming not yet observed live (docs/RUNBOOK_PERF.md §4)
- [x] One owner check per request (React.cache, parallel RPC), per-request accounts/sync-status reads, `Server-Timing` from the proxy — code done
- [ ] Measure before/after on production and fill docs/RUNBOOK_PERF.md §5 (owner, signed in)

## 6a. Onboarding sync — BUG + feature (owner, 2026-10-16) — do early (Plan 11)
- [ ] **BUG: connecting a new account does not start a sync.** Today the first data appears only at the next cron tick (up to 30 min), and the 90-day backfill then needs several ticks (35 s budget each; observed 3–5 runs) so a new account looks empty for 1–2 h with no explanation. Fix: the OAuth callback (and reconnect) must trigger an immediate sync of THAT account (mark it due + run it in `after()`), and while a backfill has work left the app keeps going without waiting 30 min (e.g. the progress page triggers the next pass via the existing owner-only sync action, or the run re-schedules itself), still inside the per-account lease and call budget.
- [ ] **Sync progress experience (professional UX).** After adding an account, show a progress panel (and a compact badge on every account row/card and on Overview while syncing):
  - overall % and a stage checklist with live state: Profile → Account metrics (e.g. "48 / 90 days") → Post list → Post metrics ("12 / 42 posts") → Stories → Audience → Cover images → Comments; each stage pending / running (Insight Orb) / done / skipped (with reason) / failed (with a plain-language reason and Retry);
  - what it is doing right now ("Pulling reach for 12 Aug…"), time elapsed and an honest estimate ("usually 5–10 minutes; you can leave this page, we will notify you");
  - survives reloads and closing the tab (progress is server state, not client state); polls every 2–3 s while visible (or Supabase Realtime), stops when done;
  - rate-limit and error states explained ("Instagram asked us to slow down; resuming in ~12 min"), never a silent stall; needs-reconnect state links to Reconnect;
  - completion: summary ("Imported 90 days, 42 posts, 3 Stories, audience data"), bell/push notification, "Open dashboard" button;
  - requires per-stage progress counters written by the sync runners (new table/columns, e.g. `sync_progress`: account_id, stage, done, total, state, detail_key, updated_at; append-only run log kept), i18n en/zh-CN, a11y live region, works on desktop first and on phone;
  - applies equally to reconnect and to "Sync now".
- Workaround until fixed: Accounts → **Sync now** on the new account (repeat a few times until "last synced" is recent and 90 days of data show).

## 6b. Next (Plan 14/15 Settings)
- [ ] **Forgot / reset password** (login page link → Supabase recovery email → `/login/reset` set-new-password page). Needs: Auth Site URL + redirect URL set to the real domain, custom SMTP (Supabase default mail is rate-limited and often spam-filtered), recovery link opens a session at aal1 so 2FA is still required afterwards, rate-limit + generic response (never reveal whether the email exists), expiry, i18n en/zh-CN, tests
- [ ] Settings → Security: **change password** form (current + new, strength meter), active sessions / sign out everywhere (owner currently changes it via the Auth admin API on request)

## 7. Later
- [ ] (C) Weekly AI summary per account via Claude API
- [x] Alerts when a token needs reconnect (Plan 8 `needs_reconnect` + `token_expiring` rules)
