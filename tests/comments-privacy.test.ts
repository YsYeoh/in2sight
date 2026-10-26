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

// What counts as touching the comments table or the comment_* functions, however the name is spelled. Not a parser: it
// catches the shapes a careless or lazy edit produces (a constant, a template, a concatenation, a computed rpc name).
const SINGLE_LITERAL = /^(['"`])[^'"`$]*\1$/; // one quote pair, no interpolation, nothing after it
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const COMMENTS_TABLE = /^(['"`])comments\1$/;
/** Names declared as `const X = 'comments'` (any file): `.from(X)` is then a comments query. */
const tableAliases = (sources: string[]): Set<string> =>
  new Set(sources.flatMap((s) => [...s.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(['"`])comments\2/g)].map((m) => m[1])));
/** Does this code query the comments table (`table`) or call a comment_* function (`fn`)? */
function commentAccess(s: string, aliases: ReadonlySet<string>): { table: boolean; fn: boolean } {
  let table = false;
  for (const m of s.matchAll(/(?<!\b(?:Array|Buffer|Uint8Array))\.from\(\s*([^)]*)/g)) {
    const arg = m[1].trim().replace(/,$/, '');
    // a comments literal or alias; or anything that is not a single literal or a plain name (a concatenation, a template with ${}, a call, t.comments)
    // other plain names (storage.from(BUCKET), db.from(TABLE) of another table) are fine
    if (COMMENTS_TABLE.test(arg) || (IDENTIFIER.test(arg) && aliases.has(arg)) || (!SINGLE_LITERAL.test(arg) && !IDENTIFIER.test(arg))) table = true;
  }
  const fn = /['"`]comment_(list|fans|outsiders)['"`]/.test(s) || [...s.matchAll(/\.rpc\(\s*([^),]*)/g)].some((m) => !SINGLE_LITERAL.test(m[1].trim()));
  return { table, fn };
}
const aliases = tableAliases(src.map(([, s]) => s));

describe('comments privacy', () => {
  it("only lib/comments/read.ts (reads), lib/moderation/store.ts (moderation) and lib/sync/store.ts (the sync's writes) query the comments table", () => {
    expect(src.filter(([, s]) => commentAccess(s, aliases).table).map(([f]) => f)).toEqual(['lib/comments/read.ts', 'lib/moderation/store.ts', 'lib/sync/store.ts']);
  });

  it('only lib/comments/read.ts calls the comment_* functions', () => {
    expect(src.filter(([, s]) => commentAccess(s, aliases).fn).map(([f]) => f)).toEqual(['lib/comments/read.ts']);
  });

  it('the guard itself catches every way around a literal .from(\'comments\'): constants, templates, concatenations, computed rpc names', () => {
    const bad = [
      "db.from('comments')",
      'db.from("comments")',
      'db.from(`comments`)',
      "db.from(\n  'comments',\n)",
      "const TABLE = 'comments';\ndb.from(TABLE)",
      "const T: string = \"comments\";\ndb.from(T).select('*')",
      "db.from('com' + 'ments')",
      'db.from(`${prefix}ments`)',
      'db.from(TABLES.comments)',
      "db.from(pick('comments'))",
    ];
    for (const s of bad) expect([s, commentAccess(s, tableAliases([s])).table]).toEqual([s, true]);
    // an alias declared in another file and imported by name
    expect(commentAccess('db.from(COMMENTS_TABLE)', tableAliases(["export const COMMENTS_TABLE = 'comments';"])).table).toBe(true);
    const badFns = ["db.rpc('comment_list', {})", 'db.rpc("comment_fans")', "const F = 'comment_outsiders';", "db.rpc('comment_' + kind, {})", 'db.rpc(`comment_${kind}`, {})', 'db.rpc(fn, args)', "db.rpc(['comment_list'][0])"];
    for (const s of badFns) expect([s, commentAccess(s, new Set()).fn]).toEqual([s, true]);
  });

  it('the guard leaves other tables, other functions, storage buckets and Array.from alone', () => {
    const ok = [
      "db.from('media').select('*')",
      "const TABLE = 'follower_exports';\ndb.from(TABLE)",
      'db.storage.from(COVERS_BUCKET)',
      'db.from(table)',
      'Array.from(rows)',
      "Array.from({ length: 3 }, (_, i) => i)",
      'Buffer.from(bytes)',
      "db.rpc('post_list', { p_account: id })",
      "db.rpc('is_owner')",
    ];
    for (const s of ok) expect([s, commentAccess(s, tableAliases([s]))]).toEqual([s, { table: false, fn: false }]);
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
