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

---

### Task 3: Registry, unsaved guard, `SaveBar`, `Segmented`

**Files:** Create `lib/settings/sections.ts`, `components/settings/unsaved.ts`, `components/settings/SaveBar.tsx`, `components/shared/Segmented.tsx`, `tests/settings-sections.test.ts`, `tests/settings-save-bar.test.tsx`, `tests/segmented.test.tsx`.

**Interfaces produced:** `SECTION_IDS`, `type SectionId`, `interface SettingsSection { id; icon }`, `SECTIONS`, `DEFAULT_SECTION`, `isSectionId(v)`, `sectionHref(id)`, `routeSettings(segments, tab): { section } | { redirect } | null`; `useUnsavedGuard(dirty)`, `hasUnsavedChanges()`, `confirmLeave(message): boolean`; `SaveBar(props: SaveBarProps)`; `Segmented<T>({ label, value, options, onChange, className? })`, `SegmentedOption<T>`.

- [ ] **Step 1: Write the failing tests**

`tests/settings-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DEFAULT_SECTION, SECTION_IDS, SECTIONS, isSectionId, routeSettings, sectionHref } from '@/lib/settings/sections';
import { isTabPath } from '@/lib/tabs/model';

describe('settings sections registry', () => {
  it('six sections in this order, each with an icon and a title + description in both languages', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['appearance', 'language', 'notifications', 'accounts', 'security', 'data']);
    expect(SECTIONS.map((s) => s.id)).toEqual([...SECTION_IDS]);
    for (const s of SECTIONS) {
      expect(s.icon).toBeTruthy();
      for (const m of [en, zh]) {
        expect(m.settings.sections[s.id].title, s.id).toBeTruthy();
        expect(m.settings.sections[s.id].description, s.id).toBeTruthy();
      }
    }
    expect(DEFAULT_SECTION).toBe('appearance');
  });

  it('isSectionId accepts the ids only', () => {
    expect(isSectionId('security')).toBe(true);
    for (const v of ['', 'Security', 'general', 'constructor', null, 1]) expect(isSectionId(v)).toBe(false);
  });

  it('every section URL stays inside its shell tab (never breaks out of the frame)', () => {
    for (const id of SECTION_IDS) {
      expect(sectionHref(id)).toBe(`/settings/${id}`);
      expect(isTabPath(sectionHref(id))).toBe(true);
    }
  });
});

describe('routeSettings', () => {
  it('/settings redirects to the first section', () => {
    expect(routeSettings(undefined, undefined)).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings([], undefined)).toEqual({ redirect: '/settings/appearance' });
  });

  it('the old tab names redirect to their new sections; anything else to the first', () => {
    expect(routeSettings(undefined, 'general')).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings(undefined, 'notifications')).toEqual({ redirect: '/settings/notifications' });
    expect(routeSettings(undefined, 'account')).toEqual({ redirect: '/settings/security' });
    expect(routeSettings(undefined, 'toString')).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings(undefined, 'bogus')).toEqual({ redirect: '/settings/appearance' });
  });

  it('a known section renders it (a ?tab= there is ignored)', () => {
    expect(routeSettings(['language'], undefined)).toEqual({ section: 'language' });
    expect(routeSettings(['security'], 'general')).toEqual({ section: 'security' });
  });

  it('an unknown or deeper path is not found', () => {
    expect(routeSettings(['bogus'], undefined)).toBeNull();
    expect(routeSettings(['appearance', 'x'], undefined)).toBeNull();
    expect(routeSettings(['Appearance'], undefined)).toBeNull();
  });
});
```

`tests/settings-save-bar.test.tsx`:

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { SaveBar, type SaveBarProps } from '@/components/settings/SaveBar';
import { confirmLeave, hasUnsavedChanges } from '@/components/settings/unsaved';

const U = en.settings.unsaved;

function bar(o: Partial<SaveBarProps> = {}) {
  const props: SaveBarProps = { dirty: false, pending: false, result: null, error: 'Could not save', saved: 'All saved', onDiscard: vi.fn(), ...o };
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <form onSubmit={onSubmit}>
        <SaveBar {...props} />
      </form>
    </NextIntlClientProvider>,
  );
  return { props, onSubmit, view };
}

afterEach(() => vi.restoreAllMocks());

describe('SaveBar', () => {
  it('clean: Save is disabled, no Discard, no text', () => {
    bar();
    expect(screen.getByRole('button', { name: en.common.save })).toBeDisabled();
    expect(screen.queryByRole('button', { name: U.discard })).toBeNull();
    expect(screen.queryByText(U.bar)).toBeNull();
  });

  it('dirty: says so, Save submits the form, Discard calls back', async () => {
    const { props, onSubmit } = bar({ dirty: true });
    expect(screen.getByText(U.bar)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(onSubmit).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: U.discard }));
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  it('a success is announced as status, an error as alert', () => {
    const { view } = bar({ result: 'saved' });
    expect(screen.getByRole('status')).toHaveTextContent('All saved');
    view.unmount();
    bar({ dirty: true, result: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });

  it('sticky at the bottom of the frame, above the safe area', () => {
    const { view } = bar({ dirty: true });
    const el = view.container.querySelector('form > div')!;
    for (const c of ['sticky', 'bottom-0', 'bg-card', 'border-t']) expect(el.classList.contains(c), c).toBe(true);
  });

  it('while dirty, reload asks (beforeunload) and confirmLeave asks; once clean, neither does', () => {
    function Harness() {
      const [dirty, setDirty] = useState(true);
      return (
        <NextIntlClientProvider locale="en" messages={en}>
          <form>
            <SaveBar dirty={dirty} pending={false} result={null} error="" saved="" onDiscard={() => setDirty(false)} />
          </form>
        </NextIntlClientProvider>
      );
    }
    render(<Harness />);
    expect(hasUnsavedChanges()).toBe(true);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmLeave('leave?')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('leave?');
  });

  it('nothing dirty: confirmLeave goes ahead without asking', async () => {
    const { view } = bar({ dirty: true });
    view.unmount();
    expect(hasUnsavedChanges()).toBe(false);
    const confirm = vi.spyOn(window, 'confirm');
    expect(confirmLeave('leave?')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
```

`tests/segmented.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from '@/components/shared/Segmented';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

describe('Segmented', () => {
  it('a labelled group with the chosen option pressed', () => {
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('picking another option calls onChange once; picking the current one does nothing', async () => {
    const onChange = vi.fn();
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('one control height and wraps at 360 px (no overflow)', () => {
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={vi.fn()} />);
    const g = screen.getByRole('group');
    for (const c of ['min-h-[var(--ctl)]', 'flex-wrap', 'max-w-full', 'border-input']) expect(g.classList.contains(c), c).toBe(true);
  });
});
```

Run: `npx vitest run tests/settings-sections.test.ts tests/settings-save-bar.test.tsx tests/segmented.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 2: `lib/settings/sections.ts`**

```ts
// Settings sections (Plan 16a): ids, order and icons in ONE place. Titles and descriptions are the i18n keys
// `settings.sections.<id>.title` / `.description`. Each id has one component `components/settings/sections/<Id>Section.tsx`
// (mapped in app/(app)/settings/[[...section]]/page.tsx). Plans 16b/16c replace SecuritySection / DataSection; they never add ids.
import { Bell, Database, Languages, Palette, RefreshCw, ShieldCheck, type LucideIcon } from 'lucide-react';

export const SECTION_IDS = ['appearance', 'language', 'notifications', 'accounts', 'security', 'data'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SettingsSection {
  id: SectionId;
  icon: LucideIcon;
}

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', icon: Palette },
  { id: 'language', icon: Languages },
  { id: 'notifications', icon: Bell },
  { id: 'accounts', icon: RefreshCw },
  { id: 'security', icon: ShieldCheck },
  { id: 'data', icon: Database },
];

export const DEFAULT_SECTION: SectionId = 'appearance';

export const isSectionId = (v: unknown): v is SectionId => typeof v === 'string' && (SECTION_IDS as readonly string[]).includes(v);

export const sectionHref = (id: SectionId): string => `/settings/${id}`;

/** The tabs of the old one-page Settings (client state only, but honoured if they ever arrive as ?tab=). */
const LEGACY_TABS: Readonly<Record<string, SectionId>> = { general: 'appearance', notifications: 'notifications', account: 'security' };

/**
 * What a settings URL shows. `segments` = the optional catch-all param (undefined for /settings), `tab` = a `?tab=` value.
 * /settings (any tab) -> a redirect; /settings/<known id> -> that section; anything else -> null (404).
 */
export function routeSettings(segments: readonly string[] | undefined, tab: string | undefined): { section: SectionId } | { redirect: string } | null {
  if (!segments || segments.length === 0) return { redirect: sectionHref(tab !== undefined && Object.hasOwn(LEGACY_TABS, tab) ? LEGACY_TABS[tab] : DEFAULT_SECTION) };
  if (segments.length === 1 && isSectionId(segments[0])) return { section: segments[0] };
  return null;
}
```

- [ ] **Step 3: `components/settings/unsaved.ts`**

```ts
'use client';

// The unsaved-changes guard (Plan 16a, kept small on purpose): a dirty form registers itself; reload / closing the window
// asks through `beforeunload`, the settings section nav asks through confirmLeave(). The shell's own navigation (sidebar,
// tab strip, Back) is NOT guarded: it moves the frame by message (docs/RUNBOOK_SETTINGS.md).
import { useEffect } from 'react';

let dirtyForms = 0; // ponytail: one counter per document; a per-form registry if a page ever needs to name the dirty form

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyForms++;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // older browsers need it set
    };
    window.addEventListener('beforeunload', ask);
    return () => {
      dirtyForms--;
      window.removeEventListener('beforeunload', ask);
    };
  }, [dirty]);
}

export const hasUnsavedChanges = (): boolean => dirtyForms > 0;

/** true = go ahead (nothing dirty, or the owner confirmed). */
export function confirmLeave(message: string): boolean {
  return !hasUnsavedChanges() || window.confirm(message);
}
```

- [ ] **Step 4: `components/settings/SaveBar.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Button } from '@/components/ui/button';
import { useUnsavedGuard } from '@/components/settings/unsaved';

export interface SaveBarProps {
  dirty: boolean;
  pending: boolean;
  /** what the last save did; 'saved' shows until the next edit, 'error' until the next save */
  result: 'saved' | 'error' | null;
  /** translated text for result 'error' */
  error: string;
  /** translated text for result 'saved' */
  saved: string;
  onDiscard: () => void;
}

/**
 * The explicit-save model (Plan 16a, UI standard 18): the last child of a <form>, sticky at the bottom of the tab frame
 * (the phone bottom bar sits outside the frame), Save = the form's submit button (disabled while clean). Registers the
 * unsaved-changes guard while dirty.
 */
export function SaveBar({ dirty, pending, result, error, saved, onDiscard }: SaveBarProps) {
  const t = useTranslations('settings.unsaved');
  const tc = useTranslations('common');
  useUnsavedGuard(dirty);
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mr-auto min-w-0 text-sm">
        {result === 'error' ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : result === 'saved' && !dirty ? (
          <p role="status" className="text-muted-foreground">
            {saved}
          </p>
        ) : dirty ? (
          <p className="text-muted-foreground">{t('bar')}</p>
        ) : null}
      </div>
      {dirty ? (
        <Button type="button" variant="outline" onClick={onDiscard} disabled={pending}>
          {t('discard')}
        </Button>
      ) : null}
      <LoadingButton type="submit" pending={pending} disabled={!dirty}>
        {tc('save')}
      </LoadingButton>
    </div>
  );
}
```

- [ ] **Step 5: `components/shared/Segmented.tsx`**

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A small set of exclusive options as ONE control (UI standard 18): a --ctl-high bordered group of small buttons with
 * aria-pressed on the chosen one; it wraps instead of overflowing at 360 px. More than four options or long labels: use a
 * native select instead.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: readonly SegmentedOption<T>[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex min-h-[var(--ctl)] max-w-full flex-wrap items-center gap-0.5 rounded-md border border-input bg-background p-0.5', className)}>
      {options.map((o) => (
        <Button key={o.value} type="button" size="sm" variant={o.value === value ? 'secondary' : 'ghost'} aria-pressed={o.value === value} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verify** — `npx vitest run tests/settings-sections.test.ts tests/settings-save-bar.test.tsx tests/segmented.test.tsx`, `npx tsc --noEmit`, `npx eslint lib/settings components/settings/unsaved.ts components/settings/SaveBar.tsx components/shared/Segmented.tsx tests/settings-sections.test.ts tests/settings-save-bar.test.tsx tests/segmented.test.tsx`. Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add lib/settings/sections.ts components/settings/unsaved.ts components/settings/SaveBar.tsx components/shared/Segmented.tsx tests/settings-sections.test.ts tests/settings-save-bar.test.tsx tests/segmented.test.tsx
git commit -m "feat(settings): section registry, unsaved-changes guard, SaveBar and Segmented (Plan 16a)"
```

---

### Task 4: Devices reader, test push, delete device, layout revalidation

**Files:**
- Create: `lib/push/devices.ts`, `tests/push-devices.test.ts`
- Modify: `app/(app)/settings/actions.ts`, `tests/push-actions.test.ts`

**Interfaces produced:** `interface PushDevice { id: number; label: string | null; createdAt: string }`, `DEVICES_MAX = 20`, `deviceLabel(ua)`, `listPushDevices(db): Promise<PushDevice[] | null>`; `deleteDeviceAction(id: unknown): Promise<PushResult>`; `type TestPushResult`, `sendTestPushAction(endpoint: unknown): Promise<TestPushResult>`. Existing actions keep their signatures; their `revalidatePath('/settings')` becomes `revalidatePath('/settings', 'layout')` (the old single page is still covered, and so is every `/settings/<section>` after Task 9).

- [ ] **Step 1: Write the failing tests**

`tests/push-devices.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { DEVICES_MAX, deviceLabel, listPushDevices } from '@/lib/push/devices';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

describe('deviceLabel', () => {
  it.each([
    [UA.chromeWin, 'Chrome · Windows'],
    [UA.edgeWin, 'Edge · Windows'],
    [UA.safariIphone, 'Safari · iPhone'],
    [UA.safariMac, 'Safari · macOS'],
    [UA.firefoxLinux, 'Firefox · Linux'],
    [UA.chromeAndroid, 'Chrome · Android'],
  ])('%s -> %s', (ua, label) => expect(deviceLabel(ua)).toBe(label));

  it('unknown or missing -> null', () => {
    for (const v of [null, undefined, '', '   ', 'curl/8.0']) expect(deviceLabel(v)).toBeNull();
  });
});

/** Owner-session fake for one chained read. */
function db(result: { data?: unknown; error?: unknown } | 'throw') {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const op of ['select', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => (result === 'throw' ? Promise.reject(new Error('x')) : Promise.resolve(result)).then(res, rej);
  return { client: { from: vi.fn((t: string) => (calls.push(['from', t]), chain)) } as never, calls };
}

describe('listPushDevices', () => {
  it('reads ids, user agents and dates only, newest first, capped; maps to labels', async () => {
    const f = db({ data: [{ id: 7, user_agent: UA.chromeWin, created_at: '2026-10-12T08:00:00Z' }, { id: '3', user_agent: null, created_at: '2026-10-01T08:00:00Z' }], error: null });
    expect(await listPushDevices(f.client)).toEqual([
      { id: 7, label: 'Chrome · Windows', createdAt: '2026-10-12T08:00:00Z' },
      { id: 3, label: null, createdAt: '2026-10-01T08:00:00Z' },
    ]);
    expect(f.calls).toEqual([['from', 'push_subscriptions'], ['select', 'id,user_agent,created_at'], ['order', 'created_at', { ascending: false }], ['limit', DEVICES_MAX]]);
    expect(JSON.stringify(f.calls)).not.toMatch(/endpoint|keys/);
  });

  it('a failed read is null, never an empty list; it never throws', async () => {
    expect(await listPushDevices(db({ data: null, error: { message: 'boom' } }).client)).toBeNull();
    expect(await listPushDevices(db('throw').client)).toBeNull();
  });
});
```

`tests/push-actions.test.ts` — replace the whole file with (the existing cases are unchanged except the revalidation assertion; new: the mocks for `next-intl/server` and `@/lib/push/send`, `maybeSingle` in the fake chain, and the device / test-push cases at the end):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, queue, push } = vi.hoisted(() => ({
  calls: [] as unknown[][],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
  push: { vapid: null as null | { publicKey: string; privateKey: string; subject: string }, status: 201 },
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['upsert', 'delete', 'eq', 'select', 'limit', 'maybeSingle']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('next-intl/server', () => ({ getTranslations: async (ns: string) => (key: string) => `${ns}.${key}` }));
// the real fan-out (sendToAll) with a fake transport: no web-push, no network
vi.mock('@/lib/push/send', async (orig) => ({
  ...(await orig<typeof import('@/lib/push/send')>()),
  vapidFromEnv: () => push.vapid,
  webPushTransport: () => async (sub: { endpoint: string }, payload: string) => (calls.push(['push', sub.endpoint, JSON.parse(payload)]), push.status),
}));

import { deleteDeviceAction, deleteSubscriptionAction, saveAlertSettingsAction, saveSubscriptionAction, sendTestPushAction } from '@/app/(app)/settings/actions';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import { parseSubscription, vapidKeyBytes } from '@/lib/push/subscription';

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', expirationTime: null, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'y'.repeat(22) } };

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  push.vapid = null;
  push.status = 201;
  requireOwner.mockReset().mockImplementation(async () => (calls.push(['requireOwner']), { userId: 'u1', email: null }));
});

describe('parseSubscription', () => {
  it('accepts a real-shaped subscription and keeps only endpoint + keys', () => {
    expect(parseSubscription(SUB)).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys });
  });

  it.each([
    ['http endpoint', { ...SUB, endpoint: 'http://push.example/x' }],
    ['javascript: endpoint', { ...SUB, endpoint: 'javascript:alert(1)' }],
    ['credentials in the URL', { ...SUB, endpoint: 'https://user:pw@fcm.googleapis.com/x' }],
    ['endpoint over 1024 chars', { ...SUB, endpoint: 'https://fcm.googleapis.com/' + 'a'.repeat(1010) }],
    ['an unknown push host', { ...SUB, endpoint: 'https://push.example/x' }],
    ['a look-alike prefix host', { ...SUB, endpoint: 'https://evilfcm.googleapis.com.attacker.test/x' }],
    ['a look-alike suffix host', { ...SUB, endpoint: 'https://fcm.googleapis.com.evil.test/x' }],
    ['an allowed host as a subdomain of another domain', { ...SUB, endpoint: 'https://x.notify.windows.com.evil.test/x' }],
    ['a prefix without a dot', { ...SUB, endpoint: 'https://evilpush.apple.com.test/x' }],
    ['an IPv4 literal', { ...SUB, endpoint: 'https://127.0.0.1/x' }],
    ['an IPv6 literal', { ...SUB, endpoint: 'https://[::1]/x' }],
    ['a metadata address', { ...SUB, endpoint: 'https://169.254.169.254/latest' }],
    ['a non-default port', { ...SUB, endpoint: 'https://fcm.googleapis.com:8443/x' }],
    ['a bare push.apple.com suffix with no label', { ...SUB, endpoint: 'https://apple.com/x' }],
    ['missing keys', { endpoint: SUB.endpoint }],
    ['short p256dh', { ...SUB, keys: { ...SUB.keys, p256dh: 'abc' } }],
    ['non-base64url auth', { ...SUB, keys: { ...SUB.keys, auth: '<script>alert(1)</script>' } }],
    ['oversized auth', { ...SUB, keys: { ...SUB.keys, auth: 'y'.repeat(200) } }],
    ['a string', 'https://push.example/x'],
    ['null', null],
  ])('refuses %s', (_n, raw) => {
    expect(parseSubscription(raw)).toBeNull();
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('accepts the real push service endpoint %s', (endpoint) => {
    expect(parseSubscription({ ...SUB, endpoint })?.endpoint).toBe(endpoint);
  });

  it('vapidKeyBytes decodes base64url without padding (a VAPID public key is 65 bytes starting 0x04)', () => {
    const bytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i * 3));
    const b64url = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(Array.from(vapidKeyBytes(b64url))).toEqual(Array.from(bytes));
  });
});

describe('push and alert-settings actions', () => {
  it.each([
    ['saveSubscription', () => saveSubscriptionAction(SUB, 'UA')],
    ['deleteSubscription', () => deleteSubscriptionAction(SUB.endpoint)],
    ['saveAlertSettings', () => saveAlertSettingsAction({})],
    ['deleteDevice', () => deleteDeviceAction(7)],
    ['sendTestPush', () => sendTestPushAction(SUB.endpoint)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('saveSubscription upserts on endpoint with the owner session; the user agent is clipped', async () => {
    expect(await saveSubscriptionAction(SUB, 'U'.repeat(900))).toEqual({ ok: true });
    const up = calls.find((c) => c[0] === 'upsert')!;
    expect(up[1]).toEqual({ endpoint: SUB.endpoint, keys: SUB.keys, user_agent: 'U'.repeat(512) });
    expect(up[2]).toEqual({ onConflict: 'endpoint' });
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('hostile bodies return invalid without opening a client', async () => {
    expect(await saveSubscriptionAction({ ...SUB, endpoint: 'http://x' }, 'UA')).toEqual({ ok: false, error: 'invalid' });
    expect(await deleteSubscriptionAction("https://x' or 1=1 --".repeat(100))).toEqual({ ok: false, error: 'invalid' });
    expect(await deleteSubscriptionAction(42)).toEqual({ ok: false, error: 'invalid' });
    expect(calls.filter((c) => c[0] === 'session')).toEqual([]);
  });

  it('deleteSubscription deletes by endpoint', async () => {
    expect(await deleteSubscriptionAction(SUB.endpoint)).toEqual({ ok: true });
    expect(calls).toContainEqual(['delete']);
    expect(calls).toContainEqual(['eq', 'endpoint', SUB.endpoint]);
  });

  const rows = (n: number, first = 'https://fcm.googleapis.com/fcm/send/other0') => ({ data: Array.from({ length: n }, (_, i) => ({ endpoint: i === 0 ? first : `https://fcm.googleapis.com/fcm/send/other${i}` })) });

  it('a new endpoint is refused once 20 subscriptions exist, before any upsert', async () => {
    queue.push(rows(20));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: false, error: 'invalid' });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(false);
  });

  it('with 19 subscriptions a new endpoint is saved', async () => {
    queue.push(rows(19));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(true);
  });

  it('re-subscribing an endpoint that already exists still works at 20', async () => {
    queue.push(rows(20, SUB.endpoint));
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert')).toBe(true);
  });

  it('a database error returns unexpected (never the Supabase message)', async () => {
    queue.push({ data: [] }, { error: { message: 'duplicate key value violates…' } });
    expect(await saveSubscriptionAction(SUB, 'UA')).toEqual({ ok: false, error: 'unexpected' });
  });

  it('saveAlertSettings stores the normalised settings on the owner profile and returns them', async () => {
    const r = await saveAlertSettingsAction({ push: { taking_off: true, hack: true }, reachDropPct: 500, takingOffRatio: '3', syncFailures: 'x' });
    const settings = { ...DEFAULT_ALERT_SETTINGS, push: { ...DEFAULT_ALERT_SETTINGS.push, taking_off: true }, reachDropPct: 90, takingOffRatio: 3 };
    expect(r).toEqual({ ok: true, settings });
    const up = calls.find((c) => c[0] === 'upsert')![1] as Record<string, unknown>;
    expect(up).toMatchObject({ user_id: 'u1', alert_settings: settings });
    expect(calls).toContainEqual(['from', 'profiles']);
    expect(calls).toContainEqual(['revalidate', '/settings', 'layout']);
  });

  it('deleteDevice deletes one row by id with the owner session and revalidates every section', async () => {
    expect(await deleteDeviceAction(7)).toEqual({ ok: true });
    expect(calls).toContainEqual(['from', 'push_subscriptions']);
    expect(calls).toContainEqual(['delete']);
    expect(calls).toContainEqual(['eq', 'id', 7]);
    expect(calls).toContainEqual(['revalidate', '/settings', 'layout']);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it.each([[0], [-1], [1.5], ['7'], [null], [Number.MAX_SAFE_INTEGER + 1]])('deleteDevice refuses id %j without opening a client', async (id) => {
    expect(await deleteDeviceAction(id)).toEqual({ ok: false, error: 'invalid' });
    expect(calls.filter((c) => c[0] === 'session')).toEqual([]);
  });

  it('deleteDevice: a database error is unexpected', async () => {
    queue.push({ error: { message: 'boom' } });
    expect(await deleteDeviceAction(7)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('sendTestPush: refuses a bad endpoint, then says not_configured without VAPID keys', async () => {
    expect(await sendTestPushAction('http://x')).toEqual({ ok: false, error: 'invalid' });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: false, error: 'not_configured' });
    expect(calls.some((c) => c[0] === 'push')).toBe(false);
  });

  it('sendTestPush: an endpoint the owner has not stored is refused, nothing is sent', async () => {
    push.vapid = { publicKey: 'p', privateKey: 'k', subject: 'mailto:x@y.z' };
    queue.push({ data: null });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: false, error: 'invalid' });
    expect(calls).toContainEqual(['eq', 'endpoint', SUB.endpoint]);
    expect(calls.some((c) => c[0] === 'push')).toBe(false);
  });

  it('sendTestPush: sends ONE translated test message to the stored endpoint only', async () => {
    push.vapid = { publicKey: 'p', privateKey: 'k', subject: 'mailto:x@y.z' };
    queue.push({ data: { endpoint: SUB.endpoint, keys: SUB.keys } });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: true });
    const sent = calls.filter((c) => c[0] === 'push');
    expect(sent).toEqual([['push', SUB.endpoint, { title: 'settings.notifications.testTitle', body: 'settings.notifications.testBody', url: '/settings/notifications', tag: 'test' }]]);
  });

  it('sendTestPush: 410 from the push service prunes the row and says gone; 500 says failed', async () => {
    push.vapid = { publicKey: 'p', privateKey: 'k', subject: 'mailto:x@y.z' };
    push.status = 410;
    queue.push({ data: { endpoint: SUB.endpoint, keys: SUB.keys } });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: false, error: 'gone' });
    expect(calls.filter((c) => c[0] === 'delete')).toHaveLength(1);
    push.status = 500;
    queue.push({ data: { endpoint: SUB.endpoint, keys: SUB.keys } });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: false, error: 'failed' });
  });

  it('sendTestPush: a read error is unexpected (never the Supabase message)', async () => {
    push.vapid = { publicKey: 'p', privateKey: 'k', subject: 'mailto:x@y.z' };
    queue.push({ error: { message: 'secret detail' } });
    expect(await sendTestPushAction(SUB.endpoint)).toEqual({ ok: false, error: 'unexpected' });
  });
});
```

Run: `npx vitest run tests/push-devices.test.ts tests/push-actions.test.ts`
Expected: FAIL (`lib/push/devices` not found; `deleteDeviceAction` / `sendTestPushAction` not exported; revalidation assertion).

- [ ] **Step 2: `lib/push/devices.ts`**

```ts
// The devices list of Settings -> Notifications (Plan 16a). Owner-session reads only (RLS push_subscriptions_owner_all).
// The endpoint (a capability URL) and the keys never leave the server: the list carries ids, a label and a date.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PushDevice {
  id: number;
  /** "Chrome · Windows"; null = not recognised (the UI says "Unknown device") */
  label: string | null;
  createdAt: string;
}

export const DEVICES_MAX = 20; // = MAX_SUBSCRIPTIONS in app/(app)/settings/actions.ts

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari", iPad/iPhone also say "Mac OS X".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** A short product label from a stored user agent; literal names (not translated). */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(' · ') || null;
}

/** Newest first, at most DEVICES_MAX. null = the read failed (the UI says so; never a fake empty list). Never throws. */
export async function listPushDevices(db: SupabaseClient): Promise<PushDevice[] | null> {
  try {
    const { data, error } = await db.from('push_subscriptions').select('id,user_agent,created_at').order('created_at', { ascending: false }).limit(DEVICES_MAX);
    if (error || !data) return null;
    return (data as { id: number; user_agent: string | null; created_at: string }[]).map((r) => ({ id: Number(r.id), label: deviceLabel(r.user_agent), createdAt: r.created_at }));
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: `app/(app)/settings/actions.ts`** — replace the whole file with:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { parseAlertSettings, type AlertSettings } from '@/lib/alerts/settings';
import { confirmEnroll, disableFactor, startEnroll } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { sendToAll, vapidFromEnv, webPushTransport, type PushSub } from '@/lib/push/send';
import { clipUserAgent, parseEndpoint, parseSubscription } from '@/lib/push/subscription';
import { createServerSupabase } from '@/lib/supabase/server';

export async function startEnrollAction() {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await startEnroll(await createServerSupabase());
  return r.ok ? r : ({ ok: false, error: r.error } as const);
}

export async function confirmEnrollAction(factorId: string, code: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await confirmEnroll(await createServerSupabase(), { factorId: String(factorId), code: String(code) });
  if (r.ok) revalidatePath('/settings', 'layout'); // every section page
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

export async function disableAction(factorId: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await disableFactor(await createServerSupabase(), String(factorId));
  if (r.ok) revalidatePath('/settings', 'layout'); // every section page
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

// Push subscriptions and alert settings. OWNER-SESSION client: RLS (push_subscriptions_owner_all, profiles_owner_all)
// applies to every write. Never the admin client here. Errors are keys, never Supabase text.
const MAX_SUBSCRIPTIONS = 20; // a single owner has a handful of devices; the cap bounds what a hostile session could store
export type PushResult = { ok: true } | { ok: false; error: 'invalid' | 'unexpected' };

export async function saveSubscriptionAction(subscription: unknown, userAgent: unknown): Promise<PushResult> {
  await requireOwner();
  const s = parseSubscription(subscription);
  if (!s) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const existing = await db.from('push_subscriptions').select('endpoint').limit(MAX_SUBSCRIPTIONS + 1);
    if (existing.error) return { ok: false, error: 'unexpected' };
    const have = (existing.data ?? []) as { endpoint: string }[];
    if (have.length >= MAX_SUBSCRIPTIONS && !have.some((r) => r.endpoint === s.endpoint)) return { ok: false, error: 'invalid' };
    const { error } = await db.from('push_subscriptions').upsert({ endpoint: s.endpoint, keys: s.keys, user_agent: clipUserAgent(userAgent) }, { onConflict: 'endpoint' });
    return error ? { ok: false, error: 'unexpected' } : { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export async function deleteSubscriptionAction(endpoint: unknown): Promise<PushResult> {
  await requireOwner();
  const e = parseEndpoint(endpoint);
  if (!e) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('push_subscriptions').delete().eq('endpoint', e);
    return error ? { ok: false, error: 'unexpected' } : { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

/** Saves the normalised settings (unknown keys dropped, thresholds clamped) and returns what was stored. */
export async function saveAlertSettingsAction(raw: unknown): Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: 'unexpected' }> {
  const { userId } = await requireOwner();
  const settings = parseAlertSettings(raw);
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('profiles').upsert({ user_id: userId, alert_settings: settings, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: 'unexpected' };
    revalidatePath('/settings', 'layout'); // every section page
    return { ok: true, settings };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

/** Settings -> Notifications -> Devices: removes one stored subscription by its id (the list never carries endpoints). */
export async function deleteDeviceAction(id: unknown): Promise<PushResult> {
  await requireOwner();
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('push_subscriptions').delete().eq('id', id);
    if (error) return { ok: false, error: 'unexpected' };
    revalidatePath('/settings', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export type TestPushResult = { ok: true } | { ok: false; error: 'invalid' | 'not_configured' | 'gone' | 'failed' | 'unexpected' };

/**
 * "Send a test notification": ONE push to THIS device only. The browser passes its own endpoint; the server sends only
 * if that endpoint is stored for the owner (RLS), so it cannot be used to push to an arbitrary URL. A 404/410 from the
 * push service prunes the row (as the alert sender does). The text is in the owner's language (request locale).
 */
export async function sendTestPushAction(endpoint: unknown): Promise<TestPushResult> {
  await requireOwner();
  const e = parseEndpoint(endpoint);
  if (!e) return { ok: false, error: 'invalid' };
  const vapid = vapidFromEnv();
  if (!vapid) return { ok: false, error: 'not_configured' };
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('push_subscriptions').select('endpoint,keys').eq('endpoint', e).maybeSingle();
    if (error) return { ok: false, error: 'unexpected' };
    if (!data) return { ok: false, error: 'invalid' };
    const t = await getTranslations('settings.notifications');
    const msg = { title: t('testTitle'), body: t('testBody'), url: '/settings/notifications', tag: 'test' };
    const r = await sendToAll([data as PushSub], msg, webPushTransport(vapid), async (gone) => {
      await db.from('push_subscriptions').delete().eq('endpoint', gone);
    });
    if (r.sent === 1) return { ok: true };
    return { ok: false, error: r.pruned === 1 ? 'gone' : 'failed' };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
```

(`sendTestPushAction` reuses `sendToAll` for its prune rule; the translator follows the request locale = the owner's language. `'not_configured'` is checked before any database read.)

- [ ] **Step 4: Verify** — `npx vitest run tests/push-devices.test.ts tests/push-actions.test.ts tests/settings-actions.test.ts`, `npx tsc --noEmit`, `npx eslint lib/push/devices.ts "app/(app)/settings/actions.ts" tests/push-devices.test.ts tests/push-actions.test.ts`. Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/push/devices.ts tests/push-devices.test.ts "app/(app)/settings/actions.ts" tests/push-actions.test.ts
git commit -m "feat(push): devices list reader, remove a device, send a test notification to this device (Plan 16a)"
```

---

### Task 5: Extract `Identity`, `SyncInfo`, `CommentsHint` (second use: Settings → Accounts & sync)

**Files:**
- Create: `components/accounts/AccountParts.tsx`, `tests/account-parts.test.tsx`
- Modify: `components/accounts/AccountsView.tsx`

Pure move: no behaviour change on `/accounts` (its tests `tests/accounts-view.test.tsx`, `tests/accounts-comments-hint.test.tsx` stay green unchanged).

- [ ] **Step 1: Write the test** `tests/account-parts.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CommentsHint, Identity, SyncInfo } from '@/components/accounts/AccountParts';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A: StoredAccount = { id: 'a1', igUserId: '1', username: 'yseny_', displayName: 'Yen', accountType: null, profilePictureUrl: null, groupName: 'Clients', status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-10-01T00:00:00Z', grantedScopes: [] };

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('AccountParts (shared by /accounts and Settings)', () => {
  it('Identity: initial, @username and display name', () => {
    wrap(<Identity a={A} />);
    expect(screen.getByText('@yseny_')).toBeInTheDocument();
    expect(screen.getByText('Yen')).toBeInTheDocument();
    expect(screen.getByText('Y')).toBeInTheDocument();
  });

  it('SyncInfo: never synced, and a translated error only while failures continue', () => {
    const { unmount } = wrap(<SyncInfo />);
    expect(screen.getByText(en.accounts.sync.never)).toBeInTheDocument();
    unmount();
    wrap(<SyncInfo s={{ lastSuccessAt: null, lastErrorKey: 'not-a-key', consecutiveFailures: 2 }} />);
    expect(screen.getByText(en.accounts.errors.unexpected)).toBeInTheDocument();
  });

  it('CommentsHint: a top-level reconnect link for an active account without the scope; nothing once granted', () => {
    const { unmount } = wrap(<CommentsHint a={A} />);
    const link = screen.getByRole('link', { name: en.accounts.commentsHint });
    expect(link).toHaveAttribute('target', '_top');
    unmount();
    const { container } = wrap(<CommentsHint a={{ ...A, grantedScopes: [COMMENTS_SCOPE] }} />);
    expect(container.querySelector('a')).toBeNull();
  });
});
```

Run: `npx vitest run tests/account-parts.test.tsx` — Expected: FAIL (module not found).

- [ ] **Step 2: Create `components/accounts/AccountParts.tsx`** (the three functions moved verbatim, now exported):

```tsx
'use client';

// Pieces of an account row shared by the Accounts page and Settings -> Accounts & sync (Plan 16a: extracted on the second use).
import { useTranslations } from 'next-intl';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { formatDateTime } from '@/lib/format';
import type { SyncStatus } from '@/lib/sync/store';

/** "last synced" plus the latest error, translated from the key the sync stored */
export function SyncInfo({ s }: { s?: SyncStatus }) {
  const t = useTranslations('accounts');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const err = s?.lastErrorKey && s.consecutiveFailures > 0 ? s.lastErrorKey : null;
  return (
    <div className="grid min-w-0 gap-0.5">
      <span>{s?.lastSuccessAt ? formatDateTime(s.lastSuccessAt, prefs) : t('sync.never')}</span>
      {err ? <span className="text-xs text-destructive">{tErr.has(err) ? tErr(err) : tErr('unexpected')}</span> : null}
    </div>
  );
}

export function Identity({ a }: { a: StoredAccount }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar>
        <AvatarFallback>{[...a.username][0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">@{a.username}</p>
        {a.displayName ? <p className="truncate text-xs text-muted-foreground">{a.displayName}</p> : null}
      </div>
    </div>
  );
}

/**
 * An active account whose token lacks the comments scope (connected before it was requested, or declined): one
 * Reconnect grants it. Needs-reconnect accounts already say "Reconnect"; archived ones are not synced.
 */
export function CommentsHint({ a }: { a: StoredAccount }) {
  const t = useTranslations('accounts');
  if (a.status !== 'active' || hasScope(a, COMMENTS_SCOPE)) return null;
  return (
    <a href={connectHref(a.groupName)} target="_top" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {t('commentsHint')}
    </a>
  );
}
```

- [ ] **Step 3: `components/accounts/AccountsView.tsx`**
  - Delete the three local functions: everything from the line `// "last synced" plus the latest error, translated from the key the sync stored` down to (not including) `function GroupBadge(`.
  - Add `import { CommentsHint, Identity, SyncInfo } from '@/components/accounts/AccountParts';` right before the `ConnectDialog` import.
  - Remove the now-unused imports `import { Avatar, AvatarFallback } from '@/components/ui/avatar';` and `import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';`, and change `import { formatDate, formatDateTime, formatNumber } from '@/lib/format';` to `import { formatDate, formatNumber } from '@/lib/format';` (`usePrefs` and `SyncStatus` stay: still used).

- [ ] **Step 4: Verify** — `npx vitest run tests/account-parts.test.tsx tests/accounts-view.test.tsx tests/accounts-comments-hint.test.tsx`, `npx tsc --noEmit`, `npx eslint components/accounts/AccountParts.tsx components/accounts/AccountsView.tsx tests/account-parts.test.tsx`. Expected: PASS, clean (eslint flags any import left unused).

- [ ] **Step 5: Commit**

```bash
git add components/accounts/AccountParts.tsx components/accounts/AccountsView.tsx tests/account-parts.test.tsx
git commit -m "refactor(accounts): share Identity, SyncInfo and CommentsHint (Plan 16a)"
```

---

### Task 6: Notifications pieces — explicit save for alert rules, the test button, the devices list

**Files:**
- Modify: `components/settings/AlertSettingsForm.tsx` (whole file), `components/settings/NotificationsCard.tsx` (whole file), `tests/settings-notifications.test.tsx` (whole file)
- Create: `components/settings/DeviceList.tsx`, `tests/device-list.test.tsx`

**Interfaces:** `AlertSettingsFormProps` unchanged. `NotificationsCardProps` gains optional `test?: (endpoint: string) => Promise<{ ok: boolean; error?: string }>` (the old page passes none, so it keeps working until Task 9). `DeviceListProps { devices: PushDevice[] | null; remove: (id: number) => Promise<{ ok: boolean; error?: string }> }`. Uses Task 3's `SaveBar` and Task 4's `PushDevice` TYPE only (no runtime import of the actions).

- [ ] **Step 1: Tests.** Replace `tests/settings-notifications.test.tsx` with the version below (unchanged cases kept verbatim; changed: "a failed save shows an error and keeps the changes" now changes a field first because Save is disabled while clean; new: clean / dirty / Discard / beforeunload cases and three test-button cases):

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AlertSettingsForm, type AlertSettingsFormProps } from '@/components/settings/AlertSettingsForm';
import { NotificationsCard, type NotificationsCardProps } from '@/components/settings/NotificationsCard';
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const NAV_PROPS = ['serviceWorker', 'userAgent', 'platform', 'maxTouchPoints'];
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of NAV_PROPS) delete (navigator as unknown as Record<string, unknown>)[k]; // own props shadowing jsdom's getters
});
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const setNav = (k: string, value: unknown) => Object.defineProperty(navigator, k, { value, configurable: true });
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const JSON_SUB = { endpoint: 'https://push.example/1', expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };

/** A browser with service workers, PushManager and Notification, all faked. */
function browser(o: { permission?: NotificationPermission; prompt?: NotificationPermission; subscribed?: boolean } = {}) {
  const sub = { endpoint: JSON_SUB.endpoint, toJSON: () => JSON_SUB, unsubscribe: vi.fn(async () => true) };
  let current = o.subscribed ? sub : null;
  const pushManager = { getSubscription: vi.fn(async () => current), subscribe: vi.fn(async () => ((current = sub), sub)) };
  const reg = { pushManager };
  const sw = { getRegistration: vi.fn(async () => reg), register: vi.fn(async () => reg), ready: Promise.resolve(reg) };
  const N = { permission: o.permission ?? 'default', requestPermission: vi.fn(async () => o.prompt ?? 'granted') };
  setNav('serviceWorker', sw);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', N);
  return { sub, sw, pushManager, N };
}

function card(o: Partial<NotificationsCardProps> = {}) {
  const props: NotificationsCardProps = { vapidPublicKey: KEY, swEnabled: true, save: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NotificationsCard {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}
const M = en.settings.notifications;

describe('NotificationsCard', () => {
  it('never asks for permission on its own; enabling subscribes with the VAPID key and stores the subscription', async () => {
    const b = browser();
    const p = card();
    const button = await screen.findByRole('button', { name: M.enable });
    expect(b.N.requestPermission).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(b.N.requestPermission).toHaveBeenCalledOnce();
    expect(b.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect((b.pushManager.subscribe.mock.calls[0] as unknown as [{ applicationServerKey: Uint8Array }])[0].applicationServerKey).toHaveLength(65);
    expect(p.save).toHaveBeenCalledWith(JSON_SUB, navigator.userAgent);
    expect(await screen.findByText(M.on)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: M.disable })).toBeInTheDocument();
  });

  it('the user denies the prompt: blocked message, nothing subscribed or stored', async () => {
    const b = browser({ prompt: 'denied' });
    const p = card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByText(M.denied)).toBeInTheDocument();
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(p.save).not.toHaveBeenCalled();
  });

  it('the user dismisses the prompt: stays off, the button is still there', async () => {
    browser({ prompt: 'default' });
    card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByRole('button', { name: M.enable })).toBeEnabled();
  });

  it('permission already blocked: explains how to unblock, no button', async () => {
    browser({ permission: 'denied' });
    card();
    expect(await screen.findByText(M.denied)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.enable })).toBeNull();
  });

  it('saving fails: the fresh browser subscription is removed again and an error shows', async () => {
    const b = browser();
    card({ save: vi.fn(async () => ({ ok: false })) });
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.error);
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('already subscribed: turning off deletes the stored endpoint and unsubscribes', async () => {
    const b = browser({ subscribed: true });
    const p = card();
    await userEvent.click(await screen.findByRole('button', { name: M.disable }));
    expect(p.remove).toHaveBeenCalledWith(JSON_SUB.endpoint);
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: M.enable })).toBeInTheDocument();
  });

  it('turning off when the server refuses keeps the device subscribed and shows an error', async () => {
    const b = browser({ subscribed: true });
    card({ remove: vi.fn(async () => ({ ok: false })) });
    await userEvent.click(await screen.findByRole('button', { name: M.disable }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.error);
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: M.disable })).toBeInTheDocument();
  });

  it('a service worker is registered on demand when none exists yet', async () => {
    const b = browser();
    b.sw.getRegistration.mockResolvedValueOnce(undefined as never).mockResolvedValueOnce(undefined as never);
    card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    await waitFor(() => expect(b.sw.register).toHaveBeenCalledWith('/sw.js'));
  });

  it('development build (service worker off): explains it, no button, nothing registered', async () => {
    const b = browser();
    card({ swEnabled: false });
    expect(await screen.findByText(M.devOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.enable })).toBeNull();
    expect(b.sw.register).not.toHaveBeenCalled();
    expect(b.N.requestPermission).not.toHaveBeenCalled();
  });

  it('unsupported browser: says so, no button', async () => {
    card();
    expect(await screen.findByText(M.unsupported)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('iPhone Safari without the installed app: Home Screen hint instead', async () => {
    setNav('userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    card();
    expect(await screen.findByText(M.iosInstall)).toBeInTheDocument();
  });

  it('push on: "Send a test notification" sends to THIS endpoint and says it was sent', async () => {
    browser({ subscribed: true });
    const test = vi.fn(async () => ({ ok: true }));
    card({ test });
    await userEvent.click(await screen.findByRole('button', { name: M.testSend }));
    expect(test).toHaveBeenCalledWith(JSON_SUB.endpoint);
    expect(await screen.findByRole('status')).toHaveTextContent(M.testSent);
  });

  it('a refused test shows the translated reason; an unknown key falls back to unexpected', async () => {
    browser({ subscribed: true });
    const test = vi.fn().mockResolvedValueOnce({ ok: false, error: 'gone' }).mockResolvedValueOnce({ ok: false, error: 'weird' });
    card({ test });
    const button = await screen.findByRole('button', { name: M.testSend });
    await userEvent.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent(M.testErrors.gone);
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(M.testErrors.unexpected));
  });

  it('no test prop: no test button (push off shows none either)', async () => {
    browser({ subscribed: true });
    card();
    await screen.findByRole('button', { name: M.disable });
    expect(screen.queryByRole('button', { name: M.testSend })).toBeNull();
  });

  it('no VAPID key on the server: not-configured note', async () => {
    browser();
    card({ vapidPublicKey: null });
    expect(await screen.findByText(M.notConfigured)).toBeInTheDocument();
  });
});

describe('AlertSettingsForm', () => {
  function form(o: Partial<AlertSettingsFormProps> = {}) {
    const props: AlertSettingsFormProps = { initial: DEFAULT_ALERT_SETTINGS, save: vi.fn(async (raw: unknown) => ({ ok: true as const, settings: { ...DEFAULT_ALERT_SETTINGS, ...(raw as object), syncFailures: 3 } })), ...o };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AlertSettingsForm {...props} />
      </NextIntlClientProvider>,
    );
    return props;
  }

  it('one labelled switch per alert type with the SPEC defaults (taking off off)', () => {
    form();
    expect(screen.getByRole('switch', { name: en.notifications.kinds.needs_reconnect.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title })).not.toBeChecked();
    expect(screen.getByLabelText(M.reachDropPct)).toHaveValue(20);
  });

  it('saves toggles and thresholds, then shows what the server stored', async () => {
    const p = form();
    await userEvent.click(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title }));
    const pct = screen.getByLabelText(M.reachDropPct);
    await userEvent.clear(pct);
    await userEvent.type(pct, '35');
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(p.save).toHaveBeenCalledWith(expect.objectContaining({ push: expect.objectContaining({ taking_off: true }), reachDropPct: '35', takingOffRatio: '2', syncFailures: '2' }));
    expect(await screen.findByRole('status')).toHaveTextContent(M.saved);
    expect(screen.getByLabelText(M.syncFailures)).toHaveValue(3); // the server's normalised value wins
  });

  it('an emptied number field is saved as the default, not the minimum', async () => {
    const p = form({ initial: { ...DEFAULT_ALERT_SETTINGS, reachDropPct: 50 }, save: vi.fn(async (raw: unknown) => ({ ok: true as const, settings: parseAlertSettings(raw) })) });
    const pct = screen.getByLabelText(M.reachDropPct);
    await userEvent.clear(pct);
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(p.save).toHaveBeenCalledWith(expect.objectContaining({ reachDropPct: '' }));
    await waitFor(() => expect(pct).toHaveValue(DEFAULT_ALERT_SETTINGS.reachDropPct));
  });

  it('out-of-range numbers are stopped by the browser (min/max) before reaching the server', async () => {
    const p = form();
    const pct = screen.getByLabelText(M.reachDropPct);
    expect(pct).toHaveAttribute('min', '5');
    expect(pct).toHaveAttribute('max', '90');
    await userEvent.clear(pct);
    await userEvent.type(pct, '500');
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(p.save).not.toHaveBeenCalled();
  });

  it('a failed save shows an error and keeps the changes', async () => {
    form({ save: vi.fn(async () => ({ ok: false as const, error: 'unexpected' })) });
    await userEvent.click(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title }));
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.saveError);
    expect(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title })).toBeChecked();
  });

  it('Save is disabled until something changes; changing it back makes it clean again', async () => {
    form();
    const save = screen.getByRole('button', { name: en.common.save });
    expect(save).toBeDisabled();
    const sw = screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title });
    await userEvent.click(sw);
    expect(save).toBeEnabled();
    expect(screen.getByText(en.settings.unsaved.bar)).toBeInTheDocument();
    await userEvent.click(sw);
    expect(save).toBeDisabled();
  });

  it('Discard restores the stored values without saving', async () => {
    const p = form();
    const pct = screen.getByLabelText(M.reachDropPct);
    await userEvent.clear(pct);
    await userEvent.type(pct, '40');
    await userEvent.click(screen.getByRole('button', { name: en.settings.unsaved.discard }));
    expect(pct).toHaveValue(20);
    expect(p.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en.common.save })).toBeDisabled();
  });

  it('while there are unsaved changes, leaving the page asks first', async () => {
    form();
    await userEvent.click(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title }));
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
```

Create `tests/device-list.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { DeviceList, type DeviceListProps } from '@/components/settings/DeviceList';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const M = en.settings.notifications;
const DEVICES = [
  { id: 7, label: 'Chrome · Windows', createdAt: '2026-10-12T08:00:00Z' },
  { id: 3, label: null, createdAt: '2026-10-01T08:00:00Z' },
];

function list(o: Partial<DeviceListProps> = {}) {
  const props: DeviceListProps = { devices: DEVICES, remove: vi.fn(async () => ({ ok: true })), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <DeviceList {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

beforeEach(() => refresh.mockReset());

describe('DeviceList', () => {
  it('one row per device: its label (or Unknown device) and the date it was added', () => {
    list();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Chrome · Windows')).toBeInTheDocument();
    expect(within(items[0]).getByText('Added 12 Oct 2026')).toBeInTheDocument();
    expect(within(items[1]).getByText(M.devicesUnknown)).toBeInTheDocument();
    expect(screen.getByText(M.devicesHint)).toBeInTheDocument();
  });

  it('empty and failed reads say so (a failed read is not "no devices")', () => {
    list({ devices: [] });
    expect(screen.getByText(M.devicesEmpty)).toBeInTheDocument();
  });

  it('a failed read is an alert', () => {
    list({ devices: null });
    expect(screen.getByRole('alert')).toHaveTextContent(M.devicesLoadError);
  });

  it('Remove asks first, then removes by id and refreshes', async () => {
    const p = list();
    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: M.devicesRemove }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Chrome · Windows?')).toBeInTheDocument();
    expect(p.remove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: M.devicesRemove }));
    expect(p.remove).toHaveBeenCalledWith(7);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('a refused remove keeps the dialog open with the error', async () => {
    list({ remove: vi.fn(async () => ({ ok: false, error: 'unexpected' })) });
    await userEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: M.devicesRemove }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: M.devicesRemove }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.devicesError);
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run tests/settings-notifications.test.tsx tests/device-list.test.tsx` — Expected: FAIL (no Discard / disabled Save, no test button, `DeviceList` missing).

- [ ] **Step 2: `components/settings/AlertSettingsForm.tsx`** — replace the whole file:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { SaveBar } from '@/components/settings/SaveBar';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, LIMITS, type AlertSettings } from '@/lib/alerts/settings';

export interface AlertSettingsFormProps {
  initial: AlertSettings;
  save: (raw: unknown) => Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }>;
}

const NUMBERS = ['reachDropPct', 'takingOffRatio', 'syncFailures'] as const;
type Nums = Record<(typeof NUMBERS)[number], string>;

// numbers are kept and sent as typed text; the server parses them (empty = the default), clamps and returns what it stored
const numsOf = (s: AlertSettings): Nums => Object.fromEntries(NUMBERS.map((k) => [k, String(s[k])])) as Nums;

/** Explicit save (Plan 16a): dirty = differs from what the server last stored; the sticky SaveBar saves or discards. */
export function AlertSettingsForm({ initial, save }: AlertSettingsFormProps) {
  const t = useTranslations('settings.notifications');
  const tk = useTranslations('notifications.kinds');
  const [stored, setStored] = useState(initial);
  const [push, setPush] = useState(initial.push);
  const [nums, setNums] = useState(() => numsOf(initial));
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ push, nums }) !== JSON.stringify({ push: stored.push, nums: numsOf(stored) });

  const reset = (s: AlertSettings) => {
    setPush(s.push);
    setNums(numsOf(s));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await save({ push, ...nums });
      if (!r.ok) return setResult('error');
      setStored(r.settings);
      reset(r.settings); // the server's normalised values win
      setResult('saved');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rulesTitle')}</CardTitle>
        <CardDescription>{t('rulesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-[var(--gp)]">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('pushFor')}</legend>
            {ALERT_KINDS.map((k) => (
              <FormField key={k} id={`push-${k}`} label={tk(`${k}.title`)} className="flex-row items-center justify-between gap-3">
                {(p) => <Switch {...p} checked={push[k]} onCheckedChange={(v) => setPush((s) => ({ ...s, [k]: v }))} />}
              </FormField>
            ))}
          </fieldset>
          <div className="grid gap-[var(--gp)] md:grid-cols-3">
            {NUMBERS.map((k) => (
              <FormField key={k} id={`alert-${k}`} label={t(k)} hint={t(`${k}Hint`)}>
                {(p) => <Input {...p} type="number" inputMode="decimal" min={LIMITS[k][0]} max={LIMITS[k][1]} step={LIMITS[k][2] ? 0.1 : 1} value={nums[k]} onChange={(e) => setNums((s) => ({ ...s, [k]: e.target.value }))} />}
              </FormField>
            ))}
          </div>
          <SaveBar dirty={dirty} pending={pending} result={result} error={t('saveError')} saved={t('saved')} onDiscard={() => reset(stored)} />
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: `components/settings/NotificationsCard.tsx`** — replace the whole file (changes: the `test` prop and `TEST_ERRORS`, `sendTest`, the "on" row with both buttons in one default-size row, the test result lines; everything else verbatim):

```tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { vapidKeyBytes } from '@/lib/push/subscription';
import { isIos, isStandalone } from '@/lib/pwa';

type Result = { ok: boolean };
type Status = 'checking' | 'dev-only' | 'unsupported' | 'ios-install' | 'not-configured' | 'denied' | 'off' | 'on';

export interface NotificationsCardProps {
  vapidPublicKey: string | null;
  /** Same production-only flag as <ServiceWorker>: in dev the worker is never registered, so push can't work. */
  swEnabled: boolean;
  save: (subscription: unknown, userAgent: string) => Promise<Result>;
  remove: (endpoint: string) => Promise<Result>;
  /** "Send a test notification" to this device (Plan 16a); omitted = no button */
  test?: (endpoint: string) => Promise<{ ok: boolean; error?: string }>;
}

const TEST_ERRORS = ['not_configured', 'gone', 'failed', 'invalid', 'unexpected'] as const;

export function NotificationsCard({ vapidPublicKey, swEnabled, save, remove, test }: NotificationsCardProps) {
  const t = useTranslations('settings.notifications');
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [tested, setTested] = useState<{ ok: true } | { ok: false; key: (typeof TEST_ERRORS)[number] } | null>(null);

  useEffect(() => {
    let alive = true;
    const set = (s: Status) => alive && setStatus(s);
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return set(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      if (!swEnabled) return set('dev-only');
      if (!vapidPublicKey) return set('not-configured');
      if (Notification.permission === 'denied') return set('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      set((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => set('off'));
    return () => {
      alive = false;
    };
  }, [vapidPublicKey, swEnabled]);

  // permission is requested ONLY here, from the explicit button (SPEC §7c)
  const enable = () =>
    start(async () => {
      setError(false);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return setStatus(permission === 'denied' ? 'denied' : 'off');
        if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey!) });
        const r = await save(sub.toJSON(), navigator.userAgent);
        if (!r.ok) {
          await sub.unsubscribe().catch(() => false); // not stored: don't leave a subscription nobody sends to
          return setError(true);
        }
        setStatus('on');
      } catch {
        setError(true);
      }
    });

  const sendTest = () =>
    startTest(async () => {
      setTested(null);
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (!sub || !test) return setTested({ ok: false, key: 'invalid' });
        const r = await test(sub.endpoint);
        const key = (TEST_ERRORS as readonly string[]).includes(r.error ?? '') ? (r.error as (typeof TEST_ERRORS)[number]) : 'unexpected';
        setTested(r.ok ? { ok: true } : { ok: false, key });
      } catch {
        setTested({ ok: false, key: 'unexpected' });
      }
    });

  const disable = () =>
    start(async () => {
      setError(false);
      setTested(null);
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (sub) {
          if (!(await remove(sub.endpoint)).ok) return setError(true); // keep the browser subscription so both sides still agree
          await sub.unsubscribe();
        }
        setStatus('off');
      } catch {
        setError(true);
      }
    });

  const note = (key: 'checking' | 'devOnly' | 'unsupported' | 'iosInstall' | 'notConfigured' | 'denied') => <p className="text-sm text-muted-foreground">{t(key)}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('pushTitle')}
          {status === 'on' ? <Badge variant="secondary">{t('on')}</Badge> : null}
        </CardTitle>
        <CardDescription>{t('pushDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gp)]">
        {status === 'checking' ? note('checking') : null}
        {status === 'dev-only' ? note('devOnly') : null}
        {status === 'unsupported' ? note('unsupported') : null}
        {status === 'ios-install' ? note('iosInstall') : null}
        {status === 'not-configured' ? note('notConfigured') : null}
        {status === 'denied' ? note('denied') : null}
        {status === 'off' ? (
          <div className="flex flex-col items-start gap-1.5">
            <LoadingButton onClick={enable} pending={pending}>
              {t('enable')}
            </LoadingButton>
            <p className="text-xs text-muted-foreground">{t('enableHint')}</p>
          </div>
        ) : null}
        {status === 'on' ? (
          <div className="flex flex-wrap items-center gap-2">
            <LoadingButton variant="outline" onClick={disable} pending={pending} disabled={testing}>
              {t('disable')}
            </LoadingButton>
            {test ? (
              <LoadingButton variant="outline" onClick={sendTest} pending={testing} disabled={pending}>
                {t('testSend')}
              </LoadingButton>
            ) : null}
          </div>
        ) : null}
        {tested?.ok ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('testSent')}
          </p>
        ) : null}
        {tested && !tested.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`testErrors.${tested.key}`)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('error')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: `components/settings/DeviceList.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { PushDevice } from '@/lib/push/devices';

export interface DeviceListProps {
  /** null = the list could not be read */
  devices: PushDevice[] | null;
  remove: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

/** Every device that gets push (Plan 16a). Remove asks first; the list refreshes from the server afterwards. */
export function DeviceList({ devices, remove }: DeviceListProps) {
  const t = useTranslations('settings.notifications');
  const tc = useTranslations('common');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [pick, setPick] = useState<PushDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (d: PushDevice) => d.label ?? t('devicesUnknown');

  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await remove(pick.id);
      if (!r.ok) return setError(t('devicesError'));
      setPick(null);
      router.refresh();
    } catch (e) {
      if (isRedirectError(e)) throw e;
      setError(t('devicesError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('devicesTitle')}</CardTitle>
        <CardDescription>{t('devicesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {devices === null ? (
          <p role="alert" className="text-sm text-destructive">
            {t('devicesLoadError')}
          </p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('devicesEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name(d)}</p>
                  <p className="text-xs text-muted-foreground">{t('devicesAdded', { date: formatDate(d.createdAt, prefs) })}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => (setError(null), setPick(d))}>
                  {t('devicesRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t('devicesHint')}</p>
      </CardContent>
      {pick ? (
        <ConfirmDialog
          open
          title={t('devicesRemoveTitle', { device: name(pick) })}
          body={t('devicesRemoveBody')}
          confirmLabel={t('devicesRemove')}
          cancelLabel={tc('cancel')}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onClose={() => setPick(null)}
        />
      ) : null}
    </Card>
  );
}
```

(`size="sm"` on Remove is allowed: a button inside a list row, rule 5.)

- [ ] **Step 5: Verify** — `npx vitest run tests/settings-notifications.test.tsx tests/device-list.test.tsx tests/settings-save-bar.test.tsx`, `npx tsc --noEmit`, `npx eslint components/settings/AlertSettingsForm.tsx components/settings/NotificationsCard.tsx components/settings/DeviceList.tsx tests/settings-notifications.test.tsx tests/device-list.test.tsx`. Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add components/settings/AlertSettingsForm.tsx components/settings/NotificationsCard.tsx components/settings/DeviceList.tsx tests/settings-notifications.test.tsx tests/device-list.test.tsx
git commit -m "feat(settings): alert rules save explicitly with a save bar; test notification; devices list (Plan 16a)"
```
