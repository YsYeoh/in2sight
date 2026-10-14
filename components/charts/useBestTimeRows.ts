'use client';

import { useTranslations } from 'next-intl';
import type { HeatmapCell } from '@/components/charts/Heatmap';
import { usePrefs } from '@/components/providers/PrefsProvider';
import type { Heatmap } from '@/lib/analysis/best-time';
import { formatCompact, formatHour, formatPercent } from '@/lib/format';

/**
 * Best-time grid → Heatmap rows with translated weekday labels and per-cell screen-reader text.
 * 'posts' cells hold an average engagement rate; 'online' cells an average count of followers online.
 */
export function useBestTimeRows() {
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const hours = Array.from({ length: 24 }, (_, h) => formatHour(h, prefs));
  const rows = (h: Heatmap, kind: 'posts' | 'online'): { label: string; cells: HeatmapCell[] }[] =>
    h.rows.map((r) => {
      const day = ta(`weekday.${r.weekday}`);
      return {
        label: day,
        cells: r.cells.map((c, i) => ({
          value: c.value,
          lowSample: kind === 'posts' && c.lowSample,
          label:
            kind === 'online'
              ? ta('onlineCell', { day, hour: hours[i], value: formatCompact(c.value, prefs) })
              : c.lowSample
                ? ta('heatCellLow', { day, hour: hours[i], reason: ta('lowSample') })
                : ta('heatCell', { day, hour: hours[i], value: formatPercent(c.value, prefs), count: c.count }),
        })),
      };
    });
  return { hours, rows };
}
