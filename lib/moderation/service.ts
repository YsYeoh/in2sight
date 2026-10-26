// Owner moderation actions (Plan 15d). Called by the server actions AFTER requireOwner(); validates everything itself
// (values come straight from the browser) and never throws. Order of one action (the plan's repair rule): account
// gate -> the comment re-read with BOTH ids -> per-minute cap -> log row ('pending', unique request id) -> token ->
// Instagram -> the row's result -> the local mirror. No Instagram write without a log row; a repeated request id is
// refused by the database before anything is sent. The token stays inside this call: never returned, never logged.
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import { classifyModerationError, type IgModeration, type ModerationErrorKey } from '@/lib/instagram/moderation';
import { MAX_WORD_RULES, pickAutoHide, REPLY_MAX, SPAM_KINDS, touchedIds, validateWord, type SpamKind } from '@/lib/moderation/rules';
import * as S from '@/lib/moderation/store';
import { isMediaId, isUuid } from '@/lib/tags';

export const MANUAL_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

export type ModerationError = ModerationErrorKey | 'invalid' | 'not_found' | 'not_active' | 'duplicate' | 'too_many' | 'already_done' | 'cannot_undo' | 'not_ready';
export type ModerationResult = { ok: true; logged: boolean } | { ok: false; error: ModerationError };
export type RuleError = 'invalid' | 'not_found' | 'not_active' | 'reconnect' | 'not_ready' | 'invalid_word' | 'rule_too_short' | 'duplicate_rule' | 'too_many_rules' | 'no_rules' | 'unexpected';
export type RuleResult = { ok: true } | { ok: false; error: RuleError };
export type PreviewResult = { ok: true; count: number } | { ok: false; error: RuleError };

export interface ServiceDeps {
  db: SupabaseClient; // owner session
  token: (accountId: string) => Promise<string | null>; // admin client, account_tokens: server only
  ig: Pick<IgModeration, 'hide' | 'reply' | 'remove'>;
  now?: () => Date;
}
export interface ManualInput {
  kind: 'hide' | 'unhide' | 'delete' | 'reply';
  accountId: string;
  commentId: string;
  requestId: string;
  message?: string;
}

const KINDS: readonly string[] = ['hide', 'unhide', 'delete', 'reply'];
const fail = <E extends string>(error: E) => ({ ok: false as const, error });
const storeKey = (e: unknown): 'not_ready' | 'duplicate' | 'not_found' | 'unexpected' =>
  e instanceof S.ModerationStoreError ? (e.reason === 'missing' ? 'not_ready' : e.reason === 'other' ? 'unexpected' : e.reason) : 'unexpected';

/** Active, with the comments scope; otherwise the error to show. */
async function gate(db: SupabaseClient, accountId: string): Promise<S.ActionAccount | 'not_found' | 'not_active' | 'reconnect'> {
  const a = await S.getActionAccount(db, accountId);
  if (!a) return 'not_found';
  if (a.status === 'archived') return 'not_active';
  if (a.status !== 'active' || !hasScope(a, COMMENTS_SCOPE)) return 'reconnect';
  return a;
}

interface Step {
  accountId: string;
  commentId: string;
  action: S.LogAction;
  requestId: string;
  message?: string;
  undoOf?: number;
  target?: string; // delete_reply: the reply id, from the stored log row
}

/** Steps 1–6 of the plan's algorithm. Store errors before Instagram propagate to the caller's catch. */
async function execute(deps: ServiceDeps, a: Step): Promise<ModerationResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  if ((await S.countRecentOwnerActions(db, a.accountId, new Date(now.getTime() - MINUTE_MS).toISOString())) >= MANUAL_PER_MINUTE) return fail('too_many');
  const logId = await S.insertLog(db, {
    accountId: a.accountId,
    commentId: a.commentId,
    action: a.action,
    actor: 'owner',
    requestId: a.requestId,
    ...(a.undoOf !== undefined ? { undoOf: a.undoOf } : {}),
    ...(a.action === 'delete_reply' && a.target ? { targetId: a.target } : {}),
  });
  let token: string | null;
  try {
    token = await deps.token(a.accountId);
  } catch {
    await S.finishLog(db, logId, 'unexpected').catch(() => {});
    return fail('unexpected');
  }
  if (!token) {
    await S.finishLog(db, logId, 'reconnect').catch(() => {});
    return fail('reconnect');
  }
  let replyId: string | null = null;
  try {
    if (a.action === 'hide' || a.action === 'unhide') await deps.ig.hide(token, a.commentId, a.action === 'hide');
    else if (a.action === 'delete') await deps.ig.remove(token, a.commentId);
    else if (a.action === 'delete_reply') await deps.ig.remove(token, a.target!);
    else replyId = await deps.ig.reply(token, a.commentId, a.message!);
  } catch (e) {
    const key = classifyModerationError(e, a.action === 'reply' ? 'reply' : 'other');
    await S.finishLog(db, logId, key).catch(() => {});
    return fail(key);
  }
  let logged = true;
  await S.finishLog(db, logId, 'ok', a.action === 'reply' ? replyId : undefined).catch(() => {
    logged = false; // Instagram did it; the row stays 'pending' and shows "Outcome unknown"
  });
  const mirror =
    a.action === 'delete' ? S.removeComment(db, a.accountId, a.commentId) : a.action === 'hide' || a.action === 'unhide' ? S.setCommentHidden(db, a.accountId, a.commentId, a.action === 'hide') : Promise.resolve();
  await mirror.catch(() => {}); // the local copy only; the next action or sync corrects it
  return { ok: true, logged };
}

export async function moderate(deps: ServiceDeps, input: ManualInput): Promise<ModerationResult> {
  const { kind, accountId, commentId, requestId } = input;
  if (!KINDS.includes(kind) || !isUuid(accountId) || !isUuid(requestId) || !isMediaId(commentId)) return fail('invalid');
  let message: string | undefined;
  if (kind === 'reply') {
    message = typeof input.message === 'string' ? input.message.trim() : '';
    if (message === '' || [...message].length > REPLY_MAX) return fail('invalid');
  }
  try {
    const account = await gate(deps.db, accountId);
    if (typeof account === 'string') return fail(account);
    const comment = await S.getActionComment(deps.db, accountId, commentId); // both ids: a comment of another account is "not found"
    if (!comment) return fail('not_found');
    if (kind === 'hide' || kind === 'unhide') {
      if (comment.authorUsername?.toLowerCase() === account.username.toLowerCase()) return fail('not_allowed'); // Meta always shows the owner's own comments
      if (comment.hidden === (kind === 'hide')) return fail('already_done');
    }
    return await execute(deps, { accountId, commentId, action: kind, requestId, message });
  } catch (e) {
    return fail(storeKey(e));
  }
}

/** Undo a hide (unhide) or a reply (delete it). Targets come from the stored row only, selected with the account id. */
export async function undoAction(deps: ServiceDeps, input: { accountId: string; logId: number; requestId: string }): Promise<ModerationResult> {
  const { accountId, logId, requestId } = input;
  if (!isUuid(accountId) || !isUuid(requestId) || !Number.isSafeInteger(logId) || logId < 1) return fail('invalid');
  try {
    const account = await gate(deps.db, accountId);
    if (typeof account === 'string') return fail(account);
    const row = await S.getLog(deps.db, accountId, logId);
    if (!row) return fail('not_found');
    if (row.undoneAt !== null) return fail('already_done');
    const kind = S.undoKind(row);
    if (!kind) return fail('cannot_undo');
    const r = await execute(deps, { accountId, commentId: row.commentId, action: kind, requestId, undoOf: row.id, target: row.targetId ?? undefined });
    if (r.ok) await S.markUndone(deps.db, accountId, row.id, (deps.now?.() ?? new Date()).toISOString()).catch(() => {});
    return r;
  } catch (e) {
    return fail(storeKey(e));
  }
}

const ruleKey = (e: unknown): RuleError => {
  const k = storeKey(e);
  return k === 'duplicate' ? 'duplicate_rule' : k;
};

/** Whole word is the default (only an explicit false means "also inside longer words"). */
export async function saveWordRule(db: SupabaseClient, accountId: string, pattern: unknown, wholeWord: unknown = true): Promise<RuleResult> {
  if (!isUuid(accountId) || typeof wholeWord !== 'boolean') return fail('invalid');
  try {
    const account = await gate(db, accountId);
    if (typeof account === 'string') return fail(account);
    const v = validateWord(pattern, await S.loadRules(db, accountId));
    if (!v.ok) return fail(v.error);
    // ponytail: re-counted right before the insert, not atomic: two simultaneous adds at 199 can reach 201; a DB trigger would close it
    if ((await S.countWordRules(db, accountId)) >= MAX_WORD_RULES) return fail('too_many_rules');
    await S.insertWordRule(db, accountId, v.pattern, wholeWord);
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}

/**
 * How many of the stored visible comments (auto-hide's own window) this NEW word alone would hide: the same validation,
 * the same matcher and the same exclusions (own comments, anything touched) as the tick. A count only, never text.
 */
export async function previewWordRule(db: SupabaseClient, accountId: string, pattern: unknown, wholeWord: unknown = true): Promise<PreviewResult> {
  if (!isUuid(accountId) || typeof wholeWord !== 'boolean') return fail('invalid');
  try {
    const account = await gate(db, accountId);
    if (typeof account === 'string') return fail(account);
    const v = validateWord(pattern, await S.loadRules(db, accountId));
    if (!v.ok) return fail(v.error);
    const cands = await S.visibleComments(db, accountId, S.CANDIDATE_SCAN);
    const marks = await S.logMarks(db, accountId, cands.map((c) => c.id));
    const picks = pickAutoHide(cands, [{ id: 'preview', kind: 'word', pattern: v.pattern, wholeWord }], { ownUsername: account.username, touched: touchedIds(marks), limit: Infinity });
    return { ok: true, count: picks.length };
  } catch (e) {
    return fail(ruleKey(e));
  }
}

/** Switching a pattern on needs an active account with the scope; switching it off is always allowed. */
export async function setSpamRule(db: SupabaseClient, accountId: string, kind: unknown, on: unknown): Promise<RuleResult> {
  if (!isUuid(accountId) || !(SPAM_KINDS as readonly unknown[]).includes(kind) || typeof on !== 'boolean') return fail('invalid');
  try {
    if (on) {
      const account = await gate(db, accountId);
      if (typeof account === 'string') return fail(account);
    }
    await S.setSpamRow(db, accountId, kind as SpamKind, on);
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}

export async function deleteRule(db: SupabaseClient, accountId: string, ruleId: unknown): Promise<RuleResult> {
  if (!isUuid(accountId) || !isUuid(ruleId)) return fail('invalid');
  try {
    return (await S.deleteRuleRow(db, accountId, ruleId)) ? { ok: true } : fail('not_found');
  } catch (e) {
    return fail(ruleKey(e));
  }
}

/** On: active + scope + at least one rule (the Moderation tab showed the preview in its confirm). Off: always. */
export async function setAutoHide(db: SupabaseClient, accountId: string, enabled: unknown, now: Date = new Date()): Promise<RuleResult> {
  if (!isUuid(accountId) || typeof enabled !== 'boolean') return fail('invalid');
  try {
    if (enabled) {
      const account = await gate(db, accountId);
      if (typeof account === 'string') return fail(account);
      if ((await S.loadRules(db, accountId)).length === 0) return fail('no_rules');
    }
    await S.saveAutoHide(db, accountId, enabled, now.toISOString());
    return { ok: true };
  } catch (e) {
    return fail(ruleKey(e));
  }
}
