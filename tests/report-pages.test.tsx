import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PrintShell } from '@/components/report/PrintShell';
import { SECTIONS } from '@/lib/export/params';
import { buildReport, type ReportModel } from '@/lib/export/report';
import { decideRoute } from '@/lib/auth/route-policy';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { DEFAULT_SCOPE } from '@/lib/time-scope/scope';
import { NOW, sampleData, TODAY, TZ } from './fixtures/export-data';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => void calls.push('requireOwner') }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/export/request', async () => {
  const { parseReportParams } = await import('@/lib/export/params');
  const { scopeQuery } = await import('@/lib/time-scope/scope');
  const fx = await import('./fixtures/export-data');
  return {
    openExport: async (q: URLSearchParams) => {
      calls.push(`openExport:${q.toString()}`);
      const p = parseReportParams(q);
      if (!p.ok) return { ok: false, status: 400, error: 'bad_params' };
      return { ok: true, ctx: { params: p.params, data: fx.sampleData(scopeQuery(p.params.time)), prefs: { ...(await import('@/lib/prefs')).DEFAULT_PREFS, timezone: fx.TZ }, now: fx.NOW, today: fx.TODAY, label: 'Brand X' } };
    },
  };
});

import ReportPage from '@/app/report/page';

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__IN2SIGHT_REPORT__;
});

const model = (): ReportModel => buildReport(sampleData('from=7d'), { scope: { kind: 'all' }, time: DEFAULT_SCOPE, sections: [...SECTIONS], title: 'T', note: '' }, { today: TODAY, now: NOW, tz: TZ, weekStart: 'mon' });
const shell = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: TZ }} persist={vi.fn()}>
        <PrintShell />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('/report (owner preview)', () => {
  it('checks the owner first, then renders the report document for valid params', async () => {
    const el = (await ReportPage({ searchParams: Promise.resolve({ scope: 'all', period: '7', sections: 'kpis,flags', title: 'Hi' }) })) as ReactElement<{ model: ReportModel }>;
    expect(calls[0]).toBe('requireOwner');
    expect(isValidElement(el)).toBe(true);
    expect(el.props.model).toMatchObject({ title: 'Hi', sections: ['kpis', 'flags'], period: 7 });
  });

  it('bad or repeated params → notFound', async () => {
    await expect(ReportPage({ searchParams: Promise.resolve({ scope: 'all', period: '7' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(ReportPage({ searchParams: Promise.resolve({ scope: ['all', 'all'], period: '7', sections: 'kpis' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls).toContain('openExport:scope=all&scope=all&period=7&sections=kpis'); // arrays are passed on, then rejected
  });
});

describe('/report/print (headless shell)', () => {
  it('the print shell renders nothing without an injected model, and ignores junk', () => {
    shell();
    expect(screen.getByText(en.export.report.loading)).toBeInTheDocument();
    expect(document.querySelector('[data-report]')).toBeNull();
    for (const junk of ['<img src=x onerror=alert(1)>', { v: 2 }, { v: 1, title: 1 }]) {
      window.__IN2SIGHT_REPORT__ = junk;
      const { unmount } = shell();
      expect(document.querySelector('[data-report]')).toBeNull();
      unmount();
    }
  });

  it('renders the injected model and flags itself ready after two frames', async () => {
    window.__IN2SIGHT_REPORT__ = JSON.parse(JSON.stringify(model()));
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    shell();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('T');
    expect(document.querySelector('[data-report-ready]')).toBeNull();
    await act(async () => {
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
    });
    expect(document.querySelector('[data-report-ready="true"]')).not.toBeNull();
    vi.useRealTimers();
  });

  it('reads no data: no session, database or query access in the page source', () => {
    const src = ['app/report/print/page.tsx', 'components/report/PrintShell.tsx'].map((f) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\/.*$/gm, '')).join('\n');
    expect(src).not.toMatch(/supabase|requireOwner|openExport|loadExport|searchParams|cookies|fetch\(/);
  });

  it('is the only new route-policy exemption, exact path only', () => {
    const anon = (pathname: string) => decideRoute({ pathname, configured: true, signedIn: false, aal: null, mfaRequired: false });
    expect(anon('/report/print')).toEqual({ type: 'next' });
    for (const p of ['/report', '/report/', '/report/print/', '/report/printx', '/report/print-evil', '/report/print/x', '/REPORT/print', '/x/report/print', '/api/export/pdf', '/api/export/xlsx'])
      expect(anon(p), p).toEqual({ type: 'redirect', to: '/login' });
  });
});
