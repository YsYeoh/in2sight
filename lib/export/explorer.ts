// The Excel export of the current Explorer view: one sheet = the table on screen (dimension, the selected metrics, and
// "previous" + change columns when comparing). Same cell rules as every export sheet (lib/export/workbook.ts): numbers
// are number cells, time buckets are real date cells, missing values are EMPTY cells, user text goes through safeText.
import type { ExplorerRow } from '@/lib/analysis/explorer';
import type { ExplorerData } from '@/lib/explorer/load';
import { rowLabel } from '@/lib/explorer/labels';
import { sheetNames } from '@/lib/export/cells';
import { sheet, type Col, type Kind, type Translate, type WorkbookSheet } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';
import { METRICS, type MetricId } from '@/lib/metrics';

type Data = Pick<ExplorerData, 'state' | 'model' | 'accounts' | 'tags' | 'items' | 'scope' | 'window'>;

const kindOf = (m: MetricId): Kind => (METRICS[m].kind === 'percent' ? 'percent' : m === 'avgReach' || m === 'avgViews' ? 'avg' : 'count');

export function buildExplorerSheet(d: Data, t: Translate, prefs: FormatPrefs): WorkbookSheet[] {
  const { state: s } = d;
  const ctx = { accounts: d.accounts, tags: d.tags, items: d.items, gran: d.scope.gran };
  const item = new Map(d.items.map((i) => [i.id, i]));
  const user = new Map(d.accounts.map((a) => [a.id, a.username]));
  const compare = d.window.compare !== null && s.by !== 'post';
  const lead: Col<ExplorerRow>[] =
    s.by === 'time'
      ? [{ header: t('explorer.by.time'), kind: 'date', width: 13, get: (r) => r.key }]
      : s.by === 'post'
        ? [
            { header: t('export.cols.account'), kind: 'text', width: 24, get: (r) => user.get(item.get(r.key)?.accountId ?? '') },
            { header: t('export.cols.postedAt'), kind: 'datetime', width: 18, get: (r) => item.get(r.key)?.postedAt },
            { header: t('export.cols.type'), kind: 'text', width: 11, get: (r) => (item.get(r.key) ? t(`analysis.format.${item.get(r.key)!.mediaType}`) : null) },
            { header: t('export.cols.caption'), kind: 'text', width: 50, get: (r) => item.get(r.key)?.caption },
            { header: t('export.cols.permalink'), kind: 'text', width: 34, get: (r) => item.get(r.key)?.permalink },
          ]
        : [{ header: t(`explorer.by.${s.by}`), kind: 'text', width: 24, get: (r) => rowLabel(s.by, r.key, ctx, t, prefs) }];
  const metrics = s.metrics.flatMap((m): Col<ExplorerRow>[] => {
    const metric = t(`metrics.${m}`);
    const value: Col<ExplorerRow> = { header: metric, kind: kindOf(m), width: 13, get: (r) => r.values[m]?.value };
    if (!compare) return [value];
    return [
      value,
      { header: t('explorer.previous', { metric }), kind: kindOf(m), width: 13, get: (r) => r.values[m]?.prior },
      { header: t('export.cols.change', { metric }), kind: 'percent', width: 13, get: (r) => r.values[m]?.change },
    ];
  });
  const built = sheet(t('explorer.title'), [...lead, ...metrics], d.model.rows, { prefs });
  return [{ sheet: sheetNames([built.name])[0], data: built.data, columns: built.columns, stickyRowsCount: built.stickyRowsCount }];
}
