import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { AudienceTab } from '@/components/account/AudienceTab';
import { StoriesTab } from '@/components/account/StoriesTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildAudience } from '@/lib/dashboard/audience';
import { buildStories, type StoryView } from '@/lib/dashboard/content';
import { ALL_TIME } from '@/lib/dashboard/lists';
import type { StoryRow } from '@/lib/dashboard/detail-read';
import { DEFAULT_PREFS } from '@/lib/prefs';

const motion = vi.hoisted(() => ({ heavy: false }));
vi.mock('@/lib/motion', () => ({ useHeavyMotion: () => motion.heavy }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) })); // the toolbar's selects navigate
beforeEach(() => {
  motion.heavy = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); // jsdom has no canvas; the globe bails out
});
afterEach(() => vi.restoreAllMocks());

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

const NOW = new Date('2026-10-15T04:00:00Z');
const snap = (capturedAt: string, views: number, exits: number) => ({ capturedAt, reach: views - 1, views, replies: 1, shares: 0, interactions: 2, tapsForward: 3, tapsBack: 0, exits });
const story = (id: string, postedAt: string, snapshots: ReturnType<typeof snap>[]): StoryRow => ({ id, postedAt, expiresAt: new Date(Date.parse(postedAt) + 86_400_000).toISOString(), permalink: id === 's1' ? 'https://www.instagram.com/stories/x/1/' : null, snapshots });

describe('StoriesTab', () => {
  const tab = (stories: StoryView[], truncated = false) => <StoriesTab stories={stories} items={stories.length} days={stories.length} page={1} state={{ dates: ALL_TIME, measured: null, sort: 'newest', page: 1 }} today="2026-10-15" truncated={truncated} />;
  it('zero stories: an empty state that explains why', () => {
    wrap(tab([]));
    expect(screen.getByRole('status')).toHaveTextContent(en.pages.account.stories.empty);
  });

  it('live and expired stories with final numbers, exit rate and the needs-5-viewers reason', () => {
    const stories = buildStories(
      [story('s1', '2026-10-15T01:00:00Z', [snap('2026-10-15T01:30:00Z', 10, 1), snap('2026-10-15T02:00:00Z', 20, 2)]), story('s2', '2026-10-13T01:00:00Z', [snap('2026-10-13T23:30:00Z', 50, 5)]), story('s3', '2026-10-12T01:00:00Z', [])],
      NOW,
    );
    wrap(tab(stories));
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText(en.pages.account.stories.live)).toBeInTheDocument();
    expect(within(cards[0]).getByText('10.0%')).toBeInTheDocument(); // 2 exits ÷ 20 views
    expect(within(cards[0]).getByText('2 snapshots so far')).toBeInTheDocument();
    expect(within(cards[0]).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(cards[1]).getByText(en.pages.account.stories.expired)).toBeInTheDocument();
    expect(within(cards[2]).getByText(en.analysis.reasons.needs_5_viewers)).toBeInTheDocument();
    expect(screen.getByText('3 Stories')).toBeInTheDocument();
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  it('a capped range says so', () => {
    const stories = buildStories([story('s9', '2026-10-15T01:00:00Z', [])], NOW);
    wrap(tab(stories, true));
    expect(screen.getByRole('status')).toHaveTextContent('Showing the newest 1 Stories.');
  });
});

describe('AudienceTab', () => {
  const day = '2026-10-14';
  const model = buildAudience({
    age_gender: { day, data: { '18-24|F': 30, '18-24|M': 10, '25-34|F': 20, '25-34|U': 5 } },
    country: { day, data: { MY: 60, SG: 20, XK: 5, ZZ: 5, ID: 2, TH: 2, PH: 2, VN: 2, JP: 1, KR: 1 } },
    city: { day, data: { 'Kuala Lumpur, Federal Territory of Kuala Lumpur': 30 } },
  });

  it('no audience data (under 100 followers): the reason, not empty charts', () => {
    wrap(<AudienceTab model={buildAudience({ age_gender: null, country: null, city: null })} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.analysis.reasons.needs_100_followers);
  });

  it('ranked countries with names, unknown country codes stay in the list, Other bucket, no globe without motion', () => {
    const { container } = wrap(<AudienceTab model={model} />);
    const countries = screen.getByRole('heading', { name: en.pages.account.audience.countries }).closest('[data-slot="card"]') as HTMLElement;
    const items = within(countries).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Malaysia');
    expect(items[0]).toContain('60.0%');
    expect(items.some((x) => x?.includes('ZZ') || x?.includes('Unknown Region'))).toBe(true);
    expect(items.at(-1)).toContain(en.pages.account.audience.other);
    expect(items).toHaveLength(9); // top 8 + Other
    expect(container.querySelector('canvas')).toBeNull(); // the accessible list is the baseline
    expect(screen.getByText('Kuala Lumpur, Federal Territory of Kuala Lumpur')).toBeInTheDocument();
    expect(screen.getByText('18-24')).toBeInTheDocument();
    expect(screen.getAllByText('Latest snapshot, 14 Oct 2026')).toHaveLength(3); // countries, cities, age and gender
  });

  it('the globe renders only when the motion gate allows it, and is hidden from assistive tech', async () => {
    motion.heavy = true;
    const { container } = wrap(<AudienceTab model={model} />);
    await vi.waitFor(() => expect(container.querySelector('canvas[data-slot="globe"]')).not.toBeNull());
    expect(container.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByText('Malaysia').length).toBeGreaterThan(0); // list still there
  });

  it('zh-CN country names', () => {
    wrap(<AudienceTab model={model} />, 'zh-CN');
    expect(screen.getByText('马来西亚')).toBeInTheDocument();
  });
});

describe('Globe animation lifecycle', () => {
  const points = [
    { code: 'MY', lat: 4, lon: 102, share: 0.6 },
    { code: 'XK', lat: 42.6, lon: 20.9, share: 0.1 },
  ];
  const ctx = () => new Proxy({ setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn() } as Record<string, unknown>, { set: () => true });

  it('draws with the dpr, stops on unmount and while the tab is hidden, resumes when visible', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(ctx() as unknown as CanvasRenderingContext2D);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7);
    const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const { default: Globe } = await import('@/components/account/Globe');
    const { unmount } = render(<Globe points={points} />);
    expect(raf).toHaveBeenCalledTimes(1); // first frame scheduled

    const hidden = vi.spyOn(document, 'visibilityState', 'get');
    hidden.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(caf).toHaveBeenCalledWith(7);
    const scheduled = raf.mock.calls.length;
    hidden.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(raf.mock.calls.length).toBe(scheduled + 1);

    caf.mockClear();
    unmount();
    expect(caf).toHaveBeenCalledWith(7);
    const after = raf.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(raf.mock.calls.length).toBe(after); // listener removed
  });
});
