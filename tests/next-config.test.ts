import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '@/next.config';

describe('next.config', () => {
  it('serves /sw.js uncached, as JavaScript, allowed to control the whole site', async () => {
    const rules = await nextConfig.headers!();
    const sw = rules.find((r) => r.source === '/sw.js');
    expect(sw?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ]),
    );
  });

  it('keeps the Tailwind turbopack wiring untouched', () => {
    const src = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(src).toMatch(/"\*\.css":\s*\{\s*loaders:\s*\["@tailwindcss\/turbopack"\],\s*as:\s*"\*\.css",\s*\}/);
  });
});
