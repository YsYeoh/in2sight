// Posts tab, Stories tab and Tags page models. Pure: now/tz are inputs.
import { engagementRate, FEED_FORMATS, groupStats, tagPerformance, type GroupStats } from '@/lib/analysis/posts';
import type { MissingReason, Tag } from '@/lib/analysis/types';
import type { CoverFields, PostRow, StoryRow, StorySnapshot } from '@/lib/dashboard/detail-read';
import type { MediaKind } from '@/lib/instagram/parse';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export type FeedFormat = Exclude<MediaKind, 'STORY'>;
export interface PostFilters {
  format: FeedFormat | null;
  tag: string | 'untagged' | null; // a tag id (lower-case uuid), 'untagged', or no filter
  from: string | null; // 'YYYY-MM-DD' owner-timezone day, inclusive
  to: string | null;
  q?: string; // search: a case-insensitive substring of the caption or of a tag name ('' or absent = none)
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
/** A real calendar day 'YYYY-MM-DD' or null: '2026-02-31' and '2026-13-01' are rejected (they do not round-trip). */
export function parseDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}

/** Posts-tab filters from the URL. Invalid values are dropped (no filter), never echoed back. */
export function parsePostFilters(sp: Params): PostFilters {
  const format = one(sp.format);
  const tag = one(sp.tag);
  let from = parseDay(sp.from);
  let to = parseDay(sp.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    format: format && (FEED_FORMATS as string[]).includes(format) ? (format as FeedFormat) : null,
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    from,
    to,
  };
}

/** Posts tab layout from `?view=`: an explicit grid or table; null = automatic (grid below md, table from md; CSS only). */
export type PostsView = 'grid' | 'table';
export const parsePostsView = (v: string | string[] | undefined): PostsView | null => (v === 'grid' || v === 'table' ? v : null);

const CAPTION_SNIPPET = 80;

/** First 80 code points of a caption on one line (emoji and CJK never split in half). */
export function snippet(caption: string | null): string | null {
  if (!caption) return null;
  const chars = [...caption.replace(/\s+/g, ' ').trim()];
  if (chars.length === 0) return null;
  return chars.length > CAPTION_SNIPPET ? `${chars.slice(0, CAPTION_SNIPPET).join('')}…` : chars.join('');
}

export interface PostView extends CoverFields {
  id: string;
  mediaType: FeedFormat;
  postedAt: string;
  permalink: string | null;
  caption: string | null; // snippet
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  engagementRate: number | null;
  tags: Tag[]; // sorted by name
}

/** The search of post_list: the caption or a tag name contains `q` (already lower-case). */
const matches = (p: PostRow, q: string, byId: Map<string, Tag>) => (p.caption ?? '').toLowerCase().includes(q) || p.tagIds.some((id) => byId.get(id)?.name.toLowerCase().includes(q) ?? false);

export function buildPosts(rows: PostRow[], tags: Tag[], f: PostFilters, tz: string): PostView[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  return rows
    .filter((p) => p.mediaType !== 'STORY')
    .filter((p) => !f.format || p.mediaType === f.format)
    .filter((p) => (f.tag === null ? true : f.tag === 'untagged' ? p.tagIds.length === 0 : p.tagIds.includes(f.tag)))
    .filter((p) => !f.q || matches(p, f.q.toLowerCase(), byId))
    .filter((p) => {
      if (!f.from && !f.to) return true;
      const day = localDay(new Date(p.postedAt), tz);
      return (!f.from || day >= f.from) && (!f.to || day <= f.to);
    })
    .map((p) => ({
      id: p.id,
      mediaType: p.mediaType as FeedFormat,
      postedAt: p.postedAt,
      permalink: p.permalink,
      caption: snippet(p.caption),
      reach: p.reach,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      saves: p.saves,
      shares: p.shares,
      engagementRate: engagementRate(p),
      cover: p.cover,
      slides: p.slides,
      tags: p.tagIds
        .map((id) => byId.get(id))
        .filter((t): t is Tag => !!t)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

export interface StoryView extends CoverFields {
  id: string;
  postedAt: string;
  permalink: string | null;
  live: boolean;
  final: StorySnapshot | null; // last snapshot before expiry = the story's final numbers (SPEC section 5)
  exitRate: number | null; // exits / views (SPEC section 7)
  progression: (number | null)[]; // views per snapshot, oldest first
  snapshots: number;
  reason: MissingReason | null; // needs_5_viewers when Instagram never shared metrics
}

const DAY_MS = 86_400_000;

/** A Story with its final snapshot already chosen: what story_list returns, and what buildStories derives from the snapshots. */
export interface StoryFinal extends CoverFields {
  id: string;
  postedAt: string;
  expiresAt: string | null;
  permalink: string | null;
  final: StorySnapshot | null; // null = Instagram never shared numbers (under 5 viewers)
  snapshots: number;
  progression: (number | null)[]; // views per snapshot, oldest first
}

const expiryOf = (s: { postedAt: string; expiresAt: string | null }) => (s.expiresAt ? Date.parse(s.expiresAt) : Date.parse(s.postedAt) + DAY_MS);

/** The Stories tab's view of one Story; the exit rate lives here only (SPEC section 7). */
export function storyView(s: StoryFinal, now: Date): StoryView {
  const views = s.final?.views ?? null;
  return {
    id: s.id,
    postedAt: s.postedAt,
    permalink: s.permalink,
    cover: s.cover,
    live: now.getTime() < expiryOf(s),
    final: s.final,
    exitRate: s.final && s.final.exits !== null && views !== null && views > 0 ? s.final.exits / views : null,
    progression: s.progression,
    snapshots: s.snapshots,
    reason: s.final ? null : 'needs_5_viewers',
  };
}

/** final = the last snapshot before expiry, else the last one (the same rule as story_list in SQL). */
export function buildStories(stories: StoryRow[], now: Date): StoryView[] {
  return stories.map((s) => {
    const before = s.snapshots.filter((x) => Date.parse(x.capturedAt) <= expiryOf(s));
    const final = before[before.length - 1] ?? s.snapshots[s.snapshots.length - 1] ?? null;
    return storyView({ id: s.id, postedAt: s.postedAt, expiresAt: s.expiresAt, permalink: s.permalink, cover: s.cover, final, snapshots: s.snapshots.length, progression: s.snapshots.map((x) => x.views) }, now);
  });
}

/** Stories by owner-timezone day for the filmstrip: days newest first, the Stories of a day oldest first (the order they played). */
export function storyDays(stories: StoryView[], tz: string): { day: string; stories: StoryView[] }[] {
  const byDay = new Map<string, StoryView[]>();
  for (const s of stories) {
    if (Number.isNaN(Date.parse(s.postedAt))) continue;
    const day = localDay(new Date(s.postedAt), tz);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, stories: list.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt)) }));
}

/** Below this many measured posts a tag's averages are shown greyed with a reason. */
export const MIN_TAG_POSTS = 5;

export type TagStat = GroupStats & { reason: MissingReason | null };

/** Per-tag performance plus the "untagged" bucket, over feed posts of every account in scope. */
export function buildTagStats(posts: PostRow[], tags: Tag[]): { rows: ({ tag: Tag } & TagStat)[]; untagged: TagStat } {
  const feed = posts.filter((p) => p.mediaType !== 'STORY');
  const mediaTags = feed.flatMap((p) => p.tagIds.map((tagId) => ({ mediaId: p.id, tagId })));
  const reason = (s: GroupStats): MissingReason | null => (s.measured < MIN_TAG_POSTS ? 'few_posts' : null);
  const untagged = groupStats(feed.filter((p) => p.tagIds.length === 0));
  return {
    rows: tagPerformance(feed, mediaTags, tags).map((r) => ({ ...r, reason: reason(r) })),
    untagged: { ...untagged, reason: reason(untagged) },
  };
}
