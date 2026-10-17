'use client';

// The Time Scope bar (creator-toolkit spec §0b): presets are links, compare and granularity are GET-form selects, and
// the custom range / week / month / quarter pickers and custom comparison days are GET forms in a ResponsiveDialog
// (a centred dialog on desktop, a bottom sheet on phones). The URL is the only state: every choice is a navigation, so
// the top progress bar and the route skeletons work unchanged. Native date inputs and selects keep it keyboard-friendly.
import { useState, type FormEvent } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { CalendarRange } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FormField } from '@/components/shared/FormField';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogTrigger } from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDay, formatMonth } from '@/lib/format';
import { addMonths, autoGranularity, daysIn, wholeMonths, type DayRange, type Granularity } from '@/lib/time-scope/range';
import { GRANULARITIES, PRESETS, scopeHref, type ResolvedScope, type TimeScope } from '@/lib/time-scope/scope';

const SELECT = 'h-[var(--ctl-sm)] max-w-48 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground';
/** How far back the month and quarter pickers go (MAX_DAYS ≈ 5 years). */
const PICKER_MONTHS = 60;

const pick = (p: Record<string, string>, keys: string[]) => Object.fromEntries(Object.entries(p).filter(([k]) => keys.includes(k)));
const omit = (p: Record<string, string>, keys: string[]) => Object.fromEntries(Object.entries(p).filter(([k]) => !keys.includes(k)));
const COMPARE_KEYS = ['cmp', 'cfrom', 'cto'];

function Hidden({ params }: { params: Record<string, string> }) {
  return Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

/** Labels for a scope: what it covers, what it is compared with (StatCard "vs …"), and the coverage note. */
export function useScopeText(r: ResolvedScope): { label: string; vs: string; note: string | null } {
  const t = useTranslations('timeScope');
  const { prefs } = usePrefs();
  const days = (x: DayRange) => {
    const months = wholeMonths(x);
    if (months === 1) return formatMonth(x.from.slice(0, 7), prefs);
    if (months === 3 && (Number(x.from.slice(5, 7)) - 1) % 3 === 0) return t('quarterOption', { q: (Number(x.from.slice(5, 7)) + 2) / 3, year: x.from.slice(0, 4) });
    return x.from === x.to ? formatDay(x.from, prefs) : t('rangeText', { from: formatDay(x.from, prefs), to: formatDay(x.to, prefs) });
  };
  const rolling = 'last' in r.window;
  const label = r.preset ? t(`presetLong.${r.preset}`) : days(r.window as DayRange);
  const vs = !r.compare
    ? ''
    : rolling && r.scope.cmp === 'prev'
      ? t('vsPrevious', { days: daysIn(r.range) })
      : rolling && r.scope.cmp === 'yoy'
        ? t('vsLastYear')
        : t('vsRange', { range: days(r.compare) });
  const date = r.earliest ? formatDay(r.earliest, prefs) : '';
  const note = r.partial ? (r.earliest ? t('partial', { date }) : t('noData')) : r.comparePartial ? t('comparePartial', { date }) : null;
  return { label, vs, note };
}

/** Chart x-axis labels for buckets: the day (a week shows its first day) or the month; ' *' marks a partial bucket. */
export function useBucketFormat(gran: Granularity, partial: string[] = []): (day: string) => string {
  const { prefs } = usePrefs();
  return (day) => `${gran === 'month' ? formatMonth(day.slice(0, 7), prefs) : formatDay(day, prefs)}${partial.includes(day) ? ' *' : ''}`;
}

function Pickers({ scope, today, keep, done }: { scope: ResolvedScope; today: string; keep: Record<string, string>; done: () => void }) {
  const t = useTranslations('timeScope');
  const { prefs } = usePrefs();
  const go = (e: FormEvent<HTMLFormElement>) => {
    startProgress(formHref(e.currentTarget));
    done();
  };
  const thisMonth = `${today.slice(0, 7)}-01`;
  const months = Array.from({ length: PICKER_MONTHS }, (_, i) => addMonths(thisMonth, -i).slice(0, 7));
  const quarters = months.filter((m) => (Number(m.slice(5, 7)) - 1) % 3 === 0).map((m) => `${m.slice(0, 4)}-Q${(Number(m.slice(5, 7)) + 2) / 3}`);
  const fixed = typeof scope.scope.range === 'object' ? scope.scope.range : null;
  const cmp = typeof scope.scope.cmp === 'object' ? scope.scope.cmp : null;
  const carry = { ...keep, ...pick(scope.params, [...COMPARE_KEYS, 'gran']) }; // a new range keeps compare + granularity
  const row = 'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2';
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <Form action="" onSubmit={go} aria-label={t('range')} className="grid min-w-0 gap-2">
        <Hidden params={carry} />
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <FormField id="ts-from" label={t('from')}>
            {(p) => <Input {...p} type="date" name="from" required max={today} defaultValue={fixed?.from ?? scope.range.from} />}
          </FormField>
          <FormField id="ts-to" label={t('to')}>
            {(p) => <Input {...p} type="date" name="to" required max={today} defaultValue={fixed?.to ?? scope.range.to} />}
          </FormField>
        </div>
        <Button type="submit" size="sm" className="justify-self-end">
          {t('apply')}
        </Button>
      </Form>
      <Form action="" onSubmit={go} aria-label={t('week')} className={row}>
        <Hidden params={carry} />
        <FormField id="ts-week" label={t('week')} hint={t('weekDay')}>
          {(p) => <Input {...p} type="date" name="week" required max={today} defaultValue={today} />}
        </FormField>
        <Button type="submit" size="sm">
          {t('apply')}
        </Button>
      </Form>
      <Form action="" onSubmit={go} aria-label={t('month')} className={row}>
        <Hidden params={carry} />
        <FormField id="ts-month" label={t('month')}>
          {(p) => (
            <select {...p} name="month" defaultValue={months[0]} className={`${SELECT} max-w-none`}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m, prefs)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <Button type="submit" size="sm">
          {t('apply')}
        </Button>
      </Form>
      <Form action="" onSubmit={go} aria-label={t('quarter')} className={row}>
        <Hidden params={carry} />
        <FormField id="ts-quarter" label={t('quarter')}>
          {(p) => (
            <select {...p} name="quarter" defaultValue={quarters[0]} className={`${SELECT} max-w-none`}>
              {quarters.map((q) => (
                <option key={q} value={q}>
                  {t('quarterOption', { q: Number(q.slice(6)), year: q.slice(0, 4) })}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <Button type="submit" size="sm">
          {t('apply')}
        </Button>
      </Form>
      {scope.preset === 'all' ? null : (
        <Form action="" onSubmit={go} aria-label={t('compareRange')} className="grid min-w-0 gap-2 border-t pt-[var(--gp)]">
          <Hidden params={{ ...keep, ...omit(scope.params, COMPARE_KEYS) }} />
          <p className="text-sm font-medium">{t('compareRange')}</p>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <FormField id="ts-cfrom" label={t('from')}>
              {(p) => <Input {...p} type="date" name="cfrom" required max={today} defaultValue={cmp?.from ?? scope.compare?.from} />}
            </FormField>
            <FormField id="ts-cto" label={t('to')}>
              {(p) => <Input {...p} type="date" name="cto" required max={today} defaultValue={cmp?.to ?? scope.compare?.to} />}
            </FormField>
          </div>
          <Button type="submit" size="sm" className="justify-self-end">
            {t('apply')}
          </Button>
        </Form>
      )}
    </div>
  );
}

/** `keep` = the page's own URL parameters (tab, filters, account) that every scope change must carry. */
export function TimeScopeBar({ scope, today, keep = {} }: { scope: ResolvedScope; today: string; keep?: Record<string, string> }) {
  const t = useTranslations('timeScope');
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const text = useScopeText(scope);
  const s = scope.scope;
  const href = (next: TimeScope) => scopeHref(next, keep);
  const go = (e: FormEvent<HTMLFormElement>) => startProgress(formHref(e.currentTarget));
  const submitOnChange = (e: { currentTarget: HTMLSelectElement }) => e.currentTarget.form?.requestSubmit();
  return (
    <section aria-label={t('label')} className="mb-[var(--gp)] grid min-w-0 gap-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <nav aria-label={t('presets')} className="inline-flex max-w-full flex-wrap rounded-md border bg-card p-0.5">
          {PRESETS.map((p) => (
            <Button key={p} asChild size="sm" variant={p === scope.preset ? 'secondary' : 'ghost'}>
              <Link
                href={href({ ...s, range: p, cmp: p === 'all' ? 'none' : scope.preset === 'all' ? 'prev' : s.cmp })}
                aria-current={p === scope.preset ? 'page' : undefined}
                title={t(`presetLong.${p}`)}
                scroll={false}
              >
                {t(`preset.${p}`)}
              </Link>
            </Button>
          ))}
        </nav>
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogTrigger asChild>
            <Button type="button" size="sm" variant={scope.preset ? 'outline' : 'secondary'}>
              <CalendarRange aria-hidden="true" />
              {t('custom')}
            </Button>
          </ResponsiveDialogTrigger>
          <ResponsiveDialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t('customTitle')}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>{t('customHint', { tz: prefs.timezone })}</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <Pickers scope={scope} today={today} keep={keep} done={() => setOpen(false)} />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
        {/* key: a remount resets the uncontrolled selects after any navigation (presets, back button) */}
        <Form key={`cmp|${scope.query}`} action="" onSubmit={go} className="flex min-w-0 items-center">
          <Hidden params={{ ...keep, ...omit(scope.params, COMPARE_KEYS) }} />
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {t('compare')}
            <select name="cmp" defaultValue={typeof s.cmp === 'object' ? 'custom' : s.cmp} disabled={scope.preset === 'all'} onChange={submitOnChange} className={SELECT}>
              <option value="prev">{t('cmp.prev')}</option>
              <option value="yoy">{t('cmp.yoy')}</option>
              <option value="none">{t('cmp.none')}</option>
              {typeof s.cmp === 'object' ? (
                <option value="custom" disabled>
                  {t('cmp.custom')}
                </option>
              ) : null}
            </select>
          </label>
          <noscript>
            <Button type="submit" size="sm" variant="outline">
              {t('apply')}
            </Button>
          </noscript>
        </Form>
        <Form key={`gran|${scope.query}`} action="" onSubmit={go} className="flex min-w-0 items-center">
          <Hidden params={{ ...keep, ...omit(scope.params, ['gran']) }} />
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {t('gran')}
            <select name="gran" defaultValue={s.gran} onChange={submitOnChange} className={SELECT}>
              {GRANULARITIES.map((g) => (
                <option key={g} value={g}>
                  {g === 'auto' ? t('granOption.auto', { gran: t(`granOption.${autoGranularity(daysIn(scope.range))}`) }) : t(`granOption.${g}`)}
                </option>
              ))}
            </select>
          </label>
          <noscript>
            <Button type="submit" size="sm" variant="outline">
              {t('apply')}
            </Button>
          </noscript>
        </Form>
      </div>
      <p role="status" className="min-w-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{text.label}</span>
        {text.vs ? ` · ${text.vs}` : null}
        {text.note ? <span className="block">{text.note}</span> : null}
      </p>
    </section>
  );
}
