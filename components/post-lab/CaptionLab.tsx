'use client';

// Caption lab: what this caption contains, and the median reach of your posts of this format with vs without each trait
// (from 20 measured posts on, each side from 5). A pattern in your own posts, said plainly: not a cause.
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CAPTION_MIN_POSTS, type CaptionLab as CaptionLabModel, type CaptionSide, type CaptionSplit } from '@/lib/analysis/caption';
import { formatNumber } from '@/lib/format';

export function CaptionLab({ lab }: { lab: CaptionLabModel }) {
  const t = useTranslations('postLab.caption');
  const { prefs } = usePrefs();
  const count = (n: number) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  const { features: f } = lab;
  const facts: [string, string][] = [
    [t('length'), count(f.length)],
    [t('hashtags'), count(f.hashtags.length)],
    [t('mentions'), count(f.mentions)],
    [t('emoji'), count(f.emoji)],
    [t('question'), t(f.question ? 'yes' : 'no')],
    [t('cta'), f.cta.length ? f.cta.join(', ') : t('no')],
  ];
  const side = (s: CaptionSide) => (s.median === null ? t('tooFew', { n: s.n }) : t('side', { value: count(s.median), n: s.n }));
  const columns: Column<CaptionSplit>[] = [
    { key: 'trait', header: t('trait'), cell: (s) => (s.trait === 'long' ? t('trait_long', { n: count(lab.longFrom ?? 0) }) : t(`trait_${s.trait}`)) },
    { key: 'has', header: t('thisPost'), cell: (s) => t(s.has ? 'yes' : 'no') },
    { key: 'with', header: t('with'), align: 'right', cell: (s) => side(s.with) },
    { key: 'without', header: t('without'), align: 'right', cell: (s) => side(s.without) },
  ];
  return (
    <ChartCard title={t('title')} subtitle={t('hint')}>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate font-medium tabular-nums" dir="auto">
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {f.hashtags.length ? (
        <ul aria-label={t('hashtags')} className="mt-2 flex flex-wrap gap-1">
          {f.hashtags.map((h) => (
            <li key={h} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" dir="auto">
              #{h}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4">
        {lab.splits ? (
          <>
            <DataTable rows={lab.splits} columns={columns} rowKey={(s) => s.trait} caption={t('splitCaption')} />
            <p className="mt-2 text-xs text-muted-foreground">{t('notCause', { n: lab.measured })}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('needMore', { min: CAPTION_MIN_POSTS, n: lab.measured })}</p>
        )}
      </div>
    </ChartCard>
  );
}
