import { describe, expect, it } from 'vitest';
import { downloadExport } from '@/lib/export/download';
import { contentDisposition, filenameFromDisposition } from '@/lib/export/filename';

const broken = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('[{"a":1}'));
    },
    pull(c) {
      c.error(new Error('export failed'));
    },
  });

describe('JSON downloads (Plan 16c)', () => {
  it('a file name with the .json extension survives both directions', () => {
    const h = contentDisposition('in2sight-media-2026-10-31', 'json');
    expect(h).toContain('filename="in2sight-media-2026-10-31.json"');
    expect(filenameFromDisposition(h, 'x.json')).toBe('in2sight-media-2026-10-31.json');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''evil.exe", 'x.json')).toBe('x.json');
  });

  it('a streamed answer that breaks off midway is an error, never a saved half file', async () => {
    const fetcher = (async () => new Response(broken(), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })) as typeof fetch;
    expect(await downloadExport('/api/export/data?table=media', 'json', fetcher)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('a JSON download refuses an HTML answer (a session that ended mid-way)', async () => {
    const fetcher = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    expect(await downloadExport('/api/export/data?table=media', 'json', fetcher)).toEqual({ ok: false, error: 'unauthorized' });
  });
});
