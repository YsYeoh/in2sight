import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261021000001_sync_progress.sql'), 'utf8').replace(/--.*$/gm, '');
const body = sql.match(/create\s+table\s+public\.sync_progress\s*\(([\s\S]*?)\r?\n\);/i)?.[1] ?? '';

describe('sync progress migration', () => {
  it('adds the backward edge to sync_state without touching the forward edge', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.sync_state\s+add\s+column\s+backfilled_from\s+date\s*;/i);
    expect(sql).not.toMatch(/drop\s+column/i);
  });

  it('marks accounts synced before this plan as complete (oldest stored day, backfill stamped) and nothing else', () => {
    const update = sql.match(/update\s+public\.sync_state[\s\S]*?;/i)?.[0] ?? '';
    expect(update).toMatch(/min\(d\.day\)\s+from\s+public\.account_daily/i);
    expect(update).toMatch(/'backfill'/);
    expect(update).toMatch(/where\s+s\.daily_done_through\s+is\s+not\s+null/i);
  });

  it('sync_progress: one row per account, cascades with it, every stage the sync writes (and the reserved covers/comments) is allowed', () => {
    expect(body).toMatch(/account_id\s+uuid\s+primary\s+key\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    for (const s of ['profile', 'stories', 'account_days', 'posts_list', 'post_metrics', 'audience', 'covers', 'comments']) expect(body, s).toContain(`'${s}'`);
    expect(body).toMatch(/state\s+in\s*\(\s*'waiting'\s*,\s*'running'\s*,\s*'failed'\s*,\s*'done'\s*\)/i);
    expect(body).not.toMatch(/token|caption|media_id/i);
  });

  it('owner session reads only: RLS, revoked from anon/authenticated, select granted, one select policy on is_owner()', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.sync_progress\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.sync_progress\s+from\s+anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.sync_progress\s+to\s+authenticated/i);
    const policies = [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on\s+public\.sync_progress\s+for\s+select\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });
});
