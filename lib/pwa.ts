import { resolveMode, type Prefs, type ResolvedMode, type Theme } from '@/lib/prefs';

/**
 * Browser-chrome colour (meta theme-color, manifest) per theme and mode = that palette's --background in
 * styles/tokens.css. A meta tag cannot read CSS variables, so the values are copied here; tests/pwa.test.ts fails if
 * they drift.
 */
export const THEME_COLORS: Record<Theme, Record<ResolvedMode, string>> = {
  ink: { light: '#F8FAFC', dark: '#0B1020' },
  sunset: { light: '#FFF8F5', dark: '#1A1011' },
  forest: { light: '#F6F8F5', dark: '#0C1510' },
  mono: { light: '#FAFAFA', dark: '#09090B' },
};

export const themeColor = (p: Pick<Prefs, 'theme' | 'mode'>, systemDark = false): string => THEME_COLORS[p.theme][resolveMode(p.mode, systemDark)];

/** iPhone/iPad, including iPadOS that reports itself as a Mac. Browser only (call from effects/handlers). */
export const isIos = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Running as the installed app. A feature check, never used for layout. Browser only. */
export const isStandalone = (): boolean => window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
