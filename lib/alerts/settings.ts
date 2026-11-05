// Alert settings live in profiles.alert_settings (jsonb). Anything read from there goes through parseAlertSettings:
// unknown keys are dropped, numbers are clamped, junk falls back to the SPEC §7c defaults. Never throws.

export const ALERT_KINDS = ['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Plan 17e: the unfollow-spike rule stays OFF until docs/RUNBOOK_GROWTH.md §2 has verified FOLLOW_TYPE on real data (a swapped
 *  mapping would report a follow spike as unfollows). Flip to true in a reviewed commit after that check; nothing else changes. */
// Before flipping this: RUNBOOK_GROWTH §2 must pass, and `unfollow_spike.body` prints {count} as a plain number (no thousands separator): pass it through formatNumber in message.ts first.
export const UNFOLLOW_SPIKE_ENABLED = false;

export interface AlertSettings {
  push: Record<AlertKind, boolean>;
  reachDropPct: number; // alert when 7-day reach falls by at least this many percent vs the previous 7 days
  takingOffRatio: number; // alert when a post reaches this multiple of the account's median reach
  syncFailures: number; // alert after this many failed sync runs in a row
  quietFrom: number; // Plan 17e: no push from this hour (owner timezone, 0-23) ...
  quietTo: number; // ... until this hour, when the morning summary goes out; quietFrom === quietTo = no quiet hours
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false, moderation_paused: true, nonfollower_spike: true, unfollow_spike: true, digest: true, weekly_digest: true },
  reachDropPct: 20,
  takingOffRatio: 2,
  syncFailures: 2,
  quietFrom: 22,
  quietTo: 8,
};

/** [min, max, decimals] per number: what the Settings form allows. */
export const LIMITS = {
  reachDropPct: [5, 90, 0],
  takingOffRatio: [1.5, 10, 1],
  syncFailures: [1, 10, 0],
  quietFrom: [0, 23, 0],
  quietTo: [0, 23, 0],
} as const;

type NumKey = keyof typeof LIMITS;

function clampNum(v: unknown, key: NumKey): number {
  const [min, max, decimals] = LIMITS[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_ALERT_SETTINGS[key];
  const f = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * f) / f));
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function parseAlertSettings(raw: unknown): AlertSettings {
  const r = obj(raw);
  const p = obj(r.push);
  return {
    push: Object.fromEntries(ALERT_KINDS.map((k) => [k, typeof p[k] === 'boolean' ? p[k] : DEFAULT_ALERT_SETTINGS.push[k]])) as Record<AlertKind, boolean>,
    reachDropPct: clampNum(r.reachDropPct, 'reachDropPct'),
    takingOffRatio: clampNum(r.takingOffRatio, 'takingOffRatio'),
    syncFailures: clampNum(r.syncFailures, 'syncFailures'),
    quietFrom: clampNum(r.quietFrom, 'quietFrom'),
    quietTo: clampNum(r.quietTo, 'quietTo'),
  };
}
