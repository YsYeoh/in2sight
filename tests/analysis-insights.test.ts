import { describe, expect, it } from 'vitest';
import type { DailyRow } from '@/lib/analysis/types';
import {
  bestSlot,
  breakouts,
  daypartOf,
  findInsights,
  formatWinner,
  hashtagWinner,
  INSIGHTS,
  latestDay,
  measuredPosts,
  parseFindingKey,
  postingGap,
  reachDropFinding,
  unansweredFinding,
  unusualDays,
  visibleFindings,
  type Finding,
  type InsightPost,
} from '@/lib/analysis/insights';
import { addDays, localHour } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const TODAY = '2026-10-15'; // a Thursday
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const o = { today: TODAY, now: NOW, tz: KL };

const post = (id: string, postedAt: string, reach: number | null, x: Partial<InsightPost> = {}): InsightPost => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
/** n days ending yesterday, reach 100, followers +1 a day. */
const days = (n: number, f: (day: string, i: number) => Partial<DailyRow> = () => ({})): DailyRow[] =>
  Array.from({ length: n }, (_, i) => {
    const day = addDays(TODAY, i - n);
    return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day, i) };
  });
/** 19 ordinary posts (reach 100) every 3 days from 1 June at 10:00 KL, so no slot of theirs reaches 5. */
const ordinary = (n = 19, x: Partial<InsightPost> = {}) => Array.from({ length: n }, (_, i) => post(`o${i}`, `${addDays('2026-06-01', 3 * i)}T02:00:00Z`, 100, x));
/** 6 posts on Tuesdays (1 Sep 2026 is a Tuesday) at 19:00 KL (evening). */
const tuesdayEvenings = (reach: number, x: Partial<InsightPost> = {}) => Array.from({ length: 6 }, (_, i) => post(`t${i}`, `${addDays('2026-09-01', 7 * i)}T11:00:00Z`, reach, x));

describe('day parts and measured posts', () => {
  it('splits the owner-timezone hour into four parts', () => {
    expect([0, 5, 6, 11, 12, 17, 18, 23].map(daypartOf)).toEqual(['night', 'night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });

  it('uses the owner timezone across a DST change (London: 17:30 UTC on 29 Mar 2026 is 18:30 BST, evening)', () => {
    expect(daypartOf(localHour(new Date('2026-03-29T17:30:00Z'), 'Europe/London'))).toBe('evening');
    expect(daypartOf(localHour(new Date('2026-03-28T17:30:00Z'), 'Europe/London'))).toBe('afternoon'); // still GMT the day before
  });

  it('keeps feed posts with reach > 0, at least 7 and at most 180 days old', () => {
    const list = [
      post('ok', '2026-10-01T02:00:00Z', 50),
      post('young', '2026-10-10T02:00:00Z', 50), // 5 days old: still gathering reach
      post('edge', `${addDays(TODAY, -INSIGHTS.matureDays)}T02:00:00Z`, 50),
      post('old', '2026-01-01T02:00:00Z', 50),
      post('story', '2026-10-01T02:00:00Z', 50, { mediaType: 'STORY' }),
      post('null', '2026-10-01T02:00:00Z', null),
      post('zero', '2026-10-01T02:00:00Z', 0),
      post('bad', 'not a date', 50),
    ];
    expect(measuredPosts(list, TODAY, KL).map((m) => m.p.id)).toEqual(['ok', 'edge']);
  });
});

describe('breakouts', () => {
  const history = Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100));
  it('a post of the last 7 days at ≥ 2× the median of the previous posts, linked to its Post Lab', () => {
    const [f, ...rest] = breakouts([...history, post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS' })], A, NOW, KL);
    expect(rest).toEqual([]);
    expect(f).toEqual({ key: `breakout:${A}:hit`, accountId: A, kind: 'breakout', tone: 'good', params: { ratio: 9, format: 'REELS' }, n: 6, confidence: 'low', day: '2026-10-12', postId: 'hit', href: `/accounts/${A}/media/hit` });
  });

  it('nothing below the guard (4 earlier posts) or under 24 hours', () => {
    expect(breakouts([...history.slice(0, 4), post('hit', '2026-10-12T02:00:00Z', 900)], A, NOW, KL)).toEqual([]);
    expect(breakouts([...history, post('hit', '2026-10-15T00:00:00Z', 900)], A, NOW, KL)).toEqual([]);
  });
});

describe('reach drop', () => {
  it('7-day reach −50 % vs the week before, keyed by the Monday of the settled day', () => {
    const f = reachDropFinding(days(14, (_d, i) => ({ reach: i < 7 ? 100 : 50 })), A, TODAY, KL);
    expect(f).toMatchObject({ key: `reach_drop:${A}:2026-10-12`, tone: 'bad', params: { change: -0.5 }, n: 7, confidence: 'low', day: '2026-10-14', href: `/accounts/${A}?tab=growth` });
  });

  it('nothing when flat or when the weeks are too sparse to compare', () => {
    expect(reachDropFinding(days(14), A, TODAY, KL)).toBeNull();
    expect(reachDropFinding(days(5, () => ({ reach: 10 })), A, TODAY, KL)).toBeNull();
  });
});

describe('unusual day', () => {
  const eightWeeks = (f: (day: string, i: number) => Partial<DailyRow> = () => ({})) => days(60, f);
  it('the settled day vs the same weekday of the 8 weeks before; up is good news, Medium from 6 values', () => {
    const list = unusualDays(eightWeeks((d) => (d === '2026-10-14' ? { reach: 500 } : {})), A, TODAY, KL);
    expect(list).toEqual([
      { key: `unusual_day:${A}:reach:2026-10-14`, accountId: A, kind: 'unusual_day', tone: 'good', params: { metric: 'reach', value: 500, typical: 100, weekday: 3 }, n: 8, confidence: 'medium', day: '2026-10-14', postId: null, href: `/accounts/${A}?tab=growth&day=2026-10-14&why=reach` },
    ]);
  });

  it('a follower drop is bad news and links to the net-follows explanation', () => {
    const list = unusualDays(eightWeeks((d, i) => ({ followers: d === '2026-10-14' ? 1000 + i - 40 : 1000 + i })), A, TODAY, KL);
    expect(list).toEqual([expect.objectContaining({ key: `unusual_day:${A}:followers:2026-10-14`, tone: 'bad', params: { metric: 'followers', value: -39, typical: 1, weekday: 3 }, href: `/accounts/${A}?tab=growth&day=2026-10-14` })]);
  });

  it('nothing with fewer than 4 same-weekday values; latestDay says why', () => {
    const short = days(20, (d) => (d === '2026-10-14' ? { reach: 500 } : {}));
    expect(unusualDays(short, A, TODAY, KL)).toEqual([]);
    expect(latestDay(short, TODAY, KL).metrics.reach).toEqual({ reason: 'few_samples', n: 2 });
  });

  it('a missing value is not a finding (null, never 0)', () => {
    expect(latestDay(eightWeeks((d) => (d === '2026-10-14' ? { views: null } : {})), TODAY, KL).metrics.views).toBeNull();
  });
});

describe('best slot', () => {
  it('Tuesday evening posts reach 3× the other posts (n = 6, Low)', () => {
    const f = bestSlot([...ordinary(), ...tuesdayEvenings(300)], A, TODAY, KL);
    expect(f).toEqual({ key: `best_slot:${A}:2:evening`, accountId: A, kind: 'best_slot', tone: 'tip', params: { weekday: 2, daypart: 'evening', ratio: 3 }, n: 6, confidence: 'low', day: TODAY, postId: null, href: `/accounts/${A}` });
  });

  it('nothing under 20 measured posts, or below 1.5×', () => {
    expect(bestSlot([...ordinary(13), ...tuesdayEvenings(300)], A, TODAY, KL)).toBeNull();
    expect(bestSlot([...ordinary(), ...tuesdayEvenings(140)], A, TODAY, KL)).toBeNull();
  });
});

describe('format winner', () => {
  it('Reels reach 2.6× the other formats, linked to the Posts list of that format', () => {
    const f = formatWinner([...ordinary(20), ...Array.from({ length: 6 }, (_, i) => post(`r${i}`, `${addDays('2026-08-01', 5 * i)}T02:00:00Z`, 260, { mediaType: 'REELS' }))], A, TODAY, KL);
    expect(f).toMatchObject({ key: `format_winner:${A}:REELS`, params: { format: 'REELS', ratio: 2.6 }, n: 6, confidence: 'low', href: `/accounts/${A}?tab=posts&format=REELS` });
  });

  it('nothing with one format only', () => {
    expect(formatWinner(ordinary(25), A, TODAY, KL)).toBeNull();
  });
});

describe('hashtag winner', () => {
  const tagged = (caption: string | undefined) => [...ordinary(19, { caption: caption === undefined ? undefined : 'just a day #daily' }), ...tuesdayEvenings(300, { caption })];
  it('posts with #food reach 3× the posts without it; only the hashtag is a param, never the caption', () => {
    const f = hashtagWinner(tagged('Lunch was tasty #Food #daily'), A, TODAY, KL);
    expect(f).toMatchObject({ key: `hashtag_winner:${A}:food`, params: { hashtag: 'food', ratio: 3 }, n: 6, href: `/accounts/${A}?tab=posts` });
    expect(JSON.stringify(f)).not.toMatch(/tasty|Lunch/);
  });

  it('nothing when the captions were not read (the Overview reads none)', () => {
    expect(hashtagWinner(tagged(undefined), A, TODAY, KL)).toBeNull();
  });

  it('a very long hashtag is cut to 60 characters in the key, and the key still parses', () => {
    const long = '美'.repeat(80);
    const f = hashtagWinner(tagged(`#${long}`), A, TODAY, KL)!;
    expect(f.params.hashtag).toBe('美'.repeat(INSIGHTS.maxHashtag));
    expect(parseFindingKey(f.key)).toEqual({ kind: 'hashtag_winner', accountId: A });
  });
});

describe('posting gap', () => {
  const every2 = (lastDay: string, n = 20) => Array.from({ length: n }, (_, k) => post(`p${k}`, `${addDays(lastDay, -2 * k)}T04:00:00Z`, 100));
  it('no post for 6 days when you usually post every 2: keyed by the last post (a new post ends it)', () => {
    expect(postingGap(every2('2026-10-09'), A, TODAY, KL)).toEqual({ key: `posting_gap:${A}:p0`, accountId: A, kind: 'posting_gap', tone: 'bad', params: { days: 6, typical: 2 }, n: 19, confidence: 'medium', day: TODAY, postId: null, href: `/accounts/${A}?tab=posts` });
  });

  it('nothing at 3 days (under 2 × the median gap), with fewer than 5 gaps, or for Stories', () => {
    expect(postingGap(every2('2026-10-12'), A, TODAY, KL)).toBeNull();
    expect(postingGap(every2('2026-10-01', 5), A, TODAY, KL)).toBeNull();
    expect(postingGap(every2('2026-10-01').map((p) => ({ ...p, mediaType: 'STORY' as const })), A, TODAY, KL)).toBeNull();
  });
});

describe('unanswered questions', () => {
  it('a count only, always Low (thread replies are not read), linked to the questions view', () => {
    expect(unansweredFinding(3, A, TODAY)).toEqual({ key: `unanswered:${A}:2026-10-12`, accountId: A, kind: 'unanswered', tone: 'bad', params: { count: 3 }, n: 3, confidence: 'low', day: TODAY, postId: null, href: `/accounts/${A}?tab=comments&section=questions` });
    expect(unansweredFinding(0, A, TODAY)).toBeNull();
    expect(unansweredFinding(null, A, TODAY)).toBeNull();
  });
});

describe('findInsights', () => {
  const posts = [...ordinary(), ...tuesdayEvenings(300), post('hit', '2026-10-12T02:00:00Z', 2000, { mediaType: 'REELS' })];
  const input = { accountId: A, daily: days(14, (_d, i) => ({ reach: i < 7 ? 100 : 50 })), posts, unanswered: 2 };

  it('problems first, then good news, then tips; the same input gives the same keys', () => {
    const list = findInsights(input, o);
    expect(list.map((f) => f.kind)).toEqual(['reach_drop', 'unanswered', 'breakout', 'best_slot']);
    expect(findInsights(input, o).map((f) => f.key)).toEqual(list.map((f) => f.key));
    for (const f of list) expect(parseFindingKey(f.key)).toEqual({ kind: f.kind, accountId: A });
  });

  it('nothing at all for an account with no data', () => {
    expect(findInsights({ accountId: A, daily: [], posts: [], unanswered: null }, o)).toEqual([]);
  });

  it('never claims High', () => {
    for (const f of findInsights(input, o)) expect(['low', 'medium']).toContain(f.confidence);
  });
});

describe('dismissals', () => {
  const f = (key: string) => ({ key }) as Finding;
  const list = [f('a'), f('b'), f('c'), f('d')];
  it('hides dismissed keys for good and snoozed keys until their time', () => {
    const shown = visibleFindings(list, [{ key: 'a', until: null }, { key: 'b', until: '2026-10-20T00:00:00Z' }, { key: 'c', until: '2026-10-15T03:59:59Z' }], NOW);
    expect(shown.map((x) => x.key)).toEqual(['c', 'd']);
  });

  it('shows everything without dismissals (null = the migration is not applied)', () => {
    expect(visibleFindings(list, null, NOW)).toBe(list);
    expect(visibleFindings(list, [], NOW)).toBe(list);
  });
});

describe('parseFindingKey', () => {
  it('accepts known kinds with a lower-case uuid and a plain id', () => {
    expect(parseFindingKey(`best_slot:${A}:2:evening`)).toEqual({ kind: 'best_slot', accountId: A });
    expect(parseFindingKey(`unusual_day:${A}:reach:2026-10-14`)).toEqual({ kind: 'unusual_day', accountId: A });
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      42,
      '',
      `nope:${A}:1`,
      `breakout:${A.toUpperCase()}:1`,
      `breakout:${A}:`,
      `breakout:not-a-uuid:1`,
      `breakout:${A}:1 2`,
      `breakout:${A}:1,2`,
      `breakout:${A}:"x"`,
      `breakout:${A}:${'1'.repeat(INSIGHTS.maxKey)}`,
      `__proto__:${A}:1`,
    ])
      expect(parseFindingKey(bad), String(bad)).toBeNull();
  });
});
