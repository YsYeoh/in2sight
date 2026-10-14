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
      if (/security\s+definer/i.test(m[0])) expect(m[0].split(/as\s+\$\$/i)[0], 'search_path').toMatch(/set\s+search_path\s*=/i);
    }
  });

  it('policies use (select auth.uid()) so the planner can cache it', () => {
    for (const m of all.matchAll(/create\s+policy[\s\S]*?;/gi)) expect(m[0]).not.toMatch(/(?<!select\s)auth\.uid\(\)/i);
  });

  it('privileged functions are not executable by public', () => {
    for (const fn of ['is_owner', 'claim_ownership']) {
      // anon needs its own revoke: Supabase grants it execute directly, `from public` does not cover it
      expect(all).toMatch(new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+from\\s+public\\s*,\\s*anon`, 'i'));
      expect(all).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}\\(\\)\\s+to\\s+authenticated`, 'i'));
    }
  });

  it('is_owner() enforces aal2 once a verified factor exists, so a password-only JWT cannot read via PostgREST', () => {
    const fn = all.match(/create\s+or\s+replace\s+function\s+public\.is_owner\(\)[\s\S]*?\$\$;?[\s\S]*?\$\$/i)![0];
    expect(fn).toMatch(/aal/);
    expect(fn).toContain("'aal2'");
    expect(fn).toContain('auth.mfa_factors');
    expect(fn).toMatch(/status\s*=\s*'verified'/);
  });

  it('profiles constrains every enumerated preference to the values the app accepts', () => {
    for (const v of ['en', 'zh-CN', 'D MMM YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', '24h', '12h', 'ink', 'sunset', 'forest', 'mono', 'dense', 'comfortable', 'sharp', 'soft', 'round', 'mon', 'sun'])
      expect(all, `profiles allows ${v}`).toContain(`'${v}'`);
  });
});

describe('accounts migration', () => {
  const accounts = all;

  it('creates accounts with the columns the app relies on', () => {
    for (const col of ['ig_user_id', 'username', 'display_name', 'account_type', 'profile_picture_url', 'group_name', 'status', 'archived_at', 'last_error', 'token_expires_at', 'connected_at'])
      expect(accounts, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(accounts).toMatch(/ig_user_id\s+text\s+not\s+null\s+unique/i);
    expect(accounts).toMatch(/status\s+in\s*\(\s*'active'\s*,\s*'needs_reconnect'\s*,\s*'archived'\s*\)/i);
    expect(accounts).toMatch(/char_length\(group_name\)\s+between\s+1\s+and\s+40/i);
  });

  it('account_tokens is invisible to the owner browser session: an explicit deny-all policy plus a revoke', () => {
    expect(accounts).toMatch(/create\s+policy\s+\w+\s+on\s+public\.account_tokens[^;]*using\s*\(\s*false\s*\)[^;]*with\s+check\s*\(\s*false\s*\)/i);
    expect(accounts).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.account_tokens[^;]*using\s*\(\s*true\s*\)/i);
    expect(accounts).toMatch(/revoke\s+all\s+on\s+public\.account_tokens\s+from\s+anon\s*,\s*authenticated/i);
  });

  it('the owner session can only read accounts (select policy gated on is_owner); writes go through the admin client', () => {
    expect(accounts).toMatch(/create\s+policy\s+accounts_owner_select\s+on\s+public\.accounts[^;]*for\s+select[^;]*public\.is_owner\(\)/i);
    expect(accounts).not.toMatch(/create\s+policy\s+\w+\s+on\s+public\.accounts[^;]*for\s+(all|insert|update|delete)\b/i);
  });

  it('tokens cascade away with their account', () => {
    expect(accounts).toMatch(/account_id\s+uuid\s+primary\s+key\s+references\s+public\.accounts\s*\(id\)\s+on\s+delete\s+cascade/i);
  });
});
