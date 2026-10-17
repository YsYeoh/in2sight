// Row labels of the Explorer, shared by the page (useTranslations) and the Excel export (server translator), so a
// row reads the same on screen and in the file. Pure: the translator and the format preferences are inputs.
import type { ScopeAccount } from '@/lib/analysis/explorer';
import type { Tag } from '@/lib/analysis/types';
import type { ItemRow } from '@/lib/explorer/read';
import { formatDateTime, formatDay, formatHour, formatMonth, type FormatPrefs } from '@/lib/format';
import type { DimensionId } from '@/lib/metrics';
import type { Granularity } from '@/lib/time-scope/range';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface LabelContext {
  accounts: ScopeAccount[];
  tags: Tag[];
  items: ItemRow[];
  gran: Granularity;
}

const user = (c: LabelContext, id: string) => `@${c.accounts.find((a) => a.id === id)?.username ?? '?'}`;

export function rowLabel(by: DimensionId, key: string, c: LabelContext, t: Translate, p: FormatPrefs): string {
  switch (by) {
    case 'account':
      return user(c, key);
    case 'group':
      return key.startsWith('g:') ? key.slice(2) : user(c, key.slice(2));
    case 'format':
      return t(`analysis.format.${key}`);
    case 'tag':
      return key === 'untagged' ? t('explorer.untagged') : (c.tags.find((x) => x.id === key)?.name ?? t('explorer.deletedTag'));
    case 'weekday':
      return t(`analysis.weekday.${key}`);
    case 'hour':
      return formatHour(Number(key), p);
    case 'time':
      return c.gran === 'month' ? formatMonth(key.slice(0, 7), p) : c.gran === 'week' ? t('explorer.weekOf', { day: formatDay(key, p) }) : formatDay(key, p);
    case 'post': {
      const it = c.items.find((x) => x.id === key);
      return it ? `${t(`analysis.format.${it.mediaType}`)} · ${formatDateTime(it.postedAt, p)}` : key;
    }
  }
}
