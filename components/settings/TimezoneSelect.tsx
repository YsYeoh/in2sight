'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { withCurrentZone } from '@/lib/timezones';

export function TimezoneSelect() {
  const t = useTranslations('prefs');
  const { prefs, update } = usePrefs();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[length:var(--lb)] text-muted-foreground">{t('timezone')}</span>
      <Select value={prefs.timezone} onValueChange={(timezone) => update({ timezone })}>
        <SelectTrigger size="sm" aria-label={t('timezone')} className="max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {withCurrentZone(prefs.timezone).map((z) => (
            <SelectItem key={z} value={z}>{z}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
