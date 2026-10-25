// Comment insights (Plan 15c): the shapes the Comments tab shows and the rule values, shared by the readers
// (lib/comments/read.ts), the SQL functions (passed as parameters: one source) and the UI. Pure, no imports.
// Commenter usernames and texts are third-party personal data: owner-only, never logged, never in URLs.

/** The post a comment belongs to (feed post or Reel; Stories have no comments). */
export interface CommentPost {
  id: string;
  type: string; // media_type: IMAGE | CAROUSEL_ALBUM | REELS
  postedAt: string; // ISO
  caption: string | null; // at most 100 characters (the SQL cuts it)
}

/** One comment as the tab shows it. Plan 15d contract: keep these names. */
export interface CommentView {
  id: string;
  mediaId: string;
  authorUsername: string | null;
  text: string; // '' when Instagram sent none
  postedAt: string; // when the comment was written (commented_at), ISO
  likeCount: number | null;
  isQuestion: boolean; // lib/comments/question.ts isQuestion
  hidden: boolean | null; // true only when stored as hidden; null = unknown (Instagram's hidden flag is not read yet)
  repliedByOwner: boolean | null; // true = a later comment of yours @mentions them; null = unknown, never false (thread replies are not read)
  post: CommentPost | null; // null = the post row is gone
}

export interface Fan {
  username: string; // lower-cased
  comments: number;
  likes: number; // likes on their comments, missing as 0
  firstAt: string; // ISO
  lastAt: string; // ISO
  postsSince: number | null; // feed posts published after their latest comment; only for "gone quiet"
}

export interface Outsider {
  username: string; // lower-cased
  comments: number;
  lastAt: string; // ISO
}

/** One server page: the rows, the total over all pages, the page actually read (a page past the end reads page 1). */
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
}

export const COMMENT_PAGE = 50;
export const FAN_PAGE = 50;
/** Characters of a comment shown in a row (Instagram allows 2,200). */
export const TEXT_CAP = 500;
/** Comments read for Topics: the newest of the range (one capped read). */
export const TOPIC_SAMPLE = 1000;
/** Fans: a fan has fanMin+ comments; new fan = first comment within windowDays and newFanMin+ comments; gone quiet = fanMin+ comments, none within windowDays, quietPosts+ posts since. */
export const FAN_RULES = { fanMin: 3, newFanMin: 2, windowDays: 30, quietPosts: 3 } as const;

/** At most `max` code points (emoji and other astral characters are never split); `cut` = something was left out. */
export function capText(s: string, max = TEXT_CAP): { text: string; cut: boolean } {
  const cps = [...s];
  return cps.length > max ? { text: cps.slice(0, max).join('').trimEnd(), cut: true } : { text: s, cut: false };
}
