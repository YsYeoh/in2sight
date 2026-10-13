import { cookies } from 'next/headers';
import { PREFS_COOKIE, parsePrefsCookie, type Prefs } from '@/lib/prefs';

/** Reads the preferences cookie for the current request. Always returns valid prefs. */
export async function getPrefs(): Promise<Prefs> {
  const jar = await cookies();
  return parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
}
