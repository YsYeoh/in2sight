# Alerts, push and PWA live-verification runbook (Plan 8)

Run this once, after: the sync runbook (`docs/RUNBOOK_SYNC.md`) passes, migration `20261018000001_alerts.sql` is applied (step 0), and the app is deployed on its HTTPS URL (`<app-url>` = your `NEXT_PUBLIC_APP_URL`). Who: owner, or Claude with the owner. Nothing here has been verified live yet.

Never paste `VAPID_PRIVATE_KEY`, `CRON_SECRET`, tokens or push endpoints into chats, screenshots or tickets.

## 0. Apply the alerts migration (pending)

`supabase/migrations/20261018000001_alerts.sql` (tables `notifications`, `push_subscriptions`) is **written but not yet applied**. Apply it on the owner's go-ahead, BEFORE the deployed code runs a tick (until then every tick records `alerts.failed: 1` and the bell stays empty):

```bash
npx supabase db push
```

Then Supabase Dashboard → Advisors → Security: no new warnings. Check in the SQL editor that the owner session cannot insert notifications (the table grants only `update (read_at)` to `authenticated`):

```sql
select privilege_type, column_name from information_schema.column_privileges
where table_name = 'notifications' and grantee = 'authenticated';   -- expect: SELECT on every column, UPDATE on read_at only
```

## 1. VAPID keys (once)

1. If `.env.local` has no keys yet: `npx web-push generate-vapid-keys` and put the two values into `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`; set `VAPID_SUBJECT=mailto:<your e-mail>`.
2. `npm run check:env -- --only=push` → all three OK (the script never prints values).
3. The same three names and values in Vercel → Project → Settings → Environment Variables (Production), then redeploy. Never rotate the keys casually: every device must re-enable notifications after a change.

## 2. Enable notifications on desktop (Chrome or Edge)

1. Open `<app-url>/settings` → **Notifications** tab. The card says "Push notifications on this device" with an **Enable notifications** button. If it says "Push isn't set up on the server yet", the VAPID env is missing in Vercel (step 1.3).
2. Click **Enable notifications** → the browser asks → **Allow**. The badge "On for this device" appears.
3. DevTools → Application → Service workers: `/sw.js` is **activated and running**, scope `<app-url>/`. Application → Cache storage → `in2sight-static-v1` holds only `/offline`, the manifest, `/icons/*` and `/_next/static/*` files — never `/overview`, `/accounts…`, `?_rsc=` or `/api/…` (SPEC §8b.6). Reload a few app pages and check again.
4. Supabase → Table editor → `push_subscriptions`: one row; `endpoint` starts with `https://` (do not copy it anywhere).
5. Denied path: in a second browser profile click Enable and choose **Block** → the card explains how to unblock; no row is added.

## 3. Enable notifications on a phone

- **Android (Chrome):** open `<app-url>`, sign in; the "Install in2sight" bar appears (or Chrome menu → Install app). Install, open from the home screen, Settings → Notifications → Enable → Allow. If the Install button doesn't appear (the browser decides when), use the browser's own Install menu.
- **iPhone/iPad (iOS 16.4+, Safari):** in Safari the Settings card says push needs the Home Screen app, and the app shows "tap Share, then Add to Home Screen". Do that, open **in2sight from the Home Screen**, sign in (the installed app has its own session), Settings → Notifications → Enable → Allow.

Each device appears as its own row in `push_subscriptions`.

## 4. Trigger a real alert

The quickest: make "post taking off" fire.

1. Settings → Notifications → Alerts: switch **Post taking off** push ON, set **Taking off (× median)** to `1.5`, Save ("Saved").
2. Accounts → **Sync now** on an account with ≥ 6 feed posts, one of them 1–3 days old with above-median reach. (The manual sync runs the alert rules for that account at the end.)
3. Expected within a few seconds: a push on every enabled device ("Post taking off — A post by @… has 1.7× its usual reach"), and the bell shows a badge; the item links to the account's Posts tab. Clicking the push focuses/opens the app on that page.
4. Press **Sync now** again: nothing new (the dedupe key `taking_off:<media id>` already exists).
5. Put the settings back (taking off push OFF, `2`), Save.

Other alerts happen on their own: "Reconnect needed" when a token is revoked (Instagram → Settings → Apps and websites → remove the app, then Sync now), "Sync failing" after 2 failed runs in a row, "Instagram access expiring" 7 and 2 days before expiry if refreshes keep failing, "Reach dropped" when 7-day reach is ≥ 20% below the previous 7 days (at most once a week per account).

## 5. Read what happened

- **Bell:** newest 20; unread ones carry a dot; "Mark all read" clears the badge.
- **`notifications` table:** `kind`, `severity`, `payload` (parameters only), `dedupe_key`, `created_at`, `read_at`.
- **`sync_runs.summary.alerts`:** `{ created, pushed, failed }` per tick. `failed` counts accounts whose rules could not be evaluated + push deliveries that failed + a failed insert. Never contains endpoints, keys or tokens.

## 6. Push troubleshooting

| Symptom | Check |
|---|---|
| Bell gets items, no push anywhere | Is push ON for that type (Settings → Alerts)? Is `sync_runs.summary.alerts.pushed` 0 with `failed` > 0? VAPID env in Vercel + redeploy; `VAPID_SUBJECT` must be `mailto:` or `https:`. |
| One device stopped getting pushes | Its subscription probably expired: the push service answered **404/410** and the sender **deleted that row** (by design). Re-enable on that device. |
| iPhone never asks for permission | Must be opened from the Home Screen icon, not Safari; iOS 16.4 or later; Settings → Notifications → in2sight allowed. |
| "Notifications are blocked" | Browser site settings → Notifications → Allow for `<app-url>`, reload, Enable again. |
| Push arrives but clicking opens the wrong page | Only same-origin paths are accepted; anything else opens `/overview` (by design). |
| After a deploy the app shows old assets | `sw.js` is served with `Cache-Control: no-cache` and activates at once; hard-reload once. To drop the cache entirely bump `VERSION` in `public/sw.js`. |

## 7. Offline and install checks

1. DevTools → Network → Offline → navigate to `/accounts`: the "You're offline" page appears (no account data). Back online → **Try again** works.
2. Lighthouse (Chrome DevTools) → "Installable" passes; the manifest shows name `in2sight`, start URL `/overview`, 192/512 and maskable icons.
3. Switch theme/mode in Settings: on Android/desktop app windows the title bar colour follows.

## 8. Smart alerts: quiet hours, morning summary, weekly review, spikes (Plan 17e)

Status: code done (review pending), NOTHING verified live. The timing maths was dry-run with fakes (48 ticks of a day, DST days in Europe/Berlin) and the SQL on PGlite (plan `docs/superpowers/plans/2026-11-01-17e-smart-alerts.md`, "Scratch-run result"). Report yes/no and numbers only; never paste endpoints or handles into a chat or an issue.

### 8.0 Migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261104000001_smart_alerts.sql` is written and NOT applied. It only replaces the `notifications_kind_check` constraint (adds `nonfollower_spike`, `unfollow_spike`, `digest`, `weekly_digest`); nothing existing is dropped and RLS is untouched. Do NOT deploy the 17e code first: the tick stores a tick's alerts in one batch, and a new kind refused by the old constraint would drop that whole batch (`alerts.failed` +1). Supabase CLI 3.x defaults to the local Docker stack, so every `sb.mjs` command carries `--remote` (`db query` against production needs an extra consent flag and is not used).
```
node --env-file=.env.local scripts/sb.mjs migration list --remote        # only 20261104000001 pending (plus any earlier pending file); nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs table:notifications      # before: 401 with code 42501 (anon denied)
node --env-file=.env.local scripts/sb.mjs db push --remote --dry-run     # exactly the pending file(s)
node --env-file=.env.local scripts/sb.mjs db push --remote --yes
node --env-file=.env.local scripts/sb.mjs migration list --remote        # N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs table:notifications      # after: still 401 with code 42501 (RLS untouched)
```
Before `db push`, the dry-run must list exactly the files you expect; if it lists an older migration too, stop and ask the owner. `db-probe.mjs` only sees tables and functions, so it cannot see a constraint: here it only shows that the table stays closed to anon. Check the constraint itself in the Supabase Dashboard SQL editor (read only): `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_kind_check';` lists ten kinds.

### 8.1 Settings
1. Settings → Notifications → Alerts: "Quiet hours" From 22:00, Until 08:00 (in your time format); the hint names 08:00. New switches "Unusual reach from non-followers", "Morning summary", "Weekly review" (all on); no "unfollows" switch.
2. Change Until to 07:00 → the hint says 07:00 → Save → reload: kept. Put it back (08:00), Save. 360 / 768 / 1280 px, light and dark.

### 8.2 Nothing at night (L1)
1. Leave a phone with notifications enabled overnight. Next morning: `sync_runs` rows between 22:00 and 08:00 may show `alerts.created` > 0 but `alerts.pushed` 0.
2. Quick test instead of waiting: set quiet hours to cover the current hour, Save, then Accounts → Sync now on an account with an alert due (e.g. "Post taking off" switched on at 1.5×, §4): the bell gets it, no push.

### 8.3 The morning summary (L1)
1. The first tick after 08:00: ONE push "Morning summary — N alerts are waiting under the bell." (N = unread alerts held overnight + token/auto-hide alerts of the last 24 h). Tapping it opens the Overview. The bell has a "Morning summary" item.
2. `notifications`: one row with `dedupe_key = 'digest:<today>'`; later ticks add none (`select count(*) from notifications where kind = 'digest' and created_at > now() - interval '1 day'` = 1).
3. Read every alert in the bell before 08:00 on another night: no summary that morning (only unread ones count).

### 8.4 The weekly review and lock-screen grouping (L4)
1. On your week's first day (Settings → Language & formats → week start), the morning push is "Weekly review" (with the held count if any) and opens the digest page (`/plan/digest`, Plan 17d).
2. A new summary replaces yesterday's on the lock screen (same tag) on Android and iPhone.

### 8.5 Non-follower spikes (L2)
1. Over the first two weeks, count `nonfollower_spike` rows. If they feel like noise, switch their push off (they stay in the bell) and tell the assistant (the guard is `NONFOLLOWER_MIN_REACH` = 50 in `lib/alerts/rules.ts`).
2. Unfollow spikes stay off until `docs/RUNBOOK_GROWTH.md` §2 passed; then flip `UNFOLLOW_SPIKE_ENABLED` in `lib/alerts/settings.ts` in a reviewed commit.

### 8.6 Tick duration (L3)
Compare `sync_runs.summary.durationMs` of three ticks before and after deploying: no visible change (one extra small read per account, one per tick).

## What to send me if it fails

The failing step number, the browser + OS, a screenshot without endpoints/keys, and the `summary` JSON of the latest `sync_runs` row.
