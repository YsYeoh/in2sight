import { describe, expect, it } from 'vitest';
import { CELL_MAX, excelDateFormat, excelDateTimeFormat, safeText, sheetNames } from '@/lib/export/cells';
import { wallClock } from '@/lib/format';

const BRAND = '品牌'; // 品牌
// invisible characters, spelled out so the source stays readable
const NBSP = String.fromCharCode(0xa0);
const ZWSP = String.fromCharCode(0x200b);
const WJ = String.fromCharCode(0x2060);
const BOM = String.fromCharCode(0xfeff);
const GRIN = '\u{1F600}'; // 😀

describe('safeText (formula injection guard)', () => {
  it('prefixes an apostrophe to text Excel would treat as a formula', () => {
    // last four: full-width = + - @
    for (const s of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', '＝1+1', '＋1', '－1', '＠x', ' =HYPERLINK(1)', `${NBSP}=1+1`, '\n=cmd', `${ZWSP}=1`, `${BOM}+1`, ` ${WJ}@x`])
      expect(safeText(s), JSON.stringify(s)).toBe(`'${s}`);
  });

  it('leaves ordinary text alone and empties to null (an empty cell, never "")', () => {
    for (const s of ['hello', 'a =b', ' hello', '5', `${BRAND} ✨`, "'already quoted", '#hashtag', '1+1']) expect(safeText(s)).toBe(s);
    expect(safeText('')).toBeNull();
    expect(safeText(null)).toBeNull();
    expect(safeText(undefined)).toBeNull();
  });

  it("caps at Excel's 32,767 characters without splitting an emoji", () => {
    expect(safeText('x'.repeat(40_000))!.length).toBe(CELL_MAX);
    const emoji = safeText('x'.repeat(CELL_MAX - 1) + GRIN.repeat(5))!;
    expect(emoji.length).toBe(CELL_MAX - 1);
    expect(emoji.endsWith('x')).toBe(true);
  });
});

describe('sheetNames', () => {
  it('passes valid names through', () => {
    expect(sheetNames(['Summary', 'Daily', '概要'])).toEqual(['Summary', 'Daily', '概要']);
  });

  it('removes forbidden characters, apostrophes at the ends, caps at 31 units, never empty', () => {
    const [a, b, c, d] = sheetNames(['a[b]c:d*e?f/g\\h', "'quoted'", 'x'.repeat(40), '???']);
    expect(a).toBe('a b c d e f g h');
    expect(b).toBe('quoted');
    expect(c).toBe('x'.repeat(31));
    expect(d).toBe('Sheet');
    expect(sheetNames([GRIN.repeat(20)])[0]).toBe(GRIN.repeat(15)); // 30 UTF-16 units: the 16th emoji would be 32
  });

  it('makes names unique ignoring case, still within 31', () => {
    expect(sheetNames(['Posts', 'posts', 'POSTS'])).toEqual(['Posts', 'posts (2)', 'POSTS (3)']);
    const [, long] = sheetNames(['y'.repeat(31), 'y'.repeat(31)]);
    expect(long).toBe(`${'y'.repeat(27)} (2)`);
  });
});

describe('Excel date formats follow the owner settings', () => {
  it('maps each app date format', () => {
    expect(excelDateFormat('YYYY-MM-DD', 'en')).toBe('yyyy-mm-dd');
    expect(excelDateFormat('DD/MM/YYYY', 'en')).toBe('dd/mm/yyyy');
    expect(excelDateFormat('MM/DD/YYYY', 'en')).toBe('mm/dd/yyyy');
    expect(excelDateFormat('D MMM YYYY', 'en')).toBe('d mmm yyyy');
    expect(excelDateFormat('D MMM YYYY', 'zh-CN')).toBe('yyyy"年"m"月"d"日"');
  });
  it('adds the time in 24h or 12h', () => {
    expect(excelDateTimeFormat('YYYY-MM-DD', '24h', 'en')).toBe('yyyy-mm-dd hh:mm');
    expect(excelDateTimeFormat('DD/MM/YYYY', '12h', 'en')).toBe('dd/mm/yyyy h:mm AM/PM');
  });
});

describe('wallClock', () => {
  it('moves an instant to the owner wall clock (Excel has no timezones)', () => {
    expect(wallClock('2026-10-15T01:30:00Z', 'Asia/Kuala_Lumpur')?.toISOString()).toBe('2026-10-15T09:30:00.000Z');
    expect(wallClock('2026-10-15T01:30:00Z', 'America/Los_Angeles')?.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  });
  it('a day string stays that day at midnight with tz UTC; junk is null', () => {
    expect(wallClock('2026-10-15', 'UTC')?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(wallClock('not a date', 'UTC')).toBeNull();
    expect(wallClock(null, 'UTC')).toBeNull();
  });
});
