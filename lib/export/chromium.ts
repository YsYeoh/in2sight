import 'server-only';
import type { Browser } from 'puppeteer-core';

/**
 * The real browser for lib/export/pdf.ts: @sparticuz/chromium's serverless build (Linux; unpacked to /tmp on first use,
 * which is the cold-start cost SPEC §7d accepts). CHROMIUM_PATH (optional) points at a locally installed Chrome for
 * trying the PDF route off Vercel. Loaded lazily so nothing else pays for these packages.
 */
export async function launchChromium(): Promise<Browser> {
  const [{ default: puppeteer }, { default: chromium }] = await Promise.all([import('puppeteer-core'), import('@sparticuz/chromium')]);
  const local = process.env.CHROMIUM_PATH?.trim();
  return puppeteer.launch({
    args: local ? [] : await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    executablePath: local || (await chromium.executablePath()),
    headless: local ? true : 'shell',
    defaultViewport: { width: 794, height: 1123 }, // A4 at 96 dpi: the md layout, same as the printed page
    timeout: 15_000, // launch timeout: bounds the wait in renderReportPdf's finally
  });
}
