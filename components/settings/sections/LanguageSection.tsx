'use client';

// Settings -> Language & formats (Plan 16a). Instant like Appearance: each pick applies at once and is saved in the
// background; a language change reloads the app once saved (PrefsProvider). Samples are rendered by lib/format.ts.
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FormField } from '@/components/shared/FormField';
import { Segmented } from '@/components/shared/Segmented';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatDateTime, formatNumber, formatTime } from '@/lib/format';
import { DATE_FORMATS, LOCALES, NUMBER_FORMATS, TIME_FORMATS, WEEK_STARTS, type Locale, type Prefs } from '@/lib/prefs';
import { withCurrentZone } from '@/lib/timezones';

/** Fixed, so the server and the client render the same text; 23:30 UTC is already the next day in Asia. */
export const SAMPLE_AT = '2026-03-14T23:30:00Z';
export const SAMPLE_NUMBER = 1234567.89;

const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文' }; // never translated
const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

export function LanguageSection() {
  const t = useTranslations('settings.language');
  const tp = useTranslations('prefs');
  const { prefs, update } = usePrefs();
  const as = (patch: Partial<Prefs>) => ({ ...prefs, ...patch });
  return (
    <div className="grid gap-[var(--gp)]">
      <Card>
        <CardHeader>
          <CardTitle>{tp('language')}</CardTitle>
          <CardDescription>{t('languageHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Segmented label={tp('language')} value={prefs.locale} options={LOCALES.map((v) => ({ value: v, label: LANGUAGE_NAMES[v] }))} onChange={(locale) => update({ locale })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('formatsTitle')}</CardTitle>
          <CardDescription>{t('formatsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)] md:grid-cols-2">
          <FormField id="pref-date-format" label={tp('dateFormat')}>
            {(p) => (
              <select {...p} className={SELECT} value={prefs.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as Prefs['dateFormat'] })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {formatDate(SAMPLE_AT, as({ dateFormat: f }))}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField id="pref-number-format" label={tp('numberFormat')}>
            {(p) => (
              <select {...p} className={SELECT} value={prefs.numberFormat} onChange={(e) => update({ numberFormat: e.target.value as Prefs['numberFormat'] })}>
                {NUMBER_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {formatNumber(SAMPLE_NUMBER, as({ numberFormat: f }))}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{tp('timeFormat')}</span>
            <Segmented label={tp('timeFormat')} value={prefs.timeFormat} options={TIME_FORMATS.map((f) => ({ value: f, label: formatTime(SAMPLE_AT, as({ timeFormat: f })) }))} onChange={(timeFormat) => update({ timeFormat })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{tp('weekStart')}</span>
            <Segmented label={tp('weekStart')} value={prefs.weekStart} options={WEEK_STARTS.map((v) => ({ value: v, label: tp(v) }))} onChange={(weekStart) => update({ weekStart })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tp('timezone')}</CardTitle>
          <CardDescription>{t('timezoneHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FormField id="pref-timezone" label={tp('timezone')} className="max-w-md">
            {(p) => (
              <select {...p} className={SELECT} value={prefs.timezone} onChange={(e) => update({ timezone: e.target.value })}>
                {withCurrentZone(prefs.timezone).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {t('sample', { date: formatDateTime(SAMPLE_AT, prefs), number: formatNumber(SAMPLE_NUMBER, prefs) })}
      </p>
    </div>
  );
}
