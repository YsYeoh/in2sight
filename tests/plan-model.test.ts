// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GOAL_METRICS, TARGET_MAX, type Goal } from '@/lib/analysis/goals';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { StoredAccount } from '@/lib/accounts/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { loadGoals, parseGoalInput, saveGoals } from '@/lib/plan/goals';
import { buildDigest, buildGoals, digestHref, lastComplete, parseDigestPeriod, planReadFrom, periodScope } from '@/lib/plan/model';
import { DEFAULT_PLAN_SECTION, PLAN_SECTIONS, isPlanSection, planHref, routePlan } from '@/lib/plan/sections';
import { addDays } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (id: string, username: string, groupName: string | null = null): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-08-01T00:00:00Z' });
const day = (d: string, followers: number, reach: number): DailyRow => ({ day: d, followers, reach, views: reach * 2, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null });
const post = (id: string, postedAt: string, reach: number | null, mediaType: Post['mediaType'] = 'IMAGE'): Post => ({ id, accountId: A, mediaType, postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });

describe('plan sections (the Settings pattern)', () => {
  it('digest then goals; /plan redirects to the digest; unknown or deeper paths are 404', () => {
    expect(PLAN_SECTIONS).toEqual(['digest', 'goals']);
    expect(DEFAULT_PLAN_SECTION).toBe('digest');
    expect(routePlan(undefined)).toEqual({ redirect: '/plan/digest' });
    expect(routePlan([])).toEqual({ redirect: '/plan/digest' });
    expect(routePlan(['goals'])).toEqual({ section: 'goals' });
    for (const s of [['Goals'], ['board'], ['goals', 'x'], ['constructor']]) expect(routePlan(s)).toBeNull();
    for (const v of ['', 'Digest', 'toString', null, 1]) expect(isPlanSection(v)).toBe(false);
  });

  it('section URLs are /plan/<id> (tests/tabs-model.test.ts checks they stay inside a shell tab)', () => {
    for (const id of PLAN_SECTIONS) expect(planHref(id)).toBe(`/plan/${id}`);
  });
});

describe('digest period', () => {
  const today = '2026-10-29'; // a Thursday

  it('default = the last complete week (week-start setting)', () => {
    expect(parseDigestPeriod({}, today, 'mon')).toEqual({ kind: 'week', range: { from: '2026-10-19', to: '2026-10-25' }, prev: '/plan/digest?week=2026-10-12', next: '/plan/digest?week=2026-10-26', running: false });
    expect(parseDigestPeriod({}, today, 'sun').range).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    expect(lastComplete('month', today, 'mon')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('week=<any day> picks its week; the running week has no next and is marked running', () => {
    expect(parseDigestPeriod({ week: '2026-10-28' }, today, 'mon')).toMatchObject({ range: { from: '2026-10-26', to: '2026-11-01' }, next: null, running: true });
  });

  it('month=YYYY-MM wins over week; a month or week starting after today, junk and repeats fall back to the last week', () => {
    expect(parseDigestPeriod({ month: '2026-09', week: '2026-10-28' }, today, 'mon')).toEqual({ kind: 'month', range: { from: '2026-09-01', to: '2026-09-30' }, prev: '/plan/digest?month=2026-08', next: '/plan/digest?month=2026-10', running: false });
    expect(parseDigestPeriod({ month: '2026-10' }, today, 'mon')).toMatchObject({ kind: 'month', next: null, running: true });
    for (const sp of [{ month: '2026-11' }, { week: '2026-11-02' }, { week: '2026-02-30' }, { month: '2026-13' }, { week: ['2026-10-01', '2026-10-08'] }])
      expect(parseDigestPeriod(sp, today, 'mon').range, JSON.stringify(sp)).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('month steps across the year and February', () => {
    expect(parseDigestPeriod({ month: '2026-01' }, today, 'mon').prev).toBe('/plan/digest?month=2025-12');
    expect(parseDigestPeriod({ month: '2026-02' }, today, 'mon').range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(digestHref('week', { from: '2026-10-19', to: '2026-10-25' })).toBe('/plan/digest?week=2026-10-19');
  });

  it('the period is a fixed Time Scope compared with the one before', () => {
    expect(periodScope(parseDigestPeriod({}, today, 'mon'))).toEqual({ range: { from: '2026-10-19', to: '2026-10-25' }, cmp: 'prev', gran: 'day' });
  });

  it('reads far enough back for the comparison, this month, last week, 30 days of followers and each followers goal start', () => {
    const p = parseDigestPeriod({}, today, 'mon');
    expect(planReadFrom(periodScope(p), today, 'mon', [])).toBe('2026-09-29'); // 30 days before today
    const g: Goal = { id: 'g', accountId: A, metric: 'followers', target: 9, dueDay: '2027-01-01', startDay: '2026-06-01' };
    expect(planReadFrom(periodScope(p), today, 'mon', [g])).toBe('2026-06-01');
    expect(planReadFrom({ range: { from: '2026-08-01', to: '2026-08-31' }, cmp: 'prev', gran: 'day' }, today, 'mon', [])).toBe('2026-06-27');
  });
});

describe('buildDigest', () => {
  const today = '2026-10-29';
  const now = new Date('2026-10-29T10:00:00Z');
  const daily = Array.from({ length: 40 }, (_, i) => day(addDays('2026-09-19', i), 1000 + i, 100));
  const posts = [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => post(`p${n}`, `2026-10-${String(18 + n).padStart(2, '0')}T03:00:00Z`, n * 100)), // 19..25 Oct
    post('null', '2026-10-20T03:00:00Z', null),
    post('story', '2026-10-21T03:00:00Z', 99999, 'STORY'),
    post('old', '2026-10-10T03:00:00Z', 99999),
  ];
  const input: OverviewInput = { accounts: [acct(A, 'one')], sync: {}, daily: { [A]: daily }, posts: { [A]: posts } };
  const period = parseDigestPeriod({}, today, 'mon');

  it('Overview numbers for the week vs the week before', () => {
    const m = buildDigest(input, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' });
    expect(m.overview.scope.range).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(m.overview.scope.compare).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    const card = m.overview.sections[0].cards[0];
    expect(card.kpis.reach).toMatchObject({ value: 700, prior: 700, change: 0 });
    expect(card.kpis.posts.value).toBe(8); // feed posts incl. the unmeasured one; Stories never
  });

  it('top 3 and bottom 3 by reach of the week’s measured feed posts; young = posted under 7 days before today', () => {
    const a = buildDigest(input, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' }).accounts[A];
    expect(a.measured).toBe(7);
    expect(a.top.map((p) => p.id)).toEqual(['p7', 'p6', 'p5']);
    expect(a.bottom.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(a.top.map((p) => p.young)).toEqual([true, true, true]); // 25, 24, 23 Oct: 4 to 6 days before 29 Oct
    expect(a.bottom.map((p) => p.young)).toEqual([false, false, false]); // 19 to 21 Oct: 8 to 10 days
  });

  it('no bottom list with 6 or fewer measured posts (it would repeat the top)', () => {
    const few: OverviewInput = { ...input, posts: { [A]: posts.slice(0, 6) } };
    const a = buildDigest(few, [], { period, today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' }).accounts[A];
    expect(a.top).toHaveLength(3);
    expect(a.bottom).toEqual([]);
  });

  it('goals are computed for today, whatever the period', () => {
    const g: Goal = { id: 'g', accountId: A, metric: 'posts_per_week', target: 3, dueDay: null, startDay: '2026-10-01' };
    const m = buildDigest(input, [g], { period: parseDigestPeriod({ month: '2026-09' }, today, 'mon'), today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' });
    expect(m.accounts[A].goals).toEqual([expect.objectContaining({ metric: 'posts_per_week', week: { from: '2026-10-26', to: '2026-11-01' }, actual: 0, lastWeek: { actual: 8, met: true } })]);
    expect(buildGoals(input, [g], { today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' })).toEqual([expect.objectContaining({ id: A, username: 'one', goals: [g] })]);
  });
});

describe('goal input and storage', () => {
  const today = '2026-10-29';

  it('the TypeScript limits equal the migration checks (20261103000001_goals.sql)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261103000001_goals.sql'), 'utf8');
    expect(sql).toContain(`check (metric in (${GOAL_METRICS.map((m) => `'${m}'`).join(', ')}))`);
    expect(sql).toContain(`check (target between 1 and ${TARGET_MAX.followers})`);
    expect(TARGET_MAX.avg_reach).toBe(TARGET_MAX.followers);
    expect(sql).toContain(`target <= ${TARGET_MAX.posts_per_week})`);
  });

  it('empty = no goal; whole numbers in range; followers needs a due day after today and within 5 years', () => {
    expect(parseGoalInput({ followers: '', avg_reach: '1200', posts_per_week: 3 }, today)).toEqual({ followers: null, avg_reach: { target: 1200, dueDay: null }, posts_per_week: { target: 3, dueDay: null } });
    expect(parseGoalInput({ followers: ' 5000 ', followersDue: '2026-12-31' }, today)).toEqual({ followers: { target: 5000, dueDay: '2026-12-31' }, avg_reach: null, posts_per_week: null });
    for (const bad of [null, 'x', { posts_per_week: '51' }, { avg_reach: '0' }, { avg_reach: '1.5' }, { avg_reach: '-3' }, { avg_reach: '1e3' }, { followers: '10' }, { followers: '10', followersDue: today }, { followers: '10', followersDue: '2031-11-03' }, { followers: '10', followersDue: '2026-02-30' }])
      expect(parseGoalInput(bad, today), JSON.stringify(bad)).toBeNull();
  });

  function fakeDb(answers: { upsert?: unknown; delete?: unknown; select?: { data: unknown; error: unknown } } = {}) {
    const calls: unknown[][] = [];
    const db = {
      from: (t: string) => ({
        upsert: (rows: unknown, o: unknown) => (calls.push(['upsert', t, rows, o]), Promise.resolve({ error: answers.upsert ?? null })),
        delete: () => ({ eq: (k: string, v: string) => ({ in: (k2: string, v2: string[]) => (calls.push(['delete', t, k, v, k2, v2]), Promise.resolve({ error: answers.delete ?? null })) }) }),
        select: (s: string) => ({ order: () => ({ limit: (n: number) => (calls.push(['select', t, s, n]), Promise.resolve(answers.select ?? { data: [], error: null })) }) }),
      }),
    };
    return { db: db as never, calls };
  }

  it('saveGoals upserts set goals on (account, metric) and deletes cleared ones', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-29T01:00:00Z') });
    const { db, calls } = fakeDb();
    expect(await saveGoals(db, A, { followers: null, avg_reach: { target: 500, dueDay: null }, posts_per_week: null })).toEqual({ ok: true });
    expect(calls).toEqual([
      ['upsert', 'goals', [{ account_id: A, metric: 'avg_reach', target: 500, due_day: null, updated_at: '2026-10-29T01:00:00.000Z' }], { onConflict: 'account_id,metric' }],
      ['delete', 'goals', 'account_id', A, 'metric', ['followers', 'posts_per_week']],
    ]);
    vi.useRealTimers();
  });

  it('error keys: not a uuid / unknown account = invalid, no table = needs_update, anything else = unexpected', async () => {
    const none = { followers: null, avg_reach: null, posts_per_week: { target: 2, dueDay: null } };
    expect(await saveGoals(fakeDb().db, 'nope', none)).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoals(fakeDb({ upsert: { code: '23503' } }).db, A, none)).toEqual({ ok: false, error: 'invalid' });
    expect(await saveGoals(fakeDb({ upsert: { code: 'PGRST205' } }).db, A, none)).toEqual({ ok: false, error: 'needs_update' });
    expect(await saveGoals(fakeDb({ delete: { code: '57014', message: 'secret' } }).db, A, none)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('loadGoals maps rows (start day in the owner timezone), null without the migration, throws a fixed message otherwise', async () => {
    const rows = [{ id: 'g1', account_id: A, metric: 'followers', target: 5000, due_day: '2026-12-31', created_at: '2026-10-28T20:00:00Z' }, { id: 'g2', account_id: A, metric: 'bogus', target: 1, due_day: null, created_at: '2026-10-28T20:00:00Z' }];
    expect(await loadGoals(fakeDb({ select: { data: rows, error: null } }).db, 'Asia/Kuala_Lumpur')).toEqual([{ id: 'g1', accountId: A, metric: 'followers', target: 5000, dueDay: '2026-12-31', startDay: '2026-10-29' }]);
    expect(await loadGoals(fakeDb({ select: { data: null, error: { code: '42P01' } } }).db, 'UTC')).toBeNull();
    await expect(loadGoals(fakeDb({ select: { data: null, error: { code: 'XX', message: 'secret 1' } } }).db, 'UTC')).rejects.toThrow('goals read failed');
  });
});
