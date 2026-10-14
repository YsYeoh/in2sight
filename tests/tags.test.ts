import { describe, expect, it } from 'vitest';
import { isMediaId, isUuid, normalizeTagName, pickColor, sameTagName, TAG_NAME_MAX } from '@/lib/tags';

describe('normalizeTagName', () => {
  it('trims and collapses whitespace (tabs, newlines, repeated spaces)', () => {
    expect(normalizeTagName('  Behind \t the\n\nscenes  ')).toEqual({ ok: true, value: 'Behind the scenes' });
  });

  it('normalises real-world names: emoji, RTL, CJK and NFD accents', () => {
    expect(normalizeTagName('🔥 Hot')).toEqual({ ok: true, value: '🔥 Hot' });
    expect(normalizeTagName('عروض خاصة')).toEqual({ ok: true, value: 'عروض خاصة' });
    expect(normalizeTagName('幕后花絮')).toEqual({ ok: true, value: '幕后花絮' });
    const nfd = 'Café'; // e + combining acute
    const r = normalizeTagName(nfd);
    expect(r).toEqual({ ok: true, value: 'Café' });
    expect(r.ok && r.value.length).toBe(4); // composed, so "Café" typed either way is one tag
  });

  it('limits to 40 code points: 40 emoji pass, 41 characters fail', () => {
    expect(normalizeTagName('😀'.repeat(TAG_NAME_MAX)).ok).toBe(true); // 80 UTF-16 units, 40 code points
    expect(normalizeTagName('a'.repeat(TAG_NAME_MAX + 1))).toEqual({ ok: false, error: 'invalid_name' });
  });

  it('rejects empty, non-strings, control characters and bidi overrides', () => {
    for (const bad of ['', '   ', null, undefined, 42, ['a'], 'a\u0000b', 'a\u0007b', 'evil‮gnp.exe', 'x⁦y']) expect(normalizeTagName(bad)).toEqual({ ok: false, error: 'invalid_name' });
  });
});

describe('ids, names and colours', () => {
  it('isUuid / isMediaId accept only the expected shapes', () => {
    expect(isUuid('7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e')).toBe(true);
    expect(isUuid('7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e; drop table tags')).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isMediaId('17895695668004550')).toBe(true);
    expect(isMediaId('17895695668004550,1')).toBe(false);
    expect(isMediaId('')).toBe(false);
  });

  it('sameTagName ignores case only', () => {
    expect(sameTagName('Promo', 'pROMO')).toBe(true);
    expect(sameTagName('Promo', 'Promos')).toBe(false);
  });

  it('pickColor takes the least-used chart token, first on a tie', () => {
    expect(pickColor([])).toBe('chart-1');
    expect(pickColor(['chart-1', 'chart-2'])).toBe('chart-3');
    expect(pickColor(['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-1'])).toBe('chart-2');
  });
});
