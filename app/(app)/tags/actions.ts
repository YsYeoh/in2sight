'use server';

// Tags are owner-authored data: these actions use the OWNER-SESSION client, so RLS (tags_owner_all /
// media_tags_owner_all, gated on is_owner()) still applies to every write. Never the admin client here.
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/lib/auth/require-owner';
import { TAG_LIMIT } from '@/lib/dashboard/detail-read';
import { createServerSupabase } from '@/lib/supabase/server';
import { isMediaId, isUuid, MAX_TAGS_PER_POST, normalizeTagName, pickColor, sameTagName } from '@/lib/tags';
import { applyTagRules, isMissingTable, loadRuleMedia, loadRules } from '@/lib/tag-rules/apply';
import { MAX_RULES, normalizeRuleValue, RULE_KINDS, type RuleError, type RuleKind } from '@/lib/tag-rules/rules';

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
    if (tags.length >= TAG_LIMIT) return fail('too_many'); // reads are capped at TAG_LIMIT, so more tags would silently vanish from the page
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

/**
 * Saves a tag picker: adds `tagIds` (deduplicated, at most 10) and removes only what the owner unticked, i.e. the tags the
 * picker showed ticked when it opened (`initial`) that are no longer in `tagIds`. A tag a rule added after the picker opened
 * is in neither list, so it is kept and not remembered as removed. Adds first, then remembers and removes (Plan 17c: a removed
 * tag is never re-added by a rule), so a failure half-way leaves extra tags rather than losing existing ones.
 */
export async function setPostTagsAction(mediaId: string, tagIds: string[], initial: string[]): Promise<TagResult> {
  await requireOwner();
  if (!isMediaId(mediaId) || !Array.isArray(tagIds) || !tagIds.every(isUuid) || !Array.isArray(initial) || !initial.every(isUuid)) return fail('not_found');
  const ids = [...new Set(tagIds.map((t) => t.toLowerCase()))];
  const shown = new Set(initial.map((t) => t.toLowerCase()));
  if (ids.length > MAX_TAGS_PER_POST) return fail('too_many');
  try {
    const db = await createServerSupabase();
    if (ids.length) {
      const { error } = await db.from('media_tags').upsert(ids.map((tag_id) => ({ media_id: mediaId, tag_id })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
      if (error) return fail(keyOf(error));
    }
    const current = await db.from('media_tags').select('tag_id').eq('media_id', mediaId);
    if (current.error) return fail(keyOf(current.error));
    const removed = ((current.data ?? []) as { tag_id: unknown }[]).map((r) => String(r.tag_id)).filter((t) => shown.has(t.toLowerCase()) && !ids.includes(t.toLowerCase()));
    if (removed.length === 0) return done();
    // Plan 17c: remember what the owner took off BEFORE removing it, so a tag rule never puts it back. Without the
    // migration there are no rules (nothing to remember it for): the removal goes ahead.
    const memo = await db.from('media_tag_rejections').upsert(removed.map((tag_id) => ({ media_id: mediaId, tag_id })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
    if (memo.error && !isMissingTable(memo.error)) return fail(keyOf(memo.error));
    const { error } = await db.from('media_tags').delete().eq('media_id', mediaId).in('tag_id', removed);
    return error ? fail(keyOf(error)) : done();
  } catch {
    return fail('unexpected');
  }
}

// ---- Plan 17c: tag rules (owner session, RLS tag_rules_owner_all / media_tags_owner_all) ----

export type RuleActionError = RuleError | 'duplicate_rule' | 'too_many_rules' | 'not_found' | 'needs_update' | 'unexpected';
export type RuleResult = { ok: true } | { ok: false; error: RuleActionError };
/** posts = posts that get (preview) or got (apply) the tag. */
export type ApplyRulesResult = { ok: true; posts: number } | { ok: false; error: RuleActionError };

const failRule = (error: RuleActionError): { ok: false; error: RuleActionError } => ({ ok: false, error });
const ruleKeyOf = (e: DbError): RuleActionError => (isMissingTable(e) ? 'needs_update' : e?.code === '23505' ? 'duplicate_rule' : e?.code === '23503' ? 'not_found' : 'unexpected');

export async function addTagRuleAction(tagId: string, kind: string, value: string): Promise<RuleResult> {
  await requireOwner();
  if (!isUuid(tagId) || !(RULE_KINDS as readonly string[]).includes(kind)) return failRule('not_found');
  const v = normalizeRuleValue(kind as RuleKind, value);
  if (!v.ok) return failRule(v.error);
  try {
    const db = await createServerSupabase();
    const rules = await loadRules(db);
    if (rules === null) return failRule('needs_update');
    if (rules.length >= MAX_RULES) return failRule('too_many_rules');
    const { error } = await db.from('tag_rules').insert({ tag_id: tagId, kind, value: v.value });
    if (error) return failRule(ruleKeyOf(error));
    revalidatePath('/tags');
    return { ok: true };
  } catch {
    return failRule('unexpected');
  }
}

/** Deleting a rule keeps the tags it already added (rules never remove tags). */
export async function deleteTagRuleAction(ruleId: string): Promise<RuleResult> {
  await requireOwner();
  if (!isUuid(ruleId)) return failRule('not_found');
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('tag_rules').delete().eq('id', ruleId).select('id');
    if (error) return failRule(ruleKeyOf(error));
    if ((data ?? []).length === 0) return failRule('not_found');
    revalidatePath('/tags');
    return { ok: true };
  } catch {
    return failRule('unexpected');
  }
}

/** The tag's rules over every existing post: dryRun = the preview count, else the apply. */
async function runTagRules(tagId: string, dryRun: boolean): Promise<ApplyRulesResult> {
  if (!isUuid(tagId)) return failRule('not_found');
  try {
    const db = await createServerSupabase();
    const all = await loadRules(db);
    if (all === null) return failRule('needs_update');
    const rules = all.filter((r) => r.tagId === tagId.toLowerCase());
    if (rules.length === 0) return { ok: true, posts: 0 };
    const r = await applyTagRules(db, { media: await loadRuleMedia(db), rules, scope: 'all', dryRun });
    if (!dryRun && r.tags > 0) done();
    return { ok: true, posts: r.posts };
  } catch {
    return failRule('unexpected');
  }
}

export async function previewTagRulesAction(tagId: string): Promise<ApplyRulesResult> {
  await requireOwner();
  return runTagRules(tagId, true);
}

export async function applyTagRulesAction(tagId: string): Promise<ApplyRulesResult> {
  await requireOwner();
  return runTagRules(tagId, false);
}
