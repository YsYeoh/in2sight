// Post-level analysis: engagement rate, top/bottom posts, format comparison, tag performance (SPEC §7).
import type { MediaKind } from '@/lib/instagram/parse';
import type { MediaTag, Post, Tag } from '@/lib/analysis/types';

const n = (v: number | null) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** (likes + comments + saves + shares) ÷ reach (SPEC §7). Missing parts count as 0; all missing, or no reach → null. */
export function engagementRate(p: Post): number | null {
  const parts = [p.likes, p.comments, p.saves, p.shares].map(n);
  const reach = n(p.reach);
  if (reach === null || reach <= 0 || parts.every((v) => v === null)) return null;
  return parts.reduce<number>((a, v) => a + (v ?? 0), 0) / reach;
}

const interactionsOf = (p: Post) => [p.likes, p.comments, p.saves, p.shares].reduce<number>((a, v) => a + (n(v) ?? 0), 0);

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Deterministic order for equal values: newer first, then id. */
const tieBreak = (a: Post, b: Post) => (a.postedAt === b.postedAt ? (a.id < b.id ? -1 : 1) : a.postedAt > b.postedAt ? -1 : 1);

/** Top (or bottom) feed posts by reach or engagement rate. Posts without that value are left out, never ranked as 0. */
export function topPosts(posts: Post[], by: 'reach' | 'engagementRate', opts: { limit?: number; order?: 'top' | 'bottom' } = {}): { post: Post; value: number }[] {
  const { limit = 5, order = 'top' } = opts;
  return posts
    .filter((p) => p.mediaType !== 'STORY')
    .map((post) => ({ post, value: by === 'reach' ? n(post.reach) : engagementRate(post) }))
    .filter((x): x is { post: Post; value: number } => x.value !== null)
    .sort((a, b) => (a.value === b.value ? tieBreak(a.post, b.post) : order === 'top' ? b.value - a.value : a.value - b.value))
    .slice(0, limit);
}

export interface GroupStats {
  posts: number; // posts in the group
  measured: number; // posts with a reach value (the base of the averages)
  avgReach: number | null;
  engagementRate: number | null; // Σ interactions ÷ Σ reach over measured posts
}

function stats(list: Post[]): GroupStats {
  const measured = list.filter((p) => (n(p.reach) ?? 0) > 0);
  const reach = measured.reduce((a, p) => a + (p.reach as number), 0);
  return {
    posts: list.length,
    measured: measured.length,
    avgReach: measured.length ? reach / measured.length : null,
    engagementRate: reach > 0 ? measured.reduce((a, p) => a + interactionsOf(p), 0) / reach : null,
  };
}

export const FEED_FORMATS: Exclude<MediaKind, 'STORY'>[] = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE'];

/** Avg reach + engagement per format, in a fixed order; formats with no posts are omitted. */
export function formatComparison(posts: Post[]): ({ mediaType: Exclude<MediaKind, 'STORY'> } & GroupStats)[] {
  return FEED_FORMATS.map((mediaType) => ({ mediaType, ...stats(posts.filter((p) => p.mediaType === mediaType)) })).filter((r) => r.posts > 0);
}

/**
 * Per-tag stats. Tags come from part 2 (`tags`, `media_tags`); a post with several tags counts for each. Tags with no
 * posts are kept (posts: 0) so the Tags page can list them; sorted by avg reach, unmeasured last, then name.
 */
export function tagPerformance(posts: Post[], mediaTags: MediaTag[], tags: Tag[]): ({ tag: Tag } & GroupStats)[] {
  const byId = new Map(posts.filter((p) => p.mediaType !== 'STORY').map((p) => [p.id, p]));
  return tags
    .map((tag) => {
      const ids = new Set(mediaTags.filter((mt) => mt.tagId === tag.id).map((mt) => mt.mediaId));
      return { tag, ...stats([...ids].map((id) => byId.get(id)).filter((p): p is Post => !!p)) };
    })
    .sort((a, b) => (b.avgReach ?? -1) - (a.avgReach ?? -1) || a.tag.name.localeCompare(b.tag.name));
}
