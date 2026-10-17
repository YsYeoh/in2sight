# Dashboards visual-verification runbook (Plan 6 part 1 + Plan 7)

Run this twice: once right after Plan 6 part 1 lands (styleguide samples only), and again once real data exists (at least one account synced for 14+ days, `docs/RUNBOOK_SYNC.md` passed). Who: owner, or Claude with the owner. Nothing here touches Supabase, Vercel or Meta settings.

## 0. Start

```bash
npm run dev        # http://localhost:3000
```

- `/styleguide` needs you signed in (it is only public while Supabase is not configured): stat cards, line/area/bar charts, the best-time heatmap and the data table with fixed sample data.
- `/overview` needs the owner session (and real data for step 3).

## 1. The matrix

For each page below check every cell: 4 themes (Ink, Sunset, Forest, Mono) × light/dark, at 360, 768 and 1280 px wide. Switch theme/mode with the bar at the top of `/styleguide` or Settings; the choice applies to every page. Browser dev tools → device toolbar → "Responsive", type the width.

| Width | What must hold |
|---|---|
| 360 | No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`). Stat cards 2 per row; account cards 1 per row; the comparison table shows as cards with a "Sort by" select; heatmap squares shrink but every row stays on screen. Long `@usernames` end in "…". |
| 768 | Table view (not cards) for the comparison; account cards 2 per row; the Time Scope bar wraps under the title cleanly (its own checks: docs/RUNBOOK_TIMESCOPE.md). |
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

1. Time Scope presets (since Plan 12a; details in docs/RUNBOOK_TIMESCOPE.md): numbers change, the URL shows `?from=…`, "vs previous N days" follows.
2. Compare one account's 7-day reach on its card with Instagram's app (Professional dashboard → Insights → Accounts reached, last 7 days). Expect the same order of magnitude, not an exact match: we sum daily reach (SPEC §7), Instagram shows unique accounts.
3. An account under 100 followers: Instagram returns little data, so the card shows dashes and a short reason instead of numbers (never 0, NaN or a fake change).
4. A freshly connected account: card says "Importing history…" until the first daily sync writes a day.
5. An account in `needs_reconnect`: red "Needs reconnect" badge + link to `/accounts`.
6. Comparison card: group scope first (if a group has 2+ accounts), "All accounts" widens it; isolated accounts appear only under "All accounts".
7. Language switch to 简体中文: every label is Chinese, numbers/dates follow Settings → formats.

## 4. Account detail, Tags, Calendar (Plan 7, real data)

None of these pages (nor the globe) has been viewed in a browser yet; this section is the first visual pass.

### 4.0 Apply the tags migration (owner, once, BEFORE the deployed code is used)

On the owner's go-ahead only: `npx supabase db push` applies `supabase/migrations/20261017000001_tags.sql` (tables `tags`, `media_tags`). Do this before using the deployed code: until it runs, the Tags page and the Posts tab fail to load (error page with "Try again"); Overview, the other account tabs and Calendar keep working. Afterwards, in the Supabase dashboard open Advisors, then Security: there must be no new warnings for `tags` / `media_tags` (both have RLS and one owner policy).

### 4.1 Account detail (`/overview`, click an account's @username)

Run the section 1 matrix (4 themes x light/dark x 360 / 768 / 1280) on each tab:

| Tab | What must hold |
|---|---|
| Overview | 6 stat cards (2 per row at 360, 3 at 768, 6 at 1280) each with "vs previous N days" (or the comparison days) or a reason; the Time Scope bar keeps you on the page and the tab (`?tab=…&from=…`); reach/views and followers charts; format comparison table (cards at 360); flags list or "Nothing unusual"; best-time heatmap defaults to **Followers online**, toggles to **Your post performance** and to the pooled scope; greyed cells for < 2 posts; the reason line when data is missing. |
| Posts | The days come from the Time Scope bar (the tab has no date inputs of its own); Format and Tag filters change the URL and the rows; "Reset" clears Format and Tag but keeps the scope; 50 rows then "Show more"; at 360 rows become cards with a Sort-by select; caption snippets end in "..."; the external-link icon opens Instagram in a new tab; "Edit" opens the tag dialog (a bottom sheet at 360). |
| Stories | Captured Stories of the Time Scope's days (newest 200 per account; more than that says so), Live/Expired badge, final numbers and exit rate, a views sparkline; a Story under 5 viewers says so. Compare one expired Story's views with Instagram's Story insights (same order of magnitude). |
| Audience | Countries (top 8 + Other, names in the UI language), cities, age x gender bars with a legend. On a desktop with motion allowed the **globe** spins next to the country list; with reduced motion, on a phone/tablet (touch emulation) or with Save-Data it is absent and only the list shows. Switch theme while the globe is visible: it recolours on the next frame. |

Also check: keyboard (Tab to the tab list, left/right arrows move focus, Enter opens the tab; the URL shows `?tab=...`); `/accounts/<garbage>` and an archived account's URL show the 404 page; the "Calendar" button opens the calendar filtered to this account.

### 4.2 Tags (`/tags`)

1. Create `🔥 Hot`, `عروض`, `幕后花絮`; creating `HOT` again (other case) shows "A tag with this name already exists."
2. A 40-character name is accepted, 41 is refused with the length message.
3. Tag 5+ posts with one tag from an account's Posts tab: its row loses the "Needs 5+ measured posts" note; the "Untagged" row counts the rest.
4. Rename and delete a tag: posts keep their numbers; the deleted tag disappears from every post.

### 4.3 Calendar (`/calendar`, also in the main navigation)

1. Month grid on 768/1280 with weekday headers starting on your week start (Settings, formats); agenda list at 360 (only days with posts or Stories). The bottom bar has 5 items at 360 and they all fit.
2. A post published just after midnight in your timezone sits on that day, not the day before (compare with the post time in the Posts tab).
3. Previous/next month links; the account select narrows to one account and the choice survives month changes.
4. Click a day: its list (time, format, account, caption, link) shows under the grid.

## What to send if something looks wrong

Page, width, theme + mode, language, a screenshot, and (for numbers) the account and period. Never screenshots of tokens or the Supabase dashboard's secret keys.
