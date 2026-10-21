// The follower diff of Plan 15b: two snapshots of an account's export → five lists by name. Pure set arithmetic on
// lower-cased usernames (Sets: 50,000 × 50,000 in milliseconds). Snapshot-based: it only knows the two files, not
// what happened in between (someone who followed and unfollowed between them appears in neither).
import type { Person } from '@/lib/followers/parse';

export const FOLLOWER_LISTS = ['new', 'lost', 'theyDontFollow', 'iDontFollow', 'mutual'] as const;
export type FollowerList = (typeof FOLLOWER_LISTS)[number];
export const FOLLOWER_PAGE = 50;
export const SEARCH_MAX = 30; // a username is at most 30 characters

export interface Snapshot {
  followers: Person[];
  following: Person[] | null; // null = that upload had no following.json
}
/** Each list, or null when it needs data the snapshots don't have (an older snapshot, or following.json). */
export type Diff = Record<FollowerList, Person[] | null>;

const names = (l: Person[]): Set<string> => new Set(l.map((p) => p.username));
const minus = (a: Person[], b: Set<string>): Person[] => a.filter((p) => !b.has(p.username));

/**
 * new = newer.followers − older.followers · lost = older.followers − newer.followers (their time: when they had
 * followed) · theyDontFollow = newer.following − newer.followers (time: when you followed) · iDontFollow =
 * newer.followers − newer.following · mutual = newer.followers ∩ newer.following (time: when they followed you).
 */
export function diffSnapshots(newer: Snapshot, older: Snapshot | null): Diff {
  const followers = names(newer.followers);
  const following = newer.following ? names(newer.following) : null;
  const before = older ? names(older.followers) : null;
  return {
    new: before ? minus(newer.followers, before) : null,
    lost: older ? minus(older.followers, followers) : null,
    theyDontFollow: newer.following ? minus(newer.following, followers) : null,
    iDontFollow: following ? minus(newer.followers, following) : null,
    mutual: following ? newer.followers.filter((p) => following.has(p.username)) : null,
  };
}

/** The list shown when the URL names none: the changes when there is a comparison, else who doesn't follow back. */
export const defaultList = (d: Diff): FollowerList => (d.new === null && d.theyDontFollow !== null ? 'theyDontFollow' : 'new');

/** Which date the list's time column means (the i18n key under followerDiff.cols). */
export const sinceKey = (l: FollowerList): 'followedYou' | 'youFollowed' => (l === 'theyDontFollow' ? 'youFollowed' : 'followedYou');

/** Newest follow first, unknown times last, then by name: the order of the screen and of the export. */
export function byRecent(a: Person, b: Person): number {
  if (a.at !== b.at) return a.at === null ? 1 : b.at === null ? -1 : b.at - a.at;
  return a.username < b.username ? -1 : a.username > b.username ? 1 : 0;
}

/** The list filtered by a (lower-cased) substring of the username, sorted byRecent. A new array. */
export function filterList(people: Person[], q: string): Person[] {
  return (q ? people.filter((p) => p.username.includes(q)) : [...people]).sort(byRecent);
}

export interface ListPage {
  rows: Person[];
  total: number; // after the search
  page: number; // a page past the end shows page 1
  pages: number;
}

export function pageList(people: Person[], q: string, page: number, size = FOLLOWER_PAGE): ListPage {
  const all = filterList(people, q);
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = page > pages ? 1 : page;
  return { rows: all.slice((p - 1) * size, p * size), total: all.length, page: p, pages };
}

/** What the tab shows for one comparison: the chosen list (or the default), every list's size, and one page of the chosen one. */
export interface FollowersView {
  list: FollowerList;
  counts: Record<FollowerList, number | null>; // null = unavailable
  page: ListPage | null; // null = the chosen list is unavailable
}

export function followersView(newer: Snapshot, older: Snapshot | null, s: { list: FollowerList | null; q: string; page: number }): FollowersView {
  const d = diffSnapshots(newer, older);
  const list = s.list ?? defaultList(d);
  const people = d[list];
  const counts = Object.fromEntries(FOLLOWER_LISTS.map((l) => [l, d[l]?.length ?? null])) as Record<FollowerList, number | null>;
  return { list, counts, page: people ? pageList(people, s.q, s.page) : null };
}
