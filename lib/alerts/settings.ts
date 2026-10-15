// Alert settings live in profiles.alert_settings (jsonb). Anything read from there goes through parseAlertSettings:
// unknown keys are dropped, numbers are clamped, junk falls back to the SPEC §7c defaults. Never throws.

export const ALERT_KINDS = ['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertSettings {
  push: Record<AlertKind, boolean>;
  reachDropPct: number; // alert when 7-day reach falls by at least this many percent vs the previous 7 days
  takingOffRatio: number; // alert when a post reaches this multiple of the account's median reach
  syncFailures: number; // alert after this many failed sync runs in a row
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  push: { token_expiring: true, needs_reconnect: true, sync_failing: true, reach_drop: true, taking_off: false },
  reachDropPct: 20,
  takingOffRatio: 2,
  syncFailures: 2,
};

/** [min, max, decimals] per threshold: what the Settings form allows. */
export const LIMITS = {
  reachDropPct: [5, 90, 0],
  takingOffRatio: [1.5, 10, 1],
  syncFailures: [1, 10, 0],
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
  };
}
