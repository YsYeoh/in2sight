import type { Tag } from '@/lib/analysis/types';
import { TAG_COLORS } from '@/lib/tags';
import { cn } from '@/lib/utils';

/** A tag chip in its chart-token colour. Unknown colours fall back to chart-1 (the value ends up in a CSS var()). */
export function TagBadge({ tag, className }: { tag: Tag; className?: string }) {
  const color = (TAG_COLORS as readonly string[]).includes(tag.color) ? tag.color : 'chart-1';
  return (
    <span
      className={cn('inline-flex max-w-40 items-center gap-1 rounded-full border px-1.5 py-px text-xs text-foreground', className)}
      style={{ background: `color-mix(in srgb, var(--${color}) 14%, transparent)`, borderColor: `color-mix(in srgb, var(--${color}) 40%, transparent)` }}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--${color})` }} />
      <span className="min-w-0 truncate" dir="auto">
        {tag.name}
      </span>
    </span>
  );
}
