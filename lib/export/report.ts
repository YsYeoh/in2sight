// The PDF / preview report (SPEC §7d) as one small, JSON-serialisable model built from ExportData. Pure: now/today/tz
// are inputs. Reuses the dashboard analysis; nothing here is new maths.
import { onlineHeatmap, postHeatmap, type Heatmap } from '@/lib/analysis/best-time';
import { reachDrop, takingOff, type Flag } from '@/lib/analysis/flags';
import { combine, kpis, summarize, type Kpi, type KpiId } from '@/lib/analysis/growth';
import { engagementRate, formatComparison, topPosts } from '@/lib/analysis/posts';
import type { Period } from '@/lib/analysis/types';
import { buildAudience, type AudienceModel } from '@/lib/dashboard/audience';
import { buildStories, buildTagStats, snippet, type FeedFormat, type TagStat } from '@/lib/dashboard/content';
import type { ExportScope, ReportParams, Section } from '@/lib/export/params';
import { exportWindow, type ExportData } from '@/lib/export/read';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay } from '@/lib/sync/time';

export const TOP_POSTS = 10;

export interface ReportPost {
  id: string;
  username: string;
  mediaType: FeedFormat;
  postedAt: string;
  permalink: string | null;
  caption: string | null; // one-line snippet
  reach: number;
  engagementRate: number | null;
}

export interface ReportModel {
  v: 1;
  title: string; // '' = the translated default title
  note: string;
  scope: { kind: ExportScope['kind']; name: string }; // name: group name, username, or '' for all
  period: Period;
  from: string; // KPI window, owner-timezone days
  to: string;
  generatedAt: string; // ISO instant; formatted by the view
  sections: Section[];
  kpis: Record<KpiId, Kpi>;
  accounts: { username: string; kpis: Record<KpiId, Kpi> }[]; // per account, when the scope has 2+
  trend: { day: string; reach: number | null; views: number | null }[];
  topPosts: ReportPost[];
  formats: ReturnType<typeof formatComparison>;
  tags: { name: string; color: string; stat: TagStat }[];
  untagged: TagStat;
  bestTime: { online: Heatmap; posts: Heatmap };
  audience: { username: string; model: Omit<AudienceModel, 'globe'> }[];
  stories: { username: string; count: number; avgReach: number | null; avgViews: number | null; avgExitRate: number | null }[];
  flags: { username: string; flag: Flag }[];
}

const avg = (vals: (number | null | undefined)[]): number | null => {
  const n = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
};
const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

export function buildReport(data: ExportData, p: ReportParams, o: { today: string; now: Date; tz: string; weekStart: WeekStart }): ReportModel {
  const { from: rawFrom, to: rawTo } = exportWindow(p.period, o.today);
  const user = new Map(data.accounts.map((a) => [a.id, a.username]));
  const allPosts = data.accounts.flatMap((a) => data.posts[a.id] ?? []);
  const windowPosts = allPosts.filter((x) => {
    const d = localDay(new Date(x.postedAt), o.tz);
    return x.mediaType !== 'STORY' && d >= rawFrom && d <= rawTo;
  });

  const summaries = data.accounts.map((a) => summarize(data.daily[a.id] ?? [], data.posts[a.id] ?? [], p.period, o.today, o.tz));
  const withData = summaries.filter((_, i) => (data.daily[data.accounts[i].id] ?? []).length > 0);
  const total = summaries.length === 1 ? summaries[0] : combine(withData.length ? withData : summaries) ?? summarize([], [], p.period, o.today, o.tz);
  const to = total.endDay;
  const from = addDays(to, -(p.period - 1));
  const days = Array.from({ length: p.period }, (_, i) => addDays(from, i));
  const byDay = (field: 'reach' | 'views') => {
    const m = new Map<string, number | null>();
    for (const a of data.accounts) for (const r of data.daily[a.id] ?? []) m.set(r.day, add(m.get(r.day) ?? null, r[field]));
    return m;
  };
  const reach = byDay('reach');
  const views = byDay('views');
  const tagStats = buildTagStats(windowPosts, data.tags);
  const caption = new Map(windowPosts.map((x) => [x.id, x.caption]));

  return {
    v: 1,
    title: p.title,
    note: p.note,
    scope: { kind: p.scope.kind, name: p.scope.kind === 'all' ? '' : p.scope.kind === 'group' ? p.scope.name : (data.accounts[0]?.username ?? '') },
    period: p.period,
    from,
    to,
    generatedAt: o.now.toISOString(),
    sections: p.sections,
    kpis: kpis(total),
    accounts: data.accounts.length > 1 ? data.accounts.map((a, i) => ({ username: a.username, kpis: kpis(summaries[i]) })) : [],
    trend: days.map((day) => ({ day, reach: reach.get(day) ?? null, views: views.get(day) ?? null })),
    topPosts: topPosts(windowPosts, 'reach', { limit: TOP_POSTS }).map(({ post, value }) => ({
      id: post.id,
      username: user.get(post.accountId) ?? '',
      mediaType: post.mediaType as FeedFormat,
      postedAt: post.postedAt,
      permalink: post.permalink,
      caption: snippet(caption.get(post.id) ?? null),
      reach: value,
      engagementRate: engagementRate(post),
    })),
    formats: formatComparison(windowPosts),
    tags: tagStats.rows.map((r) => ({ name: r.tag.name, color: r.tag.color, stat: { posts: r.posts, measured: r.measured, avgReach: r.avgReach, engagementRate: r.engagementRate, reason: r.reason } })),
    untagged: tagStats.untagged,
    bestTime: { online: onlineHeatmap(data.accounts.flatMap((a) => data.online[a.id] ?? []), o.weekStart), posts: postHeatmap(allPosts, o.tz, o.weekStart) },
    audience: data.accounts.map((a) => {
      const m = buildAudience(data.audience[a.id] ?? { age_gender: null, country: null, city: null });
      return { username: a.username, model: { ages: m.ages, countries: m.countries, cities: m.cities, reason: m.reason } }; // no globe in print
    }),
    stories: data.accounts.map((a) => {
      const list = buildStories(data.stories[a.id] ?? [], o.now);
      return { username: a.username, count: list.length, avgReach: avg(list.map((s) => s.final?.reach)), avgViews: avg(list.map((s) => s.final?.views)), avgExitRate: avg(list.map((s) => s.exitRate)) };
    }),
    flags: data.accounts.flatMap((a) => {
      const drop = reachDrop(data.daily[a.id] ?? [], o.today, o.tz);
      return [...takingOff(data.posts[a.id] ?? [], o.now, p.period), ...(drop ? [drop] : [])].map((flag) => ({ username: a.username, flag }));
    }),
  };
}

/** The view's check of a finished report handed to it: right version and shape, else it renders nothing. */
export function isReportModel(v: unknown): v is ReportModel {
  if (v === null || typeof v !== 'object') return false;
  const m = v as Partial<ReportModel>;
  return m.v === 1 && typeof m.title === 'string' && typeof m.note === 'string' && Array.isArray(m.sections) && Array.isArray(m.trend) && typeof m.kpis === 'object' && m.kpis !== null;
}
