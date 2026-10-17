import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isActive, navHref } from '@/lib/nav';

describe('navigation model', () => {
  it('lists the five main destinations in order', () => {
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(['/overview', '/accounts', '/tags', '/calendar', '/settings']);
    expect(NAV_ITEMS.map((i) => i.key)).toEqual(['overview', 'accounts', 'tags', 'calendar', 'settings']);
  });

  it('navHref: Overview and Calendar carry the current Time Scope parameters, nothing else does', () => {
    const search = new URLSearchParams('tab=posts&from=90d&cmp=yoy&format=REELS&account=x');
    expect(navHref('/overview', search)).toBe('/overview?from=90d&cmp=yoy');
    expect(navHref('/calendar', search)).toBe('/calendar?from=90d&cmp=yoy');
    for (const href of ['/accounts', '/tags', '/settings']) expect(navHref(href, search)).toBe(href);
    expect(navHref('/overview', new URLSearchParams('tab=posts'))).toBe('/overview');
    expect(navHref('/overview', null)).toBe('/overview');
  });

  it('isActive matches the route and its children, not look-alike prefixes', () => {
    expect(isActive('/accounts', '/accounts')).toBe(true);
    expect(isActive('/accounts/42', '/accounts')).toBe(true);
    expect(isActive('/accounts-archive', '/accounts')).toBe(false);
    expect(isActive('/overview', '/accounts')).toBe(false);
    expect(isActive('/', '/overview')).toBe(false);
  });
});
