'use server';

// Saved Explorer views are owner-authored data: these actions use the OWNER-SESSION client, so RLS
// (explorer_views_owner_all, gated on is_owner()) applies to every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { MAX_VIEWS, VIEW_NAME_MAX, viewState } from '@/lib/explorer/views';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid, normalizeTagName, sameTagName } from '@/lib/tags';

export type ViewError = 'invalid_name' | 'invalid_state' | 'duplicate' | 'not_found' | 'too_many' | 'unexpected';
export type ViewResult = { ok: true } | { ok: false; error: ViewError };

/** A view's query is at most a few hundred characters; anything far longer is not one of ours. */
const QUERY_MAX = 4000;

type DbError = { code?: string } | null;
// 23505 unique_violation (lower(name) index, a race with another tab), 23514 check (state too large)
const keyOf = (e: DbError): ViewError => (e?.code === '23505' ? 'duplicate' : e?.code === '23514' ? 'invalid_state' : 'unexpected');
const fail = (error: ViewError): ViewResult => ({ ok: false, error });

function done(): ViewResult {
  revalidatePath('/explorer');
  return { ok: true };
}

async function existing(db: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data, error } = await db.from('explorer_views').select('id,name').limit(MAX_VIEWS + 1);
  if (error) throw new Error('views read failed');
  return (data ?? []) as { id: string; name: string }[];
}

// Server actions are public endpoints: authorize first (outside try/catch: it redirects by throwing), then validate.
export async function saveViewAction(name: string, query: string): Promise<ViewResult> {
  await requireOwner();
  const n = normalizeTagName(name, VIEW_NAME_MAX);
  if (!n.ok) return fail(n.error);
  if (typeof query !== 'string' || query.length > QUERY_MAX) return fail('invalid_state');
  try {
    const state = viewState(query, (await getPrefs()).weekStart);
    const db = await createServerSupabase();
    const views = await existing(db);
    if (views.some((v) => sameTagName(v.name, n.value))) return fail('duplicate');
    if (views.length >= MAX_VIEWS) return fail('too_many');
    const { error } = await db.from('explorer_views').insert({ name: n.value, state });
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}

export async function renameViewAction(id: string, name: string): Promise<ViewResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  const n = normalizeTagName(name, VIEW_NAME_MAX);
  if (!n.ok) return fail(n.error);
  try {
    const db = await createServerSupabase();
    if ((await existing(db)).some((v) => v.id !== id && sameTagName(v.name, n.value))) return fail('duplicate');
    const { data, error } = await db.from('explorer_views').update({ name: n.value, updated_at: new Date().toISOString() }).eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}

export async function deleteViewAction(id: string): Promise<ViewResult> {
  await requireOwner();
  if (!isUuid(id)) return fail('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('explorer_views').delete().eq('id', id).select('id');
    if (error) return fail(keyOf(error));
    return (data ?? []).length ? done() : fail('not_found');
  } catch {
    return fail('unexpected');
  }
}
