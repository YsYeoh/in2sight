import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ScoreTable, VerdictLine } from '@/components/post-lab/Scorecard';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { ScoreRow } from '@/lib/analysis/post-lab';
import { DEFAULT_PREFS } from '@/lib/prefs';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
const row = (o: Partial<ScoreRow> & Pick<ScoreRow, 'id'>): ScoreRow => ({ kind: 'count', lowerIsBetter: false, value: null, reason: null, n: 0, median: null, percentile: null, delta: null, ...o });
/** The desktop table (DataTable also renders phone cards with the same text). */
const table = () => within(screen.getByRole('table'));
const cells = (name: string) => table().getByRole('cell', { name }).closest('tr')!;

describe('ScoreTable', () => {
  it('each number with your median (n), its percentile and the difference; rates in points, durations in seconds', () => {
    wrap(
      <ScoreTable
        title="Scorecard"
        subtitle="vs 30"
        rows={[
          row({ id: 'reach', value: 1234, n: 12, median: 1000, percentile: 92, delta: 0.234 }),
          row({ id: 'engagementRate', kind: 'percent', value: 0.081, n: 12, median: 0.069, percentile: 71, delta: 0.012 }),
          row({ id: 'skipRate', kind: 'percent', lowerIsBetter: true, value: 0.5, n: 6, median: 0.4, percentile: 83, delta: 0.1 }),
          row({ id: 'avgWatch', kind: 'duration', value: 4200, n: 6, median: 3000, percentile: 60, delta: 0.4 }),
        ]}
      />,
    );
    const reach = within(cells('Reach'));
    expect(reach.getByText('1,234')).toBeInTheDocument();
    expect(reach.getByText('1,000 (n = 12)')).toBeInTheDocument();
    expect(reach.getByText('92nd')).toBeInTheDocument();
    expect(reach.getByText('+23.4%').closest('[data-tone]')).toHaveAttribute('data-tone', 'good');
    expect(within(cells('Engagement rate')).getByText('+1.2 pp')).toBeInTheDocument();
    expect(within(cells('Skip rate')).getByText('+10.0 pp').closest('[data-tone]')).toHaveAttribute('data-tone', 'bad'); // lower is better
    expect(within(cells('Average watch time')).getByText('4.2 s')).toBeInTheDocument();
  });

  it('a missing number shows a short reason (explained under the table); no comparison below the guard says so', () => {
    wrap(
      <ScoreTable
        title="Scorecard"
        subtitle="vs 30"
        rows={[row({ id: 'followsPer1k', kind: 'per1k', reason: 'unsupported' }), row({ id: 'profileVisits', reason: 'not_captured' }), row({ id: 'reach', value: 50, n: 3 })]}
      />,
    );
    expect(within(cells('Follows per 1,000 reach')).getByText('Not reported')).toBeInTheDocument();
    expect(within(cells('Reach')).getAllByText('—')).toHaveLength(3); // median, percentile, difference
    expect(screen.getByText(/Instagram doesn't report this number for this format/)).toBeInTheDocument();
    expect(screen.getByText(/collected while a post is under 30 days old/)).toBeInTheDocument();
    expect(screen.getByText('Comparisons need 5+ earlier posts of this format that have the number.')).toBeInTheDocument();
  });
});

describe('VerdictLine', () => {
  const reach = row({ id: 'reach', value: 2500, n: 30, median: 1000, percentile: 98 });
  it('the chip and why', () => {
    wrap(<VerdictLine verdict="breakout" reach={reach} story={false} />);
    expect(screen.getByText('Breakout')).toHaveAttribute('data-verdict', 'breakout');
    expect(screen.getByText('Reach is 2.5× your median of the last 30 posts of this format.')).toBeInTheDocument();
  });

  it('too early, a percentile rank, and no verdict with the reason', () => {
    const { unmount } = wrap(<VerdictLine verdict="too_early" reach={reach} story />);
    expect(screen.getByText('The Story is still live: its final numbers come when it expires.')).toBeInTheDocument();
    unmount();
    const r2 = wrap(<VerdictLine verdict="above" reach={{ ...reach, percentile: 80 }} story={false} />);
    expect(screen.getByText('Reach is higher than 80% of your last 30 posts of this format.')).toBeInTheDocument();
    r2.unmount();
    const r3 = wrap(<VerdictLine verdict={null} reach={row({ id: 'reach', value: 10, n: 3 })} story={false} />);
    expect(screen.getByText('Needs 5+ earlier posts of this format with reach to compare (3 so far).')).toBeInTheDocument();
    expect(document.querySelector('[data-verdict]')).toBeNull();
    r3.unmount();
    wrap(<VerdictLine verdict={null} reach={row({ id: 'reach', reason: 'needs_5_viewers' })} story />);
    expect(screen.getByText('Instagram shares Story insights only from 5 viewers.')).toBeInTheDocument();
  });
});
