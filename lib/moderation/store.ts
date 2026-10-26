// Moderation persistence (Plan 15d). The ONLY module that names moderation_settings / moderation_rules /
// moderation_log and writes comments (tests/moderation-privacy.test.ts). Every function takes the client to use: the
// OWNER SESSION from the app (RLS applies), the ADMIN client from the sync tick. Every comments / log query is filtered
// by account_id. Errors are ModerationStoreError with a fixed message and a reason; Supabase's message is never used
// (it can echo values). Comment text is read only for the preview and the log context; it is never written anywhere.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountStatus } from '@/lib/accounts/types';
import { MAX_WORD_RULES, pickAutoHide, RULE_KINDS, SPAM_KINDS, touchedIds, type Candidate, type LogMark, type ModerationRule, type RuleKind, type SpamKind } from '@/lib/moderation/rules';

export const LOG_PAGE = 50;
export const PREVIEW_SCAN = 1000; // newest stored comments the preview checks
export const CANDIDATE_SCAN = 200; // newest stored comments one tick checks per account
export const MARK_SCAN = 10_000; // ponytail: newest log rows read for "touched"; an account with more needs a SQL anti-join
export const PENDING_STALE_MS = 120_000;
export const CONTEXT_CHARS = 80;
export const PREVIEW_SAMPLE = 5;

export type LogAction = 'reply' | 'hide' | 'unhide' | 'delete' | 'delete_reply';
export type UndoKind = 'unhide' | 'delete_reply';
export interface LogRow {
  id: number;
  commentId: string;
  action: LogAction;
  actor: string;
  result: string;
  targetId: string | null;
  undoOf: number | null;
  createdAt: string;
  undoneAt: string | null;
}
export interface LogEntry extends LogRow {
  shown: string; // displayResult
  undo: UndoKind | null;
  context: { authorUsername: string | null; snippet: string | null } | null; // null = the comment is no longer stored
}
export interface ModerationSettings {
  autoHide: boolean;
  pausedAt: string | null;
  pauseReason: 'reconnect' | 'failing' | null;
}
export interface ModerationData {
  settings: ModerationSettings;
  rules: ModerationRule[];
  log: { rows: LogEntry[]; total: number; page: number; pages: number; size: number };
  preview: { count: number; scanned: number; sample: { id: string; authorUsername: string | null; snippet: string | null; rule: ModerationRule }[] };
}
export interface ActionAccount {
  id: string;
  username: string;
  status: AccountStatus;
  grantedScopes: string[] | null;
}

type Reason = 'missing' | 'duplicate' | 'not_found' | 'other';
type DbError = { code?: string } | null | undefined;
export class ModerationStoreError extends Error {
  constructor(op: string, public reason: Reason) {
    super(`moderation store: ${op} failed`);
    this.name = 'ModerationStoreError';
  }
}
const reasonOf = (e: DbError): Reason => (e?.code === 'PGRST205' || e?.code === '42P01' ? 'missing' : e?.code === '23505' ? 'duplicate' : e?.code === '23503' ? 'not_found' : 'other');
function check(op: string, e: DbError): void {
  if (e) throw new ModerationStoreError(op, reasonOf(e));
}
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const ACTIONS: readonly string[] = ['reply', 'hide', 'unhide', 'delete', 'delete_reply'];
const LOG_COLUMNS = 'id,comment_id,action,actor,result,target_id,undo_of,created_at,undone_at';

const toLog = (r: Row): LogRow | null =>
  typeof r.id === 'number' && typeof r.comment_id === 'string' && ACTIONS.includes(r.action as string) && typeof r.created_at === 'string'
    ? { id: r.id, commentId: r.comment_id, action: r.action as LogAction, actor: String(r.actor), result: String(r.result), targetId: str(r.target_id), undoOf: typeof r.undo_of === 'number' ? r.undo_of : null, createdAt: r.created_at, undoneAt: str(r.undone_at) }
    : null;
const toRule = (r: Row): ModerationRule | null =>
  typeof r.id === 'string' && (RULE_KINDS as readonly string[]).includes(r.kind as string) ? { id: r.id, kind: r.kind as RuleKind, pattern: str(r.pattern), wholeWord: r.whole_word === true } : null;
const rulesOf = (rows: Row[]) => rows.map(toRule).filter((r): r is ModerationRule => r !== null);
const toCandidate = (r: Row): Candidate => ({ id: String(r.id), authorUsername: str(r.author_username), text: str(r.text), hidden: r.hidden === true });

/** What the log can undo: an ok hide (unhide) and an ok reply whose id is known (delete it). Delete never. Once only. */
export function undoKind(r: Pick<LogRow, 'action' | 'result' | 'targetId' | 'undoneAt'>): UndoKind | null {
  if (r.result !== 'ok' || r.undoneAt !== null) return null;
  if (r.action === 'hide') return 'unhide';
  if (r.action === 'reply' && r.targetId !== null) return 'delete_reply';
  return null;
}

/** A row still 'pending' after PENDING_STALE_MS never got its outcome written (see the plan's repair rule): unknown. */
export const displayResult = (r: Pick<LogRow, 'result' | 'createdAt'>, now: Date): string =>
  r.result === 'pending' && now.getTime() - Date.parse(r.createdAt) > PENDING_STALE_MS ? 'unknown' : r.result;

export function snippet(text: string | null): string | null {
  if (text === null) return null;
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length > CONTEXT_CHARS ? chars.slice(0, CONTEXT_CHARS - 1).join('') + '…' : chars.join('');
}

// ---- the tab (owner session) ----

export async function loadModeration(db: SupabaseClient, accountId: string, ownUsername: string, page: number, now: Date): Promise<ModerationData | null> {
  const logPage = (p: number) =>
    db.from('moderation_log').select(LOG_COLUMNS, { count: 'exact' }).eq('account_id', accountId).order('created_at', { ascending: false }).order('id', { ascending: false }).range((p - 1) * LOG_PAGE, p * LOG_PAGE - 1);
  const [s, r, first] = await Promise.all([
    db.from('moderation_settings').select('auto_hide,paused_at,pause_reason').eq('account_id', accountId).maybeSingle(),
    db.from('moderation_rules').select('id,kind,pattern,whole_word').eq('account_id', accountId).order('created_at').limit(MAX_WORD_RULES + SPAM_KINDS.length),
    logPage(page),
  ]);
  if ([s.error, r.error, first.error].some((e) => reasonOf(e) === 'missing')) return null;
  check('loadModeration', s.error);
  check('loadModeration', r.error);
  let shownPage = page;
  let log = first;
  if (log.error?.code === 'PGRST103') {
    shownPage = 1; // a stale ?page= past the end: show page 1 (UI standard 12)
    log = await logPage(1);
  }
  check('loadModeration', log.error);
  const settingsRow = (s.data ?? {}) as Row;
  const rules = rulesOf((r.data ?? []) as Row[]);
  const rows = ((log.data ?? []) as Row[]).map(toLog).filter((x): x is LogRow => x !== null);
  const ids = [...new Set(rows.map((x) => x.commentId))];
  // started in this order (each async helper reaches its query at once), so a test's queued results come back in order:
  // the log page's context, then the preview's comments, then the marks
  const [ctx, visible, marks] = await Promise.all([
    (async () => (ids.length ? await db.from('comments').select('id,author_username,text').eq('account_id', accountId).in('id', ids) : { data: [], error: null }))(),
    visibleComments(db, accountId, PREVIEW_SCAN),
    logMarks(db, accountId),
  ]);
  check('loadModeration', ctx.error);
  const byId = new Map(((ctx.data ?? []) as Row[]).map((c) => [String(c.id), c]));
  const picks = pickAutoHide(visible, rules, { ownUsername, touched: touchedIds(marks), limit: Infinity });
  const total = log.count ?? rows.length;
  return {
    settings: { autoHide: settingsRow.auto_hide === true, pausedAt: str(settingsRow.paused_at), pauseReason: settingsRow.pause_reason === 'reconnect' || settingsRow.pause_reason === 'failing' ? settingsRow.pause_reason : null },
    rules,
    log: {
      rows: rows.map((x) => {
        const c = byId.get(x.commentId);
        return { ...x, shown: displayResult(x, now), undo: undoKind(x), context: c ? { authorUsername: str(c.author_username), snippet: snippet(str(c.text)) } : null };
      }),
      total,
      page: shownPage,
      pages: Math.max(1, Math.ceil(total / LOG_PAGE)),
      size: LOG_PAGE,
    },
    preview: { count: picks.length, scanned: visible.length, sample: picks.slice(0, PREVIEW_SAMPLE).map((p) => ({ id: p.comment.id, authorUsername: p.comment.authorUsername, snippet: snippet(p.comment.text), rule: p.rule })) },
  };
}

// ---- actions ----

export async function getActionAccount(db: SupabaseClient, accountId: string): Promise<ActionAccount | null> {
  const { data, error } = await db.from('accounts').select('id,username,status,granted_scopes').eq('id', accountId).maybeSingle();
  check('getActionAccount', error);
  const r = data as Row | null;
  if (!r || typeof r.username !== 'string') return null;
  return { id: String(r.id), username: r.username, status: r.status as AccountStatus, grantedScopes: Array.isArray(r.granted_scopes) ? r.granted_scopes.filter((x): x is string => typeof x === 'string') : null };
}

export async function getActionComment(db: SupabaseClient, accountId: string, commentId: string): Promise<{ id: string; authorUsername: string | null; hidden: boolean } | null> {
  const { data, error } = await db.from('comments').select('id,author_username,hidden').eq('id', commentId).eq('account_id', accountId).maybeSingle();
  check('getActionComment', error);
  const r = data as Row | null;
  return r ? { id: String(r.id), authorUsername: str(r.author_username), hidden: r.hidden === true } : null;
}

export async function countRecentOwnerActions(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number> {
  const { count, error } = await db.from('moderation_log').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('actor', 'owner').gte('created_at', sinceIso);
  check('countRecentOwnerActions', error);
  return count ?? 0;
}

export async function insertLog(db: SupabaseClient, row: { accountId: string; commentId: string; action: LogAction; actor: string; requestId: string; undoOf?: number; targetId?: string }): Promise<number> {
  const payload: Row = { account_id: row.accountId, comment_id: row.commentId, action: row.action, actor: row.actor, request_id: row.requestId };
  if (row.undoOf !== undefined) payload.undo_of = row.undoOf;
  if (row.targetId !== undefined) payload.target_id = row.targetId;
  const { data, error } = await db.from('moderation_log').insert(payload).select('id').single();
  check('insertLog', error);
  const id = (data as Row | null)?.id;
  if (typeof id !== 'number') throw new ModerationStoreError('insertLog', 'other');
  return id;
}

export async function finishLog(db: SupabaseClient, id: number, result: string, targetId?: string | null): Promise<void> {
  const patch: Row = { result };
  if (targetId !== undefined) patch.target_id = targetId;
  const { error } = await db.from('moderation_log').update(patch).eq('id', id);
  check('finishLog', error);
}

export async function getLog(db: SupabaseClient, accountId: string, id: number): Promise<LogRow | null> {
  const { data, error } = await db.from('moderation_log').select(LOG_COLUMNS).eq('id', id).eq('account_id', accountId).maybeSingle();
  check('getLog', error);
  return data ? toLog(data as Row) : null;
}

export async function markUndone(db: SupabaseClient, accountId: string, id: number, atIso: string): Promise<boolean> {
  const { data, error } = await db.from('moderation_log').update({ undone_at: atIso }).eq('id', id).eq('account_id', accountId).is('undone_at', null).select('id');
  check('markUndone', error);
  return ((data ?? []) as Row[]).length > 0;
}

export async function setCommentHidden(db: SupabaseClient, accountId: string, commentId: string, hidden: boolean): Promise<void> {
  const { error } = await db.from('comments').update({ hidden }).eq('id', commentId).eq('account_id', accountId);
  check('setCommentHidden', error);
}

/** After a delete on Instagram (or "comment gone"): our copy goes too (third-party data we no longer need). */
export async function removeComment(db: SupabaseClient, accountId: string, commentId: string): Promise<void> {
  const { error } = await db.from('comments').delete().eq('id', commentId).eq('account_id', accountId);
  check('removeComment', error);
}

// ---- rules and settings (owner session) ----

export async function loadRules(db: SupabaseClient, accountId: string): Promise<ModerationRule[]> {
  const { data, error } = await db.from('moderation_rules').select('id,kind,pattern,whole_word').eq('account_id', accountId).order('created_at').limit(MAX_WORD_RULES + SPAM_KINDS.length);
  check('loadRules', error);
  return rulesOf((data ?? []) as Row[]);
}

export async function insertWordRule(db: SupabaseClient, accountId: string, pattern: string, wholeWord: boolean): Promise<void> {
  const { error } = await db.from('moderation_rules').insert({ account_id: accountId, kind: 'word', pattern, whole_word: wholeWord });
  check('insertWordRule', error);
}

/** On = a row (the partial unique index keeps it single: a second insert's 23505 means "already on"); off = no row. */
export async function setSpamRow(db: SupabaseClient, accountId: string, kind: SpamKind, on: boolean): Promise<void> {
  if (on) {
    const { error } = await db.from('moderation_rules').insert({ account_id: accountId, kind });
    if (reasonOf(error) !== 'duplicate') check('setSpamRow', error);
    return;
  }
  const { error } = await db.from('moderation_rules').delete().eq('account_id', accountId).eq('kind', kind);
  check('setSpamRow', error);
}

export async function deleteRuleRow(db: SupabaseClient, accountId: string, ruleId: string): Promise<boolean> {
  const { data, error } = await db.from('moderation_rules').delete().eq('id', ruleId).eq('account_id', accountId).select('id');
  check('deleteRuleRow', error);
  return ((data ?? []) as Row[]).length > 0;
}

/** Switching on (again) also lifts a pause; switching off clears it too. */
export async function saveAutoHide(db: SupabaseClient, accountId: string, enabled: boolean, nowIso: string): Promise<void> {
  const { error } = await db.from('moderation_settings').upsert({ account_id: accountId, auto_hide: enabled, paused_at: null, pause_reason: null, updated_at: nowIso }, { onConflict: 'account_id' });
  check('saveAutoHide', error);
}

// ---- the tick (admin client) ----

export async function autoHideAccounts(db: SupabaseClient): Promise<{ accountId: string; rules: ModerationRule[] }[] | null> {
  const s = await db.from('moderation_settings').select('account_id').eq('auto_hide', true).is('paused_at', null);
  if (reasonOf(s.error) === 'missing') return null;
  check('autoHideAccounts', s.error);
  const ids = ((s.data ?? []) as Row[]).map((r) => String(r.account_id));
  if (ids.length === 0) return [];
  const r = await db.from('moderation_rules').select('id,account_id,kind,pattern,whole_word').in('account_id', ids).order('created_at');
  check('autoHideAccounts', r.error);
  const rows = (r.data ?? []) as Row[];
  return ids.map((accountId) => ({ accountId, rules: rulesOf(rows.filter((x) => x.account_id === accountId)) }));
}

/** Stored comments not hidden by us, newest first. */
export async function visibleComments(db: SupabaseClient, accountId: string, limit: number): Promise<Candidate[]> {
  const { data, error } = await db.from('comments').select('id,author_username,text,hidden').eq('account_id', accountId).eq('hidden', false).order('commented_at', { ascending: false }).limit(limit);
  check('visibleComments', error);
  return ((data ?? []) as Row[]).map(toCandidate);
}

export async function logMarks(db: SupabaseClient, accountId: string): Promise<LogMark[]> {
  const { data, error } = await db.from('moderation_log').select('comment_id,actor,result').eq('account_id', accountId).order('created_at', { ascending: false }).limit(MARK_SCAN);
  check('logMarks', error);
  return ((data ?? []) as Row[]).map((r) => ({ commentId: String(r.comment_id), actor: String(r.actor), result: String(r.result) }));
}

/** Only the first pause counts (its paused_at is the notification's dedupe key). */
export async function pauseAutoHide(db: SupabaseClient, accountId: string, reason: 'reconnect' | 'failing', atIso: string): Promise<void> {
  const { error } = await db.from('moderation_settings').update({ paused_at: atIso, pause_reason: reason, updated_at: atIso }).eq('account_id', accountId).is('paused_at', null);
  check('pauseAutoHide', error);
}
