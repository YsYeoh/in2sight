import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heatmap, type HeatmapCell } from '@/components/charts/Heatmap';
import { clickedIndex, SeriesChart } from '@/components/charts/SeriesChart';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('clickedIndex (chart drill-down)', () => {
  it('accepts the index as a number or a numeric string (Recharts 3 uses strings)', () => {
    expect(clickedIndex({ activeTooltipIndex: 3 })).toBe(3);
    expect(clickedIndex({ activeTooltipIndex: '12' })).toBe(12);
    expect(clickedIndex({ activeTooltipIndex: 0 })).toBe(0);
  });

  it('anything else is no click target', () => {
    for (const v of [undefined, null, -1, 1.5, '', 'a', '1e3', '-2', Number.NaN]) expect(clickedIndex({ activeTooltipIndex: v as number })).toBeNull();
    expect(clickedIndex(null)).toBeNull();
    expect(clickedIndex(undefined)).toBeNull();
  });

  it('a clickable chart and a muted (comparison) series render without crashing', () => {
    const data = [{ k: 'a', v: 1, p: 2 }, { k: 'b', v: 3, p: null }];
    for (const kind of ['line', 'bar'] as const) {
      const { unmount } = render(<SeriesChart kind={kind} data={data} xKey="k" series={[{ key: 'v', label: 'Now' }, { key: 'p', label: 'Before', muted: true }]} title="t" onPointClick={() => {}} />);
      expect(screen.getByText('Before')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Heatmap drill links', () => {
  const hours = Array.from({ length: 24 }, (_, h) => `${h}:00`);
  const cells: HeatmapCell[] = Array.from({ length: 24 }, (_, h) => ({ value: h, lowSample: false, label: `Mon ${h}:00`, href: h === 20 ? '/explorer?by=post&wd=1&hr=20' : undefined }));

  it('a cell with an href is a link named by its label; the others stay plain cells', () => {
    render(<Heatmap caption="Best time" columns={hours} rows={[{ label: 'Mon', cells }]} lowLabel="Low" highLabel="High" />);
    const table = screen.getByRole('table', { name: 'Best time' });
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Mon 20:00');
    expect(links[0]).toHaveAttribute('href', '/explorer?by=post&wd=1&hr=20');
  });
});
