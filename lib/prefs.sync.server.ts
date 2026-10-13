import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { PREFS_COOKIE, parsePrefsCookie, serializePrefs, type Prefs } from '@/lib/prefs';
import { prefsPatchToRow, prefsToProfileRow, profileRowToPrefs } from '@/lib/prefs.sync';
import { isSupabaseConfigured } from '@/lib/env';
import { getSessionInfo } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

const COOKIE_OPTS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

// Best effort: the cookie stays the fast read path, so a profile failure must never break the caller.
// Only a fixed message is logged, never the error (it can carry request details).
const warn = (what: string) => console.error(`[prefs] profile ${what} failed`);

/** After login: the saved profile wins over whatever this browser had; no profile yet -> create one from the cookie. */
export async function syncPrefsFromProfile(supabase: SupabaseClient): Promise<void> {
  try {
    const info = await getSessionInfo(supabase);
    if (!info.userId) return;
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', info.userId).maybeSingle();
    // a failed read is not "no profile": never overwrite what may already be saved
    if (error) return warn('read');
    const jar = await cookies();
    const saved = profileRowToPrefs(data);
    if (saved) {
      jar.set(PREFS_COOKIE, serializePrefs(saved), COOKIE_OPTS);
      return;
    }
    const { error: writeError } = await supabase.from('profiles').upsert(prefsToProfileRow(info.userId, parsePrefsCookie(jar.get(PREFS_COOKIE)?.value)));
    if (writeError) warn('create');
  } catch {
    warn('sync');
  }
}

/**
 * Called by setPrefs after the cookie is written. Never throws.
 * Writes only `keys` (what this save changed): a stale cookie on this device must not clobber the other columns.
 * A missing row is created with the column defaults for everything not sent.
 */
export async function persistPrefsToProfile(prefs: Prefs, keys: readonly (keyof Prefs)[]): Promise<void> {
  try {
    if (keys.length === 0 || !isSupabaseConfigured()) return;
    const supabase = await createServerSupabase();
    const info = await getSessionInfo(supabase);
    if (!info.userId) return;
    const { error } = await supabase.from('profiles').upsert({ ...prefsPatchToRow(info.userId, prefs, keys), updated_at: new Date().toISOString() });
    if (error) warn('save');
  } catch {
    warn('save');
  }
}
