// Tag input rules, shared by the server actions (trust boundary) and the Tags page form (early feedback).
// The DB enforces the same limits (supabase/migrations/20261017000001_tags.sql); this file decides the error keys.

export const TAG_NAME_MAX = 40;
export const MAX_TAGS_PER_POST = 10;
export const TAG_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;
type TagColor = (typeof TAG_COLORS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Instagram media ids are numeric strings today; allow word characters so a format change does not lock tagging. */
const MEDIA_ID = /^\w{1,64}$/;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isMediaId = (v: unknown): v is string => typeof v === 'string' && MEDIA_ID.test(v);

// C0/C1 controls, and bidi overrides/isolates (U+202A-U+202E, U+2066-U+2069) that can make a name render as
// something else. Plain RTL text (Arabic, Hebrew) is fine. Tabs/newlines are whitespace and collapse instead.
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** NFC, whitespace collapsed and trimmed, 1-`max` code points (Postgres char_length counts code points too). Also
 *  used for saved Explorer view names (max 60). */
export function normalizeTagName(raw: unknown, max: number = TAG_NAME_MAX): { ok: true; value: string } | { ok: false; error: 'invalid_name' } {
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_name' };
  const nfc = raw.normalize('NFC');
  if (FORBIDDEN.test(nfc)) return { ok: false, error: 'invalid_name' };
  const value = nfc.replace(/\s+/g, ' ').trim();
  if (value === '' || [...value].length > max) return { ok: false, error: 'invalid_name' };
  return { ok: true, value };
}

/** Same tag name ignoring case (the DB's unique index is on lower(name)). */
export const sameTagName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The least-used chart colour (first in order on a tie), so new tags spread over the palette. */
export function pickColor(used: string[]): TagColor {
  const count = (c: string) => used.filter((u) => u === c).length;
  return TAG_COLORS.reduce((best, c) => (count(c) < count(best) ? c : best), TAG_COLORS[0]);
}
