import { describe, expect, it } from 'vitest';
import { explainDay, POST_MATURE_DAYS, REASON_ORDER, WHY, type DayPost, type GrowthDay } from '@/lib/analysis/why';
import { addDays } from '@/lib/sync/time';

const DAY = '2026-10-14';
const day = (d: string, o: Partial<GrowthDay> = {}): GrowthDay => ({ day: d, followers: null, follows: null, unfollows: null, net: 5, netSource: 'instagram', reach: 1000, reachFollower: 700, reachNonFollower: 300, storyReach: 400, posts: [], stories: 2, comments: 1, ...o });
const post = (id: string, d: string, o: Partial<DayPost> = {}): DayPost => ({ id, mediaType: 'REELS', postedAt: `${d}T12:00:00Z`, hour: 20, reach: 1000, permalink: null, ...o });
/** 44 days ending DAY. Every second day up to DAY − 2 has a Reel (reach 1000, 20:00) and an image (reach 400, 09:00); DAY − 1 and DAY have none. */
function history(over: Record<string, Partial<GrowthDay>> = {}, n = 44): GrowthDay[] {
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(DAY, i - (n - 1));
    const posts = i % 2 === 0 && d < addDays(DAY, -1) ? [post(`r${i}`, d), post(`i${i}`, d, { mediaType: 'IMAGE', reach: 400, hour: 9 })] : [];
    return day(d, { posts, ...over[d] });
  });
}
const ids = (w: { reasons: { id: string }[] }) => w.reasons.map((r) => r.id);

describe('explainDay', () => {
  it('a follower spike: the big Reel and the non-follower share explain it, strongest first (ties in rule order)', () => {
    const w = explainDay(history({ [DAY]: { net: 60, reach: 5000, reachFollower: 800, reachNonFollower: 1200, posts: [post('big', DAY, { reach: 5000 })] } }), DAY, 'net');
    expect(w).toMatchObject({ day: DAY, metric: 'net', value: 60, typical: 5, n: 28, direction: 'up' });
    expect(ids(w)).toEqual(['posted', 'non_followers', 'time_of_day']);
    expect(w.reasons[0]).toEqual({ id: 'posted', direction: 'up', weight: 3, confidence: 'medium', n: 21, values: { postId: 'big', format: 'REELS', when: 'same_day', hour: 20, reach: 5000, ratio: 5, posts: 1 } });
    expect(w.reasons[1]).toMatchObject({ id: 'non_followers', direction: 'up', weight: 3, confidence: 'medium', n: 28 });
    expect(w.reasons[1].values.share).toBeCloseTo(0.6);
    expect(w.reasons[1].values.change).toBeCloseTo(0.3);
    expect(w.reasons[2]).toMatchObject({ id: 'time_of_day', direction: 'up', confidence: 'medium', n: 21, values: { hour: 20, posts: 21 } });
    expect(w.reasons[2].weight).toBeCloseTo(0.857, 3); // Reels at 20:00 reach 1000 vs the median post 700
    expect(w.posts.map((p) => [p.id, p.when])).toEqual([['big', 'same_day']]);
  });

  it('reasons pointing the other way are dropped (Story reach fell on a spike day)', () => {
    const w = explainDay(history({ [DAY]: { net: 60, storyReach: 100, posts: [post('big', DAY, { reach: 5000 })] } }), DAY, 'net');
    expect(ids(w)).not.toContain('stories');
    expect(w.reasons.every((r) => r.direction === 'up')).toBe(true);
  });

  it('a drop: nothing posted that day or the day before, and Story reach fell', () => {
    const w = explainDay(history({ [DAY]: { net: -20, storyReach: 100, stories: 0 } }), DAY, 'net');
    expect(w).toMatchObject({ value: -20, typical: 5, direction: 'down', posts: [] });
    expect(ids(w)).toEqual(['no_posts', 'stories']);
    expect(w.reasons[0]).toMatchObject({ direction: 'down', weight: 1.5, confidence: 'medium', n: 28 });
    expect(w.reasons[0].values.every).toBeCloseTo(28 / 13); // 13 of the 28 days before had a post
    expect(w.reasons[1]).toMatchObject({ direction: 'down', weight: 1.5, values: { reach: 100, typical: 400, change: -0.75, stories: 0 } });
  });

  it('the day before counts; reach as the metric; a comment burst', () => {
    const w = explainDay(history({ [addDays(DAY, -1)]: { posts: [post('eve', addDays(DAY, -1), { reach: 3000 })] }, [DAY]: { reach: 4000, comments: 12 } }), DAY, 'reach');
    expect(w).toMatchObject({ metric: 'reach', value: 4000, typical: 1000, direction: 'up' });
    expect(w.reasons.find((r) => r.id === 'posted')?.values).toMatchObject({ postId: 'eve', when: 'day_before', ratio: 3 });
    expect(w.reasons.find((r) => r.id === 'comments')).toMatchObject({ direction: 'up', weight: 2, values: { comments: 12, typical: 1 } });
  });

  it('too little history: no typical, no direction, every reason kept with low confidence and no ratio', () => {
    const w = explainDay(history({ [DAY]: { net: 9, posts: [post('p', DAY, { mediaType: 'IMAGE', hour: 9 })] } }, 4), DAY, 'net');
    expect(w).toMatchObject({ value: 9, typical: null, n: 3, direction: null });
    expect(w.reasons.find((r) => r.id === 'posted')).toMatchObject({ direction: 'up', weight: 1, confidence: 'low', n: 1, values: { ratio: null } }); // one earlier image (DAY − 3), under the 5 needed
  });

  it('a post younger than a week is too recent to compare: the reason stays (evidence, no ratio, no time of day), even where the ratio would point the other way', () => {
    const low = (net: number) => history({ [DAY]: { net, posts: [post('new', DAY, { reach: 100 })] } });
    const spike = explainDay(low(60), DAY, 'net', addDays(DAY, POST_MATURE_DAYS - 2)); // age 5
    expect(ids(spike)).toContain('posted');
    expect(spike.reasons.find((r) => r.id === 'posted')).toMatchObject({ direction: 'up', confidence: 'low', values: { postId: 'new', reach: 100, ratio: null, immature: true } });
    expect(ids(spike)).not.toContain('time_of_day');
    const drop = explainDay(low(-20), DAY, 'net', addDays(DAY, 1));
    expect(drop.reasons.find((r) => r.id === 'posted')).toMatchObject({ direction: 'down', values: { ratio: null, immature: true } });
    expect(drop.reasons.some((r) => r.values.ratio !== undefined && r.values.ratio !== null)).toBe(false);
  });

  it('a post of a week or more keeps the ratio reason as before', () => {
    const w = explainDay(history({ [DAY]: { net: -20, posts: [post('old', DAY, { reach: 100 })] } }), DAY, 'net', addDays(DAY, POST_MATURE_DAYS));
    expect(w.reasons.find((r) => r.id === 'posted')).toMatchObject({ direction: 'down', values: { ratio: 0.1 } });
    expect(w.reasons.find((r) => r.id === 'posted')!.values.immature).toBeUndefined();
  });

  it('a post from the day before is aged from its own day', () => {
    const eve = addDays(DAY, -1);
    const h = history({ [eve]: { posts: [post('eve', eve, { reach: 3000 })] }, [DAY]: { net: 60 } });
    expect(explainDay(h, DAY, 'net', addDays(eve, POST_MATURE_DAYS - 1)).reasons.find((r) => r.id === 'posted')!.values).toMatchObject({ ratio: null, immature: true });
    expect(explainDay(h, DAY, 'net', addDays(eve, POST_MATURE_DAYS)).reasons.find((r) => r.id === 'posted')!.values).toMatchObject({ ratio: 3 });
  });

  it('no direction (too little baseline): reasons are listed in rule order, not ranked by weight', () => {
    const h = history({ [DAY]: { net: 9, storyReach: 4000, comments: 40, posts: [post('p', DAY, { mediaType: 'IMAGE', hour: 9 })] } }).map((d) => (d.day === DAY ? d : { ...d, net: null }));
    const w = explainDay(h, DAY, 'net');
    expect(w).toMatchObject({ typical: null, direction: null });
    expect(ids(w)).toEqual(['posted', 'stories', 'time_of_day', 'comments']);
    expect(w.reasons[1].weight).toBeGreaterThan(w.reasons[0].weight); // Stories weigh more, yet posted stays first
  });

  it('an unknown day or a missing value: nothing to explain, no crash', () => {
    expect(explainDay(history(), '2027-01-01', 'net')).toMatchObject({ value: null, typical: null, direction: null, reasons: [] });
    expect(explainDay(history({ [DAY]: { reach: null } }), DAY, 'reach')).toMatchObject({ value: null, direction: null });
  });

  it('never more than 4 reasons, never "high" confidence', () => {
    const w = explainDay(history({ [DAY]: { net: 80, reachNonFollower: 2000, storyReach: 2000, comments: 40, posts: [post('big', DAY, { reach: 9000 })] } }), DAY, 'net');
    expect(w.reasons.length).toBeLessThanOrEqual(WHY.maxReasons);
    for (const r of w.reasons) expect(['low', 'medium']).toContain(r.confidence);
    expect(REASON_ORDER).toHaveLength(6);
  });
});
