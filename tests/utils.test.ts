import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('lets a later Tailwind utility override an earlier conflicting one', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
    expect(cn('text-sm', 'text-xs')).toBe('text-xs');
  });

  it('accepts arrays and conditional objects', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });
});
