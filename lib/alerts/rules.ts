// Alert rules (SPEC §7c). Pure: every input is plain data, `now` is injected. Each alert carries a dedupe key built so
// it never repeats (the notifications table has a unique index on it) - see the key comments per rule.
import type { AccountStatus } from '@/lib/accounts/types';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import { weekdayAnomaly } from '@/lib/analysis/trend';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { UNFOLLOW_SPIKE_ENABLED, type AlertKind, type AlertSettings } from '@/lib/alerts/settings';
import { addDays, localDay } from '@/lib/sync/time';

export const TOKEN_STAGES_DAYS = [7, 2] as const; // "token expiring" fires at 7 days left, and again at 2
export const REACH_DROP_COOLDOWN_DAYS = 7;
export const TAKING_OFF_WITHIN_DAYS = 3; // only fresh posts: enabling alerts must not dump a week of old wins
/** Spike rules (Plan 17e) look at yesterday and the day before: today is partial, and Instagram may fill yesterday late. */
const SPIKE_DAYS_BACK = [1, 2] as const; // ponytail: yesterday can still be filling in (SETTLE_DAYS = 3); use [2, 3] if the live check shows noise
/** A day's follower + non-follower reach below this is too small for a share to mean anything. */
export const NONFOLLOWER_MIN_REACH = 50;

export type Severity = 'info' | 'warning' | 'critical';

/** i18n parameters only, never prose. */
export interface AlertPayload {
  username: string;
  days?: number;
  runs?: number;
  pct?: number;
  ratio?: number;
  postId?: string;
  count?: number; // Plan 17e: unfollows of a day, or alerts in a summary
  usual?: number; // Plan 17e: the same-weekday median a spike is compared with
  day?: string; // Plan 17e: the owner-timezone day of a spike, 'YYYY-MM-DD'
}

export interface Alert {
  kind: AlertKind;
  accountId: string | null; // null: the summaries (Plan 17e) belong to no account
  severity: Severity;
  dedupeKey: string;
  payload: AlertPayload;
}

export interface RuleInput {
  account: { id: string; username: string; status: AccountStatus; tokenExpiresAt: string | null };
  sync: { consecutiveFailures: number; lastSuccessAt: string | null };
  daily: DailyRow[];
  posts: Post[];
  lastReachDropAt: string | null; // created_at of the newest reach_drop notification for this account
  /** moderation_settings.paused_at of an account whose auto-hide is on but paused (Plan 15d); null/absent = not paused. */
  moderationPausedAt?: string | null;
  /** Plan 17e: account_daily_breakdown reach rows for spikeDays(today); absent = no non-follower rule. */
  reachByFollow?: { day: string; followType: string; value: number }[];
  settings: AlertSettings;
  now: Date;
  tz: string;
}

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

type Rule = (i: RuleInput) => Alert[];

/** Key: token_expiring:<account>:<expiry day>:<stage>. A refresh moves the expiry, so a later problem alerts again. */
const tokenExpiring: Rule = ({ account: a, now }) => {
  const expires = a.tokenExpiresAt ? Date.parse(a.tokenExpiresAt) : NaN;
  if (a.status !== 'active' || Number.isNaN(expires)) return [];
  const left = expires - now.getTime();
  if (left <= 0) return []; // already expired: the sync flips the account to needs_reconnect, which alerts instead
  const stage = left <= TOKEN_STAGES_DAYS[1] * DAY ? TOKEN_STAGES_DAYS[1] : left <= TOKEN_STAGES_DAYS[0] * DAY ? TOKEN_STAGES_DAYS[0] : null;
  if (stage === null) return [];
  return [{ kind: 'token_expiring', accountId: a.id, severity: stage === 2 ? 'critical' : 'warning', dedupeKey: `token_expiring:${a.id}:${new Date(expires).toISOString().slice(0, 10)}:${stage}`, payload: { username: a.username, days: Math.max(1, Math.ceil(left / DAY)) } }];
};

/** Key: needs_reconnect:<account>:<last success>. One alert per broken stretch; a successful sync starts a new one.
 *  Accepted: a second outage before any successful sync shares the key, so it is not alerted again. */
const needsReconnect: Rule = ({ account: a, sync }) =>
  a.status === 'needs_reconnect' ? [{ kind: 'needs_reconnect', accountId: a.id, severity: 'critical', dedupeKey: `needs_reconnect:${a.id}:${sync.lastSuccessAt ?? 'never'}`, payload: { username: a.username } }] : [];

/** Key: sync_failing:<account>:<last success>. Fires once when the streak reaches the threshold, not on every failure after. */
const syncFailing: Rule = ({ account: a, sync, settings }) =>
  a.status === 'active' && sync.consecutiveFailures >= settings.syncFailures
    ? [{ kind: 'sync_failing', accountId: a.id, severity: 'warning', dedupeKey: `sync_failing:${a.id}:${sync.lastSuccessAt ?? 'never'}`, payload: { username: a.username, runs: sync.consecutiveFailures } }]
    : [];

/** Key: reach_drop:<account>:<today>, plus a 7-day cool-down from the last reach_drop alert. No data = no alert. */
const reachDropRule: Rule = ({ account: a, daily, lastReachDropAt, settings, now, tz }) => {
  if (a.status !== 'active') return [];
  if (lastReachDropAt && now.getTime() - Date.parse(lastReachDropAt) < REACH_DROP_COOLDOWN_DAYS * DAY) return [];
  const flag = reachDrop(daily, localDay(now, tz), tz, -settings.reachDropPct / 100);
  if (!flag) return [];
  return [{ kind: 'reach_drop', accountId: a.id, severity: 'warning', dedupeKey: `reach_drop:${a.id}:${localDay(now, tz)}`, payload: { username: a.username, pct: Math.round(-flag.change * 100) } }];
};

/** Key: taking_off:<media id>. Once per post, ever. */
const takingOffRule: Rule = ({ account: a, posts, settings, now }) =>
  takingOff(posts, now, TAKING_OFF_WITHIN_DAYS, settings.takingOffRatio).map((f) => ({ kind: 'taking_off' as const, accountId: a.id, severity: 'info' as const, dedupeKey: `taking_off:${f.postId}`, payload: { username: a.username, ratio: round1(f.ratio), postId: f.postId } }));

/** Key: moderation_paused:<account>:<paused_at>. One alert per pause; switching auto-hide on again clears paused_at. */
const moderationPaused: Rule = ({ account: a, moderationPausedAt }) =>
  a.status === 'active' && moderationPausedAt
    ? [{ kind: 'moderation_paused', accountId: a.id, severity: 'warning', dedupeKey: `moderation_paused:${a.id}:${moderationPausedAt}`, payload: { username: a.username } }]
    : [];

/** Every day a spike rule reads: each checked day and the same weekday of the 8 weeks before it (18 days). */
export function spikeDays(today: string): string[] {
  return SPIKE_DAYS_BACK.flatMap((back) => Array.from({ length: 9 }, (_, w) => addDays(today, -back - 7 * w)));
}

/** Non-follower share of reach (0-100) per day; null when the day's reach is under NONFOLLOWER_MIN_REACH. */
export function nonFollowerShares(rows: { day: string; followType: string; value: number }[]): Record<string, number | null> {
  const by = new Map<string, { f: number; nf: number }>();
  for (const r of rows) {
    const e = by.get(r.day) ?? { f: 0, nf: 0 };
    if (r.followType === 'FOLLOWER') e.f += r.value;
    if (r.followType === 'NON_FOLLOWER') e.nf += r.value;
    by.set(r.day, e);
  }
  return Object.fromEntries([...by].map(([day, { f, nf }]) => [day, f + nf >= NONFOLLOWER_MIN_REACH ? (100 * nf) / (f + nf) : null]));
}

/** Upward same-weekday anomalies (weekdayAnomaly: 8 weeks, at least 4 samples, robust z >= 3.5) on the checked days. */
function upSpikes(series: Record<string, number | null>, now: Date, tz: string) {
  const today = localDay(now, tz);
  return SPIKE_DAYS_BACK.flatMap((back) => {
    const day = addDays(today, -back);
    const r = weekdayAnomaly(series, day);
    return r && 'unusual' in r && r.unusual && r.direction === 'up' ? [{ day, value: r.value, usual: r.median }] : [];
  });
}

/** Key: nonfollower_spike:<account>:<day>. Once per day; shares are rounded whole percents. */
const nonFollowerSpike: Rule = ({ account: a, reachByFollow, now, tz }) =>
  a.status !== 'active' || !reachByFollow?.length
    ? []
    : upSpikes(nonFollowerShares(reachByFollow), now, tz).map((s) => ({ kind: 'nonfollower_spike' as const, accountId: a.id, severity: 'info' as const, dedupeKey: `nonfollower_spike:${a.id}:${s.day}`, payload: { username: a.username, pct: Math.round(s.value), usual: Math.round(s.usual), day: s.day } }));

/** Key: unfollow_spike:<account>:<day>. OFF until UNFOLLOW_SPIKE_ENABLED (the follows/unfollows mapping is unverified). */
const unfollowSpike: Rule = ({ account: a, daily, now, tz }) =>
  !UNFOLLOW_SPIKE_ENABLED || a.status !== 'active'
    ? []
    : upSpikes(Object.fromEntries(daily.map((d) => [d.day, d.unfollows])), now, tz).map((s) => ({ kind: 'unfollow_spike' as const, accountId: a.id, severity: 'warning' as const, dedupeKey: `unfollow_spike:${a.id}:${s.day}`, payload: { username: a.username, count: s.value, usual: Math.round(s.usual), day: s.day } }));

const RULES: Rule[] = [needsReconnect, tokenExpiring, syncFailing, reachDropRule, takingOffRule, moderationPaused, nonFollowerSpike, unfollowSpike];

/** Every alert that currently applies to one account. A rule that throws (bad data) is skipped; the others still run. */
export function evaluateRules(input: RuleInput): Alert[] {
  if (input.account.status === 'archived') return [];
  return RULES.flatMap((rule) => {
    try {
      return rule(input);
    } catch {
      return [];
    }
  });
}
