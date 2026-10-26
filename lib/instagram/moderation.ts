// Comment moderation writes (Plan 15d): hide / unhide, reply, delete. Instagram API with Instagram Login
// (graph.instagram.com, Instagram User token, instagram_business_basic + instagram_business_manage_comments).
// Read 2026-10-25 from https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment
// and https://developers.facebook.com/documentation/instagram-platform/comment-moderation:
//   POST   /{ig-comment-id}?hide=true|false  -> {"success": true}  (owner of the media; the owner's own comments are always shown)
//   POST   /{ig-comment-id}/replies message  -> {"id": "..."}
//   DELETE /{ig-comment-id}                  -> {"success": true}  (owner of the media)
// Rate limits for these writes are not documented (Open question P2); the callers cap their own volume.
// SERVER ONLY: the token is a request parameter; errors are InstagramApiError with fixed messages (never a URL or body).
import { classifyIgError } from '@/lib/instagram/data';
import { call, InstagramApiError } from '@/lib/instagram/oauth';

const HOST = 'https://graph.instagram.com';
/** Shorter than the sync's 10 s: the tick pass must end before the route's 60 s (lib/moderation/auto.ts). */
export const MODERATION_TIMEOUT_MS = 5_000;
/** Graph API "permission denied" for an action. (For READS the sync meets 10 as "not enough viewers".) */
const PERMISSION_DENIED = 10;
const ID = /^\w{1,64}$/;

export type ModerationErrorKey = 'reconnect' | 'rate_limited' | 'not_allowed' | 'instagram_unavailable' | 'unknown_outcome' | 'unexpected';

/**
 * What a failed write means for the owner. `write = 'reply'`: a timeout or 5xx may still have posted the reply, so it is
 * unknown_outcome (the UI says "check on Instagram before sending again") instead of an invitation to retry.
 */
export function classifyModerationError(e: unknown, write: 'reply' | 'other' = 'other'): ModerationErrorKey {
  if (!(e instanceof InstagramApiError)) return 'unexpected';
  const k = classifyIgError(e);
  if (k === 'rate_limit' || k === 'app_rate_limit') return 'rate_limited';
  if (k === 'auth' || (e.kind !== 'network' && (e.code === PERMISSION_DENIED || e.status === 403))) return 'reconnect';
  // 100/33 ('gone' for the sync's reads) is NOT "comment gone" on a write: Meta sends it for "does not exist" AND for "cannot be
  // loaded due to missing permissions, or does not support this operation". It falls through to not_allowed; nothing is
  // deleted locally on it. The local copy goes only after an HTTP-confirmed DELETE.
  if (k === 'transient') return write === 'reply' ? 'unknown_outcome' : 'instagram_unavailable';
  return 'not_allowed';
}

const init = (method: 'POST' | 'DELETE', form?: Record<string, string>): RequestInit => ({
  method,
  signal: AbortSignal.timeout(MODERATION_TIMEOUT_MS),
  redirect: 'error', // the token is in the query: never follow a redirect anywhere
  ...(form ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() } : {}),
});

export function igModeration(apiVersion: string, fetchFn: typeof fetch = fetch) {
  const url = (commentId: string, edge: string, params: Record<string, string>, token: string) => {
    if (!ID.test(commentId)) throw new InstagramApiError('data'); // never build a path from anything else
    const u = new URL(`${HOST}/${apiVersion}/${commentId}${edge}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set('access_token', token);
    return u.toString();
  };
  const success = (b: Record<string, unknown>) => {
    if (b.success !== true) throw new InstagramApiError('data');
  };
  return {
    async hide(token: string, commentId: string, hide: boolean): Promise<void> {
      success(await call('data', fetchFn, url(commentId, '', { hide: String(hide) }, token), init('POST')));
    },
    async reply(token: string, commentId: string, message: string): Promise<string | null> {
      const b = await call('data', fetchFn, url(commentId, '/replies', {}, token), init('POST', { message }));
      return typeof b.id === 'string' && ID.test(b.id) ? b.id : null;
    },
    async remove(token: string, commentId: string): Promise<void> {
      success(await call('data', fetchFn, url(commentId, '', {}, token), init('DELETE')));
    },
  };
}

export type IgModeration = ReturnType<typeof igModeration>;
