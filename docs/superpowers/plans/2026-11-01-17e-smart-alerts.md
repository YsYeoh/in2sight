# Plan 17e: Smart alerts (quiet hours, one morning push, the weekly review push) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parallel worktree agents: read `docs/superpowers/implementer-rules.md` first.

**Goal:** the creator-toolkit §0b alerts policy: "instant push only for unusual events (breakout post, big drop, unfollow spike, sync/token failure); everything else rolls into ONE daily morning digest; quiet hours respected; per-type toggles stay in Settings". 17e only decides **when** a push goes out and **what its one line says**; it builds no page. The weekly review push links to the digest page of Plan 17d once that exists (until then `/overview`).

**Architecture:** one pure module `lib/alerts/quiet.ts` (`isQuiet`, `pushNow`, `digestDue`, `heldCount`, `summaryAlerts`, `summaryToPush`; owner-timezone wall-clock hours via `lib/sync/time`, DST-safe) decides timing. `runAlerts` (`lib/alerts/run.ts`, already inside the tick's 10 s alert window) pushes a fresh alert at once only when `pushNow` says so; then, once a day at the end of quiet hours, it counts the UNREAD alerts of the last 24 h that were held back (created in quiet hours, or a digest-only kind) and stores + pushes ONE summary row (`digest:<day>`; on the first day of the owner's week the summary is the weekly review `weekly_digest:<day>`, carrying the same count, so that morning still gets one push). Dedupe = the existing unique `notifications.dedupe_key` + `INSERT … ON CONFLICT DO NOTHING RETURNING`: a retried or overlapping tick never stores or pushes a summary twice. Two new rules in `lib/alerts/rules.ts`: `nonfollower_spike` (non-follower share of reach, same-weekday robust z via `weekdayAnomaly`) and `unfollow_spike` (unfollows, same method, **OFF** behind the code constant `UNFOLLOW_SPIKE_ENABLED = false` until RUNBOOK_GROWTH §2 verifies the follows/unfollows mapping). Settings: `quietFrom` / `quietTo` (whole hours) join `profiles.alert_settings` (jsonb, `parseAlertSettings` clamps; no migration); the summaries use the existing per-type push toggles (`push.digest`, `push.weekly_digest`). One migration: the `notifications.kind` check gains the four kinds.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript strict, next-intl 4, `web-push` (installed), Vitest + Testing Library + jsdom. **New dependencies: none.**

**Spec:** creator-toolkit design `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Alerts policy (owner)", round 3 "non-follower signals: safety as alerts"), roadmap `docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md` §1.1 (row "Smart alerts"), §3 "17e", §4 Q6, §6 item 5 (SPEC §7c lacks the policy). **`docs/SPEC.md` §7c does not contain the smart-alerts policy yet: Task 3 adds it — ⚠ owner's nod needed** (the owner approved §0b; this plan only follows it with the roadmap defaults). Project rules: `CLAUDE.md`. Rules that apply to EVERY 17x plan: roadmap §3 "Rules that apply to EVERY plan" (not repeated here; they bind).

**Independence and order:** roadmap order is 17a → 17b → 17c → 17d → 17e. 17e imports NO code of 17a–17d and builds on current `main` (`81054d7`). Touch points: (1) the weekly review link `WEEKLY_REVIEW_HREF` in `lib/alerts/message.ts` is `/overview` until Plan 17d's page exists; Task 4 sets `/plan/digest` when `app/(app)/plan/[[...section]]/page.tsx` exists at its base (17d's draft route), and a guard test fails if `app/(app)/plan` exists while the constant still says `/overview`; (2) `lib/sync/time.ts` gains ONE export `localTime` (17a/17b/17d only import from that file); (3) `messages/*.json`: insertions only inside `notifications.kinds` (after `moderation_paused`) and `settings.notifications` (after `syncFailuresHint`) — 17b inserts before the top-level `"notifications": {` line, so the anchors do not collide; (4) migration `20261104000001_smart_alerts.sql` sorts after 17b `20261101000001`, 17c `20261102000001` and 17d `20261103000001`; none of them touches `notifications`; (5) docs: SPEC §7c is edited in place (no new letter), TODO gets `## 6v` (17a 6r, 17b 6s, 17c 6t, 17d presumably 6u; take the next free letter). Names reserved by 17e: `lib/alerts/quiet.ts`, i18n keys `notifications.kinds.{nonfollower_spike,unfollow_spike,digest,weekly_digest}` and `settings.notifications.{quietTitle,quietFrom,quietTo,quietHint}`, notification kinds `nonfollower_spike`, `unfollow_spike`, `digest`, `weekly_digest`.

**Scratch run:** every code block of Tasks 1, 2, 4, 5 and 6 was written into a throwaway `git clone` of `main` at `81054d7` in the session scratchpad (`p17e/`, own `npm ci`; the real `node_modules` untouched) and the migration was executed on PGlite 0.3.15 (Postgres 17 in WASM) on top of all 16 existing migrations. Results: "Scratch-run result" at the end.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

- **Assumed from roadmap §4 Q6 (approved as working assumptions):** quiet hours **22:00–08:00 in the owner's timezone** (`profiles.timezone`, the same `tz` the tick already uses); the morning summary at **08:00**; pushes created during quiet hours are **folded into that ONE morning push** (a count, not a queue); **nothing breaks quiet hours**, not even `needs_reconnect` / `sync_failing` (nothing the owner can fix at night); the **unfollow-spike alert stays OFF** until RUNBOOK_GROWTH §2 verified `FOLLOW_TYPE` (`lib/instagram/metrics.ts:28`, marked uncertain).
- **⚠ No separate `digestHour` setting:** the summary goes out at the END of quiet hours (`quietTo`). The roadmap listed `digestHour`; with a separate hour the summary could fall inside quiet hours or leave a gap where held alerts belong to no summary. "The same hour twice" (`quietFrom === quietTo`) = no quiet hours; the summary of the digest-only kinds then goes out at that hour.
- **⚠ No `weeklyDigest` boolean:** the two summaries are notification kinds with the normal per-type push switches (`push.digest`, `push.weekly_digest`, both on by default), shown in the existing switch list. The roadmap listed `weeklyDigest`; the switch list already is that setting.
- **⚠ Which kinds are "unusual events" (pushed at once, outside quiet hours):** `needs_reconnect`, `sync_failing`, `reach_drop`, `taking_off` (its push stays off by default as today), `nonfollower_spike`, `unfollow_spike`. **Digest-only** (never pushed on their own, always counted in the next morning summary): `token_expiring` (7 and 2 days left: the next 08:00 still leaves at least a day) and `moderation_paused` (auto-hide is off by default; nothing breaks before morning). Every alert still lands in the bell at once, as today.
- **⚠ The summary counts only UNREAD alerts** of its window: what the owner already read in the bell before 08:00 is not announced again. Window = [yesterday `quietTo`, today `quietTo`) in owner-timezone wall-clock time (23 h / 25 h on DST days; windows chain without gap or overlap). Counted = push switch on for the kind AND (digest-only kind OR created during quiet hours). Alerts pushed at once are never counted. Nothing held = no summary, no push, no row.
- **Summary rows are notifications** (kind `digest` / `weekly_digest`, `account_id` null, payload `{ username: '', count }`): they appear in the bell ("Morning summary", "Weekly review") and are unread like any alert. They are made only when push is configured (VAPID present) and their switch is on: they exist to be pushed.
- **Weekly review:** on the first day of the owner's week (`profiles.week_start`, Monday by default), from the end of quiet hours, even if nothing was held ("Time to look back at last week."); if something was held, the same push says so ("… 2 alerts are also waiting under the bell.") and the plain morning summary row is stored but not pushed separately (ONE push that morning). Link: `WEEKLY_REVIEW_HREF` (`/overview` until 17d; then `/plan/digest`).
- **Dedupe and retries:** keys `digest:<owner-day>` and `weekly_digest:<owner-day>` (≤ 200 chars, the existing unique index). At most once: as today, a push that fails or runs out of the alert window is not retried (the row exists). Exactly one summary per day across 48 ticks (test). Two overlapping ticks: one push (test, and PGlite: the second `INSERT … ON CONFLICT DO NOTHING RETURNING` returns no row).
- **`nonfollower_spike`:** per account, the share of reach from non-followers (`account_daily_breakdown`, metric `reach`, `NON_FOLLOWER / (FOLLOWER + NON_FOLLOWER)` summed over formats, like the Growth tab's loyalty card; this reach breakdown is the combined follow_type × product type breakdown verified live per creator-toolkit §0b — it is NOT the follows/unfollows mapping that is uncertain). Checked days: yesterday and the day before (today is partial; Instagram may fill yesterday late). Each checked day vs the same weekday of the 8 weeks before (`weekdayAnomaly`: ≥ 4 samples, robust z ≥ 3.5, at least 3 points and 10 % away from the median), **upward only**, days under 50 people reached have no share. Severity `info`, key `nonfollower_spike:<account>:<day>`, payload `{ username, pct, usual, day }` (whole percents), link: the account's Growth tab. Push on by default (an unusual event; owner can switch it off).
- **`unfollow_spike`:** the same method on `account_daily.unfollows` (already read), upward only, severity `warning`, key `unfollow_spike:<account>:<day>`, payload `{ username, count, usual, day }`. **OFF:** `UNFOLLOW_SPIKE_ENABLED = false` in `lib/alerts/settings.ts`; its switch is hidden in Settings while off. Enabling = flipping that constant in a reviewed commit after RUNBOOK_GROWTH §2 passed (a swapped mapping would report a follow spike as unfollows).
- **Tick budget (lesson of 15d: 35 s sync + 10 s alerts + 5 s auto-hide of 60 s):** no new tick lane, no change to `lib/sync/tick.ts`; everything runs inside `runAlerts`' existing window (`ALERT_BUDGET_MS`, `c.deadline`). Added work: per account one more read in the SAME `Promise.all` (reach by follow type for 18 days ≤ 216 rows) and `account_daily` for 60 days instead of 20 (≤ 60 rows); per tick one small read of the 24 h window (only outside quiet hours, `notifications_unread_idx` covers it), at most one insert and one push per day. The summary step is skipped when the window has already run out. No Claude call, no Meta call.
- **Settings UI:** Settings → Notifications → Alerts card gains a **Quiet hours** fieldset: two native selects "From" / "Until" (24 options; UI standard 18: more than four options = native select, `h-[var(--ctl)]`), labels formatted by `formatHour` with the request's prefs on the server (`getPrefs()` → `hourLabels` prop; default = DEFAULT_PREFS labels for tests), and a hint naming the summary time. Same form, same `SaveBar`, dirty tracking includes the hours. Switches for `nonfollower_spike`, `digest`, `weekly_digest` appear in the existing list; `unfollow_spike` is hidden while its rule is off.
- **Privacy:** push payloads stay `{ title, body, url, tag }`; alert payloads hold the owner's own account name, numbers and a day — never commenter names, comment text, follower names, tokens or endpoints (`rowToNotification` keeps an allow-list; a test drops an extra `name` field). Summary tags are `digest:all` / `weekly_digest:all` (a newer summary replaces the older one on the lock screen).
- **Errors:** the store throws fixed messages (`alert store: <op> failed`); a failing summary step is counted in `failed` and never stops the instant pushes.

## Open questions for the owner (the plan implements the default shown; L = needs a LIVE check, `docs/RUNBOOK_ALERTS.md` §8)

1. **⚠ SPEC §7c edit** (Task 3): add the smart-alerts paragraph. Default: yes (owner approved §0b).
2. **⚠ Digest-only kinds** = token expiring and auto-hide paused. Alternative: everything is "unusual" and only quiet hours hold pushes.
3. **⚠ Summary at the end of quiet hours** (no separate summary hour). Alternative: a separate `digestHour` (needs a rule for a summary hour inside quiet hours).
4. **⚠ Count unread only.** Alternative: count everything held, read or not.
5. **Weekly review on the week-start day** (Monday by default) linking to the 17d digest. Alternative: always Monday.
6. **L1 — the first real morning summary** arrives once at the first tick after 08:00 with the right count; nothing between 22:00 and 08:00 (RUNBOOK §8.2–8.3).
7. **L2 — non-follower spikes on real data:** how often does `nonfollower_spike` fire in the first two weeks? If it is noise, switch its push off or raise `NONFOLLOWER_MIN_REACH` (RUNBOOK §8.5). The SQL shape (`.in('day', …)` on a `date` column) is standard PostgREST but not exercised live.
8. **L3 — tick duration** unchanged (compare `sync_runs.summary.durationMs` of 3 ticks before and after deploying; RUNBOOK §8.6).
9. **L4 — lock-screen grouping:** a new summary replaces the previous day's (same tag); check on Android and iOS (RUNBOOK §8.4).

## Owner prerequisites

1. **Apply the migration `20261104000001_smart_alerts.sql`** (owner's explicit go-ahead; RUNBOOK_ALERTS §8.0) BEFORE deploying. Without it the four new kinds are refused by the database: the tick's batched alert insert then fails as a whole (`alerts.failed` +1, no alerts that tick) whenever a new kind is due — so the code must NOT be deployed before the migration. Quiet hours alone would work, but the batch insert couples them. (Runbook §8.0 says so.)
2. Order with other pending migrations: after 17b/17c/17d (if any); independent of them. `sb.mjs db push` applies in file order.

## Assumptions about the current code (`main` at `81054d7`, read for this plan)

- `lib/alerts/settings.ts:4` `ALERT_KINDS` (6 kinds, `moderation_paused` last), `:14` `DEFAULT_ALERT_SETTINGS`, `:22` `LIMITS` (`[min, max, decimals]`), `:30` `clampNum` (default on junk), `:40` `parseAlertSettings` (drops unknown keys).
- `lib/alerts/rules.ts:16` `AlertPayload { username, days?, runs?, pct?, ratio?, postId? }`, `:25` `Alert { kind, accountId: string, severity, dedupeKey, payload }`, `:33` `RuleInput` (with optional `moderationPausedAt`), `:92` `RULES`, `:95` `evaluateRules` (a throwing rule is skipped). Imports `localDay` from `lib/sync/time`.
- `lib/alerts/run.ts:13` `ALERT_BUDGET_MS = 10_000`, `:15` `DAILY_DAYS = 20`, `:51` per-account `Promise.all` of reads, `:59` `insertNew(found)`, `:61` `toPush = fresh.filter((a) => settings.push[a.kind])`, `:62` early return without push transport, `:64-75` push loop with deadline and 410 pruning. `runAlerts` never throws.
- `lib/alerts/store.ts:15` `AlertStore` (optional `moderationPausedAt` for fakes), `:63` `insertNew` = `upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('dedupe_key')`, `fail(op)` fixed messages, `isStr`.
- `lib/alerts/message.ts:14` `alertText(kind, payload, t, prefs)` (values: `username` clipped, `days`, `runs`, `pct`, `ratio` via `formatNumber`), `:26` `alertHref` (null account → `/overview`). `lib/alerts/push-message.ts:23` `pushMessage` → `{ title, body, url, tag: `${kind}:${accountId ?? 'all'}` }`, text in the profile language.
- `lib/alerts/read.ts:28` numeric payload allow-list loop; `:32` `postId`.
- `lib/sync/time.ts:18` `localHour`, `:23` `addDays`, `:28` private `offsetMs`, `:34` `dayStart` (two-pass DST conversion). `lib/format.ts:67` `formatHour(hour, prefs)` ("08:00" in 24 h), `:77` `formatDay('YYYY-MM-DD', prefs)` (dash for junk). `lib/prefs.ts` `WeekStart = 'mon' | 'sun'`, `Prefs.weekStart`; `lib/prefs.server.ts` `getPrefs()` (cookie).
- `lib/analysis/trend.ts:10` `ANOMALY = { weeks: 8, minSamples: 4, threshold: 3.5, minAbs: 3, minRel: 0.1 }`, `:46` `weekdayAnomaly(series, day)` → `Anomaly | { reason: 'few_samples' } | null`.
- `lib/sync/tick.ts:68` `tz = store.ownerTimezone()`, `:164` `runAlerts(..., { now: new Date(clock()), tz, deadline: deadline + ALERT_BUDGET_MS, ... })` — unchanged by this plan. Route `app/api/cron/tick/route.ts:13` `maxDuration = 60`.
- `supabase/migrations/20261018000001_alerts.sql`: `notifications` (`dedupe_key text not null unique`, ≤ 200 chars, `account_id` nullable FK cascade, `notifications_unread_idx (created_at desc) where read_at is null`; owner `select`, owner `update (read_at)` only; inserts only by the service role). `20261029000002_comment_moderation.sql:99-101` drops and re-adds `notifications_kind_check` (6 kinds). `20261031000001_data_privacy.sql:79` `delete from public.notifications where true` in `delete_all_data()`.
- `components/settings/AlertSettingsForm.tsx` (client; `ALERT_KINDS` switch list, `NUMBERS` inputs, `SaveBar`, `numsOf`); `components/settings/sections/NotificationsSection.tsx:11-23` (server; `parseAlertSettings` of the profile row). `components/settings/sections/LanguageSection.tsx:19` native select class `h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground`.
- `public/sw.js:81` `TAB_PAGE` (17d adds `plan`); `notificationclick` opens `safePath(data.url)` — same-origin paths only. No change here.
- Tests that pin current behaviour and are edited by this plan: `tests/alert-run.test.ts:7,16` (T0 = 02:00 UTC with `tz: 'UTC'`: 02:00 is inside the new default quiet hours → switched to Kuala Lumpur, 10:00 local), `tests/alert-settings.test.ts:9,13-14` (exact default objects and key list), `tests/alerts-moderation.test.ts:31` (`ALERT_KINDS.at(-1)`), `tests/alert-store.test.ts:20` (recorder lacks `lt`), `tests/fixtures/alert-fakes.ts` (the only `AlertStore` fake). `tests/sync-tick-alerts.test.ts` uses the fake store timezone `Asia/Kuala_Lumpur` (02:00 UTC = 10:00) and stays green unchanged.
- `tests/messages.test.ts`: placeholder regex `\{(\w+)[,}]` — plural branches must not start with a single word followed by `}` (the plural texts below start with `#` or a sentence).

## Out of scope

A separate summary hour; per-account or per-device quiet hours; snoozing an alert; email digests (roadmap Q3); digest content beyond a count (the 17d page shows it); a "pushed_at" column or retrying failed pushes; changing `FOLLOW_TYPE` or enabling the unfollow rule; any change to `lib/sync/tick.ts`, `public/sw.js` or the bell UI; any Meta or Claude call.

## Global Constraints

- Ponytail: no new dependency, no new table, no new column, one migration (a check constraint). Reuse `weekdayAnomaly`, `localDay` / `localHour` / `addDays`, `insertNew` dedupe, `sendToAll`, `pushMessage`, `formatHour`, `formatDay`, `FormField`, `SaveBar`.
- TypeScript strict. Errors never carry Supabase messages; **no `console.*` in any new or changed file**; no third-party data in any payload, push or log.
- Every UI string via next-intl; ALL keys added by Task 1 in BOTH catalogs (real Simplified Chinese, full-width punctuation).
- Tests: Vitest; lib tests may use `// @vitest-environment node`; fakes only; never connect to Supabase. The migration file is NEVER applied by an implementer.
- `npm run check` passes after every wave. Commits: conventional, `git add` the listed paths only, last line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (`git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`). Don't push.

## Review Focus (opus review after the last wave)

1. **Dedupe:** summaries only through `insertNew` (unique `dedupe_key`), pushed only when returned fresh; `summaryToPush` picks ONE; 48-tick and overlapping-tick tests; a failing summary step never blocks instant pushes and never double-sends on the next tick.
2. **Quiet-hours maths:** `isQuiet` (window across midnight, inside a day, equal hours), `digestDue` (due from `quietTo` until quiet starts, window chaining on DST days), `localTime` (gap hour resolves forward; `dayStart` unchanged: `tests/sync-time.test.ts` green), `heldCount` (unread + switch on + digest-only or quiet; summaries and unknown kinds never counted).
3. **Tick budget:** no change to `tick.ts`; one extra read per account inside the existing `Promise.all`; the summary step checks `c.clock() < c.deadline`; `DAILY_DAYS` 60 rows; no unbounded reads (both new reads `limit(1000)`, by days / by window).
4. **Spike rules:** upward only, today never checked, small days guarded, `few_samples` → nothing, keys per day; unfollow rule truly off (`UNFOLLOW_SPIKE_ENABLED = false`, switch hidden) and the enabled path tested.
5. **Push text:** in the profile language (`pushMessage` unchanged), numbers/dates via `lib/format`, plural counts in both languages, no `undefined` / `NaN` / `{`.
6. **Privacy:** payload allow-list (`rowToNotification`), summary payload `{ username: '', count }`, tags without account ids for summaries, no logging.
7. **Migration:** only the constraint; kind list equals `ALERT_KINDS` (guard in `tests/alert-settings.test.ts`); RLS untouched; NOT applied; the code must not deploy before it (batched insert).
8. **UI:** one control height per row (native selects `h-[var(--ctl)]`), labels/hint, dirty tracking includes the hours, 360 / 768 / 1280 px, the unfollow switch hidden.
9. **17d link:** `WEEKLY_REVIEW_HREF` matches the real 17d route when 17d exists (guard test).

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `messages/en.json`, `messages/zh-CN.json` | 1 | `notifications.kinds.{nonfollower_spike,unfollow_spike,digest,weekly_digest}`, `settings.notifications.{quietTitle,quietFrom,quietTo,quietHint}` |
| `supabase/migrations/20261104000001_smart_alerts.sql` (new), `tests/smart-alerts-migration.test.ts` (new) | 2 | kind check; static SQL test |
| `docs/SPEC.md`, `docs/RUNBOOK_ALERTS.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 3 | docs |
| `lib/alerts/settings.ts`, `lib/sync/time.ts`, `lib/alerts/rules.ts`, `lib/alerts/quiet.ts` (new), `lib/alerts/message.ts`, `lib/alerts/read.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts`, `tests/alert-quiet.test.ts` (new), `tests/alert-spikes.test.ts` (new), `tests/alert-message-smart.test.ts` (new) | 4 | pure policy, settings, spike rules, texts, links |
| `lib/alerts/store.ts`, `lib/alerts/run.ts`, `tests/fixtures/alert-fakes.ts`, `tests/alert-run.test.ts`, `tests/alert-store.test.ts`, `tests/alert-run-smart.test.ts` (new) | 5 | reads + the runner |
| `components/settings/AlertSettingsForm.tsx`, `components/settings/sections/NotificationsSection.tsx`, `tests/settings-quiet-hours.test.tsx` (new) | 6 | Settings UI |

**Adding i18n keys:** by TEXT INSERTION only (Edit tool: replace the exact anchor line with the block shown), never by re-serialising the JSON. Both locales get the same keys.

**Editing existing files:** exact old → new text for the Edit tool (or a full replacement where the task says "replace the whole file"). Working copies are CRLF (`core.autocrlf=true`); the Edit tool matches either; do not convert line endings. New files: Write tool.

## Tasks, dependencies and waves

| Task | Depends on | Files it owns | Parallel with |
|---|---|---|---|
| 1 i18n | — | `messages/en.json`, `messages/zh-CN.json` | 2, 3 |
| 2 migration | — | `supabase/migrations/20261104000001_smart_alerts.sql`, `tests/smart-alerts-migration.test.ts` | 1, 3 |
| 3 docs | — | `docs/SPEC.md`, `docs/RUNBOOK_ALERTS.md`, `docs/TODO.md`, `docs/PROGRESS.md` | 1, 2 |
| 4 policy + rules + texts | 1, 2 | `lib/alerts/{settings,rules,quiet,message,read}.ts`, `lib/sync/time.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts`, `tests/alert-quiet.test.ts`, `tests/alert-spikes.test.ts`, `tests/alert-message-smart.test.ts` | — (alone) |
| 5 store + runner | 4 | `lib/alerts/store.ts`, `lib/alerts/run.ts`, `tests/fixtures/alert-fakes.ts`, `tests/alert-run.test.ts`, `tests/alert-store.test.ts`, `tests/alert-run-smart.test.ts` | 6 |
| 6 Settings UI | 1, 4 | `components/settings/AlertSettingsForm.tsx`, `components/settings/sections/NotificationsSection.tsx`, `tests/settings-quiet-hours.test.tsx` | 5 |

**Waves (at most 3 sonnet worktree agents at a time; check free disk first, `Get-PSDrive C`):** 1 = Tasks 1, 2, 3 → 2 = Task 4 → 3 = Tasks 5, 6. After each wave: cherry-pick, remove ALL worktrees, `rm -rf .next`, `npm run check > log` and READ it. Every wave leaves `main` green: wave 1 adds unused keys, an unapplied migration and docs; wave 2 adds the kinds, settings, rules and texts while the runner still pushes as before (no quiet hours yet; the spike rule gets no data until wave 3; the new switches show in Settings); wave 3 wires the runner and the form. Then an opus read-only review (Review Focus), ONE fix wave, check, commit (orchestrator).

---

### Task 1: i18n keys (en + zh-CN)

**Files:** Modify `messages/en.json`, `messages/zh-CN.json`. No other file.

- [ ] **Step 1 — en, alert kinds.** Replace the exact line (inside `notifications.kinds.moderation_paused`)

```json
        "body": "Auto-hide for @{username} is paused because Instagram refused to hide a comment. Open Moderation to see why and switch it on again."
```

with

```json
        "body": "Auto-hide for @{username} is paused because Instagram refused to hide a comment. Open Moderation to see why and switch it on again."
      },
      "nonfollower_spike": {
        "title": "Unusual reach from non-followers",
        "body": "@{username}: {pct}% of the reach on {day} came from people who don't follow you, well above the usual {usual}% for that weekday."
      },
      "unfollow_spike": {
        "title": "Unusual number of unfollows",
        "body": "@{username}: {count} unfollows on {day}, against about {usual} on that weekday usually."
      },
      "digest": {
        "title": "Morning summary",
        "body": "{count, plural, one {# alert is} other {# alerts are}} waiting under the bell."
      },
      "weekly_digest": {
        "title": "Weekly review",
        "body": "{count, plural, =0 {Time to look back at last week.} one {Time to look back at last week. # alert is also waiting under the bell.} other {Time to look back at last week. # alerts are also waiting under the bell.}}"
```

(The existing `      }` on the next line now closes `weekly_digest`.)

- [ ] **Step 2 — en, Settings.** Replace the exact line (inside `settings.notifications`)

```json
      "syncFailuresHint": "Alert after this many consecutive failed sync runs (1–10).",
```

with

```json
      "syncFailuresHint": "Alert after this many consecutive failed sync runs (1–10).",
      "quietTitle": "Quiet hours",
      "quietFrom": "From",
      "quietTo": "Until",
      "quietHint": "No push notifications between these hours (your timezone). Alerts from that time, and the less urgent ones, arrive as one summary at {time}. The same hour twice means no quiet hours.",
```

- [ ] **Step 3 — zh-CN, alert kinds.** Replace the exact line

```json
        "body": "Instagram 拒绝隐藏评论，@{username} 的自动隐藏已暂停。打开“评论管理”查看原因并重新开启。"
```

with

```json
        "body": "Instagram 拒绝隐藏评论，@{username} 的自动隐藏已暂停。打开“评论管理”查看原因并重新开启。"
      },
      "nonfollower_spike": {
        "title": "非粉丝触达异常",
        "body": "@{username}：{day} 的触达中有 {pct}% 来自未关注你的人，明显高于该星期几通常的 {usual}%。"
      },
      "unfollow_spike": {
        "title": "取关数异常",
        "body": "@{username}：{day} 有 {count} 次取关，而该星期几通常约为 {usual} 次。"
      },
      "digest": {
        "title": "早间摘要",
        "body": "{count, plural, other {铃铛下有 # 条提醒等你查看。}}"
      },
      "weekly_digest": {
        "title": "每周回顾",
        "body": "{count, plural, =0 {来回顾一下上周的表现吧。} other {来回顾一下上周的表现吧。铃铛下还有 # 条提醒等你查看。}}"
```

- [ ] **Step 4 — zh-CN, Settings.** Replace the exact line

```json
      "syncFailuresHint": "连续这么多次同步失败后提醒（1–10）。",
```

with

```json
      "syncFailuresHint": "连续这么多次同步失败后提醒（1–10）。",
      "quietTitle": "免打扰时段",
      "quietFrom": "开始",
      "quietTo": "结束",
      "quietHint": "这段时间内（按你的时区）不发送推送通知。这段时间的提醒以及不紧急的提醒，会在 {time} 合并为一条摘要发送。两个时间相同表示不设免打扰时段。",
```

- [ ] **Step 5 — verify.** `npx vitest run tests/messages.test.ts tests/alert-message.test.ts` → PASS. `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'));JSON.parse(require('fs').readFileSync('messages/zh-CN.json','utf8'))"` → no error.
- [ ] **Step 6 — commit.** `git add messages/en.json messages/zh-CN.json` → `git commit -m "feat(i18n): strings for smart alerts, quiet hours and the summaries (Plan 17e)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 2: migration + its test (NEVER applied)

**Files:** Create `supabase/migrations/20261104000001_smart_alerts.sql`, `tests/smart-alerts-migration.test.ts`.

- [ ] **Step 1 — failing test.** Write `tests/smart-alerts-migration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261104000001_smart_alerts.sql'), 'utf8').replace(/--.*$/gm, '');

describe('smart alerts migration (Plan 17e)', () => {
  it('only replaces the notifications kind check: no table, policy, grant, function or data change', () => {
    const heads = sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/).slice(0, 4).join(' ').toLowerCase());
    expect(heads).toEqual(['alter table public.notifications drop', 'alter table public.notifications add']);
    expect(sql).not.toMatch(/\b(create|grant|revoke|policy|insert|update|delete|truncate|security\s+definer)\b/i);
  });

  it('the six existing kinds plus the four of Plan 17e, in this order (tests/alert-settings.test.ts keeps ALERT_KINDS equal to it)', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.notifications\s+drop\s+constraint\s+notifications_kind_check/i);
    const list = sql.match(/add\s+constraint\s+notifications_kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)/i)?.[1] ?? '';
    expect(list.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest']);
  });
});
```

- [ ] **Step 2 — run, see it fail** (`ENOENT … 20261104000001_smart_alerts.sql`): `npx vitest run tests/smart-alerts-migration.test.ts`.
- [ ] **Step 3 — the migration.** Write `supabase/migrations/20261104000001_smart_alerts.sql`:

```sql
-- Plan 17e: smart alerts (SPEC §7c). Four new notification kinds; nothing else changes. Quiet hours and the summary
-- switches live in profiles.alert_settings (jsonb, parsed by lib/alerts/settings.ts), so they need no column. The two
-- summaries reuse the unique dedupe_key ('digest:<day>', 'weekly_digest:<day>'): a retried or overlapping tick can never
-- store or push one twice. No new table, policy or grant: notifications keeps its RLS (owner select, read_at update).
-- The kind list must equal ALERT_KINDS in lib/alerts/settings.ts (tests/alert-settings.test.ts).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest'));
```

- [ ] **Step 4 — verify.** `npx vitest run tests/smart-alerts-migration.test.ts tests/migrations.test.ts tests/moderation-migration.test.ts tests/alerts-migration.test.ts` → PASS. Do NOT run any `supabase` / `db push` command.
- [ ] **Step 5 — commit.** `git add supabase/migrations/20261104000001_smart_alerts.sql tests/smart-alerts-migration.test.ts` → `git commit -m "feat(db): notification kinds for spikes and the morning and weekly summaries (Plan 17e, not applied)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 3: docs (SPEC, runbook, TODO, PROGRESS)

**Files:** Modify `docs/SPEC.md`, `docs/RUNBOOK_ALERTS.md`, `docs/TODO.md`, `docs/PROGRESS.md`. Docs are CRLF; use the Edit tool.

- [ ] **Step 1 — `docs/SPEC.md` §7c (⚠ owner's nod).** Replace the exact text `**Remove account = archive.** Status → ` (start of a line in §7c) with:

```
**Smart alerts (Plan 17e; creator-toolkit design §0b "Alerts policy").** Status: code done, NOT verified live (`docs/RUNBOOK_ALERTS.md` §8); migration `20261104000001_smart_alerts` (four notification kinds) NOT applied: apply it before deploying. Every alert still appears in the bell at once. A push goes out at once only for an unusual event (reconnect needed, sync failing, reach drop, post taking off, non-follower spike, unfollow spike) and never during **quiet hours** (Settings → Notifications; default 22:00–08:00 in the owner's timezone; the same hour twice = none). Token-expiring and auto-hide-paused alerts are never pushed on their own. At the end of quiet hours ONE **morning summary** push counts the still-unread alerts of the last 24 hours that were not pushed (key `digest:<day>`); on the first day of the owner's week it is the **weekly review** push instead (key `weekly_digest:<day>`, same count), linking to the digest page (Plan 17d; the Overview until it exists). Both are switches in the push list (on by default) and need push to be set up. **Non-follower spike:** yesterday's or the day before's share of reach from non-followers vs the same weekday of the 8 weeks before (robust z ≥ 3.5, at least 4 weeks, at least 50 people reached), upward only, once per day. **Unfollow spike:** the same on daily unfollows, OFF in code (`UNFOLLOW_SPIKE_ENABLED`) until `docs/RUNBOOK_GROWTH.md` §2 verified the follows/unfollows mapping. All of it runs inside the tick's 10-second alert window; nothing is sent twice (unique dedupe keys).

**Remove account = archive.** Status → 
```

  (The last line keeps the original sentence start; the Edit tool's `old_string` is exactly `**Remove account = archive.** Status → ` and `new_string` is the block above, which ends with that same text.)

- [ ] **Step 2 — `docs/RUNBOOK_ALERTS.md`.** Replace the exact line `## What to send me if it fails` with:

```
## 8. Smart alerts: quiet hours, morning summary, weekly review, spikes (Plan 17e)

Status: code done, NOT verified live. The timing maths was dry-run with fakes (48 ticks of a day, DST days in Europe/Berlin) and the SQL on PGlite (plan `docs/superpowers/plans/2026-11-01-17e-smart-alerts.md`, "Scratch-run result").

### 8.0 Migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261104000001_smart_alerts.sql` only replaces the `notifications_kind_check` constraint (adds `nonfollower_spike`, `unfollow_spike`, `digest`, `weekly_digest`). Do NOT deploy the 17e code first: the tick stores a tick's alerts in one batch, and a new kind refused by the old constraint would drop that whole batch (`alerts.failed` +1).
```
node --env-file=.env.local scripts/sb.mjs migration list        # only 20261104000001 pending (plus any earlier pending file)
node --env-file=.env.local scripts/sb.mjs db push --dry-run
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched
```
Check in the SQL editor (read only): `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_kind_check';` lists ten kinds.

### 8.1 Settings
1. Settings → Notifications → Alerts: "Quiet hours" From 22:00, Until 08:00 (in your time format); the hint names 08:00. New switches "Unusual reach from non-followers", "Morning summary", "Weekly review" (all on); no "unfollows" switch.
2. Change Until to 07:00 → the hint says 07:00 → Save → reload: kept. Put it back (08:00), Save. 360 / 768 / 1280 px, light and dark.

### 8.2 Nothing at night (L1)
1. Leave a phone with notifications enabled overnight. Next morning: `sync_runs` rows between 22:00 and 08:00 may show `alerts.created` > 0 but `alerts.pushed` 0.
2. Quick test instead of waiting: set quiet hours to cover the current hour, Save, then Accounts → Sync now on an account with an alert due (e.g. "Post taking off" switched on at 1.5×, RUNBOOK §4): the bell gets it, no push.

### 8.3 The morning summary (L1)
1. The first tick after 08:00: ONE push "Morning summary — N alerts are waiting under the bell." (N = unread alerts held overnight + token/auto-hide alerts of the last 24 h). Tapping it opens the Overview. The bell has a "Morning summary" item.
2. `notifications`: one row with `dedupe_key = 'digest:<today>'`; later ticks add none (`select count(*) from notifications where kind = 'digest' and created_at > now() - interval '1 day'` = 1).
3. Read every alert in the bell before 08:00 on another night: no summary that morning (only unread ones count).

### 8.4 The weekly review and lock-screen grouping (L4)
1. On your week's first day (Settings → Language & formats → week start), the morning push is "Weekly review" (with the held count if any) and opens the Overview until Plan 17d is built, then the digest page.
2. A new summary replaces yesterday's on the lock screen (same tag) on Android and iPhone.

### 8.5 Non-follower spikes (L2)
1. Over the first two weeks, count `nonfollower_spike` rows. If they feel like noise, switch their push off (they stay in the bell) and tell the assistant (the guard is `NONFOLLOWER_MIN_REACH` = 50 in `lib/alerts/rules.ts`).
2. Unfollow spikes stay off until `docs/RUNBOOK_GROWTH.md` §2 passed; then flip `UNFOLLOW_SPIKE_ENABLED` in `lib/alerts/settings.ts` in a reviewed commit.

### 8.6 Tick duration (L3)
Compare `sync_runs.summary.durationMs` of three ticks before and after deploying: no visible change (one extra small read per account, one per tick).

## What to send me if it fails
```

- [ ] **Step 3 — `docs/TODO.md`.** Insert immediately BEFORE the line `## 6b. Next (Plan 14/15 Settings)` (letter: `6v`, or the next free letter if 17a–17d used it):

```
## 6v. Smart alerts (Plan 17e)
- [x] Quiet hours (default 22:00–08:00), one morning summary push, the weekly review push on the week's first day, non-follower spike alert, unfollow spike rule (OFF until the follows mapping is verified) (code done; live verification pending: docs/RUNBOOK_ALERTS.md §8)
- [ ] Apply migration `20261104000001_smart_alerts` (owner's go-ahead, BEFORE deploying the 17e code)
- [ ] RUNBOOK_ALERTS §8 walked through by the owner; live checks L1 (morning summary once, nothing at night), L2 (spike noise), L3 (tick duration), L4 (lock-screen grouping) (plan 2026-11-01-17e)
- [ ] After RUNBOOK_GROWTH §2 passes: switch on the unfollow-spike rule (`UNFOLLOW_SPIKE_ENABLED`)
- [ ] When Plan 17d is built: `WEEKLY_REVIEW_HREF` points to the digest page (a guard test fails until then)
- Known: a push that fails is not retried (the summary row exists); the summary is a count, not a list; no separate summary hour.

```

- [ ] **Step 4 — `docs/PROGRESS.md`.** (a) §3: insert immediately BEFORE the line starting `Account page tabs now:` (after any 17a–17d bullets already there) the bullet `- **17e: Smart alerts (code done, NOT verified live; migration 20261104000001 NOT applied).** Quiet hours (default 22:00–08:00, owner timezone), instant pushes only for unusual events and never at night, ONE morning summary push of what was held, the weekly review push on the week's first day (links to the 17d digest page once it exists), non-follower spike alert, unfollow spike rule OFF until RUNBOOK_GROWTH §2. Plan: docs/superpowers/plans/2026-11-01-17e-smart-alerts.md. Runbook: docs/RUNBOOK_ALERTS.md §8.` followed by an empty line. (b) §5 table: add after the last row the row `| 20261104000001_smart_alerts | notifications kind check gains nonfollower_spike, unfollow_spike, digest, weekly_digest (Plan 17e; **NOT applied**: owner go-ahead, apply BEFORE deploying; RUNBOOK_ALERTS §8.0) |`. (c) §6: append after the last numbered item the next number: `**docs/RUNBOOK_ALERTS.md §8** (Plan 17e): §8.0 migration, then §8.1–§8.6.` (d) §8: append after the last bullet `- 17e: summary at the end of quiet hours (no separate hour), token-expiring and auto-hide-paused are digest-only, the summary counts unread alerts only, the summaries are push switches (no separate weekly setting), the weekly review follows the week-start setting, unfollow spikes off in code.`
- [ ] **Step 5 — commit.** `git add docs/SPEC.md docs/RUNBOOK_ALERTS.md docs/TODO.md docs/PROGRESS.md` → `git commit -m "docs: smart alerts spec, runbook, todo and progress (Plan 17e)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 4: the policy, settings, spike rules and texts (TDD)

**Files:** Modify `lib/alerts/settings.ts` (replace the whole file), `lib/sync/time.ts`, `lib/alerts/rules.ts`, `lib/alerts/message.ts`, `lib/alerts/read.ts`, `tests/alert-settings.test.ts`, `tests/alerts-moderation.test.ts`; create `lib/alerts/quiet.ts`, `tests/alert-quiet.test.ts`, `tests/alert-spikes.test.ts`, `tests/alert-message-smart.test.ts`. Needs Tasks 1 and 2 merged (texts; the migration's kind list).

- [ ] **Step 1 — failing tests: settings.** In `tests/alert-settings.test.ts`:

  (a) replace the exact line

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
```

  with

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALERT_KINDS, DEFAULT_ALERT_SETTINGS, parseAlertSettings, UNFOLLOW_SPIKE_ENABLED } from '@/lib/alerts/settings';
```

  (b) replace the exact line

```ts
    expect(DEFAULT_ALERT_SETTINGS.push).toEqual({ token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true });
```

  with

```ts
    expect(DEFAULT_ALERT_SETTINGS.push).toEqual({ token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true, nonfollower_spike: true, unfollow_spike: true, digest: true, weekly_digest: true });
    expect(DEFAULT_ALERT_SETTINGS).toMatchObject({ quietFrom: 22, quietTo: 8 });
```

  (c) replace the exact two lines

```ts
    expect(s).toEqual({ push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: false, taking_off: true, moderation_paused: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4 });
    expect(Object.keys(s).sort()).toEqual(['push', 'reachDropPct', 'syncFailures', 'takingOffRatio']);
```

  with

```ts
    expect(s).toEqual({ push: { ...DEFAULT_ALERT_SETTINGS.push, reach_drop: false, taking_off: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4, quietFrom: 22, quietTo: 8 });
    expect(Object.keys(s).sort()).toEqual(['push', 'quietFrom', 'quietTo', 'reachDropPct', 'syncFailures', 'takingOffRatio']);
```

  (d) replace the exact two lines

```ts
    expect(parseAlertSettings({ reachDropPct: NaN, takingOffRatio: '', syncFailures: null })).toMatchObject({ reachDropPct: 20, takingOffRatio: 2, syncFailures: 2 });
  });
```

  with

```ts
    expect(parseAlertSettings({ reachDropPct: NaN, takingOffRatio: '', syncFailures: null })).toMatchObject({ reachDropPct: 20, takingOffRatio: 2, syncFailures: 2 });
  });

  it('quiet hours (Plan 17e): whole hours 0-23, clamped and rounded; junk falls back to 22 and 8; equal hours are kept (= off)', () => {
    expect(parseAlertSettings({ quietFrom: 23, quietTo: 0 })).toMatchObject({ quietFrom: 23, quietTo: 0 });
    expect(parseAlertSettings({ quietFrom: -1, quietTo: 24 })).toMatchObject({ quietFrom: 0, quietTo: 23 });
    expect(parseAlertSettings({ quietFrom: 21.6, quietTo: '7' })).toMatchObject({ quietFrom: 22, quietTo: 7 });
    expect(parseAlertSettings({ quietFrom: 'x', quietTo: null })).toMatchObject({ quietFrom: 22, quietTo: 8 });
    expect(parseAlertSettings({ quietFrom: 9, quietTo: 9 })).toMatchObject({ quietFrom: 9, quietTo: 9 });
  });

  it('the four Plan 17e kinds have toggles, all on by default; the unfollow-spike rule itself stays off', () => {
    expect(parseAlertSettings({ push: { digest: false, weekly_digest: 'no' } }).push).toMatchObject({ digest: false, weekly_digest: true, nonfollower_spike: true, unfollow_spike: true });
    expect(UNFOLLOW_SPIKE_ENABLED).toBe(false);
  });

  it('ALERT_KINDS equals the kind list of the newest migration that sets notifications_kind_check (code and database agree)', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const lists = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '').match(/notifications_kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i)?.[1]).filter((l): l is string => l !== undefined);
    expect(lists.at(-1)?.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([...ALERT_KINDS]);
  });
```

  In `tests/alerts-moderation.test.ts` replace the exact line `    expect(ALERT_KINDS.at(-1)).toBe('moderation_paused');` with `    expect(ALERT_KINDS).toContain('moderation_paused');`.

- [ ] **Step 2 — failing tests: the policy.** Write `tests/alert-quiet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { digestDue, heldCount, isQuiet, isWeekStart, pushNow, summaryAlerts, summaryToPush } from '@/lib/alerts/quiet';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts/settings';
import { localTime } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const BERLIN = 'Europe/Berlin'; // 2026-03-29 02:00 -> 03:00 (23-hour day), 2026-10-25 03:00 -> 02:00 (25-hour day)
const S: AlertSettings = DEFAULT_ALERT_SETTINGS; // quiet 22:00-08:00
const at = (iso: string) => new Date(iso);
const quiet = (from: number, to: number): AlertSettings => ({ ...S, quietFrom: from, quietTo: to });

describe('isQuiet', () => {
  it('22:00-08:00 crosses midnight: 22:00 and 07:59 are quiet, 08:00 and 21:59 are not (owner timezone)', () => {
    expect(isQuiet(at('2026-10-14T14:00:00Z'), S, KL)).toBe(true); // 22:00 KL
    expect(isQuiet(at('2026-10-13T23:59:00Z'), S, KL)).toBe(true); // 07:59 KL
    expect(isQuiet(at('2026-10-14T00:00:00Z'), S, KL)).toBe(false); // 08:00 KL
    expect(isQuiet(at('2026-10-14T13:59:00Z'), S, KL)).toBe(false); // 21:59 KL
    expect(isQuiet(at('2026-10-14T00:00:00Z'), S, 'UTC')).toBe(true); // the same instant is 00:00 in UTC
  });

  it('a window inside one day (01:00-06:00) and equal hours (= no quiet hours)', () => {
    expect(isQuiet(at('2026-10-13T17:00:00Z'), quiet(1, 6), KL)).toBe(true); // 01:00
    expect(isQuiet(at('2026-10-13T22:00:00Z'), quiet(1, 6), KL)).toBe(false); // 06:00
    expect(isQuiet(at('2026-10-13T16:30:00Z'), quiet(1, 6), KL)).toBe(false); // 00:30
    for (const h of [0, 7, 9, 23]) expect(isQuiet(at(`2026-10-14T${String(h).padStart(2, '0')}:00:00Z`), quiet(9, 9), 'UTC')).toBe(false);
  });

  it('DST: the wall clock decides, not UTC offsets (Berlin, both switch days)', () => {
    expect(isQuiet(at('2026-03-29T05:59:00Z'), S, BERLIN)).toBe(true); // 07:59 CEST
    expect(isQuiet(at('2026-03-29T06:00:00Z'), S, BERLIN)).toBe(false); // 08:00 CEST
    expect(isQuiet(at('2026-10-25T06:59:00Z'), S, BERLIN)).toBe(true); // 07:59 CET
    expect(isQuiet(at('2026-10-25T07:00:00Z'), S, BERLIN)).toBe(false); // 08:00 CET
  });
});

describe('pushNow', () => {
  const day = at('2026-10-14T04:00:00Z'); // 12:00 KL
  const night = at('2026-10-14T16:00:00Z'); // 00:00 KL
  it('unusual events go out at once outside quiet hours, never inside', () => {
    for (const k of ['needs_reconnect', 'sync_failing', 'reach_drop', 'nonfollower_spike', 'unfollow_spike'] as const) {
      expect(pushNow(k, S, day, KL), k).toBe(true);
      expect(pushNow(k, S, night, KL), k).toBe(false);
    }
  });
  it('digest-only kinds, the summaries and switched-off kinds are never pushed on their own', () => {
    for (const k of ['token_expiring', 'moderation_paused', 'digest', 'weekly_digest', 'taking_off'] as const) expect(pushNow(k, S, day, KL), k).toBe(false);
    expect(pushNow('taking_off', { ...S, push: { ...S.push, taking_off: true } }, day, KL)).toBe(true);
  });
});

describe('digestDue', () => {
  it('not during quiet hours; from quietTo on, with the window [yesterday quietTo, today quietTo)', () => {
    expect(digestDue(at('2026-10-13T23:30:00Z'), S, KL)).toBeNull(); // 07:30 KL
    expect(digestDue(at('2026-10-14T00:00:00Z'), S, KL)).toEqual({ day: '2026-10-14', fromIso: '2026-10-13T00:00:00.000Z', toIso: '2026-10-14T00:00:00.000Z' });
    expect(digestDue(at('2026-10-14T13:30:00Z'), S, KL)?.day).toBe('2026-10-14'); // 21:30 KL, the same day's window
    expect(digestDue(at('2026-10-14T14:00:00Z'), S, KL)).toBeNull(); // 22:00 KL
  });

  it('quiet hours inside one day (01-06): due from 06:00 to midnight, not between midnight and 01:00', () => {
    expect(digestDue(at('2026-10-13T16:30:00Z'), quiet(1, 6), KL)).toBeNull(); // 00:30
    expect(digestDue(at('2026-10-13T22:00:00Z'), quiet(1, 6), KL)?.day).toBe('2026-10-14'); // 06:00
  });

  it('no quiet hours (9 = 9): the summary of the less urgent kinds is due from 09:00', () => {
    expect(digestDue(at('2026-10-14T00:30:00Z'), quiet(9, 9), KL)).toBeNull(); // 08:30
    expect(digestDue(at('2026-10-14T01:00:00Z'), quiet(9, 9), KL)?.fromIso).toBe('2026-10-13T01:00:00.000Z');
  });

  it('DST: the window is 23 hours on the spring day and 25 on the autumn day, and windows chain without a gap', () => {
    const spring = digestDue(at('2026-03-29T06:30:00Z'), S, BERLIN)!;
    expect(spring).toEqual({ day: '2026-03-29', fromIso: '2026-03-28T07:00:00.000Z', toIso: '2026-03-29T06:00:00.000Z' });
    const autumn = digestDue(at('2026-10-25T07:30:00Z'), S, BERLIN)!;
    expect(autumn).toEqual({ day: '2026-10-25', fromIso: '2026-10-24T06:00:00.000Z', toIso: '2026-10-25T07:00:00.000Z' });
    expect(digestDue(at('2026-10-26T07:30:00Z'), S, BERLIN)!.fromIso).toBe(autumn.toIso);
  });
});

describe('heldCount', () => {
  const rows = [
    { kind: 'needs_reconnect', createdAt: '2026-10-13T18:00:00.000Z' }, // 02:00 KL: held by quiet hours
    { kind: 'reach_drop', createdAt: '2026-10-13T05:00:00+00:00' }, // 13:00 KL: was pushed at once
    { kind: 'token_expiring', createdAt: '2026-10-13T05:00:00.000Z' }, // digest-only: always held
    { kind: 'taking_off', createdAt: '2026-10-13T18:00:00.000Z' }, // push switched off: not in any push
    { kind: 'digest', createdAt: '2026-10-13T18:00:00.000Z' }, // a summary never counts
    { kind: 'something_old', createdAt: '2026-10-13T18:00:00.000Z' }, // unknown kind
  ];
  it('counts what was not pushed at once and has its push switched on', () => {
    expect(heldCount(rows, S, KL)).toBe(2);
    expect(heldCount(rows, { ...S, push: { ...S.push, taking_off: true } }, KL)).toBe(3);
    expect(heldCount(rows, quiet(9, 9), KL)).toBe(1); // no quiet hours: only the digest-only kind
    expect(heldCount([], S, KL)).toBe(0);
  });
});

describe('summaryAlerts', () => {
  it('a morning summary only when something was held; key digest:<day>; no account, no third-party data', () => {
    expect(summaryAlerts('2026-10-14', S, 'mon', 0)).toEqual([]);
    expect(summaryAlerts('2026-10-14', S, 'mon', 3)).toEqual([{ kind: 'digest', accountId: null, severity: 'info', dedupeKey: 'digest:2026-10-14', payload: { username: '', count: 3 } }]);
    expect(summaryAlerts('2026-10-14', { ...S, push: { ...S.push, digest: false } }, 'mon', 3)).toEqual([]);
  });

  it("the week's first day also gets the weekly review, carrying the held count; one summary is pushed", () => {
    const monday = summaryAlerts('2026-10-19', S, 'mon', 2);
    expect(monday.map((a) => a.dedupeKey)).toEqual(['digest:2026-10-19', 'weekly_digest:2026-10-19']);
    expect(monday[1].payload).toEqual({ username: '', count: 2 });
    expect(summaryToPush(monday)?.kind).toBe('weekly_digest');
    expect(summaryAlerts('2026-10-19', S, 'mon', 0).map((a) => a.kind)).toEqual(['weekly_digest']);
    expect(summaryAlerts('2026-10-18', S, 'sun', 0).map((a) => a.kind)).toEqual(['weekly_digest']);
    expect(summaryAlerts('2026-10-19', S, 'sun', 0)).toEqual([]);
    expect(summaryAlerts('2026-10-19', { ...S, push: { ...S.push, weekly_digest: false } }, 'mon', 2).map((a) => a.kind)).toEqual(['digest']);
    expect(summaryAlerts('2026-10-19', { ...S, push: { ...S.push, digest: false } }, 'mon', 2)[0].payload.count).toBe(0);
    expect(summaryToPush([])).toBeUndefined();
  });

  it('isWeekStart follows the week-start setting', () => {
    expect(isWeekStart('2026-10-19', 'mon')).toBe(true);
    expect(isWeekStart('2026-10-18', 'sun')).toBe(true);
    expect(isWeekStart('2026-10-14', 'mon')).toBe(false);
  });
});

describe('localTime (lib/sync/time)', () => {
  it('a wall-clock hour as an instant; a skipped hour resolves to just after the gap; dayStart is hour 0', () => {
    expect(localTime('2026-10-14', 8, KL).toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(localTime('2026-03-29', 8, BERLIN).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(localTime('2026-03-29', 2, BERLIN).toISOString()).toBe('2026-03-29T01:00:00.000Z'); // 02:00 does not exist: 03:00 CEST
    expect(localTime('2026-10-25', 8, BERLIN).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(localTime('2026-11-01', 0, 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});
```

- [ ] **Step 3 — failing tests: the spike rules.** Write `tests/alert-spikes.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateRules, nonFollowerShares, spikeDays, type RuleInput } from '@/lib/alerts/rules';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import type { DailyRow } from '@/lib/analysis/types';
import { addDays } from '@/lib/sync/time';

const NOW = new Date('2026-10-14T12:00:00Z'); // UTC: today 2026-10-14, checked days 10-13 and 10-12
const SPIKE_DAY = '2026-10-13';
const HISTORY = [18, 20, 22, 19, 21, 20, 23, 17]; // non-follower share % on the same weekday 1..8 weeks before (median 20)

type B = { day: string; followType: string; value: number };
const day = (share: number, d: string, total = 100): B[] => [
  { day: d, followType: 'FOLLOWER', value: Math.round((total * (100 - share)) / 100) },
  { day: d, followType: 'NON_FOLLOWER', value: Math.round((total * share) / 100) },
  { day: d, followType: 'UNKNOWN', value: 999 }, // neither: ignored
];
const breakdown = (spike: number, total = 100, weeks = 8): B[] => [...day(spike, SPIKE_DAY, total), ...HISTORY.slice(0, weeks).flatMap((s, i) => day(s, addDays(SPIKE_DAY, -7 * (i + 1))))];

const input = (o: Partial<RuleInput> = {}): RuleInput => ({
  account: { id: 'a1', username: 'cafe', status: 'active', tokenExpiresAt: null },
  sync: { consecutiveFailures: 0, lastSuccessAt: '2026-10-14T11:30:00.000Z' },
  daily: [],
  posts: [],
  lastReachDropAt: null,
  settings: DEFAULT_ALERT_SETTINGS,
  now: NOW,
  tz: 'UTC',
  ...o,
});
const spikes = (i: RuleInput) => evaluateRules(i).filter((a) => a.kind === 'nonfollower_spike' || a.kind === 'unfollow_spike');

describe('spikeDays', () => {
  it('yesterday and the day before, each with the same weekday of the 8 weeks before: 18 days', () => {
    const days = spikeDays('2026-10-14');
    expect(days).toHaveLength(18);
    expect(days.slice(0, 3)).toEqual(['2026-10-13', '2026-10-06', '2026-09-29']);
    expect(days).toContain('2026-08-18'); // 10-13 minus 8 weeks
    expect(days).toContain('2026-08-17'); // 10-12 minus 8 weeks
    expect(days).not.toContain('2026-10-14'); // today is partial
  });
});

describe('nonFollowerShares', () => {
  it('share of reach from non-followers in percent; UNKNOWN ignored; under 50 reached people the day has no share', () => {
    expect(nonFollowerShares(day(25, '2026-10-13'))).toEqual({ '2026-10-13': 25 });
    expect(nonFollowerShares(day(25, '2026-10-13', 40))).toEqual({ '2026-10-13': null });
    expect(nonFollowerShares([])).toEqual({});
  });
});

describe('nonfollower_spike rule', () => {
  it('an unusual upward share on a checked day alerts once for that day, with whole-percent numbers', () => {
    expect(spikes(input({ reachByFollow: breakdown(60) }))).toEqual([
      { kind: 'nonfollower_spike', accountId: 'a1', severity: 'info', dedupeKey: 'nonfollower_spike:a1:2026-10-13', payload: { username: 'cafe', pct: 60, usual: 20, day: '2026-10-13' } },
    ]);
  });

  it('nothing for a normal day, a drop, a tiny day, fewer than 4 same-weekday samples, no data or an inactive account', () => {
    expect(spikes(input({ reachByFollow: breakdown(21) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(2) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60, 40) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60, 100, 3) }))).toEqual([]);
    expect(spikes(input({ reachByFollow: [] }))).toEqual([]);
    expect(spikes(input())).toEqual([]);
    expect(spikes(input({ reachByFollow: breakdown(60), account: { id: 'a1', username: 'cafe', status: 'needs_reconnect', tokenExpiresAt: null } }))).toEqual([]);
  });

  it('today is never checked (partial day)', () => {
    expect(spikes(input({ reachByFollow: breakdown(60), now: new Date('2026-10-13T12:00:00Z') }))).toEqual([]);
  });
});

describe('unfollow_spike rule', () => {
  const row = (d: string, unfollows: number | null): DailyRow => ({ day: d, unfollows, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, linkTaps: null });
  const daily = [row(SPIKE_DAY, 30), ...[2, 3, 2, 4, 3, 2, 3, 2].map((u, i) => row(addDays(SPIKE_DAY, -7 * (i + 1)), u))];

  afterEach(() => {
    vi.doUnmock('@/lib/alerts/settings');
    vi.resetModules();
  });

  it('is OFF while the follows/unfollows mapping is unverified (UNFOLLOW_SPIKE_ENABLED = false)', () => {
    expect(spikes(input({ daily }))).toEqual([]);
  });

  it('once enabled: an upward same-weekday spike of unfollows alerts once for that day', async () => {
    vi.resetModules();
    vi.doMock('@/lib/alerts/settings', async (orig) => ({ ...(await orig<typeof import('@/lib/alerts/settings')>()), UNFOLLOW_SPIKE_ENABLED: true }));
    const { evaluateRules: on } = await import('@/lib/alerts/rules');
    expect(on(input({ daily })).filter((a) => a.kind === 'unfollow_spike')).toEqual([
      { kind: 'unfollow_spike', accountId: 'a1', severity: 'warning', dedupeKey: 'unfollow_spike:a1:2026-10-13', payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13' } },
    ]);
    expect(on(input({ daily: daily.map((r) => (r.day === SPIKE_DAY ? { ...r, unfollows: 3 } : r)) })).some((a) => a.kind === 'unfollow_spike')).toBe(false);
  });
});
```

- [ ] **Step 4 — failing tests: texts, links, stored payloads.** Write `tests/alert-message-smart.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertHref, WEEKLY_REVIEW_HREF } from '@/lib/alerts/message';
import { pushMessage } from '@/lib/alerts/push-message';
import { rowToNotification } from '@/lib/alerts/read';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const P = (locale: Prefs['locale'], o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, locale, ...o });

describe('Plan 17e messages', () => {
  it('spikes: own account name, numbers and a formatted day only', () => {
    expect(pushMessage({ kind: 'nonfollower_spike', accountId: A, payload: { username: 'cafe', pct: 61, usual: 20, day: '2026-10-13' } }, P('en'))).toEqual({
      title: 'Unusual reach from non-followers',
      body: "@cafe: 61% of the reach on 13 Oct 2026 came from people who don't follow you, well above the usual 20% for that weekday.",
      url: `/accounts/${A}?tab=growth`,
      tag: `nonfollower_spike:${A}`,
    });
    expect(pushMessage({ kind: 'unfollow_spike', accountId: A, payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13' } }, P('en', { dateFormat: 'YYYY-MM-DD' })).body).toBe('@cafe: 30 unfollows on 2026-10-13, against about 3 on that weekday usually.');
    expect(pushMessage({ kind: 'nonfollower_spike', accountId: A, payload: { username: 'cafe', pct: 61, usual: 20, day: '2026-10-13' } }, P('zh-CN')).body).toMatch(/^@cafe：.*61%.*20%/);
  });

  it('summaries: plural counts in both languages; no account in the link or the tag', () => {
    const digest = (count: number, l: Prefs['locale'] = 'en') => pushMessage({ kind: 'digest', accountId: null, payload: { username: '', count } }, P(l));
    expect(digest(1)).toEqual({ title: 'Morning summary', body: '1 alert is waiting under the bell.', url: '/overview', tag: 'digest:all' });
    expect(digest(3).body).toBe('3 alerts are waiting under the bell.');
    expect(digest(3, 'zh-CN')).toMatchObject({ title: '早间摘要', body: '铃铛下有 3 条提醒等你查看。' });
    const weekly = (count: number) => pushMessage({ kind: 'weekly_digest', accountId: null, payload: { username: '', count } }, P('en')).body;
    expect(weekly(0)).toBe('Time to look back at last week.');
    expect(weekly(2)).toBe('Time to look back at last week. 2 alerts are also waiting under the bell.');
  });

  it('the weekly review opens the digest page once Plan 17d has built it, the Overview until then', () => {
    expect(alertHref('weekly_digest', null)).toBe(WEEKLY_REVIEW_HREF);
    if (existsSync(join(process.cwd(), 'app/(app)/plan'))) expect(WEEKLY_REVIEW_HREF).toMatch(/^\/plan([/?]|$)/);
    else expect(WEEKLY_REVIEW_HREF).toBe('/overview');
    expect(alertHref('digest', null)).toBe('/overview');
    expect(alertHref('unfollow_spike', A)).toBe(`/accounts/${A}?tab=growth`);
  });

  it('stored rows keep count, usual and a valid day; anything else is dropped', () => {
    const n = rowToNotification({ id: 1, kind: 'unfollow_spike', account_id: A, severity: 'warning', created_at: '2026-10-14T00:00:00Z', read_at: null, payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13', name: 'someone' } });
    expect(n?.payload).toEqual({ username: 'cafe', count: 30, usual: 3, day: '2026-10-13' });
    expect(rowToNotification({ id: 2, kind: 'digest', account_id: null, severity: 'info', created_at: '2026-10-14T00:00:00Z', payload: { username: '', count: 'x', day: '13/10/2026' } })?.payload).toEqual({ username: '' });
  });
});
```

- [ ] **Step 5 — run, see them fail:** `npx vitest run tests/alert-settings.test.ts tests/alert-quiet.test.ts tests/alert-spikes.test.ts tests/alert-message-smart.test.ts` → failures for the missing module `@/lib/alerts/quiet`, missing exports (`localTime`, `spikeDays`, `nonFollowerShares`, `WEEKLY_REVIEW_HREF`, `UNFOLLOW_SPIKE_ENABLED`) and the new defaults.

- [ ] **Step 6 — `lib/alerts/settings.ts`: replace the whole file with:**

```ts
// Alert settings live in profiles.alert_settings (jsonb). Anything read from there goes through parseAlertSettings:
// unknown keys are dropped, numbers are clamped, junk falls back to the SPEC §7c defaults. Never throws.

export const ALERT_KINDS = ['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Plan 17e: the unfollow-spike rule stays OFF until docs/RUNBOOK_GROWTH.md §2 has verified FOLLOW_TYPE on real data (a swapped
 *  mapping would report a follow spike as unfollows). Flip to true in a reviewed commit after that check; nothing else changes. */
export const UNFOLLOW_SPIKE_ENABLED = false;

export interface AlertSettings {
  push: Record<AlertKind, boolean>;
  reachDropPct: number; // alert when 7-day reach falls by at least this many percent vs the previous 7 days
  takingOffRatio: number; // alert when a post reaches this multiple of the account's median reach
  syncFailures: number; // alert after this many failed sync runs in a row
  quietFrom: number; // Plan 17e: no push from this hour (owner timezone, 0-23) ...
  quietTo: number; // ... until this hour, when the morning summary goes out; quietFrom === quietTo = no quiet hours
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true, nonfollower_spike: true, unfollow_spike: true, digest: true, weekly_digest: true },
  reachDropPct: 20,
  takingOffRatio: 2,
  syncFailures: 2,
  quietFrom: 22,
  quietTo: 8,
};

/** [min, max, decimals] per number: what the Settings form allows. */
export const LIMITS = {
  reachDropPct: [5, 90, 0],
  takingOffRatio: [1.5, 10, 1],
  syncFailures: [1, 10, 0],
  quietFrom: [0, 23, 0],
  quietTo: [0, 23, 0],
} as const;

type NumKey = keyof typeof LIMITS;

function clampNum(v: unknown, key: NumKey): number {
  const [min, max, decimals] = LIMITS[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_ALERT_SETTINGS[key];
  const f = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * f) / f));
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseAlertSettings(raw: unknown): AlertSettings {
  const r = obj(raw);
  const p = obj(r.push);
  return {
    push: Object.fromEntries(ALERT_KINDS.map((k) => [k, typeof p[k] === 'boolean' ? p[k] : DEFAULT_ALERT_SETTINGS.push[k]])) as Record<AlertKind, boolean>,
    reachDropPct: clampNum(r.reachDropPct, 'reachDropPct'),
    takingOffRatio: clampNum(r.takingOffRatio, 'takingOffRatio'),
    syncFailures: clampNum(r.syncFailures, 'syncFailures'),
    quietFrom: clampNum(r.quietFrom, 'quietFrom'),
    quietTo: clampNum(r.quietTo, 'quietTo'),
  };
}
```

- [ ] **Step 7 — `lib/sync/time.ts`.** Replace the exact block

```ts
/** The instant the day starts in tz. Two passes so a DST change between UTC midnight and local midnight is handled. */
export function dayStart(day: string, tz: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let t = utcMidnight - offsetMs(utcMidnight, tz);
  t = utcMidnight - offsetMs(t, tz);
  return new Date(t);
}
```

with

```ts
/** The instant a wall-clock hour (0-23) of a day starts in tz. Two passes so a DST change between the UTC guess and the
 *  local time is handled; an hour skipped by a DST jump resolves to the instant right after the gap. */
export function localTime(day: string, hour: number, tz: string): Date {
  const utcGuess = Date.parse(`${day}T00:00:00Z`) + hour * 3_600_000;
  let t = utcGuess - offsetMs(utcGuess, tz);
  t = utcGuess - offsetMs(t, tz);
  return new Date(t);
}

/** The instant the day starts in tz. */
export function dayStart(day: string, tz: string): Date {
  return localTime(day, 0, tz);
}
```

  (`dayStart` behaves exactly as before: hour 0 is the same two-pass computation; `tests/sync-time.test.ts` proves it.)

- [ ] **Step 8 — `lib/alerts/rules.ts`** (six Edit replacements, each `old_string` exact):

  (a) the imports

```ts
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { AlertKind, AlertSettings } from '@/lib/alerts/settings';
import { localDay } from '@/lib/sync/time';
```

  →

```ts
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import { weekdayAnomaly } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { UNFOLLOW_SPIKE_ENABLED, type AlertKind, type AlertSettings } from '@/lib/alerts/settings';
import { addDays, localDay } from '@/lib/sync/time';
```

  (b) `export const TAKING_OFF_WITHIN_DAYS = 3; // only fresh posts: enabling alerts must not dump a week of old wins` →

```ts
export const TAKING_OFF_WITHIN_DAYS = 3; // only fresh posts: enabling alerts must not dump a week of old wins
/** Spike rules (Plan 17e) look at yesterday and the day before: today is partial, and Instagram may fill yesterday late. */
export const SPIKE_DAYS_BACK = [1, 2] as const;
/** A day's follower + non-follower reach below this is too small for a share to mean anything. */
export const NONFOLLOWER_MIN_REACH = 50;
```

  (c) inside `AlertPayload`

```ts
  ratio?: number;
  postId?: string;
}
```

  →

```ts
  ratio?: number;
  postId?: string;
  count?: number; // Plan 17e: unfollows of a day, or alerts in a summary
  usual?: number; // Plan 17e: the same-weekday median a spike is compared with
  day?: string; // Plan 17e: the owner-timezone day of a spike, 'YYYY-MM-DD'
}
```

  (d) inside `Alert`

```ts
  kind: AlertKind;
  accountId: string;
  severity: Severity;
```

  →

```ts
  kind: AlertKind;
  accountId: string | null; // null: the summaries (Plan 17e) belong to no account
  severity: Severity;
```

  (e) inside `RuleInput`

```ts
  moderationPausedAt?: string | null;
  settings: AlertSettings;
```

  →

```ts
  moderationPausedAt?: string | null;
  /** Plan 17e: account_daily_breakdown reach rows for spikeDays(today); absent = no non-follower rule. */
  reachByFollow?: { day: string; followType: string; value: number }[];
  settings: AlertSettings;
```

  (f) the rule list `const RULES: Rule[] = [needsReconnect, tokenExpiring, syncFailing, reachDropRule, takingOffRule, moderationPaused];` →

```ts
/** Every day a spike rule reads: each checked day and the same weekday of the 8 weeks before it (18 days). */
export function spikeDays(today: string): string[] {
  return SPIKE_DAYS_BACK.flatMap((back) => Array.from({ length: 9 }, (_, w) => addDays(today, -back - 7 * w)));
}

/** Non-follower share of reach (0-100) per day; null when the day's reach is under NONFOLLOWER_MIN_REACH. */
export function nonFollowerShares(rows: { day: string; followType: string; value: number }[]): Record<string, number | null> {
  const by = new Map<string, { f: number; nf: number }>();
  for (const r of rows) {
    const e = by.get(r.day) ?? { f: 0, nf: 0 };
    if (r.followType === 'FOLLOWER') e.f += r.value;
    if (r.followType === 'NON_FOLLOWER') e.nf += r.value;
    by.set(r.day, e);
  }
  return Object.fromEntries([...by].map(([day, { f, nf }]) => [day, f + nf >= NONFOLLOWER_MIN_REACH ? (100 * nf) / (f + nf) : null]));
}

/** Upward same-weekday anomalies (weekdayAnomaly: 8 weeks, at least 4 samples, robust z >= 3.5) on the checked days. */
function upSpikes(series: Record<string, number | null>, now: Date, tz: string) {
  const today = localDay(now, tz);
  return SPIKE_DAYS_BACK.flatMap((back) => {
    const day = addDays(today, -back);
    const r = weekdayAnomaly(series, day);
    return r && 'unusual' in r && r.unusual && r.direction === 'up' ? [{ day, value: r.value, usual: r.median }] : [];
  });
}

/** Key: nonfollower_spike:<account>:<day>. Once per day; shares are rounded whole percents. */
const nonFollowerSpike: Rule = ({ account: a, reachByFollow, now, tz }) =>
  a.status !== 'active' || !reachByFollow?.length
    ? []
    : upSpikes(nonFollowerShares(reachByFollow), now, tz).map((s) => ({ kind: 'nonfollower_spike' as const, accountId: a.id, severity: 'info' as const, dedupeKey: `nonfollower_spike:${a.id}:${s.day}`, payload: { username: a.username, pct: Math.round(s.value), usual: Math.round(s.usual), day: s.day } }));

/** Key: unfollow_spike:<account>:<day>. OFF until UNFOLLOW_SPIKE_ENABLED (the follows/unfollows mapping is unverified). */
const unfollowSpike: Rule = ({ account: a, daily, now, tz }) =>
  !UNFOLLOW_SPIKE_ENABLED || a.status !== 'active'
    ? []
    : upSpikes(Object.fromEntries(daily.map((d) => [d.day, d.unfollows])), now, tz).map((s) => ({ kind: 'unfollow_spike' as const, accountId: a.id, severity: 'warning' as const, dedupeKey: `unfollow_spike:${a.id}:${s.day}`, payload: { username: a.username, count: s.value, usual: Math.round(s.usual), day: s.day } }));

const RULES: Rule[] = [needsReconnect, tokenExpiring, syncFailing, reachDropRule, takingOffRule, moderationPaused, nonFollowerSpike, unfollowSpike];
```

- [ ] **Step 9 — `lib/alerts/quiet.ts` (new):**

```ts
// When a push goes out (Plan 17e, creator-toolkit design §0b "Alerts policy"): an unusual event is pushed at once, but
// never during quiet hours; what quiet hours held back, plus the less urgent kinds, arrives as ONE morning summary at the
// end of quiet hours; on the first day of the owner's week that summary is the weekly review. Pure: instants, settings
// and the owner timezone are inputs; wall-clock hours come from Intl via lib/sync/time (DST-safe).
import type { Alert } from '@/lib/alerts/rules';
import { ALERT_KINDS, type AlertKind, type AlertSettings } from '@/lib/alerts/settings';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay, localHour, localTime } from '@/lib/sync/time';

type Quiet = Pick<AlertSettings, 'quietFrom' | 'quietTo'>;

/** Never pushed on their own: nothing breaks before the next morning (the 2-day token stage still leaves a day). */
export const DIGEST_ONLY: readonly AlertKind[] = ['token_expiring', 'moderation_paused'];
/** The summaries themselves: stored for dedupe and the bell, never counted inside another summary. */
export const SUMMARY_KINDS: readonly AlertKind[] = ['digest', 'weekly_digest'];

/** Inside quiet hours at this instant? [from, to) in the owner's wall-clock hours; the window may cross midnight; from === to = never. */
export function isQuiet(at: Date, s: Quiet, tz: string): boolean {
  const { quietFrom: from, quietTo: to } = s;
  if (from === to) return false;
  const h = localHour(at, tz);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Push this freshly stored alert right now? Only an unusual-event kind, with its toggle on, outside quiet hours. */
export function pushNow(kind: AlertKind, s: AlertSettings, now: Date, tz: string): boolean {
  return s.push[kind] && !DIGEST_ONLY.includes(kind) && !SUMMARY_KINDS.includes(kind) && !isQuiet(now, s, tz);
}

export interface DigestWindow {
  day: string; // owner-timezone day of the summary (its dedupe key)
  fromIso: string; // previous summary time (yesterday at quietTo) ...
  toIso: string; // ... to today's summary time: alerts created in [from, to) belong to this summary
}

/** The summary that is due now, or null: due from quietTo until quiet hours start again, once per owner-timezone day. */
export function digestDue(now: Date, s: Quiet, tz: string): DigestWindow | null {
  if (isQuiet(now, s, tz) || localHour(now, tz) < s.quietTo) return null;
  const day = localDay(now, tz);
  return { day, fromIso: localTime(addDays(day, -1), s.quietTo, tz).toISOString(), toIso: localTime(day, s.quietTo, tz).toISOString() };
}

const isKind = (k: string): k is AlertKind => (ALERT_KINDS as readonly string[]).includes(k);

/** Unread alerts of the window that were NOT pushed at once: push toggle on, and a digest-only kind or created in quiet hours. */
export function heldCount(rows: { kind: string; createdAt: string }[], s: AlertSettings, tz: string): number {
  return rows.filter((r) => isKind(r.kind) && s.push[r.kind] && !SUMMARY_KINDS.includes(r.kind) && (DIGEST_ONLY.includes(r.kind) || isQuiet(new Date(r.createdAt), s, tz))).length;
}

/** 'YYYY-MM-DD' is the first day of the owner's week (Monday or Sunday, the Language & formats setting). */
export const isWeekStart = (day: string, weekStart: WeekStart): boolean => new Date(`${day}T00:00:00Z`).getUTCDay() === (weekStart === 'sun' ? 0 : 1);

/** At most two rows: the morning summary (only when something was held) and, on the week's first day, the weekly review
 *  (it carries the held count, so that morning sends ONE push). Keys digest:<day> / weekly_digest:<day> never repeat. */
export function summaryAlerts(day: string, s: AlertSettings, weekStart: WeekStart, held: number): Alert[] {
  const out: Alert[] = [];
  if (s.push.digest && held > 0) out.push({ kind: 'digest', accountId: null, severity: 'info', dedupeKey: `digest:${day}`, payload: { username: '', count: held } });
  if (s.push.weekly_digest && isWeekStart(day, weekStart)) out.push({ kind: 'weekly_digest', accountId: null, severity: 'info', dedupeKey: `weekly_digest:${day}`, payload: { username: '', count: s.push.digest ? held : 0 } });
  return out;
}

/** The one summary to push: the weekly review when there is one (it includes the held count), else the morning summary. */
export const summaryToPush = (fresh: Alert[]): Alert | undefined => fresh.find((a) => a.kind === 'weekly_digest') ?? fresh.find((a) => a.kind === 'digest');
```

- [ ] **Step 10 — `lib/alerts/message.ts`** (three Edit replacements):

  (a) `import { formatNumber, type FormatPrefs } from '@/lib/format';` → `import { formatDay, formatNumber, type FormatPrefs } from '@/lib/format';`

  (b)

```ts
    ratio: formatNumber(p.ratio ?? null, prefs, { maximumFractionDigits: 1 }),
  };
```

  →

```ts
    ratio: formatNumber(p.ratio ?? null, prefs, { maximumFractionDigits: 1 }),
    count: p.count ?? 0, // a number: the summaries' plural
    usual: formatNumber(p.usual ?? null, prefs, { maximumFractionDigits: 0 }),
    day: formatDay(p.day ?? '', prefs),
  };
```

  (c)

```ts
/** Same-origin path the notification opens. */
export function alertHref(kind: AlertKind, accountId: string | null): string {
  if (!accountId) return '/overview';
```

  →

```ts
/** Where the weekly review opens. Plan 17d builds the digest page under /plan; until it exists this is the Overview.
 *  tests/alert-message-smart.test.ts fails as soon as app/(app)/plan exists and this still says /overview. */
export const WEEKLY_REVIEW_HREF = '/overview';

/** Same-origin path the notification opens. */
export function alertHref(kind: AlertKind, accountId: string | null): string {
  if (kind === 'weekly_digest') return WEEKLY_REVIEW_HREF;
  if (!accountId) return '/overview';
  if (kind === 'nonfollower_spike' || kind === 'unfollow_spike') return `/accounts/${accountId}?tab=growth`;
```

  **17d check (deterministic):** if the file `app/(app)/plan/[[...section]]/page.tsx` exists at your base (Plan 17d built), write `export const WEEKLY_REVIEW_HREF = '/plan/digest';` instead, and change the comment's second sentence to "Plan 17d's digest page.". Otherwise keep `/overview`. Report which one you wrote.

- [ ] **Step 11 — `lib/alerts/read.ts`** (two Edit replacements):

  (a) `  for (const k of ['days', 'runs', 'pct', 'ratio'] as const) {` → `  for (const k of ['days', 'runs', 'pct', 'ratio', 'count', 'usual'] as const) {`

  (b) `  if (typeof p.postId === 'string') payload.postId = p.postId;` →

```ts
  if (typeof p.postId === 'string') payload.postId = p.postId;
  if (typeof p.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.day)) payload.day = p.day;
```

- [ ] **Step 12 — verify.** `npx vitest run tests/alert-settings.test.ts tests/alert-quiet.test.ts tests/alert-spikes.test.ts tests/alert-message-smart.test.ts tests/alert-message.test.ts tests/alert-rules.test.ts tests/alerts-moderation.test.ts tests/alert-run.test.ts tests/alert-store.test.ts tests/notifications-read.test.ts tests/notification-bell.test.tsx tests/settings-notifications.test.tsx tests/sync-time.test.ts tests/sync-tick-alerts.test.ts tests/messages.test.ts` → PASS (the runner is unchanged in this wave, so `tests/alert-run.test.ts` still passes with `tz: 'UTC'`). Then every other importer of `lib/sync/time`: `npx vitest run $(grep -rl "lib/sync/time" tests)` → PASS. `npx tsc --noEmit` → clean. `npx eslint lib/alerts lib/sync/time.ts tests/alert-settings.test.ts tests/alerts-moderation.test.ts tests/alert-quiet.test.ts tests/alert-spikes.test.ts tests/alert-message-smart.test.ts` → clean.
- [ ] **Step 13 — commit.** `git add lib/alerts/settings.ts lib/sync/time.ts lib/alerts/rules.ts lib/alerts/quiet.ts lib/alerts/message.ts lib/alerts/read.ts tests/alert-settings.test.ts tests/alerts-moderation.test.ts tests/alert-quiet.test.ts tests/alert-spikes.test.ts tests/alert-message-smart.test.ts` → `git commit -m "feat(alerts): quiet hours policy, spike rules and summary texts (Plan 17e)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 5: the store reads and the runner (TDD)

**Files:** Modify `lib/alerts/store.ts`, `lib/alerts/run.ts` (replace the whole file), `tests/fixtures/alert-fakes.ts`, `tests/alert-run.test.ts`, `tests/alert-store.test.ts`; create `tests/alert-run-smart.test.ts`. Needs Task 4.

- [ ] **Step 1 — fakes.** In `tests/fixtures/alert-fakes.ts`:

  (a)

```ts
  posts?: Record<string, Post[]>;
  subs?: PushSub[];
}
```

  →

```ts
  posts?: Record<string, Post[]>;
  subs?: PushSub[];
  /** Plan 17e: account_daily_breakdown reach rows per account */
  breakdown?: Record<string, { day: string; followType: string; value: number }[]>;
}
```

  (b) `    subscriptions: vi.fn(async () => [...subs]),` →

```ts
    reachByFollow: vi.fn(async (id: string, days: string[]) => (init.breakdown?.[id] ?? []).filter((r) => days.includes(r.day))),
    // every stored row counts as unread; seed rows with mem.rows.push(...) to test the morning summary
    unreadBetween: vi.fn(async (fromIso: string, toIso: string) => rows.filter((r) => r.createdAt >= fromIso && r.createdAt < toIso).map((r) => ({ kind: r.kind, createdAt: r.createdAt }))),
    subscriptions: vi.fn(async () => [...subs]),
```

- [ ] **Step 2 — the existing runner test keeps its meaning.** In `tests/alert-run.test.ts` replace the exact line

```ts
  const ctx: AlertRunContext = { accounts: fakeAccounts(list).accounts, sync: sync.store, now: new Date(T0), tz: 'UTC', deadline: T0 + 10_000, clock: () => T0 };
```

  with

```ts
  // 02:00 UTC = 10:00 in Kuala Lumpur: outside the default quiet hours (22:00-08:00, Plan 17e)
  const ctx: AlertRunContext = { accounts: fakeAccounts(list).accounts, sync: sync.store, now: new Date(T0), tz: 'Asia/Kuala_Lumpur', deadline: T0 + 10_000, clock: () => T0 };
```

- [ ] **Step 3 — failing store tests.** In `tests/alert-store.test.ts`:

  (a) `      for (const f of ['eq', 'neq', 'in', 'is', 'or', 'gte', 'order', 'limit', 'range']) chain[f]` → `      for (const f of ['eq', 'neq', 'in', 'is', 'or', 'gte', 'lt', 'order', 'limit', 'range']) chain[f]` (only the array changes; keep the rest of that line).

  (b) replace the exact two lines

```ts
    expect(r.calls[1].filters).toContainEqual(['range', 0, 59]); // ALERT_POSTS newest, one page
  });
```

  with

```ts
    expect(r.calls[1].filters).toContainEqual(['range', 0, 59]); // ALERT_POSTS newest, one page
  });

  it('reachByFollow (Plan 17e): reach rows of the given days only, explicit columns, capped; bad rows dropped; none for no days', async () => {
    const r = recorder([{ data: [{ day: '2026-10-13', follow_type: 'NON_FOLLOWER', value: 60 }, { day: '2026-10-13', follow_type: 'FOLLOWER', value: 'x' }] }]);
    expect(await supabaseAlertStore(r.db).reachByFollow('a1', ['2026-10-13', '2026-10-06'])).toEqual([{ day: '2026-10-13', followType: 'NON_FOLLOWER', value: 60 }]);
    expect(r.calls[0]).toMatchObject({ table: 'account_daily_breakdown', args: ['day,follow_type,value'], filters: [['eq', 'account_id', 'a1'], ['eq', 'metric', 'reach'], ['in', 'day', ['2026-10-13', '2026-10-06']], ['limit', 1000]] });
    const none = recorder();
    expect(await supabaseAlertStore(none.db).reachByFollow('a1', [])).toEqual([]);
    expect(none.calls).toEqual([]);
    await expect(supabaseAlertStore(recorder([{ error: { message: 'secret' } }]).db).reachByFollow('a1', ['2026-10-13'])).rejects.toThrow('alert store: reachByFollow failed');
  });

  it('unreadBetween (Plan 17e): unread notifications of [from, to), kind and time only', async () => {
    const r = recorder([{ data: [{ kind: 'needs_reconnect', created_at: '2026-10-13T18:00:00+00:00' }, { kind: null, created_at: 'x' }] }]);
    expect(await supabaseAlertStore(r.db).unreadBetween('2026-10-13T00:00:00.000Z', '2026-10-14T00:00:00.000Z')).toEqual([{ kind: 'needs_reconnect', createdAt: '2026-10-13T18:00:00+00:00' }]);
    expect(r.calls[0]).toMatchObject({ table: 'notifications', args: ['kind,created_at'], filters: [['is', 'read_at', null], ['gte', 'created_at', '2026-10-13T00:00:00.000Z'], ['lt', 'created_at', '2026-10-14T00:00:00.000Z'], ['limit', 1000]] });
    await expect(supabaseAlertStore(recorder([{ error: { message: 'secret' } }]).db).unreadBetween('a', 'b')).rejects.toThrow('alert store: unreadBetween failed');
  });
```

- [ ] **Step 4 — failing runner tests.** Write `tests/alert-run-smart.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { spikeDays } from '@/lib/alerts/rules';
import { runAlerts, type AlertDeps, type AlertRunContext } from '@/lib/alerts/run';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts/settings';
import { emptyState } from '@/lib/sync/schedule';
import { memoryAlertStore, pushSub } from './fixtures/alert-fakes';
import { account, fakeAccounts, memoryStore } from './fixtures/sync-fakes';

// Plan 17e: quiet hours, the morning summary and the weekly review, end to end through runAlerts with in-memory fakes.
const KL = 'Asia/Kuala_Lumpur'; // UTC+8; defaults: quiet 22:00-08:00, summary at 08:00
const HALF_HOUR = 1_800_000;
const broken = (id: string) => account({ id, status: 'needs_reconnect' });
const held = (kind: string, createdAt: string) => ({ kind, accountId: 'a1', severity: 'warning', dedupeKey: `${kind}:${createdAt}`, payload: { username: 'cafe' }, createdAt }) as never;

function setup(list: StoredAccount[], o: Parameters<typeof memoryAlertStore>[0] = {}, push: AlertDeps['push'] = vi.fn(async () => 201)) {
  const mem = memoryAlertStore({ subs: [pushSub(1)], ...o });
  const sync = memoryStore({ states: list.map((a) => ({ ...emptyState(a.id), lastSuccessAt: '2026-10-13T00:00:00.000Z' })) });
  const deps: AlertDeps = { store: mem.store, push };
  const ctx = (iso: string): AlertRunContext => {
    const t = Date.parse(iso);
    return { accounts: fakeAccounts(list).accounts, sync: sync.store, now: new Date(t), tz: KL, deadline: t + 10_000, clock: () => t };
  };
  const pushed = () => (push as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[1] as string));
  return { mem, deps, ctx, push, pushed };
}

describe('quiet hours', () => {
  it('an unusual event at night is stored at once but not pushed', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')]);
    expect(await runAlerts(deps, ctx('2026-10-14T16:00:00Z'))).toEqual({ created: 1, pushed: 0, failed: 0 }); // 00:00 KL
    expect(mem.rows.map((r) => r.kind)).toEqual(['needs_reconnect']);
    expect(push).not.toHaveBeenCalled();
  });

  it('quiet hours switched off (same hour twice): pushed at night as before', async () => {
    const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, quietFrom: 9, quietTo: 9 };
    const { deps, ctx, push } = setup([broken('a1')], { settings });
    expect(await runAlerts(deps, ctx('2026-10-14T16:00:00Z'))).toMatchObject({ created: 1, pushed: 1 });
    expect(push).toHaveBeenCalledOnce();
  });

  it('a digest-only kind (token expiring) is never pushed on its own, even in the day', async () => {
    const { deps, ctx, push } = setup([account({ id: 'a1', tokenExpiresAt: '2026-10-19T00:00:00.000Z' })]);
    expect(await runAlerts(deps, ctx('2026-10-14T04:00:00Z'))).toMatchObject({ created: 1, pushed: 0 }); // 12:00 KL
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the morning summary', () => {
  const nightRows = () => [
    held('needs_reconnect', '2026-10-13T18:00:00.000Z'), // 02:00 KL: held by quiet hours
    held('token_expiring', '2026-10-13T05:00:00.000Z'), // 13:00 KL: digest-only
    held('reach_drop', '2026-10-13T05:00:00.000Z'), // 13:00 KL: was pushed at once
  ];

  it('at the end of quiet hours: ONE push counting what was held; it opens the Overview; no third-party data', async () => {
    const { deps, ctx, mem, pushed } = setup([]);
    mem.rows.push(...nightRows());
    expect(await runAlerts(deps, ctx('2026-10-14T00:30:00Z'))).toEqual({ created: 1, pushed: 1, failed: 0 }); // 08:30 KL
    expect(pushed()).toEqual([{ title: 'Morning summary', body: '2 alerts are waiting under the bell.', url: '/overview', tag: 'digest:all' }]);
    expect(mem.rows.at(-1)).toMatchObject({ kind: 'digest', accountId: null, dedupeKey: 'digest:2026-10-14', payload: { username: '', count: 2 } });
  });

  it('exactly one summary across the 48 ticks of a day, sent at the first tick after quiet hours', async () => {
    const { deps, ctx, mem, push } = setup([]);
    mem.rows.push(...nightRows());
    const start = Date.parse('2026-10-13T16:00:00Z'); // 00:00 KL on 2026-10-14
    const sentAt: string[] = [];
    for (let i = 0; i < 48; i++) {
      const iso = new Date(start + i * HALF_HOUR).toISOString();
      const before = (push as ReturnType<typeof vi.fn>).mock.calls.length;
      await runAlerts(deps, ctx(iso));
      if ((push as ReturnType<typeof vi.fn>).mock.calls.length > before) sentAt.push(iso);
    }
    expect(sentAt).toEqual(['2026-10-14T00:00:00.000Z']); // 08:00 KL
    expect(mem.rows.filter((r) => r.kind === 'digest')).toHaveLength(1);
  });

  it('a retried or overlapping tick never sends it twice (dedupe key digest:<day>)', async () => {
    const { deps, ctx, mem, push } = setup([]);
    mem.rows.push(...nightRows());
    await Promise.all([runAlerts(deps, ctx('2026-10-14T00:30:00Z')), runAlerts(deps, ctx('2026-10-14T00:30:00Z'))]);
    await runAlerts(deps, ctx('2026-10-14T01:00:00Z'));
    expect(push).toHaveBeenCalledOnce();
  });

  it('nothing held, the summary switched off, or no push configured: no summary at all', async () => {
    const a = setup([]);
    await runAlerts(a.deps, a.ctx('2026-10-14T00:30:00Z'));
    expect(a.mem.rows).toEqual([]);
    const b = setup([], { settings: { ...DEFAULT_ALERT_SETTINGS, push: { ...DEFAULT_ALERT_SETTINGS.push, digest: false } } });
    b.mem.rows.push(...nightRows());
    await runAlerts(b.deps, b.ctx('2026-10-14T00:30:00Z'));
    expect(b.push).not.toHaveBeenCalled();
    const c = setup([], {}, null);
    c.mem.rows.push(...nightRows());
    await runAlerts(c.deps, c.ctx('2026-10-14T00:30:00Z'));
    expect(c.mem.store.unreadBetween).not.toHaveBeenCalled();
    expect(c.mem.rows.some((r) => r.kind === 'digest')).toBe(false);
  });

  it('a failing summary read is counted and never stops the instant pushes', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')]);
    vi.mocked(mem.store.unreadBetween).mockRejectedValue(new Error('alert store: unreadBetween failed'));
    expect(await runAlerts(deps, ctx('2026-10-14T04:00:00Z'))).toEqual({ created: 1, pushed: 1, failed: 1 });
    expect(push).toHaveBeenCalledOnce();
  });

  it('out of time: no summary is read or sent', async () => {
    const { deps, mem } = setup([]);
    mem.rows.push(...nightRows());
    const t = Date.parse('2026-10-14T00:30:00Z');
    await runAlerts(deps, { accounts: fakeAccounts([]).accounts, sync: memoryStore().store, now: new Date(t), tz: KL, deadline: t, clock: () => t });
    expect(mem.store.unreadBetween).not.toHaveBeenCalled();
  });
});

describe('the weekly review', () => {
  it("on the week's first day the morning push IS the weekly review, with the held count", async () => {
    const { deps, ctx, mem, pushed } = setup([]);
    mem.rows.push(held('needs_reconnect', '2026-10-18T17:00:00.000Z')); // 01:00 KL Monday
    expect(await runAlerts(deps, ctx('2026-10-19T00:30:00Z'))).toEqual({ created: 2, pushed: 1, failed: 0 }); // 08:30 KL Monday
    expect(pushed()).toEqual([{ title: 'Weekly review', body: 'Time to look back at last week. 1 alert is also waiting under the bell.', url: '/overview', tag: 'weekly_digest:all' }]);
    expect(mem.rows.map((r) => r.dedupeKey).slice(-2)).toEqual(['digest:2026-10-19', 'weekly_digest:2026-10-19']);
  });

  it('follows the week-start setting; nothing held still sends the review; Chinese when the profile is Chinese', async () => {
    const sun = setup([], { prefs: { weekStart: 'sun' } });
    await runAlerts(sun.deps, sun.ctx('2026-10-19T00:30:00Z'));
    expect(sun.push).not.toHaveBeenCalled();
    await runAlerts(sun.deps, sun.ctx('2026-10-25T00:30:00Z')); // Sunday
    expect(sun.pushed()[0].body).toBe('Time to look back at last week.');
    const zh = setup([], { locale: 'zh-CN' });
    await runAlerts(zh.deps, zh.ctx('2026-10-19T00:30:00Z'));
    expect(zh.pushed()[0]).toMatchObject({ title: '每周回顾', body: '来回顾一下上周的表现吧。' });
  });
});

describe('spike data', () => {
  it('reads reach by follow type per account for exactly spikeDays(today), in the same parallel batch', async () => {
    const { deps, ctx, mem } = setup([account({ id: 'a1' })]);
    await runAlerts(deps, ctx('2026-10-14T04:00:00Z'));
    expect(mem.store.reachByFollow).toHaveBeenCalledWith('a1', spikeDays('2026-10-14'));
  });
});
```

  **If Task 4 wrote `WEEKLY_REVIEW_HREF = '/plan/digest'`** (17d built), the two `url: '/overview'` of the weekly review test become `url: '/plan/digest'` (the morning summary stays `/overview`); report it.

- [ ] **Step 5 — run, see them fail:** `npx vitest run tests/alert-run-smart.test.ts tests/alert-store.test.ts tests/alert-run.test.ts` → TypeScript/runtime failures for `reachByFollow` / `unreadBetween` and the missing quiet-hours behaviour.
- [ ] **Step 6 — `lib/alerts/store.ts`** (two Edit replacements):

  (a) `  insertNew(alerts: Alert[]): Promise<Alert[]>;` →

```ts
  insertNew(alerts: Alert[]): Promise<Alert[]>;
  /** Plan 17e: reach by follow type (account_daily_breakdown, metric reach) for these owner-timezone days; ~12 rows a day. */
  reachByFollow(accountId: string, days: string[]): Promise<{ day: string; followType: string; value: number }[]>;
  /** Plan 17e: kind + created_at of the UNREAD notifications created in [fromIso, toIso), for the morning summary. */
  unreadBetween(fromIso: string, toIso: string): Promise<{ kind: string; createdAt: string }[]>;
```

  (b) `    async subscriptions() {` →

```ts
    async reachByFollow(accountId, days) {
      if (days.length === 0) return [];
      // spikeDays = 18 days x (3 follow types x 4 formats) = at most 216 rows: under PostgREST's 1,000-row cap
      const { data, error } = await db.from('account_daily_breakdown').select('day,follow_type,value').eq('account_id', accountId).eq('metric', 'reach').in('day', days).limit(1000);
      if (error) fail('reachByFollow');
      return ((data ?? []) as Row[]).flatMap((r) => (isStr(r.day) && isStr(r.follow_type) && typeof r.value === 'number' && Number.isFinite(r.value) ? [{ day: r.day, followType: r.follow_type, value: r.value }] : []));
    },
    async unreadBetween(fromIso, toIso) {
      // a day of alerts is a handful of rows; the 1,000 cap only matters if something floods the table (then the count is a floor)
      const { data, error } = await db.from('notifications').select('kind,created_at').is('read_at', null).gte('created_at', fromIso).lt('created_at', toIso).limit(1000);
      if (error) fail('unreadBetween');
      return ((data ?? []) as Row[]).flatMap((r) => (isStr(r.kind) && isStr(r.created_at) ? [{ kind: r.kind, createdAt: r.created_at }] : []));
    },
    async subscriptions() {
```

- [ ] **Step 7 — `lib/alerts/run.ts`: replace the whole file with:**

```ts
// Runs after the account jobs of every tick (SPEC §6): evaluate the rules per account, store new alerts once, push the
// new ones. Never throws. One account's failure (bad data, DB hiccup) is counted and the others carry on; push failures
// are isolated per device. The summary holds counts only - never endpoints, keys, tokens or error objects.
// Plan 17e (SPEC §7c "Smart alerts"): only unusual events are pushed at once and never in quiet hours; the rest goes out
// as ONE morning summary (the weekly review on the week's first day). Every summary row has a dedupe key, so a retried
// or overlapping tick never stores or pushes it twice.
import type { AccountsStore } from '@/lib/accounts/types';
import { pushMessage } from '@/lib/alerts/push-message';
import { digestDue, heldCount, pushNow, summaryAlerts, summaryToPush } from '@/lib/alerts/quiet';
import { evaluateRules, spikeDays, type Alert } from '@/lib/alerts/rules';
import type { AlertStore } from '@/lib/alerts/store';
import { sendToAll, type PushTransport } from '@/lib/push/send';
import type { SyncStore } from '@/lib/sync/store';
import { addDays, localDay } from '@/lib/sync/time';

/** Alerts get this long after the sync budget (route maxDuration 60 s, sync stops at 35 s). */
export const ALERT_BUDGET_MS = 10_000;
/** The spike rules compare a day 2 days back with the same weekday of the 8 weeks before (58 days); reach drop needs
 *  two 7-day windows + Instagram's up-to-3-day lag. 60 rows a day-table read, with margin. */
const DAILY_DAYS = 60;

export interface AlertDeps {
  store: AlertStore;
  push: PushTransport | null; // null: VAPID not configured, alerts stay in-app (and no summaries are made)
}

export interface AlertRunSummary {
  created: number;
  pushed: number;
  failed: number; // accounts that could not be evaluated + pushes that failed + a failed insert or summary
}

export interface AlertRunContext {
  accounts: AccountsStore;
  sync: Pick<SyncStore, 'loadStates'>;
  now: Date;
  tz: string;
  deadline: number; // ms epoch
  clock: () => number;
  accountId?: string; // manual "Sync now" for one account: evaluate only that one
}

export async function runAlerts(deps: AlertDeps, c: AlertRunContext): Promise<AlertRunSummary> {
  const out: AlertRunSummary = { created: 0, pushed: 0, failed: 0 };
  try {
    const { settings, prefs } = await deps.store.context();
    // fresh reads: an account flipped to needs_reconnect (or a failure streak grown) during this tick must alert now
    const accounts = (await c.accounts.list()).filter((a) => a.status !== 'archived' && (!c.accountId || a.id === c.accountId));
    const states = await c.sync.loadStates(accounts.map((a) => a.id));
    const today = localDay(c.now, c.tz);
    const fromDay = addDays(today, -DAILY_DAYS);
    const days = spikeDays(today);

    const found: Alert[] = [];
    for (const a of accounts) {
      if (c.clock() >= c.deadline) break;
      try {
        const [daily, posts, lastReachDropAt, moderationPausedAt, reachByFollow] = await Promise.all([deps.store.daily(a.id, fromDay), deps.store.posts(a.id), deps.store.lastReachDropAt(a.id), deps.store.moderationPausedAt?.(a.id) ?? null, deps.store.reachByFollow(a.id, days)]);
        const s = states.get(a.id);
        found.push(...evaluateRules({ account: a, sync: { consecutiveFailures: s?.consecutiveFailures ?? 0, lastSuccessAt: s?.lastSuccessAt ?? null }, daily, posts, lastReachDropAt, moderationPausedAt, reachByFollow, settings, now: c.now, tz: c.tz }));
      } catch {
        out.failed++;
      }
    }

    const fresh = await deps.store.insertNew(found);
    out.created = fresh.length;

    // The morning summary: due once a day after quiet hours. Isolated: a failure here never stops the instant pushes.
    let summaries: Alert[] = [];
    try {
      const due = deps.push && c.clock() < c.deadline ? digestDue(c.now, settings, c.tz) : null;
      const list = due ? summaryAlerts(due.day, settings, prefs.weekStart, heldCount(await deps.store.unreadBetween(due.fromIso, due.toIso), settings, c.tz)) : [];
      if (list.length > 0) summaries = await deps.store.insertNew(list);
    } catch {
      out.failed++;
    }
    out.created += summaries.length;

    const summary = summaryToPush(summaries);
    const toPush = [...fresh.filter((a) => pushNow(a.kind, settings, c.now, c.tz)), ...(summary ? [summary] : [])];
    if (!deps.push || toPush.length === 0) return out;

    let subs = await deps.store.subscriptions();
    for (const a of toPush) {
      if (subs.length === 0 || c.clock() >= c.deadline) break;
      const gone = new Set<string>();
      const r = await sendToAll(subs, pushMessage(a, prefs), deps.push, async (endpoint) => {
        gone.add(endpoint);
        await deps.store.deleteSubscription(endpoint);
      });
      out.pushed += r.sent;
      out.failed += r.failed;
      subs = subs.filter((s) => !gone.has(s.endpoint));
    }
  } catch {
    out.failed++;
  }
  return out;
}
```

- [ ] **Step 8 — verify.** `npx vitest run tests/alert-run-smart.test.ts tests/alert-run.test.ts tests/alert-store.test.ts tests/alerts-moderation.test.ts tests/sync-tick-alerts.test.ts tests/sync-tick-moderation.test.ts tests/sync-tick.test.ts tests/cron-tick-route.test.ts tests/cron-tick-chain.test.ts tests/alert-quiet.test.ts tests/alert-spikes.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx eslint lib/alerts/store.ts lib/alerts/run.ts tests/fixtures/alert-fakes.ts tests/alert-run.test.ts tests/alert-store.test.ts tests/alert-run-smart.test.ts` → clean.
- [ ] **Step 9 — commit.** `git add lib/alerts/store.ts lib/alerts/run.ts tests/fixtures/alert-fakes.ts tests/alert-run.test.ts tests/alert-store.test.ts tests/alert-run-smart.test.ts` → `git commit -m "feat(alerts): quiet hours, one morning summary and the weekly review push in the alert pass (Plan 17e)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

### Task 6: Settings → Notifications: quiet hours (TDD)

**Files:** Modify `components/settings/AlertSettingsForm.tsx` (replace the whole file), `components/settings/sections/NotificationsSection.tsx`; create `tests/settings-quiet-hours.test.tsx`. Needs Tasks 1 and 4.

- [ ] **Step 1 — failing test.** Write `tests/settings-quiet-hours.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertSettingsForm } from '@/components/settings/AlertSettingsForm';
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
import en from '@/messages/en.json';

// jsdom has no ResizeObserver (the sticky SaveBar observes its size)
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const M = en.settings.notifications;
const K = en.notifications.kinds;

function form(hourLabels?: string[]) {
  const save = vi.fn(async (raw: unknown) => ({ ok: true as const, settings: parseAlertSettings(raw) }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AlertSettingsForm initial={DEFAULT_ALERT_SETTINGS} save={save} hourLabels={hourLabels} />
    </NextIntlClientProvider>,
  );
  return save;
}

describe('AlertSettingsForm: quiet hours and summaries (Plan 17e)', () => {
  it('two labelled hour selects (22:00 and 08:00 by default) and a hint naming the summary time', () => {
    form();
    expect(screen.getByRole('group', { name: M.quietTitle })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: M.quietFrom })).toHaveValue('22');
    expect(screen.getByRole('combobox', { name: M.quietTo })).toHaveValue('8');
    expect(screen.getAllByRole('option', { name: '22:00' })).toHaveLength(2);
    expect(screen.getByText(/arrive as one summary at 08:00\./)).toBeInTheDocument();
  });

  it("hour labels come from the server in the owner's time format", () => {
    form(Array.from({ length: 24 }, (_, h) => `h${h}`));
    expect(screen.getByRole('combobox', { name: M.quietTo })).toHaveDisplayValue('h8');
    expect(screen.getByText(/one summary at h8\./)).toBeInTheDocument();
  });

  it('changing an hour makes the form dirty and Save sends both hours as numbers', async () => {
    const save = form();
    const button = screen.getByRole('button', { name: en.common.save });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: M.quietTo }), '7');
    expect(screen.getByText(/one summary at 07:00\./)).toBeInTheDocument();
    await userEvent.click(button);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ quietFrom: 22, quietTo: 7 }));
    expect(await screen.findByRole('status')).toHaveTextContent(M.saved);
    expect(button).toBeDisabled();
  });

  it('switches for the summaries and the non-follower spike; none for the unfollow spike while its rule is off', () => {
    form();
    expect(screen.getByRole('switch', { name: K.digest.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: K.weekly_digest.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: K.nonfollower_spike.title })).toBeChecked();
    expect(screen.queryByRole('switch', { name: K.unfollow_spike.title })).toBeNull();
  });
});
```

- [ ] **Step 2 — run, see it fail:** `npx vitest run tests/settings-quiet-hours.test.tsx` → no group "Quiet hours" / no comboboxes; the unfollow switch exists.
- [ ] **Step 3 — `components/settings/AlertSettingsForm.tsx`: replace the whole file with:**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useTranslations } from 'next-intl';
import { SaveBar } from '@/components/settings/SaveBar';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, LIMITS, UNFOLLOW_SPIKE_ENABLED, type AlertSettings } from '@/lib/alerts/settings';
import { formatHour } from '@/lib/format';
import { DEFAULT_PREFS } from '@/lib/prefs';

export interface AlertSettingsFormProps {
  initial: AlertSettings;
  save: (raw: unknown) => Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }>;
  /** 24 labels, hour 0-23 in the owner's time format (formatHour with the request prefs, from the server section). */
  hourLabels?: string[];
}

const DEFAULT_HOURS = Array.from({ length: 24 }, (_, h) => formatHour(h, DEFAULT_PREFS));
// the unfollow-spike rule is off until its data is verified (lib/alerts/settings.ts): no switch for an alert that never fires
const PUSH_KINDS = ALERT_KINDS.filter((k) => k !== 'unfollow_spike' || UNFOLLOW_SPIKE_ENABLED);
const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

const NUMBERS = ['reachDropPct', 'takingOffRatio', 'syncFailures'] as const;
type Nums = Record<(typeof NUMBERS)[number], string>;

// numbers are kept and sent as typed text; the server parses them (empty = the default), clamps and returns what it stored
const numsOf = (s: AlertSettings): Nums => Object.fromEntries(NUMBERS.map((k) => [k, String(s[k])])) as Nums;

/** Explicit save (Plan 16a): dirty = differs from what the server last stored; the sticky SaveBar saves or discards. */
export function AlertSettingsForm({ initial, save, hourLabels = DEFAULT_HOURS }: AlertSettingsFormProps) {
  const t = useTranslations('settings.notifications');
  const tk = useTranslations('notifications.kinds');
  const [stored, setStored] = useState(initial);
  const [push, setPush] = useState(initial.push);
  const [nums, setNums] = useState(() => numsOf(initial));
  const [quiet, setQuiet] = useState({ quietFrom: initial.quietFrom, quietTo: initial.quietTo });
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ push, nums, quiet }) !== JSON.stringify({ push: stored.push, nums: numsOf(stored), quiet: { quietFrom: stored.quietFrom, quietTo: stored.quietTo } });

  const reset = (s: AlertSettings) => {
    setPush(s.push);
    setNums(numsOf(s));
    setQuiet({ quietFrom: s.quietFrom, quietTo: s.quietTo });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      try {
        const r = await save({ push, ...nums, ...quiet });
        if (!r.ok) return setResult('error');
        setStored(r.settings);
        reset(r.settings); // the server's normalised values win
        setResult('saved');
      } catch (e) {
        if (isRedirectError(e)) throw e; // an expired session: Next follows it
        setResult('error'); // a network drop: the typed values stay, Save again
      }
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
            {PUSH_KINDS.map((k) => (
              <FormField key={k} id={`push-${k}`} label={tk(`${k}.title`)} className="flex-row items-center justify-between gap-3">
                {(p) => <Switch {...p} checked={push[k]} onCheckedChange={(v) => setPush((s) => ({ ...s, [k]: v }))} />}
              </FormField>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('quietTitle')}</legend>
            <div className="grid gap-[var(--gp)] sm:grid-cols-2">
              {(['quietFrom', 'quietTo'] as const).map((k) => (
                <FormField key={k} id={`alert-${k}`} label={t(k)}>
                  {(p) => (
                    <select {...p} className={SELECT} value={quiet[k]} onChange={(e) => setQuiet((s) => ({ ...s, [k]: Number(e.target.value) }))}>
                      {hourLabels.map((label, h) => (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('quietHint', { time: hourLabels[quiet.quietTo] ?? '' })}</p>
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

- [ ] **Step 4 — `components/settings/sections/NotificationsSection.tsx`** (three Edit replacements):

  (a) `import { requireOwner } from '@/lib/auth/require-owner';` →

```tsx
import { requireOwner } from '@/lib/auth/require-owner';
import { formatHour } from '@/lib/format';
import { getPrefs } from '@/lib/prefs.server';
```

  (b) `  const [profile, devices] = await Promise.all([db.from('profiles').select('alert_settings').eq('user_id', userId).maybeSingle(), listPushDevices(db)]);` →
  `  const [profile, devices, prefs] = await Promise.all([db.from('profiles').select('alert_settings').eq('user_id', userId).maybeSingle(), listPushDevices(db), getPrefs()]);`

  (c) `      <AlertSettingsForm initial={alertSettings} save={saveAlertSettingsAction} />` →
  `      <AlertSettingsForm initial={alertSettings} save={saveAlertSettingsAction} hourLabels={Array.from({ length: 24 }, (_, h) => formatHour(h, prefs))} />`

- [ ] **Step 5 — verify.** `npx vitest run tests/settings-quiet-hours.test.tsx tests/settings-notifications.test.tsx tests/settings-page.test.tsx tests/settings-sections.test.ts tests/ui-standards.test.ts tests/messages.test.ts` → PASS. `npx tsc --noEmit` → clean. `npx eslint components/settings/AlertSettingsForm.tsx components/settings/sections/NotificationsSection.tsx tests/settings-quiet-hours.test.tsx` → clean.
- [ ] **Step 6 — commit.** `git add components/settings/AlertSettingsForm.tsx components/settings/sections/NotificationsSection.tsx tests/settings-quiet-hours.test.tsx` → `git commit -m "feat(settings): quiet hours and the summary switches in Notifications (Plan 17e)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`

---

## Scratch-run result (2026-10-30 / 11-01, throwaway clone and PGlite OUTSIDE the repo)

**Code (clone of `main` at `81054d7` in the scratchpad `p17e/`, own `npm ci`, the real `node_modules` untouched):** every file of Tasks 1, 2, 4, 5 and 6 written as in this plan. Final state: `tsc --noEmit` exit 0; `eslint` on every touched file exit 0; full Vitest (`--pool=threads --no-file-parallelism`) **309 files / 3,131 tests passed**; `next build` exit 0. (A first `npm run check` on a loaded machine printed "Failed to start forks worker" for 10 untouched files while 299 files / 2,907 tests passed: load, not code — PROGRESS §10; the rerun above is clean.) **Wave 2 alone** (Task 4 without Tasks 5–6: `store.ts`, `run.ts`, the fakes, `alert-run`/`alert-store` tests, the form and the section restored to `81054d7`, the two Task 5/6 test files removed): `tsc` exit 0 and the 20 alert / tick / settings / messages / time test files (168 tests) green — wave 2 leaves `main` green.

**Found by the dry run and fixed in this plan:** (1) `tests/alert-run.test.ts` ran at 02:00 UTC with `tz: 'UTC'`, which is inside the new default quiet hours (6 tests stopped pushing): its context now uses Kuala Lumpur (10:00 local), the same as the tick tests' fake store; (2) `tests/alert-settings.test.ts` pinned the exact default objects and key list, `tests/alerts-moderation.test.ts` pinned `ALERT_KINDS.at(-1)`: updated; (3) `formatHour(8)` renders `08:00`, not `8:00` (form test regexes); (4) the form test needs a `ResizeObserver` stub (the `SaveBar`); (5) the migration test first imported `ALERT_KINDS`, which would make Task 2 depend on Task 4: it pins the literal list and Task 4's settings test checks `ALERT_KINDS` against the newest migration instead.

**DST and timing (pure, Vitest):** Berlin spring day (23 h window `2026-03-28T07:00Z` → `2026-03-29T06:00Z`), autumn day (25 h, windows chain), a skipped hour (02:00 → 03:00 CEST), New York midnight, quiet windows across midnight / inside a day / off; exactly one summary in 48 half-hour ticks (sent at the 08:00 tick); two overlapping runs push once.

**SQL (PGlite 0.3.15 = Postgres 17 in WASM; the 16 existing migrations, rows of the old kinds, then this one; stub `auth.uid()` / `auth.jwt()` / `auth.mfa_factors` / `storage.*`; roles `anon`, `authenticated`, `service_role` (bypassrls)), 12 of 12 checks passed:** before the migration a `digest` row → 23514; the migration applies over existing rows; the four new kinds insert (summaries with `account_id` null); `INSERT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING` returns no row for an existing `digest:<day>` and one for a new day; an unknown kind → 23514; the owner (aal2) reads the summaries, cannot insert (permission denied), may set `read_at` but not `kind`; another user sees nothing; the `unreadBetween` query is half-open (a row at exactly `to` belongs to the next summary); `delete_all_data()` (16c) removes the summaries too.

**Collisions checked** against `2026-11-01-17a-content-lab.md`, `2026-11-01-17b-insights-feed-today.md`, `2026-11-01-17c-auto-tagging.md` (and 17d's scratch draft, plan file not yet in the repo): none edits `lib/alerts/*`, `components/settings/AlertSettingsForm.tsx`, `NotificationsSection.tsx`, `tests/fixtures/alert-fakes.ts`, `docs/RUNBOOK_ALERTS.md` or SPEC §7c; 17a/17b only import from `lib/sync/time.ts`; 17d's draft changes `projectFollowers`' signature in `lib/analysis/trend.ts` (17e imports only `weekdayAnomaly`, unaffected), adds `/plan` with a catch-all `[[...section]]` route and `plan` to `TAB_PAGE` in `public/sw.js` (so the weekly link becomes `/plan/digest`, Task 4 Step 10). Migration timestamps 20261101 / 02 / 03 / 04 are distinct.

**Not executed:** a real PostgREST (`.in('day', …)` on a `date` column, the `is/gte/lt` window read), real push delivery and lock-screen grouping, the tick on Vercel (duration), real non-follower data (noise), a browser (form at 360 px, themes).

## Self-review

- Spec coverage: §0b "instant push only for unusual events" → `pushNow` + digest-only kinds (Task 4); "ONE daily morning digest" → `digestDue` / `heldCount` / `summaryAlerts` + runner (Tasks 4, 5); "quiet hours respected" → `isQuiet`, settings, form (Tasks 4, 6); "per-type toggles stay" → the switch list incl. the summaries; round 3 "non-follower spikes as alerts" → `nonfollower_spike`; "unfollow spike" → rule built, OFF until verified; roadmap 17e "Monday weekly digest push" → weekly review on the week-start day.
- Names checked against the code by grep: `weekdayAnomaly`, `localDay`, `localHour`, `addDays`, `offsetMs`, `dayStart`, `formatHour`, `formatDay`, `getPrefs`, `insertNew`, `sendToAll`, `pushMessage`, `memoryAlertStore`, `memoryStore`, `fakeAccounts`, `emptyState`, `FormField`, `SaveBar`, `WeekStart`.
- Type consistency: `Alert.accountId: string | null` (summaries); `AlertStore.reachByFollow` / `unreadBetween` match the fakes and `run.ts`; `AlertSettings.quietFrom/quietTo` used by `quiet.ts`, the form and the parser.
- Cross-task edits: `messages/*.json` only by Task 1; `tests/alert-run.test.ts` only by Task 5; the orchestrator must read the check log for `×` (not only the exit code).
