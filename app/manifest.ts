import type { MetadataRoute } from 'next';
import { THEME_COLORS } from '@/lib/pwa';

// Served at /manifest.webmanifest (public: proxy.ts skips it). Fetched without the user's cookie, so the colours are
// the default theme's; the per-user theme colour comes from the meta tag (app/layout.tsx generateViewport).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/overview',
    name: 'in2sight',
    short_name: 'in2sight',
    start_url: '/overview',
    scope: '/',
    display: 'standalone',
    background_color: THEME_COLORS.ink.light,
    theme_color: THEME_COLORS.ink.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
