type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Returns a new object: `override` wins, anything missing falls back to `base`. Never mutates inputs. */
export function deepMerge<T extends Dict>(base: T, override: Dict): T {
  const out: Dict = { ...base };
  for (const key of Object.keys(override)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const o = override[key];
    const b = out[key];
    out[key] = isDict(b) && isDict(o) ? deepMerge(b, o) : o;
  }
  return out as T;
}
