import { describe, expect, it } from 'vitest';
import { normalizeGroup } from '@/lib/accounts/group';

describe('normalizeGroup', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeGroup('  Brand   X ')).toEqual({ ok: true, value: 'Brand X' });
  });
  it('empty, whitespace-only, null and undefined mean "no group"', () => {
    for (const v of ['', '   ', null, undefined]) expect(normalizeGroup(v), String(v)).toEqual({ ok: true, value: null });
  });
  it('accepts exactly 40 characters, rejects 41, counting code points not UTF-16 units', () => {
    expect(normalizeGroup('a'.repeat(40))).toEqual({ ok: true, value: 'a'.repeat(40) });
    expect(normalizeGroup('a'.repeat(41))).toEqual({ ok: false });
    expect(normalizeGroup('😀'.repeat(40))).toEqual({ ok: true, value: '😀'.repeat(40) });
    expect(normalizeGroup('😀'.repeat(41))).toEqual({ ok: false });
  });
  it('rejects control characters', () => {
    for (const v of ['a\u0000b', 'a\u001fb', 'a\u007fb']) expect(normalizeGroup(v), JSON.stringify(v)).toEqual({ ok: false });
  });
  it('a tab or newline is whitespace, not a control rejection: it collapses', () => {
    expect(normalizeGroup('a\tb\nc')).toEqual({ ok: true, value: 'a b c' });
  });
  it('rejects non-strings', () => {
    for (const v of [42, {}, [], true]) expect(normalizeGroup(v as never), String(v)).toEqual({ ok: false });
  });
  it('keeps HTML as inert text and Chinese names intact', () => {
    expect(normalizeGroup('<b>x</b>')).toEqual({ ok: true, value: '<b>x</b>' });
    expect(normalizeGroup('品牌甲')).toEqual({ ok: true, value: '品牌甲' });
  });
});
