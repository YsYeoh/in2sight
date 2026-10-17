// Every Instagram API metric name, field list and breakdown the sync uses. Meta renames and deprecates these, so:
// re-verify against the docs below when touching this file, and on the first live run (docs/RUNBOOK_SYNC.md step 3).
// Verified against Meta's docs (API v25.0) on 2026-10-14:
//   account insights: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
//   media insights:   https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
//   media fields:     https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/
//   user fields:      https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/
// UNCERTAIN = documented ambiguously or not at all; the runbook checks it against a real account.

/** GET /me?fields=… Followers have no historic series we rely on, so the daily job snapshots this count. */
export const PROFILE_FIELDS = 'followers_count,follows_count,media_count';

/** Account-level reach/views split by follower type x media product type (verified live 2026-10-16, docs/META_PROBE_RESULTS.md). */
export const BREAKDOWN_METRICS = ['reach', 'views'] as const;
export const BREAKDOWN_DIMS = 'follow_type,media_product_type';

/**
 * GET /me/insights, metric_type=total_value, period=day, since/until = one insight day.
 * total_value over a range returns ONE total for the range, so the sync asks for one day per call.
 * Removed from the API and therefore not requested: impressions (v22+), profile_views (account level, v21+).
 */
export const ACCOUNT_DAY_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_links_taps'] as const;

/** Separate call: breakdowns error out on metrics that do not support them, so never mix them with the list above. */
export const FOLLOWS_METRIC = 'follows_and_unfollows';
export const FOLLOWS_BREAKDOWN = 'follow_type';
/** UNCERTAIN: which follow_type value means "followed" vs "unfollowed" for follows_and_unfollows. */
export const FOLLOW_TYPE = { follows: 'FOLLOWER', unfollows: 'NON_FOLLOWER' } as const;

/**
 * Audience: metric_type=total_value, period=lifetime, timeframe (since/until are not supported).
 * Since v20 only this_week / this_month are accepted. Empty under 100 followers. Top 45 rows only.
 */
export const DEMOGRAPHICS_METRIC = 'follower_demographics';
export const DEMOGRAPHICS_TIMEFRAME = 'this_month';
export const DEMOGRAPHIC_BREAKDOWNS = { age_gender: 'age,gender', country: 'country', city: 'city' } as const;
export type AudienceKind = keyof typeof DEMOGRAPHIC_BREAKDOWNS;

/**
 * UNCERTAIN: online_followers appears only in the "Limitations" section of the current docs (under 100 followers:
 * unavailable; last 30 days only), not in the metric table. period=lifetime with since/until; values[].value is an
 * hour-keyed object {"0": n, …, "23": n}; the hour base (likely Pacific time) is unverified.
 */
export const ONLINE_FOLLOWERS_METRIC = 'online_followers';

/**
 * Base fields of GET /me/media and GET /me/stories. `caption` and `media_product_type` work under Instagram Login
 * (verified live 2026-10-16, docs/META_PROBE_RESULTS.md) although the reference marks them "Facebook Login only".
 */
export const MEDIA_BASE_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp';
/** GET /me/media: + counts, Reels' is_shared_to_feed and the carousel children's types (all verified live 2026-10-16). */
export const MEDIA_FIELDS = `${MEDIA_BASE_FIELDS},like_count,comments_count,is_shared_to_feed,children{media_type}`;
/**
 * GET /me/stories: + the image URLs for the first-sight cover copy. UNVERIFIED on Stories (no Story was live while
 * probing): on a "nonexisting field" answer the sync falls back to MEDIA_BASE_FIELDS and remembers it (capability
 * "stories:url_fields"), so the Story capture itself can never break on these fields.
 */
export const STORY_FIELDS = `${MEDIA_BASE_FIELDS},media_url,thumbnail_url`;
/**
 * GET /{media-id}: fresh cover URLs (CDN links expire in ~1.4–4.5 days, so they are fetched right before the copy).
 * thumbnail_url = videos/Reels; media_url = images (omitted for copyrighted media); children = carousels.
 */
export const COVER_FIELDS = 'media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}';
/** UNCERTAIN: page-size maximum is not documented; 50 is conservative. */
export const MEDIA_PAGE_SIZE = 50;

/**
 * GET /{media-id}/insights for FEED posts and REELS (same set is valid for both, so the sync does not need
 * media_product_type to pick metrics). period is always lifetime for media. `saved` maps to our `saves` column.
 * Not requested: impressions/plays/clips_replays_count/video_views (deprecated), ig_reels_* (no column yet).
 */
export const FEED_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const;

/** Stories: available only while live (24h). Values under 5 return error code 10 "Not enough viewers". */
export const STORY_METRICS = ['reach', 'views', 'replies', 'shares', 'total_interactions'] as const;
/**
 * Separate call (breakdown). Values TAP_FORWARD / TAP_BACK / TAP_EXIT / SWIPE_FORWARD map to taps_forward / taps_back /
 * exits / swipe_forward; they come back upper- or lower-case (compare upper-cased).
 */
export const STORY_NAVIGATION_METRIC = 'navigation';
export const STORY_NAVIGATION_BREAKDOWN = 'story_navigation_action_type';

export type ExtraScope = 'story' | 'feed' | 'reels';
/** MediaMetricValues fields an extra metric lands in (lib/instagram/data.ts). */
export type ExtraField = 'follows' | 'profileVisits' | 'profileActivity' | 'avgWatchMs' | 'totalWatchMs' | 'skipRate';
export interface ExtraGroup {
  key: string; // capability-memory key: "<scope>:<key>"
  metrics: Readonly<Record<string, ExtraField>>; // Meta metric name -> field
  breakdown?: string; // a breakdown group has exactly one metric; its value is the { dimension: n } map
}

/**
 * Optional per-media metrics, fetched AFTER the core snapshot, ONE separate call per group: a single unsupported metric
 * fails a whole batched request (learned from `reposts`). Verified live 2026-10-16 (docs/META_PROBE_RESULTS.md): feed +
 * carousel `follows`, `profile_visits`, `profile_activity` (breakdown action_type); Reels `ig_reels_avg_watch_time` (ms),
 * `ig_reels_video_view_total_time` (ms), `reels_skip_rate` (percent) — Reels do NOT support follows/profile_visits.
 * Stories: documented but UNVERIFIED live, so one metric per call and support is learned at runtime (capability memory).
 * NEVER `reposts` per media (error 100 for every media type).
 */
export const EXTRA_GROUPS: Record<ExtraScope, readonly ExtraGroup[]> = {
  story: [
    { key: 'follows', metrics: { follows: 'follows' } },
    { key: 'profile_visits', metrics: { profile_visits: 'profileVisits' } },
    { key: 'profile_activity', metrics: { profile_activity: 'profileActivity' }, breakdown: 'action_type' },
  ],
  feed: [
    { key: 'follows_visits', metrics: { follows: 'follows', profile_visits: 'profileVisits' } },
    { key: 'profile_activity', metrics: { profile_activity: 'profileActivity' }, breakdown: 'action_type' },
  ],
  reels: [{ key: 'watch', metrics: { ig_reels_avg_watch_time: 'avgWatchMs', ig_reels_video_view_total_time: 'totalWatchMs', reels_skip_rate: 'skipRate' } }],
};

/**
 * Error codes (https://developers.facebook.com/docs/graph-api/guides/error-handling/ and
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting/). Instagram BUC throttling is 80002;
 * budget = 4800 x impressions per 24h per app+account pair. UNCERTAIN: 100/33 for deleted media.
 */
export const IG_ERROR = {
  auth: [190, 102], // plus the 200-299 permission range
  appRateLimit: [4],
  rateLimit: [17, 32, 613, 80002],
  transient: [1, 2, 341, 368],
  notEnoughViewers: 10,
  invalidParam: 100,
  objectMissingSubcode: 33,
  /** code 100 + this subcode: media posted before the account became professional has no insights, ever. Not re-verified against Meta's docs (no network in the fix wave): check on the first live run. */
  preConversionSubcode: 2108006,
} as const;
