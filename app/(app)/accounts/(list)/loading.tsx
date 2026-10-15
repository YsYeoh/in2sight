import { RouteLoading, SkeletonGrid, SkeletonHeader, SkeletonTable } from '@/components/shared/Skeletons';

// Lives in the (list) group on purpose: at accounts/ it would also wrap /accounts/[id] (see Plan 10 decisions).
export default function AccountsLoading() {
  return (
    <RouteLoading>
      <SkeletonHeader actions={1} />
      <SkeletonTable rows={5} className="max-md:hidden" />
      <SkeletonGrid count={3} className="md:hidden" itemClassName="h-28" />
    </RouteLoading>
  );
}
