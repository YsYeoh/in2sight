import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { Velocity } from '@/components/post-lab/Velocity';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Velocity as VelocityModel, VelocityPoint } from '@/lib/analysis/post-lab';
import { DEFAULT_PREFS } from '@/lib/prefs';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const point = (id: VelocityPoint['id'], o: Partial<VelocityPoint> = {}): VelocityPoint => ({ id, due: true, reach: null, views: null, medianReach: null, medianViews: null, nReach: 0, nViews: 0, ...o });
const view = (v: VelocityModel) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <Velocity velocity={v} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('Velocity', () => {
  it('the lead sentence, one chart per metric, and a table that tells "not yet" from "no snapshot"', () => {
    view({
      points: [
        point('1h', { reach: 50, views: 80, medianReach: 20, nReach: 9, medianViews: 40, nViews: 9 }),
        point('6h', { reach: null, medianReach: 100, nReach: 9 }),
        point('24h', { reach: 600, medianReach: 200, nReach: 8 }),
        point('48h', { due: false }),
        point('7d', { due: false }),
      ],
      lead: { at: '24h', metric: 'reach', ratio: 3, n: 8 },
    });
    expect(screen.getByRole('heading', { name: 'Velocity' })).toBeInTheDocument();
    expect(screen.getByText('At 24 h this post had 3× the median reach of 8 comparable posts.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reach since posting' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Views since posting' })).toBeInTheDocument();
    const reach = within(screen.getByRole('table', { name: 'Reach since posting' }));
    expect(reach.getByRole('row', { name: /^1 h/ })).toHaveTextContent('1 h5020 (n = 9)');
    expect(reach.getByRole('row', { name: /^6 h/ })).toHaveTextContent('6 hno snapshot100 (n = 9)');
    expect(reach.getByRole('row', { name: /^48 h/ })).toHaveTextContent('48 hnot yet—');
  });

  it('without comparable snapshots it says so', () => {
    view({ points: [point('1h'), point('6h'), point('24h')], lead: null });
    expect(screen.getByText('Not enough comparable snapshots yet to compare the pace.')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Views since posting' })).getAllByRole('row')).toHaveLength(4); // header + 3 Story checkpoints
  });
});
