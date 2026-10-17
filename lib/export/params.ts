// Export / report request parameters. Every value comes from a URL, so everything is allow-listed: anything else is
// rejected with the error key 'bad_params' (never echoed back, never "fixed up" into a different export).
import { normalizeGroup } from '@/lib/accounts/group';
import type { StoredAccount } from '@/lib/accounts/types';
import { isUuid } from '@/lib/tags';
import { isDay } from '@/lib/time-scope/range';
import { parseTimeScope, PRESETS, SCOPE_KEYS, type TimeScope } from '@/lib/time-scope/scope';

export const SECTIONS = ['kpis', 'trend', 'topPosts', 'formats', 'tags', 'bestTime', 'audience', 'stories', 'flags'] as const;
export type Section = (typeof SECTIONS)[number];

export type ExportScope = { kind: 'all' } | { kind: 'group'; name: string } | { kind: 'account'; id: string };
export interface ExportParams {
  scope: ExportScope;
  time: TimeScope; // the page's Time Scope (Plan 12a)
}
export interface ReportParams extends ExportParams {
  sections: Section[];
  title: string; // '' = the translated default title
  note: string;
}
export type Parsed<T> = { ok: true; params: T } | { ok: false; error: 'bad_params' };

export const TITLE_MAX = 120;
export const NOTE_MAX = 1000;

const BAD = { ok: false, error: 'bad_params' } as const;
// C0/C1 controls (except tab/newline, handled below) and bidi overrides/isolates that can disguise text
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** Exactly one value per key: `?scope=a&scope=b` is ambiguous, so it is rejected rather than guessed. */
function single(q: URLSearchParams, key: string): string | null {
  const all = q.getAll(key);
  return all.length === 1 ? all[0] : null;
}

export function parseScope(v: string | null): ExportScope | null {
  if (v === 'all') return { kind: 'all' };
  if (v?.startsWith('a:') && isUuid(v.slice(2))) return { kind: 'account', id: v.slice(2).toLowerCase() };
  if (v?.startsWith('g:')) {
    const g = normalizeGroup(v.slice(2));
    return g.ok && g.value !== null && g.value === v.slice(2) ? { kind: 'group', name: g.value } : null;
  }
  return null;
}

export const scopeParam = (s: ExportScope): string => (s.kind === 'all' ? 'all' : s.kind === 'group' ? `g:${s.name}` : `a:${s.id}`);

/** Free text (title, note): NFC, no control/bidi characters, at most `max` code points. Over-long text is rejected, not cut. */
function text(v: string | null, max: number, multiline: boolean): string | null {
  if (v === null) return '';
  const nfc = v.normalize('NFC').replace(/\r\n?/g, '\n');
  if (FORBIDDEN.test(nfc) || (!multiline && nfc.includes('\n'))) return null;
  const value = (multiline ? nfc.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : nfc.replace(/\s+/g, ' ')).trim();
  return [...value].length <= max ? value : null;
}

/** What an export accepts per Time Scope key: the canonical form the dialog sends, plus old `period=7|30|90` links. The
 *  picker shorthands (week/month/quarter) are for the pages only. */
const TIME_VALUE: Partial<Record<(typeof SCOPE_KEYS)[number], (v: string) => boolean>> = {
  from: (v) => (PRESETS as readonly string[]).includes(v) || isDay(v),
  to: isDay,
  cmp: (v) => v === 'prev' || v === 'yoy' || v === 'none',
  cfrom: isDay,
  cto: isDay,
  gran: (v) => v === 'day' || v === 'week' || v === 'month',
  period: (v) => v === '7' || v === '30' || v === '90',
};

/** The Time Scope of an export URL, strictly: an unknown value, a repeated key or half a pair of days is rejected. No range = the default (30 days). */
function parseTime(q: URLSearchParams): TimeScope | null {
  for (const k of SCOPE_KEYS) {
    const all = q.getAll(k);
    if (all.length > 1 || (all.length === 1 && !TIME_VALUE[k]?.(all[0]))) return null;
  }
  if (q.has('to') !== isDay(q.get('from')) || q.has('cfrom') !== q.has('cto')) return null;
  return parseTimeScope(q);
}

export function parseExportParams(q: URLSearchParams): Parsed<ExportParams> {
  const scope = parseScope(single(q, 'scope'));
  const time = parseTime(q);
  if (!scope || !time) return BAD;
  return { ok: true, params: { scope, time } };
}

export function parseReportParams(q: URLSearchParams): Parsed<ReportParams> {
  const base = parseExportParams(q);
  if (!base.ok) return BAD;
  const raw = single(q, 'sections');
  const list = raw ? raw.split(',') : [];
  const sections = SECTIONS.filter((s) => list.includes(s)); // fixed display order, duplicates collapse
  if (list.length === 0 || list.some((s) => !(SECTIONS as readonly string[]).includes(s))) return BAD;
  if (q.getAll('title').length > 1 || q.getAll('note').length > 1) return BAD;
  const title = text(q.get('title'), TITLE_MAX, false);
  const note = text(q.get('note'), NOTE_MAX, true);
  if (title === null || note === null) return BAD;
  return { ok: true, params: { ...base.params, sections, title, note } };
}

/** The live (non-archived) accounts a scope covers, sorted by username; null when the group/account does not exist. */
export function resolveScope(scope: ExportScope, accounts: StoredAccount[]): StoredAccount[] | null {
  const live = accounts.filter((a) => a.status !== 'archived').sort((a, b) => a.username.localeCompare(b.username));
  if (scope.kind === 'all') return live;
  const hit = scope.kind === 'group' ? live.filter((a) => a.groupName === scope.name) : live.filter((a) => a.id === scope.id);
  return hit.length ? hit : null;
}

export interface ScopeOption {
  value: string; // scopeParam()
  kind: ExportScope['kind'];
  name: string; // group name or username ('' for all)
}

/** What the export dialog offers: all accounts, each group, each account. */
export function exportScopes(accounts: StoredAccount[]): ScopeOption[] {
  const live = resolveScope({ kind: 'all' }, accounts) ?? [];
  const groups = [...new Set(live.map((a) => a.groupName).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b));
  return [
    { value: 'all', kind: 'all', name: '' },
    ...groups.map((g) => ({ value: `g:${g}`, kind: 'group' as const, name: g })),
    ...live.map((a) => ({ value: `a:${a.id}`, kind: 'account' as const, name: a.username })),
  ];
}

/** Short label for file names and the report header: '@username', the group name, or 'all'. */
export function scopeLabel(scope: ExportScope, accounts: StoredAccount[]): string {
  if (scope.kind === 'all') return 'all';
  if (scope.kind === 'group') return scope.name;
  return `@${accounts.find((a) => a.id === scope.id)?.username ?? 'account'}`;
}
