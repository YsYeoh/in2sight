import { after, NextResponse, type NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { EnvError, getInstagramEnv } from '@/lib/env';
import { processCallback } from '@/lib/instagram/connect-flow';
import { syncAccountNow } from '@/lib/sync/connect-sync';
import { clearSyncError, resetSyncProgress } from '@/lib/sync/store';
import { STATE_COOKIE } from '@/lib/instagram/state';
import { createAdminSupabase } from '@/lib/supabase/admin';

// the first sync of the new account runs in after() (below), which needs the function to stay alive past the redirect
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // the no-store headers Supabase hands over land in h and must reach whatever we return (see createServerSupabase)
  const h = new Headers();
  const done = (res: NextResponse) => {
    h.forEach((v, k) => res.headers.set(k, v));
    res.cookies.set(STATE_COOKIE, '', { path: '/api/instagram', maxAge: 0 }); // single use, cleared on every outcome
    return res;
  };
  if (!(await assertOwner(h))) return done(NextResponse.json({ error: 'unauthorized' }, { status: 401 }));
  const q = request.nextUrl.searchParams;
  let redirect: string;
  try {
    const db = createAdminSupabase();
    const result = await processCallback(
      { code: q.get('code'), state: q.get('state'), error: q.get('error'), cookie: request.cookies.get(STATE_COOKIE)?.value },
      { cfg: getInstagramEnv(), store: supabaseAccountsStore(db), onConnected: async (id) => {
          await clearSyncError(db, id);
          await resetSyncProgress(db, id, new Date().toISOString()); // new progress session; coverage (sync_state) is kept
          after(() => syncAccountNow(id)); // start syncing this account at once; the redirect is not delayed
        },
      },
    );
    redirect = result.redirect;
  } catch (e) {
    redirect = e instanceof EnvError ? '/accounts?error=not_configured' : '/accounts?error=save_failed';
  }
  return done(NextResponse.redirect(new URL(redirect, request.url)));
}
