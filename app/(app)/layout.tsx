import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { AppShell } from '@/components/shared/AppShell';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { signOutAction } from '@/app/login/actions';
import { markAllReadAction, markReadAction } from '@/app/(app)/notifications/actions';
import { loadNotifications } from '@/lib/alerts/read';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireOwner();
  const { items, unread } = await loadNotifications(await createServerSupabase());
  return (
    <AppShell userEmail={email ?? undefined} signOutAction={signOutAction} bell={<NotificationBell items={items} unread={unread} markRead={markReadAction} markAllRead={markAllReadAction} />}>
      <InstallPrompt />
      {children}
    </AppShell>
  );
}
