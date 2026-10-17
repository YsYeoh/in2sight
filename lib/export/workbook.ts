// The Excel export (SPEC §7d): six sheets built from ExportData. buildWorkbook is pure (now/today/tz/prefs are inputs);
// writeWorkbook hands the result to write-excel-file. Rules for every cell: numbers are number cells, dates are real
// date cells in the owner's date format, missing values are EMPTY cells (never 0), user/Meta text goes through safeText.
import { createTranslator } from 'next-intl';
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node';
import { combine, kpis, summarize, type KpiId, type Summary } from '@/lib/analysis/growth';
import { engagementRate } from '@/lib/analysis/posts';
import { buildStories, buildTagStats } from '@/lib/dashboard/content';
import type { PostRow } from '@/lib/dashboard/detail-read';
import { AVG_FORMAT, COUNT_FORMAT, excelDateFormat, excelDateTimeFormat, PERCENT_FORMAT, safeText, sheetNames } from '@/lib/export/cells';
import type { ExportData } from '@/lib/export/read';
import { formatCountry, wallClock, type FormatPrefs } from '@/lib/format';
import { deepMerge } from '@/lib/merge';
import { METRICS } from '@/lib/metrics';
import type { Locale } from '@/lib/prefs';
import { localDay } from '@/lib/sync/time';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

export type Translate = (key: string, values?: Record<string, string | number>) => string;
const CATALOGS: Record<Locale, typeof en> = { en, 'zh-CN': deepMerge(en, zh) };

/** Server-side translator in the owner's language (same catalogs as the UI, English as the base). */
export function translator(locale: Locale): Translate {
  const tr = createTranslator({ locale, messages: CATALOGS[locale] });
  return (key, values) => tr(key as never, values as never);
}

export interface WorkbookSheet {
  sheet: string;
  data: SheetData;
  columns: { width: number }[];
  stickyRowsCount: number; // the header row stays visible ("frozen")
}

type Kind = 'text' | 'count' | 'avg' | 'percent' | 'date' | 'datetime';
type Value = string | number | null | undefined;
interface Col<R> {
  header: string;
  kind: Kind;
  width: number;
  get: (r: R) => Value;
}

export interface WorkbookOptions {
  today: string;
  now: Date;
  prefs: FormatPrefs;
  scopeName: string; // label of the totals row ("All accounts" / the group name)
}

const KPI_IDS: KpiId[] = ['followers', 'reach', 'views', 'engagementRate', 'posts', 'netFollows'];
const num = (v: Value) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function cellOf(kind: Kind, v: Value, o: WorkbookOptions): Cell {
  if (kind === 'text') {
    const s = safeText(typeof v === 'string' ? v : null);
    return s === null ? null : { value: s, type: String };
  }
  if (kind === 'date' || kind === 'datetime') {
    // a day string is already an owner-timezone day; an instant is moved to the owner's wall clock
    const d = typeof v === 'string' ? wallClock(v, kind === 'date' ? 'UTC' : o.prefs.timezone) : null;
    if (!d) return null;
    const { dateFormat, timeFormat, locale } = o.prefs;
    return { value: d, type: Date, format: kind === 'date' ? excelDateFormat(dateFormat, locale) : excelDateTimeFormat(dateFormat, timeFormat, locale) };
  }
  const n = num(v);
  if (n === null) return null;
  return { value: n, type: Number, format: kind === 'percent' ? PERCENT_FORMAT : kind === 'avg' ? AVG_FORMAT : COUNT_FORMAT };
}

function sheet<R>(name: string, cols: Col<R>[], rows: R[], o: WorkbookOptions): Omit<WorkbookSheet, 'sheet'> & { name: string } {
  return {
    name,
    data: [cols.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' as const })), ...rows.map((r) => cols.map((c) => cellOf(c.kind, c.get(r), o)))],
    columns: cols.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
  };
}

export function buildWorkbook(data: ExportData, t: Translate, o: WorkbookOptions): WorkbookSheet[] {
  const { from, to } = data.scope.range; // the days the scope covers, up to today
  const tz = o.prefs.timezone;
  const user = new Map(data.accounts.map((a) => [a.id, a.username]));
  const inWindow = (iso: string) => {
    const d = localDay(new Date(iso), tz);
    return d >= from && d <= to;
  };
  const tagName = new Map(data.tags.map((x) => [x.id, x.name]));
  const posts: PostRow[] = data.accounts.flatMap((a) => (data.posts[a.id] ?? []).filter((p) => p.mediaType !== 'STORY' && inWindow(p.postedAt)));

  // Summary: one row per account, plus the scope total when there are 2+ accounts (accounts without data stay out of
  // the total so they cannot remove its comparison, like the Overview totals)
  type SumRow = { label: string; group: string | null; s: Summary; lastSynced: string | null };
  const summaries = data.accounts.map((a) => summarize(data.daily[a.id] ?? [], data.posts[a.id] ?? [], data.scope.window, o.today, tz, data.scope.scope.cmp));
  const withData = summaries.filter((_, i) => (data.daily[data.accounts[i].id] ?? []).length > 0);
  const total = data.accounts.length > 1 ? combine(withData.length ? withData : summaries) : null;
  const sumRows: SumRow[] = [
    ...data.accounts.map((a, i) => ({ label: a.username, group: a.groupName, s: summaries[i], lastSynced: data.sync[a.id]?.lastSuccessAt ?? null })),
    ...(total ? [{ label: o.scopeName, group: null, s: total, lastSynced: null }] : []),
  ];
  const k = (r: SumRow) => kpis(r.s);
  const summaryCols: Col<SumRow>[] = [
    { header: t('export.cols.account'), kind: 'text', width: 24, get: (r) => r.label },
    { header: t('export.cols.group'), kind: 'text', width: 16, get: (r) => r.group },
    { header: t('export.cols.from'), kind: 'date', width: 13, get: (r) => r.s.from },
    { header: t('export.cols.to'), kind: 'date', width: 13, get: (r) => r.s.endDay },
    { header: t('export.cols.compareFrom'), kind: 'date', width: 14, get: (r) => r.s.compare?.from },
    { header: t('export.cols.compareTo'), kind: 'date', width: 14, get: (r) => r.s.compare?.to },
    ...KPI_IDS.flatMap((id): Col<SumRow>[] => [
      { header: t(`metrics.${id}`), kind: METRICS[id].kind === 'percent' ? 'percent' : 'count', width: 12, get: (r) => k(r)[id].value },
      { header: t('export.cols.change', { metric: t(`metrics.${id}`) }), kind: 'percent', width: 14, get: (r) => k(r)[id].change },
    ]),
    { header: t('export.cols.lastSynced'), kind: 'datetime', width: 18, get: (r) => r.lastSynced },
  ];

  const dailyRows = data.accounts.flatMap((a) => (data.daily[a.id] ?? []).filter((r) => r.day >= from && r.day <= to).map((r) => ({ username: a.username, ...r })));
  const dailyCols: Col<(typeof dailyRows)[number]>[] = [
    { header: t('export.cols.account'), kind: 'text', width: 24, get: (r) => r.username },
    { header: t('export.cols.day'), kind: 'date', width: 13, get: (r) => r.day },
    { header: t('metrics.followers'), kind: 'count', width: 11, get: (r) => r.followers },
    { header: t('metrics.reach'), kind: 'count', width: 11, get: (r) => r.reach },
    { header: t('metrics.views'), kind: 'count', width: 11, get: (r) => r.views },
    { header: t('export.cols.accountsEngaged'), kind: 'count', width: 14, get: (r) => r.accountsEngaged },
    { header: t('export.cols.interactions'), kind: 'count', width: 13, get: (r) => r.interactions },
    { header: t('export.cols.follows'), kind: 'count', width: 10, get: (r) => r.follows },
    { header: t('export.cols.unfollows'), kind: 'count', width: 10, get: (r) => r.unfollows },
    { header: t('export.cols.linkTaps'), kind: 'count', width: 10, get: (r) => r.linkTaps },
  ];

  const postCols: Col<PostRow>[] = [
    { header: t('export.cols.account'), kind: 'text', width: 24, get: (p) => user.get(p.accountId) },
    { header: t('export.cols.postedAt'), kind: 'datetime', width: 18, get: (p) => p.postedAt },
    { header: t('export.cols.type'), kind: 'text', width: 11, get: (p) => t(`analysis.format.${p.mediaType}`) },
    { header: t('export.cols.caption'), kind: 'text', width: 50, get: (p) => p.caption },
    { header: t('export.cols.permalink'), kind: 'text', width: 34, get: (p) => p.permalink },
    { header: t('metrics.reach'), kind: 'count', width: 10, get: (p) => p.reach },
    { header: t('metrics.views'), kind: 'count', width: 10, get: (p) => p.views },
    { header: t('export.cols.likes'), kind: 'count', width: 9, get: (p) => p.likes },
    { header: t('export.cols.comments'), kind: 'count', width: 10, get: (p) => p.comments },
    { header: t('export.cols.saves'), kind: 'count', width: 9, get: (p) => p.saves },
    { header: t('export.cols.shares'), kind: 'count', width: 9, get: (p) => p.shares },
    { header: t('metrics.engagementRate'), kind: 'percent', width: 12, get: (p) => engagementRate(p) },
    { header: t('export.cols.tags'), kind: 'text', width: 24, get: (p) => p.tagIds.map((id) => tagName.get(id)).filter(Boolean).sort().join(', ') },
  ];

  const storyRows = data.accounts.flatMap((a) => buildStories(data.stories[a.id] ?? [], o.now).map((s) => ({ username: a.username, ...s })));
  const storyCols: Col<(typeof storyRows)[number]>[] = [
    { header: t('export.cols.account'), kind: 'text', width: 24, get: (s) => s.username },
    { header: t('export.cols.postedAt'), kind: 'datetime', width: 18, get: (s) => s.postedAt },
    { header: t('metrics.reach'), kind: 'count', width: 10, get: (s) => s.final?.reach },
    { header: t('metrics.views'), kind: 'count', width: 10, get: (s) => s.final?.views },
    { header: t('export.cols.replies'), kind: 'count', width: 9, get: (s) => s.final?.replies },
    { header: t('export.cols.shares'), kind: 'count', width: 9, get: (s) => s.final?.shares },
    { header: t('export.cols.interactions'), kind: 'count', width: 13, get: (s) => s.final?.interactions },
    { header: t('export.cols.tapsForward'), kind: 'count', width: 13, get: (s) => s.final?.tapsForward },
    { header: t('export.cols.tapsBack'), kind: 'count', width: 11, get: (s) => s.final?.tapsBack },
    { header: t('export.cols.exits'), kind: 'count', width: 9, get: (s) => s.final?.exits },
    { header: t('export.cols.exitRate'), kind: 'percent', width: 11, get: (s) => s.exitRate },
    { header: t('export.cols.snapshots'), kind: 'count', width: 11, get: (s) => s.snapshots },
  ];

  // Audience: every entry of the latest snapshot of each breakdown (Instagram sends at most 45 per breakdown)
  type AudRow = { username: string; day: string; kind: 'age_gender' | 'country' | 'city'; item: string; value: number; share: number };
  const audRows: AudRow[] = data.accounts.flatMap((a) =>
    (['age_gender', 'country', 'city'] as const).flatMap((kind) => {
      const snap = data.audience[a.id]?.[kind];
      if (!snap) return [];
      const entries = Object.entries(snap.data).filter(([, v]) => Number.isFinite(v) && v > 0);
      const sum = entries.reduce((n, [, v]) => n + v, 0);
      const label = (key: string) => {
        if (kind === 'country') return `${formatCountry(key, o.prefs)} (${key.trim().toUpperCase()})`;
        if (kind === 'city') return key;
        const [age = '', g = ''] = key.split('|').map((s) => s.trim());
        const gender = g.toUpperCase();
        return `${age} · ${t(`export.gender.${gender === 'F' || gender === 'M' ? gender : 'U'}`)}`;
      };
      return entries.sort((x, y) => y[1] - x[1]).map(([key, value]) => ({ username: a.username, day: snap.day, kind, item: label(key), value, share: value / sum }));
    }),
  );
  const audCols: Col<AudRow>[] = [
    { header: t('export.cols.account'), kind: 'text', width: 24, get: (r) => r.username },
    { header: t('export.cols.snapshotDay'), kind: 'date', width: 14, get: (r) => r.day },
    { header: t('export.cols.breakdown'), kind: 'text', width: 16, get: (r) => t(`export.breakdown.${r.kind}`) },
    { header: t('export.cols.item'), kind: 'text', width: 28, get: (r) => r.item },
    { header: t('metrics.followers'), kind: 'count', width: 11, get: (r) => r.value },
    { header: t('export.cols.share'), kind: 'percent', width: 9, get: (r) => r.share },
  ];

  const tagStats = buildTagStats(posts, data.tags);
  type TagRow = { name: string; posts: number; measured: number; avgReach: number | null; engagementRate: number | null };
  const tagRows: TagRow[] = [...tagStats.rows.map((r) => ({ ...r, name: r.tag.name })), { ...tagStats.untagged, name: t('export.untagged') }];
  const tagCols: Col<TagRow>[] = [
    { header: t('export.cols.tag'), kind: 'text', width: 24, get: (r) => r.name },
    { header: t('metrics.posts'), kind: 'count', width: 9, get: (r) => r.posts },
    { header: t('export.cols.measured'), kind: 'count', width: 14, get: (r) => r.measured },
    { header: t('export.cols.avgReach'), kind: 'avg', width: 13, get: (r) => r.avgReach },
    { header: t('metrics.engagementRate'), kind: 'percent', width: 12, get: (r) => r.engagementRate },
  ];

  const built = [
    sheet(t('export.sheets.summary'), summaryCols, sumRows, o),
    sheet(t('export.sheets.daily'), dailyCols, dailyRows, o),
    sheet(t('export.sheets.posts'), postCols, posts, o),
    sheet(t('export.sheets.stories'), storyCols, storyRows, o),
    sheet(t('export.sheets.audience'), audCols, audRows, o),
    sheet(t('export.sheets.tags'), tagCols, tagRows, o),
  ];
  const names = sheetNames(built.map((b) => b.name));
  return built.map((b, i) => ({ sheet: names[i], data: b.data, columns: b.columns, stickyRowsCount: b.stickyRowsCount }));
}

export function writeWorkbook(sheets: WorkbookSheet[]): Promise<Buffer> {
  return writeXlsxFile(sheets).toBuffer();
}
