import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261018000001_alerts.sql'), 'utf8').replace(/--.*$/gm, '');
const tableBody = (t: string) => sql.match(new RegExp('create\\s+table\\s+public\\.' + t + '\\s*\\(([\\s\\S]*?)\\r?\\n\\);', 'i'))?.[1] ?? '';
const policies = (t: string) => [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]).filter((p) => new RegExp('\\son\\s+public\\.' + t + '\\s', 'i').test(p));

describe('alerts migration', () => {
  it.each(['notifications', 'push_subscriptions'])('%s: RLS on, every policy owner-only and to authenticated', (t) => {
    expect(tableBody(t), `create table ${t}`).not.toBe('');
    expect(sql).toMatch(new RegExp('alter\\s+table\\s+public\\.' + t + '\\s+enable\\s+row\\s+level\\s+security', 'i'));
    const ps = policies(t);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p).toMatch(/to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)/i);
      if (/for\s+(all|update|insert)/i.test(p)) expect(p).toMatch(/with\s+check\s*\(\s*public\.is_owner\(\)\s*\)/i);
    }
  });

  it('notifications: the owner can read and mark read, nothing else (inserts come from the admin client)', () => {
    const ps = policies('notifications');
    expect(ps.map((p) => p.match(/for\s+(\w+)/i)?.[1].toLowerCase()).sort()).toEqual(['select', 'update']);
    expect(sql).toMatch(/revoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+public\.notifications\s+from\s+anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+update\s*\(\s*read_at\s*\)\s+on\s+public\.notifications\s+to\s+authenticated/i);
  });

  it('notifications: dedupe_key is unique, kinds and severities are constrained, account delete cascades', () => {
    const body = tableBody('notifications');
    expect(body).toMatch(/dedupe_key\s+text\s+not\s+null\s+unique/i);
    expect(body).toMatch(/kind\s+in\s*\(\s*'token_expiring'\s*,\s*'needs_reconnect'\s*,\s*'sync_failing'\s*,\s*'reach_drop'\s*,\s*'taking_off'\s*\)/i);
    expect(body).toMatch(/severity\s+in\s*\(\s*'info'\s*,\s*'warning'\s*,\s*'critical'\s*\)/i);
    expect(body).toMatch(/account_id\s+uuid\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
    for (const c of ['payload', 'created_at', 'read_at']) expect(body).toMatch(new RegExp('(^|\\n)\\s*' + c + '\\s'));
  });

  it('push_subscriptions: https endpoints only, unique, bounded; anon has no access', () => {
    const body = tableBody('push_subscriptions');
    expect(body).toMatch(/endpoint\s+text\s+not\s+null\s+unique/i);
    expect(body).toMatch(/endpoint\s+like\s+'https:\/\/%'/i);
    expect(body).toMatch(/char_length\(endpoint\)\s*<=\s*1024/i);
    expect(body).toMatch(/keys\s+jsonb\s+not\s+null/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.push_subscriptions\s+from\s+anon/i);
  });
});
