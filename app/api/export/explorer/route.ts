import type { NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { loadExplorer } from '@/lib/explorer/load';
import { viewState } from '@/lib/explorer/views';
import { buildExplorerSheet } from '@/lib/export/explorer';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportFile, exportHeaders } from '@/lib/export/request';
import { translator, writeWorkbook } from '@/lib/export/workbook';
import { getPrefs } from '@/lib/prefs.server';
import { serverTiming, timed, type Span } from '@/lib/server-timing';
import { createServerSupabase } from '@/lib/supabase/server';
import { listSyncStatus } from '@/lib/sync/store';
import { localDay } from '@/lib/sync/time';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * GET /api/export/explorer?<the Explorer's canonical query> — owner session only. The query must be exactly what the
 * page links to (canonical Explorer + Time Scope parameters); anything else, repeated or extra is `bad_params`.
 * `Server-Timing: explorer;dur=…` = the same loader as the page (docs/RUNBOOK_EXPLORER.md §4).
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const prefs = await getPrefs(); // timezone + formats: the owner's; the sync writes days in it too
    if (q.size === 0 || new URLSearchParams(viewState(q.toString(), prefs.weekStart)).toString() !== q.toString()) return exportError(h, 400, 'bad_params');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const today = localDay(new Date(), prefs.timezone);
    const spans: Span[] = [];
    const d = await timed(spans, 'explorer', async () => {
      const [accounts, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
      return loadExplorer(db, Object.fromEntries(q), { today, tz: prefs.timezone, weekStart: prefs.weekStart, accounts, sync });
    });
    h.set('server-timing', serverTiming(spans));
    const file = await writeWorkbook(buildExplorerSheet(d, translator(prefs.locale), prefs));
    return exportFile(h, file, XLSX, contentDisposition(`in2sight-explorer-${d.window.current.from}_${d.window.current.to}`, 'xlsx'));
  } catch {
    console.error('explorer export failed'); // fixed text: never log error objects (they can carry row values)
    return exportError(h, 500, 'unexpected');
  }
}
