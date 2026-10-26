import { describe, expect, it } from 'vitest';
import { fold, matchRule, MAX_WORD_RULES, pickAutoHide, touchedIds, validateWord, type Candidate, type ModerationRule } from '@/lib/moderation/rules';

const R = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const word = (pattern: string, wholeWord = false, id = R): ModerationRule => ({ id, kind: 'word', pattern, wholeWord });
const spam = (kind: ModerationRule['kind'], id = R): ModerationRule => ({ id, kind, pattern: null, wholeWord: false });
const c = (id: string, text: string | null, o: Partial<Candidate> = {}): Candidate => ({ id, authorUsername: 'fan', text, hidden: false, ...o });

describe('fold', () => {
  it('NFKC (full-width to ASCII), lower case, zero-width removed, whitespace collapsed', () => {
    expect(fold('ＦＲＥＥ　ｆｏｌｌｏｗｅｒｓ！')).toBe('free followers!');
    expect(fold('Fr​ee⁠ \n\t  Gift﻿')).toBe('free gift');
    expect(fold('  ＣＬＩＣＫ  ')).toBe('click');
  });
});

describe('matchRule', () => {
  it('null text or no rules never match', () => {
    expect(matchRule(null, [word('spam')])).toBeNull();
    expect(matchRule('spam', [])).toBeNull();
  });

  it('a word is a substring match by default, on folded text', () => {
    expect(matchRule('Buy CHEAP followers', [word('cheap')])?.kind).toBe('word');
    expect(matchRule('ｃｈｅａｐ!!', [word('Cheap')])).not.toBeNull();
    expect(matchRule('cheapest', [word('cheap')])).not.toBeNull();
  });

  it('whole word only: no letter, digit or underscore directly before or after', () => {
    const r = [word('cheap', true)];
    expect(matchRule('so cheap!', r)).not.toBeNull();
    expect(matchRule('cheap', r)).not.toBeNull();
    expect(matchRule('cheapest deal', r)).toBeNull();
    expect(matchRule('xcheap', r)).toBeNull();
    expect(matchRule('cheap_deal', r)).toBeNull();
    expect(matchRule('cheap123', r)).toBeNull();
    expect(matchRule('(cheap)', r)).not.toBeNull();
    expect(matchRule('très cheap.', r)).not.toBeNull();
  });

  it('CJK patterns always match inside longer text, whole word or not', () => {
    expect(matchRule('这个代购很便宜', [word('代购', true)])).not.toBeNull();
    expect(matchRule('全場代購', [word('代购')])).toBeNull(); // no Simplified/Traditional folding (Open question 7)
    expect(matchRule('ﾌｫﾛﾜｰ', [word('フォロワー')])).not.toBeNull(); // half-width katakana folds to full-width
  });

  it('regex characters in a pattern are literal', () => {
    expect(matchRule('see a.b now', [word('a.b')])).not.toBeNull();
    expect(matchRule('see x', [word('.')])).toBeNull(); // a lone dot is not a wildcard
    expect(matchRule('ab', [word('.')])).toBeNull();
    expect(matchRule('ab', [word('a.b')])).toBeNull();
    expect(matchRule('price $$$ now', [word('$$$', true)])).not.toBeNull();
  });

  it('link: scheme, www., or a bare domain with a common ending; full-width folded; e-mail-like and decimals are not links', () => {
    const r = [spam('link')];
    for (const t of ['see https://x.co', 'go to www.spam', 'bit.ly/abc', 'DM t.me/deals', 'ｗｗｗ．ｓｐａｍ．ｃｏｍ', 'shop at Cheap-Deals.SHOP now'])
      expect(matchRule(t, r), t).not.toBeNull();
    for (const t of ['hello.world', 'pi is 3.14', 'mail me at me@mail.com', 'great.....', 'nice pic'])
      expect(matchRule(t, r), t).toBeNull();
  });

  it('mentions: 4 or more @names; e-mail addresses do not count', () => {
    const r = [spam('mentions')];
    expect(matchRule('@a @b @c @d', r)).not.toBeNull();
    expect(matchRule('@a @b @c love it', r)).toBeNull();
    expect(matchRule('x@a.com y@b.com z@c.com w@d.com', r)).toBeNull();
  });

  it('repeat: the same character 8 or more times in a row', () => {
    const r = [spam('repeat')];
    expect(matchRule('wowwwwwwww', r)).not.toBeNull();
    expect(matchRule('!!!!!!!!', r)).not.toBeNull();
    expect(matchRule('哈哈哈哈哈哈哈哈', r)).not.toBeNull();
    expect(matchRule('!!!!!!!', r)).toBeNull();
    expect(matchRule('hahahahahahaha', r)).toBeNull();
    expect(matchRule('        spaced', r)).toBeNull(); // whitespace is collapsed by fold
  });

  it('emoji: 10 or more emoji with at most 3 letters or digits', () => {
    const r = [spam('emoji')];
    expect(matchRule('🔥'.repeat(10), r)).not.toBeNull();
    expect(matchRule('❤️'.repeat(10) + ' wow', r)).not.toBeNull();
    expect(matchRule('🔥'.repeat(9), r)).toBeNull();
    expect(matchRule('🔥'.repeat(12) + ' love this so much', r)).toBeNull();
  });

  it('first match wins: words (in the given order) before link, mentions, repeat, emoji', () => {
    const w1 = word('free', false, 'w1');
    const w2 = word('gift', false, 'w2');
    expect(matchRule('free gift www.x.com', [spam('link', 'l'), w2, w1])?.id).toBe('w2');
    expect(matchRule('@a @b @c @d www.x.com', [spam('mentions', 'm'), spam('link', 'l')])?.id).toBe('l');
  });
});

describe('validateWord', () => {
  it('trims, requires 1–50 folded characters, rejects non-strings', () => {
    expect(validateWord('  Spam  ', [])).toEqual({ ok: true, pattern: 'Spam' });
    expect(validateWord('   ', [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord('x'.repeat(51), [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord(42, [])).toEqual({ ok: false, error: 'invalid_word' });
    expect(validateWord('​', [])).toEqual({ ok: false, error: 'invalid_word' });
  });

  it('Latin patterns need 3 or more characters; Chinese, Japanese and Korean may be 1', () => {
    expect(validateWord('ass', [])).toEqual({ ok: true, pattern: 'ass' });
    expect(validateWord('as', [])).toEqual({ ok: false, error: 'rule_too_short' });
    expect(validateWord(' a ', [])).toEqual({ ok: false, error: 'rule_too_short' });
    expect(validateWord('ｂｕ', [])).toEqual({ ok: false, error: 'rule_too_short' }); // folded length counts
    expect(validateWord('代', [])).toEqual({ ok: true, pattern: '代' });
    expect(validateWord('の', [])).toEqual({ ok: true, pattern: 'の' });
    expect(validateWord('a代', [])).toEqual({ ok: true, pattern: 'a代' });
  });

  it('punctuation-only, symbol-only and whitespace-only patterns are always refused', () => {
    for (const p of ['.', '...', '!!!', '$$$', ' . ', '-_-', '🔥🔥🔥', '   ']) expect(validateWord(p, []), p).toEqual({ ok: false, error: 'invalid_word' });
  });

  it('duplicates are compared folded; the cap counts word rules only', () => {
    expect(validateWord('ＳＰＡＭ', [word('spam')])).toEqual({ ok: false, error: 'duplicate_rule' });
    const many = Array.from({ length: MAX_WORD_RULES }, (_, i) => word(`w${i}`));
    expect(validateWord('new', many)).toEqual({ ok: false, error: 'too_many_rules' });
    expect(validateWord('new', [...many.slice(1), spam('link')])).toEqual({ ok: true, pattern: 'new' });
  });
});

describe('touchedIds (auto-hide never acts twice, never after the owner)', () => {
  const rule = `rule:${R}`;
  it('any owner row, any non-retryable result, or 3 rule attempts mark a comment as touched', () => {
    const t = touchedIds([
      { commentId: 'owner', actor: 'owner', result: 'rate_limited' },
      { commentId: 'ok', actor: rule, result: 'ok' },
      { commentId: 'pending', actor: rule, result: 'pending' },
      { commentId: 'refused', actor: rule, result: 'not_allowed' },
      { commentId: 'retry', actor: rule, result: 'rate_limited' },
      { commentId: 'retry', actor: rule, result: 'instagram_unavailable' },
      { commentId: 'three', actor: rule, result: 'rate_limited' },
      { commentId: 'three', actor: rule, result: 'rate_limited' },
      { commentId: 'three', actor: rule, result: 'instagram_unavailable' },
    ]);
    expect([...t].sort()).toEqual(['ok', 'owner', 'pending', 'refused', 'three']);
  });
});

describe('pickAutoHide', () => {
  const rules = [word('spam')];
  it('visible, not the account itself (any case), not touched, matching; in input order, capped', () => {
    const cands = [
      c('1', 'spam one'),
      c('2', 'nice'),
      c('3', 'spam hidden', { hidden: true }),
      c('4', 'SPAM by me', { authorUsername: 'MyShop' }),
      c('5', 'spam touched'),
      c('6', null),
      c('7', 'spam two'),
      c('8', 'spam three'),
    ];
    const out = pickAutoHide(cands, rules, { ownUsername: 'myshop', touched: new Set(['5']), limit: 2 });
    expect(out.map((p) => p.comment.id)).toEqual(['1', '7']);
    expect(out[0].rule.id).toBe(R);
  });

  it('a comment without an author name is still checked', () => {
    expect(pickAutoHide([c('1', 'spam', { authorUsername: null })], rules, { ownUsername: 'me', touched: new Set(), limit: 20 })).toHaveLength(1);
  });

  it('no rules: nothing', () => {
    expect(pickAutoHide([c('1', 'spam')], [], { ownUsername: 'me', touched: new Set(), limit: 20 })).toEqual([]);
  });
});
