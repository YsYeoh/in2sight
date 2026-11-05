// Planner board (Plan 17f, SPEC §7p): pure rules for the owner's post ideas. No I/O, no Instagram: the board never
// publishes or schedules anything. Shared by the server actions (the trust boundary) and the board UI.
import { weekdayOf, type Heatmap } from '@/lib/analysis/best-time';
import type { MissingReason } from '@/lib/analysis/types';
import type { MediaKind } from '@/lib/instagram/parse';
import { addDays, localDay, localHour } from '@/lib/sync/time';
import { daysBetween, isDay } from '@/lib/time-scope/range';
import { isMediaId, isUuid, normalizeTagName } from '@/lib/tags';

/** Board columns, left to right. The same list is the CHECK of planner_items.status (migration 20261105000001). */
export const PLANNER_STATUSES = ['idea', 'drafting', 'ready', 'posted'] as const;
export type PlannerStatus = (typeof PLANNER_STATUSES)[number];
export const PLANNER_FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'] as const satisfies readonly MediaKind[];
export const TITLE_MAX = 120;
export const NOTES_MAX = 2000;
/** Items per owner (the board reads at most this many; a new item beyond it is refused). */
export const MAX_ITEMS = 500;
export const MAX_ITEM_TAGS = 10;
/** A post within this many hours (wall clock, owner timezone) of the planned time is marked as a match. */
export const MATCH_HOURS = 3;

export interface PlannerItem {
  id: string;
  accountId: string;
  title: string;
  notes: string;
  status: PlannerStatus;
  format: MediaKind | null;
  plannedDay: string | null; // 'YYYY-MM-DD', owner timezone
  plannedHour: number | null; // 0-23, owner timezone; only with a day
  tagIds: string[];
  mediaId: string | null; // the published post, only when status = 'posted'
  createdAt: string;
}
export type PlannerInput = Omit<PlannerItem, 'id' | 'createdAt'>;

export type PlannerError = 'invalid' | 'not_found' | 'too_many' | 'needs_update' | 'unexpected';
export type PlannerResult = { ok: true } | { ok: false; error: PlannerError };

export interface SlotSuggestion {
  day: string;
  hour: number;
  value: number; // average engagement rate of the cell
  count: number; // posts behind it
}
export type SlotResult = { ok: true; slots: SlotSuggestion[]; sample: number; reason: MissingReason | null } | { ok: false; error: PlannerError };

const isStatus = (v: unknown): v is PlannerStatus => PLANNER_STATUSES.includes(v as PlannerStatus);
const isFormat = (v: unknown): v is MediaKind => PLANNER_FORMATS.includes(v as (typeof PLANNER_FORMATS)[number]);
// C0/C1 controls (newline and tab allowed) and bidi overrides/isolates, as in lib/tags.ts
const NOTES_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

/** Validates what the dialog sends. Every field is checked again here: the action is a public endpoint. */
export function parseItemInput(raw: unknown): { ok: true; value: PlannerInput } | { ok: false; error: 'invalid' } {
  const bad = { ok: false, error: 'invalid' } as const;
  if (typeof raw !== 'object' || raw === null) return bad;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.accountId)) return bad;
  const title = normalizeTagName(r.title, TITLE_MAX); // NFC, controls refused, spaces collapsed, 1-120 code points
  if (!title.ok) return bad;
  const notesRaw = r.notes ?? '';
  if (typeof notesRaw !== 'string') return bad;
  const notes = notesRaw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (NOTES_FORBIDDEN.test(notes) || [...notes].length > NOTES_MAX) return bad;
  if (!isStatus(r.status)) return bad;
  const format = r.format ?? null;
  if (format !== null && !isFormat(format)) return bad;
  const plannedDay = r.plannedDay ?? null;
  if (plannedDay !== null && !isDay(plannedDay)) return bad;
  const plannedHour = r.plannedHour ?? null;
  if (plannedHour !== null && !(Number.isInteger(plannedHour) && (plannedHour as number) >= 0 && (plannedHour as number) <= 23)) return bad;
  if (plannedHour !== null && plannedDay === null) return bad;
  if (!Array.isArray(r.tagIds) || !r.tagIds.every(isUuid)) return bad;
  const tagIds = [...new Set(r.tagIds.map((t) => t.toLowerCase()))];
  if (tagIds.length > MAX_ITEM_TAGS) return bad;
  const mediaId = r.mediaId ?? null;
  if (mediaId !== null && !isMediaId(mediaId)) return bad;
  if (mediaId !== null && r.status !== 'posted') return bad; // a linked post means it is published
  return {
    ok: true,
    value: { accountId: r.accountId.toLowerCase(), title: title.value, notes, status: r.status, format, plannedDay, plannedHour: plannedHour as number | null, tagIds, mediaId },
  };
}

/** The column to the left (-1) or right (+1); null at the edges. */
export function stepStatus(s: PlannerStatus, dir: -1 | 1): PlannerStatus | null {
  return PLANNER_STATUSES[PLANNER_STATUSES.indexOf(s) + dir] ?? null;
}

const planKey = (i: PlannerItem) => (i.plannedDay === null ? null : `${i.plannedDay} ${String(i.plannedHour ?? 24).padStart(2, '0')}`);

/** Four columns. Planned items first (a day without an hour after that day's hours), soonest first, but latest first
 *  in Posted; then unplanned items, newest first. */
export function boardColumns(items: readonly PlannerItem[]): { status: PlannerStatus; items: PlannerItem[] }[] {
  const order = (dir: 1 | -1) => (a: PlannerItem, b: PlannerItem) => {
    const ka = planKey(a);
    const kb = planKey(b);
    if (ka !== kb) return ka === null ? 1 : kb === null ? -1 : ka < kb ? -dir : dir;
    return a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt > b.createdAt ? -1 : 1;
  };
  return PLANNER_STATUSES.map((status) => ({ status, items: items.filter((i) => i.status === status).sort(order(status === 'posted' ? -1 : 1)) }));
}

export interface LinkMedia {
  id: string;
  accountId: string;
  mediaType: MediaKind;
  postedAt: string; // ISO
}

/** Posts the owner may link to an item, best first: same account; Stories only for a Story item and never otherwise;
 *  not linked to another item; the planned format first; then the nearest to the planned time (wall clock in the
 *  owner timezone, so a DST change does not shift it); without a planned day, the newest. `match` = same or unknown
 *  format and within MATCH_HOURS of the planned time. The owner always confirms; nothing links by itself. */
export function linkCandidates(
  item: Pick<PlannerItem, 'id' | 'accountId' | 'format' | 'plannedDay' | 'plannedHour'>,
  media: readonly LinkMedia[],
  linked: ReadonlyMap<string, string>, // media id → the item that holds it
  tz: string,
  max = 5,
): { media: LinkMedia; hours: number | null; match: boolean }[] {
  const story = item.format === 'STORY';
  const hoursOff = (m: LinkMedia) => {
    if (item.plannedDay === null) return null;
    const at = new Date(m.postedAt);
    return daysBetween(item.plannedDay, localDay(at, tz)) * 24 + localHour(at, tz) - (item.plannedHour ?? 12);
  };
  return media
    .filter((m) => m.accountId === item.accountId && (m.mediaType === 'STORY') === story && (linked.get(m.id) ?? item.id) === item.id)
    .map((m) => {
      const hours = hoursOff(m);
      const sameFormat = item.format === null || item.format === m.mediaType;
      return { media: m, hours, match: sameFormat && hours !== null && Math.abs(hours) <= MATCH_HOURS, sameFormat };
    })
    .sort((a, b) => {
      if (a.sameFormat !== b.sameFormat) return a.sameFormat ? -1 : 1;
      if (a.hours !== null && b.hours !== null && Math.abs(a.hours) !== Math.abs(b.hours)) return Math.abs(a.hours) - Math.abs(b.hours);
      return a.media.postedAt === b.media.postedAt ? (a.media.id < b.media.id ? -1 : 1) : a.media.postedAt > b.media.postedAt ? -1 : 1;
    })
    .slice(0, max)
    .map(({ media: m, hours, match }) => ({ media: m, hours, match }));
}

/** Up to `n` slots in the next 7 days from the account's "your post performance" heatmap (lib/analysis/best-time.ts):
 *  the best cells with enough posts, each on its next date after today, at most one per day, skipping days that
 *  already hold a planned item. None while the heatmap itself is unreliable (fewer than RELIABLE_POSTS posts). */
export function suggestSlots(map: Heatmap, takenDays: readonly string[], today: string, n = 3): SlotSuggestion[] {
  if (map.reason !== null) return [];
  const used = new Set(takenDays);
  const cells = map.rows
    .flatMap((r) => r.cells.map((c, hour) => ({ weekday: r.weekday, hour, value: c.value, count: c.count, low: c.lowSample })))
    .filter((c): c is { weekday: number; hour: number; value: number; count: number; low: boolean } => c.value !== null && !c.low)
    .sort((a, b) => b.value - a.value || b.count - a.count || a.weekday - b.weekday || a.hour - b.hour);
  const out: SlotSuggestion[] = [];
  for (const c of cells) {
    if (out.length >= n) break;
    const day = [1, 2, 3, 4, 5, 6, 7].map((i) => addDays(today, i)).find((d) => weekdayOf(d) === c.weekday)!;
    if (used.has(day)) continue;
    used.add(day);
    out.push({ day, hour: c.hour, value: c.value, count: c.count });
  }
  return out;
}
