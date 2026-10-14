import { Skeleton } from '@/components/ui/skeleton';

export default function OverviewLoading() {
  return (
    <div aria-busy="true" className="grid gap-[var(--gp)]">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-[var(--gp)] lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-[var(--gp)] sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    </div>
  );
}
