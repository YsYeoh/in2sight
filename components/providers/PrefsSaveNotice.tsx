'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { usePrefs } from '@/components/providers/PrefsProvider';

export const PREFS_TOAST_ID = 'prefs-save';

/**
 * Shows PrefsProvider's save status (Plan 16a save model): a short "Saved", or an error that stays until Retry or dismiss.
 * One toast id, so quick changes replace one toast instead of stacking. Mounted once per document (root layout); a change
 * that arrives from another document over the channel is not saved here and shows nothing.
 */
export function PrefsSaveNotice() {
  const t = useTranslations('settings.prefsSave');
  const { status, retry } = usePrefs();
  useEffect(() => {
    if (status === 'saved') toast.success(t('saved'), { id: PREFS_TOAST_ID, duration: 2000 });
    else if (status === 'error') toast.error(t('error'), { id: PREFS_TOAST_ID, duration: Infinity, action: { label: t('retry'), onClick: retry } });
  }, [status, retry, t]);
  return null;
}
