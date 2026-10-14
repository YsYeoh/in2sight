// Shapes loadOverviewInput() into what the Overview page renders. Pure: today/now/tz are inputs.
import { tokenStatus } from '@/lib/accounts/token-status';
import type { AccountStatus } from '@/lib/accounts/types';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { combine, kpis, summarize, type Kpi, type KpiId, type Summary } from '@/lib/analysis/growth';
import { PERIODS, type Period } from '@/lib/analysis/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { addDays } from '@/lib/sync/time';

export type CardState = 'ok' | 'backfilling' | 'no_data' | 'needs_reconnect';

export interface AccountCard {
  id: string;
  username: string;
  displayName: string | null;
  groupName: string | null;
  status: AccountStatus;
  state: CardState;
  lastSyncedAt: string | null;
  syncErrorKey: string | null; // only while the account is failing (consecutive failures > 0)
  kpis: Record<KpiId, Kpi>;
  spark: (number | null)[]; // daily reach over the current window
  flags: Flag[];
}

export interface Scope {
  id: string; // 'all' or 'g:<group name>'
  group: string | null; // null = all accounts
  accountIds: string[];
}

export interface OverviewModel {
  period: Period;
  totals: Record<KpiId, Kpi> | null; // every non-archived account together; null when there are none
  totalsSpark: (number | null)[];
  sections: { group: string | null; totals: Record<KpiId, Kpi> | null; cards: AccountCard[] }[]; // named groups A→Z, isolated last
  scopes: Scope[]; // comparison scopes: groups with 2+ accounts, then all accounts (when 2+)
  days: string[]; // comparison x axis: the current window
  series: Record<string, (number | null)[]>; // daily reach per account id, aligned with days
}

/** ?period= from the URL; anything else falls back to 30 days (SPEC §7b default). */
export function parsePeriod(v: unknown): Period {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

/** First day to read: two windows plus Instagram's up-to-48 h lag. The reach-drop flag needs 2 × 7 days at least. */
export function fromDayFor(period: Period, today: string): string {
  return addDays(today, -(2 * Math.max(period, 7) + 2));
}

export function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, doneThrough: string | null | undefined, s: Summary, hasRows: boolean): CardState {
  if (status === 'needs_reconnect' || tokenStatus(tokenExpiresAt, now).state === 'expired') return 'needs_reconnect';
  if (!doneThrough && !hasRows) return 'backfilling';
  return s.current.days === 0 && s.current.followers === null ? 'no_data' : 'ok';
}

export function buildOverview(input: OverviewInput, o: { period: Period; today: string; now: Date; tz: string; locale: string }): OverviewModel {
  const summaries = new Map<string, Summary>();
  const cards: AccountCard[] = input.accounts.map((a) => {
    const daily = input.daily[a.id] ?? [];
    const posts = input.posts[a.id] ?? [];
    const s = summarize(daily, posts, o.period, o.today, o.tz);
    summaries.set(a.id, s);
    const sync = input.sync[a.id];
    const drop = reachDrop(daily, o.today, o.tz);
    return {
      id: a.id,
      username: a.username,
      displayName: a.displayName,
      groupName: a.groupName,
      status: a.status,
      state: cardState(a.status, a.tokenExpiresAt, o.now, sync?.dailyDoneThrough, s, daily.length > 0),
      lastSyncedAt: sync?.lastSuccessAt ?? null,
      syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
      kpis: kpis(s),
      spark: s.reachByDay.map((d) => d.value),
      flags: [...takingOff(posts, o.now), ...(drop ? [drop] : [])],
    };
  });

  const byName = (x: AccountCard, y: AccountCard) => x.username.localeCompare(y.username, o.locale);
  const groups = [...new Set(cards.map((c) => c.groupName).filter((g): g is string => !!g))].sort((x, y) => x.localeCompare(y, o.locale));
  // Totals only add up healthy accounts: one needs_reconnect / backfilling / no_data account must not remove the
  // comparison (coverage) for everyone else. A scope with none left shows "no data" instead of a number.
  const empty = summarize([], [], o.period, o.today, o.tz);
  const healthy = (list: AccountCard[]) => combine(list.filter((x) => x.state === 'ok').map((x) => summaries.get(x.id)!));
  const totalsOf = (list: AccountCard[]) => (list.length ? kpis(healthy(list) ?? empty) : null);
  const sections = [
    ...groups.map((g) => {
      const list = cards.filter((c) => c.groupName === g).sort(byName);
      return { group: g, totals: totalsOf(list), cards: list };
    }),
    ...(cards.some((c) => !c.groupName) ? [{ group: null, totals: null, cards: cards.filter((c) => !c.groupName).sort(byName) }] : []), // isolated: never combined
  ];

  const scopes: Scope[] = [
    ...sections.filter((s) => s.group !== null && s.cards.length >= 2).map((s) => ({ id: `g:${s.group}`, group: s.group, accountIds: s.cards.map((c) => c.id) })),
    ...(cards.length >= 2 ? [{ id: 'all', group: null, accountIds: sections.flatMap((s) => s.cards.map((c) => c.id)) }] : []),
  ];

  const all = combine([...summaries.values()]);
  const end = all?.endDay ?? addDays(o.today, -1);
  const days = Array.from({ length: o.period }, (_, i) => addDays(end, i - o.period + 1));
  const series = Object.fromEntries(
    [...summaries.entries()].map(([id, s]) => {
      const m = new Map(s.reachByDay.map((d) => [d.day, d.value]));
      return [id, days.map((d) => m.get(d) ?? null)];
    }),
  );

  return { period: o.period, totals: totalsOf(cards), totalsSpark: healthy(cards)?.reachByDay.map((d) => d.value) ?? [], sections, scopes, days, series };
}
