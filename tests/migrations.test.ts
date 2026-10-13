import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const sql = files.map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, '') }));
const all = sql.map((s) => s.text).join('\n');

describe('migrations', () => {
  it('are timestamp-named and sorted', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('every public table has RLS enabled and at least one policy', () => {
    const tables = [...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(all, `RLS on public.${t}`).toMatch(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      expect(all, `a policy on public.${t}`).toMatch(new RegExp(`create\\s+policy\\s+\\w+\\s+on\\s+public\\.${t}\\b`, 'i'));
    }
  });

  it('no policy is granted to anon or public', () => {
    for (const m of all.matchAll(/create\s+policy[\s\S]*?;/gi)) {
      expect(m[0], m[0].slice(0, 80)).not.toMatch(/\bto\s+(anon|public)\b/i);
      expect(m[0], m[0].slice(0, 80)).toMatch(/\bto\s+authenticated\b/i);
    }
  });

  it('every security definer function pins search_path', () => {
    for (const m of all.matchAll(/create\s+(?:or\s+replace\s+)?function[\s\S]*?(?=create\s|$)/gi)) {
      if (/security\s+definer/i.test(m[0])) expect(m[0].slice(0, 120), 'search_path').toMatch(/set\s+search_path\s*=/i);
    }
  });

  it('policies use (select auth.uid()) so the planner can cache it', () => {
    for (const m of all.matchAll(/create\s+policy[\s\S]*?;/gi)) expect(m[0]).not.toMatch(/(?<!select\s)auth\.uid\(\)/i);
  });

  it('privileged functions are not executable by public', () => {
    for (const fn of ['is_owner', 'claim_ownership']) {
      expect(all).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+from\\s+public`, 'i'));
      expect(all).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+to\\s+authenticated`, 'i'));
    }
  });

  it('profiles constrains every enumerated preference to the values the app accepts', () => {
    for (const v of ['en', 'zh-CN', 'D MMM YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', '24h', '12h', 'ink', 'sunset', 'forest', 'mono', 'dense', 'comfortable', 'sharp', 'soft', 'round', 'mon', 'sun'])
      expect(all, `profiles allows ${v}`).toContain(`'${v}'`);
  });
});
