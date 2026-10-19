import { describe, expect, it } from 'vitest';
import { buildPostLab, CHECKPOINTS, percentile, scoreRows, SCORECARD, similarPosts, storyFunnel, storySequence, velocity, verdictOf, WATCH, type LabItem, type LabValues, type ScoreRow } from '@/lib/analysis/post-lab';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TZ = 'Asia/Kuala_Lumpur';
const NONE: LabValues = { reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null };
const v = (o: Partial<LabValues>): LabValues => ({ ...NONE, ...o });
const item = (id: string, o: Partial<LabItem> = {}): LabItem => ({ id, accountId: A, mediaType: 'IMAGE', postedAt: '2026-10-01T02:00:00Z', expiresAt: null, goneAt: null, permalink: null, caption: null, tagIds: [], cover: 'ok', slides: null, measuredAt: '2026-10-09T02:00:00Z', latest: v({ reach: 100 }), points: {}, ...o });
/** n peers, newest first, posted one day apart before the item, reach 100, 110, 120, … */
const peers = (n: number, f: (i: number) => Partial<LabItem> = () => ({})) =>
  Array.from({ length: n }, (_, i) => item(`p${i}`, { postedAt: new Date(Date.parse('2026-09-30T02:00:00Z') - i * 86_400_000).toISOString(), latest: v({ reach: 100 + 10 * i }), ...f(i) }));
const row = (rows: ScoreRow[], id: string) => rows.find((r) => r.id === id)!;
const opts = { er: 'reach' as const, followers: {}, tz: TZ };

describe('percentile', () => {
  it('mid-rank: below + half of the equal ones', () => {
    expect(percentile(5, [1, 2, 3, 4])).toBe(100);
    expect(percentile(1, [1, 2, 3, 4])).toBe(13); // (0 + 0.5) / 4
    expect(percentile(3, [1, 3, 3, 9])).toBe(50);
    expect(percentile(3, [])).toBeNull();
  });
});

describe('scoreRows', () => {
  it('each number against the same number of the peers: median, percentile and difference (points for rates)', () => {
    const it0 = item('x', { latest: v({ reach: 400, views: 900, likes: 30, comments: 5, saves: 4, shares: 1 }) });
    const ps = peers(5, (i) => ({ latest: v({ reach: 100 + 100 * i, likes: 10, comments: 0, saves: 1, shares: 0 }) }));
    const rows = scoreRows(SCORECARD, it0, ps, opts);
    expect(rows.map((r) => r.id)).toEqual(['reach', 'views', 'interactions', 'engagementRate', 'saveRate', 'shareRate', 'followsPer1k', 'profileVisits', 'linkTaps']);
    expect(row(rows, 'reach')).toMatchObject({ value: 400, n: 5, median: 300, percentile: 70, delta: 400 / 300 - 1 });
    expect(row(rows, 'interactions')).toMatchObject({ value: 40, median: 11 });
    const er = row(rows, 'engagementRate');
    expect(er.value).toBeCloseTo(0.1);
    expect(er.delta).toBeCloseTo(0.1 - 11 / 300); // a rate: the difference in points, not relative
    expect(row(rows, 'views')).toMatchObject({ value: 900, n: 0, median: null, percentile: null, delta: null }); // no peer has views
  });

  it('below the sample guard (5 peers with that number) there is no comparison', () => {
    const rows = scoreRows(['reach'], item('x'), peers(4), opts);
    expect(rows[0]).toMatchObject({ value: 100, n: 4, median: null, percentile: null, delta: null });
  });

  it('every missing number has a reason, never 0', () => {
    const reel = item('r', { mediaType: 'REELS', latest: v({ reach: 0, likes: 3 }) });
    const rows = scoreRows([...SCORECARD, ...WATCH], reel, [], opts);
    expect(row(rows, 'followsPer1k')).toMatchObject({ value: null, reason: 'unsupported' });
    expect(row(rows, 'profileVisits').reason).toBe('unsupported');
    expect(rows.some((r) => r.id === 'linkTaps')).toBe(false); // not collected for Reels: not shown
    expect(row(rows, 'engagementRate').reason).toBe('no_reach');
    expect(row(rows, 'saveRate').reason).toBe('no_reach');
    expect(row(rows, 'avgWatch').reason).toBe('not_captured');
    expect(row(rows, 'skipRate')).toMatchObject({ lowerIsBetter: true, kind: 'percent' });
    expect(row(scoreRows(SCORECARD, item('n', { latest: null }), [], opts), 'reach').reason).toBe('not_measured');
    const story = scoreRows(SCORECARD, item('s', { mediaType: 'STORY', latest: null }), [], opts);
    expect(story.map((r) => r.id)).toEqual(['reach', 'views', 'interactions', 'shareRate', 'followsPer1k', 'profileVisits', 'linkTaps', 'replies']);
    expect(row(story, 'reach').reason).toBe('needs_5_viewers');
  });

  it('engagement per followers: each post against the follower count of its own posting day (owner timezone)', () => {
    const it0 = item('x', { postedAt: '2026-10-01T17:00:00Z', latest: v({ reach: 100, likes: 20 }) }); // 01:00 on 2 Oct in Kuala Lumpur
    const ps = peers(5, () => ({ latest: v({ reach: 100, likes: 10 }) }));
    const followers = { '2026-10-02': 1000, ...Object.fromEntries(ps.map((p) => [p.postedAt.slice(0, 10), 500])) };
    const er = row(scoreRows(['engagementRate'], it0, ps, { er: 'followers', followers, tz: TZ }), 'engagementRate');
    expect(er).toMatchObject({ value: 0.02, median: 0.02, n: 5 });
    expect(row(scoreRows(['engagementRate'], it0, ps, { er: 'followers', followers: {}, tz: TZ }), 'engagementRate')).toMatchObject({ value: null, reason: 'no_followers', n: 0 });
  });
});

describe('verdictOf', () => {
  const posted = '2026-10-01T02:00:00Z';
  const at = (hours: number) => new Date(Date.parse(posted) + hours * 3_600_000);
  const reach = (value: number, median: number, pct: number): ScoreRow => ({ id: 'reach', kind: 'count', lowerIsBetter: false, value, reason: null, n: 10, median, percentile: pct, delta: null });
  const post = item('x', { postedAt: posted });

  it('feed: Too early under 24 h; a lead (Breakout ≥ 2× median, Above ≥ 75th) counts from 24 h; the full scale from day 7', () => {
    expect(verdictOf(post, reach(500, 100, 100), at(23))).toBe('too_early');
    expect(verdictOf(post, reach(200, 100, 95), at(25))).toBe('breakout');
    expect(verdictOf(post, reach(150, 100, 80), at(25))).toBe('above');
    expect(verdictOf(post, reach(90, 100, 40), at(25))).toBe('too_early');
    expect(verdictOf(post, reach(90, 100, 40), at(7 * 24))).toBe('typical');
    expect(verdictOf(post, reach(20, 100, 10), at(7 * 24))).toBe('below');
  });

  it('Stories: the lead while live, the full scale once expired; no verdict without reach or below the guard', () => {
    const story = item('s', { mediaType: 'STORY', postedAt: posted, expiresAt: at(24).toISOString() });
    expect(verdictOf(story, reach(150, 100, 80), at(2))).toBe('above');
    expect(verdictOf(story, reach(20, 100, 10), at(2))).toBe('too_early');
    expect(verdictOf(story, reach(20, 100, 10), at(25))).toBe('below');
    expect(verdictOf(post, { ...reach(100, 100, 50), median: null, percentile: null }, at(200))).toBeNull();
    expect(verdictOf(post, { ...reach(100, 100, 50), value: null }, at(200))).toBeNull();
    expect(verdictOf(post, undefined, at(200))).toBeNull();
  });
});

describe('velocity', () => {
  it('checkpoints from the snapshots only: a missing one stays a gap; medians need 5 peers; the lead is the latest common point', () => {
    const it0 = item('x', { points: { '1h': { reach: 50, views: 80 }, '24h': { reach: 600, views: null } } });
    const ps = peers(6, (i) => ({ points: { '1h': { reach: 10 + i, views: 20 }, '6h': { reach: 100, views: 150 }, '24h': i < 5 ? { reach: 200, views: 300 } : undefined } }));
    const vel = velocity(it0, ps, new Date('2026-10-02T12:00:00Z')); // 34 h after posting
    expect(vel.points.map((p) => p.id)).toEqual(CHECKPOINTS.map((c) => c.id));
    expect(vel.points[0]).toMatchObject({ id: '1h', due: true, reach: 50, medianReach: 12.5, nReach: 6, medianViews: 20 });
    expect(vel.points[1]).toMatchObject({ id: '6h', due: true, reach: null, medianReach: 100 }); // the post has no snapshot near 6 h: not invented
    expect(vel.points[2]).toMatchObject({ id: '24h', reach: 600, medianReach: 200, nReach: 5, views: null });
    expect(vel.points[3]).toMatchObject({ id: '48h', due: false, reach: null, medianReach: null, nReach: 0 });
    expect(vel.lead).toEqual({ at: '24h', metric: 'reach', ratio: 3, n: 5 });
  });

  it('a snapshot taken before the mark is not shown as that checkpoint (a young post is not slow)', () => {
    const young = item('y', { points: { '1h': { reach: 4, views: 5 } } }); // posted 02:00, snapshot ~35 min in
    const ps = peers(6, () => ({ points: { '1h': { reach: 40, views: 50 } } }));
    const vel = velocity(young, ps, new Date('2026-10-01T02:40:00Z'));
    expect(vel.points[0]).toMatchObject({ id: '1h', due: false, reach: null, medianReach: 40 });
    expect(vel.lead).toBeNull();
  });

  it('Stories use 1 h, 6 h and 24 h; no lead below the guard', () => {
    const vel = velocity(item('s', { mediaType: 'STORY', points: { '1h': { reach: 5, views: 6 } } }), peers(3, () => ({ points: { '1h': { reach: 4, views: 5 } } })), new Date('2026-10-01T05:00:00Z'));
    expect(vel.points.map((p) => p.id)).toEqual(['1h', '6h', '24h']);
    expect(vel.points[0].medianReach).toBeNull();
    expect(vel.lead).toBeNull();
  });
});

describe('Stories: funnel and sequence', () => {
  it('funnel: each navigation as a count and a share of views; none without data', () => {
    const f = storyFunnel(v({ views: 200, replies: 3, tapsForward: 100, tapsBack: 10, exits: 30, swipeForward: null }))!;
    expect(f.replies).toBe(3);
    expect(f.steps).toEqual([
      { id: 'forward', value: 100, share: 0.5 },
      { id: 'back', value: 10, share: 0.05 },
      { id: 'exit', value: 30, share: 0.15 },
      { id: 'swipe', value: null, share: null },
    ]);
    expect(storyFunnel(null)).toBeNull();
  });

  it('sequence: the day in posting order, reach vs the first measured Story, exit rate, best and worst frame', () => {
    const s = (id: string, hh: string, latest: LabValues | null) => item(id, { mediaType: 'STORY', postedAt: `2026-10-01T${hh}:00:00Z`, latest });
    const seq = storySequence([s('c', '12', v({ reach: 50, views: 60, exits: 30 })), s('a', '08', null), s('b', '09', v({ reach: 100, views: 120, exits: 6 }))], 'c');
    expect(seq.frames.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(seq.frames[0]).toMatchObject({ reach: null, retention: null, exitRate: null });
    expect(seq.frames[2]).toMatchObject({ retention: 0.5, exitRate: 0.5, current: true });
    expect(seq).toMatchObject({ best: 'b', worst: 'c' });
    expect(storySequence([s('b', '09', v({ reach: 100, views: 120, exits: 6 }))], 'b')).toMatchObject({ best: null, worst: null });
  });
});

describe('similarPosts and buildPostLab', () => {
  it('similar: peers sharing a tag first, then the newest, at most 6', () => {
    const ps = peers(9, (i) => ({ tagIds: i === 7 || i === 4 ? ['t1'] : [] }));
    expect(similarPosts(item('x', { tagIds: ['t1'] }), ps).map((p) => p.id)).toEqual(['p4', 'p7', 'p0', 'p1', 'p2', 'p3']);
  });

  it('the scorecard uses the first 30 (or 90) peers; caption lab and similar posts use every peer read; panels per format', () => {
    const now = new Date('2026-10-20T00:00:00Z');
    const ps = peers(40);
    const m30 = buildPostLab({ item: item('x', { latest: v({ reach: 500 }) }), peers: ps, day: [], followers: {} }, { now, tz: TZ, peers: 30, er: 'reach' });
    expect(m30.peers).toEqual({ asked: 30, used: 30, read: 40 });
    expect(row(m30.scorecard, 'reach')).toMatchObject({ n: 30, median: 245 });
    expect(m30.verdict).toBe('breakout'); // 500 ≥ 2 × 245
    expect(m30.caption?.measured).toBe(40);
    expect(m30.watch).toBeNull();
    expect(m30.funnel).toBeNull();
    const m90 = buildPostLab({ item: item('x', { latest: v({ reach: 500 }) }), peers: ps, day: [], followers: {} }, { now, tz: TZ, peers: 90, er: 'reach' });
    expect(m90.peers.used).toBe(40);
    const reel = buildPostLab({ item: item('r', { mediaType: 'REELS' }), peers: [], day: [], followers: {} }, { now, tz: TZ, peers: 30, er: 'reach' });
    expect(reel.watch?.map((r) => r.id)).toEqual(['avgWatch', 'totalWatch', 'skipRate']);
    const story = item('s', { mediaType: 'STORY', postedAt: '2026-10-19T20:00:00Z', expiresAt: '2026-10-20T20:00:00Z', latest: v({ reach: 10, views: 12, exits: 2 }) });
    const sm = buildPostLab({ item: story, peers: [], day: [], followers: {} }, { now, tz: TZ, peers: 30, er: 'reach' });
    expect(sm).toMatchObject({ live: true, caption: null, verdict: null });
    expect(sm.sequence?.frames.map((f) => f.id)).toEqual(['s']);
    expect(sm.funnel?.views).toBe(12);
  });
});
