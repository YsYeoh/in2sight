import { RouteLoading, SkeletonGrid, SkeletonHeader } from '@/components/shared/Skeletons';

export default function OverviewLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader actions={2} />
      <SkeletonGrid count={4} className="mb-[var(--gp)] grid-cols-2 lg:grid-cols-4" />
      <SkeletonGrid count={3} className="sm:grid-cols-2 xl:grid-cols-3" itemClassName="h-56" />
    </RouteLoading>
  );
}
