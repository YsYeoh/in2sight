'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PERIODS, type Period } from '@/lib/analysis/types';

/** 7 / 30 / 90 days as links (?period=N): the URL is the state. Labels live under pages.overview (first user). */
export function PeriodSelect({ period }: { period: Period }) {
  const t = useTranslations('pages.overview');
  return (
    <nav aria-label={t('period')} className="inline-flex rounded-md border bg-card p-0.5">
      {PERIODS.map((p) => (
        <Button key={p} asChild size="sm" variant={p === period ? 'secondary' : 'ghost'}>
          <Link href={`?period=${p}`} aria-current={p === period ? 'page' : undefined} scroll={false}>
            {t('periodOption', { days: p })}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
