import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261022000001_capture_v2b.sql'), 'utf8').replace(/--.*$/gm, '');
const table = (name: string) => sql.match(new RegExp(`create\\s+table\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\r?\\n\\);`, 'i'))?.[1] ?? '';

describe('capture v2b migration', () => {
  it('is additive: no drops, no edits of existing columns', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(sql).not.toMatch(/alter\s+column/i);
  });

  it('accounts.granted_scopes, backfilled with the two original scopes (no comments scope) for existing accounts', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.accounts\s+add\s+column\s+granted_scopes\s+text\[\]\s*;/i);
    const update = sql.match(/update\s+public\.accounts[\s\S]*?;/i)?.[0] ?? '';
    expect(update).toContain("'instagram_business_basic'");
    expect(update).toContain("'instagram_business_manage_insights'");
    expect(update).not.toContain('manage_comments');
    expect(update).toMatch(/where\s+granted_scopes\s+is\s+null/i);
  });

  it('sync_state.capabilities defaults to an empty object', () => {
    expect(sql).toMatch(/add\s+column\s+capabilities\s+jsonb\s+not\s+null\s+default\s+'\{\}'::jsonb/i);
  });

  it('media_metrics gets every extra column, all nullable', () => {
    for (const c of ['swipe_forward', 'follows', 'profile_visits', 'profile_activity', 'avg_watch_ms', 'total_watch_ms', 'skip_rate']) {
      const line = sql.match(new RegExp(`add\\s+column\\s+${c}\\s+[^,;]*`, 'i'))?.[0] ?? '';
      expect(line, c).not.toBe('');
      expect(line, c).not.toMatch(/not\s+null/i);
    }
  });

  it('media gets the dropped fields and cover state with a closed status set', () => {
    for (const c of ['media_product_type', 'like_count', 'comments_count', 'is_shared_to_feed', 'children_count', 'cover_path', 'cover_status', 'cover_captured_at', 'cover_attempts', 'cover_tried_at', 'comments_synced_count'])
      expect(sql, c).toMatch(new RegExp(`add\\s+column\\s+${c}\\b`, 'i'));
    expect(sql).toMatch(/cover_status\s+text\s+not\s+null\s+default\s+'pending'\s+check\s*\(\s*cover_status\s+in\s*\(\s*'pending'\s*,\s*'ok'\s*,\s*'unavailable'\s*,\s*'failed'\s*\)\s*\)/i);
  });

  it('the covers bucket is private, size- and type-capped, and has no storage policies', () => {
    const insert = sql.match(/insert\s+into\s+storage\.buckets[\s\S]*?;/i)?.[0] ?? '';
    expect(insert).toMatch(/'covers'\s*,\s*'covers'\s*,\s*false\s*,\s*5242880/i);
    expect(insert).not.toMatch(/svg/i);
    expect(sql).not.toMatch(/on\s+storage\.objects/i);
  });

  it('comments and api_snapshots cascade with the account; snapshots dedupe on (account, endpoint, hash)', () => {
    expect(table('comments')).toMatch(/account_id\s+uuid\s+not\s+null\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('comments')).toMatch(/media_id\s+text\s+not\s+null\s+references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('api_snapshots')).toMatch(/account_id\s+uuid\s+not\s+null\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(table('api_snapshots')).toMatch(/unique\s*\(\s*account_id\s*,\s*endpoint\s*,\s*body_hash\s*\)/i);
    expect(table('media_children')).toMatch(/references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('every new table: RLS, revoked from browser roles, select granted, one owner select policy', () => {
    for (const t of ['media_children', 'comments', 'api_snapshots']) {
      expect(sql, t).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      expect(sql, t).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon\\s*,\\s*authenticated`, 'i'));
      expect(sql, t).toMatch(new RegExp(`grant\\s+select\\s+on\\s+public\\.${t}\\s+to\\s+authenticated`, 'i'));
      const policies = [...sql.matchAll(new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${t}\\b[\\s\\S]*?;`, 'gi'))].map((m) => m[0]);
      expect(policies, t).toHaveLength(1);
      expect(policies[0]).toMatch(/for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
    }
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });
});
