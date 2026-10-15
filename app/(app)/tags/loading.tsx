import { RouteLoading, SkeletonHeader, SkeletonTable } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function TagsLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader />
      <div className="grid min-w-0 gap-[var(--gp)]">
        <Skeleton className="h-24 rounded-[var(--rm)]" />
        <SkeletonTable rows={5} />
      </div>
    </RouteLoading>
  );
}
