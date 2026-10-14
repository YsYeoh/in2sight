import type { Prefs } from '@/lib/prefs';

export type FormatPrefs = Pick<Prefs, 'locale' | 'dateFormat' | 'timeFormat' | 'numberFormat' | 'timezone'>;
export type DateInput = Date | string | number | null | undefined;

const DASH = '—';
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Calendar/clock parts of an instant in a given timezone (24h clock, zero padded). */
function parts(d: Date, tz: string): { year: string; month: string; day: string; hour: string; minute: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: o.minute };
}

export function formatDate(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  if (!d) return DASH;
  const { year, month, day } = parts(d, p.timezone);
  switch (p.dateFormat) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'D MMM YYYY':
      return p.locale === 'zh-CN' ? `${year}年${Number(month)}月${Number(day)}日` : `${Number(day)} ${MONTHS_EN[Number(month) - 1]} ${year}`;
  }
}

export function formatTime(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  if (!d) return DASH;
  const { hour, minute } = parts(d, p.timezone);
  if (p.timeFormat === '24h') return `${hour}:${minute}`;
  const h = Number(hour);
  const h12 = h % 12 || 12;
  return p.locale === 'zh-CN' ? `${h < 12 ? '上午' : '下午'}${h12}:${minute}` : `${h12}:${minute} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  return d ? `${formatDate(d, p)} ${formatTime(d, p)}` : DASH;
}

/** A calendar day 'YYYY-MM-DD' that is already in the owner's timezone (account_daily.day): no timezone shift. */
export function formatDay(day: string, p: FormatPrefs): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDate(`${day}T12:00:00Z`, { ...p, timezone: 'UTC' }) : DASH;
}

const NUMBER_LOCALE = { '1,234.5': 'en-US', '1.234,5': 'de-DE', '1 234,5': 'fr-FR' } as const;

function isNum(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function formatNumber(
  n: number | null | undefined,
  p: FormatPrefs,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  if (!isNum(n)) return DASH;
  const out = new Intl.NumberFormat(NUMBER_LOCALE[p.numberFormat], {
    maximumFractionDigits: opts.maximumFractionDigits ?? Math.max(2, opts.minimumFractionDigits ?? 0),
    minimumFractionDigits: opts.minimumFractionDigits,
    signDisplay: 'negative', // no sign when the value rounds to zero (never "-0")
  }).format(n);
  // ICU uses U+202F or U+00A0 depending on version; normalise to a non-breaking space.
  return out.replace(/[  ]/g, ' ');
}

const UNITS = [
  [1, ''],
  [1e3, 'K'],
  [1e6, 'M'],
  [1e9, 'B'],
] as const;

export function formatCompact(n: number | null | undefined, p: FormatPrefs): string {
  if (!isNum(n)) return DASH;
  let i = 0;
  while (i < UNITS.length - 1 && Math.abs(n) >= UNITS[i + 1][0]) i++;
  let v = n / UNITS[i][0];
  let digits = i > 0 && Math.abs(v) < 100 ? 1 : 0;
  // 999,999 -> "1000K" must roll over to "1M"
  if (i < UNITS.length - 1 && Math.abs(Number(v.toFixed(digits))) >= 1000) {
    i++;
    v = n / UNITS[i][0];
    digits = Math.abs(v) < 100 ? 1 : 0;
  }
  return formatNumber(v, p, { maximumFractionDigits: digits }) + UNITS[i][1];
}

export function formatPercent(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
  if (!isNum(ratio)) return DASH;
  return `${formatNumber(ratio * 100, p, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** "+12" / "-3.5" / "0": a signed absolute change. Never a signed zero. */
export function formatSigned(n: number | null | undefined, p: FormatPrefs, digits = 0): string {
  if (!isNum(n)) return DASH;
  const fixed = { minimumFractionDigits: digits, maximumFractionDigits: digits };
  if (Number(n.toFixed(digits)) === 0) return formatNumber(0, p, fixed);
  return `${n > 0 ? '+' : '-'}${formatNumber(Math.abs(n), p, fixed)}`;
}

export function formatDelta(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
  return isNum(ratio) ? `${formatSigned(ratio * 100, p, digits)}%` : DASH;
}
