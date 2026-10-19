import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ItemPanel } from '@/components/explorer/ItemPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { ItemDetail } from '@/lib/explorer/item';
import { postLabHref } from '@/lib/post-lab/params';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const DETAIL: ItemDetail = {
  item: { id: '42', accountId: A, mediaType: 'REELS', postedAt: '2026-10-05T15:30:00Z', permalink: 'https://www.instagram.com/reel/x/', caption: 'Hello', reach: 200, views: 900, likes: 10, comments: 5, saves: 3, shares: 2 },
  measuredAt: '2026-10-07T01:00:00Z',
  day: '2026-10-05',
  followers: [],
  audience: null,
};

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

describe('Explorer item level → Post Lab', () => {
  it('links to the item’s Post Lab with the Explorer’s scope', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <ItemPanel detail={DETAIL} username="brand" tabHref={`/accounts/${A}?tab=posts&from=90d`} labHref={postLabHref(A, '42', 'from=90d')} />
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Open Post Lab' })).toHaveAttribute('href', `/accounts/${A}/media/42?from=90d`);
  });
});
