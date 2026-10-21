import { Suspense } from 'react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { AppShell } from '@/components/shared/AppShell';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { Skeleton } from '@/components/ui/skeleton';
import { signOutAction } from '@/app/login/actions';
import { markAllReadAction, markReadAction } from '@/app/(app)/notifications/actions';
import { loadNotifications } from '@/lib/alerts/read';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

/** The bell streams in on its own: the shell and the page never wait for the notification queries. */
async function NotificationsIsland() {
  const { items, unread } = await loadNotifications(await createServerSupabase()); // never throws: empty bell on failure
  return <NotificationBell items={items} unread={unread} markRead={markReadAction} markAllRead={markAllReadAction} />;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireOwner(); // shared with the page's own check in this request (React.cache)
  // A tab's frame (Plan 14c): the page renders without the shell chrome from its first paint. Only a hint: AppShell
  // re-checks on the client, since a refresh or server action re-renders this layout without the header.
  const framed = (await headers()).get('sec-fetch-dest') === 'iframe';
  const t = await getTranslations('loading');
  const bellFallback = (
    <span role="status" className="inline-flex">
      <Skeleton aria-hidden="true" className="size-[var(--ctl)]" />
      <span className="sr-only">{t('notifications')}</span>
    </span>
  );
  return (
    <AppShell
      framed={framed}
      userEmail={email ?? undefined}
      signOutAction={signOutAction}
      install={<InstallPrompt />}
      bell={
        <Suspense fallback={bellFallback}>
          <NotificationsIsland />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
