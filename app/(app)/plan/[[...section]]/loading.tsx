import { RouteLoading, SkeletonGrid } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

// Only the section streams: the Plan layout (header + section tabs) stays on screen.
export default function PlanSectionLoading() {
  return (
    <RouteLoading>
      <Skeleton className="mb-[var(--gp)] h-10 w-full max-w-sm" />
      <SkeletonGrid count={6} className="mb-[var(--gp)] grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
      <Skeleton className="h-64 rounded-[var(--rm)]" />
    </RouteLoading>
  );
}
