// Account detail: URL parsing and the Overview tab model. Pure: today/now/tz are inputs.
import type { StoredAccount } from '@/lib/accounts/types';
import { onlineHeatmap, postHeatmap, type Heatmap } from '@/lib/analysis/best-time';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { kpis, summarize, type Kpi, type KpiId } from '@/lib/analysis/growth';
import { formatComparison } from '@/lib/analysis/posts';
import type { DailyRow, OnlineFollowersRow, Period, Post } from '@/lib/analysis/types';
import { cardState, type CardState } from '@/lib/dashboard/overview';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';

export const TABS = ['overview', 'posts', 'stories', 'audience'] as const;
export type Tab = (typeof TABS)[number];

/** ?tab= from the URL. Allow-list only: arrays (?tab=a&tab=b), unknown or hostile values fall back to overview. */
export function parseTab(v: unknown): Tab {
  return typeof v === 'string' && (TABS as readonly string[]).includes(v) ? (v as Tab) : 'overview';
}

/** Accounts pooled with this one for "best time": its group, or every account when it is isolated (SPEC §7b). */
export function poolFor(account: StoredAccount, accounts: StoredAccount[]): StoredAccount[] {
  const live = accounts.filter((a) => a.status !== 'archived');
  return account.groupName ? live.filter((a) => a.groupName === account.groupName) : live;
}

export interface AccountOverviewInput {
  account: StoredAccount;
  sync: SyncStatus | undefined;
  daily: DailyRow[];
  posts: Post[];
  online: OnlineFollowersRow[];
  pooled: { accounts: number; posts: Post[]; online: OnlineFollowersRow[] };
}

export interface AccountOverviewModel {
  period: Period;
  state: CardState;
  kpis: Record<KpiId, Kpi>;
  trend: { day: string; reach: number | null; views: number | null; followers: number | null }[]; // current window
  formats: ReturnType<typeof formatComparison>;
  heat: { online: { account: Heatmap; pooled: Heatmap }; posts: { account: Heatmap; pooled: Heatmap } };
  pooledAccounts: number;
  flags: Flag[];
  lastSyncedAt: string | null;
  syncErrorKey: string | null;
}

export function buildAccountOverview(input: AccountOverviewInput, o: { period: Period; today: string; now: Date; tz: string; weekStart: WeekStart }): AccountOverviewModel {
  const { account, sync, daily, posts } = input;
  const s = summarize(daily, posts, o.period, o.today, o.tz);
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const drop = reachDrop(daily, o.today, o.tz);
  const state = cardState(account.status, account.tokenExpiresAt, o.now, sync, s, daily.length > 0);
  return {
    period: o.period,
    state,
    kpis: kpis(s, { backfilling: state === 'backfilling' }),
    trend: s.reachByDay.map(({ day }) => ({ day, reach: byDay.get(day)?.reach ?? null, views: byDay.get(day)?.views ?? null, followers: byDay.get(day)?.followers ?? null })),
    formats: formatComparison(posts),
    heat: {
      online: { account: onlineHeatmap(input.online, o.weekStart), pooled: onlineHeatmap(input.pooled.online, o.weekStart) },
      posts: { account: postHeatmap(posts, o.tz, o.weekStart), pooled: postHeatmap(input.pooled.posts, o.tz, o.weekStart) },
    },
    pooledAccounts: input.pooled.accounts,
    flags: [...takingOff(posts, o.now, o.period), ...(drop ? [drop] : [])],
    lastSyncedAt: sync?.lastSuccessAt ?? null,
    syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
  };
}
