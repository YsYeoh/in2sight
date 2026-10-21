import { NextResponse } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { MAX_BODY_BYTES, validateUpload } from '@/lib/followers/payload';
import { saveFollowerSnapshot } from '@/lib/followers/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

export type UploadError = 'unauthorized' | 'invalid' | 'tooLarge' | 'notFound' | 'notReady' | 'tooManySnapshots' | 'unexpected';

/** The body as bytes, or null as soon as it passes `max` (a missing or lying content-length cannot get more in). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
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

/** The browser's Origin must be this host (CSRF: the session cookie is the credential), as Next checks for server actions. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * POST /api/accounts/[id]/followers — one follower snapshot from the Followers tab's upload dialog (Plan 15b). Owner
 * session only (proxy + assertOwner; NOT a public exemption). The body is the compact payload of lib/followers/payload.ts
 * (usernames + follow times; the raw export files never leave the browser). Checked in this order, each failing closed
 * with a fixed key and nothing echoed: owner → account id → same origin → JSON content type → content-length ≤
 * MAX_BODY_BYTES → the body read with the same cap → UTF-8 → JSON → validateUpload → the account is live → at most
 * MAX_SNAPSHOTS → insert (owner session, RLS). Never logs the body, the names or an error object.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  const fail = (status: number, error: UploadError) => NextResponse.json({ error }, { status, headers: h });
  if (!(await assertOwner(h))) return fail(401, 'unauthorized');
  const { id } = await ctx.params;
  if (!isUuid(id)) return fail(404, 'notFound');
  if (!sameOrigin(request)) return fail(403, 'unauthorized');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return fail(415, 'invalid');
  const length = Number(request.headers.get('content-length'));
  if (!Number.isInteger(length) || length <= 0) return fail(411, 'invalid');
  if (length > MAX_BODY_BYTES) return fail(413, 'tooLarge');
  try {
    const bytes = await readCapped(request, MAX_BODY_BYTES);
    if (!bytes) return fail(413, 'tooLarge');
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return fail(400, 'invalid');
    }
    const now = new Date();
    const upload = validateUpload(body, localDay(now, (await getPrefs()).timezone), Math.floor(now.getTime() / 1000));
    if (!upload) return fail(400, 'invalid');
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies, never the admin client
    const account = await supabaseAccountsStore(db).getById(id.toLowerCase());
    if (!account || account.status === 'archived') return fail(404, 'notFound');
    const saved = await saveFollowerSnapshot(db, account.id, upload);
    if (saved === 'notReady') return fail(503, 'notReady');
    if (saved === 'tooManySnapshots') return fail(409, 'tooManySnapshots');
    return NextResponse.json({ ok: true }, { status: 201, headers: h });
  } catch {
    console.error('followers upload failed'); // fixed text: never the error object (it can carry usernames)
    return fail(500, 'unexpected');
  }
}
