export const THEMES = ['ink', 'sunset', 'forest', 'mono'] as const;
export const MODES = ['light', 'dark'] as const;
export const DENSITIES = ['dense', 'comfortable'] as const;
export const RADII = ['sharp', 'soft', 'round'] as const;
export const LOCALES = ['en', 'zh-CN'] as const;
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'D MMM YYYY'] as const;
export const TIME_FORMATS = ['24h', '12h'] as const;
export const NUMBER_FORMATS = ['1,234.5', '1.234,5', '1 234,5'] as const;
export const WEEK_STARTS = ['mon', 'sun'] as const;

export type Theme = (typeof THEMES)[number];
export type Mode = (typeof MODES)[number];
export type Density = (typeof DENSITIES)[number];
export type Radius = (typeof RADII)[number];
export type Locale = (typeof LOCALES)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type WeekStart = (typeof WEEK_STARTS)[number];

export interface Prefs {
  theme: Theme;
  mode: Mode;
  density: Density;
  radius: Radius;
  locale: Locale;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormat;
  weekStart: WeekStart;
  timezone: string;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'ink',
  mode: 'light',
  density: 'dense',
  radius: 'soft',
  locale: 'en',
  dateFormat: 'D MMM YYYY',
  timeFormat: '24h',
  numberFormat: '1,234.5',
  weekStart: 'mon',
  timezone: 'Asia/Kuala_Lumpur',
};

export const PREFS_COOKIE = 'in2sight_prefs';
const MAX_COOKIE_LENGTH = 2048;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pick<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** Always returns a complete, valid Prefs. Unknown keys are dropped; invalid values fall back per field. */
export function parsePrefs(raw: unknown): Prefs {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFS;
  return {
    theme: pick(THEMES, r.theme, d.theme),
    mode: pick(MODES, r.mode, d.mode),
    density: pick(DENSITIES, r.density, d.density),
    radius: pick(RADII, r.radius, d.radius),
    locale: pick(LOCALES, r.locale, d.locale),
    dateFormat: pick(DATE_FORMATS, r.dateFormat, d.dateFormat),
    timeFormat: pick(TIME_FORMATS, r.timeFormat, d.timeFormat),
    numberFormat: pick(NUMBER_FORMATS, r.numberFormat, d.numberFormat),
    weekStart: pick(WEEK_STARTS, r.weekStart, d.weekStart),
    timezone: isValidTimeZone(r.timezone) ? r.timezone : d.timezone,
  };
}

export function serializePrefs(p: Prefs): string {
  return encodeURIComponent(JSON.stringify(p));
}

export function parsePrefsCookie(value: string | undefined | null): Prefs {
  if (!value || value.length > MAX_COOKIE_LENGTH) return parsePrefs(null);
  try {
    return parsePrefs(JSON.parse(decodeURIComponent(value)));
  } catch {
    return parsePrefs(null);
  }
}

/** The single source for the attributes on <html>; used by the server layout and the client provider. */
export function htmlAttrs(p: Prefs) {
  return {
    lang: p.locale,
    'data-theme': p.theme,
    'data-mode': p.mode,
    'data-density': p.density,
    'data-radius': p.radius,
  } as const;
}
