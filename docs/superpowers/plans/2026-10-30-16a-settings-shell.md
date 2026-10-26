# Plan 16a: Settings redesign — the shell, the sections, one consistent save model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** Replace the three client-side tabs of `/settings` (General = the `PrefsBar` pill wall, Notifications, Account) with a Settings **shell**: a section list (desktop: a left list; phone: a native select at the top) and six URL-addressable sections `/settings/appearance`, `/settings/language`, `/settings/notifications`, `/settings/accounts`, `/settings/security`, `/settings/data`. Appearance (theme, light / dark / auto, density, corners) with a live preview card; Language & formats with the plain timezone explanation and a live sample; Notifications (this device: permission, on/off and a **test notification**; alert rules with their thresholds; a **devices list with remove**); Accounts & sync (a compact overview with status, token expiry, last sync, Sync now, Reconnect and the comments-scope hint; the full management stays on `/accounts`); Security (today's email + two-factor card, the slot Plan 16b fills); Data & privacy (a short "what we store" placeholder, the slot Plan 16c fills). **One save model:** preferences save instantly with a toast and a visible **Retry** when saving fails (no more swallowed errors in `PrefsProvider` / `setPrefs`); forms save explicitly with dirty tracking, a sticky save bar, inline success / error and an unsaved-changes guard.

**Architecture:** One optional catch-all route `app/(app)/settings/[[...section]]/page.tsx` resolves the URL through a pure registry (`lib/settings/sections.ts`: ids, order, icon, i18n keys, legacy redirects) and renders ONE zero-prop section component from `components/settings/sections/<Id>Section.tsx`; `app/(app)/settings/layout.tsx` holds the page header and the section nav (`SettingsNav`, client, `usePathname` for `aria-current`) so switching sections streams only the section. Each section loads its own data (server components call the per-request cached `requireOwner()`), so Plans 16b/16c replace one file each without touching the route. The save model lives in three small pieces: `setPrefs` now RETURNS `{ ok }` and `PrefsProvider` exposes `status` + `retry` (a `PrefsSaveNotice` in the root layout turns them into toasts, so every preference change anywhere — the header's mode toggle included — reports success or failure); `SaveBar` + `useUnsavedGuard` / `confirmLeave` (`components/settings/`) for explicit-save forms; the shared `Segmented` control replaces pill walls. "Auto" mode resolves the system colour scheme on the client (a 3-line inline script before paint + a `prefers-color-scheme` listener) and needs ONE tiny migration (the `profiles.mode` CHECK list).

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, next-intl 4, `sonner` toasts (already mounted in `app/layout.tsx`), shadcn `Card` / `Button` / `Select` / `Switch` / `Input`, the shared `FormField`, `LoadingButton`, `ConfirmDialog`, `EmptyState`, `PageHeader`, `Skeletons`, Vitest 5 + Testing Library + jsdom 29. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §7 "Phase E — Settings redesign" (sections, URL-addressable, the save model, grouped cards, no pill walls, 360/768/1280), §8 (i18n, tokens, responsive, a11y). UX rules: `docs/UI_STANDARDS.md` 1–17. Project rules: `CLAUDE.md` (binding). Current state and lessons: `docs/PROGRESS.md`. Sibling plans written at the same time: **Plan 16b** (Security: change password, forgot / reset password, sessions; `docs/superpowers/plans/2026-10-30-16b-security.md`) and later **Plan 16c** (Data & privacy). The contract they build on is in "Interfaces for Plans 16b and 16c" at the end.

**Scratch run:** see "Scratch-run result" at the end. Not executed: the build, a browser, a real push service, the migration on a database (no database may be touched) — `docs/RUNBOOK_SETTINGS.md` (Task 11) has the live checks.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **Section ids and order (fixed, in the registry):** `appearance` · `language` · `notifications` · `accounts` · `security` · `data`. Titles: Appearance · Language & formats · Notifications · Accounts & sync · Security · Data & privacy (zh-CN: 外观 · 语言与格式 · 通知 · 账号与同步 · 安全 · 数据与隐私). Icons (lucide): `Palette`, `Languages`, `Bell`, `RefreshCw`, `ShieldCheck`, `Database`.
- **URLs:** `/settings` → `redirect('/settings/appearance')` (a 307 from the server page, so it works inside a tab frame, from the user menu and from bookmarks). The old page had **no URL state** (its tabs were `defaultValue="general"` client state), so there is nothing to keep, but the old tab names are honoured anyway if they ever appear as `?tab=`: `general` → `appearance`, `notifications` → `notifications`, `account` → `security`; any other `?tab=` → `appearance`. An unknown section (`/settings/bogus`) or a deeper path (`/settings/a/b`) → `notFound()`. The nav item stays `href: '/settings'` (`lib/nav.ts` unchanged; `isActive` already matches `/settings/*`, and `isTabPath` keeps every `/settings/*` inside its tab, so nothing breaks out).
- **Route shape:** ONE optional catch-all `app/(app)/settings/[[...section]]/page.tsx` (+ its `loading.tsx`) under a `settings/layout.tsx`; the old `settings/page.tsx` and `settings/loading.tsx` are deleted (a `page.tsx` beside an optional catch-all is a Next.js conflict, and a `loading.tsx` at `settings/` would wrap the section pages, which `tests/route-loading.test.tsx` forbids). Not `next.config.ts` redirects (keeps that file untouched; the owner check runs first).
- **Section nav:** desktop (`md` and up) = a vertical list in a `<nav aria-label="Settings sections">` beside the content, each item a link (icon + title) with `aria-current="page"` on the open one (same look as the sidebar items: `aria-[current=page]:bg-accent`). Phone (below `md`) = ONE native `<select>` labelled "Section" at the top (`h-[var(--ctl)]`, theme input border; rule 9), navigating on change. Not a segmented control (six labels do not fit at 360 px: exactly the pill wall the spec forbids), not underline tabs (they would scroll sideways and hide sections). CSS breakpoints only (`md:hidden` / `hidden md:block`), never `matchMedia` for layout.
- **One section = one component with no props** (`components/settings/sections/<Id>Section.tsx`, export `<Id>Section`): a server component loads its own data (`requireOwner()` is `React.cache`d per request, so the extra calls are free) and passes server actions to client children; a client-only section (Appearance, Language) is a `'use client'` file. The page maps `SectionId → component` in one object literal.
- **Save model, preferences (Appearance, Language & formats): instant.** Every pick applies at once (as today) and is saved in the background; when the save finishes a toast says "Saved" (sonner, one fixed toast id `prefs-save`, so quick changes replace one toast instead of stacking); when it fails the toast says "Couldn't save this setting. It works on this device until you reload." with a **Retry** action and stays until retried or dismissed. Failure = the server action rejected (offline, server error) OR `setPrefs` returned `{ ok: false }` (the cookie was written but the profile row was not). Retry re-sends every key that has not been saved yet (merged), so two failed changes are retried together. Language & formats is instant too (each option is one preference; a form with Save for six independent selects would only add a step); the language switch still reloads the app as today.
- **Save model, forms (alert rules today; 16b's password form later): explicit.** Dirty tracking against the last stored values; a **sticky save bar** at the bottom of the form (`sticky bottom-0`, inside the tab frame, which already ends above the phone bottom bar; `pb-[env(safe-area-inset-bottom)]`) with the state text ("You have unsaved changes" / "Saved" / the error), **Discard** and **Save** (both default size, rule 5; Save disabled while clean); `role="status"` for success, `role="alert"` for errors; the server's normalised values replace the form's after a save (unchanged behaviour).
- **Unsaved-changes guard (deliberately small):** while a form is dirty, (1) `beforeunload` asks before a reload or closing the window, and (2) the settings section nav (list links and the phone select) asks `window.confirm("Leave without saving? Your changes to this section will be lost.")`. Not guarded (documented in the runbook): the shell's sidebar / tab strip / bottom bar (they navigate the frame by message), closing a tab in the strip, browser Back. A module-level counter in `components/settings/unsaved.ts`, no context, no router patching.
- **Appearance:** four grouped cards on the left (Theme: Ink / Sunset / Forest / Mono; Mode: Light / Dark / Auto; Density: Dense / Comfortable; Corners: Sharp / Soft / Round), each a `Segmented` control with a one-line hint; on the right (`lg`, stacked below on smaller screens) a **live preview card** that shows real pieces in the current tokens: a heading and body text, a KPI ("Reach 12,480 · +8.2%" through `lib/format.ts`), a primary and an outline button, a badge, an input, and a six-bar strip in `--chart-1..6`. The whole app re-themes instantly anyway; the preview shows the controls side by side without leaving Settings. Theme names are proper nouns and stay untranslated (as in `PrefsBar`).
- ⚠ **"Auto" mode (follow the device's light/dark setting) is in this plan** because the approved spec lists it. It needs the plan's ONLY migration, `20261030000001_prefs_auto_mode.sql` (the `profiles.mode` CHECK list gains `'auto'`), applied BEFORE deploying (until then choosing Auto works on the device but the save toast says it failed, with Retry — visible, not silent). The server cannot know the device's scheme, so the page is rendered `data-mode="light"` plus `data-mode-auto="true"`, a 3-line inline script in `<head>` switches to `dark` before first paint when `prefers-color-scheme: dark` matches, and `PrefsProvider` follows later changes of the device setting. `matchMedia` is used for the COLOUR SCHEME only (the "no matchMedia" rule is about layout). The header's moon/sun toggle flips the mode that is SHOWN (Auto showing dark → Light). Task 10 is self-contained and can be dropped without touching the other tasks (Open question 1).
- **Language & formats:** Language (`Segmented`: English / 简体中文; hint "The app reloads in the new language"), Formats card (Date format = a `Select` whose options are the sample date rendered in each format; Time format = `Segmented` with samples "21:30" / "9:30 PM"; Number format = `Select` with "1,234,567.89" rendered per format; Week starts on = `Segmented` Monday / Sunday), Timezone card (`Select` of `withCurrentZone(...)` plus the plain explanation: "Your days start at midnight in this timezone. It changes where each day begins and ends in every chart, list and alert."), and a **live sample** line under the cards: "Example: 15 Mar 2026, 07:30 · 1,234,567.89" = `formatDateTime(SAMPLE_AT, prefs)` and `formatNumber(1234567.89, prefs)`, where `SAMPLE_AT = '2026-03-14T23:30:00Z'` (fixed, so the server and client render the same text; 23:30 UTC is already the next day in Asia, so switching the timezone visibly moves the date).
- **Notifications:** moved in as-is, plus two additions. (1) **Test notification:** when push is on for this device, "Send a test notification" calls `sendTestPushAction(endpoint)`: the server looks the endpoint up in the owner's `push_subscriptions` (RLS), sends ONE push to it only (title "in2sight test", body "Push notifications work on this device.", url `/settings/notifications`, tag `test`) and answers `ok` or an error key (`not_configured`, `gone` (the push service dropped it; the row is pruned), `failed`, `invalid`, `unexpected`). (2) **Devices list:** every stored subscription as "Chrome · Windows — added 12 Oct 2026" (label derived on the server from the stored user agent by `deviceLabel`, literal product names, "Unknown device" otherwise), newest first, max 20 (the existing `MAX_SUBSCRIPTIONS`), each with Remove (a `ConfirmDialog`) → `deleteDeviceAction(id)`. The endpoint never reaches the list (ids only). The current device is NOT marked in the list (that would need the browser's endpoint matched against server rows); the list says "To stop push on this device, use Turn off above." (Open question 4). Alert rules (`AlertSettingsForm`) keep their fields and ranges and gain the explicit-save model.
- **Accounts & sync = a compact overview, not a second Accounts page.** One card per non-archived account: avatar initial + @username (+ display name), status badge (`StatusBadge`), the comments-scope hint ("Reconnect to enable comments", `CommentsHint`), token meter (`TokenMeter`: days left), last sync and the latest error (`SyncInfo`), and two buttons: **Sync now** (active accounts; `syncNowAction` from `app/(app)/accounts/actions.ts`, busy state, result announced, page refreshed) and **Reconnect** (a link to `connectHref(groupName)` with `target="_top"`, like the Accounts page). A header link **Manage accounts** → `/accounts` (groups, archive, delete, connect a new account, import progress live there). No groups, no archived list, no live import progress panel, no connect dialog (Open question 3). `Identity`, `SyncInfo` and `CommentsHint` move out of `AccountsView.tsx` into `components/accounts/AccountParts.tsx` (second use → extract; CLAUDE.md). The page segment exports `maxDuration = 60` because a server action inherits its page's limit and Sync now runs a tick (as `accounts/(list)/page.tsx` does).
- **Security (16a):** the existing "Signed in as" card and `TwoFactorCard`, unchanged, moved from the old Account tab into `SecuritySection.tsx`. **Plan 16b REPLACES that file** (keeps its name and export) and adds change password and sessions; 16a ships it so two-factor never disappears between the plans.
- **Data & privacy (16a):** one card "What in2sight stores" (insights and posts of your connected accounts, cover images, comments, follower exports; all deleted with the account on the Accounts page; never shared) and a line "Export and delete-everything tools are coming." **Plan 16c REPLACES `DataSection.tsx`.**
- **`PrefsBar` stays** (the styleguide's theme switcher and `tests/prefs-bar.test.tsx` use it); it is no longer used by Settings. `TimezoneSelect` stays for `PrefsBar`.
- **Revalidation:** the settings actions revalidate `revalidatePath('/settings', 'layout')` (every section; a plain `'/settings'` would no longer match the section pages).
- **No new tables, no new columns, no new dependencies, no new design tokens.** New shared pieces: `Segmented` (`components/shared/`), `SaveBar` + the guard (`components/settings/`); both get a styleguide demo and a UI-standards rule (18).

## Open questions for the owner (the plan implements the default shown)

1. **Auto mode with one small migration** (`profiles.mode` may be `auto`; apply before deploying)? **Default: yes** (approved spec). Alternative: keep Light / Dark only, drop Task 10, no migration.
2. **Phone section picker = one native select** ("Section: Appearance ▾") rather than a list page you go back from? **Default: the select** (always visible, one tap, no extra page). A list-first phone page (`/settings` shows the list, a section opens full screen with a Back link) is the alternative.
3. **Accounts & sync shows only active / needs-reconnect accounts with Sync now and Reconnect**, and links to `/accounts` for everything else (groups, archive, delete, connect, import progress)? **Default: yes.**
4. **Devices list without a "this device" mark?** **Default: yes** (no endpoint leaves the server; turning this device off stays in the card above).
5. **A "Saved" toast for every preference change, including the header's mode toggle?** **Default: yes** (one toast id, replaced on each change, 2 s; the spec's "instant with toast"). Alternative: toast only on failure.
6. **Unsaved-changes guard only on reload / closing the window and on the settings section nav** (not on the shell's sidebar, tab strip or Back)? **Default: yes** (the shell navigates frames by message; guarding it would mean a new shell protocol message).

## Assumptions about the current code (`main` at `9df9b2b`, read for this plan)

- `app/(app)/settings/page.tsx` renders `PageHeader` + `Tabs defaultValue="general"` (General = `<PrefsBar />`; Notifications = `NotificationsCard` + `AlertSettingsForm`; Account = "Signed in as" card + `TwoFactorCard`); `app/(app)/settings/loading.tsx` = header + 3 tab skeletons; `app/(app)/settings/actions.ts` holds `startEnrollAction`, `confirmEnrollAction`, `disableAction`, `saveSubscriptionAction`, `deleteSubscriptionAction`, `saveAlertSettingsAction` (each `requireOwner()` first; owner-session client; revalidates `'/settings'`), `MAX_SUBSCRIPTIONS = 20`, `export type PushResult`.
- `app/actions.ts setPrefs(partial: unknown): Promise<void>` writes the cookie, calls `persistPrefsToProfile` inside a `try {} catch {}` (swallowed) and revalidates `('/', 'layout')`. `lib/prefs.sync.server.ts persistPrefsToProfile(prefs, keys): Promise<void>` never throws and logs a fixed message on failure.
- `components/providers/PrefsProvider.tsx`: `PrefsProvider({ initial, persist, children })`, `usePrefs(): { prefs, update }`, `applyPrefsToDocument(p, el?)`, `PREFS_CHANNEL = 'in2sight:prefs'` (BroadcastChannel to the other documents; a `locale` change is shared only after it is saved, and the top window reloads). `update` does `Promise.resolve(persist(partial)).catch(() => {})` — the swallow this plan removes. `tests/prefs-provider.test.tsx` renders the provider WITHOUT `NextIntlClientProvider` (so the provider itself must stay translation-free).
- `app/layout.tsx` mounts `NextIntlClientProvider` → `PrefsProvider initial={prefs} persist={setPrefs}` → `NavigationProgress`, `FrameBreakout`, `TooltipProvider`, `<Toaster position="bottom-right" />`, `ServiceWorker`; `<html {...htmlAttrs(prefs)}>`; `generateViewport` uses `themeColor(prefs)`.
- `lib/prefs.ts`: `MODES = ['light', 'dark']`, `htmlAttrs(p)` → `lang`, `data-theme`, `data-mode`, `data-density`, `data-radius`. `lib/pwa.ts THEME_COLORS: Record<Theme, Record<Mode, string>>`, `themeColor(p)`. `styles/tokens.css` selects palettes by `[data-theme][data-mode="light"|"dark"]`. `profiles.mode` has `check (mode in ('light', 'dark'))` (inline column check in `20261014000001_owner_and_profiles.sql`, so Postgres named it `profiles_mode_check`). `tests/prefs-sync.test.ts` pins every CHECK list to `MODES` etc.; `tests/pwa.test.ts` loops `MODES` over `THEME_COLORS`.
- `components/settings/AlertSettingsForm.tsx` (`AlertSettingsFormProps { initial; save }`, fields `push` + `reachDropPct`, `takingOffRatio`, `syncFailures`, Save + `role="status"` / `role="alert"`), `components/settings/NotificationsCard.tsx` (`NotificationsCardProps { vapidPublicKey; swEnabled; save; remove }`, statuses `checking | dev-only | unsupported | ios-install | not-configured | denied | off | on`), tests in `tests/settings-notifications.test.tsx` (the AlertSettingsForm "a failed save shows an error" test clicks Save WITHOUT changing anything: it must change a field first once Save is disabled while clean).
- `push_subscriptions (id bigint identity, endpoint text unique, keys jsonb, user_agent text, created_at timestamptz)`, owner-all RLS. `lib/push/subscription.ts` (`parseEndpoint`, `parseSubscription`, `clipUserAgent`, `vapidKeyBytes`), `lib/push/send.ts` (`import 'server-only'`; `vapidFromEnv`, `webPushTransport`, `sendToAll(subs, msg, transport, prune)`, `PushSub`), `lib/alerts/push-message.ts PushMessage { title; body; url; tag }`.
- `components/accounts/AccountsView.tsx` has LOCAL `SyncInfo`, `Identity`, `CommentsHint` (and `RowMenu`, `GroupBadge`); `StatusBadge`, `TokenMeter`, `SyncBadge` are their own files; `connectHref(group)` is exported from `components/accounts/ConnectDialog.tsx`; `syncNowAction(id)` from `app/(app)/accounts/actions.ts` (`Result = { ok: true } | { ok: false; error: string }`, revalidates `/accounts`); `loadAccounts()` / `loadSyncStatus()` from `lib/dashboard/cached.ts` (React.cache, owner session). Error keys translate via `accounts.errors.*`.
- `requireOwner()` = `React.cache(loadOwnerContext)` → `{ userId, email }`. `getMfaStatus(db)`, `parseAlertSettings(raw)`.
- `lib/nav.ts`: Settings item `href: '/settings'`; `isActive(pathname, href)` matches sub-paths. `lib/tabs/model.ts isTabPath` = any nav section and below, so `/settings/*` stays in its tab frame; `FrameBreakout` leaves it alone. Pages ALWAYS render inside a tab frame (the top window is the shell); the frame region ends above the phone bottom bar.
- `tests/route-loading.test.tsx` lists `'(app)/settings'` among the pages (sanity) and requires a `loading.tsx` beside every page and NO `loading.tsx` above another page. `tests/push-actions.test.ts` asserts `['revalidate', '/settings']` for `saveAlertSettingsAction`.
- `messages/en.json` and `messages/zh-CN.json` are line-aligned in the blocks used here: `prefs` (lines 63–83, last entry `"sun"` at 82), `styleguide.standards` (97–110, last entry `"sampleReach"` at 109), `settings` (207–261: `"subtitle"` 226, `"tabs"` 227–231, `"account"` 232–234, `notifications.saveError` 259). The one stray CR is on line 22 (`"ascending"`), not near any anchor.

## Out of scope

Change password, forgot / reset password, sessions (Plan 16b). Storage used, export all, delete all (Plan 16c). A "this device" mark in the devices list, guarding the shell's own navigation, per-section Suspense skeletons beyond one `loading.tsx`, a list-first phone layout, quiet hours / daily digest settings (later: spec §0b alerts policy), moving `PrefsBar` / `TimezoneSelect` out of the styleguide.

## Global Constraints

- **Files:** touch ONLY the files your task lists. Tasks of one wave touch disjoint files.
- **i18n:** every string through next-intl; keys only from Task 1 (and the removal named in Task 9). Server actions return error KEYS. Theme names (Ink, Sunset, Forest, Mono), language names (English, 简体中文) and the rendered format samples are not translated.
- **Formats:** dates, times and numbers only through `lib/format.ts` (`formatDate`, `formatTime`, `formatDateTime`, `formatNumber`, `formatPercent`).
- **Tokens only** (`bg-card`, `text-muted-foreground`, `border-border`, `bg-accent`, `--chart-1..6`, `--ctl`, `--gp`, `--pc`); no raw colours; check light, dark and every theme.
- **One control height per row** (rule 5): every button, select and segmented control in a row is `--ctl` high; `size="sm"` only for the buttons INSIDE `Segmented` and in the devices list rows. Native selects: `h-[var(--ctl)] rounded-md border border-input bg-background px-2` (rule 9).
- **Responsive:** mobile-first, works at 360 / 768 / 1280; `min-w-0` on grid children; long names `truncate` / `break-words`; no fixed pixel widths on layout containers; CSS breakpoints only.
- **A11y:** the section list is a `<nav>` with `aria-current="page"`; every control has a label (`FormField`, `aria-label`, or a `role="group"` with `aria-label`); results `role="status"`, errors `role="alert"`; focus returns to the opener after a dialog (`ConfirmDialog` does it).
- **Security:** every server action calls `requireOwner()` FIRST and validates its input; the owner-session client only (never the admin client in settings); no endpoint, key or token in client props or logs; errors are fixed keys (Supabase text never reaches the browser).
- **Iframes:** every settings URL works chromeless inside a tab frame; links that leave the app (Instagram connect) keep `target="_top"`; no `window.top` access from settings code.
- **Tests:** Vitest + Testing Library; components render inside `NextIntlClientProvider locale="en" messages={en}` and, when they use `usePrefs`, inside `PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}`; Radix `Select` needs the jsdom stubs used in `tests/prefs-bar.test.tsx` (`hasPointerCapture`, `setPointerCapture`, `releasePointerCapture`, `scrollIntoView`) — prefer native `<select>` in new code (no stubs, rule 9); match whole class tokens, never loose regexes.

## Review Focus (for the final whole-change review)

1. `PrefsProvider`: failures are never swallowed; `retry` re-sends exactly the unsaved keys; the BroadcastChannel still shares every change (language after the save); no toast from a change received over the channel; the existing `tests/prefs-provider.test.tsx` cases still pass.
2. `setPrefs` still writes the cookie first and revalidates; returns `{ ok: false }` only when the profile write failed; junk input still never throws.
3. Routing: `/settings` and legacy `?tab=` redirect; unknown / deep paths 404; the catch-all page and the layout render inside a frame; `maxDuration = 60` present; no `loading.tsx` wraps another page.
4. Save bar: Save disabled while clean; Discard restores the stored values; server-normalised values replace the form's; `beforeunload` registered only while dirty and removed after; the section nav asks before leaving a dirty form.
5. `sendTestPushAction` / `deleteDeviceAction`: owner first, input validated, owner-session client, only the one endpoint is pushed, a 404/410 prunes, no endpoint in the devices props.
6. Auto mode: no flash on first paint in dark system mode (inline script before paint), `htmlAttrs` and `themeColor` resolve auto, the listener is removed on unmount and when the mode leaves auto, the migration only widens the CHECK list.
7. UI standards: one control height, no pill walls, full-word labels, tokens only, 360 px layout of every section, zh-CN strings fit.

## File Structure

| File | Responsibility |
|---|---|
| `messages/en.json`, `messages/zh-CN.json` | every new key (Task 1); `settings.tabs` removed (Task 9) |
| `app/actions.ts`, `lib/prefs.sync.server.ts`, `components/providers/PrefsProvider.tsx`, `components/providers/PrefsSaveNotice.tsx` (new), `app/layout.tsx` | the instant save model: `setPrefs` returns `{ ok }`, provider `status` + `retry`, the toast (Task 2) |
| `lib/settings/sections.ts` (new) | the registry: `SECTION_IDS`, `SectionId`, `SECTIONS`, `DEFAULT_SECTION`, `isSectionId`, `sectionHref`, `routeSettings` (Task 3) |
| `components/settings/unsaved.ts` (new), `components/settings/SaveBar.tsx` (new), `components/shared/Segmented.tsx` (new) | the form save model and the option control (Task 3) |
| `lib/push/devices.ts` (new), `app/(app)/settings/actions.ts` | `deviceLabel`, `listPushDevices`; `deleteDeviceAction`, `sendTestPushAction`, layout revalidation (Task 4) |
| `components/accounts/AccountParts.tsx` (new), `components/accounts/AccountsView.tsx` | `Identity`, `SyncInfo`, `CommentsHint` extracted (Task 5) |
| `components/settings/AlertSettingsForm.tsx`, `components/settings/NotificationsCard.tsx`, `components/settings/DeviceList.tsx` (new) | notifications with the new save model, test push, devices (Task 6) |
| `components/settings/sections/AppearanceSection.tsx` (new), `components/settings/sections/LanguageSection.tsx` (new) | the two preference sections (Task 7) |
| `components/settings/AccountsOverview.tsx` (new), `components/settings/sections/AccountsSection.tsx` (new) | Accounts & sync (Task 8) |
| `app/(app)/settings/layout.tsx` (new), `app/(app)/settings/[[...section]]/page.tsx` (new), `app/(app)/settings/[[...section]]/loading.tsx` (new), `components/settings/SettingsNav.tsx` (new), `components/settings/sections/NotificationsSection.tsx`, `SecuritySection.tsx`, `DataSection.tsx` (new); `app/(app)/settings/page.tsx`, `app/(app)/settings/loading.tsx` (deleted) | the shell and the route (Task 9) |
| `lib/prefs.ts`, `lib/pwa.ts`, `components/providers/PrefsProvider.tsx`, `app/layout.tsx`, `components/shared/ModeToggle.tsx`, `supabase/migrations/20261030000001_prefs_auto_mode.sql` (new) | Auto mode (Task 10) |
| `app/styleguide/StandardsGallery.tsx`, `docs/UI_STANDARDS.md`, `tests/ui-standards.test.ts`, `docs/RUNBOOK_SETTINGS.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md` | styleguide demo, rule 18 + guard, runbook, docs (Task 11) |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line(s) shown with the lines shown), never by loading and re-serialising the JSON (both files are hand-formatted and carry one stray `\r` on line 22). Keep every other line byte-identical; both locales get the same keys; Simplified Chinese with full-width punctuation.

## Tasks

| # | Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|---|
| 1 | i18n: every new key | — | `messages/en.json`, `messages/zh-CN.json` | 4, 5 |
| 2 | Instant save model (setPrefs result, provider status + retry, toast) | 1 | `app/actions.ts`, `lib/prefs.sync.server.ts`, `components/providers/PrefsProvider.tsx`, `components/providers/PrefsSaveNotice.tsx`, `app/layout.tsx`, `tests/set-prefs.test.ts`, `tests/prefs-sync-server.test.ts`, `tests/prefs-provider.test.tsx`, `tests/prefs-save-notice.test.tsx` | 3, 8 |
| 3 | Registry, unsaved guard, `SaveBar`, `Segmented` | 1 | `lib/settings/sections.ts`, `components/settings/unsaved.ts`, `components/settings/SaveBar.tsx`, `components/shared/Segmented.tsx`, `tests/settings-sections.test.ts`, `tests/settings-save-bar.test.tsx`, `tests/segmented.test.tsx` | 2, 8 |
| 4 | Devices reader, test push, delete device, layout revalidation | — | `lib/push/devices.ts`, `tests/push-devices.test.ts`, `app/(app)/settings/actions.ts`, `tests/push-actions.test.ts` | 1, 5 |
| 5 | Extract `Identity`, `SyncInfo`, `CommentsHint` | — | `components/accounts/AccountParts.tsx`, `components/accounts/AccountsView.tsx`, `tests/account-parts.test.tsx` | 1, 4 |
| 6 | Notifications pieces: explicit save, test button, devices list | 1, 3 | `components/settings/AlertSettingsForm.tsx`, `components/settings/NotificationsCard.tsx`, `components/settings/DeviceList.tsx`, `tests/settings-notifications.test.tsx`, `tests/device-list.test.tsx` | 7, 10 |
| 7 | Appearance and Language & formats sections | 1, 2, 3 | `components/settings/sections/AppearanceSection.tsx`, `components/settings/sections/LanguageSection.tsx`, `tests/settings-appearance.test.tsx`, `tests/settings-language.test.tsx` | 6, 10 |
| 8 | Accounts & sync section | 1, 5 | `components/settings/AccountsOverview.tsx`, `components/settings/sections/AccountsSection.tsx`, `tests/settings-accounts.test.tsx` | 2, 3 |
| 9 | The shell and the route (layout, nav, page, loading, remaining sections, old page removed) | 1–8 | `app/(app)/settings/layout.tsx`, `app/(app)/settings/[[...section]]/page.tsx`, `app/(app)/settings/[[...section]]/loading.tsx`, `app/(app)/settings/page.tsx` (delete), `app/(app)/settings/loading.tsx` (delete), `components/settings/SettingsNav.tsx`, `components/settings/sections/NotificationsSection.tsx`, `components/settings/sections/SecuritySection.tsx`, `components/settings/sections/DataSection.tsx`, `tests/settings-nav.test.tsx`, `tests/settings-page.test.tsx`, `tests/route-loading.test.tsx`, `messages/en.json`, `messages/zh-CN.json` (removal of `settings.tabs` only) | 11 |
| 10 | Auto mode + migration | 1, 2 | `lib/prefs.ts`, `lib/pwa.ts`, `components/providers/PrefsProvider.tsx`, `app/layout.tsx`, `components/shared/ModeToggle.tsx`, `supabase/migrations/20261030000001_prefs_auto_mode.sql`, `tests/prefs-auto-mode.test.tsx`, `tests/prefs-sync.test.ts`, `tests/pwa.test.ts` | 6, 7 |
| 11 | Styleguide, UI standard 18 + guard, runbook, docs | 3, 6 (and the names of 9) | `app/styleguide/StandardsGallery.tsx`, `docs/UI_STANDARDS.md`, `tests/ui-standards.test.ts`, `docs/RUNBOOK_SETTINGS.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md` | 9 |

**Waves:** W1 = 1, 4, 5 · W2 = 2, 3, 8 · W3 = 6, 7, 10 · W4 = 9, 11. After each wave the orchestrator cherry-picks, removes the worktrees, `rm -rf .next`, and runs `npm run check` (implementer-rules "Orchestrator checklist"). Every task leaves `main` green on its own: until Task 9 the old `/settings` page keeps working (Tasks 4 and 6 keep the props it passes; Task 2 keeps `update`'s call shape).

---

### Task 1: i18n — every new key (additions only)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`.

Every key the later tasks use. Additions only, plus ONE changed value (`settings.subtitle`, both locales). `settings.tabs` stays until Task 9 removes it (the old page uses it until then).

- [ ] **Step 1: Insert the blocks below** (Edit tool; each anchor occurs exactly once; the replacement keeps the anchor line, now with a trailing comma where needed). Note the third anchor REPLACES the `subtitle` value.

#### `messages/en.json`

1. Replace the anchor

```json
    "sun": "Sunday"
  },
```

   with

```json
    "sun": "Sunday",
    "auto": "Auto"
  },
```

2. Replace the anchor

```json
      "sampleReach": "Most reach"
```

   with

```json
      "sampleReach": "Most reach",
      "segmented": "Segmented control",
      "saveBar": "Save bar"
```

3. Replace the anchor

```json
    "subtitle": "Appearance, formats and security",
```

   with

```json
    "subtitle": "Appearance, notifications, accounts and security",
    "sections": {
      "nav": "Settings sections",
      "pick": "Section",
      "appearance": {
        "title": "Appearance",
        "description": "Theme, light or dark, density and corners. Changes apply at once and are saved for every device."
      },
      "language": {
        "title": "Language & formats",
        "description": "Language, date, time and number formats, week start and timezone."
      },
      "notifications": {
        "title": "Notifications",
        "description": "Push on this device, which alerts you get, and the devices that receive them."
      },
      "accounts": {
        "title": "Accounts & sync",
        "description": "The state of each connected account. Groups, archive and delete are on the Accounts page."
      },
      "security": {
        "title": "Security",
        "description": "How you sign in and how your account is protected."
      },
      "data": {
        "title": "Data & privacy",
        "description": "What in2sight stores and how to remove it."
      }
    },
    "unsaved": {
      "bar": "You have unsaved changes",
      "discard": "Discard",
      "confirm": "Leave without saving? Your changes to this section will be lost."
    },
    "prefsSave": {
      "saved": "Saved",
      "error": "Couldn't save this setting. It works on this device until you reload.",
      "retry": "Retry"
    },
    "appearance": {
      "themeHint": "Colours for the whole app, charts included.",
      "modeHint": "Auto follows your device's light or dark setting.",
      "densityHint": "Dense fits more on the screen; Comfortable gives more space.",
      "radiusHint": "How round the corners of buttons and cards are.",
      "previewTitle": "Preview",
      "previewDescription": "How pages look with these choices.",
      "previewHeading": "Weekly reach",
      "previewBody": "Your Reels reached more people than usual this week.",
      "previewKpi": "Reach",
      "previewPrimary": "Save",
      "previewSecondary": "Cancel",
      "previewBadge": "New",
      "previewInput": "Search posts",
      "previewChart": "Chart colours"
    },
    "language": {
      "languageHint": "The app reloads in the new language.",
      "formatsTitle": "Formats",
      "formatsDescription": "How dates, times and numbers are written everywhere, exports included.",
      "timezoneHint": "Your days start at midnight in this timezone. It changes where each day begins and ends in every chart, list and alert.",
      "sample": "Example: {date} · {number}"
    },
    "accountsSync": {
      "list": "Connected accounts",
      "manage": "Manage accounts",
      "syncNow": "Sync now",
      "reconnect": "Reconnect",
      "synced": "Synced @{username}",
      "lastSync": "Last sync",
      "empty": "No accounts connected yet.",
      "emptyAction": "Connect an account"
    },
    "data": {
      "title": "What in2sight stores",
      "insights": "Insights, posts, Stories and audience numbers of your connected accounts, kept from the day you connected them.",
      "covers": "Cover images of your posts and Stories, in private storage.",
      "comments": "Comments on your posts and the follower exports you upload. These are other people's data: only you can see them.",
      "delete": "Deleting an account on the Accounts page removes all of its data. Nothing is shared with anyone.",
      "soon": "Export and delete-everything tools are coming."
    },
```

4. Replace the anchor

```json
      "saveError": "Couldn't save. Try again."
```

   with

```json
      "saveError": "Couldn't save. Try again.",
      "testSend": "Send a test notification",
      "testSent": "Sent. It should appear on this device in a few seconds.",
      "testTitle": "in2sight test",
      "testBody": "Push notifications work on this device.",
      "testErrors": {
        "not_configured": "Push isn't set up on the server yet.",
        "gone": "This device's subscription has expired. Turn notifications off and on again.",
        "failed": "The push service didn't accept the test. Try again later.",
        "invalid": "This device isn't subscribed.",
        "unexpected": "Something went wrong. Try again."
      },
      "devicesTitle": "Devices",
      "devicesDescription": "Every browser or phone that gets push notifications. Remove one you no longer use.",
      "devicesHint": "To stop push on this device, use Turn off above.",
      "devicesEmpty": "No device gets push notifications yet.",
      "devicesUnknown": "Unknown device",
      "devicesAdded": "Added {date}",
      "devicesRemove": "Remove",
      "devicesRemoveTitle": "Remove {device}?",
      "devicesRemoveBody": "It stops getting push notifications. You can turn them on again on that device.",
      "devicesError": "Couldn't remove the device. Try again.",
      "devicesLoadError": "Couldn't load the devices."
```

#### `messages/zh-CN.json`

1. Replace the anchor

```json
    "sun": "周日"
  },
```

   with

```json
    "sun": "周日",
    "auto": "自动"
  },
```

2. Replace the anchor

```json
      "sampleReach": "覆盖最多"
```

   with

```json
      "sampleReach": "覆盖最多",
      "segmented": "分段选择器",
      "saveBar": "保存栏"
```

3. Replace the anchor

```json
    "subtitle": "外观、格式与安全",
```

   with

```json
    "subtitle": "外观、通知、账号与安全",
    "sections": {
      "nav": "设置分区",
      "pick": "分区",
      "appearance": {
        "title": "外观",
        "description": "主题、浅色或深色、密度和圆角。更改立即生效，并保存到所有设备。"
      },
      "language": {
        "title": "语言与格式",
        "description": "语言、日期、时间和数字格式、每周起始日和时区。"
      },
      "notifications": {
        "title": "通知",
        "description": "此设备的推送、你要接收哪些提醒，以及接收提醒的设备。"
      },
      "accounts": {
        "title": "账号与同步",
        "description": "每个已连接账号的状态。分组、归档和删除在“账号”页面。"
      },
      "security": {
        "title": "安全",
        "description": "你如何登录，以及账号如何受到保护。"
      },
      "data": {
        "title": "数据与隐私",
        "description": "in2sight 存储了哪些数据，以及如何删除。"
      }
    },
    "unsaved": {
      "bar": "你有未保存的更改",
      "discard": "放弃更改",
      "confirm": "不保存就离开？此分区的更改将会丢失。"
    },
    "prefsSave": {
      "saved": "已保存",
      "error": "无法保存此设置。在你重新加载之前，它仅在此设备上生效。",
      "retry": "重试"
    },
    "appearance": {
      "themeHint": "整个应用（包括图表）的配色。",
      "modeHint": "“自动”会跟随设备的浅色或深色设置。",
      "densityHint": "“紧凑”可在屏幕上显示更多内容；“宽松”留出更多空间。",
      "radiusHint": "按钮和卡片的圆角程度。",
      "previewTitle": "预览",
      "previewDescription": "按这些选择显示的页面效果。",
      "previewHeading": "每周覆盖人数",
      "previewBody": "本周你的 Reels 覆盖的人数比平时多。",
      "previewKpi": "覆盖人数",
      "previewPrimary": "保存",
      "previewSecondary": "取消",
      "previewBadge": "新",
      "previewInput": "搜索帖子",
      "previewChart": "图表颜色"
    },
    "language": {
      "languageHint": "应用会以新语言重新加载。",
      "formatsTitle": "格式",
      "formatsDescription": "日期、时间和数字在各处（包括导出）的写法。",
      "timezoneHint": "你的每一天从此时区的午夜开始。它决定所有图表、列表和提醒中每天的起止时间。",
      "sample": "示例：{date} · {number}"
    },
    "accountsSync": {
      "list": "已连接的账号",
      "manage": "管理账号",
      "syncNow": "立即同步",
      "reconnect": "重新连接",
      "synced": "已同步 @{username}",
      "lastSync": "最近同步",
      "empty": "还没有连接任何账号。",
      "emptyAction": "连接账号"
    },
    "data": {
      "title": "in2sight 存储的数据",
      "insights": "已连接账号的洞察数据、帖子、快拍和受众数字，从你连接账号当天开始保存。",
      "covers": "帖子和快拍的封面图片，存放在私有存储中。",
      "comments": "你帖子下的评论以及你上传的粉丝导出文件。这些是他人的数据：只有你能看到。",
      "delete": "在“账号”页面删除账号会删除它的全部数据。数据不会与任何人共享。",
      "soon": "导出和全部删除工具即将推出。"
    },
```

4. Replace the anchor

```json
      "saveError": "保存失败，请重试。"
```

   with

```json
      "saveError": "保存失败，请重试。",
      "testSend": "发送测试通知",
      "testSent": "已发送，几秒钟内应会出现在此设备上。",
      "testTitle": "in2sight 测试",
      "testBody": "此设备可以接收推送通知。",
      "testErrors": {
        "not_configured": "服务器尚未设置推送。",
        "gone": "此设备的订阅已失效。请关闭通知后再重新开启。",
        "failed": "推送服务未接受这条测试通知。请稍后重试。",
        "invalid": "此设备尚未订阅。",
        "unexpected": "出了点问题，请重试。"
      },
      "devicesTitle": "设备",
      "devicesDescription": "所有接收推送通知的浏览器或手机。移除不再使用的设备。",
      "devicesHint": "要停止此设备的推送，请使用上方的“在此设备上关闭”。",
      "devicesEmpty": "还没有设备接收推送通知。",
      "devicesUnknown": "未知设备",
      "devicesAdded": "添加于 {date}",
      "devicesRemove": "移除",
      "devicesRemoveTitle": "移除 {device}？",
      "devicesRemoveBody": "它将不再收到推送通知。你可以在该设备上重新开启。",
      "devicesError": "无法移除该设备，请重试。",
      "devicesLoadError": "无法加载设备列表。"
```

- [ ] **Step 2: Verify**

Run: `npx vitest run tests/messages.test.ts tests/ui-standards.test.ts`
Expected: PASS (same keys in both locales, placeholders `{username}`, `{date}`, `{number}`, `{device}` match, zh-CN differs from en, no abbreviated range labels).

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "feat(settings): i18n keys for the settings sections and the save model (Plan 16a)"
```

---

### Task 2: The instant save model (`setPrefs` result, provider status + retry, the toast)

**Files:**
- Modify: `lib/prefs.sync.server.ts`, `app/actions.ts`, `components/providers/PrefsProvider.tsx` (whole file below), `app/layout.tsx`, `tests/set-prefs.test.ts`, `tests/prefs-sync-server.test.ts`, `tests/prefs-provider.test.tsx`
- Create: `components/providers/PrefsSaveNotice.tsx`, `tests/prefs-save-notice.test.tsx`

**Interfaces produced:** `persistPrefsToProfile(prefs, keys): Promise<boolean>`; `export type SetPrefsResult = { ok: boolean }`, `setPrefs(partial: unknown): Promise<SetPrefsResult>`; `usePrefs(): { prefs; update(partial): void; status: SaveStatus; retry(): void }`, `export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'`; `PrefsSaveNotice`, `PREFS_TOAST_ID = 'prefs-save'`. `update` keeps its call shape (`void`), so no caller changes.

- [ ] **Step 1: Update the existing tests (they fail until Step 3)**

`tests/set-prefs.test.ts` — replace (each exactly once):

```ts
const persistPrefsToProfile = vi.fn<(prefs: unknown, keys: unknown) => Promise<void>>();
```
→
```ts
const persistPrefsToProfile = vi.fn<(prefs: unknown, keys: unknown) => Promise<boolean>>();
```
`  persistPrefsToProfile.mockReset().mockResolvedValue(undefined);` → `  persistPrefsToProfile.mockReset().mockResolvedValue(true);`
`    await expect(setPrefs(junk)).resolves.toBeUndefined();` → `    await expect(setPrefs(junk)).resolves.toEqual({ ok: true });`
`    persistPrefsToProfile.mockImplementation(async () => void order.push('profile'));` → `    persistPrefsToProfile.mockImplementation(async () => (order.push('profile'), true));`
`    await expect(setPrefs({ mode: 'dark' })).resolves.toBeUndefined();` → `    await expect(setPrefs({ mode: 'dark' })).resolves.toEqual({ ok: false });`

and insert before `  it('persists only the keys the patch named, never unknown ones', async () => {`:

```ts
  it('answers ok: false when the profile write failed (the cookie is still written and the layout revalidated)', async () => {
    persistPrefsToProfile.mockResolvedValue(false);
    await expect(setPrefs({ mode: 'dark' })).resolves.toEqual({ ok: false });
    expect(written().mode).toBe('dark');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

```

`tests/prefs-sync-server.test.ts` — replace (each exactly once):

```ts
    await persistPrefsToProfile(custom, ['theme']);
    expect(f.upserts).toHaveLength(1);
```
→
```ts
    await expect(persistPrefsToProfile(custom, ['theme'])).resolves.toBe(true);
    expect(f.upserts).toHaveLength(1);
```
```ts
    await persistPrefsToProfile(custom, []);
    expect(f.upserts).toEqual([]);
```
→
```ts
    await expect(persistPrefsToProfile(custom, [])).resolves.toBe(true);
    expect(f.upserts).toEqual([]);
```
```ts
    configured.mockReturnValue(false);
    await persistPrefsToProfile(custom, ['theme']);
```
→
```ts
    configured.mockReturnValue(false);
    await expect(persistPrefsToProfile(custom, ['theme'])).resolves.toBe(true);
```
```ts
    getSessionInfo.mockResolvedValue({ ...session, signedIn: false, userId: null });
    await persistPrefsToProfile(custom, ['theme']);
```
→
```ts
    getSessionInfo.mockResolvedValue({ ...session, signedIn: false, userId: null });
    await expect(persistPrefsToProfile(custom, ['theme'])).resolves.toBe(true);
```
and in `'never throws, even if the client cannot be created or the write fails'` both `.resolves.toBeUndefined();` → `.resolves.toBe(false);`.

`tests/prefs-provider.test.tsx` — the first import line becomes `import { render, screen, waitFor } from '@testing-library/react';`; the `Probe` gets the status, retry and a second key:

```tsx
  const { prefs, update } = usePrefs();
  return (
    <div>
      <span data-testid="mode">{prefs.mode}</span>
```
→
```tsx
  const { prefs, update, status, retry } = usePrefs();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={retry}>retry</button>
      <button onClick={() => update({ density: 'comfortable' })}>comfortable</button>
      <span data-testid="mode">{prefs.mode}</span>
```
and insert before `  it('usePrefs outside the provider throws a helpful error', () => {`:

```tsx
  it('reports saving, then saved; a void persist result counts as saved', async () => {
    let finish!: () => void;
    const persist = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    await userEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('status')).toHaveTextContent('saving');
    finish();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('network'))],
    ['answers ok: false', () => Promise.resolve({ ok: false })],
  ])('a save that %s is an error, never swallowed', async (_name, outcome) => {
    const persist = vi.fn(outcome);
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(html().getAttribute('data-mode')).toBe('dark'); // still applied here
  });

  it('retry re-sends every unsaved key with its current value, then reports saved', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await userEvent.click(screen.getByText('comfortable'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await userEvent.click(screen.getByText('retry'));
    expect(persist).toHaveBeenLastCalledWith({ mode: 'dark', density: 'comfortable' });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it('a later successful save of the same key clears its error', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it('retry with nothing unsaved does not call persist', async () => {
    const persist = vi.fn();
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('retry'));
    expect(persist).not.toHaveBeenCalled();
  });
```

Create `tests/prefs-save-notice.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { PREFS_TOAST_ID, PrefsSaveNotice } from '@/components/providers/PrefsSaveNotice';
import { DEFAULT_PREFS } from '@/lib/prefs';

function Probe() {
  const { update } = usePrefs();
  return <button onClick={() => update({ theme: 'forest' })}>forest</button>;
}

function setup(persist: (p: unknown) => unknown) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persist as never}>
        <Probe />
        <PrefsSaveNotice />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('PrefsSaveNotice', () => {
  it('nothing on first render (status idle)', () => {
    setup(vi.fn());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a saved change shows one short "Saved" toast with the fixed id', async () => {
    setup(vi.fn(async () => ({ ok: true })));
    await userEvent.click(screen.getByText('forest'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.settings.prefsSave.saved, { id: PREFS_TOAST_ID, duration: 2000 }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failed save shows a lasting error with Retry, and Retry saves again', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    setup(persist);
    await userEvent.click(screen.getByText('forest'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [text, opts] = toast.error.mock.calls[0] as [string, { id: string; duration: number; action: { label: string; onClick: () => void } }];
    expect(text).toBe(en.settings.prefsSave.error);
    expect(opts).toMatchObject({ id: PREFS_TOAST_ID, duration: Infinity, action: { label: en.settings.prefsSave.retry } });
    opts.action.onClick();
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist).toHaveBeenLastCalledWith({ theme: 'forest' });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
```

Run: `npx vitest run tests/set-prefs.test.ts tests/prefs-sync-server.test.ts tests/prefs-provider.test.tsx tests/prefs-save-notice.test.tsx`
Expected: FAIL (`setPrefs` resolves `undefined`; `status` is not in the context; `PrefsSaveNotice` does not exist).

- [ ] **Step 2: `lib/prefs.sync.server.ts`** — replace the doc comment and body of `persistPrefsToProfile` (from `/**` above it to the end of the file) with:

```ts
/**
 * Called by setPrefs after the cookie is written. Never throws.
 * Writes only `keys` (what this save changed): a stale cookie on this device must not clobber the other columns.
 * A missing row is created with the column defaults for everything not sent.
 * true = saved, or nothing to save (no keys, Supabase not configured, no session); false = the write failed (the caller shows Retry).
 */
export async function persistPrefsToProfile(prefs: Prefs, keys: readonly (keyof Prefs)[]): Promise<boolean> {
  try {
    if (keys.length === 0 || !isSupabaseConfigured()) return true;
    const supabase = await createServerSupabase();
    const info = await getSessionInfo(supabase);
    if (!info.userId) return true;
    const { error } = await supabase.from('profiles').upsert({ ...prefsPatchToRow(info.userId, prefs, keys), updated_at: new Date().toISOString() });
    if (!error) return true;
    warn('save');
    return false;
  } catch {
    warn('save');
    return false;
  }
}
```

- [ ] **Step 3: `app/actions.ts`** — replace everything from `/** Merge a partial update` to the end of the file with:

```ts
export type SetPrefsResult = { ok: boolean };

/**
 * Merge a partial update onto the current preferences cookie. Input is untrusted: parsePrefs validates every field.
 * Never throws. `ok: false` = the cookie was written but the profile row was not (PrefsProvider then offers Retry).
 */
export async function setPrefs(partial: unknown): Promise<SetPrefsResult> {
  const jar = await cookies();
  const current = parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
  const patch = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
  const next = parsePrefs({ ...current, ...patch });
  jar.set(PREFS_COOKIE, serializePrefs(next), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const keys = (Object.keys(patch) as (keyof Prefs)[]).filter((k) => Object.hasOwn(DEFAULT_PREFS, k)); // only what this save changed
  const ok = await persistPrefsToProfile(next, keys).catch(() => false); // it never throws; a rejection still counts as not saved
  revalidatePath('/', 'layout');
  return { ok };
}
```

- [ ] **Step 4: `components/providers/PrefsProvider.tsx`** — replace the whole file with:

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { htmlAttrs, parsePrefs, type Prefs } from '@/lib/prefs';
import { themeColor } from '@/lib/pwa';
import { isFramed } from '@/lib/tabs/protocol';

/** `{ ok: false }` (or a rejection) = not saved; anything else (including void) = saved. */
type Persist = (partial: Partial<Prefs>) => Promise<{ ok: boolean } | void> | { ok: boolean } | void;

/** idle = nothing saved yet in this document; error = at least one change is not saved (retry() re-sends it). */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface PrefsContextValue {
  prefs: Prefs;
  update: (partial: Partial<Prefs>) => void;
  status: SaveStatus;
  retry: () => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/**
 * Every document of the app (the tab shell and each tab's frame, Plan 14c; also other windows) has its own provider: a
 * change made in one is sent to the others on this same-origin channel and applied there at once. A language change is
 * sent after it is saved and makes the top window reload (server-rendered text); other format changes reach the
 * server-rendered parts of another tab on its next navigation or Refresh.
 */
export const PREFS_CHANNEL = 'in2sight:prefs';

export function applyPrefsToDocument(p: Prefs, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(htmlAttrs(p))) el.setAttribute(name, value);
  el.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(p));
}

const pickKeys = (p: Prefs, keys: string[]): Partial<Prefs> => Object.fromEntries(keys.filter((k) => Object.hasOwn(p, k)).map((k) => [k, p[k as keyof Prefs]]));

export function PrefsProvider({ initial, persist, children }: { initial: Prefs; persist: Persist; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(prefs);
  const unsaved = useRef<Partial<Prefs>>({}); // keys whose last save failed (retry sends their CURRENT values)
  const inflight = useRef(0);

  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);

  // changes made in the app's other documents (other tabs, the shell): parsePrefs validates them like any input
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(PREFS_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const partial = e.data !== null && typeof e.data === 'object' ? (e.data as Partial<Prefs>) : {};
      const next = parsePrefs({ ...latest.current, ...partial });
      setPrefs(next);
      applyPrefsToDocument(next);
      if ('locale' in partial && !isFramed()) window.location.reload(); // the frames reload with the shell
    };
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, []);

  // Never swallowed: a failure keeps the keys in `unsaved` and sets status 'error' until a later save of them succeeds.
  const save = useCallback(
    (partial: Partial<Prefs>) => {
      inflight.current++;
      setStatus('saving');
      void Promise.resolve()
        .then(() => persist(partial))
        .then(
          (r) => !(r !== null && typeof r === 'object' && r.ok === false),
          () => false,
        )
        .then((ok) => {
          inflight.current--;
          const keys = Object.keys(partial);
          if (ok) for (const k of keys) delete unsaved.current[k as keyof Prefs];
          else unsaved.current = { ...unsaved.current, ...pickKeys(latest.current, keys) };
          if (ok && 'locale' in partial) channel.current?.postMessage(partial); // the others reload: the cookie is saved now
          setStatus(Object.keys(unsaved.current).length > 0 ? 'error' : inflight.current > 0 ? 'saving' : 'saved');
        });
    },
    [persist],
  );

  const update = useCallback(
    (partial: Partial<Prefs>) => {
      const next = parsePrefs({ ...prefs, ...partial }); // validates: bad values fall back
      setPrefs(next);
      latest.current = next;
      applyPrefsToDocument(next); // instant, no waiting for the server
      save(partial);
      if (!('locale' in partial)) channel.current?.postMessage(partial);
    },
    [prefs, save],
  );

  const retry = useCallback(() => {
    const p = unsaved.current;
    if (Object.keys(p).length > 0) save({ ...p });
  }, [save]);

  const value = useMemo(() => ({ prefs, update, status, retry }), [prefs, update, status, retry]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}
```

Why the details: `unsaved` keeps the CURRENT value of each key whose save failed, so Retry never re-sends a stale value; `inflight` keeps the status at `saving` while another save is still running, whatever order the answers arrive in; a language change is broadcast only after a SUCCESSFUL save (the other documents reload and must find the new cookie); other changes are broadcast at once (unchanged).

- [ ] **Step 5: Create `components/providers/PrefsSaveNotice.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { usePrefs } from '@/components/providers/PrefsProvider';

export const PREFS_TOAST_ID = 'prefs-save';

/**
 * Shows PrefsProvider's save status (Plan 16a save model): a short "Saved", or an error that stays until Retry or dismiss.
 * One toast id, so quick changes replace one toast instead of stacking. Mounted once per document (root layout); a change
 * that arrives from another document over the channel is not saved here and shows nothing.
 */
export function PrefsSaveNotice() {
  const t = useTranslations('settings.prefsSave');
  const { status, retry } = usePrefs();
  useEffect(() => {
    if (status === 'saved') toast.success(t('saved'), { id: PREFS_TOAST_ID, duration: 2000 });
    else if (status === 'error') toast.error(t('error'), { id: PREFS_TOAST_ID, duration: Infinity, action: { label: t('retry'), onClick: retry } });
  }, [status, retry, t]);
  return null;
}
```

- [ ] **Step 6: Mount it in `app/layout.tsx`** — add the import after the `PrefsProvider` import:

```tsx
import { PrefsSaveNotice } from '@/components/providers/PrefsSaveNotice';
```
and the element right after `<Toaster position="bottom-right" />`:
```tsx
            <PrefsSaveNotice />
```

- [ ] **Step 7: Verify**

Run: `npx vitest run tests/set-prefs.test.ts tests/prefs-sync-server.test.ts tests/prefs-provider.test.tsx tests/prefs-save-notice.test.tsx tests/prefs-sync.test.tsx tests/prefs-bar.test.tsx tests/pwa.test.ts` then `npx tsc --noEmit` and `npx eslint app/actions.ts lib/prefs.sync.server.ts components/providers app/layout.tsx tests/prefs-save-notice.test.tsx tests/prefs-provider.test.tsx tests/set-prefs.test.ts tests/prefs-sync-server.test.ts`
Expected: all PASS, no type or lint errors.

- [ ] **Step 8: Commit**

```bash
git add app/actions.ts lib/prefs.sync.server.ts components/providers/PrefsProvider.tsx components/providers/PrefsSaveNotice.tsx app/layout.tsx tests/set-prefs.test.ts tests/prefs-sync-server.test.ts tests/prefs-provider.test.tsx tests/prefs-save-notice.test.tsx
git commit -m "feat(prefs): no silent save failures: setPrefs answers ok, the provider reports status and retries, a toast shows it (Plan 16a)"
```
