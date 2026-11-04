import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildToday, nextSlotDay, todayFindings } from '@/lib/dashboard/today';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const C = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TODAY = '2026-10-15'; // Thursday
const NOW = new Date('2026-10-15T04:00:00Z'); // 12:00 in Kuala Lumpur
const KL = 'Asia/Kuala_Lumpur';
const o = { today: TODAY, now: NOW, tz: KL };
const acct = (id: string, username: string, x: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-01-01T00:00:00Z', ...x });
const days = (n: number, f: (day: string, i: number) => Partial<DailyRow> = () => ({})): DailyRow[] =>
  Array.from({ length: n }, (_, i) => {
    const day = addDays(TODAY, i - n);
    return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day, i) };
  });
const post = (id: string, postedAt: string, reach: number, x: Partial<Post> = {}): Post => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
const ordinary = Array.from({ length: 19 }, (_, i) => post(`o${i}`, `${addDays('2026-06-01', 3 * i)}T02:00:00Z`, 100));
const tuesdays = Array.from({ length: 6 }, (_, i) => post(`t${i}`, `${addDays('2026-09-01', 7 * i)}T11:00:00Z`, 300));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

const input: OverviewInput = {
  accounts: [acct(A, 'brand.one'), acct(B, 'broken', { status: 'needs_reconnect' }), acct(C, 'failing')],
  sync: { [A]: synced, [B]: synced, [C]: { ...synced, lastErrorKey: 'rate_limited', consecutiveFailures: 2 } },
  daily: { [A]: days(60, (d) => (d === '2026-10-14' ? { reach: 500 } : {})), [B]: days(60), [C]: days(60) },
  posts: { [A]: [...ordinary, ...tuesdays, post('hit', '2026-10-12T02:00:00Z', 2000, { mediaType: 'REELS' }), post('new', '2026-10-13T02:00:00Z', 50)] },
};
const model = buildOverview(input, { scope: resolveScope(parseTimeScope(new URLSearchParams('from=7d')), TODAY, '2026-01-01'), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' });
const cards = model.sections.flatMap((s) => s.cards);

describe('nextSlotDay', () => {
  it('today while the day part has not ended, else the next such weekday', () => {
    expect(nextSlotDay(4, 'evening', NOW, KL)).toBe(TODAY); // Thursday 12:00, evening still ahead
    expect(nextSlotDay(4, 'morning', NOW, KL)).toBe('2026-10-22'); // the morning is over
    expect(nextSlotDay(2, 'evening', NOW, KL)).toBe('2026-10-20');
  });
});

describe('buildToday', () => {
  const found = todayFindings(input, { [A]: 3, [B]: null, [C]: null }, o);
  const today = buildToday(input, cards, found, [], o);

  it('the latest settled day vs the same weekday: values, typical, n, unusual', () => {
    const a = today.accounts.find((x) => x.id === A)!;
    expect(a.day).toBe('2026-10-14');
    expect(a.metrics).toEqual([
      { id: 'followers', value: 1, typical: 1, n: 8, unusual: false },
      { id: 'reach', value: 500, typical: 100, n: 8, unusual: true },
      { id: 'views', value: 200, typical: 200, n: 8, unusual: false },
      { id: 'interactions', value: 10, typical: 10, n: 8, unusual: false },
    ]);
  });

  it('only healthy accounts get a briefing; problems come first in "needs attention"', () => {
    expect(today.accounts.map((x) => x.id)).toEqual([A, C]); // C syncs with errors but has data; B needs a reconnect
    expect(today.attention.slice(0, 2)).toEqual([
      { kind: 'problem', accountId: B, username: 'broken', problem: 'needs_reconnect', errorKey: null },
      { kind: 'problem', accountId: C, username: 'failing', problem: 'sync_error', errorKey: 'rate_limited' },
    ]);
    expect(today.attention.slice(2).map((x) => x.kind === 'finding' && x.finding.kind)).toEqual(['unanswered', 'breakout']); // tips and good-news unusual days stay out
  });

  it('working now: the best post of the last 7 days vs the typical reach of its format', () => {
    expect(today.accounts[0].top).toEqual({ id: 'hit', mediaType: 'REELS', postedAt: '2026-10-12T02:00:00Z', reach: 2000, typical: null, n: 0 }); // no mature Reels: no typical
  });

  it('next: days since the last post and the next best slot', () => {
    expect(today.accounts[0].lastPostDays).toBe(2);
    expect(today.accounts[0].slot).toEqual({ weekday: 2, daypart: 'evening', day: '2026-10-20', n: 6, confidence: 'low' });
    expect(today.accounts[1]).toMatchObject({ top: null, lastPostDays: null, slot: null });
  });

  it('dismissed findings leave the list; null dismissals = no dismiss button', () => {
    const key = found[A].find((f) => f.kind === 'breakout')!.key;
    const hidden = buildToday(input, cards, found, [{ key, until: null }], o);
    expect(hidden.attention.some((x) => x.kind === 'finding' && x.finding.key === key)).toBe(false);
    expect(hidden.canDismiss).toBe(true);
    expect(buildToday(input, cards, found, null, o).canDismiss).toBe(false);
  });

  it('no accounts: an empty briefing', () => {
    expect(buildToday({ accounts: [], sync: {}, daily: {}, posts: {} }, [], {}, [], o)).toEqual({ accounts: [], attention: [], canDismiss: true });
  });
});
