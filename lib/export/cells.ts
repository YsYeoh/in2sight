// Spreadsheet cell rules shared by every sheet: safe text, sheet names, Excel number formats for the owner's settings.
import type { DateFormat, Locale, TimeFormat } from '@/lib/prefs';

/** Excel's hard limit per cell; longer text is cut (a caption can be up to 2,200 characters, so this never bites in practice). */
export const CELL_MAX = 32_767;

// A cell starting with one of these is read as a formula by Excel/LibreOffice/Sheets once someone edits or re-saves it
// as CSV (OWASP "CSV injection"). Full-width variants (U+FF1D, U+FF0B, U+FF0D, U+FF20) are included because some IMEs
// turn them into formulas too.
const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/**
 * Text from users or Meta (captions, usernames, tag/group/city names) → a cell string, or null for an empty cell.
 * Formula-like text gets a leading apostrophe. Visible on purpose: it survives copy/paste and CSV re-saves (an
 * invisible zero-width prefix would not, and would silently break lookups). The cell is a string cell either way.
 */
export function safeText(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const guarded = FORMULA_START.test(v) ? `'${v}` : v;
  if (guarded.length <= CELL_MAX) return guarded;
  const cut = guarded.slice(0, CELL_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut; // never leave half an emoji
}

const SHEET_FORBIDDEN = /[[\]:*?/\\]/g;

/** Excel sheet names: 1–31 UTF-16 units, none of []:*?/\, no leading/trailing apostrophe, unique ignoring case. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  const fit = (s: string, max: number) => {
    let out = '';
    for (const ch of s) {
      if (out.length + ch.length > max) break;
      out += ch;
    }
    return out;
  };
  return names.map((raw) => {
    const base = fit(raw.replace(SHEET_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, ''), 31).trim() || 'Sheet';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${fit(base, 31 - ` (${i})`.length)} (${i})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The owner's date format as an Excel number format (SPEC §8b.7 formats map 1:1). */
export function excelDateFormat(f: DateFormat, locale: Locale): string {
  switch (f) {
    case 'YYYY-MM-DD':
      return 'yyyy-mm-dd';
    case 'DD/MM/YYYY':
      return 'dd/mm/yyyy';
    case 'MM/DD/YYYY':
      return 'mm/dd/yyyy';
    case 'D MMM YYYY':
      return locale === 'zh-CN' ? 'yyyy"年"m"月"d"日"' : 'd mmm yyyy';
  }
}

/** ponytail: 12h uses Excel's AM/PM marker, which Excel prints in the viewer's language; add [$-804] if zh-CN wants 上午/下午 forced. */
export function excelDateTimeFormat(f: DateFormat, t: TimeFormat, locale: Locale): string {
  return `${excelDateFormat(f, locale)} ${t === '24h' ? 'hh:mm' : 'h:mm AM/PM'}`;
}

/** Counts and ratios. The thousands/decimal separators follow the viewer's Excel locale (not the app's number format). */
export const COUNT_FORMAT = '#,##0';
export const AVG_FORMAT = '#,##0.0';
export const PERCENT_FORMAT = '0.0%';
