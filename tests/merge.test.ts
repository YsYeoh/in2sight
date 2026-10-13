import { describe, expect, it } from 'vitest';
import { deepMerge } from '@/lib/merge';

describe('deepMerge', () => {
  it('override wins, missing keys fall back to base, nesting is merged', () => {
    const base = { a: 'A', n: { x: 'X', y: 'Y' }, only: 'base' };
    const merged = deepMerge(base, { a: '甲', n: { y: '乙' } });
    expect(merged).toEqual({ a: '甲', n: { x: 'X', y: '乙' }, only: 'base' });
  });

  it('does not mutate its inputs', () => {
    const base = { n: { x: 'X' } };
    const override = { n: { x: 'Z' } };
    deepMerge(base, override);
    expect(base).toEqual({ n: { x: 'X' } });
    expect(override).toEqual({ n: { x: 'Z' } });
  });

  it('ignores prototype-pollution keys', () => {
    const merged = deepMerge({ a: 'A' }, JSON.parse('{"__proto__":{"polluted":"yes"},"a":"B"}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(merged.a).toBe('B');
  });
});
