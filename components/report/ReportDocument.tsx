'use client';

// The printable report (SPEC §7d): the owner-session preview page and the headless PDF page both render this.
// Static by design: no toggles, no links that matter on paper, charts without animation, sections in a fixed order.
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RankedBars } from '@/components/account/AudienceTab';
import { Heatmap } from '@/components/charts/Heatmap';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { useBestTimeRows } from '@/components/charts/useBestTimeRows';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { useBucketFormat } from '@/components/shared/TimeScopeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import type { KpiId } from '@/lib/analysis/growth';
import type { GroupStats } from '@/lib/analysis/posts';
import type { Section } from '@/lib/export/params';
import type { ReportModel } from '@/lib/export/report';
import { formatCompact, formatCountry, formatDateTime, formatDay, formatDelta, formatNumber, formatPercent } from '@/lib/format';
import { formatMetric } from '@/lib/metrics';

const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];

export function ReportDocument({ model }: { model: ReportModel }) {
  const t = useTranslations('export');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const to = useTranslations('pages.overview');
  const tp = useTranslations('pages.account');
  const ts = useTranslations('timeScope');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const bestTime = useBestTimeRows();
  const vs = model.compare ? ts('vsRange', { range: ts('rangeText', { from: formatDay(model.compare.from, prefs), to: formatDay(model.compare.to, prefs) }) }) : '';
  const trendX = useBucketFormat(model.gran, model.trendPartial);
  const scope = model.scope.kind === 'all' ? t('scopeAll') : model.scope.kind === 'account' ? `@${model.scope.name}` : model.scope.name;
  const statRows = (rows: { key: string; label: string; s: GroupStats }[]) => (
    <DataTable
      rows={rows}
      rowKey={(r) => r.key}
      caption={t('section.tags')}
      empty={ta('reasons.no_data')}
      columns={[
        { key: 'name', header: t('cols.tag'), cell: (r) => r.label },
        { key: 'posts', header: tm('posts'), cell: (r) => formatNumber(r.s.posts, prefs), align: 'right' },
        { key: 'avgReach', header: tp('avgReach'), cell: (r) => formatCompact(r.s.avgReach, prefs), align: 'right' },
        { key: 'er', header: tm('engagementRate'), cell: (r) => formatPercent(r.s.engagementRate, prefs), align: 'right' },
      ]}
    />
  );

  const sections: Record<Section, () => React.ReactNode> = {
    kpis: () => (
      <>
        <div className="grid grid-cols-2 gap-[var(--gp)] sm:grid-cols-3">
          {KPI_IDS.map((id) => (
            <StatCard key={id} label={tm(id)} value={formatMetric(id, model.kpis[id].value, prefs, { full: id === 'followers' })} delta={delta(id, model.kpis[id])} comparison={vs} note={model.kpis[id].reason ? ta(`reasons.${model.kpis[id].reason}`) : undefined} />
          ))}
        </div>
        {model.accounts.length ? (
          <DataTable
            rows={model.accounts}
            rowKey={(a) => a.username}
            caption={t('report.perAccount')}
            columns={[
              { key: 'account', header: t('cols.account'), cell: (a) => <span dir="auto">@{a.username}</span> },
              ...KPI_IDS.map((id) => ({ key: id, header: tm(id), cell: (a: (typeof model.accounts)[number]) => formatMetric(id, a.kpis[id].value, prefs), align: 'right' as const })),
            ]}
          />
        ) : null}
      </>
    ),
    trend: () => (
      <>
        <SeriesChart kind="line" data={model.trend} xKey="day" series={[{ key: 'reach', label: tm('reach') }, { key: 'views', label: tm('views') }]} title={t('section.trend')} formatX={trendX} formatY={(n) => formatCompact(n, prefs)} animate={false} />
        {model.trendPartial.length ? <p className="mt-1 text-xs text-muted-foreground">{ts('partialNote')}</p> : null}
      </>
    ),
    topPosts: () => (
      <DataTable
        rows={model.topPosts}
        rowKey={(p) => p.id}
        caption={t('section.topPosts')}
        empty={t('report.noData')}
        columns={[
          {
            key: 'post',
            header: tp('posts.post'),
            cell: (p) => (
              <span className="grid min-w-0">
                <span className="break-words" dir="auto">{p.caption ?? tp('posts.noCaption')}</span>
                <span className="text-xs text-muted-foreground">@{p.username} &middot; {formatDateTime(p.postedAt, prefs)}</span>
              </span>
            ),
          },
          { key: 'type', header: t('cols.type'), cell: (p) => ta(`format.${p.mediaType}`) },
          { key: 'reach', header: tm('reach'), cell: (p) => formatCompact(p.reach, prefs), align: 'right' },
          { key: 'er', header: tm('engagementRate'), cell: (p) => formatPercent(p.engagementRate, prefs), align: 'right' },
        ]}
      />
    ),
    formats: () => statRows(model.formats.map((f) => ({ key: f.mediaType, label: ta(`format.${f.mediaType}`), s: f }))),
    tags: () => statRows([...model.tags.map((x) => ({ key: x.name, label: x.name, s: x.stat })), { key: '\u0000untagged', label: t('untagged'), s: model.untagged }]),
    bestTime: () => (
      <div className="grid gap-[var(--gp)]">
        {(['online', 'posts'] as const).map((kind) => (
          <div key={kind} className="grid gap-1">
            <h3 className="text-sm font-medium">{tp(kind === 'online' ? 'bestTimeOnline' : 'bestTimePosts')}</h3>
            {model.bestTime[kind].reason ? <p className="text-xs text-muted-foreground">{ta(`reasons.${model.bestTime[kind].reason}`)}</p> : null}
            <Heatmap caption={tp(kind === 'online' ? 'bestTimeOnline' : 'bestTimePosts')} columns={bestTime.hours} rows={bestTime.rows(model.bestTime[kind], kind)} lowLabel={ta('low')} highLabel={ta('high')} />
          </div>
        ))}
      </div>
    ),
    audience: () => (
      <div className="grid gap-[var(--gp)] sm:grid-cols-2">
        {model.audience.map(({ username, model: a }) => (
          <div key={username} className="grid min-w-0 content-start gap-2">
            <h3 className="truncate text-sm font-medium" dir="auto">@{username}</h3>
            {a.reason ? <p className="text-xs text-muted-foreground">{ta(`reasons.${a.reason}`)}</p> : null}
            {a.countries ? <RankedBars data={a.countries} name={(c) => formatCountry(c, prefs)} otherLabel={tp('audience.other')} /> : null}
            {a.cities ? <RankedBars data={a.cities} name={(c) => c} otherLabel={tp('audience.other')} /> : null}
          </div>
        ))}
      </div>
    ),
    stories: () => (
      <DataTable
        rows={model.stories}
        rowKey={(s) => s.username}
        caption={t('section.stories')}
        columns={[
          { key: 'account', header: t('cols.account'), cell: (s) => <span dir="auto">@{s.username}</span> },
          { key: 'count', header: t('report.storiesCount'), cell: (s) => `${formatNumber(s.count, prefs)}${s.capped ? '+' : ''}`, align: 'right' },
          { key: 'reach', header: tp('avgReach'), cell: (s) => formatCompact(s.avgReach, prefs), align: 'right' },
          { key: 'views', header: t('report.avgViews'), cell: (s) => formatCompact(s.avgViews, prefs), align: 'right' },
          { key: 'exit', header: t('report.avgExitRate'), cell: (s) => formatPercent(s.avgExitRate, prefs), align: 'right' },
        ]}
      />
    ),
    flags: () =>
      model.flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tp('noFlags')}</p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {model.flags.map(({ username, flag }) =>
            flag.kind === 'taking_off' ? (
              <li key={flag.postId} className="flex min-w-0 items-center gap-2 text-success">
                <TrendingUp aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0">
                  @{username} &middot; {to('takingOff', { ratio: formatNumber(flag.ratio, prefs, { maximumFractionDigits: 1 }) })} &middot; {formatDateTime(flag.postedAt, prefs)}
                </span>
              </li>
            ) : (
              <li key={`drop-${username}`} className="flex items-center gap-2 text-destructive">
                <TrendingDown aria-hidden="true" className="size-4 shrink-0" />@{username} &middot; {to('reachDrop', { change: formatDelta(flag.change, prefs) })}
              </li>
            ),
          )}
        </ul>
      ),
  };

  return (
    <article data-report className="mx-auto grid w-full max-w-[210mm] min-w-0 gap-[var(--gp)] bg-background p-[var(--pg)] text-foreground">
      <header className="grid gap-1 border-b pb-3">
        <h1 className="break-words text-[length:calc(var(--fv)*0.9)] font-semibold leading-tight" dir="auto">{model.title || t('report.defaultTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          <span dir="auto">{scope}</span> &middot; {t('report.range', { from: formatDay(model.from, prefs), to: formatDay(model.to, prefs), days: model.period })}
        </p>
        <p className="text-xs text-muted-foreground">{t('report.generated', { time: formatDateTime(model.generatedAt, prefs) })}</p>
        {model.note ? <p className="mt-2 whitespace-pre-line break-words text-sm" dir="auto">{model.note}</p> : null}
      </header>
      {model.sections.map((s) => (
        <section key={s} data-section={s} className="min-w-0">
          <ChartCard title={t(`section.${s}`)}>{sections[s]()}</ChartCard>
        </section>
      ))}
    </article>
  );
}
