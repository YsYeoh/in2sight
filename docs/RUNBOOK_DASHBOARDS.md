# Dashboards visual-verification runbook (Plan 6, part 1)

Run this twice: once right after Plan 6 part 1 lands (styleguide samples only), and again once real data exists (at least one account synced for 14+ days, `docs/RUNBOOK_SYNC.md` passed). Who: owner, or Claude with the owner. Nothing here touches Supabase, Vercel or Meta settings.

## 0. Start

```bash
npm run dev        # http://localhost:3000
```

- `/styleguide` works without signing in: stat cards, line/area/bar charts, the best-time heatmap and the data table with fixed sample data.
- `/overview` needs the owner session (and real data for step 3).

## 1. The matrix

For each page below check every cell: 4 themes (Ink, Sunset, Forest, Mono) × light/dark, at 360, 768 and 1280 px wide. Switch theme/mode with the bar at the top of `/styleguide` or Settings; the choice applies to every page. Browser dev tools → device toolbar → "Responsive", type the width.

| Width | What must hold |
|---|---|
| 360 | No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`). Stat cards 2 per row; account cards 1 per row; the comparison table shows as cards with a "Sort by" select; heatmap squares shrink but every row stays on screen. Long `@usernames` end in "…". |
| 768 | Table view (not cards) for the comparison; account cards 2 per row; period selector fits next to the title or wraps under it cleanly. |
| 1280 | Stat cards 4 per row; account cards 3 per row; chart legends on one line for up to 4 accounts. |

In every theme and mode:
- Chart lines/bars use the theme's chart colours (compare with the "Chart series" swatches at the top of `/styleguide`); grid lines are dashed and faint; axis text readable.
- Tooltip (hover a chart): surface background, border, readable text in dark mode.
- Delta pills: green-ish for good, red-ish for bad, grey for flat; the sign (+/−) is always in the text.
- Heatmap: darker = more; greyed cells are the "too few posts" ones; the Low→High scale matches.
- Nothing uses a colour that ignores the theme (a white box in dark mode is a bug).

## 2. Motion

- OS setting "reduce motion" on (Windows: Settings → Accessibility → Visual effects → Animation effects off; macOS: Accessibility → Display → Reduce motion): reload; charts appear without the draw-in animation, cards without the fade.
- Phone or DevTools "touch" emulation: same as above for heavy effects (none in part 1; part 2's globe/particles must stay off).

## 3. With real data (`/overview`)

1. Period selector 7 / 30 / 90 days: numbers change, the URL shows `?period=…`, "vs previous N days" follows.
2. Compare one account's 7-day reach on its card with Instagram's app (Professional dashboard → Insights → Accounts reached, last 7 days). Expect the same order of magnitude, not an exact match: we sum daily reach (SPEC §7), Instagram shows unique accounts.
3. An account under 100 followers: net follows show "Instagram shares this from 100 followers".
4. A freshly connected account: card says "Importing history…" until the first daily sync writes a day.
5. An account in `needs_reconnect`: red "Needs reconnect" badge + link to `/accounts`.
6. Comparison card: group scope first (if a group has 2+ accounts), "All accounts" widens it; isolated accounts appear only under "All accounts".
7. Language switch to 简体中文: every label is Chinese, numbers/dates follow Settings → formats.

## What to send if something looks wrong

Page, width, theme + mode, language, a screenshot, and (for numbers) the account and period. Never screenshots of tokens or the Supabase dashboard's secret keys.
