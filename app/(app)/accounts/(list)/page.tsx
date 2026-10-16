import { AccountsView } from '@/components/accounts/AccountsView';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts, loadSyncStatus } from '@/lib/dashboard/cached';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';
import { archiveAccountAction, deleteAccountAction, restoreAccountAction, setGroupAction, syncNowAction } from '../actions';

// Server actions inherit the page's limit: "Sync now" runs a tick (35s budget) inside the action.
export const maxDuration = 60;

const first = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const connected = first(sp.connected)?.slice(0, 60); // the view ignores unknown error keys
  const [accounts, sync] = await Promise.all([loadAccounts(), loadSyncStatus()]); // owner session: RLS applies
  const progress = await loadSyncProgress(await createServerSupabase(), accounts, new Date()); // never throws; [] when nothing imports
  return (
    <AccountsView
      accounts={accounts}
      notice={{ connected: connected || undefined, error: first(sp.error) }}
      now={new Date().toISOString()}
      sync={sync}
      progress={progress}
      actions={{ archive: archiveAccountAction, restore: restoreAccountAction, remove: deleteAccountAction, setGroup: setGroupAction, syncNow: syncNowAction }}
    />
  );
}
