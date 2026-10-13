import { AppShell } from '@/components/shared/AppShell';
import { signOutAction } from '@/app/login/actions';
import { requireOwner } from '@/lib/auth/require-owner';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { email } = await requireOwner();
  return (
    <AppShell userEmail={email ?? undefined} signOutAction={signOutAction}>
      {children}
    </AppShell>
  );
}
