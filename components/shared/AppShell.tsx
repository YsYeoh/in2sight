'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ModeToggle } from '@/components/shared/ModeToggle';
import { UserMenu } from '@/components/shared/UserMenu';
import { NAV_ITEMS, isActive } from '@/lib/nav';
import { cn } from '@/lib/utils';

function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', className)}>
      <span aria-hidden className="size-6 rounded-lg bg-[conic-gradient(from_210deg,var(--chart-1),var(--chart-5),var(--chart-4),var(--chart-1))]" />
      in2sight
    </span>
  );
}

export function AppShell({ children, userEmail, signOutAction }: { children: React.ReactNode; userEmail?: string; signOutAction?: () => Promise<void> }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  return (
    <div className="min-h-dvh bg-background">
      {/* md: icon rail, lg: full sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col gap-1 border-r border-border bg-card p-2 md:flex lg:w-56">
        <Brand className="mb-3 px-1.5 pt-1" />
        <nav aria-label={t('sidebar')} className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className="flex h-[var(--ctl)] items-center gap-2.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              <span className="sr-only lg:not-sr-only">{t(key)}</span>
            </Link>
          ))}
        </nav>
      </aside>

      <div className="md:pl-14 lg:pl-56">
        <header className="sticky top-0 z-20 flex h-[50px] items-center gap-2 border-b border-border bg-card/85 px-[var(--pg)] backdrop-blur">
          <Brand className="md:hidden" />
          <div className="ml-auto flex items-center gap-1">
            <ModeToggle />
            <UserMenu email={userEmail} signOutAction={signOutAction} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-[var(--pg)] pb-24 md:pb-[var(--pg)]">{children}</main>
      </div>

      {/* phones: bottom tab bar */}
      <nav aria-label={t('tabs')} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV_ITEMS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? 'page' : undefined}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[length:var(--lb)] text-muted-foreground aria-[current=page]:text-primary"
          >
            <Icon aria-hidden className="size-5" />
            {t(key)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
