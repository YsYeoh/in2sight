import { RouteLoading } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

// Only the section streams: the settings layout (header + section nav) stays on screen.
export default function SettingsSectionLoading() {
  return (
    <RouteLoading>
      <Skeleton className="h-10 w-full max-w-sm" />
      <Skeleton className="h-48 rounded-[var(--rm)]" />
      <Skeleton className="h-48 rounded-[var(--rm)]" />
    </RouteLoading>
  );
}
