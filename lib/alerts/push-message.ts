// Server-side push text in the owner's language. Kept apart from message.ts so the browser bundle (the bell) never
// carries both message catalogs.
import { createTranslator } from 'next-intl';
import { alertHref, alertText, type KindTranslator } from '@/lib/alerts/message';
import type { AlertPayload } from '@/lib/alerts/rules';
import type { AlertKind } from '@/lib/alerts/settings';
import { deepMerge } from '@/lib/merge';
import { DEFAULT_PREFS, type Locale } from '@/lib/prefs';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

const CATALOGS: Record<Locale, typeof en> = { en, 'zh-CN': deepMerge(en, zh) };

/** Nothing sensitive: text, a same-origin path, a grouping tag. */
export function pushMessage(a: { kind: AlertKind; accountId: string | null; payload: AlertPayload }, locale: Locale): PushMessage {
  const tr = createTranslator({ locale, messages: CATALOGS[locale] });
  const t: KindTranslator = (key, values) => tr(`notifications.kinds.${key}` as never, values as never);
  const { title, body } = alertText(a.kind, a.payload, t, { ...DEFAULT_PREFS, locale });
  return { title, body, url: alertHref(a.kind, a.accountId), tag: `${a.kind}:${a.accountId ?? 'all'}` };
}
