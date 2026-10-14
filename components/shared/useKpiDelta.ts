'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import type { StatDelta } from '@/components/shared/StatCard';
import type { Kpi, KpiId } from '@/lib/analysis/growth';
import { deltaView } from '@/lib/metrics';

/** KPI → what StatCard/DeltaPill show; percentage points get their translated unit. */
export function useKpiDelta() {
  const t = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  return (id: KpiId, k: Kpi | undefined): StatDelta | null => {
    const d = k ? deltaView(id, k, prefs) : null;
    return d && { ...d, text: d.unit === 'points' ? t('points', { value: d.text }) : d.text };
  };
}
