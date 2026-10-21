// Instagram "Download your information" export → follower / following lists (Plan 15b). Runs in the BROWSER on the
// files the owner picked; only the result (usernames + follow times) is uploaded. Pure: no I/O, no clock (nowSec is
// an input). Untrusted input: JSON.parse only (no reviver), nothing is executed or rendered as HTML, names live in
// Maps (so "__proto__" is a plain key), sizes are capped before reading (checkFiles) and while reading (the people caps).
// Instagram changes this format without notice: each accepted variant is a fixture in tests/followers-parse.test.ts.

export const MAX_FILES = 10;
export const MAX_FILE_BYTES = 32 * 1024 * 1024; // a 50,000-follower followers_1.json is ~8–13 MB
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_FOLLOWERS = 50_000; // = the check in supabase/migrations/20261028000002_follower_exports.sql
export const MAX_FOLLOWING = 10_000; // Instagram caps following at 7,500
export const MIN_TS = 1_262_304_000; // 2010-01-01T00:00:00Z: no Instagram follow is older
export const USERNAME_RE = /^[a-z0-9._]{1,30}$/; // Instagram's username alphabet, lower-cased

export type FollowKind = 'followers' | 'following';
export type ParseError =
  | 'noFiles'
  | 'tooManyFiles'
  | 'notJson'
  | 'zipNotSupported'
  | 'htmlFormat'
  | 'fileTooLarge'
  | 'totalTooLarge'
  | 'badJson'
  | 'badShape'
  | 'unknownFile'
  | 'tooManyFollowers'
  | 'tooManyFollowing'
  | 'needFollowers';
/** One person: the lower-cased username and when the follow happened (seconds since 1970 UTC; null = unknown). */
export interface Person {
  username: string;
  at: number | null;
}
export interface ParseFailure {
  ok: false;
  error: ParseError;
  file?: string; // the owner's own file name, shown in the message
}
export interface Parsed {
  ok: true;
  followers: Person[];
  following: Person[] | null; // null = no following file was chosen
  skipped: number; // entries without a valid username
  ignored: string[]; // recognised export files that are not needed (recently_unfollowed_profiles.json, …)
}

/** "C:\fakepath\followers_1.json" → "followers_1.json". */
const baseName = (name: string): string => name.split(/[\\/]/).pop() ?? name;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// https://www.instagram.com/<name> or …/_u/<name>, optional trailing slash, query or fragment
const HREF = /^https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([^/?#]+)\/?(?:[?#].*)?$/i;

/** Before a byte is read: how many files, their extensions and sizes. null = fine. */
export function checkFiles(files: { name: string; size: number }[]): ParseFailure | null {
  if (files.length === 0) return { ok: false, error: 'noFiles' };
  if (files.length > MAX_FILES) return { ok: false, error: 'tooManyFiles' };
  let total = 0;
  for (const f of files) {
    const file = baseName(f.name);
    const ext = file.includes('.') ? file.slice(file.lastIndexOf('.') + 1).toLowerCase() : '';
    if (ext === 'zip') return { ok: false, error: 'zipNotSupported', file };
    if (ext === 'html' || ext === 'htm') return { ok: false, error: 'htmlFormat', file };
    if (ext !== 'json') return { ok: false, error: 'notJson', file };
    if (f.size > MAX_FILE_BYTES) return { ok: false, error: 'fileTooLarge', file };
    total += f.size;
  }
  return total > MAX_TOTAL_BYTES ? { ok: false, error: 'totalTooLarge' } : null;
}

/** A username as Instagram allows it (trimmed, without a leading @, lower-cased); null for anything else. */
export function cleanUsername(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^@/, '').toLowerCase();
  return USERNAME_RE.test(s) ? s : null;
}

/** Whole seconds between 2010-01-01 and one day after now; anything else is unknown. */
export function cleanTimestamp(v: unknown, nowSec: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_TS && v <= nowSec + 86_400 ? v : null;
}

/** One list entry → a person: the name from string_list_data[0].value, else title, else the href's last segment. */
function entryPerson(e: unknown, nowSec: number): Person | null {
  if (!isObject(e)) return null;
  const list = e.string_list_data;
  const first = Array.isArray(list) && isObject(list[0]) ? list[0] : {};
  const fromHref = typeof first.href === 'string' ? HREF.exec(first.href)?.[1] : undefined;
  const username = cleanUsername(first.value) ?? cleanUsername(e.title) ?? cleanUsername(fromHref);
  return username ? { username, at: cleanTimestamp(first.timestamp, nowSec) } : null;
}

type Found = { kind: FollowKind | 'ignored'; entries: unknown };

/** Which list a file holds: a bare array is named by its file name; an object by its relationships_* key. */
function kindOf(file: string, root: unknown): Found | ParseError {
  if (Array.isArray(root)) {
    if (/^followers(_\d+)?\.json$/i.test(file)) return { kind: 'followers', entries: root };
    if (/^following(_\d+)?\.json$/i.test(file)) return { kind: 'following', entries: root };
    return 'unknownFile';
  }
  if (!isObject(root)) return 'badShape';
  if ('relationships_followers' in root) return { kind: 'followers', entries: root.relationships_followers };
  if ('relationships_following' in root) return { kind: 'following', entries: root.relationships_following };
  const keys = Object.keys(root);
  // another file of the same export folder (recently unfollowed, pending requests, close friends, blocked …)
  return keys.length > 0 && keys.every((k) => k.startsWith('relationships_')) ? { kind: 'ignored', entries: [] } : 'unknownFile';
}

const CAPS: Record<FollowKind, [number, ParseError]> = { followers: [MAX_FOLLOWERS, 'tooManyFollowers'], following: [MAX_FOLLOWING, 'tooManyFollowing'] };

/**
 * The chosen files (already size-checked by checkFiles) → the followers and following lists. Several followers files
 * are merged; a duplicate keeps its first entry (and takes a timestamp a later one has); entries without a valid
 * username are skipped and counted, never an error. Any file that is not a known export file stops everything.
 */
export function parseExportFiles(files: { name: string; text: string }[], nowSec: number): Parsed | ParseFailure {
  if (files.length === 0) return { ok: false, error: 'noFiles' };
  const lists: Record<FollowKind, Map<string, number | null> | null> = { followers: null, following: null };
  const ignored: string[] = [];
  let skipped = 0;
  for (const f of files) {
    const file = baseName(f.name);
    const text = f.text.replace(/^\uFEFF/, '');
    if (/^\s*</.test(text)) return { ok: false, error: 'htmlFormat', file };
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch {
      return { ok: false, error: 'badJson', file };
    }
    const found = kindOf(file, root);
    if (typeof found === 'string') return { ok: false, error: found, file };
    if (found.kind === 'ignored') {
      ignored.push(file);
      continue;
    }
    if (!Array.isArray(found.entries)) return { ok: false, error: 'badShape', file };
    const map = (lists[found.kind] ??= new Map());
    const [max, tooMany] = CAPS[found.kind];
    for (const e of found.entries) {
      const p = entryPerson(e, nowSec);
      if (!p) {
        skipped++;
        continue;
      }
      if (map.has(p.username)) {
        if (map.get(p.username) === null && p.at !== null) map.set(p.username, p.at);
        continue;
      }
      if (map.size >= max) return { ok: false, error: tooMany };
      map.set(p.username, p.at);
    }
  }
  if (!lists.followers) return { ok: false, error: 'needFollowers' };
  const out = (m: Map<string, number | null>): Person[] => [...m].map(([username, at]) => ({ username, at }));
  return { ok: true, followers: out(lists.followers), following: lists.following ? out(lists.following) : null, skipped, ignored };
}
