import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Page-shaped skeleton pieces for loading.tsx files and Suspense fallbacks. Grids take the SAME column classes as the
// page they stand in for, so the swap does not shift the layout. The pulse is motion-safe (components/ui/skeleton.tsx).

/** Mirrors PageHeader: title + subtitle on the left, `actions` button-sized blocks on the right. */
export function SkeletonHeader({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-[var(--gp)] flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      {actions > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-[var(--ctl)] w-24" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** `count` blocks in a grid: stat rows (h-24), chart cards (h-64), card lists. `className` = the page's grid columns. */
export function SkeletonGrid({ count, className, itemClassName }: { count: number; className?: string; itemClassName?: string }) {
  return (
    <div className={cn('grid min-w-0 gap-[var(--gp)]', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn('h-24 rounded-[var(--rm)]', itemClassName)} />
      ))}
    </div>
  );
}

/** A bordered table: one header row + `rows` body rows at the density's row height. */
export function SkeletonTable({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('grid gap-2 rounded-[var(--rm)] border border-border bg-card p-[var(--pc)]', className)}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-[var(--row)]" />
      ))}
    </div>
  );
}

/** A tab bar with `count` tabs. */
export function SkeletonTabs({ count }: { count: number }) {
  return (
    <div className="mb-[var(--gp)] flex max-w-full gap-1 overflow-hidden rounded-md bg-muted p-1">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-[var(--ctl-sm)] w-20 flex-none bg-background" />
      ))}
    </div>
  );
}

/** Route-level loading frame: the page skeleton plus ONE orb with a caption, pinned to a corner (it never moves the layout). */
export function RouteLoading({ children }: { children: ReactNode }) {
  const t = useTranslations('loading');
  return (
    <div aria-busy="true" className="min-w-0">
      {children}
      <div className="fixed right-[var(--pg)] bottom-20 z-20 flex items-center gap-2 rounded-full border border-border bg-card/90 py-1 pr-3 pl-1 shadow-pop backdrop-blur md:bottom-[var(--pg)]">
        <InsightOrb size="md" label={t('caption1')} />
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          {t('caption1')}
        </span>
      </div>
    </div>
  );
}
