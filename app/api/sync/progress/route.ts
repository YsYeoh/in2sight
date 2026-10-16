import { NextResponse } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadSyncProgress } from '@/lib/sync/progress-read';

/**
 * GET /api/sync/progress — owner session only (proxy + assertOwner; NOT a public exemption in lib/auth/route-policy.ts).
 * Progress of the accounts that are importing or just finished: counts, i18n keys and days only. Polled by the
 * progress panel every few seconds, so it is uncached and cheap (count queries only for tracked accounts).
 */
export async function GET() {
  const h = new Headers({ 'cache-control': 'private, no-store' });
  if (!(await assertOwner(h))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: h });
  try {
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const accounts = await supabaseAccountsStore(db).list();
    return NextResponse.json({ accounts: await loadSyncProgress(db, accounts, new Date()) }, { headers: h });
  } catch {
    console.error('sync progress read failed'); // fixed text: never log error objects
    return NextResponse.json({ error: 'unexpected' }, { status: 500, headers: h });
  }
}
