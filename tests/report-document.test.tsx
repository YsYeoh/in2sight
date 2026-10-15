import { render, screen, within } from '@testing-library/react';
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
import { NOW, sampleData, TODAY, TZ } from './fixtures/export-data';

beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const params = (o: Partial<ReportParams> = {}): ReportParams => ({ scope: { kind: 'group', name: 'Brand X' }, period: 30, sections: [...SECTIONS], title: '', note: '', ...o });
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

  it('Chinese: section titles and labels from the zh-CN catalog', () => {
    view(model({ sections: ['trend', 'flags'] }), 'zh-CN');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Instagram 报告');
    expect(screen.getByRole('heading', { name: '覆盖人数与浏览量趋势' })).toBeInTheDocument();
  });
});

describe('SeriesChart animate flag', () => {
  it('defaults to animated; animate={false} still renders the chart', () => {
    const { container } = render(<SeriesChart kind="line" data={[{ d: 'a', v: 1 }]} xKey="d" series={[{ key: 'v', label: 'V' }]} title="T" animate={false} />);
    expect(container.querySelector('[data-slot="series-chart"]')).not.toBeNull();
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
