# in2sight — TODO

Status: spec approved 2026-10-13; docs + mockups pushed. Implementation follows `docs/superpowers/plans/2026-10-13-00-roadmap.md` (Plan 1 in progress when this line is stale — check git log). Check items off as done.

## 0. Owner actions (Claude can't do these)
- [ ] Convert each Instagram account to **Creator** (Settings → Account type and tools → Switch to professional account)
- [ ] Create a Meta developer account at developers.facebook.com (free; phone verification)
- [ ] Create a Meta app, add the **Instagram** product → "API setup with Instagram login"
- [ ] Add each account as **Instagram Tester**, accept the invite in each account (Settings → Apps and websites → Tester invites)
- [ ] Deploy to Vercel, create the Supabase project, fill `.env.local`, run `npm run check:env` — follow `docs/SETUP.md` and `docs/SETUP_SUPABASE.md`
- [x] Approve `docs/SPEC.md` (done 2026-10-13)

See `docs/META_SETUP.md` for click-by-click notes.

## 1. Foundation
- [x] Next.js (TS, App Router) scaffold
- [ ] Deploy to Vercel (Plan 3)
- [ ] Supabase migrations: all tables in SPEC §5 + RLS
- [x] Supabase Auth: single owner login (sign-ups disabled); middleware guards all pages (code done; live verification pending — docs/RUNBOOK_AUTH.md)
- [x] 2FA: TOTP enroll/verify UI in Settings → Account; middleware enforces AAL2 once enrolled (code done; live verification pending — docs/RUNBOOK_AUTH.md)
- [x] `profiles` table: language, timezone, date/time/number format, week start, theme, density, radius (code done; live verification pending — docs/RUNBOOK_AUTH.md)

## 2. Connect accounts
- [ ] `lib/instagram.ts`: authorize URL, code→token, long-lived exchange, refresh
- [ ] `/accounts` page + OAuth callback route
- [ ] Verify with 1 real account, then connect all

## 3. Sync
- [ ] Verify current metric names (feed, Reels, **Stories**) vs Meta docs; put in one constants file
- [ ] `/api/cron/sync` (daily), `/api/cron/stories` (every 3h), `/api/cron/refresh` (weekly)
- [ ] Supabase `pg_cron` + `pg_net` schedules calling those routes with `CRON_SECRET` (no Vercel Cron)
- [ ] Per-account error isolation + `needs_reconnect` flag
- [ ] **Start daily snapshots as early as possible** — history can't be backfilled past ~30 days
- [ ] First-connect backfill (30d account insights + up to 500 media with lifetime metrics)
- [ ] Archive / restore / permanent-delete for accounts

## 3b. Alerts
- [ ] Rule evaluation after each sync (token expiring, needs reconnect, sync failing, reach drop, post taking off) with dedupe keys
- [ ] `notifications` table + bell/notification centre UI
- [ ] Web Push: VAPID keys, `push_subscriptions`, `web-push` sender, subscribe/unsubscribe in Settings, per-type toggles + thresholds

## 3c. Exports
- [ ] `/api/export/xlsx` (write-excel-file) with the six sheets, user date format, localized headers
- [ ] Report page (Overview + per account) with section options; print CSS for A4
- [ ] `/api/export/pdf` (puppeteer-core + @sparticuz/chromium), signed short-lived token, bundled Noto Sans SC

## 4. Analysis
- [ ] `lib/analysis`: growth, top posts, format comparison, best-time heatmap, per-tag, flags (+ vitest)

## 5. UI foundation (before pages)
- [x] Tailwind + shadcn/ui, FormField/PageHeader/EmptyState/ResponsiveDialog/AppShell (Plan 2)
- [ ] DataTable, StatCard, ChartCard (Plan 6)
- [ ] /styleguide gallery: primitives done (Plan 2); charts/tables/motion added in Plan 6
- [x] Theme tokens + 4 themes (Ink, Sunset, Forest, Mono) × light/dark; radius presets; text-contrast test (chart colours are checked visually in the styleguide)
- [x] next-intl with en + zh-CN, key/placeholder parity test, language switcher (PrefsBar)
- [x] `lib/format.ts` (date/time/number per user settings)
- [ ] `lib/metrics.ts` registry (Plan 2/6)
- [x] Responsive shell: bottom tab bar / icon rail / sidebar; bottom-sheet dialogs; touch targets (dialog close X is 16px — known gap)
- [ ] DataTable card mode (Plan 6)
- [ ] PWA: manifest, icons, service worker (static + offline page only), install prompt; motion gating (reduced-motion, mobile, Save-Data)

## 6. UI pages (use `frontend-design`)
- [ ] Overview (grouped cards), Account detail (incl. Stories, calendar, flags, tags), Accounts (connect/group), Tags

## 7. Later
- [ ] (C) Weekly AI summary per account via Claude API
- [ ] Alerts when a token needs reconnect
