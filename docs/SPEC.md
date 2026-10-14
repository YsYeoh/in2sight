# in2sight — Design Spec (awaiting owner's final review)

## 1. Goal
One private dashboard to see insights, traffic and basic analysis across the owner's 3–4 Instagram accounts, using Meta's free API.

**Scope v1 (A + B):** per-account trends, cross-account comparison, content analysis (top posts, format comparison, best posting time).
**Also in v1 (owner-approved):** post tags (content pillars) with per-tag analysis, simple flags (post >2× account median reach; reach drop vs previous period), posted-history calendar, **Story capture**.
**Later (C):** AI-written weekly summaries via Claude API. Not designed here beyond leaving the data model ready.
**Out of scope:** posting/scheduling, DMs, comments moderation, other people's/client accounts, Meta App Review, website analytics (GA/UTM).

## 2. Users & constraints
- Single user (owner). One Supabase Auth login; no multi-tenant.
- 3–4 accounts, currently Personal → must be converted to **Creator** (free) first. Personal accounts have no insights API.
- Meta app stays in **Dev mode** (no App Review): works for accounts added as Instagram Testers on the app. This is the whole reason we avoid client accounts.
- Stack fixed: Next.js (App Router, TypeScript) on Vercel; Supabase (Postgres + Auth + `pg_cron`/`pg_net` as the scheduler). Vercel Hobby cron is once/day, too coarse for Stories, so Vercel Cron is not used.
- Deps (each replaces a lot of code): Tailwind + shadcn/ui, TanStack Table, next-intl, Recharts, GSAP (motion), Three.js (one lazy-loaded globe), `web-push`, `write-excel-file`, `puppeteer-core` + `@sparticuz/chromium`. No others without a reason.

## 3. Meta API approach
- **Instagram API with Instagram Login** (graph.instagram.com). No Facebook Page needed.
- Permissions: `instagram_business_basic`, `instagram_business_manage_insights`.
- Connect flow per account: "Connect account" → Instagram authorize → callback → code → short-lived token → **long-lived token (60 days)** → store.
- Token refresh: weekly cron refreshes any token expiring within 14 days (a successful refresh renews it for another 60 days, so healthy accounts never expire). If refresh fails, mark account `needs_reconnect`. The "token expiring" alert (7d / 2d) therefore only fires when refreshes keep failing.
- History limits: account-level insights reach back a limited window (Meta's insights guide, checked Oct 2026: "User Metrics data is stored for up to 90 days"; individual metrics may reach back less — verify per metric when building the sync, Plan 5). **Connect early and snapshot daily** — our DB is the history.
- Metric names change often (e.g. `impressions` → `views`). Verify against current docs when implementing; keep metric lists in one file.

## 4. Architecture
```
Browser ── Next.js (Vercel) ── Supabase Postgres (RLS, owner only)
                │
   Supabase pg_cron ──► /api/cron/sync     (daily)    ─► Instagram Graph ─► upsert snapshots
   (via pg_net)    ├──► /api/cron/stories  (every 3h) ─► capture live Stories + their insights
                   └──► /api/cron/refresh  (weekly)   ─► refresh tokens
```
- Cron routes protected by `CRON_SECRET` (sent as a header by pg_net); use Supabase **service role** server-side only.
- Dashboard reads via the user session (RLS). Tokens table is **service-role only**, never exposed to the browser.
- One Meta client module (`lib/instagram/oauth.ts`): thin `fetch` wrapper, no SDK.

## 5. Data model (Postgres)
| Table | Key columns |
|---|---|
| `accounts` | id, ig_user_id (unique), username, group_name (nullable; null = isolated account), status (`active`/`needs_reconnect`/`archived`), archived_at, created_at, display_name, account_type, profile_picture_url, last_error, token_expires_at (non-secret copy of the token expiry, for the UI), connected_at |
| `profiles` | user_id, language, timezone, date_format, time_format, week_start, number_format, theme, density, radius, alert settings jsonb (per-type push on/off + thresholds) |
| `notifications` | id, account_id, kind, severity, payload jsonb, dedupe_key (unique), created_at, read_at |
| `push_subscriptions` | id, endpoint (unique), keys jsonb, user_agent, created_at |
| `account_tokens` | account_id (pk, fk), access_token, expires_at, refreshed_at — service-role only |
| `account_daily` | account_id, day, followers, reach, views, profile_views, accounts_engaged, total_interactions, follows, unfollows, link_taps — pk(account_id, day) |
| `media` | id (IG media id), account_id, media_type (incl. `STORY`), permalink, caption, posted_at, expires_at (stories) |
| `media_metrics` | media_id, captured_at (timestamptz), reach, views, likes, comments, shares, saves, total_interactions, replies, taps_forward, taps_back, exits — pk(media_id, captured_at); story-only columns null for other types |
| `tags` | id, name, color |
| `media_tags` | media_id, tag_id — pk(media_id, tag_id). Manual tagging in the UI; hashtag-to-tag auto-suggest is later |
| `audience_snapshots` | account_id, day, kind (`age_gender`/`country`/`city`), data jsonb |
| `online_followers` | account_id, day, hourly jsonb (24 values) |

Upsert only; rows are deleted solely by the explicit "Delete all data permanently" action (§7c). Feed-post metrics are re-captured daily for posts <30 days old, so we see growth curves. Story metrics are captured every 3h while live; the last snapshot before `expires_at` is the final value. Flags are computed on read, not stored.

## 6. Sync jobs
**Stories job (every 3h):** for each `active` account, list live Stories, upsert into `media`, insert a `media_metrics` snapshot per story. Stories exist for 24h only, so a missed window is lost data; 3h gives ~8 snapshots per story.

**Daily job:** for each `active` account: fetch followers + yesterday's account insights → `account_daily`; list new media → `media`; fetch insights for posts <30 days old → `media_metrics`; fetch audience + online_followers (if ≥100 followers) → snapshots. One account failing must not stop the others; log per-account result, flip status on auth errors. `archived` accounts are skipped by every job. After the daily and Stories jobs finish, the alert rules (§7c) are evaluated and push notifications sent.

## 7. Analysis (v1, plain SQL/TS — no ML)
- **Growth:** 7/30-day follower and reach deltas per account.
- **Top/bottom posts:** by reach and by engagement rate (`total_interactions / reach`).
- **Format comparison:** avg reach + engagement by `media_type` (Reel / carousel / image).
- **Best time to post (approved: both, with a sample guard):** default view = **followers online** by weekday × hour (`online_followers`, needs 100+ followers). A toggle shows **your post performance** (avg engagement rate by weekday × hour of `posted_at`); cells with fewer than 2 posts are greyed out, and the view shows "Needs ~30+ posts for a reliable pattern" until the account has ≥ 30 feed posts.
- **Cross-account:** same metrics side by side.
- Pure functions in `lib/analysis/*`, unit-tested.

**Metric definitions (defaults):**
- *Engagement rate* (post) = (likes + comments + saves + shares) ÷ reach. Account ER over a period = Σ interactions ÷ Σ reach.
- *Delta* = value vs the immediately preceding period of equal length.
- *Net follower change* = follows − unfollows; *followers* = daily snapshot.
- *Story exit rate* = exits ÷ story views.
- *Post taking off* = reach ≥ 2× the median reach of the account's previous 20 feed posts, evaluated ≥ 24 h after posting; needs ≥ 5 prior posts.
- *Daily boundaries* follow Instagram's insight day; displayed in the user's timezone. Verify the exact boundary behaviour against Meta docs at implementation.

## 7b. Functional design (approved)
- **Flows:** Connect → Overview (glance) → Account detail (dig in) → Compare.
- **Grouping is optional.** An account may have a `group_name` or none. Ungrouped = isolated: it gets its own card and is never compared with others unless the user widens scope to "All accounts".
- **Overview:** per-account status cards (followers, reach, engagement, posts + change vs previous period), listed under group headings; isolated accounts listed together. One date-range switch (7/30/90d) for the page.
- **Compare / ranking:** scoped to a group by default; toggle to all accounts; user picks the metric and accounts.
- **Rules:** one timezone (owner's); numbers always shown with a comparison; missing data states why (e.g. "needs 100+ followers"); "last synced" shown per account.
- **Not in v1:** goals/targets, scheduled or emailed reports, shareable report links, custom report builder, logo upload.

## 7c. Alerts & account lifecycle (approved)
**Alerts: in-app + Web Push.** Rules run after each sync job. Defaults (adjustable in Settings): token expiring (7d, again at 2d), needs reconnect, sync failing (2 consecutive failed runs), reach drop (7d reach ≤ −20% vs previous 7d, 7-day cool-down), post taking off (≥ 2× account median reach). Push on for all except "taking off". Each alert has a `dedupe_key` so it never repeats. Delivered to the notification centre (bell + badge) and to subscribed devices via `web-push` + VAPID keys. Push permission is requested only from an explicit "Enable notifications" action. iOS needs the PWA installed to Home Screen.

**Remove account = archive.** Status → `archived`, syncing stops, account hidden from all views, **history kept**. Reconnecting the same `ig_user_id` restores it and continues the history with no gap. A separate, confirmed "Delete all data permanently" action hard-deletes an archived account's rows (cascade).

**Backfill on first connect** (defaults): account insights for as far back as the API allows (up to 90 days per Meta's docs; 30 if a metric is shorter — decided per metric in Plan 5); all media up to 500 posts with their current lifetime metrics (so tags and best-time analysis work immediately); no Story history (not retrievable).

## 7d. Exports & reports (approved: Excel + PDF)
- **Excel:** server route `/api/export/xlsx` (auth required) using `write-excel-file` (not `xlsx`: known vulnerabilities in the npm build). Sheets: Summary, Daily, Posts (+tags), Stories, Audience, Tags. Real date cells formatted per the user's date-format setting; headers localized (en / zh-CN).
- **PDF:** a print-optimized Report page per account and for the Overview (A4, always light). `/api/export/pdf` renders that page with headless Chromium (`puppeteer-core` + `@sparticuz/chromium`) via a short-lived signed token. Bundled Noto Sans SC subset for Chinese. One layout, no second PDF renderer.
- **Report options:** section checkboxes (KPIs+deltas, reach/views trend, top posts, format comparison, tag performance, best time, audience, Stories summary, flags), title, optional note. No logo upload in v1.
- **Ceiling:** Chromium cold start adds seconds to the first PDF after idle; if volume grows, move PDF generation to a small dedicated service.

## 8. UI (v1)
Pages: Login · Overview (account cards by group, comparison) · Account detail (trends, posts table with tags, Stories, audience, best-time heatmap, calendar, flags) · Accounts (connect / reconnect / status / group) · Tags. Design pass with `frontend-design`. Charts: Recharts. Mobile-first and responsive (§8b.5). Visual reference: the approved mockups in `.superpowers/brainstorm/` (kit-forms, kit-data, kit-charts, app-prototype).

## 8b. Frontend architecture (owner rules)
1. **Reuse.** shadcn/ui primitives in `components/ui/`; our shared pieces in `components/shared/` (`AppShell`, `DataTable`, `StatCard`, `ChartCard`, `EmptyState`, `PageHeader`). Inline first, extract on the second use. Pages hold wiring only; logic is pure functions in `lib/`.
2. **Flexible, with a limit.** One metrics registry `lib/metrics.ts` (key, i18n label key, formatter, aggregation, source) drives cards, charts, tables and pickers. Feature folders: `features/overview|account|accounts|tags`. No plugin systems, no generic dashboard builder.
3. **i18n.** next-intl, `messages/en.json` + `messages/zh-CN.json` (Simplified `zh-CN`, approved). No hardcoded UI strings; a test fails on missing keys. New language = one JSON + one entry in the `locales` list. `Intl` for dates/numbers. Server returns error keys, UI translates. CJK-safe font stack.
4. **Themes + light/dark.** Semantic CSS-variable tokens (`--background`, `--primary`, `--chart-1..6`); never raw colors in components. A theme = one CSS block with light + dark variants (`data-theme` + `data-mode` attributes on `<html>`, `data-mode` being `light` / `dark`). The choice lives in a cookie and is applied to `<html>` attributes on the server (no flash, no extra dependency). Charts read the same tokens. Ship 4 themes at launch (Ink, Sunset, Forest, Mono — approved); check chart-color contrast per theme. Corner radius is also a token (Sharp/Soft/Round, default **Soft** 8/12/16).
5. **Responsive.** Mobile-first; must work on phone, tablet, desktop and ultra-wide. Breakpoints 640/768/1024/1280. Sidebar → bottom tab bar (phone) → icon rail (tablet) → full sidebar (desktop). Tables → card lists on phone; dialogs → bottom sheets; date-range picker → sheet. `@media (pointer:coarse)` forces ≥40px touch targets. Content max-width ~1600px, centered. Heavy motion (globe, particles) is off on phones, `prefers-reduced-motion`, and Save-Data.
6. **PWA.** Installable (`app/manifest.ts`, icons, `theme_color` follows theme). Small hand-written service worker: cache static assets + offline fallback page. **No authenticated data is cached by the SW** (shared-device safety). The same service worker handles Web Push (§7c).
7. **Formats are user settings** (stored in `profiles`, cached in a cookie to avoid flash): date format (`YYYY-MM-DD` / `DD/MM/YYYY` / `MM/DD/YYYY` / `D MMM YYYY`), time format (12/24h), week start (Mon/Sun), timezone, number format. All dates/numbers go through one `lib/format.ts`; no inline `toLocaleDateString`.

## 9. Security
- `.env*` never committed. Tokens never logged, never sent to the client.
- RLS enabled on every table; only the owner's user id can read.
- Repo is private. Meta app secret only in Vercel env vars.
- **2FA (TOTP)** via Supabase Auth MFA: enroll in Settings → Account (QR + secret, confirm with a 6-digit code). Once a factor is verified, middleware requires AAL2 for every page and API route. Sign-ups are disabled (single owner). Supabase has no built-in recovery codes: recovery = remove the factor in the Supabase dashboard (acceptable for a single owner; own backup codes would be a later add).

## 10. Testing
- Vitest for `lib/analysis/*` and the Meta client (mocked fetch with recorded sample responses).
- One manual end-to-end check per milestone against a real connected account.

## 11. Open questions for owner
1. ~~Chinese variant / launch themes~~ — resolved: Simplified; 4 themes.
2. OK to create a new Supabase project (free tier) for this? (needs your confirmation; I won't create it unprompted)
3. Preferred Vercel URL/domain for the OAuth redirect? Dev-mode redirect URIs may allow `localhost`; verify at setup.
4. Are any accounts private? Confirm the API works with them before we rely on them.
