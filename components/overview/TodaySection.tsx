'use client';

// "Today" on the Overview (Plan 17b, SPEC §7m; creator-toolkit design §0b): the latest settled day vs normal, what needs
// attention, what works now, what is next. Wiring and words only: the model is lib/dashboard/today.ts.
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FindingsList, type DismissAction } from '@/components/shared/FindingsList';
import { NavLink } from '@/components/shared/NavLink';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { Finding } from '@/lib/analysis/insights';
import type { TodayModel } from '@/lib/dashboard/today';
import { formatDate, formatDay, formatNumber, formatSigned } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

export function TodaySection({ model, dismiss }: { model: TodayModel; dismiss?: DismissAction }) {
  const t = useTranslations('insights.today');
  const ti = useTranslations('insights');
  const ta = useTranslations('analysis');
  const tg = useTranslations('pages.account.growth');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const whole = (v: number | null) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const fmt = (id: string, v: number | null) => (id === 'followers' ? formatSigned(v, prefs) : whole(v));
  const findings = model.attention.flatMap((a) => (a.kind === 'finding' ? [a.finding] : []));
  const names = new Map(model.attention.flatMap((a) => (a.kind === 'finding' ? [[a.finding.key, a.username] as const] : [])));
  const problems = model.attention.flatMap((a) => (a.kind === 'problem' ? [a] : []));
  const block = 'grid min-w-0 content-start gap-2';
  const h3 = 'text-sm font-medium';

  return (
    <Card className="mb-[var(--gp)] min-w-0">
      <CardHeader>
        <CardTitle className="text-[length:var(--fh)] font-medium">
          <h2>{t('title')}</h2>
        </CardTitle>
        <CardDescription className="text-xs">{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-[var(--gp)] md:grid-cols-2">
        <section aria-label={t('dayTitle')} className={block}>
          <h3 className={h3}>{t('dayTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('dayHint')}</p>
          {model.accounts.map((a) => (
            <div key={a.id} className="min-w-0">
              <p className="truncate text-sm font-medium">{t('dayLine', { username: a.username, date: formatDay(a.day, prefs) })}</p>
              <ul className="grid gap-0.5 text-sm">
                {a.metrics.map((m) => (
                  <li key={m.id} className="flex min-w-0 flex-wrap items-center gap-x-2">
                    <span>{t('metricLine', { metric: ti(`metric.${m.id}`), value: fmt(m.id, m.value) })}</span>
                    <span className="text-xs text-muted-foreground">{m.typical === null ? t('noTypical', { n: m.n }) : t('typical', { typical: fmt(m.id, m.typical), n: m.n })}</span>
                    {m.unusual ? <Badge variant="secondary">{t('unusual')}</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section aria-label={t('attentionTitle')} className={block}>
          <h3 className={h3}>{t('attentionTitle')}</h3>
          {problems.length === 0 && findings.length === 0 ? <p className="text-sm text-muted-foreground">{t('attentionEmpty')}</p> : null}
          {problems.length ? (
            <ul className="grid gap-1 text-sm">
              {problems.map((p) => (
                <li key={`${p.problem}:${p.accountId}`} className="border-l-2 border-l-destructive pl-3">
                  <Link href="/accounts" className="underline-offset-4 hover:underline">
                    {p.problem === 'needs_reconnect' ? t('needsReconnect', { username: p.username }) : t('syncError', { username: p.username, error: p.errorKey && tErr.has(p.errorKey) ? tErr(p.errorKey) : tErr('unexpected') })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {findings.length ? <FindingsList items={findings} canDismiss={model.canDismiss} dismiss={dismiss} label={(f: Finding) => `@${names.get(f.key) ?? ''}`} /> : null}
        </section>

        <section aria-label={t('workingTitle')} className={block}>
          <h3 className={h3}>{t('workingTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('workingHint')}</p>
          <ul className="grid gap-1 text-sm">
            {model.accounts.map((a) =>
              a.top ? (
                <li key={a.id} className="min-w-0 break-words">
                  <NavLink href={postLabHref(a.id, a.top.id)} className="underline-offset-4 hover:underline">
                    {t('top', { username: a.username, format: ta(`format.${a.top.mediaType}`), date: formatDate(a.top.postedAt, prefs), reach: whole(a.top.reach) })}
                  </NavLink>{' '}
                  <span className="text-xs text-muted-foreground">
                    {a.top.typical ? t('topVs', { ratio: formatNumber(a.top.reach / a.top.typical, prefs, { maximumFractionDigits: 1 }), format: ta(`format.${a.top.mediaType}`), n: a.top.n }) : t('topNoTypical')}
                  </span>
                </li>
              ) : (
                <li key={a.id} className="text-muted-foreground">
                  {t('noTop', { username: a.username })}
                </li>
              ),
            )}
          </ul>
        </section>

        <section aria-label={t('nextTitle')} className={block}>
          <h3 className={h3}>{t('nextTitle')}</h3>
          <ul className="grid gap-1 text-sm">
            {model.accounts.map((a) => (
              <li key={a.id} className="min-w-0 break-words">
                {a.slot
                  ? t('slot', { username: a.username, weekday: tg(`weekday.${a.slot.weekday}`), daypart: ti(`daypart.${a.slot.daypart}`), date: formatDay(a.slot.day, prefs), n: a.slot.n, confidence: ti(`confidence.${a.slot.confidence}`) })
                  : t('noSlot', { username: a.username })}{' '}
                <span className="text-xs text-muted-foreground">{a.lastPostDays === null ? t('noPost') : t('lastPost', { days: a.lastPostDays })}</span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-muted-foreground md:col-span-2">{t('proof')}</p>
      </CardContent>
    </Card>
  );
}
