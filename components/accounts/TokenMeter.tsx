'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Progress } from '@/components/ui/progress';
import { tokenStatus } from '@/lib/accounts/token-status';
import { formatNumber } from '@/lib/format';

const LIFETIME_DAYS = 60; // Instagram long-lived tokens

export function TokenMeter({ expiresAt, now }: { expiresAt: string | null; now: Date }) {
  const t = useTranslations('accounts.token');
  const { prefs } = usePrefs();
  const { state, daysLeft } = tokenStatus(expiresAt, now);
  const label = state === 'unknown' ? t('unknown') : state === 'expired' ? t('expired') : t('daysLeft', { days: formatNumber(daysLeft, prefs) });
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <Progress value={Math.min(100, (daysLeft / LIFETIME_DAYS) * 100)} aria-label={t('label')} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
