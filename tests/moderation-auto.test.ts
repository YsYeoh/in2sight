// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMENTS_SCOPE } from '@/lib/accounts/scopes';
import { InstagramApiError } from '@/lib/instagram/oauth';
import type { Candidate, ModerationRule } from '@/lib/moderation/rules';
import { account } from './fixtures/sync-fakes';

const { order } = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock('@/lib/moderation/store', async (orig) => {
  const real = await orig<typeof import('@/lib/moderation/store')>();
  const f = (name: string) => vi.fn(async (): Promise<unknown> => void order.push(name));
  return { ...real, autoHideAccounts: vi.fn(), visibleComments: vi.fn(), logMarks: vi.fn(), insertLog: vi.fn(), finishLog: f('finishLog'), setCommentHidden: f('setHidden'), removeComment: f('removeComment'), pauseAutoHide: f('pause') };
});

import * as S from '@/lib/moderation/store';
import { AUTO_HIDE_PER_TICK, FAIL_LIMIT, runAutoHide, type AutoHideContext, type AutoHideDeps } from '@/lib/moderation/auto';

const m = vi.mocked(S);
const RULE: ModerationRule = { id: '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e', kind: 'word', pattern: 'spam', wholeWord: false };
const NOW = new Date('2026-10-29T10:00:00Z');
const db = {} as SupabaseClient;
const spam = (id: string, o: Partial<Candidate> = {}): Candidate => ({ id, authorUsername: 'bot', text: `spam ${id}`, hidden: false, ...o });
const scoped = (id: string, o = {}) => account({ id, username: `shop_${id}`, grantedScopes: [COMMENTS_SCOPE], ...o });
let comments: Record<string, Candidate[]>;

function setup(o: { ig?: AutoHideDeps['ig']; ctx?: Partial<AutoHideContext> } = {}) {
  let req = 0;
  const deps: AutoHideDeps = {
    db,
    ig: o.ig ?? { hide: vi.fn(async (_t: string, id: string) => void order.push(`hide:${id}`)) },
    token: vi.fn(async (id: string) => `tok-${id}`),
    newId: () => `req-${++req}`,
  };
  const ctx: AutoHideContext = { accounts: [scoped('a1'), scoped('a2')], now: NOW, deadline: Infinity, clock: () => 0, ...o.ctx };
  return { deps, ctx };
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  comments = { a1: [spam('c1'), spam('c2')], a2: [spam('d1')] };
  m.autoHideAccounts.mockResolvedValue([{ accountId: 'a1', rules: [RULE] }, { accountId: 'a2', rules: [RULE] }]);
  m.visibleComments.mockImplementation(async (_db, id) => comments[id] ?? []);
  m.logMarks.mockResolvedValue([]);
  let n = 0;
  m.insertLog.mockImplementation(async () => (order.push('insertLog'), ++n));
});

describe('runAutoHide', () => {
  it('per comment: log row (actor rule:<id>) → hide → ok → local hidden; counts only in the summary', async () => {
    const { deps, ctx } = setup();
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 3, failed: 0, paused: 0 });
    expect(order.slice(0, 4)).toEqual(['insertLog', 'hide:c1', 'finishLog', 'setHidden']);
    expect(m.insertLog).toHaveBeenCalledWith(db, { accountId: 'a1', commentId: 'c1', action: 'hide', actor: `rule:${RULE.id}`, requestId: 'req-1' });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'ok');
    expect(m.visibleComments).toHaveBeenCalledWith(db, 'a1', S.CANDIDATE_SCAN);
  });

  it(`at most ${AUTO_HIDE_PER_TICK} hides per account per tick`, async () => {
    comments.a1 = Array.from({ length: 25 }, (_, i) => spam(`c${i}`));
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    expect((await runAutoHide(deps, ctx)).hidden).toBe(AUTO_HIDE_PER_TICK);
  });

  it('never touches what the owner acted on, what a rule already did, or the account itself', async () => {
    comments.a1 = [spam('c1'), spam('c2'), spam('c3', { authorUsername: 'SHOP_A1' }), spam('c4', { hidden: true })];
    m.logMarks.mockResolvedValue([{ commentId: 'c1', actor: 'owner', result: 'ok' }, { commentId: 'c2', actor: `rule:${RULE.id}`, result: 'pending' }]);
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(deps.token).not.toHaveBeenCalled(); // nothing to do: no token read
  });

  it('skips accounts that are not active, lack the scope, are not in the fresh list, or have no rules', async () => {
    m.autoHideAccounts.mockResolvedValue([
      { accountId: 'a1', rules: [RULE] },
      { accountId: 'a2', rules: [RULE] },
      { accountId: 'gone', rules: [RULE] },
      { accountId: 'a3', rules: [] },
    ]);
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1', { status: 'needs_reconnect' }), account({ id: 'a2' }), scoped('a3')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(m.visibleComments).not.toHaveBeenCalled();
  });

  it('a permission answer pauses that account (reason reconnect) and the next account still runs', async () => {
    const ig = { hide: vi.fn(async (t: string, id: string) => {
      if (t === 'tok-a1') throw new InstagramApiError('data', 403, 200);
      order.push(`hide:${id}`);
    }) };
    const { deps, ctx } = setup({ ig });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 1, paused: 1 });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'reconnect');
    expect(m.pauseAutoHide).toHaveBeenCalledWith(db, 'a1', 'reconnect', NOW.toISOString());
    expect(ig.hide).toHaveBeenCalledTimes(2); // c1 of a1 (refused), d1 of a2
  });

  it(`${FAIL_LIMIT} failures in a row pause the account (reason failing); a success in between resets the count`, async () => {
    comments.a1 = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((id) => spam(id));
    let call = 0;
    const ig = { hide: vi.fn(async () => {
      call++;
      if (call !== 3) throw new InstagramApiError('data', 400, 100); // not_allowed, except the 3rd
    }) };
    const { deps, ctx } = setup({ ig, ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 5, paused: 1 }); // fail, fail, ok, fail, fail, fail -> pause; c7 untouched
    expect(ig.hide).toHaveBeenCalledTimes(6);
    expect(m.pauseAutoHide).toHaveBeenCalledWith(db, 'a1', 'failing', NOW.toISOString());
  });

  it('a rate limit stops that account only; an app-wide one stops the pass', async () => {
    const user = { hide: vi.fn(async (t: string) => { if (t === 'tok-a1') throw new InstagramApiError('data', 400, 17); }) };
    const a = setup({ ig: user });
    expect(await runAutoHide(a.deps, a.ctx)).toEqual({ hidden: 1, failed: 1, paused: 0 });
    expect(m.pauseAutoHide).not.toHaveBeenCalled();
    const app = { hide: vi.fn(async () => { throw new InstagramApiError('data', 400, 4); }) };
    const b = setup({ ig: app });
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 1, paused: 0 });
    expect(app.hide).toHaveBeenCalledTimes(1);
  });

  it('a comment already gone on Instagram is logged, removed here, and is not a failure', async () => {
    const ig = { hide: vi.fn(async (_t: string, id: string) => { if (id === 'c1') throw new InstagramApiError('data', 400, 100, 33); }) };
    const { deps, ctx } = setup({ ig, ctx: { accounts: [scoped('a1')] } });
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 0, paused: 0 });
    expect(m.finishLog).toHaveBeenCalledWith(db, 1, 'comment_gone');
    expect(m.removeComment).toHaveBeenCalledWith(db, 'a1', 'c1');
  });

  it('no log row → no hide: the account stops, the next one runs', async () => {
    m.insertLog.mockRejectedValueOnce(new S.ModerationStoreError('insertLog', 'other'));
    const { deps, ctx } = setup();
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 1, failed: 1, paused: 0 });
    expect(deps.ig.hide).toHaveBeenCalledTimes(1);
    expect(deps.ig.hide).toHaveBeenCalledWith('tok-a2', 'd1', true);
  });

  it('no stored token: nothing is sent for that account', async () => {
    const { deps, ctx } = setup({ ctx: { accounts: [scoped('a1')] } });
    vi.mocked(deps.token).mockResolvedValue(null);
    expect(await runAutoHide(deps, ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
    expect(m.insertLog).not.toHaveBeenCalled();
  });

  it('stops at the deadline; honours a single-account (manual) run; never throws', async () => {
    let t = 0;
    const a = setup({ ctx: { deadline: 2, clock: () => t++ } });
    expect((await runAutoHide(a.deps, a.ctx)).hidden).toBeLessThan(3);
    const b = setup({ ctx: { accountId: 'a2' } });
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 1, failed: 0, paused: 0 });
    m.autoHideAccounts.mockRejectedValueOnce(new Error('db down'));
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 1, paused: 0 });
    m.autoHideAccounts.mockResolvedValueOnce(null); // before the migration
    expect(await runAutoHide(b.deps, b.ctx)).toEqual({ hidden: 0, failed: 0, paused: 0 });
  });
});
