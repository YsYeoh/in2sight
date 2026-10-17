import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { ExportDialog } from '@/components/export/ExportDialog';
import { downloadExport, exportUrl } from '@/lib/export/download';
import { SECTIONS, type ScopeOption } from '@/lib/export/params';
import { deepMerge } from '@/lib/merge';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const fetchMock = vi.fn();
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = '11111111-1111-4111-8111-111111111111';
const scopes: ScopeOption[] = [
  { value: 'all', kind: 'all', name: '' },
  { value: 'g:Brand X', kind: 'group', name: 'Brand X' },
  { value: `a:${A}`, kind: 'account', name: 'brand.one' },
];
const file = (type: string, name = 'in2sight-all-2026-10-15.xlsx') => new Response('x', { status: 200, headers: { 'content-type': type, 'content-disposition': `attachment; filename="${name}"` } });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function open(props: Partial<React.ComponentProps<typeof ExportDialog>> = {}, locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : deepMerge(en, zh)}>
      <ExportDialog scopes={scopes} defaultScope="all" period={30} {...props} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Export' : '导出' }));
  return screen.findByRole('dialog');
}

describe('exportUrl', () => {
  const base = { format: 'xlsx' as const, scope: 'g:Brand & Co', period: 7 as const, sections: [...SECTIONS], title: ' Hi ', note: '' };
  it('Excel: scope + period only, encoded', () => {
    expect(exportUrl(base)).toBe('/api/export/xlsx?scope=g%3ABrand+%26+Co&period=7');
  });
  it('PDF and preview: sections, trimmed title, note only when set', () => {
    expect(exportUrl({ ...base, format: 'pdf', sections: ['kpis', 'flags'] })).toBe('/api/export/pdf?scope=g%3ABrand+%26+Co&period=7&sections=kpis%2Cflags&title=Hi');
    expect(exportUrl({ ...base, format: 'pdf', sections: ['kpis'], title: '', note: 'a\nb' }, 'preview')).toBe('/report?scope=g%3ABrand+%26+Co&period=7&sections=kpis&note=a%0Ab');
  });
});

describe('downloadExport', () => {
  it('maps error answers to known keys only', async () => {
    const f = async (body: unknown, status: number) => downloadExport('/x', 'pdf', (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);
    expect(await f({ error: 'pdf_failed' }, 502)).toEqual({ ok: false, error: 'pdf_failed' });
    expect(await f({ error: '<script>' }, 500)).toEqual({ ok: false, error: 'unexpected' });
    expect(await downloadExport('/x', 'pdf', (async () => new Response('oops', { status: 500 })) as typeof fetch)).toEqual({ ok: false, error: 'unexpected' });
    expect(await downloadExport('/x', 'pdf', (async () => Promise.reject(new TypeError('offline'))) as typeof fetch)).toEqual({ ok: false, error: 'unexpected' });
  });
  it('an HTML answer (session ended → login page) is never saved as the file', async () => {
    expect(await downloadExport('/x', 'xlsx', (async () => file('text/html; charset=utf-8')) as typeof fetch)).toEqual({ ok: false, error: 'unauthorized' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe('ExportDialog', () => {
  it('Excel by default: downloads the chosen scope and period, no report options shown', async () => {
    fetchMock.mockResolvedValue(file(XLSX));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await open({ defaultScope: `a:${A}`, period: 7 });
    expect(screen.queryByLabelText('Title')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(fetchMock).toHaveBeenCalledWith(`/api/export/xlsx?scope=a%3A${A}&period=7`, { credentials: 'same-origin' });
    expect(await screen.findByRole('status')).toHaveTextContent('Download started');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('PDF: sections (all on by default), title, note, preview link; period switch', async () => {
    fetchMock.mockResolvedValue(file('application/pdf', 'r.pdf'));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await open();
    await userEvent.click(screen.getByLabelText('PDF report (A4)'));
    await userEvent.click(screen.getByLabelText('90 days'));
    expect(screen.getAllByRole('checkbox').filter((c) => c.getAttribute('data-state') === 'checked')).toHaveLength(SECTIONS.length);
    await userEvent.click(screen.getByLabelText('Audience'));
    await userEvent.type(screen.getByLabelText('Title'), '月报');
    expect(screen.getByRole('link', { name: 'Preview in the browser' }).getAttribute('href')).toBe(`/report?scope=all&period=90&sections=${SECTIONS.filter((s) => s !== 'audience').join('%2C')}&title=%E6%9C%88%E6%8A%A5`);
    expect(screen.getByLabelText('Title')).toHaveAttribute('maxlength', '120');
    expect(screen.getByLabelText('Note (optional)')).toHaveAttribute('maxlength', '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/export\/pdf\?scope=all&period=90&sections=kpis%2Ctrend/);
  });

  it('no sections chosen: an error, nothing requested', async () => {
    await open();
    await userEvent.click(screen.getByLabelText('PDF report (A4)'));
    for (const s of SECTIONS) await userEvent.click(screen.getByLabelText(en.export.section[s]));
    expect(screen.queryByRole('link', { name: 'Preview in the browser' })).toBeNull(); // no sections: nothing to preview
    expect(screen.getByRole('button', { name: 'Preview in the browser' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(screen.getByRole('alert')).toHaveTextContent(en.export.errors.no_sections);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed PDF shows the translated error key', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'pdf_failed' }), { status: 502 }));
    await open({}, 'zh-CN');
    await userEvent.click(screen.getByLabelText('PDF 报告（A4）'));
    await userEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(zh.export.errors.pdf_failed);
  });

  it('an unknown default scope falls back to all accounts', async () => {
    fetchMock.mockResolvedValue(file(XLSX));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await open({ defaultScope: 'a:deleted' });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/export/xlsx?scope=all&period=30');
  });
});
