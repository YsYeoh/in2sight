'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import type { StatDelta } from '@/components/shared/StatCard';
import type { Kpi } from '@/lib/analysis/growth';
import { deltaView, type MetricId } from '@/lib/metrics';

/** KPI → what StatCard/DeltaPill show; percentage points get their translated unit. Any registry metric (Explorer too). */
export function useKpiDelta() {
  const t = useTranslations('pages.overview');
  const { prefs } = usePrefs();
  return (id: MetricId, k: Kpi | undefined): StatDelta | null => {
    const d = k ? deltaView(id, k, prefs) : null;
    return d && { ...d, text: d.unit === 'points' ? t('points', { value: d.text }) : d.text };
  };
}
