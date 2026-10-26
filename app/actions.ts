'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefs, parsePrefsCookie, serializePrefs, type Prefs } from '@/lib/prefs';
import { persistPrefsToProfile } from '@/lib/prefs.sync.server';

export type SetPrefsResult = { ok: boolean };

/**
 * Merge a partial update onto the current preferences cookie. Input is untrusted: parsePrefs validates every field.
 * Never throws. `ok: false` = the cookie was written but the profile row was not (PrefsProvider then offers Retry).
 */
export async function setPrefs(partial: unknown): Promise<SetPrefsResult> {
  const jar = await cookies();
  const current = parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
  const patch = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
  const next = parsePrefs({ ...current, ...patch });
  jar.set(PREFS_COOKIE, serializePrefs(next), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  const keys = (Object.keys(patch) as (keyof Prefs)[]).filter((k) => Object.hasOwn(DEFAULT_PREFS, k)); // only what this save changed
  const ok = await persistPrefsToProfile(next, keys).catch(() => false); // it never throws; a rejection still counts as not saved
  revalidatePath('/', 'layout');
  return { ok };
}
