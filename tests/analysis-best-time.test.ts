import { describe, expect, it } from 'vitest';
import { onlineHeatmap, postHeatmap, RELIABLE_POSTS, weekdayOf, type Heatmap } from '@/lib/analysis/best-time';
import type { Post } from '@/lib/analysis/types';

const post = (id: string, postedAt: string, o: Partial<Post> = {}): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt, permalink: null, reach: 100, views: null, likes: 10, comments: null, shares: null, saves: null, ...o });
const cell = (h: Heatmap, weekday: number, hour: number) => h.rows.find((r) => r.weekday === weekday)!.cells[hour];

describe('weekdayOf', () => {
  it('reads the calendar day, not the instant', () => {
    expect(weekdayOf('2026-10-14')).toBe(3); // Wednesday
  });
});

describe('postHeatmap', () => {
  it('bins by owner-timezone weekday and hour; rows follow the week start', () => {
    // 16:30 UTC Tue 13 Oct = 00:30 Wed 14 Oct in Kuala Lumpur
    const h = postHeatmap([post('a', '2026-10-13T16:30:00Z'), post('b', '2026-10-13T16:45:00Z', { likes: 30 })], 'Asia/Kuala_Lumpur', 'mon');
    expect(h.rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(h.rows.every((r) => r.cells.length === 24)).toBe(true);
    expect(cell(h, 3, 0)).toEqual({ value: 0.2, count: 2, lowSample: false });
    expect(cell(h, 2, 16)).toEqual({ value: null, count: 0, lowSample: true });
    expect(postHeatmap([], 'UTC', 'sun').rows[0].weekday).toBe(0);
  });

  it('cells with fewer than 2 posts are flagged; under 30 posts the whole grid says why', () => {
    const h = postHeatmap([post('a', '2026-10-13T10:00:00Z')], 'UTC', 'mon');
    expect(cell(h, 2, 10)).toMatchObject({ count: 1, lowSample: true });
    expect(h).toMatchObject({ sample: 1, reason: 'not_enough_posts' });
    const many = Array.from({ length: RELIABLE_POSTS }, (_, i) => post(`p${i}`, `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`));
    expect(postHeatmap(many, 'UTC', 'mon').reason).toBeNull();
  });

  it('DST fall-back: both 01:30s on 1 Nov 2026 in New York land in Sunday 01:00', () => {
    const h = postHeatmap([post('edt', '2026-11-01T05:30:00Z'), post('est', '2026-11-01T06:30:00Z')], 'America/New_York', 'mon');
    expect(cell(h, 0, 1).count).toBe(2);
  });

  it('skips stories, posts without engagement data and bad timestamps', () => {
    const h = postHeatmap([post('s', '2026-10-13T10:00:00Z', { mediaType: 'STORY' }), post('n', '2026-10-13T10:00:00Z', { reach: null }), post('x', 'not a date')], 'UTC', 'mon');
    expect(h.sample).toBe(0);
  });
});

describe('onlineHeatmap', () => {
  it('averages followers online per weekday and hour across days', () => {
    const hourly = (v: number) => Array.from({ length: 24 }, (_, i) => (i === 20 ? v : 1));
    const h = onlineHeatmap([{ day: '2026-10-07', hourly: hourly(100) }, { day: '2026-10-14', hourly: hourly(300) }, { day: '2026-10-13', hourly: hourly(50) }], 'mon');
    expect(cell(h, 3, 20)).toEqual({ value: 200, count: 2, lowSample: false });
    expect(h).toMatchObject({ sample: 3, reason: null });
  });

  it('no data (under 100 followers) gives an empty grid with the reason; null hours are skipped', () => {
    expect(onlineHeatmap([], 'mon').reason).toBe('needs_100_followers');
    const h = onlineHeatmap([{ day: '2026-10-14', hourly: [null, 5] }], 'mon');
    expect(cell(h, 3, 0)).toMatchObject({ value: null, count: 0 });
    expect(cell(h, 3, 1)).toMatchObject({ value: 5, count: 1 });
  });
});
