'use client';

import dynamic from 'next/dynamic';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { EmptyState } from '@/components/shared/EmptyState';
import type { AudienceModel, Ranked } from '@/lib/dashboard/audience';
import { formatCountry, formatDay, formatPercent } from '@/lib/format';
import { useHeavyMotion } from '@/lib/motion';

// Heavy, decorative and browser-only: its code loads only when the motion gate allows it (never during SSR).
const Globe = dynamic(() => import('@/components/account/Globe'), { ssr: false });

/** Ranked horizontal bars as a list: the accessible form of the data (name + share in text, bar is decoration). */
function RankedBars({ data, name, otherLabel }: { data: Ranked; name: (key: string) => string; otherLabel: string }) {
  const { prefs } = usePrefs();
  const rows = [...data.rows.map((r) => ({ key: r.key, label: name(r.key), share: r.share })), ...(data.other ? [{ key: '\u0000other', label: otherLabel, share: data.other.share }] : [])];
  const max = Math.max(...rows.map((r) => r.share), 1e-6);
  return (
    <ol className="grid gap-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
          <span className="truncate" dir="auto">
            {r.label}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{formatPercent(r.share, prefs)}</span>
          <span aria-hidden="true" className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(r.share / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AudienceTab({ model }: { model: AudienceModel }) {
  const t = useTranslations('pages.account.audience');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const heavy = useHeavyMotion();

  if (model.reason) return <EmptyState icon={<Users className="size-5" aria-hidden />} title={ta(`reasons.${model.reason}`)} description={t('emptyHint')} />;

  const asOf = (day: string) => t('asOf', { date: formatDay(day, prefs) });
  const missing = <p className="text-sm text-muted-foreground">{ta('reasons.needs_100_followers')}</p>;
  const maxAge = Math.max(...(model.ages?.rows.map((r) => r.total) ?? [0]), 1);

  return (
    <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
      <ChartCard title={t('countries')} subtitle={model.countries ? asOf(model.countries.day) : undefined}>
        <div className="grid min-w-0 items-center gap-[var(--gp)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {heavy && model.globe.length > 0 ? <Globe points={model.globe} /> : null}
          <div className={heavy && model.globe.length > 0 ? 'min-w-0' : 'min-w-0 sm:col-span-2'}>{model.countries ? <RankedBars data={model.countries} name={(code) => formatCountry(code, prefs)} otherLabel={t('other')} /> : missing}</div>
        </div>
      </ChartCard>

      <ChartCard title={t('cities')} subtitle={model.cities ? asOf(model.cities.day) : undefined}>
        {model.cities ? <RankedBars data={model.cities} name={(city) => city} otherLabel={t('other')} /> : missing}
      </ChartCard>

      <ChartCard title={t('ageGender')} subtitle={model.ages ? asOf(model.ages.day) : undefined}>
        {model.ages ? (
          <>
            <ul aria-hidden="true" className="mb-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-1" />{t('female')}</li>
              <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-chart-2" />{t('male')}</li>
              <li className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground" />{t('unknown')}</li>
            </ul>
            <ol className="grid gap-1.5 text-sm">
              {model.ages.rows.map((r) => (
                <li key={r.age} className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2">
                  <span className="truncate tabular-nums">{r.age}</span>
                  <span aria-hidden="true" className="flex h-2 overflow-hidden rounded-full bg-muted" style={{ width: `${(r.total / maxAge) * 100}%` }}>
                    <span className="bg-chart-1" style={{ width: `${(r.female / r.total) * 100}%` }} />
                    <span className="bg-chart-2" style={{ width: `${(r.male / r.total) * 100}%` }} />
                    <span className="bg-muted-foreground" style={{ width: `${(r.unknown / r.total) * 100}%` }} />
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatPercent(r.share, prefs)}
                    <span className="sr-only">{t('split', { female: formatPercent(r.female / r.total, prefs), male: formatPercent(r.male / r.total, prefs) })}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          missing
        )}
      </ChartCard>
    </div>
  );
}
