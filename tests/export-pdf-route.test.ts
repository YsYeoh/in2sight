// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A } from './fixtures/export-data';

const s = vi.hoisted(() => ({ owner: true, loads: 0, failRead: false, launches: 0, launchFails: false, gotoFails: false, closed: 0, urls: [] as string[] }));
vi.mock('@/lib/auth/assert-owner', () => ({ assertOwner: async () => s.owner }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => ({ ...(await import('@/lib/prefs')).DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur' }) }));
vi.mock('@/lib/accounts/supabase-store', async () => {
  const { sampleData } = await import('./fixtures/export-data');
  return { supabaseAccountsStore: () => ({ list: async () => sampleData().accounts }) };
});
vi.mock('@/lib/export/read', async (orig) => ({
  ...(await orig<object>()),
  loadExportData: async () => {
    s.loads++;
    if (s.failRead) throw new Error('dashboard read: daily failed');
    return (await import('./fixtures/export-data')).sampleData();
  },
}));
// the seam: a fake browser instead of Chromium (lib/export/pdf.ts runs for real)
vi.mock('@/lib/export/chromium', () => ({
  launchChromium: async () => {
    s.launches++;
    if (s.launchFails) throw new Error('Failed to launch the browser process: /tmp/chromium');
    const page = {
      setCookie: async () => {},
      setBypassServiceWorker: async () => {},
      setRequestInterception: async () => {},
      on: () => {},
      evaluateOnNewDocument: async () => {},
      goto: async (url: string) => {
        s.urls.push(url);
        if (s.gotoFails) throw new Error('net::ERR_CONNECTION_REFUSED');
      },
      waitForSelector: async () => {},
      evaluate: async () => true,
      pdf: async () => new TextEncoder().encode('%PDF-1.7 fake'),
    };
    return { newPage: async () => page, close: async () => void s.closed++, process: () => null };
  },
}));

import { GET } from '@/app/api/export/pdf/route';

const get = (qs: string) => GET(new NextRequest(new URL(`/api/export/pdf?${qs}`, 'https://app.test')));
const OK = `scope=a:${A}&period=30&sections=kpis,trend&title=${encodeURIComponent('月报')}`;
beforeEach(() => {
  Object.assign(s, { owner: true, loads: 0, failRead: false, launches: 0, launchFails: false, gotoFails: false, closed: 0, urls: [] });
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/export/pdf', () => {
  it('200: a PDF attachment rendered from /report/print on our own origin; browser closed; private + no-store', async () => {
    const res = await get(OK);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/filename="in2sight-brand\.one-2026-09-16_2026-10-15\.pdf"/);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('%PDF-1.7 fake');
    expect(s.urls).toEqual(['https://app.test/report/print']);
    expect(s.closed).toBe(1);
  });

  it('401 for anyone but the owner; no read, no browser', async () => {
    s.owner = false;
    expect((await get(OK)).status).toBe(401);
    expect([s.loads, s.launches]).toEqual([0, 0]);
  });

  it('a non-owner gets 401 even when NEXT_PUBLIC_APP_URL is unusable; bad params get 400, never 503', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    s.owner = false;
    expect((await get(OK)).status).toBe(401);
    s.owner = true;
    expect((await get(`scope=a:${A}&period=30`)).status).toBe(400);
  });

  it('tampered parameters are rejected before any read', async () => {
    for (const qs of [`scope=a:${A}&period=30`, `${OK}&sections=evil`, `scope=a:${A}&period=30&sections=kpis&title=${'x'.repeat(121)}`, `scope=a:${A}&period=30&sections=kpis&note=%E2%80%AE`, `${OK}&scope=all`]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_params' });
    }
    expect([s.loads, s.launches]).toEqual([0, 0]);
  });

  it('503 not_configured without a usable NEXT_PUBLIC_APP_URL (never a guessed or user-supplied origin)', async () => {
    for (const v of ['', 'http://in2sight.example.com', 'not a url']) {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', v);
      const res = await get(OK);
      expect(res.status, v).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_configured' });
    }
    expect(s.launches).toBe(0);
  });

  it('a renderer failure is a 502 pdf_failed with a fixed log line; the browser is still closed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.gotoFails = true;
    const res = await get(OK);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('{"error":"pdf_failed"}');
    expect(s.closed).toBe(1);
    s.gotoFails = false;
    s.launchFails = true;
    expect((await get(OK)).status).toBe(502);
    expect(log.mock.calls).toEqual([['pdf export: render failed'], ['pdf export: render failed']]);
    log.mockRestore();
  });

  it('a read failure is a 500 unexpected and never starts a browser', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    s.failRead = true;
    const res = await get(OK);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'unexpected' });
    expect(s.launches).toBe(0);
    log.mockRestore();
  });

  it('allows 60 s on Vercel', async () => {
    expect((await import('@/app/api/export/pdf/route')).maxDuration).toBe(60);
  });
});
