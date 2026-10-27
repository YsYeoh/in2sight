# Weekly planning tools: roadmap (Plans 17a-17h)

Written 2026-10-27 by a read-only planner session for a DIFFERENT session that will write and run the detailed plans. Nothing
here is built, applied or committed. Read `CLAUDE.md`, `docs/PROGRESS.md` (§3, §4, §9-§11) and this file; then write the
detailed plan of 17a (kickoff prompt in §6).

**Sources read:** `docs/PROGRESS.md` §7 items 3-4; `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b, §6
("Content intelligence"), §8; `docs/SPEC.md` §5-§8b; `docs/TODO.md` §7; `docs/UI_STANDARDS.md`; and the code listed under
"Reuse" in each plan.

## 1. Purpose

The owner's third job after "daily check" and "after-I-post check" is **weekly planning**: deciding what to post next week
and checking whether the plan worked. Almost all the data this needs is synced already (posts, captions, publishing times,
formats, reach/saves/shares/follows per post, daily followers and reach, follower-vs-non-follower reach, online followers,
comments). What is missing is the layer that turns it into answers: what works (leaderboards, formats and times, hashtags,
cadence), what changed (a findings feed and a "Today" briefing), where I stand (goals, a weekly/monthly digest), and what I
will do (a planner board, **without publishing to Instagram**). The rule for every tool is spec §6: it states its data
source, its sample size and why you can or cannot trust it (UI standard 14). **No tool below needs a sync change or a new
Meta API call.**

### 1.1 Every candidate tool

Status: **built** = exists, do not re-plan; **partly** = a piece exists and is extended; **new**. Data: table.column
(all already synced unless said). Effort for one agent wave set: S (< 3 days), M (about a week), L (2 weeks).

| Tool | Status today | Data it needs (synced?) | Owner value (1 line) | Effort | Risk |
|---|---|---|---|---|---|
| **Leaderboards** (best posts by reach / saves / shares / follow rate / profile visits, per format, tag, week; "repeat this" / "retire this") | **partly**: Posts tab sorts by reach/views/engagement (`post_list`, 14b); Overview "top posts"; Post Lab percentile and verdict (13b); Explorer `by=post` | `media`, `media_metrics.reach/saves/shares/follows/profile_visits`, `media_tags` (all synced). **Trap:** `explorer_media`/`post_list`/`loadPostRows` read the LATEST snapshot, whose extras (`follows`, `profile_visits`) are often null (extras are separate calls, SPEC §6); use `post_lab_latest(ids)` (latest KNOWN value per column, migration 20261026000001) for those | "Which posts should I repeat?" in one list | S | low |
| **Format & time lab** (posting length, day-part, frequency-vs-reach curves) | **partly**: format comparison table and best-time heatmap (posts / followers online) on account Overview (`lib/analysis/best-time.ts`, `posts.ts formatComparison`); Explorer by weekday/hour | `media.posted_at/media_type/caption`, `media_metrics.reach`, `online_followers.hourly` (synced). Video length is NOT stored (no field requested in `lib/instagram/metrics.ts`): "posting length" = caption length only | Tells which format and slot to use next week | M | low (small samples: guard) |
| **Cadence & consistency** (posts/week, longest gap, streaks, gap warnings, Story days covered) | **new** | `media.posted_at`, `media.media_type` incl. `STORY` (synced; Stories only since connect day) | "Am I posting regularly?" at a glance | S | low |
| **Hashtag lab** (per-hashtag usage + median reach/saves, min-sample guard) | **new** (Post Lab's caption lab only compares with/without hashtags) | own captions `media.caption` (synced, full text via `loadPostRows`; NOT `explorer_media`, which cuts captions to 200 chars) + `captionFeatures().hashtags` (`lib/analysis/caption.ts`). No Meta hashtag API is used or needed: `lib/instagram/metrics.ts` has no hashtag endpoint; Meta's Hashtag Search belongs to the Facebook Login variant of the API with weekly unique-hashtag limits (not verified this session; irrelevant unless the owner wants to research OTHER people's hashtags, which is out of scope) | Stops wasting hashtags that never help | S | low; value doubtful if the owner uses few hashtags (show "not enough posts" honestly) |
| **Compare accounts** (side-by-side KPIs, share of reach, growth ranking) | **mostly built**: Overview comparison chart + table (group or all accounts, metric picker), Explorer `by=account`, Overview cards per group | `account_daily` (synced) | Low with 2 accounts; see §5 | S | low |
| **Insights feed** (rule-based findings with evidence, n, freshness, dismiss/snooze) | **new**, but the rules exist: `flags.ts` (taking off, reach drop), `trend.ts` (weekday anomaly, projection), `why.ts` (reasons), `best-time.ts`, `caption.ts`, `post-lab.ts` (verdict), 17a's cadence/hashtag/leaderboard functions | all synced; dismiss/snooze needs owner-authored state (**migration**) | One list of "what changed and why" | M | medium: rules must not overclaim (Low/Medium confidence only) |
| **Today briefing** (Overview answers 4 questions in 10 s, spec §0b) | **partly**: Overview has KPI cards, sync/token state, comparison; no "yesterday vs normal", no attention list, no "what to do next" | `account_daily`, `sync_state`, `media`, `comments` (counts only), best-time; findings from the feed | The daily check in 10 seconds | M | medium (Overview is the most-used page; performance budget 1.2 s) |
| **Goals** (per-account targets: followers, avg reach, posts/week; pace and forecast) | **new** (SPEC §7b lists goals as "not in v1": update SPEC) | targets = owner-authored (**migration**); actuals from `account_daily.followers`, `media`, `media_metrics.reach`; forecast reuses `projectFollowers` (`trend.ts`) | "Am I on track this month?" | M | low |
| **Weekly & monthly digest page** (+ optional push summary) | **new** page; the report model exists (`lib/export/report.ts buildReport`, `growth.ts summarize/kpis`) | all synced; push summary needs a `digest` notification kind (**migration**: `notifications.kind` check) | The Monday review on one page | M | low (page) / medium (push timing) |
| **Planner board** (idea → drafting → scheduled-for → published, auto-link to the media by time, slot suggestions from best time, tags) | **new** | owner-authored items (**migration**); auto-link reads `media.posted_at`; suggestions from `best-time.ts` | Keeps ideas and next week's slots in the same app as the numbers | L | medium (most new UI; value depends on owner habit) |
| **Smart alerts + one daily digest** (instant push only for unusual events; the rest in one morning push; quiet hours) | **partly**: rules, dedupe, notification centre, Web Push, per-type toggles (`lib/alerts/*`, `lib/push/*`); no quiet hours, no batching, no non-follower/unfollow spike rules | `account_daily.follows/unfollows`, `account_daily_breakdown` (synced); settings in `profiles.alert_settings` jsonb (no migration); new kinds need the `notifications.kind` check (**migration**) | Fewer, better pushes | M | medium: changes what reaches the phone; tick budget (35 s sync + 10 s alerts + 5 s auto-hide of 60 s) |
| **Auto-tagging from hashtags** (suggest AND apply; never overwrite a manual tag; corrections feed the rules) | **new** (SPEC §5: "hashtag-to-tag auto-suggest is later") | `media.caption`, `media.media_type`, `tags`, `media_tags`; needs rules + a source/rejected marker (**migration**) | Makes every per-tag analysis work without chores (owner principle "the app does the work") | M | medium: writes to owner data; must never undo the owner's manual choices |
| **Weekly AI summary per account** (claude-api skill) | **new**; conflicts with the creator-toolkit spec §0 ("Out of scope: AI summaries"), SPEC §1 keeps it as "Later (C)" | the digest model (numbers) + optionally the owner's own captions; cache table (**migration**); `ANTHROPIC_API_KEY` (new server-only secret = external resource, owner confirmation) | Plain-language weekly read; also the investor demo | M | medium: cost, data sent to a third party, prompt hygiene |
| **Shareable report links** (frozen snapshot, expiring unguessable token, spec §0b) | **new**; the PDF/Excel exports exist | snapshot of a `ReportModel` (**migration**: links table); first PUBLIC data route of the app | Send a report without a file | M-L | **high**: the only route that serves owner data to someone signed out |

## 2. Plans, dependencies and order

### 2.1 The split (each 1-2 weeks of agent work, shippable alone, `main` green after each)

| Plan | Name | Contains | Migration | Effort |
|---|---|---|---|---|
| **17a** | Content lab | leaderboards, format & time lab upgrades, hashtag lab, cadence | **none** | M |
| **17b** | Insights feed + Today | findings engine, feed on account Overview, "Today" section on Overview, dismiss/snooze | `insight_dismissals` | M |
| **17c** | Auto-tagging | tag rules (hashtag / keyword / format → tag), suggestions, apply, rejected memory | `tag_rules`, `media_tags.source`, `media_tag_rejections` | M |
| **17d** | Goals + digest | goals with pace and forecast, weekly/monthly digest page, Excel/PDF of the digest via the existing export | `goals` | M |
| **17e** | Smart alerts | quiet hours, one morning digest push, new unusual-event rules, digest push on Monday | `notifications.kind` check (+`digest`, `nonfollower_spike`, `unfollow_spike`) | M |
| **17f** | Planner board | board with four columns, slot suggestions, auto-link to media, tags | `planner_items` | L |
| **17g** | AI weekly summary | on-demand summary per account, cached, opt-in | `ai_summaries` | M (decision-gated) |
| **17h** | Share links | frozen report snapshots behind an expiring token | `report_links` | M-L (decision-gated; recommended: defer, §5) |

### 2.2 Dependency graph

```
17a ──► 17b ──► 17d ──► 17e
 │       │       │
 │       │       └────► 17g (summarises the digest model)
 │       └────────────► 17f (uses findings + best-time for slot hints; can start after 17a if 17b slips)
 └──► 17c (shares hashtag extraction with 17a's hashtag lab)
17h needs only the existing report model (could go anywhere; deferred)
```

### 2.3 Recommended order and why
1. **17a** first: pure analysis, no migration, no new table, highest value per day of work, and it produces the pure
   functions (cadence, hashtag stats, leaderboards) that 17b's rules reuse. Owner order: analysis first.
2. **17b** next: the feed is the backbone of Today, the digest and the morning push. Its migration is tiny (one table).
3. **17c** auto-tagging: data quality that makes every per-tag view (Tags page, 17a per-tag leaderboards, Explorer `tag`)
   useful without chores. Independent of 17b; can run in parallel with it if two plans are ever run at once (not advised).
4. **17d** goals + digest: needs findings (17b) for the "what changed" block.
5. **17e** smart alerts: needs the digest model (17d) for the morning push; touches the tick, so it comes after the read-only work.
6. **17f** planner board: owner said planning last; largest UI.
7. **17g** AI summary, **17h** share links: only after the owner answers §3 Q4 / Q5.

**Migrations flagged:** 17b, 17c, 17d, 17e, 17f, 17g, 17h. Only 17a ships without one. Every migration: new file, RLS
on, owner-authored tables use `is_owner()` for all (like `tags`, `explorer_views`), `on delete cascade` from `accounts`
where account-bound, add the table to `delete_all_data()` only if it has no account FK (a NEW migration replacing the
function; applied ones are never edited), and to `lib/data/export.ts EXPORT_TABLES` + `lib/data/usage.ts` groups
(Plan 16c guard tests will fail otherwise: check `tests/data-export.test.ts`). Code degrades without the migration
("needs a database update", like 14b/15b). Apply only on the owner's go-ahead, BEFORE deploying (PROGRESS §9).

## 3. The plans

Rules that apply to EVERY plan (do not repeat them in the detailed plans, link here): pages = wiring, logic in
`lib/analysis/` (pure, Vitest, TDD) or `lib/<feature>/`; every string in `messages/en.json` AND `zh-CN.json` (text
insertion only, docs are CRLF; `tests/messages.test.ts`); tokens only, light and dark of all 4 themes; 360 / 768 / 1280;
dates and numbers only through `lib/format.ts`; UI standards 1-18 (underline tabs for sections, `RangeBar` only on trend
pages, `FilterToolbar` for filters, one control height per row, full-word range labels, analysis states its basis with
`n` and Low/Medium confidence, keyboard path for every clickable chart, `history.replaceState` for view-only picks);
the side navigation stays; new routes are owner-only (`requireOwner()` / `assertOwner()`), never added to the public
list in `lib/auth/route-policy.ts` (17h is the only exception, decision-gated); every new page segment gets a
`loading.tsx` (test-enforced); third-party data (commenter names/texts, follower export names) never appears in any new
tool, URL, log, push or prompt: only counts; "a missing number has a reason, never 0"; PostgREST caps responses at
1,000 rows (read by ids or page, never by recency scans); update SPEC (new §7l+), TODO, a new `docs/RUNBOOK_<X>.md`,
PROGRESS §3/§5/§8 honestly ("code done; live verification pending").

### 17a: Content lab (no migration)
- **Goal:** one account tab that answers "what works" from data we already have.
- **In:** a new account tab **Content** (`?tab=content`, inserted after Growth: Overview, Growth, Content, Posts, Stories,
  Comments, Moderation, Followers; add to `TABS` in `lib/dashboard/account.ts`), with the `RangeBar` (`keep={{ tab:
  'content' }}`; it is a trend/analysis page, UI standard 4) and underline sections (`?section=` like the Comments tab,
  `lib/comments/state.ts` pattern): **Leaderboards** (metric select: reach, saves, shares, save rate, share rate, follows
  per 1,000 reach, profile visits; format filter; group by none / tag / week; top 10 with "repeat this" = top quartile
  in 2+ metrics, "retire this" = a tag or format whose median sits below the account's 25th percentile with n >= 5),
  **Formats & times** (the existing format table + heatmap moved/linked, plus day-part (night/morning/afternoon/evening
  in the owner timezone), caption length bands, and posts-per-week vs median reach per week), **Hashtags** (per hashtag:
  posts, median reach, median saves, last used; guard n >= 5 posts per hashtag, 20 measured posts overall, like
  `CAPTION_MIN_POSTS`), **Cadence** (posts/week and Story days/week over the range, longest gap, current and best streak,
  "no post for N days" warning = 2x the median gap).
- **Out:** cross-account version (Explorer covers it), video length, competitor hashtags, any write.
- **Reuse:** `loadPostRows` (caption + tags), `post_lab_latest` for extras (by ids, chunks of <= 100), `captionFeatures`,
  `median`, `percentile` (post-lab), `engagementRate`, `postHeatmap`/`onlineHeatmap`, `groupStats`, `formatComparison`,
  `bucketize` (weekly buckets), `parseTimeScope`/`resolveScope`, `ChartCard`, `DataTable`, `MediaThumb`, `postLabHref`.
- **New:** `lib/analysis/leaderboard.ts`, `lib/analysis/hashtags.ts`, `lib/analysis/cadence.ts`, `lib/analysis/dayparts.ts`
  (or one `content.ts` if small: ponytail), `lib/dashboard/content-lab.ts` (model), `components/account/ContentTab.tsx`.
- **Tests:** pure-function TDD with edge cases (no posts, all-null extras, ties, DST day-part boundary, < guard);
  component tests for the empty states and sections; `tests/ui-standards.test.ts` stays green.
- **Security/privacy:** owner captions only; hashtags shown as text (UI standard 16); no comment data.
- **Live check (RUNBOOK_CONTENT):** numbers match Post Lab for 3 posts; extras not 0 when Post Lab shows them; 360 px.
- **Opus review focus:** latest-known vs latest-snapshot trap; sample guards; owner-timezone day-parts; tab order and
  `keep` on links; performance of `post_lab_latest` over 500 ids.

### 17b: Insights feed + Today briefing
- **Goal:** a ranked list of findings ("Reels posted Tue 19:00-21:00 reach 2.1x your median, n = 9, Medium") and the
  Overview "Today" section built from it.
- **In:** `lib/analysis/insights.ts`: rules as pure functions returning `{ key, accountId, kind, severity, evidence
  params, n, confidence, firstSeenDay, href }` (keys stable across reads, e.g. `slot:<account>:<weekday>:<daypart>:<isoWeek>`);
  first rule set (max 8): breakout post (verdict), reach drop (flags), unusual day (trend), best slot (17a), format
  winner (17a), cadence gap (17a), hashtag winner (17a), unanswered questions count (15c, count only). Surfaces:
  **account Overview** gets a "Findings" card (top 5, "show all" opens `?tab=overview&findings=all`), **Overview** gets a
  **Today** section above the account cards: (1) yesterday vs normal per account (followers change, reach, views,
  interactions vs the same weekday median of 8 weeks, `weekdayAnomaly`), (2) needs attention (breakouts, drops, sync/token
  problems from `cardState`, unanswered questions count), (3) working now (top post of the last 7 days and why), (4) next
  (suggested next slot from best time + days since the last post). Dismiss / snooze (7 days) per finding key.
- **Out:** push (17e), AI wording (17g), new metrics.
- **Migration:** `insight_dismissals` (finding_key text pk, account_id fk cascade nullable, until timestamptz,
  created_at; owner-all RLS). Without it: no dismiss button, feed still works.
- **Reuse:** everything in 17a, `flags.ts`, `trend.ts`, `why.ts`, `verdictOf`, `summarize`, `cardState`, `loadOverviewInput`,
  `comment_list` (count only), `StatCard`, `useKpiDelta`, `alertHref` pattern for links.
- **Tests:** each rule pure + "no finding below guard"; stable keys; dismissed hidden until `until`; Overview performance
  (Server-Timing, <= 1.2 s p75: read in parallel, one query per table, `React.cache`).
- **Privacy:** counts only from `comments`; finding params never contain usernames or caption text (a post is referenced
  by id + cover).
- **Live (RUNBOOK_INSIGHTS):** findings on real data make sense; dismiss survives reload and another tab; Overview speed.
- **Opus review:** overclaiming (no "High", "pattern, not proof" line), key stability, Overview latency, empty states.

### 17c: Auto-tagging from hashtags
- **Goal:** tags apply themselves; the owner only corrects.
- **In:** Tags page gets a **Rules** section per tag: "hashtag is #x", "caption contains word", "format is Reels"; a
  live preview ("would tag 23 posts"); **Apply to existing posts** (owner action) and automatic apply for new posts.
  `media_tags.source` = `manual` | `auto`; removing an auto tag records a rejection so it is never re-applied; a manual
  tag is never removed by rules; rule changes never delete manual tags. "Suggested" chips on the Post Lab / drawer
  `TagPicker` for rules that would match but are not applied.
- **Where apply runs:** recommended = a `security invoker` SQL function `apply_tag_rules(p_media text[])` called (a) by the
  owner action and (b) by the sync for newly listed media through the admin client inside the account's job (one call,
  ids only, non-fatal, counted in the 35 s budget). Detailed plan decides; dry-run on PGlite like 16c.
- **Migration:** `tag_rules` (id, tag_id fk cascade, kind `hashtag|word|format`, value, created_at; owner-all RLS; unique
  (tag_id, kind, lower(value))), `media_tags.source text not null default 'manual'`, `media_tag_rejections` (media_id,
  tag_id, pk both, cascades). Also EXPORT_TABLES / usage groups.
- **Reuse:** `captionFeatures` (same hashtag regex as 17a, one source of truth), `normalizeTagName`, `lib/tags.ts`,
  TagsView, TagPicker, `moderation` rule-preview pattern (`lib/moderation/rules.ts` folding: NFKC + case).
- **Tests:** rule matching (CJK, case, `#` variants), never-overwrite, rejection memory, idempotent apply.
- **Live (RUNBOOK_AUTOTAG):** apply on real posts, remove one auto tag, next sync does not re-add it.
- **Opus review:** manual tags never touched, admin-client use limited to the function call, tick budget.

### 17d: Goals + weekly/monthly digest
- **Goal:** "where do I stand" for a week or month, per account and for all.
- **Navigation:** ONE new side-nav item **Plan** (`/plan`, icon `ClipboardList` or similar from lucide; `lib/nav.ts`
  `NAV_ITEMS`, also the phone bottom bar and the shell tab titles) with underline sections `/plan?section=digest|goals`
  (17f adds `board`). The digest is a trend page: week picker / month picker of the Time Scope (`week=`, `month=`), not
  the full `RangeBar` presets (decide in the plan; UI standard 4 allows the range bar on trend pages).
- **Goals:** per account: followers by a date, average reach per post in a month, posts per week, (optional) saves per
  post. Pace = actual vs the straight line to the target; forecast = `projectFollowers` (followers) or the run rate
  (others), with Low/Medium confidence and "not enough history" under 14 days. Form = explicit save (UI standard 18:
  `SaveBar`, dirty tracking).
- **Digest:** KPIs with comparison (`summarize`/`kpis`), top 3 and bottom 3 posts (17a leaderboards), findings of the
  period (17b), goals pace, cadence line; per account and "All accounts" (grouped like Overview). Export: reuse the
  report route with the digest as a section set only if trivial; otherwise out.
- **Migration:** `goals` (id, account_id fk cascade, metric check list, target numeric, period `week|month|by_date`,
  due_day date null, created_at, updated_at; owner-all RLS; max 20 per account).
- **Reuse:** `growth.ts summarize/combine/kpis`, `deltaView`, `metrics.ts` (a goal metric is a registry id where possible),
  `trend.ts projectFollowers`, `buildReport` pieces, `StatCard`, `ChartCard`, `Segmented`, `SaveBar`, `useUnsavedGuard`.
- **Tests:** pace/forecast pure; week/month boundaries with the week-start setting and DST; goal form validation.
- **Live (RUNBOOK_DIGEST):** last full week matches Overview for the same days; goals pace sensible.
- **Opus review:** period boundaries (owner timezone, settled-day lag `MAX_LAG_DAYS`), comparison coverage rule (80 %).

### 17e: Smart alerts and one daily digest push
- **Goal:** the spec §0b alerts policy: instant push only for unusual events; everything else in ONE morning push;
  quiet hours.
- **In:** settings in `profiles.alert_settings` (jsonb, parsed by `parseAlertSettings`: add `quietFrom`, `quietTo`,
  `digestHour`, `weeklyDigest` with clamps; no migration for these); new rules `nonfollower_spike` (non-follower share
  vs same-weekday history, `weekdayAnomaly`) and `unfollow_spike` (needs the `FOLLOW_TYPE` mapping verified first:
  RUNBOOK_GROWTH §2; until then the rule is OFF); the alerts pass marks non-urgent notifications "digest only" and, once
  per day after `digestHour` (owner timezone), sends one push summarising unread items (dedupe key `digest:<day>`); on
  Monday a weekly digest push linking to `/plan?section=digest` (dedupe `weekly:<isoWeek>`). Quiet hours hold urgent
  pushes too, except `needs_reconnect`/`sync_failing` (decision Q6).
- **Migration:** `notifications.kind` check gains `digest`, `weekly_digest`, `nonfollower_spike`, `unfollow_spike`
  (drop + add constraint, like 15d did).
- **Reuse:** `evaluateRules`, `runAlerts` (inside `ALERT_BUDGET_MS`, no new tick work), `pushMessage`, `sendToAll`,
  `alertText`, `alertHref`, Settings → Notifications form (16a), `isoWeek` from Time Scope helpers.
- **Tests:** quiet-hours window across midnight and DST; exactly one digest per day across 48 ticks; settings clamps.
- **Live (RUNBOOK_ALERTS addendum):** a real morning push; nothing during quiet hours; tick duration unchanged.
- **Opus review:** dedupe correctness, tick budget (no Claude call, no heavy reads in the tick), push text in the
  profile language, no third-party data in push payloads.

### 17f: Planner board (no publishing)
- **Goal:** ideas and next week's slots next to the numbers.
- **In:** `/plan?section=board`: four columns **Ideas, Drafting, Scheduled, Published** (on phones: a column select +
  one list; drag-and-drop optional, every move also via a menu so keyboard and touch work). Item: title (<= 120), notes
  (<= 2,000, plain text), account, format, tags, planned slot (owner-timezone date + hour), status. Slot suggestions:
  the account's top best-time cells (17a) not yet taken by another planned item. **Auto-link:** a Scheduled item becomes
  Published when a media of that account and format is posted within +/- 3 h of the slot (checked on read, the owner
  confirms the link; no write from the sync). Published items show the post's Post Lab verdict. Planned items appear on
  the **Calendar** as dashed entries (small, reuses `buildCalendar`), optional in the plan.
- **Out:** publishing or scheduling on Instagram (spec §0b), reminders by push unless Q1 says so, file/image uploads,
  collaborators.
- **Migration:** `planner_items` (id, account_id fk cascade, title, notes, format, status check, slot_at timestamptz null,
  media_id fk `on delete set null`, tag_ids uuid[] or a join table (ponytail: array, max 10), position int, created_at,
  updated_at; owner-all RLS; max 500 open items).
- **Reuse:** `best-time.ts`, `TagPicker`, `MediaThumb`, `ResponsiveDialog`, `FormField`, `ConfirmDialog`, Calendar model,
  `postLabHref`, `verdictOf`.
- **Tests:** status transitions, auto-link matching (DST, two candidates → nearest, already linked), slot suggestions.
- **Live (RUNBOOK_PLANNER):** a real post links to its planned item; 360 px board; keyboard moves.
- **Opus review:** notes rendered as text, size caps server-side, no N+1 reads, board usable without drag.

### 17g: AI weekly summary (only after Q4)
- **Goal:** a short plain-language summary of one account's week, in the app language.
- **In:** a "Summarise this week" button on the digest (17d) per account; the result cached per (account, isoWeek,
  locale) and shown with "written by Claude from these numbers" and the numbers it used; regenerate at most once per day.
  Called with `fetch` to the Messages API from a server action (CLAUDE.md: no SDK where fetch suffices), never from the
  tick (latency). Model and price: read the `claude-api` skill at plan time (do not trust memory); default the cheapest
  current model that writes good zh-CN.
- **Prompt content (allow-list, built by a pure function with a guard test):** account handle, the digest KPIs and
  deltas, top/bottom posts as format + date + numbers, findings keys + params, goals pace. **Never:** tokens, ids of the
  database, commenter names or texts, follower export names, email. Captions only if Q4 allows (default: no captions).
- **Migration:** `ai_summaries` (account_id fk cascade, iso_week, locale, text, model, input_tokens, output_tokens,
  created_at; pk (account_id, iso_week, locale); owner select, insert via the owner session).
- **New secret:** `ANTHROPIC_API_KEY` (server-only; `.env.example`, `npm run check:env`, Vercel env by the owner). A
  monthly spend cap set by the owner in the Anthropic console.
- **Tests:** prompt builder allow-list (snapshot + a test that fails on any `@`-name or token-like string), mocked fetch
  (429, 5xx, timeout → error key), cache hit, rate limit.
- **Live (RUNBOOK_AI):** one real summary per locale; the request body logged NOWHERE.
- **Opus review:** prompt hygiene, secret handling, cost guard, hallucinated numbers (the UI shows the source numbers).

### 17h: Shareable report links (only after Q5; recommended: defer)
- **Design is fixed by spec §0b:** frozen snapshot (the `ReportModel` JSON, validated by `isReportModel`, rendered by the
  existing report components), token >= 128-bit random, only its SHA-256 stored, expiry (default 7 days), revoke, list in
  Settings → Data & privacy, `noindex`, no cookies, view counter, commenter/fan names redacted by default, exact-path
  public exemption `/r/[token]` in `lib/auth/route-policy.ts`, admin client reads exactly one row by hash, rate limit,
  `frame-ancestors 'none'` on that route.
- **Migration:** `report_links` (id, token_hash unique, title, snapshot jsonb <= 512 KB, created_at, expires_at,
  revoked_at, views; owner-all RLS; no anon policy).
- **Opus + `security-review`:** the first public data route; enumeration, timing, cache headers, CSP, snapshot size.

## 4. Decisions for the owner (max 8; the recommended default is what the detailed plans implement unless told otherwise)

1. **Planner board: notes only, or also reminders?** Options: (a) board only; (b) + one push at the planned slot
   ("time to post X"); (c) + calendar export (.ics). **Default (a)**: the owner's principle is "no recurring chores" and
   spec §0b says planner only; (b) is a later 1-day add on top of 17e.
2. **Goals granularity.** Options: (a) per account: followers by a date, avg reach per post per month, posts per week;
   (b) + any registry metric per week/month; (c) + group/all-accounts goals. **Default (a)**: three goals cover the
   jobs; (b)/(c) multiply UI states for a single owner.
3. **Digest delivery.** Options: (a) in-app page + Monday push link; (b) + email; (c) page only. **Default (a)**: push
   and the PWA exist; email needs an outbound mail provider (Supabase SMTP is for auth mails only) = a new external
   resource and an unsubscribe story.
4. **AI weekly summary.** Build it at all (the creator-toolkit spec §0 says AI summaries are out of scope; SPEC §1 keeps
   it as "Later (C)")? If yes: on demand or automatic weekly; captions sent or not; which model. **Default: build 17g
   last, on demand only, numbers only (no captions, never third-party data), cheapest suitable model from the
   `claude-api` skill, owner sets a monthly spend cap.** Why: lowest cost and data exposure; automatic weekly generation
   would need a second cron endpoint and spends money on unread weeks.
5. **Shareable report links.** Options: (a) defer; (b) build with spec §0b's design; (c) drop. **Default (a) defer**:
   the owner said reports are "mostly for the owner" and the PDF export already shares a report; it is the only feature
   that opens a public data route. Build when someone outside actually needs links.
6. **Smart alerts: quiet hours and the morning digest.** Default: quiet 22:00-08:00 owner timezone, digest at 08:00,
   urgent pushes (breakout, big drop, spikes) wait for the end of quiet hours, but `needs_reconnect` / `sync_failing`
   also wait (nothing the owner can fix at night). Unfollow-spike rule OFF until RUNBOOK_GROWTH §2 verifies the mapping.
7. **Auto-tagging: apply automatically or suggest only?** Spec §0b says suggest AND apply. **Default: apply
   automatically for rules the owner created, show suggestions for nothing else; a removed auto tag is never re-added.**
   Alternative: suggestions only (owner clicks). Rules are owner-made, so auto-apply is predictable.
8. **Where the planning tools live.** Default: account tab **Content** (17a) + one side-nav item **Plan** with sections
   Digest / Goals / Board (17d, 17f), Today on Overview (17b). Alternative: everything as account tabs (8+ tabs, no
   all-accounts view). One nav item keeps the side bar short.

## 5. Not worth building (YAGNI / ponytail), honestly

- **Compare accounts as a tool:** cut. Overview already has the comparison chart + ranked table per group, and the
  Explorer breaks down by account; with two accounts a "growth ranking" is one comparison. If wanted later: add a
  "share of reach" column to the Overview comparison table (one registry-driven column), nothing more.
- **Hashtag research beyond own captions** (Meta Hashtag Search, trending tags): cut; different API variant, weekly
  limits, and it is competitor-style research the spec puts out of scope.
- **Video length in the format lab:** cut; not stored and would need a new media field probe. Caption length stands in.
- **"Frequency vs reach" curve** inside 17a: keep only the simple weekly scatter/table; a fitted curve on 2 accounts x
  a few posts a week is noise. Show it with n and "pattern, not proof", or not at all below 8 weeks.
- **Monthly digest as a separate design:** the same page with `month=`; no second layout.
- **Shareable links (17h):** defer (Q5). **AI summary (17g):** doubtful value for one owner who already reads the
  numbers; build last and only on demand. **Planner board (17f):** value depends on whether the owner will keep ideas
  here rather than in their notes app; ask before building, and keep it to one table and one page.
- **Insights feed rules:** start with at most 8 rules; a rule nobody acts on in a month is deleted, not tuned.
- **Dismiss/snooze sync across devices beyond the DB row**, insight "freshness" scoring, priorities: one `until` date is enough.

## 6. How the next session should work

**Method (PROGRESS §9, unchanged):** an **opus planner** writes `docs/superpowers/plans/<date>-17x-<name>.md` with
`superpowers:writing-plans`, modelled on `2026-10-27-14b-posts-stories-lists.md` / `2026-10-31-16c-data-privacy.md`
(Decisions, Open questions with L = live checks, Assumptions about the current code with line references, task table
"depends on / files owned / parallel with", waves), commits it early (only when the owner allows commits), and
**dry-runs every code block in a throwaway clone OUTSIDE the repo** (own `npm ci`; never symlink or delete the real
`node_modules`; SQL on PGlite on top of all migrations, like 16c). Then **sonnet worktree agents, at most 3 at a time**
(`isolation: "worktree"`, prompt starting "First read docs/superpowers/implementer-rules.md and follow it exactly. YOUR
TASK: Plan 17x Task N ... BASE SHA ... files you own ... running in parallel (do not touch their files)"; agents
`git merge --ff-only main` and verify the SHA; check free disk `Get-PSDrive C` first) → `git cherry-pick` each wave onto
`main` → **remove all worktrees** (unlock, `attrib -r`, `rmdir /s /q`, `git worktree prune`, delete `worktree-agent-*`
branches) → `rm -rf .next` → `npm run check > log` and READ the log → after the last wave an **opus read-only review**
(focus list from §3 of this roadmap) → **ONE fix wave** → check → docs (SPEC section, TODO, RUNBOOK, PROGRESS honestly).
**Never** push, apply a migration or create an external resource (Anthropic key, Vercel env, Supabase settings) without
the owner's explicit say-so. Anything NOT in the approved spec (§1.1 marks them: AI summary, the `/plan` nav item, the
Content tab, quiet-hours defaults) goes through `superpowers:brainstorming` with the owner and a SPEC edit first
(CLAUDE.md). Answer §4 with the owner before writing 17b+ plans; 17a needs only Q8.

**Spec/code disagreements found (CLAUDE.md: stop and ask; resolve with the owner before the plan that touches them):**
1. The creator-toolkit spec header still says "draft for owner review"; PROGRESS §7 and HANDOVER say it is approved.
2. AI summaries: creator-toolkit §0 "Out of scope (unchanged): AI summaries" vs SPEC §1 "Later (C)" and PROGRESS §7.4 / TODO §7.
3. SPEC §7b "Not in v1: goals/targets, scheduled or emailed reports, shareable report links" vs creator-toolkit §6 / §0b
   approving goals, digests and share links: SPEC needs the edit in 17d/17h.
4. Creator-toolkit §0b "Access: only the owner (reports are exported and shared manually)" vs the same section's
   "shareable report links" (round 4). Q5 resolves it.
5. SPEC §7c alerts (instant push per type) does not yet contain the §0b smart-alerts policy (one daily digest, quiet hours).
6. SPEC §5 `media_tags`: "hashtag-to-tag auto-suggest is later" vs §0b "suggests AND applies": 17c implements §0b.
7. Not a conflict but a trap for every leaderboard: `explorer_media`, `post_list` and `loadPostRows` read the latest
   snapshot, whose `follows`/`profile_visits` may be null; use `post_lab_latest`.

**First plan file:** `docs/superpowers/plans/2026-11-01-17a-content-lab.md`.

**Kickoff prompt (paste into the new session):**

```
You are the opus PLANNER for Plan 17a "Content lab" of the in2sight repo (cwd = repo root, branch main).
Read first: CLAUDE.md, docs/PROGRESS.md (§3, §4, §9, §10, §11), docs/superpowers/plans/2026-11-01-00-planning-tools-roadmap.md
(§1.1, §3 "Rules that apply to EVERY plan", §3 17a, §6), docs/UI_STANDARDS.md, docs/SPEC.md §7f-§7i and §8,
docs/superpowers/specs/2026-10-15-creator-toolkit-design.md §6, and the code named in the roadmap's 17a "Reuse" list
(lib/analysis/{caption,post-lab,posts,best-time,buckets}.ts, lib/dashboard/{account,detail-read,content}.ts,
lib/post-lab/read.ts, supabase/migrations/20261026000001_post_lab.sql, components/account/{AccountView,AccountOverview,
CommentsTab}.tsx, lib/comments/state.ts, components/shared/{RangeBar,ChartCard,DataTable,FilterToolbar}.tsx).
First confirm with me (the owner) roadmap §4 Q8 (Content tab after Growth) and the 17a sample guards; the Content tab is
not in the approved spec, so run superpowers:brainstorming briefly and add a SPEC §7l draft before planning.
Then write docs/superpowers/plans/2026-11-01-17a-content-lab.md with superpowers:writing-plans, modelled on
docs/superpowers/plans/2026-10-31-16c-data-privacy.md: Decisions, Open questions (L = live), Assumptions about the
current code with line refs, a task table (depends on / files owned / parallel with) in waves of at most 3 disjoint
tasks, full test + code per task, i18n keys for en and zh-CN, RUNBOOK_CONTENT.md outline, opus review focus.
No migration in 17a: if you find you need one, stop and tell me. Dry-run every code block in a throwaway clone OUTSIDE
the repo (own npm ci; never touch the real node_modules) and run npm run check there; record the result at the end of
the plan. Do not build, push, apply migrations or touch any database or live API. Commit only if I say so.
```
