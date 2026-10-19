import { RouteLoading, SkeletonGrid, SkeletonTable } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function PostLabLoading() {
  return (
    <RouteLoading>
      <Skeleton className="mb-[var(--gp)] h-3 w-24" />
      <div className="mb-[var(--gp)] grid min-w-0 gap-[var(--gp)] rounded-[var(--rm)] border border-border bg-card p-[var(--pc)] md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <Skeleton className="aspect-[4/5] w-full max-w-72 rounded-[var(--rm)]" />
        <div className="grid content-start gap-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-[var(--ctl)] w-40" />
        </div>
      </div>
      <SkeletonTable rows={9} className="mb-[var(--gp)]" />
      <SkeletonGrid count={2} className="lg:grid-cols-2" itemClassName="h-64" />
    </RouteLoading>
  );
}
