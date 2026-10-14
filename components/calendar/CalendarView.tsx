'use client';

// Month grid on md+, agenda list on phones (CSS breakpoints only: both are rendered, never matchMedia).
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { weekdayOf } from '@/lib/analysis/best-time';
import type { CalendarDay, MonthModel } from '@/lib/dashboard/calendar';
import { formatDay, formatMonth, formatNumber, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface CalendarAccount {
  id: string;
  username: string;
}

function DayItems({ day, accounts, showAccount }: { day: CalendarDay; accounts: CalendarAccount[]; showAccount: boolean }) {
  const t = useTranslations('pages.calendar');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  if (day.items.length === 0) return <p className="text-sm text-muted-foreground">{t('nothing')}</p>;
  return (
    <ul className="grid gap-2 text-sm">
      {day.items.map((i) => (
        <li key={i.id} className="flex min-w-0 items-start gap-2">
          <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(i.postedAt, prefs)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium">
                {ta(`format.${i.mediaType}`)}
                {showAccount ? ` · @${accounts.find((a) => a.id === i.accountId)?.username ?? '?'}` : ''}
              </span>
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

export function CalendarView({ model, accounts, account }: { model: MonthModel; accounts: CalendarAccount[]; account: string | null }) {
  const t = useTranslations('pages.calendar');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const days = model.weeks.flat();
  const inMonth = days.filter((d) => d.inMonth);
  const [selected, setSelected] = useState(() => (inMonth.find((d) => d.isToday) ?? inMonth.find((d) => d.items.length) ?? inMonth[0]).day);
  const current = days.find((d) => d.day === selected);
  const q = (month: string) => `?month=${month}${account ? `&account=${account}` : ''}`;
  const label = (d: CalendarDay) => t('dayLabel', { date: formatDay(d.day, prefs), posts: d.posts, stories: d.stories });

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={account ? `@${accounts.find((a) => a.id === account)?.username ?? ''}` : t('allAccounts')}
        actions={
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="month" value={model.month} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {t('account')}
              <select name="account" defaultValue={account ?? ''} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-[var(--ctl-sm)] max-w-40 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                <option value="">{t('allAccounts')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username}
                  </option>
                ))}
              </select>
            </label>
            <noscript>
              <Button type="submit" size="sm" variant="outline">
                {t('show')}
              </Button>
            </noscript>
          </form>
        }
      />

      <div className="mb-[var(--gp)] flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={q(model.prev)} aria-label={t('previous')}>
            <ChevronLeft aria-hidden="true" />
            <span className="max-sm:sr-only">{formatMonth(model.prev, prefs)}</span>
          </Link>
        </Button>
        <h2 className="text-[length:var(--fh)] font-medium" aria-live="polite">
          {formatMonth(model.month, prefs)}
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href={q(model.next)} aria-label={t('next')}>
            <span className="max-sm:sr-only">{formatMonth(model.next, prefs)}</span>
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      </div>

      {/* md+: month grid; tapping a day shows its list below */}
      <div className="hidden md:block">
        <table className="w-full table-fixed border-separate border-spacing-1">
          <caption className="sr-only">{formatMonth(model.month, prefs)}</caption>
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
                        'flex h-20 w-full flex-col gap-1 rounded-md border bg-card p-1.5 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
                        !d.inMonth && 'opacity-40',
                        d.day === selected && 'border-primary',
                      )}
                    >
                      <span className={cn('text-xs tabular-nums', d.isToday && 'font-semibold text-primary')}>{formatNumber(Number(d.day.slice(8)), prefs)}</span>
                      {d.posts ? <span className="truncate rounded-sm bg-chart-1/15 px-1 text-[10px] text-foreground">{t('posts', { count: d.posts })}</span> : null}
                      {d.stories ? <span className="truncate rounded-sm bg-chart-2/15 px-1 text-[10px] text-foreground">{t('stories', { count: d.stories })}</span> : null}
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
              <DayItems day={current} accounts={accounts} showAccount={!account} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* phones: agenda of the days that have something */}
      <div className="grid gap-[var(--gp)] md:hidden">
        {inMonth.some((d) => d.items.length) ? (
          inMonth
            .filter((d) => d.items.length)
            .map((d) => (
              <section key={d.day} aria-label={label(d)} className="rounded-lg border bg-card p-[var(--pc)]">
                <h3 className={cn('mb-2 text-sm font-medium', d.isToday && 'text-primary')}>{formatDay(d.day, prefs)}</h3>
                <DayItems day={d} accounts={accounts} showAccount={!account} />
              </section>
            ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('emptyMonth')}</p>
        )}
      </div>
    </>
  );
}
