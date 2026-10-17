import { render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { SeriesChart } from '@/components/charts/SeriesChart';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { ForceLight } from '@/components/report/ForceLight';
import { ReportDocument } from '@/components/report/ReportDocument';
import { SECTIONS, type ReportParams } from '@/lib/export/params';
import { buildReport, type ReportModel } from '@/lib/export/report';
import { deepMerge } from '@/lib/merge';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { DEFAULT_SCOPE } from '@/lib/time-scope/scope';
import { NOW, sampleData, TODAY, TZ } from './fixtures/export-data';

const anim = vi.hoisted(() => ({ line: [] as unknown[], area: [] as unknown[] }));
vi.mock('recharts', async (orig) => {
  const actual = await orig<typeof import('recharts')>();
  const spy = (Real: ComponentType<Record<string, unknown>>, seen: unknown[]) => {
    const Spy = (p: Record<string, unknown>) => (seen.push(p.isAnimationActive), <Real {...p} />);
    return Spy;
  };
  return { ...actual, Line: spy(actual.Line as unknown as ComponentType<Record<string, unknown>>, anim.line), Area: spy(actual.Area as unknown as ComponentType<Record<string, unknown>>, anim.area) };
});

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const params = (o: Partial<ReportParams> = {}): ReportParams => ({ scope: { kind: 'group', name: 'Brand X' }, time: DEFAULT_SCOPE, sections: [...SECTIONS], title: '', note: '', ...o });
const model = (o: Partial<ReportParams> = {}) => buildReport(sampleData(), params(o), { today: TODAY, now: NOW, tz: TZ, weekStart: 'mon' });
function view(m: ReportModel, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : deepMerge(en, zh)}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, timezone: TZ, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <ReportDocument model={m} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('ReportDocument', () => {
  it('header: default title, scope, range and generated time in the owner formats', () => {
    view(model());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Instagram report');
    expect(screen.getByRole('heading', { level: 1 }).nextElementSibling).toHaveTextContent('Brand X · 2026-09-15 – 2026-10-14 · 30 days');
    expect(screen.getByText('Generated 2026-10-15 12:00')).toBeInTheDocument();
  });

  it('KPIs say what they are compared with; a weekly trend marks its partial weeks', () => {
    view(model({ sections: ['kpis'] }));
    expect(screen.getAllByText('vs 2026-08-16 – 2026-09-14').length).toBeGreaterThan(0);
    const weekly = buildReport(sampleData('quarter=2026-Q3&gran=week'), params({ sections: ['trend'] }), { today: TODAY, now: NOW, tz: TZ, weekStart: 'mon' });
    view(weekly);
    expect(screen.getByText('* only partly inside the range')).toBeInTheDocument();
  });

  it('renders exactly the sections of the model, in the model order (parseReportParams sorts them)', () => {
    const { container } = view(model({ sections: ['flags', 'kpis'] }));
    expect([...container.querySelectorAll('[data-section]')].map((s) => s.getAttribute('data-section'))).toEqual(['flags', 'kpis']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Flags', 'Key numbers and changes']);
  });

  it('every section renders with the sample data (hostile names shown as plain text)', () => {
    const { container } = view({ ...model(), title: '<b>=x</b> 报告', note: 'line 1\nline 2' });
    expect(container.querySelectorAll('[data-section]')).toHaveLength(SECTIONS.length);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<b>=x</b> 报告');
    expect(container.querySelector('b')).toBeNull(); // escaped, never HTML
    expect(screen.getByText(/line 1/)).toHaveClass('whitespace-pre-line');
    expect(screen.getAllByText(/=brand\u{1F600}\/two/u).length).toBeGreaterThan(0);
    const audience = container.querySelector('[data-section="audience"]') as HTMLElement;
    expect(within(audience).getByText('Malaysia')).toBeInTheDocument();
    expect(within(audience).getByText(en.analysis.reasons.needs_100_followers)).toBeInTheDocument();
  });

  it('an account without data shows reasons, not zeros', () => {
    const { container } = view(model({ sections: ['kpis', 'stories'] }));
    const kpis = container.querySelector('[data-section="kpis"]') as HTMLElement;
    expect(within(kpis).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('Stories summary: a capped account shows its count as "200+", an uncapped one the plain number', () => {
    const m = model({ sections: ['stories'] });
    m.stories = [{ ...m.stories[0], count: 200, capped: true }, { ...m.stories[0], username: 'other', count: 7, capped: false }];
    const { container } = view(m);
    const rows = [...container.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[1]?.textContent);
    expect(rows).toEqual(['200+', '7']);
  });

  it('Chinese: section titles and labels from the zh-CN catalog', () => {
    view(model({ sections: ['trend', 'flags'] }), 'zh-CN');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Instagram 报告');
    expect(screen.getByRole('heading', { name: '覆盖人数与浏览量趋势' })).toBeInTheDocument();
  });
});

describe('SeriesChart animate flag', () => {
  const chart = (kind: 'line' | 'area', animate?: boolean) =>
    render(<SeriesChart kind={kind} data={[{ d: 'a', v: 1 }]} xKey="d" series={[{ key: 'v', label: 'V' }]} title="T" animate={animate} />);

  it.each([['line', anim.line], ['area', anim.area]] as const)('%s: animate={false} turns the animation off; the default stays on auto', (kind, seen) => {
    seen.length = 0;
    const { container } = chart(kind, false);
    expect(container.querySelector('[data-slot="series-chart"]')).not.toBeNull();
    expect(seen).toContain(false);
    expect(seen).not.toContain('auto');
    seen.length = 0;
    chart(kind);
    expect(seen).toContain('auto');
    expect(seen).not.toContain(false);
  });
});

describe('ForceLight', () => {
  it('forces light while mounted and restores the previous mode', () => {
    document.documentElement.setAttribute('data-mode', 'dark');
    const { unmount } = render(<ForceLight />);
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    unmount();
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });
});
