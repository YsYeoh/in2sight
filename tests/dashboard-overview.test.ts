import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview, fromDayFor, parsePeriod } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { addDays } from '@/lib/sync/time';

const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const OPTS = { period: 7 as const, today: TODAY, now: NOW, tz: 'Asia/Kuala_Lumpur', locale: 'en' };
const acct = (id: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username: id, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });
const days = (n: number, reach: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers: 1000, reach, views: reach * 2, accountsEngaged: null, interactions: reach / 10, follows: null, unfollows: null, linkTaps: null }));
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };

function input(o: Partial<OverviewInput> = {}): OverviewInput {
  return {
    accounts: [acct('zeta', { groupName: 'Brand X' }), acct('alpha', { groupName: 'Brand X' }), acct('solo'), acct('other', { groupName: 'Personal' })],
    sync: { zeta: synced, alpha: synced, solo: synced, other: synced },
    daily: { zeta: days(14, 100), alpha: days(14, 50), solo: days(14, 10), other: days(14, 1) },
    posts: {},
    ...o,
  };
}

describe('parsePeriod / fromDayFor', () => {
  it('accepts 7/30/90, defaults to 30', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod(['90'])).toBe(90);
    expect(parsePeriod('28')).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });
  it('reads two windows plus lag, at least 2 × 7 days', () => {
    expect(fromDayFor(30, TODAY)).toBe(addDays(TODAY, -62));
    expect(fromDayFor(7, TODAY)).toBe(addDays(TODAY, -16));
  });
});

describe('buildOverview', () => {
  it('groups A→Z with accounts A→Z inside, isolated accounts last and never combined', () => {
    const m = buildOverview(input(), OPTS);
    expect(m.sections.map((s) => s.group)).toEqual(['Brand X', 'Personal', null]);
    expect(m.sections[0].cards.map((c) => c.id)).toEqual(['alpha', 'zeta']);
    expect(m.sections[0].totals?.reach.value).toBe(1050);
    expect(m.sections[2].totals).toBeNull();
    expect(m.totals?.followers.value).toBe(4000);
  });

  it('comparison scopes: groups with 2+ accounts, then all accounts; series aligned with the window days', () => {
    const m = buildOverview(input(), OPTS);
    expect(m.scopes.map((s) => s.id)).toEqual(['g:Brand X', 'all']);
    expect(m.scopes[1].accountIds).toEqual(['alpha', 'zeta', 'other', 'solo']);
    expect(m.days).toHaveLength(7);
    expect(m.days[6]).toBe('2026-10-14');
    expect(m.series.zeta).toEqual(Array(7).fill(100));
  });

  it('card states: reconnect beats everything, never-synced is backfilling, synced-but-empty is no data', () => {
    const m = buildOverview(
      input({
        accounts: [acct('r', { status: 'needs_reconnect' }), acct('x', { tokenExpiresAt: '2026-10-01T00:00:00Z' }), acct('b'), acct('e'), acct('ok')],
        sync: { e: synced, ok: synced },
        daily: { r: days(14, 5), x: [], b: [], e: [], ok: days(3, 5) },
      }),
      OPTS,
    );
    const state = Object.fromEntries(m.sections.flatMap((s) => s.cards).map((c) => [c.id, c.state]));
    expect(state).toEqual({ r: 'needs_reconnect', x: 'needs_reconnect', b: 'backfilling', e: 'no_data', ok: 'ok' });
  });

  it('surfaces sync errors only while failing, and flags (taking off, reach drop)', () => {
    const posts: Post[] = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, accountId: 'solo', mediaType: 'IMAGE' as const, postedAt: addDays('2026-09-20', i) + 'T00:00:00Z', permalink: null, reach: 100, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null })),
      { id: 'hit', accountId: 'solo', mediaType: 'REELS', postedAt: '2026-10-13T00:00:00Z', permalink: null, reach: 500, views: null, likes: null, comments: null, shares: null, saves: null, interactions: null },
    ];
    const drop = [...days(14, 100).slice(0, 7), ...days(7, 50)];
    const m = buildOverview(input({ accounts: [acct('solo')], sync: { solo: { ...synced, lastErrorKey: 'rate_limited', consecutiveFailures: 2 } }, daily: { solo: drop }, posts: { solo: posts } }), OPTS);
    const card = m.sections[0].cards[0];
    expect(card.syncErrorKey).toBe('rate_limited');
    expect(card.flags.map((f) => f.kind)).toEqual(['taking_off', 'reach_drop']);
    expect(m.scopes).toEqual([]); // one account: nothing to compare
  });

  it('no accounts: empty model, no NaN', () => {
    const m = buildOverview({ accounts: [], sync: {}, daily: {}, posts: {} }, OPTS);
    expect(m).toMatchObject({ totals: null, sections: [], scopes: [], totalsSpark: [] });
    expect(m.days).toHaveLength(7);
  });
});
