'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Heatmap } from '@/components/charts/Heatmap';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { useBestTimeRows } from '@/components/charts/useBestTimeRows';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { NavLink } from '@/components/shared/NavLink';
import { StatCard } from '@/components/shared/StatCard';
import { useBucketFormat, useScopeText } from '@/components/shared/RangeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import type { KpiId } from '@/lib/analysis/growth';
import type { AccountOverviewModel } from '@/lib/dashboard/account';
import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
import { formatCompact, formatDateTime, formatDelta, formatNumber, formatPercent } from '@/lib/format';
import { formatMetric } from '@/lib/metrics';
import { scopeQuery } from '@/lib/time-scope/scope';

const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; text: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1">
      {options.map((o) => (
        <Button key={o.id} type="button" size="sm" variant={o.id === value ? 'secondary' : 'ghost'} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.text}
        </Button>
      ))}
    </div>
  );
}

/** `account` set: formats and best-time cells link into the Explorer (drill-down), scoped to this account. */
export function AccountOverview({ model, account }: { model: AccountOverviewModel; account?: { id: string; groupName: string | null } }) {
  const t = useTranslations('pages.account');
  const to = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const ts = useTranslations('timeScope');
  const tErr = useTranslations('accounts.errors');
  const tx = useTranslations('explorer');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const bestTime = useBestTimeRows();
  const [view, setView] = useState<'online' | 'posts'>('online'); // SPEC §7: followers online is the default
  const [scope, setScope] = useState<'account' | 'pooled'>('account');
  const heat = model.heat[view][scope];
  // drill-down: a cell of "your post performance" lists the posts behind it. The grid uses every stored post, so the
  // link asks for the whole history ("all"), this account or its pool (its group, or every account when isolated).
  const cellScope = scope === 'account' ? { acc: account?.id } : account?.groupName ? { grp: account.groupName } : {};
  const all = scopeQuery({ range: 'all', cmp: 'none', gran: 'auto' });
  const heatRows = bestTime.rows(heat, view).map((r, i) => ({
    ...r,
    cells: r.cells.map((c, hour) => ({ ...c, href: account && view === 'posts' && c.value !== null ? explorerHref(parseExplorerState({ by: 'post', ...cellScope, wd: String(heat.rows[i].weekday), hr: String(hour) }), all) : undefined })),
  }));
  const { vs } = useScopeText(model.scope);
  const fmtX = useBucketFormat(model.scope.gran, model.trendPartial);
  const gran = model.scope.gran;
  const fmtY = (n: number) => formatCompact(n, prefs);

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="min-w-0 text-xs text-muted-foreground">
        <span className="sr-only">{t('syncStatus')}: </span>
        {model.lastSyncedAt ? to('lastSynced', { time: formatDateTime(model.lastSyncedAt, prefs) }) : to('neverSynced')}
        {model.syncErrorKey ? <span className="ml-1 text-destructive">· {tErr.has(model.syncErrorKey) ? tErr(model.syncErrorKey) : tErr('unexpected')}</span> : null}
      </p>

      {model.state === 'needs_reconnect' ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          <Link href="/accounts" className="underline-offset-4 hover:underline">
            {to('reconnectHint')}
          </Link>
        </p>
      ) : model.state === 'backfilling' || model.state === 'no_data' ? (
        <p className="text-sm text-muted-foreground">{ta(`reasons.${model.state}`)}</p>
      ) : null}

      <section aria-label={t('kpis')} className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3 xl:grid-cols-6">
        {KPI_IDS.map((id) => (
          <StatCard key={id} label={tm(id)} value={formatMetric(id, model.kpis[id].value, prefs, { full: id === 'followers' })} delta={delta(id, model.kpis[id])} comparison={vs} note={model.kpis[id].reason ? ta(`reasons.${model.kpis[id].reason}`) : undefined} />
        ))}
      </section>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard title={t('trendTitle')} summary={t('trendSummary', { gran })}>
          <SeriesChart kind="line" data={model.trend} xKey="day" series={[{ key: 'reach', label: tm('reach') }, { key: 'views', label: tm('views') }]} title={t('trendTitle')} formatX={fmtX} formatY={fmtY} />
          {model.trendPartial.length ? <p className="mt-1 text-xs text-muted-foreground">{ts('partialNote')}</p> : null}
        </ChartCard>
        <ChartCard title={t('followersTitle')} summary={t('followersSummary', { gran })}>
          <SeriesChart kind="area" data={model.trend} xKey="day" series={[{ key: 'followers', label: tm('followers') }]} title={t('followersTitle')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
      </div>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard title={t('formatsTitle')} subtitle={t('formatsHint')}>
          <DataTable
            rows={model.formats}
            rowKey={(r) => r.mediaType}
            caption={t('formatsTitle')}
            empty={ta('reasons.no_data')}
            initialSort={{ key: 'avgReach', dir: 'desc' }}
            columns={[
              {
                key: 'format',
                header: t('format'),
                cell: (r) =>
                  account ? (
                    <NavLink href={explorerHref(parseExplorerState({ by: 'post', acc: account.id, fmt: r.mediaType }), model.scope.query)} aria-label={tx('drill', { name: ta(`format.${r.mediaType}`) })} className="underline-offset-4 hover:underline">
                      {ta(`format.${r.mediaType}`)}
                    </NavLink>
                  ) : (
                    ta(`format.${r.mediaType}`)
                  ),
              },
              { key: 'posts', header: tm('posts'), cell: (r) => formatNumber(r.posts, prefs), sortValue: (r) => r.posts, align: 'right' },
              { key: 'avgReach', header: t('avgReach'), cell: (r) => formatCompact(r.avgReach, prefs), sortValue: (r) => r.avgReach, align: 'right' },
              { key: 'er', header: tm('engagementRate'), cell: (r) => formatPercent(r.engagementRate, prefs), sortValue: (r) => r.engagementRate, align: 'right' },
            ]}
          />
        </ChartCard>

        <ChartCard title={t('flagsTitle')}>
          {model.flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noFlags')}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {model.flags.map((f) =>
                f.kind === 'taking_off' ? (
                  <li key={f.postId} className="flex min-w-0 items-center gap-2 text-success">
                    <TrendingUp aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">
                      {f.permalink ? (
                        <a href={f.permalink} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                          {to('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}
                        </a>
                      ) : (
                        to('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })
                      )}
                      <span className="ml-1.5 text-xs text-muted-foreground">{formatDateTime(f.postedAt, prefs)}</span>
                    </span>
                  </li>
                ) : (
                  <li key="drop" className="flex items-center gap-2 text-destructive">
                    <TrendingDown aria-hidden="true" className="size-4 shrink-0" />
                    {to('reachDrop', { change: formatDelta(f.change, prefs) })}
                  </li>
                ),
              )}
            </ul>
          )}
        </ChartCard>
      </div>

      <ChartCard
        title={t('bestTimeTitle')}
        subtitle={heat.reason ? ta(`reasons.${heat.reason}`) : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Toggle label={t('bestTimeView')} value={view} onChange={setView} options={[{ id: 'online', text: t('bestTimeOnline') }, { id: 'posts', text: t('bestTimePosts') }]} />
            <Toggle label={t('bestTimeScope')} value={scope} onChange={setScope} options={[{ id: 'account', text: t('thisAccount') }, { id: 'pooled', text: t('pooled', { count: model.pooledAccounts }) }]} />
          </div>
        }
      >
        <Heatmap caption={t('bestTimeTitle')} columns={bestTime.hours} rows={heatRows} lowLabel={ta('low')} highLabel={ta('high')} />
      </ChartCard>
    </div>
  );
}
