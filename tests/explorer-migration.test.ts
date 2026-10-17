import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261024000001_explorer.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = {
  explorer_daily: 'uuid[], date, date, text, text, text',
  explorer_media: 'uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int',
  explorer_posts: 'uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text',
  explorer_followers: 'uuid, timestamptz, timestamptz, text, boolean',
};
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');

describe('explorer migration', () => {
  it('is additive: no drops, no column edits, no other tables touched except the policy rewrite', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|function|policy)\b/i);
    expect(sql).not.toMatch(/alter\s+column/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it.each(Object.entries(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const head = m![1];
    const body = m![2];
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).not.toMatch(/security\s+definer/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\|\|/i); // nothing is ever spliced into SQL text
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('the week/month bucket rule is identical in the daily and the posts rollup (inline on purpose: a helper cannot be inlined)', () => {
    const week = /when\s+'week'\s+then\s+(\w+\.\w+)\s+-\s+\(\(extract\(dow\s+from\s+\1\)::int\s+-\s+case\s+when\s+p_week_start\s+=\s+'sun'\s+then\s+0\s+else\s+1\s+end\s+\+\s+7\)\s+%\s+7\)/i;
    const month = /when\s+'month'\s+then\s+date_trunc\('month',\s+\w+\.\w+::timestamp\)::date/i;
    for (const name of ['explorer_daily', 'explorer_posts']) {
      expect(fn(name)![2], name).toMatch(week);
      expect(fn(name)![2], name).toMatch(month);
    }
  });

  it('a NULL boolean filter means "no filter", never a silent filter: p_stories and p_untagged are coalesced', () => {
    const body = fn('explorer_media')![2];
    expect(body).toMatch(/not\s+coalesce\(p_untagged,\s*false\)/i);
    expect(body).toMatch(/coalesce\(p_stories,\s*false\)/i);
    expect(body).not.toMatch(/\bnot\s+p_untagged\b|\(p_stories\s+or\b/i);
  });

  it('Stories are opt-in and never part of the engagement-rate parts; the latest snapshot is used', () => {
    expect(fn('explorer_media')![2]).toMatch(/\(coalesce\(p_stories,\s*false\)\s+or\s+m\.media_type\s+<>\s+'STORY'\)/i);
    expect(fn('explorer_media')![2]).toMatch(/order\s+by\s+x\.captured_at\s+desc\s+limit\s+1/i);
    const parts = fn('explorer_posts')![2].match(/filter\s*\(where\s+k\.reach\s+>\s+0\s+and\s+k\.media_type\s+<>\s+'STORY'\)/gi) ?? [];
    expect(parts).toHaveLength(2);
  });

  it('rewrites the read policies the rollups hit so is_owner() is evaluated once per statement (same predicate)', () => {
    for (const [policy, table] of [
      ['account_daily_owner_select', 'account_daily'],
      ['media_owner_select', 'media'],
      ['media_metrics_owner_select', 'media_metrics'],
      ['follower_snapshots_owner_select', 'follower_snapshots'],
    ])
      expect(sql).toMatch(new RegExp(`alter\\s+policy\\s+${policy}\\s+on\\s+public\\.${table}\\s+using\\s*\\(\\s*\\(\\s*select\\s+public\\.is_owner\\(\\)\\s*\\)\\s*\\)\\s*;`, 'i'));
    expect(sql).toMatch(/alter\s+policy\s+media_tags_owner_all\s+on\s+public\.media_tags\s+using\s*\(\s*\(\s*select\s+public\.is_owner\(\)\s*\)\s*\)\s+with\s+check\s*\(\s*\(\s*select\s+public\.is_owner\(\)\s*\)\s*\)\s*;/i);
    for (const m of sql.matchAll(/alter\s+policy[\s\S]*?;/gi)) expect(m[0]).not.toMatch(/\btrue\b|auth\.uid/i);
  });

  it('explorer_views: owner-authored, one for-all is_owner() policy, bounded name and state, unique name ignoring case', () => {
    const body = sql.match(/create\s+table\s+public\.explorer_views\s*\(([\s\S]*?)\r?\n\);/i)?.[1] ?? '';
    expect(body).toMatch(/name\s+text\s+not\s+null\s+check\s*\(\s*char_length\(name\)\s+between\s+1\s+and\s+60\s+and\s+name\s*=\s*btrim\(name\)\s*\)/i);
    expect(body).toMatch(/state\s+jsonb\s+not\s+null\s+check\s*\(\s*jsonb_typeof\(state\)\s*=\s*'object'\s+and\s+octet_length\(state::text\)\s*<=\s*2048\s*\)/i);
    expect(sql).toMatch(/create\s+unique\s+index\s+\w+\s+on\s+public\.explorer_views\s*\(\s*lower\(name\)\s*\)/i);
    expect(sql).toMatch(/alter\s+table\s+public\.explorer_views\s+enable\s+row\s+level\s+security/i);
    const policies = [...sql.matchAll(/create\s+policy[\s\S]*?;/gi)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/on\s+public\.explorer_views\s+for\s+all\s+to\s+authenticated\s+using\s*\(\s*public\.is_owner\(\)\s*\)\s+with\s+check\s*\(\s*public\.is_owner\(\)\s*\)/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.explorer_views\s+from\s+anon/i);
  });
});
