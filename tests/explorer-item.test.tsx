import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import en from '@/messages/en.json';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { loadItem, type ItemDetail } from '@/lib/explorer/item';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const TZ = 'Asia/Kuala_Lumpur';

/** Owner-session fake: records table/rpc calls and modifiers; resolves each table/rpc to its queued result. */
function fakeDb(results: Record<string, { data?: unknown; error?: unknown }>) {
  const calls: unknown[][] = [];
  const chainFor = (name: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'order', 'limit']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[name] ?? { data: [], error: null }).then(res, rej);
    return chain;
  };
  return { db: { from: (t: string) => (calls.push(['from', t]), chainFor(t)), rpc: (n: string, a: unknown) => (calls.push(['rpc', n, a]), chainFor(n)) } as unknown as SupabaseClient, calls };
}

const MEDIA = { id: '42', account_id: A, media_type: 'REELS', posted_at: '2026-10-05T15:30:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hello', media_metrics: [{ captured_at: '2026-10-07T01:00:00Z', reach: 200, views: 900, likes: 10, comments: 5, saves: 3, shares: 2 }] };

describe('loadItem', () => {
  it('reads the item only from the given accounts, then its follower curve (owner-timezone day −1 … +2) and the reach split of that day', async () => {
    const { db, calls } = fakeDb({
      media: { data: [MEDIA], error: null },
      explorer_followers: { data: [{ at: '2026-10-05T23:00', followers: 1000 }, { at: 'junk', followers: null }], error: null },
      account_daily_breakdown: { data: [{ follow_type: 'FOLLOWER', value: 60 }, { follow_type: 'NON_FOLLOWER', value: 40 }, { follow_type: 'UNKNOWN', value: 5 }], error: null },
    });
    const d = await loadItem(db, '42', [A], TZ);
    expect(calls).toContainEqual(['in', 'account_id', [A]]);
    expect(d?.day).toBe('2026-10-05'); // 15:30 UTC = 23:30 in Kuala Lumpur
    expect(calls).toContainEqual(['rpc', 'explorer_followers', { p_account: A, p_from: '2026-10-03T16:00:00.000Z', p_to: '2026-10-07T16:00:00.000Z', p_tz: TZ, p_hourly: true }]);
    expect(calls).toContainEqual(['eq', 'product_type', 'REEL']);
    expect(d).toMatchObject({ measuredAt: '2026-10-07T01:00:00Z', followers: [{ at: '2026-10-05T23:00', followers: 1000 }], audience: { follower: 60, nonFollower: 40 } });
    expect(d?.item).toMatchObject({ id: '42', mediaType: 'REELS', reach: 200, permalink: 'https://www.instagram.com/reel/x/' });
  });

  it('an item outside the accounts (or none at all) is null; no breakdown rows = no audience slice; errors are fixed text', async () => {
    expect(await loadItem(fakeDb({ media: { data: [], error: null } }).db, '42', [A], TZ)).toBeNull();
    expect(await loadItem(fakeDb({}).db, '42', [], TZ)).toBeNull();
    expect((await loadItem(fakeDb({ media: { data: [MEDIA], error: null } }).db, '42', [A], TZ))?.audience).toBeNull();
    await expect(loadItem(fakeDb({ media: { error: { message: 'secret' } } }).db, '42', [A], TZ)).rejects.toThrow('explorer read: item failed');
  });
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const DETAIL: ItemDetail = {
  item: { id: '42', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T15:30:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hello', reach: 200, views: 900, likes: 10, comments: 5, saves: 3, shares: 2 },
  measuredAt: '2026-10-07T01:00:00Z',
  day: '2026-10-05',
  followers: [{ at: '2026-10-05T23:00', followers: 1000 }, { at: '2026-10-06T00:00', followers: 1004 }],
  audience: { follower: 60, nonFollower: 40 },
};

function view(detail: ItemDetail | null) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ItemPanel detail={detail} username="brand" tabHref={`/accounts/${A}?tab=posts&from=90d`} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('ItemPanel', () => {
  it('shows the latest numbers, the links, the follower curve and the audience split', () => {
    view(DETAIL);
    expect(screen.getByRole('heading', { name: 'Reel · @brand' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/reel/x/');
    expect(screen.getByRole('link', { name: 'Open in Posts' })).toHaveAttribute('href', `/accounts/${A}?tab=posts&from=90d`);
    expect(screen.getByText('Post engagement').nextSibling).toHaveTextContent('10.0%'); // (10+5+3+2) / 200
    expect(screen.getByRole('heading', { name: 'Followers around this post' })).toBeInTheDocument();
    expect(screen.getByText(/no hourly reach/)).toBeInTheDocument();
    expect(screen.getByText('Non-followers').nextSibling).toHaveTextContent('40 · 40%');
  });

  it('not in scope: an empty state; no snapshots / no breakdown: plain explanations', () => {
    view(null);
    expect(screen.getByText('This post is not in your connected accounts.')).toBeInTheDocument();
    view({ ...DETAIL, followers: [], audience: null, item: { ...DETAIL.item, mediaType: 'STORY', permalink: null } });
    expect(screen.getByText('No follower snapshots for these days yet.')).toBeInTheDocument();
    expect(screen.getByText('No follower breakdown for that day yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Stories' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open on Instagram' })).toBeNull();
  });
});
