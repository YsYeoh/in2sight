// Recurring topics in comments (Plan 15c): rule-based word, emoji and hashtag counts, no AI. Pure.
// Words come from Intl.Segmenter (built in; dictionary-based for Chinese, so 照片 / 哪里 are words), English and Chinese
// in one pass. A term counts once per comment and must come from TOPIC_MIN_COMMENTS comments by TOPIC_MIN_AUTHORS
// different people, so one person repeating themselves never makes a topic. Below TOPIC_MIN_SAMPLE comments: no topics.

export interface TopicInput {
  text: string | null;
  author: string | null; // lower-cased username; null = unknown (counted as its own person)
}
export interface Term {
  term: string;
  comments: number; // comments that contain it
}
export interface Topics {
  sample: number; // comments read
  enough: boolean; // sample >= TOPIC_MIN_SAMPLE
  words: Term[];
  emoji: Term[];
  hashtags: Term[];
}

export const TOPIC_MIN_SAMPLE = 20;
export const TOPIC_MIN_COMMENTS = 3;
export const TOPIC_MIN_AUTHORS = 2;
export const TOPIC_LIMIT = 10;

// Words that say nothing about a topic. Single letters and single Chinese characters (的, 了, 我 …) are dropped by length.
// prettier-ignore
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'you', 'your', 'yours', 'this', 'that', 'these', 'those', 'with', 'for', 'from', 'are', 'was', 'were', 'is', 'it', 'its', "it's",
  'so', 'my', 'me', 'mine', 'we', 'our', 'us', 'they', 'them', 'their', 'he', 'she', 'his', 'her', 'to', 'of', 'in', 'on', 'at', 'by', 'be',
  'been', 'am', 'an', 'or', 'as', 'if', 'do', 'does', 'did', 'have', 'has', 'had', 'not', 'no', 'but', 'just', 'all', 'can', 'will', 'would',
  'what', 'how', 'when', 'where', 'why', 'who', 'which', 'there', 'here', 'too', 'very', 'really', 'more', 'some', 'any', 'one', 'get', 'got',
  'im', "i'm", 'u', 'ur', 'pls', 'please', 'haha', 'hahaha', 'lol', 'omg', 'yes', 'yeah', 'ok', 'okay',
  '我们', '你们', '他们', '她们', '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里', '没有', '一个', '什么', '怎么', '可以', '不是',
  '就是', '真的', '自己', '因为', '所以', '但是', '还是', '已经', '然后', '那么', '还有', '一下', '一样', '大家', '现在', '时候', '哈哈', '哈哈哈',
  '嘻嘻', '呵呵', '谢谢', '好的',
]);

const URL_RE = /https?:\/\/\S+/giu;
const MENTION_RE = /@[\p{L}\p{N}._]+/gu;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const DIGITS_RE = /^\p{N}+$/u;
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/** The distinct terms of one comment, lower-cased. */
export function terms(text: string): { words: Set<string>; emoji: Set<string>; hashtags: Set<string> } {
  const t = text.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ');
  const hashtags = new Set(t.match(HASHTAG_RE) ?? []);
  const emoji = new Set(t.match(EMOJI_RE) ?? []);
  const words = new Set<string>();
  for (const s of segmenter.segment(t.replace(HASHTAG_RE, ' '))) {
    const w = s.segment;
    if (s.isWordLike && [...w].length >= 2 && !DIGITS_RE.test(w) && !STOP_WORDS.has(w)) words.add(w);
  }
  return { words, emoji, hashtags };
}

type Kind = 'words' | 'emoji' | 'hashtags';

/** Top terms per kind: in TOPIC_MIN_COMMENTS+ comments by TOPIC_MIN_AUTHORS+ people, most comments first, then the term. */
export function topics(items: TopicInput[]): Topics {
  const sample = items.length;
  const enough = sample >= TOPIC_MIN_SAMPLE;
  const empty = { sample, enough, words: [], emoji: [], hashtags: [] };
  if (!enough) return empty;
  const seen: Record<Kind, Map<string, { comments: number; authors: Set<string> }>> = { words: new Map(), emoji: new Map(), hashtags: new Map() };
  items.forEach((it, i) => {
    if (!it.text) return;
    const author = it.author ?? `\u0000${i}`; // an unknown author is nobody else
    const found = terms(it.text);
    for (const kind of ['words', 'emoji', 'hashtags'] as const)
      for (const term of found[kind]) {
        const e = seen[kind].get(term) ?? { comments: 0, authors: new Set<string>() };
        e.comments += 1;
        e.authors.add(author);
        seen[kind].set(term, e);
      }
  });
  const top = (kind: Kind): Term[] =>
    [...seen[kind]]
      .filter(([, e]) => e.comments >= TOPIC_MIN_COMMENTS && e.authors.size >= TOPIC_MIN_AUTHORS)
      .map(([term, e]) => ({ term, comments: e.comments }))
      .sort((a, b) => b.comments - a.comments || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
      .slice(0, TOPIC_LIMIT);
  return { sample, enough, words: top('words'), emoji: top('emoji'), hashtags: top('hashtags') };
}
