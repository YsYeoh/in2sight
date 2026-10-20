# Plan 14a: UI foundation — scrollbar, control height, underline tabs, full-word ranges, `RangeBar`, `FilterToolbar`, account page and Explorer restructure, UI standard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** Make every screen look like one product and show only the controls a person needs: one themed thin scrollbar, one control height per row, underline section tabs, full-word range labels ("Last 7 Days", never `7d`), a `RangeBar` (Last 7 / 14 / 30 Days visible, everything else under "More ranges") replacing `TimeScopeBar` on the trend pages, a reusable `FilterToolbar` (Plan 14b builds the Posts/Stories filters with it), the account page as Overview / Posts / Stories with Audience inside Overview, the Explorer as a toolbar instead of a tall left column, and the written standard (`docs/UI_STANDARDS.md`, CLAUDE.md, guard tests).

**Architecture:** No migration, no new route, no new dependency. CSS: one un-layered `styles/scrollbar.css` (like `density.css`) styles every scroller from `--foreground`; the `line` variant of the existing shadcn `TabsList` becomes the underline tabs. `components/shared/TimeScopeBar.tsx` is renamed to `components/shared/RangeBar.tsx` (its hooks `useScopeText`/`useBucketFormat` and the date pickers move with it unchanged); the URL contract (`lib/time-scope/*`) is untouched. `components/shared/FilterToolbar.tsx` holds the toolbar pieces (`FilterToolbar`, `FilterPanel`, `FilterOptions`, `FilterSelect`, `FilterSearch`, `useApply`): every choice is a URL change (a link, or `router.push`/`replace` with the top progress bar), so links, saved views and Back keep working. Panels are `ResponsiveDialog`s (centred on desktop, bottom sheet on phones; pure CSS). The account page drops the Audience tab (its sections render at the bottom of Overview) and shows the RangeBar on Overview only; Posts and Stories read All time, newest first, until Plan 14b gives them their own filters. The Explorer's settings move into an `ExplorerToolbar` that applies each pick at once.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, Tailwind v4 (un-layered density/scrollbar CSS), next-intl 4, shadcn/Radix (`Button`, `Badge`, `Tabs`, `Dialog` via `ResponsiveDialog`), lucide-react, Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-20-ux-polish-and-tabs-design.md` (approved): §3 (owner decisions), §4.1 (standard controls), §4.2 (pages, except the Posts/Stories filters and pagination = Plan 14b), §4.4 (standard and lessons), §5 (constraints), §6 steps 1–2. Plan 14c (`docs/superpowers/plans/2026-10-27-14c-shell-tabs.md`) is the shell tabs and is independent. Project rules: `CLAUDE.md` (binding).

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **One label map, full words.** `timeScope.preset.*` (the button labels) become full words: **Last 7 Days, Last 14 Days, Last 30 Days** (title case, as the owner wrote them), Last 90 days, Last 6 months, Last 12 months, Year to date, All time (zh-CN: 最近 7 天 … 最近 12 个月, 今年至今, 全部时间). `timeScope.presetLong.*` stays the sentence used in the summary line ("Last 30 days · vs previous 30 days"), with `all` renamed "All time". No UI string anywhere matches `\d+[dwmyh]` or `YTD` (guard test, Task 9).
- ⚠ **"1y" reads "Last 12 months", not "Last year"** (spec §4.1 wording): the preset is the rolling last 365 days; "Last year" reads as the previous calendar year. Open question 2.
- **`RangeBar` keeps `TimeScopeBar`'s props and URL contract** (`{ scope, today, keep? }`, every choice a link or a GET form built with `scopeHref`/`scopeParams`, no `useRouter`), so swapping it in is one import per page and the existing page tests that do not mock the router keep working. Visible: a segmented "Quick ranges" nav with the three presets + a "More ranges" button. The button shows the active range's name when it is not one of the three ("Last 6 months", "September 2026") and is highlighted (secondary) whenever anything inside the panel is in effect (another range, a non-default comparison, a fixed Group by), so no state is hidden. Inside, in this order: Other ranges (Last 90 days … All time), Custom dates (the existing range/week/month/quarter forms), Compare with (Previous period / Same period last year / No comparison as links, the custom-days form; a hint instead of the links under All time), Group by (Auto (Day) / Day / Week / Month as links). The summary line stays as it is.
- ⚠ **Panels are `ResponsiveDialog`s, not anchored popovers** (spec §7 leaves the popover/sheet split to the builder): one primitive that is already a bottom sheet below `md` and a centred dialog above, with focus trap, Esc and focus return, and no layout JavaScript (`matchMedia` is forbidden for layout). An anchored desktop popover would need two triggers or `!important` overrides of Radix's inline positioning. Open question 1.
- **Picking an option closes its panel** (each option link is wrapped in `ResponsiveDialogClose asChild`; the date forms close on submit as today). Checkbox lists (Explorer metrics and accounts) apply each tick at once and keep the panel open; the boxes tick immediately (a local copy that resets when the URL state changes) so the lag of the server render is not felt.
- **Apply-as-you-pick:** selects and options navigate at once (`router.push(href, { scroll: false })` + `startProgress`); text search waits for a 400 ms pause (`SEARCH_DEBOUNCE_MS`) or Enter and uses `router.replace` (typing adds no history entries). The Explorer's Apply button goes away; Reset stays.
- **One control height:** every control in a row is `--ctl` high: buttons `size="default"` (density CSS), native selects `h-[var(--ctl)]`, inputs via the density CSS. A segmented group (RangeBar presets, Grid | Table) is ONE control: a `--ctl` frame holding `size="sm"` buttons. Header action rows use `size="default"` for every button, link-buttons included (fixes: account page Calendar and Open on Instagram, the Export dialog trigger, the Explorer's Export view, the Calendar's account select).
- **Scrollbar:** global and un-layered in `styles/scrollbar.css` (imported after `density.css`): `scrollbar-width: thin` + `scrollbar-color` and the `::-webkit-scrollbar` equivalents (8 px, rounded thumb, transparent track, no arrow buttons), colours `color-mix(in srgb, var(--foreground) 22% / 40%, transparent)` so every theme and mode gets a matching thumb without new tokens; quiet until the scroller is hovered. Opt-out: the class `scrollbar-none` (used by the underline tab strip). Because it is global, no component needs a class to get the standard bar; the guard forbids one-off scrollbar styling instead (Task 9).
- **Underline tabs = the shadcn `line` variant, adjusted** (no new variant): full width, bottom rule, no pill, `overflow-x-auto scrollbar-none` with a right-edge fade mask, the active tab underlined in `--primary` on the rule. Used for page sections: the account page and Settings (one word: `variant="line"`). The styleguide's existing pill demo stays as the "default" variant.
- **Account page:** tabs Overview / Posts / Stories (`TABS` loses `audience`); `?tab=audience` redirects (307) to `/accounts/<id>?<scope>#audience`. Overview ends with an "Audience" section (`<section id="audience">`, the existing `AudienceTab` content: countries + globe, cities, age and gender); every card's subtitle reads "Latest snapshot, <date>" (they are snapshots; there is no audience history chart today). The RangeBar renders inside the Overview tab panel (below the tab strip, outside the tab's Suspense boundary, so it stays usable while the tab streams). The component keeps its name `AudienceTab` (no churn in the report code that imports `RankedBars` from it).
- ⚠ **Posts and Stories in the meantime (until Plan 14b):** they show no range bar and read **All time, newest first** (the "All" list range: back to `MAX_DAYS`), with the existing "Show more" (50 per step) and the existing caps: the newest 500 posts (`MEDIA_LIMIT`) and the newest 200 Stories (`STORY_LIMIT`, said on screen). What regresses until 14b: Posts can no longer be narrowed to a date range (only Format / Tag), and Stories older than the newest 200 are not reachable from the tab (they were, with a shorter range). The Time Scope still rides along in the URL (tab switches, Post Lab and Explorer links keep it), it just does not filter these two lists. Open question 3.
- **Explorer layout:** row 1 the RangeBar; row 2 the `ExplorerToolbar`: Break down by (select), "N metrics" (panel of checkboxes), "All accounts" / "N accounts picked" (panel), Saved views (panel holding the existing `SavedViews`), Advanced (Chart metric, Group, Format, Tag, Weekday posted, Hour posted), Reset at the end. "Stories opt-in" is the Format select's Stories option (`fmt=STORY`, unchanged state; "Posts and Reels" is the default). Chips for every active filter (each picked account, group, format, tag, weekday, hour) + Clear all (removes those, keeps metrics, Break down by and the scope). Every change leaves the single-item level (`item` cleared), as submitting the old form did. The left column and its cards go; the results take the full width.
- **Saved views keep working unchanged:** their stored query uses the same `explorerParams` keys; nothing about `lib/explorer/*` changes.
- **Overview (all accounts), Calendar, ExportDialog:** the RangeBar via the rename (Task 4); the Export trigger and the Calendar's account select follow the control rules (Task 5). The Calendar keeps its period arrows and its GET-form account select (no router needed). The export dialog already shows the full-word range sentence (`useScopeText`).
- **Message clean-up last:** keys that stop being used (`timeScope.custom`, `timeScope.compare`, `explorer.apply`, `explorer.removeFilter`, `pages.account.tab.audience`) are deleted by Task 9 after every user is gone, so no wave breaks a running page.

## Open questions for the owner (the plan implements the default shown)

1. "More ranges" and the filter panels open as a centred dialog on desktop and a bottom sheet on phones (not a small popover under the button)? **Default: yes** (one accessible primitive, no layout JavaScript).
2. The 1-year preset reads "Last 12 months" (the spec says "Last year")? **Default: yes** ("Last year" sounds like 2025).
3. Until Plan 14b lands, Posts and Stories show All time newest first (500 posts / 200 Stories, "Show more"), with no date narrowing? **Default: yes** (14b follows directly and replaces it with real pagination and its own date filter).
4. Title case only on the three visible presets ("Last 30 Days"), sentence case in the summary line and the panel ("Last 90 days", "Last 30 days · vs previous 30 days")? **Default: yes** (as written in the spec; switching to all-sentence case is one line per locale).
5. Explorer "Clear all" removes the filter chips only, and "Reset" goes back to the default metrics and breakdown (both kept)? **Default: yes.**

## Assumptions about the current code (`main` at `b3a5197`, read for this plan)

- `components/shared/TimeScopeBar.tsx`: `'use client'`; exports `useScopeText(r: ResolvedScope): { label; vs; note }`, `useBucketFormat(gran, partial?)`, `TimeScopeBar({ scope, today, keep = {} })`; an internal `Pickers({ scope, today, keep, done })` with five `next/form` GET forms (aria-labels `timeScope.range`, `.week`, `.month`, `.quarter`, `.compareRange`), `Hidden`, `pick`, `omit`, `COMPARE_KEYS`, `PICKER_MONTHS = 60`, `SELECT`. No `useRouter`. Imported by `components/{calendar/CalendarView,overview/OverviewView,explorer/ExplorerView,account/AccountView,account/AccountOverview,export/ExportDialog,report/ReportDocument}.tsx` and `tests/time-scope-bar.test.tsx`.
- `lib/time-scope/scope.ts`: `PRESETS = ['7d','14d','30d','90d','6m','1y','ytd','all']`, `GRANULARITIES`, `scopeHref(s, keep)` (drops every scope key from `keep`, returns `?…`), `scopeParams`, `resolveScope(s, today, earliest)` → `ResolvedScope { scope, params, query, preset, window, range, listRange, compare, gran, earliest, partial, comparePartial }`; `listRange` of `'all'` reaches back `MAX_DAYS` (1830). `autoGranularity(90) = 'day'`. Not changed by this plan.
- `components/ui/tabs.tsx`: `TabsList` has `variant: 'default' | 'line'` (`data-variant`); `TabsTrigger`'s underline is an `after:` element (`after:bg-foreground`, `group-data-[orientation=horizontal]/tabs:after:bottom-[-5px]`, visible only under `line`). `styles/density.css` sets `[data-slot="tabs-list"][data-orientation="horizontal"] { height: var(--ctl) }` and button heights by `data-size`.
- `app/globals.css` imports `tailwindcss`, `tokens.css`, `tw-animate-css`, `density.css`, `loading.css` (in that order); `tests/density-css.test.ts` requires `density.css` un-layered and after `tokens.css`.
- `components/ui/popover.tsx` exists (not used here). `components/shared/ResponsiveDialog.tsx` exports `ResponsiveDialog`, `…Trigger`, `…Close`, `…Content`, `…Header`, `…Title`, `…Description`, `…Footer`. `components/ui/badge.tsx` `Badge` (`data-slot="badge"`). `components/shared/NavigationProgress.tsx` `startProgress(href)`, `formHref(form)`.
- `components/account/AccountView.tsx`: `AccountView({ account, tab, scope, today, keep, exportButton, children })`; renders `TimeScopeBar` unless `tab === 'audience'`, `TabsList … className="max-w-full justify-start overflow-x-auto"`, `TABS.map`, header buttons Calendar (`outline sm`) and Instagram (`ghost sm`); tab change = `router.push('?tab=<v>&<scope>', { scroll: false })`.
- `lib/dashboard/account.ts`: `TABS = ['overview','posts','stories','audience']`, `parseTab` (allow-list → `'overview'`). `components/account/TabSkeleton.tsx` switches on `Tab` (case `'audience'`). `tests/route-loading.test.tsx` renders `TabSkeleton` for every `TABS` entry.
- `app/(app)/accounts/[id]/(tabs)/page.tsx`: `TabContent` (posts: `loadPostRows(db, id, dayStart(scope.listRange.from, tz))`, filters `from/to` = `scope.listRange`; stories: `daysToIso(scope.range.from, scope.range.to, tz)` + `loadStories`; audience: `loadAudience` + `AudienceTab`; overview: `loadDaily`, `loadPosts`, `loadSyncStatus`, `loadOnline`, others' posts) and `AccountPage` computing `keep` (tab, format, tag, view). `tests/account-page.test.tsx` mocks `next/navigation` with `notFound` and `useRouter` only.
- `components/account/AudienceTab.tsx`: `AudienceTab({ model })` (EmptyState when `model.reason`), `RankedBars` (also used by `components/report/ReportDocument.tsx`); `asOf` subtitle per card.
- `components/explorer/ExplorerView.tsx`: `Controls` (a GET form, `key={query}`), `Crumbs`, `Results` (with tag/weekday/hour chips), `ExplorerView({ data, today, views, save, rename, remove })`; `lib/explorer/state.ts`: `explorerHref`, `explorerParams`, `withState`, `usable`, `FORMATS` (incl. `STORY`), `MAX_METRICS = 4`; `components/explorer/SavedViews.tsx` `SavedViews(props: SavedViewsProps)` with `views, query, save, rename, remove`.
- `components/export/ExportDialog.tsx`: trigger `<Button variant="outline" size="sm">`. `components/calendar/CalendarView.tsx`: account `<select>` with class `h-[var(--ctl-sm)] … text-xs`.
- `messages/*.json`: hand-formatted, one stray `\r` each (on the `table.ascending` line). `tests/messages.test.ts`: key parity, non-empty, placeholders equal, zh-CN differs from en for strings with 4+ latin letters.
- `tests/ui-imports.test.ts` guards `components/ui` imports (no `cn`, no `next-themes`). No `npx shadcn` call is needed in this plan.

## Out of scope

Posts and Stories filters, their URL params (`pr`/`pfrom`/`pto`, `sort`, `q`, `page`), server pagination, the SQL list functions and the Stories cap lift (Plan 14b); the app-shell tabs (Plan 14c); the Settings redesign; anything in the sync, the analysis, the exports' content, the Time Scope URL contract.

## What Plan 14b consumes (exact names)

From `components/shared/FilterToolbar.tsx` (Task 3):
- `FilterToolbar({ label, children, advanced?, advancedCount?, end?, chips?, clearHref? })` — `label`: the toolbar's accessible name; `children`: the always-visible controls, in order; `advanced`: the body of the Advanced panel (omitted = no Advanced button); `advancedCount`: active advanced filters (badge + "Advanced, 2 active"); `end`: right-aligned extras (Reset, a view toggle); `chips: FilterChip[]`; `clearHref`: "Clear all" (shown only with chips).
- `interface FilterChip { id: string; label: string; href: string }` — `href` = the URL with that one filter removed.
- `FilterPanel({ label, title, description?, active?, badge?, open?, onOpenChange?, children })` — an outline (secondary when `active`) default-size button with a chevron, opening a `ResponsiveDialog` titled `title`, with a "Done" button.
- `FilterOptions({ label, options: { href: string; label: string; current?: boolean }[] })` — option links for use INSIDE a `FilterPanel` (picking one closes it; the current one is `aria-current="true"`).
- `FilterSelect({ id, label, value, options: FilterOption[], hrefFor })`, `interface FilterOption { value: string; label: string }` — a labelled native select, `--ctl` high, navigates to `hrefFor(value)` at once.
- `FilterSearch({ id, label, value, placeholder?, hrefFor })` — a search box that navigates (replace) to `hrefFor(trimmedText)` after `SEARCH_DEBOUNCE_MS` (400) or on Enter, and follows `value` when the URL changes it from outside.
- `useApply(): (href: string, o?: { replace?: boolean }) => void`.
- i18n `filters.{advanced,advancedTitle,withCount,active,remove,clearAll,done}`.

From `components/shared/RangeBar.tsx` (Task 4; 14b does not show it on Posts/Stories, but the names are fixed): `RangeBar({ scope: ResolvedScope; today: string; keep?: Record<string, string> })`, `useScopeText`, `useBucketFormat` (moved unchanged from `TimeScopeBar.tsx`).

Interim state 14b replaces (Task 6): `TabContent`'s `case 'posts'` / `case 'stories'` read `allTime = resolveScope({ range: 'all', cmp: 'none', gran: 'auto' }, today, scope.earliest).listRange`.

## Global Constraints

- Ponytail: smallest thing that works. `FilterToolbar.tsx` pieces each have ≥ 2 users (Explorer + RangeBar now, Posts/Stories in 14b; `FilterSearch` is the exception — its user is 14b, it is part of the spec'd pattern). **No new dependencies.** No new design tokens.
- TypeScript strict. No Meta metric names touched. **No migration.** The Time Scope URL contract (`?from&to&cmp&cfrom&cto&gran`, old `?period=`/`?month=`) is unchanged; saved Explorer views keep their stored state.
- Every UI string via next-intl. New keys are added by Task 1 in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation); Task 4 changes the preset values, Task 6 the Stories/Audience wording (each together with the tests that quote them); Task 9 deletes the keys nobody uses any more. `tests/messages.test.ts` enforces parity and placeholders.
- Theming: semantic tokens only (`bg-secondary`, `text-muted-foreground`, `border`, `after:bg-primary`, `var(--foreground)` in the scrollbar mix); never raw colours. Check light and dark of every theme in the styleguide.
- Responsive 360 / 768 / 1280: toolbars and the RangeBar wrap (`flex-wrap`), never scroll the page sideways; panels are bottom sheets below `md`; no fixed pixel widths on layout containers; CSS breakpoints only (no `matchMedia`/`useMediaQuery`).
- Control height: `--ctl` for every control in a row; `size="sm"` only inside a segmented group or a dense table/list, never next to a default control. Density is un-layered: `h-*`/`p-*` utilities on shadcn `Button`/`Input`/`Card` are ignored (none relied on).
- Dates and numbers only via `lib/format.ts` (unchanged here). URL is the state: every filter/range change is a link, a GET form or `router.push`/`replace`; nothing in `localStorage`.
- Tests: Vitest timeout 20 s; jsdom 29; Radix needs the pointer-capture/ResizeObserver stubs already used in `tests/time-scope-bar.test.tsx` (copy the block); rerun a file alone on "worker start timeout" (`tests/posts-tab.test.tsx` is known slow); never chain a commit after a piped command.
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **A filter change never silently resets another filter** (spec anti-goal): RangeBar links keep `keep` and the other scope parts; Explorer patches keep every other part of the state; chips remove exactly one filter → Task 4 "every option keeps the page parameters and the rest of the scope", Task 7 "a chip removes one filter and keeps the rest".
2. **Hidden state is never invisible:** a range, comparison or Group by chosen inside "More ranges" shows on the button (its name or the highlight) and in the summary line; an active Advanced filter shows as a badge and a chip → Task 4 "a range that is not one of the three is named on the button", Task 3 "Advanced with a count badge", Task 7.
3. **Typing in a search box does not fight the URL:** debounced, cancelled by Enter or by an outside change (chip, Clear all, Back), no lost keystrokes when the URL catches up → Task 3 FilterSearch tests (fake timers).
4. **Old links keep working:** `?tab=audience` lands on Overview's Audience section; `?period=`, `?month=` and saved views unchanged; the RangeBar's links/forms produce exactly the URLs `TimeScopeBar` produced → Task 6 redirect test, Task 4 hrefs, existing `time-scope.test.ts` untouched.
5. **Keyboard and focus:** select changes keep focus (controlled, never remounted), panels trap focus, close on Esc/Done and return focus to their button; the underline tablist keeps manual activation and arrow keys → Task 3 FilterPanel/FilterSelect tests, Task 6 AccountView keyboard test (kept).

## File Structure

| File | Responsibility |
|---|---|
| `messages/en.json`, `messages/zh-CN.json` | new keys (Task 1), preset labels (Task 4), unused keys removed (Task 9) |
| `styles/scrollbar.css` (new), `app/globals.css` | the standard scrollbar + `scrollbar-none` opt-out |
| `components/ui/tabs.tsx` | `line` variant = underline tabs |
| `components/shared/FilterToolbar.tsx` (new) | `FilterToolbar`, `FilterPanel`, `FilterOptions`, `FilterSelect`, `FilterSearch`, `useApply`, `SEARCH_DEBOUNCE_MS`, types |
| `components/shared/RangeBar.tsx` (renamed from `TimeScopeBar.tsx`) | `RangeBar`, `useScopeText`, `useBucketFormat`, the pickers |
| `components/{calendar/CalendarView,overview/OverviewView,explorer/ExplorerView,account/AccountView,account/AccountOverview,export/ExportDialog,report/ReportDocument}.tsx` | import path (Task 4) |
| `components/export/ExportDialog.tsx`, `components/calendar/CalendarView.tsx`, `app/(app)/settings/page.tsx` | control rules (Task 5) |
| `lib/dashboard/account.ts`, `components/account/{AccountView,AccountOverview,TabSkeleton}.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx` | account page: 3 tabs, Audience in Overview, redirect, RangeBar on Overview, Posts/Stories All time |
| `components/explorer/ExplorerToolbar.tsx` (new), `components/explorer/ExplorerView.tsx` | Explorer toolbar layout |
| `app/styleguide/StandardsGallery.tsx` (new), `app/styleguide/page.tsx` | the standard pieces in the styleguide |
| `docs/UI_STANDARDS.md` (new), `CLAUDE.md`, `docs/HANDOVER.md`, `docs/TODO.md`, `docs/SPEC.md`, `docs/RUNBOOK_TIMESCOPE.md`, `tests/ui-standards.test.ts` (new) | the standard, lessons, live checks, guards |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r`). Keep every other line byte-identical; both locales get the same keys; zh-CN uses full-width punctuation (`，：（）。`).

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | i18n: every new key (additions only) | — | `messages/en.json`, `messages/zh-CN.json` | 2 |
| 2 | Standard scrollbar + underline tabs | — | `styles/scrollbar.css`, `app/globals.css`, `components/ui/tabs.tsx`, `tests/scrollbar-css.test.ts`, `tests/tabs-line.test.tsx` | 1 |
| 3 | `FilterToolbar` pieces | 1 | `components/shared/FilterToolbar.tsx`, `tests/filter-toolbar.test.tsx` | — (wave B alone) |
| 4 | `RangeBar` replaces `TimeScopeBar` everywhere; full-word preset labels | 1, 3 | `components/shared/TimeScopeBar.tsx` → `components/shared/RangeBar.tsx`, the 7 importers (import line + JSX name only), `messages/en.json`, `messages/zh-CN.json` (two timeScope lines), `tests/time-scope-bar.test.tsx` → `tests/range-bar.test.tsx`, `tests/account-view.test.tsx` and `tests/overview-view.test.tsx` (preset link names only) | — (wave C alone) |
| 5 | Control rules: Export trigger, Calendar select, Settings tabs | 2, 4 | `components/export/ExportDialog.tsx`, `components/calendar/CalendarView.tsx`, `app/(app)/settings/page.tsx`, `tests/export-dialog.test.tsx`, `tests/calendar.test.tsx` | 6, 7, 8 |
| 6 | Account page: Overview / Posts / Stories, Audience in Overview, RangeBar on Overview only, Posts/Stories All time | 1, 2, 4 | `lib/dashboard/account.ts`, `components/account/AccountView.tsx`, `components/account/AccountOverview.tsx`, `components/account/TabSkeleton.tsx`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `messages/en.json`, `messages/zh-CN.json` (four wording lines), `tests/account-view.test.tsx`, `tests/account-page.test.tsx`, `tests/dashboard-account.test.ts`, `tests/stories-audience.test.tsx` | 5, 7, 8 |
| 7 | Explorer toolbar | 1, 3, 4 | `components/explorer/ExplorerToolbar.tsx`, `components/explorer/ExplorerView.tsx`, `tests/explorer-view.test.tsx` | 5, 6, 8 |
| 8 | Styleguide: the standard pieces | 1–4 | `app/styleguide/StandardsGallery.tsx`, `app/styleguide/page.tsx`, `tests/standards-gallery.test.tsx` | 5, 6, 7 |
| 9 | Standard, guards, unused keys, docs; final check | all | `docs/UI_STANDARDS.md`, `CLAUDE.md`, `docs/HANDOVER.md`, `docs/TODO.md`, `docs/SPEC.md`, `docs/RUNBOOK_TIMESCOPE.md`, `tests/ui-standards.test.ts`, `messages/en.json`, `messages/zh-CN.json` | — |

Run order: wave A = 1, 2 · wave B = 3 · wave C = 4 · wave D = 5, 6, 7, 8 · wave E = 9. Tasks in one wave touch disjoint files (Task 4 edits the import line of files that wave D edits elsewhere, so it runs before them; only Tasks 1, 4, 6 and 9 edit the message files, each in a different wave; `tests/account-view.test.tsx` is edited by Task 4 (one line) and then Task 6).

---

### Task 1: i18n — every new key (additions only)

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/messages.test.ts` (existing: parity, placeholders, no copy-pasted English) must pass.

**Interfaces:**
- Produces (exact keys later tasks read): `filters.{advanced,advancedTitle,withCount,active,remove,clearAll,done}` (new top-level namespace); `timeScope.{more,otherRanges,customDates,compareWith,compareAllHint}`; `explorer.metricsCount`; `pages.account.audience.title`; `styleguide.standards.{title,intro,rangeBar,filterToolbar,tabs,buttons,scrollbar,row,sampleSearch,sampleSort,sampleNewest,sampleReach}`.

- [ ] **Step 1: Insert the keys** — four text edits per file (Edit tool; replace the anchor exactly; every other line stays byte-identical).

`messages/en.json`:

(a) anchor (3 lines, the end of `explorer` and the start of `timeScope`):
```json
    "openAccount": "Open {name}"
  },
  "timeScope": {
```
replace with:
```json
    "openAccount": "Open {name}",
    "metricsCount": "{count, plural, one {# metric} other {# metrics}}"
  },
  "filters": {
    "advanced": "Advanced",
    "advancedTitle": "More filters",
    "withCount": "{label}, {count} active",
    "active": "Active filters",
    "remove": "Remove filter {name}",
    "clearAll": "Clear all",
    "done": "Done"
  },
  "timeScope": {
```
(b) anchor `    "next": "Next period"` (the last key of `timeScope`) → replace with:
```json
    "next": "Next period",
    "more": "More ranges",
    "otherRanges": "Other ranges",
    "customDates": "Custom dates",
    "compareWith": "Compare with",
    "compareAllHint": "All time has no earlier period to compare with."
```
(c) anchor `        "emptyHint": "Audience data appears once the account has 100+ followers and the daily sync has run.",` → replace with:
```json
        "title": "Audience",
        "emptyHint": "Audience data appears once the account has 100+ followers and the daily sync has run.",
```
(d) anchor `    "greeting": "Welcome back, {name}",` → replace with:
```json
    "greeting": "Welcome back, {name}",
    "standards": {
      "title": "Standard controls",
      "intro": "The shared pieces every page is built from (docs/UI_STANDARDS.md).",
      "rangeBar": "Range bar",
      "filterToolbar": "Filter toolbar",
      "tabs": "Section tabs",
      "buttons": "One row, one control height",
      "scrollbar": "Scrollbar",
      "row": "Row {n}",
      "sampleSearch": "Search captions",
      "sampleSort": "Sort",
      "sampleNewest": "Newest first",
      "sampleReach": "Most reach"
    },
```

`messages/zh-CN.json` (same places):

(a) anchor:
```json
    "openAccount": "打开 {name}"
  },
  "timeScope": {
```
replace with:
```json
    "openAccount": "打开 {name}",
    "metricsCount": "{count, plural, other {# 个指标}}"
  },
  "filters": {
    "advanced": "高级",
    "advancedTitle": "更多筛选",
    "withCount": "{label}，已启用 {count} 项",
    "active": "已启用的筛选",
    "remove": "移除筛选：{name}",
    "clearAll": "全部清除",
    "done": "完成"
  },
  "timeScope": {
```
(b) anchor `    "next": "下一周期"` → replace with:
```json
    "next": "下一周期",
    "more": "更多范围",
    "otherRanges": "其他范围",
    "customDates": "自定义日期",
    "compareWith": "对比对象",
    "compareAllHint": "全部时间没有更早的周期可以对比。"
```
(c) anchor `        "emptyHint": "账号粉丝达到 100 人且每日同步运行后，这里会显示受众数据。",` → replace with:
```json
        "title": "受众",
        "emptyHint": "账号粉丝达到 100 人且每日同步运行后，这里会显示受众数据。",
```
(d) anchor `    "greeting": "欢迎回来,{name}",` (keep the existing line as it is) → replace with:
```json
    "greeting": "欢迎回来,{name}",
    "standards": {
      "title": "标准控件",
      "intro": "每个页面共用的标准组件（docs/UI_STANDARDS.md）。",
      "rangeBar": "时间范围栏",
      "filterToolbar": "筛选工具栏",
      "tabs": "分区标签页",
      "buttons": "同一行使用同一控件高度",
      "scrollbar": "滚动条",
      "row": "第 {n} 行",
      "sampleSearch": "搜索文案",
      "sampleSort": "排序",
      "sampleNewest": "最新优先",
      "sampleReach": "覆盖最多"
    },
```

- [ ] **Step 2: Run the catalog test**

Run: `npx vitest run tests/messages.test.ts` and `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"`
Expected: PASS (6 tests); the parse prints nothing. `git diff --stat messages` shows only insertions plus the two `openAccount` lines (each gained a comma) and the two `next` lines.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): filter toolbar, range bar, audience section and styleguide strings (en + zh-CN)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Standard scrollbar + underline tabs

**Files:**
- Create: `styles/scrollbar.css`, `tests/scrollbar-css.test.ts`, `tests/tabs-line.test.tsx`
- Modify: `app/globals.css` (one import line), `components/ui/tabs.tsx` (the `line` variant)

**Interfaces:**
- Produces: global scrollbar on every scroller; class `scrollbar-none` (hides a scroller's bar; for tab strips only); `TabsList variant="line"` = the underline section tabs (full width, bottom rule, sideways scroll without a visible bar, right-edge fade, active tab underlined in `--primary`).

- [ ] **Step 1: Write the failing tests** — create `tests/scrollbar-css.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const css = read('styles/scrollbar.css').replace(/\/\*[\s\S]*?\*\//g, '');
const globals = read('app/globals.css');

describe('standard scrollbar (UI standard)', () => {
  it('is imported un-layered, after the density layer', () => {
    expect(globals).toMatch(/@import\s+["'][^"']*scrollbar\.css["']\s*;/);
    expect(globals.indexOf('scrollbar.css')).toBeGreaterThan(globals.indexOf('density.css'));
    expect(css).not.toMatch(/@layer/);
  });

  it('thin, 8px, rounded thumb, transparent track, no arrow buttons', () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*8px[^}]*height:\s*8px/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*9999px/);
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
    expect(css).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
  });

  it('colours come only from the theme (every theme and mode), with a hover step', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).toMatch(/var\(--foreground\)/);
    expect(css).toMatch(/:hover/);
  });

  it('one opt-out class for scrollers whose bar must stay hidden', () => {
    expect(css).toMatch(/\.scrollbar-none\s*\{[^}]*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.scrollbar-none::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });
});
```

and `tests/tabs-line.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function tabs(variant?: 'default' | 'line') {
  return render(
    <Tabs defaultValue="a">
      <TabsList variant={variant} aria-label="Sections">
        <TabsTrigger value="a">Overview</TabsTrigger>
        <TabsTrigger value="b">Posts</TabsTrigger>
      </TabsList>
      <TabsContent value="a">A</TabsContent>
      <TabsContent value="b">B</TabsContent>
    </Tabs>,
  );
}

describe('underline tabs (variant="line")', () => {
  it('a full-width bottom rule, no pill track, sideways scroll with a hidden bar and a fade edge', () => {
    tabs('line');
    const list = screen.getByRole('tablist', { name: 'Sections' });
    expect(list).toHaveAttribute('data-variant', 'line');
    expect(list).toHaveClass('w-full', 'justify-start', 'border-b', 'overflow-x-auto', 'scrollbar-none');
    expect(list.className).toMatch(/mask-image/);
    expect(list).not.toHaveClass('bg-muted');
  });

  it('the active tab is underlined in the primary colour on the rule', () => {
    tabs('line');
    const active = screen.getByRole('tab', { name: 'Overview' });
    expect(active).toHaveAttribute('data-state', 'active');
    expect(active.className).toMatch(/after:bg-primary/);
    expect(active.className).toMatch(/after:bottom-0/);
  });

  it('the default variant is unchanged (pill on a muted track)', () => {
    tabs();
    const list = screen.getByRole('tablist');
    expect(list).toHaveClass('bg-muted');
    expect(list).not.toHaveClass('border-b');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/scrollbar-css.test.ts tests/tabs-line.test.tsx`
Expected: FAIL — `ENOENT … styles/scrollbar.css`; the line list lacks `w-full`/`border-b`/`scrollbar-none`, the trigger has `after:bg-foreground`.

- [ ] **Step 3: Implement**

Create `styles/scrollbar.css`:

```css
/*
 * The standard scrollbar (docs/UI_STANDARDS.md): thin, rounded, quiet until the scroller is hovered, coloured from the
 * theme's --foreground so every theme and mode matches. Un-layered like density.css. Applies to every scroller, so no
 * component needs a class; `scrollbar-none` hides the bar where it must stay hidden (tab strips).
 */
* {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--foreground) 22%, transparent) transparent;
}
*:hover {
  scrollbar-color: color-mix(in srgb, var(--foreground) 40%, transparent) transparent;
}
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--foreground) 22%, transparent) padding-box;
}
::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--foreground) 40%, transparent) padding-box;
}
::-webkit-scrollbar-button {
  display: none;
}
.scrollbar-none {
  scrollbar-width: none;
}
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
```

In `app/globals.css` insert `@import "../styles/scrollbar.css";` on the line after `@import "../styles/loading.css";` (not inside a layer).

In `components/ui/tabs.tsx`:
- `tabsListVariants` → `line:` becomes `"w-full justify-start gap-1 overflow-x-auto border-b bg-transparent p-0 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]"` (the base's `w-fit`/`p-[3px]`/`justify-center` lose to these through `cn`).
- `TabsTrigger`, fourth class string: `after:bg-foreground` → `after:bg-primary`, and `group-data-[orientation=horizontal]/tabs:after:bottom-[-5px]` → `group-data-[orientation=horizontal]/tabs:after:bottom-0` (the underline is only visible under `line`, so the default variant is unaffected; with `p-0` it now sits on the list's bottom rule instead of being clipped by `overflow-x-auto`).

Nothing else changes in the file (no new variant, no new export). Check visually in Task 8's styleguide section in light and dark.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/scrollbar-css.test.ts tests/tabs-line.test.tsx tests/density-css.test.ts tests/css-vars-defined.test.ts tests/account-view.test.tsx tests/gallery.test.tsx tests/ui-imports.test.ts` and `npx eslint components/ui/tabs.tsx`
Expected: PASS; eslint clean. (`account-view` still renders the old default-variant list; Task 6 switches it to `line`.)

- [ ] **Step 5: Commit**

```bash
git add styles/scrollbar.css app/globals.css components/ui/tabs.tsx tests/scrollbar-css.test.ts tests/tabs-line.test.tsx
git commit -m "feat(ui): standard themed scrollbar and underline section tabs" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `FilterToolbar` pieces

**Files:**
- Create: `components/shared/FilterToolbar.tsx`, `tests/filter-toolbar.test.tsx`

**Interfaces:**
- Consumes: i18n `filters.*` (Task 1); `ResponsiveDialog*` (incl. `ResponsiveDialogClose`, `ResponsiveDialogFooter`), `Button`, `Badge`, `Input`, `startProgress`; `useRouter` from `next/navigation`; lucide `ChevronDown`, `Search`, `X`.
- Produces (also the contract Plan 14b consumes — see "What Plan 14b consumes"):
  - `export const SEARCH_DEBOUNCE_MS = 400`
  - `export interface FilterChip { id: string; label: string; href: string }`
  - `export interface FilterOption { value: string; label: string }`
  - `export function useApply(): (href: string, o?: { replace?: boolean }) => void` — `startProgress(href)` then `router.replace` (when `replace`) or `router.push`, always `{ scroll: false }`.
  - `export function FilterToolbar(p: { label: string; children: ReactNode; advanced?: ReactNode; advancedCount?: number; end?: ReactNode; chips?: FilterChip[]; clearHref?: string }): JSX.Element` — `div[role=group][aria-label=label]`, `mb-[var(--gp)] grid gap-2`; row 1 `flex flex-wrap items-center gap-2`: `children`, then (when `advanced`) a `FilterPanel` labelled `filters.advanced`, titled `filters.advancedTitle`, `active` and `badge` = `advancedCount`, then `end` in a `ms-auto` wrapper; row 2 (only when `chips.length`): `ul[aria-label=filters.active]` of chip links (`aria-label = filters.remove {name}`, an `X` icon, `rounded-full border bg-card px-2 py-0.5 text-xs`, `scroll={false}`) and, when `clearHref`, a "Clear all" link.
  - `export function FilterPanel(p: { label: string; title: string; description?: string; active?: boolean; badge?: number; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }): JSX.Element` — `ResponsiveDialogTrigger asChild` → `<Button type="button" variant={active ? 'secondary' : 'outline'}>` (default size) with the truncated label, a `Badge aria-hidden` when `badge > 0` (then the button's `aria-label` is `filters.withCount {label, count}`), and `ChevronDown`; content `max-h-[90dvh] overflow-y-auto sm:max-w-md` with header (title, optional description; pass `aria-describedby={undefined}` to the content when there is no description), the children in `grid gap-[var(--gp)]`, and a footer with `ResponsiveDialogClose asChild` → outline "Done" button. `open`/`onOpenChange` optional (controlled by the RangeBar so its date forms can close it).
  - `export function FilterOptions(p: { label: string; options: { href: string; label: string; current?: boolean }[] }): JSX.Element` — `nav[aria-label=label]` with a visible `aria-hidden` heading and a wrapping `ul`; each option `ResponsiveDialogClose asChild` → `Button asChild size="sm" variant={current ? 'secondary' : 'ghost'}` → `Link scroll={false} aria-current={current ? 'true' : undefined}`. Only inside a `FilterPanel` (it needs the dialog context).
  - `export function FilterSelect(p: { id: string; label: string; value: string; options: FilterOption[]; hrefFor: (value: string) => string }): JSX.Element` — `<label htmlFor={id} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">` + a controlled native `<select id className="h-[var(--ctl)] max-w-56 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground">`; `onChange` → `apply(hrefFor(value))`. Controlled and never keyed, so it keeps focus when the URL changes.
  - `export function FilterSearch(p: { id: string; label: string; value: string; placeholder?: string; hrefFor: (text: string) => string }): JSX.Element` — `form[role=search]` with an `sr-only` label, a `Search` icon and `<Input type="search">` (`w-56 max-w-full pl-8`).

- [ ] **Step 1: Write the failing test** — create `tests/filter-toolbar.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { FilterOptions, FilterPanel, FilterSearch, FilterSelect, FilterToolbar, SEARCH_DEBOUNCE_MS } from '@/components/shared/FilterToolbar';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
  replace.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const intl = (ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') => (
  <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
    {ui}
  </NextIntlClientProvider>
);
const wrap = (ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') => render(intl(ui, locale));
const FORMATS = [
  { value: '', label: 'All formats' },
  { value: 'REELS', label: 'Reels' },
];
const searchBox = (value: string) => <FilterSearch id="q" label="Search captions" value={value} hrefFor={(q) => (q ? `?q=${encodeURIComponent(q)}` : '?')} />;

describe('FilterToolbar', () => {
  it('a labelled row of equal-height controls; Advanced with a count badge; removable chips and Clear all', () => {
    wrap(
      <FilterToolbar
        label="Post filters"
        advanced={<p>more</p>}
        advancedCount={2}
        chips={[
          { id: 'format', label: 'Reels', href: '?tab=posts' },
          { id: 'tag', label: 'Launch', href: '?tab=posts&format=REELS' },
        ]}
        clearHref="?tab=posts"
        end={<a href="?">Reset</a>}
      >
        <FilterSelect id="f-format" label="Format" value="" options={FORMATS} hrefFor={(v) => `?format=${v}`} />
        <FilterPanel label="Tags" title="Pick tags">
          <p>tags</p>
        </FilterPanel>
      </FilterToolbar>,
    );
    const bar = screen.getByRole('group', { name: 'Post filters' });
    const adv = within(bar).getByRole('button', { name: 'Advanced, 2 active' });
    expect(adv).toHaveAttribute('data-variant', 'secondary');
    expect(within(adv).getByText('2')).toHaveAttribute('aria-hidden', 'true');
    expect(new Set(within(bar).getAllByRole('button').map((b) => b.getAttribute('data-size')))).toEqual(new Set(['default']));
    expect(within(bar).getByRole('combobox', { name: 'Format' })).toHaveClass('h-[var(--ctl)]');
    const chips = within(bar).getByRole('list', { name: en.filters.active });
    expect(within(chips).getByRole('link', { name: 'Remove filter Reels' })).toHaveAttribute('href', '?tab=posts');
    expect(within(chips).getByRole('link', { name: 'Remove filter Launch' })).toHaveAttribute('href', '?tab=posts&format=REELS');
    expect(within(bar).getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=posts');
    expect(within(bar).getByRole('link', { name: 'Reset' })).toBeInTheDocument();
  });

  it('no chips: no list and no Clear all; a quiet Advanced has no badge; no `advanced`: no Advanced button', () => {
    const { unmount } = wrap(
      <FilterToolbar label="F" advanced={<p>x</p>} clearHref="?">
        <span />
      </FilterToolbar>,
    );
    expect(screen.getByRole('button', { name: en.filters.advanced })).toHaveAttribute('data-variant', 'outline');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('link', { name: en.filters.clearAll })).toBeNull();
    unmount();
    wrap(
      <FilterToolbar label="F">
        <span />
      </FilterToolbar>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('zh-CN: the count reads in Chinese', () => {
    wrap(
      <FilterToolbar label="F" advanced={<p>x</p>} advancedCount={1}>
        <span />
      </FilterToolbar>,
      'zh-CN',
    );
    expect(screen.getByRole('button', { name: '高级，已启用 1 项' })).toBeInTheDocument();
  });
});

describe('FilterPanel and FilterOptions', () => {
  it('opens a dialog titled by the panel (a bottom sheet on phones); Done closes it and focus returns to the button', async () => {
    const user = userEvent.setup();
    wrap(
      <FilterPanel label="2 metrics" title="Metrics">
        <input type="checkbox" aria-label="Reach" />
      </FilterPanel>,
    );
    const trigger = screen.getByRole('button', { name: '2 metrics' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('data-size', 'default');
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Metrics' });
    expect(within(dialog).getByRole('checkbox', { name: 'Reach' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.filters.done }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('options are links; the current one is marked and highlighted', async () => {
    const user = userEvent.setup();
    wrap(
      <FilterPanel label="Posted" title="Posted">
        <FilterOptions
          label="Quick dates"
          options={[
            { href: '?pr=7d', label: 'Last 7 days' },
            { href: '?', label: 'All time', current: true },
          ]}
        />
      </FilterPanel>,
    );
    await user.click(screen.getByRole('button', { name: 'Posted' }));
    const nav = within(await screen.findByRole('dialog', { name: 'Posted' })).getByRole('navigation', { name: 'Quick dates' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['Last 7 days', '?pr=7d', null],
      ['All time', '?', 'true'],
    ]);
    expect(links[1]).toHaveAttribute('data-variant', 'secondary');
  });
});

describe('FilterSelect', () => {
  it('applies the picked value at once (no scroll jump); the value follows the URL and focus stays', async () => {
    const user = userEvent.setup();
    const select = (value: string) => <FilterSelect id="s" label="Format" value={value} options={FORMATS} hrefFor={(v) => (v ? `?format=${v}` : '?')} />;
    const { rerender } = wrap(select(''));
    const el = screen.getByRole('combobox', { name: 'Format' });
    el.focus();
    await user.selectOptions(el, 'REELS');
    expect(push).toHaveBeenCalledWith('?format=REELS', { scroll: false });
    rerender(intl(select('REELS'))); // the navigation commits
    const after = screen.getByRole('combobox', { name: 'Format' });
    expect(after).toBe(el);
    expect(after).toHaveValue('REELS');
    expect(document.activeElement).toBe(after);
  });
});

describe('FilterSearch', () => {
  it('text applies after a pause with replace (typing adds no history entries); Enter applies at once and cancels the pause', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      wrap(searchBox(''));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, 'cat');
      expect(replace).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('?q=cat', { scroll: false });
      await user.type(box, 's{Enter}');
      expect(replace).toHaveBeenLastCalledWith('?q=cats', { scroll: false });
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(2);
      expect(push).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows the URL when a chip or Clear all changes it, but not while its own text is arriving', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { rerender } = wrap(searchBox(''));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, 'cat');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      await user.type(box, 's'); // "cats" typed, not applied yet
      rerender(intl(searchBox('cat'))); // the URL catches up with "cat"
      expect(box).toHaveValue('cats');
      rerender(intl(searchBox(''))); // a chip or Clear all removed the search
      expect(box).toHaveValue('');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      expect(replace).toHaveBeenCalledTimes(1); // the pending "cats" was dropped
    } finally {
      vi.useRealTimers();
    }
  });

  it('blank or unchanged text never navigates', async () => {
    vi.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      wrap(searchBox('cat'));
      const box = screen.getByRole('searchbox', { name: 'Search captions' });
      await user.type(box, ' ');
      act(() => {
        vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      });
      await user.type(box, '{Enter}');
      expect(replace).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/filter-toolbar.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/shared/FilterToolbar"`.

- [ ] **Step 3: Implement `components/shared/FilterToolbar.tsx`** (`'use client'`; a header comment naming the pattern and pointing to `docs/UI_STANDARDS.md`) with the exports in the Interfaces block. Everything there is determined by the tests except `FilterSearch`'s URL sync, which must be exactly this (render-phase "adjust state when a prop changes", lint-clean with `eslint-plugin-react-hooks` 7.1.1 — checked while planning):

```tsx
export function FilterSearch({ id, label, value, placeholder, hrefFor }: { id: string; label: string; value: string; placeholder?: string; hrefFor: (text: string) => string }) {
  const apply = useApply();
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value); // the last `value` rendered
  const [sent, setSent] = useState(value); // the last text this box applied
  if (value !== seen) {
    // the URL changed: follow it, unless it is this box's own text arriving (then keep what is being typed)
    setSeen(value);
    if (value !== sent) {
      setText(value);
      setSent(value);
    }
  }
  const send = useCallback(
    (q: string) => {
      setSent(q);
      apply(hrefFor(q), { replace: true });
    },
    [apply, hrefFor],
  );
  useEffect(() => {
    const q = text.trim();
    if (q === value.trim() || q === sent) return; // nothing new: an outside change or Enter cancels the pause
    const timer = setTimeout(() => send(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value, sent, send]);
  // ponytail: a parent re-render with a new hrefFor restarts the pause; harmless while parents re-render only on navigation
  …form[role=search] onSubmit: preventDefault; q = text.trim(); if (q !== value.trim() && q !== sent) send(q)
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/filter-toolbar.test.tsx tests/css-vars-defined.test.ts tests/messages.test.ts` and `npx tsc --noEmit` and `npx eslint components/shared/FilterToolbar.tsx`
Expected: PASS (filter-toolbar: 9 tests); typecheck and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add components/shared/FilterToolbar.tsx tests/filter-toolbar.test.tsx
git commit -m "feat(ui): FilterToolbar pattern (panels, Advanced badge, chips, Clear all, apply as you pick, debounced search)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `RangeBar` replaces `TimeScopeBar` everywhere; full-word preset labels

**Files:**
- Move: `components/shared/TimeScopeBar.tsx` → `components/shared/RangeBar.tsx` (`git mv`, then edit); `tests/time-scope-bar.test.tsx` → `tests/range-bar.test.tsx` (`git mv`, then replace the content)
- Modify (import path and JSX name only): `components/calendar/CalendarView.tsx`, `components/overview/OverviewView.tsx`, `components/explorer/ExplorerView.tsx`, `components/account/AccountView.tsx`, `components/account/AccountOverview.tsx`, `components/export/ExportDialog.tsx`, `components/report/ReportDocument.tsx`
- Modify: `messages/en.json`, `messages/zh-CN.json` (the `preset` and `presetLong` lines of `timeScope`); `tests/account-view.test.tsx` (line 105), `tests/overview-view.test.tsx` (lines 56 and 63)

**Interfaces:**
- Consumes: `FilterPanel`, `FilterOptions` (Task 3); `timeScope.{more,otherRanges,customDates,compareWith,compareAllHint}` (Task 1); `PRESETS`, `GRANULARITIES`, `scopeHref`, `ResolvedScope`, `TimeScope`, `Preset` (`lib/time-scope/scope.ts`), `autoGranularity`, `daysIn` (`lib/time-scope/range.ts`).
- Produces: `components/shared/RangeBar.tsx` exports `RangeBar({ scope, today, keep = {} }: { scope: ResolvedScope; today: string; keep?: Record<string, string> })`, and — unchanged — `useScopeText`, `useBucketFormat`. `TimeScopeBar` no longer exists.

- [ ] **Step 1: Move the files and switch the labels**

```bash
git mv components/shared/TimeScopeBar.tsx components/shared/RangeBar.tsx
git mv tests/time-scope-bar.test.tsx tests/range-bar.test.tsx
```

In the seven importers replace `@/components/shared/TimeScopeBar` with `@/components/shared/RangeBar`, and in `CalendarView`, `OverviewView`, `ExplorerView`, `AccountView` the identifier `TimeScopeBar` with `RangeBar` (import and JSX; props unchanged). `grep -rn "TimeScopeBar" app components lib tests` → nothing.

Messages (text edits, the whole line each):
- `messages/en.json`: the `"preset": {…}` line of `timeScope` becomes
  `    "preset": { "7d": "Last 7 Days", "14d": "Last 14 Days", "30d": "Last 30 Days", "90d": "Last 90 days", "6m": "Last 6 months", "1y": "Last 12 months", "ytd": "Year to date", "all": "All time" },`
  and in the `"presetLong": {…}` line `"all": "All data"` becomes `"all": "All time"`.
- `messages/zh-CN.json`: `    "preset": { "7d": "最近 7 天", "14d": "最近 14 天", "30d": "最近 30 天", "90d": "最近 90 天", "6m": "最近 6 个月", "1y": "最近 12 个月", "ytd": "今年至今", "all": "全部时间" },` and `"all": "全部数据"` → `"all": "全部时间"` in `presetLong`.

Tests quoting the old short labels: `tests/account-view.test.tsx:105` `{ name: '7d' }` → `{ name: en.timeScope.preset['7d'] }`; `tests/overview-view.test.tsx:56` `{ name: '30d' }` → `{ name: en.timeScope.preset['30d'] }`, `:63` `{ name: '7d' }` → `{ name: en.timeScope.preset['7d'] }`.

- [ ] **Step 2: Write the failing test** — replace the content of `tests/range-bar.test.tsx` with:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { RangeBar, useBucketFormat } from '@/components/shared/RangeBar';
import { deepMerge } from '@/lib/merge';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-17';
const scope = (q: string, earliest: string | null = '2025-01-01') => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, earliest);

function view(q = '', o: { keep?: Record<string, string>; earliest?: string | null; locale?: 'en' | 'zh-CN' } = {}) {
  const locale = o.locale ?? 'en';
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : deepMerge(en, zh)}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <RangeBar scope={scope(q, o.earliest === undefined ? '2025-01-01' : o.earliest)} today={TODAY} keep={o.keep} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const hidden = (form: HTMLElement) => Object.fromEntries([...form.querySelectorAll<HTMLInputElement>('input[type=hidden]')].map((i) => [i.name, i.value]));
const links = (el: HTMLElement) => within(el).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')]);
async function openMore(name: string) {
  await userEvent.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name: en.timeScope.customTitle });
}

describe('RangeBar', () => {
  it('shows Last 7 / 14 / 30 Days and "More ranges" only; links keep the page parameters; one summary line', () => {
    view('', { keep: { tab: 'posts', format: 'REELS' } });
    expect(links(screen.getByRole('navigation', { name: 'Quick ranges' }))).toEqual([
      ['Last 7 Days', '?tab=posts&format=REELS&from=7d', null],
      ['Last 14 Days', '?tab=posts&format=REELS&from=14d', null],
      ['Last 30 Days', '?tab=posts&format=REELS', 'page'],
    ]);
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'outline');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Last 30 days · vs previous 30 days');
    expect(document.body.textContent).not.toMatch(/\b\d+[dwmy]\b|YTD/);
  });

  it('one control height: the presets are one segmented control; "More ranges" is a default-size button', () => {
    view();
    const nav = screen.getByRole('navigation', { name: 'Quick ranges' });
    expect(nav).toHaveClass('h-[var(--ctl)]');
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('data-size'))).toEqual(['sm', 'sm', 'sm']);
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-size', 'default');
  });

  it('a range that is not one of the three is named on the button, which is highlighted', () => {
    view('from=6m');
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Last 6 months' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('status')).toHaveTextContent('Last 6 months · vs previous 182 days');
  });

  it('a month: the button and the summary name it', () => {
    view('month=2026-09&cmp=yoy');
    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('data-variant', 'secondary');
    expect(screen.getByRole('status')).toHaveTextContent('September 2026 · vs September 2025');
  });

  it('a visible preset with a fixed Group by still highlights "More ranges" (nothing chosen inside is hidden)', () => {
    view('from=7d&gran=week');
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('More ranges: other presets, Compare with and Group by are links that keep the rest of the scope and the page parameters', async () => {
    view('from=90d&cmp=yoy&gran=month', { keep: { account: 'x' } });
    const dialog = await openMore('Last 90 days');
    expect(links(within(dialog).getByRole('navigation', { name: 'Other ranges' }))).toEqual([
      ['Last 90 days', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
      ['Last 6 months', '?account=x&from=6m&cmp=yoy&gran=month', null],
      ['Last 12 months', '?account=x&from=1y&cmp=yoy&gran=month', null],
      ['Year to date', '?account=x&from=ytd&cmp=yoy&gran=month', null],
      ['All time', '?account=x&from=all&gran=month', null],
    ]);
    expect(links(within(dialog).getByRole('navigation', { name: 'Compare with' }))).toEqual([
      ['Previous period', '?account=x&from=90d&gran=month', null],
      ['Same period last year', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
      ['No comparison', '?account=x&from=90d&cmp=none&gran=month', null],
    ]);
    expect(links(within(dialog).getByRole('navigation', { name: 'Group by' }))).toEqual([
      ['Auto (Day)', '?account=x&from=90d&cmp=yoy', null],
      ['Day', '?account=x&from=90d&cmp=yoy&gran=day', null],
      ['Week', '?account=x&from=90d&cmp=yoy&gran=week', null],
      ['Month', '?account=x&from=90d&cmp=yoy&gran=month', 'true'],
    ]);
  });

  it('custom dates: range, week, month and quarter GET forms carry the page parameters, compare and group-by', async () => {
    view('from=90d&cmp=yoy&gran=month', { keep: { account: 'x' } });
    const dialog = await openMore('Last 90 days');
    expect(dialog).toHaveTextContent(en.timeScope.customDates);
    const range = within(dialog).getByRole('form', { name: 'Date range' });
    expect(hidden(range)).toEqual({ account: 'x', cmp: 'yoy', gran: 'month' });
    expect(within(range).getByLabelText('From')).toHaveAttribute('max', TODAY);
    expect(within(range).getByLabelText('From')).toHaveValue('2026-07-20');
    expect(within(dialog).getByRole('form', { name: 'Week' }).querySelector('input[name=week]')).toHaveValue(TODAY);
    const month = within(dialog).getByRole('combobox', { name: 'Month' });
    expect(within(month).getAllByRole('option')).toHaveLength(60);
    expect(within(month).getAllByRole('option')[0]).toHaveTextContent('October 2026');
    expect(within(within(dialog).getByRole('combobox', { name: 'Quarter' })).getAllByRole('option')[0]).toHaveTextContent('Q4 2026');
    const cmp = within(dialog).getByRole('form', { name: 'Compare with other days' });
    expect(hidden(cmp)).toEqual({ account: 'x', from: '90d', gran: 'month' });
    expect(cmp.querySelector('input[name=cfrom]')).toHaveValue('2025-07-20');
  });

  it('"All time": no comparison links or form, a hint instead; the visible presets compare again', async () => {
    view('from=all', { earliest: '2026-03-01' });
    expect(screen.getByRole('status')).toHaveTextContent(/^All time$/);
    expect(screen.getByRole('link', { name: 'Last 30 Days' })).toHaveAttribute('href', '?');
    const dialog = await openMore('All time');
    expect(within(dialog).queryByRole('navigation', { name: 'Compare with' })).toBeNull();
    expect(within(dialog).queryByRole('form', { name: 'Compare with other days' })).toBeNull();
    expect(dialog).toHaveTextContent(en.timeScope.compareAllHint);
  });

  it('a custom comparison: highlighted button, none of the three compare links current, the form holds the days', async () => {
    view('from=30d&cfrom=2025-01-01&cto=2025-01-30');
    expect(screen.getByRole('status')).toHaveTextContent('vs 1 Jan 2025 – 30 Jan 2025');
    expect(screen.getByRole('button', { name: 'More ranges' })).toHaveAttribute('data-variant', 'secondary');
    const dialog = await openMore('More ranges');
    expect(within(within(dialog).getByRole('navigation', { name: 'Compare with' })).queryByRole('link', { current: true })).toBeNull();
    expect(within(dialog).getByRole('form', { name: 'Compare with other days' }).querySelector('input[name=cfrom]')).toHaveValue('2025-01-01');
  });

  it('coverage: says where the data starts, or that nothing was captured yet', () => {
    view('from=1y', { earliest: '2026-08-01' });
    expect(screen.getByRole('status')).toHaveTextContent('Data starts 1 Aug 2026: earlier days in this range have no data.');
    view('from=7d', { earliest: null });
    expect(screen.getAllByRole('status')[1]).toHaveTextContent('No data captured yet.');
  });

  it('bucket labels: days and weeks by their first day, months by name, partial ones starred', () => {
    function Labels() {
      const day = useBucketFormat('week', ['2026-09-28']);
      const month = useBucketFormat('month');
      return <p>{[day('2026-09-28'), day('2026-10-05'), month('2026-10-01')].join(' | ')}</p>;
    }
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <Labels />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('28 Sep 2026 * | 5 Oct 2026 | October 2026')).toBeInTheDocument();
  });

  it('zh-CN: full words', () => {
    view('', { locale: 'zh-CN' });
    expect(within(screen.getByRole('navigation', { name: zh.timeScope.presets })).getAllByRole('link').map((a) => a.textContent)).toEqual(['最近 7 天', '最近 14 天', '最近 30 天']);
    expect(screen.getByRole('button', { name: zh.timeScope.more })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('最近 30 天 · 对比前 30 天');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/range-bar.test.tsx`
Expected: FAIL — `RangeBar` is not exported (the moved file still exports `TimeScopeBar`).

- [ ] **Step 4: Implement `RangeBar` in `components/shared/RangeBar.tsx`**

Keep `useScopeText`, `useBucketFormat`, `Hidden`, `pick`, `omit`, `COMPARE_KEYS`, `PICKER_MONTHS` and the four date forms of `Pickers` (range, week, month, quarter; they keep `done()` on submit). Move the "Compare with other days" form out of `Pickers` into its own `CompareDays({ scope, today, keep, done })` (same fields, hidden params and aria-label). Delete `TimeScopeBar`, the compare/granularity `<select>` forms and `submitOnChange`. Update the header comment (RangeBar, ux-polish design §4.1). Then:

```tsx
const VISIBLE: readonly Preset[] = ['7d', '14d', '30d']; // owner: only these three on screen; the rest under "More ranges"
const MORE: readonly Preset[] = PRESETS.filter((p) => !VISIBLE.includes(p));
const COMPARES = ['prev', 'yoy', 'none'] as const;

export function RangeBar({ scope, today, keep = {} }: { scope: ResolvedScope; today: string; keep?: Record<string, string> })
```
- `presetHref(p)` = `scopeHref({ ...s, range: p, cmp: p === 'all' ? 'none' : scope.preset === 'all' ? 'prev' : s.cmp }, keep)` (the old preset rule).
- `visible = scope.preset !== null && VISIBLE.includes(scope.preset)`; `tuned = !visible || s.gran !== 'auto' || s.cmp !== 'prev'` (under "all" `!visible` already holds).
- Layout: `<section aria-label={t('label')} className="mb-[var(--gp)] grid min-w-0 gap-1.5">` → row `flex min-w-0 flex-wrap items-center gap-2` with
  - `<nav aria-label={t('presets')} className="inline-flex h-[var(--ctl)] max-w-full items-center gap-0.5 rounded-md border bg-card p-0.5">` holding the three `Button asChild size="sm" variant={current ? 'secondary' : 'ghost'}` → `Link href={presetHref(p)} aria-current={current ? 'page' : undefined} scroll={false}` with `t(\`preset.${p}\`)`;
  - `<FilterPanel label={visible ? t('more') : scope.preset ? t(\`preset.${scope.preset}\`) : text.label} title={t('customTitle')} description={t('customHint', { tz: prefs.timezone })} active={tuned} open={open} onOpenChange={setOpen}>` holding, in order: `FilterOptions label={t('otherRanges')}` (MORE, `current: p === scope.preset`); a `grid gap-2` block with a `text-sm font-medium` heading `t('customDates')` and `<Pickers …/>`; under "all" a `text-xs text-muted-foreground` paragraph `t('compareAllHint')`, otherwise `FilterOptions label={t('compareWith')}` (COMPARES with `t(\`cmp.${c}\`)`, `scopeHref({ ...s, cmp: c }, keep)`, `current: s.cmp === c`) followed by `<CompareDays …/>`; `FilterOptions label={t('gran')}` (GRANULARITIES; `auto` labelled `t('granOption.auto', { gran: t(\`granOption.${autoGranularity(daysIn(scope.range))}\`) })`, `scopeHref({ ...s, gran: g }, keep)`, `current: s.gran === g`).
- The summary `<p role="status">` exactly as before (label · vs, note on its own line). No `useRouter` anywhere in the file.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/range-bar.test.tsx tests/time-scope.test.ts tests/account-view.test.tsx tests/overview-view.test.tsx tests/calendar.test.tsx tests/calendar-page.test.tsx tests/explorer-view.test.tsx tests/export-dialog.test.tsx tests/report-document.test.tsx tests/messages.test.ts` and `npx tsc --noEmit` and `npx eslint components/shared/RangeBar.tsx components/calendar/CalendarView.tsx components/overview/OverviewView.tsx components/explorer/ExplorerView.tsx components/account/AccountView.tsx components/account/AccountOverview.tsx components/export/ExportDialog.tsx components/report/ReportDocument.tsx`
Expected: PASS (range-bar: 12 tests; every other file unchanged in count); typecheck and eslint clean.

- [ ] **Step 6: Commit**

```bash
git add -A components/shared/TimeScopeBar.tsx components/shared/RangeBar.tsx tests/time-scope-bar.test.tsx tests/range-bar.test.tsx
git add components/calendar/CalendarView.tsx components/overview/OverviewView.tsx components/explorer/ExplorerView.tsx components/account/AccountView.tsx components/account/AccountOverview.tsx components/export/ExportDialog.tsx components/report/ReportDocument.tsx messages/en.json messages/zh-CN.json tests/account-view.test.tsx tests/overview-view.test.tsx
git commit -m "feat(ui): RangeBar (Last 7/14/30 Days + More ranges) replaces TimeScopeBar; full-word range labels" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
