# in2sight — TODO

Status: nothing built yet. Check items off as done.

## 0. Owner actions (Claude can't do these)
- [ ] Convert each Instagram account to **Creator** (Settings → Account type and tools → Switch to professional account)
- [ ] Create a Meta developer account at developers.facebook.com (free; phone verification)
- [ ] Create a Meta app, add the **Instagram** product → "API setup with Instagram login"
- [ ] Add each account as **Instagram Tester**, accept the invite in each account (Settings → Apps and websites → Tester invites)
- [ ] Create Supabase project and Vercel project (or approve Claude doing it via MCP)
- [ ] Approve `docs/SPEC.md`

See `docs/META_SETUP.md` for click-by-click notes.

## 1. Foundation
- [ ] Next.js (TS, App Router) scaffold, deploy empty app to Vercel
- [ ] Supabase migrations: all tables in SPEC §5 + RLS
- [ ] Supabase Auth: single owner login (sign-ups disabled); middleware guards all pages
- [ ] 2FA: TOTP enroll/verify UI in Settings → Account; middleware enforces AAL2 once enrolled
- [ ] `profiles` table: language, timezone, date/time/number format, week start, theme, density, radius

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
- [ ] Tailwind + shadcn/ui, `components/shared/*` (AppShell, DataTable, StatCard, ChartCard, EmptyState, PageHeader)
- [ ] **`/styleguide` page first**: every component in every theme × light/dark × density × radius, EN/中文, at 360 / 768 / 1280 widths — compare against the approved mockups
- [ ] Theme tokens + 4 themes (Ink, Sunset, Forest, Mono) × light/dark (next-themes); radius presets; chart-color contrast check
- [ ] next-intl with en + zh-CN, missing-key test, language switcher
- [ ] `lib/format.ts` (date/time/number per user settings) + `lib/metrics.ts` registry
- [ ] Responsive shell: bottom tab bar / icon rail / sidebar; DataTable card mode; bottom-sheet dialogs; touch targets
- [ ] PWA: manifest, icons, service worker (static + offline page only), install prompt; motion gating (reduced-motion, mobile, Save-Data)

## 6. UI pages (use `frontend-design`)
- [ ] Overview (grouped cards), Account detail (incl. Stories, calendar, flags, tags), Accounts (connect/group), Tags

## 7. Later
- [ ] (C) Weekly AI summary per account via Claude API
- [ ] Alerts when a token needs reconnect
