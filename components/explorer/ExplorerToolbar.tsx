'use client';

// The Explorer's settings as a toolbar (docs/UI_STANDARDS.md): Break down by, Metrics, Accounts, Saved views, Advanced,
// Reset, then a chip per active filter. Every pick is a URL change that applies at once; every change leaves the
// single-item level and keeps every other part of the state.
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SavedViews, type SavedViewsProps } from '@/components/explorer/SavedViews';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FilterPanel, FilterSelect, FilterToolbar, useApply, type FilterChip } from '@/components/shared/FilterToolbar';
import { Button } from '@/components/ui/button';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { explorerHref, FORMATS, MAX_METRICS, usable, withState, type ExplorerState } from '@/lib/explorer/state';
import { formatHour } from '@/lib/format';
import { DIMENSIONS, METRIC_IDS, type DimensionId, type MetricId } from '@/lib/metrics';
import { cn } from '@/lib/utils';

/** A checkbox list that ticks at once (a local copy of the picked ids) and applies each tick; the parent re-keys it when the URL's list changes. */
function Ticks<T extends string>({ options, initial, onChange, disabled }: { options: { id: T; label: string }[]; initial: T[]; onChange: (next: T[]) => void; disabled?: (id: T, picked: T[]) => boolean }) {
  const [picked, setPicked] = useState(initial);
  return (
    <div className="grid max-h-72 gap-1 overflow-y-auto pe-1">
      {options.map((o) => {
        const on = picked.includes(o.id);
        const off = disabled?.(o.id, picked) ?? false;
        return (
          <label key={o.id} className={cn('flex min-w-0 items-center gap-2 text-sm', off && 'text-muted-foreground')}>
            <input
              type="checkbox"
              checked={on}
              disabled={off}
              onChange={(e) => {
                const next = e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id);
                setPicked(next);
                onChange(next);
              }}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="truncate">{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function ExplorerToolbar({ data, views, query, save, rename, remove }: { data: ExplorerData } & SavedViewsProps) {
  const t = useTranslations('explorer');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tAll = useTranslations();
  const { prefs } = usePrefs();
  const apply = useApply();
  const s = data.state;
  const go = (patch: Partial<ExplorerState>) => explorerHref(withState(s, { ...patch, item: null }), data.scope.query);
  const ctx = { accounts: data.live, tags: data.tags, items: data.items, gran: data.scope.gran };
  const name = (by: DimensionId, key: string) => rowLabel(by, key, ctx, (k, v) => tAll(k as never, v as never), prefs);
  const username = (id: string) => `@${data.live.find((a) => a.id === id)?.username ?? '?'}`;
  const cleared = { group: null, format: null, tag: null, weekday: null, hour: null } as const;
  const resetHref = go({ ...cleared, metrics: [], accounts: [], by: 'account' });
  const chips: FilterChip[] = [
    ...s.accounts.map((id) => ({ id: `acc-${id}`, label: username(id), href: go({ accounts: s.accounts.filter((x) => x !== id) }) })),
    ...(s.group !== null ? [{ id: 'grp', label: s.group, href: go({ group: null }) }] : []),
    ...(s.format !== null ? [{ id: 'fmt', label: ta(`format.${s.format}`), href: go({ format: null }) }] : []),
    ...(s.tag !== null ? [{ id: 'tag', label: name('tag', s.tag), href: go({ tag: null }) }] : []),
    ...(s.weekday !== null ? [{ id: 'wd', label: name('weekday', String(s.weekday)), href: go({ weekday: null }) }] : []),
    ...(s.hour !== null ? [{ id: 'hr', label: formatHour(s.hour, prefs), href: go({ hour: null }) }] : []),
  ];
  const advancedCount = [s.group, s.format, s.tag, s.weekday, s.hour].filter((v) => v !== null).length;
  const any = (label: string) => ({ value: '', label });
  const num = (v: string) => (v === '' ? null : Number(v));

  return (
    <FilterToolbar
      label={t('controls')}
      advancedCount={advancedCount}
      chips={chips}
      clearHref={go({ accounts: [], ...cleared })}
      end={
        <Button asChild variant="ghost">
          <Link href={resetHref}>{t('reset')}</Link>
        </Button>
      }
      advanced={
        <>
          <FilterSelect id="x-chart" label={t('chartMetric')} value={s.chart} options={s.metrics.map((id) => ({ value: id, label: tm(id) }))} hrefFor={(v) => go({ chart: v as MetricId })} />
          {data.groups.length ? (
            <FilterSelect id="x-grp" label={t('group')} value={s.group ?? ''} options={[any(t('anyGroup')), ...data.groups.map((g) => ({ value: g, label: g }))]} hrefFor={(v) => go({ group: v || null })} />
          ) : null}
          <FilterSelect id="x-fmt" label={t('format')} value={s.format ?? ''} options={[any(t('anyFormat')), ...FORMATS.map((f) => ({ value: f, label: ta(`format.${f}`) }))]} hrefFor={(v) => go({ format: (v || null) as ExplorerState['format'] })} />
          <FilterSelect
            id="x-tag"
            label={t('tag')}
            value={s.tag ?? ''}
            options={[any(t('anyTag')), { value: 'untagged', label: t('untagged') }, ...data.tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
            hrefFor={(v) => go({ tag: v || null })}
          />
          <FilterSelect id="x-wd" label={t('weekday')} value={s.weekday === null ? '' : String(s.weekday)} options={[any(t('any')), ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: ta(`weekday.${d}`) }))]} hrefFor={(v) => go({ weekday: num(v) })} />
          <FilterSelect id="x-hr" label={t('hour')} value={s.hour === null ? '' : String(s.hour)} options={[any(t('any')), ...Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: formatHour(h, prefs) }))]} hrefFor={(v) => go({ hour: num(v) })} />
        </>
      }
    >
      <FilterSelect id="x-by" label={t('groupBy')} value={s.by} options={DIMENSIONS.map((d) => ({ value: d, label: t(`by.${d}`) }))} hrefFor={(v) => go({ by: v as DimensionId })} />
      <FilterPanel label={t('metricsCount', { count: s.metrics.length })} title={t('metrics')} description={t('metricsHint', { max: MAX_METRICS })}>
        <Ticks
          key={s.metrics.join()}
          options={METRIC_IDS.map((id) => ({ id, label: tm(id) }))}
          initial={s.metrics}
          disabled={(id, picked) => !usable(id, s) || (picked.includes(id) ? picked.length === 1 : picked.length >= MAX_METRICS)}
          onChange={(next) => apply(go({ metrics: next }))}
        />
        <p className="text-xs text-muted-foreground">{t('accountTotalsHint')}</p>
      </FilterPanel>
      <FilterPanel label={s.accounts.length ? t('accountsPicked', { count: s.accounts.length }) : t('allAccounts')} title={t('accounts')} active={s.accounts.length > 0}>
        <Ticks key={s.accounts.join()} options={data.live.map((a) => ({ id: a.id, label: `@${a.username}` }))} initial={s.accounts} onChange={(next) => apply(go({ accounts: next }))} />
      </FilterPanel>
      <FilterPanel label={t('views.title')} title={t('views.title')}>
        <SavedViews views={views} query={query} save={save} rename={rename} remove={remove} />
      </FilterPanel>
    </FilterToolbar>
  );
}
