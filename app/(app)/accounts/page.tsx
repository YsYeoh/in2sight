import { AccountsView } from '@/components/accounts/AccountsView';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { listSyncStatus } from '@/lib/sync/store';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveAccountAction, deleteAccountAction, restoreAccountAction, setGroupAction, syncNowAction } from './actions';

// Server actions inherit the page's limit: "Sync now" runs a tick (45s budget) inside the action.
export const maxDuration = 60;

const first = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const connected = first(sp.connected)?.slice(0, 60); // the view ignores unknown error keys
  const db = await createServerSupabase(); // owner session: RLS applies
  const [accounts, sync] = await Promise.all([supabaseAccountsStore(db).list(), listSyncStatus(db)]);
  return (
    <AccountsView
      accounts={accounts}
      notice={{ connected: connected || undefined, error: first(sp.error) }}
      now={new Date().toISOString()}
      sync={sync}
      actions={{ archive: archiveAccountAction, restore: restoreAccountAction, remove: deleteAccountAction, setGroup: setGroupAction, syncNow: syncNowAction }}
    />
  );
}
