import { RouteLoading, SkeletonGrid, SkeletonHeader } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function CalendarLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader actions={1} />
      <div className="mb-[var(--gp)] flex items-center justify-between gap-2">
        <Skeleton className="h-[var(--ctl-sm)] w-24" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-[var(--ctl-sm)] w-24" />
      </div>
      <SkeletonGrid count={35} className="grid-cols-7 gap-1 max-md:hidden" itemClassName="h-20 rounded-md" />
      <SkeletonGrid count={5} className="md:hidden" itemClassName="h-14" />
    </RouteLoading>
  );
}
