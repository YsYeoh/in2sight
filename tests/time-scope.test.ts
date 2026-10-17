import { describe, expect, it } from 'vitest';
import { DEFAULT_SCOPE, earliestDay, MAX_DAYS, parseTimeScope, readFrom, resolveScope, scopeHref, scopeParams, scopeQuery, scopeQueryOf, stepScope, type TimeScope } from '@/lib/time-scope/scope';
import { daysIn } from '@/lib/time-scope/range';

const TODAY = '2026-10-17'; // a Saturday
const p = (q: string, weekStart: 'mon' | 'sun' = 'mon') => parseTimeScope(new URLSearchParams(q), weekStart);

describe('parseTimeScope', () => {
  it('no parameters: last 30 days vs the previous period, automatic buckets', () => {
    expect(p('')).toEqual(DEFAULT_SCOPE);
    expect(DEFAULT_SCOPE).toEqual({ range: '30d', cmp: 'prev', gran: 'auto' });
  });

  it('presets, fixed days, compare modes and granularity', () => {
    for (const preset of ['7d', '14d', '30d', '90d', '6m', '1y', 'ytd']) expect(p(`from=${preset}`).range).toBe(preset);
    expect(p('from=2026-09-01&to=2026-09-30&cmp=yoy&gran=week')).toEqual({ range: { from: '2026-09-01', to: '2026-09-30' }, cmp: 'yoy', gran: 'week' });
    expect(p('from=90d&cmp=none').cmp).toBe('none');
    expect(p('from=90d&cfrom=2025-01-01&cto=2025-03-31&cmp=yoy').cmp).toEqual({ from: '2025-01-01', to: '2025-03-31' }); // custom days win
  });

  it('pickers: week (owner week start), month, quarter', () => {
    expect(p('week=2026-10-14').range).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(p('week=2026-10-14', 'sun').range).toEqual({ from: '2026-10-11', to: '2026-10-17' });
    expect(p('month=2026-02').range).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(p('quarter=2026-Q3').range).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('old ?period= links map to the preset', () => {
    expect(p('period=7').range).toBe('7d');
    expect(p('period=90').range).toBe('90d');
    expect(p('period=365').range).toBe('30d');
  });

  it('"all" never compares', () => {
    expect(p('from=all&cmp=yoy')).toEqual({ range: 'all', cmp: 'none', gran: 'auto' });
  });

  it('reversed days are put in order; more than MAX_DAYS keeps the end', () => {
    expect(p('from=2026-09-30&to=2026-09-01').range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    const long = p('from=2001-01-01&to=2026-10-17').range as { from: string; to: string };
    expect(long.to).toBe('2026-10-17');
    expect(daysIn(long)).toBe(MAX_DAYS);
  });

  it('hostile or malformed values fall back per part and never throw', () => {
    const junk = [
      'from=2026-02-30&to=2026-03-01', // not a day
      'from=2026-09-01', // no end
      'from=-30d',
      'from=30d&from=7d', // repeated
      'from=<script>',
      'from=1999-01-01&to=1999-02-01', // outside 2000-2099
      'week=2026-13-01',
      'month=2026-13',
      'quarter=2026-Q5',
      'period=30.0',
    ];
    for (const q of junk) expect(p(q).range, q).toBe('30d');
    for (const q of ['cmp=evil', 'cmp=yoy&cmp=none', 'cfrom=2026-01-01', 'cfrom=x&cto=y']) expect(p(q).cmp, q).toBe('prev');
    for (const q of ['gran=hour', 'gran=', 'gran=day&gran=week']) expect(p(q).gran, q).toBe('auto');
  });

  it('reads Next.js searchParams objects too (arrays count as missing)', () => {
    expect(parseTimeScope({ from: '7d', gran: 'week' })).toEqual({ range: '7d', cmp: 'prev', gran: 'week' });
    expect(parseTimeScope({ from: ['7d', '90d'] }).range).toBe('30d');
  });
});

describe('serialising', () => {
  it('canonical, defaults left out, round-trips', () => {
    expect(scopeQuery(DEFAULT_SCOPE)).toBe('');
    const scopes: TimeScope[] = [
      { range: '90d', cmp: 'yoy', gran: 'auto' },
      { range: { from: '2026-09-01', to: '2026-09-30' }, cmp: 'prev', gran: 'week' },
      { range: '1y', cmp: { from: '2024-01-01', to: '2024-12-31' }, gran: 'month' },
      { range: 'all', cmp: 'none', gran: 'auto' },
    ];
    for (const s of scopes) expect(p(scopeQuery(s))).toEqual(s);
    expect(scopeParams(scopes[1])).toEqual({ from: '2026-09-01', to: '2026-09-30', gran: 'week' });
    expect(scopeQuery(scopes[3])).toBe('from=all');
  });

  it('scopeHref keeps page parameters and replaces every scope key (pickers, old period)', () => {
    expect(scopeHref({ range: '7d', cmp: 'prev', gran: 'auto' }, { tab: 'posts', format: 'REELS', month: '2026-09', period: '30' })).toBe('?tab=posts&format=REELS&from=7d');
    expect(scopeHref(DEFAULT_SCOPE)).toBe('?');
  });

  it('scopeQueryOf picks only the scope keys of a URL', () => {
    expect(scopeQueryOf(new URLSearchParams('tab=posts&from=90d&cmp=yoy&account=x'))).toBe('from=90d&cmp=yoy');
    expect(scopeQueryOf(new URLSearchParams('tab=posts'))).toBe('');
  });
});

describe('resolveScope', () => {
  it('rolling preset: KPIs measure the last N settled days; the range shown runs to today', () => {
    const r = resolveScope({ range: '30d', cmp: 'prev', gran: 'auto' }, TODAY, '2026-01-01');
    expect(r.window).toEqual({ last: 30 });
    expect(r.range).toEqual({ from: '2026-09-18', to: TODAY });
    expect(r.compare).toEqual({ from: '2026-08-19', to: '2026-09-17' });
    expect(r).toMatchObject({ preset: '30d', gran: 'day', query: '', partial: false, comparePartial: false });
  });

  it('a running month is cut at today and compares with the same days of September', () => {
    const r = resolveScope(p('month=2026-10'), TODAY, '2026-01-01');
    expect(r.window).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(r.range).toEqual({ from: '2026-10-01', to: TODAY });
    expect(r.compare).toEqual({ from: '2026-09-01', to: '2026-09-17' });
    expect(r.query).toBe('from=2026-10-01&to=2026-10-31');
  });

  it('YTD, 1 year (weekly buckets) and all (from the first captured day, never compared)', () => {
    expect(resolveScope(p('from=ytd'), TODAY).window).toEqual({ from: '2026-01-01', to: TODAY });
    expect(resolveScope(p('from=1y'), TODAY).gran).toBe('week');
    const all = resolveScope(p('from=all'), TODAY, '2026-03-01');
    expect(all).toMatchObject({ window: { from: '2026-03-01', to: TODAY }, compare: null, partial: false, gran: 'week' });
    expect(resolveScope(p('from=all'), TODAY, null).range).toEqual({ from: TODAY, to: TODAY }); // nothing captured yet
    expect(resolveScope(p('from=all'), TODAY, '2015-01-01').range.from).toBe('2021-10-14'); // capped at MAX_DAYS
  });

  it('coverage: flags a range or comparison that starts before the first captured day', () => {
    const r = resolveScope(p('from=90d&cmp=yoy'), TODAY, '2026-08-01');
    expect(r).toMatchObject({ partial: true, comparePartial: true, earliest: '2026-08-01' });
    expect(resolveScope(p('from=7d'), TODAY, null)).toMatchObject({ partial: true, earliest: null });
  });

  it('a range that starts after today falls back to the default; a manual granularity is kept', () => {
    const r = resolveScope(p('from=2026-11-01&to=2026-11-30&gran=month'), TODAY);
    expect(r.scope.range).toBe('30d');
    expect(r.gran).toBe('month');
    expect(r.query).toBe('gran=month');
  });
});

describe('readFrom / earliestDay / stepScope', () => {
  it('reads both windows plus the lag, and at least 18 days for the reach-drop flag', () => {
    expect(readFrom(DEFAULT_SCOPE, TODAY)).toBe('2026-08-15'); // 2026-08-19 minus 4
    expect(readFrom(p('from=7d'), TODAY)).toBe('2026-09-29'); // the reach-drop floor
    expect(readFrom(p('from=7d&cmp=none'), TODAY)).toBe('2026-09-29');
    expect(readFrom(p('month=2025-09&cmp=yoy'), TODAY)).toBe('2024-08-28');
    expect(readFrom(p('from=all'), TODAY)).toBe('2021-10-14');
  });

  it('earliestDay is the oldest first row', () => {
    expect(earliestDay([[{ day: '2026-08-01' }], [], [{ day: '2026-07-20' }, { day: '2026-07-21' }]])).toBe('2026-07-20');
    expect(earliestDay([[], []])).toBeNull();
  });

  it('stepScope: a month steps by months, a rolling preset by its days, never past today', () => {
    expect(stepScope(resolveScope(p('month=2026-09'), TODAY), -1, TODAY)?.range).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(stepScope(resolveScope(p('month=2026-09'), TODAY), 1, TODAY)?.range).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(stepScope(resolveScope(p('month=2026-10'), TODAY), 1, TODAY)).toBeNull();
    expect(stepScope(resolveScope(p('from=7d&gran=day'), TODAY), -1, TODAY)).toEqual({ range: { from: '2026-10-04', to: '2026-10-10' }, cmp: 'prev', gran: 'day' });
  });
});
