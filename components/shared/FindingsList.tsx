'use client';

// Findings of the insights feed (Plan 17b): the account Overview's Findings card and the Overview's "Needs attention".
// Each line: the finding in words, its basis (n, a confidence word, the day) and a link to the evidence; Dismiss (for
// good) and "Hide for 7 days" when the table exists. A hidden finding leaves the list at once; the next page load reads
// the dismissals again. Params are numbers and ids, formatted here (lib/format.ts); never HTML.
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { NavLink } from '@/components/shared/NavLink';
import { Button } from '@/components/ui/button';
import type { DismissMode, DismissResult, Finding } from '@/lib/analysis/insights';
import { formatDay, formatDelta, formatNumber, formatSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

export type DismissAction = (key: string, mode: DismissMode) => Promise<DismissResult>;

/** The sentence of one finding in the UI language. */
export function useFindingText(): (f: Finding) => string {
  const t = useTranslations('insights');
  const ta = useTranslations('analysis');
  const tg = useTranslations('pages.account.growth');
  const { prefs } = usePrefs();
  return (f) => {
    const p = f.params;
    const num = (v: unknown, digits = 0) => formatNumber(typeof v === 'number' ? v : null, prefs, { maximumFractionDigits: digits });
    const values: Record<string, string | number> = {
      ratio: num(p.ratio, 1),
      change: formatDelta(typeof p.change === 'number' ? p.change : null, prefs),
      format: p.format ? ta(`format.${p.format}`) : '',
      date: formatDay(f.day, prefs),
      metric: p.metric ? t(`metric.${p.metric}`) : '',
      value: p.metric === 'followers' ? formatSigned(Number(p.value), prefs) : num(p.value),
      typical: f.kind === 'posting_gap' ? num(p.typical, 1) : p.metric === 'followers' ? formatSigned(Number(p.typical), prefs) : num(p.typical),
      weekday: p.weekday !== undefined ? tg(`weekday.${p.weekday}`) : '',
      daypart: p.daypart ? t(`daypart.${p.daypart}`) : '',
      days: Number(p.days ?? 0),
      count: Number(p.count ?? 0),
      hashtag: String(p.hashtag ?? ''),
    };
    return t(`kind.${f.kind}`, values);
  };
}

const TONE = { bad: 'border-l-destructive', good: 'border-l-success', tip: 'border-l-primary' } as const;

export function FindingsList({ items, canDismiss, dismiss, label }: { items: Finding[]; canDismiss: boolean; dismiss?: DismissAction; label?: (f: Finding) => string | null }) {
  const t = useTranslations('insights');
  const { prefs } = usePrefs();
  const text = useFindingText();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const shown = items.filter((f) => !hidden.has(f.key));
  const run = (key: string, mode: DismissMode) =>
    start(async () => {
      const r = dismiss ? await dismiss(key, mode) : ({ ok: false, error: 'unexpected' } as const);
      if (r.ok) setHidden((h) => new Set([...h, key]));
      setNotice(r.ok ? { ok: true, text: t('hidden') } : { ok: false, text: t(`errors.${r.error}`) });
    });

  return (
    <div className="grid min-w-0 gap-2">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid min-w-0 gap-2">
          {shown.map((f) => {
            const sentence = text(f);
            const who = label?.(f);
            return (
              <li key={f.key} className={cn('grid min-w-0 gap-1 border-l-2 pl-3 text-sm', TONE[f.tone])}>
                <p className="min-w-0 break-words">
                  {who ? <span className="font-medium">{who} · </span> : null}
                  {sentence}
                </p>
                <p className="text-xs text-muted-foreground">{t('basis', { n: formatNumber(f.n, prefs), confidence: t(`confidence.${f.confidence}`), date: formatDay(f.day, prefs) })}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <NavLink href={f.href} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                    {t('open')}
                  </NavLink>
                  {canDismiss && dismiss ? (
                    <>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={t('dismissLabel', { text: sentence })} onClick={() => run(f.key, 'dismiss')}>
                        {t('dismiss')}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={pending} aria-label={t('snoozeLabel', { text: sentence })} onClick={() => run(f.key, 'snooze')}>
                        {t('snooze')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!canDismiss && shown.length > 0 ? <p className="text-xs text-muted-foreground">{t('needsUpdate')}</p> : null}
      {notice ? (
        <p role={notice.ok ? 'status' : 'alert'} className={cn('text-xs', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
