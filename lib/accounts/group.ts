const MAX = 40;

export function normalizeGroup(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  // tabs/newlines are ordinary whitespace and collapse; other control characters are rejected
  const text = raw.replace(/[\t\n\r]+/g, ' ');
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false };
  const value = text.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: true, value: null };
  if ([...value].length > MAX) return { ok: false };
  return { ok: true, value };
}
