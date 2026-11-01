# Plan 17c: Auto-tagging from hashtags, caption words and format — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** tags apply themselves; the owner only corrects (creator-toolkit design §0b "Tags (owner): automatic — the app suggests AND applies tags from hashtags, caption keywords and format; never silently overwrite a manual tag"). The Tags page gets a **Rules** button per tag: rules "hashtag is #x", "caption contains word/phrase", "format is Reels / Carousel / Image". New posts that match a rule get the tag when the sync lists them; older posts get it only when the owner presses **Apply to existing posts**, which first shows how many posts would change. A tag already on a post is never touched; a tag the owner removes from a post is never added back; rules never remove anything.

**Architecture:** one migration `supabase/migrations/20261102000001_tag_rules.sql` (owner-all RLS on two new tables `tag_rules` and `media_tag_rejections`, a column `media_tags.source manual|auto`, and a `BEFORE INSERT` trigger on `media_tags` that drops a rule-written row whose (post, tag) pair the owner removed). Matching is TypeScript, not SQL (Unicode / CJK safety is already solved there): pure `lib/tag-rules/rules.ts` (`normalizeRuleValue`, `hashtagsOf` = `captionFeatures(...).hashtags` after NFKC, `ruleMatches` reusing the moderation `fold` / `matchRule` word matcher, `planAutoTags` = the diff: what to ADD, capped at 10 tags per post, idempotent), and `lib/tag-rules/apply.ts` (`loadRules`, `loadRuleMedia`, `applyTagRules`: reads tags and rejections only for the posts a rule matches, by id in chunks of 100, then `upsert … ignoreDuplicates` with `source: 'auto'`). Two callers: (a) the sync: `SyncStore.autoTag(items)` called once by the `mediaList` job right after `upsertMedia` (admin client, best-effort, `scope: 'new'` = only posts published at or after the rule was written); (b) owner server actions in `app/(app)/tags/actions.ts` (`addTagRuleAction`, `deleteTagRuleAction`, `previewTagRulesAction`, `applyTagRulesAction`, owner session, `scope: 'all'`). `setPostTagsAction` (the existing tag picker save) now records every tag the owner removes in `media_tag_rejections` BEFORE deleting it. UI: `components/tags/TagRulesDialog.tsx` (new) opened from `TagsView`.

**Tech Stack:** Next.js 16.4 App Router (server actions), React 19.3, TypeScript strict, `@supabase/supabase-js` (installed), next-intl 4, shadcn via the shared pieces (`ResponsiveDialog*`, `Segmented`, `FormField`, `LoadingButton`, `Button`, `Input`), Vitest + Testing Library + jsdom. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Tags (owner)") and §6; roadmap `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §1.1 (row "Auto-tagging"), §3 "17c", §4 Q7, §6 item 6 (SPEC §5 conflict). **`docs/SPEC.md` §5 still says "hashtag-to-tag auto-suggest is later": Task 7 aligns it with §0b — ⚠ owner's nod needed** (the owner approved §0b; this plan only follows it). Project rules: `CLAUDE.md`. Rules that apply to EVERY 17x plan: roadmap §3 (not repeated here; they bind).

**Independence:** Plans 17a and 17b are planned in parallel and NOT built. This plan uses none of their code. `captionFeatures` is the shared hashtag source of truth (17a will use the same function). Migration timestamp `20261102000001` sorts AFTER 17b's expected `20261101000001_insight_dismissals.sql`; the two migrations are independent (no shared table).

**Scratch run:** every code block of Tasks 1–6 was written into a throwaway `git clone` of `main` at `81054d7` in the session scratchpad (own `npm ci`; the real `node_modules` untouched) and the migration was executed on PGlite 0.3.15 (Postgres 17 in WASM) on top of all 16 existing migrations. Results: "Scratch-run result" at the end.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **Assumed from roadmap §4 (Q7, approved as working assumptions):** rules the owner writes apply automatically; a manual tag is NEVER overwritten; a tag the owner removed from a post is NEVER re-added (`media_tag_rejections`); rules are owner-authored (hashtag / caption word / format → tag); whole-word, Unicode-safe matching with Chinese / Japanese / Korean handled (the `lib/moderation/rules.ts` lessons: NFKC + lower case, Latin whole words, CJK anywhere); idempotent and safe to re-run; bulk apply shows a preview count before confirming. "Suggest for nothing else" (Q7 default) ⇒ **no "Suggested" chips in the TagPicker** (the roadmap's §3 text mentions them; with auto-apply the only non-applied matches are pairs the owner rejected, so chips would re-suggest what the owner removed). Out of scope; listed as an open question.
- **⚠ Automatic = new posts only.** The sync applies a rule only to posts published at or after the rule's `created_at` (`scope: 'new'`). Existing posts change only through "Apply to existing posts" with its preview. Why: writing a rule must never silently relabel the back catalogue; the preview is the one place mass changes happen. Edge: a post published a few minutes BEFORE the rule was written is not tagged automatically (use Apply). A caption edited later on Instagram is re-read by the next listing (recent posts, 30 days), so a hashtag added later still tags a post published after the rule.
- **⚠ Every tag the owner removes is remembered**, manual or automatic (`setPostTagsAction`: read the post's current tags → upsert the removed pairs into `media_tag_rejections` → then delete them). The owner's words: "a tag the owner removed from a post is NEVER re-added". The memory is written FIRST, so a failure leaves the tag on the post (retry), never a removed tag without memory. Re-adding a tag by hand always works (the rejection only blocks rule writes). Rejections have no UI (no "forget" button): ponytail; the owner can re-tag by hand.
- **Enforced by the database too.** `media_tags_skip_rejected` (BEFORE INSERT trigger, `security invoker`, `search_path = ''`) returns NULL for a `source = 'auto'` row whose pair is in `media_tag_rejections`: even a sync that read the rejections a moment before the owner removed the tag cannot add it back. Manual rows are never blocked. A rule write is always `INSERT … ON CONFLICT (media_id, tag_id) DO NOTHING` (`upsert` + `ignoreDuplicates`): an existing row (manual or auto) is never changed. PGlite verified all of this for the owner session and the service role.
- **Rules never delete.** Deleting a rule keeps the tags it added (said in the dialog hint). Deleting a tag cascades its rules, its rejections and its `media_tags` (FK `on delete cascade`, verified). Deleting a post cascades its rejections.
- **`media_tags.source`** (`manual` default for every existing row, `auto` from rules) is written and exported, not shown in the UI in 17c (ponytail: nothing reads it yet; it makes the data honest and lets a later "undo apply" or an "auto" badge exist without a migration). Roadmap §3 17c lists it.
- **Matching in TypeScript, not in a SQL `apply_tag_rules` function** (the roadmap leaves the choice to this plan). Postgres has no Unicode word boundary and `[[:alnum:]]` depends on the locale; the TS matchers are already tested for CJK and full-width text. Cost: the posts are read into the server action (Apply) — feed posts and Reels of all accounts, 1,000-row pages, capped at 20,000 (`ponytail:` comment). The sync passes the items it just listed (no extra media read).
- **Rule semantics:** *hashtag* = equality with one of the caption's hashtags after NFKC + lower case (`#Food`, `＃ＦＯＯＤ` → `food`; `#foodie` does not match `food`; `#美食` works; the stored value has no `#`; letters, digits, `_`, ≤ 50). *word* = `validateWord` (≥ 3 characters unless CJK, ≤ 50, at least one letter or digit) folded; matched by the moderation matcher: Latin whole words (`sale` not in `wholesale`, but in `#sale`), CJK anywhere, phrases allowed (`link in bio`). *format* = `REELS`, `CAROUSEL_ALBUM` or `IMAGE` (Stories never: no caption, gone after 24 h; Stories are never auto-tagged by any rule). Values are stored folded; uniqueness `(tag_id, kind, lower(value))`.
- **Limits:** at most 200 rules in total (`MAX_RULES`, one read); at most 10 tags per post as before (`MAX_TAGS_PER_POST`): rules fill up to 10, oldest rule first; a manual save is unchanged (10).
- **Preview = the same code as the apply** (`applyTagRules(..., dryRun: true)`), per tag, run when the owner presses "Apply to existing posts" (not live while typing: a live preview would ship every caption to the browser or call the server per keystroke). The count is "posts that would get this tag"; the owner then presses Apply (or Cancel). Server actions inherit Vercel's default duration; reading 20,000 captions is well under it (estimate: ≤ 20 pages × ~200 ms).
- **Sync placement and budget:** one call per account run inside the `mediaList` job (after `upsertMedia`), not a separate job and not in the tick after the alerts. Cost when no rule exists: one `select` on `tag_rules` (≤ 200 rows). With rules: + 2 reads per 100 matching posts + 1 upsert; normally 0–2 new posts. Not wrapped in a time check (a clock read would shift the existing budget tests; the call is milliseconds). Any failure is swallowed (`.catch(() => {})`): a rule problem never costs the media list, never marks the account failing, never logs.
- **Admin client:** used ONLY by the existing `supabaseSyncStore(db)` (the sync's own admin client) → `autoTag` → `loadRules` / `applyTagRules`. The owner actions use `createServerSupabase()` (RLS). `lib/tag-rules/*` never imports a Supabase client factory.
- **Export / storage:** `tag_rules` and `media_tag_rejections` join `EXPORT_TABLES` (owner data, not third-party; 22 files in all, 20 without other people's data). Storage used: `lib/data/usage.ts` needs no change (unknown tables fall into "other"), but `data_usage()` (16c, applied) lists tables by a literal array, so the two new (tiny) tables are **not counted** until a later migration replaces that function (not done here: replacing a SECURITY DEFINER function for two tables of a few hundred rows is not worth a second function in this migration). `delete_all_data()` needs no change: both tables cascade from `tags` / `media` (PGlite verified).
- **UI:** Tags table → actions column gains **"Rules (n)"** (ghost `size="sm"` like Rename / Delete: dense table, UI standard 5). Dialog = `ResponsiveDialog` (bottom sheet on phones): title, hint, the rules list (each with Remove), an add form (`Segmented` kind: Hashtag / Word in caption / Format; then an `Input` or a `Segmented` of the three formats), and an "Apply to existing posts" block (preview text `role="status"`, Cancel / Apply, result `role="status"`, errors `role="alert"` as translated keys). Without the migration: no Rules buttons, one muted line "Automatic tagging needs a database update." Tokens only; `min-w-0`, `break-words`, `dir="auto"` for owner-typed values; works at 360 / 768 / 1280.
- **Errors are keys:** `invalid_hashtag | invalid_word | rule_too_short | invalid_format | duplicate_rule | too_many_rules | not_found | needs_update | unexpected` (`pages.tags.errors.*`).

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check in `docs/RUNBOOK_AUTOTAG.md`)

1. **⚠ SPEC §5 edit** (Task 7): replace "hashtag-to-tag auto-suggest is later" with the §0b behaviour. Default: yes (owner approved §0b).
2. **Automatic for new posts only?** Default: yes (Decisions). Alternative: every rule change re-applies to the last 30 days automatically.
3. **Remember manual removals too?** Default: yes (every removal). Alternative: only removals of `auto` tags.
4. **"Suggested" chips in the tag picker** (roadmap §3 text). Default: not built (Q7 "suggestions for nothing else").
5. **Storage used** does not count the two new tables (Decisions). Default: accept until `data_usage()` is next replaced.
6. **L1 — `upsert(..., { ignoreDuplicates: true })` through PostgREST with the trigger** returns 201 and writes nothing for a rejected pair (PGlite proved the SQL `INSERT … ON CONFLICT DO NOTHING` + trigger; PostgREST's `Prefer: resolution=ignore-duplicates` is assumed to produce the same SQL). RUNBOOK §3.
7. **L2 — real captions:** hashtags in the owner's real captions (Chinese, emoji neighbours, line breaks) are found as the tests say. RUNBOOK §2.
8. **L3 — tick duration** unchanged after rules exist (Server-Timing / `sync_runs` durations, RUNBOOK §4).

## Owner prerequisites

1. **Apply the migration `20261102000001_tag_rules.sql`** (owner's explicit go-ahead; `docs/RUNBOOK_AUTOTAG.md` §0) BEFORE deploying. The code degrades without it: no Rules buttons, the sync skips auto-tagging, removing a tag still works (the memory write is skipped on "table not found").
2. Order with other pending migrations: after 17b's (if any); independent of it. `sb.mjs db push` applies in file order.

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- `supabase/migrations/20261017000001_tags.sql`: `tags (id uuid pk, name, color, created_at)`, unique `lower(name)`; `media_tags (media_id text fk media cascade, tag_id uuid fk tags cascade, created_at, pk (media_id, tag_id))`, index `media_tags_tag_idx`; both owner-all RLS (`using (public.is_owner())`). Later migrations use the InitPlan form `((select public.is_owner()))` (this plan does).
- `lib/tags.ts:5` `MAX_TAGS_PER_POST = 10`; `isUuid`, `isMediaId`.
- `app/(app)/tags/actions.ts` (`'use server'`): `TagError`, `TagResult`, private `DbError`, `keyOf`, `fail`, `done()` (revalidates `/tags` and `/accounts/[id]`), `setPostTagsAction` at line 79 (upsert with `ignoreDuplicates`, then `delete … not in (ids)`).
- `app/(app)/tags/page.tsx`: owner session, `Promise.all([loadAccounts(), loadTags(db)])`, passes the actions to `TagsView`. `app/(app)/tags/loading.tsx` exists.
- `components/tags/TagsView.tsx`: `TagsViewProps { tags, stats, create, rename, remove }`; actions column with Rename / Delete ghost `size="sm"` buttons; `CreateForm` inside a `Card`; `RenameDialog` + `ConfirmDialog`.
- `components/account/TagPicker.tsx` / `PostsTab` / `PostLabView` call `setPostTagsAction` (unchanged signature).
- `lib/moderation/rules.ts:46` `fold` (NFKC, lower, zero-width removed, whitespace collapsed); `:75` `matchRule(text, rules)`; `:95` `validateWord(raw, existing)` (PATTERN_MAX 50, WORD_MIN 3 unless CJK). Importing them from a non-moderation module is allowed by `tests/moderation-privacy.test.ts` (only `lib/sync/*` importers are restricted, and `lib/tag-rules/*` is not under `lib/sync/`).
- `lib/analysis/caption.ts:22` `HASHTAG = /#([\p{L}\p{N}_]+)/gu`; `:30` `captionFeatures(caption).hashtags` (unique, lower case, no `#`).
- `lib/sync/run-account.ts:227` `mediaList` job: `listMedia` → `upsertMedia` (line 232) → `return { done: !outOfTime(c) }`. `lib/sync/store.ts:63` `SyncStore.upsertMedia`; `:215` its implementation; `supabaseSyncStore(db)` is built with the admin client in `lib/sync/deps.ts`. `IgMediaItem` = `{ id, kind, caption, permalink, postedAt, details? }` (`lib/instagram/parse.ts`).
- `tests/fixtures/sync-fakes.ts`: `memoryStore()` with `const store: SyncStore = {…}` (line 74) and the return object (line 147); `tests/sync-run-account.test.ts` `media jobs` describe with `post()` helper and the test "backfill: every listed post gets its lifetime metrics on the first pass".
- `lib/data/export.ts:31` `{ name: 'media_tags', keys: ['media_id', 'tag_id'] },` inside `EXPORT_TABLES`; `tests/data-export.test.ts` checks every exported table's keys against `create table public.<name> (…\n);` in the migrations; `tests/settings-data.test.tsx:84,87,92` count 18 / "18 files downloaded." / 20; `components/settings/DataExport.tsx` labels each table with `settings.data.tables.<name>`.
- `messages/en.json` / `zh-CN.json`: line 1163 `pages.tags.deleteBody`, line 1170 `pages.tags.errors.too_many`, line 426 `settings.data.tables.media_tags`; `analysis.format.{REELS,CAROUSEL_ALBUM,IMAGE,STORY}` exist.
- `tests/migrations.test.ts`: every `create table public.X` needs `enable row level security` and a policy `to authenticated`; definer functions pin `search_path`.

## Out of scope

Suggested chips in the tag picker; a live preview while typing; an "auto" badge or filter; undo of an apply; a "forget this removal" UI; rules on Stories; regex or "caption starts with" rules; per-account rules; replacing `data_usage()`; any Meta call (none needed); SQL-side matching.

## Global Constraints

- Ponytail: no new dependency, no new design token, one migration. Reuse `captionFeatures`, `fold`, `matchRule`, `validateWord`, `MAX_TAGS_PER_POST`, `isUuid`, the shared dialog/form pieces.
- TypeScript strict. `requireOwner()` first and OUTSIDE try/catch in every new action. Errors are keys; no Supabase message, caption or value reaches a response or a log. **No `console.*` in any new or changed file.**
- Writes to `media_tags` by rules are insert-only (`ignoreDuplicates`), `source: 'auto'`; nothing in this plan deletes a `media_tags` row except the owner's own picker save (unchanged behaviour plus the memory).
- Every UI string via next-intl; ALL keys added by Task 1 in BOTH catalogs (real Simplified Chinese, full-width punctuation).
- Tests: Vitest; lib / action tests `// @vitest-environment node`; fakes only; never connect to Supabase. The migration file is NEVER applied by an implementer.
- `npm run check` passes after every wave. Commits: conventional, `git add` the listed paths only, last line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (`git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`). Don't push.

## Review Focus (opus review after the last wave)

1. **Manual tags never touched:** every rule write is `upsert(…, { onConflict: 'media_id,tag_id', ignoreDuplicates: true })` with `source: 'auto'`; grep `lib/tag-rules/` for `.delete(` / `.update(` (must be none); `planAutoTags` skips existing tags (Task 3 tests; PGlite: auto never overwrites manual).
2. **Rejection memory:** written BEFORE the delete in `setPostTagsAction` (Task 5 test checks the order); the trigger blocks rule rows (PGlite: owner session and service role); missing-table tolerance limited to `PGRST205`/`42P01`.
3. **Admin client limited:** only `supabaseSyncStore(db).autoTag` (the existing sync client); `lib/tag-rules/*` imports no client factory; the actions use `createServerSupabase` only (Task 5 test: no `ADMIN` call).
4. **Tick budget:** one `tag_rules` read per account run when no rule exists; reads by id in chunks of 100; failure swallowed; no clock read added (existing budget tests unchanged).
5. **1,000-row cap:** rules ≤ 200 (one read); tags/rejections read per ≤ 100 post ids (≤ 10 tags per post); media in ordered 1,000-row pages.
6. **Matching correctness:** full-width `＃`, CJK hashtags and words, `#foodie` vs `food`, `wholesale` vs `sale`, Stories never, `scope 'new'` boundary (equal timestamp counts as new).
7. **Preview = apply:** both go through `applyTagRules` with only `dryRun` different.
8. **UI:** one control height per row, dialog at 360 px, errors as keys, owner-typed text rendered as text (`dir="auto"`, `break-words`), focus returns on close (Radix).
9. **Privacy:** captions are the owner's own; nothing third-party is read; no logging.

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | `pages.tags.{rulesButton,rulesButtonNamed,rulesNeedUpdate,rules.*}`, `pages.tags.errors.*` (7 new), `settings.data.tables.{tag_rules,media_tag_rejections}` |
| `supabase/migrations/20261102000001_tag_rules.sql` (new), `tests/tag-rules-migration.test.ts` (new) | 2 | tables, column, RLS, trigger; static SQL test |
| `lib/tag-rules/rules.ts` (new), `lib/tag-rules/apply.ts` (new), `tests/tag-rules.test.ts` (new), `tests/tag-rules-apply.test.ts` (new) | 3 | pure matching/diff; reads and the insert-only write |
| `lib/sync/store.ts`, `lib/sync/run-account.ts`, `tests/fixtures/sync-fakes.ts`, `tests/sync-run-account.test.ts`, `tests/tag-rules-apply.test.ts` (append) | 4 | sync hook |
| `app/(app)/tags/actions.ts`, `tests/tag-actions.test.ts`, `tests/tag-rule-actions.test.ts` (new), `lib/data/export.ts`, `tests/settings-data.test.tsx` | 5 | rule actions, rejection memory, export registry |
| `components/tags/TagRulesDialog.tsx` (new), `components/tags/TagsView.tsx`, `app/(app)/tags/page.tsx`, `tests/tags-view.test.tsx` | 6 | UI wiring |
| `docs/RUNBOOK_AUTOTAG.md` (new), `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 7 | docs |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line with the block shown), never by re-serialising the JSON. Both locales get the same keys.

**Editing existing files:** exact old → new text for the Edit tool. Working copies are CRLF (`core.autocrlf=true`); the Edit tool matches either; do not convert line endings. New files: Write tool.

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261102000001_tag_rules.sql`, `tests/tag-rules-migration.test.ts` | 1, 3 |
| 3 rules + apply libs | — | `lib/tag-rules/rules.ts`, `lib/tag-rules/apply.ts`, `tests/tag-rules.test.ts`, `tests/tag-rules-apply.test.ts` | 1, 2 |
| 4 sync hook | 3 | `lib/sync/store.ts`, `lib/sync/run-account.ts`, `tests/fixtures/sync-fakes.ts`, `tests/sync-run-account.test.ts`, `tests/tag-rules-apply.test.ts` (append only) | 5 |
| 5 actions + export | 1, 2, 3 | `app/(app)/tags/actions.ts`, `tests/tag-actions.test.ts`, `tests/tag-rule-actions.test.ts`, `lib/data/export.ts`, `tests/settings-data.test.tsx` | 4 |
| 6 UI | 1, 3, 5 | `components/tags/TagRulesDialog.tsx`, `components/tags/TagsView.tsx`, `app/(app)/tags/page.tsx`, `tests/tags-view.test.tsx` | 7 |
| 7 docs | 2 | `docs/RUNBOOK_AUTOTAG.md`, `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 6 |

**Waves (at most 3 sonnet worktree agents at a time; check free disk first, `Get-PSDrive C`):** 1 = Tasks 1, 2, 3 → 2 = Tasks 4, 5 → 3 = Tasks 6, 7. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log` and READ it. Every wave leaves `main` green: wave 1 adds unused keys, an unapplied migration and unused libs; wave 2 wires the sync (no rules exist → one read, nothing written) and adds actions no page calls yet (plus two export files that answer "table not found" until the migration: the export of those two files fails with the existing "export failed" message before the migration — acceptable, noted in the runbook); wave 3 wires the page. Then an opus read-only review (Review Focus), ONE fix wave, check, commit (orchestrator).

---

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

- [ ] **Step 1 — en, Tags page.** Replace the exact line (line 1163, inside `pages.tags`)

```json
      "deleteBody": "It is removed from every post. The posts and their numbers stay.",
```

with

```json
      "deleteBody": "It is removed from every post. The posts and their numbers stay.",
      "rulesButton": "Rules ({count})",
      "rulesButtonNamed": "Rules for {name}",
      "rulesNeedUpdate": "Automatic tagging needs a database update.",
      "rules": {
        "title": "Rules for “{name}”",
        "hint": "Posts that match a rule get this tag automatically when they are synced. A tag you remove from a post is never added back, and rules never remove tags.",
        "none": "No rules yet.",
        "kind": "Rule type",
        "kinds": { "hashtag": "Hashtag", "word": "Word in caption", "format": "Format" },
        "valueLabel": { "hashtag": "Hashtag (without #)", "word": "Word or phrase" },
        "format": "Format",
        "add": "Add rule",
        "label": { "hashtag": "Hashtag #{value}", "word": "Caption contains “{value}”", "format": "Format is {format}" },
        "remove": "Remove",
        "removeNamed": "Remove the rule: {rule}",
        "applyHint": "New posts are tagged when they are synced. Older posts get the tag only when you apply the rules to them.",
        "applyExisting": "Apply to existing posts",
        "preview": "{count, plural, one {Adds this tag to # post.} other {Adds this tag to # posts.}} Tags you set or removed by hand stay as they are.",
        "previewNone": "No post would change.",
        "apply": "Apply",
        "applied": "{count, plural, one {Tagged # post.} other {Tagged # posts.}}",
        "close": "Close"
      },
```

- [ ] **Step 2 — en, errors.** Replace the exact line (line 1170)

```json
        "too_many": "Too many tags: a post can have at most 10, and there can be 500 tags in total.",
```

with

```json
        "too_many": "Too many tags: a post can have at most 10, and there can be 500 tags in total.",
        "invalid_hashtag": "Use letters, digits or _ only, without spaces (at most 50).",
        "invalid_word": "Use 1–50 characters with at least one letter or digit.",
        "rule_too_short": "Use at least 3 letters (one character is enough in Chinese, Japanese or Korean).",
        "invalid_format": "Pick a format.",
        "duplicate_rule": "This tag already has that rule.",
        "too_many_rules": "Too many rules: there can be 200 in total.",
        "needs_update": "Automatic tagging needs a database update.",
```

- [ ] **Step 3 — en, export table labels.** Replace the exact line (line 426)

```json
        "media_tags": "Tags on posts",
```

with

```json
        "media_tags": "Tags on posts",
        "tag_rules": "Tag rules",
        "media_tag_rejections": "Tags you removed from posts",
```

- [ ] **Step 4 — zh-CN, Tags page.** Replace the exact line (line 1163)

```json
      "deleteBody": "该标签会从所有帖子中移除，帖子及其数据保留。",
```

with

```json
      "deleteBody": "该标签会从所有帖子中移除，帖子及其数据保留。",
      "rulesButton": "规则（{count}）",
      "rulesButtonNamed": "{name} 的规则",
      "rulesNeedUpdate": "自动打标签需要先更新数据库。",
      "rules": {
        "title": "“{name}”的规则",
        "hint": "符合规则的帖子在同步时会自动加上此标签。你从帖子上移除的标签不会被再次加上，规则也从不移除标签。",
        "none": "还没有规则。",
        "kind": "规则类型",
        "kinds": { "hashtag": "话题标签", "word": "文案中的词", "format": "形式" },
        "valueLabel": { "hashtag": "话题标签（不含 #）", "word": "词或短语" },
        "format": "形式",
        "add": "添加规则",
        "label": { "hashtag": "话题标签 #{value}", "word": "文案包含“{value}”", "format": "形式为{format}" },
        "remove": "移除",
        "removeNamed": "移除规则：{rule}",
        "applyHint": "新帖子在同步时自动加标签。较早的帖子只有在你对其应用规则后才会加上标签。",
        "applyExisting": "应用到已有帖子",
        "preview": "{count, plural, other {将为 # 篇帖子加上此标签。}}你手动设置或移除的标签保持不变。",
        "previewNone": "没有帖子会改变。",
        "apply": "应用",
        "applied": "{count, plural, other {已为 # 篇帖子加上标签。}}",
        "close": "关闭"
      },
```

- [ ] **Step 5 — zh-CN, errors.** Replace the exact line (line 1170)

```json
        "too_many": "标签过多：每篇帖子最多 10 个标签，标签总数上限为 500。",
```

with

```json
        "too_many": "标签过多：每篇帖子最多 10 个标签，标签总数上限为 500。",
        "invalid_hashtag": "只能使用字母、数字或 _，不含空格（最多 50 个）。",
        "invalid_word": "请使用 1–50 个字符，且至少包含一个字母或数字。",
        "rule_too_short": "请至少输入 3 个字母（中文、日文或韩文一个字即可）。",
        "invalid_format": "请选择一种形式。",
        "duplicate_rule": "此标签已有这条规则。",
        "too_many_rules": "规则过多：总数上限为 200 条。",
        "needs_update": "自动打标签需要先更新数据库。",
```

- [ ] **Step 6 — zh-CN, export table labels.** Replace the exact line (line 426)

```json
        "media_tags": "帖子上的标签",
```

with

```json
        "media_tags": "帖子上的标签",
        "tag_rules": "标签规则",
        "media_tag_rejections": "你从帖子上移除的标签",
```

- [ ] **Step 7 — verify.** `npx vitest run tests/messages.test.ts` → PASS (same keys, placeholders match, zh differs from en). `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` → no error.
- [ ] **Step 8 — commit.** `git add messages/en.json messages/zh-CN.json` → `git commit -m "feat(i18n): strings for tag rules and auto-tagging (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 2: migration + its test (NEVER applied)

**Files:** Create `supabase/migrations/20261102000001_tag_rules.sql`, `tests/tag-rules-migration.test.ts`.

- [ ] **Step 1 — failing test.** Write `tests/tag-rules-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261102000001_tag_rules.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('tag rules migration (Plan 17c)', () => {
  it('two owner-only tables, one column, one trigger; nothing dropped, no grant, no definer', () => {
    const heads = sql
      .replace(/\$\$[\s\S]*?\$\$/g, '$$body$$')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create table', 'create unique', 'alter table', 'create policy', 'alter table', 'create table', 'create index', 'alter table', 'create policy', 'create or', 'create trigger']);
    expect(sql).not.toMatch(/\b(drop|truncate|grant|security\s+definer)\b/i);
  });

  it('tag_rules: kinds, formats and length; cascades with the tag; unique per tag, kind and value ignoring case', () => {
    expect(sql).toMatch(exact("kind text not null check (kind in ('hashtag', 'word', 'format'))"));
    expect(sql).toMatch(exact('char_length(value) between 1 and 50 and value = btrim(value)'));
    expect(sql).toMatch(exact("check (kind <> 'format' or value in ('IMAGE', 'CAROUSEL_ALBUM', 'REELS'))"));
    expect(sql).toMatch(exact('tag_id uuid not null references public.tags (id) on delete cascade'));
    expect(sql).toMatch(exact('create unique index tag_rules_tag_kind_value_key on public.tag_rules (tag_id, kind, lower(value))'));
  });

  it('media_tags.source: manual by default (every existing row), auto only from rules', () => {
    expect(sql).toMatch(exact("alter table public.media_tags add column source text not null default 'manual' check (source in ('manual', 'auto'))"));
  });

  it('media_tag_rejections: one row per (post, tag), deleted with the post or the tag', () => {
    expect(sql).toMatch(exact('media_id text not null references public.media (id) on delete cascade'));
    expect(sql).toMatch(exact('primary key (media_id, tag_id)'));
    expect(sql).toMatch(exact('create index media_tag_rejections_tag_idx on public.media_tag_rejections (tag_id)'));
  });

  it('RLS on both tables, owner-all in InitPlan form, authenticated only', () => {
    for (const t of ['tag_rules', 'media_tag_rejections']) {
      expect(sql).toMatch(exact(`alter table public.${t} enable row level security`));
      expect(sql).toMatch(exact(`create policy ${t}_owner_all on public.${t} for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))`));
    }
  });

  it('the trigger skips only rule-written rows of a removed pair, as invoker with a pinned search_path', () => {
    const fn = sql.match(/create or replace function public\.media_tags_skip_rejected\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(fn).toMatch(exact('security invoker'));
    expect(fn).toMatch(exact("set search_path = ''"));
    expect(fn).toMatch(exact("if new.source = 'auto' and exists (select 1 from public.media_tag_rejections r where r.media_id = new.media_id and r.tag_id = new.tag_id) then return null;"));
    expect(sql).toMatch(exact('create trigger media_tags_skip_rejected before insert on public.media_tags for each row execute function public.media_tags_skip_rejected()'));
  });
});
```

(Task 3's `rules.ts` constants `RULE_KINDS`, `RULE_FORMATS`, `RULE_VALUE_MAX = 50` must stay equal to these literals; Task 3's tests pin the TS side.)

- [ ] **Step 2 — run, see it fail** (`ENOENT … 20261102000001_tag_rules.sql`): `npx vitest run tests/tag-rules-migration.test.ts`.
- [ ] **Step 3 — the migration.** Write `supabase/migrations/20261102000001_tag_rules.sql` (keep `create table public.<name> (` and the closing `);` on their own lines: `tests/data-export.test.ts` parses that shape):

```sql
-- Plan 17c: auto-tagging. Owner-authored rules ("hashtag is #x", "caption contains word", "format is Reels") add a tag
-- to posts by themselves; the owner only corrects. Matching runs in TypeScript (lib/tag-rules/rules.ts: Unicode/CJK-safe),
-- not here. Three hard rules, two of them enforced by the database itself:
--  1. a tag on a post is never overwritten: rules only INSERT ... ON CONFLICT DO NOTHING into media_tags;
--  2. a tag the owner removed from a post is never added back by a rule: media_tag_rejections + the trigger below;
--  3. rules never delete anything (deleting a rule keeps the tags it added).
-- Owner-authored like tags (owner-all RLS); the sync writes media_tags with the service role (bypasses RLS).

create table public.tag_rules (
  id         uuid primary key default gen_random_uuid(),
  tag_id     uuid not null references public.tags (id) on delete cascade,
  kind       text not null check (kind in ('hashtag', 'word', 'format')),
  value      text not null check (char_length(value) between 1 and 50 and value = btrim(value)),
  created_at timestamptz not null default now(),
  check (kind <> 'format' or value in ('IMAGE', 'CAROUSEL_ALBUM', 'REELS'))
);
-- one rule per (tag, kind, value) ignoring case; it also serves the tag delete cascade (tag_id leads)
create unique index tag_rules_tag_kind_value_key on public.tag_rules (tag_id, kind, lower(value));
alter table public.tag_rules enable row level security;
create policy tag_rules_owner_all on public.tag_rules
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- who put the tag on the post: the owner (default, every row that exists today) or a rule
alter table public.media_tags add column source text not null default 'manual' check (source in ('manual', 'auto'));

-- (post, tag) pairs the owner removed by hand: a rule never adds them again
create table public.media_tag_rejections (
  media_id   text not null references public.media (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, tag_id)
);
-- the primary key serves lookups by post; this one the tag delete cascade
create index media_tag_rejections_tag_idx on public.media_tag_rejections (tag_id);
alter table public.media_tag_rejections enable row level security;
create policy media_tag_rejections_owner_all on public.media_tag_rejections
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));

-- Belt and braces for rule 2: even a rule run that read the rejections a moment before the owner removed the tag cannot
-- add it back. Only rows written by a rule (source 'auto') are skipped; the owner can always tag a post by hand again.
create or replace function public.media_tags_skip_rejected()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source = 'auto' and exists (select 1 from public.media_tag_rejections r where r.media_id = new.media_id and r.tag_id = new.tag_id) then
    return null;
  end if;
  return new;
end;
$$;
create trigger media_tags_skip_rejected
  before insert on public.media_tags
  for each row execute function public.media_tags_skip_rejected();
```

- [ ] **Step 4 — verify.** `npx vitest run tests/tag-rules-migration.test.ts tests/migrations.test.ts tests/data-privacy-migration.test.ts` → PASS. Do NOT run any `supabase` / `db push` command.
- [ ] **Step 5 — commit.** `git add supabase/migrations/20261102000001_tag_rules.sql tests/tag-rules-migration.test.ts` → `git commit -m "feat(db): tag rules, media_tags.source and removal memory with a guard trigger (Plan 17c, not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 3: pure rules + the apply library (TDD)

**Files:** Create `lib/tag-rules/rules.ts`, `lib/tag-rules/apply.ts`, `tests/tag-rules.test.ts`, `tests/tag-rules-apply.test.ts`.

- [ ] **Step 1 — failing tests (pure).** Write `tests/tag-rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashtagsOf, normalizeRuleValue, planAutoTags, RULE_FORMATS, RULE_KINDS, RULE_VALUE_MAX, ruleMatches, type RuleMedia, type TagRule } from '@/lib/tag-rules/rules';

const rule = (o: Partial<TagRule> & Pick<TagRule, 'kind' | 'value'>): TagRule => ({ id: `r-${o.kind}-${o.value}`, tagId: 't1', createdAt: '2026-10-01T00:00:00.000Z', ...o });
const post = (id: string, caption: string | null, o: Partial<RuleMedia> = {}): RuleMedia => ({ id, caption, kind: 'IMAGE', postedAt: '2026-10-10T00:00:00.000Z', ...o });

it('constants match the migration checks (20261102000001)', () => {
  expect(RULE_KINDS).toEqual(['hashtag', 'word', 'format']);
  expect([...RULE_FORMATS].sort()).toEqual(['CAROUSEL_ALBUM', 'IMAGE', 'REELS']);
  expect(RULE_VALUE_MAX).toBe(50);
});

describe('normalizeRuleValue', () => {
  it('hashtag: folded, without # (full-width too), letters / digits / _ only, at most 50', () => {
    expect(normalizeRuleValue('hashtag', '#Food ')).toEqual({ ok: true, value: 'food' });
    expect(normalizeRuleValue('hashtag', 'ＦＯＯＤ')).toEqual({ ok: true, value: 'food' });
    expect(normalizeRuleValue('hashtag', '＃美食')).toEqual({ ok: true, value: '美食' });
    expect(normalizeRuleValue('hashtag', 'travel_2026')).toEqual({ ok: true, value: 'travel_2026' });
    for (const bad of ['#', '', '##food', 'two words', 'food!', 'x'.repeat(51), 42]) expect(normalizeRuleValue('hashtag', bad), String(bad)).toEqual({ ok: false, error: 'invalid_hashtag' });
    expect(normalizeRuleValue('hashtag', 'x'.repeat(50))).toEqual({ ok: true, value: 'x'.repeat(50) });
  });

  it('word: folded; Latin words need 3 characters, Chinese / Japanese / Korean one; phrases allowed', () => {
    expect(normalizeRuleValue('word', '  Big SALE ')).toEqual({ ok: true, value: 'big sale' });
    expect(normalizeRuleValue('word', '优惠')).toEqual({ ok: true, value: '优惠' });
    expect(normalizeRuleValue('word', '猫')).toEqual({ ok: true, value: '猫' });
    expect(normalizeRuleValue('word', 'ab')).toEqual({ ok: false, error: 'rule_too_short' });
    for (const bad of ['', '   ', '!!!', 'x'.repeat(51), null]) expect(normalizeRuleValue('word', bad), String(bad)).toEqual({ ok: false, error: 'invalid_word' });
  });

  it('format: exactly one of the feed formats (never Stories, never lower case)', () => {
    for (const f of ['REELS', 'CAROUSEL_ALBUM', 'IMAGE']) expect(normalizeRuleValue('format', f)).toEqual({ ok: true, value: f });
    for (const bad of ['STORY', 'reels', '', 1]) expect(normalizeRuleValue('format', bad)).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('hashtagsOf', () => {
  it('folded hashtags of a caption, full-width # included; none for no caption', () => {
    expect(hashtagsOf('Dinner #Food #美食 ＃ＣＡＴ #food')).toEqual(['food', '美食', 'cat']);
    expect(hashtagsOf(null)).toEqual([]);
    expect(hashtagsOf('mail me a@b.com')).toEqual([]);
  });
});

describe('ruleMatches', () => {
  it('hashtag: the whole hashtag, any case; never part of a longer one', () => {
    const r = rule({ kind: 'hashtag', value: 'food' });
    expect(ruleMatches(r, post('p', 'Lunch #FOOD'))).toBe(true);
    expect(ruleMatches(r, post('p', 'Lunch #foodie'))).toBe(false);
    expect(ruleMatches(r, post('p', 'food without the sign'))).toBe(false);
    expect(ruleMatches(rule({ kind: 'hashtag', value: '美食' }), post('p', '今天的#美食 分享'))).toBe(true);
  });

  it('word: whole Latin words (also inside a hashtag), Chinese anywhere, width and case folded', () => {
    const r = rule({ kind: 'word', value: 'sale' });
    expect(ruleMatches(r, post('p', 'Big SALE today'))).toBe(true);
    expect(ruleMatches(r, post('p', 'ＳＡＬＥ'))).toBe(true);
    expect(ruleMatches(r, post('p', '#sale'))).toBe(true);
    expect(ruleMatches(r, post('p', 'wholesale prices'))).toBe(false);
    expect(ruleMatches(rule({ kind: 'word', value: '优惠' }), post('p', '今天优惠活动'))).toBe(true);
    expect(ruleMatches(rule({ kind: 'word', value: 'link in bio' }), post('p', 'Shop: Link in bio!'))).toBe(true);
    expect(ruleMatches(r, post('p', null))).toBe(false);
  });

  it('format: the media type; Stories never match any rule', () => {
    const reels = rule({ kind: 'format', value: 'REELS' });
    expect(ruleMatches(reels, post('p', null, { kind: 'REELS' }))).toBe(true);
    expect(ruleMatches(reels, post('p', null, { kind: 'IMAGE' }))).toBe(false);
    expect(ruleMatches(rule({ kind: 'hashtag', value: 'food' }), post('s', '#food', { kind: 'STORY' }))).toBe(false);
  });
});

describe('planAutoTags', () => {
  const food = rule({ id: 'r1', tagId: 't-food', kind: 'hashtag', value: 'food' });
  const reels = rule({ id: 'r2', tagId: 't-reels', kind: 'format', value: 'REELS', createdAt: '2026-10-02T00:00:00.000Z' });
  const media = [post('p1', '#food'), post('p2', 'nothing', { kind: 'REELS' }), post('p3', '#food', { kind: 'REELS' })];
  const base = { media, rules: [food, reels], existing: new Map(), rejected: new Set<string>(), scope: 'all' as const };

  it('adds every matching (post, tag) pair once', () => {
    expect(planAutoTags(base)).toEqual([
      { mediaId: 'p1', tagId: 't-food' },
      { mediaId: 'p2', tagId: 't-reels' },
      { mediaId: 'p3', tagId: 't-food' },
      { mediaId: 'p3', tagId: 't-reels' },
    ]);
    const twice = rule({ id: 'r3', tagId: 't-food', kind: 'word', value: 'food' });
    expect(planAutoTags({ ...base, media: [post('p1', '#food')], rules: [food, twice] })).toEqual([{ mediaId: 'p1', tagId: 't-food' }]);
  });

  it('never touches a tag the post already has (manual or auto) and never re-adds a removed one', () => {
    const out = planAutoTags({ ...base, existing: new Map([['p1', new Set(['t-food'])]]), rejected: new Set(['p3:t-reels']) });
    expect(out).toEqual([
      { mediaId: 'p2', tagId: 't-reels' },
      { mediaId: 'p3', tagId: 't-food' },
    ]);
  });

  it('is idempotent: with its own result applied, a second run adds nothing', () => {
    const first = planAutoTags(base);
    const existing = new Map<string, Set<string>>();
    for (const a of first) existing.set(a.mediaId, (existing.get(a.mediaId) ?? new Set()).add(a.tagId));
    expect(planAutoTags({ ...base, existing })).toEqual([]);
  });

  it('stops at 10 tags per post, oldest rule first', () => {
    const rules = Array.from({ length: 12 }, (_, i) => rule({ id: `r${i}`, tagId: `t${i}`, kind: 'word', value: 'food', createdAt: `2026-10-${String(12 - i).padStart(2, '0')}T00:00:00.000Z` }));
    const out = planAutoTags({ ...base, media: [post('p1', 'food')], rules, existing: new Map([['p1', new Set(['manual'])]]) });
    expect(out).toHaveLength(9);
    expect(out[0].tagId).toBe('t11'); // created 2026-10-01: the oldest rule
    expect(out.map((a) => a.tagId)).not.toContain('t0'); // the newest rules lose
  });

  it("scope 'new' (the sync) only tags posts published at or after the rule was created", () => {
    const late = rule({ id: 'r9', tagId: 't-late', kind: 'hashtag', value: 'food', createdAt: '2026-10-10T00:00:00.000Z' });
    const m = [post('old', '#food', { postedAt: '2026-10-09T23:59:59.000Z' }), post('same', '#food', { postedAt: '2026-10-10T00:00:00.000Z' })];
    expect(planAutoTags({ ...base, media: m, rules: [late], scope: 'new' })).toEqual([{ mediaId: 'same', tagId: 't-late' }]);
    expect(planAutoTags({ ...base, media: m, rules: [late], scope: 'all' })).toHaveLength(2);
  });

  it('no rules or no posts: nothing', () => {
    expect(planAutoTags({ ...base, rules: [] })).toEqual([]);
    expect(planAutoTags({ ...base, media: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2 — failing tests (apply).** Write `tests/tag-rules-apply.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyTagRules, loadRuleMedia, loadRules } from '@/lib/tag-rules/apply';
import type { RuleMedia, TagRule } from '@/lib/tag-rules/rules';

type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][] };

/** Records every query-builder call; each awaited query resolves to the next queued result (default: ok, no data). */
function recorder(results: { data?: unknown; error?: unknown }[] = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = (...a: unknown[]) => ((call.op = op), call.args.push(...a), chain);
      chain.select = (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain);
      for (const f of ['eq', 'neq', 'in', 'order', 'range', 'limit']) chain[f] = (...a: unknown[]) => (call.filters.push([f, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const R: TagRule = { id: 'r1', tagId: 't1', kind: 'hashtag', value: 'food', createdAt: '2026-10-01T00:00:00.000Z' };
const post = (id: string, caption: string | null, kind = 'IMAGE'): RuleMedia => ({ id, caption, kind, postedAt: '2026-10-10T00:00:00.000Z' });

describe('loadRules', () => {
  it('maps the rows oldest first, capped, and drops unknown kinds', async () => {
    const r = recorder([{ data: [{ id: 'r1', tag_id: 't1', kind: 'hashtag', value: 'food', created_at: '2026-10-01T00:00:00+00:00' }, { id: 'r2', tag_id: 't1', kind: 'regex', value: '.*', created_at: 'x' }] }]);
    expect(await loadRules(r.db)).toEqual([{ id: 'r1', tagId: 't1', kind: 'hashtag', value: 'food', createdAt: '2026-10-01T00:00:00+00:00' }]);
    expect(r.calls[0]).toMatchObject({ table: 'tag_rules', filters: [['order', 'created_at', { ascending: true }], ['limit', 200]] });
  });

  it('null without the migration; any other error throws a fixed message', async () => {
    expect(await loadRules(recorder([{ error: { code: 'PGRST205' } }]).db)).toBeNull();
    expect(await loadRules(recorder([{ error: { code: '42P01' } }]).db)).toBeNull();
    await expect(loadRules(recorder([{ error: { code: '500', message: 'secret value' } }]).db)).rejects.toThrow(/^tag rules: read failed$/);
  });
});

describe('loadRuleMedia', () => {
  it('reads feed posts and Reels of every account (never Stories) in ordered 1,000-row pages', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}`, caption: i ? null : '#food', media_type: 'IMAGE', posted_at: 'T' }));
    const r = recorder([{ data: page }, { data: [{ id: 'z', caption: 7, media_type: 'REELS', posted_at: 'T' }] }]);
    const m = await loadRuleMedia(r.db);
    expect(m).toHaveLength(1001);
    expect(m[0]).toEqual({ id: 'm0', caption: '#food', kind: 'IMAGE', postedAt: 'T' });
    expect(m[1000]).toEqual({ id: 'z', caption: null, kind: 'REELS', postedAt: 'T' });
    expect(r.calls[0].filters).toEqual([['neq', 'media_type', 'STORY'], ['order', 'id', { ascending: true }], ['range', 0, 999]]);
    expect(r.calls[1].filters).toContainEqual(['range', 1000, 1999]);
    await expect(loadRuleMedia(recorder([{ error: { message: 'secret' } }]).db)).rejects.toThrow(/^tag rules: media read failed$/);
  });
});

describe('applyTagRules', () => {
  it('no post matches: no database call at all', async () => {
    const r = recorder();
    expect(await applyTagRules(r.db, { media: [post('p1', 'nothing')], rules: [R], scope: 'all', dryRun: false })).toEqual({ posts: 0, tags: 0 });
    expect(r.calls).toEqual([]);
  });

  it('reads tags and removals only for the matching posts, by id, then inserts the rest as auto (never overwriting)', async () => {
    const r = recorder([{ data: [{ media_id: 'p2', tag_id: 't1' }] }, { data: [{ media_id: 'p3', tag_id: 't1' }] }, { error: null }]);
    const media = [post('p1', '#food'), post('p2', '#food'), post('p3', '#food'), post('p4', 'no')];
    expect(await applyTagRules(r.db, { media, rules: [R], scope: 'all', dryRun: false })).toEqual({ posts: 1, tags: 1 });
    expect(r.calls.map((c) => [c.table, c.op])).toEqual([['media_tags', 'select'], ['media_tag_rejections', 'select'], ['media_tags', 'upsert']]);
    expect(r.calls[0].filters).toEqual([['in', 'media_id', ['p1', 'p2', 'p3']]]);
    expect(r.calls[2].args).toEqual([[{ media_id: 'p1', tag_id: 't1', source: 'auto' }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true }]);
  });

  it('dry run (the preview) counts without writing', async () => {
    const r = recorder();
    expect(await applyTagRules(r.db, { media: [post('p1', '#food'), post('p2', '#FOOD')], rules: [R], scope: 'all', dryRun: true })).toEqual({ posts: 2, tags: 2 });
    expect(r.calls.some((c) => c.op === 'upsert')).toBe(false);
  });

  it('reads in chunks of 100 posts (PostgREST answers at most 1,000 rows)', async () => {
    const r = recorder();
    const media = Array.from({ length: 150 }, (_, i) => post(`p${i}`, '#food'));
    await applyTagRules(r.db, { media, rules: [R], scope: 'all', dryRun: true });
    const reads = r.calls.filter((c) => c.op === 'select');
    expect(reads.map((c) => [c.table, (c.filters[0][2] as string[]).length])).toEqual([['media_tags', 100], ['media_tag_rejections', 100], ['media_tags', 50], ['media_tag_rejections', 50]]);
  });

  it('a read or write error throws a fixed message (never the Supabase text)', async () => {
    await expect(applyTagRules(recorder([{ error: { message: 'secret' } }]).db, { media: [post('p1', '#food')], rules: [R], scope: 'all', dryRun: false })).rejects.toThrow(/^tag rules: media_tags read failed$/);
    await expect(applyTagRules(recorder([{ data: [] }, { data: [] }, { error: { message: 'secret' } }]).db, { media: [post('p1', '#food')], rules: [R], scope: 'all', dryRun: false })).rejects.toThrow(/^tag rules: media_tags write failed$/);
  });
});
```

- [ ] **Step 3 — run, see both fail** (cannot resolve `@/lib/tag-rules/rules` / `apply`): `npx vitest run tests/tag-rules.test.ts tests/tag-rules-apply.test.ts`.
- [ ] **Step 4 — `lib/tag-rules/rules.ts`** (Write tool: it contains regexes and non-ASCII):

```ts
// Auto-tagging rules (Plan 17c). Pure: no I/O, no clock. The sync (new posts), the Tags page (preview + "Apply to
// existing posts") and the tests use the same functions, so the preview counts exactly what an apply would add.
// Hashtags come from captionFeatures (one source of truth with the caption lab); words and folding come from the
// moderation rules (NFKC + lower case; Latin whole words, Chinese / Japanese / Korean anywhere).
import { captionFeatures } from '@/lib/analysis/caption';
import { fold, matchRule, validateWord } from '@/lib/moderation/rules';
import { MAX_TAGS_PER_POST } from '@/lib/tags';

export const RULE_KINDS = ['hashtag', 'word', 'format'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
/** Formats a rule can name (Stories are never auto-tagged: they have no caption and leave after 24 hours). */
export const RULE_FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE'] as const;
export const RULE_VALUE_MAX = 50; // = the migration's check
export const MAX_RULES = 200; // all tags together; one read, far below PostgREST's 1,000 rows

export interface TagRule {
  id: string;
  tagId: string;
  kind: RuleKind;
  value: string; // folded (hashtag without '#'); a format is one of RULE_FORMATS
  createdAt: string; // ISO
}

/** What a rule looks at. kind = media.media_type. */
export interface RuleMedia {
  id: string;
  caption: string | null;
  kind: string;
  postedAt: string; // ISO
}

export type RuleError = 'invalid_hashtag' | 'invalid_word' | 'rule_too_short' | 'invalid_format';

const HASHTAG_BODY = /^[\p{L}\p{N}_]+$/u; // the characters captionFeatures accepts after '#'

/** The value as stored: hashtag folded without its '#' (full-width ＃ too), word folded, format as is. */
export function normalizeRuleValue(kind: RuleKind, raw: unknown): { ok: true; value: string } | { ok: false; error: RuleError } {
  if (kind === 'format') return typeof raw === 'string' && (RULE_FORMATS as readonly string[]).includes(raw) ? { ok: true, value: raw } : { ok: false, error: 'invalid_format' };
  if (typeof raw !== 'string') return { ok: false, error: kind === 'hashtag' ? 'invalid_hashtag' : 'invalid_word' };
  if (kind === 'hashtag') {
    const value = fold(raw).replace(/^#/, '');
    return HASHTAG_BODY.test(value) && [...value].length <= RULE_VALUE_MAX ? { ok: true, value } : { ok: false, error: 'invalid_hashtag' };
  }
  const w = validateWord(raw, []); // letters or digits, at most 50, 3+ characters unless Chinese, Japanese or Korean
  if (!w.ok) return { ok: false, error: w.error === 'rule_too_short' ? 'rule_too_short' : 'invalid_word' };
  return { ok: true, value: fold(w.pattern) };
}

/** Hashtags of a caption, folded (NFKC first, so a full-width ＃ counts too). */
export const hashtagsOf = (caption: string | null): string[] => (caption ? captionFeatures(caption.normalize('NFKC')).hashtags : []);

export function ruleMatches(rule: TagRule, m: RuleMedia): boolean {
  if (m.kind === 'STORY') return false;
  switch (rule.kind) {
    case 'format':
      return m.kind === rule.value;
    case 'hashtag':
      return hashtagsOf(m.caption).includes(rule.value);
    case 'word':
      // the moderation word matcher: whole Latin words ("sale" not in "wholesale"), CJK anywhere, case and width folded
      return matchRule(m.caption, [{ id: rule.id, kind: 'word', pattern: rule.value, wholeWord: true }]) !== null;
  }
}

export interface PlanInput {
  media: readonly RuleMedia[];
  rules: readonly TagRule[];
  /** Tags each post already has (any source). Missing = none. */
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  /** `${mediaId}:${tagId}` pairs the owner removed by hand: never added back. */
  rejected: ReadonlySet<string>;
  /** 'new': a rule only tags posts published at or after the rule was created (the sync); 'all': every post (the owner's apply). */
  scope: 'new' | 'all';
}

export const pairKey = (mediaId: string, tagId: string) => `${mediaId}:${tagId}`;

/**
 * The (post, tag) pairs to ADD. Never a tag the post has (so a manual tag is never touched), never a rejected pair, never
 * more than MAX_TAGS_PER_POST tags on a post (oldest rule first), each pair once. Running it again on the result adds nothing.
 */
export function planAutoTags(p: PlanInput): { mediaId: string; tagId: string }[] {
  const rules = [...p.rules].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const out: { mediaId: string; tagId: string }[] = [];
  for (const m of p.media) {
    const has = new Set(p.existing.get(m.id) ?? []);
    for (const r of rules) {
      if (has.size >= MAX_TAGS_PER_POST) break;
      if (has.has(r.tagId) || p.rejected.has(pairKey(m.id, r.tagId))) continue;
      if (p.scope === 'new' && Date.parse(m.postedAt) < Date.parse(r.createdAt)) continue;
      if (!ruleMatches(r, m)) continue;
      has.add(r.tagId);
      out.push({ mediaId: m.id, tagId: r.tagId });
    }
  }
  return out;
}
```

- [ ] **Step 5 — `lib/tag-rules/apply.ts`:**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_RULES, pairKey, planAutoTags, RULE_KINDS, type RuleKind, type RuleMedia, type TagRule } from '@/lib/tag-rules/rules';

// Auto-tagging reads and the one write (Plan 17c). Takes whichever client the caller has: the OWNER session on the Tags
// page (RLS), the ADMIN client in the sync (lib/sync/store.ts autoTag). Writes only INSERT ... ON CONFLICT DO NOTHING
// into media_tags with source 'auto': a tag already on a post is never touched, nothing is ever deleted, and the
// database trigger media_tags_skip_rejected refuses a pair the owner removed even if this read missed it.
// Never logs; errors are fixed messages (never the Supabase text, which can echo values).

type Row = Record<string, unknown>;
/** Ids per `in` filter: 100 posts x at most 10 tags stays at PostgREST's 1,000-row cap (lesson from Plan 15d). */
const CHUNK = 100;
const PAGE = 1000; // PostgREST's row cap: a shorter page is the last one
const RULE_MEDIA_MAX = 20_000; // ponytail: "Apply to existing posts" reads at most 20,000 posts; past that, page per account
const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01']; // = lib/followers/read.ts MISSING_TABLE (not imported: that module is the follower-data choke point)

const chunks = <T>(a: readonly T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** True when the error means "the 17c tables are not there yet" (PostgREST / Postgres "table not found"). */
export const isMissingTable = (e: unknown): boolean => MISSING_TABLE.includes(String((e as { code?: unknown } | null)?.code));

/** Every rule, oldest first. null = the migration 20261102000001 is not applied yet: auto-tagging is off. */
export async function loadRules(db: SupabaseClient): Promise<TagRule[] | null> {
  const { data, error } = await db.from('tag_rules').select('id,tag_id,kind,value,created_at').order('created_at', { ascending: true }).limit(MAX_RULES);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error('tag rules: read failed');
  }
  return ((data ?? []) as Row[])
    .filter((r) => (RULE_KINDS as readonly string[]).includes(String(r.kind)))
    .map((r) => ({ id: String(r.id), tagId: String(r.tag_id), kind: r.kind as RuleKind, value: String(r.value), createdAt: String(r.created_at) }));
}

/** Every feed post and Reel of every account (Stories never), in ordered 1,000-row pages (owner's Apply to existing posts). */
export async function loadRuleMedia(db: SupabaseClient): Promise<RuleMedia[]> {
  const out: RuleMedia[] = [];
  for (let from = 0; from < RULE_MEDIA_MAX; from += PAGE) {
    const { data, error } = await db.from('media').select('id,caption,media_type,posted_at').neq('media_type', 'STORY').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error('tag rules: media read failed');
    const rows = (data ?? []) as Row[];
    for (const r of rows) out.push({ id: String(r.id), caption: typeof r.caption === 'string' ? r.caption : null, kind: String(r.media_type), postedAt: String(r.posted_at) });
    if (rows.length < PAGE) break;
  }
  return out;
}

async function pairsOf(db: SupabaseClient, table: 'media_tags' | 'media_tag_rejections', ids: string[]): Promise<Row[]> {
  const { data, error } = await db.from(table).select('media_id,tag_id').in('media_id', ids);
  if (error) throw new Error(`tag rules: ${table} read failed`);
  return (data ?? []) as Row[];
}

export interface ApplyResult {
  posts: number; // posts that get at least one tag
  tags: number; // (post, tag) pairs added
}

/**
 * Adds the tags the rules call for. dryRun: counts only (the preview). Reads tags and rejections only for the posts a
 * rule matches, by id. Idempotent: a second run adds nothing.
 */
export async function applyTagRules(db: SupabaseClient, o: { media: readonly RuleMedia[]; rules: readonly TagRule[]; scope: 'new' | 'all'; dryRun: boolean }): Promise<ApplyResult> {
  const candidates = planAutoTags({ media: o.media, rules: o.rules, existing: new Map(), rejected: new Set(), scope: o.scope });
  const ids = [...new Set(candidates.map((c) => c.mediaId))];
  if (ids.length === 0) return { posts: 0, tags: 0 };
  const existing = new Map<string, Set<string>>();
  const rejected = new Set<string>();
  for (const part of chunks(ids)) {
    for (const r of await pairsOf(db, 'media_tags', part)) {
      const id = String(r.media_id);
      existing.set(id, (existing.get(id) ?? new Set()).add(String(r.tag_id)));
    }
    for (const r of await pairsOf(db, 'media_tag_rejections', part)) rejected.add(pairKey(String(r.media_id), String(r.tag_id)));
  }
  const byId = new Set(ids);
  const add = planAutoTags({ media: o.media.filter((m) => byId.has(m.id)), rules: o.rules, existing, rejected, scope: o.scope });
  if (!o.dryRun) {
    for (const part of chunks(add, 500)) {
      const { error } = await db.from('media_tags').upsert(part.map((a) => ({ media_id: a.mediaId, tag_id: a.tagId, source: 'auto' })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
      if (error) throw new Error('tag rules: media_tags write failed');
    }
  }
  return { posts: new Set(add.map((a) => a.mediaId)).size, tags: add.length };
}
```

- [ ] **Step 6 — verify.** `npx vitest run tests/tag-rules.test.ts tests/tag-rules-apply.test.ts tests/moderation-privacy.test.ts tests/analysis-caption.test.ts` → PASS; `npx tsc --noEmit`; `npx eslint lib/tag-rules tests/tag-rules.test.ts tests/tag-rules-apply.test.ts`.
- [ ] **Step 7 — commit.** `git add lib/tag-rules tests/tag-rules.test.ts tests/tag-rules-apply.test.ts` → `git commit -m "feat(tags): pure tag-rule matching and an insert-only apply (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 4: the sync hook

**Files:** Modify `lib/sync/store.ts`, `lib/sync/run-account.ts`, `tests/fixtures/sync-fakes.ts`, `tests/sync-run-account.test.ts`; append to `tests/tag-rules-apply.test.ts` (created by Task 3).

- [ ] **Step 1 — failing tests.**
  (a) `tests/sync-run-account.test.ts`: replace the exact line

```ts
  it('backfill: every listed post gets its lifetime metrics on the first pass', async () => {
```

with

```ts
  it("the listed posts go through the owner's tag rules (Plan 17c); a rule failure never costs the list", async () => {
    const { c, ig, mem } = ctx();
    ig.listMedia.mockResolvedValue([post('p1', '2026-10-13T00:00:00.000Z'), post('p2', '2026-10-12T00:00:00.000Z')]);
    await run(c, ['mediaList']);
    expect(mem.autoTagged).toEqual([['p1', 'p2']]);
    const failing = ctx();
    failing.ig.listMedia.mockResolvedValue([post('p1', '2026-10-13T00:00:00.000Z')]);
    failing.mem.store.autoTag = async () => {
      throw new Error('tag rules: read failed');
    };
    const { result, patch } = await run(failing.c, ['mediaList']);
    expect(result.outcome).toBe('ok');
    expect(failing.mem.media.has('p1')).toBe(true);
    expect(patch.lastRun.mediaList).toBe(NOW.toISOString());
  });

  it('backfill: every listed post gets its lifetime metrics on the first pass', async () => {
```

  (b) `tests/tag-rules-apply.test.ts`: replace the exact line

```ts
import type { RuleMedia, TagRule } from '@/lib/tag-rules/rules';
```

with

```ts
import type { RuleMedia, TagRule } from '@/lib/tag-rules/rules';
import { supabaseSyncStore } from '@/lib/sync/store';
```

  and append at the END of the file:

```ts

describe('supabaseSyncStore.autoTag (the sync, admin client)', () => {
  const item = (id: string, kind: 'IMAGE' | 'REELS' | 'STORY', caption: string | null) => ({ id, kind, caption, permalink: null, postedAt: '2026-10-10T00:00:00.000Z' });

  it('Stories only, no rules, or no migration: stops early', async () => {
    const none = recorder();
    await supabaseSyncStore(none.db).autoTag([item('s1', 'STORY', '#food')]);
    expect(none.calls).toEqual([]);
    const noRules = recorder([{ data: [] }]);
    await supabaseSyncStore(noRules.db).autoTag([item('p1', 'IMAGE', '#food')]);
    expect(noRules.calls.map((c) => c.table)).toEqual(['tag_rules']);
    const missing = recorder([{ error: { code: 'PGRST205' } }]);
    await supabaseSyncStore(missing.db).autoTag([item('p1', 'IMAGE', '#food')]);
    expect(missing.calls.map((c) => c.table)).toEqual(['tag_rules']);
  });

  it('tags the listed posts published after the rule was written', async () => {
    const r = recorder([{ data: [{ id: 'r1', tag_id: 't1', kind: 'hashtag', value: 'food', created_at: '2026-10-05T00:00:00.000Z' }] }, { data: [] }, { data: [] }, { error: null }]);
    await supabaseSyncStore(r.db).autoTag([item('p1', 'IMAGE', '#Food'), { ...item('old', 'IMAGE', '#food'), postedAt: '2026-10-01T00:00:00.000Z' }, item('s1', 'STORY', '#food')]);
    expect(r.calls.at(-1)).toMatchObject({ table: 'media_tags', op: 'upsert', args: [[{ media_id: 'p1', tag_id: 't1', source: 'auto' }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true }] });
  });
});
```

- [ ] **Step 2 — run, see them fail** (`autoTag` is not a function / `mem.autoTagged` undefined; `tsc` would also flag it): `npx vitest run tests/sync-run-account.test.ts tests/tag-rules-apply.test.ts`.
- [ ] **Step 3 — `lib/sync/store.ts`.** Three edits:
  1. Replace `import { emptyState, isBackfilling, type JobKind, type MediaRef, type SyncState } from '@/lib/sync/schedule';` with the same line followed by `import { applyTagRules, loadRules } from '@/lib/tag-rules/apply';`.
  2. Replace `  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;` (line 63, inside `interface SyncStore`) with

```ts
  upsertMedia(accountId: string, items: IgMediaItem[]): Promise<void>;
  /** Plan 17c: the owner's tag rules on these listed posts (Stories never), only for posts published after the rule was written. Adds tags, never removes or overwrites one. */
  autoTag(items: IgMediaItem[]): Promise<void>;
```

  3. Replace

```ts
      if (children.length > 0) check('upsertMediaChildren')(await db.from('media_children').upsert(children, { onConflict: 'media_id,position' }));
    },
```

  with

```ts
      if (children.length > 0) check('upsertMediaChildren')(await db.from('media_children').upsert(children, { onConflict: 'media_id,position' }));
    },
    async autoTag(items) {
      const media = items.filter((i) => i.kind !== 'STORY').map((i) => ({ id: i.id, caption: i.caption, kind: i.kind, postedAt: i.postedAt }));
      if (media.length === 0) return;
      const rules = await loadRules(db); // null: the 17c migration is not applied yet
      if (!rules || rules.length === 0) return;
      await applyTagRules(db, { media, rules, scope: 'new', dryRun: false });
    },
```

  (Note: `lib/tag-rules/apply.ts` imports nothing from `lib/sync` or `lib/dashboard`, so there is no import cycle.)
- [ ] **Step 4 — `lib/sync/run-account.ts`.** Replace (in `mediaList`, line 232)

```ts
  await c.store.upsertMedia(c.account.id, items);
  return { done: !outOfTime(c) };
```

with

```ts
  await c.store.upsertMedia(c.account.id, items);
  await c.store.autoTag(items).catch(() => {}); // Plan 17c: best-effort, a rule problem never costs the media list
  return { done: !outOfTime(c) };
```

  (The line after `return { done: !outOfTime(c) };` keeps its trailing comment; match only the text shown.) Do NOT add a clock read.
- [ ] **Step 5 — `tests/fixtures/sync-fakes.ts`.** Three edits:
  1. Replace `  const progress: { accountId: string; p: ProgressWrite }[] = [];` with that line followed by
     `  /** ids passed to autoTag, one entry per call (Plan 17c) */` and `  const autoTagged: string[][] = [];`.
  2. Replace `    mediaForMetrics: async (accountId, since) =>` with `    autoTag: async (items) => void autoTagged.push(items.map((i) => i.id)),` followed by `    mediaForMetrics: async (accountId, since) =>`.
  3. Replace `runs, saved, progress };` (end of the `return` of `memoryStore`) with `runs, saved, progress, autoTagged };`.
- [ ] **Step 6 — verify.** `npx vitest run tests/sync-run-account.test.ts tests/tag-rules-apply.test.ts tests/sync-store.test.ts tests/sync-tick.test.ts tests/sync-comments.test.ts tests/sync-covers-capture.test.ts tests/moderation-privacy.test.ts` (plus any other file `grep -rl "sync-fakes\|lib/sync/store" tests` lists) → PASS; `npx tsc --noEmit`; `npx eslint lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-run-account.test.ts tests/tag-rules-apply.test.ts`.
- [ ] **Step 7 — commit.** `git add lib/sync/store.ts lib/sync/run-account.ts tests/fixtures/sync-fakes.ts tests/sync-run-account.test.ts tests/tag-rules-apply.test.ts` → `git commit -m "feat(sync): apply the owner's tag rules to newly listed posts, best-effort (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 5: rule actions, removal memory, export registry

**Files:** Modify `app/(app)/tags/actions.ts`, `tests/tag-actions.test.ts`, `lib/data/export.ts`, `tests/settings-data.test.tsx`; create `tests/tag-rule-actions.test.ts`.

- [ ] **Step 1 — failing tests.**
  (a) `tests/tag-actions.test.ts`: replace `for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'not', 'limit'])` with `for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'not', 'in', 'limit'])`. Then replace the first two tests of `describe('setPostTagsAction', …)` — from the line `describe('setPostTagsAction', () => {` through the end of the test `'an empty list clears the post (no upsert, plain delete)'` (its closing `  });`) — with:

```ts
describe('setPostTagsAction', () => {
  const T3 = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
  const M = '17895695668004550';

  it('upserts the deduplicated set; nothing else on the post: nothing removed, nothing remembered', async () => {
    queue.push({ error: null }, { data: [{ tag_id: T1 }, { tag_id: T2 }] });
    expect(await setPostTagsAction(M, [T1, T1.toUpperCase(), T2])).toEqual({ ok: true });
    expect(has('upsert', [{ media_id: M, tag_id: T1 }, { media_id: M, tag_id: T2 }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true })).toBe(true);
    expect(calls.some((c) => c[0] === 'delete')).toBe(false);
    expect(calls.some((c) => c[0] === 'from' && c[1] === 'media_tag_rejections')).toBe(false);
    expect(has('revalidate', '/accounts/[id]', 'page')).toBe(true);
  });

  it('a removed tag is remembered BEFORE it is deleted, so a rule never adds it back (Plan 17c)', async () => {
    queue.push({ error: null }, { data: [{ tag_id: T1 }, { tag_id: T3 }] }, { error: null }, { error: null });
    expect(await setPostTagsAction(M, [T1])).toEqual({ ok: true });
    const memo = calls.findIndex((c) => c[0] === 'from' && c[1] === 'media_tag_rejections');
    const del = calls.findIndex((c) => c[0] === 'delete');
    expect(memo).toBeGreaterThan(-1);
    expect(memo).toBeLessThan(del);
    expect(has('upsert', [{ media_id: M, tag_id: T3 }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true })).toBe(true);
    expect(has('in', 'tag_id', [T3])).toBe(true);
  });

  it('an empty list clears the post (no tag upsert) and remembers every removed tag', async () => {
    queue.push({ data: [{ tag_id: T2 }] }, { error: null }, { error: null });
    expect(await setPostTagsAction('1', [])).toEqual({ ok: true });
    expect(has('upsert', [{ media_id: '1', tag_id: T2 }], { onConflict: 'media_id,tag_id', ignoreDuplicates: true })).toBe(true);
    expect(calls.filter((c) => c[0] === 'upsert')).toHaveLength(1);
    expect(has('eq', 'media_id', '1')).toBe(true);
    expect(has('in', 'tag_id', [T2])).toBe(true);
  });

  it('without the 17c migration the removal still works; any other memo error stops before deleting', async () => {
    queue.push({ data: [{ tag_id: T2 }] }, { error: { code: 'PGRST205' } }, { error: null });
    expect(await setPostTagsAction('1', [])).toEqual({ ok: true });
    expect(has('delete')).toBe(true);
    calls.length = 0;
    queue.push({ data: [{ tag_id: T2 }] }, { error: { code: '500', message: 'secret' } });
    expect(await setPostTagsAction('1', [])).toEqual({ ok: false, error: 'unexpected' });
    expect(has('delete')).toBe(false);
  });
```

  (the third existing test, `'a missing post or tag (foreign key) returns not_found'`, and the closing `});` stay.)

  (b) Create `tests/tag-rule-actions.test.ts`:

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagRule } from '@/lib/tag-rules/rules';

type Op = unknown[];
const { calls, requireOwner, queue, apply } = vi.hoisted(() => ({
  calls: [] as Op[],
  requireOwner: vi.fn(),
  queue: [] as { data?: unknown; error?: unknown }[],
  apply: { rules: [] as TagRule[] | null, result: { posts: 0, tags: 0 } },
}));

/** Owner-session fake: records every call; each awaited query resolves to the next queued result. */
function fakeDb() {
  return {
    from(table: string) {
      calls.push(['from', table]);
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'insert', 'delete', 'eq']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res, rej);
      return chain;
    },
  };
}

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), fakeDb()) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(['revalidate', ...a]) }));
vi.mock('@/lib/tag-rules/apply', async (orig) => ({
  ...(await orig<typeof import('@/lib/tag-rules/apply')>()),
  loadRules: async () => (calls.push(['loadRules']), apply.rules),
  loadRuleMedia: async () => (calls.push(['loadRuleMedia']), [{ id: 'p1', caption: '#food', kind: 'IMAGE', postedAt: 'T' }]),
  applyTagRules: async (_db: unknown, o: { rules: TagRule[]; scope: string; dryRun: boolean }) => (calls.push(['apply', o.rules.map((r) => r.id), o.scope, o.dryRun]), apply.result),
}));

import { addTagRuleAction, applyTagRulesAction, deleteTagRuleAction, previewTagRulesAction } from '@/app/(app)/tags/actions';
import { MAX_RULES } from '@/lib/tag-rules/rules';

const T1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const T2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const rule = (id: string, tagId: string): TagRule => ({ id, tagId, kind: 'hashtag', value: 'food', createdAt: 'T' });
const has = (op: string, ...args: unknown[]) => calls.some((c) => c[0] === op && args.every((a, i) => JSON.stringify(c[i + 1]) === JSON.stringify(a)));

beforeEach(() => {
  calls.length = 0;
  queue.length = 0;
  apply.rules = [];
  apply.result = { posts: 0, tags: 0 };
  requireOwner.mockReset().mockImplementation(async () => void calls.push(['requireOwner']));
});

describe('tag rule actions: authorization and validation', () => {
  it.each([
    ['add', () => addTagRuleAction(T1, 'hashtag', 'food')],
    ['delete', () => deleteTagRuleAction(T1)],
    ['preview', () => previewTagRulesAction(T1)],
    ['apply', () => applyTagRulesAction(T1)],
  ])('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toEqual(['requireOwner']);
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
  });

  it('bad input returns a key without opening a database client; never the admin client', async () => {
    expect(await addTagRuleAction('nope', 'hashtag', 'food')).toEqual({ ok: false, error: 'not_found' });
    expect(await addTagRuleAction(T1, 'regex', '.*')).toEqual({ ok: false, error: 'not_found' });
    expect(await addTagRuleAction(T1, 'hashtag', 'two words')).toEqual({ ok: false, error: 'invalid_hashtag' });
    expect(await addTagRuleAction(T1, 'word', 'ab')).toEqual({ ok: false, error: 'rule_too_short' });
    expect(await addTagRuleAction(T1, 'format', 'STORY')).toEqual({ ok: false, error: 'invalid_format' });
    expect(await deleteTagRuleAction("1' or 1=1")).toEqual({ ok: false, error: 'not_found' });
    expect(await previewTagRulesAction('x')).toEqual({ ok: false, error: 'not_found' });
    expect(calls.some((c) => c[0] === 'session' || c[0] === 'ADMIN')).toBe(false);
  });
});

describe('addTagRuleAction / deleteTagRuleAction', () => {
  it('stores the normalised value and revalidates the Tags page', async () => {
    expect(await addTagRuleAction(T1, 'hashtag', '#Food')).toEqual({ ok: true });
    expect(has('insert', { tag_id: T1, kind: 'hashtag', value: 'food' })).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
  });

  it('needs_update without the migration, too_many_rules at the cap, duplicate_rule on 23505, unexpected otherwise', async () => {
    apply.rules = null;
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'needs_update' });
    apply.rules = Array.from({ length: MAX_RULES }, (_, i) => rule(`r${i}`, T1));
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'too_many_rules' });
    apply.rules = [];
    queue.push({ error: { code: '23505', message: 'tag_rules_tag_kind_value_key' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'duplicate_rule' });
    queue.push({ error: { code: '23503' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'not_found' });
    queue.push({ error: { message: 'secret' } });
    expect(await addTagRuleAction(T1, 'word', 'sale')).toEqual({ ok: false, error: 'unexpected' });
  });

  it('delete: by id; gone = not_found; the missing table = needs_update', async () => {
    queue.push({ data: [{ id: T2 }] });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: true });
    expect(has('eq', 'id', T2)).toBe(true);
    queue.push({ data: [] });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: false, error: 'not_found' });
    queue.push({ error: { code: 'PGRST205' } });
    expect(await deleteTagRuleAction(T2)).toEqual({ ok: false, error: 'needs_update' });
  });
});

describe('preview / apply to existing posts', () => {
  it("preview runs only this tag's rules over every post as a dry run and writes nothing", async () => {
    apply.rules = [rule('r1', T1), rule('r2', T2)];
    apply.result = { posts: 23, tags: 23 };
    expect(await previewTagRulesAction(T1)).toEqual({ ok: true, posts: 23 });
    expect(has('apply', ['r1'], 'all', true)).toBe(true);
    expect(calls.some((c) => c[0] === 'revalidate')).toBe(false);
  });

  it('apply writes and revalidates; a tag without rules changes nothing; errors are keys', async () => {
    apply.rules = [rule('r1', T1)];
    apply.result = { posts: 2, tags: 2 };
    expect(await applyTagRulesAction(T1)).toEqual({ ok: true, posts: 2 });
    expect(has('apply', ['r1'], 'all', false)).toBe(true);
    expect(has('revalidate', '/tags')).toBe(true);
    calls.length = 0;
    expect(await applyTagRulesAction(T2)).toEqual({ ok: true, posts: 0 });
    expect(calls.some((c) => c[0] === 'loadRuleMedia')).toBe(false);
    apply.rules = null;
    expect(await applyTagRulesAction(T1)).toEqual({ ok: false, error: 'needs_update' });
  });
});
```

  (c) `tests/settings-data.test.tsx`: `expect(urls).toHaveLength(18);` → `expect(urls).toHaveLength(20);`; `expect(await screen.findByText('18 files downloaded.')).toBeInTheDocument();` → `'20 files downloaded.'`; `expect(server.download.mock.calls).toHaveLength(20);` → `toHaveLength(22);`.
- [ ] **Step 2 — run, see them fail:** `npx vitest run tests/tag-actions.test.ts tests/tag-rule-actions.test.ts tests/settings-data.test.tsx`.
- [ ] **Step 3 — `lib/data/export.ts`.** Replace `  { name: 'media_tags', keys: ['media_id', 'tag_id'] },` with that line followed by `  { name: 'tag_rules', keys: ['id'] },` and `  { name: 'media_tag_rejections', keys: ['media_id', 'tag_id'] },`.
- [ ] **Step 4 — `app/(app)/tags/actions.ts`.** Three edits:
  1. Replace `import { isMediaId, isUuid, MAX_TAGS_PER_POST, normalizeTagName, pickColor, sameTagName } from '@/lib/tags';` with that line followed by

```ts
import { applyTagRules, isMissingTable, loadRuleMedia, loadRules } from '@/lib/tag-rules/apply';
import { MAX_RULES, normalizeRuleValue, RULE_KINDS, type RuleError, type RuleKind } from '@/lib/tag-rules/rules';
```

  2. In `setPostTagsAction`, replace

```ts
    const del = db.from('media_tags').delete().eq('media_id', mediaId);
    // ids are validated uuids, so the PostgREST list literal cannot be injected into
    const { error } = ids.length ? await del.not('tag_id', 'in', `(${ids.join(',')})`) : await del;
    return error ? fail(keyOf(error)) : done();
```

  with

```ts
    const current = await db.from('media_tags').select('tag_id').eq('media_id', mediaId);
    if (current.error) return fail(keyOf(current.error));
    const removed = ((current.data ?? []) as { tag_id: unknown }[]).map((r) => String(r.tag_id)).filter((t) => !ids.includes(t.toLowerCase()));
    if (removed.length === 0) return done();
    // Plan 17c: remember what the owner took off BEFORE removing it, so a tag rule never puts it back. Without the
    // migration there are no rules (nothing to remember it for): the removal goes ahead.
    const memo = await db.from('media_tag_rejections').upsert(removed.map((tag_id) => ({ media_id: mediaId, tag_id })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
    if (memo.error && !isMissingTable(memo.error)) return fail(keyOf(memo.error));
    const { error } = await db.from('media_tags').delete().eq('media_id', mediaId).in('tag_id', removed);
    return error ? fail(keyOf(error)) : done();
```

  Also update the doc comment above `setPostTagsAction` to: `/** Replaces a post's tags with exactly \`tagIds\` (deduplicated, at most 10). Adds first, then remembers and removes the rest (Plan 17c: a removed tag is never re-added by a rule), so a failure half-way leaves extra tags rather than losing the existing ones. */`
  3. Append at the END of the file:

```ts

// ---- Plan 17c: tag rules (owner session, RLS tag_rules_owner_all / media_tags_owner_all) ----

export type RuleActionError = RuleError | 'duplicate_rule' | 'too_many_rules' | 'not_found' | 'needs_update' | 'unexpected';
export type RuleResult = { ok: true } | { ok: false; error: RuleActionError };
/** posts = posts that get (preview) or got (apply) the tag. */
export type ApplyRulesResult = { ok: true; posts: number } | { ok: false; error: RuleActionError };

const failRule = (error: RuleActionError): { ok: false; error: RuleActionError } => ({ ok: false, error });
const ruleKeyOf = (e: DbError): RuleActionError => (isMissingTable(e) ? 'needs_update' : e?.code === '23505' ? 'duplicate_rule' : e?.code === '23503' ? 'not_found' : 'unexpected');

export async function addTagRuleAction(tagId: string, kind: string, value: string): Promise<RuleResult> {
  await requireOwner();
  if (!isUuid(tagId) || !(RULE_KINDS as readonly string[]).includes(kind)) return failRule('not_found');
  const v = normalizeRuleValue(kind as RuleKind, value);
  if (!v.ok) return failRule(v.error);
  try {
    const db = await createServerSupabase();
    const rules = await loadRules(db);
    if (rules === null) return failRule('needs_update');
    if (rules.length >= MAX_RULES) return failRule('too_many_rules');
    const { error } = await db.from('tag_rules').insert({ tag_id: tagId, kind, value: v.value });
    if (error) return failRule(ruleKeyOf(error));
    revalidatePath('/tags');
    return { ok: true };
  } catch {
    return failRule('unexpected');
  }
}

/** Deleting a rule keeps the tags it already added (rules never remove tags). */
export async function deleteTagRuleAction(ruleId: string): Promise<RuleResult> {
  await requireOwner();
  if (!isUuid(ruleId)) return failRule('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('tag_rules').delete().eq('id', ruleId).select('id');
    if (error) return failRule(ruleKeyOf(error));
    if ((data ?? []).length === 0) return failRule('not_found');
    revalidatePath('/tags');
    return { ok: true };
  } catch {
    return failRule('unexpected');
  }
}

/** The tag's rules over every existing post: dryRun = the preview count, else the apply. */
async function runTagRules(tagId: string, dryRun: boolean): Promise<ApplyRulesResult> {
  if (!isUuid(tagId)) return failRule('not_found');
  try {
    const db = await createServerSupabase();
    const all = await loadRules(db);
    if (all === null) return failRule('needs_update');
    const rules = all.filter((r) => r.tagId === tagId.toLowerCase());
    if (rules.length === 0) return { ok: true, posts: 0 };
    const r = await applyTagRules(db, { media: await loadRuleMedia(db), rules, scope: 'all', dryRun });
    if (!dryRun && r.tags > 0) done();
    return { ok: true, posts: r.posts };
  } catch {
    return failRule('unexpected');
  }
}

export async function previewTagRulesAction(tagId: string): Promise<ApplyRulesResult> {
  await requireOwner();
  return runTagRules(tagId, true);
}

export async function applyTagRulesAction(tagId: string): Promise<ApplyRulesResult> {
  await requireOwner();
  return runTagRules(tagId, false);
}
```

  (`runTagRules` is not exported: a `'use server'` file may export async functions only, and every export is a public endpoint that must call `requireOwner()` itself.)
- [ ] **Step 5 — verify.** `npx vitest run tests/tag-actions.test.ts tests/tag-rule-actions.test.ts tests/settings-data.test.tsx tests/data-export.test.ts tests/data-privacy-guard.test.ts tests/messages.test.ts` → PASS (`data-export.test.ts` finds both new tables' primary keys in Task 2's migration); `npx tsc --noEmit`; `npx eslint "app/(app)/tags/actions.ts" lib/data/export.ts tests/tag-actions.test.ts tests/tag-rule-actions.test.ts tests/settings-data.test.tsx`.
- [ ] **Step 6 — commit.** `git add "app/(app)/tags/actions.ts" tests/tag-actions.test.ts tests/tag-rule-actions.test.ts lib/data/export.ts tests/settings-data.test.tsx` → `git commit -m "feat(tags): rule actions with preview and apply; removed tags are remembered (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 6: the Rules dialog on the Tags page

**Files:** Create `components/tags/TagRulesDialog.tsx`; modify `components/tags/TagsView.tsx`, `app/(app)/tags/page.tsx`, `tests/tags-view.test.tsx`.

- [ ] **Step 1 — failing tests.** `tests/tags-view.test.tsx`, three edits:
  1. Replace `import { DEFAULT_PREFS } from '@/lib/prefs';` with that line followed by `import type { TagRule } from '@/lib/tag-rules/rules';`.
  2. Replace `const ok = async () => ({ ok: true as const });` with

```ts
const ok = async () => ({ ok: true as const });
const RULES: TagRule[] = [{ id: 'r1', tagId: T1, kind: 'hashtag', value: 'food', createdAt: '2026-10-01T00:00:00.000Z' }];
const ruleActions = () => ({ add: vi.fn(ok), remove: vi.fn(ok), preview: vi.fn(async () => ({ ok: true as const, posts: 23 })), apply: vi.fn(async () => ({ ok: true as const, posts: 23 })) });
```

  3. Replace `remove: vi.fn(ok), ...o };` with `remove: vi.fn(ok), rules: RULES, ruleActions: ruleActions(), ...o };`, and append at the END of the file:

```ts

describe('TagsView rules (Plan 17c)', () => {
  it('each tag row has a Rules button with its count; the dialog lists the rules and adds a hashtag rule', async () => {
    const user = userEvent.setup();
    const props = view();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: `Rules for ${LONG}` })).toHaveTextContent('Rules (0)');
    await user.click(within(table).getByRole('button', { name: 'Rules for عروض' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Hashtag #food')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(en.pages.tags.rules.valueLabel.hashtag), '#Travel');
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.add }));
    expect(props.ruleActions.add).toHaveBeenCalledWith(T1, 'hashtag', '#Travel');
    await user.click(within(dialog).getByRole('button', { name: 'Remove the rule: Hashtag #food' }));
    expect(props.ruleActions.remove).toHaveBeenCalledWith('r1');
  });

  it('a format rule is picked from the formats, not typed', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rules for عروض' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.kinds.format }));
    await user.click(within(dialog).getByRole('button', { name: en.analysis.format.CAROUSEL_ALBUM }));
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.add }));
    expect(props.ruleActions.add).toHaveBeenCalledWith(T1, 'format', 'CAROUSEL_ALBUM');
  });

  it('Apply to existing posts shows how many posts change BEFORE it writes', async () => {
    const user = userEvent.setup();
    const props = view();
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rules for عروض' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.applyExisting }));
    expect(props.ruleActions.preview).toHaveBeenCalledWith(T1);
    expect(props.ruleActions.apply).not.toHaveBeenCalled();
    expect(await within(dialog).findByText(/Adds this tag to 23 posts\./)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.apply }));
    expect(props.ruleActions.apply).toHaveBeenCalledWith(T1);
    expect(await within(dialog).findByText('Tagged 23 posts.')).toBeInTheDocument();
  });

  it('an error comes back as its translated key', async () => {
    const user = userEvent.setup();
    const actions = { ...ruleActions(), add: vi.fn(async () => ({ ok: false as const, error: 'duplicate_rule' as const })) };
    view({ ruleActions: actions });
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rules for عروض' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(en.pages.tags.rules.valueLabel.hashtag), 'food');
    await user.click(within(dialog).getByRole('button', { name: en.pages.tags.rules.add }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(en.pages.tags.errors.duplicate_rule);
  });

  it('without the database update: no Rules buttons, one quiet line', () => {
    view({ rules: null });
    expect(screen.queryByRole('button', { name: /^Rules for / })).toBeNull();
    expect(screen.getByText(en.pages.tags.rulesNeedUpdate)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2 — run, see it fail:** `npx vitest run tests/tags-view.test.tsx` (unknown props / no Rules button).
- [ ] **Step 3 — `components/tags/TagRulesDialog.tsx`** (Write tool):

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { Segmented } from '@/components/shared/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Tag } from '@/lib/analysis/types';
import { RULE_FORMATS, RULE_KINDS, type RuleKind, type TagRule } from '@/lib/tag-rules/rules';
import type { ApplyRulesResult, RuleResult } from '@/app/(app)/tags/actions';

export interface RuleActions {
  add: (tagId: string, kind: string, value: string) => Promise<RuleResult>;
  remove: (ruleId: string) => Promise<RuleResult>;
  preview: (tagId: string) => Promise<ApplyRulesResult>;
  apply: (tagId: string) => Promise<ApplyRulesResult>;
}

type Format = (typeof RULE_FORMATS)[number];

/** One tag's rules: list with Remove, an add form, and "Apply to existing posts" with a preview count before it writes. */
function RulesBody({ tag, rules, actions }: { tag: Tag; rules: TagRule[]; actions: RuleActions }) {
  const t = useTranslations('pages.tags.rules');
  const tTags = useTranslations('pages.tags');
  const tErr = useTranslations('pages.tags.errors');
  const tf = useTranslations('analysis.format');
  const [kind, setKind] = useState<RuleKind>('hashtag');
  const [value, setValue] = useState('');
  const [format, setFormat] = useState<Format>('REELS');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null); // posts the apply would tag; null = not checked
  const [applied, setApplied] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'add' | 'check' | 'apply' | null>(null);

  const label = (r: TagRule) => (r.kind === 'format' ? t('label.format', { format: tf(r.value) }) : t(`label.${r.kind}`, { value: r.value }));
  const run = (what: 'add' | 'check' | 'apply' | null, fn: () => Promise<void>) => {
    setBusy(what);
    start(async () => {
      await fn();
      setBusy(null);
    });
  };
  const reset = () => {
    setPreview(null);
    setApplied(null);
  };

  return (
    <div className="grid min-w-0 gap-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('title', { name: tag.name })}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t('hint')}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="grid gap-1">
          {rules.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm" dir="auto">
                {label(r)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={t('removeNamed', { rule: label(r) })}
                onClick={() =>
                  run(null, async () => {
                    const res = await actions.remove(r.id);
                    reset();
                    setError(res.ok ? null : tErr(res.error));
                  })
                }
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid min-w-0 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run('add', async () => {
            const res = await actions.add(tag.id, kind, kind === 'format' ? format : value);
            reset();
            if (res.ok) {
              setValue('');
              setError(null);
            } else setError(tErr(res.error));
          });
        }}
      >
        <Segmented
          label={t('kind')}
          value={kind}
          options={RULE_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
          onChange={(k) => {
            setKind(k);
            setError(null);
          }}
        />
        {kind === 'format' ? (
          <Segmented label={t('format')} value={format} options={RULE_FORMATS.map((f) => ({ value: f, label: tf(f) }))} onChange={setFormat} />
        ) : (
          <FormField id={`rule-value-${tag.id}`} label={t(`valueLabel.${kind}`)}>
            {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" dir="auto" />}
          </FormField>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div>
          <LoadingButton type="submit" pending={busy === 'add'} disabled={pending || (kind !== 'format' && value.trim() === '')}>
            {t('add')}
          </LoadingButton>
        </div>
      </form>
      <div className="grid gap-2 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">{t('applyHint')}</p>
        {preview === null ? (
          <div>
            <LoadingButton
              type="button"
              variant="outline"
              pending={busy === 'check'}
              disabled={pending || rules.length === 0}
              onClick={() =>
                run('check', async () => {
                  const res = await actions.preview(tag.id);
                  setApplied(null);
                  if (res.ok) {
                    setPreview(res.posts);
                    setError(null);
                  } else setError(tErr(res.error));
                })
              }
            >
              {t('applyExisting')}
            </LoadingButton>
          </div>
        ) : (
          <>
            <p role="status" className="text-sm">
              {preview === 0 ? t('previewNone') : t('preview', { count: preview })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setPreview(null)}>
                {tTags('cancel')}
              </Button>
              {preview > 0 ? (
                <LoadingButton
                  type="button"
                  pending={busy === 'apply'}
                  disabled={pending}
                  onClick={() =>
                    run('apply', async () => {
                      const res = await actions.apply(tag.id);
                      setPreview(null);
                      if (res.ok) setApplied(res.posts);
                      else setError(tErr(res.error));
                    })
                  }
                >
                  {t('apply')}
                </LoadingButton>
              ) : null}
            </div>
          </>
        )}
        {applied !== null ? (
          <p role="status" className="text-sm">
            {t('applied', { count: applied })}
          </p>
        ) : null}
      </div>
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            {t('close')}
          </Button>
        </ResponsiveDialogClose>
      </ResponsiveDialogFooter>
    </div>
  );
}

/** The Rules dialog of one tag (null = closed). `rules` are that tag's rules, oldest first. */
export function TagRulesDialog({ tag, rules, actions, onClose }: { tag: Tag | null; rules: TagRule[]; actions: RuleActions; onClose: () => void }) {
  return (
    <ResponsiveDialog open={tag !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>{tag ? <RulesBody key={tag.id} tag={tag} rules={rules} actions={actions} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
```

  (Client component: `lib/tag-rules/rules.ts` is pure and client-safe; the actions file is imported as `import type` only.)
- [ ] **Step 4 — `components/tags/TagsView.tsx`.** Seven edits (exact old → new):
  1. `import { TagBadge } from '@/components/shared/TagBadge';` → that line + `import { TagRulesDialog, type RuleActions } from '@/components/tags/TagRulesDialog';`
  2. `import { formatCompact, formatNumber, formatPercent } from '@/lib/format';` → that line + `import type { TagRule } from '@/lib/tag-rules/rules';`
  3. In `TagsViewProps`, `  remove: (id: string) => Promise<TagResult>;\n}` → 

```ts
  remove: (id: string) => Promise<TagResult>;
  /** Plan 17c: every tag rule, oldest first; null = the database update for rules is not applied yet. */
  rules: TagRule[] | null;
  ruleActions: RuleActions;
}
```

  4. `export function TagsView({ tags, stats, create, rename, remove }: TagsViewProps) {` → `export function TagsView({ tags, stats, create, rename, remove, rules, ruleActions }: TagsViewProps) {`
  5. `  const [deleting, setDeleting] = useState<Tag | null>(null);` → that line +

```ts
  const [ruling, setRuling] = useState<Tag | null>(null);
  const rulesOf = (id: string) => (rules ?? []).filter((r) => r.tagId === id);
```

  6. In the `actions` column, replace

```tsx
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" aria-label={t('renameNamed', { name: r.tag.name })} onClick={() => setRenaming(r.tag)}>
```

  with

```tsx
          <span className="flex gap-1">
            {rules !== null ? (
              <Button type="button" variant="ghost" size="sm" aria-label={t('rulesButtonNamed', { name: r.tag.name })} onClick={() => setRuling(r.tag)}>
                {t('rulesButton', { count: rulesOf(r.tag.id).length })}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" aria-label={t('renameNamed', { name: r.tag.name })} onClick={() => setRenaming(r.tag)}>
```

  7. Replace `            <CreateForm create={create} />` with that line + `            {rules === null ? <p className="mt-2 text-sm text-muted-foreground">{t('rulesNeedUpdate')}</p> : null}`; and replace `      <RenameDialog key={renaming?.id ?? 'none'} tag={renaming} rename={rename} onClose={() => setRenaming(null)} />` with that line + `      <TagRulesDialog tag={ruling} rules={ruling ? rulesOf(ruling.id) : []} actions={ruleActions} onClose={() => setRuling(null)} />`.
- [ ] **Step 5 — `app/(app)/tags/page.tsx`.** Four edits:
  1. `import { createTagAction, deleteTagAction, renameTagAction } from '@/app/(app)/tags/actions';` → `import { addTagRuleAction, applyTagRulesAction, createTagAction, deleteTagAction, deleteTagRuleAction, previewTagRulesAction, renameTagAction } from '@/app/(app)/tags/actions';`
  2. `import { createServerSupabase } from '@/lib/supabase/server';` → that line + `import { loadRules } from '@/lib/tag-rules/apply';`
  3. `  const [all, tags] = await Promise.all([loadAccounts(), loadTags(db)]);` → `  const [all, tags, rules] = await Promise.all([loadAccounts(), loadTags(db), loadRules(db)]);`
  4. `  return <TagsView tags={tags} stats={buildTagStats(posts.flat(), tags)} create={createTagAction} rename={renameTagAction} remove={deleteTagAction} />;` →

```tsx
  const ruleActions = { add: addTagRuleAction, remove: deleteTagRuleAction, preview: previewTagRulesAction, apply: applyTagRulesAction };
  return <TagsView tags={tags} stats={buildTagStats(posts.flat(), tags)} create={createTagAction} rename={renameTagAction} remove={deleteTagAction} rules={rules} ruleActions={ruleActions} />;
```

- [ ] **Step 6 — verify.** `npx vitest run tests/tags-view.test.tsx tests/ui-standards.test.ts tests/messages.test.ts tests/loading-routes*.test.* tests/moderation-privacy.test.ts` (the loading guard file name: `grep -rl "loading.tsx" tests`) → PASS; `npx tsc --noEmit`; `npx eslint components/tags "app/(app)/tags/page.tsx" tests/tags-view.test.tsx`. Manually (orchestrator, after the wave, `npm run dev`): `/tags` at 360 / 768 / 1280 px, light and dark of two themes, open Rules, add a rule, Apply flow.
- [ ] **Step 7 — commit.** `git add components/tags/TagRulesDialog.tsx components/tags/TagsView.tsx "app/(app)/tags/page.tsx" tests/tags-view.test.tsx` → `git commit -m "feat(tags): Rules dialog with preview before applying to existing posts (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 7: runbook and docs

**Files:** Create `docs/RUNBOOK_AUTOTAG.md`; modify `docs/SPEC.md`, `docs/TODO.md`, `docs/PROGRESS.md`. Docs are CRLF; use the Edit / Write tools.

- [ ] **Step 1 — `docs/SPEC.md` §5 (⚠ owner's nod).** Replace the exact row

```
| `media_tags` | media_id, tag_id — pk(media_id, tag_id). Manual tagging in the UI; hashtag-to-tag auto-suggest is later |
```

with

```
| `media_tags` | media_id, tag_id, source (`manual` / `auto`) — pk(media_id, tag_id). Manual tagging in the UI; owner-written rules apply tags automatically (§7n; creator-toolkit §0b) and never overwrite a tag already on a post |
| `tag_rules`, `media_tag_rejections` | Plan 17c: owner-authored rules (tag_id, kind `hashtag`/`word`/`format`, value, created_at; unique per tag, kind and value ignoring case) and the (post, tag) pairs the owner removed by hand, which no rule adds back (also enforced by a `BEFORE INSERT` trigger on `media_tags`). Owner-all RLS; cascade with the tag / post |
```

- [ ] **Step 2 — `docs/SPEC.md` new section.** Insert immediately BEFORE the line `## 8. UI (v1)` (if Plans 17a/17b added §7l/§7m there, keep their order and insert this after them):

```
## 7n. Auto-tagging (Plan 17c; creator-toolkit design §0b "Tags")
Status: code done, NOT verified live (`docs/RUNBOOK_AUTOTAG.md`); migration `20261102000001_tag_rules` NOT applied (owner applies it before deploying; without it the Tags page shows "Automatic tagging needs a database update" and nothing else changes).

Tags page → **Rules** per tag: "hashtag is #x" (the caption's hashtags after NFKC + lower case; `#foodie` is not `#food`), "caption contains a word or phrase" (Latin whole words, Chinese / Japanese / Korean anywhere, case and width folded; at least 3 letters unless CJK), "format is Reel / Carousel / Image". Stories are never auto-tagged. At most 200 rules; at most 10 tags per post (oldest rule first). **Automatic** for posts published at or after the rule was written: the sync's media-list job runs the rules on the posts it just listed (best-effort, never fails the sync). **Older posts** only via "Apply to existing posts", which first shows how many posts would get the tag. Rules only ADD (`INSERT … ON CONFLICT DO NOTHING`, `source = 'auto'`): a tag already on a post is never changed, deleting a rule keeps its tags, and every tag the owner removes from a post (manual or automatic) is remembered and never added back by a rule (a database trigger enforces it; the owner can always re-add it by hand). Matching runs in TypeScript (`lib/tag-rules/`), not SQL. Not built: suggested chips in the tag picker, a live preview while typing, an "auto" badge, undo of an apply.
```

- [ ] **Step 3 — `docs/TODO.md`.** Insert immediately BEFORE the line `## 6b. Next (Plan 14/15 Settings)`:

```
## 6t. Auto-tagging (Plan 17c)
- [x] Tag rules (hashtag / caption word / format), automatic on new posts, Apply to existing posts with a preview, removed tags remembered (code done; live verification pending: docs/RUNBOOK_AUTOTAG.md)
- [ ] Apply migration `20261102000001_tag_rules` (owner's go-ahead, before deploying)
- [ ] RUNBOOK_AUTOTAG §1–§5 walked through by the owner; live checks L1 (PostgREST upsert + trigger), L2 (real captions), L3 (tick duration) (plan 2026-11-01-17c)
- Known: Storage used does not count `tag_rules` / `media_tag_rejections` (data_usage() lists tables literally); "Apply to existing posts" reads at most 20,000 posts; no suggested chips, no auto badge, no undo of an apply.

```

  (If 17a/17b already used the letter `t`, take the next free letter.) In `## 7. Later`, if a line mentions auto-tagging from hashtags, mark it `[x]` with "(Plan 17c, code done)"; otherwise change nothing there.
- [ ] **Step 4 — `docs/PROGRESS.md`.** (a) §3: append the bullet `- **17c: Auto-tagging (code done, NOT verified live; migration 20261102000001 NOT applied).** Tags page → Rules per tag (hashtag / caption word / format); new posts tagged by the sync's media-list job; older posts via "Apply to existing posts" with a preview count; rules only add; removed tags are remembered and never re-added (trigger). Plan: docs/superpowers/plans/2026-11-01-17c-auto-tagging.md. Runbook: docs/RUNBOOK_AUTOTAG.md.` (b) §5 table: add the row `| 20261102000001_tag_rules | tag_rules, media_tag_rejections, media_tags.source, trigger media_tags_skip_rejected (Plan 17c; **NOT applied**: owner go-ahead, apply BEFORE deploying; RUNBOOK_AUTOTAG §0) |`. (c) §6: append item `10. **docs/RUNBOOK_AUTOTAG.md** (Plan 17c): §0 migration, then §1–§5.` (d) §8: append `- 17c: automatic for new posts only, older posts via Apply with a preview; every manual removal remembered; no suggested chips; source column not shown; Storage used does not count the two new tables.`
- [ ] **Step 5 — `docs/RUNBOOK_AUTOTAG.md`** (new):

```
# Runbook — Auto-tagging (Plan 17c)

Live checks for the owner (with the assistant). The SQL was verified on PGlite (Postgres 17 in WASM) on top of all
migrations (see the plan's "Scratch-run result"); the UI only in jsdom tests. Report counts and yes/no only.

## 0. The migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261102000001_tag_rules.sql` adds `tag_rules`, `media_tag_rejections`, `media_tags.source`
(default `manual` for every existing row) and the trigger `media_tags_skip_rejected`. Nothing existing is dropped.
```
node --env-file=.env.local scripts/sb.mjs migration list        # only 20261102000001 pending (plus any earlier pending file)
node --env-file=.env.local scripts/db-probe.mjs table:tag_rules table:media_tag_rejections   # before: 404 PGRST205
node --env-file=.env.local scripts/sb.mjs db push --dry-run
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs table:tag_rules table:media_tag_rejections   # after: 401 42501 (exists, anon denied)
```
Without it: the Tags page shows "Automatic tagging needs a database update", the sync skips rules, removing a tag works,
and the two new files in Settings → Data & privacy → Export fail with the usual "export failed" message.

## 1. Rules and the dialog (360 / 768 / 1280 px, light and dark)
1. Tags → a tag → "Rules (0)" → add `#something` you really use, a word, and "Format is Reel". Duplicates (other case,
   `＃` full-width) are refused with "This tag already has that rule."
2. Remove one rule: the tags it added stay on the posts.

## 2. Apply to existing posts (L2)
1. Press "Apply to existing posts": note the count. Check 3 of those posts in Post Lab: the caption really has the
   hashtag / word (also a Chinese one if you use them). Press Apply: "Tagged N posts."; the Tags table counts change.
2. Press it again: "No post would change." (idempotent).
3. A post you had tagged BY HAND with that tag before: still exactly one tag, unchanged.

## 3. Removal memory (L1)
1. In a post's tag picker, untick an automatic tag and save.
2. Apply to existing posts again: the count does not include that post; after Apply the tag is still off.
3. Wait for the next sync tick (or "Sync now"): still off. Re-tick it by hand: it stays (manual wins).
4. (Assistant, owner present) PostgREST check: `upsert` of that pair with `source: 'auto'` through the owner session
   answers 201 and the row does NOT appear (the trigger). Never paste row values into chats.

## 4. New posts and the tick (L3)
1. Post a new Reel / post with a rule's hashtag. After the next tick it has the tag (source auto).
2. Compare 3 ticks' durations before and after creating rules (Server-Timing / `sync_runs`): no visible change.

## 5. Export and delete
1. Settings → Data & privacy → Download all: 20 files (22 with other people's data); `tag_rules` and
   `media_tag_rejections` open as JSON.
2. Deleting a tag removes its rules (Tags → Delete).
```

- [ ] **Step 6 — commit.** `git add docs/RUNBOOK_AUTOTAG.md docs/SPEC.md docs/TODO.md docs/PROGRESS.md` → `git commit -m "docs: auto-tagging spec, runbook, todo and progress (Plan 17c)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

## Scratch-run result (2026-10-27, throwaway clone and PGlite OUTSIDE the repo)

**Code (clone of `main` at `81054d7`, own `npm ci`, the real `node_modules` untouched):** every file of Tasks 1–6 written as in this plan. Targeted runs: `tests/tag-rules.test.ts` (13), `tests/tag-rules-apply.test.ts` (+ the sync describe), `tests/tag-rule-actions.test.ts`, `tests/tag-actions.test.ts`, `tests/tags-view.test.tsx` (10), `tests/sync-run-account.test.ts`, `tests/sync-store.test.ts`, `tests/sync-tick.test.ts`, `tests/messages.test.ts`, `tests/data-export.test.ts`, `tests/settings-data.test.tsx`, `tests/migrations.test.ts`, `tests/tag-rules-migration.test.ts`: all green; `tsc --noEmit` clean. Full `npm run check` on the clone (lint, tsc, all tests, `next build`): **exit 0**. After the fixes below, the code blocks were extracted verbatim from THIS file into the clone again: `tsc` clean, eslint clean on every touched file, full Vitest **307 files / 3,131 tests green**.

**Found by the dry run and fixed in this plan:** (1) a first draft of `loadRuleMedia` reused `readPages` from `lib/dashboard/read.ts`, which imports `lib/sync/store.ts` → an import cycle `store → tag-rules/apply → dashboard/read → store` once the sync hook lands: replaced by a 6-line page loop; (2) `loadRules` first returned null on ANY error (a transient error would read as "needs a database update"): now null only for `PGRST205`/`42P01`, otherwise it throws; (3) the working copies are CRLF (`core.autocrlf=true`): scripted string edits must normalise line endings (the Edit tool handles it); (4) a clock read added to `mediaList` would shift the existing time-budget tests: the hook has none; (5) ICU messages with a plural branch that starts with a word followed by `}` would be read as a placeholder by `tests/messages.test.ts`: the button text is `Rules ({count})` instead.

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; all 16 existing migrations, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.mfa_factors` / `storage.*`; roles `anon`, `authenticated`, `service_role` (bypassrls) with Supabase-like default privileges), 27 of 27 checks passed:** the migration applies; default `source` = manual; owner inserts a rule; duplicate ignoring case → 23505; same value, other kind allowed; format `STORY`, an untrimmed value, 51 characters, an unknown kind → 23514; unknown tag → 23503; a non-owner sees 0 rules and cannot insert (42501); anon sees 0 rules and cannot write rejections; the owner at aal1 with a verified factor sees 0 rules; the owner records a rejection; an `auto` insert of a rejected pair is skipped for the owner session AND the service role; the owner can still tag it by hand (`manual`); `auto` never overwrites an existing manual row; a new `auto` pair inserts; the same insert again is a no-op; an unknown source → 23514; deleting a tag cascades its rules, rejections and `media_tags`; deleting a post cascades its rejections; `delete_all_data()` (16c) empties `tag_rules`, `media_tag_rejections` and `media_tags`.

**Not executed:** a real PostgREST (L1: `upsert` with `ignoreDuplicates` + the trigger), real captions (L2), the tick on Vercel (L3), a browser (dialog at 360 px, themes), any Meta call (none is made by this plan).

## Self-review

- Spec coverage: §0b "suggests AND applies … never silently overwrite a manual tag" → rules + auto apply (Tasks 3–6), insert-only + trigger (Tasks 2, 3), removal memory (Tasks 2, 5); roadmap 17c In list (rules per tag, preview, apply, automatic for new posts, `source`, rejections, never delete manual) covered; "Suggested chips" deliberately dropped (Q7 default, Open question 4).
- Names checked against the code by grep: `captionFeatures`, `fold`, `matchRule`, `validateWord`, `MAX_TAGS_PER_POST`, `isUuid`, `requireOwner`, `createServerSupabase`, `revalidatePath`, `SyncStore.upsertMedia`, `supabaseSyncStore`, `memoryStore`, `EXPORT_TABLES`, `Segmented`, `FormField`, `LoadingButton`, `ResponsiveDialog*`, `analysis.format.*`.
- Type consistency: `RuleActions` (Task 6) matches the action signatures of Task 5 (`RuleResult`, `ApplyRulesResult`); `TagRule` / `RuleMedia` come only from `lib/tag-rules/rules.ts`.
- Cross-task file edits: `tests/tag-rules-apply.test.ts` created by Task 3 (wave 1), appended by Task 4 (wave 2); `messages/*.json` only by Task 1.
