# Runbook: app-shell tabs (Plan 14c)

The owner's live check of the browser-style tabs (UX polish design §4.3). Run it on the deployed preview (Vercel) and, where noted, on a phone. This is **Gate B**: if §1, §2 or §3 fails, report it before anything is pushed to production; the fallback is to revert the 14c commits (shell, root layout, `next.config.ts`, `public/sw.js`, `NavigationProgress` and new files only; no data, no migration) and build a lighter "recent pages" switcher instead.

How it works, in one paragraph: the top window is only the shell (sidebar, header, tab strip); every tab is a hidden-but-alive frame of the app showing one page without the shell. Switching only shows another frame, so nothing reloads. The frame tells the shell where it is and what its heading is; the shell keeps each tab's Back/Forward history itself, because the browser's history is shared by all frames.

## 0. Before you start
- Sign in on a desktop browser (Chrome or Edge), window at least 1280 px wide. Open the DevTools Network panel once and check that `/overview` answers with `content-security-policy: frame-ancestors 'self'`.
- If the app is installed as a PWA or was opened before this deploy, reload twice (the service worker updates on the first load and takes over on the second).

## 1. Switching keeps everything (desktop)
1. On Overview, pick "Last 90 days" (or any range other than the default). Scroll halfway down.
2. Click "Explorer" in the sidebar → a second tab "Explorer" opens. Change a metric.
3. Click the "Overview" tab in the strip. **Pass:** instant (no skeleton, no progress bar), the range is still 90 days and the scroll position is where you left it.
4. On Overview, ctrl-click (⌘-click on a Mac) an account name → a new tab "@name · Overview" opens. Open a post drawer there (Posts → click a cover).
5. Switch to Explorer, then back to the account tab. **Pass:** the drawer is still open, the metric you picked in Explorer is still picked.
6. Click "Explorer" in the sidebar again. **Pass:** it jumps to the existing Explorer tab (no new tab). Click "Accounts" in the sidebar while an account tab is open. **Pass:** a new "Accounts" tab opens (the list page is its own tab).
7. Middle-click a post's Post Lab flask icon, and click the small window icon next to it. **Pass:** each opens a Post Lab tab, the second click jumps to the tab the first one opened (same page).
8. Reload the browser (F5). **Pass:** the same tabs come back with their titles, the one you were on is active, the address bar shows its URL.
9. Copy the address bar, open it in a new browser window. **Pass:** that page is the active tab there (the tab list is shared; two windows are not kept in sync, by design).

## 2. Break-outs, sign-in, sign-out
1. In the user menu, sign out. **Pass:** the whole window shows the login page (no login inside a tab).
2. Sign in again. **Pass:** you land on Overview with your tabs restored.
3. Session expiry: in DevTools → Application → Cookies, delete the Supabase auth cookies, then click a link inside a tab. **Pass:** the WHOLE window goes to the login page, never a login form inside the tab.
4. Export → "Preview" on Overview. **Pass:** the report opens in a normal browser tab (not as an app tab).
5. Download an Excel export from inside a tab. **Pass:** the file downloads as before.

## 3. Memory and speed (desktop Chrome)
1. Open these 4 tabs: Overview (Last 90 days), an account's Posts tab (table view), Explorer, Calendar. Visit each once.
2. Chrome menu → More tools → Task manager. Find the in2sight tab's row (all frames share it). **Pass:** the row's memory footprint is at most about 4 × 150 MB = 600 MB (planning measurement with sample data: about 40 MB per tab). Write the number down.
3. Switch between the 4 tabs quickly. **Pass:** each switch is instant; no tab reloads.
4. Open 9 tabs. **Pass:** still smooth; the least recently viewed tab reloads (a short skeleton) when you go back to it — that is the 8-live-tab limit working.

## 4. Back and Forward
1. In one tab: Overview → click an account → click its Posts tab → open a post's Post Lab.
2. Use the ← button at the left of the strip three times. **Pass:** you step back Post Lab → Posts → account Overview → Overview, inside this tab only. → steps forward again.
3. Open a second tab and navigate in it. Switch back to the first tab and press ←. **Pass:** the FIRST tab steps back; the second tab does not move.
4. Alt+Left / Alt+Right, once with the focus in the tab strip and once after clicking inside the page. **Pass:** one step each time (if one key press steps twice, or the browser leaves the app, note it: browsers differ here).
5. The browser's own Back button: best effort only. It steps whichever tab navigated last; it is not per tab (the browser has one history for all frames). Expected, not a failure.
6. Note: Back shows the earlier page again with its URL state (range, filters, page number) but at the top of the page and with drawers closed.

## 5. Stale tabs and Refresh
1. Leave a tab unviewed for more than 30 minutes (switch to another tab and wait). Switch back. **Pass:** the Refresh button (↻ next to ← →) has a dot and its tooltip/label says the numbers may be out of date. Click it. **Pass:** the numbers reload without losing the scroll position; the dot is gone.

## 6. Notifications and Web Push
1. Bell → click a notification. **Pass:** it opens as a tab (or jumps to the tab that already shows exactly that page).
2. With Push enabled (Settings → Notifications) and the app open in a window, wait for an alert (docs/RUNBOOK_ALERTS.md §4 says how to trigger one) and click the system notification. **Pass:** the app window comes to the front and the page opens as a tab.
3. Close all app windows, click a Push notification. **Pass:** a window opens at that page, your saved tabs come back next to it.

## 7. Phone (360 px; a real phone or DevTools device mode)
1. **Pass:** no strip; the header shows "Tabs (1)". The bottom bar navigates inside the current tab (no new tab per tap).
2. Ctrl/long-press is not available on phones: use the small window icon on an account card or next to a post → "Tabs (2)".
3. Tap "Tabs (2)". **Pass:** a bottom sheet lists the tabs with the current one highlighted; ← → ↻ are at the top; tapping a tab switches and closes the sheet; ✕ closes a tab; "New tab" opens Overview.
4. Open 4 tabs and visit each. **Pass:** the first one reloads when you return to it (phones keep at most 3 tabs alive).

## 8. Themes, keyboard, screen reader
1. Switch light/dark (header button) and every theme (Settings, inside a tab). **Pass:** the shell AND every tab switch at once (check a second tab too); the active tab stands out, text is readable, no raw colours.
2. Switch the language in Settings. **Pass:** the whole app reloads in the new language with your tabs restored.
3. Keyboard only: Tab into the strip → ←/→ move between tabs and show them, Home/End jump, Delete closes the focused tab; Tab moves on to "+", the bell and then into the page. **Pass:** focus is always visible and never lands in a hidden tab.
4. Screen reader (NVDA/VoiceOver): the strip is announced as "Open tabs, tab list", each tab with its title and "selected"; close buttons say "Close <title>".

## 9. Known limits (by design)
- One browser history for all frames: the browser's Back button is best effort; use the app's ← →.
- All tabs share one browser process and thread: a very heavy page in one tab can make the others briefly sluggish; closing the tab frees it.
- At 768 px and 1024 px the page inside a tab is narrower than the window (the sidebar takes its width), so pages pick their layout by the tab's width. Expected; report anything that looks broken.
- Offline: the shell shows the offline page on a reload, a tab that navigates while offline shows the browser's own error inside the tab.
- Two browser windows share one saved tab list; the last one that changes it wins.
- Changing the date/time/number format, week start or timezone updates every tab's interactive parts at once; numbers and dates drawn on the server in OTHER tabs update on their next navigation or Refresh.

## What to send if something fails
The section and step, the browser and version, a screenshot, and for §3 the Task manager number. For a break-out failure, the URL shown inside the tab.
