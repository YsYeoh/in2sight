'use client';

import { ExternalLink, Film } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { StoryView } from '@/lib/dashboard/content';
import { formatCompact, formatDateTime, formatNumber, formatPercent } from '@/lib/format';

/** `truncated`: the range holds more Stories than are read (STORY_LIMIT); said out loud, never silent. */
export function StoriesTab({ stories, truncated = false }: { stories: StoryView[]; truncated?: boolean }) {
  const t = useTranslations('pages.account.stories');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();

  if (stories.length === 0) return <EmptyState icon={<Film className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />;

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="text-xs text-muted-foreground">{t('summary', { count: formatNumber(stories.length, prefs) })}</p>
      {truncated ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('truncated', { count: formatNumber(stories.length, prefs) })}
        </p>
      ) : null}
      <ul className="grid gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-3">
        {stories.map((s) => {
          const f = s.final;
          const metrics = [
            [tm('views'), formatCompact(f?.views ?? null, prefs)],
            [tm('reach'), formatCompact(f?.reach ?? null, prefs)],
            [t('replies'), formatNumber(f?.replies ?? null, prefs)],
            [t('shares'), formatNumber(f?.shares ?? null, prefs)],
            [t('exitRate'), formatPercent(s.exitRate, prefs)],
            [t('tapsForward'), formatNumber(f?.tapsForward ?? null, prefs)],
          ] as const;
          return (
            <li key={s.id} className="min-w-0">
              <Card className="h-full min-w-0">
                <CardContent className="grid min-w-0 gap-2">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{formatDateTime(s.postedAt, prefs)}</span>
                    <Badge variant={s.live ? 'default' : 'secondary'}>{s.live ? t('live') : t('expired')}</Badge>
                  </div>
                  {s.reason ? (
                    <p className="text-xs text-muted-foreground">{ta(`reasons.${s.reason}`)}</p>
                  ) : (
                    <>
                      <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                        {metrics.map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="truncate text-muted-foreground">{label}</dt>
                            <dd className="truncate font-medium tabular-nums">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <Sparkline data={s.progression} className="text-chart-2" />
                    </>
                  )}
                  <div className="mt-auto flex min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate">{s.live ? t('liveHint', { count: s.snapshots }) : t('finalHint', { count: s.snapshots })}</span>
                    {s.permalink ? (
                      <a href={s.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open', { time: formatDateTime(s.postedAt, prefs) })} className="shrink-0 hover:text-foreground">
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
