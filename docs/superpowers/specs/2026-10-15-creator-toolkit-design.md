# Creator Toolkit — design (Plans 10–14)

Status: **draft for owner review** (2026-10-15). Nothing here is built. When approved, `docs/SPEC.md` gets the matching edits (§5 data model, §6 sync, §8 UI) as the first task of each plan, and each phase below gets its own implementation plan.

## 0. Owner decisions already made
- Followers / unfollowers / viewers: **official sources only + export diff**. No scraping, no unofficial APIs.
- Top commenters: **included**; adds the `instagram_business_manage_comments` scope (Meta app permission + one reconnect per account).
- Delivery order: **A loading → B covers → C Post Lab → D toolkit → E settings**.
- Out of scope (unchanged): AI summaries, competitor tracking, scheduling/publishing posts to Instagram.

### 0b. Product alignment (owner, 2026-10-16)
- Main jobs: daily check · after-I-post check · weekly planning · reporting to others · followers trend. Detail on demand: who followed/unfollowed, who engages.
- Access: **only the owner** (single-owner model stays; reports are exported and shared manually).
- Publishing: **planner board only** — no publishing or scheduling to Instagram.
- Engagement rate: **show both** (per reach is the default; per followers) with a toggle; reports can use either.
- Comments: **read + reply/hide/delete from the app** (needs `instagram_business_manage_comments`; moderation UI; every action confirmed and logged).
- Follower names: owner asked whether any Meta API gives them — **no** (no endpoint, no follow webhook); the export upload stays the only by-name route; the owner has not yet said how often they would upload (default: weekly/monthly with an in-app reminder).
- **By-name unfollower tracking (owner asked for fully automatic crawling, 2026-10-16): DECLINED by the assistant, risks explained to the owner.** No crawling, scraping, credential/session automation — it breaches Meta's automated-collection terms, risks account restriction, stores credentials server-side, runs from datacenter IPs, can jeopardise the Meta developer app (and the official sync), and yields false unfollowers when lists load partially. Delivered instead, fully automatic: follower count every tick (intraday curve), daily follows/unfollows totals (≥100 followers) with spike alerts linked to that day's posts, daily non-follower share of reach/views by format (Stories included — combined `follow_type`×`media_product_type` breakdown verified live), and a churn-risk list of regular commenters who went quiet (a signal, not proof). The Instagram-export upload stays an OPTIONAL on-demand tool (no schedule, reminder off by default). The owner may revisit; the assistant would still not build scraping.
- **Design principle (owner): the app does the work; no recurring chores for the owner.** Automation by default; manual steps only where no legitimate automatic route exists, and then on demand, never scheduled.
- **Overview = "Today briefing" (owner, 2026-10-16)** answers four things in ~10 s, in this order: (1) how yesterday / the last 24 h went (followers change, reach, views, interactions per account vs the owner's normal); (2) what needs attention (breakout posts, sudden drops, unusual non-follower spikes, sync/token problems, new comments to answer); (3) what is working now (top post/Reel/Story of the week and why: format, time, tag); (4) what to do next (suggested next slot/format from own best times and posting gaps). Drill-down from every tile (see Time Scope / Explorer).
- **Alerts policy (owner):** smart — instant push only for unusual events (breakout post, big drop, unfollow spike, sync/token failure); everything else rolls into ONE daily morning digest; quiet hours respected; per-type toggles stay in Settings.
- **Tags (owner):** automatic — the app suggests AND applies tags from hashtags, caption keywords and format; the owner only corrects mistakes (corrections feed the rules; never silently overwrite a manual tag).
- **Reports (owner):** mostly for the owner; language follows the app language setting (en / zh-CN); client branding options stay low priority.
- **Round 3 decisions (owner, 2026-10-16):** accounts: **more than 4 soon** → plan for scale (tiered sync cadence, per-account call budgets, search/filter/pagination on every list, rollups in SQL); primary device: **desktop** (dense tables, wide charts, keyboard shortcuts for analysis; phone stays supported for checks/alerts); comments: **auto-hide with banned words + spam patterns, every action reversible and listed in an undo log**; non-follower signals: **both** — safety as alerts (unusual non-follower spikes), growth as analysis (follows per post, non-follower share by format).
- **Account features requested:** change password (Settings → Security) and **forgot/reset password** via Supabase recovery email (needs custom SMTP + Site URL; see docs/TODO.md).
- **Onboarding sync (owner, 2026-10-16): new accounts must start syncing immediately and show professional, honest progress** (stages, counts, current activity, ETA, notifications, error/rate-limit explanations) — full requirements in docs/TODO.md §6a; belongs to Plan 11 (needs per-stage progress counters from the sync runners).
- **Progressive backfill (owner, 2026-10-16): sync recent first and fastest value first**, so Overview shows numbers within a minute instead of staying blank (profile + followers → last 7 days → newest posts → Stories/audience → days 8–90 newest to oldest → older posts, covers, comments). Analysis and UI handle partial coverage; details in docs/TODO.md §6a.
- **Round 4 decisions (owner, 2026-10-16):** wish-list tools wanted: **"Why did this change?"** (click a spike/drop → rule-based reasons: what was posted, format, time, non-follower share, Story changes, comments), **anomaly detection** (unusual for that account/weekday/hour, not fixed thresholds) **+ adaptive best-time optimiser** (with sample size and confidence), **comment insights** (top fans, unanswered questions, recurring topics — rule-based, no AI), **shareable report links**. Usage: **own accounts only** → Vercel Hobby stays; revisit before any client use. Forgot-password email: **skip for now** (the owner asks the assistant or uses the Supabase dashboard); the TODO item stays open.
- **Shareable report links — security design (resolves tension with "only me" access):** a link never grants access to accounts or live data. It serves a **frozen snapshot** of one generated report (stored server-side as rendered HTML/JSON), identified by an unguessable random token (≥128-bit), **expiring** (default 7 days, owner can revoke any time, list of active links in Settings), `noindex`, no cookies/session, view counter only, no third-party usernames unless the owner opts in (default: redacted fan/commenter names). Public route is an exact-path exemption; the token lookup uses the admin client for exactly one row; rate-limited.
- **Priority order (owner): data collection and analysis first, planning last.** New order: **Plan 11 = Data Capture v2 (no new screens)** → Plan 12 = Covers + Post Lab → Plan 13 = Followers & Growth Center (+ comments/fans/moderation, export diff) → Plan 14 = Settings redesign → Plan 15 = Weekly planning tools (insights feed, leaderboards, planner, goals, digests). Rationale: Instagram history can't be backfilled, so capture starts first.
- Plan 11 Data Capture v2 scope (all additive, nullable columns/new tables, per-account call budget): daily `followers_count` continuously; daily account `reach`/`views` by `follow_type` and by `media_product_type`; `time_series` backfill via ONE 90-day call; new per-media metrics per format (feed/carousel: `follows`, `profile_visits`, `profile_activity`; Reels: `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`; NEVER `reposts` per media; Stories: full `navigation` incl. SWIPE_FORWARD, `follows`, `profile_visits`, `shares`); 7-day checkpoint; `like_count`/`comments_count`/`media_product_type`/children on media; cover image capture into private Storage (Stories while live; CDN links expire in ~1.4–4.5 days); comments ingestion once the scope is confirmed; `engaged_audience_demographics`; demographics `last_30_days`/`last_90_days`.
- **Drill-down & time scope (owner, 2026-10-16): "zoom vertically and horizontally; the more detail the more analysis; collect and snapshot more; advanced filters (1 year, half year, date range, week range, month picker), not just 7/30/90."** Design:
  - **Time Scope** (one shared filter bar, in the URL `?from&to&cmp&gran`, used by Overview, account pages, Posts, Calendar, Explorer, exports): presets 7d/14d/30d/90d/6m/1y/YTD/all; custom date range; week picker (prefs week start); month picker; quarter; compare to previous period / same period last year / custom; granularity hour/day/week/month (auto or manual); owner-timezone day boundaries (DST-safe); shows data coverage ("data from <earliest captured day>"), flags ranges outside coverage; replaces the fixed 7/30/90 `PeriodSelect`.
  - **Vertical drill-down:** portfolio → group → account → format (Stories/Reels/feed/carousel) → single item → its hourly curve → audience slice; every chart bar/table row/heatmap cell is clickable; breadcrumb trail; back keeps the scope.
  - **Horizontal comparison** at any level: accounts, groups, formats, tags, weekdays, hours, periods.
  - **Explorer page:** pick metrics, group-by (account, group, format, tag, weekday, hour, week, month), filters, linked chart + table, drill by click, saved views, export of the current view. Whitelisted metric/dimension registry (extend `lib/metrics.ts`); no free-form queries from the client.
  - **Data policy:** everything that can change is stored as an append-only snapshot and kept forever; ALSO archive the raw insights API responses (jsonb, compressed/deduped) because Meta history can't be re-fetched; poll `followers_count` every tick for an intraday follower curve (account insights are daily-only from Meta, so no intraday reach); heavy aggregation in SQL views/functions (`security invoker`, so RLS applies) or rollup tables refreshed after ticks.
  - **Plan order revised again:** 11 Data Capture v2 (+ raw archive, intraday followers) → 12 Time Scope + rollups + Explorer + drill-down → 13 Covers + Post Lab → 14 Followers & Growth Center (+ comments/fans/moderation, export diff) → 15 Settings → 16 Weekly planning tools.
- Reality check restated to the owner: viewer / visitor / "stalker" lists and by-name unfollowers are NOT available from Instagram's API. Substitutes: non-follower share of reach (by format and day, with spike detection), profile visits per post, commenters cross-checked against the latest follower-export snapshot ("commenters who don't follow you"), and the follower-export diff for new and lost followers by name.

## 1. What the owner asked for (restated)
1. Page transitions feel slow: add proper loading feedback and a custom, innovative spinner (inspired by `thinking-orbs` from libraries.dev and the 21st.dev spinner catalogue — ideas only, own design and code).
2. Make sure we keep our own long-term copy of Instagram insights.
3. Show the actual cover of every post, Reel and Story, not just a name.
4. Deep analysis per post and per Story.
5. Followers snapshot, comparison, unfollowers.
6. Who views the account / Stories / posts, including non-followers.
7. Better Settings UX.
8. "As much as you can provide" for content creators and social account managers.

## 2. What Instagram's API really allows (verified in docs Oct 2026; UNCONFIRMED items get a live probe first — Task 0 of Plans 11 and 12)
| Wanted | Possible? | Notes |
|---|---|---|
| Follower / following **lists**, unfollower **names** | **No** | No endpoint. Only counts. |
| Story **viewers** list, post **likers**, profile **visitors** | **No** | Only counts (`views`, `reach`, `likes`, `profile_visits`). |
| Commenter usernames | **Yes** | `GET /{media-id}/comments?fields=id,text,timestamp,username,like_count` — needs `instagram_business_manage_comments`. |
| Daily follows & unfollows totals | Yes | `follows_and_unfollows` `breakdown=follow_type`; not returned under 100 followers. Already stored. |
| Reach split **follower vs non-follower** | Yes | `reach` + `breakdown=follow_type` (FOLLOWER / NON_FOLLOWER / UNKNOWN). `views`+`follow_type` UNCONFIRMED → probe. |
| Reach/views by format | Yes | `breakdown=media_product_type`. |
| Per-media: follows, profile_visits, profile_activity (bio link / call / email / direction / text taps), reposts | Yes | Feed/Reels/Stories (see D list in the research report). |
| Reels: avg watch time, total watch time, skip rate | Yes | `ig_reels_avg_watch_time`, `ig_reels_video_view_total_time`, `reels_skip_rate`. |
| Story navigation incl. SWIPE_FORWARD | Yes | `navigation` + `story_navigation_action_type` (we drop SWIPE_FORWARD today). |
| Per-media follower-vs-non-follower split | **No** | `follow_type` is account-level only. |
| Cover images | Yes | `media_url`, `thumbnail_url` (video only), carousel `children`. **URLs expire** → we copy them. `media_url` omitted for copyrighted media. |
| Unfollowers **by name** | Only via the owner's own **"Download your information"** export (`followers_1.json`, `following.json`) | Manual upload, snapshot-based. Verify file shape on a real export before coding the parser. |
| History beyond 90 days | Only what **we** stored from connect day on | Backfill is limited to Meta's window. |

## 3. Phase A — Loading, perceived speed, the "Insight Orb" (Plan 10)
### Problems found
Only `/overview` has a `loading.tsx`; every other route blocks on the full server render with zero feedback. Auth work is repeated 2–3× per navigation (proxy `getSessionInfo` incl. `getUser` for aal1, layout `requireOwner` with `getClaims` + `getUser` + `rpc('is_owner')`, page `requireOwner` again); the accounts list and sync status are re-queried per page; the layout awaits notifications before rendering children; queries on `accounts/[id]` and `calendar` are sequential.

### Design
1. **Instant feedback (≤100 ms):** a `NavLink` wrapper (uses `useLinkStatus`) shows the orb inline on the clicked nav item / button, and a **global top progress bar** (thin, theme token colour, indeterminate → completes on pathname change) runs for every client navigation, `router.push` (tabs, period, filters) and server-action transition. Bottom tab bar and rail get the same pending state.
2. **Route skeletons:** a `loading.tsx` for **every** route segment (`overview`, `accounts`, `accounts/[id]`, `calendar`, `tags`, `settings`, `report`), each shaped like its page (cards, table rows, chart blocks) using one shared `Skeleton` kit. Tabs inside the account page stream per tab with `Suspense` so the header and tab bar appear immediately.
3. **The Insight Orb (own design):** an SVG + CSS-only loader (no JS animation loop, ~2 KB): a soft glowing orb filled from the current theme (`--chart-1..3`), three orbiting arcs at different speeds, and a tiny sparkline that draws itself inside the orb in a loop ("the system is reading your numbers"). Sizes: `xs` (inline in buttons/nav), `md` (section), `lg` (full-page/first load, with an optional rotating caption such as "Reading your insights…", i18n). `prefers-reduced-motion` → static orb with a slow opacity pulse; always `role="status"` + visually hidden label. Exposed as `components/shared/InsightOrb.tsx` and used by `LoadingButton`, `NavigationProgress`, `RouteLoading`, `SyncNow`, export dialog.
4. **Server speed:**
   - `React.cache()` the per-request owner check and the accounts + sync-status loaders so the layout and page share one result per request.
   - Cheaper owner check: run `getClaims`, `getUser` (aal1 only) and `rpc('is_owner')` in parallel where independent; skip the page-level repeat when the layout already verified in the same request (still fail-closed; pages keep calling `requireOwner()`, but it becomes a cached lookup).
   - Parallelise sequential loaders; move notification loading in the layout to a streamed `Suspense` island (bell shows skeleton).
   - Add `Server-Timing` headers (dev + prod, no sensitive data) and a documented budget: click→feedback ≤100 ms; skeleton ≤300 ms; warm page data ≤1.2 s p75 for owner's data volume.
5. **Acceptance:** every nav item/button/tab shows pending feedback; no route lacks a skeleton (test enumerates `app/**/page.tsx` ↔ `loading.tsx`); orb passes reduced-motion test; auth work per navigation measured before/after and reduced.

## 4. Phase B — Visual content library (Plan 11)
### Data
- `media` gains: `media_url_source` (not persisted long-term), `cover_path` (Storage object key), `cover_status` (`pending|ok|unavailable|failed`), `cover_captured_at`, `video_duration`? (only if API gives; else null), `like_count`, `comments_count`, `is_shared_to_feed`, `media_product_type` (stop dropping it), `children_count`. Also `media_children` (media_id, position, cover_path) for carousels (first 10).
- **Private Supabase Storage bucket `covers`**, objects `covers/{account_id}/{media_id}.jpg` (original `thumbnail_url` for videos, `media_url` for images; no resizing dependency; typical 50–150 KB; ~1,000 posts ≈ 100 MB — within the free 1 GB; add a size dashboard in Settings → Data).
- **Stories are captured while live** (first sight → download immediately, because the CDN image dies at 24 h); posts/Reels backfilled for everything the API still lists; failures retried with backoff, then `unavailable` (type-icon placeholder).
- Serving: `GET /api/media/[id]/cover` (owner-only via `assertOwner`, streams from Storage, `Cache-Control: private, max-age=31536000, immutable` keyed by object version) — no public bucket, no long-lived signed URLs, nothing for the service worker to cache (path stays out of its allowlist).
- SSRF/safety: fetch only `https` hosts that match Instagram CDN suffixes (`cdninstagram.com`, `fbcdn.net`), size cap (5 MB), content-type check (`image/*`), timeout; never log URLs (they carry tokens).
- Permanent account delete removes Storage objects; archive keeps them. Respect Meta Platform Terms §3.d (delete when no longer needed / on deauthorize+delete callbacks → delete covers too).
### UI
- `MediaThumb` component (aspect 4:5 feed, 9:16 Reels/Stories, 1:1 carousel; format badge, play glyph, carousel count, "expired" ribbon for gone Stories; blur-up skeleton; alt text = caption snippet).
- Posts tab: **Grid | Table** toggle (grid is the default on phones). Stories tab: **filmstrip per day**. Calendar cells and day list show covers. Flags ("taking off"), tag assignment, top-posts, export Posts sheet (cover not embedded; permalink stays).
- A **post detail drawer** on click (cover, caption, key numbers) with "Open Post Lab" (Phase C).

## 5. Phase C — Post Lab: deep per-post / per-Story analysis (Plan 12)
### New captured metrics (all nullable columns on `media_metrics`; one probe task first)
Feed/Reels: `follows`, `profile_visits`, `reposts`, `like_count`/`comments_count` (fields), `profile_activity` (jsonb by `action_type`); Reels: `avg_watch_ms`, `total_watch_ms`, `skip_rate`; Stories: add `swipe_forward`, `shares`, `follows`, `profile_visits`, `reposts`, `profile_activity`. Cadence stays: hourly <48 h, daily <30 d; add a **7-day checkpoint** so the velocity curve has 1 h / 6 h / 24 h / 48 h / 7 d points.
### Route `/accounts/[id]/media/[mediaId]` (posts, Reels, carousels, Stories)
1. Header: big cover, caption, date/time in owner timezone, format, tags (editable), permalink, "gone/expired" state.
2. **Scorecard** (each number with comparison): reach, views, interactions, engagement rate, **save rate, share rate, follow rate per 1,000 reach**, profile visits, link taps; each shows **percentile vs your last 30/90 posts of the same format** and Δ vs median. Verdict chip: *Breakout / Above typical / Typical / Below typical / Too early* (with sample-size guard).
3. **Velocity curve:** cumulative reach/views at 1 h, 6 h, 24 h, 48 h, 7 d vs median curve of comparable posts ("this post ran 2.3× faster in the first 6 h").
4. Reels: watch-time panel (avg watch, total watch, skip rate vs your median).
5. Stories: navigation funnel (forward / back / exit / swipe), reply count, **story-sequence view** — the day's Stories in order with reach drop-off and exit rate per frame, best/worst frame.
6. **Caption lab:** length, hashtag count and list, emoji, question/CTA words, mentions; correlation to the account's own results is shown only with n ≥ 20 posts.
7. "Similar posts" (same format/tag) strip for context.
8. Pure analysis in `lib/analysis/post-lab.ts` (+ tests), all null-safe; no verdict below the sample guard.

## 6. Phase D — Creator toolkit (Plans 13a/13b)
Every tool states its data source, sample size and "why you can/can't trust this".
**Audience & growth**
- **Followers daily:** store `followers_count` daily going forward (already for today; make it continuous); chart + growth rate + 7/30/90 projection.
- **Follow flow:** daily follows vs unfollows (+ follower/non-follower split when ≥100 followers), churn %, best/worst days, **"what happened that day"** overlay (posts, Stories published).
- **Loyalty vs discovery:** reach by `follow_type` over time (store a daily breakdown row), trend + per-format (`media_product_type`) reach.
- **Demographics over time:** age/gender/country/city history from the snapshots we already keep, with change highlighting; engaged-audience demographics added.
- **Top commenters ("fans"):** comments ingested (author username/id, timestamp, like_count, text) for recent posts, ranked leaderboard per account and across accounts, first-seen/last-seen, "new fan" and "gone quiet" lists. Third-party personal data → owner-only, deleted with the account, never exported unless chosen.
- **Followers diff (export upload):** upload `followers_N.json` + `following.json` from "Download your information"; stored as dated snapshots (lower-cased usernames, timestamps from the file). Compare any two snapshots (or snapshot vs previous) → **new followers, unfollowers, not-following-back, you-don't-follow-back, mutuals**, searchable, exportable, with a guided "how to get the file" panel (en/zh). Clearly labelled snapshot-based. Parser is pure, size-capped, validates shape, never executes content.
**Content intelligence**
- **Insights feed:** rule-based findings with evidence ("Reels posted Tue 19:00–21:00 reach 2.1× your median — n=9"), freshness, dismiss/snooze; the same findings feed the weekly digest.
- **Leaderboards:** best posts by reach / saves / shares / follow rate / profile visits, per format, per tag, per week; "repeat this" and "retire this" lists.
- **Format & time lab:** existing format comparison + best time upgraded with posting-length, day-part and "frequency vs reach" curves.
- **Cadence & consistency:** posts per week, longest gap, streaks, gap warnings, Story days covered.
- **Hashtag lab:** per-hashtag usage + median reach/saves (min-sample guard).
- **Compare accounts:** side-by-side KPIs, share of reach, growth ranking.
- **Goals:** per-account targets (followers, avg reach, posts/week) with pace & forecast.
- **Planner board:** idea → drafting → scheduled-for (date/time slot) → published (auto-link to the matching media by time); suggests slots from best-time data; links ideas to tags. No publishing to Instagram.
- **Weekly & monthly digest page** (+ optional push summary): KPIs with comparison, top/bottom posts, findings, goals pace.

## 7. Phase E — Settings redesign (Plan 14)
- Sections (desktop: left list; mobile: top segmented list → full-screen sections), **URL-addressable** (`/settings/appearance` …): **Appearance** (theme, light/dark/auto, density, radius — with live preview card), **Language & formats** (language, date/time/number, week start, timezone with a plain explanation "changes where your days start in all charts"), **Notifications** (this device: permission + test state; alert rules grouped with their thresholds; devices list with remove), **Accounts & sync** (connected accounts, token expiry, last sync, Sync now, reconnect), **Security** (2FA, active session/sign out, password), **Data & privacy** (storage used by covers, follower snapshots, export all, delete all, what we store).
- One consistent save model: appearance = instant with toast; forms = explicit save with dirty tracking + sticky save bar + inline success/error; no silent failure (fix `PrefsProvider` swallowing persist errors → visible retry).
- Grouped cards with headings, helper text, mobile-first layout (no 10-pill walls: option sets use segmented controls/selects, wrapping rules tested at 360/768/1280).

## 8. Cross-cutting rules
- Every new table: RLS, owner read-only (writes via admin in sync) except owner-authored data (goals, planner, snapshots uploads) with `is_owner()` policies; lint-compatible; new migrations only (earlier ones are applied live); apply with `supabase db push` before deploying code that needs them.
- Sync budget: more calls per tick (new metrics, comments, covers). Add a **per-account call budget** and tiering (hot posts hourly, older daily/weekly), honour `X-Business-Use-Case-Usage` when present, stay inside the 35 s tick budget; heavy backfills (covers, comments) are resumable across ticks.
- Scope change: adding `instagram_business_manage_comments` to the authorize URL + `docs/META_SETUP.md`/runbook; accounts connected before need reconnect (UI shows "Reconnect to enable comments"). Features degrade gracefully without the scope.
- i18n en + zh-CN complete; tokens only; responsive 360/768/1280; a11y; formats via `lib/format.ts`; motion gated; no new heavy dependencies without justification.
- Privacy: third-party usernames (commenters, follower snapshots) are personal data of others: owner-only, never in logs, deleted with the account, included in "delete all data".
- Each plan ends with an opus whole-branch review, runbook for live checks, honest TODO ticks.

## 9. Plan breakdown
| Plan | Content | Needs from owner |
|---|---|---|
| 10 | Phase A: orb, progress bar, skeletons, auth/query speed-ups, Server-Timing | nothing |
| 11 | Phase B: probe, migration, cover capture + Storage bucket, `MediaThumb`, grid/filmstrip, drawer | create the `covers` bucket is done by migration; apply migration |
| 12 | Phase C: new metrics + 7-day checkpoint, Post Lab | apply migration; live probe results |
| 13a | Phase D-1: follower/follow-flow/loyalty/demographics trends, followers diff upload, goals, compare | upload an export to test |
| 13b | Phase D-2: comments ingestion + fans, insights feed, leaderboards, hashtag lab, cadence, planner, digests | enable permission in Meta app + reconnect |
| 14 | Phase E: Settings redesign | nothing |

## 10. Open items to resolve with live probes (Task 0 of Plans 11 and 12)
`views`+`follow_type`; `follower_count` series; `caption`/`media_product_type` under Instagram Login; max `since`/`until` range; thumbnail/media fields on `/me/stories`; media URL lifetime; export file names (`recently_unfollowed_profiles.json`, pending requests).
