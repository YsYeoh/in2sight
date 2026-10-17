'use client';

// The Explorer (creator-toolkit spec §0b): desktop-first. Left: the settings (a GET form: the URL is the only state) and
// saved views. Right: breadcrumb trail, Time Scope bar, linked chart + table (every row links one level deeper; chart
// bars/points do the same on click), or the single-item level. Logic lives in lib/analysis/explorer.ts.
import { useState, type ReactNode } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, CircleUserRound, Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { SavedViews, type SavedViewsProps } from '@/components/explorer/SavedViews';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { NavLink } from '@/components/shared/NavLink';
import { PageHeader } from '@/components/shared/PageHeader';
import { TimeScopeBar } from '@/components/shared/TimeScopeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { breadcrumbs, drillHref, type ExplorerRow } from '@/lib/analysis/explorer';
import { downloadExport } from '@/lib/export/download';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { explorerHref, explorerParams, FORMATS, MAX_METRICS, usable, withState, type ExplorerState } from '@/lib/explorer/state';
import { formatDay, formatHour } from '@/lib/format';
import { DIMENSIONS, formatMetric, METRIC_IDS, type MetricId } from '@/lib/metrics';
import { cn } from '@/lib/utils';

const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

function Hidden({ params }: { params: Record<string, string> }) {
  return Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

/** The settings form. Multi-choices (metrics, accounts) are joined into ONE value: a repeated key would count as missing. */
function Controls({ data }: { data: ExplorerData }) {
  const t = useTranslations('explorer');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const s = data.state;
  const [by, setBy] = useState(s.by);
  const [metrics, setMetrics] = useState<MetricId[]>(s.metrics);
  const [accounts, setAccounts] = useState<string[]>(s.accounts);
  const filters = { by, format: s.format, tag: s.tag, weekday: s.weekday, hour: s.hour };
  const kept = metrics.filter((id) => usable(id, filters));
  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  return (
    <Form action="" onSubmit={(e) => startProgress(formHref(e.currentTarget))} aria-label={t('controls')} className="grid min-w-0 gap-[var(--gp)]">
      <Hidden params={data.scope.params} />
      <input type="hidden" name="m" value={kept.join(',')} />
      {accounts.length ? <input type="hidden" name="acc" value={accounts.join(',')} /> : null}
      <FormField id="x-by" label={t('groupBy')}>
        {(p) => (
          <select {...p} name="by" value={by} onChange={(e) => setBy(e.target.value as ExplorerState['by'])} className={SELECT}>
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>
                {t(`by.${d}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="grid min-w-0 gap-1">
        <legend className="mb-1 text-sm font-medium">
          {t('metrics')} <span className="text-xs font-normal text-muted-foreground">{t('metricsHint', { max: MAX_METRICS })}</span>
        </legend>
        {METRIC_IDS.map((id) => {
          const ok = usable(id, filters);
          const on = kept.includes(id);
          return (
            <label key={id} className={cn('flex min-w-0 items-center gap-2 text-sm', !ok && 'text-muted-foreground')}>
              <input type="checkbox" checked={on} disabled={!ok || (!on && kept.length >= MAX_METRICS)} onChange={(e) => setMetrics((l) => toggle(l, id, e.target.checked) as MetricId[])} className="size-4 accent-[var(--primary)]" />
              <span className="truncate">{tm(id)}</span>
            </label>
          );
        })}
        <p className="text-xs text-muted-foreground">{t('accountTotalsHint')}</p>
      </fieldset>
      <FormField id="x-chart" label={t('chartMetric')}>
        {(p) => (
          <select {...p} name="chart" defaultValue={s.chart} key={kept.join()} className={SELECT}>
            {kept.map((id) => (
              <option key={id} value={id}>
                {tm(id)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <fieldset className="grid min-w-0 gap-1">
        <legend className="mb-1 text-sm font-medium">{t('accounts')}</legend>
        <div className="grid max-h-48 gap-1 overflow-y-auto pr-1">
          {data.live.map((a) => (
            <label key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
              <input type="checkbox" checked={accounts.includes(a.id)} onChange={(e) => setAccounts((l) => toggle(l, a.id, e.target.checked))} className="size-4 accent-[var(--primary)]" />
              <span className="truncate">@{a.username}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{accounts.length ? t('accountsPicked', { count: accounts.length }) : t('allAccounts')}</p>
      </fieldset>
      {data.groups.length ? (
        <FormField id="x-grp" label={t('group')}>
          {(p) => (
            <select {...p} name="grp" defaultValue={s.group ?? ''} className={SELECT}>
              <option value="">{t('anyGroup')}</option>
              {data.groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}
      <FormField id="x-fmt" label={t('format')}>
        {(p) => (
          <select {...p} name="fmt" defaultValue={s.format ?? ''} className={SELECT}>
            <option value="">{t('anyFormat')}</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {ta(`format.${f}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField id="x-tag" label={t('tag')}>
        {(p) => (
          <select {...p} name="tag" defaultValue={s.tag ?? ''} className={SELECT}>
            <option value="">{t('anyTag')}</option>
            <option value="untagged">{t('untagged')}</option>
            {data.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-2">
        <FormField id="x-wd" label={t('weekday')}>
          {(p) => (
            <select {...p} name="wd" defaultValue={s.weekday ?? ''} className={SELECT}>
              <option value="">{t('any')}</option>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {ta(`weekday.${d}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="x-hr" label={t('hour')}>
          {(p) => (
            <select {...p} name="hr" defaultValue={s.hour ?? ''} className={SELECT}>
              <option value="">{t('any')}</option>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {formatHour(h, prefs)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <div className="flex gap-2">
        <Button type="submit">{t('apply')}</Button>
        <Button asChild variant="ghost">
          <Link href={explorerHref(withState(s, { metrics: [], accounts: [], group: null, format: null, tag: null, weekday: null, hour: null, item: null, by: 'account' }), data.scope.query)}>{t('reset')}</Link>
        </Button>
      </div>
    </Form>
  );
}

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
  const chips: { key: string; name: string; patch: Partial<ExplorerState> }[] = [
    ...(s.tag !== null ? [{ key: 'tag', name: rowLabel('tag', s.tag, ctx, (k, v) => tAll(k as never, v as never), prefs), patch: { tag: null } }] : []),
    ...(s.weekday !== null ? [{ key: 'wd', name: rowLabel('weekday', String(s.weekday), ctx, (k, v) => tAll(k as never, v as never), prefs), patch: { weekday: null } }] : []),
    ...(s.hour !== null ? [{ key: 'hr', name: formatHour(s.hour, prefs), patch: { hour: null } }] : []),
  ];
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      {chips.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <li key={c.key}>
              <Link href={explorerHref(withState(s, c.patch), data.scope.query)} aria-label={t('removeFilter', { name: c.name })} className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs hover:bg-hover">
                {c.name}
                <X aria-hidden="true" className="size-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
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
        size="sm"
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
      <TimeScopeBar scope={data.scope} today={today} keep={Object.fromEntries(explorerParams(s))} />
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
        <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="grid min-w-0 content-start gap-[var(--gp)] lg:sticky lg:top-[calc(50px+var(--pg))] lg:max-h-[calc(100dvh-50px-2*var(--pg))] lg:overflow-y-auto">
            <Card className="min-w-0">
              <CardContent>
                <Controls key={query} data={data} />
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardContent>
                <SavedViews views={views} query={query} save={save} rename={rename} remove={remove} />
              </CardContent>
            </Card>
          </aside>
          <div className="min-w-0">
            <p className="mb-2 text-xs text-muted-foreground">
              {t('window', { from: formatDay(data.window.current.from, prefs), to: formatDay(data.window.current.to, prefs) })}
              {data.window.compare && s.by !== 'post' ? ` · ${t('windowCompare', { from: formatDay(data.window.compare.from, prefs), to: formatDay(data.window.compare.to, prefs) })}` : null}
            </p>
            {s.item !== null ? (
              <ItemPanel detail={data.item} username={item?.username ?? '?'} tabHref={`/accounts/${data.item?.item.accountId ?? ''}?${new URLSearchParams({ tab: data.item?.item.mediaType === 'STORY' ? 'stories' : 'posts', ...data.scope.params })}`} />
            ) : (
              <Results data={data} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
