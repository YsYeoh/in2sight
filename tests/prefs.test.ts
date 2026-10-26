import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, THEMES, MODES, DENSITIES, RADII, LOCALES, DATE_FORMATS, TIME_FORMATS, NUMBER_FORMATS, WEEK_STARTS,
  htmlAttrs, isValidTimeZone, parsePrefs, parsePrefsCookie, serializePrefs, type Prefs,
} from '@/lib/prefs';

describe('defaults', () => {
  it('are the owner-approved values', () => {
    expect(DEFAULT_PREFS).toEqual({
      theme: 'ink', mode: 'light', density: 'dense', radius: 'soft', locale: 'en',
      dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', weekStart: 'mon', timezone: 'Asia/Kuala_Lumpur',
    });
  });

  it('every default is a member of its enum and the timezone is valid', () => {
    expect(THEMES).toContain(DEFAULT_PREFS.theme);
    expect(MODES).toContain(DEFAULT_PREFS.mode);
    expect(DENSITIES).toContain(DEFAULT_PREFS.density);
    expect(RADII).toContain(DEFAULT_PREFS.radius);
    expect(LOCALES).toContain(DEFAULT_PREFS.locale);
    expect(DATE_FORMATS).toContain(DEFAULT_PREFS.dateFormat);
    expect(TIME_FORMATS).toContain(DEFAULT_PREFS.timeFormat);
    expect(NUMBER_FORMATS).toContain(DEFAULT_PREFS.numberFormat);
    expect(WEEK_STARTS).toContain(DEFAULT_PREFS.weekStart);
    expect(isValidTimeZone(DEFAULT_PREFS.timezone)).toBe(true);
  });

  it('every theme has a palette in styles/tokens.css', () => {
    const css = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');
    for (const t of THEMES) {
      expect(css).toContain(`:root[data-theme="${t}"][data-mode="light"]{`);
      expect(css).toContain(`:root[data-theme="${t}"][data-mode="dark"]{`);
    }
  });
});

describe('parsePrefs', () => {
  it('keeps valid fields and falls back per field for invalid ones', () => {
    const p = parsePrefs({ theme: 'forest', mode: 'purple', density: 'comfortable', radius: 42, timezone: 'Not/AZone', dateFormat: 'DD/MM/YYYY' });
    expect(p.theme).toBe('forest');
    expect(p.mode).toBe(DEFAULT_PREFS.mode);
    expect(p.density).toBe('comfortable');
    expect(p.radius).toBe(DEFAULT_PREFS.radius);
    expect(p.timezone).toBe(DEFAULT_PREFS.timezone);
    expect(p.dateFormat).toBe('DD/MM/YYYY');
  });

  // each case is wrapped in its own row so vitest does not spread the array cases into separate arguments
  it.each([[null], [undefined], ['a string'], [42], [[]], [[1, 2]]])('returns full defaults for non-object input %j', (raw) => {
    expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('ignores unknown keys and returns a fresh object each time', () => {
    // JSON.parse creates a real own '__proto__' key (an object literal would just set the prototype)
    const p = parsePrefs(JSON.parse('{"theme":"mono","__proto__":{"theme":"sunset"},"evil":"<script>"}'));
    expect(p.theme).toBe('mono');
    expect(p).not.toHaveProperty('evil');
    expect(({} as Record<string, unknown>).theme).toBeUndefined();
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(p).not.toBe(DEFAULT_PREFS);
    expect(parsePrefs({})).not.toBe(parsePrefs({}));
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(123)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('cookie round trip', () => {
  it('serialize -> parse returns the same prefs', () => {
    const p: Prefs = { ...DEFAULT_PREFS, theme: 'sunset', mode: 'dark', locale: 'zh-CN', dateFormat: 'MM/DD/YYYY', timezone: 'America/New_York' };
    expect(parsePrefsCookie(serializePrefs(p))).toEqual(p);
  });

  it('serialized value is cookie-safe (no ; , or whitespace)', () => {
    expect(serializePrefs(DEFAULT_PREFS)).not.toMatch(/[;,\s]/);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['bad percent-encoding', '%E0%A4%A'],
    ['not JSON', encodeURIComponent('hello')],
    ['JSON but not an object', encodeURIComponent('42')],
    ['truncated JSON', encodeURIComponent('{"theme":"for')],
    ['oversized (> 2 KB) but otherwise valid', encodeURIComponent(JSON.stringify({ theme: 'mono', pad: 'x'.repeat(3000) }))],
  ])('falls back to defaults for a %s cookie without throwing', (_label, value) => {
    expect(parsePrefsCookie(value as string | null | undefined)).toEqual(DEFAULT_PREFS);
  });

  it('a tampered cookie keeps only the valid fields', () => {
    const value = encodeURIComponent(JSON.stringify({ theme: 'mono', radius: 'triangle', locale: 'zh-CN' }));
    expect(parsePrefsCookie(value)).toEqual({ ...DEFAULT_PREFS, theme: 'mono', locale: 'zh-CN' });
  });
});

describe('htmlAttrs', () => {
  it('maps prefs to the attributes the token CSS and next-intl rely on', () => {
    expect(htmlAttrs({ ...DEFAULT_PREFS, theme: 'forest', mode: 'dark', density: 'comfortable', radius: 'round', locale: 'zh-CN' })).toEqual({
      lang: 'zh-CN', 'data-theme': 'forest', 'data-mode': 'dark', 'data-mode-auto': 'false', 'data-density': 'comfortable', 'data-radius': 'round',
    });
  });
});
