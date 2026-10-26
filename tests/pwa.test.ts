import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { render, screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

vi.mock('next-intl/server', () => ({ getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages: en, namespace: namespace as never }) }));

import manifest from '@/app/manifest';
import OfflinePage from '@/app/offline/page';
import { applyPrefsToDocument } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS, MODES, THEMES } from '@/lib/prefs';
import { THEME_COLORS, themeColor } from '@/lib/pwa';
import { config } from '@/proxy';

const tokens = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');
const tokenOf = (theme: string, mode: string, name: string) => {
  const block = tokens.split(`:root[data-theme="${theme}"][data-mode="${mode}"]{`)[1]?.split('}')[0] ?? '';
  return block.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`))?.[1];
};

/** Width, height, colour type and the alpha of the top-left pixel of an 8-bit RGBA PNG (filter 0 rows, as written). */
function pngInfo(path: string) {
  const b = readFileSync(join(process.cwd(), path));
  expect(b.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    if (b.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25], topLeftAlpha: inflateSync(Buffer.concat(idat))[4] };
}

describe('PWA', () => {
  it('manifest: installable standalone app starting at /overview with 192/512/maskable icons', () => {
    const m = manifest();
    expect(m).toMatchObject({ name: 'in2sight', short_name: 'in2sight', start_url: '/overview', scope: '/', display: 'standalone', theme_color: '#F8FAFC', background_color: '#F8FAFC' });
    expect(m.icons?.map((i) => [i.src, i.sizes, i.purpose])).toEqual([
      ['/icons/icon-192.png', '192x192', 'any'],
      ['/icons/icon-512.png', '512x512', 'any'],
      ['/icons/maskable-512.png', '512x512', 'maskable'],
    ]);
  });

  it.each([
    ['public/icons/icon-192.png', 192, 0],
    ['public/icons/icon-512.png', 512, 0],
    ['public/icons/maskable-512.png', 512, 255],
    ['public/icons/apple-touch-icon.png', 180, 255],
  ])('%s is a %ipx RGBA PNG (maskable/Apple icons are full bleed)', (path, size, alpha) => {
    expect(pngInfo(path)).toEqual({ width: size, height: size, colorType: 6, topLeftAlpha: alpha });
  });

  it('the icon script uses the Ink brand colours from tokens.css', () => {
    const script = readFileSync(join(process.cwd(), 'scripts/make-icons.mjs'), 'utf8');
    for (const n of ['chart-1', 'chart-5', 'chart-4']) expect(script).toContain(tokenOf('ink', 'light', n));
  });

  it('theme colours equal each palette background in tokens.css', () => {
    for (const theme of THEMES) for (const mode of ['light', 'dark'] as const) expect(THEME_COLORS[theme][mode], `${theme}/${mode}`).toBe(tokenOf(theme, mode, 'background'));
    expect(MODES).toContain('auto'); // auto resolves to one of the two (tests/prefs-auto-mode.test.tsx)
    expect(themeColor({ theme: 'forest', mode: 'dark' })).toBe('#0C1510');
  });

  it('switching theme updates the theme-color meta tag', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#F8FAFC';
    document.head.append(meta);
    applyPrefsToDocument({ ...DEFAULT_PREFS, theme: 'sunset', mode: 'dark' });
    expect(meta.content).toBe('#1A1011');
    meta.remove();
  });

  it('manifest, service worker, icons and the offline page are reachable without a session (proxy skips them)', () => {
    const re = new RegExp('^' + config.matcher[0] + '$');
    for (const path of ['/manifest.webmanifest', '/sw.js', '/offline', '/icons/icon-192.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/favicon.ico']) expect(re.test(path), path).toBe(false);
    for (const path of ['/overview', '/api/cron/tick', '/settings']) expect(re.test(path), path).toBe(true);
  });

  it('the offline page is plain public text with a way back', async () => {
    render(await OfflinePage());
    expect(screen.getByRole('heading', { name: en.pwa.offline.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.pwa.offline.retry })).toHaveAttribute('href', '/overview');
  });
});
