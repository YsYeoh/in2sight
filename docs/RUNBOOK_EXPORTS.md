# Exports live-verification runbook (Plan 9)

Run this once after the app is deployed on its HTTPS URL (`<app-url>` = your `NEXT_PUBLIC_APP_URL`) with at least one account that has synced data. Who: owner, or Claude with the owner. **Nothing here has been verified live yet**: the unit tests use a fake browser, because headless Chromium cannot run inside the tests (and `@sparticuz/chromium` only runs on Linux).

Never paste tokens, cookies or `SUPABASE_SECRET_KEY` into chats, screenshots or tickets. Exported files contain your Instagram data: share them deliberately.

## 0. Before you start

- `NEXT_PUBLIC_APP_URL` in Vercel is the exact public origin (`https://…`, no trailing slash). The PDF route only ever opens `<app-url>/report/print`; with a missing or `http://` URL it answers `not_configured`.
- `REPORT_SIGNING_SECRET` is **not used** (Plan 9 hands the report to Chromium over the DevTools protocol instead of a signed link). You can leave it empty.
- If Vercel **Deployment Protection** is on for the URL you test (typical for preview URLs), the headless browser gets Vercel's login page instead of the report. Test on the production domain, or add a Protection Bypass for Automation (Vercel → Project → Settings → Deployment Protection) and tell Claude before changing anything.

## 1. Excel (any machine)

1. `<app-url>/overview` → **Export** → Format **Excel workbook** → Accounts **All accounts** → 30 days → **Download**. A file `in2sight-all-<date>.xlsx` is saved; the dialog says "Download started".
2. Open it in **Excel** and in **LibreOffice Calc** (both must open without a repair prompt). Check:
   - Six sheets: Summary, Daily, Posts, Stories, Audience, Tags (in Chinese when the app language is 简体中文: 概要, 每日数据, 帖子, 快拍, 受众, 标签).
   - The header row is bold and stays visible when scrolling (frozen).
   - Date columns are real dates (right-aligned; sorting and filtering by date work) shown in your Settings date format (try switching Settings → date format and exporting again).
   - Number columns are numbers (SUM works), engagement and shares show as `%`.
   - Missing values are empty cells, not `0` (e.g. Link taps, or reach of a post Instagram never measured).
   - A caption or tag starting with `=`, `+`, `-` or `@` shows with a leading `'` and is **not** evaluated. Click into such a cell and press Enter: it must stay text.
3. Export one account from its Account detail page (**Export** is next to Calendar; the account is preselected). File name `in2sight-@<username>-<date>.xlsx` (browsers that cannot save `@`/emoji use the ASCII fallback name).
4. An account with a slash, emoji or Chinese in its group name: export the group; the file name keeps the characters (slashes become `-`).

## 2. PDF report preview (any machine, no Chromium)

1. **Export** → Format **PDF report** → pick sections, a title in Chinese (e.g. `十月报告`) and a two-line note → **Preview in the browser**. A new tab opens `/report?…` with the report, always light even when the app is in dark mode.
2. Check every section renders with your data, the globe is absent, charts are drawn (no animation in print).
3. Ctrl+P (Save as PDF, A4): sections are not split across pages where avoidable; colours print (heatmap, chart lines).

## 3. PDF on Vercel (the real check)

1. **Export** → **PDF report** → all sections → **Download**. The first PDF after a quiet spell can take 10–30 s (Chromium unpacks to `/tmp`); a second one right after should be clearly faster. Note both times.
2. Open the PDF:
   - A4 pages, light background, your title and note at the top, the date range in your date format.
   - **Chinese text renders as Chinese, not boxes ("tofu")**: title, section headings (switch the app to 简体中文 and export again), captions with Chinese, emoji may show as boxes in a few places (no emoji font is bundled; acceptable).
   - Charts and heatmaps are complete (not mid-animation).
3. Vercel → Project → Deployments → the deployment → **Functions**: `/api/export/pdf` size is shown (expect roughly 70–80 MB compressed; the limit is 250 MB unzipped). Logs → filter `/api/export/pdf`: duration under 60 s, memory used. If memory is near the limit, raise the function memory (Vercel → Settings → Functions) to 2 GB+.
4. Open `<app-url>/report/print` in a private window: it shows only "Preparing the report…", with no data and no error. That page never has data unless the PDF route injected it.

## 4. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Dialog says "PDF export is not configured…" | `NEXT_PUBLIC_APP_URL` missing, `http://`, or has a path typo | fix it in Vercel env, redeploy |
| Dialog says "The PDF could not be generated" every time | Chromium failed to launch (logs: `pdf export: render failed`), Deployment Protection page, or a timeout | check the function log time and memory; test on the production domain; retry once (cold start) |
| PDF shows Vercel's login page | Deployment Protection on that URL | §0 |
| Chinese shows as boxes | fonts not loaded before printing (slow network to `/_next/static/media`) | export again; if it persists, tell Claude (the renderer waits for `document.fonts.ready`) |
| Excel opens with a repair prompt | a bug in the writer | keep the file private and tell Claude which sheet |
| "Your session has ended" | signed out or 2FA expired while exporting | sign in again |

## 5. Trying the PDF route locally (optional)

`@sparticuz/chromium` only runs on Linux. To try the route on Windows/macOS, set `CHROMIUM_PATH` in `.env.local` to an installed Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`), run `npm run build && npm start` with `NEXT_PUBLIC_APP_URL=http://localhost:3000`, and export a PDF. Remove `CHROMIUM_PATH` afterwards; never set it in Vercel.
