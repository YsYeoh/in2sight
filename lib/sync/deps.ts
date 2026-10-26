import 'server-only';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { supabaseAlertStore } from '@/lib/alerts/store';
import { getInstagramEnv } from '@/lib/env';
import { igData } from '@/lib/instagram/data';
import { igModeration } from '@/lib/instagram/moderation';
import { vapidFromEnv, webPushTransport } from '@/lib/push/send';
import { supabaseSyncStore } from '@/lib/sync/store';
import type { TickDeps } from '@/lib/sync/tick';
import { createAdminSupabase } from '@/lib/supabase/admin';

/** Real dependencies for runTick. Throws EnvError when Supabase or Instagram env vars are missing. Push is optional. */
export function createSyncDeps(): TickDeps {
  const { apiVersion } = getInstagramEnv();
  const db = createAdminSupabase();
  const vapid = vapidFromEnv();
  const store = supabaseSyncStore(db);
  return {
    store,
    accounts: supabaseAccountsStore(db),
    ig: igData(apiVersion),
    alerts: { store: supabaseAlertStore(db), push: vapid ? webPushTransport(vapid) : null },
    // Plan 15d auto-hide: the same admin client; the token read stays server-side (account_tokens)
    moderation: { db, ig: igModeration(apiVersion), token: (id) => store.getToken(id) },
  };
}
