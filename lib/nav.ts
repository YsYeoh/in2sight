import { CalendarDays, CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';
import { scopeQueryOf } from '@/lib/time-scope/scope';

export interface NavItem {
  href: '/overview' | '/accounts' | '/tags' | '/calendar' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'calendar' | 'settings';
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/overview', key: 'overview', icon: LayoutDashboard },
  { href: '/accounts', key: 'accounts', icon: CircleUserRound },
  { href: '/tags', key: 'tags', icon: Tag },
  { href: '/calendar', key: 'calendar', icon: CalendarDays },
  { href: '/settings', key: 'settings', icon: Settings },
];

/** Main pages that show the Time Scope: their nav links carry the scope of the current URL (the account pages are reached from Overview). */
const SCOPED: readonly string[] = ['/overview', '/calendar'];

/** A nav item's href, plus the current URL's Time Scope parameters when it leads to a scoped page. */
export function navHref(href: string, search: URLSearchParams | null): string {
  const q = search && SCOPED.includes(href) ? scopeQueryOf(search) : '';
  return q ? `${href}?${q}` : href;
}

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
