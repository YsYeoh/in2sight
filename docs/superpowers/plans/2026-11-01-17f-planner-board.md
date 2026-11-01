# Plan 17f: Planner board (no publishing to Instagram) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** A **Board** section on the Plan page (`/plan/board`, Plan 17d's page) with a board of the owner's post ideas in four columns, **Ideas → Drafting → Ready → Posted**. A card holds a title, plain-text notes, its account, an optional format, an optional planned day and hour (owner timezone) and up to 10 tags; once posted it can be linked to the real post (Post Lab link). Cards move by drag and drop OR by arrow buttons (keyboard and touch). "Suggest a time" proposes up to 3 slots of the next 7 days from the account's post-performance heatmap. **Nothing is ever published, scheduled or sent to Instagram; no reminders.**

**Architecture:** ONE owner-authored table `planner_items` (migration `supabase/migrations/20261105000001_planner_items.sql`, NEVER applied by an implementer; `is_owner()` RLS, cascade from `accounts`, `media_id` set null). Pure rules in `lib/planner/items.ts` (validation `parseItemInput`, `stepStatus`, `boardColumns`, `linkCandidates`, `suggestSlots` on top of `postHeatmap`); row mapping + the read in `lib/planner/read.ts`; four owner-session server actions in `app/(app)/plan/planner-actions.ts` (save, move, delete, suggest). UI: `components/plan/PlannerBoard.tsx` (columns, cards, native HTML drag events + arrow buttons, account filter in a `FilterToolbar`) and `components/plan/PlannerItemDialog.tsx` (the card form in a `ResponsiveDialog`, tags, suggestions, link list, delete confirm). The server component `app/(app)/plan/planner-section.tsx` does the reads and renders the board; it is mounted as the **`board` section of Plan 17d's page** (`/plan/board`, Case B, the expected case) or, if 17d is not built, as the whole `/plan` page with its own nav item (Case A). Export: `planner_items` joins `EXPORT_TABLES`. Without the migration `/plan` says "The planner needs a database update".

**Tech Stack:** Next.js 16.4 App Router (server components, server actions), React 19 (`useTransition`), TypeScript strict, `@supabase/supabase-js` (installed), next-intl 4, shadcn `Button` / `Input` / `Textarea` / `Checkbox`, lucide icons (installed), Vitest + Testing Library + jsdom. **New dependencies: none** (drag and drop = native HTML5 drag events).

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Publishing: planner board only — no publishing or scheduling to Instagram") and §6 ("Planner board"); roadmap `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §1.1 (row "Planner board"), §3 "17f", §4 (recommended defaults APPROVED by the owner as working assumptions), §5 ("keep it to one table and one page"). **`docs/SPEC.md` has no planner board (§1 only says "Out of scope: posting/scheduling"): Task 8 adds §7p; ⚠ the owner must nod at the plan review before Wave 1 starts (CLAUDE.md "do not build ahead of approval").** All roadmap rules "that apply to EVERY plan" (§3) apply here and are not repeated.

**Order and collisions with 17a–17e (execute 17a → 17b → 17c → 17d → 17e → 17f).** 17f imports NO code of 17a–17e and was dry-run on `main` at `81054d7` without them. Shared files and what to expect when the earlier plans have landed:
- `messages/en.json`, `messages/zh-CN.json`: every insertion below is anchored on a text line (not a line number), so it applies after 17a–17e by plain text insertion.
- `lib/data/export.ts` / `tests/settings-data.test.tsx`: 17b (+1 table), 17c (+2), 17d (likely +1 `goals`) change the same three counts; Task 4 says "increase each of the three numbers by exactly 1 from what the file says".
- **`/plan` belongs to Plan 17d** (`2026-11-01-17d-goals-digest.md`): the side-nav item **Plan** between Explorer and Settings, `lib/plan/sections.ts` `PLAN_SECTIONS = ['digest', 'goals']` ("Plan 17f adds 'board'"), the route `app/(app)/plan/[[...section]]/page.tsx` + `layout.tsx` (header + `PlanNav` underline tabs) + `[[...section]]/loading.tsx`, the i18n top-level `plan` (`plan.sections.<id>.title|description`), `app/(app)/plan/actions.ts`. Plan 17e's `WEEKLY_REVIEW_HREF` becomes `/plan/digest` when that route exists, and its test `tests/alert-message-smart.test.ts` asserts "`app/(app)/plan` exists ⇒ the href starts with `/plan`". The orchestrator decides the case BEFORE Wave 1 with `ls "app/(app)/plan/[[...section]]/page.tsx"` and `grep -n "PLAN_SECTIONS =" lib/plan/sections.ts`:
  - **Case B — 17d built (expected; roadmap order 17d before 17f):** Task 1 adds `plan.sections.board` (not `nav.plan`); **Task 6B** adds `'board'` to `PLAN_SECTIONS` and updates 17d's two tests that pin the list; **Task 7B** creates `planner-section.tsx` and adds one branch + one import to 17d's page. No nav, service-worker, shell or loading change (17d's `[[...section]]/loading.tsx` covers the section).
  - **Case A — 17d not built:** Task 1 adds `nav.plan` (not `plan.sections.board`); **Task 6A** adds the Plan nav item exactly where 17d would (between Explorer and Settings); **Task 7A** creates `planner-section.tsx`, `app/(app)/plan/page.tsx` (header + the board, `basePath` `/plan`) and `loading.tsx`, and if 17e landed narrows its guard to 17d's own route (the weekly review must keep opening `/overview` while there is no digest). If 17d is built LATER, its implementer must turn `app/(app)/plan/page.tsx` into the `board` section (Case B) and take the nav item over.
- File names chosen to avoid collisions with 17d: the actions file is `app/(app)/plan/planner-actions.ts` (17d owns `actions.ts`), the board components `components/plan/Planner*.tsx` (17d owns `PlanNav`, `GoalLine`, `DigestView`, `GoalsView`), lib code in `lib/planner/` (17d owns `lib/plan/`), i18n top-level `planner` (17d owns `plan`), tests `tests/planner-*` (17d owns `tests/plan-*`).
- Names reserved by 17f: migration `20261105000001_planner_items.sql` (after 17e's `20261104000001`), i18n top-level `planner`, `plan.sections.board` (inside 17d's `plan` block) or, in Case A only, `nav.plan`, `settings.data.tables.planner_items`, SPEC §7p (17a §7l, 17b §7m, 17c §7n, 17d presumably §7o; 17e adds none, it edits §7c in place; rule: the next free letter after the highest existing §7x, say which), TODO §6w (17a §6r, 17b §6s, 17c §6t, 17d presumably §6u, 17e §6v; same rule), `docs/RUNBOOK_PLANNER.md`, route `/plan/board` (Case A: `/plan`).

**Scratch run:** every code block of Tasks 1–7 was written into a throwaway `git clone` of `main` at `81054d7` in the session scratchpad (own `npm ci`; the real `node_modules` untouched) and the migration was executed on PGlite 0.3.15 on top of all 16 existing migrations (and again on top of 17b's and 17c's migrations taken from their plans). Results: "Scratch-run result" at the end.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

1. **⚠ SPEC gets §7p "Planner board" (Task 8)** and §8's page list gains "Plan". Owner nod required at plan review (Wave 0).
2. **Assumed from roadmap §4 (approved working assumptions):** Q1 (a) = board only: **no reminders, no push, no .ics, no Calendar entries**; Q8 = one side-nav item **Plan** (`/plan`) shared with 17d's digest and goals; no publishing, no scheduling, no call to the Instagram API, no uploads, no collaborators.
3. **⚠ Columns = the owner's brief: `idea`, `drafting`, `ready`, `posted`** ("Ideas, Drafting, Ready, Posted"), not the roadmap's "Scheduled / Published": a planned day is optional on EVERY card, so "ready" means "ready to post", not "has a slot".
4. **⚠ A card belongs to exactly one account** (`account_id NOT NULL`, cascade). The board is global (all live accounts) with an account filter (`?account=`, like the Calendar); with one account the filter and the handles on the cards are hidden. Cards of archived accounts are hidden (SPEC §7c).
5. **⚠ Fields and limits:** title 1–120 code points (NFC, spaces collapsed, `normalizeTagName`), notes ≤ 2,000 code points plain text (newlines kept, control and bidi-override characters refused), format optional (`REELS` / `CAROUSEL_ALBUM` / `IMAGE` / `STORY`), planned **day (`date`) + optional hour (`smallint` 0–23) in the owner timezone** (wall clock, no `timestamptz`: no conversion, DST-proof; changing the timezone setting keeps the wall-clock values), up to 10 tags as `tag_ids uuid[]` (no join table; a deleted tag's id is ignored on read and dropped on the next save), at most **500 cards** (checked by the save action; the read is capped).
6. **⚠ No manual order inside a column** (no `position` column): planned cards soonest first (a day without an hour after that day's hours), the Posted column latest first, then unplanned cards newest first. Add `position` only if the owner asks.
7. **⚠ Moves:** each card has ← / → buttons (the keyboard and touch path, labelled "Move <title> to <column>"; none at the edges) and is `draggable` (native HTML5 drag events, desktop mouse/pen); one owner-session server action per move; the result is announced (`role="status"`, errors `role="alert"`) and focus returns to the moved card. On phones the four columns stack (CSS only; no column select).
8. **⚠ Linking a post (the roadmap's "auto-link", owner-confirmed):** the dialog of a Ready or Posted card lists up to 5 posts of that account from the last 30 days (Stories only for a Story card, never otherwise), not linked to another card, the planned format first, then the nearest to the planned wall-clock time (a day without an hour counts from 12:00); within ±3 h and the same (or no) format = "Matches the planned time". **Nothing links by itself and the sync never writes.** Picking a post moves the card to Posted; leaving Posted drops the link (DB check `media_id is null or status = 'posted'`). A card older than 30 days keeps its link (shown as "Open the post"). **No Post Lab verdict on the card** (it would need peers and `post_lab_latest` per card: the link opens Post Lab, which shows it).
9. **⚠ Suggest a time = on demand** (a server action, not on page load): the account's "your post performance" heatmap (`postHeatmap`, SPEC §7: engagement rate by owner-timezone weekday × hour over all stored feed posts, cells with ≥ 2 posts, nothing below 30 posts), up to 3 slots in the next 7 days, one per day, skipping days that already hold a planned card of that account; it says its basis and `n` and "Pattern, not proof." (UI standard 14). The followers-online heatmap is not used (its hour base is UNCERTAIN, `lib/instagram/metrics.ts`).
10. **⚠ Export / delete / storage, consistent with Plans 17b and 17c:** `planner_items` joins `EXPORT_TABLES` (owner data, not third-party); `delete_all_data()` needs **no change** (every card hangs off an account; PGlite verified that the unchanged 16c function empties the table); `data_usage()` is **not replaced** (it lists tables literally; the new table counts in the database total). Recorded for the plan that next replaces `data_usage()`: add `insight_dismissals`, `tag_rules`, `media_tag_rejections`, 17d's `goals` and `planner_items` to its array (names of absent tables are harmless there).
11. **Where:** the third underline tab **Board** of Plan 17d's page (`/plan/board`, after Digest and Goals; `/plan` keeps redirecting to the digest). Case A only: the nav item exactly as 17d defines it (between Explorer and Settings, icon `ClipboardList`, phone bar `grid-cols-7`, service-worker tab pages); not a Time Scope page.
12. **Privacy and safety:** owner-authored text only, rendered as React text (`whitespace-pre-wrap`, `break-words`), never in a URL; no third-party data; owner session only (never `createAdminSupabase`); no logging; error keys only.
13. **Out (later, if asked):** reminders (roadmap Q1 b, a 1-day add on 17e), Calendar dashed entries (roadmap: optional), manual order, a column select on phones, image uploads, cross-account cards, a verdict on the card, Story-day planning beyond a STORY format.

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_PLANNER.md`)

1. **⚠ Column names** Ideas / Drafting / Ready / Posted (Decision 3). Alternative: the roadmap's Ideas / Drafting / Scheduled / Published.
2. **⚠ Every card has an account** (Decision 4). Alternative: account optional ("any account" ideas); then `delete_all_data()` must be replaced in this migration to also delete account-less cards (16c function + one `delete from public.planner_items where true;`).
3. **Reminders** (roadmap Q1): default none.
4. **L1 — 360 px:** the board (columns stacked), the dialog as a bottom sheet, the Digest / Goals / Board tab strip (Case A: the 7-item phone bar, which 17d also introduces).
5. **L2 — drag and drop inside the app-shell tab iframe** (Plan 14c) in Chrome, Edge, Firefox and Safari desktop; the arrow buttons are the fallback everywhere.
6. **L3 — Suggest a time** names the same best cells as the account Overview's "your post performance" heatmap.
7. **L4 — a real post links:** plan a card for a time, post on Instagram, after the next sync the card's dialog shows it as "Matches the planned time"; linking opens the right Post Lab page.
8. **L5 — PostgREST writes `tag_ids`** (a JSON array of uuids into `uuid[]`) and a `date` + `smallint` from supabase-js exactly as the fakes assume.

## Owner prerequisites

1. **Apply `supabase/migrations/20261105000001_planner_items.sql`** on the owner's explicit go-ahead, BEFORE deploying (PROGRESS §9 commands; RUNBOOK_PLANNER §0). Until then `/plan` shows "The planner needs a database update" and every action answers `needs_update`.
2. Nothing else (no secret, no Meta or Supabase setting, no external resource).

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- Plan 17d (its plan file; not built at `81054d7`): `lib/plan/sections.ts` has the line `export const PLAN_SECTIONS = ['digest', 'goals'] as const;`; its page `app/(app)/plan/[[...section]]/page.tsx` has the consecutive lines `  if ('redirect' in route) redirect(route.redirect);` and `  const prefs = await getPrefs();` and the import line `import { saveGoalsAction } from '@/app/(app)/plan/actions';`; `tests/plan-model.test.ts` pins `    expect(PLAN_SECTIONS).toEqual(['digest', 'goals']);` and lists `['board']` among the 404 paths (`    for (const s of [['Goals'], ['board'], ['goals', 'x'], ['constructor']]) expect(routePlan(s)).toBeNull();`); `tests/plan-views.test.tsx` pins the tab names (`.toEqual(['Digest', 'Goals']);`); `PlanNav` renders one tab per `PLAN_SECTIONS` id titled `plan.sections.<id>.title`; the messages line `      "goals": { "title": "Goals", "description": "Targets per account and how you are doing now." }` (zh `      "goals": { "title": "目标", "description": "每个账号的目标以及目前的进度。" }`) closes `plan.sections`.
- (Case A) `lib/nav.ts:1` imports the lucide icons; `:4-5` the `href` / `key` unions; `:10-17` `NAV_ITEMS` (Overview, Accounts, Tags, Calendar, Explorer, Settings); `:20` `SCOPED` (no `/plan`). Consumers: `components/shared/AppShell.tsx:57` (sidebar) and `:92-93` (phone bar `grid grid-cols-6`), `lib/tabs/model.ts:49-50` (`isTabPath`, comment "six main sections"), `public/sw.js:81` `TAB_PAGE` (must list the NAV_ITEMS hrefs in order: `tests/service-worker.test.ts:197-201`). Tests pinning the list: `tests/nav.test.ts:5-7`, `:15`; `tests/tabs-model.test.ts:11-12`; `tests/app-shell.test.tsx:147` (`grid-cols-6`).
- `lib/auth/route-policy.ts`: a signed-in owner reaches every non-entry path (`decideRoute` returns `next`); `/plan` needs no entry there (and must NOT be added to the signed-out sets).
- `tests/route-loading.test.tsx`: every `app/**/page.tsx` needs a sibling `loading.tsx` rendering exactly one status orb (`RouteLoading`).
- `lib/tags.ts:13` `isUuid`, `:14` `isMediaId`, `:22` `normalizeTagName(raw, max)` (NFC, control/bidi refused, spaces collapsed, 1–max code points); `lib/time-scope/range.ts:24` `isDay`, `:29` `daysBetween`; `lib/sync/time.ts` `localDay`, `localHour`, `addDays`, `daysToIso`.
- `lib/analysis/best-time.ts:11` `RELIABLE_POSTS = 30`, `:25` `weekdayOf`, `:41` `postHeatmap(posts, tz, weekStart)` → `{ rows: { weekday, cells: { value, count, lowSample }[] }[], sample, reason }`.
- `lib/dashboard/detail-read.ts:65` `MonthMedia` (`id, accountId, mediaType, postedAt, permalink, caption, cover, slides`), `:75` `loadPostRows(db, accountId)` (feed posts with the latest metrics), `:254` `loadTags(db)`, `:262` `loadMonthMedia(db, accountIds, fromIso, toIso)` (posts AND Stories, capped 5,000).
- `lib/post-lab/params.ts:24` `postLabHref(accountId, mediaId)`; `lib/format.ts` `formatDay`, `formatHour`, `formatDateTime:71`, `formatPercent:141`; `components/providers/PrefsProvider.tsx` `usePrefs()`.
- `components/shared/FilterToolbar.tsx:51` `FilterToolbar({ label, children, end })`, `:184` `FilterSelect({ id, label, value, options, hrefFor })` (navigates with `router.push(href, { scroll: false })`); `ResponsiveDialog*`, `FormField` (render prop), `ConfirmDialog:70` (`open, title, body, confirmLabel, cancelLabel, busy, error, onConfirm, onClose`), `MediaThumb:35`, `TagBadge`, `EmptyState`, `PageHeader`, `LoadingButton`, `Skeletons` (`RouteLoading`, `SkeletonHeader`, `SkeletonGrid`).
- `app/(app)/tags/actions.ts` is the server-action pattern (`requireOwner()` outside `try`, validate, owner session, error keys, `revalidatePath`); `tests/tag-actions.test.ts` the fake-client test pattern; `app/(app)/calendar/page.tsx` the page pattern (`getPrefs`, `loadAccounts`, `?account=` validated with `isUuid`).
- `supabase/migrations/20261031000001_data_privacy.sql:73` `delete_all_data()` starts with `delete from public.accounts where true;` (cascades); `data_usage()` lists tables literally. `lib/data/export.ts:32` `{ name: 'explorer_views', keys: ['id'] },`; `tests/data-export.test.ts` checks each entry's key against `create table public.<name> (` … `\n);` and scans its column names; `tests/settings-data.test.tsx:84`, `:87`, `:92` count 18 / "18 files downloaded." / 20 (at `81054d7`); `components/settings/DataExport.tsx` labels each table with `settings.data.tables.<name>`.
- `tests/migrations.test.ts`: RLS + a policy on every table, policies `to authenticated`, never anon/public, `(select …)` form.
- `messages/*.json`: `nav` at lines 33–42 (`    "calendar": …,` then `    "explorer": …,`), `settings.data.tables.explorer_views` at line 427, top-level `  "notifications": {` at line 1265; `analysis.format.*`, `analysis.reasons.not_enough_posts` exist. The files are LF with one stray CR: edit by text insertion only.

## Out of scope

Publishing or scheduling on Instagram (spec §0b), reminders / push / .ics (Q1), Calendar entries, uploads, collaborators, manual order, a verdict on the card, `data_usage()` / `delete_all_data()` replacement, any sync or Meta change, Server-Timing.

## Global Constraints

- Ponytail: one table, two lib files, one actions file, two components, one page. **No new dependency.**
- TypeScript strict; tests with fakes only; lib / action tests `// @vitest-environment node`.
- Owner session only (`createServerSupabase`); never `createAdminSupabase`, never `lib/instagram/*`, no `console.*` in any 17f file.
- Every UI string in `messages/en.json` AND `messages/zh-CN.json` (Task 1 adds all of them, text insertion only). Dates / numbers only via `lib/format.ts`. Tokens only. 360 / 768 / 1280 px. UI standards: 1 (the toolbar holds one filter + one button), 5 (toolbar row: default sizes; `size="sm"` only inside the card list and the slot list), 10 (dialogs are `ResponsiveDialog`), 14 (suggestions state basis + n), 16 (owner text as text).
- Migration file NEVER applied by an implementer. `npm run check` passes after every wave. Commits: conventional, `git add` only the listed paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus (opus read-only review after the last wave)

1. **No Instagram, no admin, no logs:** `grep -rn "createAdminSupabase\|lib/instagram\|console\." lib/planner components/plan "app/(app)/plan"` is empty; nothing publishes or schedules.
2. **Trust boundary:** `requireOwner()` first in all four actions; `parseItemInput` on every save (title / notes caps in code points, status and format allow-lists, day real, hour 0–23 only with a day, ≤ 10 uuid tags, media id shape, media only when posted); a linked post re-read with `id` AND `account_id`; ids lower-cased uuids; the DB checks mirror the code (`tests/planner-migration.test.ts`).
3. **Owner text is text:** titles and notes rendered as React text, never `dangerouslySetInnerHTML`, never in an href; aria-labels may contain the title.
4. **Usable without drag:** arrow buttons with names, none at the edges, focus back on the moved card, `role="status"` / `role="alert"`, the dialog closes on Escape and returns focus.
5. **Reads:** the page = accounts + items + tags + 30 days of media, in parallel (no N+1); suggestions only on click; candidates computed in the browser from that one read; captions cut to 80 code points before they reach the browser.
6. **Without the migration:** the page says "needs a database update", every action returns `needs_update`, nothing throws.
7. **Data:** `planner_items` in `EXPORT_TABLES` (`keys: ['id']`), counts +1; `delete_all_data()` unchanged and verified; account cascade + `media_id` set null + both FKs indexed.
8. **UI:** FilterToolbar for the filter, one control height in the toolbar row, tokens only, light/dark of all 4 themes, 360 / 768 / 1280; Case B: the Board tab sits in 17d's tab strip and `/plan` still redirects to the digest.
9. **Ponytail:** nothing beyond the file list; no position column, no reminder hooks, no generic board abstraction.

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | `nav.plan`, top-level `planner`, `settings.data.tables.planner_items` |
| `supabase/migrations/20261105000001_planner_items.sql` (new), `tests/planner-migration.test.ts` (new) | 2 | the table, two indexes, RLS, policy, revoke |
| `lib/planner/items.ts` (new), `tests/planner-items.test.ts` (new) | 3 | constants, types, validation, columns, moves, link candidates, slot suggestions (pure) |
| `lib/planner/read.ts` (new), `app/(app)/plan/planner-actions.ts` (new), `tests/planner-actions.test.ts` (new), `lib/data/export.ts`, `tests/settings-data.test.tsx` | 4 | row mapping and the read; save / move / delete / suggest actions; the export entry |
| `components/plan/PlannerItemDialog.tsx` (new), `components/plan/PlannerBoard.tsx` (new), `tests/planner-board.test.tsx` (new) | 5 | the board and the card dialog |
| 6B: `lib/plan/sections.ts`, `tests/plan-model.test.ts`, `tests/plan-views.test.tsx` — 6A: `lib/nav.ts`, `public/sw.js`, `components/shared/AppShell.tsx`, `lib/tabs/model.ts`, `tests/nav.test.ts`, `tests/tabs-model.test.ts`, `tests/app-shell.test.tsx` | 6 | B: the Board section id; A: the Plan nav item |
| `app/(app)/plan/planner-section.tsx` (new); 7B: `app/(app)/plan/[[...section]]/page.tsx` — 7A: `app/(app)/plan/page.tsx` (new), `app/(app)/plan/loading.tsx` (new), `tests/alert-message-smart.test.ts` (only if 17e landed) | 7 | the reads + wiring, mounted as 17d's section (B) or as the page (A) |
| `docs/SPEC.md`, `docs/RUNBOOK_PLANNER.md` (new), `docs/TODO.md`, `docs/PROGRESS.md` | 8 | spec section, runbook, progress |

**Adding i18n keys:** by TEXT INSERTION only (the Edit tool with the exact anchors below), never by re-serialising the JSON.

**Editing existing files:** every change to an existing file is given as an exact OLD text → NEW text pair: use the Edit tool (old_string = OLD, new_string = NEW). The working copies are CRLF (`core.autocrlf=true`) except the messages JSON (LF): the Edit tool matches line content either way. If an OLD text is not found (an earlier plan changed the line), make the equivalent edit by hand ONLY when the intent is unambiguous and report it (implementer rules §3). New files: write them with the Write tool exactly as given (they contain non-ASCII text and regexes).

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261105000001_planner_items.sql`, `tests/planner-migration.test.ts` | 1, 3 |
| 3 pure rules | — | `lib/planner/items.ts`, `tests/planner-items.test.ts` | 1, 2 |
| 4 read + actions + export | 1, 2, 3 | `lib/planner/read.ts`, `app/(app)/plan/planner-actions.ts`, `tests/planner-actions.test.ts`, `lib/data/export.ts`, `tests/settings-data.test.tsx` | 5, 8 |
| 5 board UI | 1, 3 | `components/plan/PlannerItemDialog.tsx`, `components/plan/PlannerBoard.tsx`, `tests/planner-board.test.tsx` | 4, 8 |
| 8 docs | 2 | `docs/SPEC.md`, `docs/RUNBOOK_PLANNER.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 4, 5 |
| 6 section id (6B) or nav item (6A) | 1 | see File Structure | 7 |
| 7 mount (7B or 7A) | 4, 5 | see File Structure | 6 |

**Waves (at most 3 sonnet worktree agents; check free disk first, `Get-PSDrive C`):** **0** = the owner's nod on Decision 1 (SPEC §7p) and Open questions 1–2 at plan review, and the orchestrator decides Case A / Case B. **1** = Tasks 1, 2, 3 → **2** = Tasks 4, 5, 8 → **3** = Case B: ONE agent runs Task 6B then Task 7B (two commits; 7B's `route.section === 'board'` does not type-check before 6B adds the id); Case A: Tasks 6A and 7A as two parallel agents (disjoint files). After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log 2>&1` and READ the log (search it for `×` and "failed"). Every wave leaves `main` green: wave 1 adds unused keys, an unapplied migration and an unused module; wave 2 adds actions, components and docs no page uses yet (and the export entry, which is harmless before the migration: the export answers that table with an error key like any missing table); wave 3 adds the Board tab (or the nav item) and the mount together. Then the opus review (Review Focus), ONE fix wave, check, commit.

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

Three text insertions per file. Insertion (a) depends on the case: **Case B** (17d built) adds the Board section title; **Case A** adds `nav.plan`.

- [ ] **Step 1 — en (a).** **Case B:** OLD

```
      "goals": { "title": "Goals", "description": "Targets per account and how you are doing now." }
```

NEW

```
      "goals": { "title": "Goals", "description": "Targets per account and how you are doing now." },
      "board": { "title": "Board", "description": "Your post ideas, from first idea to posted. Nothing is sent to Instagram." }
```

**Case A:** OLD

```
    "explorer": "Explorer",
    "settings": "Settings",
```

NEW

```
    "explorer": "Explorer",
    "plan": "Plan",
    "settings": "Settings",
```

- [ ] **Step 2 — en (b) export label.** OLD `        "explorer_views": "Saved Explorer views",` → NEW:

```
        "explorer_views": "Saved Explorer views",
        "planner_items": "Planner cards",
```

- [ ] **Step 3 — en (c) the `planner` block:** insert these lines immediately BEFORE the line that is exactly `  "notifications": {` (two spaces; the top-level one, line 1265 at `81054d7`; after Plan 17b it follows 17b's `insights` block):

```json
  "planner": {
    "title": "Plan",
    "subtitle": "Your post ideas and the next posts, next to your numbers. Nothing here is published or scheduled on Instagram.",
    "filters": "Board filters",
    "account": "Account",
    "allAccounts": "All accounts",
    "new": "New idea",
    "status": { "idea": "Ideas", "drafting": "Drafting", "ready": "Ready", "posted": "Posted" },
    "count": "{count, plural, one {# card} other {# cards}}",
    "emptyColumn": "Nothing here yet.",
    "emptyTitle": "No ideas yet",
    "emptyBody": "Write down a post idea and move it along as it takes shape: Ideas, Drafting, Ready, Posted.",
    "noAccounts": "Connect an Instagram account to plan posts for it.",
    "needsUpdate": "The planner needs a database update.",
    "edit": "Edit {title}",
    "moveTo": "Move {title} to {column}",
    "moved": "Moved {title} to {column}.",
    "dropHint": "Drag a card to another column, or use its arrow buttons.",
    "anyTime": "any time",
    "openPost": "Open the post",
    "dialog": {
      "newTitle": "New idea",
      "editTitle": "Edit card",
      "description": "Only you see this. Nothing is published or scheduled on Instagram.",
      "titleLabel": "Title",
      "notes": "Notes",
      "notesHint": "Plain text, up to 2,000 characters.",
      "column": "Column",
      "format": "Format",
      "noFormat": "Not decided",
      "day": "Planned day",
      "hour": "Time",
      "suggest": "Suggest a time",
      "suggestBasis": "From your post performance: engagement rate by weekday and hour, {count} posts. Pattern, not proof.",
      "suggestNone": "No free good time in the next 7 days.",
      "suggestReason": "{reason} (n = {count} posts)",
      "slot": "{day}, {hour}",
      "slotBasis": "{rate} engagement, {count} posts",
      "tags": "Tags",
      "noTags": "No tags yet.",
      "manageTags": "Manage tags",
      "link": "Published post",
      "linkHint": "Pick the post this idea became (this account, the last 30 days). Picking one moves the card to Posted.",
      "noLink": "Not linked",
      "match": "Matches the planned time",
      "noCandidates": "No posts of this account in the last 30 days.",
      "save": "Save",
      "cancel": "Cancel",
      "delete": "Delete",
      "deleteTitle": "Delete this card?",
      "deleteBody": "{title} is removed from the board. This cannot be undone.",
      "saved": "Saved.",
      "deleted": "Deleted."
    },
    "errors": {
      "invalid": "Check the fields and try again.",
      "not_found": "This card, account or post no longer exists. Reload the page.",
      "too_many": "The board holds at most 500 cards. Delete some posted ones first.",
      "needs_update": "The planner needs a database update.",
      "unexpected": "Could not save. Try again."
    }
  },
```

- [ ] **Step 4 — zh-CN, the same three insertions.** (a) **Case B:** OLD

```
      "goals": { "title": "目标", "description": "每个账号的目标以及目前的进度。" }
```

NEW

```
      "goals": { "title": "目标", "description": "每个账号的目标以及目前的进度。" },
      "board": { "title": "看板", "description": "你的帖子创意，从最初的想法到发布。不会向 Instagram 发送任何内容。" }
```

**Case A:** OLD

```
    "explorer": "探索",
    "settings": "设置",
```

NEW

```
    "explorer": "探索",
    "plan": "计划",
    "settings": "设置",
```

(b) OLD `        "explorer_views": "已保存的探索视图",` → NEW:

```
        "explorer_views": "已保存的探索视图",
        "planner_items": "计划卡片",
```

(c) immediately BEFORE the line that is exactly `  "notifications": {`:

```json
  "planner": {
    "title": "计划",
    "subtitle": "你的帖子创意和接下来要发的帖子，就在数据旁边。这里的内容不会发布到 Instagram，也不会在 Instagram 上排期。",
    "filters": "看板筛选",
    "account": "账号",
    "allAccounts": "全部账号",
    "new": "新建创意",
    "status": { "idea": "创意", "drafting": "制作中", "ready": "待发布", "posted": "已发布" },
    "count": "{count, plural, other {# 张卡片}}",
    "emptyColumn": "这里还没有内容。",
    "emptyTitle": "还没有创意",
    "emptyBody": "记下一个帖子创意，随着进展把它往后移动：创意、制作中、待发布、已发布。",
    "noAccounts": "先连接一个 Instagram 账号，才能为它计划帖子。",
    "needsUpdate": "计划看板需要先更新数据库。",
    "edit": "编辑「{title}」",
    "moveTo": "将「{title}」移到{column}",
    "moved": "已将「{title}」移到{column}。",
    "dropHint": "把卡片拖到另一列，或使用卡片上的箭头按钮。",
    "anyTime": "任意时间",
    "openPost": "打开帖子",
    "dialog": {
      "newTitle": "新建创意",
      "editTitle": "编辑卡片",
      "description": "只有你能看到。这里的内容不会发布到 Instagram，也不会在 Instagram 上排期。",
      "titleLabel": "标题",
      "notes": "备注",
      "notesHint": "纯文本，最多 2,000 个字符。",
      "column": "所在列",
      "format": "格式",
      "noFormat": "未定",
      "day": "计划日期",
      "hour": "时间",
      "suggest": "建议时间",
      "suggestBasis": "依据你的帖子表现：按星期几和小时统计的互动率，共 {count} 篇帖子。这是规律，不是证明。",
      "suggestNone": "未来 7 天内没有空闲的好时间。",
      "suggestReason": "{reason}（n = {count} 篇帖子）",
      "slot": "{day}，{hour}",
      "slotBasis": "互动率 {rate}，{count} 篇帖子",
      "tags": "标签",
      "noTags": "还没有标签。",
      "manageTags": "管理标签",
      "link": "已发布的帖子",
      "linkHint": "选择这个创意最终发布成的帖子（此账号，近 30 天）。选择后卡片会移到「已发布」。",
      "noLink": "未关联",
      "match": "与计划时间相符",
      "noCandidates": "此账号近 30 天没有帖子。",
      "save": "保存",
      "cancel": "取消",
      "delete": "删除",
      "deleteTitle": "删除这张卡片？",
      "deleteBody": "「{title}」将从看板中移除，且无法撤销。",
      "saved": "已保存。",
      "deleted": "已删除。"
    },
    "errors": {
      "invalid": "请检查填写的内容后重试。",
      "not_found": "此卡片、账号或帖子已不存在，请刷新页面。",
      "too_many": "看板最多容纳 500 张卡片，请先删除一些已发布的卡片。",
      "needs_update": "计划看板需要先更新数据库。",
      "unexpected": "无法保存，请重试。"
    }
  },
```

- [ ] **Step 5 — verify:** `npx vitest run tests/messages.test.ts` → pass (same keys, same placeholders, zh differs from en). Notes from the dry run: `"slot": "{day}, {hour}"` would be "untranslated" if zh were identical (it contains a 4-letter word inside a placeholder), hence the full-width comma in zh; no plural uses `=0 {…}`.
- [ ] **Commit:** `git add messages/en.json messages/zh-CN.json`, `git commit -m "feat(i18n): planner board strings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 2: migration `planner_items` (NEVER applied here)

**Files:** Create `supabase/migrations/20261105000001_planner_items.sql`, `tests/planner-migration.test.ts`.

The test reads only the SQL file (literal values); Task 4's test pins that the code constants equal these checks.

- [ ] **Step 1 — failing test** `tests/planner-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261105000001_planner_items.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.planner_items\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('planner_items migration', () => {
  it('is additive: one table, two indexes, RLS, one policy and a revoke; no function is touched', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'create index', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant|function)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it('bound to its account (cascade), linked post set null, both foreign keys indexed', () => {
    const t = table();
    expect(t).toMatch(exact('id uuid primary key default gen_random_uuid()'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data" deletes every account
    expect(t).toMatch(exact('media_id text references public.media (id) on delete set null'));
    expect(sql).toMatch(exact('create index planner_items_account_idx on public.planner_items (account_id)'));
    expect(sql).toMatch(exact('create index planner_items_media_idx on public.planner_items (media_id) where media_id is not null'));
  });

  it('the checks (the same limits as lib/planner/items.ts; tests/planner-actions.test.ts pins that)', () => {
    const t = table();
    expect(t).toMatch(exact('check (char_length(title) between 1 and 120 and title = btrim(title))'));
    expect(t).toMatch(exact("notes text not null default '' check (char_length(notes) <= 2000)"));
    expect(t).toMatch(exact("status text not null default 'idea' check (status in ('idea', 'drafting', 'ready', 'posted'))"));
    expect(t).toMatch(exact("format text check (format in ('REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'))"));
    expect(t).toMatch(exact('planned_day date,'));
    expect(t).toMatch(exact('planned_hour smallint check (planned_hour between 0 and 23)'));
    expect(t).toMatch(exact("tag_ids uuid[] not null default '{}' check (cardinality(tag_ids) <= 10 and coalesce(array_ndims(tag_ids), 1) = 1 and array_position(tag_ids, null) is null)"));
    expect(t).toMatch(exact('check (planned_hour is null or planned_day is not null)'));
    expect(t).toMatch(exact("check (media_id is null or status = 'posted')"));
  });

  it('owner-authored: RLS on, one for-all policy for authenticated owners (InitPlan form), anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.planner_items enable row level security'));
    expect(sql).toMatch(exact('create policy planner_items_owner_all on public.planner_items for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.planner_items from anon'));
  });
});
```

- [ ] **Step 2 — run, see it fail** (`ENOENT … 20261105000001_planner_items.sql`): `npx vitest run tests/planner-migration.test.ts`.
- [ ] **Step 3 — the migration** `supabase/migrations/20261105000001_planner_items.sql` (if a file with a LATER timestamp already exists in `supabase/migrations/`, STOP and report: this one must be the newest; keep `create table public.planner_items (` and the closing `);` on their own lines: `tests/data-export.test.ts` parses that shape):

```sql
-- Plan 17f: Planner board (SPEC §7p; creator-toolkit design §0b "planner board only", §6). ONE owner-authored table:
-- post ideas with a status column, an optional planned day/hour (owner timezone) and, once posted, the post they became.
-- Nothing here is ever sent to Instagram: no publishing, no scheduling, no reminders.
-- Owner session under RLS (is_owner(), like tags / explorer_views); never the admin client. The app checks the same
-- limits first (lib/planner/items.ts) and the same media account (app/(app)/plan/actions.ts).
-- account_id cascades, so deleting an account (and "Delete all data", which deletes every account) removes its items:
-- delete_all_data() needs no change. data_usage() (16c) lists tables literally and is not replaced for a table of a few
-- hundred rows (it counts in the database total), as in Plans 17b / 17c. tag_ids is an array (at most 10, no join
-- table): a deleted tag's id stays behind and the board ignores ids it does not know. media_id is set null when the
-- post's row goes; both foreign keys are indexed so the cascades stay linear (the 16c lesson).
create table public.planner_items (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  notes        text not null default '' check (char_length(notes) <= 2000),
  status       text not null default 'idea' check (status in ('idea', 'drafting', 'ready', 'posted')),
  format       text check (format in ('REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY')),
  planned_day  date,
  planned_hour smallint check (planned_hour between 0 and 23),
  tag_ids      uuid[] not null default '{}' check (cardinality(tag_ids) <= 10 and coalesce(array_ndims(tag_ids), 1) = 1 and array_position(tag_ids, null) is null),
  media_id     text references public.media (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (planned_hour is null or planned_day is not null),
  check (media_id is null or status = 'posted')
);
create index planner_items_account_idx on public.planner_items (account_id);
create index planner_items_media_idx on public.planner_items (media_id) where media_id is not null;
alter table public.planner_items enable row level security;
create policy planner_items_owner_all on public.planner_items
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.planner_items from anon;
```

- [ ] **Step 4 — verify:** `npx vitest run tests/planner-migration.test.ts tests/migrations.test.ts` → pass. Do NOT run `supabase`, `db push` or anything that connects to a database.
- [ ] **Commit:** `git add supabase/migrations/20261105000001_planner_items.sql tests/planner-migration.test.ts`, `git commit -m "feat(db): planner_items table for the planner board (Plan 17f, not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 3: the pure rules (`lib/planner/items.ts`, TDD)

**Files:** Create `lib/planner/items.ts`, `tests/planner-items.test.ts`.

- [ ] **Step 1 — failing test** `tests/planner-items.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Heatmap } from '@/lib/analysis/best-time';
import { boardColumns, linkCandidates, parseItemInput, stepStatus, suggestSlots, type LinkMedia, type PlannerItem } from '@/lib/planner/items';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const T1 = '00000000-0000-4000-8000-000000000001';
const input = (o: Record<string, unknown> = {}) => ({ accountId: A, title: 'Reel: studio tour', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, ...o });
const item = (o: Partial<PlannerItem>): PlannerItem => ({ id: 'i', accountId: A, title: 't', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, createdAt: '2026-10-01T00:00:00Z', ...o });

describe('parseItemInput', () => {
  it('normalises a valid item: title NFC + spaces collapsed, notes keep newlines (CRLF → LF), tags deduplicated lower case', () => {
    const r = parseItemInput(input({ title: '  Café   tour ', notes: ' line 1\r\nline 2 ', tagIds: [T1, T1.toUpperCase()], plannedDay: '2026-11-10', plannedHour: 19, format: 'REELS', accountId: A.toUpperCase() }));
    expect(r).toEqual({ ok: true, value: { accountId: A, title: 'Café tour', notes: 'line 1\nline 2', status: 'idea', format: 'REELS', plannedDay: '2026-11-10', plannedHour: 19, tagIds: [T1], mediaId: null } });
  });

  it('missing optional fields default to empty', () => {
    expect(parseItemInput({ accountId: A, title: 'x', status: 'drafting', tagIds: [] })).toMatchObject({ ok: true, value: { notes: '', format: null, plannedDay: null, plannedHour: null, mediaId: null } });
  });

  it.each([
    ['not an object', null],
    ['bad account', input({ accountId: 'x' })],
    ['empty title', input({ title: '   ' })],
    ['121 characters', input({ title: 'a'.repeat(121) })],
    ['control character', input({ title: 'a\u0007b' })],
    ['bidi override in notes', input({ notes: 'a‮b' })],
    ['2,001 characters of notes', input({ notes: 'é'.repeat(2001) })],
    ['notes not a string', input({ notes: 5 })],
    ['unknown status', input({ status: 'scheduled' })],
    ['unknown format', input({ format: 'VIDEO' })],
    ['impossible day', input({ plannedDay: '2026-02-30' })],
    ['hour 24', input({ plannedDay: '2026-11-10', plannedHour: 24 })],
    ['fractional hour', input({ plannedDay: '2026-11-10', plannedHour: 1.5 })],
    ['hour without a day', input({ plannedHour: 9 })],
    ['tags not an array', input({ tagIds: 'x' })],
    ['a tag that is not a uuid', input({ tagIds: ['x'] })],
    ['eleven tags', input({ tagIds: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`) })],
    ['a media id with a comma', input({ status: 'posted', mediaId: '1,2' })],
    ['a linked post on an unposted item', input({ status: 'ready', mediaId: '17895695668004550' })],
  ])('refuses %s', (_n, raw) => {
    expect(parseItemInput(raw)).toEqual({ ok: false, error: 'invalid' });
  });

  it('2,000 code points of notes (CJK and emoji count as one each) pass', () => {
    expect(parseItemInput(input({ notes: '😀'.repeat(1000) + '中'.repeat(1000) })).ok).toBe(true);
  });

  it('a posted item may carry its post', () => {
    expect(parseItemInput(input({ status: 'posted', mediaId: '17895695668004550' }))).toMatchObject({ ok: true, value: { mediaId: '17895695668004550' } });
  });
});

describe('stepStatus', () => {
  it('moves one column and stops at the edges', () => {
    expect(stepStatus('idea', 1)).toBe('drafting');
    expect(stepStatus('ready', 1)).toBe('posted');
    expect(stepStatus('drafting', -1)).toBe('idea');
    expect(stepStatus('idea', -1)).toBeNull();
    expect(stepStatus('posted', 1)).toBeNull();
  });
});

describe('boardColumns', () => {
  it('four columns in board order; planned soonest first (no hour after the day’s hours), then unplanned newest first', () => {
    const cols = boardColumns([
      item({ id: 'u-old', createdAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'u-new', createdAt: '2026-10-05T00:00:00Z' }),
      item({ id: 'd11-any', plannedDay: '2026-11-11' }),
      item({ id: 'd11-09', plannedDay: '2026-11-11', plannedHour: 9 }),
      item({ id: 'd10-20', plannedDay: '2026-11-10', plannedHour: 20 }),
      item({ id: 'r', status: 'ready' }),
    ]);
    expect(cols.map((c) => c.status)).toEqual(['idea', 'drafting', 'ready', 'posted']);
    expect(cols[0].items.map((i) => i.id)).toEqual(['d10-20', 'd11-09', 'd11-any', 'u-new', 'u-old']);
    expect(cols[1].items).toEqual([]);
    expect(cols[2].items.map((i) => i.id)).toEqual(['r']);
  });

  it('Posted: the latest planned first, then unplanned newest first', () => {
    const cols = boardColumns([item({ id: 'p1', status: 'posted', plannedDay: '2026-10-01' }), item({ id: 'p0', status: 'posted' }), item({ id: 'p2', status: 'posted', plannedDay: '2026-10-08' })]);
    expect(cols[3].items.map((i) => i.id)).toEqual(['p2', 'p1', 'p0']);
  });
});

describe('linkCandidates', () => {
  const tz = 'Europe/London';
  const m = (id: string, postedAt: string, mediaType: LinkMedia['mediaType'] = 'REELS', accountId = A): LinkMedia => ({ id, accountId, mediaType, postedAt });
  const planned = { id: 'i1', accountId: A, format: 'REELS' as const, plannedDay: '2026-10-25', plannedHour: 19 };

  it('nearest to the planned wall-clock time first, across the DST change (25 Oct 2026, London)', () => {
    // 19:00 London on 25 Oct = 19:00 UTC (GMT); 18:30 UTC = 18 h local → 1 h early; 24 Oct 21:00 UTC = 22:00 BST → 21 h early
    const r = linkCandidates(planned, [m('far', '2026-10-24T21:00:00Z'), m('near', '2026-10-25T18:30:00Z'), m('late', '2026-10-25T23:10:00Z')], new Map(), tz);
    expect(r.map((c) => [c.media.id, c.hours, c.match])).toEqual([
      ['near', -1, true],
      ['late', 4, false],
      ['far', -21, false],
    ]);
  });

  it('two posts equally near: the newer first; the planned format before others; other accounts, Stories and posts linked elsewhere are out', () => {
    const r = linkCandidates(
      planned,
      [m('img', '2026-10-25T19:00:00Z', 'IMAGE'), m('a', '2026-10-25T17:00:00Z'), m('b', '2026-10-25T21:00:00Z'), m('other', '2026-10-25T19:00:00Z', 'REELS', B), m('st', '2026-10-25T19:00:00Z', 'STORY'), m('taken', '2026-10-25T19:00:00Z')],
      new Map([['taken', 'i2']]),
      tz,
    );
    expect(r.map((c) => c.media.id)).toEqual(['b', 'a', 'img']);
    expect(r[2].match).toBe(false); // right time, other format
  });

  it('the post already linked to THIS item stays a candidate', () => {
    expect(linkCandidates(planned, [m('mine', '2026-10-25T19:00:00Z')], new Map([['mine', 'i1']]), tz).map((c) => c.media.id)).toEqual(['mine']);
  });

  it('a Story item gets Stories only; no planned day = newest first, no hours, no match; at most max', () => {
    const story = { ...planned, format: 'STORY' as const, plannedDay: null, plannedHour: null };
    const list = [m('s1', '2026-10-20T10:00:00Z', 'STORY'), m('s2', '2026-10-22T10:00:00Z', 'STORY'), m('r', '2026-10-23T10:00:00Z')];
    expect(linkCandidates(story, list, new Map(), tz).map((c) => [c.media.id, c.hours, c.match])).toEqual([
      ['s2', null, false],
      ['s1', null, false],
    ]);
    expect(linkCandidates(story, list, new Map(), tz, 1)).toHaveLength(1);
  });

  it('no format planned: any feed format matches; a day without an hour counts from noon', () => {
    const r = linkCandidates({ ...planned, format: null, plannedHour: null }, [m('x', '2026-10-25T14:00:00Z', 'IMAGE')], new Map(), tz);
    expect(r).toEqual([{ media: m('x', '2026-10-25T14:00:00Z', 'IMAGE'), hours: 2, match: true }]);
  });
});

describe('suggestSlots', () => {
  // weekday 0 = Sunday; 2026-11-01 is a Sunday
  const map = (cells: { weekday: number; hour: number; value: number; count: number }[], reason: Heatmap['reason'] = null): Heatmap => ({
    rows: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
      weekday,
      cells: Array.from({ length: 24 }, (_, hour) => {
        const c = cells.find((x) => x.weekday === weekday && x.hour === hour);
        return c ? { value: c.value, count: c.count, lowSample: c.count < 2 } : { value: null, count: 0, lowSample: true };
      }),
    })),
    sample: 40,
    reason,
  });

  it('best cells first, on their next date after today, one per day, skipping taken days and thin cells', () => {
    const m = map([
      { weekday: 2, hour: 19, value: 0.09, count: 4 }, // Tue 3 Nov
      { weekday: 2, hour: 8, value: 0.08, count: 3 }, // Tue again: skipped (one per day)
      { weekday: 4, hour: 12, value: 0.07, count: 2 }, // Thu 5 Nov: taken
      { weekday: 0, hour: 10, value: 0.065, count: 2 }, // Sun 8 Nov (today is Sunday 1 Nov: next week)
      { weekday: 6, hour: 9, value: 0.2, count: 1 }, // one post: too thin
      { weekday: 1, hour: 7, value: 0.05, count: 5 }, // Mon 2 Nov
    ]);
    expect(suggestSlots(m, ['2026-11-05'], '2026-11-01')).toEqual([
      { day: '2026-11-03', hour: 19, value: 0.09, count: 4 },
      { day: '2026-11-08', hour: 10, value: 0.065, count: 2 },
      { day: '2026-11-02', hour: 7, value: 0.05, count: 5 },
    ]);
    expect(suggestSlots(m, [], '2026-11-01', 1)).toHaveLength(1);
  });

  it('nothing while the heatmap is unreliable', () => {
    expect(suggestSlots(map([{ weekday: 2, hour: 19, value: 0.09, count: 4 }], 'not_enough_posts'), [], '2026-11-01')).toEqual([]);
  });
});
```

- [ ] **Step 2 — run, see it fail** (cannot resolve `@/lib/planner/items`): `npx vitest run tests/planner-items.test.ts`.
- [ ] **Step 3 — implementation** `lib/planner/items.ts`:

```ts
// Planner board (Plan 17f, SPEC §7p): pure rules for the owner's post ideas. No I/O, no Instagram: the board never
// publishes or schedules anything. Shared by the server actions (the trust boundary) and the board UI.
import { weekdayOf, type Heatmap } from '@/lib/analysis/best-time';
import type { MissingReason } from '@/lib/analysis/types';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween, isDay } from '@/lib/time-scope/range';
import { isMediaId, isUuid, normalizeTagName } from '@/lib/tags';

/** Board columns, left to right. The same list is the CHECK of planner_items.status (migration 20261105000001). */
export const PLANNER_STATUSES = ['idea', 'drafting', 'ready', 'posted'] as const;
export type PlannerStatus = (typeof PLANNER_STATUSES)[number];
export const PLANNER_FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'] as const satisfies readonly MediaKind[];
export const TITLE_MAX = 120;
export const NOTES_MAX = 2000;
/** Items per owner (the board reads at most this many; a new item beyond it is refused). */
export const MAX_ITEMS = 500;
export const MAX_ITEM_TAGS = 10;
/** A post within this many hours (wall clock, owner timezone) of the planned time is marked as a match. */
export const MATCH_HOURS = 3;

export interface PlannerItem {
  id: string;
  accountId: string;
  title: string;
  notes: string;
  status: PlannerStatus;
  format: MediaKind | null;
  plannedDay: string | null; // 'YYYY-MM-DD', owner timezone
  plannedHour: number | null; // 0-23, owner timezone; only with a day
  tagIds: string[];
  mediaId: string | null; // the published post, only when status = 'posted'
  createdAt: string;
}
export type PlannerInput = Omit<PlannerItem, 'id' | 'createdAt'>;

export type PlannerError = 'invalid' | 'not_found' | 'too_many' | 'needs_update' | 'unexpected';
export type PlannerResult = { ok: true } | { ok: false; error: PlannerError };

export interface SlotSuggestion {
  day: string;
  hour: number;
  value: number; // average engagement rate of the cell
  count: number; // posts behind it
}
export type SlotResult = { ok: true; slots: SlotSuggestion[]; sample: number; reason: MissingReason | null } | { ok: false; error: PlannerError };

const isStatus = (v: unknown): v is PlannerStatus => PLANNER_STATUSES.includes(v as PlannerStatus);
const isFormat = (v: unknown): v is MediaKind => PLANNER_FORMATS.includes(v as (typeof PLANNER_FORMATS)[number]);
// C0/C1 controls (newline and tab allowed) and bidi overrides/isolates, as in lib/tags.ts
const NOTES_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** Validates what the dialog sends. Every field is checked again here: the action is a public endpoint. */
export function parseItemInput(raw: unknown): { ok: true; value: PlannerInput } | { ok: false; error: 'invalid' } {
  const bad = { ok: false, error: 'invalid' } as const;
  if (typeof raw !== 'object' || raw === null) return bad;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.accountId)) return bad;
  const title = normalizeTagName(r.title, TITLE_MAX); // NFC, controls refused, spaces collapsed, 1-120 code points
  if (!title.ok) return bad;
  const notesRaw = r.notes ?? '';
  if (typeof notesRaw !== 'string') return bad;
  const notes = notesRaw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (NOTES_FORBIDDEN.test(notes) || [...notes].length > NOTES_MAX) return bad;
  if (!isStatus(r.status)) return bad;
  const format = r.format ?? null;
  if (format !== null && !isFormat(format)) return bad;
  const plannedDay = r.plannedDay ?? null;
  if (plannedDay !== null && !isDay(plannedDay)) return bad;
  const plannedHour = r.plannedHour ?? null;
  if (plannedHour !== null && !(Number.isInteger(plannedHour) && (plannedHour as number) >= 0 && (plannedHour as number) <= 23)) return bad;
  if (plannedHour !== null && plannedDay === null) return bad;
  if (!Array.isArray(r.tagIds) || !r.tagIds.every(isUuid)) return bad;
  const tagIds = [...new Set(r.tagIds.map((t) => t.toLowerCase()))];
  if (tagIds.length > MAX_ITEM_TAGS) return bad;
  const mediaId = r.mediaId ?? null;
  if (mediaId !== null && !isMediaId(mediaId)) return bad;
  if (mediaId !== null && r.status !== 'posted') return bad; // a linked post means it is published
  return {
    ok: true,
    value: { accountId: r.accountId.toLowerCase(), title: title.value, notes, status: r.status, format, plannedDay, plannedHour: plannedHour as number | null, tagIds, mediaId },
  };
}

/** The column to the left (-1) or right (+1); null at the edges. */
export function stepStatus(s: PlannerStatus, dir: -1 | 1): PlannerStatus | null {
  return PLANNER_STATUSES[PLANNER_STATUSES.indexOf(s) + dir] ?? null;
}

const planKey = (i: PlannerItem) => (i.plannedDay === null ? null : `${i.plannedDay} ${String(i.plannedHour ?? 24).padStart(2, '0')}`);

/** Four columns. Planned items first (a day without an hour after that day's hours), soonest first, but latest first
 *  in Posted; then unplanned items, newest first. */
export function boardColumns(items: readonly PlannerItem[]): { status: PlannerStatus; items: PlannerItem[] }[] {
  const order = (dir: 1 | -1) => (a: PlannerItem, b: PlannerItem) => {
    const ka = planKey(a);
    const kb = planKey(b);
    if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka < kb ? -dir : dir;
    return a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt > b.createdAt ? -1 : 1;
  };
  return PLANNER_STATUSES.map((status) => ({ status, items: items.filter((i) => i.status === status).sort(order(status === 'posted' ? -1 : 1)) }));
}

export interface LinkMedia {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string; // ISO
}

/** Posts the owner may link to an item, best first: same account; Stories only for a Story item and never otherwise;
 *  not linked to another item; the planned format first; then the nearest to the planned time (wall clock in the
 *  owner timezone, so a DST change does not shift it); without a planned day, the newest. `match` = same or unknown
 *  format and within MATCH_HOURS of the planned time. The owner always confirms; nothing links by itself. */
export function linkCandidates(
  item: Pick<PlannerItem, 'id' | 'accountId' | 'format' | 'plannedDay' | 'plannedHour'>,
  media: readonly LinkMedia[],
  linked: ReadonlyMap<string, string>, // media id → the item that holds it
  tz: string,
  max = 5,
): { media: LinkMedia; hours: number | null; match: boolean }[] {
  const story = item.format === 'STORY';
  const hoursOff = (m: LinkMedia) => {
    if (item.plannedDay === null) return null;
    const at = new Date(m.postedAt);
    return daysBetween(item.plannedDay, localDay(at, tz)) * 24 + localHour(at, tz) - (item.plannedHour ?? 12);
  };
  return media
    .filter((m) => m.accountId === item.accountId && (m.mediaType === 'STORY') === story && (linked.get(m.id) ?? item.id) === item.id)
    .map((m) => {
      const hours = hoursOff(m);
      const sameFormat = item.format === null || item.format === m.mediaType;
      return { media: m, hours, match: sameFormat && hours !== null && Math.abs(hours) <= MATCH_HOURS, sameFormat };
    })
    .sort((a, b) => {
      if (a.sameFormat !== b.sameFormat) return a.sameFormat ? -1 : 1;
      if (a.hours !== null && b.hours !== null && Math.abs(a.hours) !== Math.abs(b.hours)) return Math.abs(a.hours) - Math.abs(b.hours);
      return a.media.postedAt === b.media.postedAt ? (a.media.id < b.media.id ? -1 : 1) : a.media.postedAt > b.media.postedAt ? -1 : 1;
    })
    .slice(0, max)
    .map(({ media: m, hours, match }) => ({ media: m, hours, match }));
}

/** Up to `n` slots in the next 7 days from the account's "your post performance" heatmap (lib/analysis/best-time.ts):
 *  the best cells with enough posts, each on its next date after today, at most one per day, skipping days that
 *  already hold a planned item. None while the heatmap itself is unreliable (fewer than RELIABLE_POSTS posts). */
export function suggestSlots(map: Heatmap, takenDays: readonly string[], today: string, n = 3): SlotSuggestion[] {
  if (map.reason !== null) return [];
  const used = new Set(takenDays);
  const cells = map.rows
    .flatMap((r) => r.cells.map((c, hour) => ({ weekday: r.weekday, hour, value: c.value, count: c.count, low: c.lowSample })))
    .filter((c): c is { weekday: number; hour: number; value: number; count: number; low: boolean } => c.value !== null && !c.low)
    .sort((a, b) => b.value - a.value || b.count - a.count || a.weekday - b.weekday || a.hour - b.hour);
  const out: SlotSuggestion[] = [];
  for (const c of cells) {
    if (out.length >= n) break;
    const day = [1, 2, 3, 4, 5, 6, 7].map((i) => addDays(today, i)).find((d) => weekdayOf(d) === c.weekday)!;
    if (used.has(day)) continue;
    used.add(day);
    out.push({ day, hour: c.hour, value: c.value, count: c.count });
  }
  return out;
}
```

- [ ] **Step 4 — verify:** `npx vitest run tests/planner-items.test.ts` → 33 passed; `npx tsc --noEmit`; `npx eslint lib/planner/items.ts tests/planner-items.test.ts`.
- [ ] **Commit:** `git add lib/planner/items.ts tests/planner-items.test.ts`, `git commit -m "feat(planner): pure rules for cards, columns, post links and slot suggestions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 4: the read, the server actions, the export entry

**Files:** Create `lib/planner/read.ts`, `app/(app)/plan/planner-actions.ts`, `tests/planner-actions.test.ts`; modify `lib/data/export.ts`, `tests/settings-data.test.tsx`.

- [ ] **Step 1 — failing test** `tests/planner-actions.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = unknown[];
const { calls, requireOwner, queue, posts } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
  posts: [] as unknown[],
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'gte', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/prefs.server', () => ({ getPrefs: async () => ({ timezone: 'UTC', weekStart: 'mon' }) }));
vi.mock('@/lib/dashboard/detail-read', () => ({ loadPostRows: async (...a: unknown[]) => (calls.push(['loadPostRows', a[1]]), posts) }));

import { deletePlannerItemAction, movePlannerItemAction, savePlannerItemAction, suggestSlotsAction } from '@/app/(app)/plan/planner-actions';
import { MAX_ITEM_TAGS, MAX_ITEMS, NOTES_MAX, PLANNER_FORMATS, PLANNER_STATUSES, TITLE_MAX } from '@/lib/planner/items';
import { loadPlannerItems } from '@/lib/planner/read';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const I = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const input = (o: Record<string, unknown> = {}) => ({ accountId: A, title: 'Studio tour', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, ...o });
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  posts.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('planner actions: authorization and boundary validation', () => {
  it.each([
    ['save', () => savePlannerItemAction(null, input())],
    ['move', () => movePlannerItemAction(I, 'drafting')],
    ['delete', () => deletePlannerItemAction(I)],
    ['suggest', () => suggestSlotsAction(A)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('never uses the admin client', async () => {
    await savePlannerItemAction(null, input());
    await movePlannerItemAction(I, 'posted');
    await suggestSlotsAction(A);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('invalid input returns an error key without opening a database client', async () => {
    expect(await savePlannerItemAction('x', input())).toEqual({ ok: false, error: 'not_found' });
    expect(await savePlannerItemAction(null, input({ title: '' }))).toEqual({ ok: false, error: 'invalid' });
    expect(await savePlannerItemAction(null, 'nope')).toEqual({ ok: false, error: 'invalid' });
    expect(await movePlannerItemAction("1' or 1=1", 'idea')).toEqual({ ok: false, error: 'not_found' });
    expect(await movePlannerItemAction(I, 'scheduled' as never)).toEqual({ ok: false, error: 'invalid' });
    expect(await deletePlannerItemAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(await suggestSlotsAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session')).toBe(false);
  });
});

describe('savePlannerItemAction', () => {
  it('creates: checks the cap, inserts the normalised row, revalidates /plan', async () => {
    queue.push({ data: [{ id: 'x' }] }, { error: null });
    expect(await savePlannerItemAction(null, input({ title: '  Studio   tour ', tagIds: [] }))).toEqual({ ok: true });
    expect(has('limit', MAX_ITEMS)).toBe(true);
    expect(has('insert', { account_id: A, title: 'Studio tour', notes: '', status: 'idea', format: null, planned_day: null, planned_hour: null, tag_ids: [], media_id: null })).toBe(true);
    expect(has('revalidate', '/plan')).toBe(true);
  });

  it('refuses a new item at the cap', async () => {
    queue.push({ data: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: i })) });
    expect(await savePlannerItemAction(null, input())).toEqual({ ok: false, error: 'too_many' });
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
  });

  it('updates by id; a vanished item is not_found', async () => {
    queue.push({ data: [{ id: I }] });
    expect(await savePlannerItemAction(I.toUpperCase(), input({ status: 'drafting' }))).toEqual({ ok: true });
    expect(has('eq', 'id', I)).toBe(true);
    queue.push({ data: [] });
    expect(await savePlannerItemAction(I, input())).toEqual({ ok: false, error: 'not_found' });
  });

  it('a linked post must belong to the item’s account', async () => {
    queue.push({ data: [] });
    expect(await savePlannerItemAction(I, input({ status: 'posted', mediaId: '178' }))).toEqual({ ok: false, error: 'not_found' });
    expect(has('from', 'media')).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
    expect(calls.some((c) => c[0] === 'update')).toBe(false);

    calls.length = 0;
    queue.push({ data: [{ id: '178' }] }, { data: [{ id: I }] });
    expect(await savePlannerItemAction(I, input({ status: 'posted', mediaId: '178' }))).toEqual({ ok: true });
    expect(calls.some((c) => c[0] === 'update' && (c[1] as { media_id: string }).media_id === '178')).toBe(true);
  });

  it.each([
    ['PGRST205', 'needs_update'],
    ['42P01', 'needs_update'],
    ['23503', 'not_found'],
    ['23514', 'invalid'],
    ['XX000', 'unexpected'],
  ])('database error %s → %s', async (code, key) => {
    queue.push({ data: [] }, { error: { code, message: 'secret detail' } });
    expect(await savePlannerItemAction(null, input())).toEqual({ ok: false, error: key });
  });
});

describe('movePlannerItemAction', () => {
  it('to posted keeps the link; to any other column drops it', async () => {
    queue.push({ data: [{ id: I }] }, { data: [{ id: I }] });
    expect(await movePlannerItemAction(I, 'posted')).toEqual({ ok: true });
    expect(has('update', { status: 'posted' })).toBe(true);
    expect(await movePlannerItemAction(I, 'ready')).toEqual({ ok: true });
    expect(has('update', { status: 'ready', media_id: null })).toBe(true);
  });

  it('a vanished item is not_found', async () => {
    queue.push({ data: [] });
    expect(await movePlannerItemAction(I, 'idea')).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('deletePlannerItemAction', () => {
  it('deletes by id and revalidates', async () => {
    queue.push({ data: [{ id: I }] });
    expect(await deletePlannerItemAction(I)).toEqual({ ok: true });
    expect(has('delete')).toBe(true);
    expect(has('eq', 'id', I)).toBe(true);
    expect(has('revalidate', '/plan')).toBe(true);
  });
});

describe('suggestSlotsAction', () => {
  it('reads the account’s posts and its planned days after today; too few posts → no slots, with the reason', async () => {
    queue.push({ data: [{ planned_day: '2099-01-01' }] });
    const r = await suggestSlotsAction(A);
    expect(r).toEqual({ ok: true, slots: [], sample: 0, reason: 'not_enough_posts' });
    expect(has('loadPostRows', A)).toBe(true);
    expect(has('eq', 'account_id', A)).toBe(true);
    expect(calls.some((c) => c[0] === 'gte' && c[1] === 'planned_day')).toBe(true);
    expect(calls.some((c) => c[0] === 'revalidate')).toBe(false); // read-only
  });

  it('without the migration: needs_update', async () => {
    queue.push({ error: { code: 'PGRST205' } });
    expect(await suggestSlotsAction(A)).toEqual({ ok: false, error: 'needs_update' });
  });
});

describe('loadPlannerItems', () => {
  it('newest first, capped; maps rows (unknown status / format fall back); no table → null; other errors → a fixed message', async () => {
    const db = fakeDb() as never;
    queue.push({ data: [{ id: I, account_id: A, title: 'T', notes: null, status: 'weird', format: 'VIDEO', planned_day: '2026-11-10', planned_hour: 19, tag_ids: [A], media_id: null, created_at: 'c' }] });
    expect(await loadPlannerItems(db)).toEqual([{ id: I, accountId: A, title: 'T', notes: '', status: 'idea', format: null, plannedDay: '2026-11-10', plannedHour: 19, tagIds: [A], mediaId: null, createdAt: 'c' }]);
    expect(has('order', 'created_at', { ascending: false })).toBe(true);
    expect(has('limit', MAX_ITEMS)).toBe(true);
    queue.push({ error: { code: 'PGRST205' } });
    expect(await loadPlannerItems(db)).toBeNull();
    queue.push({ error: { code: 'XX000', message: 'secret detail' } });
    await expect(loadPlannerItems(db)).rejects.toThrow(/^planner read failed$/);
  });
});

describe('the app limits equal the migration checks (20261105000001)', () => {
  it('title, notes, status, format and tag caps', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261105000001_planner_items.sql'), 'utf8');
    const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ');
    expect(sql).toContain(`char_length(title) between 1 and ${TITLE_MAX}`);
    expect(sql).toContain(`char_length(notes) <= ${NOTES_MAX}`);
    expect(sql).toContain(`status in (${list(PLANNER_STATUSES)})`);
    expect(sql).toContain(`format in (${list(PLANNER_FORMATS)})`);
    expect(sql).toContain(`cardinality(tag_ids) <= ${MAX_ITEM_TAGS}`);
  });
});
```

- [ ] **Step 2 — run, see it fail** (cannot resolve `@/app/(app)/plan/planner-actions`): `npx vitest run tests/planner-actions.test.ts`.
- [ ] **Step 3 — `lib/planner/read.ts`:**

```ts
// Reads and row mapping of planner_items (Plan 17f, migration 20261105000001). OWNER SESSION client only (RLS:
// planner_items_owner_all, is_owner()); never the admin client. Errors become keys, never Supabase text.
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_ITEMS, PLANNER_FORMATS, PLANNER_STATUSES, type PlannerError, type PlannerInput, type PlannerItem } from '@/lib/planner/items';

export const PLANNER_TABLE = 'planner_items';
const COLUMNS = 'id,account_id,title,notes,status,format,planned_day,planned_hour,tag_ids,media_id,created_at';

type Row = Record<string, unknown>;
type DbError = { code?: string } | null;

/** PostgREST / Postgres "table not found" = migration 20261105000001 not applied; 23503 = the account or post is gone;
 *  23514 = a check refused the row (the app validates first, so this means a stale page). */
export function plannerError(e: DbError): PlannerError {
  const code = e?.code;
  return code === 'PGRST205' || code === '42P01' ? 'needs_update' : code === '23503' ? 'not_found' : code === '23514' ? 'invalid' : 'unexpected';
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function rowToItem(r: Row): PlannerItem {
  const format = str(r.format);
  const status = str(r.status);
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    title: String(r.title),
    notes: str(r.notes) ?? '',
    status: PLANNER_STATUSES.find((s) => s === status) ?? 'idea',
    format: PLANNER_FORMATS.find((f) => f === format) ?? null,
    plannedDay: str(r.planned_day),
    plannedHour: typeof r.planned_hour === 'number' ? r.planned_hour : null,
    tagIds: Array.isArray(r.tag_ids) ? r.tag_ids.map(String) : [],
    mediaId: str(r.media_id),
    createdAt: String(r.created_at),
  };
}

export const itemToRow = (v: PlannerInput) => ({
  account_id: v.accountId,
  title: v.title,
  notes: v.notes,
  status: v.status,
  format: v.format,
  planned_day: v.plannedDay,
  planned_hour: v.plannedHour,
  tag_ids: v.tagIds,
  media_id: v.mediaId,
});

/** Every item, newest first (at most MAX_ITEMS, which the actions enforce). null = the migration is not applied yet. */
export async function loadPlannerItems(db: SupabaseClient): Promise<PlannerItem[] | null> {
  const { data, error } = await db.from(PLANNER_TABLE).select(COLUMNS).order('created_at', { ascending: false }).limit(MAX_ITEMS);
  if (error) {
    if (plannerError(error) === 'needs_update') return null;
    throw new Error('planner read failed');
  }
  return ((data ?? []) as Row[]).map(rowToItem);
}
```

- [ ] **Step 4 — `app/(app)/plan/planner-actions.ts`:**

```ts
'use server';

// Planner board (Plan 17f). Owner-authored data: OWNER-SESSION client only, so RLS (planner_items_owner_all,
// is_owner()) applies to every write. Never the admin client, never a call to Instagram, no logging.
import { revalidatePath } from 'next/cache';
import { postHeatmap } from '@/lib/analysis/best-time';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadPostRows } from '@/lib/dashboard/detail-read';
import { MAX_ITEMS, PLANNER_STATUSES, parseItemInput, suggestSlots, type PlannerError, type PlannerResult, type PlannerStatus, type SlotResult } from '@/lib/planner/items';
import { itemToRow, PLANNER_TABLE, plannerError } from '@/lib/planner/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

const fail = (error: PlannerError) => ({ ok: false, error }) as const;

function done(): PlannerResult {
  revalidatePath('/plan');
  return { ok: true };
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.

/** Creates (id = null) or replaces an item. A linked post must belong to the item's account. */
export async function savePlannerItemAction(id: string | null, raw: unknown): Promise<PlannerResult> {
  await requireOwner();
  if (id !== null && !isUuid(id)) return fail('not_found');
  const p = parseItemInput(raw);
  if (!p.ok) return fail(p.error);
  try {
    const db = await createServerSupabase();
    if (p.value.mediaId !== null) {
      const { data, error } = await db.from('media').select('id').eq('id', p.value.mediaId).eq('account_id', p.value.accountId).limit(1);
      if (error) return fail('unexpected');
      if (!(data ?? []).length) return fail('not_found');
    }
    if (id === null) {
      const { data, error } = await db.from(PLANNER_TABLE).select('id').limit(MAX_ITEMS);
      if (error) return fail(plannerError(error));
      if ((data ?? []).length >= MAX_ITEMS) return fail('too_many');
      const { error: insertError } = await db.from(PLANNER_TABLE).insert(itemToRow(p.value));
      return insertError ? fail(plannerError(insertError)) : done();
    }
    const { data, error } = await db.from(PLANNER_TABLE).update(itemToRow(p.value)).eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Moves a card to another column. Leaving "posted" drops the post link (a linked post means it is published). */
export async function movePlannerItemAction(id: string, status: PlannerStatus): Promise<PlannerResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  if (!PLANNER_STATUSES.includes(status)) return fail('invalid');
  try {
    const db = await createServerSupabase();
    const patch = status === 'posted' ? { status } : { status, media_id: null };
    const { data, error } = await db.from(PLANNER_TABLE).update(patch).eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deletePlannerItemAction(id: string): Promise<PlannerResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from(PLANNER_TABLE).delete().eq('id', id.toLowerCase()).select('id');
    if (error) return fail(plannerError(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Up to 3 slots in the next 7 days from the account's post performance (the account Overview's heatmap: all stored
 *  feed posts, owner timezone), skipping days that already hold a planned item of this account. Read-only. */
export async function suggestSlotsAction(accountId: string): Promise<SlotResult> {
  await requireOwner();
  if (!isUuid(accountId)) return fail('not_found');
  try {
    const [prefs, db] = await Promise.all([getPrefs(), createServerSupabase()]);
    const today = localDay(new Date(), prefs.timezone);
    const id = accountId.toLowerCase();
    const [posts, taken] = await Promise.all([
      loadPostRows(db, id),
      db.from(PLANNER_TABLE).select('planned_day').eq('account_id', id).gte('planned_day', addDays(today, 1)).limit(MAX_ITEMS),
    ]);
    if (taken.error) return fail(plannerError(taken.error));
    const map = postHeatmap(posts, prefs.timezone, prefs.weekStart);
    const days = ((taken.data ?? []) as { planned_day: unknown }[]).map((r) => String(r.planned_day));
    return { ok: true, slots: suggestSlots(map, days, today), sample: map.sample, reason: map.reason };
  } catch {
    return fail('unexpected');
  }
}
```

- [ ] **Step 5 — export entry.** `lib/data/export.ts`: OLD `  { name: 'explorer_views', keys: ['id'] },` → NEW:

```ts
  { name: 'explorer_views', keys: ['id'] },
  { name: 'planner_items', keys: ['id'] },
```

`tests/settings-data.test.tsx`: increase each of these three numbers by exactly 1 from what the file says (at `81054d7`: OLD `    expect(urls).toHaveLength(18);` → NEW `    expect(urls).toHaveLength(19);`; OLD `    expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();` → NEW `    expect(await screen.findByText('19 files downloaded.')).toBeInTheDocument();`; OLD `    expect(server.download.mock.calls).toHaveLength(20);` → NEW `    expect(server.download.mock.calls).toHaveLength(21);`. After 17b/17c/17d the numbers are higher: still +1 each, and the two "without other people's data" numbers stay equal to each other).
- [ ] **Step 6 — verify:** `npx vitest run tests/planner-actions.test.ts tests/data-export.test.ts tests/settings-data.test.tsx tests/data-privacy-guard.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/planner/read.ts "app/(app)/plan/planner-actions.ts" tests/planner-actions.test.ts lib/data/export.ts tests/settings-data.test.tsx`.
- [ ] **Commit:** `git add lib/planner/read.ts "app/(app)/plan/planner-actions.ts" tests/planner-actions.test.ts lib/data/export.ts tests/settings-data.test.tsx`, `git commit -m "feat(planner): owner-session read and save / move / delete / suggest actions; export entry" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 5: the board and the card dialog

**Files:** Create `components/plan/PlannerItemDialog.tsx`, `components/plan/PlannerBoard.tsx`, `tests/planner-board.test.tsx`.

- [ ] **Step 1 — failing test** `tests/planner-board.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PlannerBoard, type PlannerBoardProps } from '@/components/plan/PlannerBoard';
import type { PlannerItem } from '@/lib/planner/items';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const GONE = '99999999-9999-4999-8999-999999999999'; // an archived account
const T1 = '00000000-0000-4000-8000-000000000001';
const P = en.planner;
const item = (o: Partial<PlannerItem>): PlannerItem => ({ id: 'i', accountId: A, title: 't', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, createdAt: '2026-10-01T00:00:00Z', ...o });
const ITEMS = [
  item({ id: 'i1', title: '<b>Studio tour</b>', notes: 'line 1\nline 2', format: 'REELS', plannedDay: '2026-11-10', plannedHour: 19, tagIds: [T1, 'deleted-tag'] }),
  item({ id: 'i2', title: 'Q&A carousel', status: 'drafting', accountId: B }),
  item({ id: 'i3', title: 'Launch post', status: 'posted', mediaId: '178' }),
  item({ id: 'i4', title: 'Hidden', accountId: GONE }),
];
const ok = async () => ({ ok: true as const });

function board(o: Partial<PlannerBoardProps> = {}, messages: typeof en = en) {
  const props: PlannerBoardProps = {
    items: ITEMS,
    accounts: [
      { id: A, username: 'alice' },
      { id: B, username: 'bob' },
    ],
    account: null,
    tags: [{ id: T1, name: 'Promo', color: 'chart-2' }],
    media: [
      { id: '178', accountId: A, mediaType: 'REELS', postedAt: '2026-10-02T10:00:00Z', cover: 'pending', caption: 'Launch' }, // linked to i3: never offered to another card
      { id: '179', accountId: A, mediaType: 'REELS', postedAt: '2026-11-10T19:30:00Z', cover: 'pending', caption: 'Tour' },
    ],
    save: vi.fn(ok),
    move: vi.fn(ok),
    remove: vi.fn(ok),
    suggest: vi.fn(async () => ({ ok: true as const, slots: [{ day: '2026-11-12', hour: 18, value: 0.081, count: 4 }], sample: 42, reason: null })),
    ...o,
  };
  render(
    <NextIntlClientProvider locale={messages === en ? 'en' : 'zh-CN'} messages={messages}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'UTC', timeFormat: '24h', dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <PlannerBoard {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}
const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}`) });

describe('PlannerBoard', () => {
  it('four columns in order with counts; cards show the account, format, planned time, notes and known tags as text', () => {
    board();
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))).toEqual(['plan-col-idea', 'plan-col-drafting', 'plan-col-ready', 'plan-col-posted']);
    const ideas = column(P.status.idea);
    expect(within(ideas).getByText('1 card')).toBeInTheDocument();
    const card = within(ideas).getByRole('listitem');
    expect(within(card).getByRole('button', { name: `Edit ${ITEMS[0].title}` })).toHaveTextContent('<b>Studio tour</b>'); // text, never HTML
    expect(card).toHaveTextContent('@alice');
    expect(card).toHaveTextContent('Reel');
    expect(card).toHaveTextContent('2026-11-10 19:00');
    expect(card).toHaveTextContent('Promo');
    expect(card.querySelectorAll('[style]').length).toBeGreaterThan(0); // the known tag badge; the unknown id is skipped
    expect(within(column(P.status.ready)).getByText(P.emptyColumn)).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).toBeNull(); // archived account
    expect(within(column(P.status.posted)).getByRole('link', { name: P.openPost })).toHaveAttribute('href', `/accounts/${A}/media/178`);
  });

  it('keyboard path: the arrow buttons move a card one column and announce it; edges have no button', async () => {
    const user = userEvent.setup();
    const p = board();
    const ideas = column(P.status.idea);
    expect(within(ideas).queryByRole('button', { name: /to Ideas/ })).toBeNull();
    await user.click(within(ideas).getByRole('button', { name: `Move ${ITEMS[0].title} to Drafting` }));
    expect(p.move).toHaveBeenCalledWith('i1', 'drafting');
    expect(await screen.findByRole('status')).toHaveTextContent(`Moved ${ITEMS[0].title} to Drafting.`);
    await user.click(within(column(P.status.drafting)).getByRole('button', { name: 'Move Q&A carousel to Ideas' }));
    expect(p.move).toHaveBeenLastCalledWith('i2', 'idea');
    expect(within(column(P.status.posted)).queryByRole('button', { name: /^Move .* to (?!Ready)/ })).toBeNull();
  });

  it('drag and drop moves a card; dropping on its own column does nothing', () => {
    const p = board();
    const dt = { getData: () => 'i1', setData: vi.fn() };
    fireEvent.drop(column(P.status.ready), { dataTransfer: dt });
    expect(p.move).toHaveBeenCalledWith('i1', 'ready');
    fireEvent.drop(column(P.status.idea), { dataTransfer: dt });
    expect(p.move).toHaveBeenCalledTimes(1);
    const card = within(column(P.status.idea)).getByRole('listitem');
    expect(card).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(card, { dataTransfer: dt });
    expect(dt.setData).toHaveBeenCalledWith('text/plain', 'i1');
  });

  it('a failed move shows the error key as an alert', async () => {
    const user = userEvent.setup();
    board({ move: vi.fn(async () => ({ ok: false as const, error: 'needs_update' as const })) });
    await user.click(screen.getByRole('button', { name: `Move ${ITEMS[0].title} to Drafting` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(P.errors.needs_update);
  });

  it('the account filter navigates on the page the board lives on', async () => {
    const user = userEvent.setup();
    board({ account: B });
    await user.selectOptions(screen.getByLabelText(P.account), '@alice');
    expect(push).toHaveBeenLastCalledWith(`/plan?account=${A}`, { scroll: false });
    await user.selectOptions(screen.getByLabelText(P.account), P.allAccounts);
    expect(push).toHaveBeenLastCalledWith('/plan', { scroll: false });
  });

  it('under Plan 17d the board keeps its section path', async () => {
    const user = userEvent.setup();
    board({ basePath: '/plan/board' });
    await user.selectOptions(screen.getByLabelText(P.account), '@bob');
    expect(push).toHaveBeenLastCalledWith(`/plan/board?account=${B}`, { scroll: false });
  });

  it('one account: no filter, no handle on cards; a filtered board shows only that account', () => {
    board({ accounts: [{ id: A, username: 'alice' }] });
    expect(screen.queryByLabelText(P.account)).toBeNull();
    expect(screen.queryByText('@alice')).toBeNull();
    expect(screen.queryByText('Q&A carousel')).toBeNull();
  });

  it('empty and no-account states', () => {
    board({ items: [] });
    expect(screen.getByText(P.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: P.new })).toBeInTheDocument();
  });

  it('no live account: says to connect one, no New button', () => {
    board({ accounts: [] });
    expect(screen.getByText(P.noAccounts)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: P.new })).toBeNull();
  });

  it('New idea: title required, saves the trimmed form with the filtered account, closes and announces', async () => {
    const user = userEvent.setup();
    const p = board({ account: B });
    await user.click(screen.getByRole('button', { name: P.new }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: P.dialog.save });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText(new RegExp(P.dialog.titleLabel)), 'Behind the scenes');
    await user.type(within(dialog).getByLabelText(P.dialog.notes), 'Shot list');
    await user.selectOptions(within(dialog).getByLabelText(P.dialog.format), 'REELS');
    expect(within(dialog).queryByText(P.dialog.link)).toBeNull(); // only for Ready / Posted
    await user.click(save);
    expect(p.save).toHaveBeenCalledWith(null, { accountId: B, title: 'Behind the scenes', notes: 'Shot list', status: 'idea', format: 'REELS', plannedDay: null, plannedHour: null, tagIds: [], mediaId: null });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(P.dialog.saved);
  });

  it('Suggest a time: shows the basis with n and fills the day and hour', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.suggest }));
    expect(p.suggest).toHaveBeenCalledWith(A);
    expect(within(dialog).getByText(/42 posts\. Pattern, not proof\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '2026-11-12, 18:00' }));
    expect(within(dialog).getByLabelText(P.dialog.day)).toHaveValue('2026-11-12');
    expect(within(dialog).getByLabelText(P.dialog.hour)).toHaveValue('18');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.save }));
    expect(p.save).toHaveBeenCalledWith('i1', expect.objectContaining({ plannedDay: '2026-11-12', plannedHour: 18, tagIds: [T1] })); // the unknown tag id is dropped
  });

  it('Suggest a time with too few posts says why, with n', async () => {
    const user = userEvent.setup();
    board({ suggest: vi.fn(async () => ({ ok: true as const, slots: [], sample: 7, reason: 'not_enough_posts' as const })) });
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: P.dialog.suggest }));
    expect(screen.getByText(`${en.analysis.reasons.not_enough_posts} (n = 7 posts)`)).toBeInTheDocument();
  });

  it('linking a recent post moves the card to Posted; the nearest post is marked as a match', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: `Edit ${ITEMS[0].title}` }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(P.dialog.column), 'ready');
    const fieldset = within(dialog).getByRole('group', { name: P.dialog.link });
    expect(within(fieldset).getByText(P.dialog.match)).toBeInTheDocument();
    const radios = within(fieldset).getAllByRole('radio');
    expect(radios).toHaveLength(2); // "Not linked" + the Reel posted 30 minutes after the planned 19:00 (178 belongs to i3)
    await user.click(radios[1]);
    expect(within(dialog).getByLabelText(P.dialog.column)).toHaveValue('posted');
    await user.click(within(dialog).getByRole('button', { name: P.dialog.save }));
    expect(p.save).toHaveBeenCalledWith('i1', expect.objectContaining({ status: 'posted', mediaId: '179' }));
  });

  it('Delete asks first, then removes', async () => {
    const user = userEvent.setup();
    const p = board();
    await user.click(screen.getByRole('button', { name: 'Edit Q&A carousel' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: P.dialog.delete }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Q&A carousel is removed from the board.');
    await user.click(within(confirm).getByRole('button', { name: P.dialog.delete }));
    expect(p.remove).toHaveBeenCalledWith('i2');
  });

  it('zh-CN renders the column names', () => {
    board({}, zh as unknown as typeof en);
    expect(screen.getByRole('heading', { name: /^创意/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^已发布/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 — run, see it fail** (cannot resolve `@/components/plan/PlannerBoard`): `npx vitest run tests/planner-board.test.tsx`.
- [ ] **Step 3 — `components/plan/PlannerItemDialog.tsx`:**

```tsx
'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { MediaThumb, type ThumbMedia } from '@/components/shared/MediaThumb';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Tag } from '@/lib/analysis/types';
import { formatDateTime, formatDay, formatHour, formatPercent } from '@/lib/format';
import {
  linkCandidates,
  MAX_ITEM_TAGS,
  NOTES_MAX,
  PLANNER_FORMATS,
  PLANNER_STATUSES,
  TITLE_MAX,
  type LinkMedia,
  type PlannerInput,
  type PlannerItem,
  type PlannerResult,
  type PlannerStatus,
  type SlotResult,
} from '@/lib/planner/items';
import { postLabHref } from '@/lib/post-lab/params';

export interface PlannerActions {
  save: (id: string | null, input: PlannerInput) => Promise<PlannerResult>;
  move: (id: string, status: PlannerStatus) => Promise<PlannerResult>;
  remove: (id: string) => Promise<PlannerResult>;
  suggest: (accountId: string) => Promise<SlotResult>;
}
/** A recent post the owner may link: its time, plus what the thumbnail needs (an 80-character caption snippet). */
export type PlannerMedia = LinkMedia & ThumbMedia;

const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface FormProps extends Pick<PlannerActions, 'save' | 'remove' | 'suggest'> {
  item: PlannerItem | null;
  accountId: string;
  accounts: { id: string; username: string }[];
  tags: Tag[];
  media: PlannerMedia[];
  linked: ReadonlyMap<string, string>;
  onDone: (text: string) => void;
}

function ItemForm({ item, accountId, accounts, tags, media, linked, save, remove, suggest, onDone }: FormProps) {
  const t = useTranslations('planner');
  const tErr = useTranslations('planner.errors');
  const tf = useTranslations('analysis.format');
  const tr = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const [v, setV] = useState<PlannerInput>(() =>
    item
      ? { accountId: item.accountId, title: item.title, notes: item.notes, status: item.status, format: item.format, plannedDay: item.plannedDay, plannedHour: item.plannedHour, tagIds: item.tagIds, mediaId: item.mediaId }
      : { accountId, title: '', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PlannerInput>) => setV((p) => ({ ...p, ...patch }));
  const known = new Set(tags.map((tg) => tg.id));
  const picked = v.tagIds.filter((id) => known.has(id)); // a deleted tag's id is dropped on the next save
  const candidates = linkCandidates({ id: item?.id ?? '', accountId: v.accountId, format: v.format, plannedDay: v.plannedDay, plannedHour: v.plannedHour }, media, linked, prefs.timezone);
  const run = (fn: () => Promise<PlannerResult>, text: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) onDone(text);
      else setError(tErr(r.error));
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => save(item?.id ?? null, { ...v, tagIds: picked }), t('dialog.saved'));
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{item ? t('dialog.editTitle') : t('dialog.newTitle')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t('dialog.description')}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      {accounts.length > 1 ? (
        <FormField id="plan-item-account" label={t('account')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.accountId} onChange={(e) => set({ accountId: e.target.value, mediaId: null })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}
      <FormField id="plan-item-title" label={t('dialog.titleLabel')} required>
        {(p) => <Input {...p} value={v.title} maxLength={TITLE_MAX} autoComplete="off" onChange={(e) => set({ title: e.target.value })} />}
      </FormField>
      <FormField id="plan-item-notes" label={t('dialog.notes')} hint={t('dialog.notesHint')}>
        {(p) => <Textarea {...p} value={v.notes} maxLength={NOTES_MAX} rows={4} onChange={(e) => set({ notes: e.target.value })} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="plan-item-status" label={t('dialog.column')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.status} onChange={(e) => set({ status: e.target.value as PlannerStatus, ...(e.target.value === 'posted' ? {} : { mediaId: null }) })}>
              {PLANNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="plan-item-format" label={t('dialog.format')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.format ?? ''} onChange={(e) => set({ format: (e.target.value || null) as PlannerInput['format'] })}>
              <option value="">{t('dialog.noFormat')}</option>
              {PLANNER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {tf(f)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="plan-item-day" label={t('dialog.day')}>
          {(p) => <Input {...p} type="date" value={v.plannedDay ?? ''} onChange={(e) => set(e.target.value ? { plannedDay: e.target.value } : { plannedDay: null, plannedHour: null })} />}
        </FormField>
        <FormField id="plan-item-hour" label={t('dialog.hour')}>
          {(p) => (
            <select {...p} className={SELECT} disabled={v.plannedDay === null} value={v.plannedHour ?? ''} onChange={(e) => set({ plannedHour: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{t('anyTime')}</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h, prefs)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      <div className="grid gap-2">
        <Button type="button" variant="outline" className="justify-self-start" disabled={pending} onClick={() => start(async () => setSlots(await suggest(v.accountId)))}>
          {t('dialog.suggest')}
        </Button>
        {slots && !slots.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {tErr(slots.error)}
          </p>
        ) : null}
        {slots && slots.ok ? (
          <div role="status" className="grid gap-2 text-xs text-muted-foreground">
            <p>{slots.reason ? t('dialog.suggestReason', { reason: tr(slots.reason), count: slots.sample }) : t('dialog.suggestBasis', { count: slots.sample })}</p>
            {!slots.reason && slots.slots.length === 0 ? <p>{t('dialog.suggestNone')}</p> : null}
            {slots.slots.length ? (
              <ul className="flex flex-wrap gap-2">
                {slots.slots.map((s) => (
                  <li key={s.day}>
                    <Button type="button" variant="outline" size="sm" onClick={() => set({ plannedDay: s.day, plannedHour: s.hour })}>
                      {t('dialog.slot', { day: formatDay(s.day, prefs), hour: formatHour(s.hour, prefs) })}
                    </Button>
                    <span className="ms-1">{t('dialog.slotBasis', { rate: formatPercent(s.value, prefs), count: s.count })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('dialog.tags')}</legend>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('dialog.noTags')}{' '}
            <Link href="/tags" className="font-medium text-primary underline-offset-4 hover:underline">
              {t('dialog.manageTags')}
            </Link>
          </p>
        ) : (
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {tags.map((tag) => {
              const on = picked.includes(tag.id);
              return (
                <label key={tag.id} className="flex min-w-0 items-center gap-1.5">
                  <Checkbox checked={on} disabled={!on && picked.length >= MAX_ITEM_TAGS} onCheckedChange={(c) => set({ tagIds: c === true ? [...picked, tag.id] : picked.filter((x) => x !== tag.id) })} />
                  <TagBadge tag={tag} />
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {v.status === 'ready' || v.status === 'posted' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('dialog.link')}</legend>
          <p className="text-xs text-muted-foreground">{t('dialog.linkHint')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="plan-item-link" checked={v.mediaId === null} onChange={() => set({ mediaId: null })} />
            {t('dialog.noLink')}
          </label>
          {candidates.length === 0 ? <p className="text-xs text-muted-foreground">{t('dialog.noCandidates')}</p> : null}
          {candidates.map((c) => (
            <label key={c.media.id} className="flex min-w-0 items-center gap-2 text-sm">
              <input type="radio" name="plan-item-link" checked={v.mediaId === c.media.id} onChange={() => set({ mediaId: c.media.id, status: 'posted' })} />
              <MediaThumb media={c.media} badges={false} className="w-10 shrink-0 rounded-sm" />
              <span className="min-w-0">
                <span className="block">
                  {tf(c.media.mediaType)} · {formatDateTime(c.media.postedAt, prefs)}
                </span>
                {c.match ? <span className="block text-xs text-primary">{t('dialog.match')}</span> : null}
              </span>
            </label>
          ))}
          {v.mediaId !== null && !candidates.some((c) => c.media.id === v.mediaId) ? (
            <Link href={postLabHref(v.accountId, v.mediaId)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('openPost')}
            </Link>
          ) : null}
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        {item ? (
          <Button type="button" variant="outline" className="text-destructive sm:me-auto" onClick={() => setConfirm(true)}>
            {t('dialog.delete')}
          </Button>
        ) : null}
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            {t('dialog.cancel')}
          </Button>
        </ResponsiveDialogClose>
        <LoadingButton type="submit" pending={pending} disabled={v.title.trim() === ''}>
          {t('dialog.save')}
        </LoadingButton>
      </ResponsiveDialogFooter>
      {item ? (
        <ConfirmDialog
          open={confirm}
          title={t('dialog.deleteTitle')}
          body={t('dialog.deleteBody', { title: item.title })}
          confirmLabel={t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          busy={pending}
          error={null}
          onConfirm={() => {
            setConfirm(false);
            run(() => remove(item.id), t('dialog.deleted'));
          }}
          onClose={() => setConfirm(false)}
        />
      ) : null}
    </form>
  );
}

/** New (item = null) or edit dialog of one card. Mounted fresh on every opening, so the form starts from the card. */
export function PlannerItemDialog({ open, onClose, ...form }: FormProps & { open: boolean; onClose: () => void }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveDialogContent className="md:max-h-[90dvh] md:overflow-y-auto">{open ? <ItemForm {...form} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

- [ ] **Step 4 — `components/plan/PlannerBoard.tsx`:**

```tsx
'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlannerItemDialog, type PlannerActions, type PlannerMedia } from '@/components/plan/PlannerItemDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSelect, FilterToolbar } from '@/components/shared/FilterToolbar';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import type { Tag } from '@/lib/analysis/types';
import { formatDay, formatHour } from '@/lib/format';
import { boardColumns, stepStatus, type PlannerItem, type PlannerStatus } from '@/lib/planner/items';
import { postLabHref } from '@/lib/post-lab/params';

export interface PlannerBoardProps extends PlannerActions {
  items: PlannerItem[];
  accounts: { id: string; username: string }[]; // live accounts only
  account: string | null; // the account filter (?account=), validated by the page
  basePath?: string; // where the board lives: '/plan', or a section of Plan 17d's page such as '/plan/board'
  tags: Tag[];
  media: PlannerMedia[]; // the live accounts' posts and Stories of the last 30 days: link candidates
}

/** The planner board (Plan 17f): four columns; every move by drag and drop OR by the arrow buttons (keyboard, touch). */
export function PlannerBoard({ items, accounts, account, basePath = '/plan', tags, media, save, move, remove, suggest }: PlannerBoardProps) {
  const t = useTranslations('planner');
  const tErr = useTranslations('planner.errors');
  const tf = useTranslations('analysis.format');
  const { prefs } = usePrefs();
  const [editing, setEditing] = useState<{ item: PlannerItem | null } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [, start] = useTransition();
  const refocus = useRef<string | null>(null);
  const live = new Set(accounts.map((a) => a.id));
  const shown = items.filter((i) => live.has(i.accountId) && (account === null || i.accountId === account));
  const handle = new Map(accounts.map((a) => [a.id, a.username]));
  const tagById = new Map(tags.map((tg) => [tg.id, tg]));
  const linked = new Map(items.flatMap((i) => (i.mediaId ? [[i.mediaId, i.id] as const] : [])));
  const hrefFor = (v: string) => (v ? `${basePath}${basePath.includes('?') ? '&' : '?'}account=${v}` : basePath); // v = a listed account id

  // A moved card re-renders in another column, which drops the keyboard focus: put it back on the card's title.
  useEffect(() => {
    const id = refocus.current;
    const el = id ? document.querySelector<HTMLElement>(`[data-plan-item="${id}"]`) : null;
    if (el) {
      el.focus();
      refocus.current = null;
    }
  }, [items]);

  const doMove = (it: PlannerItem, to: PlannerStatus) =>
    start(async () => {
      const r = await move(it.id, to);
      if (r.ok) refocus.current = it.id;
      setMessage(r.ok ? { text: t('moved', { title: it.title, column: t(`status.${to}`) }), error: false } : { text: tErr(r.error), error: true });
    });

  if (accounts.length === 0) return <EmptyState title={t('noAccounts')} />;

  return (
    <>
      <FilterToolbar
        label={t('filters')}
        end={
          <Button type="button" onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        }
      >
        {accounts.length > 1 ? (
          <FilterSelect
            id="plan-account"
            label={t('account')}
            value={account ?? ''}
            options={[{ value: '', label: t('allAccounts') }, ...accounts.map((a) => ({ value: a.id, label: `@${a.username}` }))]}
            hrefFor={hrefFor}
          />
        ) : null}
      </FilterToolbar>
      <p role={message?.error ? 'alert' : 'status'} className={message?.error ? 'mb-2 text-sm text-destructive' : 'sr-only'}>
        {message?.text}
      </p>

      {shown.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{t('dropHint')}</p>
          <div className="grid gap-[var(--gp)] md:grid-cols-2 xl:grid-cols-4">
            {boardColumns(shown).map((col) => (
              <section
                key={col.status}
                aria-labelledby={`plan-col-${col.status}`}
                className="min-w-0 rounded-[var(--rm)] border border-border bg-muted/40 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const it = shown.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                  if (it && it.status !== col.status) doMove(it, col.status);
                }}
              >
                <h2 id={`plan-col-${col.status}`} className="mb-2 flex items-baseline justify-between gap-2 px-1 text-sm font-semibold">
                  {t(`status.${col.status}`)}
                  <span className="text-xs font-normal text-muted-foreground">{t('count', { count: col.items.length })}</span>
                </h2>
                {col.items.length === 0 ? <p className="px-1 pb-2 text-xs text-muted-foreground">{t('emptyColumn')}</p> : null}
                <ul className="grid gap-2">
                  {col.items.map((it) => {
                    const prev = stepStatus(it.status, -1);
                    const next = stepStatus(it.status, 1);
                    const itemTags = it.tagIds.flatMap((id) => tagById.get(id) ?? []);
                    return (
                      <li key={it.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)} className="grid gap-1 rounded-md border border-border bg-card p-2 text-sm">
                        <button
                          type="button"
                          data-plan-item={it.id}
                          aria-label={t('edit', { title: it.title })}
                          className="text-start font-medium break-words hover:underline focus-visible:underline"
                          onClick={() => setEditing({ item: it })}
                        >
                          {it.title}
                        </button>
                        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {account === null && accounts.length > 1 ? <span>@{handle.get(it.accountId)}</span> : null}
                          {it.format ? <span>{tf(it.format)}</span> : null}
                          {it.plannedDay ? (
                            <span>
                              {formatDay(it.plannedDay, prefs)} {it.plannedHour === null ? t('anyTime') : formatHour(it.plannedHour, prefs)}
                            </span>
                          ) : null}
                        </p>
                        {it.notes ? <p className="line-clamp-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">{it.notes}</p> : null}
                        {itemTags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {itemTags.map((tg) => (
                              <TagBadge key={tg.id} tag={tg} />
                            ))}
                          </div>
                        ) : null}
                        {it.mediaId ? (
                          <Link href={postLabHref(it.accountId, it.mediaId)} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                            {t('openPost')}
                          </Link>
                        ) : null}
                        <div className="flex justify-between">
                          {prev ? (
                            <Button type="button" variant="ghost" size="sm" aria-label={t('moveTo', { title: it.title, column: t(`status.${prev}`) })} onClick={() => doMove(it, prev)}>
                              <ChevronLeft aria-hidden />
                            </Button>
                          ) : (
                            <span />
                          )}
                          {next ? (
                            <Button type="button" variant="ghost" size="sm" aria-label={t('moveTo', { title: it.title, column: t(`status.${next}`) })} onClick={() => doMove(it, next)}>
                              <ChevronRight aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <PlannerItemDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        item={editing?.item ?? null}
        accountId={account ?? accounts[0].id}
        accounts={accounts}
        tags={tags}
        media={media}
        linked={linked}
        save={save}
        remove={remove}
        suggest={suggest}
        onDone={(text) => {
          setEditing(null);
          setMessage({ text, error: false });
        }}
      />
    </>
  );
}
```

- [ ] **Step 5 — verify:** `npx vitest run tests/planner-board.test.tsx tests/messages.test.ts tests/ui-standards.test.ts` → pass (15 board tests); `npx tsc --noEmit`; `npx eslint components/plan tests/planner-board.test.tsx`.
- [ ] **Commit:** `git add components/plan/PlannerItemDialog.tsx components/plan/PlannerBoard.tsx tests/planner-board.test.tsx`, `git commit -m "feat(planner): board with keyboard and drag moves, card dialog with suggestions and post links" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 6B (Case B, expected): the Board section id in Plan 17d's page

**Files:** Modify `lib/plan/sections.ts`, `tests/plan-model.test.ts`, `tests/plan-views.test.tsx` (all from Plan 17d).

- [ ] **Step 1 — tests first.** `tests/plan-model.test.ts`: OLD `    expect(PLAN_SECTIONS).toEqual(['digest', 'goals']);` → NEW `    expect(PLAN_SECTIONS).toEqual(['digest', 'goals', 'board']);`. OLD `    for (const s of [['Goals'], ['board'], ['goals', 'x'], ['constructor']]) expect(routePlan(s)).toBeNull();` → NEW:

```ts
    expect(routePlan(['board'])).toEqual({ section: 'board' }); // Plan 17f
    for (const s of [['Goals'], ['Board'], ['board', 'x'], ['goals', 'x'], ['constructor']]) expect(routePlan(s)).toBeNull();
```

`tests/plan-views.test.tsx`: OLD `.toEqual(['Digest', 'Goals']);` (the `PlanNav` tab names) → NEW `.toEqual(['Digest', 'Goals', 'Board']);`.

- [ ] **Step 2 — run, see them fail:** `npx vitest run tests/plan-model.test.ts tests/plan-views.test.tsx`.
- [ ] **Step 3 — the code.** `lib/plan/sections.ts`: OLD `export const PLAN_SECTIONS = ['digest', 'goals'] as const;` → NEW `export const PLAN_SECTIONS = ['digest', 'goals', 'board'] as const;` (`PlanNav` renders the third tab from it with `plan.sections.board.title`, Task 1; `/plan` still redirects to the digest).
- [ ] **Step 4 — verify:** `npx vitest run tests/plan-model.test.ts tests/plan-views.test.tsx tests/messages.test.ts tests/tabs-model.test.ts` → pass; `npx tsc --noEmit` (the 17d page now has a `board` route the switch does not render yet: it falls through to the digest until Task 7B, which is harmless in between); `npx eslint lib/plan/sections.ts tests/plan-model.test.ts tests/plan-views.test.tsx`. If any OLD text differs (17d changed during its build), make the equivalent edit only when unambiguous and report it.
- [ ] **Commit:** `git add lib/plan/sections.ts tests/plan-model.test.ts tests/plan-views.test.tsx`, `git commit -m "feat(plan): Board section id (Plan 17f)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 6A (Case A only: 17d not built): the Plan nav item

**Files:** Modify `lib/nav.ts`, `public/sw.js`, `components/shared/AppShell.tsx`, `lib/tabs/model.ts`, `tests/nav.test.ts`, `tests/tabs-model.test.ts`, `tests/app-shell.test.tsx`. Exactly 17d's placement (between Explorer and Settings), so a later 17d finds it in place.

- [ ] **Step 1 — tests first.** `tests/nav.test.ts` OLD:

```ts
  it('lists the six main destinations in order', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/explorer', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'explorer', 'settings']);
```

NEW:

```ts
  it('lists the seven main destinations in order', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/explorer', '/plan', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'explorer', 'plan', 'settings']);
```

and OLD `    for (const href of ['/accounts', '/tags', '/settings']) expect(navHref(href, search)).toBe(href);` → NEW `    for (const href of ['/accounts', '/tags', '/plan', '/settings']) expect(navHref(href, search)).toBe(href);`

`tests/tabs-model.test.ts` OLD:

```ts
  it('isTabPath: the six main pages and everything below them, nothing else', () => {
    for (const p of ['/overview', '/accounts', '/accounts/7b0c', '/accounts/7b0c/media/123', '/tags', '/calendar', '/explorer', '/settings']) expect(isTabPath(p), p).toBe(true);
```

NEW:

```ts
  it('isTabPath: the seven main pages and everything below them, nothing else', () => {
    for (const p of ['/overview', '/accounts', '/accounts/7b0c', '/accounts/7b0c/media/123', '/tags', '/calendar', '/explorer', '/plan', '/settings']) expect(isTabPath(p), p).toBe(true);
```

`tests/app-shell.test.tsx` OLD `className).toContain('grid-cols-6'); // one column per item` → NEW `className).toContain('grid-cols-7'); // one column per item`.

- [ ] **Step 2 — run, see them fail:** `npx vitest run tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx tests/service-worker.test.ts`.
- [ ] **Step 3 — the code.** `lib/nav.ts` OLD `import { CalendarDays, ChartNoAxesCombined, CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';` → NEW `import { CalendarDays, ChartNoAxesCombined, CircleUserRound, ClipboardList, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';`. OLD:

```ts
  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/explorer' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'explorer' | 'settings';
```

NEW:

```ts
  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/explorer' | '/plan' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'explorer' | 'plan' | 'settings';
```

OLD `  { href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined },` → NEW:

```ts
  { href: '/explorer', key: 'explorer', icon: ChartNoAxesCombined },
  { href: '/plan', key: 'plan', icon: ClipboardList },
```

`public/sw.js` OLD `const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|settings)(\/|$)/;` → NEW `const TAB_PAGE = /^\/(overview|accounts|tags|calendar|explorer|plan|settings)(\/|$)/;`

`components/shared/AppShell.tsx` OLD `grid grid-cols-6 border-t` → NEW `grid grid-cols-7 border-t` (the phone bottom bar, one column per item).

`lib/tabs/model.ts` OLD `/** Pages that live in a tab: the six main sections and everything below them. Anything else breaks out of a frame. */` → NEW `/** Pages that live in a tab: the seven main sections and everything below them. Anything else breaks out of a frame. */`

- [ ] **Step 4 — verify:** `npx vitest run tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx tests/service-worker.test.ts tests/tab-host.test.tsx tests/frame-bridge.test.tsx` → pass; `npx tsc --noEmit`; `npx eslint lib/nav.ts components/shared/AppShell.tsx lib/tabs/model.ts tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx`.
- [ ] **Commit:** `git add lib/nav.ts public/sw.js components/shared/AppShell.tsx lib/tabs/model.ts tests/nav.test.ts tests/tabs-model.test.ts tests/app-shell.test.tsx`, `git commit -m "feat(nav): Plan item in the sidebar, the phone bar and the tab pages (Plan 17f, without 17d)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 7: mount the board (7B in Case B, 7A in Case A)

**Files (both cases):** Create `app/(app)/plan/planner-section.tsx`. **7B:** modify `app/(app)/plan/[[...section]]/page.tsx` (Plan 17d). **7A:** create `app/(app)/plan/page.tsx`, `app/(app)/plan/loading.tsx`; modify `tests/alert-message-smart.test.ts` only if it exists (Plan 17e).

- [ ] **Step 1 (both) — `app/(app)/plan/planner-section.tsx`** (server component: the reads and the wiring; the caller has run `requireOwner()`):

```tsx
import { getTranslations } from 'next-intl/server';
import { deletePlannerItemAction, movePlannerItemAction, savePlannerItemAction, suggestSlotsAction } from '@/app/(app)/plan/planner-actions';
import { PlannerBoard } from '@/components/plan/PlannerBoard';
import { EmptyState } from '@/components/shared/EmptyState';
import { loadAccounts } from '@/lib/dashboard/cached';
import { loadMonthMedia, loadTags } from '@/lib/dashboard/detail-read';
import { loadPlannerItems } from '@/lib/planner/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, daysToIso, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

/** Days of posts and Stories offered when linking a card to the post it became. */
const LINK_DAYS = 30;

/** The planner board's reads and wiring (Plan 17f). Server component; the caller has run requireOwner(). Rendered as
 *  Plan 17d's `board` section (`/plan/board`) or, without 17d, as the whole `/plan` page. */
export async function PlannerSection({ sp, basePath }: { sp: Record<string, string | string[] | undefined>; basePath: string }) {
  const [prefs, all, db, t] = await Promise.all([getPrefs(), loadAccounts(), createServerSupabase(), getTranslations('planner')]); // owner session: RLS applies
  const accounts = all.filter((a) => a.status !== 'archived').map((a) => ({ id: a.id, username: a.username })); // archived = hidden (SPEC §7c)
  const wanted = isUuid(sp.account) ? sp.account.toLowerCase() : null;
  const account = wanted && accounts.some((a) => a.id === wanted) ? wanted : null; // unknown/archived id → all accounts
  const today = localDay(new Date(), prefs.timezone);
  const { fromIso, toIso } = daysToIso(addDays(today, -LINK_DAYS), today, prefs.timezone);
  const [items, tags, recent] = await Promise.all([
    loadPlannerItems(db),
    loadTags(db),
    accounts.length ? loadMonthMedia(db, accounts.map((a) => a.id), fromIso, toIso) : { media: [], truncated: false },
  ]);
  if (items === null) return <EmptyState title={t('needsUpdate')} />;
  // only what the link list needs; the caption is the owner's own text, cut to an 80-character alt-text snippet
  const media = recent.media.map((m) => ({ id: m.id, accountId: m.accountId, mediaType: m.mediaType, postedAt: m.postedAt, cover: m.cover, slides: m.slides, caption: m.caption === null ? null : [...m.caption].slice(0, 80).join('') }));
  return (
    <PlannerBoard
      items={items}
      accounts={accounts}
      account={account}
      basePath={basePath}
      tags={tags}
      media={media}
      save={savePlannerItemAction}
      move={movePlannerItemAction}
      remove={deletePlannerItemAction}
      suggest={suggestSlotsAction}
    />
  );
}
```

- [ ] **Step 2B (Case B) — 17d's page.** In `app/(app)/plan/[[...section]]/page.tsx`: OLD `import { saveGoalsAction } from '@/app/(app)/plan/actions';` → NEW:

```tsx
import { saveGoalsAction } from '@/app/(app)/plan/actions';
import { PlannerSection } from '@/app/(app)/plan/planner-section';
```

and OLD:

```tsx
  if ('redirect' in route) redirect(route.redirect);
  const prefs = await getPrefs();
```

NEW (the board needs none of the digest / goals reads below, so it returns before them):

```tsx
  if ('redirect' in route) redirect(route.redirect);
  if (route.section === 'board') return <PlannerSection sp={sp} basePath="/plan/board" />; // Plan 17f
  const prefs = await getPrefs();
```

17d's `[[...section]]/loading.tsx` is the section skeleton (no new `loading.tsx`); 17d's layout gives the header and the tabs. Do NOT create `app/(app)/plan/page.tsx` in Case B (it would collide with `[[...section]]`). 17e's guard test needs no change (17d's route exists).

- [ ] **Step 2A (Case A) — the page.** `app/(app)/plan/loading.tsx` (`tests/route-loading.test.tsx` requires it):

```tsx
import { RouteLoading, SkeletonGrid, SkeletonHeader } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function PlanLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader />
      <Skeleton className="mb-[var(--gp)] h-[var(--ctl)] w-full max-w-md" />
      <SkeletonGrid count={4} className="gap-[var(--gp)] md:grid-cols-2 xl:grid-cols-4" itemClassName="h-48 rounded-[var(--rm)]" />
    </RouteLoading>
  );
}
```

`app/(app)/plan/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { PlannerSection } from '@/app/(app)/plan/planner-section';
import { PageHeader } from '@/components/shared/PageHeader';
import { requireOwner } from '@/lib/auth/require-owner';

// Plan 17f without Plan 17d (Case A): the board is the whole Plan page. With 17d the board is its `board` section.
export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const [sp, t] = await Promise.all([searchParams, getTranslations('planner')]);
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PlannerSection sp={sp} basePath="/plan" />
    </>
  );
}
```

If `tests/alert-message-smart.test.ts` exists (Plan 17e landed): its check "a `/plan` folder means the digest page exists" would now fail although there is no digest. Narrow it to 17d's own route (the same path 17e's Task 4 uses as its 17d check). OLD `    if (existsSync(join(process.cwd(), 'app/(app)/plan'))) expect(WEEKLY_REVIEW_HREF).toMatch(/^\/plan([/?]|$)/);` → NEW `    if (existsSync(join(process.cwd(), 'app/(app)/plan/[[...section]]'))) expect(WEEKLY_REVIEW_HREF).toMatch(/^\/plan([/?]|$)/); // Plan 17d's digest route; /plan alone is the 17f board`. If the line differs, STOP and report.

- [ ] **Step 3 — verify:** `npx vitest run tests/route-loading.test.tsx tests/planner-board.test.tsx tests/planner-actions.test.ts` (+ `tests/plan-views.test.tsx tests/plan-model.test.ts` in Case B, + `tests/alert-message-smart.test.ts` if it exists) → pass; `rm -rf .next`; `npx tsc --noEmit`; `npx eslint "app/(app)/plan"`. (No page test: wiring only; the orchestrator's `npm run check` builds it.)
- [ ] **Commit:** Case B: `git add "app/(app)/plan/planner-section.tsx" "app/(app)/plan/[[...section]]/page.tsx"`; Case A: `git add "app/(app)/plan/planner-section.tsx" "app/(app)/plan/page.tsx" "app/(app)/plan/loading.tsx"` (+ `tests/alert-message-smart.test.ts` if changed); then `git commit -m "feat(planner): mount the planner board under Plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 8: SPEC §7p, runbook, TODO, PROGRESS

**Files:** Modify `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`; create `docs/RUNBOOK_PLANNER.md`. Docs are CRLF: use the Edit / Write tools.

- [ ] **Step 1 — `docs/SPEC.md`:** insert immediately BEFORE the line `## 8. UI (v1)` (after any §7l–§7p of Plans 17a–17e; if §7p is taken, use the next free letter and say so):

```markdown
## 7p. Planner board (Plan 17f; creator-toolkit design §0b "planner board only", §6)
Status: code complete, NOT verified live (`docs/RUNBOOK_PLANNER.md`). Migration `20261105000001_planner_items.sql` (one owner-authored table) is NOT applied: apply only on the owner's go-ahead, BEFORE deploying; until then `/plan` says "The planner needs a database update".

- **Where:** the **Board** tab of the Plan page (§7o, `/plan/board`, after Digest and Goals); without Plan 17d the board is the whole `/plan` page with its own side-nav item (between Explorer and Settings). Not a Time Scope page. Account filter `?account=` in a `FilterToolbar` (hidden with one account), "New idea" at the end of that row.
- **Board:** four columns **Ideas → Drafting → Ready → Posted** (stacked on phones). A card = title (1–120 characters), notes (plain text, up to 2,000 characters), its account (required), an optional format (Reel / carousel / image / Story), an optional planned day and hour in the owner's timezone (wall clock), up to 10 tags, and once posted the post it became (a Post Lab link). Order inside a column: planned cards soonest first (Posted: latest first), then unplanned cards newest first; no manual order. At most 500 cards. Cards of archived accounts are hidden.
- **Moves:** drag a card to another column (desktop) or use its ← / → buttons (keyboard and touch); one owner-session server action per move; the result is announced and the focus returns to the card. Leaving Posted removes the post link.
- **Suggest a time** (on demand, in the card dialog): the account's "your post performance" heatmap (§7 best time: engagement rate by weekday × hour of all stored feed posts, cells with 2+ posts, nothing below 30 posts) → up to 3 slots in the next 7 days, one per day, skipping days that already hold a planned card of that account; with the number of posts and "Pattern, not proof."
- **Link a post** (Ready / Posted cards): the account's posts of the last 30 days (Stories only for a Story card), not linked to another card, the planned format first, then the nearest to the planned time; within ±3 hours = "Matches the planned time". The owner picks one (the card moves to Posted); nothing links by itself and the sync never writes.
- **Never:** publishing, scheduling, reminders or any call to Instagram; no uploads; no collaborators; no Calendar entries.
- **Data:** `planner_items` (id, account_id → accounts on delete cascade, title, notes, status `idea|drafting|ready|posted`, format, planned_day date, planned_hour 0–23 (only with a day), tag_ids uuid[] ≤ 10, media_id → media on delete set null (only when posted), created_at); owner-authored RLS (`is_owner()`); in "Export your data" (`planner_items.json`); deleted with its account and by "Delete all data" (cascade, `delete_all_data()` unchanged); counted in the database total of "Storage used" (`data_usage()` not replaced). Pure rules `lib/planner/items.ts`, read `lib/planner/read.ts`, actions `app/(app)/plan/planner-actions.ts`.
```

Then §8's page list: if Plan 17d added a Plan entry there, append ", planner board (§7p)" inside it; otherwise OLD `· Tags · Explorer (§7e) ·` → NEW `· Tags · Explorer (§7e) · Plan (planner board, §7p) ·`.

- [ ] **Step 2 — `docs/RUNBOOK_PLANNER.md`** (new):

```markdown
# Runbook: Planner board (Plan 17f) — live checks

The planner never talks to Instagram: nothing in it publishes, schedules or reminds. These checks need the owner (login with 2FA, real accounts). Report yes / no and counts; card texts are the owner's own.

## 0. The migration — on the owner's go-ahead, BEFORE deploying
`supabase/migrations/20261105000001_planner_items.sql` adds one table (`planner_items`, owner-only RLS). NOT applied.

    node --env-file=.env.local scripts/sb.mjs migration list        # expect only 20261105000001 pending (plus any earlier pending file)
    node --env-file=.env.local scripts/db-probe.mjs table:planner_items   # before: 404 PGRST205 (absent)
    node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file(s)
    node --env-file=.env.local scripts/sb.mjs db push --yes
    node --env-file=.env.local scripts/sb.mjs migration list        # expect N local / N remote / 0 mismatched
    node --env-file=.env.local scripts/db-probe.mjs table:planner_items   # after: 401 with code 42501 (exists, anon denied)

Before the migration the Plan page says "The planner needs a database update" (check once on a preview if convenient).

## 1. The board (L1, L2)
1. Side nav → Plan → Board tab (`/plan/board`; desktop sidebar, tablet rail, phone bottom bar). The tab strip shows Digest, Goals, Board at 360 px (L1).
2. New idea → title, notes with two lines, format Reel, a planned day and hour, two tags → Save. The card shows them; the notes keep their line break; a title like `<b>x</b>` shows as text.
3. Move the card with → to Drafting, then Ready, then ← back: the card moves, a screen reader announces "Moved … to …", the focus stays on the card (Tab continues from it).
4. Keyboard only: Tab to a card's → button, Enter. Escape closes the dialog and the focus returns.
5. Drag a card to another column with the mouse in Chrome, Edge, Firefox and Safari, inside an app-shell tab (L2). If a browser refuses, the arrows still work: note which.
6. Two accounts: the Account filter shows only that account's cards and survives a reload; "All accounts" shows the handle on each card.
7. 360 / 768 / 1280 px, light and dark of all 4 themes: columns stack on phones, 2 per row on tablets, 4 on wide screens; the dialog is a bottom sheet on phones.

## 2. Suggest a time (L3)
Open a card of an account with 30+ feed posts → Suggest a time. Up to 3 buttons in the next 7 days, never on a day that already has a planned card of that account, with "… N posts. Pattern, not proof." The slots are among the strongest cells of the account Overview's best-time heatmap ("your post performance"). An account with fewer than 30 posts says "Needs ~30+ posts for a reliable pattern (n = … posts)".

## 3. Link a real post (L4)
1. Plan a card (Reel, today, the hour you will post) and move it to Ready.
2. Post a Reel on Instagram at about that time. After the next sync (up to 30 minutes), open the card: the Reel is listed first with "Matches the planned time".
3. Pick it → Save: the card moves to Posted and shows "Open the post", which opens the right Post Lab page.
4. Move it back to Ready: the link is gone. Link it again; open another card: that Reel is not offered there.

## 4. Data (L5)
1. Tags and the planned day / hour saved through the real PostgREST come back unchanged after a reload (uuid[] and date + smallint, L5).
2. Settings → Data & privacy → Export: `planner_items` is in the list and downloads.
3. Delete a tag that a card uses: the card simply stops showing it.
4. (Only when the owner wants it) an account deleted for good removes its cards.

## 5. Privacy
No request to Instagram happens while using the board (DevTools Network: only same-origin requests). Nothing about cards appears in the sync log, notifications or push.

## Known limits (by design)
No reminders, no Calendar entries, no manual order, only posts of the last 30 days can be newly linked, at most 500 cards, touch devices move cards with the arrows.
```

- [ ] **Step 3 — `docs/TODO.md`:** insert immediately BEFORE the line `## 6b. Next (Plan 14/15 Settings)` (after any §6r–§6v of Plans 17a–17e; same letter rule):

```markdown
## 6w. Planner board (Plan 17f)
- [x] Plan page: board with Ideas / Drafting / Ready / Posted, moves by drag or arrow buttons, Suggest a time, link a card to its post (code done; live verification pending: docs/RUNBOOK_PLANNER.md)
- [ ] Apply migration `20261105000001_planner_items` (owner go-ahead, before deploying; RUNBOOK_PLANNER §0)
- [ ] RUNBOOK_PLANNER §1–§5 walked through by the owner (L1 360 px and the 7-item phone bar, L2 drag inside a tab, L3 suggestions, L4 a real post links, L5 PostgREST writes)
- Known: no reminders and no Calendar entries; only posts of the last 30 days can be newly linked; no manual order inside a column; at most 500 cards; drag and drop is mouse / pen only (touch uses the arrows); "Storage used" does not list the table on its own.
```

- [ ] **Step 4 — `docs/PROGRESS.md`:** (a) §2: insert before the line starting `| Open agents / worktrees |` the row `| Plan 17f (Planner board) | **code complete, NOT pushed, nothing verified live.** Migration 20261105000001_planner_items NOT applied (owner go-ahead, before deploying; RUNBOOK_PLANNER §0); without it /plan says "needs a database update". Nothing is ever sent to Instagram |`; (b) §3: insert before the line starting `Account page tabs now:` the bullet `- **17f: Planner board (code done, NOT verified live; migration 20261105000001 NOT applied).** Plan → Board (/plan/board, Plan 17d's page): Ideas / Drafting / Ready / Posted, moves by drag or arrow buttons, planned day + hour, tags, "Suggest a time" from the post-performance heatmap, link a card to the real post (owner confirms). No publishing, scheduling or reminders. Plan: docs/superpowers/plans/2026-11-01-17f-planner-board.md. Runbook: docs/RUNBOOK_PLANNER.md.`; (c) §5: append at the end of the migrations table (immediately before the blank line above `## 6. NOT verified live`) the row `| 20261105000001_planner_items | planner_items: owner-authored planner cards (Plan 17f; **NOT applied**: owner go-ahead, apply BEFORE deploying; RUNBOOK_PLANNER §0) |`; (d) §6: insert before the line starting `Record outcomes in the runbooks` the item `<next free number>. **docs/RUNBOOK_PLANNER.md** (Plan 17f): §0 migration, then §1–§5.`; (e) §8: append as the last bullet (immediately before the blank line above `## 9. How to work here`) `- 17f: columns Ideas / Drafting / Ready / Posted, every card has one account, planned day + hour in the owner timezone (wall clock), no manual order, arrows + native drag, link offered from the last 30 days and confirmed by the owner (±3 h = match), Suggest a time from the post-performance heatmap on demand, 500 cards, no reminders / Calendar entries, data_usage() not replaced.`
- [ ] **Commit:** `git add docs/SPEC.md docs/RUNBOOK_PLANNER.md docs/TODO.md docs/PROGRESS.md`, `git commit -m "docs(planner): SPEC 7p, runbook, todo, progress for the planner board" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

## Scratch-run result (2026-10-30, throwaway clone and PGlite OUTSIDE the repo)

**Code (throwaway `git clone` of `main` at `81054d7`, own `npm ci`, the real `node_modules` untouched; Case A, i.e. without Plans 17a–17e):** every block of Tasks 1–7 was written as given here. Targeted runs: `tests/planner-items.test.ts` 33 / 33, `tests/planner-migration.test.ts`, `tests/planner-actions.test.ts`, `tests/planner-board.test.tsx` 15 / 15, plus the touched existing suites (`messages`, `ui-standards`, `nav`, `tabs-model`, `app-shell`, `service-worker`, `settings-data`, `data-export`, `route-loading`, `migrations`) all green. Full `npm run check` (lint + tsc + every test + `next build`): `eslint .` exit 0, `tsc --noEmit` exit 0, `next build` exit 0 (route `ƒ /plan` listed), the whole Vitest suite 307 files / 3,159 tests passed (`--pool=threads`; the first `npm run check` run had all 297 files passing but exited 1 on ten "Failed to start forks worker" load timeouts, the known PROGRESS §10 machine-load issue, so the suite was rerun with threads). Findings fixed during the dry run and already in the blocks above: a post linked to another card is never offered (the first board fixture used such a post); the migration test reads literals so Task 2 does not depend on Task 3 in the same wave; the delete message is its own key; the reason line under "Suggest a time" is a translated key (no hard-coded "n =").

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; all 16 existing migrations, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.users` / `auth.mfa_factors` / `storage.*`; roles `anon`, `authenticated`, `service_role` (bypassrls) with Supabase-like default privileges), 35 of 35 checks passed — and again 35 of 35 with Plan 17b's `20261101000001` and Plan 17c's `20261102000001` (taken from their plans) applied before this one:** the migration applies as the newest; the owner (aal1, no factor) inserts a minimal card (defaults `idea`, `''`, `{}`, nulls); 120 code points of CJK + emoji pass; refused with 23514: empty title, untrimmed title, 121 characters, 2,001 characters of notes, unknown status, unknown format, hour 24, hour without a day, 11 tags, a null tag id, a 2-D tag array, a linked post on an idea; refused with 23503: an unknown post, an unknown account; a full card (Reel, day + hour, two tags) inserts; linking sets `posted` + `media_id`; moving a linked card back without dropping the link is refused (23514) and with `media_id = null` (what the move action sends) works; another signed-in user sees 0 cards, cannot insert (42501) and updates nothing; `anon` gets "permission denied"; the owner at aal1 with a verified factor sees 0 cards, at aal2 all of them; deleting a post sets `media_id` null and keeps the card (status stays `posted`, the check still holds); deleting an account removes only its cards; indexes `planner_items_pkey`, `planner_items_account_idx`, `planner_items_media_idx` exist; the UNCHANGED `delete_all_data()` (16c) run as `service_role` empties `planner_items` through the account cascade, a second call is a no-op, and `authenticated` cannot call it (42501).

**Case A vs Case B:** the code above was dry-run as Case A (the board as the `/plan` page; nav item between Explorer and Settings, like 17d; after moving the reads into `planner-section.tsx`: eslint, tsc, the 13 affected test files (199 tests) and `next build` green again). Case B was checked only in part: 17d's `lib/plan/sections.ts` (taken verbatim from the 17d plan) with Task 6B's edit passes 17d's own `routePlan` assertions as edited in 6B (`['board']` → the section, `['Board']` / `['board', 'x']` → 404). 17d's page, layout and `PlanNav` were NOT built in the clone (17d's plan appeared while this plan was being finished): the two Edit anchors of Task 7B and the tab-name line of 6B are copied from the 17d plan text; the `PlannerSection` props are the ones compiled in Case A.

**Not executed:** a real PostgREST (uuid[] / date / smallint writes from supabase-js: L5), a browser (drag and drop inside the 14c tab iframe: L2; 360 px phone bar: L1), Supabase, Vercel.

## Self-review

- Roadmap 17f coverage: four columns (Decision 3, renamed per the owner's brief), drag optional + every move without drag (Tasks 5), item fields with caps (Tasks 2–3), slot suggestions not taken by another planned card (Task 3 `suggestSlots`, Task 4 action), auto-link = owner-confirmed link within ±3 h with "two candidates → nearest" and "already linked" covered (Task 3 tests, DST case), tags (array, max 10), owner-all RLS + cascade + `media_id` set null, 500 cap, export entry, runbook / SPEC / TODO / PROGRESS. Deviations from the roadmap: column names (owner), no Post Lab verdict on the card, no Calendar entries (optional in the roadmap), no `updated_at` / `position` columns (nothing reads them).
- Names checked against the code by grep: `normalizeTagName`, `isUuid`, `isMediaId`, `isDay`, `daysBetween`, `localDay`, `localHour`, `addDays`, `daysToIso`, `weekdayOf`, `postHeatmap`, `Heatmap`, `MissingReason`, `MediaKind`, `loadPostRows`, `loadTags`, `loadMonthMedia`, `loadAccounts`, `getPrefs`, `requireOwner`, `createServerSupabase`, `postLabHref`, `formatDay`, `formatHour`, `formatDateTime`, `formatPercent`, `usePrefs`, `FilterToolbar`, `FilterSelect`, `ResponsiveDialog*`, `FormField`, `ConfirmDialog`, `MediaThumb`, `ThumbMedia`, `TagBadge`, `EmptyState`, `PageHeader`, `LoadingButton`, `RouteLoading`, `SkeletonHeader`, `SkeletonGrid`, `EXPORT_TABLES`, `NAV_ITEMS`, `TAB_PAGE`, `analysis.format.*`, `analysis.reasons.*`.
