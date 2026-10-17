import { describe, expect, it } from 'vitest';
import { CAPTION_MIN_POSTS, captionFeatures, captionLab } from '@/lib/analysis/caption';

describe('captionFeatures', () => {
  it('counts characters, hashtags, mentions, emoji, questions and call-to-action words', () => {
    const f = captionFeatures('New drop 🔥🔥 Which colour? Tag a friend & check the link in bio #Summer #summer #OOTD_2026 @brand.shop');
    expect(f.hashtags).toEqual(['summer', 'ootd_2026']); // unique, lower case, in order
    expect(f.mentions).toBe(1);
    expect(f.emoji).toBe(2);
    expect(f.question).toBe(true);
    expect(f.cta).toEqual(['link in bio', 'tag']);
    expect(f.length).toBe([...'New drop 🔥🔥 Which colour? Tag a friend & check the link in bio #Summer #summer #OOTD_2026 @brand.shop'].length);
  });

  it('Chinese: full-width question mark, CTA words anywhere, characters counted as one each; e-mails are not mentions', () => {
    const f = captionFeatures('喜欢的话记得收藏和关注吗？ 联系 hi@brand.com #穿搭');
    expect(f.question).toBe(true);
    expect(f.cta).toEqual(['收藏', '关注']);
    expect(f.hashtags).toEqual(['穿搭']);
    expect(f.mentions).toBe(0);
    expect(f.length).toBe(33);
  });

  it('whole words only for Latin CTAs, and an empty caption has nothing', () => {
    expect(captionFeatures('Comments are open, saved for later #shop https://x.com/share').cta).toEqual([]);
    expect(captionFeatures(null)).toEqual({ length: 0, hashtags: [], mentions: 0, emoji: 0, question: false, cta: [] });
  });
});

describe('captionLab', () => {
  const peer = (caption: string, reach: number | null) => ({ caption, reach });

  it('no comparison below 20 measured posts (posts without reach do not count)', () => {
    const peers = [...Array.from({ length: CAPTION_MIN_POSTS - 1 }, (_, i) => peer(`post ${i}?`, 100 + i)), peer('x', null), peer('y', 0)];
    const lab = captionLab('Hello?', peers);
    expect(lab.measured).toBe(19);
    expect(lab.splits).toBeNull();
    expect(lab.features.question).toBe(true);
  });

  it('median reach with vs without each trait; a side under 5 posts has no median', () => {
    const peers = [
      ...Array.from({ length: 12 }, (_, i) => peer(`Which one do you like best for summer? ${i}`, 1000 + i)), // long + question
      ...Array.from({ length: 8 }, (_, i) => peer(`hi ${i}`, 400)), // short, no question
      peer('#tag one', 50),
    ];
    const lab = captionLab('Is this the one?', peers);
    expect(lab.measured).toBe(21);
    const q = lab.splits!.find((s) => s.trait === 'question')!;
    expect(q).toMatchObject({ has: true, with: { n: 12, median: 1005.5 }, without: { n: 9, median: 400 } });
    const tags = lab.splits!.find((s) => s.trait === 'hashtags')!;
    expect(tags).toMatchObject({ has: false, with: { n: 1, median: null }, without: { n: 20 } });
    expect(lab.longFrom).toBe(40); // the peers' median caption length
    expect(lab.splits!.find((s) => s.trait === 'long')).toMatchObject({ has: false, with: { n: 12 }, without: { n: 9 } });
  });
});
