// Download file names. Account and group names may contain emoji, CJK, slashes or quotes: the header carries an
// ASCII-only `filename` (old clients) plus the exact UTF-8 name in RFC 5987/6266 `filename*` (every current browser).

// path separators, quotes, Windows-reserved characters and controls can never be part of a file name
const UNSAFE = /[\u0000-\u001f\u007f"\\/:*?<>|]+/g;
const MAX = 100; // code points, before the extension

function clean(base: string): string {
  const s = [...base.normalize('NFC').replace(UNSAFE, '-').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim()].slice(0, MAX).join('').trim();
  return s.replace(/^\.+/, '') || 'in2sight'; // never a hidden or empty name
}

/** 'in2sight-<scope>-<first day>_<last day>': the file name says which days it holds. */
export function exportBasename(label: string, range: { from: string; to: string }): string {
  return `in2sight-${label}-${range.from}_${range.to}`;
}

export function contentDisposition(base: string, ext: 'xlsx' | 'pdf' | 'json'): string {
  const name = clean(base);
  const ascii =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'in2sight';
  // encodeURIComponent leaves ' ( ) * unencoded; RFC 5987 attr-char does not allow them
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${star}.${ext}`;
}

/** The browser side: the name to save a fetched blob under (same cleaning, so a hostile header cannot pick a path). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let name: string | null = null;
  if (star) {
    try {
      name = decodeURIComponent(star.trim());
    } catch {
      name = null;
    }
  }
  name ??= header?.match(/filename="([^"]*)"/i)?.[1] ?? null;
  if (!name) return fallback;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext === 'xlsx' || ext === 'pdf' || ext === 'json' ?`${clean(name.slice(0, dot))}.${ext}` : fallback;
}
