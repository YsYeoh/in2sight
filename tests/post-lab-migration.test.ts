import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261026000001_post_lab.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = { post_lab_latest: 'text[]', post_lab_points: 'text[], int[], int[]' };
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');

describe('post lab migration', () => {
  it('is additive: two functions, no tables, no policy or column changes, never account_tokens', () => {
    expect(sql).not.toMatch(/\b(drop|alter|create\s+table|create\s+policy|insert|update|delete)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect([...sql.matchAll(/create\s+or\s+replace\s+function/gi)]).toHaveLength(2);
  });

  it.each(Object.keys(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const [, head, body] = m!;
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).not.toMatch(/security\s+definer/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\|\|/i); // nothing is ever spliced into SQL text
    expect(body).toMatch(/media_id\s*=\s*any\s*\(p_ids\)|m\.id\s*=\s*any\s*\(p_ids\)/i); // only the asked media
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('latest: the newest non-null value of every metric column, so a snapshot without extras never hides older ones', () => {
    const body = fn('post_lab_latest')![2];
    for (const col of ['reach', 'views', 'likes', 'comments', 'saves', 'shares', 'total_interactions', 'replies', 'taps_forward', 'taps_back', 'exits', 'swipe_forward', 'follows', 'profile_visits', 'profile_activity', 'avg_watch_ms', 'total_watch_ms', 'skip_rate'])
      expect(body, col).toMatch(new RegExp(`\\(array_agg\\(x\\.${col}\\s+order\\s+by\\s+x\\.captured_at\\s+desc\\)\\s+filter\\s+\\(where\\s+x\\.${col}\\s+is\\s+not\\s+null\\)\\)\\[1\\]`, 'i'));
    expect(body).toMatch(/group\s+by\s+x\.media_id/i);
  });

  it('points: the nearest snapshot inside each mark’s tolerance window, never interpolated', () => {
    const body = fn('post_lab_points')![2];
    expect(body).toMatch(/distinct\s+on\s*\(x\.media_id,\s*k\.mark\)/i);
    expect(body).toMatch(/unnest\(p_marks,\s*p_tols\)\s+as\s+k\(mark,\s*tol\)/i);
    expect(body).toMatch(/abs\(extract\(epoch\s+from\s+x\.captured_at\s+-\s+m\.posted_at\)\s*\/\s*60\s*-\s*k\.mark\)\s*<=\s*k\.tol/i);
    expect(body).toMatch(/order\s+by\s+x\.media_id,\s*k\.mark,\s*abs\(/i);
  });
});
