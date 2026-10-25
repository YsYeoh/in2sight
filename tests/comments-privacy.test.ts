import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Commenter usernames and comment texts (Plan 11b ingest, Plan 15c insights) are third-party personal data: owner-only,
// never logged, never through the admin client outside the sync, never in another export. These guards hold for every
// file that exists now and every later one (Plan 15d's moderation files included).
const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, code(readFileSync(join(root, f), 'utf8'))] as const);
/** Files that handle comments: lib/comments/* and everything that imports from it. */
const commentFiles = src.filter(([f, s]) => f.startsWith('lib/comments/') || /from '@\/lib\/comments\//.test(s));

describe('comments privacy', () => {
  it("only lib/comments/read.ts (reads) and lib/sync/store.ts (the sync's writes) query the comments table", () => {
    expect(src.filter(([, s]) => /\.from\(\s*['"]comments['"]\s*\)/.test(s)).map(([f]) => f)).toEqual(['lib/comments/read.ts', 'lib/sync/store.ts']);
  });

  it('only lib/comments/read.ts calls the comment_* functions', () => {
    expect(src.filter(([, s]) => /['"]comment_(list|fans|outsiders)['"]/.test(s)).map(([f]) => f)).toEqual(['lib/comments/read.ts']);
  });

  it('no file that handles comments logs anything but one fixed string', () => {
    expect(commentFiles.length).toBeGreaterThanOrEqual(5);
    for (const [f, s] of commentFiles) {
      expect(s, f).not.toMatch(/console\.(log|info|warn|debug|trace|dir|table)\s*\(/);
      for (const m of s.matchAll(/console\.error\s*\(([^)]*)\)/g)) expect(m[1], f).toMatch(/^'[^'`$]*'$/);
    }
  });

  it('reads and UI never use the admin client or account_tokens; nothing renders comment text as HTML', () => {
    // a server-only moderation module (Plan 15d) may need the token; the readers and every component never do
    for (const [f, s] of commentFiles) {
      if (f.startsWith('lib/comments/') || f.startsWith('components/')) expect(s, f).not.toMatch(/lib\/supabase\/admin|createAdminSupabase|account_tokens/);
      expect(s, f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it('the account exports (Excel workbook, PDF report), the sync, alerts and push never touch comment insights', () => {
    for (const [f, s] of src)
      if (/^lib\/(export\/|sync\/|alerts\/|push\/)/.test(f) || f.startsWith('app/api/cron/') || f.startsWith('app/api/export/')) expect(s, f).not.toMatch(/lib\/comments\//);
  });
});
