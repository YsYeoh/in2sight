'use client';

// Grid of whole weeks on md+, agenda list on phones (CSS breakpoints only: both are rendered, never matchMedia). The days
// are the Time Scope's (a month picker gives the classic month view); the arrows step one period of the same kind.
// Covers: every item of the day list / agenda; inside grid cells only for a month-sized grid (COVER_WEEKS), so a 1y or
// "all" grid adds no images or DOM per cell.
import { useState } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { PageHeader } from '@/components/shared/PageHeader';
import { RangeBar, useScopeText } from '@/components/shared/RangeBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { weekdayOf } from '@/lib/analysis/best-time';
import type { CalendarDay, CalendarModel } from '@/lib/dashboard/calendar';
import { formatDay, formatNumber, formatTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { scopeHref, stepScope, type ResolvedScope } from '@/lib/time-scope/scope';
import { cn } from '@/lib/utils';

/** Grids up to this many weeks (a month view) show up to 3 covers per day cell. */
export const COVER_WEEKS = 6;

interface CalendarAccount {
  id: string;
  username: string;
}

/** Each item's name links to its Post Lab (with the page's scope `query`). */
function DayItems({ day, accounts, showAccount, query }: { day: CalendarDay; accounts: CalendarAccount[]; showAccount: boolean; query: string }) {
  const t = useTranslations('pages.calendar');
  const ta = useTranslations('analysis');
  const tl = useTranslations('postLab');
  const { prefs } = usePrefs();
  if (day.items.length === 0) return <p className="text-sm text-muted-foreground">{t('nothing')}</p>;
  const name = (i: CalendarDay['items'][number]) => `${ta(`format.${i.mediaType}`)}${showAccount ? ` · @${accounts.find((a) => a.id === i.accountId)?.username ?? '?'}` : ''}`;
  return (
    <ul className="grid gap-2 text-sm">
      {day.items.map((i) => (
        <li key={i.id} className="flex min-w-0 items-start gap-2">
          {/* decorative here: the text next to it names the item */}
          <span aria-hidden="true" className="w-10 shrink-0">
            <MediaThumb media={i} className="aspect-square" badges={false} />
          </span>
          <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(i.postedAt, prefs)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link
                href={postLabHref(i.accountId, i.id, query)}
                aria-label={tl('openFor', { post: `${name(i)} · ${formatTime(i.postedAt, prefs)}` })}
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {name(i)}
              </Link>
              {i.permalink ? (
                <a href={i.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open')} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              ) : null}
            </span>
            {i.caption ? (
              <span className="block truncate text-xs text-muted-foreground" dir="auto">
                {i.caption}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CalendarView({ model, scope, today, accounts, account, truncated }: { model: CalendarModel; scope: ResolvedScope; today: string; accounts: CalendarAccount[]; account: string | null; truncated: boolean }) {
  const t = useTranslations('pages.calendar');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const ts = useTranslations('timeScope');
  const { label: rangeLabel } = useScopeText(scope);
  const days = model.weeks.flat();
  const inRange = days.filter((d) => d.inRange);
  const [selected, setSelected] = useState(() => (inRange.find((d) => d.isToday) ?? inRange.find((d) => d.items.length) ?? inRange[0]).day);
  const current = days.find((d) => d.day === selected);
  const keep: Record<string, string> = account ? { account } : {};
  const prev = stepScope(scope, -1, today);
  const next = stepScope(scope, 1, today); // null: it would start after today
  const label = (d: CalendarDay) => t('dayLabel', { date: formatDay(d.day, prefs), posts: d.posts, stories: d.stories });
  const covers = model.weeks.length <= COVER_WEEKS;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={account ? `@${accounts.find((a) => a.id === account)?.username ?? ''}` : t('allAccounts')}
        actions={
          <Form action="" onSubmit={(e) => startProgress(formHref(e.currentTarget))} className="flex items-center gap-2">
            {Object.entries(scope.params).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('account')}
              <select name="account" defaultValue={account ?? ''} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-[var(--ctl)] max-w-48 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                <option value="">{t('allAccounts')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username}
                  </option>
                ))}
              </select>
            </label>
            <noscript>
              <Button type="submit" variant="outline">
                {t('show')}
              </Button>
            </noscript>
          </Form>
        }
      />

      <RangeBar scope={scope} today={today} keep={keep} />

      <div className="mb-[var(--gp)] flex items-center justify-between gap-2">
        {prev ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={scopeHref(prev, keep)}>
              <ChevronLeft aria-hidden="true" />
              <span className="max-sm:sr-only">{ts('previous')}</span>
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <h2 className="min-w-0 truncate text-[length:var(--fh)] font-medium" aria-live="polite">
          {rangeLabel}
        </h2>
        {next ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={scopeHref(next, keep)}>
              <span className="max-sm:sr-only">{ts('next')}</span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled>
            <span className="max-sm:sr-only">{ts('next')}</span>
            <ChevronRight aria-hidden="true" />
          </Button>
        )}
      </div>

      {truncated ? (
        <p role="status" className="mb-[var(--gp)] text-sm text-muted-foreground">
          {t('truncated')}
        </p>
      ) : null}

      {/* md+: month grid; tapping a day shows its list below */}
      <div className="hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-1">
          <caption className="sr-only">{rangeLabel}</caption>
          <thead>
            <tr>
              {model.weeks[0].map((d) => (
                <th key={d.day} scope="col" className="text-xs font-normal text-muted-foreground">
                  {ta(`weekday.${weekdayOf(d.day)}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.weeks.map((w) => (
              <tr key={w[0].day}>
                {w.map((d) => (
                  <td key={d.day} className="p-0 align-top">
                    <button
                      type="button"
                      aria-label={label(d)}
                      aria-pressed={d.day === selected}
                      onClick={() => setSelected(d.day)}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-md border bg-card p-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                        covers ? 'h-28' : 'h-20',
                        !d.inRange && 'opacity-40',
                        d.day === selected && 'border-primary',
                      )}
                    >
                      <span className={cn('text-xs tabular-nums', d.isToday && 'font-semibold text-primary')}>{formatNumber(Number(d.day.slice(8)), prefs)}</span>
                      {d.posts ? <span className="truncate rounded-sm bg-chart-1/15 px-1 text-[10px] text-foreground">{t('posts', { count: d.posts })}</span> : null}
                      {d.stories ? <span className="truncate rounded-sm bg-chart-2/15 px-1 text-[10px] text-foreground">{t('stories', { count: d.stories })}</span> : null}
                      {covers && d.items.length ? (
                        <span className="mt-auto flex gap-0.5">
                          {d.items.slice(0, 3).map((i) => (
                            <MediaThumb key={i.id} media={i} className="aspect-square w-1/3 max-w-10 rounded-sm" badges={false} />
                          ))}
                        </span>
                      ) : null}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {current ? (
          <Card className="mt-[var(--gp)]">
            <CardContent className="grid gap-2">
              <h3 className="font-medium">{formatDay(current.day, prefs)}</h3>
              <DayItems day={current} accounts={accounts} showAccount={!account} query={scope.query} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* phones: agenda of the days that have something */}
      <div className="grid gap-[var(--gp)] md:hidden">
        {inRange.some((d) => d.items.length) ? (
          inRange
            .filter((d) => d.items.length)
            .map((d) => (
              <section key={d.day} aria-label={label(d)} className="rounded-lg border bg-card p-[var(--pc)]">
                <h3 className={cn('mb-2 text-sm font-medium', d.isToday && 'text-primary')}>{formatDay(d.day, prefs)}</h3>
                <DayItems day={d} accounts={accounts} showAccount={!account} query={scope.query} />
              </section>
            ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('emptyMonth')}</p>
        )}
      </div>
    </>
  );
}
