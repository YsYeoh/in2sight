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

### Task 1: Tags migration + lint test

**Files:**
- Create: `supabase/migrations/20261017000001_tags.sql`
- Test: `tests/tags-migration.test.ts` (new); `tests/migrations.test.ts` already lints every migration (RLS + a policy per table, `to authenticated`, no anon/public) and must keep passing.

**Interfaces:**
- Consumes: `public.is_owner()` (migration `20261014000001`), `public.media(id text)` (migration `20261015000001`).
- Produces: tables `public.tags(id uuid, name text, color text, created_at)` and `public.media_tags(media_id text, tag_id uuid, created_at)`; unique index `tags_name_lower_key` on `lower(name)` (a violation surfaces as Postgres error code `23505`); FK violations as `23503`.

- [ ] **Step 1: Write the failing test** — `tests/tags-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261017000001_tags.sql'), 'utf8').replace(/--.*$/gm, '');
const tableBody = (t: string) => sql.match(new RegExp('create\\s+table\\s+public\\.' + t + '\\s*\\(([\\s\\S]*?)\\r?\\n\\);', 'i'))?.[1] ?? '';
const policies = (t: string) => [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]).filter((p) => new RegExp('\\son\\s+public\\.' + t + '\\s', 'i').test(p));

describe('tags migration', () => {
  it.each(['tags', 'media_tags'])('%s: RLS on, one owner-only policy for every action (using + with check)', (t) => {
    expect(tableBody(t), `create table ${t}`).not.toBe('');
    expect(sql).toMatch(new RegExp('alter\\s+table\\s+public\\.' + t + '\\s+enable\\s+row\\s+level\\s+security', 'i'));
    const ps = policies(t);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatch(/for\s+all\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)\s+with\s+check\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  it('tag names: 1-40 characters, trimmed, unique ignoring case', () => {
    expect(tableBody('tags')).toMatch(/char_length\(name\)\s+between\s+1\s+and\s+40/i);
    expect(tableBody('tags')).toMatch(/name\s*=\s*btrim\(name\)/i);
    expect(sql).toMatch(/create\s+unique\s+index\s+\w+\s+on\s+public\.tags\s*\(\s*lower\(name\)\s*\)/i);
  });

  it('colours are chart tokens, never raw colours', () => {
    expect(tableBody('tags')).toMatch(/color\s+in\s*\(\s*'chart-1'\s*,\s*'chart-2'\s*,\s*'chart-3'\s*,\s*'chart-4'\s*,\s*'chart-5'\s*,\s*'chart-6'\s*\)/i);
  });

  it('media_tags: one row per (media, tag), cascades with either side, indexed by tag', () => {
    const body = tableBody('media_tags');
    expect(body).toMatch(/primary\s+key\s*\(\s*media_id\s*,\s*tag_id\s*\)/i);
    expect(body).toMatch(/media_id\s+text\s+not\s+null\s+references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(body).toMatch(/tag_id\s+uuid\s+not\s+null\s+references\s+public\.tags\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(sql).toMatch(/create\s+index\s+\w+\s+on\s+public\.media_tags\s*\(\s*tag_id\s*\)/i);
  });

  it('never grants anything to anon/public and never touches account_tokens', () => {
    expect(sql).not.toMatch(/\bto\s+(anon|public)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/tags-migration.test.ts`
Expected: FAIL with `ENOENT: no such file or directory ... 20261017000001_tags.sql`.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20261017000001_tags.sql`:

```sql
-- Plan 7: post tags (content pillars, SPEC §5). Unlike the sync tables these are owner-authored UI data: the owner
-- session may select/insert/update/delete them under RLS. Server actions use the owner-session client, never the
-- admin client, so RLS applies to every write.

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  color      text not null default 'chart-1' check (color in ('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6')),
  created_at timestamptz not null default now()
);
-- names are unique ignoring case ("Promo" and "promo" are the same tag); the app normalises first (NFC, spaces)
create unique index tags_name_lower_key on public.tags (lower(name));
alter table public.tags enable row level security;
create policy tags_owner_all on public.tags
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create table public.media_tags (
  media_id   text not null references public.media (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, tag_id)
);
-- the primary key serves lookups by media; this one serves "posts with tag X" and the tag delete cascade
create index media_tags_tag_idx on public.media_tags (tag_id);
alter table public.media_tags enable row level security;
create policy media_tags_owner_all on public.media_tags
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
```

Notes for the implementer: `gen_random_uuid()` is built into Postgres 13+ (Supabase); `btrim(name)` only strips spaces, which is all the app can send after normalising (Task 2). Do NOT apply this to the live project — that is the owner's runbook step (Task 14).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tags-migration.test.ts tests/migrations.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261017000001_tags.sql tests/tags-migration.test.ts
git commit -m "feat: tags and media_tags tables with owner RLS" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tag name / id validation (`lib/tags.ts`)

**Files:**
- Create: `lib/tags.ts`
- Test: `tests/tags.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TAG_NAME_MAX = 40`, `MAX_TAGS_PER_POST = 10`, `TAG_COLORS` (`'chart-1'…'chart-6'`), `type TagColor`, `isUuid(v: unknown): v is string`, `isMediaId(v: unknown): v is string`, `normalizeTagName(raw: unknown): { ok: true; value: string } | { ok: false; error: 'invalid_name' }`, `sameTagName(a: string, b: string): boolean`, `pickColor(used: string[]): TagColor`.

- [ ] **Step 1: Write the failing test** — `tests/tags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isMediaId, isUuid, normalizeTagName, pickColor, sameTagName, TAG_NAME_MAX } from '@/lib/tags';

describe('normalizeTagName', () => {
  it('trims and collapses whitespace (tabs, newlines, repeated spaces)', () => {
    expect(normalizeTagName('  Behind \t the\n\nscenes  ')).toEqual({ ok: true, value: 'Behind the scenes' });
  });

  it('normalises real-world names: emoji, RTL, CJK and NFD accents', () => {
    expect(normalizeTagName('🔥 Hot')).toEqual({ ok: true, value: '🔥 Hot' });
    expect(normalizeTagName('عروض خاصة')).toEqual({ ok: true, value: 'عروض خاصة' });
    expect(normalizeTagName('幕后花絮')).toEqual({ ok: true, value: '幕后花絮' });
    const nfd = 'Café';
    const r = normalizeTagName(nfd);
    expect(r).toEqual({ ok: true, value: 'Café' });
    expect(r.ok && r.value.length).toBe(4); // composed, so "Café" typed either way is one tag
  });

  it('limits to 40 code points: 40 emoji pass, 41 characters fail', () => {
    expect(normalizeTagName('😀'.repeat(TAG_NAME_MAX)).ok).toBe(true); // 80 UTF-16 units, 40 code points
    expect(normalizeTagName('a'.repeat(TAG_NAME_MAX + 1))).toEqual({ ok: false, error: 'invalid_name' });
  });

  it('rejects empty, non-strings, control characters and bidi overrides', () => {
    for (const bad of ['', '   ', null, undefined, 42, ['a'], 'a\u0000b', 'a\u0007b', 'evil‮gnp.exe', 'x⁦y']) expect(normalizeTagName(bad)).toEqual({ ok: false, error: 'invalid_name' });
  });
});

describe('ids, names and colours', () => {
  it('isUuid / isMediaId accept only the expected shapes', () => {
    expect(isUuid('7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e')).toBe(true);
    expect(isUuid('7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e; drop table tags')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isMediaId('17895695668004550')).toBe(true);
    expect(isMediaId('17895695668004550,1')).toBe(false);
    expect(isMediaId('')).toBe(false);
  });

  it('sameTagName ignores case only', () => {
    expect(sameTagName('Promo', 'pROMO')).toBe(true);
    expect(sameTagName('Promo', 'Promos')).toBe(false);
  });

  it('pickColor takes the least-used chart token, first on a tie', () => {
    expect(pickColor([])).toBe('chart-1');
    expect(pickColor(['chart-1', 'chart-2'])).toBe('chart-3');
    expect(pickColor(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-1'])).toBe('chart-2');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/tags.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/tags"`.

- [ ] **Step 3: Implement** — `lib/tags.ts`:

```ts
// Tag input rules, shared by the server actions (trust boundary) and the Tags page form (early feedback).
// The DB enforces the same limits (supabase/migrations/20261017000001_tags.sql); this file decides the error keys.

export const TAG_NAME_MAX = 40;
export const MAX_TAGS_PER_POST = 10;
export const TAG_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instagram media ids are numeric strings today; allow word characters so a format change does not lock tagging. */
const MEDIA_ID = /^\w{1,64}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isMediaId = (v: unknown): v is string => typeof v === 'string' && MEDIA_ID.test(v);

// C0/C1 controls, and bidi overrides/isolates (U+202A-U+202E, U+2066-U+2069) that can make a name render as
// something else. Plain RTL text (Arabic, Hebrew) is fine. Tabs/newlines are whitespace and collapse instead.
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** NFC, whitespace collapsed and trimmed, 1-40 code points (Postgres char_length counts code points too). */
export function normalizeTagName(raw: unknown): { ok: true; value: string } | { ok: false; error: 'invalid_name' } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_name' };
  const nfc = raw.normalize('NFC');
  if (FORBIDDEN.test(nfc)) return { ok: false, error: 'invalid_name' };
  const value = nfc.replace(/\s+/g, ' ').trim();
  if (value === '' || [...value].length > TAG_NAME_MAX) return { ok: false, error: 'invalid_name' };
  return { ok: true, value };
}

/** Same tag name ignoring case (the DB's unique index is on lower(name)). */
export const sameTagName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The least-used chart colour (first in order on a tie), so new tags spread over the palette. */
export function pickColor(used: string[]): TagColor {
  const count = (c: string) => used.filter((u) => u === c).length;
  return TAG_COLORS.reduce((best, c) => (count(c) < count(best) ? c : best), TAG_COLORS[0]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tags.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/tags.ts tests/tags.test.ts
git commit -m "feat: tag name normalisation and id validation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Owner-session readers (`lib/dashboard/detail-read.ts`)

**Files:**
- Create: `lib/dashboard/detail-read.ts`
- Test: `tests/detail-read.test.ts`

**Interfaces:**
- Consumes: `MEDIA_LIMIT`, `rowToPost(r)` from `lib/dashboard/read.ts`; types `Post`, `Tag`, `OnlineFollowersRow` from `lib/analysis/types.ts`; `AudienceKind` from `lib/instagram/metrics.ts`; `MediaKind` from `lib/instagram/parse.ts`.
- Produces:
  - consts `STORY_LIMIT = 200`, `TAG_LIMIT = 500`, `MONTH_LIMIT = 1000`, `ONLINE_LIMIT = 1000`, `AUDIENCE_KINDS`.
  - `interface PostRow extends Post { caption: string | null; tagIds: string[] }`
  - `interface StorySnapshot { capturedAt; reach; views; replies; shares; interactions; tapsForward; tapsBack; exits }` (numbers nullable)
  - `interface StoryRow { id; postedAt; expiresAt: string | null; permalink: string | null; snapshots: StorySnapshot[] }`
  - `type AudienceSnapshots = Record<AudienceKind, { day: string; data: Record<string, number> } | null>`
  - `interface MonthMedia { id; accountId; mediaType: MediaKind; postedAt; permalink: string | null; caption: string | null }`
  - `loadPostRows(db, accountId): Promise<PostRow[]>`, `loadStories(db, accountId, sinceIso): Promise<StoryRow[]>`, `loadAudience(db, accountId): Promise<AudienceSnapshots>`, `loadOnline(db, accountIds, fromDay): Promise<Record<string, OnlineFollowersRow[]>>`, `loadTags(db): Promise<Tag[]>`, `loadMonthMedia(db, accountIds, fromIso, toIso): Promise<MonthMedia[]>`.

Why these shapes: tag ids come embedded with each post (`media_tags(tag_id)` via the FK), so no `.in('media_id', [500 ids])` URL is ever built; the latest metrics snapshot uses the same embedded `order + limit(1)` trick as `loadPosts`; Stories keep ALL snapshots (progression) but only for 14 days and at most 200 stories; audience is the latest row per kind (3 tiny queries).

- [ ] **Step 1: Write the failing test** — `tests/detail-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadAudience, loadMonthMedia, loadOnline, loadPostRows, loadStories, loadTags, STORY_LIMIT } from '@/lib/dashboard/detail-read';
import { MEDIA_LIMIT } from '@/lib/dashboard/read';

type Call = { table: string; select: string; ops: unknown[][] };

/** Fake Supabase client: every chained call is recorded; an awaited query resolves to the next result queued for its table. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }[]>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      chain.select = (s: string) => ((call.select = s), chain);
      for (const op of ['eq', 'neq', 'gte', 'lt', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (call.ops.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[table]?.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const noStar = (calls: Call[]) => calls.forEach((c) => expect(c.select).not.toContain('*'));

describe('loadPostRows', () => {
  it('feed posts with latest metrics, caption and tag ids; null caption and permalink survive', async () => {
    const f = fakeDb({
      media: [
        {
          data: [
            { id: 'm1', account_id: 'a1', media_type: 'REELS', posted_at: '2026-10-10T10:00:00Z', permalink: null, caption: null, media_metrics: [{ reach: 50, likes: 3 }], media_tags: [{ tag_id: 't1' }, { tag_id: null }] },
            { id: 'm2', account_id: 'a1', media_type: 'IMAGE', posted_at: '2026-10-09T10:00:00Z', permalink: 'https://www.instagram.com/p/x/', caption: 'Hello', media_metrics: [], media_tags: null },
            { id: 'bad', account_id: 'a1', media_type: 'VIDEO', posted_at: '2026-10-09T10:00:00Z' },
          ],
        },
      ],
    });
    const rows = await loadPostRows(f.db, 'a1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'm1', caption: null, permalink: null, reach: 50, tagIds: ['t1'] });
    expect(rows[1]).toMatchObject({ id: 'm2', caption: 'Hello', reach: null, tagIds: [] });
    expect(f.calls[0].select).toContain('media_tags(tag_id)');
    expect(f.calls[0].ops).toContainEqual(['neq', 'media_type', 'STORY']);
    expect(f.calls[0].ops).toContainEqual(['limit', MEDIA_LIMIT]);
    expect(f.calls[0].ops).toContainEqual(['limit', 1, { referencedTable: 'media_metrics' }]);
    noStar(f.calls);
  });

  it('throws a fixed message that never echoes the database error', async () => {
    const f = fakeDb({ media: [{ error: { message: 'secret detail' } }] });
    await expect(loadPostRows(f.db, 'a1')).rejects.toThrow(/^dashboard read: post rows failed$/);
  });
});

describe('loadStories', () => {
  it('stories since a date with every snapshot oldest first; a story without snapshots keeps an empty list', async () => {
    const f = fakeDb({
      media: [
        {
          data: [
            { id: 's1', posted_at: '2026-10-14T08:00:00Z', expires_at: '2026-10-15T08:00:00Z', permalink: null, media_metrics: [{ captured_at: '2026-10-14T08:30:00Z', views: 10, exits: 1, total_interactions: 2 }] },
            { id: 's2', posted_at: '2026-10-13T08:00:00Z', expires_at: null, permalink: null, media_metrics: [] },
          ],
        },
      ],
    });
    const out = await loadStories(f.db, 'a1', '2026-10-01T00:00:00.000Z');
    expect(out[0].snapshots[0]).toEqual({ capturedAt: '2026-10-14T08:30:00Z', reach: null, views: 10, replies: null, shares: null, interactions: 2, tapsForward: null, tapsBack: null, exits: 1 });
    expect(out[1].snapshots).toEqual([]);
    expect(f.calls[0].ops).toEqual([
      ['eq', 'account_id', 'a1'],
      ['eq', 'media_type', 'STORY'],
      ['gte', 'posted_at', '2026-10-01T00:00:00.000Z'],
      ['order', 'posted_at', { ascending: false }],
      ['order', 'captured_at', { ascending: true, referencedTable: 'media_metrics' }],
      ['limit', STORY_LIMIT],
    ]);
    noStar(f.calls);
  });
});

describe('loadAudience', () => {
  it('latest snapshot per kind; missing kinds are null; non-numeric counts dropped', async () => {
    const f = fakeDb({
      audience_snapshots: [{ data: [{ day: '2026-10-14', data: { '18-24|F': 10, '25-34|M': 'x' } }] }, { data: [{ day: '2026-10-14', data: { MY: 40, XK: 2 } }] }, { data: [] }],
    });
    const out = await loadAudience(f.db, 'a1');
    expect(out.age_gender).toEqual({ day: '2026-10-14', data: { '18-24|F': 10 } });
    expect(out.country).toEqual({ day: '2026-10-14', data: { MY: 40, XK: 2 } });
    expect(out.city).toBeNull();
    expect(f.calls.map((c) => c.ops[1])).toEqual([['eq', 'kind', 'age_gender'], ['eq', 'kind', 'country'], ['eq', 'kind', 'city']]);
    for (const c of f.calls) expect(c.ops).toContainEqual(['limit', 1]);
    noStar(f.calls);
  });
});

describe('loadOnline, loadTags, loadMonthMedia', () => {
  it('online followers grouped by account; no query without accounts', async () => {
    const f = fakeDb({ online_followers: [{ data: [{ account_id: 'a1', day: '2026-10-13', hourly: [1, 'x', 3] }] }] });
    expect(await loadOnline(f.db, ['a1', 'a2'], '2026-09-14')).toEqual({ a1: [{ day: '2026-10-13', hourly: [1, null, 3] }], a2: [] });
    expect(f.calls[0].ops[0]).toEqual(['in', 'account_id', ['a1', 'a2']]);
    const empty = fakeDb({});
    expect(await loadOnline(empty.db, [], '2026-09-14')).toEqual({});
    expect(empty.calls).toHaveLength(0);
  });

  it('tags ordered by name with explicit columns', async () => {
    const f = fakeDb({ tags: [{ data: [{ id: 't1', name: 'Promo', color: 'chart-2' }] }] });
    expect(await loadTags(f.db)).toEqual([{ id: 't1', name: 'Promo', color: 'chart-2' }]);
    expect(f.calls[0].select).toBe('id,name,color');
  });

  it('month media: posts and stories in [from, to) for the accounts', async () => {
    const f = fakeDb({ media: [{ data: [{ id: 's', account_id: 'a1', media_type: 'STORY', posted_at: '2026-10-01T00:00:00Z', permalink: null, caption: null }] }] });
    expect(await loadMonthMedia(f.db, ['a1'], '2026-09-30T16:00:00.000Z', '2026-10-31T16:00:00.000Z')).toEqual([{ id: 's', accountId: 'a1', mediaType: 'STORY', postedAt: '2026-10-01T00:00:00Z', permalink: null, caption: null }]);
    expect(f.calls[0].ops.slice(0, 3)).toEqual([['in', 'account_id', ['a1']], ['gte', 'posted_at', '2026-09-30T16:00:00.000Z'], ['lt', 'posted_at', '2026-10-31T16:00:00.000Z']]);
    noStar(f.calls);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/detail-read.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/dashboard/detail-read"`.

- [ ] **Step 3: Implement** — `lib/dashboard/detail-read.ts`:

```ts
// Account detail, Tags and Calendar reads. OWNER SESSION client only (RLS: owner select); explicit columns, hard
// limits, fixed error messages (Supabase messages can echo values). Never the admin client, never account_tokens.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnlineFollowersRow, Post, Tag } from '@/lib/analysis/types';
import { MEDIA_LIMIT, rowToPost } from '@/lib/dashboard/read';
import type { AudienceKind } from '@/lib/instagram/metrics';
import type { MediaKind } from '@/lib/instagram/parse';

/** Stories are read for the last 14 days; ~10 a day is already a heavy poster. */
export const STORY_LIMIT = 200;
export const TAG_LIMIT = 500;
/** One month of posts + stories over 3-4 accounts stays far below this (PostgREST's default cap is 1000). */
export const MONTH_LIMIT = 1000;
export const ONLINE_LIMIT = 1000;
export const AUDIENCE_KINDS: AudienceKind[] = ['age_gender', 'country', 'city'];

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

function fail(op: string): never {
  throw new Error(`dashboard read: ${op} failed`);
}

export interface PostRow extends Post {
  caption: string | null;
  tagIds: string[];
}

export interface StorySnapshot {
  capturedAt: string;
  reach: number | null;
  views: number | null;
  replies: number | null;
  shares: number | null;
  interactions: number | null;
  tapsForward: number | null;
  tapsBack: number | null;
  exits: number | null;
}

export interface StoryRow {
  id: string;
  postedAt: string;
  expiresAt: string | null;
  permalink: string | null;
  snapshots: StorySnapshot[]; // oldest first; empty when Instagram never shared metrics (under 5 viewers)
}

export type AudienceSnapshots = Record<AudienceKind, { day: string; data: Record<string, number> } | null>;

export interface MonthMedia {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string;
  permalink: string | null;
  caption: string | null;
}

/** Feed posts + reels (no stories), newest first, each with its latest metrics snapshot, caption and tag ids. */
export async function loadPostRows(db: SupabaseClient, accountId: string): Promise<PostRow[]> {
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption,media_metrics(captured_at,reach,views,likes,comments,shares,saves),media_tags(tag_id)')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: false, referencedTable: 'media_metrics' })
    .limit(MEDIA_LIMIT)
    .limit(1, { referencedTable: 'media_metrics' });
  if (error) fail('post rows');
  return ((data ?? []) as Row[]).flatMap((r) => {
    const p = rowToPost(r);
    if (!p || p.mediaType === 'STORY') return [];
    const tags = Array.isArray(r.media_tags) ? (r.media_tags as Row[]) : [];
    return [{ ...p, caption: str(r.caption), tagIds: tags.map((t) => str(t.tag_id)).filter((t): t is string => t !== null) }];
  });
}

/** Stories posted since `sinceIso`, newest first, with every snapshot (oldest first). */
export async function loadStories(db: SupabaseClient, accountId: string, sinceIso: string): Promise<StoryRow[]> {
  const { data, error } = await db
    .from('media')
    .select('id,posted_at,expires_at,permalink,media_metrics(captured_at,reach,views,replies,shares,total_interactions,taps_forward,taps_back,exits)')
    .eq('account_id', accountId)
    .eq('media_type', 'STORY')
    .gte('posted_at', sinceIso)
    .order('posted_at', { ascending: false })
    .order('captured_at', { ascending: true, referencedTable: 'media_metrics' })
    .limit(STORY_LIMIT);
  if (error) fail('stories');
  return ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    postedAt: String(r.posted_at),
    expiresAt: str(r.expires_at),
    permalink: str(r.permalink),
    snapshots: (Array.isArray(r.media_metrics) ? (r.media_metrics as Row[]) : []).map((m) => ({
      capturedAt: String(m.captured_at),
      reach: num(m.reach),
      views: num(m.views),
      replies: num(m.replies),
      shares: num(m.shares),
      interactions: num(m.total_interactions),
      tapsForward: num(m.taps_forward),
      tapsBack: num(m.taps_back),
      exits: num(m.exits),
    })),
  }));
}

const isCounts = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The latest snapshot of each audience kind (one small query per kind, in parallel). Non-numeric values are dropped. */
export async function loadAudience(db: SupabaseClient, accountId: string): Promise<AudienceSnapshots> {
  const rows = await Promise.all(
    AUDIENCE_KINDS.map(async (kind) => {
      const { data, error } = await db.from('audience_snapshots').select('day,data').eq('account_id', accountId).eq('kind', kind).order('day', { ascending: false }).limit(1);
      if (error) fail('audience');
      const r = ((data ?? []) as Row[])[0];
      if (!r || !isCounts(r.data)) return null;
      const counts = Object.fromEntries(Object.entries(r.data).flatMap(([k, v]) => (num(v) !== null ? [[k, v as number]] : [])));
      return { day: String(r.day), data: counts };
    }),
  );
  return { age_gender: rows[0], country: rows[1], city: rows[2] };
}

/** online_followers rows from `fromDay` on for the given accounts, grouped by account. */
export async function loadOnline(db: SupabaseClient, accountIds: string[], fromDay: string): Promise<Record<string, OnlineFollowersRow[]>> {
  const out: Record<string, OnlineFollowersRow[]> = Object.fromEntries(accountIds.map((id) => [id, []]));
  if (accountIds.length === 0) return out;
  const { data, error } = await db.from('online_followers').select('account_id,day,hourly').in('account_id', accountIds).gte('day', fromDay).order('day', { ascending: true }).limit(ONLINE_LIMIT);
  if (error) fail('online followers');
  for (const r of (data ?? []) as Row[]) {
    const id = String(r.account_id);
    out[id]?.push({ day: String(r.day), hourly: Array.isArray(r.hourly) ? r.hourly.map(num) : [] });
  }
  return out;
}

export async function loadTags(db: SupabaseClient): Promise<Tag[]> {
  const { data, error } = await db.from('tags').select('id,name,color').order('name', { ascending: true }).limit(TAG_LIMIT);
  if (error) fail('tags');
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), color: String(r.color) }));
}

/** Every media item (posts AND stories) published in [fromIso, toIso) for the given accounts, oldest first. */
export async function loadMonthMedia(db: SupabaseClient, accountIds: string[], fromIso: string, toIso: string): Promise<MonthMedia[]> {
  if (accountIds.length === 0) return [];
  const { data, error } = await db
    .from('media')
    .select('id,account_id,media_type,posted_at,permalink,caption')
    .in('account_id', accountIds)
    .gte('posted_at', fromIso)
    .lt('posted_at', toIso)
    .order('posted_at', { ascending: true })
    .limit(MONTH_LIMIT);
  if (error) fail('month media');
  return ((data ?? []) as Row[]).flatMap((r) => {
    const p = rowToPost({ ...r, media_metrics: [] });
    return p ? [{ id: p.id, accountId: p.accountId, mediaType: p.mediaType, postedAt: p.postedAt, permalink: p.permalink, caption: str(r.caption) }] : [];
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/detail-read.test.ts tests/dashboard-read.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/detail-read.ts tests/detail-read.test.ts
git commit -m "feat: owner-session readers for posts with tags, stories, audience, online followers, tags and month media" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tag server actions

**Files:**
- Create: `app/(app)/tags/actions.ts`
- Test: `tests/tag-actions.test.ts`

**Interfaces:**
- Consumes: `requireOwner()` (`lib/auth/require-owner.ts`), `createServerSupabase()` (`lib/supabase/server.ts`), `TAG_LIMIT` (Task 3), `isUuid`, `isMediaId`, `normalizeTagName`, `sameTagName`, `pickColor`, `MAX_TAGS_PER_POST` (Task 2).
- Produces (all `'use server'`): `type TagError = 'invalid_name' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected'`, `type TagResult = { ok: true } | { ok: false; error: TagError }`, `createTagAction(name: string)`, `renameTagAction(id: string, name: string)`, `deleteTagAction(id: string)`, `setPostTagsAction(mediaId: string, tagIds: string[])` — each `Promise<TagResult>`. Error keys are translated under `pages.tags.errors.*` (Task 12 adds them).

Why the owner-session client (not admin): tags are the owner's own UI data and RLS (`tags_owner_all`, `media_tags_owner_all`) gates every write on `is_owner()`; with the admin client a bug in an action could write anywhere and skip that gate. `requireOwner()` is awaited first and OUTSIDE try/catch (it redirects by throwing; a catch would swallow the redirect).

- [ ] **Step 1: Write the failing test** — `tests/tag-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = unknown[];
const { calls, requireOwner, queue } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'not', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));

import { createTagAction, deleteTagAction, renameTagAction, setPostTagsAction } from '@/app/(app)/tags/actions';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('tag actions: authorization and boundary validation', () => {
  it.each([
    ['create', () => createTagAction('Promo')],
    ['rename', () => renameTagAction(T1, 'Promo')],
    ['delete', () => deleteTagAction(T1)],
    ['setPostTags', () => setPostTagsAction('17895695668004550', [T1])],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('never uses the admin client', async () => {
    await createTagAction('Promo');
    await setPostTagsAction('1', []);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('invalid input returns an error key without opening a database client', async () => {
    expect(await createTagAction('   ')).toEqual({ ok: false, error: 'invalid_name' });
    expect(await createTagAction('a'.repeat(41))).toEqual({ ok: false, error: 'invalid_name' });
    expect(await renameTagAction('nope', 'X')).toEqual({ ok: false, error: 'not_found' });
    expect(await deleteTagAction("1' or 1=1")).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1,2', [T1])).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1', ['x'])).toEqual({ ok: false, error: 'not_found' });
    expect(await setPostTagsAction('1', 'x' as unknown as string[])).toEqual({ ok: false, error: 'not_found' });
    const eleven = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`);
    expect(await setPostTagsAction('1', eleven)).toEqual({ ok: false, error: 'too_many' });
    expect(calls.some((c) => c[0] === 'session')).toBe(false);
  });
});

describe('createTagAction', () => {
  it('stores the normalised name with the least-used colour and revalidates', async () => {
    queue.push({ data: [{ id: T2, name: 'Old', color: 'chart-1' }] }, { error: null });
    expect(await createTagAction('  Behind   the scenes ')).toEqual({ ok: true });
    expect(has('insert', { name: 'Behind the scenes', color: 'chart-2' })).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
  });

  it('a duplicate in a different case returns duplicate (app check) and 23505 maps to duplicate (race)', async () => {
    queue.push({ data: [{ id: T2, name: 'Promo', color: 'chart-1' }] });
    expect(await createTagAction('PROMO')).toEqual({ ok: false, error: 'duplicate' });
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
    queue.push({ data: [] }, { error: { code: '23505', message: 'duplicate key value violates unique constraint "tags_name_lower_key"' } });
    expect(await createTagAction('Promo')).toEqual({ ok: false, error: 'duplicate' });
  });

  it('an unexpected database error returns unexpected, never the message', async () => {
    queue.push({ error: { message: 'secret' } });
    expect(await createTagAction('Promo')).toEqual({ ok: false, error: 'unexpected' });
  });
});

describe('renameTagAction / deleteTagAction', () => {
  it('rename: renaming to its own name in another case is allowed; another tag with that name is a duplicate', async () => {
    queue.push({ data: [{ id: T1, name: 'promo', color: 'chart-1' }] }, { data: [{ id: T1 }] });
    expect(await renameTagAction(T1, 'Promo')).toEqual({ ok: true });
    expect(has('update', { name: 'Promo' })).toBe(true);
    expect(has('eq', 'id', T1)).toBe(true);
    queue.push({ data: [{ id: T2, name: 'Promo', color: 'chart-1' }] });
    expect(await renameTagAction(T1, 'promo')).toEqual({ ok: false, error: 'duplicate' });
  });

  it('rename / delete of a tag that is gone returns not_found', async () => {
    queue.push({ data: [] }, { data: [] });
    expect(await renameTagAction(T1, 'X')).toEqual({ ok: false, error: 'not_found' });
    queue.push({ data: [] });
    expect(await deleteTagAction(T1)).toEqual({ ok: false, error: 'not_found' });
    queue.push({ data: [{ id: T1 }] });
    expect(await deleteTagAction(T1)).toEqual({ ok: true });
  });
});

describe('setPostTagsAction', () => {
  it('upserts the deduplicated set, then removes every other tag of that post', async () => {
    expect(await setPostTagsAction('17895695668004550', [T1, T1.toUpperCase(), T2])).toEqual({ ok: true });
    expect(has('upsert', [{ media_id: '17895695668004550', tag_id: T1 }, { media_id: '17895695668004550', tag_id: T2 }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true })).toBe(true);
    expect(has('not', 'tag_id', 'in', `(${T1},${T2})`)).toBe(true);
    expect(has('revalidate', '/accounts/[id]', 'page')).toBe(true);
  });

  it('an empty list clears the post (no upsert, plain delete)', async () => {
    expect(await setPostTagsAction('1', [])).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'upsert' || c[0] === 'not')).toBe(false);
    expect(has('delete')).toBe(true);
    expect(has('eq', 'media_id', '1')).toBe(true);
  });

  it('a missing post or tag (foreign key) returns not_found', async () => {
    queue.push({ error: { code: '23503' } });
    expect(await setPostTagsAction('1', [T1])).toEqual({ ok: false, error: 'not_found' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/tag-actions.test.ts`
Expected: FAIL with `Failed to resolve import "@/app/(app)/tags/actions"`.

- [ ] **Step 3: Implement** — `app/(app)/tags/actions.ts`:

```ts
'use server';

// Tags are owner-authored data: these actions use the OWNER-SESSION client, so RLS (tags_owner_all /
// media_tags_owner_all, gated on is_owner()) still applies to every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { TAG_LIMIT } from '@/lib/dashboard/detail-read';
import { createServerSupabase } from '@/lib/supabase/server';
import { isMediaId, isUuid, MAX_TAGS_PER_POST, normalizeTagName, pickColor, sameTagName } from '@/lib/tags';

export type TagError = 'invalid_name' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected';
export type TagResult = { ok: true } | { ok: false; error: TagError };

type DbError = { code?: string } | null;
// 23505 unique_violation (lower(name) index, a race with another tab), 23503 foreign key (media/tag gone)
const keyOf = (e: DbError): TagError => (e?.code === '23505' ? 'duplicate' : e?.code === '23503' ? 'not_found' : 'unexpected');
const fail = (error: TagError): TagResult => ({ ok: false, error });

function done(): TagResult {
  revalidatePath('/tags');
  revalidatePath('/accounts/[id]', 'page');
  return { ok: true };
}

async function existing(db: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data, error } = await db.from('tags').select('id,name,color').limit(TAG_LIMIT);
  if (error) throw new Error('tags read failed');
  return (data ?? []) as { id: string; name: string; color: string }[];
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function createTagAction(name: string): Promise<TagResult> {
  await requireOwner();
  const n = normalizeTagName(name);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    const tags = await existing(db);
    if (tags.some((t) => sameTagName(t.name, n.value))) return fail('duplicate');
    const { error } = await db.from('tags').insert({ name: n.value, color: pickColor(tags.map((t) => t.color)) });
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}

export async function renameTagAction(id: string, name: string): Promise<TagResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  const n = normalizeTagName(name);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    if ((await existing(db)).some((t) => t.id !== id && sameTagName(t.name, n.value))) return fail('duplicate');
    const { data, error } = await db.from('tags').update({ name: n.value }).eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deleteTagAction(id: string): Promise<TagResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('tags').delete().eq('id', id).select('id'); // media_tags rows cascade
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Replaces a post's tags with exactly `tagIds` (deduplicated, at most 10). Adds first, then removes the rest, so a
 *  failure half-way leaves extra tags rather than losing the existing ones. */
export async function setPostTagsAction(mediaId: string, tagIds: string[]): Promise<TagResult> {
  await requireOwner();
  if (!isMediaId(mediaId) || !Array.isArray(tagIds) || !tagIds.every(isUuid)) return fail('not_found');
  const ids = [...new Set(tagIds.map((t) => t.toLowerCase()))];
  if (ids.length > MAX_TAGS_PER_POST) return fail('too_many');
  try {
    const db = await createServerSupabase();
    if (ids.length) {
      const { error } = await db.from('media_tags').upsert(ids.map((tag_id) => ({ media_id: mediaId, tag_id })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
      if (error) return fail(keyOf(error));
    }
    const del = db.from('media_tags').delete().eq('media_id', mediaId);
    // ids are validated uuids, so the PostgREST list literal cannot be injected into
    const { error } = ids.length ? await del.not('tag_id', 'in', `(${ids.join(',')})`) : await del;
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/tag-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/tags/actions.ts" tests/tag-actions.test.ts
git commit -m "feat: tag create/rename/delete and post tagging server actions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Account Overview model + tab parsing (`lib/dashboard/account.ts`)

**Files:**
- Create: `lib/dashboard/account.ts`
- Modify: `lib/dashboard/overview.ts` (export `cardState`)
- Test: `tests/dashboard-account.test.ts`

**Interfaces:**
- Consumes: `summarize`, `kpis`, `Kpi`, `KpiId` (`lib/analysis/growth.ts`); `onlineHeatmap`, `postHeatmap`, `Heatmap` (`lib/analysis/best-time.ts`); `takingOff`, `reachDrop`, `Flag` (`lib/analysis/flags.ts`); `formatComparison` (`lib/analysis/posts.ts`); `cardState`, `CardState` (`lib/dashboard/overview.ts`); `SyncStatus` (`lib/sync/store.ts`); `StoredAccount`; `WeekStart`.
- Produces: `TABS`, `type Tab = 'overview' | 'posts' | 'stories' | 'audience'`, `parseTab(v: unknown): Tab`, `poolFor(account: StoredAccount, accounts: StoredAccount[]): StoredAccount[]`, `interface AccountOverviewInput { account; sync; daily; posts; online; pooled: { accounts: number; posts: Post[]; online: OnlineFollowersRow[] } }`, `interface AccountOverviewModel { period; state; kpis; trend: { day; reach; views; followers }[]; formats; heat: { online: { account; pooled }; posts: { account; pooled } }; pooledAccounts; flags; lastSyncedAt; syncErrorKey }`, `buildAccountOverview(input, { period, today, now: Date, tz, weekStart }): AccountOverviewModel`.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildAccountOverview, parseTab, poolFor, type AccountOverviewInput } from '@/lib/dashboard/account';
import { addDays } from '@/lib/sync/time';

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur';
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000 + i, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const post = (id: string, postedAt: string, reach: number, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: 10, comments: null, shares: null, saves: null, ...o });
const empty: AccountOverviewInput = { account: acct('a1'), sync: undefined, daily: [], posts: [], online: [], pooled: { accounts: 1, posts: [], online: [] } };
const opts = { period: 7 as const, today: TODAY, now: NOW, tz: KL, weekStart: 'mon' as const };

describe('parseTab', () => {
  it('accepts the four tabs only (tab param injection falls back to overview)', () => {
    expect(['overview', 'posts', 'stories', 'audience'].map(parseTab)).toEqual(['overview', 'posts', 'stories', 'audience']);
    for (const bad of [undefined, '', 'POSTS', 'settings', '<script>alert(1)</script>', 'posts ', ['posts', 'audience'], 42, '__proto__', 'constructor']) expect(parseTab(bad)).toBe('overview');
  });
});

describe('poolFor', () => {
  it('pools the group, or every live account for an isolated one; archived never', () => {
    const list = [acct('a', { groupName: 'G' }), acct('b', { groupName: 'G' }), acct('c'), acct('d', { groupName: 'G', status: 'archived' })];
    expect(poolFor(list[0], list).map((a) => a.id)).toEqual(['a', 'b']);
    expect(poolFor(list[2], list).map((a) => a.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildAccountOverview', () => {
  it('KPIs with comparison, a trend over the window, formats, heatmaps, flags and sync status', () => {
    const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100));
    const hit = post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS', permalink: 'https://www.instagram.com/reel/hit/' });
    const m = buildAccountOverview(
      { ...empty, sync: { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: 'rate_limited', consecutiveFailures: 1, dailyDoneThrough: '2026-10-14' }, daily: days(14, 100), posts: [...history, hit], online: [{ day: '2026-10-12', hourly: Array(24).fill(5) }], pooled: { accounts: 2, posts: [...history, hit, post('x', '2026-10-01T02:00:00Z', 50, { accountId: 'a2' })], online: [] } },
      opts,
    );
    expect(m.state).toBe('ok');
    expect(m.kpis.reach).toMatchObject({ value: 700, change: 0 });
    expect(m.trend).toHaveLength(7);
    expect(m.trend[6]).toEqual({ day: '2026-10-14', reach: 100, views: 200, followers: 1013 });
    expect(m.formats.map((f) => f.mediaType)).toEqual(['REELS', 'IMAGE']);
    expect(m.heat.online.account.reason).toBeNull();
    expect(m.heat.online.pooled.reason).toBe('needs_100_followers');
    expect(m.heat.posts.pooled.sample).toBe(8);
    expect(m.pooledAccounts).toBe(2);
    expect(m.flags).toEqual([expect.objectContaining({ kind: 'taking_off', postId: 'hit' })]);
    expect(m.lastSyncedAt).toBe('2026-10-15T03:00:00Z');
    expect(m.syncErrorKey).toBe('rate_limited');
  });

  it('account with no data yet: reasons everywhere, no NaN, backfilling state', () => {
    const m = buildAccountOverview(empty, opts);
    expect(m.state).toBe('backfilling');
    expect(m.kpis.reach).toMatchObject({ value: null, reason: 'no_data' });
    expect(m.trend.every((d) => d.reach === null && d.followers === null)).toBe(true);
    expect(m.formats).toEqual([]);
    expect(m.heat.online.account.reason).toBe('needs_100_followers');
    expect(m.heat.posts.account.reason).toBe('not_enough_posts');
    expect(m.flags).toEqual([]);
    expect(m.syncErrorKey).toBeNull();
    for (const k of Object.values(m.kpis)) for (const v of [k.value, k.diff, k.change]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
  });

  it('a needs_reconnect account says so', () => {
    expect(buildAccountOverview({ ...empty, account: acct('a1', { status: 'needs_reconnect' }) }, opts).state).toBe('needs_reconnect');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboard-account.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/dashboard/account"`.

- [ ] **Step 3: Export `cardState`** — in `lib/dashboard/overview.ts` change

```ts
function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, doneThrough: string | null | undefined, s: Summary, hasRows: boolean): CardState {
```

to

```ts
export function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, doneThrough: string | null | undefined, s: Summary, hasRows: boolean): CardState {
```

(nothing else in the file changes; the account page shows the same backfilling / needs-reconnect states as the Overview card).

- [ ] **Step 4: Implement** — `lib/dashboard/account.ts`:

```ts
// Account detail: URL parsing and the Overview tab model. Pure: today/now/tz are inputs.
import type { StoredAccount } from '@/lib/accounts/types';
import { onlineHeatmap, postHeatmap, type Heatmap } from '@/lib/analysis/best-time';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { kpis, summarize, type Kpi, type KpiId } from '@/lib/analysis/growth';
import { formatComparison } from '@/lib/analysis/posts';
import type { DailyRow, OnlineFollowersRow, Period, Post } from '@/lib/analysis/types';
import { cardState, type CardState } from '@/lib/dashboard/overview';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';

export const TABS = ['overview', 'posts', 'stories', 'audience'] as const;
export type Tab = (typeof TABS)[number];

/** ?tab= from the URL. Allow-list only: arrays (?tab=a&tab=b), unknown or hostile values fall back to overview. */
export function parseTab(v: unknown): Tab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v) ? (v as Tab) : 'overview';
}

/** Accounts pooled with this one for "best time": its group, or every account when it is isolated (SPEC §7b). */
export function poolFor(account: StoredAccount, accounts: StoredAccount[]): StoredAccount[] {
  const live = accounts.filter((a) => a.status !== 'archived');
  return account.groupName ? live.filter((a) => a.groupName === account.groupName) : live;
}

export interface AccountOverviewInput {
  account: StoredAccount;
  sync: SyncStatus | undefined;
  daily: DailyRow[];
  posts: Post[];
  online: OnlineFollowersRow[];
  pooled: { accounts: number; posts: Post[]; online: OnlineFollowersRow[] };
}

export interface AccountOverviewModel {
  period: Period;
  state: CardState;
  kpis: Record<KpiId, Kpi>;
  trend: { day: string; reach: number | null; views: number | null; followers: number | null }[]; // current window
  formats: ReturnType<typeof formatComparison>;
  heat: { online: { account: Heatmap; pooled: Heatmap }; posts: { account: Heatmap; pooled: Heatmap } };
  pooledAccounts: number;
  flags: Flag[];
  lastSyncedAt: string | null;
  syncErrorKey: string | null;
}

export function buildAccountOverview(input: AccountOverviewInput, o: { period: Period; today: string; now: Date; tz: string; weekStart: WeekStart }): AccountOverviewModel {
  const { account, sync, daily, posts } = input;
  const s = summarize(daily, posts, o.period, o.today, o.tz);
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const drop = reachDrop(daily, o.today, o.tz);
  return {
    period: o.period,
    state: cardState(account.status, account.tokenExpiresAt, o.now, sync?.dailyDoneThrough, s, daily.length > 0),
    kpis: kpis(s),
    trend: s.reachByDay.map(({ day }) => ({ day, reach: byDay.get(day)?.reach ?? null, views: byDay.get(day)?.views ?? null, followers: byDay.get(day)?.followers ?? null })),
    formats: formatComparison(posts),
    heat: {
      online: { account: onlineHeatmap(input.online, o.weekStart), pooled: onlineHeatmap(input.pooled.online, o.weekStart) },
      posts: { account: postHeatmap(posts, o.tz, o.weekStart), pooled: postHeatmap(input.pooled.posts, o.tz, o.weekStart) },
    },
    pooledAccounts: input.pooled.accounts,
    flags: [...takingOff(posts, o.now, o.period), ...(drop ? [drop] : [])],
    lastSyncedAt: sync?.lastSuccessAt ?? null,
    syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard-account.test.ts tests/dashboard-overview.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/account.ts lib/dashboard/overview.ts tests/dashboard-account.test.ts
git commit -m "feat: account overview model and tab parsing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Posts, Stories and tag-stats models (`lib/dashboard/content.ts`)

**Files:**
- Create: `lib/dashboard/content.ts`
- Modify: `lib/analysis/posts.ts` (export `groupStats`), `lib/analysis/types.ts` (two new `MissingReason` values), `messages/en.json`, `messages/zh-CN.json`
- Test: `tests/dashboard-content.test.ts`

**Interfaces:**
- Consumes: `engagementRate`, `FEED_FORMATS`, `tagPerformance`, `groupStats`, `GroupStats` (`lib/analysis/posts.ts`); `PostRow`, `StoryRow`, `StorySnapshot` (Task 3); `isUuid` (Task 2); `localDay` (`lib/sync/time.ts`).
- Produces: `type FeedFormat`, `interface PostFilters { format; tag: string | 'untagged' | null; from; to }`, `parseDay(v: unknown): string | null`, `parsePostFilters(sp): PostFilters`, `CAPTION_SNIPPET = 80`, `snippet(caption): string | null`, `interface PostView { id; mediaType; postedAt; permalink; caption; reach; views; likes; comments; saves; shares; engagementRate; tags: Tag[] }`, `buildPosts(rows, tags, filters, tz): PostView[]`, `interface StoryView { id; postedAt; permalink; live; final: StorySnapshot | null; exitRate; progression: (number | null)[]; snapshots: number; reason }`, `buildStories(stories, now: Date): StoryView[]`, `MIN_TAG_POSTS = 5`, `type TagStat = GroupStats & { reason }`, `buildTagStats(posts: PostRow[], tags): { rows: ({ tag } & TagStat)[]; untagged: TagStat }`. `MissingReason` gains `'needs_5_viewers' | 'few_posts'`.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-content.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Tag } from '@/lib/analysis/types';
import { buildPosts, buildStories, buildTagStats, MIN_TAG_POSTS, parsePostFilters, snippet } from '@/lib/dashboard/content';
import type { PostRow, StoryRow, StorySnapshot } from '@/lib/dashboard/detail-read';

const KL = 'Asia/Kuala_Lumpur';
const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const TAGS: Tag[] = [
  { id: T1, name: 'Promo', color: 'chart-1' },
  { id: T2, name: 'Behind', color: 'chart-2' },
];
const row = (id: string, o: Partial<PostRow> = {}): PostRow => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-10T02:00:00Z', permalink: null, reach: 100, views: null, likes: 5, comments: null, shares: null, saves: null, caption: null, tagIds: [], ...o });
const snap = (capturedAt: string, o: Partial<StorySnapshot> = {}): StorySnapshot => ({ capturedAt, reach: null, views: null, replies: null, shares: null, interactions: null, tapsForward: null, tapsBack: null, exits: null, ...o });

describe('parsePostFilters', () => {
  it('keeps valid filters', () => {
    expect(parsePostFilters({ format: 'REELS', tag: T1.toUpperCase(), from: '2026-10-01', to: '2026-10-31' })).toEqual({ format: 'REELS', tag: T1, from: '2026-10-01', to: '2026-10-31' });
    expect(parsePostFilters({ tag: 'untagged' }).tag).toBe('untagged');
  });

  it('filters ignore invalid values: unknown format, STORY, non-uuid tag, impossible dates, arrays', () => {
    expect(parsePostFilters({ format: 'STORY', tag: "x' or 1=1", from: '2026-02-31', to: '2026-13-01' })).toEqual({ format: null, tag: null, from: null, to: null });
    expect(parsePostFilters({ format: ['REELS', 'IMAGE'], from: '20261001' })).toEqual({ format: null, tag: null, from: null, to: null });
  });

  it('swaps a reversed date range', () => {
    expect(parsePostFilters({ from: '2026-10-31', to: '2026-10-01' })).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
  });
});

describe('snippet', () => {
  it('one line, at most 80 code points, never splits an emoji; null/blank → null', () => {
    expect(snippet('Hello\n\nworld')).toBe('Hello world');
    const long = '😀'.repeat(81);
    expect(snippet(long)).toBe(`${'😀'.repeat(80)}…`);
    expect(snippet(null)).toBeNull();
    expect(snippet('  \n ')).toBeNull();
  });
});

describe('buildPosts', () => {
  const rows = [
    row('a', { mediaType: 'REELS', tagIds: [T1, T2, 'gone'], caption: 'Hi', permalink: 'https://www.instagram.com/reel/a/' }),
    row('b', { postedAt: '2026-09-30T16:30:00Z' }), // 1 Oct 00:30 in Kuala Lumpur
    row('c', { mediaType: 'CAROUSEL_ALBUM', tagIds: [T2], reach: null }),
  ];

  it('maps rows with engagement rate, sorted known tags and a caption snippet; null caption/permalink stay null', () => {
    const out = buildPosts(rows, TAGS, { format: null, tag: null, from: null, to: null }, KL);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: 'a', caption: 'Hi', engagementRate: 0.05, tags: [TAGS[1], TAGS[0]] });
    expect(out[1]).toMatchObject({ id: 'b', caption: null, permalink: null });
    expect(out[2].engagementRate).toBeNull();
  });

  it('filters by format, tag, untagged and owner-timezone day', () => {
    const f = { format: null, tag: null, from: null, to: null };
    expect(buildPosts(rows, TAGS, { ...f, format: 'REELS' }, KL).map((p) => p.id)).toEqual(['a']);
    expect(buildPosts(rows, TAGS, { ...f, tag: T2 }, KL).map((p) => p.id)).toEqual(['a', 'c']);
    expect(buildPosts(rows, TAGS, { ...f, tag: 'untagged' }, KL).map((p) => p.id)).toEqual(['b']);
    expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, KL).map((p) => p.id)).toEqual(['b']);
    expect(buildPosts(rows, TAGS, { ...f, from: '2026-10-01', to: '2026-10-01' }, 'UTC').map((p) => p.id)).toEqual([]);
  });
});

describe('buildStories', () => {
  const NOW = new Date('2026-10-15T04:00:00Z');
  const story = (id: string, postedAt: string, snapshots: StorySnapshot[], expiresAt: string | null = new Date(Date.parse(postedAt) + 86_400_000).toISOString()): StoryRow => ({ id, postedAt, expiresAt, permalink: null, snapshots });

  it('final = last snapshot before expiry; exit rate = exits ÷ views; progression of views; live vs expired', () => {
    const s = story('s1', '2026-10-13T08:00:00Z', [snap('2026-10-13T08:30:00Z', { views: 10, exits: 1 }), snap('2026-10-14T07:30:00Z', { views: 40, exits: 4 }), snap('2026-10-14T08:30:00Z', { views: 41, exits: 9 })]);
    const [v] = buildStories([s], NOW);
    expect(v).toMatchObject({ live: false, final: { views: 40, exits: 4 }, exitRate: 0.1, progression: [10, 40, 41], snapshots: 3, reason: null });
    const [live] = buildStories([story('s2', '2026-10-15T01:00:00Z', [snap('2026-10-15T01:30:00Z', { views: 0, exits: 0 })])], NOW);
    expect(live).toMatchObject({ live: true, exitRate: null }); // 0 views: no rate, never NaN
  });

  it('no stories → empty list; a story without snapshots says it needs 5 viewers', () => {
    expect(buildStories([], NOW)).toEqual([]);
    const [v] = buildStories([story('s3', '2026-10-14T20:00:00Z', [], null)], NOW);
    expect(v).toMatchObject({ final: null, exitRate: null, progression: [], reason: 'needs_5_viewers', live: true });
  });
});

describe('buildTagStats', () => {
  it('per-tag stats, an untagged bucket, and the few-posts guard', () => {
    const posts = [...Array.from({ length: MIN_TAG_POSTS }, (_, i) => row(`p${i}`, { tagIds: [T1], reach: 200 })), row('u1'), row('u2', { tagIds: [] }), row('t2', { tagIds: [T2] })];
    const out = buildTagStats(posts, TAGS);
    expect(out.rows.map((r) => [r.tag.name, r.posts, r.reason])).toEqual([
      ['Promo', 5, null],
      ['Behind', 1, 'few_posts'],
    ]);
    expect(out.untagged).toMatchObject({ posts: 2, avgReach: 100, reason: 'few_posts' });
  });

  it('no tags and no posts: empty rows, untagged with zero posts', () => {
    expect(buildTagStats([], [])).toEqual({ rows: [], untagged: { posts: 0, measured: 0, avgReach: null, engagementRate: null, reason: 'few_posts' } });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboard-content.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/dashboard/content"`.

- [ ] **Step 3: Export `groupStats` and extend `MissingReason`**

In `lib/analysis/posts.ts` rename the private helper and export it (three edits):

```ts
export function groupStats(list: Post[]): GroupStats {
```

(was `function stats(list: Post[]): GroupStats {`), and replace both `...stats(` calls inside `formatComparison` and `tagPerformance` with `...groupStats(`.

In `lib/analysis/types.ts` replace the `MissingReason` line with:

```ts
export type MissingReason = 'no_data' | 'needs_100_followers' | 'not_enough_history' | 'not_enough_posts' | 'backfilling' | 'needs_5_viewers' | 'few_posts';
```

Add the two reasons to `analysis.reasons` — `messages/en.json`:

```json
"needs_5_viewers": "Instagram shares Story insights from 5 viewers",
"few_posts": "Needs 5+ measured posts to compare"
```

`messages/zh-CN.json`:

```json
"needs_5_viewers": "快拍观看者达到 5 人后 Instagram 才提供数据",
"few_posts": "至少需要 5 篇有数据的帖子才能对比"
```

- [ ] **Step 4: Implement** — `lib/dashboard/content.ts`:

```ts
// Posts tab, Stories tab and Tags page models. Pure: now/tz are inputs.
import { engagementRate, FEED_FORMATS, groupStats, tagPerformance, type GroupStats } from '@/lib/analysis/posts';
import type { MissingReason, Tag } from '@/lib/analysis/types';
import type { PostRow, StoryRow, StorySnapshot } from '@/lib/dashboard/detail-read';
import type { MediaKind } from '@/lib/instagram/parse';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export type FeedFormat = Exclude<MediaKind, 'STORY'>;
export interface PostFilters {
  format: FeedFormat | null;
  tag: string | 'untagged' | null; // a tag id (lower-case uuid), 'untagged', or no filter
  from: string | null; // 'YYYY-MM-DD' owner-timezone day, inclusive
  to: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
/** A real calendar day 'YYYY-MM-DD' or null: '2026-02-31' and '2026-13-01' are rejected (they do not round-trip). */
export function parseDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/** Posts-tab filters from the URL. Invalid values are dropped (no filter), never echoed back. */
export function parsePostFilters(sp: Params): PostFilters {
  const format = one(sp.format);
  const tag = one(sp.tag);
  let from = parseDay(sp.from);
  let to = parseDay(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    format: format && (FEED_FORMATS as string[]).includes(format) ? (format as FeedFormat) : null,
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    from,
    to,
  };
}

export const CAPTION_SNIPPET = 80;

/** First 80 code points of a caption on one line (emoji and CJK never split in half). */
export function snippet(caption: string | null): string | null {
  if (!caption) return null;
  const chars = [...caption.replace(/\s+/g, ' ').trim()];
  if (chars.length === 0) return null;
  return chars.length > CAPTION_SNIPPET ? `${chars.slice(0, CAPTION_SNIPPET).join('')}…` : chars.join('');
}

export interface PostView {
  id: string;
  mediaType: FeedFormat;
  postedAt: string;
  permalink: string | null;
  caption: string | null; // snippet
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  engagementRate: number | null;
  tags: Tag[]; // sorted by name
}

export function buildPosts(rows: PostRow[], tags: Tag[], f: PostFilters, tz: string): PostView[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  return rows
    .filter((p) => p.mediaType !== 'STORY')
    .filter((p) => !f.format || p.mediaType === f.format)
    .filter((p) => (f.tag === null ? true : f.tag === 'untagged' ? p.tagIds.length === 0 : p.tagIds.includes(f.tag)))
    .filter((p) => {
      if (!f.from && !f.to) return true;
      const day = localDay(new Date(p.postedAt), tz);
      return (!f.from || day >= f.from) && (!f.to || day <= f.to);
    })
    .map((p) => ({
      id: p.id,
      mediaType: p.mediaType as FeedFormat,
      postedAt: p.postedAt,
      permalink: p.permalink,
      caption: snippet(p.caption),
      reach: p.reach,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      saves: p.saves,
      shares: p.shares,
      engagementRate: engagementRate(p),
      tags: p.tagIds
        .map((id) => byId.get(id))
        .filter((t): t is Tag => !!t)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export interface StoryView {
  id: string;
  postedAt: string;
  permalink: string | null;
  live: boolean;
  final: StorySnapshot | null; // last snapshot before expiry = the story's final numbers (SPEC §5)
  exitRate: number | null; // exits ÷ views (SPEC §7)
  progression: (number | null)[]; // views per snapshot, oldest first
  snapshots: number;
  reason: MissingReason | null; // needs_5_viewers when Instagram never shared metrics
}

const DAY_MS = 86_400_000;

export function buildStories(stories: StoryRow[], now: Date): StoryView[] {
  return stories.map((s) => {
    const expires = s.expiresAt ? Date.parse(s.expiresAt) : Date.parse(s.postedAt) + DAY_MS;
    const before = s.snapshots.filter((x) => Date.parse(x.capturedAt) <= expires);
    const final = before[before.length - 1] ?? s.snapshots[s.snapshots.length - 1] ?? null;
    const views = final?.views ?? null;
    return {
      id: s.id,
      postedAt: s.postedAt,
      permalink: s.permalink,
      live: now.getTime() < expires,
      final,
      exitRate: final && final.exits !== null && views !== null && views > 0 ? final.exits / views : null,
      progression: s.snapshots.map((x) => x.views),
      snapshots: s.snapshots.length,
      reason: final ? null : 'needs_5_viewers',
    };
  });
}

/** Below this many measured posts a tag's averages are shown greyed with a reason. */
export const MIN_TAG_POSTS = 5;

export type TagStat = GroupStats & { reason: MissingReason | null };

/** Per-tag performance plus the "untagged" bucket, over feed posts of every account in scope. */
export function buildTagStats(posts: PostRow[], tags: Tag[]): { rows: ({ tag: Tag } & TagStat)[]; untagged: TagStat } {
  const feed = posts.filter((p) => p.mediaType !== 'STORY');
  const mediaTags = feed.flatMap((p) => p.tagIds.map((tagId) => ({ mediaId: p.id, tagId })));
  const reason = (s: GroupStats): MissingReason | null => (s.measured < MIN_TAG_POSTS ? 'few_posts' : null);
  const untagged = groupStats(feed.filter((p) => p.tagIds.length === 0));
  return {
    rows: tagPerformance(feed, mediaTags, tags).map((r) => ({ ...r, reason: reason(r) })),
    untagged: { ...untagged, reason: reason(untagged) },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard-content.test.ts tests/analysis-posts.test.ts tests/messages.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/content.ts lib/analysis/posts.ts lib/analysis/types.ts messages/en.json messages/zh-CN.json tests/dashboard-content.test.ts
git commit -m "feat: posts filters, story snapshots and tag performance models" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Audience model, country names, centroids

**Files:**
- Create: `lib/dashboard/audience.ts`, `lib/geo/centroids.ts`
- Modify: `lib/format.ts` (append `formatCountry`)
- Test: `tests/dashboard-audience.test.ts`

**Interfaces:**
- Consumes: `AudienceSnapshots` (Task 3); `MissingReason`.
- Produces: `TOP_N = 8`, `interface RankedRow { key; value; share }`, `interface Ranked { day; total; rows; other: { value; share } | null }`, `interface AgeRow { age; female; male; unknown; total; share }`, `interface GlobePoint { code; lat; lon; share }`, `interface AudienceModel { ages: { day; total; rows: AgeRow[] } | null; countries: Ranked | null; cities: Ranked | null; globe: GlobePoint[]; reason }`, `buildAudience(s: AudienceSnapshots): AudienceModel`; `CENTROIDS: Record<string, readonly [lat, lon]>`; `formatCountry(code: string, p: Pick<FormatPrefs, 'locale'>): string`.

Stored shape (checked in `lib/instagram/parse.ts` `parseBreakdown` + `lib/sync/run-account.ts` `audience`): `audience_snapshots.data` is `{ "<dimension values joined by |>": count }` — age_gender `{"18-24|F": 210}`, country `{"MY": 40}` (ISO-3166 alpha-2), city `{"Kuala Lumpur, Federal Territory of Kuala Lumpur": 30}`. Nothing is written under 100 followers.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-audience.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAudience, TOP_N } from '@/lib/dashboard/audience';
import type { AudienceSnapshots } from '@/lib/dashboard/detail-read';
import { formatCountry } from '@/lib/format';
import { CENTROIDS } from '@/lib/geo/centroids';

const none: AudienceSnapshots = { age_gender: null, country: null, city: null };
const day = '2026-10-14';

describe('buildAudience', () => {
  it('empty snapshots give needs_100_followers and nothing else', () => {
    expect(buildAudience(none)).toEqual({ ages: null, countries: null, cities: null, globe: [], reason: 'needs_100_followers' });
    expect(buildAudience({ ...none, country: { day, data: {} } }).reason).toBe('needs_100_followers');
  });

  it('countries: top 8 + other, shares of the total, ties by code, lower-case codes merged', () => {
    const data: Record<string, number> = { my: 5, MY: 45, SG: 20, ID: 10 };
    'ABCDEFGH'.split('').forEach((ch, i) => (data[`Z${ch}`] = 1 + (i % 2)));
    const m = buildAudience({ ...none, country: { day, data } });
    expect(m.countries!.total).toBe(50 + 20 + 10 + 12);
    expect(m.countries!.rows).toHaveLength(TOP_N);
    expect(m.countries!.rows.slice(0, 3).map((r) => [r.key, r.value])).toEqual([['MY', 50], ['SG', 20], ['ID', 10]]);
    expect(m.countries!.rows[3].key).toBe('ZB'); // value 2, ties broken by code
    expect(m.countries!.other!.value).toBe(m.countries!.total - m.countries!.rows.reduce((a, r) => a + r.value, 0));
    expect(m.reason).toBeNull();
  });

  it('unknown country codes keep the raw code and get no centroid (no globe dot); known ones do', () => {
    const m = buildAudience({ ...none, country: { day, data: { MY: 10, XK: 2, ZZ: 3, '??': 1 } } });
    expect(m.countries!.rows.map((r) => r.key)).toEqual(['MY', 'ZZ', 'XK', '??']);
    expect(m.globe.map((g) => g.code).sort()).toEqual(['MY', 'XK']);
    expect(m.globe.find((g) => g.code === 'MY')).toMatchObject({ lat: CENTROIDS.MY[0], lon: CENTROIDS.MY[1], share: 10 / 16 });
  });

  it('age × gender: buckets ordered by age, F/M/unknown split, keys without gender count as unknown', () => {
    const m = buildAudience({ ...none, age_gender: { day, data: { '25-34|F': 30, '18-24|M': 10, '18-24|F': 20, '65+|U': 5, '35-44': 5, '|F': 9, '13-17|M': -1 } } });
    expect(m.ages!.rows.map((r) => [r.age, r.female, r.male, r.unknown])).toEqual([
      ['18-24', 20, 10, 0],
      ['25-34', 30, 0, 0],
      ['35-44', 0, 0, 5],
      ['65+', 0, 0, 5],
    ]);
    expect(m.ages!.total).toBe(70);
    expect(m.ages!.rows[0].share).toBeCloseTo(30 / 70);
  });

  it('cities rank by name as Instagram sends it', () => {
    const m = buildAudience({ ...none, city: { day, data: { 'Kuala Lumpur, Federal Territory of Kuala Lumpur': 30, 'Singapore, Singapore': 10 } } });
    expect(m.cities!.rows[0]).toMatchObject({ key: 'Kuala Lumpur, Federal Territory of Kuala Lumpur', share: 0.75 });
    expect(m.cities!.other).toBeNull();
  });
});

describe('formatCountry', () => {
  it('names a code in the UI language; junk comes back unchanged', () => {
    expect(formatCountry('MY', { locale: 'en' })).toBe('Malaysia');
    expect(formatCountry('my', { locale: 'zh-CN' })).toBe('马来西亚');
    expect(formatCountry('XK', { locale: 'en' })).toMatch(/\S/);
    expect(formatCountry('??', { locale: 'en' })).toBe('??');
    expect(formatCountry('USA', { locale: 'en' })).toBe('USA');
  });
});

describe('CENTROIDS', () => {
  it('every entry is a valid alpha-2 code with a lat/lon in range', () => {
    expect(Object.keys(CENTROIDS).length).toBeGreaterThan(240);
    for (const [code, [lat, lon]] of Object.entries(CENTROIDS)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboard-audience.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/dashboard/audience"`.

- [ ] **Step 3: Add `formatCountry`** — append to the end of `lib/format.ts`:

```ts
/**
 * A country name for an ISO-3166 alpha-2 code in the UI language ('MY' → "Malaysia" / "马来西亚"). Anything that is not
 * two letters, or that the runtime cannot name, comes back as the code itself — never an exception.
 */
export function formatCountry(code: string, p: Pick<FormatPrefs, 'locale'>): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return code;
  try {
    const name = new Intl.DisplayNames([p.locale], { type: 'region', fallback: 'code' }).of(c);
    return name || c;
  } catch {
    return c;
  }
}
```

- [ ] **Step 4: Add the centroids** — `lib/geo/centroids.ts`:

```ts
// Approximate country centroids [latitude, longitude] by ISO-3166 alpha-2 code (Instagram's follower_demographics
// country breakdown uses these codes). Only used to place dots on the decorative audience globe, so ~1° accuracy
// is plenty. Includes XK (Kosovo, user-assigned but used by Meta). A code missing here simply gets no dot.
export const CENTROIDS: Readonly<Record<string, readonly [number, number]>> = {
  AD: [42.5, 1.5], AE: [24, 54], AF: [33, 66], AG: [17.1, -61.8], AI: [18.2, -63.1], AL: [41, 20], AM: [40, 45], AO: [-12.5, 18.5],
  AQ: [-75, 0], AR: [-34, -64], AS: [-14.3, -170.7], AT: [47.3, 13.3], AU: [-25, 134], AW: [12.5, -70], AX: [60.2, 20], AZ: [40.5, 47.5],
  BA: [44, 18], BB: [13.2, -59.5], BD: [24, 90], BE: [50.8, 4], BF: [13, -1.5], BG: [43, 25], BH: [26, 50.5], BI: [-3.5, 30],
  BJ: [9.5, 2.3], BL: [17.9, -62.8], BM: [32.3, -64.8], BN: [4.5, 114.7], BO: [-17, -65], BQ: [12.2, -68.3], BR: [-10, -55], BS: [24.3, -76],
  BT: [27.5, 90.5], BW: [-22, 24], BY: [53, 28], BZ: [17.2, -88.7], CA: [60, -96], CC: [-12.2, 96.8], CD: [-2.5, 23.5], CF: [7, 21],
  CG: [-1, 15], CH: [47, 8], CI: [7.5, -5.5], CK: [-21.2, -159.8], CL: [-30, -71], CM: [6, 12], CN: [35, 103], CO: [4, -72],
  CR: [10, -84], CU: [21.5, -79.5], CV: [16, -24], CW: [12.2, -69], CX: [-10.5, 105.7], CY: [35, 33], CZ: [49.8, 15.5], DE: [51, 10],
  DJ: [11.5, 43], DK: [56, 10], DM: [15.4, -61.4], DO: [19, -70.7], DZ: [28, 3], EC: [-1.5, -78], EE: [58.6, 25], EG: [27, 30],
  EH: [24.5, -13], ER: [15, 39], ES: [40, -4], ET: [8, 38], FI: [64, 26], FJ: [-18, 178], FK: [-51.8, -59.5], FM: [6.9, 158.2],
  FO: [62, -7], FR: [46, 2], GA: [-1, 11.7], GB: [54, -2], GD: [12.1, -61.7], GE: [42, 43.5], GF: [4, -53], GG: [49.5, -2.6],
  GH: [8, -1.2], GI: [36.1, -5.4], GL: [72, -40], GM: [13.5, -15.5], GN: [10, -11], GP: [16.2, -61.6], GQ: [1.6, 10.5], GR: [39, 22],
  GT: [15.5, -90.3], GU: [13.4, 144.8], GW: [12, -15], GY: [5, -59], HK: [22.3, 114.2], HN: [15, -86.5], HR: [45.2, 15.5], HT: [19, -72.3],
  HU: [47, 19.5], ID: [-2, 118], IE: [53, -8], IL: [31.5, 34.8], IM: [54.2, -4.5], IN: [22, 79], IO: [-6, 71.5], IQ: [33, 44],
  IR: [32, 53], IS: [65, -18], IT: [42.8, 12.8], JE: [49.2, -2.1], JM: [18.1, -77.3], JO: [31, 36], JP: [36, 138], KE: [0.5, 38],
  KG: [41.5, 75], KH: [12.5, 105], KI: [1.9, -157.4], KM: [-12.2, 44.3], KN: [17.3, -62.7], KP: [40, 127], KR: [36.5, 128], KW: [29.3, 47.7],
  KY: [19.3, -81.3], KZ: [48, 68], LA: [18, 105], LB: [33.8, 35.8], LC: [13.9, -61], LI: [47.2, 9.5], LK: [7.8, 80.8], LR: [6.5, -9.5],
  LS: [-29.5, 28.3], LT: [55.2, 24], LU: [49.8, 6.1], LV: [57, 25], LY: [27, 17], MA: [32, -6], MC: [43.7, 7.4], MD: [47, 28.5],
  ME: [42.8, 19.3], MF: [18.1, -63], MG: [-20, 47], MH: [7.1, 171.2], MK: [41.6, 21.7], ML: [17, -4], MM: [21, 96], MN: [46, 105],
  MO: [22.2, 113.5], MP: [15.2, 145.7], MQ: [14.6, -61], MR: [20, -10.5], MS: [16.7, -62.2], MT: [35.9, 14.4], MU: [-20.3, 57.6], MV: [3.2, 73.2],
  MW: [-13.5, 34], MX: [23, -102], MY: [3.5, 102], MZ: [-18, 35], NA: [-22, 17], NC: [-21.3, 165.5], NE: [16, 8], NF: [-29, 168],
  NG: [9, 8], NI: [13, -85], NL: [52.2, 5.5], NO: [62, 10], NP: [28, 84], NR: [-0.5, 166.9], NU: [-19, -169.9], NZ: [-41, 174],
  OM: [21, 57], PA: [9, -80], PE: [-10, -76], PF: [-17.6, -149.4], PG: [-6, 147], PH: [12, 122], PK: [30, 70], PL: [52, 19.5],
  PM: [46.9, -56.3], PN: [-25, -130], PR: [18.2, -66.5], PS: [32, 35.2], PT: [39.5, -8], PW: [7.5, 134.6], PY: [-23, -58], QA: [25.3, 51.2],
  RE: [-21.1, 55.5], RO: [46, 25], RS: [44, 21], RU: [60, 95], RW: [-2, 30], SA: [24, 45], SB: [-9, 160], SC: [-4.6, 55.5],
  SD: [15, 30], SE: [62, 15], SG: [1.35, 103.8], SH: [-15.9, -5.7], SI: [46.1, 14.8], SJ: [78, 16], SK: [48.7, 19.5], SL: [8.5, -11.8],
  SM: [43.9, 12.4], SN: [14.5, -14.5], SO: [6, 46], SR: [4, -56], SS: [7, 30], ST: [0.2, 6.6], SV: [13.8, -88.9], SX: [18, -63.1],
  SY: [35, 38.5], SZ: [-26.5, 31.5], TC: [21.8, -71.8], TD: [15, 19], TG: [8.5, 1], TH: [15, 101], TJ: [39, 71], TK: [-9.2, -171.8],
  TL: [-8.8, 125.9], TM: [39, 60], TN: [34, 9.5], TO: [-20, -175], TR: [39, 35], TT: [10.5, -61.3], TV: [-8.5, 179.2], TW: [23.7, 121],
  TZ: [-6, 35], UA: [49, 32], UG: [1.3, 32.3], US: [39, -98], UY: [-33, -56], UZ: [41.5, 64], VA: [41.9, 12.45], VC: [13.2, -61.2],
  VE: [7, -66], VG: [18.4, -64.6], VI: [18.3, -64.8], VN: [16, 107], VU: [-16, 167], WF: [-13.3, -176.2], WS: [-13.8, -172.1], XK: [42.6, 20.9],
  YE: [15.5, 48], YT: [-12.8, 45.2], ZA: [-29, 24], ZM: [-14, 28], ZW: [-19, 30],
};
```

- [ ] **Step 5: Implement** — `lib/dashboard/audience.ts`:

```ts
// Audience tab model: latest follower_demographics snapshots → ranked bars, an age × gender split and globe points.
// Instagram returns at most 45 rows per breakdown and nothing under 100 followers (lib/instagram/metrics.ts).
import type { MissingReason } from '@/lib/analysis/types';
import type { AudienceSnapshots } from '@/lib/dashboard/detail-read';
import { CENTROIDS } from '@/lib/geo/centroids';

export const TOP_N = 8;

export interface RankedRow {
  key: string; // country code (upper-case) or city name
  value: number;
  share: number; // of the snapshot total, 0..1
}
export interface Ranked {
  day: string;
  total: number;
  rows: RankedRow[]; // top N, largest first
  other: { value: number; share: number } | null; // everything after the top N
}
export interface AgeRow {
  age: string; // '18-24', '65+', or the raw bucket Instagram sent
  female: number;
  male: number;
  unknown: number;
  total: number;
  share: number;
}
export interface GlobePoint {
  code: string;
  lat: number;
  lon: number;
  share: number;
}
export interface AudienceModel {
  ages: { day: string; total: number; rows: AgeRow[] } | null;
  countries: Ranked | null;
  cities: Ranked | null;
  globe: GlobePoint[]; // every country with a known centroid (not just the top N)
  reason: MissingReason | null; // needs_100_followers when Instagram shared nothing at all
}

function rank(day: string, counts: Map<string, number>, top: number): Ranked | null {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const sorted = [...counts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const rest = sorted.slice(top).reduce((a, [, v]) => a + v, 0);
  return {
    day,
    total,
    rows: sorted.slice(0, top).map(([key, value]) => ({ key, value, share: value / total })),
    other: rest > 0 ? { value: rest, share: rest / total } : null,
  };
}

function tally(data: Record<string, number>, keyOf: (k: string) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(data)) {
    const key = keyOf(k);
    if (key && Number.isFinite(v) && v > 0) m.set(key, (m.get(key) ?? 0) + v);
  }
  return m;
}

const ageStart = (age: string) => {
  const n = Number.parseInt(age, 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
};

function ages(snap: AudienceSnapshots['age_gender']): AudienceModel['ages'] {
  if (!snap) return null;
  const by = new Map<string, AgeRow>();
  for (const [k, v] of Object.entries(snap.data)) {
    if (!Number.isFinite(v) || v <= 0) continue;
    const [age = '', g = ''] = k.split('|').map((s) => s.trim());
    if (!age) continue;
    const row = by.get(age) ?? { age, female: 0, male: 0, unknown: 0, total: 0, share: 0 };
    const gender = g.toUpperCase();
    if (gender === 'F') row.female += v;
    else if (gender === 'M') row.male += v;
    else row.unknown += v;
    row.total += v;
    by.set(age, row);
  }
  const total = [...by.values()].reduce((a, r) => a + r.total, 0);
  if (total <= 0) return null;
  const rows = [...by.values()].sort((a, b) => ageStart(a.age) - ageStart(b.age) || a.age.localeCompare(b.age)).map((r) => ({ ...r, share: r.total / total }));
  return { day: snap.day, total, rows };
}

export function buildAudience(s: AudienceSnapshots): AudienceModel {
  const countryCounts = s.country ? tally(s.country.data, (k) => k.trim().toUpperCase()) : new Map<string, number>();
  const countries = s.country ? rank(s.country.day, countryCounts, TOP_N) : null;
  const cities = s.city ? rank(s.city.day, tally(s.city.data, (k) => k.trim()), TOP_N) : null;
  const a = ages(s.age_gender);
  const total = countries?.total ?? 0;
  const globe = [...countryCounts.entries()].flatMap(([code, value]) => {
    const c = CENTROIDS[code];
    return c && total > 0 ? [{ code, lat: c[0], lon: c[1], share: value / total }] : [];
  });
  return { ages: a, countries, cities, globe, reason: !a && !countries && !cities ? 'needs_100_followers' : null };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard-audience.test.ts tests/format.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/audience.ts lib/geo/centroids.ts lib/format.ts tests/dashboard-audience.test.ts
git commit -m "feat: audience model with ranked countries, cities, age split and globe points" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Calendar model (`lib/dashboard/calendar.ts`)

**Files:**
- Create: `lib/dashboard/calendar.ts`
- Modify: `lib/format.ts` (append `formatMonth`)
- Test: `tests/dashboard-calendar.test.ts`

**Interfaces:**
- Consumes: `MonthMedia` (Task 3), `snippet` (Task 6), `addDays`, `dayStart`, `localDay` (`lib/sync/time.ts`, DST-safe), `WeekStart`.
- Produces: `interface CalendarItem { id; accountId; mediaType; postedAt; permalink; caption }`, `interface CalendarDay { day; inMonth; isToday; posts; stories; items }`, `interface MonthModel { month; prev; next; weeks: CalendarDay[][] }`, `parseMonth(v: unknown, today: string): string`, `monthRange(month, weekStart, tz): { days: string[]; fromIso: string; toIso: string }`, `buildMonth(month, media, { weekStart, tz, today }): MonthModel`; `formatMonth(month: string, p: Pick<FormatPrefs, 'locale'>): string`.

- [ ] **Step 1: Write the failing test** — `tests/dashboard-calendar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildMonth, monthRange, parseMonth } from '@/lib/dashboard/calendar';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import { formatMonth } from '@/lib/format';

const media = (id: string, postedAt: string, mediaType: MonthMedia['mediaType'] = 'IMAGE'): MonthMedia => ({ id, accountId: 'a1', mediaType, postedAt, permalink: null, caption: null });

describe('parseMonth', () => {
  it('parseMonth rejects junk and falls back to the current month', () => {
    expect(parseMonth('2026-02', '2026-10-15')).toBe('2026-02');
    for (const bad of [undefined, '2026-13', '2026-00', '2026-1', '26-10', ['2026-02'], '2026-02-01', '<x>']) expect(parseMonth(bad, '2026-10-15')).toBe('2026-10');
  });
});

describe('monthRange', () => {
  it('whole weeks from the user week start; Monday vs Sunday', () => {
    const mon = monthRange('2026-10', 'mon', 'UTC'); // 1 Oct 2026 is a Thursday
    expect(mon.days[0]).toBe('2026-09-28');
    expect(mon.days).toHaveLength(35);
    expect(mon.days[34]).toBe('2026-11-01');
    const sun = monthRange('2026-10', 'sun', 'UTC');
    expect(sun.days[0]).toBe('2026-09-27');
    expect(sun.days.length % 7).toBe(0);
    expect(sun.days.at(-1)).toBe('2026-10-31');
  });

  it('bounds are owner-timezone midnights (Kuala Lumpur is UTC+8)', () => {
    const r = monthRange('2026-10', 'mon', 'Asia/Kuala_Lumpur');
    expect(r.fromIso).toBe('2026-09-27T16:00:00.000Z');
    expect(r.toIso).toBe('2026-11-01T16:00:00.000Z');
  });

  it('DST month in New York: the start is EDT midnight, the end is EST midnight', () => {
    const r = monthRange('2026-11', 'sun', 'America/New_York'); // DST ends Sun 1 Nov 2026
    expect(r.days[0]).toBe('2026-11-01');
    expect(r.fromIso).toBe('2026-11-01T04:00:00.000Z');
    expect(r.toIso).toBe('2026-12-06T05:00:00.000Z');
  });
});

describe('buildMonth', () => {
  it('posts bin by owner-timezone day across the month edge; stories counted apart', () => {
    const m = buildMonth('2026-10', [media('a', '2026-09-30T16:30:00Z'), media('s', '2026-10-01T02:00:00Z', 'STORY'), media('b', '2026-10-31T15:59:00Z'), media('c', '2026-10-31T16:00:00Z')], { weekStart: 'mon', tz: 'Asia/Kuala_Lumpur', today: '2026-10-15' });
    const cell = (d: string) => m.weeks.flat().find((c) => c.day === d)!;
    expect(cell('2026-10-01')).toMatchObject({ posts: 1, stories: 1, inMonth: true });
    expect(cell('2026-10-01').items.map((i) => i.id)).toEqual(['a', 's']);
    expect(cell('2026-09-30').posts).toBe(0);
    expect(cell('2026-10-31').posts).toBe(1);
    expect(cell('2026-11-01')).toMatchObject({ posts: 1, inMonth: false });
    expect(cell('2026-10-15').isToday).toBe(true);
    expect(m.prev).toBe('2026-09');
    expect(m.next).toBe('2026-11');
    expect(m.weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('DST fall-back in New York: 23:30 local on 1 Nov (EST, 04:30Z next day) stays on 1 Nov', () => {
    const m = buildMonth('2026-11', [media('early', '2026-11-01T04:30:00Z'), media('late', '2026-11-02T04:30:00Z')], { weekStart: 'sun', tz: 'America/New_York', today: '2026-11-15' });
    expect(m.weeks[0][0]).toMatchObject({ day: '2026-11-01', posts: 2 });
  });

  it('year rollover and an empty month', () => {
    const m = buildMonth('2026-12', [], { weekStart: 'mon', tz: 'UTC', today: '2026-10-15' });
    expect(m.next).toBe('2027-01');
    expect(m.weeks.flat().every((c) => c.posts === 0 && c.stories === 0 && !c.isToday)).toBe(true);
    expect(buildMonth('2026-01', [], { weekStart: 'mon', tz: 'UTC', today: '2026-10-15' }).prev).toBe('2025-12');
  });
});

describe('formatMonth', () => {
  it('formats a month in both languages; junk becomes a dash', () => {
    expect(formatMonth('2026-10', { locale: 'en' })).toBe('October 2026');
    expect(formatMonth('2026-10', { locale: 'zh-CN' })).toBe('2026年10月');
    expect(formatMonth('2026-13', { locale: 'en' })).toBe('—');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dashboard-calendar.test.ts`
Expected: FAIL with `Failed to resolve import "@/lib/dashboard/calendar"`.

- [ ] **Step 3: Add `formatMonth`** — append to the end of `lib/format.ts`:

```ts
const MONTHS_EN_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A calendar month 'YYYY-MM' (already in the owner's timezone): "October 2026" / "2026年10月". */
export function formatMonth(month: string, p: Pick<FormatPrefs, 'locale'>): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const i = m ? Number(m[2]) - 1 : -1;
  if (!m || i < 0 || i > 11) return DASH;
  return p.locale === 'zh-CN' ? `${m[1]}年${i + 1}月` : `${MONTHS_EN_FULL[i]} ${m[1]}`;
}
```

- [ ] **Step 4: Implement** — `lib/dashboard/calendar.ts`:

```ts
// Calendar model: a month grid of published posts and Stories, binned by the OWNER-timezone day (SPEC §7 "Daily
// boundaries ... displayed in the user's timezone"). Pure: today and tz are inputs.
import { snippet } from '@/lib/dashboard/content';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, dayStart, localDay } from '@/lib/sync/time';

export interface CalendarItem {
  id: string;
  accountId: string;
  mediaType: MonthMedia['mediaType'];
  postedAt: string;
  permalink: string | null;
  caption: string | null; // snippet
}
export interface CalendarDay {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  posts: number; // feed posts + reels
  stories: number;
  items: CalendarItem[]; // oldest first
}
export interface MonthModel {
  month: string; // 'YYYY-MM'
  prev: string;
  next: string;
  weeks: CalendarDay[][]; // whole weeks starting on the user's week start
}

/** ?month=YYYY-MM; anything else (2026-13, arrays, junk) falls back to the month of `today`. */
export function parseMonth(v: unknown, today: string): string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : today.slice(0, 7);
}

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** The grid's days (whole weeks) and the [fromIso, toIso) instants that bound them in the owner's timezone. */
export function monthRange(month: string, weekStart: WeekStart, tz: string): { days: string[]; fromIso: string; toIso: string } {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() - (weekStart === 'sun' ? 0 : 1) + 7) % 7;
  const start = addDays(first, -offset);
  const span = Math.ceil((offset + Number(last.slice(8))) / 7) * 7;
  const days = Array.from({ length: span }, (_, i) => addDays(start, i));
  return { days, fromIso: dayStart(days[0], tz).toISOString(), toIso: dayStart(addDays(days[days.length - 1], 1), tz).toISOString() };
}

export function buildMonth(month: string, media: MonthMedia[], o: { weekStart: WeekStart; tz: string; today: string }): MonthModel {
  const { days } = monthRange(month, o.weekStart, o.tz);
  const byDay = new Map<string, CalendarItem[]>();
  const sorted = [...media].sort((a, b) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt < b.postedAt ? -1 : 1));
  for (const m of sorted) {
    const at = new Date(m.postedAt);
    if (Number.isNaN(at.getTime())) continue;
    const day = localDay(at, o.tz);
    byDay.set(day, [...(byDay.get(day) ?? []), { id: m.id, accountId: m.accountId, mediaType: m.mediaType, postedAt: m.postedAt, permalink: m.permalink, caption: snippet(m.caption) }]);
  }
  const cells = days.map((day) => {
    const items = byDay.get(day) ?? [];
    const stories = items.filter((i) => i.mediaType === 'STORY').length;
    return { day, inMonth: day.startsWith(month), isToday: day === o.today, posts: items.length - stories, stories, items };
  });
  return { month, prev: shiftMonth(month, -1), next: shiftMonth(month, 1), weeks: Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7)) };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/dashboard-calendar.test.ts tests/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/calendar.ts lib/format.ts tests/dashboard-calendar.test.ts
git commit -m "feat: calendar month model in the owner timezone" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
