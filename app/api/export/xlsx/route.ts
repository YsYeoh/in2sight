import type { NextRequest } from 'next/server';
import { contentDisposition, exportBasename } from '@/lib/export/filename';
import { parseExportParams } from '@/lib/export/params';
import { exportError, exportFile, exportHeaders, openExport } from '@/lib/export/request';
import { buildWorkbook, translator, writeWorkbook } from '@/lib/export/workbook';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** GET /api/export/xlsx?scope=all|g:<group>|a:<uuid>&<Time Scope: from, to, cmp, cfrom, cto, gran; or old period=7|30|90> — owner session only. */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    const r = await openExport(request.nextUrl.searchParams, parseExportParams, h);
    if (!r.ok) return exportError(h, r.status, r.error);
    const { params, data, prefs, now, today, label } = r.ctx;
    const t = translator(prefs.locale);
    const sheets = buildWorkbook(data, t, { today, now, prefs, scopeName: params.scope.kind === 'all' ? t('export.scopeAll') : label });
    return exportFile(h, await writeWorkbook(sheets), XLSX, contentDisposition(exportBasename(label, data.scope.range), 'xlsx'));
  } catch {
    console.error('xlsx export failed'); // fixed text: never log error objects (they can carry row values)
    return exportError(h, 500, 'unexpected');
  }
}
