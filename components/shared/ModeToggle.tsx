'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Button } from '@/components/ui/button';

export function ModeToggle() {
  const t = useTranslations('shell');
  const { prefs, update } = usePrefs();
  // flips what is SHOWN: Auto showing dark becomes Light (the icon follows the saved choice, so it matches the server render)
  return (
    <Button variant="ghost" size="icon" aria-label={t('toggleMode')} onClick={() => update({ mode: document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark' })}>
      {prefs.mode === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
