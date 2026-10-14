import { cn } from '@/lib/utils';

/**
 * Tiny trend line for stat cards (plain SVG: 24+ of these on a page would be heavy as Recharts charts).
 * Decorative: the card states the number and its comparison in text. Colour = currentColor, set with a token class
 * such as `text-chart-1` or `text-destructive`. Gaps (null days) break the line instead of drawing a fake zero.
 */
export function Sparkline({ data, className, height = 32 }: { data: (number | null)[]; className?: string; height?: number }) {
  const vals = data.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * 100;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const segments: string[] = [];
  let cur: string[] = [];
  data.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) cur.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
    else if (cur.length) {
      segments.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) segments.push(cur.join(' '));
  return (
    <svg data-slot="sparkline" aria-hidden="true" focusable="false" className={cn('block w-full text-chart-1', className)} height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {segments.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
