import type { Prefs, Theme, Mode } from '@/lib/prefs';

/**
 * Browser-chrome colour (meta theme-color, manifest) per theme and mode = that palette's --background in
 * styles/tokens.css. A meta tag cannot read CSS variables, so the values are copied here; tests/pwa.test.ts fails if
 * they drift.
 */
export const THEME_COLORS: Record<Theme, Record<Mode, string>> = {
  ink: { light: '#F8FAFC', dark: '#0B1020' },
  sunset: { light: '#FFF8F5', dark: '#1A1011' },
  forest: { light: '#F6F8F5', dark: '#0C1510' },
  mono: { light: '#FAFAFA', dark: '#09090B' },
};

export const themeColor = (p: Pick<Prefs, 'theme' | 'mode'>): string => THEME_COLORS[p.theme][p.mode];
