import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { GrowthTab } from '@/components/account/GrowthTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { DailyRow } from '@/lib/analysis/types';
import { buildGrowth, type GrowthInput } from '@/lib/dashboard/growth';
import type { BreakdownRow } from '@/lib/dashboard/growth-read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const { push, replace, search } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, prefetch: vi.fn(), refresh: vi.fn(), back: vi.fn() }), useSearchParams: () => new URLSearchParams(search.value) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix and Recharts use; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  search.value = '';
  window.history.replaceState(null, '', '/accounts/a1?tab=growth&from=7d');
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

const KL = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-15';
const g = en.pages.account.growth;
const row = (day: string, o: Partial<DailyRow> = {}): DailyRow => ({ day, followers: null, reach: null, views: null, accountsEngaged: null, interactions: null, follows: null, unfollows: null, linkTaps: null, ...o });
const NONE = { first: { age_gender: null, country: null, city: null }, last: { age_gender: null, country: null, city: null } };
const EMPTY: GrowthInput = { daily: [], breakdown: [], posts: [], stories: { days: {}, from: null }, comments: { days: {}, from: null }, curve: null, audience: NONE };
/** As tests/dashboard-growth.test.ts `steady`, with a +60 day on Wednesday 14 October and two audience snapshots. */
function input(): GrowthInput {
  const days = Array.from({ length: 120 }, (_, i) => addDays(TODAY, i - 119));
  return {
    ...EMPTY,
    daily: days.map((d, i) => row(d, { followers: 1000 + 5 * i, follows: d === '2026-10-14' ? 63 : 8, unfollows: 3, reach: 1000 })),
    breakdown: days.flatMap((day): BreakdownRow[] => [
      { day, followType: 'FOLLOWER', productType: 'REEL', value: 600 },
      { day, followType: 'NON_FOLLOWER', productType: 'REEL', value: 300 },
      { day, followType: 'FOLLOWER', productType: 'STORY', value: 100 },
    ]),
    audience: { first: { age_gender: null, country: { day: '2026-10-09', data: { MY: 60, SG: 40 } }, city: null }, last: { age_gender: null, country: { day: '2026-10-14', data: { MY: 50, SG: 50 } }, city: null } },
  };
}
const model = (q = 'from=7d', i = input()) => buildGrowth(i, { scope: resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, '2026-06-01'), today: TODAY, tz: KL, weekStart: 'mon' });

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('GrowthTab', () => {
  it('six KPI cards with sparklines; unfollows going up would be bad (lower is better)', () => {
    const { container } = wrap(<GrowthTab model={model()} />);
    const kpis = screen.getByRole('region', { name: g.kpis });
    for (const label of Object.values(g.kpi)) expect(within(kpis).getByText(label)).toBeInTheDocument();
    expect(kpis.querySelectorAll('[data-slot="sparkline"]').length).toBe(6);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i); // tokens only
  });

  it('followers: the change over the range, the projection with its method and confidence', () => {
    wrap(<GrowthTab model={model()} />);
    expect(screen.getByText('+30 (+1.9%) in this range')).toBeInTheDocument();
    expect(screen.getByText(/^In 7 days: about /)).toBeInTheDocument();
    expect(screen.getByText(/^In 90 days: about /)).toBeInTheDocument();
    expect(screen.getByText(/the median daily change between every pair of the 28 days/)).toBeInTheDocument();
    expect(screen.getByText(g.confidence.medium.replace('{n}', '28'))).toBeInTheDocument();
  });

  it('follow flow: the data source, churn, best days with what was published', () => {
    wrap(<GrowthTab model={model()} />);
    expect(screen.getByText(g.flowSource.instagram)).toBeInTheDocument();
    expect(screen.getByText(/^Churn: /)).toBeInTheDocument();
    const best = screen.getByRole('heading', { name: g.best }).parentElement!;
    expect(within(best).getAllByRole('listitem')[0].textContent).toMatch(/: \+60, no posts, no Stories$/);
  });

  it('loyalty: the per-format table names the formats and the change in points', () => {
    wrap(<GrowthTab model={model()} />);
    const table = screen.getByRole('table', { name: g.formatsTitle });
    expect(within(table).getByText(g.product.REEL)).toBeInTheDocument();
    expect(within(table).getByText(g.product.STORY)).toBeInTheDocument();
  });

  it('picking an unusual day explains it and writes ?day= with replaceState (no navigation); other params stay', async () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    wrap(<GrowthTab model={model()} />);
    expect(screen.getByText(g.why.pick)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Wednesday/ }));
    expect(spy).toHaveBeenLastCalledWith(null, '', '?tab=growth&from=7d&day=2026-10-14');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Net follows on .*: \+60, typical \+5/)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('a link with ?day= opens on its explanation; a day outside the range is ignored', () => {
    search.value = 'tab=growth&day=2026-10-14';
    wrap(<GrowthTab model={model()} />);
    expect(screen.getByText(/Net follows on .*: \+60/)).toBeInTheDocument();
    cleanup();
    search.value = 'tab=growth&day=2026-01-01';
    wrap(<GrowthTab model={model()} />);
    expect(screen.getByText(g.why.pick)).toBeInTheDocument();
  });

  it('weekly buckets say how to click single days', () => {
    wrap(<GrowthTab model={model('from=90d&gran=week')} />);
    expect(screen.getByText(g.dayOnly)).toBeInTheDocument();
  });

  it('audience: then vs now with notable changes marked', () => {
    wrap(<GrowthTab model={model()} />);
    const section = screen.getByRole('heading', { name: g.audienceKind.country }).closest('section')!;
    const notable = section.querySelectorAll('[data-notable]');
    expect(notable).toHaveLength(2);
    expect(within(section).getAllByText(new RegExp(g.notable)).length).toBe(2);
  });

  it('zh-CN, no data: every reason, no projection, no audience, and no NaN / undefined / raw keys', () => {
    const { container } = wrap(<GrowthTab model={model('from=7d', { ...EMPTY, daily: [row(TODAY, { followers: 85 })] })} />, 'zh-CN');
    expect(container.textContent).toContain(zh.pages.account.growth.audienceNone);
    expect(container.textContent).toContain('暂无预测');
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity|pages\.account|\{/);
  });
});
