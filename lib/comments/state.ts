// URL state of the Comments tab (Plan 15c; docs/UI_STANDARDS.md rule 3: the URL is the state). Parsed on the server,
// every value validated, invalid ones dropped (never echoed back). The comment-date filter reuses the list keys of
// Plan 14b (pr | pfrom | pto), so PostedFilter works unchanged. Pure.
import { cleanSearch, dateParams, listHref, parseDates, type ListDates } from '@/lib/dashboard/lists';

type Params = Record<string, string | string[] | undefined>;

export const COMMENT_SECTIONS = ['comments', 'questions', 'fans', 'topics', 'outsiders'] as const;
export type CommentSection = (typeof COMMENT_SECTIONS)[number];
export const FAN_MODES = ['top', 'new', 'quiet'] as const;
export type FanMode = (typeof FAN_MODES)[number];
export const COMMENT_ONLY = ['questions', 'fans'] as const;
export type CommentOnly = (typeof COMMENT_ONLY)[number];

export interface CommentState {
  section: CommentSection;
  dates: ListDates; // the comment date (owner timezone days)
  q: string; // '' = no search
  media: string | null; // one post (Instagram media id, digits)
  only: CommentOnly | null; // All comments: only questions / only fans
  fans: FanMode;
  page: number; // 1-based
}

/** The tab's own URL keys besides LIST_KEYS (pr, pfrom, pto, q, page): the page's Suspense key ignores both. */
export const COMMENT_KEYS = ['section', 'media', 'only', 'fans'] as const;

const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);
const pick = <T extends string>(all: readonly T[], v: string | null): T | null => (v !== null && (all as readonly string[]).includes(v) ? (v as T) : null);

export function parseCommentState(sp: Params): CommentState {
  const media = one(sp.media);
  const page = one(sp.page);
  return {
    section: pick(COMMENT_SECTIONS, one(sp.section)) ?? 'comments',
    dates: parseDates(sp),
    q: cleanSearch(one(sp.q)),
    media: media !== null && /^\d{1,32}$/.test(media) ? media : null,
    only: pick(COMMENT_ONLY, one(sp.only)),
    fans: pick(FAN_MODES, one(sp.fans)) ?? 'top',
    page: page !== null && /^\d{1,6}$/.test(page) && Number(page) >= 1 ? Number(page) : 1,
  };
}

/** A link inside the tab: the patch applied, page back to 1 unless patched, defaults left out, fixed order; `keep` = the Time Scope params (never override the tab's own). */
export function commentHref(s: CommentState, patch: Partial<CommentState>, keep: Record<string, string> = {}): string {
  const n = { ...s, page: 1, ...patch };
  const p: Record<string, string> = {
    tab: 'comments',
    ...(n.section !== 'comments' ? { section: n.section } : {}),
    ...dateParams(n.dates),
    ...(n.q ? { q: n.q } : {}),
    ...(n.media ? { media: n.media } : {}),
    ...(n.only ? { only: n.only } : {}),
    ...(n.fans !== 'top' ? { fans: n.fans } : {}),
    ...(n.page > 1 ? { page: String(n.page) } : {}),
  };
  for (const [k, v] of Object.entries(keep)) if (!(k in p)) p[k] = v;
  return listHref(p);
}
