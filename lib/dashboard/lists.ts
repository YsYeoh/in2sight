// Posts and Stories tab lists (ux-polish design §4.2, §8 calls 1–3): the URL state, the posted-date window, page sizes
// and the TypeScript mirror of the SQL order (post_list / story_list, supabase/migrations/20261027000001_post_story_lists.sql).
// The mirror serves the tabs while that migration is not applied and is the tested reference of the SQL order
// (tests/lists.test.ts uses the fixture the plan's dry run ran through the SQL). Pure: today and tz are inputs.
import { FEED_FORMATS } from '@/lib/analysis/posts';
import { parseDay, parsePostsView, storyDays, type FeedFormat, type PostsView, type PostView, type StoryView } from '@/lib/dashboard/content';
import { addDays } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';
import { MAX_DAYS } from '@/lib/time-scope/scope';

type Params = Record<string, string | string[] | undefined>;

export const LIST_PRESETS = ['7d', '30d', '90d', 'year'] as const;
export type ListPreset = (typeof LIST_PRESETS)[number];
/** The posted-date filter: a preset, custom days (either end may be open), or neither = All time. */
export interface ListDates {
  pr: ListPreset | null;
  from: string | null;
  to: string | null;
}
export const ALL_TIME: ListDates = { pr: null, from: null, to: null };

export const POST_SORTS = ['newest', 'oldest', 'reach', 'reach_asc', 'views', 'views_asc', 'engagement', 'engagement_asc'] as const;
export type PostSort = (typeof POST_SORTS)[number];
export type PostSortKey = 'date' | 'reach' | 'views' | 'engagement';
export const STORY_SORTS = ['newest', 'views', 'exit'] as const;
export type StorySort = (typeof STORY_SORTS)[number];

export const POST_GRID_PAGE = 24;
export const POST_TABLE_PAGE = 50; // also the automatic view (no ?view): the server cannot know the width; desktop-first
export const STORY_DAYS_PER_PAGE = 7;
export const STORY_PAGE_SIZE = 48;
export const SEARCH_MAX = 100;

export interface PostListState {
  dates: ListDates;
  q: string; // '' = no search
  format: FeedFormat | null;
  tag: string | null; // a tag id (lower-case uuid), 'untagged', or no filter
  sort: PostSort;
  page: number; // 1-based
  view: PostsView | null;
}
export interface StoryListState {
  dates: ListDates;
  measured: boolean | null; // null = all Stories
  sort: StorySort;
  page: number; // 1-based: days (newest) or Stories (other sorts)
}

/** Every URL key the two lists own. The account page's Suspense key ignores them, so the toolbar never remounts. */
export const LIST_KEYS = ['pr', 'pfrom', 'pto', 'q', 'format', 'tag', 'sort', 'page', 'measured', 'view'] as const;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : null);
const pick = <T extends string>(all: readonly T[], v: string | null): T | null => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : null);
export const parsePage = (v: string | string[] | undefined) => {
  const s = one(v);
  return s !== null && /^\d{1,6}$/.test(s) && Number(s) >= 1 ? Number(s) : 1;
};

export function parseDates(sp: Params): ListDates {
  let from = parseDay(sp.pfrom);
  let to = parseDay(sp.pto);
  if (from && to && from > to) [from, to] = [to, from];
  if (from || to) return { pr: null, from, to }; // custom dates win over a preset
  return { pr: pick(LIST_PRESETS, one(sp.pr)), from: null, to: null };
}

/** Search text: inner whitespace collapsed, trimmed, at most SEARCH_MAX code points (emoji never split). */
export const cleanSearch = (v: unknown): string => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, SEARCH_MAX).join('').trim() : '');

/** Posts list state from the URL. Invalid values are dropped (defaults), never echoed back. */
export function parsePostList(sp: Params): PostListState {
  const tag = one(sp.tag);
  return {
    dates: parseDates(sp),
    q: cleanSearch(one(sp.q)),
    format: pick(FEED_FORMATS, one(sp.format)),
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    sort: pick(POST_SORTS, one(sp.sort)) ?? 'newest',
    page: parsePage(sp.page),
    view: parsePostsView(sp.view),
  };
}

/** Stories list state from the URL. Invalid values are dropped (defaults), never echoed back. */
export function parseStoryList(sp: Params): StoryListState {
  const m = one(sp.measured);
  return { dates: parseDates(sp), measured: m === 'yes' ? true : m === 'no' ? false : null, sort: pick(STORY_SORTS, one(sp.sort)) ?? 'newest', page: parsePage(sp.page) };
}

export const dateParams = (d: ListDates): Record<string, string> => (d.from || d.to ? { ...(d.from ? { pfrom: d.from } : {}), ...(d.to ? { pto: d.to } : {}) } : d.pr ? { pr: d.pr } : {});

/** The Posts tab's query, fixed order, defaults left out, then `keep` (the page's Time Scope params, carried untouched). */
export function postListParams(s: PostListState, keep: Record<string, string> = {}): Record<string, string> {
  return {
    tab: 'posts',
    ...dateParams(s.dates),
    ...(s.q ? { q: s.q } : {}),
    ...(s.format ? { format: s.format } : {}),
    ...(s.tag ? { tag: s.tag } : {}),
    ...(s.sort !== 'newest' ? { sort: s.sort } : {}),
    ...(s.page > 1 ? { page: String(s.page) } : {}),
    ...(s.view ? { view: s.view } : {}),
    ...keep,
  };
}

/** The Stories tab's query, fixed order, defaults left out, then `keep`. */
export function storyListParams(s: StoryListState, keep: Record<string, string> = {}): Record<string, string> {
  return {
    tab: 'stories',
    ...dateParams(s.dates),
    ...(s.measured !== null ? { measured: s.measured ? 'yes' : 'no' } : {}),
    ...(s.sort !== 'newest' ? { sort: s.sort } : {}),
    ...(s.page > 1 ? { page: String(s.page) } : {}),
    ...keep,
  };
}

export const listHref = (params: Record<string, string>): string => `?${new URLSearchParams(params)}`;
/** The Posts list with `patch` applied. Any change goes back to page 1 unless the patch sets the page. */
export const postHref = (s: PostListState, patch: Partial<PostListState>, keep: Record<string, string> = {}): string => listHref(postListParams({ ...s, page: 1, ...patch }, keep));
/** The Stories list with `patch` applied. Any change goes back to page 1 unless the patch sets the page. */
export const storyHref = (s: StoryListState, patch: Partial<StoryListState>, keep: Record<string, string> = {}): string => listHref(storyListParams({ ...s, page: 1, ...patch }, keep));

/** The days a posted-date filter covers (owner timezone, inclusive). All time and open custom ends reach back MAX_DAYS (the app-wide floor). */
export function listWindow(d: ListDates, today: string): { from: string; to: string } {
  const floor = addDays(today, -(MAX_DAYS - 1));
  if (d.from || d.to) return { from: d.from ?? floor, to: d.to ?? today };
  switch (d.pr) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: floor, to: today };
  }
}

export const postPageSize = (view: PostsView | null): number => (view === 'grid' ? POST_GRID_PAGE : POST_TABLE_PAGE);
export const storyPageSize = (sort: StorySort): number => (sort === 'newest' ? STORY_DAYS_PER_PAGE : STORY_PAGE_SIZE);
export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));
/** The page of size `to` that holds the first item of `page` at size `from` (Grid | Table keeps the place). */
export const samePlace = (page: number, from: number, to: number): number => Math.floor(((page - 1) * from) / to) + 1;

export function postSortOf(s: PostSort): { key: PostSortKey; asc: boolean } {
  if (s === 'newest' || s === 'oldest') return { key: 'date', asc: s === 'oldest' };
  const [key, dir] = s.split('_') as [Exclude<PostSortKey, 'date'>, string | undefined];
  return { key, asc: dir === 'asc' };
}

export const postSortFor = (key: PostSortKey, asc: boolean): PostSort => (key === 'date' ? (asc ? 'oldest' : 'newest') : ((asc ? `${key}_asc` : key) as PostSort));

// The SQL order: nulls last in both directions, ties newest first (posted_at desc, id desc); oldest = posted_at, id ascending.
type Dated = { id: string; postedAt: string };
const newest = (a: Dated, b: Dated) => Date.parse(b.postedAt) - Date.parse(a.postedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
const oldest = (a: Dated, b: Dated) => -newest(a, b);
function byValue<T extends Dated>(get: (x: T) => number | null, asc: boolean) {
  return (a: T, b: T) => {
    const x = get(a);
    const y = get(b);
    if (x === null || y === null) return x === y ? newest(a, b) : x === null ? 1 : -1;
    return (asc ? x - y : y - x) || newest(a, b);
  };
}
const POST_VALUES: Record<Exclude<PostSortKey, 'date'>, (p: PostView) => number | null> = { reach: (p) => p.reach, views: (p) => p.views, engagement: (p) => p.engagementRate };

export function sortPosts(posts: PostView[], sort: PostSort): PostView[] {
  const { key, asc } = postSortOf(sort);
  return [...posts].sort(key === 'date' ? (asc ? oldest : newest) : byValue(POST_VALUES[key], asc));
}

export function sortStories(stories: StoryView[], sort: StorySort): StoryView[] {
  return [...stories].sort(sort === 'views' ? byValue((s: StoryView) => s.final?.views ?? null, false) : sort === 'exit' ? byValue((s: StoryView) => s.exitRate, false) : newest);
}

/** One page of already-filtered posts (the fallback read): sorted, cut; a page past the end is page 1 (as the reader does). */
export function pagePosts(posts: PostView[], s: Pick<PostListState, 'sort' | 'page' | 'view'>): { posts: PostView[]; total: number; page: number } {
  const size = postPageSize(s.view);
  const page = s.page > pageCount(posts.length, size) ? 1 : s.page;
  return { posts: sortPosts(posts, s.sort).slice((page - 1) * size, page * size), total: posts.length, page };
}

/** One page of Stories (the fallback read): the measured filter, then whole owner-timezone days (newest) or sorted Stories. */
export function pageStories(stories: StoryView[], s: StoryListState, tz: string): { stories: StoryView[]; items: number; days: number; page: number } {
  const kept = s.measured === null ? stories : stories.filter((x) => (x.reason === null) === s.measured);
  const groups = storyDays(kept, tz);
  const size = storyPageSize(s.sort);
  const page = s.page > pageCount(s.sort === 'newest' ? groups.length : kept.length, size) ? 1 : s.page;
  const cut = s.sort === 'newest' ? groups.slice((page - 1) * size, page * size).flatMap((d) => d.stories) : sortStories(kept, s.sort).slice((page - 1) * size, page * size);
  return { stories: cut, items: kept.length, days: groups.length, page };
}
