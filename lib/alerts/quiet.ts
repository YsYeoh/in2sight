// When a push goes out (Plan 17e, creator-toolkit design §0b "Alerts policy"): an unusual event is pushed at once, but
// never during quiet hours; what quiet hours held back, plus the less urgent kinds, arrives as ONE morning summary at the
// end of quiet hours; on the first day of the owner's week that summary is the weekly review. Pure: instants, settings
// and the owner timezone are inputs; wall-clock hours come from Intl via lib/sync/time (DST-safe).
import type { Alert } from '@/lib/alerts/rules';
import { ALERT_KINDS, type AlertKind, type AlertSettings } from '@/lib/alerts/settings';
import type { WeekStart } from '@/lib/prefs';
import { addDays, localDay, localHour, localTime } from '@/lib/sync/time';

type Quiet = Pick<AlertSettings, 'quietFrom' | 'quietTo'>;

/** Never pushed on their own: nothing breaks before the next morning (the 2-day token stage still leaves a day). */
export const DIGEST_ONLY: readonly AlertKind[] = ['token_expiring', 'moderation_paused'];
/** The summaries themselves: stored for dedupe and the bell, never counted inside another summary. */
export const SUMMARY_KINDS: readonly AlertKind[] = ['digest', 'weekly_digest'];

/** Inside quiet hours at this instant? [from, to) in the owner's wall-clock hours; the window may cross midnight; from === to = never. */
export function isQuiet(at: Date, s: Quiet, tz: string): boolean {
  const { quietFrom: from, quietTo: to } = s;
  if (from === to) return false;
  const h = localHour(at, tz);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

/** Push this freshly stored alert right now? Only an unusual-event kind, with its toggle on, outside quiet hours. */
export function pushNow(kind: AlertKind, s: AlertSettings, now: Date, tz: string): boolean {
  return s.push[kind] && !DIGEST_ONLY.includes(kind) && !SUMMARY_KINDS.includes(kind) && !isQuiet(now, s, tz);
}

export interface DigestWindow {
  day: string; // owner-timezone day of the summary (its dedupe key)
  fromIso: string; // previous summary time (yesterday at quietTo) ...
  toIso: string; // ... to today's summary time: alerts created in [from, to) belong to this summary
}

/** The summary that is due now, or null: due from quietTo until quiet hours start again, once per owner-timezone day. */
export function digestDue(now: Date, s: Quiet, tz: string): DigestWindow | null {
  if (isQuiet(now, s, tz) || localHour(now, tz) < s.quietTo) return null;
  const day = localDay(now, tz);
  return { day, fromIso: localTime(addDays(day, -1), s.quietTo, tz).toISOString(), toIso: localTime(day, s.quietTo, tz).toISOString() };
}

const isKind = (k: string): k is AlertKind => (ALERT_KINDS as readonly string[]).includes(k);

/** Unread alerts of the window that were NOT pushed at once: push toggle on, and a digest-only kind or created in quiet hours. */
export function heldCount(rows: { kind: string; createdAt: string }[], s: AlertSettings, tz: string): number {
  return rows.filter((r) => isKind(r.kind) && s.push[r.kind] && !SUMMARY_KINDS.includes(r.kind) && (DIGEST_ONLY.includes(r.kind) || isQuiet(new Date(r.createdAt), s, tz))).length;
}

/** 'YYYY-MM-DD' is the first day of the owner's week (Monday or Sunday, the Language & formats setting). */
export const isWeekStart = (day: string, weekStart: WeekStart): boolean => new Date(`${day}T00:00:00Z`).getUTCDay() === (weekStart === 'sun' ? 0 : 1);

/** At most two rows: the morning summary (only when something was held) and, on the week's first day, the weekly review
 *  (it carries the held count, so that morning sends ONE push). Keys digest:<day> / weekly_digest:<day> never repeat. */
export function summaryAlerts(day: string, s: AlertSettings, weekStart: WeekStart, held: number): Alert[] {
  const out: Alert[] = [];
  if (s.push.digest && held > 0) out.push({ kind: 'digest', accountId: null, severity: 'info', dedupeKey: `digest:${day}`, payload: { username: '', count: held } });
  if (s.push.weekly_digest && isWeekStart(day, weekStart)) out.push({ kind: 'weekly_digest', accountId: null, severity: 'info', dedupeKey: `weekly_digest:${day}`, payload: { username: '', count: s.push.digest ? held : 0 } });
  return out;
}

/** The one summary to push: the weekly review when there is one (it includes the held count), else the morning summary. */
export const summaryToPush = (fresh: Alert[]): Alert | undefined => fresh.find((a) => a.kind === 'weekly_digest') ?? fresh.find((a) => a.kind === 'digest');
