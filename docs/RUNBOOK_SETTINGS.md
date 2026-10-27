# Runbook: Settings redesign (Plan 16a) — live checks

Plan 16a is code complete on local `main`, NOT pushed. Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app, in this order. Report yes/no per step.

## 0. The migration (Auto mode) — BEFORE deploying, on the owner's go-ahead
`supabase/migrations/20261030000001_prefs_auto_mode.sql` widens the `profiles.mode` CHECK list to `light, dark, auto` (nothing else). It is NOT applied.
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only 20261030000001 pending
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly that file
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect N local / N remote / 0 mismatched
```
If `drop constraint profiles_mode_check` fails (a different name), STOP: the file runs as one transaction, so nothing was changed; report the error. Without the migration, choosing Auto applies on the device but shows the "Couldn't save" toast with Retry (by design: visible, not silent).

## 1. Routes and the shell tab
1. User menu → Settings: the tab shows `/settings/appearance` (redirected), title "Settings". `/settings?tab=account` → Security; `/settings/bogus` → not found.
2. Each section from the left list (desktop) and from the "Section" select (phone width): the URL changes, Back/Forward in the tab strip move between sections, Refresh keeps the section.
3. Inside the tab nothing breaks out to the top window; Reconnect (Accounts & sync) and Connect leave the shell as before (Instagram login in the whole window).

## 2. Appearance and Language & formats (instant save)
1. Change theme, mode, density, corners: the whole app changes at once, the preview card too, a "Saved" toast appears once (not stacked). Another open tab follows within a second.
2. Auto: with the device in dark mode the app is dark at once and after a reload there is NO light flash; switch the device to light: the app follows without reload. The header moon/sun toggle switches to the opposite of what is shown.
3. Failure path: DevTools → Network → Offline, change density: the change applies, an error toast with Retry stays; back Online → Retry → "Saved". Reload: the density is the saved one.
4. Language & formats: date / number options show samples; the Example line changes with every pick; timezone UTC moves the example from 15 Mar to 14 Mar; switching language reloads the app in the new language (zh-CN strings fit at 360 px).

## 3. Notifications
1. This device: Enable → permission prompt → "On for this device"; **Send a test notification** → a notification "in2sight test" arrives on THIS device only (other devices stay silent). Turn off works.
2. Alert rules: Save is disabled until a change; change a threshold → "You have unsaved changes" bar stays visible at the bottom while scrolling (phone: above the bottom bar); Discard restores; Save → "Saved" and the server's value (e.g. 500 % becomes 90). With a change pending, pick another section → "Leave without saving?"; Cancel stays; reload → the browser's leave prompt.
3. Devices: each device as "Browser · System — Added date"; Remove asks, then the row disappears. Removing the current device: push stops for it; the card above may still say "On" until it is turned off and on (known limit).

## 4. Accounts & sync
1. Each active / needs-reconnect account with status, token days, last sync; archived accounts not listed; "Manage accounts" opens `/accounts` in the same tab.
2. Sync now on one account: a "Syncing…" line, then "Synced @name" and a fresh last-sync time (up to about a minute; no timeout before 60 s). A second Sync now on the same account while running → "A sync is already running for this account."
3. An account without the comments scope shows "Reconnect to enable comments".

## 5. Security and Data & privacy
Security shows "Signed in as" and two-factor exactly as before (enrol / disable still work); password and sessions: docs/RUNBOOK_SECURITY.md. Data & privacy (Plan 16c): storage used, export your data and delete all data; live checks in docs/RUNBOOK_DATA.md.

## 6. Layout and a11y
Every section at 360 / 768 / 1280 px in light and dark of two themes: no horizontal scroll, one control height per row, no pill walls. Keyboard only: Tab through the section list (the open one is announced as current page), every control has a label, saved / error messages are read out.

## Known limits (by design)
The unsaved-changes guard does not cover the shell's sidebar, tab strip, bottom bar, closing a tab or browser Back. The devices list does not mark this device. Auto mode's browser-bar colour follows after the page loads.
