'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { CircleUserRound, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { PeriodSelect } from '@/components/shared/PeriodSelect';
import { DeltaPill, StatCard } from '@/components/shared/StatCard';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import type { Period } from '@/lib/analysis/types';
import type { AccountCard, OverviewModel } from '@/lib/dashboard/overview';
import { formatCompact, formatDateTime, formatDay, formatDelta, formatNumber } from '@/lib/format';
import { formatMetric } from '@/lib/metrics';
import { cn } from '@/lib/utils';

function MiniStat({ id, k }: { id: KpiId; k: Kpi }) {
  const tm = useTranslations('metrics');
  const { prefs } = usePrefs();
  const delta = useKpiDelta()(id, k);
  return (
    <div className="min-w-0">
      <span className="block truncate text-[10px] text-muted-foreground">{tm(id)}</span>
      <b className="block truncate font-medium tabular-nums">{formatMetric(id, k.value, prefs)}</b>
      {delta ? <span className={cn('block truncate text-[10px] tabular-nums', delta.tone === 'good' ? 'text-success' : delta.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{delta.text}</span> : null}
    </div>
  );
}

function AccountCardView({ c, period }: { c: AccountCard; period: Period }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const delta = useKpiDelta()('followers', c.kpis.followers);
  const reachDown = (c.kpis.reach.change ?? 0) < 0;
  return (
    <li className="min-w-0">
      <Card className="h-full min-w-0 motion-safe:animate-in motion-safe:fade-in">
        <CardContent className="grid min-w-0 gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <Avatar>
              <AvatarFallback>{[...c.username][0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-medium">@{c.username}</h3>
              {c.displayName ? <p className="truncate text-xs text-muted-foreground">{c.displayName}</p> : null}
            </div>
            {c.state === 'needs_reconnect' ? (
              <Badge variant="destructive">
                <TriangleAlert aria-hidden="true" />
                {t('needsReconnect')}
              </Badge>
            ) : null}
          </div>

          <div className="flex min-w-0 items-end justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{tm('followers')}</p>
              <p className="truncate text-[length:var(--fv)] font-semibold leading-tight tabular-nums">{formatMetric('followers', c.kpis.followers.value, prefs, { full: true })}</p>
            </div>
            {delta ? <DeltaPill delta={delta} /> : null}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">{delta ? t('vsPrevious', { days: period }) : c.kpis.followers.reason ? tR(c.kpis.followers.reason) : null}</p>

          <Sparkline data={c.spark} className={reachDown ? 'text-destructive' : 'text-chart-1'} />

          <div className="grid grid-cols-3 gap-1.5 border-t pt-2">
            <MiniStat id="reach" k={c.kpis.reach} />
            <MiniStat id="engagementRate" k={c.kpis.engagementRate} />
            <MiniStat id="posts" k={c.kpis.posts} />
          </div>

          {c.state === 'backfilling' || c.state === 'no_data' ? <p className="text-xs text-muted-foreground">{tR(c.state)}</p> : null}
          {c.state === 'needs_reconnect' ? (
            <Link href="/accounts" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
              {t('reconnectHint')}
            </Link>
          ) : null}

          {c.flags.length ? (
            <ul className="grid gap-1 text-xs">
              {c.flags.map((f) =>
                f.kind === 'taking_off' ? (
                  <li key={f.postId} className="flex items-center gap-1.5 text-success">
                    <TrendingUp aria-hidden="true" className="size-3.5 shrink-0" />
                    {f.permalink ? (
                      <a href={f.permalink} target="_blank" rel="noreferrer" className="truncate underline-offset-4 hover:underline">
                        {t('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}
                      </a>
                    ) : (
                      <span className="truncate">{t('takingOff', { ratio: formatNumber(f.ratio, prefs, { maximumFractionDigits: 1 }) })}</span>
                    )}
                  </li>
                ) : (
                  <li key="drop" className="flex items-center gap-1.5 text-destructive">
                    <TrendingDown aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{t('reachDrop', { change: formatDelta(f.change, prefs) })}</span>
                  </li>
                ),
              )}
            </ul>
          ) : null}

          <p className="mt-auto truncate text-[10px] text-muted-foreground">
            {c.lastSyncedAt ? t('lastSynced', { time: formatDateTime(c.lastSyncedAt, prefs) }) : t('neverSynced')}
            {c.syncErrorKey ? <span className="ml-1 text-destructive">· {tErr.has(c.syncErrorKey) ? tErr(c.syncErrorKey) : tErr('unexpected')}</span> : null}
          </p>
        </CardContent>
      </Card>
    </li>
  );
}

function Comparison({ model }: { model: OverviewModel }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const [scopeId, setScopeId] = useState(model.scopes[0]?.id);
  const scope = model.scopes.find((s) => s.id === scopeId) ?? model.scopes[0];
  if (!scope) return null;
  const cards = model.sections.flatMap((s) => s.cards);
  const inScope = scope.accountIds.map((id) => cards.find((c) => c.id === id)).filter((c): c is AccountCard => !!c);
  const data = model.days.map((day, i) => ({ day, ...Object.fromEntries(inScope.map((c) => [c.id, model.series[c.id]?.[i] ?? null])) }));
  const kpiCol = (id: KpiId): Column<AccountCard> => ({
    key: id,
    header: tm(id),
    align: 'right',
    sortValue: (c) => c.kpis[id].value,
    cell: (c) => {
      const d = delta(id, c.kpis[id]);
      return (
        <>
          {formatMetric(id, c.kpis[id].value, prefs)}
          {d ? <span className={cn('ml-1.5 text-xs', d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{d.text}</span> : null}
        </>
      );
    },
  });
  const columns: Column<AccountCard>[] = [{ key: 'account', header: t('account'), cell: (c) => `@${c.username}`, sortValue: (c) => c.username }, kpiCol('followers'), kpiCol('reach'), kpiCol('engagementRate'), kpiCol('posts')];

  return (
    <ChartCard
      title={t('compareTitle')}
      subtitle={t('compareHint')}
      summary={t('chartSummary', { count: inScope.length, days: model.period })}
      actions={
        <div role="group" aria-label={t('scope')} className="flex flex-wrap gap-1">
          {model.scopes.map((s) => (
            <Button key={s.id} type="button" size="sm" variant={s.id === scope.id ? 'secondary' : 'ghost'} aria-pressed={s.id === scope.id} onClick={() => setScopeId(s.id)} className="max-w-48">
              <span className="truncate">{s.group ?? t('allAccounts')}</span>
            </Button>
          ))}
        </div>
      }
    >
      <SeriesChart kind="line" data={data} xKey="day" series={inScope.map((c) => ({ key: c.id, label: `@${c.username}` }))} title={t('compareTitle')} formatX={(d) => formatDay(d, prefs)} formatY={(n) => formatCompact(n, prefs)} />
      <div className="mt-4">
        <DataTable rows={inScope} columns={columns} rowKey={(c) => c.id} caption={t('compareTitle')} initialSort={{ key: 'reach', dir: 'desc' }} />
      </div>
    </ChartCard>
  );
}

export function OverviewView({ model }: { model: OverviewModel }) {
  const t = useTranslations('pages.overview');
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const uid = useId();
  const header = <PageHeader title={t('title')} subtitle={t('subtitle')} actions={<PeriodSelect period={model.period} />} />;

  if (model.sections.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<CircleUserRound className="size-5" aria-hidden />}
          title={t('empty')}
          description={t('emptyHint')}
          action={
            <Button asChild>
              <Link href="/accounts">{t('addAccount')}</Link>
            </Button>
          }
        />
      </>
    );
  }

  const totals = model.totals!;
  const vs = t('vsPrevious', { days: model.period });
  return (
    <>
      {header}
      <section aria-label={t('allAccounts')} className="mb-[var(--gp)] grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        {(['followers', 'reach', 'views', 'engagementRate'] as const).map((id) => (
          <StatCard
            key={id}
            label={tm(id)}
            value={formatMetric(id, totals[id].value, prefs, { full: id === 'followers' })}
            delta={delta(id, totals[id])}
            comparison={vs}
            note={totals[id].reason ? tR(totals[id].reason) : undefined}
            spark={id === 'reach' ? <Sparkline data={model.totalsSpark} /> : undefined}
          />
        ))}
      </section>

      <div className="grid gap-[calc(var(--gp)*1.5)]">
        {model.sections.map((s, i) => (
          <section key={s.group ?? '\u0000isolated'} aria-labelledby={`${uid}-grp-${i}`}>
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id={`${uid}-grp-${i}`} className="flex min-w-0 items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="min-w-0 truncate">{s.group ?? t('isolated')}</span>
                <Badge variant="secondary">{formatNumber(s.cards.length, prefs)}</Badge>
              </h2>
              {s.totals ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {(['followers', 'reach'] as const).map((id) => {
                    const d = delta(id, s.totals![id]);
                    return (
                      <span key={id} className="inline-flex items-center gap-1">
                        {tm(id)} <b className="font-medium text-foreground tabular-nums">{formatMetric(id, s.totals![id].value, prefs)}</b>
                        {d ? <DeltaPill delta={d} /> : null}
                      </span>
                    );
                  })}
                </p>
              ) : null}
            </div>
            <ul className="grid gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-3">
              {s.cards.map((c) => (
                <AccountCardView key={c.id} c={c} period={model.period} />
              ))}
            </ul>
          </section>
        ))}

        <Comparison model={model} />
      </div>
    </>
  );
}
