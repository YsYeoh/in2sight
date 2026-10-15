# Loading feedback and navigation speed runbook (Plan 10)

Who: the owner (signed in), or Claude with the owner. Nothing here changes Supabase, Vercel or Meta settings. Measure **before** deploying Plan 10 (§1 on the current production site) and **after** (same steps), and note both in the table in §5.

## Budgets

| What | Budget | How it is met |
|---|---|---|
| Click → visible feedback | ≤ 100 ms | top progress bar on the click; orb on the clicked nav item after 100 ms if still pending |
| Click → page-shaped skeleton | ≤ 300 ms | `loading.tsx` per route (prefetched in production) |
| Warm page data (2nd visit, owner's data volume) | ≤ 1.2 s p75 | one owner check per request, parallel reads, streamed account tab and bell |

## 1. Measure (before and after)

1. Chrome → DevTools → Network, tick "Disable cache" off (warm), throttling "No throttling". Sign in, open `/overview` once (warm-up).
2. Click each nav item in order: Overview → Accounts → an account → Posts tab → Calendar → Tags → Settings. For each request named like the page (`overview?_rsc=…`, or the document on a hard reload):
   - **Timing** tab → "Server Timing" shows `auth` (the proxy's session check) and `proxy` (all proxy work). After Plan 10 only.
   - "Waiting for server response" = TTFB. Render time on the server ≈ TTFB − `proxy`.
3. Repeat each click 5 times; write down the median and the slowest (≈ p75 for 5 samples) TTFB and the moment the skeleton appeared (Performance panel → screenshots, or just eyeball: did the bar/skeleton appear at once?).
4. Optional, from a terminal (copy the `Cookie` header of a signed-in request from DevTools; it is a secret — never paste it anywhere else and close the terminal afterwards):

```bash
curl -s -o /dev/null -H "Cookie: <paste>" -w "ttfb=%{time_starttransfer}s total=%{time_total}s\n" https://<your-app>/overview
curl -s -D - -o /dev/null -H "Cookie: <paste>" https://<your-app>/overview | grep -i server-timing
```

5. Optional: Lighthouse (DevTools → Lighthouse → Navigation, Mobile) on `/overview` signed in; note LCP and TBT.

## 2. Every navigation control gives feedback

Tick each on a phone-width window (360 px) and on desktop (1280 px):

- [ ] Sidebar / icon rail / bottom tab bar items: top bar starts at once; on a slow click the item's icon turns into the small orb.
- [ ] Overview: an account card title → account skeleton (header, tabs, KPI blocks), never the accounts-list skeleton.
- [ ] Overview: period 7 / 30 / 90 → bar; content updates.
- [ ] Account page: Overview / Posts / Stories / Audience tabs → bar; header and tab bar stay; the tab area shows its skeleton, then the data.
- [ ] Posts: Apply filters → bar, no full page reload (the page does not flash white; scroll position resets to top is OK); Reset → bar.
- [ ] Calendar: prev / next month → bar; account picker → bar, no full reload.
- [ ] Accounts: Sync now → status line "Syncing @name…" with the orb until it finishes.
- [ ] Archive / Delete / tag delete confirm buttons, Export download, Settings save/enable/disable, 2FA, tag create/rename/save, login and code buttons, "Mark all read" → orb in the button while working.
- [ ] Browser back / forward → no bar stuck on screen.
- [ ] Double-click a nav item, or click two items quickly → one bar, it ends.
- [ ] Kill the network (DevTools → Offline) and click a nav item → the bar ends within 12 s (Next then shows the offline page or reloads).

## 3. The orb and skeletons in every theme

On `/styleguide` (signed in) → "Insight Orb" group, and on each route's skeleton (DevTools → Network → throttling "Slow 4G" makes skeletons visible): 4 themes × light/dark.

- [ ] Orb: glow, three arcs turning at different speeds, a sparkline drawing itself inside; colours follow the theme; the sparkline is readable (light line on the orb in light mode, dark line in dark mode).
- [ ] Top bar: thin gradient line at the very top, above the header, visible in every theme.
- [ ] Skeleton shapes match the page (cards where cards appear, table rows where the table appears) — no big jump when the content arrives.
- [ ] OS setting "Reduce motion" on (Windows: Settings → Accessibility → Visual effects → Animation effects off; macOS: Accessibility → Display → Reduce motion): orb arcs stand still and spread around the orb, the orb pulses slowly, skeletons do not pulse, the top bar is a static faint line.
- [ ] Screen reader (NVDA / VoiceOver): opening a slow page announces "Reading your insights…" once; buttons announce "busy".

## 4. Streaming checks (cannot be unit-tested end to end)

- [ ] Hard reload `/accounts/<id>?tab=posts` with "Slow 4G": the header and tabs appear before the posts table.
- [ ] Hard reload any page: the bell shows a grey square first, then the bell with its badge; the page content does not wait for it.
- [ ] Switching account tabs: watch whether the WHOLE account skeleton (route `loading.tsx`) shows instead of only the tab skeleton. Expected: header and tabs stay. If the whole skeleton shows, note it in §5 — the fix is a follow-up decision (it does not lose data).
- The error path (a tab query failing after the header rendered → the "Something went wrong" page) is covered by `tests/account-page.test.tsx`; do not break production to see it.

## 5. Results

| Page | TTFB before (median / slowest) | TTFB after | `auth` span after | Skeleton at once? | Notes |
|---|---|---|---|---|---|
| /overview | | | | | |
| /accounts | | | | | |
| /accounts/[id] (overview tab) | | | | | |
| /accounts/[id]?tab=posts | | | | | |
| /calendar | | | | | |
| /tags | | | | | |
| /settings | | | | | |
