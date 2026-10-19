'use client';

// The single-item level of the Explorer drill-down: latest numbers + links (the item's Post Lab, Instagram, the account's
// Posts/Stories tab), the follower curve around the post and the audience slice.
import Link from 'next/link';
import { ExternalLink, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { itemParts } from '@/lib/analysis/explorer';
import type { ItemDetail } from '@/lib/explorer/item';
import { formatCompact, formatDateTime, formatDay, formatHour, formatPercent } from '@/lib/format';
import { formatMetric, METRICS, type MetricId } from '@/lib/metrics';

const NUMBERS: MetricId[] = ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'postEngagementRate'];

/** `labHref`: the item's Post Lab (with the Explorer's scope). */
export function ItemPanel({ detail, username, tabHref, labHref }: { detail: ItemDetail | null; username: string; tabHref: string; labHref?: string }) {
  const t = useTranslations('explorer.item');
  const tl = useTranslations('postLab');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tt = useTranslations('pages.account.tab');
  const { prefs } = usePrefs();
  if (!detail) return <EmptyState title={t('notFound')} />;
  const { item, followers, audience } = detail;
  const format = ta(`format.${item.mediaType}`);
  const parts = itemParts(item);
  // reach/views of one item are its own values; the registry computes the ratio the same way as everywhere else
  const value = (id: MetricId) => (id === 'reach' ? item.reach : id === 'views' ? item.views : METRICS[id].value(parts));
  const at = (s: string) => `${formatDay(s.slice(0, 10), prefs)} ${formatHour(Number(s.slice(11, 13)), prefs)}`;
  const total = audience ? audience.follower + audience.nonFollower : 0;

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <Card className="min-w-0">
        <CardContent className="grid min-w-0 gap-3">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-medium">
                {format} · @{username}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t('posted', { time: formatDateTime(item.postedAt, prefs) })} · {detail.measuredAt ? t('measured', { time: formatDateTime(detail.measuredAt, prefs) }) : t('notMeasured')}
              </p>
              {item.caption ? (
                <p className="mt-1 line-clamp-2 text-xs break-words text-muted-foreground" dir="auto">
                  {item.caption}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {labHref ? (
                <Button asChild size="sm">
                  <Link href={labHref}>
                    <FlaskConical aria-hidden="true" />
                    {tl('open')}
                  </Link>
                </Button>
              ) : null}
              {item.permalink ? (
                <Button asChild variant="outline" size="sm">
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    {t('openInstagram')}
                  </a>
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={tabHref}>{t('openTab', { tab: tt(item.mediaType === 'STORY' ? 'stories' : 'posts') })}</Link>
              </Button>
            </div>
          </div>
          <dl aria-label={t('numbers')} className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4 xl:grid-cols-7">
            {NUMBERS.map((id) => (
              <div key={id} className="min-w-0">
                <dt className="truncate text-xs text-muted-foreground">{tm(id)}</dt>
                <dd className="truncate font-medium tabular-nums">{formatMetric(id, value(id), prefs, { full: true })}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <ChartCard title={t('followersTitle')} subtitle={t('followersHint')} summary={followers.length ? t('followersSummary', { from: at(followers[0].at), to: at(followers[followers.length - 1].at) }) : undefined}>
            {followers.length ? (
              <SeriesChart kind="line" data={followers} xKey="at" series={[{ key: 'followers', label: tm('followers') }]} title={t('followersTitle')} formatX={at} formatY={(n) => formatCompact(n, prefs)} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('followersEmpty')}</p>
            )}
          </ChartCard>
        </div>
        <ChartCard title={t('audienceTitle', { format })} subtitle={t('audienceHint', { format, username, day: formatDay(detail.day, prefs) })}>
          {audience && total > 0 ? (
            <dl className="grid gap-2 text-sm">
              {([['follower', audience.follower], ['nonFollower', audience.nonFollower]] as const).map(([k, v]) => (
                <div key={k} className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t(k)}</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCompact(v, prefs)} · {formatPercent(v / total, prefs, 0)}
                    </dd>
                  </div>
                  <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
                    <div className={k === 'follower' ? 'h-full rounded-full bg-chart-1' : 'h-full rounded-full bg-chart-2'} style={{ width: `${Math.round((v / total) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('audienceEmpty')}</p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
