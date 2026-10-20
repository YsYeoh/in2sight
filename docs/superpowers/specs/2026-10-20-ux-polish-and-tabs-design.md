# UX polish pass and app-shell tabs (design)

Date: 2026-10-20. Status: draft for owner approval. Owner: the single owner/user of in2sight (private dashboard, desktop-first, phone supported).

## 1. Intent and why

The product works, but the owner finds the screens crowded and inconsistent: too many filters open at once ("end users get confused"), raw lower-case range labels (`7d`, `1y`), a Time Scope bar that appears on pages where it does not belong, section tabs with ugly native scroll arrows, header buttons of different heights, the ugly default browser scrollbar, and no way to keep two accounts open side by side without reloading. The owner wants **the current base improved first** (before the remaining roadmap: Followers & Growth Center, Settings redesign, Weekly planning), and wants **what we learn recorded as a standard** so every future screen follows it from the start.

Success looks like: a screen shows only the few controls a person needs, everything else is one click away under an Advanced/More button; every screen looks like it belongs to the same product (same control height, same tabs, same scrollbar, same range wording); the owner can open several pages as tabs inside the app and switch instantly without losing state.

## 2. Goals, non-goals, anti-goals

Goals
1. A shared, simplified **range filter** ("Last 7 / 14 / 30 days" visible, everything else under "More ranges").
2. A shared **filter toolbar pattern** (important filters visible, rest under an "Advanced" button with an active-count badge, removable chips, Clear all) used by Explorer, Posts, Stories and any later list.
3. **Account page:** Audience moves into Overview; section tabs become Overview / Posts / Stories as plain underlined tabs. The shared range filter shows only on pages that show trends and insights.
4. **Posts and Stories get their own filters**, open on All time, newest first, with real **pagination**.
5. **One control height / one set of button rules**, a **standard themed scrollbar**, no lower-case or abbreviated range labels anywhere.
6. **Explorer** restructured to the toolbar pattern (no tall left column).
7. **App-shell tabs** (browser style) that keep each tab alive so switching never reloads, several tabs at once, the left sidebar kept.
8. A written **UI standard** (`docs/UI_STANDARDS.md`) plus CLAUDE.md rules and automated guards, written as the work lands.

Non-goals: no new data capture, no new analytics, no changes to the sync, no change to the Time Scope URL contract (`?from&to&cmp&cfrom&cto&gran` and the old `?period=`/`?month=` links keep working), no redesign of colors/themes, no change to the phone bottom tab bar, no drag-to-reorder or pin for tabs in v1, no multi-window support.

Anti-goals (a failure even if it technically works): hiding a control so deep that the owner cannot find it; a filter change that silently resets other filters; tabs that reload every time you switch; a tab strip that makes the app slow or runs out of memory; any raw color or fixed pixel layout width creeping in (CLAUDE.md rules still apply).

## 3. Decisions made by the owner (as stated)

- The **left sidebar stays** (icon rail on tablet, full labels on desktop, bottom tab bar on phones).
- **Tab strip placement: in the existing top header row**, to the left of the bell / theme toggle / user menu (option A of the mockup).
- **Sidebar click:** opens a new tab the first time; if that page already has a tab, jump to it.
- **Links inside a page** (my recommendation, the owner accepted): a normal click navigates inside the current tab (back button steps back within the tab); ctrl-click, middle-click or a small "open in new tab" icon (account cards, posts, Post Lab links) opens a new tab, or jumps to the tab that already has that exact page.
- Range filter: show only **Last 7 Days / Last 14 Days / Last 30 Days**; 90 days, 6 months, 1 year, YTD, All time, Custom, **Compare** and **Group by** all inside "More ranges". Full words, not `7d`.
- The range filter is for **Overview, trends and insights only** (Overview, account Overview, Calendar, Explorer, exports). **Not** for Posts and Stories.
- **Audience** merges into the account **Overview** (shares its range filter).
- **Posts:** search by caption text (and tag name), posted-date filter with its own quick choices (Last 7/30/90 days, This year, All time, custom dates), Format, Tag, Sort (newest, most reach, best engagement); active filters as removable chips + Clear all. **Stories:** posted-date filter (same quick choices), Sort (newest, most views, highest exit rate), a "measured / not measured" toggle (Stories under 5 viewers have no numbers); no search (no caption).
- **Posts and Stories open on All time, newest first, with pagination** (page numbers), not "Show more". This also removes the 200-Stories-per-range cap (pages are read from the database).
- **Explorer:** always visible: range bar, Break down by, "N metrics ▾", "All accounts ▾", Saved views. Under **Advanced**: Chart metric, Group, Format, Tag, Weekday, Hour posted, Stories opt-in. Changes **apply as they are picked** (the Apply button goes away); Reset stays; chips for active filters.
- A **standard scrollbar**: thin (8 px), rounded, quiet until hover, drawn from theme tokens so it works in every light/dark theme, applied everywhere something scrolls.
- All header/action buttons have **the same height** (today Export is `default`, Calendar and Open on Instagram are `sm`).
- The same fixes apply **system-wide**, not only on the account page (Overview, Calendar, Explorer, Tags, Settings, Accounts).
- Afterwards: **record the lessons** and apply them to future work.

## 4. Design

### 4.1 Standard controls (foundation, built first)
- **Control height:** one token (`--ctl`, already used by the shell) drives every button, select, input, segmented control and icon button in a row. Only table/dense contexts may use a smaller size, never in the same row as a normal control. Header action rows use one size (default) for all buttons including link-buttons.
- **Scrollbar:** global CSS (`scrollbar-width: thin; scrollbar-color` plus the `::-webkit-scrollbar` equivalents) in `styles/`, using tokens (a thumb from the muted/border family, a hover step). Opt-out class only where a scroller must be hidden. Note the CLAUDE.md density un-layered caveat: put it where tokens apply and verify in every theme.
- **Underline tabs:** `components/ui/tabs.tsx` gets an underline variant (default for page sections). No native scroll arrows; if tabs ever overflow, they scroll sideways with a fade edge and a hidden scrollbar. Labels are full words.
- **Range labels:** every preset gets a full-word translated label ("Last 7 Days"); nothing shows `7d`, `1y`, `YTD`. English and zh-CN. Use title case for the three visible presets as the owner wrote them.
- **`RangeBar`** (replaces the visible part of `TimeScopeBar`): segmented Last 7/14/30 days + a "More ranges" button opening a popover (a bottom sheet on phone) with: remaining presets (Last 90 days, Last 6 months, Last year, Year to date, All time), Custom dates (the existing picker, week/month/quarter pickers), Compare with (previous period / same period last year / custom days / none), Group by (auto/day/week/month). If the active range is not one of the three visible presets, the button shows its name (for example "Last 6 months ▾") so the state is never hidden. The summary line below ("Last 30 days · compared with the previous 30 days", "Data starts …") stays.
- **`FilterToolbar`** pattern: a wrapping row of equal-height controls; each non-trivial control (multi-select, advanced group) is a button opening a popover/sheet; an **Advanced** button with a badge counting active advanced filters; removable chips for every active filter; Clear all. Filters are URL state (as today) so links and saved views keep working. Apply-as-you-pick means a change updates the URL (debounced for text search, immediate for selects), with the page showing its existing loading feedback.

### 4.2 Pages
- **Account page:** `AccountView` tabs become Overview / Posts / Stories (underline tabs). Audience content (countries, cities, age, gender, the globe) becomes a section at the bottom of Overview. The old `?tab=audience` link redirects to Overview (scrolled to the section). The RangeBar shows on Overview only (inside the page, not above the tabs); Posts and Stories show their own FilterToolbar.
- **Posts tab:** FilterToolbar (search, posted date, Format, Tag, Sort; advanced if more are added); server-side pagination (page size 24 grid / 50 table, page in the URL as `?page`, plus first/prev/next/last with the current page and total); Grid | Table toggle stays. Defaults: All time, newest first. The page reads one page at a time from the database with the same ownership rules; counts for "N posts" come from a count query.
- **Stories tab:** FilterToolbar (posted date, Sort, measured toggle); the day-grouped filmstrip stays; pagination is by **day groups** (for example 7 days per page) so a day is never split across pages (my call). Defaults: All time, newest first.
- **Overview (all accounts), Calendar, Explorer, exports:** keep the RangeBar. Explorer moves to the FilterToolbar layout (section 3). Calendar keeps its month navigation.
- **Other pages** (Tags, Settings, Accounts list, Post Lab): get the control-height, scrollbar, tabs and button rules; no filter redesign unless they have filters (none now). Post Lab keeps its own two toggles.

### 4.3 App-shell tabs
- **What a tab is:** one page (a URL). It keeps its own state: range, filters, scroll position, open drawer.
- **How it is built (my call, to be proven by a first spike):** each tab is an `<iframe>` of the same-origin app, kept mounted and hidden while inactive, hosted by a client component in the shell (`TabHost`). The framed page renders **without the sidebar/header chrome**: the layout detects `Sec-Fetch-Dest: iframe` on the request (the browser sends it on every framed navigation, including links clicked inside the frame, so no query flag can get lost), and the top-level document is the shell plus tab host only. Why: Next.js cannot keep several instances of dynamic server-rendered routes alive in one page, and this keeps every existing page unchanged; state really is preserved because the frame is never unmounted. No `X-Frame-Options`/frame-ancestors header exists today (verified), so same-origin framing works.
- **Tab strip:** in the header row. Each tab shows a title (for example "@yseny_ · Overview", "Explorer") and a close button; "+" opens a new tab (on the Overview page); the active tab is highlighted; tabs shrink then scroll sideways. Titles come from the framed page via `postMessage` (the frame reports `{title, url}` after each navigation).
- **Rules:** sidebar click → new tab or jump to the existing tab of that page (match on path; for the account list "Accounts", match the list page, not account pages); in-page links stay in the tab; ctrl/middle-click or the "open in new tab" icon → new tab or jump to the tab with that exact URL (frames post `open-tab` to the shell); closing the active tab activates its neighbour; closing the last tab opens Overview. Max **8 live tabs**: opening a 9th discards the least-recently-used inactive frame (its tab stays in the strip and reloads from its saved URL when selected). A tab not viewed for a while shows a small refresh affordance rather than auto-refreshing (numbers could be stale: data is synced every 30 minutes).
- **Persistence:** the open-tab list (urls, active tab) is kept in `localStorage` (wrapped in try/catch, the page works without it) and restored on reload. The browser address bar follows the active tab's URL (`history.replaceState`), so copy/paste and reload land on the same tab.
- **Break-outs:** a framed navigation to `/login`, `/setup`, `/auth/signout` or any auth redirect must take over the whole window (frame posts `navigate-top`), never render a login inside a tab. Sign-out and the owner/MFA checks are unchanged.
- **Phone:** the bottom bar stays; a "Tabs (N)" button in the header opens a sheet listing open tabs (switch, close, new). The same keep-alive rule applies (cap 3 live frames on a phone, my call).
- **Accessibility:** the strip is a `role="tablist"` with arrow-key navigation, close buttons with names, `aria-selected`, frames have titles. Respect reduced motion.
- **Risks to prove in the spike before the full build:** memory per frame, the sidebar's active item following the frame's path, the notification bell/Push deep-links opening the right tab, the PWA/service worker, `Sec-Fetch-Dest` available behind Vercel's proxy, Next link prefetch inside frames, print/PDF export pages, and keyboard focus moving between the strip and the frame.

### 4.4 Standard and lessons (written as work lands)
- New `docs/UI_STANDARDS.md`: one page of rules with the reasoning: show at most 3-5 primary controls, rest under Advanced/More; one control height per row; full-word labels; underline tabs for sections; themed scrollbar; the range filter belongs to trend/insight pages only, lists have their own filters; apply-as-you-pick; sizes via tokens; URL is the state; no native control chrome showing through. Each rule links to the component that implements it.
- CLAUDE.md gets a short "UI standards" section pointing there and the new "do not" list (no `size="sm"` mixed with default in one row, no raw `overflow-x-auto` scrollbars without the standard class, no abbreviations like `7d` in UI text, no new filter UI outside `FilterToolbar`).
- The `/styleguide` page shows the standard pieces (RangeBar, FilterToolbar, underline tabs, buttons row, scrollbar) in all themes.
- Automated guards (tests, like the existing `tests/ui-imports.test.ts`): no `7d`-style label strings in `messages/*.json` UI keys for range presets; i18n parity; a test that header action rows use one button size where practical.
- This design doc's "lessons" are appended to docs/HANDOVER.md when each part lands.

## 5. Constraints
- CLAUDE.md rules all apply: semantic tokens only, i18n in `messages/en.json` and `messages/zh-CN.json` (new keys in both), formats only through `lib/format.ts`, mobile-first at 360/768/1280, density tokens un-layered (utilities like `h-9` on shadcn controls are ignored), no layout via `matchMedia`, `npm run check` green.
- Time Scope URL contract unchanged; old links keep working; saved Explorer views keep working (their stored state is the same).
- No migration is required for the filters/UI. Pagination and search use existing tables; if a search or count needs an index or a SQL function, it is a NEW migration file applied before the code that uses it, with the owner's go-ahead.
- Owner-only access and RLS unchanged; framing must stay same-origin only (`frame-ancestors 'self'` is added as a header so other sites cannot frame the app).
- No new dependency unless it is justified here first (popover/sheet primitives already exist: `components/ui/popover.tsx`, `ResponsiveDialog`).

## 6. Suggested order of work (builder may refine)
1. **Foundation + standard** (scrollbar, control height, underline tabs, range labels, `RangeBar`, `FilterToolbar`, styleguide, `UI_STANDARDS.md`, CLAUDE.md, guards).
2. **Apply to existing pages:** account page restructure (Audience into Overview, tabs, buttons), Overview, Calendar, Explorer toolbar, exports dialog labels.
3. **Posts and Stories filters + pagination** (server-side).
4. **Tabs spike** (prove the risks above), then the **shell tabs** build.
5. Lessons recorded in HANDOVER / UI_STANDARDS, then live checks with the owner.
Each step is independently shippable; steps 1-3 do not depend on step 4.

## 7. Left to the builder
Exact popover vs sheet breakpoints, the visual styling of chips/badges, exact page sizes beyond the numbers above, naming of components and files, how the Stories day-group pagination query is written, tab title wording, animation details (respecting reduced motion), the precise scrollbar colors (from existing tokens), and how to test the iframe host in jsdom (a thin interface around `postMessage` is fine).

## 8. Calls made by the author (after the builder check; owner may overrule)
1. **Posts/Stories date filter has its own URL params** (`pr` preset or `pfrom`/`pto`), separate from the Time Scope params. The old `?from&to` params no longer filter Posts/Stories (they are ignored there; the same params still drive the trend pages). Links from a post to the Explorer or Post Lab carry no range.
2. **Stories sort:** "Newest" (default) pages by day groups; any other sort (most views, highest exit rate) shows a flat list paged by item, each frame showing its date, so a day is never half-sorted.
3. **Server paging needs SQL.** The plan includes a NEW migration: a `security invoker` list function (page, sort key, filters, total count) for posts and for Stories (this is also the `story_finals` function that lifts the 200 cap). SQL only decides sort order, filtering and the page; the displayed rates stay computed by the existing TypeScript so the formulas are not duplicated in the UI. The migration is applied only on the owner's go-ahead, before the code that calls it (as always).
4. **Tabs spike pass/fail:** pass means: 4 live tabs use at most about 150 MB each on a mid laptop, switching shows the page instantly with scroll/range/drawer intact, the sidebar highlight follows the active frame, a frame that is redirected to login takes over the whole window, and no page shows duplicated chrome. Chrome detection: the frame is chromeless because its first document request carries `Sec-Fetch-Dest: iframe`; later soft navigations stay in the same layout tree, so the mode persists (the builder must verify, and fall back to a flag the shell passes to the frame on load if not). If the spike fails, tabs are dropped for a lighter "recent pages" switcher (state kept in the URL only) and the owner is told.
5. **Phone:** the bottom bar navigates inside the current tab (no new tab per tap); the header "Tabs (N)" sheet manages tabs.
6. **Audience in Overview:** the parts that are a current snapshot (countries, cities, age, gender, the globe) are labelled "latest snapshot, <date>" and do not change with the range; any audience history chart follows the range.
7. **Posts table header sorting:** the Sort control and the sortable column headers (date, reach, views, engagement) use the same server sort (`sort` in the URL); columns without a server sort are not sortable.

## 9. Decided with the owner
- **Back/Forward with tabs (decided: the author's recommendation, the owner said "you suggest, give me best solution"):** all frames share one browser history, so the browser's own Back button cannot be made per tab. The app gets its own **Back and Forward buttons** for the active tab, placed at the left of the tab strip; they call that frame's own history, so they always step the tab being viewed. Alt+Left / Alt+Right work as shortcuts while focus is in the app. The browser's Back button is best effort only (it may step inside whichever frame navigated last); this is documented in the runbook, not fought with history hacks.

## 10. Open items for the owner
None. Awaiting the owner's approval of this document before the implementation plan is written.
