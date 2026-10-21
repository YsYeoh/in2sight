// The compact upload of Plan 15b: built in the browser (toPayload) from the parsed export, checked on the server
// (validateUpload) as untrusted input — exactly four keys, every name and time re-checked, nothing repaired.
import { MAX_FOLLOWERS, MAX_FOLLOWING, MIN_TS, USERNAME_RE, type Person } from '@/lib/followers/parse';

export const PAYLOAD_VERSION = 1;
// Vercel Functions reject request bodies over 4.5 MB; both lists at their caps with 30-character names are ≈ 2.8 MB
export const MAX_BODY_BYTES = 4_000_000;
export const FIRST_DAY = '2010-10-06'; // Instagram's launch: no export is older
export const MAX_SNAPSHOTS = 60; // per account: ~1 MB each at 50,000 followers (5 years monthly, ~1 year weekly)

type Pair = [string, number | null];
export interface Upload {
  takenOn: string; // YYYY-MM-DD
  followers: Person[];
  following: Person[] | null;
}

/** The request body: `{"v":1,"takenOn":"…","followers":[["name",1690000000],…],"following":[…]|null}`. */
export function toPayload(u: Upload): string {
  const pairs = (l: Person[]): Pair[] => l.map((p) => [p.username, p.at]);
  return JSON.stringify({ v: PAYLOAD_VERSION, takenOn: u.takenOn, followers: pairs(u.followers), following: u.following ? pairs(u.following) : null });
}

const realDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function people(v: unknown, max: number, nowSec: number): Person[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [username, at] = p as unknown[];
    if (typeof username !== 'string' || !USERNAME_RE.test(username) || seen.has(username)) return null;
    if (at !== null && !(typeof at === 'number' && Number.isInteger(at) && at >= MIN_TS && at <= nowSec + 86_400)) return null;
    seen.add(username);
    out.push({ username, at });
  }
  return out;
}

/** Server side: the parsed JSON body → the upload, or null for anything that is not exactly what toPayload builds. */
export function validateUpload(body: unknown, today: string, nowSec: number): Upload | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  if (Object.keys(body).sort().join(',') !== 'followers,following,takenOn,v') return null;
  const b = body as Record<string, unknown>;
  if (b.v !== PAYLOAD_VERSION || typeof b.takenOn !== 'string' || !realDay(b.takenOn) || b.takenOn < FIRST_DAY || b.takenOn > today) return null;
  const followers = people(b.followers, MAX_FOLLOWERS, nowSec);
  if (!followers) return null;
  if (b.following === null) return { takenOn: b.takenOn, followers, following: null };
  const following = people(b.following, MAX_FOLLOWING, nowSec);
  return following ? { takenOn: b.takenOn, followers, following } : null;
}
