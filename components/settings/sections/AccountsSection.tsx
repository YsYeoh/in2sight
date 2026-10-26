import { syncNowAction } from '@/app/(app)/accounts/actions';
import { AccountsOverview } from '@/components/settings/AccountsOverview';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';

/** Settings -> Accounts & sync (Plan 16a). Owner-session reads (RLS), shared per request with the layout (React.cache). */
export async function AccountsSection() {
  await requireOwner();
  const [accounts, sync] = await Promise.all([loadAccounts(), loadSyncStatus()]);
  return <AccountsOverview accounts={accounts.filter((a) => a.status !== 'archived')} sync={sync} now={new Date().toISOString()} syncNow={syncNowAction} />;
}
