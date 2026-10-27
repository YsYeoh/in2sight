import { describe, expect, it } from 'vitest';
import { formatBytes, type FormatPrefs } from '@/lib/format';

const en: FormatPrefs = { locale: 'en', dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'UTC' };
const eu: FormatPrefs = { ...en, numberFormat: '1.234,5' };

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1,023 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [1024 * 1024 - 1, '1 MB'], // 1,023.999 KB never shows as "1,024 KB"
    [230 * 1024 * 1024, '230 MB'],
    [1.25 * 1024 ** 3, '1.3 GB'],
  ])('%d -> %s', (n, out) => {
    expect(formatBytes(n, en)).toBe(out);
  });

  it('uses the owner’s number format', () => {
    expect(formatBytes(1536, eu)).toBe('1,5 KB');
  });

  it('unknown or negative is a dash, never 0', () => {
    for (const v of [null, undefined, Number.NaN, -1]) expect(formatBytes(v, en)).toBe('—');
  });
});
