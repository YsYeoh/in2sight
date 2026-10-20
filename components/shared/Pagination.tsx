'use client';

// Page navigation for server-paged lists (Posts, Stories; docs/UI_STANDARDS.md): First / Previous / "Page 3 of 12" /
// Next / Last. Every link comes from the caller's hrefFor(page), so every other URL parameter is kept. At an edge the
// button is disabled (not a link). One control height: default-size icon buttons. Nothing for a single page.
import type { ComponentType } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  const t = useTranslations('pagination');
  const { prefs } = usePrefs();
  if (pages <= 1) return null;
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const step = (to: number, label: string, Icon: ComponentType<{ 'aria-hidden'?: boolean | 'true' }>) =>
    to < 1 || to > pages || to === page ? (
      <Button type="button" variant="outline" size="icon" disabled aria-label={label}>
        <Icon aria-hidden="true" />
      </Button>
    ) : (
      <Button asChild variant="outline" size="icon">
        <Link href={hrefFor(to)} aria-label={label}>
          <Icon aria-hidden="true" />
        </Link>
      </Button>
    );
  return (
    <nav aria-label={t('label')} className="flex flex-wrap items-center justify-center gap-2">
      {step(1, t('first'), ChevronsLeft)}
      {step(page - 1, t('previous'), ChevronLeft)}
      <span className="px-2 text-sm tabular-nums">{t('status', { page: n(page), pages: n(pages) })}</span>
      {step(page + 1, t('next'), ChevronRight)}
      {step(pages, t('last'), ChevronsRight)}
    </nav>
  );
}
