'use server';

// Tags are owner-authored data: these actions use the OWNER-SESSION client, so RLS (tags_owner_all /
// media_tags_owner_all, gated on is_owner()) still applies to every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { TAG_LIMIT } from '@/lib/dashboard/detail-read';
import { createServerSupabase } from '@/lib/supabase/server';
import { isMediaId, isUuid, MAX_TAGS_PER_POST, normalizeTagName, pickColor, sameTagName } from '@/lib/tags';

export type TagError = 'invalid_name' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected';
export type TagResult = { ok: true } | { ok: false; error: TagError };

type DbError = { code?: string } | null;
// 23505 unique_violation (lower(name) index, a race with another tab), 23503 foreign key (media/tag gone)
const keyOf = (e: DbError): TagError => (e?.code === '23505' ? 'duplicate' : e?.code === '23503' ? 'not_found' : 'unexpected');
const fail = (error: TagError): TagResult => ({ ok: false, error });

function done(): TagResult {
  revalidatePath('/tags');
  revalidatePath('/accounts/[id]', 'page');
  return { ok: true };
}

async function existing(db: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data, error } = await db.from('tags').select('id,name,color').limit(TAG_LIMIT);
  if (error) throw new Error('tags read failed');
  return (data ?? []) as { id: string; name: string; color: string }[];
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function createTagAction(name: string): Promise<TagResult> {
  await requireOwner();
  const n = normalizeTagName(name);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    const tags = await existing(db);
    if (tags.some((t) => sameTagName(t.name, n.value))) return fail('duplicate');
    const { error } = await db.from('tags').insert({ name: n.value, color: pickColor(tags.map((t) => t.color)) });
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}

export async function renameTagAction(id: string, name: string): Promise<TagResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  const n = normalizeTagName(name);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    if ((await existing(db)).some((t) => t.id !== id && sameTagName(t.name, n.value))) return fail('duplicate');
    const { data, error } = await db.from('tags').update({ name: n.value }).eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deleteTagAction(id: string): Promise<TagResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('tags').delete().eq('id', id).select('id'); // media_tags rows cascade
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

/** Replaces a post's tags with exactly `tagIds` (deduplicated, at most 10). Adds first, then removes the rest, so a
 *  failure half-way leaves extra tags rather than losing the existing ones. */
export async function setPostTagsAction(mediaId: string, tagIds: string[]): Promise<TagResult> {
  await requireOwner();
  if (!isMediaId(mediaId) || !Array.isArray(tagIds) || !tagIds.every(isUuid)) return fail('not_found');
  const ids = [...new Set(tagIds.map((t) => t.toLowerCase()))];
  if (ids.length > MAX_TAGS_PER_POST) return fail('too_many');
  try {
    const db = await createServerSupabase();
    if (ids.length) {
      const { error } = await db.from('media_tags').upsert(ids.map((tag_id) => ({ media_id: mediaId, tag_id })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
      if (error) return fail(keyOf(error));
    }
    const del = db.from('media_tags').delete().eq('media_id', mediaId);
    // ids are validated uuids, so the PostgREST list literal cannot be injected into
    const { error } = ids.length ? await del.not('tag_id', 'in', `(${ids.join(',')})`) : await del;
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}
