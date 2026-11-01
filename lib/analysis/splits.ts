// Formats & times of the Content tab (Plan 17a; creator-toolkit design §6 "Format & time lab"): median reach per post
// split by format, owner-timezone day-part and caption length. Pure. A median needs SPLIT_MIN measured posts.
import { median } from '@/lib/analysis/posts';
import { localHour } from '@/lib/sync/time';

export const SPLIT_MIN = 5; // measured posts (reach > 0) a median needs: the Post Lab guard

/** Owner-timezone hours: night 0-5, morning 6-11, afternoon 12-17, evening 18-23. */
export const DAYPARTS = ['night', 'morning', 'afternoon', 'evening'] as const;
export type Daypart = (typeof DAYPARTS)[number];
/** The day-part of an instant in the owner's timezone (Intl: DST-safe). */
export const daypartAt = (iso: string, tz: string): Daypart => DAYPARTS[Math.floor(localHour(new Date(iso), tz) / 6)];

/** Caption length in characters (code points): none, short = what the feed shows before "more" (125), medium to 500, long. */
export const CAPTION_BANDS = ['none', 'short', 'medium', 'long'] as const;
export type CaptionBand = (typeof CAPTION_BANDS)[number];
export const SHORT_CAPTION = 125;
export const MEDIUM_CAPTION = 500;
export const bandOf = (chars: number): CaptionBand => (chars === 0 ? 'none' : chars <= SHORT_CAPTION ? 'short' : chars <= MEDIUM_CAPTION ? 'medium' : 'long');

export interface SplitRow<K extends string> {
  key: K;
  posts: number;
  n: number; // measured posts (reach > 0)
  medianReach: number | null; // null below SPLIT_MIN
}

/** One row per key that has posts, in the order of `keys`. */
export function splitBy<K extends string, P extends { reach: number | null }>(posts: P[], keys: readonly K[], keyOf: (p: P) => K): SplitRow<K>[] {
  return keys.flatMap((key) => {
    const list = posts.filter((p) => keyOf(p) === key);
    const reach = list.flatMap((p) => (typeof p.reach === 'number' && p.reach > 0 ? [p.reach] : []));
    return list.length ? [{ key, posts: list.length, n: reach.length, medianReach: reach.length >= SPLIT_MIN ? median(reach) : null }] : [];
  });
}
