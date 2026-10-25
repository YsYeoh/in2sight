import { describe, expect, it } from 'vitest';
import { isQuestion, QUESTION_PATTERN } from '@/lib/comments/question';
import { capText, FAN_RULES, TEXT_CAP } from '@/lib/comments/view';

describe('isQuestion', () => {
  it.each([
    ['Where did you buy this?', true],
    ['好看吗？', true],
    ['price？', true], // full-width question mark
    ['❓', true],
    ['How much', true],
    ['how much', true],
    ['WHERE is this', true],
    ['@amy what time does it open', true],
    ['  @amy @bob  can you share the recipe', true],
    ['Is it open today', true],
    ['what', true], // the word at the very end
    ['这个在哪里买', true],
    ['多少钱', true],
    ['有沒有優惠', true],
    ['请问几点开门', true],
  ])('%s → question', (text, want) => expect(isQuestion(text)).toBe(want));

  it.each([
    ['This is great', false], // English words count only at the start
    ['Show me more', false], // "how" inside a word
    ['whatever', false], // a question word must end at a non-letter
    ['Anyway love it', false],
    ['Love it 😍', false],
    ['好看', false],
    ['太棒了！', false],
    ['@what_is_this nice', false], // a mention is skipped, not read as a word
    ['', false],
  ])('%s → not a question', (text, want) => expect(isQuestion(text)).toBe(want));

  it('null is not a question', () => expect(isQuestion(null)).toBe(false));

  it('the pattern uses only syntax shared by JavaScript and PostgreSQL regular expressions (the SQL filter uses it with ~*)', () => {
    expect([...QUESTION_PATTERN.matchAll(/\\(.)/g)].map((m) => m[1])).toEqual(['s', 's']); // the only escape is \s
    expect(QUESTION_PATTERN).not.toMatch(/\(\?|\{\d|\\[bBdDwW]|\[\^?\]/); // no lookarounds, counted repeats, \b \d \w, empty sets
    expect(QUESTION_PATTERN.length).toBeLessThan(400);
  });
});

describe('capText', () => {
  it('keeps short text as it is', () => expect(capText('hello')).toEqual({ text: 'hello', cut: false }));

  it(`cuts at ${TEXT_CAP} code points, never inside an emoji`, () => {
    const long = '😀'.repeat(TEXT_CAP + 1);
    const r = capText(long);
    expect(r.cut).toBe(true);
    expect([...r.text]).toHaveLength(TEXT_CAP);
    expect(r.text.endsWith('😀')).toBe(true);
    expect(capText('abcdef', 3)).toEqual({ text: 'abc', cut: true });
    expect(capText('ab  cd', 3)).toEqual({ text: 'ab', cut: true }); // no trailing space before the ellipsis
  });

  it('the fan rules are the values the UI and the SQL use', () => expect(FAN_RULES).toEqual({ fanMin: 3, newFanMin: 2, windowDays: 30, quietPosts: 3 }));
});
