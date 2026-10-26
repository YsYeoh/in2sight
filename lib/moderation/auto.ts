// Auto-hide (Plan 15d): a pass of the sync tick that runs AFTER the lanes and the alerts, in its own window, so it can
// never take time from either. It reads only comments the comments job already stored, hides at most
// AUTO_HIDE_PER_TICK per account, logs every hide (actor rule:<id>) BEFORE sending it, never acts on a comment the
// owner touched or a rule already finished (touchedIds), never deletes, and pauses itself on a permission answer or
// FAIL_LIMIT failures in a row (one notification per pause: lib/alerts/rules.ts). Never throws; one account's trouble
// never stops the others. Counts only leave this module (they go into sync_runs).
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { classifyIgError } from '@/lib/instagram/data';
import { classifyModerationError, type IgModeration } from '@/lib/instagram/moderation';
import { pickAutoHide, touchedIds, type ModerationRule } from '@/lib/moderation/rules';
import * as S from '@/lib/moderation/store';

export const AUTO_HIDE_PER_TICK = 20;
/** After the alerts' window: 35 s sync + 10 s alerts + 5 s here; each write times out after 5 s (route maxDuration 60 s). */
export const MODERATION_BUDGET_MS = 5_000;
export const FAIL_LIMIT = 3;

export interface AutoHideDeps {
  db: SupabaseClient; // admin client (the tick has no owner session)
  ig: Pick<IgModeration, 'hide'>;
  token: (accountId: string) => Promise<string | null>;
  newId?: () => string;
}
export interface AutoHideSummary {
  hidden: number;
  failed: number;
  paused: number;
}
export interface AutoHideContext {
  accounts: StoredAccount[]; // fresh: an account flipped to needs_reconnect in this tick is skipped
  now: Date;
  deadline: number; // ms epoch
  clock: () => number;
  accountId?: string; // manual "Sync now" for one account
}

interface AccountRun {
  hidden: number;
  failed: number;
  paused: boolean;
  stopAll: boolean; // app-wide rate limit: every further call would fail too
}

async function hideForAccount(deps: AutoHideDeps, account: StoredAccount, rules: ModerationRule[], c: AutoHideContext): Promise<AccountRun> {
  const out: AccountRun = { hidden: 0, failed: 0, paused: false, stopAll: false };
  const [cands, marks] = await Promise.all([S.visibleComments(deps.db, account.id, S.CANDIDATE_SCAN), S.logMarks(deps.db, account.id)]);
  const picks = pickAutoHide(cands, rules, { ownUsername: account.username, touched: touchedIds(marks), limit: AUTO_HIDE_PER_TICK });
  if (picks.length === 0) return out;
  const token = await deps.token(account.id);
  if (!token) return out; // the sync flags a missing token
  const nowIso = c.now.toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let streak = 0;
  for (const { comment, rule } of picks) {
    if (c.clock() >= c.deadline) break;
    // the row first: an insert failure throws and stops this account, so there is never an unlogged hide
    const logId = await S.insertLog(deps.db, { accountId: account.id, commentId: comment.id, action: 'hide', actor: `rule:${rule.id}`, requestId: newId() });
    try {
      await deps.ig.hide(token, comment.id, true);
    } catch (e) {
      const key = classifyModerationError(e);
      await S.finishLog(deps.db, logId, key).catch(() => {});
      if (key === 'comment_gone') {
        await S.removeComment(deps.db, account.id, comment.id).catch(() => {});
        continue;
      }
      out.failed++;
      if (key === 'reconnect') {
        await S.pauseAutoHide(deps.db, account.id, 'reconnect', nowIso);
        out.paused = true;
        return out;
      }
      if (key === 'rate_limited') {
        out.stopAll = classifyIgError(e) === 'app_rate_limit';
        return out;
      }
      if (++streak >= FAIL_LIMIT) {
        await S.pauseAutoHide(deps.db, account.id, 'failing', nowIso);
        out.paused = true;
        return out;
      }
      continue;
    }
    streak = 0;
    await S.finishLog(deps.db, logId, 'ok').catch(() => {}); // left 'pending' = touched: never retried automatically
    await S.setCommentHidden(deps.db, account.id, comment.id, true).catch(() => {});
    out.hidden++;
  }
  return out;
}

export async function runAutoHide(deps: AutoHideDeps, c: AutoHideContext): Promise<AutoHideSummary> {
  const out: AutoHideSummary = { hidden: 0, failed: 0, paused: 0 };
  let list: Awaited<ReturnType<typeof S.autoHideAccounts>>;
  try {
    list = await S.autoHideAccounts(deps.db);
  } catch {
    out.failed++;
    return out;
  }
  if (!list) return out; // the moderation migration is not applied
  for (const { accountId, rules } of list) {
    if (c.clock() >= c.deadline) break;
    if (c.accountId && accountId !== c.accountId) continue;
    const account = c.accounts.find((a) => a.id === accountId);
    if (!account || account.status !== 'active' || !hasScope(account, COMMENTS_SCOPE) || rules.length === 0) continue;
    try {
      const r = await hideForAccount(deps, account, rules, c);
      out.hidden += r.hidden;
      out.failed += r.failed;
      if (r.paused) out.paused++;
      if (r.stopAll) break;
    } catch {
      out.failed++;
    }
  }
  return out;
}
