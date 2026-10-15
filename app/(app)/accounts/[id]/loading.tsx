import { TabSkeleton } from '@/components/account/TabSkeleton';
import { RouteLoading, SkeletonHeader, SkeletonTabs } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function AccountLoading() {
  return (
    <RouteLoading>
      <Skeleton className="mb-2 h-3 w-24" />
      <SkeletonHeader actions={3} />
      <SkeletonTabs count={4} />
      <TabSkeleton tab="overview" />
    </RouteLoading>
  );
}
