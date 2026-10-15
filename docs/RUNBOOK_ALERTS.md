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

## What to send me if it fails

The failing step number, the browser + OS, a screenshot without endpoints/keys, and the `summary` JSON of the latest `sync_runs` row.
