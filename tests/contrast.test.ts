import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb } from '@/lib/contrast';

describe('contrast', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#4F46E5')).toEqual([79, 70, 229]);
  });

  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('identical colours are 1:1 and the order of arguments does not matter', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('#777777 on white is about 4.48:1 (just under AA)', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('rejects anything that is not a 6-digit hex colour', () => {
    expect(() => hexToRgb('#fff')).toThrow();
    expect(() => hexToRgb('rgb(0,0,0)')).toThrow();
  });
});
