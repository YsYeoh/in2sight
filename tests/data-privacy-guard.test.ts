// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Plan 16c: the Data & privacy files never log, the export never touches the service role (so account_tokens is out of
// reach by privilege), only the delete action uses it and only after requireOwner + the password check, and nothing
// reachable by a GET can delete.
const root = process.cwd();
const src = (f: string) => readFileSync(join(root, f), 'utf8');
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''); // comments may name what is excluded

const NAMED = [
  'lib/data/export.ts',
  'lib/data/usage.ts',
  'lib/data/delete.ts',
  'app/api/export/data/route.ts',
  'app/(app)/settings/data-actions.ts',
  'components/settings/DataExport.tsx',
  'components/settings/DeleteAllData.tsx',
  'components/settings/sections/DataSection.tsx',
];
const EXPORT_SIDE = ['lib/data/export.ts', 'lib/data/usage.ts', 'app/api/export/data/route.ts', 'components/settings/DataExport.tsx', 'components/settings/sections/DataSection.tsx'];

function walk(dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .map((p) => `${dir}/${p.replace(/\\/g, '/')}`)
    .filter((f) => /\.tsx?$/.test(f));
}
const FILES = [...new Set([...NAMED, ...walk('lib/data')])];
const ADMIN = /createAdminSupabase|supabase\/admin|SECRET_KEY|service_role|serviceRole/;

describe('data & privacy guard (Plan 16c)', () => {
  it('the guard really scans the files', () => {
    for (const f of NAMED) expect(existsSync(join(root, f)), f).toBe(true);
  });

  it.each(FILES)('%s: no logging', (f) => {
    expect(src(f)).not.toMatch(/\bconsole\b|\blogger\b|process\.std(out|err)/);
  });

  it.each(EXPORT_SIDE)('%s: no service-role client, also not through an imported module', (f) => {
    expect(src(f)).not.toMatch(ADMIN);
    for (const m of src(f).matchAll(/from '@\/([^']+)'/g)) {
      if (m[1] === 'app/(app)/settings/data-actions') continue; // the section passes the action to a client component; it is checked below
      const target = ['.ts', '.tsx', '/index.ts'].map((e) => `${m[1]}${e}`).find((p) => existsSync(join(root, p)));
      if (target) expect(src(target), `${f} -> ${target}`).not.toMatch(/createAdminSupabase|supabase\/admin|service_role/);
    }
  });

  it('the export code never names the token or push tables (outside comments)', () => {
    for (const f of EXPORT_SIDE) expect(code(f), f).not.toMatch(/account_tokens|push_subscriptions|access_token/);
  });

  it('the service role appears only in the delete action; lib/data/delete.ts receives the client as a parameter', () => {
    const users = [...walk('lib'), ...walk('app'), ...walk('components')].filter((f) => /createAdminSupabase/.test(src(f)) && /data/.test(f));
    expect(users).toEqual(['app/(app)/settings/data-actions.ts']);
    expect(src('lib/data/delete.ts')).not.toMatch(ADMIN);
  });

  it('delete_all_data is called from lib/data/delete.ts only, and deleteAllData only from the server action', () => {
    const all = [...walk('lib'), ...walk('app'), ...walk('components')];
    expect(all.filter((f) => /delete_all_data/.test(code(f)))).toEqual(['lib/data/delete.ts']);
    expect(all.filter((f) => /\bdeleteAllData\(/.test(code(f))).sort()).toEqual(['app/(app)/settings/data-actions.ts', 'lib/data/delete.ts']);
  });

  it('every exported action authorizes first, then the phrase, the password, and only then the delete', () => {
    const f = 'app/(app)/settings/data-actions.ts';
    const s = src(f);
    expect(s.startsWith("'use server';")).toBe(true);
    const lines = s.split(/\r?\n/);
    const heads = lines.flatMap((l, i) => (/^export async function \w+\(/.test(l) ? [i] : []));
    expect(heads).toHaveLength(1);
    expect(s).not.toMatch(/^export (async )?const /m);
    const first = lines.slice(heads[0] + 1).find((l) => l.trim() && !l.trim().startsWith('//'));
    expect(first).toMatch(/^\s*const \{ userId, email \} = await requireOwner\(\);/);
    const at = (x: string) => {
      const i = s.indexOf(x);
      expect(i, x).toBeGreaterThan(-1);
      return i;
    };
    expect(at('await requireOwner()')).toBeLessThan(at('DELETE_PHRASE)'));
    expect(at('DELETE_PHRASE)')).toBeLessThan(at('isLimited('));
    expect(at('isLimited(')).toBeLessThan(at('checkPassword('));
    expect(at('checkPassword(')).toBeLessThan(at('createAdminSupabase()'));
    expect(at("if (checked !== 'ok')")).toBeLessThan(at('deleteAllData('));
  });

  it('no GET handler can delete: the export route reads only, and no route handler imports the delete code', () => {
    const route = code('app/api/export/data/route.ts');
    expect(route).toMatch(/export async function GET\(/);
    expect(route).not.toMatch(/export (async )?function (POST|PUT|PATCH|DELETE)\b/);
    expect(route).not.toMatch(/\.(delete|insert|update|upsert|remove|rpc)\(/);
    expect(route.indexOf('assertOwner(')).toBeLessThan(route.indexOf('createServerSupabase('));
    for (const f of walk('app').filter((x) => /\/route\.ts$/.test(x))) expect(src(f), f).not.toMatch(/lib\/data\/delete|data-actions|delete_all_data/);
  });

  it('the export reads only with select (no write method anywhere in lib/data/export.ts)', () => {
    const s = code('lib/data/export.ts');
    expect(s).toMatch(/\.select\('\*'\)/);
    expect(s).not.toMatch(/\.(delete|insert|update|upsert|remove|rpc)\(/);
  });

  it('the delete dialog is a form posting the server action (no fetch, no GET, no auto-submit)', () => {
    const s = code('components/settings/DeleteAllData.tsx');
    expect(s).toMatch(/<form action=\{formAction\}/);
    expect(s).not.toMatch(/\bfetch\(|requestSubmit|\.submit\(\)|useEffect/);
  });
});
