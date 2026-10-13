import { CircleUserRound, LayoutDashboard, Settings, Tag, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: '/overview' | '/accounts' | '/tags' | '/settings';
  key: 'overview' | 'accounts' | 'tags' | 'settings';
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/overview', key: 'overview', icon: LayoutDashboard },
  { href: '/accounts', key: 'accounts', icon: CircleUserRound },
  { href: '/tags', key: 'tags', icon: Tag },
  { href: '/settings', key: 'settings', icon: Settings },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
