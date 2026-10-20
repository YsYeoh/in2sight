import { SkeletonGrid, SkeletonTable } from '@/components/shared/Skeletons';
import type { Tab } from '@/lib/dashboard/account';

/** The shape of one account tab while it streams in (same grids as AccountOverview (AudienceTab inside Overview) / PostsTab / StoriesTab). */
export function TabSkeleton({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'posts':
      return (
        <div aria-busy="true" className="grid min-w-0 gap-[var(--gp)]">
          <SkeletonGrid count={5} className="grid-cols-2 md:grid-cols-[repeat(4,minmax(0,1fr))_auto]" itemClassName="h-[calc(var(--ctl)*1.8)] rounded-md" />
          <SkeletonTable rows={8} />
        </div>
      );
    case 'stories':
      return (
        <div aria-busy="true">
          <SkeletonGrid count={6} className="sm:grid-cols-2 xl:grid-cols-3" itemClassName="h-40" />
        </div>
      );
    default:
      return (
        <div aria-busy="true" className="grid min-w-0 gap-[var(--gp)]">
          <SkeletonGrid count={6} className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
          <SkeletonGrid count={2} className="lg:grid-cols-2" itemClassName="h-64" />
          <SkeletonGrid count={2} className="lg:grid-cols-2" itemClassName="h-64" />
          <SkeletonGrid count={2} className="lg:grid-cols-2" itemClassName="h-64" />
        </div>
      );
  }
}
