import { describe, expect, it } from 'vitest';
import { STOP_WORDS, terms, TOPIC_LIMIT, TOPIC_MIN_SAMPLE, topics, type TopicInput } from '@/lib/comments/topics';

/** n filler comments by distinct people that share nothing (single characters only). */
const filler = (n: number): TopicInput[] => Array.from({ length: n }, (_, i) => ({ text: `${'abcdefghijklmnopqrstuvwxyz'[i % 26]}!`, author: `f${i}` }));
const by = (author: string, text: string): TopicInput => ({ author, text });

describe('terms', () => {
  it('Chinese words by Intl.Segmenter; single characters and function words dropped', () => {
    expect([...terms('这个颜色好漂亮').words]).toEqual(['颜色', '漂亮']);
    expect([...terms('照片在哪里拍的？').words]).toEqual(expect.arrayContaining(['照片', '哪里']));
    expect([...terms('咖啡好喝').words]).toEqual(['咖啡', '好喝']);
  });

  it('English: lower-cased, once per comment, stop words, digits, mentions and links left out', () => {
    expect([...terms('love love LOVE the colours').words]).toEqual(['love', 'colours']);
    expect([...terms('@amy look https://x.co/a 123 2026').words]).toEqual(['look']);
    expect(STOP_WORDS.has('the') && STOP_WORDS.has('我们')).toBe(true);
  });

  it('hashtags (kept with #, lower-cased, not also words) and emoji (one code point, so ❤️ and ❤ are one)', () => {
    const t = terms('Love it #Penang #food_trip ❤️❤ 😍');
    expect([...t.hashtags]).toEqual(['#penang', '#food_trip']);
    expect([...t.emoji]).toEqual(['❤', '😍']);
    expect([...t.words]).toEqual(['love']);
  });

  it('text is never interpreted: markup is just characters', () => {
    expect([...terms('<script>alert(1)</script>').words]).toEqual(['script', 'alert']);
  });
});

describe('topics', () => {
  it(`fewer than ${TOPIC_MIN_SAMPLE} comments: not enough, nothing listed`, () => {
    const r = topics([...filler(TOPIC_MIN_SAMPLE - 4), by('a', '颜色'), by('b', '颜色'), by('c', '颜色')]);
    expect(r).toEqual({ sample: TOPIC_MIN_SAMPLE - 1, enough: false, words: [], emoji: [], hashtags: [] });
  });

  it('a term needs 3 comments from 2+ people; counts are comments, not repeats; most first, then the term', () => {
    const r = topics([
      ...filler(20),
      by('a', '这个颜色好漂亮 😍'),
      by('b', '颜色真的很漂亮！😍😍😍'),
      by('c', '颜色 colours #penang'),
      by('d', 'colours #penang'),
      by('d', 'colours #Penang 😍'),
      by('e', 'spam spam spam'),
      by('e', 'spam'),
      by('e', 'spam'), // 3 comments but one person: not a topic
    ]);
    expect(r.sample).toBe(28);
    expect(r.enough).toBe(true);
    expect(r.words).toEqual([
      { term: 'colours', comments: 3 },
      { term: '颜色', comments: 3 },
    ]);
    expect(r.emoji).toEqual([{ term: '😍', comments: 3 }]);
    expect(r.hashtags).toEqual([{ term: '#penang', comments: 3 }]);
  });

  it(`at most ${TOPIC_LIMIT} per kind; unknown authors count as different people; empty texts are skipped`, () => {
    const words = Array.from({ length: 12 }, (_, i) => `word${String.fromCharCode(97 + i)}x`);
    const items: TopicInput[] = [...filler(20), { text: null, author: 'z' }];
    for (const w of words) for (let k = 0; k < 3; k++) items.push({ text: w, author: null });
    const r = topics(items);
    expect(r.words).toHaveLength(TOPIC_LIMIT);
    expect(r.words[0]).toEqual({ term: 'wordax', comments: 3 });
  });
});
