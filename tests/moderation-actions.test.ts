// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, requireOwner, svc } = vi.hoisted(() => ({
  calls: [] as string[],
  requireOwner: vi.fn(),
  svc: {
    moderate: vi.fn(),
    undoAction: vi.fn(),
    saveWordRule: vi.fn(),
    setSpamRule: vi.fn(),
    deleteRule: vi.fn(),
    setAutoHide: vi.fn(),
  },
}));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push('session'), { session: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => (calls.push('ADMIN'), { admin: true }) }));
vi.mock('@/lib/sync/store', () => ({ supabaseSyncStore: () => ({ getToken: async () => (calls.push('getToken'), 'tok-secret') }) }));
vi.mock('@/lib/env', () => ({ getInstagramEnv: () => (calls.push('env'), { apiVersion: 'v25.0' }) }));
vi.mock('@/lib/instagram/moderation', () => ({ igModeration: () => ({ hide: vi.fn(), reply: vi.fn(), remove: vi.fn() }) }));
vi.mock('@/lib/moderation/service', () => svc);
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => calls.push(`revalidate:${a.join(',')}`) }));

import {
  deleteCommentAction, deleteRuleAction, hideCommentAction, replyCommentAction, saveWordRuleAction, setAutoHideAction, setSpamRuleAction, undoModerationAction,
} from '@/app/(app)/accounts/moderation-actions';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const R = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

const ACTIONS = [
  ['hide', () => hideCommentAction(A, 'c1', true, R)],
  ['reply', () => replyCommentAction(A, 'c1', 'hi', R)],
  ['delete', () => deleteCommentAction(A, 'c1', R)],
  ['undo', () => undoModerationAction(A, 3, R)],
  ['saveWord', () => saveWordRuleAction(A, 'spam', false)],
  ['setSpam', () => setSpamRuleAction(A, 'link', true)],
  ['deleteRule', () => deleteRuleAction(A, R)],
  ['setAutoHide', () => setAutoHideAction(A, true)],
] as const;

beforeEach(() => {
  calls.length = 0;
  requireOwner.mockReset().mockImplementation(async () => void calls.push('requireOwner'));
  for (const f of Object.values(svc)) f.mockReset().mockResolvedValue({ ok: true, logged: true });
});

describe('moderation actions', () => {
  it.each(ACTIONS)('%s: requireOwner runs first; a redirect propagates and nothing is touched', async (_n, run) => {
    await run();
    expect(calls[0]).toBe('requireOwner');
    calls.length = 0;
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls).toEqual([]);
    expect(Object.values(svc).reduce((n, f) => n + f.mock.calls.length, 0)).toBe(1); // only the first, authorised call
  });

  it.each(ACTIONS)('%s: a thrown error becomes the fixed key "unexpected" (no message, no token, no comment text leaks)', async (_n, run) => {
    for (const f of Object.values(svc)) f.mockRejectedValue(new Error('boom tok-secret SECRET-COMMENT-TEXT @someone'));
    const r = await run();
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toMatch(/tok-|SECRET|boom|someone/);
    expect(calls.some((c) => c.startsWith('revalidate'))).toBe(false);
  });

  it('maps each action to the service input (the browser picks no kind it should not)', async () => {
    await hideCommentAction(A, 'c1', true, R);
    await hideCommentAction(A, 'c1', false, R);
    await replyCommentAction(A, 'c1', 'hi', R);
    await deleteCommentAction(A, 'c1', R);
    expect(svc.moderate.mock.calls.map((c) => c[1])).toEqual([
      { kind: 'hide', accountId: A, commentId: 'c1', requestId: R },
      { kind: 'unhide', accountId: A, commentId: 'c1', requestId: R },
      { kind: 'reply', accountId: A, commentId: 'c1', requestId: R, message: 'hi' },
      { kind: 'delete', accountId: A, commentId: 'c1', requestId: R },
    ]);
    expect(await hideCommentAction(A, 'c1', 'yes' as never, R)).toEqual({ ok: false, error: 'invalid' });
    expect(svc.moderate).toHaveBeenCalledTimes(4); // the non-boolean never reached the service
    await undoModerationAction(A, 3, R);
    expect(svc.undoAction.mock.calls[0][1]).toEqual({ accountId: A, logId: 3, requestId: R });
  });

  it('a forged "kind" smuggled in through an extra argument is ignored (the kind comes from the action, not the browser)', async () => {
    await (replyCommentAction as unknown as (...a: unknown[]) => Promise<unknown>)(A, 'c1', 'hi', R, 'delete');
    await (deleteCommentAction as unknown as (...a: unknown[]) => Promise<unknown>)(A, 'c1', R, 'reply', 'x');
    expect(svc.moderate.mock.calls.map((c) => c[1].kind)).toEqual(['reply', 'delete']);
  });

  it('the admin client exists only inside token(), and only when the service asks for it', async () => {
    await hideCommentAction(A, 'c1', true, R);
    expect(calls).not.toContain('ADMIN');
    svc.moderate.mockImplementationOnce(async (deps: { token: (id: string) => Promise<string | null> }) => {
      await deps.token(A);
      return { ok: true, logged: true };
    });
    const r = await hideCommentAction(A, 'c1', true, R);
    expect(calls.slice(-3)).toEqual(['ADMIN', 'getToken', `revalidate:/accounts/[id],page`]);
    expect(JSON.stringify(r)).not.toContain('tok-');
  });

  it('the service gets the owner session (never the admin client) as its database', async () => {
    await hideCommentAction(A, 'c1', true, R);
    await undoModerationAction(A, 3, R);
    expect(svc.moderate.mock.calls[0][0].db).toEqual({ session: true });
    expect(svc.undoAction.mock.calls[0][0].db).toEqual({ session: true });
  });

  it('rule actions use only the owner session (no admin client, no Instagram env)', async () => {
    await saveWordRuleAction(A, 'spam', true);
    await setSpamRuleAction(A, 'emoji', false);
    await deleteRuleAction(A, R);
    await setAutoHideAction(A, false);
    expect(calls).not.toContain('ADMIN');
    expect(calls).not.toContain('env');
    expect(svc.saveWordRule.mock.calls[0]).toEqual([{ session: true }, A, 'spam', true]);
    expect(svc.setSpamRule.mock.calls[0]).toEqual([{ session: true }, A, 'emoji', false]);
    expect(svc.deleteRule.mock.calls[0]).toEqual([{ session: true }, A, R]);
    expect(svc.setAutoHide.mock.calls[0]).toEqual([{ session: true }, A, false]);
  });

  it('revalidates the account page only after a success', async () => {
    svc.moderate.mockResolvedValueOnce({ ok: false, error: 'rate_limited' });
    expect(await hideCommentAction(A, 'c1', true, R)).toEqual({ ok: false, error: 'rate_limited' });
    expect(calls.some((c) => c.startsWith('revalidate'))).toBe(false);
    svc.setAutoHide.mockResolvedValueOnce({ ok: false, error: 'no_rules' });
    await setAutoHideAction(A, true);
    expect(calls.some((c) => c.startsWith('revalidate'))).toBe(false);
  });
});
