import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALERT_KINDS, DEFAULT_ALERT_SETTINGS, parseAlertSettings, UNFOLLOW_SPIKE_ENABLED } from '@/lib/alerts/settings';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';

describe('parseAlertSettings', () => {
  it('empty, null, arrays and strings give the SPEC defaults (push on for all except taking off)', () => {
    for (const raw of [undefined, null, {}, [], 'x', 42]) expect(parseAlertSettings(raw)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(DEFAULT_ALERT_SETTINGS.push).toEqual({ token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true, nonfollower_spike: true, unfollow_spike: true, digest: true, weekly_digest: true });
    expect(DEFAULT_ALERT_SETTINGS).toMatchObject({ quietFrom: 22, quietTo: 8 });
  });

  it('keeps valid values, drops unknown keys, non-boolean toggles fall back per key', () => {
    const s = parseAlertSettings({ push: { taking_off: true, reach_drop: false, sync_failing: 'yes', evil: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4, __proto__x: 1 });
    expect(s).toEqual({ push: { ...DEFAULT_ALERT_SETTINGS.push, reach_drop: false, taking_off: true }, reachDropPct: 30, takingOffRatio: 3.5, syncFailures: 4, quietFrom: 22, quietTo: 8 });
    expect(Object.keys(s).sort()).toEqual(['push', 'quietFrom', 'quietTo', 'reachDropPct', 'syncFailures', 'takingOffRatio']);
  });

  it('clamps and rounds thresholds; NaN, Infinity and junk strings fall back', () => {
    expect(parseAlertSettings({ reachDropPct: 0, takingOffRatio: 100, syncFailures: -3 })).toMatchObject({ reachDropPct: 5, takingOffRatio: 10, syncFailures: 1 });
    expect(parseAlertSettings({ reachDropPct: 33.6, takingOffRatio: 2.04, syncFailures: 2.6 })).toMatchObject({ reachDropPct: 34, takingOffRatio: 2, syncFailures: 3 });
    expect(parseAlertSettings({ reachDropPct: '25', takingOffRatio: 'abc', syncFailures: Infinity })).toMatchObject({ reachDropPct: 25, takingOffRatio: 2, syncFailures: 2 });
    expect(parseAlertSettings({ reachDropPct: NaN, takingOffRatio: '', syncFailures: null })).toMatchObject({ reachDropPct: 20, takingOffRatio: 2, syncFailures: 2 });
  });

  it('quiet hours (Plan 17e): whole hours 0-23, clamped and rounded; junk falls back to 22 and 8; equal hours are kept (= off)', () => {
    expect(parseAlertSettings({ quietFrom: 23, quietTo: 0 })).toMatchObject({ quietFrom: 23, quietTo: 0 });
    expect(parseAlertSettings({ quietFrom: -1, quietTo: 24 })).toMatchObject({ quietFrom: 0, quietTo: 23 });
    expect(parseAlertSettings({ quietFrom: 21.6, quietTo: '7' })).toMatchObject({ quietFrom: 22, quietTo: 7 });
    expect(parseAlertSettings({ quietFrom: 'x', quietTo: null })).toMatchObject({ quietFrom: 22, quietTo: 8 });
    expect(parseAlertSettings({ quietFrom: 9, quietTo: 9 })).toMatchObject({ quietFrom: 9, quietTo: 9 });
  });

  it('the four Plan 17e kinds have toggles, all on by default; the unfollow-spike rule itself stays off', () => {
    expect(parseAlertSettings({ push: { digest: false, weekly_digest: 'no' } }).push).toMatchObject({ digest: false, weekly_digest: true, nonfollower_spike: true, unfollow_spike: true });
    expect(UNFOLLOW_SPIKE_ENABLED).toBe(false);
  });

  it('ALERT_KINDS equals the kind list of the newest migration that sets notifications_kind_check (code and database agree)', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const lists = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '').match(/notifications_kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)/i)?.[1]).filter((l): l is string => l !== undefined);
    expect(lists.at(-1)?.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual([...ALERT_KINDS]);
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
