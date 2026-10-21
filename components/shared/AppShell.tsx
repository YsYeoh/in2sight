'use client';

import { useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ModeToggle } from '@/components/shared/ModeToggle';
import { NavLink } from '@/components/shared/NavLink';
import { UserMenu } from '@/components/shared/UserMenu';
import { FrameBridge } from '@/components/shared/tabs/FrameBridge';
import { TabFrames, TabsProvider } from '@/components/shared/tabs/TabHost';
import { TabStrip } from '@/components/shared/tabs/TabStrip';
import { TabsSheet } from '@/components/shared/tabs/TabsSheet';
import { NAV_ITEMS, isActive, navHref } from '@/lib/nav';
import { isFramed } from '@/lib/tabs/protocol';
import { cn } from '@/lib/utils';

function Brand({ className, wordClassName }: { className?: string; wordClassName?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-semibold', className)}>
      <span aria-hidden className="size-6 shrink-0 rounded-lg bg-[conic-gradient(from_210deg,var(--chart-1),var(--chart-5),var(--chart-4),var(--chart-1))]" />
      <span className={wordClassName}>in2sight</span>
    </span>
  );
}

const noop = () => () => {};

/**
 * Two faces (Plan 14c, app-shell tabs). In the TOP window: the shell (sidebar, header with the tab strip, phone bottom
 * bar) and the tab frames; the page itself (`children`) is not shown there. Inside a tab's FRAME: the page only, no
 * chrome. `framed` is the server's hint (the request had `Sec-Fetch-Dest: iframe`) so a frame's first paint has no
 * chrome; after hydration the real answer (window.self !== window.top) wins, because a refresh or a server action
 * re-renders this layout without that header.
 */
export function AppShell({ children, userEmail, signOutAction, bell, install, framed: framedHint = false }: { children: React.ReactNode; userEmail?: string; signOutAction?: () => Promise<void>; bell?: React.ReactNode; install?: React.ReactNode; framed?: boolean }) {
  const framed = useSyncExternalStore(noop, () => isFramed(), () => framedHint);
  const pathname = usePathname();
  const search = useSearchParams(); // the (app) routes are all dynamic (owner check), so this never forces client-side rendering
  const t = useTranslations('nav');

  if (framed)
    return (
      <div className="min-h-dvh bg-background">
        <FrameBridge />
        <main className="mx-auto w-full max-w-[1600px] p-[var(--pg)]">{children}</main>
      </div>
    );

  const query = search?.toString();
  return (
    <TabsProvider initialUrl={query ? `${pathname}?${query}` : pathname}>
      <div className="flex h-dvh flex-col bg-background">
        {/* md: icon rail, lg: full sidebar. Its links jump to (or open) the tab of that section. */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col gap-1 border-r border-border bg-card p-2 md:flex lg:w-56">
          <Brand className="mb-3 px-1.5 pt-1" wordClassName="max-lg:sr-only" />
          <nav aria-label={t('sidebar')} data-tab-open="nav" className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, key, icon: Icon }) => (
              <NavLink
                key={href}
                href={navHref(href, search)}
                icon={Icon}
                iconClassName="size-4"
                aria-current={isActive(pathname, href) ? 'page' : undefined}
                className="flex h-[var(--ctl)] items-center gap-2.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
              >
                <span className="sr-only lg:not-sr-only">{t(key)}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col md:pl-14 lg:pl-56">
          <header className="z-20 flex h-[50px] shrink-0 items-center gap-2 border-b border-border bg-card/85 px-[var(--pg)] backdrop-blur">
            <Brand className="md:hidden" />
            <TabStrip className="hidden flex-1 md:flex" />
            <div className="ml-auto flex items-center gap-1">
              <TabsSheet className="md:hidden" />
              {bell}
              <ModeToggle />
              <UserMenu email={userEmail} signOutAction={signOutAction} />
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {install ? <div className="px-[var(--pg)] pt-[var(--pg)] empty:hidden">{install}</div> : null}
            <div className="relative min-h-0 flex-1">
              <TabFrames />
            </div>
          </main>
        </div>

        {/* phones: bottom tab bar; it navigates inside the current tab */}
        <nav aria-label={t('tabs')} data-tab-open="current" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
          {NAV_ITEMS.map(({ href, key, icon: Icon }) => (
            <NavLink
              key={href}
              href={navHref(href, search)}
              icon={Icon}
              iconClassName="size-5"
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[length:var(--lb)] text-muted-foreground aria-[current=page]:text-primary"
            >
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </div>
    </TabsProvider>
  );
}
