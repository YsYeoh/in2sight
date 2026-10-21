'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo } from 'react';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { explainDay, type GrowthDay, type Reason, type UnusualDay, type WhyMetric } from '@/lib/analysis/why';
import { weekdayOf } from '@/lib/analysis/best-time';
import { formatCompact, formatDateTime, formatDay, formatDelta, formatHour, formatNumber, formatPercent, formatSigned } from '@/lib/format';

const DIRECTION = {
  up: { Icon: ArrowUpRight, tone: 'text-success' },
  down: { Icon: ArrowDownRight, tone: 'text-destructive' },
  flat: { Icon: Minus, tone: 'text-muted-foreground' },
} as const;

/** The unusual days of the range (the keyboard path of the chart click) and the rule-based reasons of the picked day. */
export function WhyPanel({ days, unusual, pick, onPick }: { days: GrowthDay[]; unusual: UnusualDay[]; pick: { day: string | null; metric: WhyMetric }; onPick: (day: string, metric: WhyMetric) => void }) {
  const t = useTranslations('pages.account.growth');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const titleId = useId();
  const one = (v: unknown) => formatNumber(Number(v), prefs, { maximumFractionDigits: 1 });
  const amount = (metric: WhyMetric, v: number | null) => (metric === 'net' ? formatSigned(v, prefs) : formatCompact(v, prefs));
  const w = useMemo(() => (pick.day ? explainDay(days, pick.day, pick.metric) : null), [days, pick.day, pick.metric]);

  const reasonText = (r: Reason): string => {
    const v = r.values;
    switch (r.id) {
      case 'posted': {
        const args = { format: ta(`format.${v.format as string}`), when: t(`why.when.${v.when as string}`), hour: formatHour(Number(v.hour), prefs), reach: formatCompact(v.reach as number | null, prefs) };
        return v.ratio === null ? t('why.reason.postedNoBase', args) : t('why.reason.posted', { ...args, ratio: one(v.ratio) });
      }
      case 'no_posts':
        return t('why.reason.no_posts', { every: one(v.every) });
      case 'stories': {
        const args = { reach: formatCompact(v.reach as number, prefs), typical: formatCompact(v.typical as number, prefs), change: formatDelta(v.change as number, prefs) };
        return v.stories === null ? t('why.reason.storiesNoCount', args) : t('why.reason.stories', { ...args, stories: Number(v.stories) });
      }
      case 'non_followers':
        return t('why.reason.non_followers', { share: formatPercent(v.share as number, prefs), typical: formatPercent(v.typical as number, prefs) });
      case 'time_of_day':
        return t('why.reason.time_of_day', { hour: formatHour(Number(v.hour), prefs), ratio: one(v.ratio) });
      case 'comments':
        return t('why.reason.comments', { comments: Number(v.comments), typical: one(v.typical) });
    }
  };

  const headline = (() => {
    if (!w || !pick.day) return null;
    const metric = t(`why.metric.${w.metric}`);
    const day = formatDay(w.day, prefs);
    if (w.value === null) return t('why.noValue', { metric, day });
    const value = amount(w.metric, w.value);
    return w.typical === null ? t('why.headlineNoBase', { metric, day, value }) : t('why.headline', { metric, day, value, typical: amount(w.metric, w.typical), n: w.n });
  })();

  return (
    <ChartCard title={t('why.title')} subtitle={t('why.source')}>
      <div className="grid min-w-0 gap-[var(--gp)] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <section aria-labelledby={titleId} className="min-w-0">
          <h3 id={titleId} className="text-sm font-medium">
            {t('why.unusualTitle')}
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">{t('why.unusualHint')}</p>
          {unusual.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('why.noUnusual')}</p>
          ) : (
            <ul className="grid gap-1">
              {unusual.map((u) => {
                const picked = pick.day === u.day && pick.metric === u.metric;
                const { Icon, tone } = DIRECTION[u.direction];
                return (
                  <li key={`${u.day}-${u.metric}`}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => onPick(u.day, u.metric)}
                      className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${picked ? 'bg-muted font-medium' : ''}`}
                    >
                      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} />
                      <span className="min-w-0">
                        {t('why.unusualItem', {
                          day: formatDay(u.day, prefs),
                          metric: t(`why.metric.${u.metric}`),
                          value: amount(u.metric, u.value),
                          typical: amount(u.metric, u.typical),
                          weekday: t(`weekday.${weekdayOf(u.day)}`),
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-live="polite" className="min-w-0 text-sm">
          {w && headline ? (
            <div className="grid gap-2">
              <p className="font-medium">{headline}</p>
              {w.value !== null && w.reasons.length === 0 ? <p className="text-muted-foreground">{t('why.none')}</p> : null}
              {w.reasons.length > 0 ? (
                <ul className="grid gap-2">
                  {w.reasons.map((r) => (
                    <li key={r.id} data-reason={r.id}>
                      <p>{reasonText(r)}</p>
                      <p className="text-xs text-muted-foreground">{t('why.basis', { confidence: t(`why.confidence.${r.confidence}`), n: r.n })}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
              {w.posts.length > 0 ? (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground">{t('why.posts')}</h4>
                  <ul className="mt-1 grid gap-1">
                    {w.posts.map((p) => {
                      const label = `${ta(`format.${p.mediaType}`)} · ${formatDateTime(p.postedAt, prefs)}`;
                      return (
                        <li key={p.id} className="min-w-0 truncate">
                          {p.permalink ? (
                            <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                              {label}
                            </a>
                          ) : (
                            label
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">{t('why.pick')}</p>
          )}
        </section>
      </div>
    </ChartCard>
  );
}
