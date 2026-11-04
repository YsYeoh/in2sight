// Auto-tagging rules (Plan 17c). Pure: no I/O, no clock. The sync (new posts), the Tags page (preview + "Apply to
// existing posts") and the tests use the same functions, so the preview counts exactly what an apply would add.
// Hashtags come from captionFeatures (one source of truth with the caption lab); words and folding come from the
// moderation rules (NFKC + lower case; Latin whole words, Chinese / Japanese / Korean anywhere).
import { captionFeatures } from '@/lib/analysis/caption';
import { fold, matchRule, validateWord } from '@/lib/moderation/rules';
import { MAX_TAGS_PER_POST } from '@/lib/tags';

export const RULE_KINDS = ['hashtag', 'word', 'format'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
/** Formats a rule can name (Stories are never auto-tagged: they have no caption and leave after 24 hours). */
export const RULE_FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE'] as const;
export const RULE_VALUE_MAX = 50; // = the migration's check
export const MAX_RULES = 200; // all tags together; one read, far below PostgREST's 1,000 rows

export interface TagRule {
  id: string;
  tagId: string;
  kind: RuleKind;
  value: string; // folded (hashtag without '#'); a format is one of RULE_FORMATS
  createdAt: string; // ISO
}

/** What a rule looks at. kind = media.media_type. */
export interface RuleMedia {
  id: string;
  caption: string | null;
  kind: string;
  postedAt: string; // ISO
}

export type RuleError = 'invalid_hashtag' | 'invalid_word' | 'rule_too_short' | 'invalid_format';

const HASHTAG_BODY = /^[\p{L}\p{N}_]+$/u; // the characters captionFeatures accepts after '#'

/** The value as stored: hashtag folded without its '#' (full-width ＃ too), word folded, format as is. */
export function normalizeRuleValue(kind: RuleKind, raw: unknown): { ok: true; value: string } | { ok: false; error: RuleError } {
  if (kind === 'format') return typeof raw === 'string' && (RULE_FORMATS as readonly string[]).includes(raw) ? { ok: true, value: raw } : { ok: false, error: 'invalid_format' };
  if (typeof raw !== 'string') return { ok: false, error: kind === 'hashtag' ? 'invalid_hashtag' : 'invalid_word' };
  if (kind === 'hashtag') {
    const value = fold(raw).replace(/^#/, '');
    return HASHTAG_BODY.test(value) && [...value].length <= RULE_VALUE_MAX ? { ok: true, value } : { ok: false, error: 'invalid_hashtag' };
  }
  const w = validateWord(raw, []); // letters or digits, at most 50, 3+ characters unless Chinese, Japanese or Korean
  if (!w.ok) return { ok: false, error: w.error === 'rule_too_short' ? 'rule_too_short' : 'invalid_word' };
  return { ok: true, value: fold(w.pattern) };
}

/** Hashtags of a caption, folded (NFKC first, so a full-width ＃ counts too). */
export const hashtagsOf = (caption: string | null): string[] => (caption ? captionFeatures(caption.normalize('NFKC')).hashtags : []);

export function ruleMatches(rule: TagRule, m: RuleMedia): boolean {
  if (m.kind === 'STORY') return false;
  switch (rule.kind) {
    case 'format':
      return m.kind === rule.value;
    case 'hashtag':
      return hashtagsOf(m.caption).includes(rule.value);
    case 'word':
      // the moderation word matcher: whole Latin words ("sale" not in "wholesale"), CJK anywhere, case and width folded
      return matchRule(m.caption, [{ id: rule.id, kind: 'word', pattern: rule.value, wholeWord: true }]) !== null;
  }
}

export interface PlanInput {
  media: readonly RuleMedia[];
  rules: readonly TagRule[];
  /** Tags each post already has (any source). Missing = none. */
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  /** `${mediaId}:${tagId}` pairs the owner removed by hand: never added back. */
  rejected: ReadonlySet<string>;
  /** 'new': a rule only tags posts published at or after the rule was created (the sync); 'all': every post (the owner's apply). */
  scope: 'new' | 'all';
}

export const pairKey = (mediaId: string, tagId: string) => `${mediaId}:${tagId}`;

/**
 * The (post, tag) pairs to ADD. Never a tag the post has (so a manual tag is never touched), never a rejected pair, never
 * more than MAX_TAGS_PER_POST tags on a post (oldest rule first), each pair once. Running it again on the result adds nothing.
 */
export function planAutoTags(p: PlanInput): { mediaId: string; tagId: string }[] {
  const rules = [...p.rules].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const out: { mediaId: string; tagId: string }[] = [];
  for (const m of p.media) {
    const has = new Set(p.existing.get(m.id) ?? []);
    for (const r of rules) {
      if (has.size >= MAX_TAGS_PER_POST) break;
      if (has.has(r.tagId) || p.rejected.has(pairKey(m.id, r.tagId))) continue;
      if (p.scope === 'new' && Date.parse(m.postedAt) < Date.parse(r.createdAt)) continue;
      if (!ruleMatches(r, m)) continue;
      has.add(r.tagId);
      out.push({ mediaId: m.id, tagId: r.tagId });
    }
  }
  return out;
}
