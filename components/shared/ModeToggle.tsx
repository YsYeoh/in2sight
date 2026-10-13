'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Button } from '@/components/ui/button';

export function ModeToggle() {
  const t = useTranslations('shell');
  const { prefs, update } = usePrefs();
  return (
    <Button variant="ghost" size="icon" aria-label={t('toggleMode')} onClick={() => update({ mode: prefs.mode === 'dark' ? 'light' : 'dark' })}>
      {prefs.mode === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
