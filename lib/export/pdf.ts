// Prints a ReportModel to an A4 PDF with headless Chromium. The browser comes from an injected `launch` (the real one is
// lib/export/chromium.ts; tests pass a fake), opens ONLY the app's own /report/print, receives the model over the
// DevTools protocol (never in a URL), and is always closed: a warm serverless function must not keep a zombie Chromium.
import type { Browser } from 'puppeteer-core';
import type { ReportModel } from '@/lib/export/report';
import { PREFS_COOKIE, serializePrefs, type Prefs } from '@/lib/prefs';

export type Launch = () => Promise<Browser>;

export const PRINT_PATH = '/report/print';
export const BUDGET_MS = 45_000; // inside the route's maxDuration (60 s), leaving time to answer
const GOTO_MS = 20_000;
const READY_MS = 15_000;
const PDF_MS = 20_000;
const CLOSE_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), ms)))]).finally(() => clearTimeout(timer));
}

async function closeQuietly(browser: Browser): Promise<void> {
  try {
    await withTimeout(browser.close(), CLOSE_MS);
  } catch {
    browser.process()?.kill('SIGKILL'); // close() failed or hung: never leave the process behind
  }
}

/** The one origin the headless browser may talk to: NEXT_PUBLIC_APP_URL's (https, or http://localhost for local runs). */
export function appOrigin(raw: string | undefined): string | null {
  try {
    const u = new URL(raw ?? '');
    const local = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    return u.protocol === 'https:' || local ? u.origin : null;
  } catch {
    return null;
  }
}

export async function renderReportPdf(model: ReportModel, o: { origin: string; prefs: Prefs; launch: Launch; budgetMs?: number }): Promise<Uint8Array> {
  const url = new URL(PRINT_PATH, o.origin);
  const launching = o.launch();
  try {
    return await withTimeout(
      (async () => {
        const browser = await launching;
        // the prefs cookie (not a secret) gives the root layout the owner's language, formats and theme; always light
        await browser.setCookie({ name: PREFS_COOKIE, value: serializePrefs({ ...o.prefs, mode: 'light' }), domain: url.hostname, path: '/', secure: url.protocol === 'https:', sameSite: 'Lax' });
        const page = await browser.newPage();
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          let same = false;
          try {
            same = new URL(req.url()).origin === url.origin;
          } catch {
            same = false;
          }
          void (same ? req.continue() : req.abort()).catch(() => undefined); // SSRF guard: our own origin only
        });
        await page.evaluateOnNewDocument((m: unknown) => {
          (window as unknown as { __IN2SIGHT_REPORT__: unknown }).__IN2SIGHT_REPORT__ = m;
        }, model);
        await page.goto(url.href, { waitUntil: 'networkidle0', timeout: GOTO_MS });
        await page.waitForSelector('[data-report-ready="true"]', { timeout: READY_MS });
        await page.evaluate(() => document.fonts.ready.then(() => true)); // Noto Sans SC slices loaded: no tofu
        return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: PDF_MS });
      })(),
      o.budgetMs ?? BUDGET_MS,
    );
  } finally {
    // waits for a launch still in progress (puppeteer's own launch timeout bounds it), then closes or kills it
    await launching.then(closeQuietly, () => undefined);
  }
}
