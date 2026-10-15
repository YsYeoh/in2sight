// The common front half of both export routes: owner check, parameter allow-list, scope, owner-session reads.
import { NextResponse } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { resolveScope, scopeLabel, type ExportParams, type Parsed } from '@/lib/export/params';
import { loadExportData, type ExportData } from '@/lib/export/read';
import type { Prefs } from '@/lib/prefs';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';

export type ExportError = 'unauthorized' | 'bad_params' | 'not_found' | 'pdf_failed' | 'not_configured' | 'unexpected';

export interface ExportContext<P extends ExportParams> {
  params: P;
  data: ExportData;
  prefs: Prefs;
  now: Date;
  today: string;
  label: string; // scopeLabel(): '@username', the group name, or 'all'
}

export async function openExport<P extends ExportParams>(q: URLSearchParams, parse: (q: URLSearchParams) => Parsed<P>, h: Headers): Promise<{ ok: true; ctx: ExportContext<P> } | { ok: false; status: number; error: ExportError }> {
  if (!(await assertOwner(h))) return { ok: false, status: 401, error: 'unauthorized' };
  const parsed = parse(q);
  if (!parsed.ok) return { ok: false, status: 400, error: 'bad_params' };
  const prefs = await getPrefs(); // timezone + formats: the owner's (synced to profiles); the sync writes days in it too
  const now = new Date();
  const today = localDay(now, prefs.timezone);
  const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
  const accounts = resolveScope(parsed.params.scope, await supabaseAccountsStore(db).list());
  if (!accounts) return { ok: false, status: 404, error: 'not_found' };
  const data = await loadExportData(db, accounts, { period: parsed.params.period, today, tz: prefs.timezone });
  return { ok: true, ctx: { params: parsed.params, data, prefs, now, today, label: scopeLabel(parsed.params.scope, accounts) } };
}

/** Every export response is private and uncached (it carries the owner's data, and maybe a refreshed session cookie). */
export function exportHeaders(): Headers {
  return new Headers({ 'cache-control': 'private, no-store' });
}

export function exportError(h: Headers, status: number, error: ExportError): NextResponse {
  return NextResponse.json({ error }, { status, headers: h });
}

export function exportFile(h: Headers, body: Uint8Array, type: string, disposition: string): NextResponse {
  h.set('content-type', type);
  h.set('content-disposition', disposition);
  h.set('x-content-type-options', 'nosniff');
  return new NextResponse(new Uint8Array(body), { status: 200, headers: h });
}
