// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramApiError } from '@/lib/instagram/oauth';

const { order, state } = vi.hoisted(() => ({ order: [] as string[], state: { account: null as unknown, comment: null as unknown, log: null as unknown } }));
vi.mock('@/lib/moderation/store', async (orig) => {
  const real = await orig<typeof import('@/lib/moderation/store')>();
  const f = (name: string, impl: (...a: unknown[]) => unknown = () => undefined) => vi.fn(async (...a: unknown[]) => (order.push(name), impl(...a)));
  return {
    ...real,
    getActionAccount: f('account', () => state.account),
    getActionComment: f('comment', () => state.comment),
    countRecentOwnerActions: f('count', () => 0),
    insertLog: f('insertLog', () => 7),
    finishLog: f('finishLog'),
    getLog: f('getLog', () => state.log),
    markUndone: f('markUndone', () => true),
    setCommentHidden: f('setHidden'),
    removeComment: f('removeComment'),
    loadRules: f('loadRules', () => []),
    countWordRules: f('countWords', () => 0),
    visibleComments: f('visible', () => []),
    logMarks: f('marks', () => []),
    insertWordRule: f('insertWord'),
    setSpamRow: f('setSpam'),
    deleteRuleRow: f('deleteRule', () => true),
    saveAutoHide: f('saveAutoHide'),
  };
});

import * as S from '@/lib/moderation/store';
import { MANUAL_PER_MINUTE, moderate, previewWordRule, saveWordRule, setAutoHide, setSpamRule, undoAction, type ServiceDeps } from '@/lib/moderation/service';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const REQ = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const RULE = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const NOW = new Date('2026-10-29T10:00:00Z');
const db = {} as SupabaseClient;
const ACCOUNT = { id: A, username: 'MyShop', status: 'active' as const, grantedScopes: ['instagram_business_basic', 'instagram_business_manage_comments'] };
const m = vi.mocked(S);

function deps(o: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    db,
    token: vi.fn(async () => (order.push('token'), 'tok-secret')),
    ig: {
      hide: vi.fn(async (_t: string, _c: string, h: boolean) => void order.push(`meta:${h ? 'hide' : 'unhide'}`)),
      reply: vi.fn(async () => (order.push('meta:reply'), '1790')),
      remove: vi.fn(async (_t: string, id: string) => void order.push(`meta:remove:${id}`)),
    },
    now: () => NOW,
    ...o,
  };
}
const hide = (o: Record<string, unknown> = {}) => ({ kind: 'hide' as const, accountId: A, commentId: 'c1', requestId: REQ, ...o });

beforeEach(() => {
  order.length = 0;
  vi.resetAllMocks(); // back to each vi.fn's own implementation (a test's mockResolvedValue must not leak)
  state.account = ACCOUNT;
  state.comment = { id: 'c1', authorUsername: 'fan', hidden: false };
  state.log = null;
});

describe('moderate: the order of writes', () => {
  it('account → comment (both ids) → cap → log row → token → Meta → result → local state', async () => {
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: true, logged: true });
    expect(order).toEqual(['account', 'comment', 'count', 'insertLog', 'token', 'meta:hide', 'finishLog', 'setHidden']);
    expect(m.getActionComment).toHaveBeenCalledWith(db, A, 'c1');
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c1', action: 'hide', actor: 'owner', requestId: REQ });
    expect(m.countRecentOwnerActions).toHaveBeenCalledWith(db, A, '2026-10-29T09:59:00.000Z');
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'ok', undefined);
    expect(m.setCommentHidden).toHaveBeenCalledWith(db, A, 'c1', true);
  });

  it('unhide and delete mirror locally; reply stores the reply id, sends the trimmed text', async () => {
    state.comment = { id: 'c1', authorUsername: 'fan', hidden: true };
    expect(await moderate(deps(), hide({ kind: 'unhide' }))).toEqual({ ok: true, logged: true });
    expect(m.setCommentHidden).toHaveBeenCalledWith(db, A, 'c1', false);
    const d = deps();
    await moderate(d, hide({ kind: 'delete' }));
    expect(d.ig.remove).toHaveBeenCalledWith('tok-secret', 'c1');
    expect(m.removeComment).toHaveBeenCalledWith(db, A, 'c1');
    const r = deps();
    await moderate(r, hide({ kind: 'reply', message: '  Thanks!  ' }));
    expect(r.ig.reply).toHaveBeenCalledWith('tok-secret', 'c1', 'Thanks!');
    expect(m.finishLog).toHaveBeenLastCalledWith(db, 7, 'ok', '1790');
  });
});

describe('moderate: refusals send nothing to Instagram', () => {
  it.each([
    ['bad account id', hide({ accountId: 'x' })],
    ['bad request id', hide({ requestId: 'nope' })],
    ['bad comment id', hide({ commentId: '../1' })],
    ['unknown kind', hide({ kind: 'ban' })],
    ['empty reply', hide({ kind: 'reply', message: '   ' })],
    ['reply too long', hide({ kind: 'reply', message: 'x'.repeat(2201) })],
    ['reply not a string', hide({ kind: 'reply', message: 42 })],
  ])('%s → invalid, nothing read', async (_n, input) => {
    expect(await moderate(deps(), input as never)).toEqual({ ok: false, error: 'invalid' });
    expect(order).toEqual([]);
  });

  it.each([
    ['no such account', null, 'not_found'],
    ['archived', { ...ACCOUNT, status: 'archived' as const }, 'not_active'],
    ['needs reconnect', { ...ACCOUNT, status: 'needs_reconnect' as const }, 'reconnect'],
    ['no comments scope', { ...ACCOUNT, grantedScopes: ['instagram_business_basic'] }, 'reconnect'],
  ])('%s → %s', async (_n, acc, error) => {
    state.account = acc;
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error });
    expect(order).toEqual(['account']);
  });

  it('a comment of another account (or gone) is not_found: no log row, no token, no Meta', async () => {
    state.comment = null;
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'not_found' });
    expect(order).toEqual(['account', 'comment']);
  });

  it("the account's own comment cannot be hidden (any case); a reply to it is fine", async () => {
    state.comment = { id: 'c1', authorUsername: 'myshop', hidden: false };
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'not_allowed' });
    expect(order).not.toContain('insertLog');
    expect(await moderate(deps(), hide({ kind: 'reply', message: 'hi' }))).toEqual({ ok: true, logged: true });
  });

  it('already hidden → already_done without a call', async () => {
    state.comment = { id: 'c1', authorUsername: 'fan', hidden: true };
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'already_done' });
    expect(order).not.toContain('insertLog');
  });

  it(`more than ${MANUAL_PER_MINUTE} actions a minute → too_many before any log row`, async () => {
    m.countRecentOwnerActions.mockResolvedValueOnce(MANUAL_PER_MINUTE);
    expect(await moderate(deps(), hide())).toEqual({ ok: false, error: 'too_many' });
    expect(order).not.toContain('insertLog');
  });

  it('the same request id twice sends once: the unique request_id answers duplicate', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'duplicate'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'duplicate' });
    expect(d.ig.hide).not.toHaveBeenCalled();
    expect(d.token).not.toHaveBeenCalled();
  });

  it('no log row → no Instagram write (missing table: not_ready; any other failure: unexpected)', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'missing'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'not_ready' });
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'other'));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'unexpected' });
    expect(d.ig.hide).not.toHaveBeenCalled();
  });

  it('no stored token → the row says reconnect, nothing is sent', async () => {
    const d = deps({ token: vi.fn(async () => null) });
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'reconnect' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'reconnect');
    expect(d.ig.hide).not.toHaveBeenCalled();
  });
});

describe('moderate: partial failures', () => {
  it('Meta 100/33 (does not exist OR refused) → logged not_allowed, our copy is KEPT, nothing mirrored', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 100, 33));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'not_allowed' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'not_allowed');
    expect(m.removeComment).not.toHaveBeenCalled();
    expect(m.setCommentHidden).not.toHaveBeenCalled();
  });

  it('a delete refused with 100/33 keeps our copy; only a confirmed delete removes it', async () => {
    const d = deps();
    vi.mocked(d.ig.remove).mockRejectedValueOnce(new InstagramApiError('data', 400, 100, 33));
    expect(await moderate(d, hide({ kind: 'delete' }))).toEqual({ ok: false, error: 'not_allowed' });
    expect(m.removeComment).not.toHaveBeenCalled();
  });

  it('Meta rate limit → logged, nothing mirrored', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 17));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'rate_limited' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'rate_limited');
    expect(m.setCommentHidden).not.toHaveBeenCalled();
  });

  it('Meta ok but the result write fails → ok with logged:false (the row stays pending = "outcome unknown"); the mirror still runs', async () => {
    m.finishLog.mockRejectedValueOnce(new S.ModerationStoreError('finishLog', 'other'));
    expect(await moderate(deps(), hide())).toEqual({ ok: true, logged: false });
    expect(m.setCommentHidden).toHaveBeenCalled();
  });

  it('Meta failed and the result write fails too → still the Meta error key', async () => {
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 190));
    m.finishLog.mockRejectedValueOnce(new Error('db down'));
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'reconnect' });
  });

  it('a reply Instagram did not confirm is unknown_outcome (never "try again")', async () => {
    const d = deps();
    vi.mocked(d.ig.reply).mockRejectedValueOnce(new InstagramApiError('network'));
    expect(await moderate(d, hide({ kind: 'reply', message: 'hi' }))).toEqual({ ok: false, error: 'unknown_outcome' });
  });

  it('the mirror failing never fails the action; the token never appears in a result', async () => {
    m.setCommentHidden.mockRejectedValueOnce(new Error('db down'));
    const r = await moderate(deps(), hide());
    expect(r).toEqual({ ok: true, logged: true });
    expect(JSON.stringify(r)).not.toContain('tok-');
  });

  // extra failure paths (safety review additions)
  it('the token read throwing → the row says unexpected, nothing is sent', async () => {
    const d = deps({ token: vi.fn(async () => { throw new Error('db down tok-secret'); }) });
    const r = await moderate(d, hide());
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'unexpected');
    expect(d.ig.hide).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('tok-');
  });

  it('the cap read failing → unexpected before any log row or Instagram call', async () => {
    m.countRecentOwnerActions.mockRejectedValueOnce(new Error('db down'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'unexpected' });
    expect(order).not.toContain('insertLog');
    expect(d.ig.hide).not.toHaveBeenCalled();
  });

  it('a read of the account or comment failing → unexpected, nothing sent', async () => {
    m.getActionComment.mockRejectedValueOnce(new Error('db down'));
    const d = deps();
    expect(await moderate(d, hide())).toEqual({ ok: false, error: 'unexpected' });
    expect(order).not.toContain('insertLog');
  });

  it('an unrecognised error from Instagram is unexpected and its text never leaks', async () => {
    const d = deps();
    vi.mocked(d.ig.remove).mockRejectedValueOnce(new Error('Bearer tok-secret leaked'));
    const r = await moderate(d, hide({ kind: 'delete' }));
    expect(r).toEqual({ ok: false, error: 'unexpected' });
    expect(JSON.stringify(r)).not.toContain('tok-');
    expect(m.removeComment).not.toHaveBeenCalled();
  });

  it('a permission answer is reconnect and never changes anything else (no local mirror)', async () => {
    const d = deps();
    vi.mocked(d.ig.remove).mockRejectedValueOnce(new InstagramApiError('data', 403, 10));
    expect(await moderate(d, hide({ kind: 'delete' }))).toEqual({ ok: false, error: 'reconnect' });
    expect(m.removeComment).not.toHaveBeenCalled();
    expect(m.finishLog).toHaveBeenCalledWith(db, 7, 'reconnect');
  });

  it('delete: Meta ok but the result write fails → ok with logged:false and the copy is still removed', async () => {
    m.finishLog.mockRejectedValueOnce(new S.ModerationStoreError('finishLog', 'other'));
    expect(await moderate(deps(), hide({ kind: 'delete' }))).toEqual({ ok: true, logged: false });
    expect(m.removeComment).toHaveBeenCalledWith(db, A, 'c1');
  });
});

describe('undoAction', () => {
  const row = (o: Partial<S.LogRow> = {}): S.LogRow => ({ id: 3, commentId: 'c9', action: 'hide', actor: `rule:${RULE}`, result: 'ok', targetId: null, undoOf: null, createdAt: '2026-10-29T09:00:00Z', undoneAt: null, ...o });

  it('a hide (also a rule\'s) is undone by an unhide of the STORED comment, linked to the row, then marked undone', async () => {
    state.log = row();
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: true, logged: true });
    expect(m.getLog).toHaveBeenCalledWith(db, A, 3);
    expect(d.ig.hide).toHaveBeenCalledWith('tok-secret', 'c9', false);
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c9', action: 'unhide', actor: 'owner', requestId: REQ, undoOf: 3 });
    expect(m.markUndone).toHaveBeenCalledWith(db, A, 3, NOW.toISOString());
  });

  it('a reply is undone by deleting the STORED reply id', async () => {
    state.log = row({ action: 'reply', actor: 'owner', targetId: '1790' });
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: true, logged: true });
    expect(d.ig.remove).toHaveBeenCalledWith('tok-secret', '1790');
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: A, commentId: 'c9', action: 'delete_reply', actor: 'owner', requestId: REQ, undoOf: 3, targetId: '1790' });
    expect(m.removeComment).not.toHaveBeenCalled(); // the parent comment stays
  });

  it('an undo of a reply refused with 100/33 is NOT marked undone (the reply may still be live)', async () => {
    state.log = row({ action: 'reply', actor: 'owner', targetId: '1790' });
    const d = deps();
    vi.mocked(d.ig.remove).mockRejectedValueOnce(new InstagramApiError('data', 400, 100, 33));
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'not_allowed' });
    expect(m.markUndone).not.toHaveBeenCalled();
    expect(m.removeComment).not.toHaveBeenCalled();
  });

  it.each([
    ['not this account / absent', null, 'not_found'],
    ['already undone', row({ undoneAt: '2026-10-29T09:30:00Z' }), 'already_done'],
    ['a delete', row({ action: 'delete' }), 'cannot_undo'],
    ['a failed hide', row({ result: 'rate_limited' }), 'cannot_undo'],
    ['a reply without its id', row({ action: 'reply' }), 'cannot_undo'],
  ])('%s → %s, nothing sent', async (_n, r, error) => {
    state.log = r;
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error });
    expect(d.token).not.toHaveBeenCalled();
  });

  it('a repeated undo request id is a duplicate: nothing sent, nothing marked undone', async () => {
    state.log = row();
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'duplicate'));
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'duplicate' });
    expect(d.ig.hide).not.toHaveBeenCalled();
    expect(m.markUndone).not.toHaveBeenCalled();
  });

  it('an undo that fails on Instagram (rate limit) is not marked undone and can be tried again', async () => {
    state.log = row();
    const d = deps();
    vi.mocked(d.ig.hide).mockRejectedValueOnce(new InstagramApiError('data', 400, 17));
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'rate_limited' });
    expect(m.markUndone).not.toHaveBeenCalled();
  });

  it('the account gate applies to undo too (scope lost → reconnect, nothing read or sent)', async () => {
    state.account = { ...ACCOUNT, grantedScopes: ['instagram_business_basic'] };
    const d = deps();
    expect(await undoAction(d, { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'reconnect' });
    expect(order).toEqual(['account']);
  });

  it('an unhide / delete_reply / pending row has no undo', async () => {
    for (const r of [row({ action: 'unhide' }), row({ action: 'delete_reply' }), row({ result: 'pending' })]) {
      state.log = r;
      expect(await undoAction(deps(), { accountId: A, logId: 3, requestId: REQ })).toEqual({ ok: false, error: 'cannot_undo' });
    }
    expect(m.insertLog).not.toHaveBeenCalled();
  });

  it('invalid ids → invalid, nothing read', async () => {
    expect(await undoAction(deps(), { accountId: A, logId: 1.5, requestId: REQ })).toEqual({ ok: false, error: 'invalid' });
    expect(await undoAction(deps(), { accountId: A, logId: 0, requestId: REQ })).toEqual({ ok: false, error: 'invalid' });
    expect(order).toEqual([]);
  });
});

describe('rules and the auto-hide switch', () => {
  it('a word is validated against the stored rules; the unique index duplicate maps to duplicate_rule', async () => {
    expect(await saveWordRule(db, A, '  Spam ', true)).toEqual({ ok: true });
    expect(m.insertWordRule).toHaveBeenCalledWith(db, A, 'Spam', true);
    m.loadRules.mockResolvedValueOnce([{ id: RULE, kind: 'word', pattern: 'spam', wholeWord: false }]);
    expect(await saveWordRule(db, A, 'SPAM', false)).toEqual({ ok: false, error: 'duplicate_rule' });
    expect(await saveWordRule(db, A, 'x', 'yes')).toEqual({ ok: false, error: 'invalid' });
    m.loadRules.mockRejectedValueOnce(new S.ModerationStoreError('loadRules', 'missing'));
    expect(await saveWordRule(db, A, 'x', false)).toEqual({ ok: false, error: 'not_ready' });
  });

  it('a word is whole-word unless the caller says otherwise (the default is on)', async () => {
    expect(await saveWordRule(db, A, 'spam', undefined)).toEqual({ ok: true });
    expect(m.insertWordRule).toHaveBeenLastCalledWith(db, A, 'spam', true);
    expect(await saveWordRule(db, A, 'spam', false)).toEqual({ ok: true });
    expect(m.insertWordRule).toHaveBeenLastCalledWith(db, A, 'spam', false);
  });

  it('too short and punctuation-only words are refused server-side, nothing is inserted', async () => {
    expect(await saveWordRule(db, A, 'as', true)).toEqual({ ok: false, error: 'rule_too_short' });
    expect(await saveWordRule(db, A, '.', false)).toEqual({ ok: false, error: 'invalid_word' });
    expect(await saveWordRule(db, A, '代', false)).toEqual({ ok: true });
    expect(m.insertWordRule).toHaveBeenCalledTimes(1);
  });

  it('the 200-word cap is re-counted right before the insert', async () => {
    m.countWordRules.mockResolvedValueOnce(200);
    expect(await saveWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'too_many_rules' });
    expect(m.insertWordRule).not.toHaveBeenCalled();
    order.length = 0;
    expect(await saveWordRule(db, A, 'spam', true)).toEqual({ ok: true });
    expect(order.slice(-2)).toEqual(['countWords', 'insertWord']);
  });

  it('rule edits need an active account with the comments scope (archived: refused)', async () => {
    state.account = { ...ACCOUNT, status: 'archived' as const };
    expect(await saveWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'not_active' });
    expect(await setSpamRule(db, A, 'link', true)).toEqual({ ok: false, error: 'not_active' });
    expect(await previewWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'not_active' });
    state.account = { ...ACCOUNT, status: 'needs_reconnect' as const };
    expect(await saveWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'reconnect' });
    state.account = null;
    expect(await saveWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'not_found' });
    expect(m.insertWordRule).not.toHaveBeenCalled();
    expect(m.setSpamRow).not.toHaveBeenCalled();
  });

  it('switching a spam pattern OFF is allowed whatever the account state (nothing to protect)', async () => {
    state.account = { ...ACCOUNT, status: 'archived' as const };
    expect(await setSpamRule(db, A, 'link', false)).toEqual({ ok: true });
    expect(m.setSpamRow).toHaveBeenCalledWith(db, A, 'link', false);
  });

  it('previewWordRule: how many existing visible comments the NEW rule alone would hide (same matcher; touched and own comments excluded)', async () => {
    const cand = (id: string, text: string, authorUsername = 'fan') => ({ id, authorUsername, text, hidden: false });
    m.visibleComments.mockResolvedValueOnce([cand('1', 'Cheap spam'), cand('2', 'nice'), cand('3', 'cheap!', 'MyShop'), cand('4', 'so cheap'), cand('5', 'cheapest')]);
    m.logMarks.mockResolvedValueOnce([{ commentId: '4', actor: 'owner', result: 'ok' }]);
    expect(await previewWordRule(db, A, ' cheap ', true)).toEqual({ ok: true, count: 1 }); // 1 only: 3 own, 4 touched, 5 not a whole word
    expect(m.visibleComments).toHaveBeenCalledWith(db, A, S.CANDIDATE_SCAN);
    expect(m.logMarks).toHaveBeenCalledWith(db, A, ['1', '2', '3', '4', '5']);
    m.visibleComments.mockResolvedValueOnce([cand('5', 'cheapest')]);
    expect(await previewWordRule(db, A, 'cheap', false)).toEqual({ ok: true, count: 1 }); // substring when asked
  });

  it('previewWordRule validates like the save, reads nothing for an invalid word, and never throws', async () => {
    expect(await previewWordRule(db, A, 'x', true)).toEqual({ ok: false, error: 'rule_too_short' });
    expect(await previewWordRule(db, A, 'spam', 'yes')).toEqual({ ok: false, error: 'invalid' });
    expect(m.visibleComments).not.toHaveBeenCalled();
    m.loadRules.mockResolvedValueOnce([{ id: RULE, kind: 'word', pattern: 'spam', wholeWord: false }]);
    expect(await previewWordRule(db, A, 'SPAM', true)).toEqual({ ok: false, error: 'duplicate_rule' });
    m.visibleComments.mockRejectedValueOnce(new Error('db down'));
    expect(await previewWordRule(db, A, 'spam', true)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('spam kinds are whitelisted', async () => {
    expect(await setSpamRule(db, A, 'link', true)).toEqual({ ok: true });
    expect(m.setSpamRow).toHaveBeenCalledWith(db, A, 'link', true);
    expect(await setSpamRule(db, A, 'word', true)).toEqual({ ok: false, error: 'invalid' });
    expect(await setSpamRule(db, A, 'link', 'on')).toEqual({ ok: false, error: 'invalid' });
  });

  it('switching auto-hide ON needs an active account with the scope and at least one rule; OFF always works', async () => {
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: false, error: 'no_rules' });
    m.loadRules.mockResolvedValueOnce([{ id: RULE, kind: 'link', pattern: null, wholeWord: false }]);
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: true });
    expect(m.saveAutoHide).toHaveBeenCalledWith(db, A, true, NOW.toISOString());
    state.account = { ...ACCOUNT, grantedScopes: null };
    expect(await setAutoHide(db, A, true, NOW)).toEqual({ ok: false, error: 'reconnect' });
    order.length = 0;
    expect(await setAutoHide(db, A, false, NOW)).toEqual({ ok: true });
    expect(order).toEqual(['saveAutoHide']);
    expect(await setAutoHide(db, A, 'true', NOW)).toEqual({ ok: false, error: 'invalid' });
  });
});
