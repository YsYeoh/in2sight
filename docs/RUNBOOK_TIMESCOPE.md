# Time Scope live-verification runbook (Plan 12a)

Run this once after Plan 12a is deployed, with at least one account that has synced data for 30+ days (ideally one with 90 days of backfill, so "1 year" and "all" have something to show). Who: owner, or Claude with the owner. **Nothing here has been verified live yet**: the unit tests run in jsdom with fixed dates. No migration is needed for 12a; nothing here touches Supabase, Vercel or Meta settings.

The Time Scope lives only in the URL. Useful to know while testing:

| URL | Means |
|---|---|
| (no parameters) | last 30 days vs the previous 30 days, automatic buckets |
| `?from=7d` … `?from=1y`, `?from=ytd`, `?from=all` | a preset (rolling: bookmark it and it keeps meaning "the last N days") |
| `?from=2026-09-01&to=2026-09-30` | fixed days (the month picker writes this) |
| `&cmp=yoy` / `&cmp=none` / `&cfrom=…&cto=…` | same period last year / no comparison / custom comparison days |
| `&gran=day` / `week` / `month` | chart buckets (default: automatic) |
| `?period=30`, `?month=2026-09` | links from before 12a; they still work |

## 1. The bar at every width, theme and mode

On `/overview`, an account's Overview/Posts/Stories tabs and `/calendar`: 4 themes × light/dark at 360, 768 and 1280 px (browser dev tools → device toolbar → "Responsive").

| Width | What must hold |
|---|---|
| 360 | No horizontal page scroll (`document.documentElement.scrollWidth <= innerWidth`). The 8 preset buttons wrap onto two rows inside their frame; Custom, Compare and Group by wrap below them; the summary line ("Last 30 days · vs previous 30 days") wraps instead of overflowing. **Custom** opens a bottom sheet that scrolls; every date input and select is reachable. |
| 768 | Presets on one row, the selects next to or below them; **Custom** opens a centred dialog. |
| 1280 | Everything on one row; the dialog is narrow (not full width). |

In every theme and mode: the active preset is visibly highlighted (secondary button), the selects and date inputs use the theme's input border and background (no white box in dark mode), the summary line is readable muted text.

Keyboard only (no mouse): Tab reaches every preset, Custom, Compare and Group by; Enter on a preset navigates; arrow keys change the Compare/Group-by select and the page follows; in the dialog Tab moves through the five forms, Esc closes it. A screen reader announces the summary line after a change (it is a `status`).

## 2. Presets and numbers

1. Click each preset. Expect: the top progress bar runs, the URL shows `?from=…` (none for 30 days), the summary line names the range and comparison, numbers change, charts change buckets (90 days daily, 6 months and 1 year weekly, "All" weekly or monthly by length).
2. **7 days**: the KPIs equal what the old `?period=7` page showed (same numbers, same "vs previous 7 days"). Same for 30 and 90.
3. **1 year** and **All** with every account in view: note the load time (DevTools → Network → the document's Server-Timing, see docs/RUNBOOK_PERF.md). Expected within the RUNBOOK_PERF budget; write the numbers down. The daily reads page through 1,000-row pages, so nothing is cut at 200 days.
4. **YTD**: starts on 1 January of your timezone's year.
5. Charts: hover a weekly chart; the first and/or last week label ends in `*` and the note "* only partly inside the range" is under the chart. Missing days never show as 0 (a gap, not a drop).

## 3. Compare

1. Compare → **Same period last year**: before you have a year of data, the KPIs show their value with "Not enough history to compare yet", and the bar says "Data starts …: the comparison period is incomplete…". Never a fake +100 % change.
2. Compare → **No comparison**: the KPI cards show values only (no pill, no reason text).
3. Custom → "Compare with other days": pick 14 days from last month; the summary says "vs <those days>"; the comparison is cut to the length of the range.
4. Back to **Previous period**: the URL loses `cmp`.

## 4. Pickers

1. **Month**: pick the current month. It is compared with the same days of last month (e.g. 1–17 Oct vs 1–17 Sep), never with all of September. Pick last month (a finished one, e.g. September): compared with an equal-length window counted from the 1st of the month before (1–30 Aug, so 31 Aug is not part of it): the comparison is never longer than the current window, which keeps sums comparable.
2. **Week**: pick any day; the range is that week starting on your Settings → week start. Switch the week start (Monday ↔ Sunday) in Settings and pick again: the week moves.
3. **Quarter**: Q3 shows 1 Jul – 30 Sep; "Previous period" is Q2.
4. **Date range**: pick a range; the end cannot be after today (the date input stops there).

## 5. A range across a daylight-saving change (owner timezone)

Only meaningful when your Settings timezone observes DST (Kuala Lumpur does not: then skip this section and note "no DST in owner timezone"; the behaviour is covered by tests `tests/sync-time.test.ts` "daysToIso …" and `tests/dashboard-calendar.test.ts` "DST …"). **Do not switch the account's timezone just for this check**: the sync writes days in the owner's timezone, so the data itself would shift.

If your timezone has DST (e.g. Europe/London: last Sunday of October; America/New_York: first Sunday of November):
1. Custom → Date range from 5 days before the change to 5 days after.
2. Export Excel: the Daily sheet has exactly one row per day, none missing or doubled around the change.
3. Posts tab and Calendar: a post published around 23:30 local on the change day sits on that day (compare with the time Instagram shows).

## 6. Old links and hostile URLs

1. `/overview?period=30` → "Last 30 days"; `/overview?period=7` → "Last 7 days"; `/calendar?month=2026-09` → September 2026 as a month grid.
2. `/overview?from=2026-02-30&to=x`, `/overview?from=<script>`, `/overview?from=7d&from=30d` → the default (last 30 days), no error page.
3. `/overview?from=2001-01-01&to=<today>` → at most about 5 years (the start moves up).
4. `/overview?from=<a date next month>&to=<later>` → the default (nothing to show in the future).
5. `<app-url>/api/export/xlsx?scope=all&from=junk` → JSON `{"error":"bad_params"}` (400). `?scope=all&period=7` still downloads.

## 7. The scope travels

1. On Overview pick **90 days**, then click an account's @username: the account page shows 90 days.
2. Switch tabs (Posts, Stories, Overview): still 90 days (the tab URL keeps `from=90d`). Audience has no bar (it shows the latest snapshot).
3. Posts tab: change Format → the scope stays; **Reset** keeps the scope too. The count line reads "Showing X of Y posts": X is the posts in the table (the scope's days, then the Format and Tag filters); Y is the posts loaded for this page, not every post stored for the account. The page loads the newest 500 posts of the account, or every post back to the start of the range when that reaches further, so Y can include posts older than the range and posts the filters hide.
4. Stories tab: Stories of the range; with more than 200 in the range it says "Showing the newest 200 Stories of this range…".
5. "Overview" back link and the **Calendar** button keep 90 days; the sidebar/tab-bar **Overview** and **Calendar** items keep it; **Accounts**, **Tags**, **Settings** do not carry it.
6. Browser back/forward walk through the scopes you chose (the URL is the state).

## 8. Calendar

1. `/calendar` with no parameters: the last 30 days as whole weeks, days outside dimmed, titled "Last 30 days".
2. Month picker → the classic month view; the arrows step whole months; "next" is disabled for a month that starts after today.
3. The account select keeps the scope; the scope keeps the account.

## 9. Exports

1. **Export** on Overview: the dialog shows "Time range: <the bar's range> · vs …" (no 7/30/90 radio any more).
2. Excel for a month: the file is named `in2sight-all-2026-09-01_2026-09-30.xlsx`; Summary has From/To (each account's KPI window) and Compared from/to; Daily and Posts hold only that month.
3. PDF preview: the header names the days; KPI cards say "vs <comparison days>"; the trend uses the bar's granularity with `*` on partial buckets.

## 10. Language

Switch to 简体中文: presets read 7天 … 1年, 今年, 全部; the summary line, dialog, compare and group-by options are Chinese; dates follow Settings → date format.

## Known limits

- **All on the Posts tab and in the export's Posts sheet** lists every stored post up to 5 years back, even posts older than the first captured day. The KPIs and charts for All still start at the first captured day, and the Calendar for All starts at the first captured day too; older posts are in the Posts tab.
- **Exports reject a bad range** with `{"error":"bad_params"}` (400) instead of repairing it: a start after the end, more than 1,830 days, or a start in the future. (The pages still repair a hostile URL to the default or to about 5 years, section 6.)
- **Stories are capped at 200 per account per range** in the Stories tab and in exports. In the export, the xlsx Stories sheet carries a note saying it is capped, and the PDF shows the Stories count as "200+".

## Report back

Page, width, theme + mode, language, the URL (it holds the whole scope), a screenshot, and for numbers the account. Never screenshots of tokens or Supabase secret keys.
