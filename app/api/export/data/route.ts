import { NextResponse, type NextRequest } from 'next/server';
import { assertOwner } from '@/lib/auth/assert-owner';
import { exportPages, findExportTable, jsonArrayStream } from '@/lib/data/export';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportHeaders } from '@/lib/export/request';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export const maxDuration = 60;
/** Stop well inside maxDuration: an unfinished file must fail in the browser, not be cut off by the platform. */
// ponytail: one table = one request within 50 s; add ?after=<cursor> parts if a table ever outgrows it (RUNBOOK_DATA §2).
const BUDGET_MS = 50_000;

/**
 * GET /api/export/data?table=<name> — one table of "Export all" (Settings → Data & privacy, Plan 16c) as a JSON array,
 * streamed page by page. Owner session only (assertOwner first; RLS on every read; never the admin client, so
 * account_tokens cannot be read even by mistake). Exactly one parameter, an allow-listed table name. A GET reads only;
 * nothing changes. Never logs rows or error objects.
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    // A cross-site page can navigate the owner's browser here (Lax cookies ride top-level GETs) and make it save other people's data
    // to disk. Our own download is a same-origin fetch, a typed URL is "none"; a browser always sends the header, a page cannot forge it.
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return exportError(h, 403, 'unauthorized');
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const table = findExportTable(q.get('table'));
    if ([...q.keys()].length !== 1 || !table) return exportError(h, 400, 'bad_params');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const day = localDay(new Date(), (await getPrefs()).timezone);
    h.set('content-type', 'application/json; charset=utf-8');
    h.set('content-disposition', contentDisposition(`in2sight-${table.name}-${day}`, 'json'));
    h.set('x-content-type-options', 'nosniff');
    return new NextResponse(jsonArrayStream(exportPages(db, table), Date.now() + BUDGET_MS), { status: 200, headers: h });
  } catch {
    return exportError(h, 500, 'unexpected');
  }
}
