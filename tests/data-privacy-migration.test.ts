import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261031000001_data_privacy.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const fn = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';

describe('data & privacy migration', () => {
  it('two functions and their grants, nothing else: no table, no policy change, no drop', () => {
    const heads = sql
      .replace(/\$\$[\s\S]*?\$\$/g, '$$body$$') // function bodies hold their own semicolons
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create or', 'revoke execute', 'grant execute', 'create or', 'revoke execute', 'grant execute']);
    expect(sql).not.toMatch(/\b(drop|truncate|alter|create\s+table|create\s+policy)\b/i);
  });

  it('data_usage: security definer with an empty search_path, owner check first, read-only, no dynamic SQL', () => {
    const f = fn('data_usage');
    expect(f).toMatch(exact('returns table (kind text, label text, row_count bigint, bytes bigint)'));
    expect(f).toMatch(/\bstable\b/i);
    expect(f).toMatch(exact('security definer'));
    expect(f).toMatch(exact("set search_path = ''"));
    expect(f.indexOf('if not public.is_owner() then')).toBeGreaterThan(-1);
    expect(f.indexOf('if not public.is_owner() then')).toBeLessThan(f.indexOf('return query'));
    expect(f).not.toMatch(/\b(execute|format)\s*\(|\bexecute\s+'|\b(insert|update|delete)\b/i);
    expect(f).toMatch(/pg_catalog\.pg_total_relation_size\(c\.oid\)/);
    expect(f).toMatch(/c\.reltuples/); // an estimate, never count(*) over a table
    expect(f).not.toMatch(/account_tokens/);
    expect(f).toMatch(exact("where o.bucket_id = 'covers'"));
  });

  it('data_usage lists every owner-data table by name (and exactly these)', () => {
    const list = fn('data_usage').match(/array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? '';
    const names = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual(
      [
        'accounts', 'account_daily', 'account_daily_breakdown', 'audience_snapshots', 'online_followers', 'follower_snapshots', 'api_snapshots', 'media', 'media_metrics', 'media_children',
        'comments', 'moderation_settings', 'moderation_rules', 'moderation_log', 'follower_exports', 'tags', 'media_tags', 'explorer_views', 'notifications', 'push_subscriptions',
        'profiles', 'sync_state', 'sync_progress', 'sync_runs',
      ].sort(),
    );
  });

  it('data_usage: anon and public cannot execute it, the owner session can', () => {
    expect(sql).toMatch(exact('revoke execute on function public.data_usage() from public, anon'));
    expect(sql).toMatch(exact('grant execute on function public.data_usage() to authenticated'));
  });

  it('delete_all_data: security invoker, executable by service_role ONLY (the browser session cannot call it)', () => {
    const f = fn('delete_all_data');
    expect(f).toMatch(exact('security invoker'));
    expect(f).toMatch(exact("set search_path = ''"));
    expect(sql).toMatch(exact('revoke execute on function public.delete_all_data() from public, anon, authenticated'));
    expect(sql).toMatch(exact('grant execute on function public.delete_all_data() to service_role'));
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.delete_all_data\(\)\s+to\s+(authenticated|anon|public)/i);
  });

  it('delete_all_data deletes accounts (cascade) and the account-less owner rows, each with an explicit where (pg-safeupdate), and keeps the login', () => {
    const f = fn('delete_all_data');
    const deletes = [...f.matchAll(/delete from public\.(\w+) where true;/g)].map((m) => m[1]);
    expect(deletes).toEqual(['accounts', 'tags', 'explorer_views', 'notifications', 'sync_runs']);
    expect(f.match(/\bdelete\b/gi)).toHaveLength(deletes.length);
    expect(f).not.toMatch(/profiles|owners|push_subscriptions|auth\.|storage\./);
  });
});
