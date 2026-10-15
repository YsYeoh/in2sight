import { describe, expect, it } from 'vitest';
import { evaluateRules, type RuleInput } from '@/lib/alerts/rules';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import type { DailyRow, Post } from '@/lib/analysis/types';

const NOW = new Date('2026-10-14T12:00:00Z');
const DAY = 86_400_000;
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString();
const day = (offset: number) => new Date(Date.parse('2026-10-14T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
const row = (d: string, reach: number | null): DailyRow => ({ day: d, reach, followers: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
const post = (id: string, ageDays: number, reach: number | null): Post => ({ id, accountId: 'a1', mediaType: 'IMAGE', postedAt: iso(-ageDays * DAY), permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });

function input(o: Omit<Partial<RuleInput>, 'account'> & { account?: Partial<RuleInput['account']> } = {}): RuleInput {
  return {
    sync: { consecutiveFailures: 0, lastSuccessAt: '2026-10-14T11:30:00.000Z' },
    daily: [],
    posts: [],
    lastReachDropAt: null,
    settings: DEFAULT_ALERT_SETTINGS,
    now: NOW,
    tz: 'UTC',
    ...o,
    account: { id: 'a1', username: 'cafe', status: 'active', tokenExpiresAt: iso(40 * DAY), ...o.account },
  };
}
const kinds = (i: RuleInput) => evaluateRules(i).map((a) => a.kind);
// 7 days at 100 then 7 days at `cur` (ending yesterday = 2026-10-13)
const weeks = (cur: number | null) => Array.from({ length: 14 }, (_, i) => row(day(i - 14), i < 7 ? 100 : cur));

describe('evaluateRules', () => {
  it('a healthy account raises nothing', () => {
    expect(evaluateRules(input({ daily: weeks(100) }))).toEqual([]);
  });

  it('archived accounts never alert, whatever their state', () => {
    expect(evaluateRules(input({ account: { status: 'archived', tokenExpiresAt: iso(DAY) }, sync: { consecutiveFailures: 9, lastSuccessAt: null }, daily: weeks(10) }))).toEqual([]);
  });

  describe('token expiring', () => {
    it('fires at 7 days left (warning) and again at 2 days left (critical) with different keys', () => {
      const at7 = evaluateRules(input({ account: { tokenExpiresAt: '2026-10-20T12:00:00.000Z' } }));
      const at2 = evaluateRules(input({ account: { tokenExpiresAt: '2026-10-16T00:00:00.000Z' } }));
      expect(at7).toEqual([{ kind: 'token_expiring', accountId: 'a1', severity: 'warning', dedupeKey: 'token_expiring:a1:2026-10-20:7', payload: { username: 'cafe', days: 6 } }]);
      expect(at2[0]).toMatchObject({ severity: 'critical', dedupeKey: 'token_expiring:a1:2026-10-16:2', payload: { days: 2 } });
    });

    it('the key is stable across ticks (no repeat) and changes after a refresh moves the expiry', () => {
      const a = evaluateRules(input({ account: { tokenExpiresAt: '2026-10-20T12:00:00.000Z' } }))[0].dedupeKey;
      const b = evaluateRules(input({ now: new Date(NOW.getTime() + 3_600_000), account: { tokenExpiresAt: '2026-10-20T12:00:00.000Z' } }))[0].dedupeKey;
      expect(a).toBe(b);
      expect(evaluateRules(input({ account: { tokenExpiresAt: iso(60 * DAY) } }))).toEqual([]);
    });

    it('expired, missing or junk expiry: nothing (needs_reconnect covers a dead token)', () => {
      for (const tokenExpiresAt of [iso(-DAY), null, 'not a date']) expect(kinds(input({ account: { tokenExpiresAt } }))).toEqual([]);
    });
  });

  it('needs reconnect: one critical alert per broken stretch', () => {
    const a = evaluateRules(input({ account: { status: 'needs_reconnect' }, sync: { consecutiveFailures: 1, lastSuccessAt: '2026-10-13T08:00:00.000Z' } }));
    expect(a).toEqual([{ kind: 'needs_reconnect', accountId: 'a1', severity: 'critical', dedupeKey: 'needs_reconnect:a1:2026-10-13T08:00:00.000Z', payload: { username: 'cafe' } }]);
    expect(evaluateRules(input({ account: { status: 'needs_reconnect' }, sync: { consecutiveFailures: 0, lastSuccessAt: null } }))[0].dedupeKey).toBe('needs_reconnect:a1:never');
  });

  it('sync failing: at the threshold (default 2), same key for the rest of the streak, honours a custom threshold', () => {
    expect(kinds(input({ sync: { consecutiveFailures: 1, lastSuccessAt: null } }))).toEqual([]);
    const two = evaluateRules(input({ sync: { consecutiveFailures: 2, lastSuccessAt: '2026-10-13T08:00:00.000Z' } }));
    const five = evaluateRules(input({ sync: { consecutiveFailures: 5, lastSuccessAt: '2026-10-13T08:00:00.000Z' } }));
    expect(two[0]).toMatchObject({ kind: 'sync_failing', dedupeKey: 'sync_failing:a1:2026-10-13T08:00:00.000Z', payload: { runs: 2 } });
    expect(five[0].dedupeKey).toBe(two[0].dedupeKey);
    expect(kinds(input({ sync: { consecutiveFailures: 2, lastSuccessAt: null }, settings: { ...DEFAULT_ALERT_SETTINGS, syncFailures: 3 } }))).toEqual([]);
  });

  describe('reach drop', () => {
    it('-25 % week over week alerts with the rounded percentage', () => {
      expect(evaluateRules(input({ daily: weeks(75) }))).toEqual([{ kind: 'reach_drop', accountId: 'a1', severity: 'warning', dedupeKey: 'reach_drop:a1:2026-10-14', payload: { username: 'cafe', pct: 25 } }]);
    });

    it('-15 % does not alert at the default 20 %, but does at a 10 % threshold', () => {
      expect(kinds(input({ daily: weeks(85) }))).toEqual([]);
      expect(kinds(input({ daily: weeks(85), settings: { ...DEFAULT_ALERT_SETTINGS, reachDropPct: 10 } }))).toEqual(['reach_drop']);
    });

    it('no data: no reach-drop alert (null is not 0)', () => {
      expect(kinds(input({ daily: [] }))).toEqual([]);
      expect(kinds(input({ daily: weeks(null) }))).toEqual([]);
      expect(kinds(input({ daily: Array.from({ length: 14 }, (_, i) => row(day(i - 14), null)) }))).toEqual([]);
    });

    it('7-day cool-down: no new alert while the last one is younger than 7 days', () => {
      expect(kinds(input({ daily: weeks(50), lastReachDropAt: iso(-6 * DAY) }))).toEqual([]);
      expect(kinds(input({ daily: weeks(50), lastReachDropAt: iso(-7 * DAY) }))).toEqual(['reach_drop']);
    });
  });

  describe('taking off', () => {
    const history = Array.from({ length: 8 }, (_, i) => post(`old${i}`, 20 - i, 100));

    it('a fresh post at >= 2x the median alerts once per post (key = media id), info severity', () => {
      const a = evaluateRules(input({ posts: [...history, post('hit', 2, 260)] }));
      expect(a).toEqual([{ kind: 'taking_off', accountId: 'a1', severity: 'info', dedupeKey: 'taking_off:hit', payload: { username: 'cafe', ratio: 2.6, postId: 'hit' } }]);
    });

    it('older than 3 days, younger than 24 h, or under the custom ratio: nothing', () => {
      expect(kinds(input({ posts: [...history, post('old-hit', 5, 300)] }))).toEqual([]);
      expect(kinds(input({ posts: [...history, post('new', 0.5, 300)] }))).toEqual([]);
      expect(kinds(input({ posts: [...history, post('hit', 2, 260)], settings: { ...DEFAULT_ALERT_SETTINGS, takingOffRatio: 3 } }))).toEqual([]);
    });

    it('fewer than 5 prior posts: nothing (needs history)', () => {
      expect(kinds(input({ posts: [post('a', 10, 100), post('b', 9, 100), post('hit', 2, 900)] }))).toEqual([]);
    });
  });

  it('several rules can fire together; a needs_reconnect account gets no sync_failing/reach_drop noise', () => {
    const a = kinds(input({ account: { status: 'needs_reconnect' }, sync: { consecutiveFailures: 4, lastSuccessAt: null }, daily: weeks(10) }));
    expect(a).toEqual(['needs_reconnect']);
    const b = kinds(input({ account: { tokenExpiresAt: iso(DAY) }, sync: { consecutiveFailures: 2, lastSuccessAt: null }, daily: weeks(10) }));
    expect(b).toEqual(['token_expiring', 'sync_failing', 'reach_drop']);
  });

  it('long and unusual usernames pass through untouched (clipping is a display concern)', () => {
    const name = 'a'.repeat(30) + '_咖啡馆_' + '🔥'.repeat(5);
    expect(evaluateRules(input({ account: { status: 'needs_reconnect', username: name } }))[0].payload.username).toBe(name);
  });
});
