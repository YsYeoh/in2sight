import { RouteLoading, SkeletonHeader, SkeletonTable } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function ExplorerLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader actions={1} />
      <Skeleton className="mb-[var(--gp)] h-[var(--ctl)] w-full max-w-xl" />
      <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-[var(--rm)]" />
        <div className="grid min-w-0 content-start gap-[var(--gp)]">
          <Skeleton className="h-72 rounded-[var(--rm)]" />
          <SkeletonTable rows={6} />
        </div>
      </div>
    </RouteLoading>
  );
}
