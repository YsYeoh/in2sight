import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';

describe('parseAlertSettings', () => {
  it('empty, null, arrays and strings give the SPEC defaults (push on for all except taking off)', () => {
    for (const raw of [undefined, null, {}, [], 'x', 42]) expect(parseAlertSettings(raw)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(DEFAULT_ALERT_SETTINGS.push).toEqual({ token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true });
  });

  it('keeps valid values, drops unknown keys, non-boolean toggles fall back per key', () => {
    const s = parseAlertSettings({ push: { taking_off: true, reach_drop: false, sync_failing: 'yes', evil: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4, __proto__x: 1 });
    expect(s).toEqual({ push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: false, taking_off: true, moderation_paused: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4 });
    expect(Object.keys(s).sort()).toEqual(['push', 'reachDropPct', 'syncFailures', 'takingOffRatio']);
  });

  it('clamps and rounds thresholds; NaN, Infinity and junk strings fall back', () => {
    expect(parseAlertSettings({ reachDropPct: 0, takingOffRatio: 100, syncFailures: -3 })).toMatchObject({ reachDropPct: 5, takingOffRatio: 10, syncFailures: 1 });
    expect(parseAlertSettings({ reachDropPct: 33.6, takingOffRatio: 2.04, syncFailures: 2.6 })).toMatchObject({ reachDropPct: 34, takingOffRatio: 2, syncFailures: 3 });
    expect(parseAlertSettings({ reachDropPct: '25', takingOffRatio: 'abc', syncFailures: Infinity })).toMatchObject({ reachDropPct: 25, takingOffRatio: 2, syncFailures: 2 });
    expect(parseAlertSettings({ reachDropPct: NaN, takingOffRatio: '', syncFailures: null })).toMatchObject({ reachDropPct: 20, takingOffRatio: 2, syncFailures: 2 });
  });
});

describe('flag thresholds are parameters (defaults unchanged)', () => {
  const NOW = new Date('2026-10-14T12:00:00Z');
  const post = (i: number, reach: number): Post => ({ id: `p${i}`, accountId: 'a', mediaType: 'IMAGE', postedAt: new Date(NOW.getTime() - (30 - i) * 86_400_000).toISOString(), permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });
  const posts = [...Array.from({ length: 10 }, (_, i) => post(i, 100)), post(28, 250)]; // last post 2 days old, 2.5× median

  it('takingOff uses 2× by default and a custom ratio when given', () => {
    expect(takingOff(posts, NOW).map((f) => f.postId)).toEqual(['p28']);
    expect(takingOff(posts, NOW, 7, 3)).toEqual([]);
  });

  it('reachDrop uses −20 % by default and a custom threshold when given', () => {
    const row = (day: string, reach: number): DailyRow => ({ day, reach, followers: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null });
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.parse('2026-09-30T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10));
    const rows = days.map((d, i) => row(d, i < 7 ? 100 : 75)); // −25 %
    expect(reachDrop(rows, '2026-10-14', 'UTC')?.change).toBeCloseTo(-0.25);
    expect(reachDrop(rows, '2026-10-14', 'UTC', -0.3)).toBeNull();
  });
});
