# Plan 17b: Insights feed + Today — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** (1) A ranked list of rule-based **findings** per account ("Posts on Tuesday evening reach 2.1× the median of your other posts", with `n`, a Low/Medium confidence word, the day and a link to the evidence) shown as a **Findings** card on the account Overview (top 5, "Show all"), each finding **dismissable** (for good) or **hidden for 7 days** (snooze). (2) A **Today** section at the top of the Overview that answers the four questions of the creator-toolkit design §0b in ten seconds: the latest settled day vs the same weekday of the 8 weeks before, what needs attention (reconnect / sync problems, reach drops, posting gaps, unanswered questions, breakouts), what works now (best post of the last 7 days vs the typical post of its format) and what is next (the next best slot, days since the last post).

**Architecture:** Pure rules in ONE new file `lib/analysis/insights.ts` (8 rules, each a function returning `Finding | null` or `Finding[]`, keys stable across reads, params = numbers and ids only). A pure Today model `lib/dashboard/today.ts` built from the Overview's existing reads (`loadOverviewInput`, read 64 days back instead of ≥ 18) plus one count per account (`loadUnansweredCounts`, one `comment_list` call of one row; counts only). One owner-authored table `insight_dismissals` (migration `20261101000001_insight_dismissals.sql`, NEVER applied by an implementer), read BY KEY (`lib/dashboard/dismissals.ts`) and written by one owner-session server action (`app/(app)/overview/insight-actions.ts`). UI: `components/shared/FindingsList.tsx` (second use: account Overview and Today), `components/overview/TodaySection.tsx`, wiring in `OverviewView`, `AccountOverview` (the Findings card **replaces** the old "Flags" card) and the two pages. Without the migration everything works except the dismiss buttons ("Dismissing findings needs a database update").

**Tech Stack:** Next.js 16.4 App Router (server components, server actions), React 19.3 (`useTransition`), TypeScript strict, `@supabase/supabase-js` (installed), next-intl 4, shadcn via `Card`, `Badge`, `Button`, Vitest + Testing Library + jsdom. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Overview = Today briefing", the four questions) and §6 ("Insights feed: rule-based findings with evidence, freshness, dismiss/snooze"); roadmap `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §1.1, §3 "17b", §4 (defaults approved as working assumptions), §5. **`docs/SPEC.md` does not contain the feed or Today yet: Task 8 adds §7m; the owner must nod at the plan review before Wave 1 starts (CLAUDE.md "do not build ahead of approval").** All roadmap rules "that apply to EVERY plan" (§3) apply here and are not repeated.

**Order with 17a and 17c (execute 17a → 17b → 17c).** 17b does **not** import any 17a code and builds on current `main` (`81054d7`) without it (the dry run proves it). Its patch blocks are `git diff` against `81054d7`; 17a (`2026-11-01-17a-content-lab.md`) also edits `lib/dashboard/account.ts` (TABS line), `app/(app)/accounts/[id]/(tabs)/page.tsx` (a new `case 'content'`), `tests/dashboard-account.test.ts`, `tests/account-view.test.tsx`, `tests/account-page.test.tsx` and `messages/*.json`, so after 17a some hunks of Tasks 1 and 6 will drift: their intent is unambiguous (different lines), so implementers make the equivalent edit by hand and list it (implementer rules §3). 17c (`2026-11-01-17c-auto-tagging.md`, migration `20261102000001`, TODO §6t, SPEC §7n) comes after 17b and also edits `lib/data/export.ts` / `tests/settings-data.test.tsx` (it must count from 17b's numbers: 19 / 21 files). Names reserved by 17b: migration `20261101000001_insight_dismissals.sql`, i18n top-level `insights` and `settings.data.tables.insight_dismissals`, SPEC §7m, TODO §6s, `docs/RUNBOOK_INSIGHTS.md`, files `lib/analysis/insights.ts`, `lib/dashboard/{today,dismissals}.ts`, `components/shared/FindingsList.tsx`, `components/overview/TodaySection.tsx`, `app/(app)/overview/insight-actions.ts`; no new route.
**Overlap with 17a's code:** Four rules overlap 17a's functions (best slot ↔ 17a `lib/analysis/splits.ts` `DAYPARTS` / `daypartAt` with the SAME boundaries 0–5 / 6–11 / 12–17 / 18–23, format winner ↔ 17a formats split, posting gap ↔ 17a `lib/analysis/cadence.ts`, hashtag winner ↔ 17a `lib/analysis/hashtags.ts`). 17b keeps its own minimal versions inside `lib/analysis/insights.ts` (≈ 15 lines each, built on existing helpers: `median`, `captionFeatures`, `weekdayOf`, `localDay`/`localHour`). 17b's opus review (Review Focus 7) gets one item: "make `daypartOf` reuse 17a's `DAYPARTS` from `lib/analysis/splits.ts` if it exists on `main`, and list the gap / hashtag medians as accepted duplicates (17b compares a group with the rest, 17a reports per-group medians)"; implementers of Task 3 follow this plan exactly and do not improvise.

**Scratch run:** every code block of Tasks 1–7 was written into a throwaway `git clone` of `main` at `81054d7` (WITHOUT 17a) in the session scratchpad (own `npm ci`; the real `node_modules` untouched) and the migration was executed on PGlite 0.3.15 on top of all 16 existing migrations. Results: "Scratch-run result" at the end.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

1. **⚠ SPEC gets §7m "Insights feed and Today" (Task 8).** Neither is in `docs/SPEC.md`; the creator-toolkit design §0b/§6 approved them in principle. Owner nod required at plan review.
2. **Defaults assumed from roadmap §4** (owner approved them as working assumptions): Q8 = Today lives on the Overview, the feed on the account Overview (no new nav item, no new route); no push (17e), no AI wording (17g), no new metrics, no sync change, no Meta call.
3. **⚠ Eight rules, no more** (roadmap §5: "a rule nobody acts on in a month is deleted"). Constants in `INSIGHTS` (`lib/analysis/insights.ts`):

   | Rule (kind) | Fires when | n | Medium when | Tone | Key id |
   |---|---|---|---|---|---|
   | `breakout` | a feed post of the last 7 days, ≥ 24 h old, reach ≥ 2× the median of the previous 20 feed posts (≥ 5 with reach) = SPEC §7 "Post taking off" (`takingOff`) | prior posts | n ≥ 10 | good | post id |
   | `reach_drop` | 7-day reach ≤ −20 % vs the 7 days before, both weeks ≥ 80 % covered (`reachDrop`) | 7 | never (Low) | bad | Monday of the settled day |
   | `unusual_day` | the settled day's followers change / reach / views / interactions vs the same weekday of the 8 weeks before: `weekdayAnomaly` unusual (robust z ≥ 3.5 and a move ≥ max(3, 10 %)), ≥ 4 values | same weekdays | n ≥ 6 | up good / down bad | `<metric>:<day>` |
   | `best_slot` | weekday × day part whose posts' median reach ≥ 1.5× the median of all other posts; ≥ 5 posts in the slot and ≥ 5 outside; ≥ 20 measured mature posts | posts in slot | slot ≥ 10 and rest ≥ 10 | tip | `<weekday>:<daypart>` |
   | `format_winner` | a format ≥ 1.3× the other formats' median, same guards | posts of format | same | tip | format |
   | `hashtag_winner` | posts with a hashtag ≥ 1.3× the posts without it, same guards; **account Overview only** (needs captions) | posts with it | same | tip | hashtag (≤ 60 code points) |
   | `posting_gap` | no feed post for ≥ max(2 × median gap between posting days, 3) days; ≥ 5 gaps in 180 days | gaps | n ≥ 10 | bad | last post id (a new post ends it) |
   | `unanswered` | ≥ 1 question of the last 7 days without a reply SEEN (`comment_list` question + unanswered filters of Plan 15c) | the count | never (Low: thread replies are not read) | bad | Monday of today |

   "Measured mature posts" = feed posts (no Stories) with reach > 0, posted between 180 and 7 days ago (owner-timezone days): a post younger than 7 days is still gathering reach (PROGRESS §10 "compare posts of the same age"). All post rules compare a group with **the rest** (never with itself included).
4. **⚠ Ranking** = problems (`bad`) first, then good news, then tips; inside a tone by the kind order above, newest day first, then key. No scores, no "freshness" weighting (roadmap §5).
5. **⚠ Keys** = `<kind>:<account uuid>:<id>`; the same input always gives the same key; a key changes only when the finding is a new one (a new week for the drop and questions, a new day for unusual days, a new last post for the gap). The server action accepts only `^(known kind):(lower-case uuid):[\p{L}\p{M}\p{N}_:.-]+$`, ≤ 200 characters (`parseFindingKey`).
6. **Day parts** (owner timezone, DST-safe through `localHour`): night 0:00–5:59, morning 6:00–11:59, afternoon 12:00–17:59, evening 18:00–23:59. The Findings card subtitle states them with `formatHour` (the owner's 12 / 24 h setting).
7. **⚠ Dismiss = for good; "Hide for 7 days" = snooze.** One row per key (`until` null = for good, a time = snooze). A dismissed key never returns; a NEW key of the same rule does (e.g. next week's drop). No undo button (the owner can wait for the next key; a later "Hidden findings" list is out of scope).
8. **⚠ The account Overview's "Flags" card is replaced by the Findings card** (breakout and reach drop are two of its rules, with n and a confidence word). `AccountOverviewModel.flags` is removed (no other reader). The Overview account cards keep their flag lines and the PDF/Excel reports keep their flags section (unchanged; `pages.account.flagsTitle` / `noFlags` stay because the report reads `noFlags`).
9. **⚠ `takingOff` gains `n`** (the prior posts behind the median) so the breakout finding states its sample; one test line changes. The alert rules read only `postId` and `ratio` (unchanged).
10. **Today is above the range bar** (`PageHeader` → Today → `RangeBar` → KPI cards …): the range does not apply to Today and the subtitle says so. Only healthy accounts (card state `ok`) get the day / working / next lines; `needs_reconnect` and a failing sync appear under "Needs attention" (from `AccountCard.state` / `syncErrorKey`, i.e. `cardState`). "Needs attention" lists problems, then findings of tone `bad` and breakouts, at most 8. Tips are on the account Overview only.
11. **Reads.** Overview: `loadOverviewInput` from `min(readFrom(scope), today − 64 days)` (64 = 8 weeks + 3 days lag + the day before; was ≥ 18 days): ≤ ~64 extra small rows per account; posts unchanged (newest 500). Then in parallel the existing `loadSyncProgress` and `loadUnansweredCounts` (one rpc per account with the comments scope), then ONE dismissals read by the keys on screen (chunks of 50). Account Overview: the same 64-day floor, `loadPostRows` (captions + tag ids) instead of `loadPosts` for the account's own posts (the hashtag rule needs captions; the Posts tab reads the same rows), the count and the dismissals. All owner session. Budget: Overview ≤ 1.2 s p75 (RUNBOOK_INSIGHTS §4 measures it).
12. **Privacy.** Counts only from `comments` (the rpc rows' username and text never leave `lib/comments/read.ts`); finding params never contain usernames, comment text or captions; the hashtag rule's param and key hold the owner's OWN hashtag (owner text, shown as React text, never in a URL); the Today section shows the owner's own account handles. Nothing is logged. `insight_dismissals` is exported by "Export your data" (owner-authored) and deleted by the account cascade (so `delete_all_data()` needs no change); `data_usage()` is not replaced for a table of a few KB (it counts in the database total).
13. **No Server-Timing in pages** (App Router server components cannot set headers; the proxy already sends `auth`/`proxy`). RUNBOOK_INSIGHTS §4 measures the document time in DevTools before/after.
14. **`?findings=all`** on the account Overview = view-only pick written with `history.replaceState` (UI standard 14); the server reads it only on a full load (initial state).

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_INSIGHTS.md`)

1. **⚠ The 8 rules and their thresholds** (Decision 3). Default as shown. Alternative: drop `hashtag_winner` (roadmap: "value doubtful if the owner uses few hashtags"; it already stays silent below 20 posts / 5 with a tag).
2. **Replace the Flags card** (Decision 8). Default yes. Alternative: keep both cards.
3. **Snooze length** 7 days (Decision 7). Alternative: 3 or 14.
4. **L1 — rules on real data make sense** (no finding that the owner calls wrong in a week of use; especially `unusual_day` noise and the `best_slot` with Low confidence).
5. **L2 — dismiss survives a reload and another shell tab**, and `.in('finding_key', …)` with keys containing `:` and a non-ASCII hashtag works through the real PostgREST (unit-tested with a fake only).
6. **L3 — Overview latency** with the 64-day read, the count rpc per account and the dismissals read: ≤ 1.2 s p75 warm.
7. **L4 — the unanswered count matches** the Comments tab → Unanswered questions filtered to the last 7 days (same rpc, same filters).

## Owner prerequisites

1. **Apply `supabase/migrations/20261101000001_insight_dismissals.sql`** on the owner's explicit go-ahead, BEFORE deploying (PROGRESS §9 commands; RUNBOOK_INSIGHTS §0). Until then the feed and Today work and show "Dismissing findings needs a database update" instead of buttons.
2. Nothing else (no secret, no Meta or Supabase setting).

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- `lib/analysis/flags.ts:13-15` `Flag` union; `:24` `takingOff(posts, now, withinDays = 7, ratio)` builds `prior` (`:32`) and pushes `{ kind, postId, permalink, postedAt, ratio }` (`:34`); `:40` `reachDrop(rows, today, tz)` → `{ kind: 'reach_drop', change } | null`. `tests/analysis-flags.test.ts:15` pins the taking-off object with `toEqual`.
- `lib/analysis/trend.ts:10` `ANOMALY = { weeks: 8, minSamples: 4, threshold: 3.5, … }`; `:46` `weekdayAnomaly(series, day)` → `Anomaly | { reason: 'few_samples'; n } | null`.
- `lib/analysis/growth.ts:90` `summarize(rows, posts, window, today, tz, cmp)` → `endDay` = the settled day; `:40` `MAX_LAG_DAYS = 3`.
- `lib/analysis/posts.ts:17` `median`; `lib/analysis/best-time.ts:25` `weekdayOf(day)` (0 = Sunday); `lib/analysis/caption.ts:5` `CAPTION_MIN_POSTS = 20`, `:30` `captionFeatures(caption).hashtags` (lower case, unique, no `#`).
- `lib/sync/time.ts` `localDay`, `localHour`, `addDays`, `daysToIso`, `dayStart`; `lib/time-scope/range.ts:29` `daysBetween`, `:31` `minDay`, `:44` `weekOf(day, weekStart)`; `lib/time-scope/scope.ts:163` `readFrom(scope, today)`.
- `lib/post-lab/params.ts:24` `postLabHref(accountId, mediaId, query = '')`.
- `lib/dashboard/overview.ts:12` `CardState`, `:14` `AccountCard` (`state`, `syncErrorKey`, `username`), `:53` `buildOverview`; `lib/dashboard/read.ts:138` `OverviewInput { accounts, sync, daily, posts }`, `:146` `loadOverviewInput(db, fromDay, tz)`.
- `lib/dashboard/account.ts:5` imports `reachDrop, takingOff, type Flag`; `:48` `flags: Flag[]` in `AccountOverviewModel`; `:58` `const drop = …`; `:82` the `flags:` line. `tests/dashboard-account.test.ts:35`, `:52`, `:65` read `m.flags`.
- `components/account/AccountOverview.tsx:5` imports `TrendingDown, TrendingUp, TriangleAlert`; `:132-161` the Flags `ChartCard`; `:42` the component signature. `tests/account-view.test.tsx:130`, `:137` (the "Post taking off" link) and `:162` (`zh.pages.account.noFlags`).
- `app/(app)/accounts/[id]/(tabs)/page.tsx:157-173` the default (Overview) case reading `loadDaily`, `loadPosts`, …, rendering `<AccountOverview … audience={…} />`. `tests/account-page.test.tsx:24-31` mocks `@/lib/comments/read` (no `loadUnansweredCounts`) and has no mock of `@/lib/dashboard/dismissals`.
- `app/(app)/overview/page.tsx:21-25` reads `loadOverviewInput(db, readFrom(time, today), …)`, then `loadSyncProgress`, renders `<OverviewView … />`. No test imports this page.
- `components/overview/OverviewView.tsx:237` `OverviewView({ model, today, exportButton, progress })`, `:250-251` `PageHeader` then `RangeBar` inside `header`.
- `lib/comments/read.ts:23` private `paged(db, fn, args, page, size, map)`; it is the ONLY module allowed to call `comment_*` (`tests/comments-privacy.test.ts:48`). `lib/comments/question.ts` `QUESTION_PATTERN`. `lib/accounts/scopes.ts` `COMMENTS_SCOPE`, `hasScope`.
- `lib/data/export.ts:19-40` `EXPORT_TABLES`; `tests/data-export.test.ts` checks each entry's `keys` against `create table public.<name> (` … `\n);` and scans column names for secret-looking words (`finding_key` passes).
- `messages/*.json` line 1265: `  "notifications": {` (top level, two spaces) in both files; `pages.account.growth.weekday.{0..6}` holds full weekday names; `analysis.format.*`; `accounts.errors.*`.
- `components/shared/NavLink.tsx`, `components/ui/{badge,button,card}.tsx`; tokens `border-l-destructive`, `border-l-success` (`--success` in `styles/tokens.css`), `border-l-primary`.

## Out of scope

Push for findings (17e), AI wording (17g), goals / digest (17d), a "hidden findings" list or undo, cross-account findings on the account page, Stories rules, video length, competitor data, new metrics or any sync / Meta change, `data_usage()` replacement, the Explorer.

## Global Constraints

- Ponytail: one rules file, one model file, one table, one action; no scoring engine, no plugin registry. **No new dependency.**
- TypeScript strict; tests with fakes only; lib / action tests `// @vitest-environment node` where they do not render.
- Owner session only (`createServerSupabase`); never `createAdminSupabase` in any 17b file. No logging in any 17b file.
- Every UI string in `messages/en.json` AND `messages/zh-CN.json` (Task 1 adds all of them, text insertion only). Dates / numbers only via `lib/format.ts`. Tokens only. 360 / 768 / 1280 px. UI standards 5 (the dismiss buttons are `size="sm"` inside a dense list; the "Show all" button is alone in its row), 7, 14 (basis, n, Low / Medium, "Patterns, not proof"), 16 (hashtag as text).
- Migration file NEVER applied by an implementer. `npm run check` passes after every wave. Commits: conventional, `git add` only the listed paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus (opus read-only review after the last wave)

1. **Overclaiming:** no "High" anywhere (`findInsights` test), "Patterns, not proof." on both surfaces, guards (20 posts / 5 per side / 4 same weekdays / 5 gaps) never bypassed, young posts excluded from medians, `unanswered` always Low and worded "without a reply we can see".
2. **Key stability:** same input → same keys; key ids never contain time-of-read values; `parseFindingKey` refuses everything else (length, characters, unknown kind, upper-case uuid).
3. **Dismiss path:** `requireOwner()` first; owner session; `account_id` taken from the parsed key; RLS `is_owner()`; error keys only; no buttons when the table is missing.
4. **Overview latency:** reads in parallel, one rpc of one row per account, one keyed dismissals read; no N+1; the 64-day floor.
5. **Privacy:** no commenter data leaves `lib/comments/read.ts` (only `.total`); no caption text in params; hashtag never in an href.
6. **Empty / partial states:** no accounts, backfilling, needs_reconnect, no comments scope, no migration, < 20 posts: each says why (or stays silent), never NaN / 0 for unknown.
7. **17a overlap:** duplicated definitions listed for unification (Order with 17a).
8. **UI:** Today above the range bar, four regions with headings, works at 360 px (one column), light/dark of all themes; Findings card replaces Flags without breaking the report.

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | new top-level `insights` namespace (feed + `today`); `settings.data.tables.insight_dismissals` |
| `supabase/migrations/20261101000001_insight_dismissals.sql` (new), `tests/insights-migration.test.ts` (new) | 2 | the table, index, RLS, policy |
| `lib/analysis/insights.ts` (new), `tests/analysis-insights.test.ts` (new), `lib/analysis/flags.ts`, `tests/analysis-flags.test.ts` | 3 | the eight rules, ranking, keys, dismiss types |
| `lib/dashboard/dismissals.ts` (new), `app/(app)/overview/insight-actions.ts` (new), `lib/comments/read.ts`, `lib/data/export.ts`, `tests/insight-dismissals.test.ts` (new), `tests/settings-data.test.tsx` | 4 | dismissals read/write, the server action, the unanswered count, export entry |
| `lib/dashboard/today.ts` (new), `tests/dashboard-today.test.ts` (new), `components/shared/FindingsList.tsx` (new), `tests/findings-list.test.tsx` (new) | 5 | Today model; the shared findings list |
| `components/account/AccountOverview.tsx`, `lib/dashboard/account.ts`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/account-view.test.tsx`, `tests/dashboard-account.test.ts`, `tests/account-page.test.tsx` | 6 | Findings card on the account Overview |
| `components/overview/TodaySection.tsx` (new), `components/overview/OverviewView.tsx`, `app/(app)/overview/page.tsx`, `tests/today-section.test.tsx` (new) | 7 | Today on the Overview |
| `docs/SPEC.md`, `docs/RUNBOOK_INSIGHTS.md` (new), `docs/TODO.md`, `docs/PROGRESS.md` | 8 | spec section, runbook, progress |

**Adding i18n keys:** by TEXT INSERTION only (the patch below, or the Edit tool inserting the block before the line `  "notifications": {`), never by re-serialising the JSON.

**Applying the patch blocks:** `diff` blocks are `git diff` output against `81054d7`. Write each block to a file OUTSIDE the repo (ending with a newline), `git apply --check <file>`, then `git apply <file>` (implementer rules §3). The working copies are CRLF with `core.autocrlf=true`; `git apply` handles it. If a hunk does not apply, make the equivalent edit by hand only when the intent is unambiguous and report it.

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261101000001_insight_dismissals.sql`, `tests/insights-migration.test.ts` | 1, 3 |
| 3 rules | — | `lib/analysis/insights.ts`, `tests/analysis-insights.test.ts`, `lib/analysis/flags.ts`, `tests/analysis-flags.test.ts` | 1, 2 |
| 4 dismissals + count + action | 1, 3 | `lib/dashboard/dismissals.ts`, `app/(app)/overview/insight-actions.ts`, `lib/comments/read.ts`, `lib/data/export.ts`, `tests/insight-dismissals.test.ts`, `tests/settings-data.test.tsx` | 5, 8 |
| 5 Today model + FindingsList | 1, 3 | `lib/dashboard/today.ts`, `tests/dashboard-today.test.ts`, `components/shared/FindingsList.tsx`, `tests/findings-list.test.tsx` | 4, 8 |
| 6 account Overview | 4, 5 | `components/account/AccountOverview.tsx`, `lib/dashboard/account.ts`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/account-view.test.tsx`, `tests/dashboard-account.test.ts`, `tests/account-page.test.tsx` | 7 |
| 7 Overview Today | 4, 5 | `components/overview/TodaySection.tsx`, `components/overview/OverviewView.tsx`, `app/(app)/overview/page.tsx`, `tests/today-section.test.tsx` | 6 |
| 8 docs | 2 | `docs/SPEC.md`, `docs/RUNBOOK_INSIGHTS.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 4, 5 |

**Waves (at most 3 sonnet worktree agents; check free disk first, `Get-PSDrive C`):** **0** = the owner's nod on Decision 1 (SPEC §7m) at plan review. **1** = Tasks 1, 2, 3 → **2** = Tasks 4, 5, 8 → **3** = Tasks 6, 7. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log 2>&1` and READ the log — **search it for `×` and "failed"**: in the scratch run a failing test file printed `× …` while the wrapper still reported exit 0 (the vitest summary was cut off). Every wave leaves `main` green: wave 1 adds unused keys, an unapplied migration and an unused module; wave 2 adds an action and modules no page uses yet; wave 3 wires both pages. Then the opus review (Review Focus), ONE fix wave, check, commit.

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

Two insertions per file: the new top-level `insights` block immediately BEFORE the line `  "notifications": {`, and one export label `settings.data.tables.insight_dismissals` after the `explorer_views` label (Task 4 adds the table to "Export your data").

- [ ] **Step 1 — en:**

```diff
diff --git a/messages/en.json b/messages/en.json
index e9fc9c6..d899dda 100644
--- a/messages/en.json
+++ b/messages/en.json
@@ -425,6 +425,7 @@
         "tags": "Tags",
         "media_tags": "Tags on posts",
         "explorer_views": "Saved Explorer views",
+        "insight_dismissals": "Dismissed and hidden findings",
         "notifications": "Notifications",
         "moderation_settings": "Moderation settings",
         "moderation_rules": "Moderation rules",
@@ -1262,6 +1263,68 @@
       "few_posts": "Needs 5+ measured posts to compare"
     }
   },
+  "insights": {
+    "title": "Findings",
+    "source": "Rule-based, from this account's posts and daily insights. Posts younger than 7 days are left out of every median. Patterns, not proof.",
+    "dayparts": "Day parts in your timezone: night until {a}, morning until {b}, afternoon until {c}, evening after.",
+    "empty": "Nothing stands out right now.",
+    "basis": "n = {n} · {confidence} confidence · {date}",
+    "confidence": { "low": "Low", "medium": "Medium" },
+    "daypart": { "night": "night", "morning": "morning", "afternoon": "afternoon", "evening": "evening" },
+    "metric": { "followers": "Follower change", "reach": "Reach", "views": "Views", "interactions": "Interactions" },
+    "kind": {
+      "reach_drop": "Reach {change} over the last 7 days vs the 7 days before",
+      "posting_gap": "No post for {days} days; you usually post every {typical} days",
+      "unanswered": "{count, plural, one {# question} other {# questions}} in the last 7 days without a reply we can see",
+      "unusual_day": "{metric} on {date}: {value}, usually {typical} on a {weekday}",
+      "breakout": "A {format} posted {date} has {ratio}× the median reach of your previous posts",
+      "best_slot": "Posts on {weekday} {daypart} reach {ratio}× the median of your other posts",
+      "format_winner": "{format} posts reach {ratio}× the median of your other posts",
+      "hashtag_winner": "Posts with #{hashtag} reach {ratio}× the median of posts without it"
+    },
+    "open": "Show the evidence",
+    "dismiss": "Dismiss",
+    "snooze": "Hide for 7 days",
+    "dismissLabel": "Dismiss: {text}",
+    "snoozeLabel": "Hide for 7 days: {text}",
+    "hidden": "Hidden.",
+    "showAll": "Show all ({count})",
+    "showFewer": "Show fewer",
+    "needsUpdate": "Dismissing findings needs a database update.",
+    "errors": {
+      "invalid": "This finding can no longer be dismissed. Reload the page.",
+      "needs_update": "Dismissing findings needs a database update.",
+      "not_found": "This account no longer exists. Reload the page.",
+      "unexpected": "Could not save. Try again."
+    },
+    "today": {
+      "title": "Today",
+      "subtitle": "Your daily check. It does not follow the range below: the latest settled day, the last 7 days and what to do next.",
+      "dayTitle": "Latest day vs your normal",
+      "dayHint": "Each number vs the same weekday in the 8 weeks before (median).",
+      "dayLine": "@{username} · {date}",
+      "metricLine": "{metric}: {value}",
+      "typical": "usually {typical} (n = {n})",
+      "noTypical": "not enough history to compare (n = {n})",
+      "unusual": "Unusual",
+      "attentionTitle": "Needs attention",
+      "attentionEmpty": "Nothing needs you right now.",
+      "needsReconnect": "@{username} needs to be reconnected",
+      "syncError": "@{username} is not syncing: {error}",
+      "workingTitle": "Working now",
+      "workingHint": "Best post of the last 7 days. Recent posts are still collecting reach.",
+      "top": "@{username}: a {format} posted {date} reached {reach}",
+      "topVs": "{ratio}× the typical {format} (n = {n})",
+      "topNoTypical": "fewer than 5 earlier posts of this format to compare",
+      "noTop": "@{username}: no posts in the last 7 days",
+      "nextTitle": "Next",
+      "slot": "@{username}: next good slot {weekday} {daypart}, {date} (n = {n}, {confidence})",
+      "noSlot": "@{username}: not enough posts yet for a slot suggestion (needs 20 measured posts)",
+      "lastPost": "Last post {days, plural, =0 {earlier today} one {# day ago} other {# days ago}}",
+      "noPost": "No posts read yet",
+      "proof": "Patterns, not proof."
+    }
+  },
   "notifications": {
     "title": "Notifications",
     "bell": "Notifications, {count, plural, =0 {none unread} one {# unread} other {# unread}}",
```

- [ ] **Step 2 — zh-CN:**

```diff
diff --git a/messages/zh-CN.json b/messages/zh-CN.json
index 81779c4..43545c6 100644
--- a/messages/zh-CN.json
+++ b/messages/zh-CN.json
@@ -425,6 +425,7 @@
         "tags": "标签",
         "media_tags": "帖子上的标签",
         "explorer_views": "已保存的探索视图",
+        "insight_dismissals": "已忽略和隐藏的发现",
         "notifications": "通知",
         "moderation_settings": "审核设置",
         "moderation_rules": "审核规则",
@@ -1262,6 +1263,68 @@
       "few_posts": "至少需要 5 篇有数据的帖子才能对比"
     }
   },
+  "insights": {
+    "title": "发现",
+    "source": "基于规则，来自此账号的帖子和每日数据。发布不满 7 天的帖子不计入任何中位数。这是规律，不是证明。",
+    "dayparts": "按你的时区划分时段：凌晨至 {a}，上午至 {b}，下午至 {c}，之后为晚上。",
+    "empty": "目前没有值得注意的情况。",
+    "basis": "n = {n} · 可信度{confidence} · {date}",
+    "confidence": { "low": "低", "medium": "中" },
+    "daypart": { "night": "凌晨", "morning": "上午", "afternoon": "下午", "evening": "晚上" },
+    "metric": { "followers": "粉丝变化", "reach": "覆盖人数", "views": "观看次数", "interactions": "互动" },
+    "kind": {
+      "reach_drop": "近 7 天覆盖人数较前 7 天 {change}",
+      "posting_gap": "已经 {days} 天没有发帖；你通常每 {typical} 天发一次",
+      "unanswered": "近 7 天有 {count, plural, other {# 个问题}}尚未看到回复",
+      "unusual_day": "{date} 的{metric}：{value}，{weekday}通常为 {typical}",
+      "breakout": "{date} 发布的{format}覆盖人数是你之前帖子中位数的 {ratio} 倍",
+      "best_slot": "{weekday}{daypart}发布的帖子覆盖人数是其他帖子中位数的 {ratio} 倍",
+      "format_winner": "{format}帖子的覆盖人数是其他帖子中位数的 {ratio} 倍",
+      "hashtag_winner": "带 #{hashtag} 的帖子覆盖人数是不带它的帖子中位数的 {ratio} 倍"
+    },
+    "open": "查看依据",
+    "dismiss": "忽略",
+    "snooze": "隐藏 7 天",
+    "dismissLabel": "忽略：{text}",
+    "snoozeLabel": "隐藏 7 天：{text}",
+    "hidden": "已隐藏。",
+    "showAll": "显示全部（{count}）",
+    "showFewer": "收起",
+    "needsUpdate": "忽略发现需要先更新数据库。",
+    "errors": {
+      "invalid": "此发现已无法忽略，请刷新页面。",
+      "needs_update": "忽略发现需要先更新数据库。",
+      "not_found": "此账号已不存在，请刷新页面。",
+      "unexpected": "无法保存，请重试。"
+    },
+    "today": {
+      "title": "今日",
+      "subtitle": "你的每日检查。它不跟随下方的时间范围：最近一个已结算的日子、近 7 天以及下一步。",
+      "dayTitle": "最近一天与平常相比",
+      "dayHint": "每个数字都与之前 8 周的同一星期几（中位数）相比。",
+      "dayLine": "@{username}（{date}）",
+      "metricLine": "{metric}：{value}",
+      "typical": "通常为 {typical}（n = {n}）",
+      "noTypical": "历史数据不足，无法比较（n = {n}）",
+      "unusual": "异常",
+      "attentionTitle": "需要关注",
+      "attentionEmpty": "目前没有需要你处理的事项。",
+      "needsReconnect": "@{username} 需要重新连接",
+      "syncError": "@{username} 未在同步：{error}",
+      "workingTitle": "当前表现最好",
+      "workingHint": "近 7 天表现最好的帖子。新帖子的覆盖人数仍在增长。",
+      "top": "@{username}：{date} 发布的{format}覆盖了 {reach} 人",
+      "topVs": "是同类{format}通常水平的 {ratio} 倍（n = {n}）",
+      "topNoTypical": "此格式之前的帖子不足 5 篇，无法比较",
+      "noTop": "@{username}：近 7 天没有发帖",
+      "nextTitle": "下一步",
+      "slot": "@{username}：下一个好时段为{weekday}{daypart}，{date}（n = {n}，可信度{confidence}）",
+      "noSlot": "@{username}：帖子还不够，无法建议时段（需要 20 篇有数据的帖子）",
+      "lastPost": "上次发帖：{days, plural, =0 {今天} other {# 天前}}",
+      "noPost": "尚未读取到帖子",
+      "proof": "这是规律，不是证明。"
+    }
+  },
   "notifications": {
     "title": "通知",
     "bell": "通知，{count, plural, =0 {无未读} other {# 条未读}}",
```

- [ ] **Step 3 — verify:** `npx vitest run tests/messages.test.ts` → pass (same keys, same placeholders, zh differs from en). Notes found by the dry run: a plural branch written `=0 {today}` counts as a placeholder `{today}` for the guard (hence `{earlier today}`), and a string identical in both locales fails the "translated" guard (hence `@{username}（{date}）` in zh-CN).
- [ ] **Commit:** `git add messages/en.json messages/zh-CN.json`, `git commit -m "feat(i18n): insights feed and Today strings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 2: migration `insight_dismissals` (NEVER applied here)

**Files:** Create `supabase/migrations/20261101000001_insight_dismissals.sql`, `tests/insights-migration.test.ts`.

- [ ] **Step 1 — failing test** `tests/insights-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261101000001_insight_dismissals.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.insight_dismissals\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('insight dismissals migration', () => {
  it('is additive: one table, its index, RLS, one policy and a revoke; nothing else', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant|function)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it('a key per finding, bound to its account (cascade), an optional until', () => {
    const t = table();
    expect(t).toMatch(exact('finding_key text primary key check (char_length(finding_key) between 3 and 200)'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data" deletes every account
    expect(t).toMatch(/\buntil\s+timestamptz\s*,/i); // nullable: null = dismissed for good
    expect(t).toMatch(exact('created_at timestamptz not null default now()'));
    expect(sql).toMatch(exact('create index insight_dismissals_account_idx on public.insight_dismissals (account_id)')); // a linear cascade
  });

  it('owner-authored: RLS on, one for-all policy for authenticated owners (InitPlan form), anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.insight_dismissals enable row level security'));
    expect(sql).toMatch(exact('create policy insight_dismissals_owner_all on public.insight_dismissals for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.insight_dismissals from anon'));
  });
});
```

Run `npx vitest run tests/insights-migration.test.ts` → FAIL (file not found).

- [ ] **Step 2 — the migration** `supabase/migrations/20261101000001_insight_dismissals.sql` (if a later file name already exists in `supabase/migrations/`, STOP and report: the timestamp must stay the newest):

```sql
-- Plan 17b: Insights feed + Today. ONE owner-authored table: the findings the owner dismissed (until = null: for good)
-- or snoozed (until = the time they come back). A finding is computed on read (lib/analysis/insights.ts), never stored;
-- only its key is: `<kind>:<account id>:<id>`, no usernames, no comment text, no captions (the hashtag rule's key holds
-- the owner's own hashtag). Owner session under RLS (is_owner(), like tags / explorer_views); never the admin client.
-- account_id cascades, so deleting an account (and "Delete all data", which deletes every account) removes its rows:
-- delete_all_data() needs no change. The account_id index keeps that cascade linear (the 16c lesson).
create table public.insight_dismissals (
  finding_key text primary key check (char_length(finding_key) between 3 and 200),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  until       timestamptz,
  created_at  timestamptz not null default now()
);
create index insight_dismissals_account_idx on public.insight_dismissals (account_id);
alter table public.insight_dismissals enable row level security;
create policy insight_dismissals_owner_all on public.insight_dismissals
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.insight_dismissals from anon;
```

- [ ] **Step 3 — verify:** `npx vitest run tests/insights-migration.test.ts tests/migrations.test.ts` → pass (RLS + policy on every table, `to authenticated`, `(select …)` form). Do NOT run `supabase`, `db push` or anything that connects to a database.
- [ ] **Commit:** `git add supabase/migrations/20261101000001_insight_dismissals.sql tests/insights-migration.test.ts`, `git commit -m "feat(db): insight_dismissals table for dismissed and snoozed findings (not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 3: the rules (`lib/analysis/insights.ts`) and `n` on taking-off flags

**Files:** Create `lib/analysis/insights.ts`, `tests/analysis-insights.test.ts`. Modify `lib/analysis/flags.ts`, `tests/analysis-flags.test.ts`.

- [ ] **Step 1 — failing tests** `tests/analysis-insights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DailyRow } from '@/lib/analysis/types';
import {
  bestSlot,
  breakouts,
  daypartOf,
  findInsights,
  formatWinner,
  hashtagWinner,
  INSIGHTS,
  latestDay,
  measuredPosts,
  parseFindingKey,
  postingGap,
  reachDropFinding,
  unansweredFinding,
  unusualDays,
  visibleFindings,
  type Finding,
  type InsightPost,
} from '@/lib/analysis/insights';
import { addDays, localHour } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const TODAY = '2026-10-15'; // a Thursday
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const o = { today: TODAY, now: NOW, tz: KL };

const post = (id: string, postedAt: string, reach: number | null, x: Partial<InsightPost> = {}): InsightPost => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
/** n days ending yesterday, reach 100, followers +1 a day. */
const days = (n: number, f: (day: string, i: number) => Partial<DailyRow> = () => ({})): DailyRow[] =>
  Array.from({ length: n }, (_, i) => {
    const day = addDays(TODAY, i - n);
    return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day, i) };
  });
/** 19 ordinary posts (reach 100) every 3 days from 1 June at 10:00 KL, so no slot of theirs reaches 5. */
const ordinary = (n = 19, x: Partial<InsightPost> = {}) => Array.from({ length: n }, (_, i) => post(`o${i}`, `${addDays('2026-06-01', 3 * i)}T02:00:00Z`, 100, x));
/** 6 posts on Tuesdays (1 Sep 2026 is a Tuesday) at 19:00 KL (evening). */
const tuesdayEvenings = (reach: number, x: Partial<InsightPost> = {}) => Array.from({ length: 6 }, (_, i) => post(`t${i}`, `${addDays('2026-09-01', 7 * i)}T11:00:00Z`, reach, x));

describe('day parts and measured posts', () => {
  it('splits the owner-timezone hour into four parts', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(daypartOf)).toEqual(['night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });

  it('uses the owner timezone across a DST change (London: 17:30 UTC on 29 Mar 2026 is 18:30 BST, evening)', () => {
    expect(daypartOf(localHour(new Date('2026-03-29T17:30:00Z'), 'Europe/London'))).toBe('evening');
    expect(daypartOf(localHour(new Date('2026-03-28T17:30:00Z'), 'Europe/London'))).toBe('afternoon'); // still GMT the day before
  });

  it('keeps feed posts with reach > 0, at least 7 and at most 180 days old', () => {
    const list = [
      post('ok', '2026-10-01T02:00:00Z', 50),
      post('young', '2026-10-10T02:00:00Z', 50), // 5 days old: still gathering reach
      post('edge', `${addDays(TODAY, -INSIGHTS.matureDays)}T02:00:00Z`, 50),
      post('old', '2026-01-01T02:00:00Z', 50),
      post('story', '2026-10-01T02:00:00Z', 50, { mediaType: 'STORY' }),
      post('null', '2026-10-01T02:00:00Z', null),
      post('zero', '2026-10-01T02:00:00Z', 0),
      post('bad', 'not a date', 50),
    ];
    expect(measuredPosts(list, TODAY, KL).map((m) => m.p.id)).toEqual(['ok', 'edge']);
  });
});

describe('breakouts', () => {
  const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100));
  it('a post of the last 7 days at ≥ 2× the median of the previous posts, linked to its Post Lab', () => {
    const [f, ...rest] = breakouts([...history, post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS' })], A, NOW, KL);
    expect(rest).toEqual([]);
    expect(f).toEqual({ key: `breakout:${A}:hit`, accountId: A, kind: 'breakout', tone: 'good', params: { ratio: 9, format: 'REELS' }, n: 6, confidence: 'low', day: '2026-10-12', postId: 'hit', href: `/accounts/${A}/media/hit` });
  });

  it('nothing below the guard (4 earlier posts) or under 24 hours', () => {
    expect(breakouts([...history.slice(0, 4), post('hit', '2026-10-12T02:00:00Z', 900)], A, NOW, KL)).toEqual([]);
    expect(breakouts([...history, post('hit', '2026-10-15T00:00:00Z', 900)], A, NOW, KL)).toEqual([]);
  });
});

describe('reach drop', () => {
  it('7-day reach −50 % vs the week before, keyed by the Monday of the settled day', () => {
    const f = reachDropFinding(days(14, (_d, i) => ({ reach: i < 7 ? 100 : 50 })), A, TODAY, KL);
    expect(f).toMatchObject({ key: `reach_drop:${A}:2026-10-12`, tone: 'bad', params: { change: -0.5 }, n: 7, confidence: 'low', day: '2026-10-14', href: `/accounts/${A}?tab=growth` });
  });

  it('nothing when flat or when the weeks are too sparse to compare', () => {
    expect(reachDropFinding(days(14), A, TODAY, KL)).toBeNull();
    expect(reachDropFinding(days(5, () => ({ reach: 10 })), A, TODAY, KL)).toBeNull();
  });
});

describe('unusual day', () => {
  const eightWeeks = (f: (day: string, i: number) => Partial<DailyRow> = () => ({})) => days(60, f);
  it('the settled day vs the same weekday of the 8 weeks before; up is good news, Medium from 6 values', () => {
    const list = unusualDays(eightWeeks((d) => (d === '2026-10-14' ? { reach: 500 } : {})), A, TODAY, KL);
    expect(list).toEqual([
      { key: `unusual_day:${A}:reach:2026-10-14`, accountId: A, kind: 'unusual_day', tone: 'good', params: { metric: 'reach', value: 500, typical: 100, weekday: 3 }, n: 8, confidence: 'medium', day: '2026-10-14', postId: null, href: `/accounts/${A}?tab=growth&day=2026-10-14&why=reach` },
    ]);
  });

  it('a follower drop is bad news and links to the net-follows explanation', () => {
    const list = unusualDays(eightWeeks((d, i) => ({ followers: d === '2026-10-14' ? 1000 + i - 40 : 1000 + i })), A, TODAY, KL);
    expect(list).toEqual([expect.objectContaining({ key: `unusual_day:${A}:followers:2026-10-14`, tone: 'bad', params: { metric: 'followers', value: -39, typical: 1, weekday: 3 }, href: `/accounts/${A}?tab=growth&day=2026-10-14` })]);
  });

  it('nothing with fewer than 4 same-weekday values; latestDay says why', () => {
    const short = days(20, (d) => (d === '2026-10-14' ? { reach: 500 } : {}));
    expect(unusualDays(short, A, TODAY, KL)).toEqual([]);
    expect(latestDay(short, TODAY, KL).metrics.reach).toEqual({ reason: 'few_samples', n: 2 });
  });

  it('a missing value is not a finding (null, never 0)', () => {
    expect(latestDay(eightWeeks((d) => (d === '2026-10-14' ? { views: null } : {})), TODAY, KL).metrics.views).toBeNull();
  });
});

describe('best slot', () => {
  it('Tuesday evening posts reach 3× the other posts (n = 6, Low)', () => {
    const f = bestSlot([...ordinary(), ...tuesdayEvenings(300)], A, TODAY, KL);
    expect(f).toEqual({ key: `best_slot:${A}:2:evening`, accountId: A, kind: 'best_slot', tone: 'tip', params: { weekday: 2, daypart: 'evening', ratio: 3 }, n: 6, confidence: 'low', day: TODAY, postId: null, href: `/accounts/${A}` });
  });

  it('nothing under 20 measured posts, or below 1.5×', () => {
    expect(bestSlot([...ordinary(13), ...tuesdayEvenings(300)], A, TODAY, KL)).toBeNull();
    expect(bestSlot([...ordinary(), ...tuesdayEvenings(140)], A, TODAY, KL)).toBeNull();
  });
});

describe('format winner', () => {
  it('Reels reach 2.6× the other formats, linked to the Posts list of that format', () => {
    const f = formatWinner([...ordinary(20), ...Array.from({ length: 6 }, (_, i) => post(`r${i}`, `${addDays('2026-08-01', 5 * i)}T02:00:00Z`, 260, { mediaType: 'REELS' }))], A, TODAY, KL);
    expect(f).toMatchObject({ key: `format_winner:${A}:REELS`, params: { format: 'REELS', ratio: 2.6 }, n: 6, confidence: 'low', href: `/accounts/${A}?tab=posts&format=REELS` });
  });

  it('nothing with one format only', () => {
    expect(formatWinner(ordinary(25), A, TODAY, KL)).toBeNull();
  });
});

describe('hashtag winner', () => {
  const tagged = (caption: string | undefined) => [...ordinary(19, { caption: caption === undefined ? undefined : 'just a day #daily' }), ...tuesdayEvenings(300, { caption })];
  it('posts with #food reach 3× the posts without it; only the hashtag is a param, never the caption', () => {
    const f = hashtagWinner(tagged('Lunch was tasty #Food #daily'), A, TODAY, KL);
    expect(f).toMatchObject({ key: `hashtag_winner:${A}:food`, params: { hashtag: 'food', ratio: 3 }, n: 6, href: `/accounts/${A}?tab=posts` });
    expect(JSON.stringify(f)).not.toMatch(/tasty|Lunch/);
  });

  it('nothing when the captions were not read (the Overview reads none)', () => {
    expect(hashtagWinner(tagged(undefined), A, TODAY, KL)).toBeNull();
  });

  it('a very long hashtag is cut to 60 characters in the key, and the key still parses', () => {
    const long = '美'.repeat(80);
    const f = hashtagWinner(tagged(`#${long}`), A, TODAY, KL)!;
    expect(f.params.hashtag).toBe('美'.repeat(INSIGHTS.maxHashtag));
    expect(parseFindingKey(f.key)).toEqual({ kind: 'hashtag_winner', accountId: A });
  });
});

describe('posting gap', () => {
  const every2 = (lastDay: string, n = 20) => Array.from({ length: n }, (_, k) => post(`p${k}`, `${addDays(lastDay, -2 * k)}T04:00:00Z`, 100));
  it('no post for 6 days when you usually post every 2: keyed by the last post (a new post ends it)', () => {
    expect(postingGap(every2('2026-10-09'), A, TODAY, KL)).toEqual({ key: `posting_gap:${A}:p0`, accountId: A, kind: 'posting_gap', tone: 'bad', params: { days: 6, typical: 2 }, n: 19, confidence: 'medium', day: TODAY, postId: null, href: `/accounts/${A}?tab=posts` });
  });

  it('nothing at 3 days (under 2 × the median gap), with fewer than 5 gaps, or for Stories', () => {
    expect(postingGap(every2('2026-10-12'), A, TODAY, KL)).toBeNull();
    expect(postingGap(every2('2026-10-01', 5), A, TODAY, KL)).toBeNull();
    expect(postingGap(every2('2026-10-01').map((p) => ({ ...p, mediaType: 'STORY' as const })), A, TODAY, KL)).toBeNull();
  });
});

describe('unanswered questions', () => {
  it('a count only, always Low (thread replies are not read), linked to the questions view', () => {
    expect(unansweredFinding(3, A, TODAY)).toEqual({ key: `unanswered:${A}:2026-10-12`, accountId: A, kind: 'unanswered', tone: 'bad', params: { count: 3 }, n: 3, confidence: 'low', day: TODAY, postId: null, href: `/accounts/${A}?tab=comments&section=questions` });
    expect(unansweredFinding(0, A, TODAY)).toBeNull();
    expect(unansweredFinding(null, A, TODAY)).toBeNull();
  });
});

describe('findInsights', () => {
  const posts = [...ordinary(), ...tuesdayEvenings(300), post('hit', '2026-10-12T02:00:00Z', 2000, { mediaType: 'REELS' })];
  const input = { accountId: A, daily: days(14, (_d, i) => ({ reach: i < 7 ? 100 : 50 })), posts, unanswered: 2 };

  it('problems first, then good news, then tips; the same input gives the same keys', () => {
    const list = findInsights(input, o);
    expect(list.map((f) => f.kind)).toEqual(['reach_drop', 'unanswered', 'breakout', 'best_slot']);
    expect(findInsights(input, o).map((f) => f.key)).toEqual(list.map((f) => f.key));
    for (const f of list) expect(parseFindingKey(f.key)).toEqual({ kind: f.kind, accountId: A });
  });

  it('nothing at all for an account with no data', () => {
    expect(findInsights({ accountId: A, daily: [], posts: [], unanswered: null }, o)).toEqual([]);
  });

  it('never claims High', () => {
    for (const f of findInsights(input, o)) expect(['low', 'medium']).toContain(f.confidence);
  });
});

describe('dismissals', () => {
  const f = (key: string) => ({ key }) as Finding;
  const list = [f('a'), f('b'), f('c'), f('d')];
  it('hides dismissed keys for good and snoozed keys until their time', () => {
    const shown = visibleFindings(list, [{ key: 'a', until: null }, { key: 'b', until: '2026-10-20T00:00:00Z' }, { key: 'c', until: '2026-10-15T03:59:59Z' }], NOW);
    expect(shown.map((x) => x.key)).toEqual(['c', 'd']);
  });

  it('shows everything without dismissals (null = the migration is not applied)', () => {
    expect(visibleFindings(list, null, NOW)).toBe(list);
    expect(visibleFindings(list, [], NOW)).toBe(list);
  });
});

describe('parseFindingKey', () => {
  it('accepts known kinds with a lower-case uuid and a plain id', () => {
    expect(parseFindingKey(`best_slot:${A}:2:evening`)).toEqual({ kind: 'best_slot', accountId: A });
    expect(parseFindingKey(`unusual_day:${A}:reach:2026-10-14`)).toEqual({ kind: 'unusual_day', accountId: A });
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      42,
      '',
      `nope:${A}:1`,
      `breakout:${A.toUpperCase()}:1`,
      `breakout:${A}:`,
      `breakout:not-a-uuid:1`,
      `breakout:${A}:1 2`,
      `breakout:${A}:1,2`,
      `breakout:${A}:"x"`,
      `breakout:${A}:${'1'.repeat(INSIGHTS.maxKey)}`,
      `__proto__:${A}:1`,
    ])
      expect(parseFindingKey(bad), String(bad)).toBeNull();
  });
});
```

Run `npx vitest run tests/analysis-insights.test.ts` → FAIL (module not found).

- [ ] **Step 2 — `takingOff` states its sample.** Apply:

```diff
diff --git a/lib/analysis/flags.ts b/lib/analysis/flags.ts
index 097faec..a644040 100644
--- a/lib/analysis/flags.ts
+++ b/lib/analysis/flags.ts
@@ -11,7 +11,7 @@ export const MIN_AGE_HOURS = 24;
 export const REACH_DROP = -0.2;
 
 export type Flag =
-  | { kind: 'taking_off'; postId: string; permalink: string | null; postedAt: string; ratio: number }
+  | { kind: 'taking_off'; postId: string; permalink: string | null; postedAt: string; ratio: number; n: number } // n = prior posts behind the median
   | { kind: 'reach_drop'; change: number };
 
 const HOUR = 3_600_000;
@@ -31,7 +31,7 @@ export function takingOff(posts: Post[], now: Date, withinDays = 7, ratio = TAKI
     if (age < MIN_AGE_HOURS * HOUR || age > withinDays * 24 * HOUR || p.reach === null) return;
     const prior = feed.slice(Math.max(0, i - PRIOR_POSTS), i).map((x) => x.reach).filter((r): r is number => r !== null);
     const m = prior.length >= MIN_PRIOR_POSTS ? median(prior) : null;
-    if (m !== null && m > 0 && p.reach >= ratio * m) out.push({ kind: 'taking_off', postId: p.id, permalink: p.permalink, postedAt: p.postedAt, ratio: p.reach / m });
+    if (m !== null && m > 0 && p.reach >= ratio * m) out.push({ kind: 'taking_off', postId: p.id, permalink: p.permalink, postedAt: p.postedAt, ratio: p.reach / m, n: prior.length });
   });
   return out.reverse();
 }
```

and the test line:

```diff
diff --git a/tests/analysis-flags.test.ts b/tests/analysis-flags.test.ts
index 524c1ad..937a072 100644
--- a/tests/analysis-flags.test.ts
+++ b/tests/analysis-flags.test.ts
@@ -12,7 +12,7 @@ const history = (n: number, reach: number | null = 100) => Array.from({ length:
 describe('takingOff', () => {
   it('flags a post with ≥ 2× the median reach of the previous 20 posts', () => {
     const flags = takingOff([...history(20), post('hit', hoursAgo(30), 200), post('meh', hoursAgo(26), 150)], NOW);
-    expect(flags).toEqual([{ kind: 'taking_off', postId: 'hit', permalink: 'https://instagram.com/p/hit', postedAt: hoursAgo(30), ratio: 2 }]);
+    expect(flags).toEqual([{ kind: 'taking_off', postId: 'hit', permalink: 'https://instagram.com/p/hit', postedAt: hoursAgo(30), ratio: 2, n: 20 }]);
   });
 
   it('waits 24 h after posting and ignores posts older than the window', () => {
```

- [ ] **Step 3 — the rules** `lib/analysis/insights.ts`:

```ts
// Insights feed (Plan 17b, SPEC §7m): rule-based findings over ONE account's synced data. Pure: today, now and the
// timezone are inputs, never the clock. Every finding carries its evidence (params), its sample (n) and a confidence
// word, Low or Medium, never High: a rule finds a pattern, not a cause. Keys are stable across reads, so a dismissal or
// a snooze keeps hiding the same finding. Params hold numbers and fixed ids only (formats, weekdays, day parts, metric
// ids) and, for the hashtag rule, the owner's own hashtag; never usernames, comment text or captions.
// ponytail: eight rules; a rule nobody acts on in a month is deleted, not tuned (roadmap §5).
import { weekdayOf } from '@/lib/analysis/best-time';
import { CAPTION_MIN_POSTS, captionFeatures } from '@/lib/analysis/caption';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import { summarize } from '@/lib/analysis/growth';
import { median } from '@/lib/analysis/posts';
import { weekdayAnomaly, type AnomalyResult } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { postLabHref } from '@/lib/post-lab/params';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween, weekOf } from '@/lib/time-scope/range';

export const INSIGHTS = {
  readDays: 64, // daily rows a caller reads: 8 weeks of same-weekday history, Instagram's lag and the day before (follower change)
  lookbackDays: 180, // posts the post rules look at
  matureDays: 7, // a post younger than this is still gathering reach: left out of every median
  minPosts: CAPTION_MIN_POSTS, // measured, mature posts a post rule needs at all (20)
  minGroup: 5, // posts in a slot / format / with a hashtag, and on the other side
  mediumGroup: 10, // ... for Medium instead of Low
  slotRatio: 1.5,
  formatRatio: 1.3,
  hashtagRatio: 1.3,
  minGaps: 5, // gaps between posting days the gap rule needs
  mediumGaps: 10,
  gapFactor: 2, // "no post for N days" = N ≥ 2 × the median gap ...
  minGapDays: 3, // ... and at least 3 days
  mediumSamples: 6, // same-weekday values for a Medium unusual day (weekdayAnomaly needs 4)
  breakoutDays: 7, // breakouts of the last 7 days
  maxHashtag: 60, // code points of a hashtag kept in a key
  snoozeDays: 7,
  maxKey: 200, // characters of a key (the table checks it too)
} as const;

export const FINDING_KINDS = ['reach_drop', 'posting_gap', 'unanswered', 'unusual_day', 'breakout', 'best_slot', 'format_winner', 'hashtag_winner'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export type Tone = 'bad' | 'good' | 'tip';
const TONES: readonly Tone[] = ['bad', 'good', 'tip'];

export interface Finding {
  key: string; // `<kind>:<account id>:<id>`, stable across reads: the dismissal id
  accountId: string;
  kind: FindingKind;
  tone: Tone;
  params: Record<string, string | number>; // i18n parameters, formatted by the UI
  n: number; // the sample behind it
  confidence: 'low' | 'medium';
  day: string; // the owner-timezone day it is about
  postId: string | null;
  href: string; // same-origin path with the evidence
}

export const DAYPARTS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type Daypart = (typeof DAYPARTS)[number];
/** Owner-timezone day parts: night 0:00-5:59, morning 6:00-11:59, afternoon 12:00-17:59, evening 18:00-23:59. */
export const daypartOf = (hour: number): Daypart => DAYPARTS[Math.min(3, Math.max(0, Math.floor(hour / 6)))];

export type DayMetric = 'followers' | 'reach' | 'views' | 'interactions';
export const DAY_METRICS: readonly DayMetric[] = ['followers', 'reach', 'views', 'interactions'];

/** A post with its caption when the caller read it (the hashtag rule skips posts without one). */
export interface InsightPost extends Post {
  caption?: string | null;
}
export interface InsightInput {
  accountId: string;
  daily: DailyRow[]; // at least INSIGHTS.readDays back
  posts: InsightPost[]; // feed posts, newest first (Stories are ignored)
  unanswered: number | null; // questions without a reply seen, last 7 days; null = not read (no comments scope, no migration)
}

export type DismissMode = 'dismiss' | 'snooze';
export type DismissError = 'invalid' | 'needs_update' | 'not_found' | 'unexpected';
export type DismissResult = { ok: true } | { ok: false; error: DismissError };
/** A stored dismissal: until = null hides the key for good, a time hides it until then (snooze). */
export interface Dismissal {
  key: string;
  until: string | null;
}

const conf = (n: number, medium: number): 'low' | 'medium' => (n >= medium ? 'medium' : 'low');
const accountHref = (id: string, q = '') => `/accounts/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
const make = (accountId: string, kind: FindingKind, id: string, f: Omit<Finding, 'key' | 'accountId' | 'kind'>): Finding => ({ key: `${kind}:${accountId}:${id}`, accountId, kind, ...f });

export interface Measured {
  p: InsightPost;
  day: string;
  hour: number;
  reach: number;
}

/** Feed posts with reach > 0, posted between INSIGHTS.lookbackDays and INSIGHTS.matureDays ago (owner-timezone days). */
export function measuredPosts(posts: InsightPost[], today: string, tz: string): Measured[] {
  const from = addDays(today, -INSIGHTS.lookbackDays);
  const to = addDays(today, -INSIGHTS.matureDays);
  return posts.flatMap((p) => {
    const at = new Date(p.postedAt);
    if (p.mediaType === 'STORY' || p.reach === null || !(p.reach > 0) || Number.isNaN(at.getTime())) return [];
    const day = localDay(at, tz);
    return day >= from && day <= to ? [{ p, day, hour: localHour(at, tz), reach: p.reach }] : [];
  });
}

interface Win {
  key: string;
  ratio: number;
  n: number;
  rest: number;
}

/** The group whose median reach is the highest multiple of the median of every other post (≥ minGroup on both sides). */
function winner(m: Measured[], keysOf: (x: Measured) => string[]): Win | null {
  const by = new Map<string, Measured[]>();
  for (const x of m) for (const k of keysOf(x)) by.set(k, [...(by.get(k) ?? []), x]);
  let best: Win | null = null;
  for (const [key, group] of by) {
    const inside = new Set(group);
    const rest = m.filter((x) => !inside.has(x));
    if (group.length < INSIGHTS.minGroup || rest.length < INSIGHTS.minGroup) continue;
    const ratio = median(group.map((x) => x.reach))! / median(rest.map((x) => x.reach))!;
    if (!best || ratio > best.ratio || (ratio === best.ratio && key < best.key)) best = { key, ratio, n: group.length, rest: rest.length };
  }
  return best;
}

const winConf = (w: Win) => (w.n >= INSIGHTS.mediumGroup && w.rest >= INSIGHTS.mediumGroup ? 'medium' : 'low');

/** Feed posts of the last 7 days at ≥ 2× the median reach of the previous 20 (SPEC §7 "Post taking off", lib/analysis/flags.ts). */
export function breakouts(posts: InsightPost[], accountId: string, now: Date, tz: string): Finding[] {
  return takingOff(posts, now, INSIGHTS.breakoutDays).map((f) =>
    make(accountId, 'breakout', f.postId, {
      tone: 'good',
      params: { ratio: f.ratio, format: posts.find((p) => p.id === f.postId)!.mediaType },
      n: f.n,
      confidence: conf(f.n, INSIGHTS.mediumGroup),
      day: localDay(new Date(f.postedAt), tz),
      postId: f.postId,
      href: postLabHref(accountId, f.postId),
    }),
  );
}

/** 7-day reach ≤ −20 % vs the 7 days before (SPEC §7c), keyed by the week of the settled day. */
export function reachDropFinding(daily: DailyRow[], accountId: string, today: string, tz: string): Finding | null {
  const d = reachDrop(daily, today, tz);
  if (!d) return null;
  const end = summarize(daily, [], 7, today, tz).endDay;
  return make(accountId, 'reach_drop', weekOf(end, 'mon').from, { tone: 'bad', params: { change: d.change }, n: 7, confidence: 'low', day: end, postId: null, href: accountHref(accountId, 'tab=growth') });
}

/** The settled day (the KPIs' last day) and each metric on it vs the same weekday of the 8 weeks before (weekdayAnomaly).
 *  followers = the change of the follower count from the day before. */
export function latestDay(daily: DailyRow[], today: string, tz: string): { day: string; values: Record<DayMetric, number | null>; metrics: Record<DayMetric, AnomalyResult | null> } {
  const day = summarize(daily, [], 1, today, tz).endDay;
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const change = (d: string): number | null => {
    const a = byDay.get(d)?.followers ?? null;
    const b = byDay.get(addDays(d, -1))?.followers ?? null;
    return a !== null && b !== null ? a - b : null;
  };
  const series = (m: DayMetric): Record<string, number | null> => Object.fromEntries(daily.map((r) => [r.day, m === 'followers' ? change(r.day) : r[m]]));
  const all = Object.fromEntries(DAY_METRICS.map((m) => [m, series(m)])) as Record<DayMetric, Record<string, number | null>>;
  return {
    day,
    values: Object.fromEntries(DAY_METRICS.map((m) => [m, all[m][day] ?? null])) as Record<DayMetric, number | null>,
    metrics: Object.fromEntries(DAY_METRICS.map((m) => [m, weekdayAnomaly(all[m], day)])) as Record<DayMetric, AnomalyResult | null>,
  };
}

/** A metric of the settled day that weekdayAnomaly calls unusual (robust z ≥ 3.5 and a real move). */
export function unusualDays(daily: DailyRow[], accountId: string, today: string, tz: string): Finding[] {
  const { day, metrics } = latestDay(daily, today, tz);
  return DAY_METRICS.flatMap((metric) => {
    const a = metrics[metric];
    if (!a || 'reason' in a || !a.unusual) return [];
    return [
      make(accountId, 'unusual_day', `${metric}:${day}`, {
        tone: a.direction === 'up' ? 'good' : 'bad',
        params: { metric, value: a.value, typical: a.median, weekday: weekdayOf(day) },
        n: a.n,
        confidence: conf(a.n, INSIGHTS.mediumSamples),
        day,
        postId: null,
        href: accountHref(accountId, `tab=growth&day=${day}${metric === 'followers' ? '' : '&why=reach'}`),
      }),
    ];
  });
}

/** The weekday × day part whose posts reach the most vs every other post. */
export function bestSlot(posts: InsightPost[], accountId: string, today: string, tz: string): Finding | null {
  const m = measuredPosts(posts, today, tz);
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => [`${weekdayOf(x.day)}:${daypartOf(x.hour)}`]);
  if (!w || w.ratio < INSIGHTS.slotRatio) return null;
  const [weekday, daypart] = w.key.split(':');
  return make(accountId, 'best_slot', w.key, { tone: 'tip', params: { weekday: Number(weekday), daypart, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId) });
}

/** The format whose posts reach the most vs the posts of every other format. */
export function formatWinner(posts: InsightPost[], accountId: string, today: string, tz: string): Finding | null {
  const m = measuredPosts(posts, today, tz);
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => [x.p.mediaType]);
  if (!w || w.ratio < INSIGHTS.formatRatio) return null;
  return make(accountId, 'format_winner', w.key, { tone: 'tip', params: { format: w.key, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId, `tab=posts&format=${w.key}`) });
}

/** The hashtag whose posts reach the most vs the posts without it (only posts whose caption was read). */
export function hashtagWinner(posts: InsightPost[], accountId: string, today: string, tz: string): Finding | null {
  const m = measuredPosts(posts, today, tz).filter((x) => x.p.caption !== undefined);
  if (m.length < INSIGHTS.minPosts) return null;
  const w = winner(m, (x) => captionFeatures(x.p.caption ?? null).hashtags.map((h) => [...h].slice(0, INSIGHTS.maxHashtag).join('')));
  if (!w || w.ratio < INSIGHTS.hashtagRatio) return null;
  return make(accountId, 'hashtag_winner', w.key, { tone: 'tip', params: { hashtag: w.key, ratio: w.ratio }, n: w.n, confidence: winConf(w), day: today, postId: null, href: accountHref(accountId, 'tab=posts') });
}

/** No feed post for ≥ 2 × the median gap between posting days (and ≥ 3 days); keyed by the last post, so a new post ends it. */
export function postingGap(posts: InsightPost[], accountId: string, today: string, tz: string): Finding | null {
  const from = addDays(today, -INSIGHTS.lookbackDays);
  const feed = posts
    .filter((p) => p.mediaType !== 'STORY' && !Number.isNaN(Date.parse(p.postedAt)))
    .map((p) => ({ p, day: localDay(new Date(p.postedAt), tz) }))
    .filter((x) => x.day >= from && x.day <= today)
    .sort((a, b) => Date.parse(a.p.postedAt) - Date.parse(b.p.postedAt) || (a.p.id < b.p.id ? -1 : 1));
  const days = [...new Set(feed.map((x) => x.day))];
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  if (gaps.length < INSIGHTS.minGaps) return null;
  const typical = median(gaps)!;
  const last = feed[feed.length - 1];
  const since = daysBetween(last.day, today);
  if (since < Math.max(INSIGHTS.gapFactor * typical, INSIGHTS.minGapDays)) return null;
  return make(accountId, 'posting_gap', last.p.id, { tone: 'bad', params: { days: since, typical }, n: gaps.length, confidence: conf(gaps.length, INSIGHTS.mediumGaps), day: today, postId: null, href: accountHref(accountId, 'tab=posts') });
}

/** Questions of the last 7 days without a reply SEEN (thread replies are not read: always Low). Counts only. */
export function unansweredFinding(count: number | null, accountId: string, today: string): Finding | null {
  if (count === null || !(count >= 1)) return null;
  return make(accountId, 'unanswered', weekOf(today, 'mon').from, { tone: 'bad', params: { count }, n: count, confidence: 'low', day: today, postId: null, href: accountHref(accountId, 'tab=comments&section=questions') });
}

/** Problems first, then good news, then tips; inside a tone by FINDING_KINDS order, newest day first, then key. */
export const compareFindings = (a: Finding, b: Finding): number =>
  TONES.indexOf(a.tone) - TONES.indexOf(b.tone) || FINDING_KINDS.indexOf(a.kind) - FINDING_KINDS.indexOf(b.kind) || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Every rule over one account, ranked. */
export function findInsights(input: InsightInput, o: { today: string; now: Date; tz: string }): Finding[] {
  const { accountId: a, daily, posts } = input;
  return [
    ...breakouts(posts, a, o.now, o.tz),
    reachDropFinding(daily, a, o.today, o.tz),
    ...unusualDays(daily, a, o.today, o.tz),
    bestSlot(posts, a, o.today, o.tz),
    formatWinner(posts, a, o.today, o.tz),
    hashtagWinner(posts, a, o.today, o.tz),
    postingGap(posts, a, o.today, o.tz),
    unansweredFinding(input.unanswered, a, o.today),
  ]
    .filter((f): f is Finding => f !== null)
    .sort(compareFindings);
}

/** Findings minus the dismissed ones (until = null) and the snoozed ones (until in the future). */
export function visibleFindings(findings: Finding[], dismissals: Dismissal[] | null, now: Date): Finding[] {
  if (!dismissals?.length) return findings;
  const hidden = new Set(dismissals.filter((d) => d.until === null || Date.parse(d.until) > now.getTime()).map((d) => d.key));
  return findings.filter((f) => !hidden.has(f.key));
}

const KEY = /^([a-z_]+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([\p{L}\p{M}\p{N}_:.-]+)$/u;

/** A key from the browser: `<known kind>:<lower-case uuid>:<id>`, at most INSIGHTS.maxKey characters; anything else is null. */
export function parseFindingKey(v: unknown): { kind: FindingKind; accountId: string } | null {
  if (typeof v !== 'string' || v.length > INSIGHTS.maxKey) return null;
  const m = KEY.exec(v);
  return m && (FINDING_KINDS as readonly string[]).includes(m[1]) ? { kind: m[1] as FindingKind, accountId: m[2] } : null;
}
```

- [ ] **Step 4 — verify:** `npx vitest run tests/analysis-insights.test.ts tests/analysis-flags.test.ts tests/alert-rules.test.ts tests/dashboard-account.test.ts tests/dashboard-overview.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/analysis/insights.ts lib/analysis/flags.ts tests/analysis-insights.test.ts tests/analysis-flags.test.ts`.
- [ ] **Commit:** `git add lib/analysis/insights.ts tests/analysis-insights.test.ts lib/analysis/flags.ts tests/analysis-flags.test.ts`, `git commit -m "feat(analysis): rule-based findings with evidence, n and stable keys" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 4: dismissals read / write, the server action, the unanswered count, the export entry

**Files:** Create `lib/dashboard/dismissals.ts`, `app/(app)/overview/insight-actions.ts`, `tests/insight-dismissals.test.ts`. Modify `lib/comments/read.ts`, `lib/data/export.ts`, `tests/settings-data.test.tsx`.

- [ ] **Step 1 — failing tests** `tests/insight-dismissals.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

type Op = unknown[];
const { calls, queue, requireOwner } = vi.hoisted(() => ({ calls: [] as Op[], queue: [] as { data?: unknown; error?: unknown }[], requireOwner: vi.fn() }));
const next = () => Promise.resolve(queue.shift() ?? { data: [], error: null });

/** Owner-session fake: records every call; each awaited query or rpc resolves to the next queued result. */
function fakeDb(): SupabaseClient {
  return {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push(['rpc', fn, args]);
      return next();
    },
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'in', 'upsert']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  } as unknown as SupabaseClient;
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));

import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
import { loadUnansweredCounts } from '@/lib/comments/read';
import { QUESTION_PATTERN } from '@/lib/comments/question';
import { loadDismissals, saveDismissal } from '@/lib/dashboard/dismissals';
import { EXPORT_TABLES } from '@/lib/data/export';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const KEY = `best_slot:${A}:2:evening`;
const NOW = new Date('2026-10-15T04:00:00Z');

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('loadDismissals', () => {
  it('reads by the keys on screen, in chunks of 50, deduplicated', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `k${i}`);
    queue.push({ data: [{ finding_key: 'k1', until: null }], error: null }, { data: [{ finding_key: 'k60', until: '2026-10-20T00:00:00+00:00' }], error: null }, { data: [], error: null });
    expect(await loadDismissals(fakeDb(), [...keys, 'k1'])).toEqual([{ key: 'k1', until: null }, { key: 'k60', until: '2026-10-20T00:00:00+00:00' }]);
    const ins = calls.filter((c) => c[0] === 'in');
    expect(ins.map((c) => (c[2] as string[]).length)).toEqual([50, 50, 20]);
    expect(calls).toContainEqual(['from', 'insight_dismissals']);
    expect(calls).toContainEqual(['select', 'finding_key,until']);
  });

  it('no keys = no request; any error (a missing table too) = null, never a throw', async () => {
    expect(await loadDismissals(fakeDb(), [])).toEqual([]);
    expect(calls).toEqual([]);
    queue.push({ data: null, error: { code: 'PGRST205', message: 'secret' } });
    expect(await loadDismissals(fakeDb(), ['a'])).toBeNull();
    queue.push({ data: null, error: { code: 'XX000' } });
    expect(await loadDismissals(fakeDb(), ['a'])).toBeNull();
  });
});

describe('saveDismissal', () => {
  it('dismiss = until null; snooze = 7 days; one upsert on the key', async () => {
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: true });
    expect(calls).toContainEqual(['upsert', { finding_key: KEY, account_id: A, until: null }, { onConflict: 'finding_key' }]);
    calls.length = 0;
    await saveDismissal(fakeDb(), KEY, A, 'snooze', NOW);
    expect(calls).toContainEqual(['upsert', { finding_key: KEY, account_id: A, until: '2026-10-22T04:00:00.000Z' }, { onConflict: 'finding_key' }]);
  });

  it('errors are keys: missing table, unknown account, anything else', async () => {
    queue.push({ error: { code: 'PGRST205' } }, { error: { code: '23503' } }, { error: { code: 'XX000', message: 'secret' } });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'needs_update' });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(await saveDismissal(fakeDb(), KEY, A, 'dismiss', NOW)).toEqual({ ok: false, error: 'unexpected' });
  });
});

describe('dismissFindingAction', () => {
  it('requireOwner first, then the owner session (never the admin client)', async () => {
    expect(await dismissFindingAction(KEY, 'snooze')).toEqual({ ok: true });
    expect(calls[0]).toEqual(['requireOwner']);
    expect(calls).toContainEqual(['session']);
    expect(calls).not.toContainEqual(['ADMIN']);
  });

  it('a redirect from requireOwner propagates and nothing is written', async () => {
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));
    await expect(dismissFindingAction(KEY, 'dismiss')).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('refuses a bad key or mode before touching the database', async () => {
    for (const [k, m] of [[`nope:${A}:1`, 'dismiss'], [KEY, 'forever'], [42, 'dismiss']] as const) expect(await dismissFindingAction(k as string, m as 'dismiss')).toEqual({ ok: false, error: 'invalid' });
    expect(calls.filter((c) => c[0] !== 'requireOwner')).toEqual([]);
  });
});

describe('loadUnansweredCounts', () => {
  const acc = (id: string, scopes: string[] | null) => ({ id, username: 'Me.Shop', grantedScopes: scopes });
  it('one comment_list call of one row per account with the comments scope; counts only', async () => {
    queue.push({ data: [{ id: 'c', author_username: 'amy', body: 'where?', total: 4 }], error: null });
    const out = await loadUnansweredCounts(fakeDb(), [acc(A, ['instagram_business_manage_comments']), acc('b', null)], '2026-10-15', 'Asia/Kuala_Lumpur');
    expect(out).toEqual({ [A]: 4, b: null });
    expect(calls).toEqual([
      ['rpc', 'comment_list', { p_account: A, p_from: '2026-10-08T16:00:00.000Z', p_to: '2026-10-15T16:00:00.000Z', p_q: null, p_media: null, p_question_re: QUESTION_PATTERN, p_unanswered: true, p_fan_min: null, p_owner: 'me.shop', p_offset: 0, p_limit: 1 }],
    ]);
  });

  it('no rows = 0; a missing function or a failed read = null (the page never breaks)', async () => {
    const one = [acc(A, ['instagram_business_manage_comments'])];
    queue.push({ data: [], error: null }, { data: null, error: { code: 'PGRST202' } }, { data: null, error: { code: 'XX000' } });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: 0 });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: null });
    expect(await loadUnansweredCounts(fakeDb(), one, '2026-10-15', 'UTC')).toEqual({ [A]: null });
  });
});

describe('export', () => {
  it('"Export your data" includes the dismissals (owner-authored, not third-party)', () => {
    expect(EXPORT_TABLES.find((t) => t.name === 'insight_dismissals')).toEqual({ name: 'insight_dismissals', keys: ['finding_key'] });
  });
});
```

Run it → FAIL (modules / exports missing).

- [ ] **Step 2 — `lib/dashboard/dismissals.ts`:**

```ts
// Dismissed and snoozed findings (Plan 17b, migration 20261101000001_insight_dismissals). OWNER SESSION client only (RLS:
// is_owner()); never the admin client. Read by the keys on screen, in chunks (PostgREST answers at most 1,000 rows, and
// the table only grows), never by recency. Errors are keys; no Supabase message leaves this file.
import type { SupabaseClient } from '@supabase/supabase-js';
import { INSIGHTS, type Dismissal, type DismissMode, type DismissResult } from '@/lib/analysis/insights';

const TABLE = 'insight_dismissals';
/** PostgREST / Postgres codes for "this table does not exist": the migration is not applied yet. */
export const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01'];
const CHUNK = 50; // keys per request: keeps the URL short
const DAY_MS = 86_400_000;
const codeOf = (e: unknown) => String((e as { code?: unknown } | null)?.code);

/** The dismissals of these keys. null = they cannot be read (the migration is missing, or the read failed): the feed then
 *  shows everything and offers no dismiss button. No keys = nothing to read ([]). */
export async function loadDismissals(db: SupabaseClient, keys: string[]): Promise<Dismissal[] | null> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const chunks = Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, i) => unique.slice(i * CHUNK, (i + 1) * CHUNK));
  try {
    const results = await Promise.all(chunks.map((c) => db.from(TABLE).select('finding_key,until').in('finding_key', c)));
    if (results.some((r) => r.error)) return null;
    return results.flatMap((r) => ((r.data ?? []) as Record<string, unknown>[]).map((row) => ({ key: String(row.finding_key), until: typeof row.until === 'string' ? row.until : null })));
  } catch {
    return null;
  }
}

/** Dismiss (for good) or snooze (INSIGHTS.snoozeDays) one finding. `accountId` comes from the parsed key. */
export async function saveDismissal(db: SupabaseClient, key: string, accountId: string, mode: DismissMode, now: Date): Promise<DismissResult> {
  const until = mode === 'snooze' ? new Date(now.getTime() + INSIGHTS.snoozeDays * DAY_MS).toISOString() : null;
  const { error } = await db.from(TABLE).upsert({ finding_key: key, account_id: accountId, until }, { onConflict: 'finding_key' });
  if (!error) return { ok: true };
  const code = codeOf(error);
  return { ok: false, error: MISSING_TABLE.includes(code) ? 'needs_update' : code === '23503' ? 'not_found' : 'unexpected' };
}
```

- [ ] **Step 3 — `app/(app)/overview/insight-actions.ts`:**

```ts
'use server';

// Dismiss / snooze a finding (Plan 17b). Owner-authored data: the OWNER-SESSION client, so RLS (is_owner()) applies to the
// write; never the admin client. The key comes from the browser: parsed against the known shape before anything else.
import { requireOwner } from '@/lib/auth/require-owner';
import { parseFindingKey, type DismissMode, type DismissResult } from '@/lib/analysis/insights';
import { saveDismissal } from '@/lib/dashboard/dismissals';
import { createServerSupabase } from '@/lib/supabase/server';

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function dismissFindingAction(key: string, mode: DismissMode): Promise<DismissResult> {
  await requireOwner();
  const parsed = parseFindingKey(key);
  if (!parsed || (mode !== 'dismiss' && mode !== 'snooze')) return { ok: false, error: 'invalid' };
  try {
    return await saveDismissal(await createServerSupabase(), key, parsed.accountId, mode, new Date());
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
```

- [ ] **Step 4 — the count (counts only; the only module allowed to call `comment_list`):**

```diff
diff --git a/lib/comments/read.ts b/lib/comments/read.ts
index 75d9afc..a6bb30b 100644
--- a/lib/comments/read.ts
+++ b/lib/comments/read.ts
@@ -4,11 +4,14 @@
 // admin client. Every read is filtered by the account id. Errors are fixed texts: a Supabase error can echo row values,
 // i.e. third-party usernames and comment texts. Nothing here logs.
 import type { SupabaseClient } from '@supabase/supabase-js';
+import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
+import type { StoredAccount } from '@/lib/accounts/types';
 import { isQuestion, QUESTION_PATTERN } from '@/lib/comments/question';
 import type { FanMode } from '@/lib/comments/state';
 import type { TopicInput } from '@/lib/comments/topics';
 import { COMMENT_PAGE, FAN_PAGE, FAN_RULES, TOPIC_SAMPLE, type CommentPost, type CommentView, type Fan, type Outsider, type Paged } from '@/lib/comments/view';
 import { MISSING_FUNCTION } from '@/lib/dashboard/read';
+import { addDays, daysToIso } from '@/lib/sync/time';
 
 type Row = Record<string, unknown>;
 const missing = (e: unknown): boolean => MISSING_FUNCTION.includes(String((e as { code?: unknown } | null)?.code));
@@ -139,3 +142,22 @@ export async function loadCommentStart(db: SupabaseClient, accountId: string): P
   if (error) return fail('start');
   return str(((data ?? []) as Row[])[0]?.first_seen_at);
 }
+
+/** Questions of the last 7 owner-timezone days without a reply seen, per account (Plan 17b: COUNTS only, no row leaves
+ *  this module). One comment_list call of one row per account with the comments scope. null = not read: no scope (an
+ *  empty list would not mean "none"), the 15c migration missing, or a failed read (the Overview must not break on it). */
+export async function loadUnansweredCounts(db: SupabaseClient, accounts: Pick<StoredAccount, 'id' | 'username' | 'grantedScopes'>[], today: string, tz: string): Promise<Record<string, number | null>> {
+  const { fromIso, toIso } = daysToIso(addDays(today, -6), today, tz);
+  const counts = await Promise.all(
+    accounts.map(async (a) => {
+      if (!hasScope(a, COMMENTS_SCOPE)) return null;
+      const args = { p_account: a.id, p_from: fromIso, p_to: toIso, p_q: null, p_media: null, p_question_re: QUESTION_PATTERN, p_unanswered: true, p_fan_min: null, p_owner: a.username.toLowerCase() };
+      try {
+        return (await paged(db, 'comment_list', args, 1, 1, () => null))?.total ?? null;
+      } catch {
+        return null;
+      }
+    }),
+  );
+  return Object.fromEntries(accounts.map((a, i) => [a.id, counts[i]]));
+}
```

- [ ] **Step 5 — "Export your data" includes the table:**

```diff
diff --git a/lib/data/export.ts b/lib/data/export.ts
index b71e52c..e27b1e3 100644
--- a/lib/data/export.ts
+++ b/lib/data/export.ts
@@ -30,6 +30,7 @@ export const EXPORT_TABLES = [
   { name: 'tags', keys: ['id'] },
   { name: 'media_tags', keys: ['media_id', 'tag_id'] },
   { name: 'explorer_views', keys: ['id'] },
+  { name: 'insight_dismissals', keys: ['finding_key'] },
   { name: 'notifications', keys: ['id'] },
   { name: 'moderation_settings', keys: ['account_id'] },
   { name: 'moderation_rules', keys: ['id'] },
```

- [ ] **Step 6 — "Download all" now fetches one file more** (found by the dry run: the Data & privacy test counts the files):

```diff
diff --git a/tests/settings-data.test.tsx b/tests/settings-data.test.tsx
index 94865e7..82a5298 100644
--- a/tests/settings-data.test.tsx
+++ b/tests/settings-data.test.tsx
@@ -81,15 +81,15 @@ describe('Settings -> Data & privacy', () => {
     await show();
     await user.click(screen.getByRole('button', { name: D.export.all }));
     const urls = server.download.mock.calls.map((c) => c[0] as string);
-    expect(urls).toHaveLength(18);
+    expect(urls).toHaveLength(19); // Plan 17b: + insight_dismissals
     expect(urls.some((u) => /table=(comments|follower_exports)\b/.test(u))).toBe(false);
     expect(server.download.mock.calls.every((c) => c[1] === 'json')).toBe(true);
-    expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();
+    expect(await screen.findByText('19 files downloaded.')).toBeInTheDocument();
 
     server.download.mockClear();
     await user.click(screen.getByRole('checkbox', { name: D.export.others }));
     await user.click(screen.getByRole('button', { name: D.export.all }));
-    expect(server.download.mock.calls).toHaveLength(20);
+    expect(server.download.mock.calls).toHaveLength(21);
   });
 
   it('a failed file stops the run and shows the export error', async () => {
```

- [ ] **Step 7 — verify:** `npx vitest run tests/settings-data.test.tsx tests/insight-dismissals.test.ts tests/comments-read.test.ts tests/comments-privacy.test.ts tests/data-export.test.ts tests/data-privacy-guard.test.ts tests/data-export-route.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/dashboard/dismissals.ts "app/(app)/overview/insight-actions.ts" lib/comments/read.ts lib/data/export.ts tests/insight-dismissals.test.ts`.
- [ ] **Commit:** `git add lib/dashboard/dismissals.ts "app/(app)/overview/insight-actions.ts" lib/comments/read.ts lib/data/export.ts tests/insight-dismissals.test.ts tests/settings-data.test.tsx`, `git commit -m "feat(insights): dismiss and snooze findings, unanswered question counts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 5: the Today model and the shared findings list

**Files:** Create `lib/dashboard/today.ts`, `tests/dashboard-today.test.ts`, `components/shared/FindingsList.tsx`, `tests/findings-list.test.tsx`.

- [ ] **Step 1 — failing tests** `tests/dashboard-today.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildToday, nextSlotDay, todayFindings } from '@/lib/dashboard/today';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const C = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TODAY = '2026-10-15'; // Thursday
const NOW = new Date('2026-10-15T04:00:00Z'); // 12:00 in Kuala Lumpur
const KL = 'Asia/Kuala_Lumpur';
const o = { today: TODAY, now: NOW, tz: KL };
const acct = (id: string, username: string, x: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-01-01T00:00:00Z', ...x });
const days = (n: number, f: (day: string, i: number) => Partial<DailyRow> = () => ({})): DailyRow[] =>
  Array.from({ length: n }, (_, i) => {
    const day = addDays(TODAY, i - n);
    return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day, i) };
  });
const post = (id: string, postedAt: string, reach: number, x: Partial<Post> = {}): Post => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
const ordinary = Array.from({ length: 19 }, (_, i) => post(`o${i}`, `${addDays('2026-06-01', 3 * i)}T02:00:00Z`, 100));
const tuesdays = Array.from({ length: 6 }, (_, i) => post(`t${i}`, `${addDays('2026-09-01', 7 * i)}T11:00:00Z`, 300));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

const input: OverviewInput = {
  accounts: [acct(A, 'brand.one'), acct(B, 'broken', { status: 'needs_reconnect' }), acct(C, 'failing')],
  sync: { [A]: synced, [B]: synced, [C]: { ...synced, lastErrorKey: 'rate_limited', consecutiveFailures: 2 } },
  daily: { [A]: days(60, (d) => (d === '2026-10-14' ? { reach: 500 } : {})), [B]: days(60), [C]: days(60) },
  posts: { [A]: [...ordinary, ...tuesdays, post('hit', '2026-10-12T02:00:00Z', 2000, { mediaType: 'REELS' }), post('new', '2026-10-13T02:00:00Z', 50)] },
};
const model = buildOverview(input, { scope: resolveScope(parseTimeScope(new URLSearchParams('from=7d')), TODAY, '2026-01-01'), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' });
const cards = model.sections.flatMap((s) => s.cards);

describe('nextSlotDay', () => {
  it('today while the day part has not ended, else the next such weekday', () => {
    expect(nextSlotDay(4, 'evening', NOW, KL)).toBe(TODAY); // Thursday 12:00, evening still ahead
    expect(nextSlotDay(4, 'morning', NOW, KL)).toBe('2026-10-22'); // the morning is over
    expect(nextSlotDay(2, 'evening', NOW, KL)).toBe('2026-10-20');
  });
});

describe('buildToday', () => {
  const found = todayFindings(input, { [A]: 3, [B]: null, [C]: null }, o);
  const today = buildToday(input, cards, found, [], o);

  it('the latest settled day vs the same weekday: values, typical, n, unusual', () => {
    const a = today.accounts.find((x) => x.id === A)!;
    expect(a.day).toBe('2026-10-14');
    expect(a.metrics).toEqual([
      { id: 'followers', value: 1, typical: 1, n: 8, unusual: false },
      { id: 'reach', value: 500, typical: 100, n: 8, unusual: true },
      { id: 'views', value: 200, typical: 200, n: 8, unusual: false },
      { id: 'interactions', value: 10, typical: 10, n: 8, unusual: false },
    ]);
  });

  it('only healthy accounts get a briefing; problems come first in "needs attention"', () => {
    expect(today.accounts.map((x) => x.id)).toEqual([A, C]); // C syncs with errors but has data; B needs a reconnect
    expect(today.attention.slice(0, 2)).toEqual([
      { kind: 'problem', accountId: B, username: 'broken', problem: 'needs_reconnect', errorKey: null },
      { kind: 'problem', accountId: C, username: 'failing', problem: 'sync_error', errorKey: 'rate_limited' },
    ]);
    expect(today.attention.slice(2).map((x) => x.kind === 'finding' && x.finding.kind)).toEqual(['unanswered', 'breakout']); // tips and good-news unusual days stay out
  });

  it('working now: the best post of the last 7 days vs the typical reach of its format', () => {
    expect(today.accounts[0].top).toEqual({ id: 'hit', mediaType: 'REELS', postedAt: '2026-10-12T02:00:00Z', reach: 2000, typical: null, n: 0 }); // no mature Reels: no typical
  });

  it('next: days since the last post and the next best slot', () => {
    expect(today.accounts[0].lastPostDays).toBe(2);
    expect(today.accounts[0].slot).toEqual({ weekday: 2, daypart: 'evening', day: '2026-10-20', n: 6, confidence: 'low' });
    expect(today.accounts[1]).toMatchObject({ top: null, lastPostDays: null, slot: null });
  });

  it('dismissed findings leave the list; null dismissals = no dismiss button', () => {
    const key = found[A].find((f) => f.kind === 'breakout')!.key;
    const hidden = buildToday(input, cards, found, [{ key, until: null }], o);
    expect(hidden.attention.some((x) => x.kind === 'finding' && x.finding.key === key)).toBe(false);
    expect(hidden.canDismiss).toBe(true);
    expect(buildToday(input, cards, found, null, o).canDismiss).toBe(false);
  });

  it('no accounts: an empty briefing', () => {
    expect(buildToday({ accounts: [], sync: {}, daily: {}, posts: {} }, [], {}, [], o)).toEqual({ accounts: [], attention: [], canDismiss: true });
  });
});
```

and `tests/findings-list.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { FindingsList } from '@/components/shared/FindingsList';
import type { Finding } from '@/lib/analysis/insights';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const f = (kind: Finding['kind'], params: Finding['params'], x: Partial<Finding> = {}): Finding => ({ key: `${kind}:${A}:1`, accountId: A, kind, tone: 'tip', params, n: 9, confidence: 'medium', day: '2026-10-14', postId: null, href: `/accounts/${A}`, ...x });
const ALL: Finding[] = [
  f('reach_drop', { change: -0.25 }, { key: 'k1', tone: 'bad' }),
  f('posting_gap', { days: 6, typical: 2.5 }, { key: 'k2', tone: 'bad' }),
  f('unanswered', { count: 3 }, { key: 'k3', tone: 'bad' }),
  f('unusual_day', { metric: 'followers', value: -39, typical: 1, weekday: 3 }, { key: 'k4', tone: 'bad' }),
  f('breakout', { ratio: 2.06, format: 'REELS' }, { key: 'k5', tone: 'good' }),
  f('best_slot', { weekday: 2, daypart: 'evening', ratio: 2.1 }, { key: 'k6' }),
  f('format_winner', { format: 'CAROUSEL_ALBUM', ratio: 1.4 }, { key: 'k7' }),
  f('hashtag_winner', { hashtag: '美食', ratio: 3 }, { key: 'k8' }),
];

function wrap(ui: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('FindingsList', () => {
  it('every kind in words, with its basis (n, a confidence word, the day) and a link to the evidence', () => {
    wrap(<FindingsList items={ALL} canDismiss={false} />);
    for (const s of [
      'Reach -25.0% over the last 7 days vs the 7 days before',
      'No post for 6 days; you usually post every 2.5 days',
      '3 questions in the last 7 days without a reply we can see',
      'Follower change on 14 Oct 2026: -39, usually +1 on a Wednesday',
      'A Reel posted 14 Oct 2026 has 2.1× the median reach of your previous posts',
      'Posts on Tuesday evening reach 2.1× the median of your other posts',
      'Carousel posts reach 1.4× the median of your other posts',
      'Posts with #美食 reach 3× the median of posts without it',
    ])
      expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getAllByText('n = 9 · Medium confidence · 14 Oct 2026')).toHaveLength(8);
    expect(screen.getAllByRole('link', { name: en.insights.open })[0]).toHaveAttribute('href', `/accounts/${A}`);
    expect(screen.queryByRole('button')).toBeNull(); // no table: no dismiss
    expect(screen.getByText(en.insights.needsUpdate)).toBeInTheDocument();
  });

  it('dismiss and snooze call the action with the key; the line leaves the list; an error is announced', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    wrap(<FindingsList items={ALL.slice(0, 2)} canDismiss dismiss={dismiss} />);
    await user.click(screen.getByRole('button', { name: `Dismiss: ${'Reach -25.0% over the last 7 days vs the 7 days before'}` }));
    expect(dismiss).toHaveBeenCalledWith('k1', 'dismiss');
    expect(await screen.findByRole('status')).toHaveTextContent(en.insights.hidden);
    expect(screen.queryByText('Reach -25.0% over the last 7 days vs the 7 days before')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Hide for 7 days: No post/ }));
    expect(dismiss).toHaveBeenLastCalledWith('k2', 'snooze');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.insights.errors.needs_update);
    expect(screen.getByText(/No post for 6 days/)).toBeInTheDocument(); // still there
  });

  it('empty list says so; zh-CN renders without NaN or raw keys', () => {
    wrap(<FindingsList items={[]} canDismiss />);
    expect(screen.getByText(en.insights.empty)).toBeInTheDocument();
    const { container } = wrap(<FindingsList items={ALL} canDismiss={false} />, 'zh-CN');
    expect(container.textContent).not.toMatch(/NaN|undefined|insights\./);
    expect(screen.getByText('星期二晚上发布的帖子覆盖人数是其他帖子中位数的 2.1 倍')).toBeInTheDocument();
  });
});
```

Run both → FAIL (modules missing).

- [ ] **Step 2 — `lib/dashboard/today.ts`:**

```ts
// The Overview's "Today" briefing (Plan 17b, SPEC §7m; creator-toolkit design §0b): four answers in ten seconds. Pure:
// built from the Overview's own reads, the account cards and the findings; today / now / tz are inputs. It ignores the
// range bar on purpose (it is always "the latest settled day" and "the last 7 days").
import { weekdayOf } from '@/lib/analysis/best-time';
import {
  bestSlot,
  compareFindings,
  DAY_METRICS,
  DAYPARTS,
  findInsights,
  INSIGHTS,
  latestDay,
  measuredPosts,
  visibleFindings,
  type DayMetric,
  type Daypart,
  type Dismissal,
  type Finding,
} from '@/lib/analysis/insights';
import { median } from '@/lib/analysis/posts';
import type { AccountCard } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween } from '@/lib/time-scope/range';

export const TODAY = { topDays: 7, attentionMax: 8 } as const;

export interface TodayMetric {
  id: DayMetric;
  value: number | null;
  typical: number | null; // median of the same weekday; null = fewer than 4 of them
  n: number;
  unusual: boolean;
}
export interface TodayTop {
  id: string;
  mediaType: Exclude<MediaKind, 'STORY'>;
  postedAt: string;
  reach: number;
  typical: number | null; // median reach of the account's mature posts of that format; null under 5
  n: number;
}
export interface TodaySlot {
  weekday: number;
  daypart: Daypart;
  day: string; // the next such day (today while the day part has not passed)
  n: number;
  confidence: 'low' | 'medium';
}
export interface TodayAccount {
  id: string;
  username: string;
  day: string; // the settled day the metrics are for
  metrics: TodayMetric[];
  top: TodayTop | null; // best post of the last 7 days
  lastPostDays: number | null; // days since the newest feed post; null = none read
  slot: TodaySlot | null;
}
export type Attention =
  | { kind: 'problem'; accountId: string; username: string; problem: 'needs_reconnect' | 'sync_error'; errorKey: string | null }
  | { kind: 'finding'; username: string; finding: Finding };
export interface TodayModel {
  accounts: TodayAccount[]; // healthy accounts only (state ok), in card order
  attention: Attention[];
  canDismiss: boolean;
}

/** The next day (from today) with this weekday whose day part has not ended yet. */
export function nextSlotDay(weekday: number, daypart: Daypart, now: Date, tz: string): string {
  const today = localDay(now, tz);
  const end = (DAYPARTS.indexOf(daypart) + 1) * 6;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday && (i > 0 || localHour(now, tz) < end)) return d;
  }
  return addDays(today, 7);
}

/** Every rule for every account of the Overview (no captions there, so no hashtag finding). */
export function todayFindings(input: OverviewInput, unanswered: Record<string, number | null>, o: { today: string; now: Date; tz: string }): Record<string, Finding[]> {
  return Object.fromEntries(input.accounts.map((a) => [a.id, findInsights({ accountId: a.id, daily: input.daily[a.id] ?? [], posts: input.posts[a.id] ?? [], unanswered: unanswered[a.id] ?? null }, o)]));
}

function topPost(input: OverviewInput, id: string, o: { today: string; tz: string }): TodayTop | null {
  const posts = (input.posts[id] ?? []).filter((p) => p.mediaType !== 'STORY' && p.reach !== null && p.reach > 0 && localDay(new Date(p.postedAt), o.tz) >= addDays(o.today, -(TODAY.topDays - 1)));
  const best = posts.reduce<(typeof posts)[number] | null>((b, p) => (!b || p.reach! > b.reach! || (p.reach === b.reach && p.postedAt > b.postedAt) ? p : b), null);
  if (!best) return null;
  const same = measuredPosts(input.posts[id] ?? [], o.today, o.tz).filter((m) => m.p.mediaType === best.mediaType).map((m) => m.reach);
  return { id: best.id, mediaType: best.mediaType as TodayTop['mediaType'], postedAt: best.postedAt, reach: best.reach!, typical: same.length >= INSIGHTS.minGroup ? median(same) : null, n: same.length };
}

export function buildToday(input: OverviewInput, cards: AccountCard[], found: Record<string, Finding[]>, dismissals: Dismissal[] | null, o: { today: string; now: Date; tz: string }): TodayModel {
  const problems: Attention[] = cards.flatMap((c): Attention[] =>
    c.state === 'needs_reconnect'
      ? [{ kind: 'problem', accountId: c.id, username: c.username, problem: 'needs_reconnect', errorKey: null }]
      : c.syncErrorKey
        ? [{ kind: 'problem', accountId: c.id, username: c.username, problem: 'sync_error', errorKey: c.syncErrorKey }]
        : [],
  );
  const name = new Map(cards.map((c) => [c.id, c.username]));
  const findings = cards
    .flatMap((c) => visibleFindings(found[c.id] ?? [], dismissals, o.now))
    .filter((f) => f.tone === 'bad' || f.kind === 'breakout')
    .sort(compareFindings)
    .map((f): Attention => ({ kind: 'finding', username: name.get(f.accountId) ?? '', finding: f }));
  const accounts = cards
    .filter((c) => c.state === 'ok')
    .map((c): TodayAccount => {
      const daily = input.daily[c.id] ?? [];
      const posts = input.posts[c.id] ?? [];
      const latest = latestDay(daily, o.today, o.tz);
      const newest = posts.filter((p) => p.mediaType !== 'STORY').reduce<string | null>((m, p) => (m === null || p.postedAt > m ? p.postedAt : m), null);
      const slot = bestSlot(posts, c.id, o.today, o.tz);
      return {
        id: c.id,
        username: c.username,
        day: latest.day,
        metrics: DAY_METRICS.map((id) => {
          const a = latest.metrics[id];
          const known = a && !('reason' in a) ? a : null;
          return { id, value: latest.values[id], typical: known?.median ?? null, n: a?.n ?? 0, unusual: known?.unusual ?? false };
        }),
        top: topPost(input, c.id, o),
        lastPostDays: newest === null ? null : daysBetween(localDay(new Date(newest), o.tz), o.today),
        slot: slot ? { weekday: Number(slot.params.weekday), daypart: slot.params.daypart as Daypart, day: nextSlotDay(Number(slot.params.weekday), slot.params.daypart as Daypart, o.now, o.tz), n: slot.n, confidence: slot.confidence } : null,
      };
    });
  return { accounts, attention: [...problems, ...findings].slice(0, TODAY.attentionMax), canDismiss: dismissals !== null };
}
```

- [ ] **Step 3 — `components/shared/FindingsList.tsx`:**

```tsx
'use client';

// Findings of the insights feed (Plan 17b): the account Overview's Findings card and the Overview's "Needs attention".
// Each line: the finding in words, its basis (n, a confidence word, the day) and a link to the evidence; Dismiss (for
// good) and "Hide for 7 days" when the table exists. A hidden finding leaves the list at once; the next page load reads
// the dismissals again. Params are numbers and ids, formatted here (lib/format.ts); never HTML.
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { NavLink } from '@/components/shared/NavLink';
import { Button } from '@/components/ui/button';
import type { DismissMode, DismissResult, Finding } from '@/lib/analysis/insights';
import { formatDay, formatDelta, formatNumber, formatSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

export type DismissAction = (key: string, mode: DismissMode) => Promise<DismissResult>;

/** The sentence of one finding in the UI language. */
export function useFindingText(): (f: Finding) => string {
  const t = useTranslations('insights');
  const ta = useTranslations('analysis');
  const tg = useTranslations('pages.account.growth');
  const { prefs } = usePrefs();
  return (f) => {
    const p = f.params;
    const num = (v: unknown, digits = 0) => formatNumber(typeof v === 'number' ? v : null, prefs, { maximumFractionDigits: digits });
    const values: Record<string, string | number> = {
      ratio: num(p.ratio, 1),
      change: formatDelta(typeof p.change === 'number' ? p.change : null, prefs),
      format: p.format ? ta(`format.${p.format}`) : '',
      date: formatDay(f.day, prefs),
      metric: p.metric ? t(`metric.${p.metric}`) : '',
      value: p.metric === 'followers' ? formatSigned(Number(p.value), prefs) : num(p.value),
      typical: f.kind === 'posting_gap' ? num(p.typical, 1) : p.metric === 'followers' ? formatSigned(Number(p.typical), prefs) : num(p.typical),
      weekday: p.weekday !== undefined ? tg(`weekday.${p.weekday}`) : '',
      daypart: p.daypart ? t(`daypart.${p.daypart}`) : '',
      days: Number(p.days ?? 0),
      count: Number(p.count ?? 0),
      hashtag: String(p.hashtag ?? ''),
    };
    return t(`kind.${f.kind}`, values);
  };
}

const TONE = { bad: 'border-l-destructive', good: 'border-l-success', tip: 'border-l-primary' } as const;

export function FindingsList({ items, canDismiss, dismiss, label }: { items: Finding[]; canDismiss: boolean; dismiss?: DismissAction; label?: (f: Finding) => string | null }) {
  const t = useTranslations('insights');
  const { prefs } = usePrefs();
  const text = useFindingText();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const shown = items.filter((f) => !hidden.has(f.key));
  const run = (key: string, mode: DismissMode) =>
    start(async () => {
      const r = dismiss ? await dismiss(key, mode) : ({ ok: false, error: 'unexpected' } as const);
      if (r.ok) setHidden((h) => new Set([...h, key]));
      setNotice(r.ok ? { ok: true, text: t('hidden') } : { ok: false, text: t(`errors.${r.error}`) });
    });

  return (
    <div className="grid min-w-0 gap-2">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid min-w-0 gap-2">
          {shown.map((f) => {
            const sentence = text(f);
            const who = label?.(f);
            return (
              <li key={f.key} className={cn('grid min-w-0 gap-1 border-l-2 pl-3 text-sm', TONE[f.tone])}>
                <p className="min-w-0 break-words">
                  {who ? <span className="font-medium">{who} · </span> : null}
                  {sentence}
                </p>
                <p className="text-xs text-muted-foreground">{t('basis', { n: formatNumber(f.n, prefs), confidence: t(`confidence.${f.confidence}`), date: formatDay(f.day, prefs) })}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <NavLink href={f.href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                    {t('open')}
                  </NavLink>
                  {canDismiss && dismiss ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={t('dismissLabel', { text: sentence })} onClick={() => run(f.key, 'dismiss')}>
                        {t('dismiss')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={t('snoozeLabel', { text: sentence })} onClick={() => run(f.key, 'snooze')}>
                        {t('snooze')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!canDismiss && shown.length > 0 ? <p className="text-xs text-muted-foreground">{t('needsUpdate')}</p> : null}
      {notice ? (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('text-xs', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4 — verify:** `npx vitest run tests/dashboard-today.test.ts tests/findings-list.test.tsx tests/ui-standards.test.ts tests/messages.test.ts` → pass; `npx tsc --noEmit`; `npx eslint lib/dashboard/today.ts components/shared/FindingsList.tsx tests/dashboard-today.test.ts tests/findings-list.test.tsx`.
- [ ] **Commit:** `git add lib/dashboard/today.ts tests/dashboard-today.test.ts components/shared/FindingsList.tsx tests/findings-list.test.tsx`, `git commit -m "feat(insights): Today model and the shared findings list" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 6: the Findings card on the account Overview (replaces Flags)

**Files:** Modify `components/account/AccountOverview.tsx`, `lib/dashboard/account.ts`, `app/(app)/accounts/[id]/(tabs)/page.tsx`, `tests/account-view.test.tsx`, `tests/dashboard-account.test.ts`, `tests/account-page.test.tsx`.

- [ ] **Step 1 — tests first** (they fail until Step 2):

```diff
diff --git a/tests/account-view.test.tsx b/tests/account-view.test.tsx
index 733b890..256ab84 100644
--- a/tests/account-view.test.tsx
+++ b/tests/account-view.test.tsx
@@ -127,7 +127,7 @@ describe('AccountView', () => {
 });
 
 describe('AccountOverview', () => {
-  it('KPIs with comparison, charts, formats, flags and the best-time toggles', async () => {
+  it('KPIs with comparison, charts, formats, the findings card and the best-time toggles', async () => {
     const user = userEvent.setup();
     const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, addDays('2026-09-20', i), 100));
     const model = buildAccountOverview({ ...empty, sync: { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' }, daily: days(14), posts: [...history, post('hit', '2026-10-12', 900)], pooled: { accounts: 3, posts: history, online: [] } }, opts);
@@ -135,7 +135,8 @@ describe('AccountOverview', () => {
     const kpis = screen.getByRole('region', { name: en.pages.account.kpis });
     expect(within(kpis).getAllByText(en.timeScope.vsPrevious.replace('{days}', '7')).length).toBeGreaterThan(0);
     expect(screen.getByRole('heading', { name: en.pages.account.trendTitle })).toBeInTheDocument();
-    expect(screen.getByRole('link', { name: /Post taking off/ })).toHaveAttribute('rel', 'noopener noreferrer');
+    expect(screen.getByRole('heading', { name: en.insights.title })).toBeInTheDocument(); // Plan 17b: findings replace the flags card
+    expect(screen.getByText(en.insights.empty)).toBeInTheDocument();
     expect(screen.getAllByText(en.analysis.format.REELS).length).toBeGreaterThan(0);
     // default = followers online (SPEC §7); no online data → the reason shows
     expect(screen.getByRole('button', { name: en.pages.account.bestTimeOnline })).toHaveAttribute('aria-pressed', 'true');
@@ -146,6 +147,20 @@ describe('AccountOverview', () => {
     expect(screen.getByRole('button', { name: '3 accounts pooled' })).toHaveAttribute('aria-pressed', 'true');
   });
 
+  it('findings: five, then "Show all" (a view-only pick: history.replaceState, findings=all)', async () => {
+    const user = userEvent.setup();
+    const replace = vi.spyOn(window.history, 'replaceState');
+    const items = Array.from({ length: 6 }, (_, i) => ({ key: `best_slot:${ID}:${i}`, accountId: ID, kind: 'best_slot' as const, tone: 'tip' as const, params: { weekday: i, daypart: 'evening', ratio: 2 }, n: 6, confidence: 'low' as const, day: TODAY, postId: null, href: `/accounts/${ID}` }));
+    wrap(<AccountOverview model={buildAccountOverview(empty, opts)} findings={{ items, canDismiss: true, showAll: false }} dismiss={vi.fn()} />);
+    expect(screen.getAllByRole('link', { name: en.insights.open })).toHaveLength(5);
+    await user.click(screen.getByRole('button', { name: 'Show all (6)' }));
+    expect(screen.getAllByRole('link', { name: en.insights.open })).toHaveLength(6);
+    expect(String(replace.mock.calls.at(-1)?.[2])).toContain('findings=all');
+    await user.click(screen.getByRole('button', { name: en.insights.showFewer }));
+    expect(String(replace.mock.calls.at(-1)?.[2])).not.toContain('findings=all');
+    replace.mockRestore();
+  });
+
   it('Audience is the last section of Overview (#audience); its snapshots say they are the latest snapshot', () => {
     const audience = buildAudience({ age_gender: null, country: { day: '2026-10-14', data: { MY: 60, SG: 40 } }, city: null });
     wrap(<AccountOverview model={buildAccountOverview(empty, opts)} audience={audience} />);
@@ -159,7 +174,7 @@ describe('AccountOverview', () => {
   it('account with no data renders every reason and no NaN (zh-CN)', () => {
     const { container } = wrap(<AccountOverview model={buildAccountOverview(empty, opts)} />, 'zh-CN');
     expect(screen.getAllByText(zh.analysis.reasons.backfilling).length).toBeGreaterThan(0); // the state note and the KPI reasons
-    expect(screen.getByText(zh.pages.account.noFlags)).toBeInTheDocument();
+    expect(screen.getByText(zh.insights.empty)).toBeInTheDocument();
     expect(screen.getByText(zh.pages.overview.neverSynced)).toBeInTheDocument();
     expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
   });
```

```diff
diff --git a/tests/dashboard-account.test.ts b/tests/dashboard-account.test.ts
index 5c132ba..3fa4518 100644
--- a/tests/dashboard-account.test.ts
+++ b/tests/dashboard-account.test.ts
@@ -32,7 +32,7 @@ describe('poolFor', () => {
 });
 
 describe('buildAccountOverview', () => {
-  it('KPIs with comparison, a trend over the window, formats, heatmaps, flags and sync status', () => {
+  it('KPIs with comparison, a trend over the window, formats, heatmaps and sync status (flags moved to the findings, Plan 17b)', () => {
     const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100));
     const hit = post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS', permalink: 'https://www.instagram.com/reel/hit/' });
     const m = buildAccountOverview(
@@ -49,7 +49,6 @@ describe('buildAccountOverview', () => {
     expect(m.heat.online.pooled.reason).toBe('needs_100_followers');
     expect(m.heat.posts.pooled.sample).toBe(8);
     expect(m.pooledAccounts).toBe(2);
-    expect(m.flags).toEqual([expect.objectContaining({ kind: 'taking_off', postId: 'hit' })]);
     expect(m.lastSyncedAt).toBe('2026-10-15T03:00:00Z');
     expect(m.syncErrorKey).toBe('rate_limited');
   });
@@ -62,7 +61,6 @@ describe('buildAccountOverview', () => {
     expect(m.formats).toEqual([]);
     expect(m.heat.online.account.reason).toBe('needs_100_followers');
     expect(m.heat.posts.account.reason).toBe('not_enough_posts');
-    expect(m.flags).toEqual([]);
     expect(m.syncErrorKey).toBeNull();
     for (const k of Object.values(m.kpis)) for (const v of [k.value, k.diff, k.change]) if (v !== null) expect(Number.isFinite(v)).toBe(true);
   });
```

```diff
diff --git a/tests/account-page.test.tsx b/tests/account-page.test.tsx
index a93bcaa..60c7109 100644
--- a/tests/account-page.test.tsx
+++ b/tests/account-page.test.tsx
@@ -28,7 +28,9 @@ vi.mock('@/lib/comments/read', () => ({
   loadFans: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('fans'), comments.args.push(a), comments.migrated ? { rows: [], total: 0, page: 1 } : null),
   loadOutsiders: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('outsiders'), comments.args.push(a), comments.migrated ? { rows: [], total: 0, page: 1 } : null),
   loadTopicSample: async (_db: unknown, _id: string, a: Record<string, unknown>) => (calls.push('topicSample'), comments.args.push(a), []),
+  loadUnansweredCounts: async () => (calls.push('unanswered'), {}),
 }));
+vi.mock('@/lib/dashboard/dismissals', () => ({ loadDismissals: async () => (calls.push('dismissals'), []) }));
 const moderation = vi.hoisted(() => ({ data: null as Record<string, unknown> | null, loads: [] as unknown[][] }));
 vi.mock('@/lib/moderation/store', () => ({
   loadModeration: async (...a: unknown[]) => (calls.push('moderation'), moderation.loads.push(a.slice(1)), moderation.data),
@@ -146,6 +148,7 @@ describe('account detail page', () => {
     expect(el.props.tab).toBe('overview');
     expect(isValidElement(await streamTab(el))).toBe(true);
     expect(calls).toContain('daily');
+    expect(calls).toEqual(expect.arrayContaining(['postRows', 'unanswered', 'dismissals'])); // Plan 17b: captions for the hashtag rule, counts, dismissals
     expect(calls).not.toContain('ADMIN');
     expect(calls).not.toContain('stories');
   });
```

- [ ] **Step 2 — the model loses `flags`:**

```diff
diff --git a/lib/dashboard/account.ts b/lib/dashboard/account.ts
index 4e715e9..502c514 100644
--- a/lib/dashboard/account.ts
+++ b/lib/dashboard/account.ts
@@ -2,7 +2,6 @@
 import type { StoredAccount } from '@/lib/accounts/types';
 import { onlineHeatmap, postHeatmap, type Heatmap } from '@/lib/analysis/best-time';
 import { bucketize } from '@/lib/analysis/buckets';
-import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
 import { kpis, summarize, type Kpi, type KpiId } from '@/lib/analysis/growth';
 import { formatComparison } from '@/lib/analysis/posts';
 import type { DailyRow, OnlineFollowersRow, Post } from '@/lib/analysis/types';
@@ -45,7 +44,6 @@ export interface AccountOverviewModel {
   formats: ReturnType<typeof formatComparison>; // posts published in the scope's days
   heat: { online: { account: Heatmap; pooled: Heatmap }; posts: { account: Heatmap; pooled: Heatmap } };
   pooledAccounts: number;
-  flags: Flag[];
   lastSyncedAt: string | null;
   syncErrorKey: string | null;
 }
@@ -55,7 +53,6 @@ export function buildAccountOverview(input: AccountOverviewInput, o: { scope: Re
   const { window, gran, range } = o.scope;
   const s = summarize(daily, posts, window, o.today, o.tz, o.scope.scope.cmp);
   const byDay = new Map(daily.map((r) => [r.day, r]));
-  const drop = reachDrop(daily, o.today, o.tz);
   const state = cardState(account.status, account.tokenExpiresAt, o.now, sync, s, daily.length > 0);
   const trend = bucketize(
     s.reachByDay.map(({ day }) => ({ day, reach: byDay.get(day)?.reach ?? null, views: byDay.get(day)?.views ?? null, followers: byDay.get(day)?.followers ?? null })),
@@ -79,7 +76,6 @@ export function buildAccountOverview(input: AccountOverviewInput, o: { scope: Re
       posts: { account: postHeatmap(posts, o.tz, o.weekStart), pooled: postHeatmap(input.pooled.posts, o.tz, o.weekStart) },
     },
     pooledAccounts: input.pooled.accounts,
-    flags: [...takingOff(posts, o.now, 'last' in window ? window.last : 7), ...(drop ? [drop] : [])], // "right now" signals
     lastSyncedAt: sync?.lastSuccessAt ?? null,
     syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
   };
```

- [ ] **Step 3 — the card:**

```diff
diff --git a/components/account/AccountOverview.tsx b/components/account/AccountOverview.tsx
index 7fe5160..aaaf250 100644
--- a/components/account/AccountOverview.tsx
+++ b/components/account/AccountOverview.tsx
@@ -2,7 +2,7 @@
 
 import { useState } from 'react';
 import Link from 'next/link';
-import { TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
+import { TriangleAlert } from 'lucide-react';
 import { useTranslations } from 'next-intl';
 import { AudienceTab } from '@/components/account/AudienceTab';
 import { Heatmap } from '@/components/charts/Heatmap';
@@ -10,6 +10,7 @@ import { SeriesChart } from '@/components/charts/SeriesChart';
 import { useBestTimeRows } from '@/components/charts/useBestTimeRows';
 import { usePrefs } from '@/components/providers/PrefsProvider';
 import { ChartCard } from '@/components/shared/ChartCard';
+import { FindingsList, type DismissAction } from '@/components/shared/FindingsList';
 import { DataTable } from '@/components/shared/DataTable';
 import { NavLink } from '@/components/shared/NavLink';
 import { StatCard } from '@/components/shared/StatCard';
@@ -17,14 +18,18 @@ import { useBucketFormat, useScopeText } from '@/components/shared/RangeBar';
 import { useKpiDelta } from '@/components/shared/useKpiDelta';
 import { Button } from '@/components/ui/button';
 import type { KpiId } from '@/lib/analysis/growth';
+import type { Finding } from '@/lib/analysis/insights';
 import type { AccountOverviewModel } from '@/lib/dashboard/account';
 import type { AudienceModel } from '@/lib/dashboard/audience';
 import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
-import { formatCompact, formatDateTime, formatDelta, formatNumber, formatPercent } from '@/lib/format';
+import { formatCompact, formatDateTime, formatHour, formatNumber, formatPercent } from '@/lib/format';
 import { formatMetric } from '@/lib/metrics';
 import { scopeQuery } from '@/lib/time-scope/scope';
 
 const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];
+/** Findings shown before "Show all" (Plan 17b). */
+const FINDINGS_SHOWN = 5;
+const NO_FINDINGS = { items: [] as Finding[], canDismiss: false, showAll: false };
 
 function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; text: string }[]; onChange: (v: T) => void }) {
   return (
@@ -38,8 +43,9 @@ function Toggle<T extends string>({ label, value, options, onChange }: { label:
   );
 }
 
-/** `account` set: formats and best-time cells link into the Explorer (drill-down), scoped to this account. */
-export function AccountOverview({ model, account, audience }: { model: AccountOverviewModel; account?: { id: string; groupName: string | null }; audience?: AudienceModel }) {
+/** `account` set: formats and best-time cells link into the Explorer (drill-down), scoped to this account. `findings`: the
+ *  insights feed (Plan 17b); `showAll` mirrors ?findings=all, a view-only pick written with history.replaceState. */
+export function AccountOverview({ model, account, audience, findings = NO_FINDINGS, dismiss }: { model: AccountOverviewModel; account?: { id: string; groupName: string | null }; audience?: AudienceModel; findings?: { items: Finding[]; canDismiss: boolean; showAll: boolean }; dismiss?: DismissAction }) {
   const t = useTranslations('pages.account');
   const to = useTranslations('pages.overview');
   const tm = useTranslations('metrics');
@@ -52,6 +58,16 @@ export function AccountOverview({ model, account, audience }: { model: AccountOv
   const bestTime = useBestTimeRows();
   const [view, setView] = useState<'online' | 'posts'>('online'); // SPEC §7: followers online is the default
   const [scope, setScope] = useState<'account' | 'pooled'>('account');
+  const ti = useTranslations('insights');
+  const items = findings.items;
+  const [allFindings, setAllFindings] = useState(findings.showAll);
+  const toggleFindings = () => {
+    const q = new URLSearchParams(window.location.search);
+    if (allFindings) q.delete('findings');
+    else q.set('findings', 'all');
+    setAllFindings(!allFindings);
+    window.history.replaceState(null, '', `?${q.toString()}`);
+  };
   const heat = model.heat[view][scope];
   // drill-down: a cell of "your post performance" lists the posts behind it. The grid uses every stored post, so the
   // link asks for the whole history ("all"), this account or its pool (its group, or every account when isolated).
@@ -129,35 +145,13 @@ export function AccountOverview({ model, account, audience }: { model: AccountOv
           />
         </ChartCard>
 
-        <ChartCard title={t('flagsTitle')}>
-          {model.flags.length === 0 ? (
-            <p className="text-sm text-muted-foreground">{t('noFlags')}</p>
-          ) : (
-            <ul className="grid gap-2 text-sm">
-              {model.flags.map((f) =>
-                f.kind === 'taking_off' ? (
-                  <li key={f.postId} className="flex min-w-0 items-center gap-2 text-success">
-                    <TrendingUp aria-hidden="true" className="size-4 shrink-0" />
-                    <span className="min-w-0 truncate">
-                      {f.permalink ? (
-                        <a href={f.permalink} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
-                          {to('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}
-                        </a>
-                      ) : (
-                        to('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })
-                      )}
-                      <span className="ml-1.5 text-xs text-muted-foreground">{formatDateTime(f.postedAt, prefs)}</span>
-                    </span>
-                  </li>
-                ) : (
-                  <li key="drop" className="flex items-center gap-2 text-destructive">
-                    <TrendingDown aria-hidden="true" className="size-4 shrink-0" />
-                    {to('reachDrop', { change: formatDelta(f.change, prefs) })}
-                  </li>
-                ),
-              )}
-            </ul>
-          )}
+        <ChartCard title={ti('title')} subtitle={`${ti('source')} ${ti('dayparts', { a: formatHour(6, prefs), b: formatHour(12, prefs), c: formatHour(18, prefs) })}`}>
+          <FindingsList items={allFindings ? items : items.slice(0, FINDINGS_SHOWN)} canDismiss={findings.canDismiss} dismiss={dismiss} />
+          {items.length > FINDINGS_SHOWN ? (
+            <Button type="button" variant="ghost" className="mt-2" aria-expanded={allFindings} onClick={toggleFindings}>
+              {allFindings ? ti('showFewer') : ti('showAll', { count: items.length })}
+            </Button>
+          ) : null}
         </ChartCard>
       </div>
 
```

- [ ] **Step 4 — the page reads 64 days, captions, the count and the dismissals:**

```diff
diff --git a/app/(app)/accounts/[id]/(tabs)/page.tsx b/app/(app)/accounts/[id]/(tabs)/page.tsx
index c4c4050..1b139a3 100644
--- a/app/(app)/accounts/[id]/(tabs)/page.tsx
+++ b/app/(app)/accounts/[id]/(tabs)/page.tsx
@@ -13,15 +13,18 @@ import { StoriesTab } from '@/components/account/StoriesTab';
 import { TabSkeleton } from '@/components/account/TabSkeleton';
 import { setPostTagsAction } from '@/app/(app)/tags/actions';
 import { deleteFollowerSnapshotAction } from '@/app/(app)/accounts/followers-actions';
+import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
 import { deleteCommentAction, deleteRuleAction, hideCommentAction, previewWordRuleAction, replyCommentAction, saveWordRuleAction, setAutoHideAction, setSpamRuleAction, undoModerationAction } from '@/app/(app)/accounts/moderation-actions';
 import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
 import type { StoredAccount } from '@/lib/accounts/types';
+import { findInsights, INSIGHTS, visibleFindings } from '@/lib/analysis/insights';
 import { requireOwner } from '@/lib/auth/require-owner';
-import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample } from '@/lib/comments/read';
+import { loadCommentPage, loadCommentPosts, loadCommentStart, loadFans, loadOutsiders, loadTopicSample, loadUnansweredCounts } from '@/lib/comments/read';
 import { COMMENT_KEYS, parseCommentState } from '@/lib/comments/state';
 import { topics } from '@/lib/comments/topics';
 import { buildAccountOverview, parseTab, poolFor, type Tab } from '@/lib/dashboard/account';
 import { buildAudience } from '@/lib/dashboard/audience';
+import { loadDismissals } from '@/lib/dashboard/dismissals';
 import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
 import { buildPosts, buildStories, storyView } from '@/lib/dashboard/content';
 import { buildGrowth, growthReadFrom, HOURLY_MAX_DAYS } from '@/lib/dashboard/growth';
@@ -38,7 +41,7 @@ import { getPrefs } from '@/lib/prefs.server';
 import { createServerSupabase } from '@/lib/supabase/server';
 import { addDays, dayStart, daysToIso, localDay } from '@/lib/sync/time';
 import { isUuid } from '@/lib/tags';
-import { daysIn } from '@/lib/time-scope/range';
+import { daysIn, minDay } from '@/lib/time-scope/range';
 import { parseTimeScope, readFrom, resolveScope, type ResolvedScope } from '@/lib/time-scope/scope';
 
 type SearchParams = Record<string, string | string[] | undefined>;
@@ -155,22 +158,27 @@ async function TabContent({ tab, account, sp, scope }: { tab: Tab; account: Stor
       return <FollowersTab ready snapshots={snapshots} state={state} newer={view ? pair.newer : null} older={older ? pair.older : null} view={view} {...props} />;
     }
     default: {
-      const fromDay = readFrom(scope.scope, today);
+      // at least INSIGHTS.readDays back: the findings compare the latest day with the same weekday of the 8 weeks before
+      const fromDay = minDay(readFrom(scope.scope, today), addDays(today, -INSIGHTS.readDays));
       const pool = poolFor(account, await liveAccounts());
       const others = pool.filter((a) => a.id !== account.id);
-      const [daily, posts, sync, online, otherPosts, audience] = await Promise.all([
+      const [daily, posts, sync, online, otherPosts, audience, unanswered] = await Promise.all([
         loadDaily(db, account.id, fromDay),
-        loadPosts(db, account.id, MEDIA_LIMIT, dayStart(fromDay, tz).toISOString()),
+        loadPostRows(db, account.id, dayStart(fromDay, tz).toISOString()), // with captions: the hashtag rule reads them
         loadSyncStatus(),
         loadOnline(db, pool.map((a) => a.id), addDays(today, -30)), // Instagram keeps 30 days of online_followers
         Promise.all(others.map((a) => loadPosts(db, a.id))), // best time pools the newest posts, whatever the scope
         loadAudience(db, account.id),
+        loadUnansweredCounts(db, [account], today, tz), // never throws
       ]);
+      const found = findInsights({ accountId: account.id, daily, posts, unanswered: unanswered[account.id] ?? null }, { today, now, tz });
+      const dismissals = await loadDismissals(db, found.map((f) => f.key)); // null = migration missing: no dismiss buttons
+      const findings = { items: visibleFindings(found, dismissals, now), canDismiss: dismissals !== null, showAll: sp.findings === 'all' };
       const model = buildAccountOverview(
         { account, sync: sync[account.id], daily, posts, online: online[account.id] ?? [], pooled: { accounts: pool.length, posts: [...posts, ...otherPosts.flat()], online: Object.values(online).flat() } },
         { scope, today, now, tz, weekStart: prefs.weekStart },
       );
-      return <AccountOverview model={model} account={{ id: account.id, groupName: account.groupName }} audience={buildAudience(audience)} />;
+      return <AccountOverview model={model} account={{ id: account.id, groupName: account.groupName }} audience={buildAudience(audience)} findings={findings} dismiss={dismissFindingAction} />;
     }
   }
 }
```

- [ ] **Step 5 — verify:** `npx vitest run tests/account-view.test.tsx tests/account-drill.test.tsx tests/dashboard-account.test.ts tests/account-page.test.tsx tests/ui-standards.test.ts tests/comments-privacy.test.ts tests/report-document.test.tsx` (skip a file that does not exist) → pass; `npx tsc --noEmit`; `npx eslint components/account/AccountOverview.tsx lib/dashboard/account.ts "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/account-view.test.tsx tests/dashboard-account.test.ts tests/account-page.test.tsx`. Look at it (`npm run dev`, owner session if available; else rely on the tests and say so): 360 / 768 / 1280, light + dark of two themes.
- [ ] **Commit:** `git add components/account/AccountOverview.tsx lib/dashboard/account.ts "app/(app)/accounts/[id]/(tabs)/page.tsx" tests/account-view.test.tsx tests/dashboard-account.test.ts tests/account-page.test.tsx`, `git commit -m "feat(account): findings card with dismiss and snooze on the account Overview" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 7: Today on the Overview

**Files:** Create `components/overview/TodaySection.tsx`, `tests/today-section.test.tsx`. Modify `components/overview/OverviewView.tsx`, `app/(app)/overview/page.tsx`.

- [ ] **Step 1 — failing test** `tests/today-section.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildToday, todayFindings } from '@/lib/dashboard/today';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur';
const o = { today: TODAY, now: NOW, tz: KL };
const acct = (id: string, username: string, x: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-01-01T00:00:00Z', ...x });
const days = (n: number, f: (day: string) => Partial<DailyRow> = () => ({})): DailyRow[] => Array.from({ length: n }, (_, i) => { const day = addDays(TODAY, i - n); return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day) }; });
const post = (id: string, postedAt: string, reach: number, x: Partial<Post> = {}): Post => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
const input: OverviewInput = {
  accounts: [acct(A, 'brand.one'), acct(B, 'broken', { status: 'needs_reconnect' })],
  sync: { [A]: synced, [B]: synced },
  daily: { [A]: days(60, (d) => (d === '2026-10-14' ? { reach: 500 } : {})), [B]: days(60) },
  posts: { [A]: [...Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100)), post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS' })] },
};
const model = buildOverview(input, { scope: resolveScope(parseTimeScope(new URLSearchParams('from=7d')), TODAY, '2026-01-01'), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' });
const briefing = buildToday(input, model.sections.flatMap((s) => s.cards), todayFindings(input, { [A]: 2, [B]: null }, o), [], o);

function view(locale: 'en' | 'zh-CN' = 'en', b: typeof briefing | null = briefing) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <OverviewView model={model} today={TODAY} briefing={b ?? undefined} dismiss={vi.fn()} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Today on the Overview', () => {
  it('sits above the range bar, with the four answers', () => {
    view();
    const today = screen.getByRole('heading', { name: en.insights.today.title, level: 2 });
    const range = screen.getAllByRole('button').find((b) => /Last 7 Days|More ranges/.test(b.textContent ?? ''));
    expect(range && today.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of [en.insights.today.dayTitle, en.insights.today.attentionTitle, en.insights.today.workingTitle, en.insights.today.nextTitle]) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  });

  it('latest day vs normal: the value, the typical one with n, and an Unusual badge', () => {
    view();
    const day = screen.getByRole('region', { name: en.insights.today.dayTitle });
    expect(within(day).getByText('@brand.one · 14 Oct 2026')).toBeInTheDocument();
    expect(within(day).getByText('Reach: 500')).toBeInTheDocument();
    expect(within(day).getByText('usually 100 (n = 8)')).toBeInTheDocument();
    expect(within(day).getAllByText(en.insights.today.unusual)).toHaveLength(1);
  });

  it('needs attention: the reconnect problem first, then the findings with the account name and dismiss buttons', () => {
    view();
    const att = screen.getByRole('region', { name: en.insights.today.attentionTitle });
    expect(within(att).getByRole('link', { name: '@broken needs to be reconnected' })).toHaveAttribute('href', '/accounts');
    expect(within(att).getByText(/2 questions in the last 7 days/)).toBeInTheDocument();
    expect(within(att).getAllByRole('button', { name: /^Dismiss: / }).length).toBeGreaterThan(0);
  });

  it('working now links to the Post Lab; next says when there are too few posts for a slot', () => {
    view();
    expect(within(screen.getByRole('region', { name: en.insights.today.workingTitle })).getByRole('link')).toHaveAttribute('href', `/accounts/${A}/media/hit`);
    const next = screen.getByRole('region', { name: en.insights.today.nextTitle });
    expect(within(next).getByText(/not enough posts yet for a slot suggestion/)).toBeInTheDocument();
    expect(within(next).getByText('Last post 3 days ago')).toBeInTheDocument();
  });

  it('no briefing (no accounts or an old caller): no Today section; zh-CN renders cleanly', () => {
    const { unmount } = view('en', null);
    expect(screen.queryByRole('heading', { name: en.insights.today.title })).toBeNull();
    unmount();
    const { container } = view('zh-CN');
    expect(screen.getByRole('heading', { name: zh.insights.today.title, level: 2 })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|undefined|insights\./);
  });
});
```

- [ ] **Step 2 — `components/overview/TodaySection.tsx`:**

```tsx
'use client';

// "Today" on the Overview (Plan 17b, SPEC §7m; creator-toolkit design §0b): the latest settled day vs normal, what needs
// attention, what works now, what is next. Wiring and words only: the model is lib/dashboard/today.ts.
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FindingsList, type DismissAction } from '@/components/shared/FindingsList';
import { NavLink } from '@/components/shared/NavLink';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Finding } from '@/lib/analysis/insights';
import type { TodayModel } from '@/lib/dashboard/today';
import { formatDate, formatDay, formatNumber, formatSigned } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

export function TodaySection({ model, dismiss }: { model: TodayModel; dismiss?: DismissAction }) {
  const t = useTranslations('insights.today');
  const ti = useTranslations('insights');
  const ta = useTranslations('analysis');
  const tg = useTranslations('pages.account.growth');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const whole = (v: number | null) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const fmt = (id: string, v: number | null) => (id === 'followers' ? formatSigned(v, prefs) : whole(v));
  const findings = model.attention.flatMap((a) => (a.kind === 'finding' ? [a.finding] : []));
  const names = new Map(model.attention.flatMap((a) => (a.kind === 'finding' ? [[a.finding.key, a.username] as const] : [])));
  const problems = model.attention.flatMap((a) => (a.kind === 'problem' ? [a] : []));
  const block = 'grid min-w-0 content-start gap-2';
  const h3 = 'text-sm font-medium';

  return (
    <Card className="mb-[var(--gp)] min-w-0">
      <CardHeader>
        <CardTitle className="text-[length:var(--fh)] font-medium">
          <h2>{t('title')}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-[var(--gp)] md:grid-cols-2">
        <section aria-label={t('dayTitle')} className={block}>
          <h3 className={h3}>{t('dayTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('dayHint')}</p>
          {model.accounts.map((a) => (
            <div key={a.id} className="min-w-0">
              <p className="truncate text-sm font-medium">{t('dayLine', { username: a.username, date: formatDay(a.day, prefs) })}</p>
              <ul className="grid gap-0.5 text-sm">
                {a.metrics.map((m) => (
                  <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span>{t('metricLine', { metric: ti(`metric.${m.id}`), value: fmt(m.id, m.value) })}</span>
                    <span className="text-xs text-muted-foreground">{m.typical === null ? t('noTypical', { n: m.n }) : t('typical', { typical: fmt(m.id, m.typical), n: m.n })}</span>
                    {m.unusual ? <Badge variant="secondary">{t('unusual')}</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section aria-label={t('attentionTitle')} className={block}>
          <h3 className={h3}>{t('attentionTitle')}</h3>
          {problems.length === 0 && findings.length === 0 ? <p className="text-sm text-muted-foreground">{t('attentionEmpty')}</p> : null}
          {problems.length ? (
            <ul className="grid gap-1 text-sm">
              {problems.map((p) => (
                <li key={`${p.problem}:${p.accountId}`} className="border-l-2 border-l-destructive pl-3">
                  <Link href="/accounts" className="underline-offset-4 hover:underline">
                    {p.problem === 'needs_reconnect' ? t('needsReconnect', { username: p.username }) : t('syncError', { username: p.username, error: p.errorKey && tErr.has(p.errorKey) ? tErr(p.errorKey) : tErr('unexpected') })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {findings.length ? <FindingsList items={findings} canDismiss={model.canDismiss} dismiss={dismiss} label={(f: Finding) => `@${names.get(f.key) ?? ''}`} /> : null}
        </section>

        <section aria-label={t('workingTitle')} className={block}>
          <h3 className={h3}>{t('workingTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('workingHint')}</p>
          <ul className="grid gap-1 text-sm">
            {model.accounts.map((a) =>
              a.top ? (
                <li key={a.id} className="min-w-0 break-words">
                  <NavLink href={postLabHref(a.id, a.top.id)} className="underline-offset-4 hover:underline">
                    {t('top', { username: a.username, format: ta(`format.${a.top.mediaType}`), date: formatDate(a.top.postedAt, prefs), reach: whole(a.top.reach) })}
                  </NavLink>{' '}
                  <span className="text-xs text-muted-foreground">
                    {a.top.typical ? t('topVs', { ratio: formatNumber(a.top.reach / a.top.typical, prefs, { maximumFractionDigits: 1 }), format: ta(`format.${a.top.mediaType}`), n: a.top.n }) : t('topNoTypical')}
                  </span>
                </li>
              ) : (
                <li key={a.id} className="text-muted-foreground">
                  {t('noTop', { username: a.username })}
                </li>
              ),
            )}
          </ul>
        </section>

        <section aria-label={t('nextTitle')} className={block}>
          <h3 className={h3}>{t('nextTitle')}</h3>
          <ul className="grid gap-1 text-sm">
            {model.accounts.map((a) => (
              <li key={a.id} className="min-w-0 break-words">
                {a.slot
                  ? t('slot', { username: a.username, weekday: tg(`weekday.${a.slot.weekday}`), daypart: ti(`daypart.${a.slot.daypart}`), date: formatDay(a.slot.day, prefs), n: a.slot.n, confidence: ti(`confidence.${a.slot.confidence}`) })
                  : t('noSlot', { username: a.username })}{' '}
                <span className="text-xs text-muted-foreground">{a.lastPostDays === null ? t('noPost') : t('lastPost', { days: a.lastPostDays })}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-muted-foreground md:col-span-2">{t('proof')}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3 — wire it above the range bar:**

```diff
diff --git a/components/overview/OverviewView.tsx b/components/overview/OverviewView.tsx
index 7c80482..a16af7b 100644
--- a/components/overview/OverviewView.tsx
+++ b/components/overview/OverviewView.tsx
@@ -7,12 +7,14 @@ import { CircleUserRound, TrendingDown, TrendingUp, TriangleAlert } from 'lucide
 import { useTranslations } from 'next-intl';
 import { SyncBadge } from '@/components/accounts/SyncBadge';
 import { useSyncProgress } from '@/components/accounts/useSyncProgress';
+import { TodaySection } from '@/components/overview/TodaySection';
 import { SeriesChart } from '@/components/charts/SeriesChart';
 import { Sparkline } from '@/components/charts/Sparkline';
 import { usePrefs } from '@/components/providers/PrefsProvider';
 import { ChartCard } from '@/components/shared/ChartCard';
 import { DataTable, type Column } from '@/components/shared/DataTable';
 import { EmptyState } from '@/components/shared/EmptyState';
+import type { DismissAction } from '@/components/shared/FindingsList';
 import { startProgress } from '@/components/shared/NavigationProgress';
 import { NavLink } from '@/components/shared/NavLink';
 import { OpenInTab } from '@/components/shared/OpenInTab';
@@ -26,6 +28,7 @@ import { Button } from '@/components/ui/button';
 import { Card, CardContent } from '@/components/ui/card';
 import type { Kpi, KpiId } from '@/lib/analysis/growth';
 import type { AccountCard, OverviewModel } from '@/lib/dashboard/overview';
+import type { TodayModel } from '@/lib/dashboard/today';
 import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
 import type { AccountProgress } from '@/lib/sync/progress';
 import { formatCompact, formatDateTime, formatDelta, formatNumber, formatPercent } from '@/lib/format';
@@ -234,7 +237,8 @@ function Comparison({ model }: { model: OverviewModel }) {
   );
 }
 
-export function OverviewView({ model, today, exportButton, progress = NO_PROGRESS }: { model: OverviewModel; today: string; exportButton?: ReactNode; progress?: AccountProgress[] }) {
+/** `briefing` = the Today section (Plan 17b): above the range bar, because the range does not apply to it. */
+export function OverviewView({ model, today, exportButton, progress = NO_PROGRESS, briefing, dismiss }: { model: OverviewModel; today: string; exportButton?: ReactNode; progress?: AccountProgress[]; briefing?: TodayModel; dismiss?: DismissAction }) {
   const t = useTranslations('pages.overview');
   const tm = useTranslations('metrics');
   const tR = useTranslations('analysis.reasons');
@@ -248,6 +252,7 @@ export function OverviewView({ model, today, exportButton, progress = NO_PROGRES
   const header = (
     <>
       <PageHeader title={t('title')} subtitle={t('subtitle')} actions={exportButton} />
+      {briefing && model.sections.length > 0 ? <TodaySection model={briefing} dismiss={dismiss} /> : null}
       <RangeBar scope={model.scope} today={today} />
     </>
   );
```

- [ ] **Step 4 — the page:**

```diff
diff --git a/app/(app)/overview/page.tsx b/app/(app)/overview/page.tsx
index 841a0f2..033cc16 100644
--- a/app/(app)/overview/page.tsx
+++ b/app/(app)/overview/page.tsx
@@ -2,12 +2,18 @@ import { ExportDialog } from '@/components/export/ExportDialog';
 import { OverviewView } from '@/components/overview/OverviewView';
 import { requireOwner } from '@/lib/auth/require-owner';
 import { exportScopes } from '@/lib/export/params';
+import { dismissFindingAction } from '@/app/(app)/overview/insight-actions';
+import { INSIGHTS } from '@/lib/analysis/insights';
+import { loadUnansweredCounts } from '@/lib/comments/read';
+import { loadDismissals } from '@/lib/dashboard/dismissals';
 import { buildOverview } from '@/lib/dashboard/overview';
 import { loadOverviewInput } from '@/lib/dashboard/read';
 import { getPrefs } from '@/lib/prefs.server';
 import { createServerSupabase } from '@/lib/supabase/server';
 import { loadSyncProgress } from '@/lib/sync/progress-read';
-import { localDay } from '@/lib/sync/time';
+import { buildToday, todayFindings } from '@/lib/dashboard/today';
+import { addDays, localDay } from '@/lib/sync/time';
+import { minDay } from '@/lib/time-scope/range';
 import { earliestDay, parseTimeScope, readFrom, resolveScope } from '@/lib/time-scope/scope';
 
 export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
@@ -18,9 +24,15 @@ export default async function OverviewPage({ searchParams }: { searchParams: Pro
   const today = localDay(now, prefs.timezone);
   const time = parseTimeScope(sp, prefs.weekStart); // the URL is the only state; junk falls back to the default
   const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
-  const input = await loadOverviewInput(db, readFrom(time, today), prefs.timezone);
+  // at least INSIGHTS.readDays back: Today compares the latest day with the same weekday of the 8 weeks before
+  const input = await loadOverviewInput(db, minDay(readFrom(time, today), addDays(today, -INSIGHTS.readDays)), prefs.timezone);
   const scope = resolveScope(time, today, earliestDay(Object.values(input.daily)));
   const model = buildOverview(input, { scope, today, now, tz: prefs.timezone, locale: prefs.locale, weekStart: prefs.weekStart });
-  const progress = await loadSyncProgress(db, input.accounts, now); // never throws; [] when nothing imports
-  return <OverviewView model={model} today={today} progress={progress} exportButton={<ExportDialog scopes={exportScopes(input.accounts)} defaultScope="all" time={scope} />} />;
+  const o = { today, now, tz: prefs.timezone };
+  // both never throw: [] when nothing imports; null per account when the unanswered count cannot be read
+  const [progress, unanswered] = await Promise.all([loadSyncProgress(db, input.accounts, now), loadUnansweredCounts(db, input.accounts, today, prefs.timezone)]);
+  const found = todayFindings(input, unanswered, o);
+  const dismissals = await loadDismissals(db, Object.values(found).flat().map((f) => f.key)); // null = migration missing: no dismiss buttons
+  const briefing = buildToday(input, model.sections.flatMap((s) => s.cards), found, dismissals, o);
+  return <OverviewView model={model} today={today} progress={progress} briefing={briefing} dismiss={dismissFindingAction} exportButton={<ExportDialog scopes={exportScopes(input.accounts)} defaultScope="all" time={scope} />} />;
 }
```

- [ ] **Step 5 — verify:** `npx vitest run tests/today-section.test.tsx tests/overview-view.test.tsx tests/overview-drill.test.tsx tests/ui-standards.test.ts tests/comments-privacy.test.ts` → pass; `npx tsc --noEmit`; `npx eslint components/overview/TodaySection.tsx components/overview/OverviewView.tsx "app/(app)/overview/page.tsx" tests/today-section.test.tsx`. Look at 360 px (one column, no horizontal scroll, long handles wrap) and 1280 px (two columns).
- [ ] **Commit:** `git add components/overview/TodaySection.tsx components/overview/OverviewView.tsx "app/(app)/overview/page.tsx" tests/today-section.test.tsx`, `git commit -m "feat(overview): Today briefing above the range bar" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Task 8: SPEC §7m, runbook, TODO, PROGRESS

**Files:** Modify `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`. Create `docs/RUNBOOK_INSIGHTS.md`. Docs are CRLF: Edit / Write tools.

- [ ] **Step 1 — `docs/SPEC.md`:** insert immediately BEFORE the line `## 8. UI (v1)` (if Plan 17a already added §7l, this stays §7m; if §7m is taken, use the next free letter and say so):

```markdown
## 7m. Insights feed and Today (Plan 17b; creator-toolkit design §0b, §6)
Status: code complete, NOT verified live (`docs/RUNBOOK_INSIGHTS.md`). Migration `20261101000001_insight_dismissals.sql` (one owner-authored table) is NOT applied: apply only on the owner's go-ahead, BEFORE deploying; until then everything works except dismissing ("needs a database update").

- **Findings** (`lib/analysis/insights.ts`, pure, computed on read, never stored): eight rules per account, each with its evidence, `n`, a confidence word (Low or Medium, never High) and a link to the evidence: breakout (SPEC §7 "Post taking off", last 7 days), reach drop (§7c, 7 vs 7 days), unusual day (the settled day's follower change / reach / views / interactions vs the same weekday of the 8 weeks before, robust z ≥ 3.5, ≥ 4 values), best slot (weekday × day part ≥ 1.5× the other posts' median reach), format winner and hashtag winner (≥ 1.3×; the hashtag rule on the account Overview only), posting gap (no feed post for ≥ max(2 × the median gap, 3) days), unanswered questions (count of the last 7 days, always Low: thread replies are not read). Post rules use feed posts 7–180 days old with reach (young posts are still growing), need 20 of them and 5 on each side. Day parts in the owner timezone: night 0–5, morning 6–11, afternoon 12–17, evening 18–23. Ranked problems → good news → tips. Key `<kind>:<account id>:<id>`, stable across reads.
- **Account Overview → Findings card** (replaces the Flags card): top 5, "Show all" (`?findings=all`, `history.replaceState`), Dismiss (for good) and "Hide for 7 days" per finding, "Patterns, not proof".
- **Overview → Today** (above the range bar, which does not apply to it): (1) the latest settled day vs the same weekday of the 8 weeks before, per healthy account; (2) needs attention: reconnect / failing sync (card state), then bad-news findings and breakouts of every account, at most 8; (3) working now: the best feed post of the last 7 days vs the typical reach of its format; (4) next: the next day of the best slot (Low/Medium) and days since the last post.
- **Storage:** `insight_dismissals` (finding_key pk ≤ 200 chars, account_id fk cascade, until null = for good, created_at; owner-all RLS `(select is_owner())`; read by key, chunks of 50). In "Export your data"; deleted with the account (and by "Delete all data" through the cascade).
- **Privacy:** counts only from comments; params never hold usernames, comment text or captions (the hashtag rule holds the owner's own hashtag); nothing logged; no push (Plan 17e), no AI (17g).
```

Also in §8 replace `Pages: Login · Overview (account cards by group, comparison)` with `Pages: Login · Overview (Today briefing (§7m), account cards by group, comparison)`.

- [ ] **Step 2 — `docs/RUNBOOK_INSIGHTS.md`** (new, exactly):

```markdown
# Runbook: Insights feed + Today (Plan 17b) — live checks

Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app. Report yes/no and counts only.

## 0. The migration — on the owner's go-ahead, BEFORE deploying
`supabase/migrations/20261101000001_insight_dismissals.sql` adds one table. NOT applied.
    node --env-file=.env.local scripts/sb.mjs migration list        # expect only 20261101000001 pending
    node --env-file=.env.local scripts/db-probe.mjs table:insight_dismissals   # before: 404 PGRST205 (absent)
    node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly that file
    node --env-file=.env.local scripts/sb.mjs db push --yes
    node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched
    node --env-file=.env.local scripts/db-probe.mjs table:insight_dismissals   # after: 401 / 42501 (exists, anon denied)
Without it: no Dismiss buttons and the line "Dismissing findings needs a database update".

## 1. Findings make sense (L1)
1. Each account → Overview tab → Findings card. For every finding: open "Show the evidence"; the linked page shows the same story (Post Lab for a breakout, Growth with the day picked for an unusual day, Posts filtered by format, Comments → Unanswered questions).
2. Check the numbers of one `best_slot` against the best-time heatmap ("your post performance") and one `format_winner` against the format table: same direction.
3. Note any finding the owner calls wrong or useless (rule + why). A rule nobody acts on in a month is deleted, not tuned.
4. No finding says "High"; every card says "Patterns, not proof."

## 2. Dismiss and snooze (L2)
1. Dismiss one finding → "Hidden." and it leaves the list; reload → still gone; open the account in a second shell tab → gone there too.
2. "Hide for 7 days" on another → gone after reload; Supabase SQL editor (read-only, owner runs it): `select finding_key, until from public.insight_dismissals order by created_at desc limit 5;` shows `until` ≈ now + 7 days and NULL for the dismissed one. Keys hold no usernames or captions.
3. If an account has a hashtag finding, dismiss it (non-ASCII hashtag if possible): it stays hidden after reload (the keyed read with `:` and non-ASCII works).

## 3. Today (Overview)
1. Today sits above the range bar; changing the range does not change Today.
2. "Latest day vs your normal": the date is the KPIs' last settled day; the reach matches the account's Growth tab for that day; an "Unusual" badge only on a clear outlier.
3. "Needs attention": a reconnect / failing account shows first; the unanswered count matches Comments → Unanswered questions with the last 7 days (L4).
4. "Working now" opens the right Post Lab; "Next" names a weekday and day part and a date in the coming week, or says there are not enough posts.

## 4. Speed (L3)
DevTools → Network, `/overview` document (warm, 3 reloads): note the times before deploying 17b and after. Budget: ≤ 1.2 s p75. Over budget: report the times (the extra work is a 64-day daily read, one count rpc per account and one keyed read).

## 5. Phone and themes
360 / 768 / 1280 px, light and dark of two themes: Today one column on a phone, no horizontal scroll, long handles wrap; the Findings buttons stay tappable.

## 6. Privacy
Vercel logs: no row content. Today and the findings never show a commenter name or comment text; only counts.

Record outcomes here; tick `docs/TODO.md` (Plan 17b section) only after the owner has looked.
```

- [ ] **Step 3 — `docs/TODO.md`:** insert before the line `## 6b. Next (Plan 14/15 Settings)` (use the next free section number after the last `## 6x` that exists; 17a may have added one):

```markdown
## 6s. Insights feed + Today (Plan 17b)
- [x] Findings (8 rules, n, Low/Medium, dismiss / hide 7 days) on the account Overview; Today briefing on the Overview (code done; live verification pending: docs/RUNBOOK_INSIGHTS.md)
- [ ] Apply migration `20261101000001_insight_dismissals` (owner go-ahead; RUNBOOK_INSIGHTS §0)
- [ ] RUNBOOK_INSIGHTS §1–§6 with the owner (L1 rules make sense, L2 dismiss survives, L3 Overview ≤ 1.2 s, L4 unanswered count matches)
- Known: hashtag rule only on the account Overview (the Overview reads no captions); no hidden-findings list / undo; day parts and gap/hashtag medians duplicated with 17a until unified.
```

- [ ] **Step 4 — `docs/PROGRESS.md`:** §2 add a row `| Plan 17b (Insights feed + Today) | **code complete, NOT pushed, nothing verified live.** Migration 20261101000001_insight_dismissals NOT applied (owner go-ahead, before deploying; RUNBOOK_INSIGHTS §0); without it no dismiss buttons |`; §3 add `- **17b: Insights feed + Today (NOT verified live).** Eight rule-based findings per account with n and Low/Medium (account Overview Findings card, replaces Flags; dismiss / hide 7 days), Today briefing above the Overview range bar. Plan: docs/superpowers/plans/2026-11-01-17b-insights-feed-today.md. Runbook: RUNBOOK_INSIGHTS.`; §5 add the row `| 20261101000001_insight_dismissals | owner-authored dismissed / snoozed finding keys (Plan 17b; **NOT applied**) |`; §6 add `10. **docs/RUNBOOK_INSIGHTS.md** (Plan 17b): §0 migration, then §1–§6.`; §8 add `- 17b: 8 rules (thresholds in lib/analysis/insights.ts INSIGHTS), problems → good news → tips, dismiss for good + hide 7 days, Findings replaces Flags on the account Overview, Today above the range bar, hashtag rule on the account page only.`
- [ ] **Verify:** Markdown renders; `npx vitest run tests/ui-standards.test.ts`.
- [ ] **Commit:** `git add docs/SPEC.md docs/RUNBOOK_INSIGHTS.md docs/TODO.md docs/PROGRESS.md`, `git commit -m "docs(insights): spec 7m, runbook, todo and progress for the findings feed and Today" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

## Scratch-run result (2026-10-27, throwaway clone and PGlite OUTSIDE the repo)

**Code (clone of `main` at `81054d7`, WITHOUT 17a; own `npm ci`; the real `node_modules` untouched):** every file of Tasks 1–7 written exactly as in this plan. `tsc --noEmit` clean, `eslint` clean (whole repo), **`vitest run`: 309 test files / 3,141 tests green** (after the two fixes below), `next build` green (no new route). Every `diff` block of this plan was checked with `git apply --check` against a clean `81054d7` checkout: all 15 apply.

**Found by the dry run and fixed in this plan:** (1) `tests/settings-data.test.tsx` counts the "Download all" files (18 / 20): the new export table makes them 19 / 21 (Task 4 Step 6) and needs a label `settings.data.tables.insight_dismissals` (Task 1); (2) `tests/account-page.test.tsx` mocks `@/lib/comments/read` without `loadUnansweredCounts` and has no dismissals mock (Task 6); (3) the messages guard counts `=0 {today}` in a plural as a placeholder and refuses a string identical in both locales (Task 1 wording); (4) `zh-CN` weekday names come from `pages.account.growth.weekday` (星期二, not 周二); (5) **the `npm run check` wrapper once reported exit 0 while vitest had printed `× …` for a failing file and no summary**: read the log for `×` / "failed" (Waves).

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; all 16 existing migrations, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.users` / `auth.mfa_factors` / `storage.*`; roles `anon`, `authenticated`, `service_role` with Supabase-like default privileges), 14 of 14 checks passed:** the migration applies as the 17th; the owner (no factor, aal1) upserts by `finding_key` (`on conflict … do update`: `until` replaced) and reads by key; another signed-in user sees 0 rows and cannot insert (RLS); the owner at aal1 with a verified factor sees 0 rows, at aal2 both; `anon` gets "permission denied"; keys of < 3 and > 200 characters are refused; an unknown account is refused (foreign key, `23503` → `not_found`); `account_id` is required; deleting an account removes only its dismissals; the unchanged `delete_all_data()` empties the table through the cascade; the primary key and `insight_dismissals_account_idx` exist.

**Not executed:** a real PostgREST (L2: `.in('finding_key', …)` with `:` and non-ASCII values; the `PGRST205` code of a missing table), the live comment data (L4), a browser at 360 / 768 / 1280 px and the themes, Vercel latency (L3), any Meta call. 17a's code was not present (Order with 17a and 17c).

## Self-review

- Roadmap 17b coverage: `insights.ts` rules with key / kind / tone / params / n / confidence / day / href (Task 3); max 8 rules incl. breakout, reach drop, unusual day, best slot, format winner, cadence gap, hashtag winner, unanswered count (Task 3–4); account Overview Findings top 5 + `?findings=all` (Task 6); Overview Today (1)–(4) (Tasks 5, 7); dismiss / snooze 7 days per key (Tasks 2, 4); migration `insight_dismissals` with cascade + owner-all RLS (Task 2, `account_id` NOT NULL instead of the roadmap's "nullable": every finding has an account, and the cascade then covers "Delete all data"); EXPORT_TABLES (Task 4); runbook + SPEC + TODO + PROGRESS (Task 8). Deviations from the roadmap: `verdictOf` is not used for breakouts (it needs Post Lab peers per format and `post_lab_latest`; the breakout rule is SPEC §7's "taking off", which is the verdict's Breakout threshold); no Server-Timing in pages (Decision 13); `data_usage()` not replaced (Decision 12).
- Names checked against the code by grep: `takingOff`, `reachDrop`, `summarize`, `weekdayAnomaly`, `median`, `weekdayOf`, `captionFeatures`, `CAPTION_MIN_POSTS`, `postLabHref`, `localDay`, `localHour`, `addDays`, `daysToIso`, `dayStart`, `daysBetween`, `minDay`, `weekOf`, `readFrom`, `loadOverviewInput`, `loadPostRows`, `loadPosts`, `buildOverview`, `AccountCard`, `paged`, `QUESTION_PATTERN`, `hasScope`, `COMMENTS_SCOPE`, `requireOwner`, `createServerSupabase`, `EXPORT_TABLES`, `formatDay`, `formatDate`, `formatHour`, `formatDelta`, `formatSigned`, `formatNumber`, `NavLink`, `Badge`, `Card*`, `pages.account.growth.weekday`, `analysis.format`, `accounts.errors`.
- Cross-task file edits: none (every file has one owning task). `messages/*.json` only in Task 1.
