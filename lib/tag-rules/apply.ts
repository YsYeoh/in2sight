import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_RULES, pairKey, planAutoTags, RULE_KINDS, type RuleKind, type RuleMedia, type TagRule } from '@/lib/tag-rules/rules';

// Auto-tagging reads and the one write (Plan 17c). Takes whichever client the caller has: the OWNER session on the Tags
// page (RLS), the ADMIN client in the sync (lib/sync/store.ts autoTag). Writes only INSERT ... ON CONFLICT DO NOTHING
// into media_tags with source 'auto': a tag already on a post is never touched, nothing is ever deleted, and the
// database trigger media_tags_skip_rejected refuses a pair the owner removed even if this read missed it.
// Never logs; errors are fixed messages (never the Supabase text, which can echo values).

type Row = Record<string, unknown>;
/** Ids per `in` filter: 100 posts x at most 10 tags stays at PostgREST's 1,000-row cap (lesson from Plan 15d). */
const CHUNK = 100;
const PAGE = 1000; // PostgREST's row cap: a shorter page is the last one
const RULE_MEDIA_MAX = 20_000; // ponytail: "Apply to existing posts" reads at most 20,000 posts; past that, page per account
const MISSING_TABLE: readonly string[] = ['PGRST205', '42P01']; // = lib/followers/read.ts MISSING_TABLE (not imported: that module is the follower-data choke point)

const chunks = <T>(a: readonly T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** True when the error means "the 17c tables are not there yet" (PostgREST / Postgres "table not found"). */
export const isMissingTable = (e: unknown): boolean => MISSING_TABLE.includes(String((e as { code?: unknown } | null)?.code));

/** Every rule, oldest first. null = the migration 20261102000001 is not applied yet: auto-tagging is off. */
export async function loadRules(db: SupabaseClient): Promise<TagRule[] | null> {
  const { data, error } = await db.from('tag_rules').select('id,tag_id,kind,value,created_at').order('created_at', { ascending: true }).limit(MAX_RULES);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error('tag rules: read failed');
  }
  return ((data ?? []) as Row[])
    .filter((r) => (RULE_KINDS as readonly string[]).includes(String(r.kind)))
    .map((r) => ({ id: String(r.id), tagId: String(r.tag_id), kind: r.kind as RuleKind, value: String(r.value), createdAt: String(r.created_at) }));
}

/** Every feed post and Reel of every account (Stories never), in ordered 1,000-row pages (owner's Apply to existing posts). */
export async function loadRuleMedia(db: SupabaseClient): Promise<RuleMedia[]> {
  const out: RuleMedia[] = [];
  for (let from = 0; from < RULE_MEDIA_MAX; from += PAGE) {
    const { data, error } = await db.from('media').select('id,caption,media_type,posted_at').neq('media_type', 'STORY').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error('tag rules: media read failed');
    const rows = (data ?? []) as Row[];
    for (const r of rows) out.push({ id: String(r.id), caption: typeof r.caption === 'string' ? r.caption : null, kind: String(r.media_type), postedAt: String(r.posted_at) });
    if (rows.length < PAGE) break;
  }
  return out;
}

async function pairsOf(db: SupabaseClient, table: 'media_tags' | 'media_tag_rejections', ids: string[]): Promise<Row[]> {
  const { data, error } = await db.from(table).select('media_id,tag_id').in('media_id', ids);
  if (error) throw new Error(`tag rules: ${table} read failed`);
  return (data ?? []) as Row[];
}

export interface ApplyResult {
  posts: number; // posts that get at least one tag
  tags: number; // (post, tag) pairs added
}

/**
 * Adds the tags the rules call for. dryRun: counts only (the preview). Reads tags and rejections only for the posts a
 * rule matches, by id. Idempotent: a second run adds nothing.
 */
export async function applyTagRules(db: SupabaseClient, o: { media: readonly RuleMedia[]; rules: readonly TagRule[]; scope: 'new' | 'all'; dryRun: boolean }): Promise<ApplyResult> {
  const candidates = planAutoTags({ media: o.media, rules: o.rules, existing: new Map(), rejected: new Set(), scope: o.scope });
  const ids = [...new Set(candidates.map((c) => c.mediaId))];
  if (ids.length === 0) return { posts: 0, tags: 0 };
  const existing = new Map<string, Set<string>>();
  const rejected = new Set<string>();
  for (const part of chunks(ids)) {
    for (const r of await pairsOf(db, 'media_tags', part)) {
      const id = String(r.media_id);
      existing.set(id, (existing.get(id) ?? new Set()).add(String(r.tag_id)));
    }
    for (const r of await pairsOf(db, 'media_tag_rejections', part)) rejected.add(pairKey(String(r.media_id), String(r.tag_id)));
  }
  const byId = new Set(ids);
  const add = planAutoTags({ media: o.media.filter((m) => byId.has(m.id)), rules: o.rules, existing, rejected, scope: o.scope });
  if (!o.dryRun) {
    for (const part of chunks(add, 500)) {
      const { error } = await db.from('media_tags').upsert(part.map((a) => ({ media_id: a.mediaId, tag_id: a.tagId, source: 'auto' })), { onConflict: 'media_id,tag_id', ignoreDuplicates: true });
      if (error) throw new Error('tag rules: media_tags write failed');
    }
  }
  return { posts: new Set(add.map((a) => a.mediaId)).size, tags: add.length };
}
