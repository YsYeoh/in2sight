'use client';

// Settings -> Appearance (Plan 16a). Every pick applies at once and is saved in the background (PrefsProvider; the toast
// comes from PrefsSaveNotice). The preview shows real pieces in the current tokens.
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Segmented } from '@/components/shared/Segmented';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDelta, formatNumber } from '@/lib/format';
import { DENSITIES, MODES, RADII, THEMES, type Theme } from '@/lib/prefs';

// proper nouns, not translated (as in PrefsBar)
const THEME_NAMES: Record<Theme, string> = { ink: 'Ink', sunset: 'Sunset', forest: 'Forest', mono: 'Mono' };
const BARS = [
  ['bg-chart-1', 'h-[40%]'],
  ['bg-chart-2', 'h-[70%]'],
  ['bg-chart-3', 'h-[55%]'],
  ['bg-chart-4', 'h-[90%]'],
  ['bg-chart-5', 'h-[65%]'],
  ['bg-chart-6', 'h-[80%]'],
] as const;

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Preview() {
  const t = useTranslations('settings.appearance');
  const { prefs } = usePrefs();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('previewTitle')}</CardTitle>
        <CardDescription>{t('previewDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium">{t('previewHeading')}</h3>
          <p className="text-sm text-muted-foreground">{t('previewBody')}</p>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm text-muted-foreground">{t('previewKpi')}</span>
          <span className="text-[length:var(--fv)] font-semibold">{formatNumber(12480, prefs)}</span>
          <Badge variant="secondary">{formatDelta(0.082, prefs)}</Badge>
          <Badge>{t('previewBadge')}</Badge>
        </div>
        <div role="img" aria-label={t('previewChart')} className="flex h-12 items-end gap-1">
          {BARS.map(([bg, h]) => (
            <span key={bg} className={`flex-1 rounded-t-[var(--rs)] ${bg} ${h}`} />
          ))}
        </div>
        <Input aria-label={t('previewInput')} placeholder={t('previewInput')} />
        <div className="flex flex-wrap gap-2">
          <Button type="button">{t('previewPrimary')}</Button>
          <Button type="button" variant="outline">
            {t('previewSecondary')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AppearanceSection() {
  const t = useTranslations('settings.appearance');
  const tp = useTranslations('prefs');
  const { prefs, update } = usePrefs();
  return (
    <div className="grid gap-[var(--gp)] lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="grid min-w-0 gap-[var(--gp)]">
        <Group title={tp('theme')} hint={t('themeHint')}>
          <Segmented label={tp('theme')} value={prefs.theme} options={THEMES.map((v) => ({ value: v, label: THEME_NAMES[v] }))} onChange={(theme) => update({ theme })} />
        </Group>
        <Group title={tp('mode')} hint={t('modeHint')}>
          <Segmented label={tp('mode')} value={prefs.mode} options={MODES.map((v) => ({ value: v, label: tp(v) }))} onChange={(mode) => update({ mode })} />
        </Group>
        <Group title={tp('density')} hint={t('densityHint')}>
          <Segmented label={tp('density')} value={prefs.density} options={DENSITIES.map((v) => ({ value: v, label: tp(v) }))} onChange={(density) => update({ density })} />
        </Group>
        <Group title={tp('radius')} hint={t('radiusHint')}>
          <Segmented label={tp('radius')} value={prefs.radius} options={RADII.map((v) => ({ value: v, label: tp(v) }))} onChange={(radius) => update({ radius })} />
        </Group>
      </div>
      <div className="min-w-0 lg:sticky lg:top-[var(--pg)]">
        <Preview />
      </div>
    </div>
  );
}
