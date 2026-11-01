// Hashtag lab of the Content tab (Plan 17a; creator-toolkit design §6): the hashtags of the account's OWN captions and
// how the posts that used each one did. Pure. Hashtags come from captionFeatures (lib/analysis/caption.ts, the one
// hashtag rule; 17c's auto-tagging reuses it). No Meta hashtag API. Guards as the caption lab: nothing below
// CAPTION_MIN_POSTS measured posts in the range, no median below CAPTION_MIN_SIDE posts of one hashtag.
import { CAPTION_MIN_POSTS, CAPTION_MIN_SIDE } from '@/lib/analysis/caption';
import { median } from '@/lib/analysis/posts';

export const HASHTAG_ROWS = 50;

export interface HashtagRow {
  tag: string; // lower case, without '#'
  posts: number;
  n: number; // measured posts (reach > 0)
  medianReach: number | null; // null below CAPTION_MIN_SIDE
  medianSaves: number | null; // over measured posts that have saves; null below CAPTION_MIN_SIDE
  lastUsed: string; // ISO of the newest post with it
}
export interface HashtagLab {
  posts: number;
  measured: number;
  withHashtags: number; // posts with at least one hashtag
  baseline: number | null; // median reach of every measured post: the line each hashtag is read against
  rows: HashtagRow[] | null; // null below CAPTION_MIN_POSTS measured posts; best median first, then most used
  more: number; // hashtags not shown (past HASHTAG_ROWS)
}

const measured = (r: number | null): r is number => typeof r === 'number' && r > 0;

export function hashtagLab(posts: { hashtags: string[]; postedAt: string; reach: number | null; saves: number | null }[]): HashtagLab {
  const reach = posts.flatMap((p) => (measured(p.reach) ? [p.reach] : []));
  const head = { posts: posts.length, measured: reach.length, withHashtags: posts.filter((p) => p.hashtags.length > 0).length, baseline: median(reach) };
  if (reach.length < CAPTION_MIN_POSTS) return { ...head, rows: null, more: 0 };
  const by = new Map<string, typeof posts>();
  for (const p of posts) for (const tag of new Set(p.hashtags)) by.set(tag, [...(by.get(tag) ?? []), p]);
  const rows = [...by].map(([tag, list]): HashtagRow => {
    const r = list.flatMap((p) => (measured(p.reach) ? [p.reach] : []));
    const s = list.flatMap((p) => (measured(p.reach) && typeof p.saves === 'number' ? [p.saves] : []));
    return {
      tag,
      posts: list.length,
      n: r.length,
      medianReach: r.length >= CAPTION_MIN_SIDE ? median(r) : null,
      medianSaves: s.length >= CAPTION_MIN_SIDE ? median(s) : null,
      lastUsed: list.reduce((m, p) => (Date.parse(p.postedAt) > Date.parse(m) ? p.postedAt : m), list[0].postedAt),
    };
  });
  rows.sort((a, b) => (b.medianReach ?? -1) - (a.medianReach ?? -1) || b.posts - a.posts || (a.tag < b.tag ? -1 : 1));
  return { ...head, rows: rows.slice(0, HASHTAG_ROWS), more: Math.max(0, rows.length - HASHTAG_ROWS) };
}
