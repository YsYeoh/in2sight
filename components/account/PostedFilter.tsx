'use client';

// The posted-date filter of the Posts and Stories tabs (ux-polish design §3, §8 call 1; docs/UI_STANDARDS.md): its own
// URL params (pr | pfrom/pto), never the Time Scope. A FilterPanel named after the current window (highlighted unless
// All time) with the quick choices as links and a custom-dates GET form whose hidden fields keep every other param.
import { useState } from 'react';
import Form from 'next/form';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FilterOptions, FilterPanel } from '@/components/shared/FilterToolbar';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LIST_PRESETS, listWindow, type ListDates } from '@/lib/dashboard/lists';
import { formatDay } from '@/lib/format';

/** The window's name: a preset ("Last 30 days"), All time, or the custom days ("1 Oct 2026 – 15 Oct 2026"). Also the chip label. */
export function usePostedName(dates: ListDates, today: string): string {
  const t = useTranslations('pages.account.lists');
  const { prefs } = usePrefs();
  if (dates.from || dates.to) {
    const w = listWindow(dates, today);
    return t('between', { from: formatDay(w.from, prefs), to: formatDay(w.to, prefs) });
  }
  return t(`presets.${dates.pr ?? 'all'}`);
}

/** `hrefFor(dates)` = the list with those dates (page 1, everything else kept); `hidden` = the other params of the list,
 *  for the custom-dates form (without pr/pfrom/pto/page). `label` / `title` = the button and panel names when the date is
 *  not a posting date (the Comments tab: "Commented: …"); default "Posted: …". */
export function PostedFilter({ id, dates, today, hrefFor, hidden, label, title }: { id: string; dates: ListDates; today: string; hrefFor: (d: ListDates) => string; hidden: Record<string, string>; label?: string; title?: string }) {
  const t = useTranslations('pages.account.lists');
  const [open, setOpen] = useState(false);
  const name = usePostedName(dates, today);
  const custom = dates.from !== null || dates.to !== null;
  const w = listWindow(dates, today);
  return (
    <FilterPanel label={label ?? t('postedWith', { range: name })} title={title ?? t('postedTitle')} active={custom || dates.pr !== null} open={open} onOpenChange={setOpen}>
      <FilterOptions
        label={t('quick')}
        options={[...LIST_PRESETS, null].map((pr) => ({ href: hrefFor({ pr, from: null, to: null }), label: t(`presets.${pr ?? 'all'}`), current: !custom && dates.pr === pr }))}
      />
      <Form
        action=""
        aria-label={t('custom')}
        onSubmit={(e) => {
          startProgress(formHref(e.currentTarget));
          setOpen(false);
        }}
        className="grid gap-2"
      >
        <p aria-hidden="true" className="text-xs text-muted-foreground">
          {t('custom')}
        </p>
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor={`${id}-from`} className="grid gap-1 text-xs text-muted-foreground">
            {t('from')}
            <Input id={`${id}-from`} type="date" name="pfrom" defaultValue={custom ? w.from : ''} max={today} />
          </label>
          <label htmlFor={`${id}-to`} className="grid gap-1 text-xs text-muted-foreground">
            {t('to')}
            <Input id={`${id}-to`} type="date" name="pto" defaultValue={custom ? w.to : ''} max={today} />
          </label>
        </div>
        <Button type="submit" variant="outline" className="justify-self-start">
          {t('show')}
        </Button>
      </Form>
    </FilterPanel>
  );
}
