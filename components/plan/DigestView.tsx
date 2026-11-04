'use client';

// The weekly / monthly digest (Plan 17d): one calendar week or month per account and for all accounts, compared with the
// one before (the Overview's numbers and comparison rules), the best and weakest feed posts by reach, and each account's
// goals now. Week / Month and Previous / Next are links (the URL is the state); no range bar (the period IS the range).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, CircleUserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GoalLine } from '@/components/plan/GoalLine';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { startProgress } from '@/components/shared/NavigationProgress';
import { Segmented } from '@/components/shared/Segmented';
import { StatCard } from '@/components/shared/StatCard';
import { useScopeText } from '@/components/shared/RangeBar';
import { useKpiDelta } from '@/components/shared/useKpiDelta';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { formatDay, formatMonth, formatNumber } from '@/lib/format';
import { formatMetric } from '@/lib/metrics';
import { digestHref, lastComplete, TOP_POSTS, type DigestModel, type DigestPost, type PeriodKind } from '@/lib/plan/model';
import { planHref } from '@/lib/plan/sections';
import { localDay } from '@/lib/sync/time';

const KPIS: KpiId[] = ['followers', 'netFollows', 'reach', 'views', 'engagementRate', 'posts'];

function Kpis({ kpis, vs }: { kpis: Record<KpiId, Kpi>; vs: string }) {
  const tm = useTranslations('metrics');
  const tR = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const delta = useKpiDelta();
  return (
    <div className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3 xl:grid-cols-6">
      {KPIS.map((id) => (
        <StatCard key={id} label={tm(id)} value={formatMetric(id, kpis[id].value, prefs, { full: id === 'followers' })} delta={delta(id, kpis[id])} comparison={vs} note={kpis[id].reason ? tR(kpis[id].reason) : undefined} />
      ))}
    </div>
  );
}

function Posts({ title, posts, accountId }: { title: string; posts: DigestPost[]; accountId: string }) {
  const t = useTranslations('plan.digest');
  const tf = useTranslations('analysis.format');
  const { prefs } = usePrefs();
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-sm font-medium">{title}</h4>
      <ol className="grid gap-1 text-sm">
        {posts.map((p) => {
          const date = formatDay(localDay(new Date(p.postedAt), prefs.timezone), prefs);
          return (
            <li key={p.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <Link href={`/accounts/${accountId}/media/${encodeURIComponent(p.id)}`} aria-label={t('openPostLab', { format: tf(p.mediaType), date })} className="min-w-0 truncate underline-offset-4 hover:underline">
                {tf(p.mediaType)} · {date}
              </Link>
              <span className="tabular-nums text-muted-foreground">{t('reach', { value: formatNumber(p.reach, prefs) })}</span>
              {p.young ? <span className="text-xs text-muted-foreground">({t('young')})</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DigestView({ model, today, goalsReady }: { model: DigestModel; today: string; goalsReady: boolean }) {
  const t = useTranslations('plan.digest');
  const { prefs } = usePrefs();
  const router = useRouter();
  const { vs } = useScopeText(model.overview.scope);
  const { period, overview } = model;
  const label = period.kind === 'month' ? formatMonth(period.range.from.slice(0, 7), prefs) : t('range', { from: formatDay(period.range.from, prefs), to: formatDay(period.range.to, prefs) });
  const pick = (kind: PeriodKind) => {
    const href = digestHref(kind, lastComplete(kind, today, prefs.weekStart));
    startProgress(href);
    router.push(href);
  };

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segmented label={t('period')} value={period.kind} options={[{ value: 'week', label: t('week') }, { value: 'month', label: t('month') }]} onChange={pick} />
        <Button asChild variant="outline">
          <Link href={period.prev}>
            <ChevronLeft aria-hidden="true" />
            {t('previous')}
          </Link>
        </Button>
        {period.next ? (
          <Button asChild variant="outline">
            <Link href={period.next}>
              {t('next')}
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t('next')}
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="min-w-0">
        <h2 className="text-[length:var(--fh)] font-semibold">{label}</h2>
        <p className="text-xs text-muted-foreground">{t('source')}</p>
        {period.running ? <p className="text-xs text-muted-foreground">{t('running')}</p> : null}
      </div>

      {overview.sections.length === 0 ? (
        <EmptyState icon={<CircleUserRound className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          {overview.totals && overview.sections.flatMap((s) => s.cards).length > 1 ? (
            <section aria-labelledby="digest-all" className="grid gap-2">
              <h3 id="digest-all" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('allAccounts')}
              </h3>
              <Kpis kpis={overview.totals} vs={vs} />
            </section>
          ) : null}
          {overview.sections.map((s) => (
            <section key={s.group ?? '\u0000isolated'} className="grid gap-[var(--gp)]">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.group ?? t('isolated')}</h3>
              {s.cards.map((c) => {
                const a = model.accounts[c.id];
                return (
                  <Card key={c.id} className="min-w-0">
                    <CardHeader>
                      <CardTitle>
                        <Link href={`/accounts/${c.id}${overview.scope.query ? `?${overview.scope.query}` : ''}`} className="underline-offset-4 hover:underline">
                          @{c.username}
                        </Link>
                      </CardTitle>
                      <CardDescription>{t('postsSource', { n: a?.measured ?? 0 })}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid min-w-0 gap-[var(--gp)]">
                      <Kpis kpis={c.kpis} vs={vs} />
                      {a && a.top.length ? (
                        <div className="grid gap-[var(--gp)] md:grid-cols-2">
                          <Posts title={t('topTitle')} posts={a.top} accountId={c.id} />
                          {a.bottom.length ? <Posts title={t('bottomTitle')} posts={a.bottom} accountId={c.id} /> : <p className="text-xs text-muted-foreground">{t('bottomFew', { n: 2 * TOP_POSTS + 1 })}</p>}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{t('noPosts')}</p>
                      )}
                      {goalsReady ? (
                        <div className="grid gap-1">
                          <h4 className="text-sm font-medium">{t('goalsTitle')}</h4>
                          {a && a.goals.length ? (
                            <ul className="grid gap-2">
                              {a.goals.map((p) => (
                                <GoalLine key={p.metric} p={p} />
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {t('noGoals')}{' '}
                              <Link href={planHref('goals')} className="font-medium text-primary underline-offset-4 hover:underline">
                                {t('setGoals')}
                              </Link>
                            </p>
                          )}
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
