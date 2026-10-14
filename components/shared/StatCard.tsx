import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatDelta {
  text: string; // already formatted and signed, e.g. "+12.5%" or "+0.4 pp"
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
}

const TONE = {
  good: 'bg-success/10 text-success',
  bad: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
} as const;
const ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** Signed change with an arrow; colour follows good/bad (not up/down), and the sign is always in the text. */
export function DeltaPill({ delta, className }: { delta: StatDelta; className?: string }) {
  const Icon = ICON[delta.direction];
  return (
    <span data-tone={delta.tone} className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-xs font-medium tabular-nums whitespace-nowrap', TONE[delta.tone], className)}>
      <Icon aria-hidden="true" className="size-3" />
      {delta.text}
    </span>
  );
}

/**
 * A KPI tile: label, value, and ALWAYS a comparison line (SPEC §7b): the delta + "vs previous N days", or the reason
 * the comparison is missing (`note`).
 */
export function StatCard({ label, value, delta, comparison, note, spark, className }: { label: string; value: string; delta?: StatDelta | null; comparison: string; note?: string; spark?: ReactNode; className?: string }) {
  return (
    <Card className={cn('min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1', className)}>
      <CardContent className="grid min-w-0 gap-1">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-[length:var(--fv)] font-semibold leading-tight tabular-nums">{value}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {delta ? <DeltaPill delta={delta} /> : null}
          <span className="min-w-0 text-muted-foreground">{delta ? comparison : (note ?? comparison)}</span>
        </div>
        {spark ? <div className="mt-1">{spark}</div> : null}
      </CardContent>
    </Card>
  );
}
