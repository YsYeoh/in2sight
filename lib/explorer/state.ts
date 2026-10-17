// Explorer URL state (`/explorer?m=…&by=…&…`). Every value comes from a URL or a saved view, so everything is
// allow-listed: unknown, repeated or hostile values fall back to the default for that part (never echoed, never thrown).
// The Time Scope keys (from/to/cmp/cfrom/cto/gran, Plan 12a) are NOT parsed here: lib/time-scope owns them.
import { normalizeGroup } from '@/lib/accounts/group';
import type { MediaKind } from '@/lib/instagram/parse';
import { isDimensionId, isMetricId, METRICS, supports, type DimensionId, type MetricId } from '@/lib/metrics';
import { isMediaId, isUuid } from '@/lib/tags';

export const MAX_METRICS = 4;
export const MAX_ACCOUNTS = 20;
export const FORMATS: readonly MediaKind[] = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'];
/** The query keys this module owns (saved views keep only these plus the Time Scope keys). */
export const EXPLORER_KEYS = ['m', 'chart', 'by', 'acc', 'grp', 'fmt', 'tag', 'wd', 'hr', 'item'] as const;

export interface ExplorerState {
  metrics: MetricId[]; // m=reach,posts — order kept, duplicates and metrics the dimension cannot show dropped, ≤ 4
  chart: MetricId; // chart= — the metric drawn in the chart; one of `metrics`
  by: DimensionId; // by=
  accounts: string[]; // acc=<uuid>,<uuid> — empty = every live account (≤ 20)
  group: string | null; // grp=<group name>
  format: MediaKind | null; // fmt=REELS|CAROUSEL_ALBUM|IMAGE|STORY
  tag: string | null; // tag=<uuid> | untagged
  weekday: number | null; // wd=0..6 (0 = Sunday, owner timezone)
  hour: number | null; // hr=0..23 (owner timezone)
  item: string | null; // item=<media id> — the single-item level
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' ? v : null);

type Filters = Pick<ExplorerState, 'by' | 'format' | 'tag' | 'weekday' | 'hour'>;
const contentFiltered = (f: Filters) => f.format !== null || f.tag !== null || f.weekday !== null || f.hour !== null;

/**
 * Whether a metric can be shown: the dimension must support it, and account totals (daily metrics) cannot be narrowed
 * to a format, tag, weekday or hour — Instagram reports them per account and day only.
 */
export function usable(id: MetricId, f: Filters): boolean {
  return supports(id, f.by) && (METRICS[id].source === 'posts' || !contentFiltered(f));
}

/** Defaults when the URL names no usable metric: account totals where allowed, post numbers otherwise. */
export function defaultMetrics(f: Filters): MetricId[] {
  return usable('reach', f) ? ['reach', 'engagementRate', 'posts', 'avgReach'] : ['posts', 'avgReach', 'postEngagementRate'];
}

function intIn(v: string | null, min: number, max: number): number | null {
  if (v === null || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export function parseExplorerState(sp: Params): ExplorerState {
  const g = normalizeGroup(one(sp.grp) ?? undefined);
  const fmt = one(sp.fmt);
  const tag = one(sp.tag);
  const item = one(sp.item);
  const base = {
    by: isDimensionId(one(sp.by)) ? (one(sp.by) as DimensionId) : 'account',
    accounts: [...new Set((one(sp.acc) ?? '').split(',').filter(isUuid).map((id) => id.toLowerCase()))].slice(0, MAX_ACCOUNTS),
    group: g.ok && g.value !== null && g.value === one(sp.grp) ? g.value : null, // only an exact, already-normal name
    format: fmt && (FORMATS as readonly string[]).includes(fmt) ? (fmt as MediaKind) : null,
    tag: tag === 'untagged' ? 'untagged' : isUuid(tag) ? tag.toLowerCase() : null,
    weekday: intIn(one(sp.wd), 0, 6),
    hour: intIn(one(sp.hr), 0, 23),
    item: isMediaId(item) ? item : null,
  } satisfies Omit<ExplorerState, 'metrics' | 'chart'>;
  const asked = (one(sp.m) ?? '').split(',').filter(isMetricId).filter((id) => usable(id, base));
  const metrics = asked.length ? [...new Set(asked)].slice(0, MAX_METRICS) : defaultMetrics(base);
  const chart = one(sp.chart);
  return { metrics, chart: isMetricId(chart) && metrics.includes(chart) ? chart : metrics[0], ...base };
}

/** Canonical query of a state, in a fixed key order (links, saved views and the export all use this). */
export function explorerParams(s: ExplorerState): URLSearchParams {
  const q = new URLSearchParams();
  q.set('m', s.metrics.join(','));
  if (s.chart !== s.metrics[0]) q.set('chart', s.chart);
  q.set('by', s.by);
  if (s.accounts.length) q.set('acc', s.accounts.join(','));
  if (s.group !== null) q.set('grp', s.group);
  if (s.format !== null) q.set('fmt', s.format);
  if (s.tag !== null) q.set('tag', s.tag);
  if (s.weekday !== null) q.set('wd', String(s.weekday));
  if (s.hour !== null) q.set('hr', String(s.hour));
  if (s.item !== null) q.set('item', s.item);
  return q;
}

/** A new state with some parts changed: metrics it cannot show are dropped, the chart metric follows. */
export function withState(s: ExplorerState, patch: Partial<ExplorerState>): ExplorerState {
  const next = { ...s, ...patch };
  const kept = next.metrics.filter((id) => usable(id, next));
  const metrics = kept.length ? kept : defaultMetrics(next);
  return { ...next, metrics, chart: metrics.includes(next.chart) ? next.chart : metrics[0] };
}

/** `/explorer?<state>&<scope>`: `scopeQuery` is the Time Scope's canonical query (ResolvedScope.query, '' = default). */
export function explorerHref(s: ExplorerState, scopeQuery: string): string {
  return `/explorer?${explorerParams(s)}${scopeQuery ? `&${scopeQuery}` : ''}`;
}
