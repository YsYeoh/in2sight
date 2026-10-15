// Per-request singletons for reads several server components of ONE render need (the account page header and its
// streamed tab both need the accounts list). React.cache is scoped to the current request: nothing is shared between
// requests or users. Owner session (RLS applies), never the admin client. No arguments on purpose: the cache key is
// the argument list, and a fresh Supabase client per call would never hit.
import { cache } from 'react';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { listSyncStatus } from '@/lib/sync/store';
import { createServerSupabase } from '@/lib/supabase/server';

export const loadAccounts = cache(async () => supabaseAccountsStore(await createServerSupabase()).list());

export const loadSyncStatus = cache(async () => listSyncStatus(await createServerSupabase()));
