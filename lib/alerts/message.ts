// Turns a stored alert (kind + i18n payload) into text and a link. The UI (bell) and the push sender
// (lib/alerts/push-message.ts) share alertText, so a notification reads the same in the app and on the lock screen.
// Client-safe: no message catalogs are imported here (the bell gets them from NextIntlClientProvider).
import type { AlertPayload } from '@/lib/alerts/rules';
import type { AlertKind } from '@/lib/alerts/settings';
import { formatNumber, type FormatPrefs } from '@/lib/format';

/** A translator scoped to `notifications.kinds` (next-intl's useTranslations / createTranslator both fit). */
export type KindTranslator = (key: string, values?: Record<string, string | number>) => string;

export const MAX_NAME = 40;
const clip = (s: string, n: number) => ([...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s);

export function alertText(kind: AlertKind, p: AlertPayload, t: KindTranslator, prefs: FormatPrefs): { title: string; body: string } {
  const values = {
    username: clip(p.username, MAX_NAME),
    days: p.days ?? 0,
    runs: p.runs ?? 0,
    pct: formatNumber(p.pct ?? null, prefs),
    ratio: formatNumber(p.ratio ?? null, prefs, { maximumFractionDigits: 1 }),
  };
  return { title: t(`${kind}.title`, values), body: t(`${kind}.body`, values) };
}

/** Same-origin path the notification opens. */
export function alertHref(kind: AlertKind, accountId: string | null): string {
  if (!accountId) return '/overview';
  if (kind === 'taking_off') return `/accounts/${accountId}?tab=posts`;
  if (kind === 'moderation_paused') return `/accounts/${accountId}?tab=moderation`;
  if (kind === 'reach_drop') return `/accounts/${accountId}`;
  return '/accounts';
}
