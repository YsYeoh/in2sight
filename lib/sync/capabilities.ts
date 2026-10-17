// Capability memory: which optional Meta metrics/fields work for this account, learned at runtime and kept in
// sync_state.capabilities (e.g. {"story:follows": false}). Only an explicit "unsupported" answer is remembered as false,
// so a transient error can never switch a metric off. Reset (owner/assistant): update sync_state set capabilities = '{}';
import { isUnsupported } from '@/lib/instagram/data';

export type Capabilities = Record<string, boolean>;

/** Stored jsonb -> map; anything that is not a boolean is dropped. */
export function parseCapabilities(v: unknown): Capabilities {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean'));
}

/** Ask unless Meta already said "unsupported". Unknown and supported are both asked. */
export const shouldAsk = (caps: Capabilities, key: string): boolean => caps[key] !== false;

/**
 * What one optional call taught: success -> supported; an "unsupported" answer -> false; anything else (transient,
 * network, no data, deleted object, unclassified) teaches nothing and leaves the map as it was.
 */
export function learn(caps: Capabilities, key: string, result: { ok: true } | { error: unknown }): Capabilities {
  if ('ok' in result) return caps[key] === true ? caps : { ...caps, [key]: true };
  return isUnsupported(result.error) ? { ...caps, [key]: false } : caps;
}
