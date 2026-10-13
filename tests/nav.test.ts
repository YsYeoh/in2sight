import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isActive } from '@/lib/nav';

describe('navigation model', () => {
  it('lists the four main destinations in order', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'settings']);
  });

  it('isActive matches the route and its children, not look-alike prefixes', () => {
    expect(isActive('/accounts', '/accounts')).toBe(true);
    expect(isActive('/accounts/42', '/accounts')).toBe(true);
    expect(isActive('/accounts-archive', '/accounts')).toBe(false);
    expect(isActive('/overview', '/accounts')).toBe(false);
    expect(isActive('/', '/overview')).toBe(false);
  });
});
