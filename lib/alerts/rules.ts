// Alert rules (SPEC §7c). Pure: every input is plain data, `now` is injected. Each alert carries a dedupe key built so
// it never repeats (the notifications table has a unique index on it) - see the key comments per rule.
import type { AccountStatus } from '@/lib/accounts/types';
import { reachDrop, takingOff } from '@/lib/analysis/flags';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { AlertKind, AlertSettings } from '@/lib/alerts/settings';
import { localDay } from '@/lib/sync/time';

export const TOKEN_STAGES_DAYS = [7, 2] as const; // "token expiring" fires at 7 days left, and again at 2
export const REACH_DROP_COOLDOWN_DAYS = 7;
export const TAKING_OFF_WITHIN_DAYS = 3; // only fresh posts: enabling alerts must not dump a week of old wins

export type Severity = 'info' | 'warning' | 'critical';

/** i18n parameters only, never prose. */
export interface AlertPayload {
  username: string;
  days?: number;
  runs?: number;
  pct?: number;
  ratio?: number;
  postId?: string;
}

export interface Alert {
  kind: AlertKind;
  accountId: string;
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

const RULES: Rule[] = [needsReconnect, tokenExpiring, syncFailing, reachDropRule, takingOffRule];

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
