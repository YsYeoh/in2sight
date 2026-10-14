import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from '@/components/charts/Sparkline';
import { ChartCard } from '@/components/shared/ChartCard';
import { DeltaPill, StatCard } from '@/components/shared/StatCard';

describe('StatCard', () => {
  it('shows label, value, the delta and its comparison', () => {
    render(<StatCard label="Reach" value="12.3K" delta={{ text: '+12.5%', direction: 'up', tone: 'good' }} comparison="vs previous 30 days" note="unused" />);
    expect(screen.getByText('Reach')).toBeInTheDocument();
    expect(screen.getByText('12.3K')).toBeInTheDocument();
    expect(screen.getByText('+12.5%')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByText('vs previous 30 days')).toBeInTheDocument();
    expect(screen.queryByText('unused')).toBeNull();
  });

  it('without a delta it states why (numbers always come with a comparison or a reason)', () => {
    render(<StatCard label="Reach" value="—" comparison="vs previous 30 days" note="Not enough history to compare yet" />);
    expect(screen.getByText('Not enough history to compare yet')).toBeInTheDocument();
    expect(screen.queryByText('vs previous 30 days')).toBeNull();
  });

  it('a very long label or value truncates instead of widening the card', () => {
    const long = 'x'.repeat(300);
    render(<StatCard label={long} value={long} comparison="c" />);
    for (const el of screen.getAllByText(long)) expect(el.className).toContain('truncate');
  });
});

describe('DeltaPill', () => {
  it('bad tone uses the destructive token, never a raw colour', () => {
    render(<DeltaPill delta={{ text: '-20.0%', direction: 'down', tone: 'bad' }} />);
    const pill = screen.getByText('-20.0%');
    expect(pill.className).toContain('text-destructive');
    expect(pill.className).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
});

describe('Sparkline', () => {
  it('draws one polyline per run of data and breaks at gaps', () => {
    const { container } = render(<Sparkline data={[1, 2, null, 3, 4]} />);
    expect(container.querySelectorAll('polyline')).toHaveLength(2);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('renders nothing with fewer than two points or a flat/empty series without NaN', () => {
    expect(render(<Sparkline data={[null, 5]} />).container.innerHTML).toBe('');
    const { container } = render(<Sparkline data={[0, 0, 0]} />);
    expect(container.querySelector('polyline')?.getAttribute('points')).not.toContain('NaN');
  });
});

describe('ChartCard', () => {
  it('title as a heading, summary for screen readers, table fallback collapsed', () => {
    render(
      <ChartCard title="Reach by account" summary="Daily reach for 2 accounts" table={<table aria-label="data" />} tableLabel="Show as table">
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.getByRole('heading', { name: 'Reach by account' })).toBeInTheDocument();
    expect(screen.getByText('Daily reach for 2 accounts')).toHaveClass('sr-only');
    expect(screen.getByText('Show as table').closest('details')).not.toHaveAttribute('open');
  });
});
