import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261017000001_tags.sql'), 'utf8').replace(/--.*$/gm, '');
const tableBody = (t: string) => sql.match(new RegExp('create\\s+table\\s+public\\.' + t + '\\s*\\(([\\s\\S]*?)\\r?\\n\\);', 'i'))?.[1] ?? '';
const policies = (t: string) => [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]).filter((p) => new RegExp('\\son\\s+public\\.' + t + '\\s', 'i').test(p));

describe('tags migration', () => {
  it.each(['tags', 'media_tags'])('%s: RLS on, one owner-only policy for every action (using + with check)', (t) => {
    expect(tableBody(t), `create table ${t}`).not.toBe('');
    expect(sql).toMatch(new RegExp('alter\\s+table\\s+public\\.' + t + '\\s+enable\\s+row\\s+level\\s+security', 'i'));
    const ps = policies(t);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatch(/for\s+all\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)\s+with\s+check\s*\(\s*public\.is_owner\(\)\s*\)/i);
  });

  it('tag names: 1-40 characters, trimmed, unique ignoring case', () => {
    expect(tableBody('tags')).toMatch(/char_length\(name\)\s+between\s+1\s+and\s+40/i);
    expect(tableBody('tags')).toMatch(/name\s*=\s*btrim\(name\)/i);
    expect(sql).toMatch(/create\s+unique\s+index\s+\w+\s+on\s+public\.tags\s*\(\s*lower\(name\)\s*\)/i);
  });

  it('colours are chart tokens, never raw colours', () => {
    expect(tableBody('tags')).toMatch(/color\s+in\s*\(\s*'chart-1'\s*,\s*'chart-2'\s*,\s*'chart-3'\s*,\s*'chart-4'\s*,\s*'chart-5'\s*,\s*'chart-6'\s*\)/i);
  });

  it('media_tags: one row per (media, tag), cascades with either side, indexed by tag', () => {
    const body = tableBody('media_tags');
    expect(body).toMatch(/primary\s+key\s*\(\s*media_id\s*,\s*tag_id\s*\)/i);
    expect(body).toMatch(/media_id\s+text\s+not\s+null\s+references\s+public\.media\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(body).toMatch(/tag_id\s+uuid\s+not\s+null\s+references\s+public\.tags\s*\(id\)\s+on\s+delete\s+cascade/i);
    expect(sql).toMatch(/create\s+index\s+\w+\s+on\s+public\.media_tags\s*\(\s*tag_id\s*\)/i);
  });

  it('never grants anything to anon/public and never touches account_tokens', () => {
    expect(sql).not.toMatch(/\bto\s+(anon|public)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });
});
