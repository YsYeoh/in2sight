import type { NextRequest } from 'next/server';
import { launchChromium } from '@/lib/export/chromium';
import { contentDisposition, exportBasename } from '@/lib/export/filename';
import { parseReportParams } from '@/lib/export/params';
import { appOrigin, renderReportPdf } from '@/lib/export/pdf';
import { buildReport } from '@/lib/export/report';
import { exportError, exportFile, exportHeaders, openExport } from '@/lib/export/request';

// Chromium cold start (unpacking to /tmp) plus rendering: SPEC §7d accepts a few seconds; renderReportPdf stops at 40 s.
export const maxDuration = 60;

/** GET /api/export/pdf?scope=…&period=…&sections=…&title=…&note=… — owner session only. */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  const origin = appOrigin(process.env.NEXT_PUBLIC_APP_URL); // the only place the headless browser may go
  let model;
  let ctx;
  try {
    const r = await openExport(request.nextUrl.searchParams, parseReportParams, h);
    if (!r.ok) return exportError(h, r.status, r.error);
    if (!origin) return exportError(h, 503, 'not_configured'); // after the owner and parameter checks: a non-owner never learns about our config
    ctx = r.ctx;
    model = buildReport(ctx.data, ctx.params, { today: ctx.today, now: ctx.now, tz: ctx.prefs.timezone, weekStart: ctx.prefs.weekStart });
  } catch {
    console.error('pdf export: read failed'); // fixed text: never log error objects
    return exportError(h, 500, 'unexpected');
  }
  try {
    const pdf = await renderReportPdf(model, { origin, prefs: ctx.prefs, launch: launchChromium });
    return exportFile(h, pdf, 'application/pdf', contentDisposition(exportBasename(ctx.label, ctx.today), 'pdf'));
  } catch {
    console.error('pdf export: render failed');
    return exportError(h, 502, 'pdf_failed');
  }
}
