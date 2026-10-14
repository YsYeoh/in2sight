import { describe, expect, it } from 'vitest';
import { formatCompact, formatDate, formatDateTime, formatDelta, formatHour, formatNumber, formatPercent, formatTime, type FormatPrefs } from '@/lib/format';

const P: FormatPrefs = { locale: 'en', dateFormat: 'DD/MM/YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'Asia/Kuala_Lumpur' };
const with_ = (o: Partial<FormatPrefs>): FormatPrefs => ({ ...P, ...o });
// 16:02 UTC on 13 Oct is 00:02 on 14 Oct in Kuala Lumpur (UTC+8)
const T = '2026-10-13T16:02:00Z';
const NBSP = ' ';

describe('formatDate', () => {
  it('renders every date format in the user timezone (not UTC)', () => {
    expect(formatDate(T, with_({ dateFormat: 'YYYY-MM-DD' }))).toBe('2026-10-14');
    expect(formatDate(T, with_({ dateFormat: 'DD/MM/YYYY' }))).toBe('14/10/2026');
    expect(formatDate(T, with_({ dateFormat: 'MM/DD/YYYY' }))).toBe('10/14/2026');
    expect(formatDate(T, with_({ dateFormat: 'D MMM YYYY' }))).toBe('14 Oct 2026');
  });

  it('uses the Chinese pattern for D MMM YYYY when the locale is zh-CN', () => {
    expect(formatDate(T, with_({ dateFormat: 'D MMM YYYY', locale: 'zh-CN' }))).toBe('2026年10月14日');
  });

  it('the same instant shows a different calendar day in UTC', () => {
    expect(formatDate(T, with_({ timezone: 'UTC' }))).toBe('13/10/2026');
  });

  it('accepts Date, ISO string and epoch milliseconds', () => {
    const ms = Date.parse(T);
    expect(formatDate(new Date(ms), P)).toBe('14/10/2026');
    expect(formatDate(ms, P)).toBe('14/10/2026');
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(formatDate(T, with_({ timezone: 'Not/AZone' }))).toBe('13/10/2026');
  });

  it.each([null, undefined, 'garbage', NaN, new Date('nope')])('shows an em dash for invalid input %j', (v) => {
    expect(formatDate(v as never, P)).toBe('—');
  });
});

describe('formatTime', () => {
  it('24h is zero padded and handles midnight as 00', () => {
    expect(formatTime(T, P)).toBe('00:02');
    expect(formatTime('2026-10-13T08:05:00Z', P)).toBe('16:05');
  });

  it('12h english uses AM/PM with no leading zero', () => {
    expect(formatTime(T, with_({ timeFormat: '12h' }))).toBe('12:02 AM');
    expect(formatTime('2026-10-13T08:05:00Z', with_({ timeFormat: '12h' }))).toBe('4:05 PM');
    expect(formatTime('2026-10-13T04:00:00Z', with_({ timeFormat: '12h' }))).toBe('12:00 PM');
  });

  it('12h chinese uses 上午/下午', () => {
    expect(formatTime(T, with_({ timeFormat: '12h', locale: 'zh-CN' }))).toBe('上午12:02');
    expect(formatTime('2026-10-13T08:05:00Z', with_({ timeFormat: '12h', locale: 'zh-CN' }))).toBe('下午4:05');
  });

  it('follows daylight saving time (America/New_York, 8 March 2026)', () => {
    const ny = with_({ timezone: 'America/New_York' });
    expect(formatTime('2026-03-08T06:30:00Z', ny)).toBe('01:30'); // still EST
    expect(formatTime('2026-03-08T07:30:00Z', ny)).toBe('03:30'); // EDT began at 07:00Z
  });

  it('shows an em dash for invalid input', () => {
    expect(formatTime(null, P)).toBe('—');
  });
});

describe('formatHour', () => {
  it('an hour of the day (already in the owner timezone) follows the 12/24h setting', () => {
    expect(formatHour(0, P)).toBe('00:00');
    expect(formatHour(13, P)).toBe('13:00');
    expect(formatHour(0, with_({ timeFormat: '12h' }))).toBe('12:00 AM');
    expect(formatHour(13, with_({ timeFormat: '12h' }))).toBe('1:00 PM');
    expect(formatHour(13, with_({ timeFormat: '12h', locale: 'zh-CN' }))).toBe('下午1:00');
  });
});

describe('formatDateTime', () => {
  it('joins date and time with a space', () => {
    expect(formatDateTime(T, P)).toBe('14/10/2026 00:02');
    expect(formatDateTime('nope', P)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('supports the three separator styles', () => {
    expect(formatNumber(1234567.891, P)).toBe('1,234,567.89');
    expect(formatNumber(1234567.891, with_({ numberFormat: '1.234,5' }))).toBe('1.234.567,89');
    expect(formatNumber(1234567.891, with_({ numberFormat: '1 234,5' }))).toBe(`1${NBSP}234${NBSP}567,89`);
  });

  it('honours fraction digit options, zero and negatives', () => {
    expect(formatNumber(1234.5, P, { maximumFractionDigits: 0 })).toBe('1,235');
    expect(formatNumber(0, P)).toBe('0');
    expect(formatNumber(-1234.5, P)).toBe('-1,234.5');
    expect(formatNumber(2, P, { minimumFractionDigits: 1 })).toBe('2.0');
  });

  it('never prints a signed zero but keeps the sign of genuine negatives', () => {
    expect(formatNumber(-0.004, P)).toBe('0');
    expect(formatNumber(-0.004, P, { maximumFractionDigits: 1, minimumFractionDigits: 1 })).toBe('0.0');
    expect(formatNumber(-0.4, P)).toBe('-0.4');
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('shows an em dash for %j', (v) => {
    expect(formatNumber(v as never, P)).toBe('—');
  });
});

describe('formatCompact', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [12480, '12.5K'],
    [184200, '184K'],
    [999_999, '1M'], // must roll over, never "1,000K"
    [1_500_000, '1.5M'],
    [2_000_000_000, '2B'],
    [-2500, '-2.5K'],
  ])('%j -> %s', (n, expected) => {
    expect(formatCompact(n, P)).toBe(expected);
  });

  it('uses the decimal separator of the chosen number format', () => {
    expect(formatCompact(12480, with_({ numberFormat: '1.234,5' }))).toBe('12,5K');
  });

  it('never prints a signed zero', () => {
    expect(formatCompact(-0.4, P)).toBe('0');
  });

  it('shows an em dash for missing data', () => {
    expect(formatCompact(null, P)).toBe('—');
    expect(formatCompact(NaN, P)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats a ratio with one decimal by default', () => {
    expect(formatPercent(0.048, P)).toBe('4.8%');
    expect(formatPercent(0.5, P, 0)).toBe('50%');
    expect(formatPercent(0.048, with_({ numberFormat: '1.234,5' }))).toBe('4,8%');
  });

  it('never prints a signed zero', () => {
    expect(formatPercent(-0.00001, P)).toBe('0.0%');
  });

  it('shows an em dash for missing data', () => {
    expect(formatPercent(undefined, P)).toBe('—');
    expect(formatPercent(Infinity, P)).toBe('—');
  });
});

describe('formatDelta', () => {
  it('signs positive and negative changes', () => {
    expect(formatDelta(0.032, P)).toBe('+3.2%');
    expect(formatDelta(-0.032, P)).toBe('-3.2%');
  });

  it('never prints a signed zero ("-0.0%" or "+0.0%")', () => {
    expect(formatDelta(0, P)).toBe('0.0%');
    expect(formatDelta(-0.0004, P)).toBe('0.0%');
    expect(formatDelta(0.0004, P)).toBe('0.0%');
  });

  it('shows an em dash for missing data', () => {
    expect(formatDelta(null, P)).toBe('—');
  });
});
