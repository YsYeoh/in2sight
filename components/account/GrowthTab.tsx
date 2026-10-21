'use client';

// The Growth tab (Plan 15a): how followers move and why. KPIs, followers + projection, follow flow, loyalty vs discovery,
// audience then-vs-now and the "Why did this change?" panel. The picked day is URL state (?day=…&why=…), written with
// history.replaceState (never router.push/replace: no server render, no history entry per click); the pick also lives in
// local state, so a link reopens the same explanation.
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { WhyPanel } from '@/components/account/WhyPanel';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { useBucketFormat, useScopeText } from '@/components/shared/RangeBar';
import { StatCard } from '@/components/shared/StatCard';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import type { WhyMetric } from '@/lib/analysis/why';
import { formatCompact, formatCountry, formatDay, formatDelta, formatHour, formatNumber, formatPercent, formatSigned } from '@/lib/format';
import {
  GROWTH_KPIS,
  GROWTH_KPI_IDS,
  parseWhyParams,
  whyHref,
  type AudienceDim,
  type FlowDay,
  type GrowthModel,
} from '@/lib/dashboard/growth';

const DIMS: AudienceDim[] = ['age', 'gender', 'country', 'city'];
const SPARK_TONE = { good: 'text-success', bad: 'text-destructive', neutral: 'text-chart-1' } as const;
const PAGE = 30; // rows of a "Show the numbers" table before "Show more"

export function GrowthTab({ model }: { model: GrowthModel }) {
  const t = useTranslations('pages.account.growth');
  const ta = useTranslations('analysis');
  const to = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  const { vs } = useScopeText(model.scope);
  const fmtFollowers = useBucketFormat(model.scope.gran, model.followers.partial);
  const fmtFlow = useBucketFormat(model.scope.gran, model.flow.partial); // the flow and loyalty buckets are the same days
  const search = useSearchParams();
  const [pick, setPick] = useState(() => parseWhyParams(new URLSearchParams(search?.toString() ?? ''), model.scope.range));
  const { range } = model.scope;
  // a range change must not keep explaining a day that is no longer in it
  const shown = pick.day !== null && pick.day >= range.from && pick.day <= range.to ? pick : { day: null, metric: pick.metric };

  const onPick = (day: string, metric: WhyMetric) => {
    setPick({ day, metric });
    window.history.replaceState(null, '', whyHref(new URLSearchParams(window.location.search), day, metric));
  };

  const daily = model.scope.gran === 'day';
  const fmtY = (n: number) => formatCompact(n, prefs);
  const whole = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  const activityText = (a: { posts: number; stories: number | null }) => (a.stories === null ? t('activityStoriesUnknown', { posts: a.posts }) : t('activity', { posts: a.posts, stories: a.stories }));
  const withActivity = (day: string) => {
    const a = model.activity[day];
    return a ? `${fmtFlow(day)} · ${activityText(a)}` : fmtFlow(day);
  };
  const hourLabel = (at: string) => `${formatDay(at.slice(0, 10), prefs)} ${formatHour(Number(at.slice(11, 13)), prefs)}`;
  const dayList = (title: string, days: FlowDay[]) => (
    <div className="min-w-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noDays')}</p>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm">
          {days.map((d) => (
            <li key={d.day}>{t('dayLine', { day: formatDay(d.day, prefs), net: formatSigned(d.net, prefs), activity: activityText({ posts: d.posts, stories: d.stories }) })}</li>
          ))}
        </ul>
      )}
    </div>
  );

  const { followers, projection, flow, loyalty } = model;
  const followerRows = followers.hourly ? followers.hourly.map((r) => ({ key: r.at, label: hourLabel(r.at), value: r.followers })) : followers.rows.map((r) => ({ key: r.day, label: fmtFollowers(r.day), value: r.followers }));
  const churn = model.kpis.churnRate.value;
  const hasLoyalty = loyalty.rows.some((r) => r.follower !== null || r.nonFollower !== null);
  const derivedOnly = flow.source === 'derived';
  const productName = (type: string) => (t.has(`product.${type}`) ? t(`product.${type}`) : type);

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <section aria-label={t('kpis')} className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3 xl:grid-cols-6">
        {GROWTH_KPI_IDS.map((id) => {
          const k = model.kpis[id];
          const def = GROWTH_KPIS[id];
          const d = delta(def, k);
          const value = def.kind === 'percent' ? formatPercent(k.value, prefs) : id === 'followers' ? whole(k.value) : formatCompact(k.value, prefs);
          return (
            <StatCard
              key={id}
              label={t(`kpi.${id}`)}
              value={value}
              delta={d}
              comparison={vs}
              note={k.reason ? ta(`reasons.${k.reason}`) : undefined}
              spark={<Sparkline data={model.sparks[id]} className={SPARK_TONE[d?.tone ?? 'neutral']} />}
            />
          );
        })}
      </section>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard
          title={t('followersTitle')}
          subtitle={followers.hourly ? `${t('followersSource')} ${t('followersHourly')}` : t('followersSource')}
          tableLabel={t('table')}
          table={
            <DataTable
              rows={followerRows}
              rowKey={(r) => r.key}
              caption={t('followersTitle')}
              pageSize={PAGE}
              columns={[
                { key: 'when', header: t('key'), cell: (r) => r.label },
                { key: 'value', header: t('kpi.followers'), cell: (r) => whole(r.value), align: 'right' },
              ]}
            />
          }
        >
          {followers.hourly ? (
            <SeriesChart kind="area" data={followers.hourly} xKey="at" series={[{ key: 'followers', label: t('kpi.followers') }]} title={t('followersTitle')} formatX={hourLabel} formatY={fmtY} />
          ) : (
            <SeriesChart kind="area" data={followers.rows} xKey="day" series={[{ key: 'followers', label: t('kpi.followers') }]} title={t('followersTitle')} formatX={fmtFollowers} formatY={fmtY} />
          )}
          <div className="mt-2 grid gap-1 text-sm">
            {followers.change ? (
              <p className="font-medium">
                {followers.change.pct === null
                  ? t('changeNoPct', { abs: formatSigned(followers.change.abs, prefs) })
                  : t('change', { abs: formatSigned(followers.change.abs, prefs), pct: formatDelta(followers.change.pct, prefs) })}
              </p>
            ) : null}
            {followers.firstDay && followers.firstDay > range.from ? <p className="text-xs text-muted-foreground">{t('followersSince', { date: formatDay(followers.firstDay, prefs) })}</p> : null}
            <h3 className="mt-1 text-sm font-medium">{t('projectionTitle')}</h3>
            {'reason' in projection ? (
              <p className="text-muted-foreground">{t('projectionNone', { n: projection.n })}</p>
            ) : (
              <>
                <ul className="grid gap-0.5">
                  {projection.horizons.map((h) => (
                    <li key={h.days}>{t('projectionRow', { days: h.days, value: whole(h.value), low: whole(h.low), high: whole(h.high) })}</li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {t('projectionMethod', { n: projection.n, from: formatDay(projection.from, prefs), to: formatDay(projection.to, prefs), perDay: formatSigned(projection.perDay, prefs, 1) })}
                </p>
                <p className="text-xs text-muted-foreground">{t(`confidence.${projection.confidence}`, { n: projection.n })}</p>
              </>
            )}
          </div>
        </ChartCard>

        <ChartCard
          title={t('flowTitle')}
          subtitle={t(`flowSource.${flow.source ?? 'none'}`)}
          tableLabel={t('table')}
          table={
            <DataTable
              rows={flow.rows}
              rowKey={(r) => r.day}
              caption={t('flowTitle')}
              pageSize={PAGE}
              columns={[
                { key: 'when', header: t('key'), cell: (r) => fmtFlow(r.day) },
                { key: 'follows', header: t('follows'), cell: (r) => whole(r.follows), align: 'right' },
                { key: 'unfollows', header: t('unfollows'), cell: (r) => whole(r.unfollows), align: 'right' },
                { key: 'net', header: t('net'), cell: (r) => formatSigned(r.net, prefs), align: 'right' },
              ]}
            />
          }
        >
          <SeriesChart
            kind="bar"
            data={flow.rows}
            xKey="day"
            series={derivedOnly ? [{ key: 'net', label: t('net') }] : [{ key: 'follows', label: t('follows'), tone: 'good' }, { key: 'unfollows', label: t('unfollows'), tone: 'bad' }]}
            title={t('flowTitle')}
            formatX={fmtFlow}
            formatLabel={withActivity}
            formatY={fmtY}
            onPointClick={daily ? (i) => flow.rows[i] && onPick(flow.rows[i].day, 'net') : undefined}
          />
          <div className="mt-2 grid gap-2 text-sm">
            {churn !== null ? <p>{t('churn', { rate: formatPercent(churn, prefs) })}</p> : null}
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {dayList(t('best'), flow.best)}
              {dayList(t('worst'), flow.worst)}
            </div>
            {!daily ? <p className="text-xs text-muted-foreground">{t('dayOnly')}</p> : null}
            {model.storiesFrom ? <p className="text-xs text-muted-foreground">{t('storiesFrom', { date: formatDay(model.storiesFrom, prefs) })}</p> : null}
          </div>
        </ChartCard>
      </div>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard
          title={t('loyaltyTitle')}
          subtitle={t('loyaltySource')}
          tableLabel={t('table')}
          table={
            hasLoyalty ? (
              <DataTable
                rows={loyalty.rows}
                rowKey={(r) => r.day}
                caption={t('loyaltyTitle')}
                pageSize={PAGE}
                columns={[
                  { key: 'when', header: t('key'), cell: (r) => fmtFlow(r.day) },
                  { key: 'follower', header: t('follower'), cell: (r) => formatCompact(r.follower, prefs), align: 'right' },
                  { key: 'nonFollower', header: t('nonFollower'), cell: (r) => formatCompact(r.nonFollower, prefs), align: 'right' },
                ]}
              />
            ) : undefined
          }
        >
          {hasLoyalty ? (
            <SeriesChart
              kind="line"
              data={loyalty.rows}
              xKey="day"
              series={[{ key: 'follower', label: t('follower') }, { key: 'nonFollower', label: t('nonFollower') }]}
              title={t('loyaltyTitle')}
              formatX={fmtFlow}
              formatLabel={withActivity}
              formatY={fmtY}
              onPointClick={daily ? (i) => loyalty.rows[i] && onPick(loyalty.rows[i].day, 'reach') : undefined}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('noBreakdown')}</p>
          )}
        </ChartCard>

        <ChartCard title={t('formatsTitle')}>
          <DataTable
            rows={loyalty.formats}
            rowKey={(r) => r.productType}
            caption={t('formatsTitle')}
            empty={t('noBreakdown')}
            columns={[
              { key: 'format', header: t('format'), cell: (r) => productName(r.productType), sortValue: (r) => productName(r.productType) },
              { key: 'follower', header: t('follower'), cell: (r) => formatCompact(r.follower, prefs), sortValue: (r) => r.follower, align: 'right' },
              { key: 'nonFollower', header: t('nonFollower'), cell: (r) => formatCompact(r.nonFollower, prefs), sortValue: (r) => r.nonFollower, align: 'right' },
              { key: 'share', header: t('share'), cell: (r) => formatPercent(r.share, prefs), sortValue: (r) => r.share, align: 'right' },
              { key: 'change', header: t('shareChange'), cell: (r) => (r.change === null ? '—' : to('points', { value: formatSigned(r.change * 100, prefs, 1) })), sortValue: (r) => r.change, align: 'right' },
            ]}
          />
        </ChartCard>
      </div>

      <WhyPanel days={model.days} unusual={model.unusual} pick={shown} settled={model.settled} onPick={onPick} />

      <ChartCard title={t('audienceTitle')} subtitle={t('audienceSource')}>
        {DIMS.every((d) => model.audience[d] === null) ? (
          <p className="text-sm text-muted-foreground">{t('audienceNone')}</p>
        ) : (
          <div className="grid min-w-0 gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-4">
            {DIMS.map((dim) => {
              const c = model.audience[dim];
              const id = `growth-aud-${dim}`;
              return (
                <section key={dim} aria-labelledby={id} className="min-w-0">
                  <h3 id={id} className="text-sm font-medium">
                    {t(`audienceKind.${dim}`)}
                  </h3>
                  {c === null ? (
                    <p className="text-xs text-muted-foreground">{t('audienceNone')}</p>
                  ) : (
                    <>
                      <p className="mb-1 text-xs text-muted-foreground">
                        {c.from ? t('audienceRange', { from: formatDay(c.from, prefs), to: formatDay(c.to, prefs) }) : t('audienceSingle', { date: formatDay(c.to, prefs) })}
                      </p>
                      <table className="w-full table-fixed text-xs">
                        <caption className="sr-only">{t(`audienceKind.${dim}`)}</caption>
                        <thead>
                          <tr className="text-muted-foreground">
                            <th scope="col" className="w-2/5 text-left font-normal">
                              {t('key')}
                            </th>
                            <th scope="col" className="text-right font-normal">
                              {t('then')}
                            </th>
                            <th scope="col" className="text-right font-normal">
                              {t('now')}
                            </th>
                            <th scope="col" className="text-right font-normal">
                              {t('shareChange')}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((r) => (
                            <tr key={r.key} data-notable={r.notable ? '' : undefined} className={r.notable ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                              <th scope="row" className="max-w-0 truncate text-left font-[inherit]">
                                {r.notable ? (
                                  <>
                                    {(r.change ?? 0) > 0 ? <ArrowUpRight aria-hidden="true" className="mr-0.5 inline size-3" /> : <ArrowDownRight aria-hidden="true" className="mr-0.5 inline size-3" />}
                                    <span className="sr-only">{t('notable')}: </span>
                                  </>
                                ) : null}
                                {dim === 'country' ? formatCountry(r.key, prefs) : dim === 'gender' ? t(`gender.${r.key}`) : r.key}
                              </th>
                              <td className="text-right tabular-nums">{formatPercent(r.then, prefs)}</td>
                              <td className="text-right tabular-nums">{formatPercent(r.now, prefs)}</td>
                              <td className="text-right tabular-nums">{r.change === null ? '—' : to('points', { value: formatSigned(r.change * 100, prefs, 1) })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
