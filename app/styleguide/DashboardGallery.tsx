'use client';

// Dashboard pieces with fixed sample data, for checking every theme × mode × density at 360 / 768 / 1280
// (docs/RUNBOOK_DASHBOARDS.md). Sample values are deterministic so screenshots compare.
import { useTranslations } from 'next-intl';
import { Heatmap } from '@/components/charts/Heatmap';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { postHeatmap } from '@/lib/analysis/best-time';
import type { Post } from '@/lib/analysis/types';
import { formatCompact, formatDay, formatPercent } from '@/lib/format';
import { addDays } from '@/lib/sync/time';

const DAYS = Array.from({ length: 30 }, (_, i) => addDays('2026-09-15', i));
const wave = (i: number, base: number, amp: number, k: number) => Math.round(base + amp * Math.sin(i / 3 + k) + i * (base / 60));
const ROWS = DAYS.map((day, i) => ({ day, a: wave(i, 4200, 900, 0), b: wave(i, 2600, 700, 2), c: i % 9 === 4 ? null : wave(i, 1200, 400, 4) }));
const SERIES = [
  { key: 'a', label: '@brandx.official' },
  { key: 'b', label: '@brandx.shop' },
  { key: 'c', label: '@studio.two' },
];
const POSTS: Post[] = Array.from({ length: 80 }, (_, i) => ({
  id: `p${i}`,
  accountId: 'a',
  mediaType: 'IMAGE',
  postedAt: new Date(Date.UTC(2026, 8, 1 + (i % 7), 9 + (i % 4) * 3)).toISOString(), // 28 slots, ~3 posts each
  permalink: null,
  reach: 1000,
  views: null,
  likes: 20 + ((i * 13) % 60),
  comments: null,
  shares: null,
  saves: null,
  interactions: null,
}));

export function DashboardGallery() {
  const t = useTranslations('styleguide.gallery');
  const ta = useTranslations('analysis');
  const tm = useTranslations('metrics');
  const to = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  const heat = postHeatmap(POSTS, prefs.timezone, prefs.weekStart);
  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const fmtY = (n: number) => formatCompact(n, prefs);
  const fmtX = (d: string) => formatDay(d, prefs);

  return (
    <section className="grid gap-[var(--gp)]">
      <h2 className="text-[length:var(--fh)] font-medium">{t('stats')}</h2>
      <div className="grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        <StatCard label={tm('followers')} value="18,204" delta={{ text: '+3.1%', direction: 'up', tone: 'good' }} comparison={t('sampleComparison')} spark={<Sparkline data={ROWS.map((r) => r.a)} />} />
        <StatCard label={tm('reach')} value="241K" delta={{ text: '-18.0%', direction: 'down', tone: 'bad' }} comparison={t('sampleComparison')} spark={<Sparkline data={ROWS.map((r) => r.b)} className="text-destructive" />} />
        <StatCard label={tm('engagementRate')} value="4.8%" delta={{ text: '0.0%', direction: 'flat', tone: 'neutral' }} comparison={t('sampleComparison')} />
        <StatCard label={tm('netFollows')} value="—" comparison={t('sampleComparison')} note={ta('reasons.needs_100_followers')} />
      </div>

      <h2 className="text-[length:var(--fh)] font-medium">{t('charts')}</h2>
      <div className="grid gap-[var(--gp)] lg:grid-cols-2">
        <ChartCard title={t('lineChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="line" data={ROWS} xKey="day" series={SERIES} title={t('lineChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('areaChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="area" data={ROWS} xKey="day" series={SERIES.slice(0, 2)} title={t('areaChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('barChart')} summary={t('sampleSummary')}>
          <SeriesChart kind="bar" data={ROWS.slice(-10)} xKey="day" series={SERIES.slice(0, 2)} title={t('barChart')} formatX={fmtX} formatY={fmtY} />
        </ChartCard>
        <ChartCard title={t('heatmap')} subtitle={heat.reason ? ta(`reasons.${heat.reason}`) : undefined}>
          <Heatmap
            caption={t('heatmap')}
            columns={hours}
            lowLabel={ta('low')}
            highLabel={ta('high')}
            rows={heat.rows.map((r) => ({
              label: ta(`weekday.${r.weekday}`),
              cells: r.cells.map((c, h) => ({
                value: c.value,
                lowSample: c.lowSample,
                label: c.lowSample ? `${ta(`weekday.${r.weekday}`)} ${h}:00 · ${ta('lowSample')}` : ta('heatCell', { day: ta(`weekday.${r.weekday}`), hour: h, value: formatPercent(c.value, prefs), count: c.count }),
              })),
            }))}
          />
        </ChartCard>
      </div>

      <h2 className="text-[length:var(--fh)] font-medium">{t('dataTable')}</h2>
      <DataTable
        rows={SERIES.map((s, i) => ({ ...s, reach: ROWS.reduce((a, r) => a + ((r[s.key as 'a' | 'b' | 'c'] as number | null) ?? 0), 0), er: [0.048, 0.031, null][i] }))}
        rowKey={(r) => r.key}
        caption={t('dataTable')}
        initialSort={{ key: 'reach', dir: 'desc' }}
        columns={[
          { key: 'account', header: to('account'), cell: (r) => r.label, sortValue: (r) => r.label },
          { key: 'reach', header: tm('reach'), cell: (r) => formatCompact(r.reach, prefs), sortValue: (r) => r.reach, align: 'right' },
          { key: 'er', header: tm('engagementRate'), cell: (r) => formatPercent(r.er, prefs), sortValue: (r) => r.er, align: 'right' },
        ]}
      />
    </section>
  );
}
