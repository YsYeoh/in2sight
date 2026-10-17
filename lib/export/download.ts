// Browser side of the export dialog: build the request URL and save the answer as a file.
import { filenameFromDisposition } from '@/lib/export/filename';
import type { Section } from '@/lib/export/params';

export type ExportFormat = 'xlsx' | 'pdf';
export interface ExportRequest {
  format: ExportFormat;
  scope: string; // a ScopeOption value
  time: string; // the page's canonical Time Scope query (ResolvedScope.query; '' = the default)
  sections: Section[];
  title: string;
  note: string;
}

const KNOWN = ['bad_params', 'unauthorized', 'not_found', 'pdf_failed', 'not_configured', 'unexpected'];
const TYPES: Record<ExportFormat, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };

/** '/api/export/<format>?…' (a download) or '/report?…' (the browser preview of the PDF report). */
export function exportUrl(r: ExportRequest, target: 'file' | 'preview' = 'file'): string {
  const q = new URLSearchParams({ scope: r.scope });
  for (const [k, v] of new URLSearchParams(r.time)) q.append(k, v);
  if (r.format === 'pdf' || target === 'preview') {
    q.set('sections', r.sections.join(','));
    if (r.title.trim()) q.set('title', r.title.trim());
    if (r.note.trim()) q.set('note', r.note.trim());
  }
  return target === 'preview' ? `/report?${q}` : `/api/export/${r.format}?${q}`;
}

/**
 * GETs the export and saves it under the server's (re-cleaned) file name. Error answers come back as an
 * `export.errors.*` key. A session that ended mid-way shows up as a redirect to an HTML page: never saved as a file.
 */
export async function downloadExport(url: string, format: ExportFormat, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetcher(url, { credentials: 'same-origin' });
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  if (!res.ok) {
    const key = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof key === 'string' && KNOWN.includes(key) ? key : 'unexpected' };
  }
  if (res.redirected || !res.headers.get('content-type')?.startsWith(TYPES[format])) return { ok: false, error: 'unauthorized' };
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = filenameFromDisposition(res.headers.get('content-disposition'), `in2sight.${format}`);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return { ok: true };
}
