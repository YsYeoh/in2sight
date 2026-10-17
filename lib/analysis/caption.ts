// Caption lab (creator-toolkit design §5.6): what a caption contains, and how the account's own posts with and without
// each trait did (median reach). Pure. A pattern in your own posts, never a cause; no comparison below 20 posts (spec).
import { median } from '@/lib/analysis/posts';

export const CAPTION_MIN_POSTS = 20; // measured posts (reach > 0) the with/without comparison needs at all
export const CAPTION_MIN_SIDE = 5; // posts each side of one trait needs for its median

/** Call-to-action words (lower case), English and Simplified Chinese. Matching rules for captions, not UI text.
 *  Latin words match as whole words ("comment below", not "comments"); Chinese words match anywhere; links, hashtags
 *  and mentions are skipped ("#shop" and "@brand.shop" are not a call to action). */
export const CTA_WORDS = ['link in bio', 'comment', 'save', 'share', 'tag', 'follow', 'dm', 'click', 'shop', 'subscribe', 'sign up', '评论', '收藏', '分享', '转发', '关注', '私信', '点击', '链接'] as const;

export interface CaptionFeatures {
  length: number; // characters (code points: an emoji or a Chinese character is one)
  hashtags: string[]; // unique, lower case, in order of appearance, without '#'
  mentions: number;
  emoji: number; // pictographic code points (ponytail: a ZWJ family emoji counts per person; fine for a rough count)
  question: boolean;
  cta: string[]; // the call-to-action words found
}

const HASHTAG = /#([\p{L}\p{N}_]+)/gu;
const MENTION = /(^|[^\w.])@[\w.]+/g; // "a@b.com" is an e-mail, not a mention
const EMOJI = /\p{Extended_Pictographic}/gu;
const LATIN = /^[a-z ]+$/;
const NOT_WORDS = /https?:\/\/\S+|[#@][\p{L}\p{N}_.]+/gu; // links, hashtags and mentions are not call-to-action words
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CTA = CTA_WORDS.map((w) => ({ w, re: LATIN.test(w) ? new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, 'iu') : null }));

export function captionFeatures(caption: string | null): CaptionFeatures {
  const text = caption ?? '';
  const words = text.replace(NOT_WORDS, ' ');
  const lower = words.toLowerCase();
  return {
    length: [...text].length,
    hashtags: [...new Set([...text.matchAll(HASHTAG)].map((m) => m[1].toLowerCase()))],
    mentions: [...text.matchAll(MENTION)].length,
    emoji: [...text.matchAll(EMOJI)].length,
    question: /[?？]/.test(text),
    cta: CTA.filter(({ w, re }) => (re ? re.test(words) : lower.includes(w))).map(({ w }) => w),
  };
}

export const CAPTION_TRAITS = ['long', 'hashtags', 'mentions', 'emoji', 'question', 'cta'] as const;
export type CaptionTrait = (typeof CAPTION_TRAITS)[number];

export interface CaptionSide {
  n: number;
  median: number | null; // median reach; null below CAPTION_MIN_SIDE posts
}
export interface CaptionSplit {
  trait: CaptionTrait;
  has: boolean; // this post has the trait
  with: CaptionSide;
  without: CaptionSide;
}
export interface CaptionLab {
  features: CaptionFeatures;
  measured: number; // peers with reach > 0
  longFrom: number | null; // "long" = at least this many characters (the peers' median length)
  splits: CaptionSplit[] | null; // null below CAPTION_MIN_POSTS measured peers
}

function traitOf(t: CaptionTrait, f: CaptionFeatures, longFrom: number): boolean {
  switch (t) {
    case 'long':
      return f.length >= longFrom;
    case 'hashtags':
      return f.hashtags.length > 0;
    case 'mentions':
      return f.mentions > 0;
    case 'emoji':
      return f.emoji > 0;
    case 'question':
      return f.question;
    case 'cta':
      return f.cta.length > 0;
  }
}

const side = (reach: number[]): CaptionSide => ({ n: reach.length, median: reach.length >= CAPTION_MIN_SIDE ? median(reach) : null });

/** This caption's features, and median reach of the peers with vs without each trait (from 20 measured peers on). */
export function captionLab(caption: string | null, peers: { caption: string | null; reach: number | null }[]): CaptionLab {
  const features = captionFeatures(caption);
  const measured = peers.filter((p): p is { caption: string | null; reach: number } => typeof p.reach === 'number' && p.reach > 0).map((p) => ({ f: captionFeatures(p.caption), reach: p.reach }));
  if (measured.length < CAPTION_MIN_POSTS) return { features, measured: measured.length, longFrom: null, splits: null };
  const longFrom = median(measured.map((m) => m.f.length)) ?? 0;
  const splits = CAPTION_TRAITS.map((trait) => {
    const yes = measured.filter((m) => traitOf(trait, m.f, longFrom)).map((m) => m.reach);
    const no = measured.filter((m) => !traitOf(trait, m.f, longFrom)).map((m) => m.reach);
    return { trait, has: traitOf(trait, features, longFrom), with: side(yes), without: side(no) };
  });
  return { features, measured: measured.length, longFrom, splits };
}
