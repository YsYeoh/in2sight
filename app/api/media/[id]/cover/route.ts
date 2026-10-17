import { NextResponse } from 'next/server';
import { assertOwner } from '@/lib/auth/assert-owner';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { createServerSupabase } from '@/lib/supabase/server';
import { COVER_TYPES, COVERS_BUCKET, coverPath } from '@/lib/sync/covers';

const MEDIA_ID = /^\d{1,32}$/; // Instagram media ids are numeric

/**
 * GET /api/media/[id]/cover — the stored cover image of one post/Reel/Story. Owner session only (proxy + assertOwner;
 * NOT a public exemption in lib/auth/route-policy.ts). The media row is read with the OWNER session (RLS decides it
 * exists for this owner); only then is the private object streamed with the admin client. The object key is recomputed
 * from our own ids and must equal the stored one, so no request value ever reaches Storage. Immutable once stored
 * (covers are never overwritten), cached privately for a year; the service worker never caches /api/*.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  if (!(await assertOwner(h))) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: h });
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404, headers: h });
  const { id } = await ctx.params;
  if (!MEDIA_ID.test(id)) return notFound();
  try {
    const db = await createServerSupabase({ responseHeaders: h });
    const { data, error } = await db.from('media').select('account_id,cover_status,cover_path').eq('id', id).maybeSingle();
    if (error) throw new Error('cover lookup failed');
    const row = data as { account_id: string; cover_status: string; cover_path: string | null } | null;
    if (!row || row.cover_status !== 'ok' || row.cover_path !== coverPath(row.account_id, id)) return notFound();
    const file = await createAdminSupabase().storage.from(COVERS_BUCKET).download(row.cover_path);
    if (file.error || !file.data) return notFound();
    // our own upload type (Task 10 only stores JPEG/PNG/WebP); anything else is served as JPEG, never sniffed
    h.set('content-type', (COVER_TYPES as readonly string[]).includes(file.data.type) ? file.data.type : 'image/jpeg');
    h.set('cache-control', 'private, max-age=31536000, immutable');
    return new NextResponse(file.data.stream(), { status: 200, headers: h });
  } catch {
    console.error('cover read failed'); // fixed text: never log error objects, ids or paths
    return NextResponse.json({ error: 'unexpected' }, { status: 500, headers: h });
  }
}
