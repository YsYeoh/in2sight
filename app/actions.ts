'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefs, parsePrefsCookie, serializePrefs, type Prefs } from '@/lib/prefs';
import { persistPrefsToProfile } from '@/lib/prefs.sync.server';

/** Merge a partial update onto the current preferences cookie. Input is untrusted: parsePrefs validates every field. */
export async function setPrefs(partial: unknown): Promise<void> {
  const jar = await cookies();
  const current = parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
  const patch = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
  const next = parsePrefs({ ...current, ...patch });
  jar.set(PREFS_COOKIE, serializePrefs(next), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  try {
    await persistPrefsToProfile(next, (Object.keys(patch) as (keyof Prefs)[]).filter((k) => Object.hasOwn(DEFAULT_PREFS, k))); // only what this save changed
  } catch {
    // the cookie is already saved; the next successful save syncs the profile
  }
  revalidatePath('/', 'layout');
}
