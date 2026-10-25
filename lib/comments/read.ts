// Reads of the Comments tab (Plan 15c, READ-ONLY). Besides the sync store (lib/sync/store.ts, which writes), the ONLY
// module that names the comments table and the comment_* functions (tests/comments-privacy.test.ts). Owner-session
// client only: RLS (comments_owner_select, is_owner()) applies, inside the security-invoker functions too; never the
// admin client. Every read is filtered by the account id. Errors are fixed texts: a Supabase error can echo row values,
// i.e. third-party usernames and comment texts. Nothing here logs.
import type { SupabaseClient } from '@supabase/supabase-js';
import { isQuestion, QUESTION_PATTERN } from '@/lib/comments/question';
import type { FanMode } from '@/lib/comments/state';
import type { TopicInput } from '@/lib/comments/topics';
import { COMMENT_PAGE, FAN_PAGE, FAN_RULES, TOPIC_SAMPLE, type CommentPost, type CommentView, type Fan, type Outsider, type Paged } from '@/lib/comments/view';
import { MISSING_FUNCTION } from '@/lib/dashboard/read';

type Row = Record<string, unknown>;
const missing = (e: unknown): boolean => MISSING_FUNCTION.includes(String((e as { code?: unknown } | null)?.code));
const fail = (op: string): never => {
  throw new Error(`comments ${op} failed`);
};
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null); // bigint arrives as a number or a string
const offset = (page: number, size: number) => (page - 1) * size;

/** One page from a comment_* function; a page past the end is read again as page 1; null = the function is missing. */
async function paged<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>, page: number, size: number, map: (r: Row) => T): Promise<Paged<T> | null> {
  const { data, error } = await db.rpc(fn, { ...args, p_offset: offset(page, size), p_limit: size });
  if (error) return missing(error) ? null : fail(fn);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0 && page > 1) return paged(db, fn, args, 1, size, map);
  return { rows: rows.map(map), total: num(rows[0]?.total) ?? 0, page };
}

export const toCommentView = (r: Row): CommentView => {
  const text = str(r.body) ?? '';
  const postedAt = str(r.posted_at);
  return {
    id: String(r.id),
    mediaId: String(r.media_id),
    authorUsername: str(r.author_username),
    text,
    postedAt: String(r.commented_at),
    likeCount: num(r.like_count),
    isQuestion: isQuestion(text),
    hidden: r.hidden === true ? true : null, // the column defaults to false and Instagram's flag is not read yet: false is not data
    repliedByOwner: r.replied === true ? true : null, // no reply SEEN is not "unanswered" (thread replies are not read)
    post: postedAt ? { id: String(r.media_id), type: String(r.media_type), postedAt, caption: str(r.caption) } : null,
  };
};

export interface CommentPageArgs {
  fromIso: string;
  toIso: string;
  q: string; // '' = no search
  media: string | null;
  questions: boolean; // only comments that match the question rule
  unanswered: boolean; // only comments with no reply seen (and not the owner's own)
  fansOnly: boolean; // only authors with FAN_RULES.fanMin+ comments
  owner: string; // the account's username, lower-cased
  page: number;
}

/** One page of comments, newest first, by comment_list (migration 20261029000001). null = not applied yet. */
export const loadCommentPage = (db: SupabaseClient, accountId: string, a: CommentPageArgs): Promise<Paged<CommentView> | null> =>
  paged(
    db,
    'comment_list',
    {
      p_account: accountId,
      p_from: a.fromIso,
      p_to: a.toIso,
      p_q: a.q || null,
      p_media: a.media,
      p_question_re: a.questions ? QUESTION_PATTERN : null,
      p_unanswered: a.unanswered,
      p_fan_min: a.fansOnly ? FAN_RULES.fanMin : null,
      p_owner: a.owner,
    },
    a.page,
    COMMENT_PAGE,
    toCommentView,
  );

/** One page of commenters by comment_fans: top, new or gone quiet (FAN_RULES). null = not applied yet. */
export const loadFans = (db: SupabaseClient, accountId: string, a: { owner: string; mode: FanMode; now: Date; page: number }): Promise<Paged<Fan> | null> =>
  paged(
    db,
    'comment_fans',
    {
      p_account: accountId,
      p_owner: a.owner,
      p_mode: a.mode,
      p_now: a.now.toISOString(),
      p_fan_min: FAN_RULES.fanMin,
      p_new_min: FAN_RULES.newFanMin,
      p_days: FAN_RULES.windowDays,
      p_quiet_posts: FAN_RULES.quietPosts,
    },
    a.page,
    FAN_PAGE,
    (r) => ({ username: String(r.username), comments: num(r.comments) ?? 0, likes: num(r.likes) ?? 0, firstAt: String(r.first_at), lastAt: String(r.last_at), postsSince: num(r.posts_since) }),
  );

/** One page of commenters missing from the newest follower export, by comment_outsiders. null = not applied yet. */
export const loadOutsiders = (db: SupabaseClient, accountId: string, a: { owner: string; page: number }): Promise<Paged<Outsider> | null> =>
  paged(db, 'comment_outsiders', { p_account: accountId, p_owner: a.owner }, a.page, FAN_PAGE, (r) => ({ username: String(r.username), comments: num(r.comments) ?? 0, lastAt: String(r.last_at) }));

/** Topics input: the newest TOPIC_SAMPLE comments written in [fromIso, toIso), the owner's own left out (plain table read: works before the migration). */
export async function loadTopicSample(db: SupabaseClient, accountId: string, a: { fromIso: string; toIso: string; owner: string }): Promise<TopicInput[]> {
  const { data, error } = await db
    .from('comments')
    .select('text,author_username')
    .eq('account_id', accountId)
    .gte('commented_at', a.fromIso)
    .lt('commented_at', a.toIso)
    .order('commented_at', { ascending: false })
    .limit(TOPIC_SAMPLE);
  if (error) return fail('topics');
  return ((data ?? []) as Row[]).flatMap((r) => {
    const author = str(r.author_username)?.toLowerCase() ?? null;
    return author === a.owner ? [] : [{ text: str(r.text), author }];
  });
}

/** The post filter's choices: the newest 50 feed posts / Reels that have comments. */
export async function loadCommentPosts(db: SupabaseClient, accountId: string): Promise<CommentPost[]> {
  const { data, error } = await db
    .from('media')
    .select('id,media_type,posted_at,caption')
    .eq('account_id', accountId)
    .neq('media_type', 'STORY')
    .gt('comments_count', 0)
    .order('posted_at', { ascending: false })
    .limit(50);
  if (error) return fail('posts');
  return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), type: String(r.media_type), postedAt: String(r.posted_at), caption: str(r.caption) }));
}

/** When comments were first read for this account (the earliest first_seen_at); null = none yet. */
export async function loadCommentStart(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from('comments').select('first_seen_at').eq('account_id', accountId).order('first_seen_at', { ascending: true }).limit(1);
  if (error) return fail('start');
  return str(((data ?? []) as Row[])[0]?.first_seen_at);
}
