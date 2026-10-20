import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PostsTab } from '@/components/account/PostsTab';
import { StoriesTab } from '@/components/account/StoriesTab';
import { CalendarView } from '@/components/calendar/CalendarView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildCalendar } from '@/lib/dashboard/calendar';
import { buildStories, type PostView } from '@/lib/dashboard/content';
import { ALL_TIME } from '@/lib/dashboard/lists';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }) })); // the toolbar's selects navigate

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const KL = { ...DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur' };
const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={KL} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
const reel: PostView = { id: '42', mediaType: 'REELS', postedAt: '2026-10-07T12:00:00Z', permalink: null, caption: 'Behind the scenes', reach: 1200, views: 3400, likes: 40, comments: 5, saves: 3, shares: 2, engagementRate: 0.0417, cover: 'ok', slides: null, tags: [] };
const LABEL = 'Reel · 7 Oct 2026 20:00';
const LAB = `/accounts/${A}/media/42`; // no range (ux-polish §8 call 1)

describe('Posts tab → Post Lab', () => {
  it('a flask link per row and tile, and "Open Post Lab" in the drawer, none with a range', async () => {
    const user = userEvent.setup();
    wrap(<PostsTab posts={[reel]} total={1} page={1} state={{ dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null }} tags={[]} today="2026-10-15" scope={{ from: '90d' }} accountId={A} setPostTags={vi.fn()} />);
    const links = screen.getAllByRole('link', { name: `Open the Post Lab of ${LABEL}` }); // table row, phone card and grid tile
    expect(links.length).toBeGreaterThan(1);
    for (const l of links) expect(l).toHaveAttribute('href', LAB);
    await user.click(screen.getAllByRole('button', { name: `Details of ${LABEL}` })[0]);
    const dialog = await screen.findByRole('dialog', { name: LABEL });
    expect(within(dialog).getByRole('link', { name: 'Open Post Lab' })).toHaveAttribute('href', LAB);
  });

  it('without an account id nothing links to a Post Lab (unchanged behaviour)', () => {
    wrap(<PostsTab posts={[reel]} total={1} page={1} state={{ dates: ALL_TIME, q: '', format: null, tag: null, sort: 'newest', page: 1, view: null }} tags={[]} today="2026-10-15" setPostTags={vi.fn()} />);
    expect(screen.queryAllByRole('link', { name: /Post Lab/ })).toHaveLength(0);
  });
});

describe('Stories tab → Post Lab', () => {
  it('each frame links to its Post Lab, and so does its drawer; no range rides along (ux-polish §8 call 1)', async () => {
    const user = userEvent.setup();
    const stories = buildStories([{ id: '9', postedAt: '2026-10-15T01:00:00Z', expiresAt: '2026-10-16T01:00:00Z', permalink: null, snapshots: [], cover: 'ok' }], new Date('2026-10-15T04:00:00Z'));
    wrap(<StoriesTab stories={stories} items={1} days={1} page={1} state={{ dates: ALL_TIME, measured: null, sort: 'newest', page: 1 }} today="2026-10-15" accountId={A} scope={{ from: '7d' }} />);
    const title = 'Story · 15 Oct 2026 09:00';
    expect(screen.getByRole('link', { name: `Open the Post Lab of ${title}` })).toHaveAttribute('href', `/accounts/${A}/media/9`);
    await user.click(screen.getByRole('button', { name: `Details of ${title}` }));
    const dialog = await screen.findByRole('dialog', { name: title });
    expect(within(dialog).getByRole('link', { name: 'Open Post Lab' })).toHaveAttribute('href', `/accounts/${A}/media/9`);
  });
});

describe('Calendar → Post Lab', () => {
  it('each item of the day list links to its Post Lab with the Calendar’s scope', () => {
    const today = '2026-10-15';
    const scope = resolveScope(parseTimeScope(new URLSearchParams('month=2026-10')), today, '2025-01-01');
    const media = [{ id: 'p1', accountId: A, mediaType: 'IMAGE' as const, postedAt: '2026-10-15T01:00:00Z', permalink: null, caption: 'Hello', cover: 'ok' as const, slides: null }];
    wrap(<CalendarView model={buildCalendar(scope.range, media, { weekStart: 'mon', tz: 'Asia/Kuala_Lumpur', today })} scope={scope} today={today} accounts={[{ id: A, username: 'brand' }]} account={null} truncated={false} />);
    const links = screen.getAllByRole('link', { name: 'Open the Post Lab of Image · @brand · 09:00' }); // the day list (md+) and the phone agenda
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', `/accounts/${A}/media/p1?from=2026-10-01&to=2026-10-31`); // the canonical scope
  });
});
