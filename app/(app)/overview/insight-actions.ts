'use server';

// Dismiss / snooze a finding (Plan 17b). Owner-authored data: the OWNER-SESSION client, so RLS (is_owner()) applies to the
// write; never the admin client. The key comes from the browser: parsed against the known shape before anything else.
import { requireOwner } from '@/lib/auth/require-owner';
import { parseFindingKey, type DismissMode, type DismissResult } from '@/lib/analysis/insights';
import { saveDismissal } from '@/lib/dashboard/dismissals';
import { createServerSupabase } from '@/lib/supabase/server';

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function dismissFindingAction(key: string, mode: DismissMode): Promise<DismissResult> {
  await requireOwner();
  const parsed = parseFindingKey(key);
  if (!parsed || (mode !== 'dismiss' && mode !== 'snooze')) return { ok: false, error: 'invalid' };
  try {
    return await saveDismissal(await createServerSupabase(), key, parsed.accountId, mode, new Date());
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
