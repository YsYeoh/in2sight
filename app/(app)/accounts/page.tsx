import { AccountsView } from '@/components/accounts/AccountsView';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveAccountAction, deleteAccountAction, restoreAccountAction, setGroupAction } from './actions';

const first = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const sp = await searchParams;
  const connected = first(sp.connected)?.slice(0, 60); // the view ignores unknown error keys
  const accounts = await supabaseAccountsStore(await createServerSupabase()).list(); // owner session: RLS applies
  return (
    <AccountsView
      accounts={accounts}
      notice={{ connected: connected || undefined, error: first(sp.error) }}
      now={new Date().toISOString()}
      actions={{ archive: archiveAccountAction, restore: restoreAccountAction, remove: deleteAccountAction, setGroup: setGroupAction }}
    />
  );
}
