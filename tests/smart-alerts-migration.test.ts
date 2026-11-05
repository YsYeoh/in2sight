import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261104000001_smart_alerts.sql'), 'utf8').replace(/--.*$/gm, '');

describe('smart alerts migration (Plan 17e)', () => {
  it('only replaces the notifications kind check: no table, policy, grant, function or data change', () => {
    const heads = sql.split(';').map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+/).slice(0, 4).join(' ').toLowerCase());
    expect(heads).toEqual(['alter table public.notifications drop', 'alter table public.notifications add']);
    expect(sql).not.toMatch(/\b(create|grant|revoke|policy|insert|update|delete|truncate|security\s+definer)\b/i);
  });

  it('the six existing kinds plus the four of Plan 17e, in this order (tests/alert-settings.test.ts keeps ALERT_KINDS equal to it)', () => {
    expect(sql).toMatch(/alter\s+table\s+public\.notifications\s+drop\s+constraint\s+notifications_kind_check/i);
    const list = sql.match(/add\s+constraint\s+notifications_kind_check\s+check\s*\(\s*kind\s+in\s*\(([^)]*)\)\s*\)/i)?.[1] ?? '';
    expect(list.split(',').map((s) => s.trim().replace(/^'|'$/g, ''))).toEqual(['token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest']);
  });
});
