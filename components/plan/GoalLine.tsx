'use client';

// One goal's progress as words (Plan 17d): a status badge and the numbers behind it, used by the Digest and the Goals
// section. Pace and projection are rules on the owner's numbers: Low / Medium confidence only, never "High".
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Badge } from '@/components/ui/badge';
import type { GoalProgress } from '@/lib/analysis/goals';
import { formatDay, formatNumber } from '@/lib/format';

const TONE = { done: 'default', ahead: 'secondary', behind: 'outline', missed: 'destructive' } as const;

export function GoalLine({ p }: { p: GoalProgress }) {
  const t = useTranslations('plan.goals');
  const { prefs } = usePrefs();
  const n = (v: number | null) => (v === null ? '—' : formatNumber(v, prefs));
  const title = t(p.metric === 'followers' ? 'followers' : p.metric === 'avg_reach' ? 'avgReach' : 'postsPerWeek');
  const lines: string[] = [];
  if (p.metric === 'followers') {
    lines.push(p.actual === null ? t('followersNoData') : t('followersLine', { actual: n(p.actual), target: n(p.target), date: formatDay(p.dueDay, prefs), baseline: n(p.baseline), expected: n(p.expected) }));
    if (p.forecast && 'reason' in p.forecast) lines.push(t('forecastFew', { n: p.forecast.n }));
    else if (p.forecast) lines.push(t('forecast', { date: formatDay(p.dueDay, prefs), value: n(p.forecast.value), low: n(p.forecast.low), high: n(p.forecast.high), confidence: t(`confidence.${p.forecast.confidence}`), n: p.forecast.n, verdict: p.forecast.verdict }));
  } else if (p.metric === 'avg_reach') {
    lines.push(p.actual === null ? t('avgNone') : t('avgLine', { actual: n(p.actual), n: p.n, target: n(p.target) }));
    if (p.actual !== null && p.status === null) lines.push(t('avgFew'));
    if (p.young > 0) lines.push(t('avgYoung', { young: p.young }));
  } else {
    lines.push(t('postsLine', { actual: n(p.actual), target: n(p.target), expected: n(p.expected), last: n(p.lastWeek.actual) }));
  }
  return (
    <li className="grid min-w-0 gap-0.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {p.status ? <Badge variant={TONE[p.status]}>{t(`status.${p.status}`)}</Badge> : null}
      </div>
      {lines.map((l) => (
        <p key={l} className="text-xs break-words text-muted-foreground">
          {l}
        </p>
      ))}
    </li>
  );
}
