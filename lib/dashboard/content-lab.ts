// Content tab model (Plan 17a): "what works" from the account's own feed posts of the range. Pure: today/tz are inputs.
// The server builds everything that does not depend on a pick (formats & times, hashtags, cadence); the leaderboard is
// computed in the browser from `posts` (lib/analysis/leaderboard.ts) because its picks only change what is shown.
// Captions stay on the server: the browser gets an 80-character snippet per post (the cover's alt text).
import { captionFeatures } from '@/lib/analysis/caption';
import { cadence, frequency, type Cadence, type FrequencyRow } from '@/lib/analysis/cadence';
import { hashtagLab, type HashtagLab } from '@/lib/analysis/hashtags';
import { BOARD_GROUPS, BOARD_METRICS, type BoardGroupBy, type BoardMetric, type BoardPost } from '@/lib/analysis/leaderboard';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import { bandOf, CAPTION_BANDS, DAYPARTS, daypartAt, splitBy, type CaptionBand, type Daypart, type SplitRow } from '@/lib/analysis/splits';
import type { Tag } from '@/lib/analysis/types';
import { snippet, type FeedFormat } from '@/lib/dashboard/content';
import type { ContentRow } from '@/lib/dashboard/content-lab-read';
import type { CoverFields } from '@/lib/dashboard/detail-read';
import type { DayCounts } from '@/lib/dashboard/growth-read';
import type { WeekStart } from '@/lib/prefs';
import { localDay } from '@/lib/sync/time';
import type { DayRange } from '@/lib/time-scope/range';
import type { ResolvedScope } from '@/lib/time-scope/scope';

export const CONTENT_SECTIONS = ['leaderboards', 'formats', 'hashtags', 'cadence'] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];

export interface ContentPost extends BoardPost, CoverFields {
  mediaType: FeedFormat;
  caption: string | null; // snippet (80 characters), never the whole caption
}
export interface ContentLabModel {
  range: DayRange; // the days analysed ("All time": from the oldest post)
  posts: ContentPost[]; // newest first
  measured: number; // posts with reach > 0
  tags: Tag[];
  formats: SplitRow<FeedFormat>[];
  dayparts: SplitRow<Daypart>[];
  captions: SplitRow<CaptionBand>[];
  frequency: { weeks: number; rows: FrequencyRow[] } | null;
  hashtags: HashtagLab;
  cadence: Cadence;
}

export function buildContentLab(
  input: { rows: ContentRow[]; lastPostAt: string | null; stories: DayCounts; tags: Tag[]; connectedAt: string },
  o: { scope: ResolvedScope; today: string; tz: string; weekStart: WeekStart },
): ContentLabModel {
  const all = input.rows.filter((r) => r.mediaType !== 'STORY').map((r) => ({ r, day: localDay(new Date(r.postedAt), o.tz) }));
  const list = o.scope.listRange;
  const oldest = all.reduce<string | null>((m, x) => (m === null || x.day < m ? x.day : m), null);
  // "All time" reads back to the 5-year floor: start at the oldest post, so the years before it are not empty weeks
  const range = { from: o.scope.preset === 'all' ? (oldest ?? list.to) : list.from, to: list.to };
  const inRange = all.filter((x) => x.day >= range.from && x.day <= range.to);
  const rich = inRange.map(({ r, day }) => ({ r, day, f: captionFeatures(r.caption), reach: r.latest?.reach ?? null }));
  const connectDay = localDay(new Date(input.connectedAt), o.tz);
  const storiesFrom = [range.from, connectDay, input.stories.from ?? range.from].reduce((a, b) => (b > a ? b : a));
  return {
    range,
    posts: rich.map(({ r }) => ({ id: r.id, mediaType: r.mediaType as FeedFormat, postedAt: r.postedAt, tagIds: r.tagIds, values: r.latest, cover: r.cover, slides: r.slides, caption: snippet(r.caption) })),
    measured: rich.filter((x) => typeof x.reach === 'number' && x.reach > 0).length,
    tags: input.tags,
    formats: splitBy(rich, FEED_FORMATS, (x) => x.r.mediaType as FeedFormat),
    dayparts: splitBy(rich, DAYPARTS, (x) => daypartAt(x.r.postedAt, o.tz)),
    captions: splitBy(rich, CAPTION_BANDS, (x) => bandOf(x.f.length)),
    frequency: frequency(rich, range, o.weekStart),
    hashtags: hashtagLab(rich.map((x) => ({ hashtags: x.f.hashtags, postedAt: x.r.postedAt, reach: x.reach, saves: x.r.latest?.saves ?? null }))),
    cadence: cadence({
      postDays: rich.map((x) => x.day),
      lastPostDay: input.lastPostAt === null ? null : localDay(new Date(input.lastPostAt), o.tz),
      storyDays: input.stories.days,
      storiesFrom,
      range,
      today: o.today,
      weekStart: o.weekStart,
    }),
  };
}

// URL state of the tab's picks (UI standard 14: a pick that only changes what is shown is written with
// history.replaceState). Allow-listed; anything else falls back to the default and is never echoed.
export interface ContentPicks {
  section: ContentSection;
  metric: BoardMetric;
  format: FeedFormat | null; // URL key `fmt` (the Posts tab owns `format`)
  group: BoardGroupBy;
}
const pick = <T extends string>(all: readonly T[], sp: URLSearchParams, key: string): T | null => {
  const v = sp.getAll(key);
  return v.length === 1 && (all as readonly string[]).includes(v[0]) ? (v[0] as T) : null;
};
export function parseContentPicks(sp: URLSearchParams): ContentPicks {
  return { section: pick(CONTENT_SECTIONS, sp, 'section') ?? 'leaderboards', metric: pick(BOARD_METRICS, sp, 'metric') ?? 'reach', format: pick(FEED_FORMATS, sp, 'fmt'), group: pick(BOARD_GROUPS, sp, 'group') ?? 'none' };
}
/** The same URL with the picks set (defaults removed); every other parameter kept. Returns '?…'. */
export function contentHref(sp: URLSearchParams, p: ContentPicks): string {
  const q = new URLSearchParams(sp);
  const set = (k: string, v: string | null, dflt: string | null) => (v === null || v === dflt ? q.delete(k) : q.set(k, v));
  set('section', p.section, 'leaderboards');
  set('metric', p.metric, 'reach');
  set('fmt', p.format, null);
  set('group', p.group, 'none');
  return `?${q.toString()}`;
}
