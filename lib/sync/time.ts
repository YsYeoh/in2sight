// Owner-timezone day arithmetic. Offsets come from Intl for the instant in question (DST-safe), never hard-coded.
// A "day" is a 'YYYY-MM-DD' string in the owner's timezone.

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

function parts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

export function localDay(at: Date, tz: string): string {
  const p = parts(at, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localHour(at: Date, tz: string): number {
  return parts(at, tz).h;
}

/** Calendar arithmetic on a day string (timezone-free). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** tz offset (ms, local minus UTC) at an instant. */
function offsetMs(at: number, tz: string): number {
  const p = parts(new Date(at), tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at / 1000) * 1000;
}

/** The instant the day starts in tz. Two passes so a DST change between UTC midnight and local midnight is handled. */
export function dayStart(day: string, tz: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let t = utcMidnight - offsetMs(utcMidnight, tz);
  t = utcMidnight - offsetMs(t, tz);
  return new Date(t);
}

/** [first day 00:00, the day after the last day 00:00) in tz as ISO instants: the posted_at bounds of owner-timezone days. */
export function daysToIso(from: string, to: string, tz: string): { fromIso: string; toIso: string } {
  return { fromIso: dayStart(from, tz).toISOString(), toIso: dayStart(addDays(to, 1), tz).toISOString() };
}

/** [since, until) of a day as unix seconds, the form Instagram's insights API takes. */
export function dayRangeSec(day: string, tz: string): { since: number; until: number } {
  return { since: dayStart(day, tz).getTime() / 1000, until: dayStart(addDays(day, 1), tz).getTime() / 1000 };
}
