import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface HeatmapCell {
  value: number | null;
  lowSample: boolean; // greyed out: too few posts behind it
  label: string; // full text for screen readers and the native tooltip, e.g. "Wed 20:00 · 4.2% · 3 posts"
  href?: string; // drill-down: the cell becomes a link (its accessible name is `label`)
}

/**
 * Weekday × hour grid drawn as a real <table> (screen readers get rows/columns for free; no separate fallback).
 * Intensity = color-mix of --primary into --surface (tokens only, like docs/mockups/charts.js heat()).
 * At 360px the 24 columns shrink to ~11px squares; hour labels show every 3 hours.
 */
export function Heatmap({ caption, columns, rows, lowLabel, highLabel }: { caption: string; columns: string[]; rows: { label: string; cells: HeatmapCell[] }[]; lowLabel: string; highLabel: string }) {
  const max = Math.max(0, ...rows.flatMap((r) => r.cells.filter((c) => !c.lowSample && c.value !== null).map((c) => c.value as number)));
  const shade = (c: HeatmapCell) => (c.value === null || c.lowSample || max <= 0 ? undefined : `color-mix(in srgb, var(--primary) ${Math.round(6 + (c.value / max) * 88)}%, var(--surface))`);
  return (
    <div data-slot="heatmap" className="min-w-0">
      <table className="w-full table-fixed border-separate border-spacing-0.5 text-[10px] text-muted-foreground">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-7" />
            {columns.map((c, i) => (
              <th key={c} scope="col" className="p-0 text-center font-normal">
                <span className={i % 3 === 0 ? undefined : 'sr-only'}>{c}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row" className="pr-1 text-left font-normal">
                {r.label}
              </th>
              {r.cells.map((c, i) => {
                const inner = (
                  <>
                    <span
                      aria-hidden="true"
                      data-low={c.lowSample || undefined}
                      className={cn('block aspect-square max-h-[22px] w-full rounded-[calc(var(--rs)*0.4)]', shade(c) ? undefined : 'bg-muted', c.lowSample && 'opacity-50')}
                      style={shade(c) ? { background: shade(c) } : undefined}
                    />
                    <span className="sr-only">{c.label}</span>
                  </>
                );
                return (
                  <td key={i} className="p-0" title={c.label}>
                    {c.href ? (
                      <Link href={c.href} className="block rounded-[calc(var(--rs)*0.4)] outline-none hover:ring-2 hover:ring-ring/50 focus-visible:ring-2 focus-visible:ring-ring">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div aria-hidden="true" className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {lowLabel}
        <span className="h-1.5 w-24 rounded-full" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 6%, var(--surface)), var(--primary))' }} />
        {highLabel}
      </div>
    </div>
  );
}
