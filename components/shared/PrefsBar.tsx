'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { TimezoneSelect } from '@/components/settings/TimezoneSelect';
import { DATE_FORMATS, DENSITIES, LOCALES, MODES, NUMBER_FORMATS, RADII, THEMES, TIME_FORMATS, WEEK_STARTS, type Prefs } from '@/lib/prefs';

// proper nouns / literal formats are not translated
const LITERAL: Record<string, string> = { ink: 'Ink', sunset: 'Sunset', forest: 'Forest', mono: 'Mono', en: 'English', 'zh-CN': '简体中文' };

function Choice({ field, label, options }: { field: keyof Prefs; label: string; options: readonly string[] }) {
  const t = useTranslations('prefs');
  const { prefs, update } = usePrefs();
  const text = (o: string) => LITERAL[o] ?? (t.has(o) ? t(o) : o);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[length:var(--lb)] text-muted-foreground">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={prefs[field] === o}
          onClick={() => update({ [field]: o } as Partial<Prefs>)}
          className="h-[var(--ctl-sm)] rounded-md border border-border bg-card px-2.5 text-[length:var(--lb)] font-medium transition-colors hover:bg-hover aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          {text(o)}
        </button>
      ))}
    </div>
  );
}

export function PrefsBar() {
  const t = useTranslations('prefs');
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border bg-card p-[var(--pc)]">
      <Choice field="theme" label={t('theme')} options={THEMES} />
      <Choice field="mode" label={t('mode')} options={MODES} />
      <Choice field="density" label={t('density')} options={DENSITIES} />
      <Choice field="radius" label={t('radius')} options={RADII} />
      <Choice field="locale" label={t('language')} options={LOCALES} />
      <Choice field="dateFormat" label={t('dateFormat')} options={DATE_FORMATS} />
      <Choice field="timeFormat" label={t('timeFormat')} options={TIME_FORMATS} />
      <Choice field="numberFormat" label={t('numberFormat')} options={NUMBER_FORMATS} />
      <Choice field="weekStart" label={t('weekStart')} options={WEEK_STARTS} />
      <TimezoneSelect />
    </div>
  );
}
