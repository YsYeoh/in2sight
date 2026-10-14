import 'server-only';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { getInstagramEnv } from '@/lib/env';
import { igData } from '@/lib/instagram/data';
import { supabaseSyncStore } from '@/lib/sync/store';
import type { TickDeps } from '@/lib/sync/tick';
import { createAdminSupabase } from '@/lib/supabase/admin';

/** Real dependencies for runTick. Throws EnvError when Supabase or Instagram env vars are missing. */
export function createSyncDeps(): TickDeps {
  const { apiVersion } = getInstagramEnv();
  const db = createAdminSupabase();
  return { store: supabaseSyncStore(db), accounts: supabaseAccountsStore(db), ig: igData(apiVersion) };
}
