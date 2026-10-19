'use client';

// Velocity: cumulative reach and views at 1 h, 6 h, 24 h, 48 h and 7 days (Stories: 1 h, 6 h, 24 h) against the median of
// the same posts at the same age. Bars, not lines: a checkpoint without a snapshot simply has no bar (nothing is
// interpolated), and an isolated value stays visible. The table under each chart says "not yet" vs "no snapshot".
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import type { Velocity as VelocityModel, VelocityPoint } from '@/lib/analysis/post-lab';
import { formatCompact, formatNumber } from '@/lib/format';

const METRICS = ['reach', 'views'] as const;

export function Velocity({ velocity }: { velocity: VelocityModel }) {
  const t = useTranslations('postLab');
  const { prefs } = usePrefs();
  const { points, lead } = velocity;
  const label = (id: VelocityPoint['id']) => t(`checkpoint.${id}`);
  const own = (p: VelocityPoint, m: (typeof METRICS)[number]) => (m === 'reach' ? p.reach : p.views);
  const med = (p: VelocityPoint, m: (typeof METRICS)[number]) => (m === 'reach' ? p.medianReach : p.medianViews);
  const n = (p: VelocityPoint, m: (typeof METRICS)[number]) => (m === 'reach' ? p.nReach : p.nViews);
  return (
    <section aria-labelledby="velocity-title" className="grid min-w-0 gap-[var(--gp)]">
      <div className="min-w-0">
        <h2 id="velocity-title" className="font-medium">
          {t('velocity.title')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {lead ? t('velocity.lead', { at: label(lead.at), ratio: formatNumber(lead.ratio, prefs, { maximumFractionDigits: 1 }), metric: lead.metric, n: lead.n }) : t('velocity.noLead')}
        </p>
      </div>
      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
        {METRICS.map((m) => {
          const title = t(`velocity.${m}`);
          return (
            <ChartCard
              key={m}
              title={title}
              subtitle={t('velocity.hint')}
              summary={t('velocity.summary', { metric: m })}
              tableLabel={t('velocity.table')}
              table={
                <table className="w-full text-xs">
                  <caption className="sr-only">{title}</caption>
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="text-left font-medium">
                        {t('velocity.at')}
                      </th>
                      <th scope="col" className="text-right font-medium">
                        {t('velocity.thisPost')}
                      </th>
                      <th scope="col" className="text-right font-medium">
                        {t('velocity.median')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.id}>
                        <th scope="row" className="text-left font-normal">
                          {label(p.id)}
                        </th>
                        <td className="text-right tabular-nums">{own(p, m) !== null ? formatNumber(own(p, m), prefs, { maximumFractionDigits: 0 }) : t(p.due ? 'velocity.gap' : 'velocity.notYet')}</td>
                        <td className="text-right tabular-nums">{med(p, m) !== null ? t('medianOf', { value: formatNumber(med(p, m), prefs, { maximumFractionDigits: 0 }), n: n(p, m) }) : formatNumber(null, prefs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <SeriesChart
                kind="bar"
                data={points.map((p) => ({ at: p.id, post: own(p, m), median: med(p, m) }))}
                xKey="at"
                series={[
                  { key: 'post', label: t('velocity.thisPost') },
                  { key: 'median', label: t('velocity.median'), muted: true },
                ]}
                title={title}
                formatX={(id) => label(id as VelocityPoint['id'])}
                formatY={(v) => formatCompact(v, prefs)}
                height={200}
              />
            </ChartCard>
          );
        })}
      </div>
    </section>
  );
}
