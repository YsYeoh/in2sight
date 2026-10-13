'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { PREFS_COOKIE, parsePrefs, parsePrefsCookie, serializePrefs } from '@/lib/prefs';

/** Merge a partial update onto the current preferences cookie. Input is untrusted: parsePrefs validates every field. */
export async function setPrefs(partial: unknown): Promise<void> {
  const jar = await cookies();
  const current = parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
  const patch = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
  const next = parsePrefs({ ...current, ...patch });
  jar.set(PREFS_COOKIE, serializePrefs(next), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
