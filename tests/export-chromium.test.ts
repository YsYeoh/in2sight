// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const launched = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('puppeteer-core', () => ({
  default: {
    launch: async (o: Record<string, unknown>) => (launched.push(o), { fake: true }),
    defaultArgs: async ({ args }: { args: string[] }) => ['--default', ...args],
  },
}));
vi.mock('@sparticuz/chromium', () => ({ default: { args: ['--serverless'], executablePath: async () => '/tmp/chromium' } }));

import { launchChromium } from '@/lib/export/chromium';

afterEach(() => {
  launched.length = 0;
  vi.unstubAllEnvs();
});

describe('launchChromium', () => {
  it('serverless: the @sparticuz build in headless shell mode, A4 viewport, bounded launch', async () => {
    vi.stubEnv('CHROMIUM_PATH', '');
    await launchChromium();
    expect(launched[0]).toMatchObject({ executablePath: '/tmp/chromium', headless: 'shell', args: ['--default', '--serverless'], defaultViewport: { width: 794, height: 1123 }, timeout: 15_000 });
  });

  it('CHROMIUM_PATH: a local Chrome, plain headless, no serverless flags', async () => {
    vi.stubEnv('CHROMIUM_PATH', ' C:/Program Files/Google/Chrome/Application/chrome.exe ');
    await launchChromium();
    expect(launched[0]).toMatchObject({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: [] });
  });
});
