# Plan 7: Account detail, Tags & Calendar (Analysis & dashboards part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner dig into one account (KPIs with comparison, trends, format comparison, best-time heatmap, flags, sync status; a filterable posts table with tags; captured Stories; audience with a motion-gated globe), label posts with tags and compare tag performance, and see a posting calendar per account or across all accounts.

**Architecture:** One migration adds owner-writable `tags` / `media_tags`. Readers in `lib/dashboard/detail-read.ts` use the owner-session client with explicit columns and limits. Pure model builders (`lib/dashboard/account.ts`, `content.ts`, `audience.ts`, `calendar.ts`, `lib/tags.ts`) turn rows into what the views render; they take today/now/timezone as inputs and reuse `lib/analysis/*` and `lib/sync/time.ts`. Pages stay wiring: `requireOwner()` first, validate params, load ONLY the active tab's data, then pass a model plus server actions to client views in `components/account|tags|calendar/`.

**Tech Stack:** Next.js 16.4 App Router (server components + client views), TypeScript strict, `@supabase/ssr` owner session, next-intl 4, Tailwind 4 tokens, Radix Tabs (already in `components/ui/tabs.tsx`), Recharts 3 (installed), Vitest 5 + Testing Library. **New dependencies: none.**

**Spec:** `docs/SPEC.md` §5 (tags, media_tags), §7 (analysis + story exit rate), §7b (flows, comparison rules, missing-data reasons), §7c (archived hidden), §8 (Account detail contents, Tags page, globe), §8b (frontend rules). Project rules: `CLAUDE.md` (binding). Visual reference: `docs/mockups/app-prototype.html`, `kit-data.html`, `kit-charts.html`.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- ⚠ **Globe without Three.js.** SPEC §2 lists Three.js "(one lazy-loaded globe)". A dot globe (country centroids sized by audience share on a rotating orthographic sphere with a graticule) is ~90 lines of canvas 2D code and 0 KB of dependencies, versus ~160 KB gzipped for `three`. Same look the mockups show, MIT-free (our code), lazy-loaded with `next/dynamic({ ssr: false })`, rendered ONLY when `useHeavyMotion()` allows. The ranked country list is always rendered and is the accessible baseline; the globe canvas is `aria-hidden`. If the owner wants real country outlines / 3D lighting later, swap `components/account/Globe.tsx` for a Three.js version — nothing else changes.
- ⚠ **Calendar is a page (`/calendar`), filterable by account**, linked from the account detail header ("Calendar" → `/calendar?account=<id>`), plus a 5th main-nav item. SPEC §8 lists the calendar under Account detail; the brief also asks for an all-accounts view. One page serves both without loading calendar data on every account tab.
- **Tabs** are `?tab=overview|posts|stories|audience`, parsed server-side with an allow-list (anything else = overview), rendered with the existing Radix `Tabs` (roles `tablist`/`tab`/`tabpanel`, arrow keys, `activationMode="manual"` so arrowing does not navigate). Choosing a tab does `router.push('?tab=…')`; the server loads only that tab's data.
- **Tags are owner-authored UI data**, so unlike the sync tables the owner session may INSERT/UPDATE/DELETE them under RLS (`for all to authenticated using (public.is_owner()) with check (public.is_owner())`). Server actions use the **owner-session client, never the admin client**: RLS then still applies to every write (a bug in an action cannot touch other tables or bypass the owner check), and there are no secrets to protect in these tables.
- **Tag names:** NFC-normalised, whitespace collapsed, 1–40 characters (code points, matching Postgres `char_length`), control and bidi-override characters rejected (RTL text itself is fine), unique **case-insensitively** (`unique index on lower(name)` + an app-side check that returns the `duplicate` error key). Colours are chart tokens `chart-1`…`chart-6`, assigned to the least-used one on create (no picker in v1; add one when asked).
- **Tag performance sample guard:** a tag (or the "Untagged" bucket) with fewer than 5 measured posts shows its numbers greyed with the reason "Needs 5+ measured posts to compare" (`MIN_TAG_POSTS`). `groupStats()` is exported from `lib/analysis/posts.ts` (it was private `stats`) so the untagged bucket uses the same maths.
- **Posts table:** filters (format, tag incl. "untagged", from/to date) are a native `<form method="get">` (no JS needed, URL is the state). The table shows 50 rows and a "Show more" button (`DataTable` gains an optional `pageSize`); 500 posts never mount 1000 DOM rows at once. TanStack Table is still not needed (client sort of ≤ 500 rows is ~20 lines already in `DataTable`).
- **Pooled best time** = the account's group when it has one, otherwise all non-archived accounts (SPEC §7b: isolated accounts are only compared when widened to all). Followers-online is the default view, post performance the toggle (SPEC §7).
- **Stories:** the last 14 days of captured Stories with every snapshot (progression sparkline of views), the final snapshot (last before `expires_at`) as the value, live vs expired from `expires_at` vs `now`, exit rate = exits ÷ views (SPEC §7). A story with no snapshot shows "Instagram shares Story insights from 5 viewers".
- **Audience:** latest snapshot per kind. Age × gender becomes age buckets with a female/male/unknown split; countries and cities are top 8 + "Other". Country names via `Intl.DisplayNames` in a new `formatCountry()` in `lib/format.ts`; unknown or non-ISO codes (e.g. `XK`, `ZZ`) fall back to the raw code and simply get no dot on the globe.
- **Overview cards link to the account page** (the username), and the account page has a "← Overview" back link.

## Out of scope

Alerts / notifications / push / PWA (Plan 8), exports (Plan 9), AI summaries, tag colour picker, hashtag auto-suggest, compare page.

## Global Constraints

- Ponytail: smallest thing that works; no new dependency; no abstraction with one implementation.
- TypeScript strict. No Meta metric names added (none needed).
- DB: one NEW migration `supabase/migrations/20261017000001_tags.sql`; never edit earlier migrations (they are applied live). RLS on every table, policies `to authenticated` and gated on `public.is_owner()`. Applying it to the live project is an owner action (runbook step), not part of this plan's execution.
- Dashboard reads and tag writes use ONLY `createServerSupabase()` (owner session); never `lib/supabase/admin.ts` in `lib/dashboard/*`, `app/(app)/tags/*`, `app/(app)/accounts/[id]/*` or `app/(app)/calendar/*`; never `account_tokens`; explicit column lists (no `select('*')` in new readers); fixed error messages that never echo Supabase errors.
- Server actions: `await requireOwner()` FIRST and outside any try/catch (it redirects by throwing), then validate every argument at the boundary, return `{ ok: true } | { ok: false; error: <i18n key> }`.
- Pure logic in `lib/`, deterministic: no `new Date()` / `Date.now()` inside `lib/dashboard/*` builders or `lib/analysis/*`; pages compute `now` once and pass it (ISO string to client components).
- Every UI string via next-intl, new keys in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese, full-width punctuation). `tests/messages.test.ts` enforces parity.
- Theming: semantic tokens only (`bg-card`, `text-muted-foreground`, `text-success`, `text-destructive`, `var(--chart-n)`, `color-mix(... var(--primary) ...)`); the canvas globe reads its colours from CSS variables at draw time. No hex/rgb literals in components.
- Responsive: mobile-first, 360 / 768 / 1280; CSS breakpoints only (`md:hidden` / `hidden md:block`), never `matchMedia` for layout (the motion gate is the one sanctioned `matchMedia`, about motion); `min-w-0` + `truncate` on long text.
- Dates/numbers only via `lib/format.ts` / `lib/metrics.ts`.
- UI kit: density is un-layered (`h-*`/`p-*` on shadcn Button/Card/Table cells are ignored); `TooltipProvider` already mounted; no `npx shadcn` needed (Tabs exists).
- Vitest timeout is 20 s (config). Tests inject clocks and explicit timezones.
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, message ends with a second `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

1. **Tag names from real keyboards** — emoji (`🔥 Hot`), RTL (`عروض`), 41+ characters, the same name in a different case or with different spacing/Unicode form (`Promo` vs `promo ` vs NFD `é`): stored once, normalised, duplicate returns the `duplicate` key, never a 500 → Task 2 "normalises and limits real-world names", Task 4 "a duplicate in a different case returns duplicate (app check) and 23505 maps to duplicate".
2. **Accounts with nothing yet** — zero Stories, zero posts, no audience snapshot (under 100 followers), no online_followers: each tab shows its reason, no crash, no NaN → Task 6 "no stories", Task 7 "empty snapshots give needs_100_followers", Task 9 "account with no data renders every reason", Task 11 "zero stories".
3. **Hostile or odd URL params** — `?tab=<script>`, `?tab=posts&tab=audience`, `?tag=not-a-uuid`, `?from=2026-02-31`, `?month=2026-13`, `/accounts/not-a-uuid`: allow-listed, invalid values fall back, unknown id → 404 → Task 5 "tab param injection", Task 6 "filters ignore invalid values", Task 8 "parseMonth rejects junk", Task 9 page "not a uuid → notFound".
4. **Owner-timezone month edges and DST** — a post at 23:30 local on the 31st, a post at 16:30Z that is already the 1st in Kuala Lumpur, a month containing a DST change in `America/New_York`, week start Sunday vs Monday → Task 8 "DST month in New York", "posts bin by owner-timezone day across the month edge".
5. **Big and dirty data** — 500 posts, posts with null caption/permalink, unknown country codes (`XK`, `ZZ`, lowercase), age keys without gender → Task 10 "500 posts render 50 rows then show more" and "null caption/permalink", Task 7 "unknown country codes keep the raw code and get no centroid", Task 11 "unknown country codes stay in the list".

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261017000001_tags.sql` | `tags`, `media_tags`, owner RLS (all actions), indexes, cascade |
| `tests/tags-migration.test.ts` | lint of the new migration |
| `lib/tags.ts` | `normalizeTagName`, `isUuid`, `TAG_COLORS`, `pickColor`, `sameTagName` |
| `lib/analysis/types.ts` (modify) | + `MissingReason` values `needs_5_viewers`, `few_posts` |
| `lib/analysis/posts.ts` (modify) | export `groupStats` (was private `stats`) |
| `lib/dashboard/detail-read.ts` | owner-session readers: `loadAccount`, `loadPostRows`, `loadStories`, `loadAudience`, `loadOnline`, `loadTags`, `loadMonthMedia` |
| `app/(app)/tags/actions.ts` | `createTagAction`, `renameTagAction`, `deleteTagAction`, `setPostTagsAction` |
| `lib/dashboard/account.ts` | `parseTab`, `buildAccountOverview` |
| `lib/dashboard/content.ts` | `parsePostFilters`, `buildPosts`, `buildStories`, `buildTagStats` |
| `lib/dashboard/audience.ts` + `lib/geo/centroids.ts` | `buildAudience`, ISO-3166 alpha-2 centroids |
| `lib/dashboard/calendar.ts` | `parseMonth`, `monthRange`, `buildMonth` |
| `lib/format.ts` (modify) | + `formatCountry`, `formatMonth` |
| `components/shared/PeriodSelect.tsx` (extract from OverviewView), `components/shared/ConfirmDialog.tsx` (moved from accounts) | second use → shared |
| `components/shared/DataTable.tsx` (modify) | optional `pageSize` + "Show more" |
| `components/charts/best-time.ts` | heatmap rows + labels (second Heatmap user → extracted from the styleguide) |
| `app/(app)/accounts/[id]/page.tsx`, `components/account/AccountView.tsx`, `AccountOverview.tsx` | account page wiring, header + tabs, Overview tab |
| `components/account/PostsTab.tsx`, `TagPicker.tsx` | Posts tab, tag assignment |
| `components/account/StoriesTab.tsx`, `AudienceTab.tsx`, `Globe.tsx` | Stories, Audience, motion-gated globe |
| `app/(app)/tags/page.tsx` (replace), `components/tags/TagsView.tsx` | Tags page |
| `app/(app)/calendar/page.tsx`, `components/calendar/CalendarView.tsx`, `lib/nav.ts` (modify), `components/shared/AppShell.tsx` (modify) | calendar + nav |
| `components/overview/OverviewView.tsx` (modify) | cards link to `/accounts/<id>` |
| `messages/en.json`, `messages/zh-CN.json` (modify) | `pages.account`, `pages.tags`, `pages.calendar`, `analysis` additions |
| `docs/RUNBOOK_DASHBOARDS.md`, `docs/TODO.md`, `docs/SPEC.md` (modify) | visual checks with real data, ticks, spec notes |

**Adding i18n keys (every task that touches messages):** merge the given object into the existing top-level key of the same name in BOTH files (create the key if missing), keep existing entries, 2-space JSON. Where a task REPLACES a key (e.g. `pages.tags`), it says so.

## Tasks

1. Tags migration + lint test
2. Tag name / id validation (`lib/tags.ts`)
3. Owner-session readers (`lib/dashboard/detail-read.ts`)
4. Tag server actions
5. Account Overview model + tab parsing (`lib/dashboard/account.ts`)
6. Posts, Stories and tag-stats models (`lib/dashboard/content.ts`)
7. Audience model, country names, centroids
8. Calendar model (`lib/dashboard/calendar.ts`)
9. Account page, header + tabs, Overview tab UI
10. Posts tab UI + tag picker (+ DataTable paging)
11. Stories + Audience tabs + motion-gated globe
12. Tags page
13. Calendar page + navigation
14. Overview links, docs, final check

---
