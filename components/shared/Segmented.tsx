'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A small set of exclusive options as ONE control (UI standard 18): a --ctl-high bordered group of small buttons with
 * aria-pressed on the chosen one; it wraps instead of overflowing at 360 px. More than four options or long labels: use a
 * native select instead.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className }: { label: string; value: T; options: readonly SegmentedOption<T>[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex min-h-[var(--ctl)] max-w-full flex-wrap items-center gap-0.5 rounded-md border border-input bg-background p-0.5', className)}>
      {options.map((o) => (
        <Button key={o.value} type="button" size="sm" variant={o.value === value ? 'secondary' : 'ghost'} aria-pressed={o.value === value} onClick={() => o.value !== value && onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  );
}
