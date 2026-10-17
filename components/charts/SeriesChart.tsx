'use client';

// Line / area / bar chart over a shared x axis, styled like docs/mockups/charts.js: --chart-1…6 colours, 2px lines,
// dashed horizontal grid, token-styled tooltip. Recharts 3 API (installed major): `responsive` sizes the chart from CSS,
// isAnimationActive="auto" (the default) skips the entry animation under prefers-reduced-motion.
import { useId } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

export interface Series {
  key: string; // property name in each data row
  label: string; // legend + tooltip name (already translated)
  muted?: boolean; // a secondary series (the comparison period): dashed line, lighter bar
}

export type ChartRow = Record<string, string | number | null>;

export const seriesColor = (i: number) => `var(--chart-${(i % 6) + 1})`;

/** The data index a chart click landed on. Recharts 3 reports it as a number or a numeric string; anything else is null. */
export function clickedIndex(s: { activeTooltipIndex?: number | string | null } | null | undefined): number | null {
  const v = s?.activeTooltipIndex;
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 10 };
const TOOLTIP_STYLE = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--rs)', boxShadow: 'var(--shadow)', fontSize: 'var(--lb)', color: 'var(--foreground)' };

export function SeriesChart({
  kind,
  data,
  xKey,
  series,
  title,
  desc,
  height = 220,
  formatX = String,
  formatY = String,
  animate = true,
  onPointClick,
}: {
  kind: 'line' | 'area' | 'bar';
  data: ChartRow[];
  xKey: string;
  series: Series[];
  title: string;
  desc?: string;
  height?: number;
  formatX?: (v: string) => string;
  formatY?: (v: number) => string;
  animate?: boolean; // false for print/PDF: the snapshot must show the finished chart
  onPointClick?: (index: number) => void; // drill-down: a click on a bar / point. Mouse only: the linked table holds the keyboard path
}) {
  const gid = useId().replace(/:/g, '');
  const anim = animate ? ('auto' as const) : false;
  const onClick = onPointClick
    ? (state: { activeTooltipIndex?: number | string | null }) => {
        const i = clickedIndex(state);
        if (i !== null) onPointClick(i);
      }
    : undefined;
  const common = { data, responsive: true, style: { width: '100%', height, cursor: onPointClick ? 'pointer' : undefined }, title, desc, margin: { top: 8, right: 8, bottom: 0, left: 0 }, onClick };
  const parts = [
    <CartesianGrid key="grid" vertical={false} stroke="var(--border)" strokeDasharray="3 4" />,
    <XAxis key="x" dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => formatX(String(v))} minTickGap={24} />,
    <YAxis key="y" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatY(Number(v))} />,
    <Tooltip key="tip" contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 500 }} labelFormatter={(v) => formatX(String(v))} formatter={(v) => (typeof v === 'number' ? formatY(v) : String(v ?? ''))} />,
  ];

  return (
    <div data-slot="series-chart" className="min-w-0">
      <ul className="mb-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: seriesColor(i) }} />
            <span className="max-w-48 truncate">{s.label}</span>
          </li>
        ))}
      </ul>
      {kind === 'line' ? (
        <LineChart {...common}>
          {parts}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={seriesColor(i)} strokeWidth={2} strokeDasharray={s.muted ? '4 3' : undefined} dot={false} activeDot={{ r: 4, fill: 'var(--surface)', strokeWidth: 2 }} connectNulls={false} isAnimationActive={anim} />
          ))}
        </LineChart>
      ) : kind === 'area' ? (
        <AreaChart {...common}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={seriesColor(i)} stopOpacity={0.3} />
                <stop offset="1" stopColor={seriesColor(i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {parts}
          {series.map((s, i) => (
            <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={seriesColor(i)} strokeWidth={2} fill={`url(#${gid}-${i})`} connectNulls={false} isAnimationActive={anim} />
          ))}
        </AreaChart>
      ) : (
        <BarChart {...common}>
          {parts}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={seriesColor(i)} fillOpacity={s.muted ? 0.45 : 1} radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={anim} />
          ))}
        </BarChart>
      )}
    </div>
  );
}
