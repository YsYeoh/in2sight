// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Heatmap } from '@/lib/analysis/best-time';
import { boardColumns, linkCandidates, parseItemInput, stepStatus, suggestSlots, type LinkMedia, type PlannerItem } from '@/lib/planner/items';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const T1 = '00000000-0000-4000-8000-000000000001';
const input = (o: Record<string, unknown> = {}) => ({ accountId: A, title: 'Reel: studio tour', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, ...o });
const item = (o: Partial<PlannerItem>): PlannerItem => ({ id: 'i', accountId: A, title: 't', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null, createdAt: '2026-10-01T00:00:00Z', ...o });

describe('parseItemInput', () => {
  it('normalises a valid item: title NFC + spaces collapsed, notes keep newlines (CRLF → LF), tags deduplicated lower case', () => {
    const r = parseItemInput(input({ title: '  Café   tour ', notes: ' line 1\r\nline 2 ', tagIds: [T1, T1.toUpperCase()], plannedDay: '2026-11-10', plannedHour: 19, format: 'REELS', accountId: A.toUpperCase() }));
    expect(r).toEqual({ ok: true, value: { accountId: A, title: 'Café tour', notes: 'line 1\nline 2', status: 'idea', format: 'REELS', plannedDay: '2026-11-10', plannedHour: 19, tagIds: [T1], mediaId: null } });
  });

  it('missing optional fields default to empty', () => {
    expect(parseItemInput({ accountId: A, title: 'x', status: 'drafting', tagIds: [] })).toMatchObject({ ok: true, value: { notes: '', format: null, plannedDay: null, plannedHour: null, mediaId: null } });
  });

  it.each([
    ['not an object', null],
    ['bad account', input({ accountId: 'x' })],
    ['empty title', input({ title: '   ' })],
    ['121 characters', input({ title: 'a'.repeat(121) })],
    ['control character', input({ title: 'a\u0007b' })],
    ['bidi override in notes', input({ notes: 'a‮b' })],
    ['2,001 characters of notes', input({ notes: 'é'.repeat(2001) })],
    ['notes not a string', input({ notes: 5 })],
    ['unknown status', input({ status: 'scheduled' })],
    ['unknown format', input({ format: 'VIDEO' })],
    ['impossible day', input({ plannedDay: '2026-02-30' })],
    ['hour 24', input({ plannedDay: '2026-11-10', plannedHour: 24 })],
    ['fractional hour', input({ plannedDay: '2026-11-10', plannedHour: 1.5 })],
    ['hour without a day', input({ plannedHour: 9 })],
    ['tags not an array', input({ tagIds: 'x' })],
    ['a tag that is not a uuid', input({ tagIds: ['x'] })],
    ['eleven tags', input({ tagIds: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`) })],
    ['a media id with a comma', input({ status: 'posted', mediaId: '1,2' })],
    ['a linked post on an unposted item', input({ status: 'ready', mediaId: '17895695668004550' })],
  ])('refuses %s', (_n, raw) => {
    expect(parseItemInput(raw)).toEqual({ ok: false, error: 'invalid' });
  });

  it('2,000 code points of notes (CJK and emoji count as one each) pass', () => {
    expect(parseItemInput(input({ notes: '😀'.repeat(1000) + '中'.repeat(1000) })).ok).toBe(true);
  });

  it('a posted item may carry its post', () => {
    expect(parseItemInput(input({ status: 'posted', mediaId: '17895695668004550' }))).toMatchObject({ ok: true, value: { mediaId: '17895695668004550' } });
  });
});

describe('stepStatus', () => {
  it('moves one column and stops at the edges', () => {
    expect(stepStatus('idea', 1)).toBe('drafting');
    expect(stepStatus('ready', 1)).toBe('posted');
    expect(stepStatus('drafting', -1)).toBe('idea');
    expect(stepStatus('idea', -1)).toBeNull();
    expect(stepStatus('posted', 1)).toBeNull();
  });
});

describe('boardColumns', () => {
  it('four columns in board order; planned soonest first (no hour after the day’s hours), then unplanned newest first', () => {
    const cols = boardColumns([
      item({ id: 'u-old', createdAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'u-new', createdAt: '2026-10-05T00:00:00Z' }),
      item({ id: 'd11-any', plannedDay: '2026-11-11' }),
      item({ id: 'd11-09', plannedDay: '2026-11-11', plannedHour: 9 }),
      item({ id: 'd10-20', plannedDay: '2026-11-10', plannedHour: 20 }),
      item({ id: 'r', status: 'ready' }),
    ]);
    expect(cols.map((c) => c.status)).toEqual(['idea', 'drafting', 'ready', 'posted']);
    expect(cols[0].items.map((i) => i.id)).toEqual(['d10-20', 'd11-09', 'd11-any', 'u-new', 'u-old']);
    expect(cols[1].items).toEqual([]);
    expect(cols[2].items.map((i) => i.id)).toEqual(['r']);
  });

  it('Posted: the latest planned first, then unplanned newest first', () => {
    const cols = boardColumns([item({ id: 'p1', status: 'posted', plannedDay: '2026-10-01' }), item({ id: 'p0', status: 'posted' }), item({ id: 'p2', status: 'posted', plannedDay: '2026-10-08' })]);
    expect(cols[3].items.map((i) => i.id)).toEqual(['p2', 'p1', 'p0']);
  });
});

describe('linkCandidates', () => {
  const tz = 'Europe/London';
  const m = (id: string, postedAt: string, mediaType: LinkMedia['mediaType'] = 'REELS', accountId = A): LinkMedia => ({ id, accountId, mediaType, postedAt });
  const planned = { id: 'i1', accountId: A, format: 'REELS' as const, plannedDay: '2026-10-25', plannedHour: 19 };

  it('nearest to the planned wall-clock time first, across the DST change (25 Oct 2026, London)', () => {
    // 19:00 London on 25 Oct = 19:00 UTC (GMT); 18:30 UTC = 18 h local → 1 h early; 24 Oct 21:00 UTC = 22:00 BST → 21 h early
    const r = linkCandidates(planned, [m('far', '2026-10-24T21:00:00Z'), m('near', '2026-10-25T18:30:00Z'), m('late', '2026-10-25T23:10:00Z')], new Map(), tz);
    expect(r.map((c) => [c.media.id, c.hours, c.match])).toEqual([
      ['near', -1, true],
      ['late', 4, false],
      ['far', -21, false],
    ]);
  });

  it('two posts equally near: the newer first; the planned format before others; other accounts, Stories and posts linked elsewhere are out', () => {
    const r = linkCandidates(
      planned,
      [m('img', '2026-10-25T19:00:00Z', 'IMAGE'), m('a', '2026-10-25T17:00:00Z'), m('b', '2026-10-25T21:00:00Z'), m('other', '2026-10-25T19:00:00Z', 'REELS', B), m('st', '2026-10-25T19:00:00Z', 'STORY'), m('taken', '2026-10-25T19:00:00Z')],
      new Map([['taken', 'i2']]),
      tz,
    );
    expect(r.map((c) => c.media.id)).toEqual(['b', 'a', 'img']);
    expect(r[2].match).toBe(false); // right time, other format
  });

  it('the post already linked to THIS item stays a candidate', () => {
    expect(linkCandidates(planned, [m('mine', '2026-10-25T19:00:00Z')], new Map([['mine', 'i1']]), tz).map((c) => c.media.id)).toEqual(['mine']);
  });

  it('a Story item gets Stories only; no planned day = newest first, no hours, no match; at most max', () => {
    const story = { ...planned, format: 'STORY' as const, plannedDay: null, plannedHour: null };
    const list = [m('s1', '2026-10-20T10:00:00Z', 'STORY'), m('s2', '2026-10-22T10:00:00Z', 'STORY'), m('r', '2026-10-23T10:00:00Z')];
    expect(linkCandidates(story, list, new Map(), tz).map((c) => [c.media.id, c.hours, c.match])).toEqual([
      ['s2', null, false],
      ['s1', null, false],
    ]);
    expect(linkCandidates(story, list, new Map(), tz, 1)).toHaveLength(1);
  });

  it('no format planned: any feed format matches; a day without an hour counts from noon', () => {
    const r = linkCandidates({ ...planned, format: null, plannedHour: null }, [m('x', '2026-10-25T14:00:00Z', 'IMAGE')], new Map(), tz);
    expect(r).toEqual([{ media: m('x', '2026-10-25T14:00:00Z', 'IMAGE'), hours: 2, match: true }]);
  });
});

describe('suggestSlots', () => {
  // weekday 0 = Sunday; 2026-11-01 is a Sunday
  const map = (cells: { weekday: number; hour: number; value: number; count: number }[], reason: Heatmap['reason'] = null): Heatmap => ({
    rows: [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
      weekday,
      cells: Array.from({ length: 24 }, (_, hour) => {
        const c = cells.find((x) => x.weekday === weekday && x.hour === hour);
        return c ? { value: c.value, count: c.count, lowSample: c.count < 2 } : { value: null, count: 0, lowSample: true };
      }),
    })),
    sample: 40,
    reason,
  });

  it('best cells first, on their next date after today, one per day, skipping taken days and thin cells', () => {
    const m = map([
      { weekday: 2, hour: 19, value: 0.09, count: 4 }, // Tue 3 Nov
      { weekday: 2, hour: 8, value: 0.08, count: 3 }, // Tue again: skipped (one per day)
      { weekday: 4, hour: 12, value: 0.07, count: 2 }, // Thu 5 Nov: taken
      { weekday: 0, hour: 10, value: 0.065, count: 2 }, // Sun 8 Nov (today is Sunday 1 Nov: next week)
      { weekday: 6, hour: 9, value: 0.2, count: 1 }, // one post: too thin
      { weekday: 1, hour: 7, value: 0.05, count: 5 }, // Mon 2 Nov
    ]);
    expect(suggestSlots(m, ['2026-11-05'], '2026-11-01')).toEqual([
      { day: '2026-11-03', hour: 19, value: 0.09, count: 4 },
      { day: '2026-11-08', hour: 10, value: 0.065, count: 2 },
      { day: '2026-11-02', hour: 7, value: 0.05, count: 5 },
    ]);
    expect(suggestSlots(m, [], '2026-11-01', 1)).toHaveLength(1);
  });

  it('nothing while the heatmap is unreliable', () => {
    expect(suggestSlots(map([{ weekday: 2, hour: 19, value: 0.09, count: 4 }], 'not_enough_posts'), [], '2026-11-01')).toEqual([]);
  });
});
