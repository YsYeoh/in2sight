import { describe, expect, it } from 'vitest';
import { digestDue, heldCount, isQuiet, isWeekStart, pushNow, summaryAlerts, summaryToPush } from '@/lib/alerts/quiet';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts/settings';
import { localTime } from '@/lib/sync/time';

const KL = 'Asia/Kuala_Lumpur'; // UTC+8, no DST
const BERLIN = 'Europe/Berlin'; // 2026-03-29 02:00 -> 03:00 (23-hour day), 2026-10-25 03:00 -> 02:00 (25-hour day)
const S: AlertSettings = DEFAULT_ALERT_SETTINGS; // quiet 22:00-08:00
const at = (iso: string) => new Date(iso);
const quiet = (from: number, to: number): AlertSettings => ({ ...S, quietFrom: from, quietTo: to });

describe('isQuiet', () => {
  it('22:00-08:00 crosses midnight: 22:00 and 07:59 are quiet, 08:00 and 21:59 are not (owner timezone)', () => {
    expect(isQuiet(at('2026-10-14T14:00:00Z'), S, KL)).toBe(true); // 22:00 KL
    expect(isQuiet(at('2026-10-13T23:59:00Z'), S, KL)).toBe(true); // 07:59 KL
    expect(isQuiet(at('2026-10-14T00:00:00Z'), S, KL)).toBe(false); // 08:00 KL
    expect(isQuiet(at('2026-10-14T13:59:00Z'), S, KL)).toBe(false); // 21:59 KL
    expect(isQuiet(at('2026-10-14T00:00:00Z'), S, 'UTC')).toBe(true); // the same instant is 00:00 in UTC
  });

  it('a window inside one day (01:00-06:00) and equal hours (= no quiet hours)', () => {
    expect(isQuiet(at('2026-10-13T17:00:00Z'), quiet(1, 6), KL)).toBe(true); // 01:00
    expect(isQuiet(at('2026-10-13T22:00:00Z'), quiet(1, 6), KL)).toBe(false); // 06:00
    expect(isQuiet(at('2026-10-13T16:30:00Z'), quiet(1, 6), KL)).toBe(false); // 00:30
    for (const h of [0, 7, 9, 23]) expect(isQuiet(at(`2026-10-14T${String(h).padStart(2, '0')}:00:00Z`), quiet(9, 9), 'UTC')).toBe(false);
  });

  it('DST: the wall clock decides, not UTC offsets (Berlin, both switch days)', () => {
    expect(isQuiet(at('2026-03-29T05:59:00Z'), S, BERLIN)).toBe(true); // 07:59 CEST
    expect(isQuiet(at('2026-03-29T06:00:00Z'), S, BERLIN)).toBe(false); // 08:00 CEST
    expect(isQuiet(at('2026-10-25T06:59:00Z'), S, BERLIN)).toBe(true); // 07:59 CET
    expect(isQuiet(at('2026-10-25T07:00:00Z'), S, BERLIN)).toBe(false); // 08:00 CET
  });
});

describe('pushNow', () => {
  const day = at('2026-10-14T04:00:00Z'); // 12:00 KL
  const night = at('2026-10-14T16:00:00Z'); // 00:00 KL
  it('unusual events go out at once outside quiet hours, never inside', () => {
    for (const k of ['needs_reconnect', 'sync_failing', 'reach_drop', 'nonfollower_spike', 'unfollow_spike'] as const) {
      expect(pushNow(k, S, day, KL), k).toBe(true);
      expect(pushNow(k, S, night, KL), k).toBe(false);
    }
  });
  it('digest-only kinds, the summaries and switched-off kinds are never pushed on their own', () => {
    for (const k of ['token_expiring', 'moderation_paused', 'digest', 'weekly_digest', 'taking_off'] as const) expect(pushNow(k, S, day, KL), k).toBe(false);
    expect(pushNow('taking_off', { ...S, push: { ...S.push, taking_off: true } }, day, KL)).toBe(true);
  });
});

describe('digestDue', () => {
  it('not during quiet hours; from quietTo on, with the window [yesterday quietTo, today quietTo)', () => {
    expect(digestDue(at('2026-10-13T23:30:00Z'), S, KL)).toBeNull(); // 07:30 KL
    expect(digestDue(at('2026-10-14T00:00:00Z'), S, KL)).toEqual({ day: '2026-10-14', fromIso: '2026-10-13T00:00:00.000Z', toIso: '2026-10-14T00:00:00.000Z' });
    expect(digestDue(at('2026-10-14T13:30:00Z'), S, KL)?.day).toBe('2026-10-14'); // 21:30 KL, the same day's window
    expect(digestDue(at('2026-10-14T14:00:00Z'), S, KL)).toBeNull(); // 22:00 KL
  });

  it('quiet hours inside one day (01-06): due from 06:00 to midnight, not between midnight and 01:00', () => {
    expect(digestDue(at('2026-10-13T16:30:00Z'), quiet(1, 6), KL)).toBeNull(); // 00:30
    expect(digestDue(at('2026-10-13T22:00:00Z'), quiet(1, 6), KL)?.day).toBe('2026-10-14'); // 06:00
  });

  it('no quiet hours (9 = 9): the summary of the less urgent kinds is due from 09:00', () => {
    expect(digestDue(at('2026-10-14T00:30:00Z'), quiet(9, 9), KL)).toBeNull(); // 08:30
    expect(digestDue(at('2026-10-14T01:00:00Z'), quiet(9, 9), KL)?.fromIso).toBe('2026-10-13T01:00:00.000Z');
  });

  it('DST: the window is 23 hours on the spring day and 25 on the autumn day, and windows chain without a gap', () => {
    const spring = digestDue(at('2026-03-29T06:30:00Z'), S, BERLIN)!;
    expect(spring).toEqual({ day: '2026-03-29', fromIso: '2026-03-28T07:00:00.000Z', toIso: '2026-03-29T06:00:00.000Z' });
    const autumn = digestDue(at('2026-10-25T07:30:00Z'), S, BERLIN)!;
    expect(autumn).toEqual({ day: '2026-10-25', fromIso: '2026-10-24T06:00:00.000Z', toIso: '2026-10-25T07:00:00.000Z' });
    expect(digestDue(at('2026-10-26T07:30:00Z'), S, BERLIN)!.fromIso).toBe(autumn.toIso);
  });
});

describe('heldCount', () => {
  const rows = [
    { kind: 'needs_reconnect', createdAt: '2026-10-13T18:00:00.000Z' }, // 02:00 KL: held by quiet hours
    { kind: 'reach_drop', createdAt: '2026-10-13T05:00:00+00:00' }, // 13:00 KL: was pushed at once
    { kind: 'token_expiring', createdAt: '2026-10-13T05:00:00.000Z' }, // digest-only: always held
    { kind: 'taking_off', createdAt: '2026-10-13T18:00:00.000Z' }, // push switched off: not in any push
    { kind: 'digest', createdAt: '2026-10-13T18:00:00.000Z' }, // a summary never counts
    { kind: 'something_old', createdAt: '2026-10-13T18:00:00.000Z' }, // unknown kind
  ];
  it('counts what was not pushed at once and has its push switched on', () => {
    expect(heldCount(rows, S, KL)).toBe(2);
    expect(heldCount(rows, { ...S, push: { ...S.push, taking_off: true } }, KL)).toBe(3);
    expect(heldCount(rows, quiet(9, 9), KL)).toBe(1); // no quiet hours: only the digest-only kind
    expect(heldCount([], S, KL)).toBe(0);
  });
});

describe('summaryAlerts', () => {
  it('a morning summary only when something was held; key digest:<day>; no account, no third-party data', () => {
    expect(summaryAlerts('2026-10-14', S, 'mon', 0)).toEqual([]);
    expect(summaryAlerts('2026-10-14', S, 'mon', 3)).toEqual([{ kind: 'digest', accountId: null, severity: 'info', dedupeKey: 'digest:2026-10-14', payload: { username: '', count: 3 } }]);
    expect(summaryAlerts('2026-10-14', { ...S, push: { ...S.push, digest: false } }, 'mon', 3)).toEqual([]);
  });

  it("the week's first day also gets the weekly review, carrying the held count; one summary is pushed", () => {
    const monday = summaryAlerts('2026-10-19', S, 'mon', 2);
    expect(monday.map((a) => a.dedupeKey)).toEqual(['digest:2026-10-19', 'weekly_digest:2026-10-19']);
    expect(monday[1].payload).toEqual({ username: '', count: 2 });
    expect(summaryToPush(monday)?.kind).toBe('weekly_digest');
    expect(summaryAlerts('2026-10-19', S, 'mon', 0).map((a) => a.kind)).toEqual(['weekly_digest']);
    expect(summaryAlerts('2026-10-18', S, 'sun', 0).map((a) => a.kind)).toEqual(['weekly_digest']);
    expect(summaryAlerts('2026-10-19', S, 'sun', 0)).toEqual([]);
    expect(summaryAlerts('2026-10-19', { ...S, push: { ...S.push, weekly_digest: false } }, 'mon', 2).map((a) => a.kind)).toEqual(['digest']);
    expect(summaryAlerts('2026-10-19', { ...S, push: { ...S.push, digest: false } }, 'mon', 2)[0].payload.count).toBe(0);
    expect(summaryToPush([])).toBeUndefined();
  });

  it('isWeekStart follows the week-start setting', () => {
    expect(isWeekStart('2026-10-19', 'mon')).toBe(true);
    expect(isWeekStart('2026-10-18', 'sun')).toBe(true);
    expect(isWeekStart('2026-10-14', 'mon')).toBe(false);
  });
});

describe('localTime (lib/sync/time)', () => {
  it('a wall-clock hour as an instant; a skipped hour resolves to just after the gap; dayStart is hour 0', () => {
    expect(localTime('2026-10-14', 8, KL).toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(localTime('2026-03-29', 8, BERLIN).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(localTime('2026-03-29', 2, BERLIN).toISOString()).toBe('2026-03-29T01:00:00.000Z'); // 02:00 does not exist: 03:00 CEST
    expect(localTime('2026-10-25', 8, BERLIN).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(localTime('2026-11-01', 0, 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
  });
});
