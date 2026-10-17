// Instagram data reads for the sync (graph.instagram.com, Instagram Login tokens). Thin fetch wrapper, no SDK.
// Errors are InstagramApiError('data' | 'network'): fixed messages, never a URL, body or token.
import * as M from '@/lib/instagram/metrics';
import { call, graphInit, InstagramApiError, refreshLongLived } from '@/lib/instagram/oauth';
import { mediaDetailsById, parseBreakdown, parseCommentsPage, parseMediaDetails, parseMediaPage, parseOnlineFollowers, parseTotals, type IgComment, type IgMediaItem, type MediaDetails } from '@/lib/instagram/parse';

const HOST = 'https://graph.instagram.com';

export interface AccountDayValues {
  reach: number | null;
  views: number | null;
  accountsEngaged: number | null;
  totalInteractions: number | null;
  linkTaps: number | null;
  follows: number | null;
  unfollows: number | null;
}

export interface BreakdownRow {
  metric: 'reach' | 'views';
  followType: string; // FOLLOWER | NON_FOLLOWER | UNKNOWN
  productType: string; // STORY | REEL | POST | CAROUSEL_CONTAINER | AD
  value: number;
}

export interface MediaMetricValues {
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  totalInteractions: number | null;
  replies: number | null;
  tapsForward: number | null;
  tapsBack: number | null;
  exits: number | null;
  // Plan 11b extras: optional so a snapshot without them stays valid; missing = not captured (stored as null, never 0)
  swipeForward?: number | null;
  follows?: number | null;
  profileVisits?: number | null;
  profileActivity?: Record<string, number> | null;
  avgWatchMs?: number | null;
  totalWatchMs?: number | null;
  skipRate?: number | null;
}

/** The optional per-media metrics (lib/instagram/metrics.ts EXTRA_GROUPS), written onto an existing snapshot. */
export type MediaExtras = Pick<MediaMetricValues, M.ExtraField>;

const NO_METRICS: MediaMetricValues = { reach: null, views: null, likes: null, comments: null, shares: null, saves: null, totalInteractions: null, replies: null, tapsForward: null, tapsBack: null, exits: null };

export type IgErrorClass = 'auth' | 'app_rate_limit' | 'rate_limit' | 'no_data' | 'gone' | 'transient' | 'other';

/** What a failed call means for the sync. Callers decide what to do with no_data / gone (only media insights skip). */
export function classifyIgError(e: unknown): IgErrorClass {
  if (!(e instanceof InstagramApiError)) return 'other';
  if (e.kind === 'network') return 'transient';
  const c = e.code;
  if (c !== undefined && ((M.IG_ERROR.auth as readonly number[]).includes(c) || (c >= 200 && c <= 299))) return 'auth';
  if (c !== undefined && (M.IG_ERROR.appRateLimit as readonly number[]).includes(c)) return 'app_rate_limit';
  if ((c !== undefined && (M.IG_ERROR.rateLimit as readonly number[]).includes(c)) || e.status === 429) return 'rate_limit';
  if (c === M.IG_ERROR.notEnoughViewers || (c === M.IG_ERROR.invalidParam && e.subcode === M.IG_ERROR.preConversionSubcode)) return 'no_data';
  if (c === M.IG_ERROR.invalidParam && e.subcode === M.IG_ERROR.objectMissingSubcode) return 'gone';
  if ((c !== undefined && (M.IG_ERROR.transient as readonly number[]).includes(c)) || (e.status ?? 0) >= 500) return 'transient';
  if (e.status === 401) return 'auth';
  return 'other';
}

/** Only auth and rate-limit problems may stop a job; everything else in an optional extra capture is skipped. */
export const isFatalIgError = (e: unknown): boolean => ['auth', 'app_rate_limit', 'rate_limit'].includes(classifyIgError(e));

/**
 * Meta said this metric/field is not available here (code 100 + the "not supported" wording). Never true for a
 * pre-conversion post (no data, 2108006) or a deleted object (33), and never for transient or network errors, so a
 * hiccup can not be mistaken for "unsupported" and poison the capability memory.
 */
export function isUnsupported(e: unknown): boolean {
  return e instanceof InstagramApiError && e.kind !== 'network' && e.code === M.IG_ERROR.invalidParam && e.unsupported && e.subcode !== M.IG_ERROR.preConversionSubcode && e.subcode !== M.IG_ERROR.objectMissingSubcode;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function igData(apiVersion: string, fetchFn: typeof fetch = fetch) {
  const getUrl = (url: string) => call('data', fetchFn, url, graphInit());
  const get = (path: string, params: Record<string, string | number>, token: string) => {
    const u = new URL(`${HOST}/${apiVersion}/${path}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    u.searchParams.set('access_token', token);
    return getUrl(u.toString());
  };

  /**
   * Follows paging.next until maxItems, the last page, a page reaching media older than stopBefore, a page cap (items the
   * parser skips must not let a long cursor be walked to the end), or timeUp() (the tick's budget). Returns what it has.
   */
  async function listPaged(path: string, token: string, story: boolean, maxItems: number, fields: string, stopBefore?: string, timeUp?: () => boolean): Promise<IgMediaItem[]> {
    const out: IgMediaItem[] = [];
    const maxPages = Math.ceil(maxItems / M.MEDIA_PAGE_SIZE) + 1;
    let body = await get(path, { fields, limit: M.MEDIA_PAGE_SIZE }, token);
    for (let pages = 1; ; pages++) {
      const page = parseMediaPage(body, story);
      const details = mediaDetailsById(body);
      for (const item of page.items) {
        if (out.length >= maxItems) return out;
        out.push({ ...item, details: details.get(item.id) });
      }
      const reachedOld = stopBefore !== undefined && page.items.some((i) => i.postedAt < stopBefore);
      // the next URL carries the token: only ever follow it to Instagram's own host
      if (!page.next || reachedOld || out.length >= maxItems || pages >= maxPages || timeUp?.() || !page.next.startsWith(`${HOST}/`)) return out;
      body = await getUrl(page.next);
    }
  }

  return {
    async profile(token: string): Promise<{ followersCount: number | null; followingCount: number | null; mediaCount: number | null }> {
      const b = await get('me', { fields: M.PROFILE_FIELDS }, token);
      return { followersCount: num(b.followers_count), followingCount: num(b.follows_count), mediaCount: num(b.media_count) };
    },

    /** One insight day of reach and views split by follower type x product type (two calls). Rows with no value are omitted. */
    async accountDayBreakdown(token: string, since: number, until: number): Promise<BreakdownRow[]> {
      const rows: BreakdownRow[] = [];
      for (const metric of M.BREAKDOWN_METRICS) {
        const r = parseBreakdown(await get('me/insights', { metric_type: 'total_value', period: 'day', since, until, metric, breakdown: M.BREAKDOWN_DIMS }, token), metric);
        for (const [key, value] of Object.entries(r)) {
          const [followType, productType] = key.split('|');
          if (followType && productType) rows.push({ metric, followType, productType, value });
        }
      }
      return rows;
    },

    /** One insight day: since/until are unix seconds of that day's start and the next day's start. */
    async accountDay(token: string, since: number, until: number): Promise<AccountDayValues> {
      const base = { metric_type: 'total_value', period: 'day', since, until };
      const t = parseTotals(await get('me/insights', { ...base, metric: M.ACCOUNT_DAY_METRICS.join(',') }, token));
      const f = parseBreakdown(await get('me/insights', { ...base, metric: M.FOLLOWS_METRIC, breakdown: M.FOLLOWS_BREAKDOWN }, token), M.FOLLOWS_METRIC);
      return {
        reach: t.reach ?? null,
        views: t.views ?? null,
        accountsEngaged: t.accounts_engaged ?? null,
        totalInteractions: t.total_interactions ?? null,
        linkTaps: t.profile_links_taps ?? null,
        follows: f[M.FOLLOW_TYPE.follows] ?? null,
        unfollows: f[M.FOLLOW_TYPE.unfollows] ?? null,
      };
    },

    listMedia: (token: string, maxItems: number, stopBefore?: string, timeUp?: () => boolean) => listPaged('me/media', token, false, maxItems, M.MEDIA_FIELDS, stopBefore, timeUp),
    /** withUrls=false: the base fields only (fallback when Meta rejects the URL fields on Stories). */
    listStories: (token: string, withUrls = true) => listPaged('me/stories', token, true, 100, withUrls ? M.STORY_FIELDS : M.MEDIA_BASE_FIELDS),

    async feedInsights(token: string, mediaId: string): Promise<MediaMetricValues> {
      const t = parseTotals(await get(`${mediaId}/insights`, { metric: M.FEED_METRICS.join(',') }, token));
      return { ...NO_METRICS, reach: t.reach ?? null, views: t.views ?? null, likes: t.likes ?? null, comments: t.comments ?? null, shares: t.shares ?? null, saves: t.saved ?? null, totalInteractions: t.total_interactions ?? null };
    },

    async storyInsights(token: string, mediaId: string): Promise<MediaMetricValues> {
      const t = parseTotals(await get(`${mediaId}/insights`, { metric: M.STORY_METRICS.join(',') }, token));
      const nav = parseBreakdown(await get(`${mediaId}/insights`, { metric: M.STORY_NAVIGATION_METRIC, breakdown: M.STORY_NAVIGATION_BREAKDOWN }, token), M.STORY_NAVIGATION_METRIC);
      const navUpper = Object.fromEntries(Object.entries(nav).map(([k, v]) => [k.toUpperCase(), v]));
      return {
        ...NO_METRICS,
        reach: t.reach ?? null,
        views: t.views ?? null,
        replies: t.replies ?? null,
        shares: t.shares ?? null,
        totalInteractions: t.total_interactions ?? null,
        tapsForward: navUpper.TAP_FORWARD ?? null,
        tapsBack: navUpper.TAP_BACK ?? null,
        exits: navUpper.TAP_EXIT ?? null,
        swipeForward: navUpper.SWIPE_FORWARD ?? null,
      };
    },

    /**
     * One optional metric group for one media item (a SEPARATE call; see EXTRA_GROUPS). Plain metrics -> { metric: n };
     * a breakdown group -> { dimension: n } of its single metric. Empty object when Meta sends nothing.
     */
    async extraInsights(token: string, mediaId: string, metrics: readonly string[], breakdown?: string): Promise<Record<string, number>> {
      const body = await get(`${mediaId}/insights`, { metric: metrics.join(','), ...(breakdown ? { breakdown } : {}) }, token);
      return breakdown ? parseBreakdown(body, metrics[0]) : parseTotals(body);
    },

    async audience(token: string, kind: M.AudienceKind): Promise<Record<string, number>> {
      const params = { metric: M.DEMOGRAPHICS_METRIC, period: 'lifetime', metric_type: 'total_value', timeframe: M.DEMOGRAPHICS_TIMEFRAME, breakdown: M.DEMOGRAPHIC_BREAKDOWNS[kind] };
      return parseBreakdown(await get('me/insights', params, token), M.DEMOGRAPHICS_METRIC);
    },

    async onlineFollowers(token: string, since: number, until: number) {
      return parseOnlineFollowers(await get('me/insights', { metric: M.ONLINE_FOLLOWERS_METRIC, period: 'lifetime', since, until }, token));
    },

    /**
     * One page of a media item's top-level comments. `next` (from the previous page) carries the token, so it is only
     * followed to Instagram's own host; any other URL ends the paging.
     */
    async commentsPage(token: string, mediaId: string, next?: string): Promise<{ items: IgComment[]; next: string | null }> {
      if (next !== undefined && !next.startsWith(`${HOST}/`)) return { items: [], next: null };
      const body = next !== undefined ? await getUrl(next) : await get(`${mediaId}/comments`, { fields: M.COMMENT_FIELDS, limit: M.COMMENT_PAGE_SIZE }, token);
      return parseCommentsPage(body);
    },

    /** Fresh cover URLs for one media item (they expire within days, so they are asked right before the copy). */
    async mediaCover(token: string, mediaId: string): Promise<MediaDetails> {
      return parseMediaDetails(await get(mediaId, { fields: M.COVER_FIELDS }, token));
    },

    refresh: (token: string) => refreshLongLived(token, fetchFn),
  };
}

export type IgData = ReturnType<typeof igData>;
