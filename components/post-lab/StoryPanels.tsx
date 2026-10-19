'use client';

// Stories in the Post Lab: what viewers did (taps forward/back, exits, swipes away, as counts and shares of views, plus
// replies) and the day's Stories in order — reach compared with the day's first Story and the exit rate per frame,
// with the best and worst frame marked. Every other frame links to its own Post Lab (the scope is kept).
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { MediaThumb } from '@/components/shared/MediaThumb';
import type { Funnel, Sequence } from '@/lib/analysis/post-lab';
import { formatNumber, formatPercent, formatTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { cn } from '@/lib/utils';

export function StoryPanels({ funnel, sequence, accountId, query }: { funnel: Funnel | null; sequence: Sequence; accountId: string; query: string }) {
  const t = useTranslations('postLab.story');
  const tl = useTranslations('postLab');
  const { prefs } = usePrefs();
  const count = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  return (
    <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <ChartCard title={t('funnelTitle')} subtitle={t('funnelHint')}>
        {funnel ? (
          <dl className="grid gap-2 text-sm">
            {funnel.steps.map((s) => (
              <div key={s.id} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="min-w-0 truncate text-muted-foreground">{t(s.id)}</dt>
                  <dd className="font-medium tabular-nums">
                    {count(s.value)} · {formatPercent(s.share, prefs, 0)}
                  </dd>
                </div>
                <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, Math.round((s.share ?? 0) * 100))}%` }} />
                </div>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2 border-t pt-2">
              <dt className="text-muted-foreground">{t('replies')}</dt>
              <dd className="font-medium tabular-nums">{count(funnel.replies)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noData')}</p>
        )}
      </ChartCard>

      <ChartCard title={t('sequenceTitle')} subtitle={t('sequenceHint')}>
        <ol className="flex min-w-0 gap-3 overflow-x-auto pb-2">
          {sequence.frames.map((f) => {
            const label = t('frame', { time: formatTime(f.postedAt, prefs) });
            const body = (
              <>
                <MediaThumb media={{ id: f.id, mediaType: 'STORY', cover: f.cover }} badges={false} />
                <span className="mt-1 block truncate text-xs font-medium tabular-nums">{formatTime(f.postedAt, prefs)}</span>
                <span className="block truncate text-xs tabular-nums text-muted-foreground">{tl('reachValue', { value: count(f.reach) })}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{t('retention', { pct: formatPercent(f.retention, prefs, 0) })}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{t('exitRate', { pct: formatPercent(f.exitRate, prefs, 0) })}</span>
              </>
            );
            return (
              <li key={f.id} aria-current={f.current ? 'true' : undefined} className={cn('w-24 shrink-0 rounded-md p-1', f.current && 'ring-2 ring-ring')}>
                {f.id === sequence.best || f.id === sequence.worst ? (
                  <span className={cn('mb-1 inline-block rounded-full px-1.5 text-[10px] font-medium', f.id === sequence.best ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive')}>{t(f.id === sequence.best ? 'best' : 'worst')}</span>
                ) : null}
                {f.current ? (
                  <div>
                    <span className="sr-only">{t('current')}</span>
                    {body}
                  </div>
                ) : (
                  <Link href={postLabHref(accountId, f.id, query)} aria-label={label} className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </ChartCard>
    </div>
  );
}
