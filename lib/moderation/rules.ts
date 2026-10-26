// Banned words and spam patterns (Plan 15d). Pure: no I/O, no clock. The tick (lib/moderation/auto.ts) and the
// Moderation tab's preview use the same functions, so the preview shows exactly what auto-hide would do.
// Comment text is third-party personal data: it is only compared here, never logged or returned in errors.

export const RULE_KINDS = ['word', 'link', 'mentions', 'repeat', 'emoji'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
/** Built-in patterns, checked after the words in this order. A row of the kind = switched on. */
export const SPAM_KINDS = ['link', 'mentions', 'repeat', 'emoji'] as const satisfies readonly RuleKind[];
export type SpamKind = (typeof SPAM_KINDS)[number];

export const PATTERN_MAX = 50; // = the migration's check
export const MAX_WORD_RULES = 200;
export const REPEAT_MIN = 8; // the same character this many times in a row
export const MENTIONS_MIN = 4; // @mentions in one comment
export const EMOJI_MIN = 10; // emoji in one comment ...
export const EMOJI_TEXT_MAX = 3; // ... with at most this many letters or digits
export const MAX_AUTO_TRIES = 3; // rule attempts per comment (only retryable failures get a second one)
/** Instagram's comment length (Open question P6). Lives here (pure, client-safe) so the reply dialog can count it. */
export const REPLY_MAX = 2_200;
/** Rule attempts that ended like this are tried again on a later tick; everything else is final. */
export const RETRYABLE: readonly string[] = ['rate_limited', 'instagram_unavailable'];

export interface ModerationRule {
  id: string;
  kind: RuleKind;
  pattern: string | null; // words only, as the owner typed it (trimmed)
  wholeWord: boolean;
}

export interface Candidate {
  id: string;
  authorUsername: string | null;
  text: string | null;
  hidden: boolean;
}

/** One moderation_log row, as far as auto-hide cares. */
export interface LogMark {
  commentId: string;
  actor: string; // 'owner' | 'rule:<uuid>'
  result: string;
}

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
/** NFKC (full-width -> ASCII, half-width katakana -> full-width), lower case, zero-width removed, whitespace collapsed. */
export const fold = (s: string): string => s.normalize('NFKC').toLowerCase().replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_CHAR = '[\\p{L}\\p{N}_]';
/** A scheme or www., or a bare domain ending in a common TLD (not preceded by a letter, digit, @ . _ or -). */
const LINK = /(?:https?:\/\/|www\.)\S|(?<![\p{L}\p{N}@._-])[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.(?:com|net|org|info|biz|io|co|me|ly|xyz|top|shop|store|site|online|link|click|app|live|vip|club|cn|ru|my|sg)(?![\p{L}\p{N}])/u;
const MENTION = /(?<![\p{L}\p{N}_.])@[a-z0-9._]{1,30}/gu;
const REPEAT = new RegExp(`(\\S)\\1{${REPEAT_MIN - 1},}`, 'u');
const EMOJI = /\p{Extended_Pictographic}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

const count = (re: RegExp, s: string) => s.match(re)?.length ?? 0;

function wordMatches(text: string, rule: ModerationRule): boolean {
  const p = rule.pattern === null ? '' : fold(rule.pattern);
  if (p === '') return false;
  if (!rule.wholeWord || CJK.test(p)) return text.includes(p);
  return new RegExp(`(?<!${WORD_CHAR})${escape(p)}(?!${WORD_CHAR})`, 'u').test(text);
}

const SPAM: Record<SpamKind, (text: string) => boolean> = {
  link: (t) => LINK.test(t),
  mentions: (t) => count(MENTION, t) >= MENTIONS_MIN,
  repeat: (t) => REPEAT.test(t),
  emoji: (t) => count(EMOJI, t) >= EMOJI_MIN && count(LETTER_OR_DIGIT, t) <= EMOJI_TEXT_MAX,
};

/** The first rule the comment breaks: word rules in the given order, then link, mentions, repeat, emoji. */
export function matchRule(text: string | null, rules: readonly ModerationRule[]): ModerationRule | null {
  if (text === null || rules.length === 0) return null;
  const t = fold(text);
  if (t === '') return null;
  for (const r of rules) if (r.kind === 'word' && wordMatches(t, r)) return r;
  for (const kind of SPAM_KINDS) {
    const r = rules.find((x) => x.kind === kind);
    if (r && SPAM[kind](t)) return r;
  }
  return null;
}

export const WORD_MIN = 3; // Latin-script patterns: shorter ones ("as", ".") match inside too many ordinary words
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * A new banned word: trimmed, PATTERN_MAX characters at most, at least one letter or digit (never punctuation or
 * whitespace only), WORD_MIN characters folded unless it contains Chinese, Japanese or Korean (one character is a word
 * there), not already listed (folded), under the cap.
 */
export function validateWord(raw: unknown, existing: readonly ModerationRule[]): { ok: true; pattern: string } | { ok: false; error: 'invalid_word' | 'rule_too_short' | 'duplicate_rule' | 'too_many_rules' } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_word' };
  const pattern = raw.trim();
  const folded = fold(pattern);
  if (folded === '' || [...pattern].length > PATTERN_MAX || !HAS_LETTER_OR_DIGIT.test(folded)) return { ok: false, error: 'invalid_word' };
  if (!CJK.test(folded) && [...folded].length < WORD_MIN) return { ok: false, error: 'rule_too_short' };
  const words = existing.filter((r) => r.kind === 'word');
  if (words.some((r) => r.pattern !== null && fold(r.pattern) === folded)) return { ok: false, error: 'duplicate_rule' };
  if (words.length >= MAX_WORD_RULES) return { ok: false, error: 'too_many_rules' };
  return { ok: true, pattern };
}

/**
 * Comments auto-hide must leave alone: the owner acted on it (any row: a manual unhide exempts it for good), a rule
 * attempt ended in a final result (ok, pending = outcome unknown, refused, gone, …), or MAX_AUTO_TRIES rule attempts.
 */
export function touchedIds(marks: readonly LogMark[]): Set<string> {
  const out = new Set<string>();
  const tries = new Map<string, number>();
  for (const m of marks) {
    if (m.actor === 'owner' || !RETRYABLE.includes(m.result)) out.add(m.commentId);
    const n = (tries.get(m.commentId) ?? 0) + 1;
    tries.set(m.commentId, n);
    if (n >= MAX_AUTO_TRIES) out.add(m.commentId);
  }
  return out;
}

/** What auto-hide would hide now, in the given (newest-first) order, at most `limit`. */
export function pickAutoHide(cands: readonly Candidate[], rules: readonly ModerationRule[], opts: { ownUsername: string; touched: ReadonlySet<string>; limit: number }): { comment: Candidate; rule: ModerationRule }[] {
  const own = opts.ownUsername.toLowerCase();
  const out: { comment: Candidate; rule: ModerationRule }[] = [];
  if (rules.length === 0) return out;
  for (const comment of cands) {
    if (out.length >= opts.limit) break;
    if (comment.hidden || opts.touched.has(comment.id) || comment.authorUsername?.toLowerCase() === own) continue;
    const rule = matchRule(comment.text, rules);
    if (rule) out.push({ comment, rule });
  }
  return out;
}
