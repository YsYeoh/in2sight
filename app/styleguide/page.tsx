import { getTranslations } from 'next-intl/server';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { formatCompact, formatDate, formatDelta, formatNumber, formatPercent, formatTime } from '@/lib/format';
import { getPrefs } from '@/lib/prefs.server';
import { Gallery } from './Gallery';

const SWATCHES = ['background', 'surface', 'surface-2', 'border', 'foreground', 'muted-foreground', 'primary', 'primary-foreground', 'accent', 'success', 'warning', 'danger'];
const SAMPLE_INSTANT = new Date('2026-10-13T16:02:00Z');

export default async function StyleguidePage() {
  const t = await getTranslations('styleguide');
  const prefs = await getPrefs();
  const rows: [string, string][] = [
    [t('sampleDate'), formatDate(SAMPLE_INSTANT, prefs)],
    [t('sampleTime'), formatTime(SAMPLE_INSTANT, prefs)],
    [t('sampleNumber'), formatNumber(1234567.891, prefs)],
    [t('sampleCompact'), formatCompact(184200, prefs)],
    [t('samplePercent'), formatPercent(0.048, prefs)],
    [t('sampleDelta'), formatDelta(0.032, prefs)],
  ];

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-[var(--gp)] p-[var(--pg)]">
      <header>
        <h1 className="text-[length:var(--fv)] font-semibold leading-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </header>

      <PrefsBar />

      <section className="rounded-lg border border-border bg-card p-[var(--pc)]">
        <h2 className="mb-3 text-[length:var(--fh)] font-medium">{t('tokens')}</h2>
        <div className="grid grid-cols-2 gap-[var(--gp)] sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map((n) => (
            <div key={n} className="overflow-hidden rounded-md border border-border">
              <div className="h-10 border-b border-border" style={{ background: `var(--${n})` }} />
              <div className="p-2 text-[length:var(--lb)]">
                <div className="font-medium">{n}</div>
                <div className="text-muted-foreground">--{n}</div>
              </div>
            </div>
          ))}
        </div>
        <h3 className="mb-2 mt-4 text-[length:var(--fh)] font-medium">{t('chart')}</h3>
        <div className="grid grid-cols-3 gap-[var(--gp)] sm:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-10 rounded-md border border-border" style={{ background: `var(--chart-${n})` }} title={`--chart-${n}`} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-[var(--pc)]">
        <h2 className="mb-3 text-[length:var(--fh)] font-medium">{t('formats')}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-muted-foreground">{t('greeting', { name: 'Yong Sen' })}</p>
      </section>

      <Gallery />
    </main>
  );
}
