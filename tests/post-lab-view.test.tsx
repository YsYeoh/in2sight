import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PostLabUnavailable, PostLabView } from '@/components/post-lab/PostLabView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildPostLab, type LabItem, type LabValues } from '@/lib/analysis/post-lab';
import { parseLabParams } from '@/lib/post-lab/params';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const NOW = new Date('2026-10-20T00:00:00Z');
const TZ = 'Asia/Kuala_Lumpur';
const NONE: LabValues = { reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null };
const item = (id: string, o: Partial<LabItem> = {}): LabItem => ({ id, accountId: A, mediaType: 'IMAGE', postedAt: '2026-10-01T02:00:00Z', expiresAt: null, goneAt: null, permalink: null, caption: null, tagIds: [], cover: 'ok', slides: null, measuredAt: '2026-10-09T02:00:00Z', latest: { ...NONE, reach: 100 }, points: {}, ...o });
const peers = (n: number, o: Partial<LabItem> = {}) => Array.from({ length: n }, (_, i) => item(`p${i}`, { postedAt: new Date(Date.parse('2026-09-30T02:00:00Z') - i * 86_400_000).toISOString(), latest: { ...NONE, reach: 100 + 10 * i }, ...o }));
const TAGS = [{ id: 't1', name: 'Promo', color: 'chart-1' }];

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

function view(main: LabItem, o: { peers?: LabItem[]; day?: LabItem[]; sp?: Record<string, string> } = {}) {
  const params = parseLabParams(o.sp ?? { from: '90d' });
  const model = buildPostLab({ item: main, peers: o.peers ?? peers(8), day: o.day ?? [], followers: {} }, { now: NOW, tz: TZ, peers: params.peers, er: params.er });
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <PostLabView model={model} account={{ id: A, username: 'brand' }} tags={TAGS} params={params} setPostTags={vi.fn()} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('PostLabView', () => {
  it('header: back link with the scope, format and account, the whole caption, tags with the editor, Instagram link, verdict', () => {
    view(item('42', { caption: 'Line one\nLine two #summer', tagIds: ['t1'], permalink: 'https://www.instagram.com/p/x/', latest: { ...NONE, reach: 500, likes: 30 } }));
    expect(screen.getByRole('link', { name: 'Back to Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts&from=90d`);
    expect(screen.getByRole('heading', { level: 1, name: 'Image · @brand' })).toBeInTheDocument();
    expect(screen.getByText(/Line one\s+Line two #summer/)).toBeInTheDocument();
    expect(screen.getByText('Promo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit tags/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/p/x/');
    expect(screen.getByRole('link', { name: 'Followers around this post' })).toHaveAttribute('href', `/explorer?m=posts%2CavgReach%2CpostEngagementRate&by=post&acc=${A}&fmt=IMAGE&item=42&from=90d`);
    expect(screen.getByRole('img', { name: 'Line one Line two #summer' })).toBeInTheDocument(); // the cover's alt = the caption snippet
    expect(document.querySelector('[data-verdict="breakout"]')).not.toBeNull(); // 500 ≥ 2 × median 135
    expect(screen.getByRole('heading', { name: 'Scorecard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Velocity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Caption lab' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Watch time' })).toBeNull();
  });

  it('toggles are links that keep the scope; the current one is marked', () => {
    view(item('42'), { sp: { from: '90d', peers: '90' } });
    const peersNav = within(screen.getByRole('navigation', { name: 'Compare with' }));
    expect(peersNav.getByRole('link', { name: 'Last 30' })).toHaveAttribute('href', `/accounts/${A}/media/42?from=90d`);
    expect(peersNav.getByRole('link', { name: 'Last 90' })).toHaveAttribute('aria-current', 'true');
    const er = within(screen.getByRole('navigation', { name: 'Engagement rate' }));
    expect(er.getByRole('link', { name: 'per followers' })).toHaveAttribute('href', `/accounts/${A}/media/42?from=90d&peers=90&er=followers`);
  });

  it('similar posts link to their own Post Lab with the scope; a gone post says so', () => {
    view(item('42', { goneAt: '2026-10-10T00:00:00Z' }), { peers: peers(8, { tagIds: [] }) });
    const similar = within(screen.getByRole('heading', { name: 'Similar posts' }).closest('[data-slot="card"]') as HTMLElement);
    expect(similar.getAllByRole('link')).toHaveLength(6);
    expect(similar.getAllByRole('link')[0]).toHaveAttribute('href', `/accounts/${A}/media/p0?from=90d`);
    expect(screen.getByText('No longer on Instagram')).toBeInTheDocument();
  });

  it('a Reel gets the watch-time panel; a live Story gets the funnel and the sequence, no engagement toggle, no caption lab', () => {
    const r = view(item('r', { mediaType: 'REELS', latest: { ...NONE, reach: 100, avgWatchMs: 4200 } }), { peers: peers(6, { mediaType: 'REELS' }) });
    expect(screen.getByRole('heading', { name: 'Watch time' })).toBeInTheDocument();
    r.unmount();
    const s = item('s', { mediaType: 'STORY', postedAt: '2026-10-19T20:00:00Z', expiresAt: '2026-10-20T20:00:00Z', latest: { ...NONE, reach: 40, views: 50, exits: 5, tapsForward: 20 } });
    view(s, { peers: [], day: [item('s0', { mediaType: 'STORY', postedAt: '2026-10-19T19:00:00Z', latest: { ...NONE, reach: 80, views: 90, exits: 9 } }), s] });
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Stories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What viewers did' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "That day's Stories" })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Engagement rate' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Caption lab' })).toBeNull();
  });
});

describe('PostLabUnavailable', () => {
  it('explains the missing migration and links back', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PostLabUnavailable back={`/accounts/${A}?tab=posts`} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('The Post Lab needs a database update')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts`);
  });
});
