// Cover images: pick the right CDN URL, fetch it safely, decide when to (re)try. Signed CDN URLs are never logged,
// stored or put into results/errors. SSRF rules (spec §4): https only, Instagram CDN hosts only (re-checked after every
// redirect, which is followed by hand), 10 s timeout, max 5 MB, JPEG/PNG/WebP only (never SVG: it can carry script).
import type { MediaDetails } from '@/lib/instagram/parse';
import type { SyncStore } from '@/lib/sync/store';

export const COVERS_BUCKET = 'covers';
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_TIMEOUT_MS = 10_000;
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type CoverType = (typeof COVER_TYPES)[number];
const MAX_REDIRECTS = 3;
const CDN_SUFFIXES = ['fbcdn.net', 'cdninstagram.com'];

/** Storage key inside the bucket. Both parts are ours (uuid, numeric media id), never client input. */
export const coverPath = (accountId: string, mediaId: string) => `${accountId}/${mediaId}.jpg`;

/** https on the default port, no credentials, host = an Instagram CDN domain or a subdomain of one. */
export function isCdnUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port !== '' && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return CDN_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Thumbnail for videos/Reels, the image itself for photos, the first child for carousels. null = none offered. */
export function coverUrl(d: MediaDetails | undefined): string | null {
  if (!d) return null;
  const pick = (type: string | null, mediaUrl: string | null, thumb: string | null) => (type === 'VIDEO' ? thumb : (mediaUrl ?? thumb));
  const first = d.children?.[0];
  if (first) return pick(first.mediaType, first.mediaUrl, first.thumbnailUrl);
  return pick(d.mediaType, d.mediaUrl, d.thumbnailUrl);
}

export type FetchImageResult = { ok: true; bytes: Uint8Array; contentType: CoverType } | { ok: false; reason: 'blocked' | 'http' | 'type' | 'too_large' | 'network' };

async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** GET one image under the rules above. Never throws; the result never contains the URL. */
export async function fetchImage(url: string, fetchFn: typeof fetch = fetch): Promise<FetchImageResult> {
  const signal = AbortSignal.timeout(COVER_TIMEOUT_MS);
  const drop = (res: Response) => res.body?.cancel().catch(() => {});
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      if (!isCdnUrl(current)) return { ok: false, reason: 'blocked' };
      const res = await fetchFn(current, { redirect: 'manual', signal, headers: { accept: COVER_TYPES.join(',') } });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await drop(res);
        if (!location || hop >= MAX_REDIRECTS) return { ok: false, reason: 'blocked' };
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) {
        await drop(res);
        return { ok: false, reason: 'http' };
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!(COVER_TYPES as readonly string[]).includes(type)) {
        await drop(res);
        return { ok: false, reason: 'type' };
      }
      if (Number(res.headers.get('content-length')) > COVER_MAX_BYTES) {
        await drop(res);
        return { ok: false, reason: 'too_large' };
      }
      const bytes = await readCapped(res, COVER_MAX_BYTES);
      if (!bytes) return { ok: false, reason: 'too_large' };
      if (bytes.byteLength === 0) return { ok: false, reason: 'http' };
      return { ok: true, bytes, contentType: type as CoverType };
    }
  } catch {
    return { ok: false, reason: 'network' }; // timeout, DNS, reset, bad redirect URL
  }
}

export type CoverStatus = 'pending' | 'ok' | 'unavailable' | 'failed';
export interface CoverRef {
  id: string;
  kind: string;
  postedAt: string;
  status: CoverStatus;
  attempts: number;
  triedAt: string | null;
}

/** After this many failed attempts a cover is given up on ('unavailable': the UI shows a type placeholder). */
export const COVER_MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 30 * 60_000;

/** Back-off before attempt n+1 after n failures: 30, 60, 120, 240 min. */
export const coverRetryMs = (attempts: number) => RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);

/** Status after one more failed attempt. */
export const afterFailure = (attempts: number): { status: 'failed' | 'unavailable'; attempts: number } => ({ status: attempts + 1 >= COVER_MAX_ATTEMPTS ? 'unavailable' : 'failed', attempts: attempts + 1 });

/**
 * One attempt: fetch the image, upload it as {account}/{media}.jpg (never overwriting), record the outcome. A fetch
 * or upload failure counts as a failed attempt (back-off, then 'unavailable'); only the status write itself can throw.
 */
export async function captureCover(store: SyncStore, accountId: string, ref: Pick<CoverRef, 'id' | 'attempts'>, url: string, nowIso: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const img = await fetchImage(url, fetchFn);
  if (img.ok) {
    const path = coverPath(accountId, ref.id);
    try {
      await store.uploadCover(path, img.bytes, img.contentType);
      await store.markCover(ref.id, { status: 'ok', attempts: ref.attempts + 1, triedAt: nowIso, path });
      return true;
    } catch {
      // Storage hiccup: counted as a failed attempt below
    }
  }
  await store.markCover(ref.id, { ...afterFailure(ref.attempts), triedAt: nowIso });
  return false;
}

/** Post covers to try now, newest first: never tried, or failed and its back-off has passed. */
export function pickCoverDue(refs: CoverRef[], now: Date, max: number): CoverRef[] {
  const t = now.getTime();
  return refs
    .filter((r) => r.status === 'pending' || (r.status === 'failed' && (!r.triedAt || t - Date.parse(r.triedAt) >= coverRetryMs(r.attempts))))
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : 0))
    .slice(0, max);
}
