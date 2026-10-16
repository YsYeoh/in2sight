# Meta API live probe results (2026-10-16)

Run read-only against the owner's real connected Creator account (Instagram API with Instagram Login, `v25.0`), using the stored token server-side. No ids, usernames, captions or tokens are recorded here. Re-run if Meta changes metrics (they do). These resolve the "UNCONFIRMED" items in `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §2 and §10.

## Account level (`/me/insights`, `period=day`)
| Probe | Result |
|---|---|
| `reach` + `breakdown=follow_type` | **Works**: `FOLLOWER` / `NON_FOLLOWER` (no `UNKNOWN` seen). |
| `reach` + `breakdown=media_product_type` | **Works**: `POST`, `CAROUSEL_CONTAINER`, `STORY`, `REEL` (note: Stories dominate reach for this account). |
| `views` + `breakdown=follow_type` | **Works** (previously UNCONFIRMED). `follower_type` is invalid (error 100) — the docs' table has a typo; use `follow_type`. |
| `views` + `breakdown=media_product_type` | **Works**. |
| `follows_and_unfollows` + `follow_type` | Works (returned 0/0 for the probed days). |
| `profile_links_taps`, `likes,comments,saves,shares,replies,reposts` (account-level `total_value`) | **Work** (all six, including `reposts`, at account level). |
| `follower_count` (`time_series`) | **Works** (returned 0,0 for the probed days → it appears to be the daily net change, not the total; the total comes from `followers_count` on `/me`). Verify semantics before relying on it. |
| `profile_views` | Request is accepted (200) but deprecated per changelog — don't rely on it. |
| `since`/`until` range for `time_series` `reach` | **30, 31, 60 and 90 days all work in one call** (returns one point per day). The current one-day-per-call backfill can be replaced by one 90-day call for time_series metrics (`total_value` metrics still need per-day calls). |
| `follower_demographics` timeframes | `this_week`, `this_month`, **`last_30_days` and `last_90_days` all work** (docs said unsupported). |
| `engaged_audience_demographics` (`this_month`, `age`) | Works. |

## Media fields (`/me/media`)
- Present under Instagram Login: `id, caption (null when empty), media_type, media_product_type, permalink, timestamp, like_count, comments_count`; `media_url` (19/25), `thumbnail_url` (13/25 — videos/Reels), `is_shared_to_feed` (Reels only), `children{media_type,media_url,thumbnail_url}` on carousels. `media_product_type` and `caption` DO work (docs labelled them Facebook-Login-only).
- **Image URLs expire fast**: the signed `oe=` expiry on the CDN URLs was ~1.4 to 4.5 days from now → covers must be copied within the first day (Stories within hours). Fetching a cover returned 200 `image/jpeg`, ~16 KB, host suffix `fbcdn.net` (allowlist `fbcdn.net` and `cdninstagram.com`).
- `/me/stories` field list requested: 200 with 0 live stories at probe time → story media fields still UNCONFIRMED (re-probe while a Story is live).

## Per-media insights
| Media | Result |
|---|---|
| Feed / carousel | `reach, views, total_interactions, saved, shares, likes, comments` work; **`follows` and `profile_visits` work** (feed only); `profile_activity` + `breakdown=action_type` works. |
| Reel | `reach, views, total_interactions, saved, shares, likes, comments` work; **`ig_reels_avg_watch_time` (ms), `ig_reels_video_view_total_time` (ms), `reels_skip_rate` (percent) work**; **`follows` and `profile_visits` are NOT supported for Reels** (error 100 "does not support the metric for this media product type"). |
| Any media | **`reposts` is NOT supported per media** (error 100) — and including it in a multi-metric request makes the whole request fail. Request metrics per media type; never batch an unsupported metric. |
| Carousel | Children don't get insights; the parent returns `reach, views, saved`. |

## Comments edge
`GET /{media-id}/comments?fields=id,text,timestamp,username,like_count` returned **200 without a permission error** on the current token (the probed post may simply have no readable comments). Confirm the `instagram_business_manage_comments` scope is actually granted before building the fans feature: check an account that has comments, and check the scopes on the stored token; if absent, add the scope to the authorize URL + Meta app and reconnect.

## Consequences for the plans
- Plan 11 (covers): request `media_url, thumbnail_url, children{...}` in `listMedia`; copy on first sight; allowlist hosts `fbcdn.net`/`cdninstagram.com`; expect ~16 KB JPEGs.
- Plan 12 (Post Lab): drop `reposts` from per-media; `follows`/`profile_visits` for feed + carousel only; Reels get watch time + skip rate; add `shares, saved` (already), keep `profile_activity` with `action_type`; Stories navigation still to probe live.
- Plan 13a: account-level `reach`/`views` by `follow_type` and by `media_product_type` are available daily — store them as daily breakdown rows; use `last_30_days`/`last_90_days` demographics; backfill `time_series` metrics in a single 90-day call to save calls.
- Remember: reach for this account is Story-dominated (stories are ~99% of reach on the probed window) — the analysis should split by `media_product_type` so feed/Reels performance isn't drowned out.

## Addendum 2026-10-16 — combined breakdowns (Story non-follower views)
- `reach` and `views` accept TWO breakdowns in one call: `breakdown=follow_type,media_product_type` (either order). Account-level, daily window. Sample over 6 days on the owner's account: Story reach 350 FOLLOWER / 4 NON_FOLLOWER; Story views 965 FOLLOWER / 60 NON_FOLLOWER; Reel views 55 / 31; carousel views 31 / 54.
- So the **non-follower share of Story (and Reel/feed) reach and views per day is available** and should be stored daily (reach and views × follow_type × media_product_type = one call each per day).
- Still NOT available: the split per individual Story/post (follow_type is not accepted on media insights), and any list of who the non-followers are.
- A same-day query (`since == until`) returned no data; use a window of at least one full day like the existing daily job does.
- No Story was live during this probe, so Story-level metrics (navigation etc.) remain to be probed while one is live.
