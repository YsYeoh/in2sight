'use client';

import Link from 'next/link';
import { LogOut, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function UserMenu({ email, signOutAction }: { email?: string; signOutAction?: () => Promise<void> }) {
  const t = useTranslations('shell');
  const initial = (email?.[0] ?? '?').toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('userMenu')} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-[var(--ctl-sm)]">
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {email ? <DropdownMenuLabel className="font-normal text-muted-foreground">{email}</DropdownMenuLabel> : null}
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> {t('settings')}
          </Link>
        </DropdownMenuItem>
        {signOutAction ? (
          <>
            <DropdownMenuSeparator />
            <form action={signOutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut aria-hidden /> {t('signOut')}
                </button>
              </DropdownMenuItem>
            </form>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
