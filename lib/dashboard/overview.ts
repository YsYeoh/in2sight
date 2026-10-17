// Shapes loadOverviewInput() into what the Overview page renders. Pure: today/now/tz are inputs.
import { tokenStatus } from '@/lib/accounts/token-status';
import type { AccountStatus } from '@/lib/accounts/types';
import { bucketize, type DayValues } from '@/lib/analysis/buckets';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { combine, kpis, summarize, type Kpi, type KpiId, type Summary } from '@/lib/analysis/growth';
import type { OverviewInput } from '@/lib/dashboard/read';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';
import type { ResolvedScope } from '@/lib/time-scope/scope';

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
  coverage: number; // share of the current window's days with data (0–1); shown while importing
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
  scope: ResolvedScope; // the Time Scope the numbers are for
  totals: Record<KpiId, Kpi> | null; // every non-archived account together; null when there are none
  totalsSpark: (number | null)[];
  sections: { group: string | null; totals: Record<KpiId, Kpi> | null; cards: AccountCard[] }[]; // named groups A→Z, isolated last
  scopes: Scope[]; // comparison scopes: groups with 2+ accounts, then all accounts (when 2+)
  days: string[]; // comparison x axis: the first day of each bucket (day, week or month) of the current window
  partial: string[]; // buckets the window only partly covers
  series: Record<string, (number | null)[]>; // reach per bucket per account id, aligned with days
}

/** backfilling = history still importing (SyncStatus.backfilling); without that flag (older rows): never synced and no rows. */
export function cardState(status: AccountStatus, tokenExpiresAt: string | null, now: Date, sync: SyncStatus | undefined, s: Summary, hasRows: boolean): CardState {
  if (status === 'needs_reconnect' || tokenStatus(tokenExpiresAt, now).state === 'expired') return 'needs_reconnect';
  if (sync?.backfilling ?? (!sync?.dailyDoneThrough && !hasRows)) return 'backfilling';
  return s.current.days === 0 && s.current.followers === null ? 'no_data' : 'ok';
}

export function buildOverview(input: OverviewInput, o: { scope: ResolvedScope; today: string; now: Date; tz: string; locale: string; weekStart: WeekStart }): OverviewModel {
  const { window, gran } = o.scope;
  const cmp = o.scope.scope.cmp;
  const summaries = new Map<string, Summary>();
  const cards: AccountCard[] = input.accounts.map((a) => {
    const daily = input.daily[a.id] ?? [];
    const posts = input.posts[a.id] ?? [];
    const s = summarize(daily, posts, window, o.today, o.tz, cmp);
    summaries.set(a.id, s);
    const sync = input.sync[a.id];
    const drop = reachDrop(daily, o.today, o.tz);
    const state = cardState(a.status, a.tokenExpiresAt, o.now, sync, s, daily.length > 0);
    return {
      id: a.id,
      username: a.username,
      displayName: a.displayName,
      groupName: a.groupName,
      status: a.status,
      state,
      lastSyncedAt: sync?.lastSuccessAt ?? null,
      syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
      coverage: s.coverage.current,
      kpis: kpis(s, { backfilling: state === 'backfilling' }),
      spark: s.reachByDay.map((d) => d.value),
      flags: [...takingOff(posts, o.now), ...(drop ? [drop] : [])],
    };
  });

  const byName = (x: AccountCard, y: AccountCard) => x.username.localeCompare(y.username, o.locale);
  const groups = [...new Set(cards.map((c) => c.groupName).filter((g): g is string => !!g))].sort((x, y) => x.localeCompare(y, o.locale));
  // Totals only add up healthy accounts: one needs_reconnect / backfilling / no_data account must not remove the
  // comparison (coverage) for everyone else. A scope with none left shows "no data" instead of a number.
  const empty = summarize([], [], window, o.today, o.tz, cmp);
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

  // comparison chart: every account's daily reach on the calendar days of the combined window, then bucketed
  const all = combine([...summaries.values()]) ?? empty;
  const byAccount = [...summaries.entries()].map(([id, s]) => [id, new Map(s.reachByDay.map((d) => [d.day, d.value]))] as const);
  const rows = all.reachByDay.map(({ day }) => ({ ...Object.fromEntries(byAccount.map(([id, m]) => [id, m.get(day) ?? null])), day }) as DayValues<string>);
  const chart = bucketize(rows, gran, o.weekStart, Object.fromEntries(byAccount.map(([id]) => [id, 'sum' as const])));
  const series = Object.fromEntries(byAccount.map(([id]) => [id, chart.rows.map((r) => r[id])]));

  return { scope: o.scope, totals: totalsOf(cards), totalsSpark: healthy(cards)?.reachByDay.map((d) => d.value) ?? [], sections, scopes, days: chart.rows.map((r) => r.day), partial: chart.partial, series };
}
