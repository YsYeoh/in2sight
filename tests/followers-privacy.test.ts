import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Third-party usernames (follower snapshots, Plan 15b) are personal data: owner-only, never logged, never in another
// export, never through the admin client. These guards hold for every file that exists now and every later one.
const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, readFileSync(join(root, f), 'utf8')] as const);
/** Files that handle follower lists: lib/followers/* and everything that imports from it. */
const followerFiles = src.filter(([f, s]) => f.startsWith('lib/followers/') || /from '@\/lib\/followers\//.test(s));

describe('follower lists privacy', () => {
  it('only lib/followers/read.ts names the follower_exports table in code (comments may mention it)', () => {
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src.filter(([, s]) => /follower_exports/.test(code(s))).map(([f]) => f)).toEqual(['lib/followers/read.ts']);
  });

  it('no file that handles follower lists logs anything but one fixed string', () => {
    expect(followerFiles.length).toBeGreaterThanOrEqual(5);
    for (const [f, s] of followerFiles) {
      expect(s, f).not.toMatch(/console\.(log|info|warn|debug|trace|dir|table)\s*\(/);
      for (const m of s.matchAll(/console\.error\s*\(([^)]*)\)/g)) expect(m[1], f).toMatch(/^'[^'`$]*'$/);
    }
  });

  it('never through the admin client', () => {
    for (const [f, s] of followerFiles) expect(s, f).not.toMatch(/lib\/supabase\/admin|createAdminSupabase|account_tokens/);
  });

  it('the account exports (Excel workbook, PDF report) and the sync never touch follower lists', () => {
    for (const [f, s] of src)
      if (/^lib\/(export\/(read|workbook|report|pdf)|sync\/|alerts\/|push\/)/.test(f) || f.startsWith('app/api/cron/')) expect(s, f).not.toMatch(/lib\/followers\//);
  });
});
