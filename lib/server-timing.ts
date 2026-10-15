// `Server-Timing` response header (read in DevTools → Network → Timing). Names and durations only — never data, ids or
// tokens. Pure helpers: the proxy records spans and sets the header (docs/RUNBOOK_PERF.md).

export interface Span {
  name: string;
  dur: number; // milliseconds
}

/** `auth;dur=12.3, total;dur=14.0` — names reduced to a header token, negative/NaN durations clamped to 0. */
export function serverTiming(spans: readonly Span[]): string {
  return spans
    .map(({ name, dur }) => `${name.replace(/[^A-Za-z0-9_-]/g, '') || 'span'};dur=${(Number.isFinite(dur) && dur > 0 ? dur : 0).toFixed(1)}`)
    .join(', ');
}

/** Runs `fn`, records how long it took under `name` (also when it throws), returns its result. */
export async function timed<T>(spans: Span[], name: string, fn: () => Promise<T>, now: () => number = () => performance.now()): Promise<T> {
  const start = now();
  try {
    return await fn();
  } finally {
    spans.push({ name, dur: now() - start });
  }
}
