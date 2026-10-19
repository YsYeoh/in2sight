import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { StoryPanels } from '@/components/post-lab/StoryPanels';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Frame, Funnel, Sequence } from '@/lib/analysis/post-lab';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const frame = (id: string, hh: string, o: Partial<Frame> = {}): Frame => ({ id, postedAt: `2026-10-05T${hh}:00:00Z`, cover: 'ok', reach: null, views: null, exitRate: null, retention: null, current: false, ...o });
const view = (funnel: Funnel | null, sequence: Sequence) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <StoryPanels funnel={funnel} sequence={sequence} accountId={A} query="from=90d" />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('StoryPanels', () => {
  it('the funnel: each navigation as a count and a share of views, plus replies', () => {
    view({ views: 200, replies: 3, steps: [{ id: 'forward', value: 100, share: 0.5 }, { id: 'back', value: 10, share: 0.05 }, { id: 'exit', value: 30, share: 0.15 }, { id: 'swipe', value: null, share: null }] }, { frames: [], best: null, worst: null });
    expect(screen.getByText('Tapped forward').nextSibling).toHaveTextContent('100 · 50%');
    expect(screen.getByText('Swiped to the next account').nextSibling).toHaveTextContent('— · —');
    expect(screen.getByText('Replies').nextSibling).toHaveTextContent('3');
  });

  it('the day in order: other frames link to their own Post Lab with the scope; this Story, best and worst are marked', () => {
    view(null, {
      frames: [frame('a', '01', { reach: 100, retention: 1, exitRate: 0.05 }), frame('b', '02', { reach: 50, retention: 0.5, exitRate: 0.5, current: true }), frame('c', '03')],
      best: 'a',
      worst: 'b',
    });
    expect(screen.getByText('Instagram shares Story insights only from 5 viewers.')).toBeInTheDocument(); // no funnel data
    const list = within(screen.getByRole('list'));
    const items = list.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole('link')).toHaveAttribute('href', `/accounts/${A}/media/a?from=90d`);
    expect(within(items[0]).getByText('Best')).toBeInTheDocument();
    expect(within(items[0]).getByText('100% of first')).toBeInTheDocument();
    expect(items[1]).toHaveAttribute('aria-current', 'true');
    expect(within(items[1]).queryByRole('link')).toBeNull();
    expect(within(items[1]).getByText('Worst')).toBeInTheDocument();
    expect(within(items[1]).getByText('Exit 50%')).toBeInTheDocument();
    expect(within(items[2]).getByText('Reach —')).toBeInTheDocument();
  });
});
