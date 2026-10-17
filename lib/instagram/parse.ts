// Pure parsers for Instagram API responses. Unknown or missing values become null / are skipped, never 0:
// Meta returns an empty data set (not 0) when a metric is unavailable.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const entries = (body: unknown): Obj[] => (isObj(body) && Array.isArray(body.data) ? body.data.filter(isObj) : []);

/** Insight entry value: total_value.value (account insights) or values[0].value (media insights). */
function entryValue(e: Obj): number | null {
  const tv = isObj(e.total_value) ? num(e.total_value.value) : null;
  if (tv !== null) return tv;
  const first = Array.isArray(e.values) && isObj(e.values[0]) ? e.values[0] : null;
  return first ? num(first.value) : null;
}

/** { metricName: value } for every entry that has a numeric value. */
export function parseTotals(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries(body)) {
    const name = str(e.name);
    const v = entryValue(e);
    if (name && v !== null) out[name] = v;
  }
  return out;
}

/** First breakdown of `metric` as { "dim1|dim2": value }, e.g. { "25-34|F": 330 }. Empty object if absent. */
export function parseBreakdown(body: unknown, metric: string): Record<string, number> {
  const e = entries(body).find((x) => x.name === metric);
  const tv = e && isObj(e.total_value) ? e.total_value : null;
  const first = tv && Array.isArray(tv.breakdowns) && isObj(tv.breakdowns[0]) ? tv.breakdowns[0] : null;
  const results = first && Array.isArray(first.results) ? first.results.filter(isObj) : [];
  const out: Record<string, number> = {};
  for (const r of results) {
    const v = num(r.value);
    if (!Array.isArray(r.dimension_values) || v === null) continue;
    out[r.dimension_values.map(String).join('|')] = v;
  }
  return out;
}

export type MediaKind = 'IMAGE' | 'CAROUSEL_ALBUM' | 'REELS' | 'STORY';
export interface IgMediaItem {
  id: string;
  kind: MediaKind;
  caption: string | null;
  permalink: string | null;
  postedAt: string; // ISO UTC
  /** Extra fields from the listing (counts, product type, cover URLs, children); absent = not requested/parsed. */
  details?: MediaDetails;
}

export interface MediaChild {
  mediaType: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
}
export interface MediaDetails {
  mediaType: string | null;
  productType: string | null;
  likeCount: number | null;
  commentsCount: number | null;
  isSharedToFeed: boolean | null;
  mediaUrl: string | null; // signed CDN URL: never logged, never stored
  thumbnailUrl: string | null; // signed CDN URL: never logged, never stored
  childrenCount: number | null;
  children: MediaChild[] | null; // carousels: the first 10, in order
}

/** One media object's optional fields. Missing or malformed values are null (never 0). */
export function parseMediaDetails(v: unknown): MediaDetails {
  const m = isObj(v) ? v : {};
  const kids = isObj(m.children) && Array.isArray(m.children.data) ? m.children.data.filter(isObj) : null;
  return {
    mediaType: str(m.media_type),
    productType: str(m.media_product_type),
    likeCount: num(m.like_count),
    commentsCount: num(m.comments_count),
    isSharedToFeed: typeof m.is_shared_to_feed === 'boolean' ? m.is_shared_to_feed : null,
    mediaUrl: str(m.media_url),
    thumbnailUrl: str(m.thumbnail_url),
    childrenCount: kids ? kids.length : null,
    children: kids ? kids.slice(0, 10).map((c) => ({ mediaType: str(c.media_type), mediaUrl: str(c.media_url), thumbnailUrl: str(c.thumbnail_url) })) : null,
  };
}

/** Details of every item on a media page, by id (parseMediaPage keeps its original item shape). */
export function mediaDetailsById(body: unknown): Map<string, MediaDetails> {
  const out = new Map<string, MediaDetails>();
  for (const m of entries(body)) {
    const id = typeof m.id === 'number' ? String(m.id) : str(m.id);
    if (id) out.set(id, parseMediaDetails(m));
  }
  return out;
}

/** Every feed video is a Reel since 2022, so VIDEO maps to REELS when media_product_type is unavailable. */
function kindOf(m: Obj, story: boolean): MediaKind | null {
  if (story || m.media_product_type === 'STORY') return 'STORY';
  if (m.media_product_type === 'REELS' || m.media_type === 'VIDEO') return 'REELS';
  if (m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM') return m.media_type;
  return null;
}

/** Instagram timestamps look like 2026-10-13T10:00:00+0000. Returns ISO UTC or null. */
export function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** A page of /me/media or /me/stories. Items with an unknown type or no timestamp are skipped. */
export function parseMediaPage(body: unknown, story: boolean): { items: IgMediaItem[]; next: string | null } {
  const items: IgMediaItem[] = [];
  for (const m of entries(body)) {
    const id = typeof m.id === 'number' ? String(m.id) : str(m.id);
    const kind = kindOf(m, story);
    const postedAt = toIso(m.timestamp);
    if (!id || !kind || !postedAt) continue;
    items.push({ id, kind, caption: str(m.caption), permalink: str(m.permalink), postedAt });
  }
  const paging = isObj(body) && isObj(body.paging) ? body.paging : null;
  return { items, next: paging ? str(paging.next) : null };
}

/** A comment on the owner's media. text and username are third-party personal data: never logged. */
export interface IgComment {
  id: string;
  text: string | null;
  username: string | null;
  likeCount: number | null;
  commentedAt: string; // ISO UTC
}

/** A page of /{media-id}/comments. Items without an id or a valid timestamp are skipped. */
export function parseCommentsPage(body: unknown): { items: IgComment[]; next: string | null } {
  const items: IgComment[] = [];
  for (const c of entries(body)) {
    const id = typeof c.id === 'number' ? String(c.id) : str(c.id);
    const commentedAt = toIso(c.timestamp);
    if (!id || !commentedAt) continue;
    items.push({ id, text: typeof c.text === 'string' ? c.text : null, username: str(c.username), likeCount: num(c.like_count), commentedAt });
  }
  const paging = isObj(body) && isObj(body.paging) ? body.paging : null;
  return { items, next: paging ? str(paging.next) : null };
}

/**
 * The insight day an online_followers value belongs to. end_time marks the END of the day it covers (midnight in
 * Instagram's day, e.g. 07:00Z = Pacific midnight); stepping back 12h lands safely inside that day.
 */
export function insightDay(endTime: string): string | null {
  const iso = toIso(endTime);
  return iso ? new Date(Date.parse(iso) - 12 * 3_600_000).toISOString().slice(0, 10) : null;
}

/** online_followers values -> [{ day, hourly[24] }]. Empty values (accounts under 100 followers) are skipped. */
export function parseOnlineFollowers(body: unknown): { day: string; hourly: number[] }[] {
  const e = entries(body).find((x) => x.name === 'online_followers');
  const values = e && Array.isArray(e.values) ? e.values.filter(isObj) : [];
  const out: { day: string; hourly: number[] }[] = [];
  for (const v of values) {
    const day = typeof v.end_time === 'string' ? insightDay(v.end_time) : null;
    if (!day || !isObj(v.value) || Object.keys(v.value).length === 0) continue;
    const byHour = v.value;
    out.push({ day, hourly: Array.from({ length: 24 }, (_, h) => num(byHour[String(h)]) ?? 0) });
  }
  return out;
}
