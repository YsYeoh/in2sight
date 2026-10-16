'use client';

import { Clock, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Badge } from '@/components/ui/badge';
import { formatPercent } from '@/lib/format';
import type { AccountProgress } from '@/lib/sync/progress';

const WARN = ['failed', 'needs_reconnect', 'stalled', 'rate_limited'];

/** Compact "Importing… 63%" for account rows and Overview cards; nothing once the import is done. Icon + text, never colour alone. */
export function SyncBadge({ p }: { p: AccountProgress | undefined }) {
  const t = useTranslations('sync');
  const { prefs } = usePrefs();
  if (!p || p.phase === 'done') return null;
  const warn = WARN.includes(p.phase);
  return (
    <Badge variant={warn ? 'outline' : 'secondary'} className="max-w-full">
      {p.phase === 'running' ? <InsightOrb size="xs" decorative /> : warn ? <TriangleAlert aria-hidden="true" /> : <Clock aria-hidden="true" />}
      <span className="truncate">{t('badge', { pct: formatPercent(p.percent / 100, prefs, 0) })}</span>
    </Badge>
  );
}
