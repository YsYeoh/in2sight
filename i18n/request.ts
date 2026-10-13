import { getRequestConfig } from 'next-intl/server';
import { getPrefs } from '@/lib/prefs.server';
import { deepMerge } from '@/lib/merge';
import en from '../messages/en.json';

export default getRequestConfig(async () => {
  const { locale, timezone } = await getPrefs();
  // English is always the base, so a key missing in another locale shows English instead of a raw key.
  const messages = locale === 'en' ? en : deepMerge(en, (await import(`../messages/${locale}.json`)).default);
  return { locale, messages, timeZone: timezone };
});
