import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261015000001_sync.sql'), 'utf8').replace(/--.*$/gm, '');
const TABLES = ['account_daily', 'media', 'media_metrics', 'audience_snapshots', 'online_followers', 'sync_state', 'sync_runs'];
const tableBody = (t: string) => sql.match(new RegExp('create\\s+table\\s+public\\.' + t + '\\s*\\(([\\s\\S]*?)\\r?\\n\\);', 'i'))?.[1] ?? '';
const policies = (t: string) => [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]).filter((p) => new RegExp('\\son\\s+public\\.' + t + '\\s', 'i').test(p));

describe('sync migration', () => {
  it.each(TABLES)('%s: RLS on, one owner-only select policy, no write policy', (t) => {
    expect(tableBody(t), `create table ${t}`).not.toBe('');
    expect(sql).toMatch(new RegExp('alter\\s+table\\s+public\\.' + t + '\\s+enable\\s+row\\s+level\\s+security', 'i'));
    const ps = policies(t);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatch(/for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  it('keys snapshots so re-runs upsert instead of duplicating', () => {
    expect(tableBody('account_daily')).toMatch(/primary\s+key\s*\(\s*account_id\s*,\s*day\s*\)/i);
    expect(tableBody('media_metrics')).toMatch(/primary\s+key\s*\(\s*media_id\s*,\s*captured_at\s*\)/i);
    expect(tableBody('audience_snapshots')).toMatch(/primary\s+key\s*\(\s*account_id\s*,\s*day\s*,\s*kind\s*\)/i);
    expect(tableBody('online_followers')).toMatch(/primary\s+key\s*\(\s*account_id\s*,\s*day\s*\)/i);
  });

  it.each(['account_daily', 'media', 'audience_snapshots', 'online_followers', 'sync_state'])('%s cascades away with its account', (t) => {
    expect(tableBody(t)).toMatch(/references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('media_metrics cascades away with its media', () => {
    expect(tableBody('media_metrics')).toMatch(/media_id\s+text\s+not\s+null\s+references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
  });

  it('constrains media types, audience kinds and run triggers to what the sync writes', () => {
    expect(tableBody('media')).toMatch(/media_type\s+in\s*\(\s*'IMAGE'\s*,\s*'CAROUSEL_ALBUM'\s*,\s*'REELS'\s*,\s*'STORY'\s*\)/);
    expect(tableBody('audience_snapshots')).toMatch(/kind\s+in\s*\(\s*'age_gender'\s*,\s*'country'\s*,\s*'city'\s*\)/);
    expect(tableBody('sync_runs')).toMatch(/trigger\s+in\s*\(\s*'cron'\s*,\s*'manual'\s*\)/);
  });

  it('carries the columns the sync code reads and writes', () => {
    const cols: Record<string, string[]> = {
      account_daily: ['followers', 'reach', 'views', 'profile_views', 'accounts_engaged', 'total_interactions', 'follows', 'unfollows', 'link_taps'],
      media: ['account_id', 'media_type', 'permalink', 'caption', 'posted_at', 'expires_at', 'last_metrics_at', 'gone_at'],
      media_metrics: ['reach', 'views', 'likes', 'comments', 'shares', 'saves', 'total_interactions', 'replies', 'taps_forward', 'taps_back', 'exits'],
      sync_state: ['lease_id', 'lease_until', 'last_attempt_at', 'last_success_at', 'consecutive_failures', 'last_error_key', 'daily_done_through', 'last_run'],
    };
    for (const [t, list] of Object.entries(cols)) for (const c of list) expect(tableBody(t), `${t}.${c}`).toMatch(new RegExp('(^|\\n)\\s*' + c + '\\s'));
  });
});
