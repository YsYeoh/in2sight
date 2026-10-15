# in2sight — Handover (2026-10-15)

Written so a fresh environment (e.g. Claude Code in the cloud) can continue without this chat. Read this first, then `CLAUDE.md`, `docs/SPEC.md`, `docs/TODO.md`, and `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md`.

## 1. Where things stand
- **Repo:** https://github.com/YsYeoh/in2sight — everything is on `main` (HEAD at handover = the commit that adds this file). The old `feat/*` branches are fully merged (fast-forward, linear history) and can be deleted.
- **Live:** https://in2sight.yongsen.space (Vercel, auto-deploys `main`). Supabase project ref `fwfbqlgxyrnxprxjzwhb`. All 5 migrations are applied (`supabase/migrations/*`, local list == remote list). Sign-ups are **disabled**; one owner user exists and has claimed ownership. cron-job.org calls `/api/cron/tick` every 30 min (owner configured it). 1 Instagram Creator account is connected and syncing (verified earlier with manual ticks: 87 days of account metrics, 42 posts, 27 post-metric series, audience snapshots).
- **Built and merged (Plans 1–10), all passing `npm run check` (≈1350 tests):**
  1 foundation (tokens, themes, prefs, i18n en + zh-CN, `lib/format.ts`) · 2 UI kit · 3 auth + TOTP 2FA + profiles · 4 Instagram connect & accounts (OAuth, tokens service-role only, archive/restore/delete, Meta deauthorize/delete callbacks) · 5 sync engine (30-min tick, leases, backfill, stories, media metrics, audience) · 6 analysis + Overview · 7 account detail (Overview/Posts/Stories/Audience + canvas globe), Tags, Calendar · 8 alerts, Web Push, PWA · 9 Excel + PDF exports · 10 loading feedback (Insight Orb, top progress bar, per-route skeletons, per-request cached owner check, Suspense streaming, Server-Timing).
- **Nothing in Plans 6–10 has been looked at in a browser** (jsdom/tests only, plus a few screenshots of the orb). See §5 for the owner's verification checklist.

## 2. What to do next (approved design, not yet built)
Source of truth: `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` (owner approved it; answers: official data only + follower-export diff, include commenters/`instagram_business_manage_comments`, order A→E).
| Plan | Content | Status |
|---|---|---|
| 10 | Loading, skeletons, Insight Orb, speed | **done** |
| **11** | **Covers**: probe, migration, store cover images in a private Supabase Storage bucket (Stories captured while live), `MediaThumb`, grid/filmstrip/drawer | **next — write the plan first** |
| 12 | Post Lab: extra per-post/Story metrics + 7-day checkpoint, velocity curve, percentiles, Story sequence, caption lab | to do |
| 13a/13b | Toolkit: follower/follow-flow/loyalty/demographics trends, followers-diff upload, goals, compare; comments/fans, insights feed, leaderboards, hashtag lab, cadence, planner, digests | to do |
| 14 | Settings redesign | to do |
Each phase: write a plan (`superpowers:writing-plans`, model it on `docs/superpowers/plans/2026-10-18-08-alerts-pwa.md`), execute with subagent-driven development, final opus review, fix wave, merge to `main`, push, update `docs/TODO.md`.
**Live probes to run at the start of Plans 11/12** (Meta details still UNCONFIRMED): `views`+`follow_type`, `follower_count` series, `caption`/`media_product_type` under Instagram Login, max `since`/`until` range, media fields on `/me/stories`, media URL lifetime, follower-export file names.

## 3. Hard facts about what Instagram allows (don't re-litigate)
No follower/following lists, no unfollower names, no Story viewers, no post likers, no profile visitors — via any official API. Scraping/unofficial apps violate Meta terms (risk: restriction). Legitimate substitutes (in the spec): daily follows/unfollows totals, reach split follower vs non-follower, commenter leaderboard (extra scope + reconnect), and an owner-uploaded "Download your information" export diff. History before connect day cannot be recovered. Posts older than the Creator conversion have no insights (error code 100 / subcode 2108006 → skipped). Stories with <5 viewers return error 10 (no data).

## 4. Secrets, environment, accounts
- **Secrets are NOT in git.** `.env.local` (git-ignored) must be recreated in the new environment; copy values from the owner (never paste secrets in chat/logs). Variable **names** (see `.env.example`, `npm run check:env`): `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `CRON_SECRET`, `IG_APP_ID`, `IG_APP_SECRET`, `IG_API_VERSION`, `IG_REDIRECT_URI`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `REPORT_SIGNING_SECRET` (now unused), optional `CHROMIUM_PATH`. Vercel has the runtime ones (not the three `SUPABASE_PROJECT_REF/ACCESS_TOKEN/DB_PASSWORD`, which are local CLI only).
- **Applying migrations:** `npx supabase link --project-ref $SUPABASE_PROJECT_REF --password $SUPABASE_DB_PASSWORD --yes` once, then `npx supabase db push --yes --password $SUPABASE_DB_PASSWORD` (load `.env.local` into the process env, e.g. `node --env-file=.env.local`; do not print values). New migrations only — never edit applied ones. The Supabase **MCP connector cannot see this project** (it only sees two unrelated projects: do not touch those).
- **Owner's Supabase user** exists (created via the Auth admin API); the owner changes the password themselves.
- Manual sync trigger for testing: `POST /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` (returns 202; results in table `sync_runs`).

## 5. Owner's pending checks (nothing below has been verified live)
Follow the runbooks: `docs/RUNBOOK_DASHBOARDS.md` (Overview, account tabs, globe, Tags, Calendar at 360/768/1280 × themes), `RUNBOOK_ALERTS.md` (enable push on desktop and phone, install PWA), `RUNBOOK_EXPORTS.md` (Excel opens correctly; **PDF has never run on real Chromium** — check Chinese glyphs, chart width, timing), `RUNBOOK_PERF.md` (click→feedback, Server-Timing; fill the before/after table), `RUNBOOK_SYNC.md` §4 (record real fixtures with `npm run record:fixtures`), `RUNBOOK_META.md` (deauthorize callback flags an account? if not, signed_request user id may be the app-scoped id — report it). Also: change the password that was typed in chat; set Supabase Auth "Site URL" to the real domain.

## 6. How we worked (reuse this process)
- Method: `superpowers:subagent-driven-development` (SDD). Plan per phase → one implementer subagent per batch of 3–6 tasks (sonnet; plans contain full test + code, so it is mostly transcription) → **one commit per task** → final whole-branch review by an **opus** reviewer (the plans' own code had been dry-run in a clean clone, so per-task reviewers were skipped for plans 5+; security-critical tasks got a task reviewer in plans 3–4) → ONE fix wave → merge (fast-forward) → push. Planner agents (opus) write plans incrementally, committing early (rate limits killed two planners that had not).
- Brief extraction: `bash <superpowers>/skills/subagent-driven-development/scripts/task-brief PLAN N`; review packaging: `.../review-package PLAN BASE HEAD`. SDD workspaces/ledgers live in `.superpowers/sdd/<plan>/` — **git-ignored, local only**; the decisions that matter are recorded in §7 below.
- Rules every dispatch repeated: stage specific paths; never kill processes by image name; use the Write tool for files containing backslashes/regexes/non-ASCII (shell heredocs halve backslashes; write non-ASCII as `\u` escapes); don't touch `turbopack.rules["*.css"]` in `next.config.ts` (it is how Tailwind is wired); never run `npx shadcn init`; after `shadcn add` check `git diff app/globals.css` and grep `components/ui` for bogus `cn`/`next-themes`; planners that dry-run in a throwaway clone must not symlink/delete the real `node_modules` (this once corrupted it → `npm ci` fixed it).
- Conventions: commits are conventional and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; push straight to `main` after a plan passes `npm run check` + review (owner approved this workflow); update `docs/TODO.md` honestly ("code done; live verification pending" until the owner has looked).
- Windows quirks: Git Bash + PowerShell; autocrlf warnings are harmless; vitest sometimes times out starting workers when the machine is busy (rerun passes); `.next` generated types can go stale after moving routes (delete `.next/dev/types/validator.ts`).

## 7. Decisions & rulings worth remembering
- Auth/security: `requireOwner()` (cached per request via `React.cache`) = session via `getClaims`, server-validated MFA factors via `getUser` (never trust cookie `factors`), `rpc('is_owner')` (which itself requires aal2 once a factor is enrolled — RLS enforces 2FA, not just the proxy). Every page and server action calls it first, outside try/catch. Non-owner → `/auth/signout`; RPC error → throw (no redirect loops). Route handlers use `assertOwner(responseHeaders)` (fail closed, headers copied on every response). Public-by-design routes are exact-path exemptions in `lib/auth/route-policy.ts`: `/api/instagram/(deauthorize|delete)` (HMAC-verified), `/api/cron/tick` (Bearer `CRON_SECRET`), `/report/print` (empty shell, no data), manifest/sw.js/offline.
- Tokens: `account_tokens` is service-role only (RLS deny-all + revoked grants); never selected, logged, or returned. `lib/supabase/admin.ts` is `server-only`.
- Scheduler: external caller (cron-job.org) → one endpoint `/api/cron/tick` every 30 min (202 + `after()`, `maxDuration 60`, 35 s work budget, per-account lease with 120 s expiry, round-robin by oldest attempt); pg_cron/pg_net is a documented fallback. Vercel Cron is not used (Hobby = daily).
- Sync cadence: Stories every tick; recent media metrics hourly <48 h, daily <30 d; daily account day + last 3 days re-fetched (Meta lag); audience daily; token refresh retried daily within 14 days of expiry; periods 7/30/90 (spec says 30, not 28); engagement rate = (likes+comments+saves+shares)/reach.
- Frontend: globe is hand-written canvas (no Three.js), shown only when the motion gate allows, ranked list always present; Calendar is its own `/calendar` route + 5th nav item; tags are owner-authored (owner-session CRUD under RLS); PDF is rendered by passing the finished report to headless Chromium over DevTools (no signed token; `/report/print` reads nothing; `REPORT_SIGNING_SECRET` unused); Excel text cells beginning with `= + - @ \t \r` (also after leading whitespace/zero-width) get a visible leading apostrophe; accounts list lives in `app/(app)/accounts/(list)/` (same URL) so its `loading.tsx` doesn't cover `[id]`; server actions don't drive the top progress bar (they show the orb on their button).
- Dependencies added over the project: recharts, react-is (pinned for React 19), web-push (+ types), write-excel-file, puppeteer-core, @sparticuz/chromium (exact pins; chromium only in the PDF function bundle), @fontsource/noto-sans-sc. `npm audit --omit=dev` = 0; dev-only audit noise is known.

## 8. Known minor items deferred (all low risk)
- Post metrics: posts older than the Creator conversion have none (Meta limit); a post with a persistent unclassified error is marked attempted after 3 tries.
- `NavigationProgress` can run to its 12 s failsafe if a link redirects back to the same URL; Overview account-card orb can be clipped by `truncate`; `aria-busy` wrapper around the route-loading orb may suppress screen-reader announcement (runbook step is unverified); `lib/auth/require-owner.ts` has a few exports only tests could use.
- Rate limit: Meta's `X-Business-Use-Case-Usage` header is not read yet (fine for 3–4 accounts; add before the heavier sync in Plans 11–13).
- `signInAction` syncs prefs at aal1 (harmless warn for enrolled owners); sign-out route ignores a failed `signOut()`.
- `NEXT_PUBLIC_APP_URL` check order in the PDF route fixed; PDF queue is per-instance only.
- Many small Plan 1–2 polish items listed in earlier ledgers (not in git).

## 9. Quick start in a new environment
```bash
git clone https://github.com/YsYeoh/in2sight.git && cd in2sight
npm ci
# recreate .env.local from the owner's values (see §4), then:
npm run check:env      # names only, never prints values
npm run check          # lint + typecheck + tests + build (~3–5 min)
npm run dev            # http://localhost:3000 (redirects to /login or /setup)
```
Then start Plan 11: create branch `feat/covers` from `main`, write the plan from spec §4 (+ Task 0 live probes), execute with SDD as in §6.
