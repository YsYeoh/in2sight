'use client';

// The Explorer (creator-toolkit spec §0b): a toolbar (ExplorerToolbar: the URL is the only state; every pick applies at
// once), the breadcrumb trail and Time Scope bar, then a linked chart + table (every row links one level deeper; chart
// bars/points do the same on click) or the single-item level, full width. Logic lives in lib/analysis/explorer.ts.
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, CircleUserRound, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { ExplorerToolbar } from '@/components/explorer/ExplorerToolbar';
import type { SavedViewsProps } from '@/components/explorer/SavedViews';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { startProgress } from '@/components/shared/NavigationProgress';
import { NavLink } from '@/components/shared/NavLink';
import { PageHeader } from '@/components/shared/PageHeader';
import { RangeBar } from '@/components/shared/RangeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import { breadcrumbs, drillHref, type ExplorerRow } from '@/lib/analysis/explorer';
import { downloadExport } from '@/lib/export/download';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { explorerParams } from '@/lib/explorer/state';
import { formatDay } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { formatMetric, type MetricId } from '@/lib/metrics';
import { cn } from '@/lib/utils';

function Crumbs({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const crumbs = breadcrumbs(data.state, { query: data.scope.query, hasGroups: data.groups.length > 0 });
  const label = (k: (typeof crumbs)[number]) =>
    k.kind === 'all' ? t('crumbs.all') : k.kind === 'group' ? k.key : k.kind === 'account' ? `@${data.live.find((a) => a.id === k.key)?.username ?? '?'}` : k.kind === 'format' ? ta(`format.${k.key}`) : data.item ? formatDay(data.item.day, prefs) : t('crumbs.item');
  return (
    <nav aria-label={t('breadcrumb')} className="mb-2 min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((c, i) => (
          <li key={c.kind} className="flex min-w-0 items-center gap-1">
            {i > 0 ? <ChevronRight aria-hidden="true" className="size-3 shrink-0" /> : null}
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {label(c)}
              </span>
            ) : (
              <NavLink href={c.href} className="truncate underline-offset-4 hover:text-foreground hover:underline">
                {label(c)}
              </NavLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Results({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const tm = useTranslations('metrics');
  const tAll = useTranslations();
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const router = useRouter();
  const s = data.state;
  const ctx = { accounts: data.live, tags: data.tags, items: data.items, gran: data.scope.gran };
  const partial = new Set(data.model.partial);
  const label = (r: ExplorerRow) => `${rowLabel(s.by, r.key, ctx, (k, v) => tAll(k as never, v as never), prefs)}${partial.has(r.key) ? ' *' : ''}`;
  const href = (r: ExplorerRow) => drillHref(s, r.key, data.scope);
  const compare = data.window.compare !== null && s.by !== 'post';
  const chartLabel = tm(s.chart);
  const rows = data.model.rows.map((r) => ({ label: label(r), now: r.values[s.chart]?.value ?? null, before: r.values[s.chart]?.prior ?? null }));
  const go = (i: number) => {
    const h = href(data.model.rows[i]);
    if (!h) return;
    startProgress(h);
    router.push(h);
  };
  const metricCol = (id: MetricId): Column<ExplorerRow> => ({
    key: id,
    header: tm(id),
    align: 'right',
    sortValue: (r) => r.values[id]?.value ?? null,
    cell: (r) => {
      const k = r.values[id];
      const d = compare && k ? delta(id, k) : null;
      return (
        <>
          {formatMetric(id, k?.value ?? null, prefs)}
          {d ? <span className={cn('ml-1.5 text-xs', d.tone === 'good' ? 'text-success' : d.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{d.text}</span> : null}
        </>
      );
    },
  });
  const columns: Column<ExplorerRow>[] = [
    {
      key: 'row',
      header: t(`by.${s.by}`),
      cell: (r) => {
        const h = href(r);
        return h ? (
          <NavLink href={h} aria-label={t('drill', { name: label(r) })} className="underline-offset-4 hover:underline" dir="auto">
            {label(r)}
          </NavLink>
        ) : (
          label(r)
        );
      },
    },
    ...s.metrics.map(metricCol),
  ];
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      {s.by === 'weekday' || s.by === 'hour' ? <p className="text-xs text-muted-foreground">{t('publishedHint')}</p> : null}
      {s.by !== 'post' ? (
        <ChartCard title={t('chartTitle', { metric: chartLabel, by: t(`by.${s.by}`) })} subtitle={t('drillHint')} summary={t('chartSummary', { metric: chartLabel, count: rows.length })}>
          <SeriesChart
            kind={s.by === 'time' ? 'line' : 'bar'}
            data={rows}
            xKey="label"
            series={[{ key: 'now', label: chartLabel }, ...(compare ? [{ key: 'before', label: t('previous', { metric: chartLabel }), muted: true }] : [])]}
            title={t('chartTitle', { metric: chartLabel, by: t(`by.${s.by}`) })}
            formatY={(n) => formatMetric(s.chart, n, prefs)}
            height={260}
            onPointClick={go}
          />
        </ChartCard>
      ) : null}
      {data.truncated ? <p className="text-xs text-muted-foreground">{t('truncated', { count: data.items.length })}</p> : null}
      <DataTable rows={data.model.rows} columns={columns} rowKey={(r) => r.key} caption={t('tableCaption')} empty={t('empty')} pageSize={s.by === 'post' ? 50 : undefined} />
      {partial.size ? <p className="text-xs text-muted-foreground">{t('partial')}</p> : null}
    </div>
  );
}

export function ExplorerView({ data, today, views, save, rename, remove }: { data: ExplorerData; today: string } & Omit<SavedViewsProps, 'query'>) {
  const t = useTranslations('explorer');
  const te = useTranslations('export.errors');
  const tp = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const s = data.state;
  const query = new URLSearchParams({ ...Object.fromEntries(explorerParams(s)), ...data.scope.params }).toString();
  const exportButton: ReactNode =
    s.item === null && data.live.length ? (
      <LoadingButton
        type="button"
        variant="outline"
        pending={exporting}
        onClick={async () => {
          setExporting(true);
          const r = await downloadExport(`/api/export/explorer?${query}`, 'xlsx');
          setExporting(false);
          setExportError(r.ok ? null : te(r.error));
        }}
      >
        <Download aria-hidden="true" />
        {t('export')}
      </LoadingButton>
    ) : null;
  const item = data.item ? data.live.find((a) => a.id === data.item!.item.accountId) : undefined;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={exportButton} />
      {exportError ? (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {exportError}
        </p>
      ) : null}
      <Crumbs data={data} />
      <RangeBar scope={data.scope} today={today} keep={Object.fromEntries(explorerParams(s))} />
      {data.live.length === 0 ? (
        <EmptyState
          icon={<CircleUserRound className="size-5" aria-hidden />}
          title={tp('empty')}
          description={tp('emptyHint')}
          action={
            <Button asChild>
              <Link href="/accounts">{tp('addAccount')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <ExplorerToolbar data={data} views={views} query={query} save={save} rename={rename} remove={remove} />
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">
              {t('window', { from: formatDay(data.window.current.from, prefs), to: formatDay(data.window.current.to, prefs) })}
              {data.window.compare && s.by !== 'post' ? ` · ${t('windowCompare', { from: formatDay(data.window.compare.from, prefs), to: formatDay(data.window.compare.to, prefs) })}` : null}
            </p>
            {s.item !== null ? (
              <ItemPanel
                detail={data.item}
                username={item?.username ?? '?'}
                tabHref={`/accounts/${data.item?.item.accountId ?? ''}?${new URLSearchParams({ tab: data.item?.item.mediaType === 'STORY' ? 'stories' : 'posts', ...data.scope.params })}`}
                labHref={data.item ? postLabHref(data.item.item.accountId, data.item.item.id, data.scope.query) : undefined}
              />
            ) : (
              <Results data={data} />
            )}
          </div>
        </>
      )}
    </>
  );
}
