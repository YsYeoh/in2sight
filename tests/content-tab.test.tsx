import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { ContentTab } from '@/components/account/ContentTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { LabValues } from '@/lib/analysis/post-lab';
import { buildContentLab } from '@/lib/dashboard/content-lab';
import type { ContentRow } from '@/lib/dashboard/content-lab-read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }), useSearchParams: () => new URLSearchParams(search.value) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const replaceState = vi.fn();
beforeEach(() => {
  search.value = '';
  replaceState.mockReset();
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window.history, 'replaceState').mockImplementation(replaceState);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const TODAY = '2026-10-28';
const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const V = (o: Partial<LabValues>): LabValues => ({ reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null, replies: null, tapsForward: null, tapsBack: null, exits: null, swipeForward: null, follows: null, profileVisits: null, linkTaps: null, avgWatchMs: null, totalWatchMs: null, skipRate: null, ...o });
const row = (i: number, latest: Partial<LabValues>, caption = `Post number ${i}`): ContentRow => ({ id: `m${i}`, accountId: ID, mediaType: 'IMAGE', postedAt: `${addDays('2026-10-20', -i)}T04:00:00Z`, permalink: null, reach: null, views: null, likes: null, comments: null, shares: null, saves: null, caption, tagIds: [], cover: 'pending', slides: null, latest: V(latest) });
const scope = resolveScope(parseTimeScope(new URLSearchParams('from=30d')), TODAY, '2026-01-01');
const modelOf = (rows: ContentRow[]) => buildContentLab({ rows, lastPostAt: rows[0]?.postedAt ?? null, stories: { days: {}, from: null }, tags: [], connectedAt: '2026-01-01T00:00:00Z' }, { scope, today: TODAY, tz: 'Asia/Kuala_Lumpur', weekStart: 'mon' });
// 8 posts, every 2 days from 2026-10-20 back; m0 is the star (top in reach and shares)
const rows = [row(0, { reach: 900, shares: 9, saves: 1 }, 'Star post #sunset'), ...Array.from({ length: 7 }, (_, i) => row((i + 1) * 2, { reach: 100 + i, shares: 1, saves: 1 }))];

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const c = en.pages.account.content;

describe('ContentTab', () => {
  it('without the Post Lab functions: "needs a database update"; without posts: a hint to pick a longer range', () => {
    wrap(<ContentTab model={null} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('status')).toHaveTextContent(c.notReady);
    cleanup();
    wrap(<ContentTab model={modelOf([])} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('status')).toHaveTextContent(c.empty);
  });

  it('four underline sections; the leaderboard ranks by reach, links to the Post Lab with the scope, marks "Repeat this"', () => {
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="from=30d" />);
    const list = screen.getByRole('tablist', { name: c.sections.label });
    expect(list).toHaveAttribute('data-variant', 'line');
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual([c.sections.leaderboards, c.sections.formats, c.sections.hashtags, c.sections.cadence]);
    expect(screen.getByRole('heading', { name: 'Best posts by Reach' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Star post/ });
    expect(links[0]).toHaveAttribute('href', `/accounts/${ID}/media/m0?from=30d`);
    expect(screen.getAllByText(c.repeat, { selector: '[data-slot="badge"]' }).length).toBeGreaterThan(0);
  });

  it('a pick changes what is shown and writes the URL with replaceState (no navigation)', async () => {
    const user = userEvent.setup();
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="" />);
    await user.selectOptions(screen.getByLabelText(c.metricLabel), 'profileVisits');
    expect(screen.getByRole('heading', { name: 'Best posts by Profile visits' })).toBeInTheDocument();
    expect(screen.getAllByText(c.noValues).length).toBeGreaterThan(0); // extras never captured: no ranking, never zeros
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '?metric=profileVisits');
    await user.click(screen.getByRole('tab', { name: c.sections.hashtags }));
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '?section=hashtags&metric=profileVisits');
    expect(screen.getByText(c.hashtagsFew.replace('{measured}', '8'))).toBeInTheDocument();
  });

  it('opens on the section of the URL; Cadence warns after twice the usual gap', () => {
    search.value = 'section=cadence';
    const old = [10, 12, 14, 16, 18].map((d) => row(d, { reach: 100 })); // posting days every 2 days, newest 2026-10-10: 18 days ago
    wrap(<ContentTab model={modelOf(old)} accountId={ID} scopeQuery="" />);
    expect(screen.getByRole('tab', { name: c.sections.cadence })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('No post for 18 days');
  });

  it('every section renders in Simplified Chinese', async () => {
    const user = userEvent.setup();
    wrap(<ContentTab model={modelOf(rows)} accountId={ID} scopeQuery="" />, 'zh-CN');
    const z = zh.pages.account.content;
    for (const s of ['formats', 'hashtags', 'cadence', 'leaderboards'] as const) {
      await user.click(screen.getByRole('tab', { name: z.sections[s] }));
      expect(screen.getByRole('tab', { name: z.sections[s] })).toHaveAttribute('aria-selected', 'true');
    }
    expect(screen.getByRole('heading', { name: '按覆盖人数排名的最佳帖子' })).toBeInTheDocument();
  });
});
