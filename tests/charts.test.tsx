import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heatmap, type HeatmapCell } from '@/components/charts/Heatmap';
import { SeriesChart, seriesColor, toneColor } from '@/components/charts/SeriesChart';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const rows = Array.from({ length: 90 }, (_, i) => ({ day: `d${i}`, a: i % 7 === 0 ? null : i * 10, b: 5 }));

describe('SeriesChart', () => {
  it.each(['line', 'area', 'bar'] as const)('%s: renders a legend for every series without crashing (90 days, gaps)', (kind) => {
    const { container } = render(<SeriesChart kind={kind} data={rows} xKey="day" series={[{ key: 'a', label: '@brand.official' }, { key: 'b', label: '@studio' }]} title="Reach" />);
    expect(screen.getByText('@brand.official')).toBeInTheDocument();
    expect(screen.getByText('@studio')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i); // tokens only
  });

  it('colours cycle through the six chart tokens', () => {
    expect([0, 5, 6].map(seriesColor)).toEqual(['var(--chart-1)', 'var(--chart-6)', 'var(--chart-1)']);
  });

  it('a series with a tone uses the success / danger token (legend and marks); the others keep their chart colour', () => {
    const { container } = render(<SeriesChart kind="bar" data={rows} xKey="day" series={[{ key: 'a', label: 'Follows', tone: 'good' }, { key: 'b', label: 'Unfollows', tone: 'bad' }, { key: 'a', label: 'Plain' }]} title="Flow" formatLabel={(v) => `${v} · 2 posts`} />);
    const dots = [...container.querySelectorAll('[data-slot="series-chart"] li > span[aria-hidden="true"]')].map((s) => (s as HTMLElement).style.background);
    expect(dots).toEqual(['var(--success)', 'var(--danger)', 'var(--chart-3)']);
    expect(toneColor).toEqual({ good: 'var(--success)', bad: 'var(--danger)' });
  });

  it('a very long account name truncates in the legend', () => {
    render(<SeriesChart kind="line" data={rows} xKey="day" series={[{ key: 'a', label: 'a'.repeat(200) }]} title="Reach" />);
    expect(screen.getByText('a'.repeat(200)).className).toContain('truncate');
  });
});

describe('Heatmap', () => {
  const cells = (f: (h: number) => Partial<HeatmapCell>): HeatmapCell[] => Array.from({ length: 24 }, (_, h) => ({ value: null, lowSample: false, label: `h${h}`, ...f(h) }));
  const hours = Array.from({ length: 24 }, (_, h) => `${h}:00`);

  it('is a table with a caption, row headers and screen-reader text per cell', () => {
    render(<Heatmap caption="Best time to post" columns={hours} rows={[{ label: 'Mon', cells: cells((h) => ({ value: h, label: `Mon ${h}:00 · ${h}` })) }]} lowLabel="Low" highLabel="High" />);
    const table = screen.getByRole('table', { name: 'Best time to post' });
    expect(within(table).getByRole('rowheader', { name: 'Mon' })).toBeInTheDocument();
    expect(within(table).getByText('Mon 23:00 · 23')).toHaveClass('sr-only');
    expect(table.innerHTML).toContain('var(--primary) 94%');
  });

  it('low-sample cells are greyed and do not set the scale; all-empty grid has no NaN', () => {
    const { container } = render(<Heatmap caption="c" columns={hours} rows={[{ label: 'Tue', cells: cells((h) => (h === 1 ? { value: 1000, lowSample: true } : h === 2 ? { value: 10 } : {})) }]} lowLabel="Low" highLabel="High" />);
    expect(container.querySelectorAll('[data-low]')).toHaveLength(1);
    expect(container.innerHTML).toContain('var(--primary) 94%'); // the 10 is the max, the low-sample 1000 is ignored
    const empty = render(<Heatmap caption="e" columns={hours} rows={[{ label: 'Wed', cells: cells(() => ({})) }]} lowLabel="Low" highLabel="High" />);
    expect(empty.container.innerHTML).not.toContain('NaN');
  });
});
