import { RouteLoading, SkeletonHeader, SkeletonTabs } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader />
      <SkeletonTabs count={3} />
      <Skeleton className="h-64 rounded-[var(--rm)]" />
    </RouteLoading>
  );
}
