// @vitest-environment node
import type { Browser } from 'puppeteer-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECTIONS } from '@/lib/export/params';
import { appOrigin, renderReportPdf } from '@/lib/export/pdf';
import { buildReport } from '@/lib/export/report';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefsCookie } from '@/lib/prefs';
import { DEFAULT_SCOPE } from '@/lib/time-scope/scope';
import { NOW, sampleData, TODAY, TZ } from './fixtures/export-data';

const model = buildReport(sampleData('from=7d'), { scope: { kind: 'all' }, time: DEFAULT_SCOPE, sections: [...SECTIONS], title: 'T', note: '' }, { today: TODAY, now: NOW, tz: TZ, weekStart: 'mon' });
const PDF = new Uint8Array([37, 80, 68, 70]); // %PDF
const never = () => new Promise<never>(() => {});

type Step = 'goto' | 'ready' | 'pdf' | 'close';
function fakeBrowser(o: { fail?: Step; hang?: Step } = {}) {
  const log: unknown[][] = [];
  let onRequest: ((req: unknown) => void) | null = null;
  const step = async (name: Step, value?: unknown) => {
    log.push([name]);
    if (o.hang === name) return never();
    if (o.fail === name) throw new Error(`${name} failed`);
    return value;
  };
  const page = {
    setCookie: async (...c: unknown[]) => void log.push(['cookie', ...c]),
    setBypassServiceWorker: async (v: boolean) => void log.push(['bypassSW', v]),
    setRequestInterception: async (v: boolean) => void log.push(['intercept', v]),
    on: (event: string, h: (req: unknown) => void) => {
      log.push(['on', event]);
      onRequest = h;
    },
    evaluateOnNewDocument: async (fn: (m: unknown) => void, arg: unknown) => {
      const win: Record<string, unknown> = {};
      vi.stubGlobal('window', win);
      fn(arg);
      vi.unstubAllGlobals();
      log.push(['inject', win.__IN2SIGHT_REPORT__]);
    },
    goto: (url: string, opts: unknown) => (log.push(['gotoUrl', url, opts]), step('goto')),
    waitForSelector: (sel: string) => (log.push(['selector', sel]), step('ready')),
    evaluate: async () => true,
    pdf: (opts: unknown) => (log.push(['pdfOpts', opts]), step('pdf', PDF)),
  };
  const kill = vi.fn();
  const browser = {
    newPage: async () => page,
    close: () => step('close'),
    process: () => ({ kill }),
  };
  const request = (url: string) => {
    const r = { url: () => url, continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    onRequest!(r);
    return r;
  };
  return { browser: browser as unknown as Browser, log, kill, request, closed: () => log.filter((l) => l[0] === 'close').length };
}

afterEach(() => vi.useRealTimers());
const run = (b: ReturnType<typeof fakeBrowser>, budgetMs?: number) => renderReportPdf(model, { origin: 'https://app.test', prefs: { ...DEFAULT_PREFS, locale: 'zh-CN', mode: 'dark' }, launch: async () => b.browser, budgetMs });

describe('appOrigin (SSRF guard)', () => {
  it('https origins, or http://localhost for local runs; anything else is refused', () => {
    expect(appOrigin('https://in2sight.vercel.app')).toBe('https://in2sight.vercel.app');
    expect(appOrigin('https://in2sight.vercel.app/some/path?x=1')).toBe('https://in2sight.vercel.app');
    expect(appOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    for (const v of [undefined, '', 'not a url', 'http://in2sight.example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x']) expect(appOrigin(v), String(v)).toBeNull();
  });
});

describe('renderReportPdf', () => {
  it('opens only /report/print on the app origin with the model injected and light prefs, prints A4, closes the browser', async () => {
    const b = fakeBrowser();
    expect(await run(b)).toBe(PDF);
    const cookie = b.log.find((l) => l[0] === 'cookie')![1] as { name: string; value: string; url: string };
    expect(cookie).toMatchObject({ name: PREFS_COOKIE, url: 'https://app.test' });
    expect(parsePrefsCookie(cookie.value)).toMatchObject({ locale: 'zh-CN', mode: 'light' });
    expect(b.log).toContainEqual(['inject', model]);
    expect(b.log).toContainEqual(['bypassSW', true]);
    expect(b.log).toContainEqual(['intercept', true]);
    expect(b.log.find((l) => l[0] === 'gotoUrl')?.[1]).toBe('https://app.test/report/print');
    expect(b.log).toContainEqual(['selector', '[data-report-ready="true"]']);
    expect(b.log.find((l) => l[0] === 'pdfOpts')?.[1]).toMatchObject({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    expect(b.closed()).toBe(1);
  });

  it('wires the model injection and the request guard BEFORE navigating', async () => {
    const b = fakeBrowser();
    await run(b);
    const at = (name: string) => b.log.findIndex((l) => l[0] === name);
    expect(at('cookie')).toBeGreaterThanOrEqual(0);
    for (const before of ['cookie', 'inject', 'intercept', 'on', 'bypassSW']) expect(at(before), before).toBeLessThan(at('gotoUrl'));
  });

  it('request interception: same-origin requests continue, everything else is aborted', async () => {
    const b = fakeBrowser();
    await run(b);
    expect(b.request('https://app.test/_next/static/media/noto.woff2').continue).toHaveBeenCalled();
    for (const u of ['https://evil.test/x', 'http://app.test/x', 'https://app.test.evil.test/', 'data:text/html,hi', 'file:///etc/passwd', '::junk::']) {
      const r = b.request(u);
      expect(r.abort, u).toHaveBeenCalled();
      expect(r.continue, u).not.toHaveBeenCalled();
    }
  });

  it.each(['goto', 'ready', 'pdf'] as const)('always closes the browser when %s fails', async (fail) => {
    const b = fakeBrowser({ fail });
    await expect(run(b)).rejects.toThrow(`${fail} failed`);
    expect(b.closed()).toBe(1);
  });

  it('always closes the browser when the page never becomes ready (budget timeout)', async () => {
    const b = fakeBrowser({ hang: 'ready' });
    await expect(run(b, 50)).rejects.toThrow('timeout');
    expect(b.closed()).toBe(1);
  });

  it('kills the process when close() throws or hangs; the original outcome is kept', async () => {
    const throwing = fakeBrowser({ fail: 'close' });
    expect(await run(throwing)).toBe(PDF);
    expect(throwing.kill).toHaveBeenCalledWith('SIGKILL');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hanging = fakeBrowser({ hang: 'close', fail: 'goto' });
    const done = expect(run(hanging)).rejects.toThrow('goto failed');
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(hanging.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('a launch failure rejects with nothing to close', async () => {
    await expect(renderReportPdf(model, { origin: 'https://app.test', prefs: DEFAULT_PREFS, launch: async () => Promise.reject(new Error('no chromium')) })).rejects.toThrow('no chromium');
  });

  it('a launch that finishes after the budget ran out is still closed', async () => {
    const b = fakeBrowser();
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    const p = renderReportPdf(model, { origin: 'https://app.test', prefs: DEFAULT_PREFS, launch: async () => (await late, b.browser), budgetMs: 20 });
    setTimeout(release, 60);
    await expect(p).rejects.toThrow('timeout');
    expect(b.closed()).toBe(1);
  });
});

describe('renderReportPdf queue and cleanup cap', () => {
  const opts = (launch: () => Promise<Browser>) => ({ origin: 'https://app.test', prefs: DEFAULT_PREFS, launch });

  it('renders one PDF at a time: the second launch waits for the first to finish', async () => {
    const first = fakeBrowser({ hang: 'goto' });
    const second = fakeBrowser();
    const launches: string[] = [];
    const p1 = renderReportPdf(model, { ...opts(async () => (launches.push('one'), first.browser)), budgetMs: 60 });
    const p2 = renderReportPdf(model, opts(async () => (launches.push('two'), second.browser)));
    await new Promise((r) => setTimeout(r, 30));
    expect(launches).toEqual(['one']); // first is still stuck on goto
    await expect(p1).rejects.toThrow('timeout'); // ...and a failure does not poison the chain
    expect(await p2).toBe(PDF);
    expect(launches).toEqual(['one', 'two']);
    expect(first.closed()).toBe(1);
    expect(second.closed()).toBe(1);
  });

  it('the answer waits at most 5 s for a launch that never finishes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled = false;
    const p = renderReportPdf(model, { ...opts(() => never()), budgetMs: 100 }).catch((e: Error) => ((settled = true), e.message));
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(4_800);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(await p).toBe('timeout');
  });
});
