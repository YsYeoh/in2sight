// Account detail: URL parsing and the Overview tab model. Pure: today/now/tz are inputs.
import type { StoredAccount } from '@/lib/accounts/types';
import { onlineHeatmap, postHeatmap, type Heatmap } from '@/lib/analysis/best-time';
import { bucketize } from '@/lib/analysis/buckets';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { kpis, summarize, type Kpi, type KpiId } from '@/lib/analysis/growth';
import { formatComparison } from '@/lib/analysis/posts';
import type { DailyRow, OnlineFollowersRow, Post } from '@/lib/analysis/types';
import { cardState, type CardState } from '@/lib/dashboard/overview';
import type { WeekStart } from '@/lib/prefs';
import type { SyncStatus } from '@/lib/sync/store';
import { localDay } from '@/lib/sync/time';
import type { ResolvedScope } from '@/lib/time-scope/scope';

// Audience is the last section of Overview (ux-polish design §4.2); ?tab=audience redirects there
export const TABS = ['overview', 'posts', 'stories'] as const;
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
  scope: ResolvedScope;
  state: CardState;
  kpis: Record<KpiId, Kpi>;
  trend: { day: string; reach: number | null; views: number | null; followers: number | null }[]; // current window, one row per bucket (its first day)
  trendPartial: string[]; // buckets the window only partly covers
  formats: ReturnType<typeof formatComparison>; // posts published in the scope's days
  heat: { online: { account: Heatmap; pooled: Heatmap }; posts: { account: Heatmap; pooled: Heatmap } };
  pooledAccounts: number;
  flags: Flag[];
  lastSyncedAt: string | null;
  syncErrorKey: string | null;
}

export function buildAccountOverview(input: AccountOverviewInput, o: { scope: ResolvedScope; today: string; now: Date; tz: string; weekStart: WeekStart }): AccountOverviewModel {
  const { account, sync, daily, posts } = input;
  const { window, gran, range } = o.scope;
  const s = summarize(daily, posts, window, o.today, o.tz, o.scope.scope.cmp);
  const byDay = new Map(daily.map((r) => [r.day, r]));
  const drop = reachDrop(daily, o.today, o.tz);
  const state = cardState(account.status, account.tokenExpiresAt, o.now, sync, s, daily.length > 0);
  const trend = bucketize(
    s.reachByDay.map(({ day }) => ({ day, reach: byDay.get(day)?.reach ?? null, views: byDay.get(day)?.views ?? null, followers: byDay.get(day)?.followers ?? null })),
    gran,
    o.weekStart,
    { reach: 'sum', views: 'sum', followers: 'last' },
  );
  const inRange = posts.filter((p) => {
    const day = localDay(new Date(p.postedAt), o.tz);
    return day >= range.from && day <= range.to;
  });
  return {
    scope: o.scope,
    state,
    kpis: kpis(s, { backfilling: state === 'backfilling' }),
    trend: trend.rows,
    trendPartial: trend.partial,
    formats: formatComparison(inRange),
    heat: {
      online: { account: onlineHeatmap(input.online, o.weekStart), pooled: onlineHeatmap(input.pooled.online, o.weekStart) },
      posts: { account: postHeatmap(posts, o.tz, o.weekStart), pooled: postHeatmap(input.pooled.posts, o.tz, o.weekStart) },
    },
    pooledAccounts: input.pooled.accounts,
    flags: [...takingOff(posts, o.now, 'last' in window ? window.last : 7), ...(drop ? [drop] : [])], // "right now" signals
    lastSyncedAt: sync?.lastSuccessAt ?? null,
    syncErrorKey: sync && sync.consecutiveFailures > 0 ? sync.lastErrorKey : null,
  };
}
