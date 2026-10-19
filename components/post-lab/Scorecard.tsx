'use client';

// Post Lab scorecard and the Reels watch-time panel (same rows): each number with your median, its percentile among
// your earlier posts of the same format and the difference, or a short reason why it is missing (explained under the
// table). Plus the verdict chip with its one-line reason. Table on md+, cards on phones (DataTable).
import { Hourglass, Minus, Rocket, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { DeltaPill, type StatDelta } from '@/components/shared/StatCard';
import type { LabKind, ScoreRow, Verdict } from '@/lib/analysis/post-lab';
import { formatDelta, formatNumber, formatPercent, formatSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

/** A Post Lab number as text, by kind (durations come in milliseconds). */
export function useLabValue() {
  const t = useTranslations('postLab');
  const { prefs } = usePrefs();
  return (kind: LabKind, v: number | null): string => {
    if (v === null || kind === 'count') return formatNumber(v, prefs, { maximumFractionDigits: 0 });
    if (kind === 'percent') return formatPercent(v, prefs);
    if (kind === 'per1k') return formatNumber(v, prefs, { maximumFractionDigits: 1 });
    const s = v / 1000;
    const n = (x: number) => formatNumber(x, prefs, { maximumFractionDigits: 1 });
    return s >= 3600 ? t('duration.h', { n: n(s / 3600) }) : s >= 60 ? t('duration.min', { n: n(s / 60) }) : t('duration.s', { n: n(s) });
  };
}

function useDelta() {
  const t = useTranslations('postLab');
  const { prefs } = usePrefs();
  return (r: ScoreRow): StatDelta | null => {
    if (r.delta === null) return null;
    const points = r.kind === 'percent';
    const shown = Number((r.delta * 100).toFixed(1));
    const direction = shown > 0 ? 'up' : shown < 0 ? 'down' : 'flat';
    const tone = direction === 'flat' ? 'neutral' : (direction === 'up') !== r.lowerIsBetter ? 'good' : 'bad';
    return { text: points ? t('points', { value: formatSigned(r.delta * 100, prefs, 1) }) : formatDelta(r.delta, prefs), direction, tone };
  };
}

export function ScoreTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: ScoreRow[] }) {
  const t = useTranslations('postLab');
  const { prefs } = usePrefs();
  const value = useLabValue();
  const delta = useDelta();
  const dash = formatNumber(null, prefs); // lib/format.ts's placeholder for "no number"
  const reasons = [...new Set(rows.flatMap((r) => (r.reason ? [r.reason] : [])))];
  const few = rows.some((r) => r.value !== null && r.median === null);
  const columns: Column<ScoreRow>[] = [
    { key: 'metric', header: t('col.metric'), cell: (r) => t(`metric.${r.id}`) },
    { key: 'value', header: t('col.value'), align: 'right', cell: (r) => (r.value === null ? <span className="text-muted-foreground">{t(`reason.${r.reason ?? 'not_captured'}`)}</span> : value(r.kind, r.value)) },
    { key: 'median', header: t('col.median'), align: 'right', cell: (r) => (r.median === null ? dash : t('medianOf', { value: value(r.kind, r.median), n: r.n })) },
    { key: 'pct', header: t('col.percentile'), align: 'right', cell: (r) => (r.percentile === null ? dash : t('percentile', { n: r.percentile })) },
    {
      key: 'delta',
      header: t('col.delta'),
      align: 'right',
      cell: (r) => {
        const d = delta(r);
        return d ? <DeltaPill delta={d} /> : dash;
      },
    },
  ];
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption={title} />
      {reasons.length || few ? (
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {reasons.map((r) => (
            <li key={r}>
              <span className="font-medium">{t(`reason.${r}`)}:</span> {t(`reasonHint.${r}`)}
            </li>
          ))}
          {few ? <li>{t('fewPeers')}</li> : null}
        </ul>
      ) : null}
    </ChartCard>
  );
}

const CHIP: Record<Verdict, { icon: typeof Rocket; className: string }> = {
  breakout: { icon: Rocket, className: 'bg-success/15 text-success' },
  above: { icon: TrendingUp, className: 'bg-success/10 text-success' },
  typical: { icon: Minus, className: 'bg-muted text-muted-foreground' },
  below: { icon: TrendingDown, className: 'bg-destructive/10 text-destructive' },
  too_early: { icon: Hourglass, className: 'bg-muted text-muted-foreground' },
};

/** The verdict chip and why: from reach vs your median, or the reason there is no verdict. */
export function VerdictLine({ verdict, reach, story }: { verdict: Verdict | null; reach: ScoreRow | undefined; story: boolean }) {
  const t = useTranslations('postLab');
  const { prefs } = usePrefs();
  let why: string;
  if (verdict === null) why = reach?.reason ? t(`reasonHint.${reach.reason}`) : t('why.fewPosts', { n: reach?.n ?? 0 });
  else if (verdict === 'too_early') why = t(story ? 'why.tooEarlyStory' : 'why.tooEarly');
  else if (verdict === 'breakout') why = t('why.breakout', { ratio: formatNumber((reach?.value ?? 0) / (reach?.median || 1), prefs, { maximumFractionDigits: 1 }), n: reach?.n ?? 0 });
  else why = t('why.rank', { pct: reach?.percentile ?? 0, n: reach?.n ?? 0 });
  const chip = verdict ? CHIP[verdict] : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {chip ? (
        <span data-verdict={verdict} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium', chip.className)}>
          <chip.icon aria-hidden="true" className="size-3.5" />
          {t(`verdict.${verdict}`)}
        </span>
      ) : null}
      <p className="min-w-0 text-xs text-muted-foreground">{why}</p>
    </div>
  );
}
