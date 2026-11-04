import { describe, expect, it } from 'vitest';
import { hashtagsOf, normalizeRuleValue, planAutoTags, RULE_FORMATS, RULE_KINDS, RULE_VALUE_MAX, ruleMatches, type RuleMedia, type TagRule } from '@/lib/tag-rules/rules';

const rule = (o: Partial<TagRule> & Pick<TagRule, 'kind' | 'value'>): TagRule => ({ id: `r-${o.kind}-${o.value}`, tagId: 't1', createdAt: '2026-10-01T00:00:00.000Z', ...o });
const post = (id: string, caption: string | null, o: Partial<RuleMedia> = {}): RuleMedia => ({ id, caption, kind: 'IMAGE', postedAt: '2026-10-10T00:00:00.000Z', ...o });

it('constants match the migration checks (20261102000001)', () => {
  expect(RULE_KINDS).toEqual(['hashtag', 'word', 'format']);
  expect([...RULE_FORMATS].sort()).toEqual(['CAROUSEL_ALBUM', 'IMAGE', 'REELS']);
  expect(RULE_VALUE_MAX).toBe(50);
});

describe('normalizeRuleValue', () => {
  it('hashtag: folded, without # (full-width too), letters / digits / _ only, at most 50', () => {
    expect(normalizeRuleValue('hashtag', '#Food ')).toEqual({ ok: true, value: 'food' });
    expect(normalizeRuleValue('hashtag', 'ＦＯＯＤ')).toEqual({ ok: true, value: 'food' });
    expect(normalizeRuleValue('hashtag', '＃美食')).toEqual({ ok: true, value: '美食' });
    expect(normalizeRuleValue('hashtag', 'travel_2026')).toEqual({ ok: true, value: 'travel_2026' });
    for (const bad of ['#', '', '##food', 'two words', 'food!', 'x'.repeat(51), 42]) expect(normalizeRuleValue('hashtag', bad), String(bad)).toEqual({ ok: false, error: 'invalid_hashtag' });
    expect(normalizeRuleValue('hashtag', 'x'.repeat(50))).toEqual({ ok: true, value: 'x'.repeat(50) });
  });

  it('word: folded; Latin words need 3 characters, Chinese / Japanese / Korean one; phrases allowed', () => {
    expect(normalizeRuleValue('word', '  Big SALE ')).toEqual({ ok: true, value: 'big sale' });
    expect(normalizeRuleValue('word', '优惠')).toEqual({ ok: true, value: '优惠' });
    expect(normalizeRuleValue('word', '猫')).toEqual({ ok: true, value: '猫' });
    expect(normalizeRuleValue('word', 'ab')).toEqual({ ok: false, error: 'rule_too_short' });
    for (const bad of ['', '   ', '!!!', 'x'.repeat(51), null]) expect(normalizeRuleValue('word', bad), String(bad)).toEqual({ ok: false, error: 'invalid_word' });
  });

  it('the 50-character limit counts the FOLDED value that is stored (NFKC can lengthen it), word and hashtag', () => {
    expect(normalizeRuleValue('word', 'ﬀ'.repeat(25))).toEqual({ ok: true, value: 'ff'.repeat(25) }); // folds to exactly 50
    expect(normalizeRuleValue('word', 'ﬀ'.repeat(45))).toEqual({ ok: false, error: 'invalid_word' }); // 45 typed, 90 stored
    expect(normalizeRuleValue('hashtag', 'ﬀ'.repeat(45))).toEqual({ ok: false, error: 'invalid_hashtag' });
  });

  it('format: exactly one of the feed formats (never Stories, never lower case)', () => {
    for (const f of ['REELS', 'CAROUSEL_ALBUM', 'IMAGE']) expect(normalizeRuleValue('format', f)).toEqual({ ok: true, value: f });
    for (const bad of ['STORY', 'reels', '', 1]) expect(normalizeRuleValue('format', bad)).toEqual({ ok: false, error: 'invalid_format' });
  });
});

describe('hashtagsOf', () => {
  it('folded hashtags of a caption, full-width # included; none for no caption', () => {
    expect(hashtagsOf('Dinner #Food #美食 ＃ＣＡＴ #food')).toEqual(['food', '美食', 'cat']);
    expect(hashtagsOf(null)).toEqual([]);
    expect(hashtagsOf('mail me a@b.com')).toEqual([]);
  });
});

describe('ruleMatches', () => {
  it('hashtag: the whole hashtag, any case; never part of a longer one', () => {
    const r = rule({ kind: 'hashtag', value: 'food' });
    expect(ruleMatches(r, post('p', 'Lunch #FOOD'))).toBe(true);
    expect(ruleMatches(r, post('p', 'Lunch #foodie'))).toBe(false);
    expect(ruleMatches(r, post('p', 'food without the sign'))).toBe(false);
    expect(ruleMatches(rule({ kind: 'hashtag', value: '美食' }), post('p', '今天的#美食 分享'))).toBe(true);
  });

  it('word: whole Latin words (also inside a hashtag), Chinese anywhere, width and case folded', () => {
    const r = rule({ kind: 'word', value: 'sale' });
    expect(ruleMatches(r, post('p', 'Big SALE today'))).toBe(true);
    expect(ruleMatches(r, post('p', 'ＳＡＬＥ'))).toBe(true);
    expect(ruleMatches(r, post('p', '#sale'))).toBe(true);
    expect(ruleMatches(r, post('p', 'wholesale prices'))).toBe(false);
    expect(ruleMatches(rule({ kind: 'word', value: '优惠' }), post('p', '今天优惠活动'))).toBe(true);
    expect(ruleMatches(rule({ kind: 'word', value: 'link in bio' }), post('p', 'Shop: Link in bio!'))).toBe(true);
    expect(ruleMatches(r, post('p', null))).toBe(false);
  });

  it('format: the media type; Stories never match any rule', () => {
    const reels = rule({ kind: 'format', value: 'REELS' });
    expect(ruleMatches(reels, post('p', null, { kind: 'REELS' }))).toBe(true);
    expect(ruleMatches(reels, post('p', null, { kind: 'IMAGE' }))).toBe(false);
    expect(ruleMatches(rule({ kind: 'hashtag', value: 'food' }), post('s', '#food', { kind: 'STORY' }))).toBe(false);
  });
});

describe('planAutoTags', () => {
  const food = rule({ id: 'r1', tagId: 't-food', kind: 'hashtag', value: 'food' });
  const reels = rule({ id: 'r2', tagId: 't-reels', kind: 'format', value: 'REELS', createdAt: '2026-10-02T00:00:00.000Z' });
  const media = [post('p1', '#food'), post('p2', 'nothing', { kind: 'REELS' }), post('p3', '#food', { kind: 'REELS' })];
  const base = { media, rules: [food, reels], existing: new Map(), rejected: new Set<string>(), scope: 'all' as const };

  it('adds every matching (post, tag) pair once', () => {
    expect(planAutoTags(base)).toEqual([
      { mediaId: 'p1', tagId: 't-food' },
      { mediaId: 'p2', tagId: 't-reels' },
      { mediaId: 'p3', tagId: 't-food' },
      { mediaId: 'p3', tagId: 't-reels' },
    ]);
    const twice = rule({ id: 'r3', tagId: 't-food', kind: 'word', value: 'food' });
    expect(planAutoTags({ ...base, media: [post('p1', '#food')], rules: [food, twice] })).toEqual([{ mediaId: 'p1', tagId: 't-food' }]);
  });

  it('never touches a tag the post already has (manual or auto) and never re-adds a removed one', () => {
    const out = planAutoTags({ ...base, existing: new Map([['p1', new Set(['t-food'])]]), rejected: new Set(['p3:t-reels']) });
    expect(out).toEqual([
      { mediaId: 'p2', tagId: 't-reels' },
      { mediaId: 'p3', tagId: 't-food' },
    ]);
  });

  it('is idempotent: with its own result applied, a second run adds nothing', () => {
    const first = planAutoTags(base);
    const existing = new Map<string, Set<string>>();
    for (const a of first) existing.set(a.mediaId, (existing.get(a.mediaId) ?? new Set()).add(a.tagId));
    expect(planAutoTags({ ...base, existing })).toEqual([]);
  });

  it('stops at 10 tags per post, oldest rule first', () => {
    const rules = Array.from({ length: 12 }, (_, i) => rule({ id: `r${i}`, tagId: `t${i}`, kind: 'word', value: 'food', createdAt: `2026-10-${String(12 - i).padStart(2, '0')}T00:00:00.000Z` }));
    const out = planAutoTags({ ...base, media: [post('p1', 'food')], rules, existing: new Map([['p1', new Set(['manual'])]]) });
    expect(out).toHaveLength(9);
    expect(out[0].tagId).toBe('t11'); // created 2026-10-01: the oldest rule
    expect(out.map((a) => a.tagId)).not.toContain('t0'); // the newest rules lose
  });

  it('orders rules by creation INSTANT, not by text: a fractional second does not jump the queue (ties: by id)', () => {
    const early = rule({ id: 'a', tagId: 't-early', kind: 'word', value: 'food', createdAt: '2026-10-01T10:00:00+00:00' });
    const late = rule({ id: 'b', tagId: 't-late', kind: 'word', value: 'food', createdAt: '2026-10-01T10:00:00.5+00:00' });
    const nine = new Map([['p1', new Set(Array.from({ length: 9 }, (_, i) => `manual${i}`))]]); // one slot left
    const one = { ...base, media: [post('p1', 'food')], existing: nine };
    expect(planAutoTags({ ...one, rules: [late, early] })).toEqual([{ mediaId: 'p1', tagId: 't-early' }]);
    const tie = [rule({ id: 'y', tagId: 't-y', kind: 'word', value: 'food' }), rule({ id: 'x', tagId: 't-x', kind: 'word', value: 'food' })];
    expect(planAutoTags({ ...one, rules: tie })).toEqual([{ mediaId: 'p1', tagId: 't-x' }]);
    expect(planAutoTags({ ...one, rules: [...tie].reverse() })).toEqual([{ mediaId: 'p1', tagId: 't-x' }]);
  });

  it("scope 'new' (the sync) only tags posts published at or after the rule was created", () => {
    const late = rule({ id: 'r9', tagId: 't-late', kind: 'hashtag', value: 'food', createdAt: '2026-10-10T00:00:00.000Z' });
    const m = [post('old', '#food', { postedAt: '2026-10-09T23:59:59.000Z' }), post('same', '#food', { postedAt: '2026-10-10T00:00:00.000Z' })];
    expect(planAutoTags({ ...base, media: m, rules: [late], scope: 'new' })).toEqual([{ mediaId: 'same', tagId: 't-late' }]);
    expect(planAutoTags({ ...base, media: m, rules: [late], scope: 'all' })).toHaveLength(2);
  });

  it('no rules or no posts: nothing', () => {
    expect(planAutoTags({ ...base, rules: [] })).toEqual([]);
    expect(planAutoTags({ ...base, media: [] })).toEqual([]);
  });
});
