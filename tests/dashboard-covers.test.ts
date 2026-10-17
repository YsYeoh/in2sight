import { describe, expect, it } from 'vitest';
import { buildCalendar } from '@/lib/dashboard/calendar';
import { buildPosts, buildStories, parsePostsView, storyDays, type StoryView } from '@/lib/dashboard/content';
import { coverOf, type PostRow, type StoryRow } from '@/lib/dashboard/detail-read';

const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur';

describe('coverOf', () => {
  it('keeps the four stored statuses; anything else is "pending" (never requested)', () => {
    for (const s of ['pending', 'ok', 'unavailable', 'failed'] as const) expect(coverOf(s)).toBe(s);
    for (const v of [undefined, null, 'OK', 'ok ', 1, {}]) expect(coverOf(v)).toBe('pending');
  });
});

describe('cover fields pass through the models', () => {
  it('posts, Stories and calendar items keep cover and slides', () => {
    const row: PostRow = {
      id: 'c1',
      accountId: 'a1',
      mediaType: 'CAROUSEL_ALBUM',
      postedAt: '2026-10-10T02:00:00Z',
      permalink: null,
      reach: 10,
      views: null,
      likes: 1,
      comments: null,
      shares: null,
      saves: null,
      caption: 'Hi',
      tagIds: [],
      cover: 'ok',
      slides: 5,
    };
    expect(buildPosts([row], [], { format: null, tag: null, from: null, to: null }, KL)[0]).toMatchObject({ cover: 'ok', slides: 5 });
    const story: StoryRow = { id: 's1', postedAt: '2026-10-14T01:00:00Z', expiresAt: null, permalink: null, snapshots: [], cover: 'unavailable' };
    expect(buildStories([story], NOW)[0].cover).toBe('unavailable');
    const cal = buildCalendar(
      { from: '2026-10-01', to: '2026-10-31' },
      [{ id: 'm1', accountId: 'a1', mediaType: 'IMAGE', postedAt: '2026-10-10T02:00:00Z', permalink: null, caption: null, cover: 'failed', slides: null }],
      { weekStart: 'mon', tz: KL, today: '2026-10-15' },
    );
    expect(cal.weeks.flat().find((d) => d.day === '2026-10-10')!.items[0]).toMatchObject({ cover: 'failed', slides: null });
  });
});

describe('parsePostsView', () => {
  it('grid or table; anything else (missing, repeated, junk) is automatic', () => {
    expect(parsePostsView('grid')).toBe('grid');
    expect(parsePostsView('table')).toBe('table');
    for (const v of [undefined, '', 'GRID', ['grid', 'table'], '<script>']) expect(parsePostsView(v)).toBeNull();
  });
});

describe('storyDays', () => {
  const s = (id: string, postedAt: string): StoryView => ({ id, postedAt, permalink: null, live: false, final: null, exitRate: null, progression: [], snapshots: 0, reason: 'needs_5_viewers' });
  it('owner-timezone days newest first; the Stories of a day in posting order', () => {
    // 14 Oct 23:30 UTC is 15 Oct 07:30 in Kuala Lumpur
    const days = storyDays([s('late', '2026-10-15T09:00:00Z'), s('early', '2026-10-14T23:30:00Z'), s('prev', '2026-10-14T03:00:00Z')], KL);
    expect(days.map((d) => [d.day, d.stories.map((x) => x.id)])).toEqual([
      ['2026-10-15', ['early', 'late']],
      ['2026-10-14', ['prev']],
    ]);
    expect(storyDays([s('early', '2026-10-14T23:30:00Z')], 'UTC')[0].day).toBe('2026-10-14');
  });

  it('no Stories gives no days; an unparsable time is skipped, never thrown', () => {
    expect(storyDays([], KL)).toEqual([]);
    expect(storyDays([s('bad', 'not a date'), s('ok', '2026-10-14T03:00:00Z')], KL).map((d) => d.stories.map((x) => x.id))).toEqual([['ok']]);
  });
});
