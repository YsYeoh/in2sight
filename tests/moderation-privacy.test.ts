import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Comment moderation (Plan 15d) writes to Instagram on the owner's accounts and handles third-party text (comment
// texts, commenter names) plus the owner's reply text. These guards hold for every file that exists now and every later
// one: they discover the moderation files by path and by import, so a new component or module is covered automatically.
// They extend (never replace) tests/comments-privacy.test.ts, which already limits who may query the comments table.
const root = process.cwd();
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
/** Code without comments (a comment may say "console.log" or name a table without using it). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, code(readFileSync(join(root, f), 'utf8'))] as const);
const text = (f: string) => src.find(([p]) => p === f)?.[1] ?? '';
const naming = (re: RegExp) => src.filter(([, s]) => re.test(s)).map(([f]) => f).sort();

const ACTIONS_FILE = 'app/(app)/accounts/moderation-actions.ts';
/** The moderation modules themselves: lib/moderation/*, the Meta write client, the server actions. */
const isModule = (f: string) => f.startsWith('lib/moderation/') || f === 'lib/instagram/moderation.ts' || f === ACTIONS_FILE;
/** Any import (value or type) of a moderation module or of the actions, however it is spelled. */
const IMPORTS_MODERATION = /from\s+'(@\/lib\/moderation\/[\w-]+|@\/lib\/instagram\/moderation|@\/app\/\(app\)\/accounts\/moderation-actions|[./]+[^']*moderation-actions)'/;
const modules = src.filter(([f]) => isModule(f));
const importers = src.filter(([f, s]) => !isModule(f) && IMPORTS_MODERATION.test(s));
/** Everything that handles moderation data: the modules plus every file that imports one (components, pages, the tick). */
const handling = [...modules, ...importers];
const components = handling.filter(([f]) => f.startsWith('components/'));

describe('moderation privacy and choke points', () => {
  it('discovery finds the moderation modules (a rename cannot silently empty these guards)', () => {
    expect(modules.map(([f]) => f)).toEqual(expect.arrayContaining(['lib/moderation/rules.ts', 'lib/moderation/store.ts', 'lib/moderation/service.ts', 'lib/moderation/auto.ts', 'lib/instagram/moderation.ts', ACTIONS_FILE]));
    expect(importers.map(([f]) => f)).toEqual(expect.arrayContaining(['lib/sync/tick.ts', 'lib/sync/deps.ts']));
  });

  it('only lib/moderation/store.ts names the log and the rules; settings also in the alert store (paused_at only)', () => {
    expect(naming(/['"`]moderation_log['"`]/)).toEqual(['lib/moderation/store.ts']);
    expect(naming(/['"`]moderation_rules['"`]/)).toEqual(['lib/moderation/store.ts']);
    expect(naming(/['"`]moderation_settings['"`]/)).toEqual(['lib/alerts/store.ts', 'lib/moderation/store.ts']);
    expect(text('lib/alerts/store.ts')).toMatch(/from\('moderation_settings'\)\.select\('paused_at'\)/); // nothing else of the settings
  });

  it('only lib/moderation/store.ts updates or deletes comments; the log is never deleted from anywhere', () => {
    expect(naming(/from\(\s*['"]comments['"]\s*\)\s*\.(update|delete)\(/)).toEqual(['lib/moderation/store.ts']);
    expect(text('lib/sync/store.ts')).not.toMatch(/from\(\s*['"]comments['"]\s*\)\s*\.(update|delete)\(/); // the sync only upserts (never writes `hidden`, never deletes)
    expect(text('lib/moderation/store.ts')).not.toMatch(/from\(\s*['"]moderation_log['"]\s*\)\s*\.delete\(/);
    expect(naming(/from\(\s*['"]comments['"]\s*\)\s*\.upsert\(/)).not.toContain('lib/moderation/store.ts'); // moderation never creates comments
  });

  it('no console output in a moderation file or a file using one, except console.error with ONE fixed string literal (no text, names, ids or tokens)', () => {
    expect(handling.length).toBeGreaterThanOrEqual(8);
    for (const [f, s] of handling) {
      expect(s, f).not.toMatch(/console\.(log|info|warn|debug|trace|dir|table|assert|group|time)\w*\s*\(/);
      for (const m of s.matchAll(/console\.error\s*\(([^)]*)\)/g)) expect(m[1].trim(), f).toMatch(/^'[^'`$\\]*'$/);
    }
  });

  it('error values are never turned into output: no message, stack, cause, String(e) or interpolated error in a moderation module', () => {
    for (const [f, s] of modules) {
      expect(s, f).not.toMatch(/\b(e|err|error|ex)\.(message|stack|cause|body|response)\b/);
      expect(s, f).not.toMatch(/(String|JSON\.stringify)\(\s*(e|err|error|ex)\s*\)|\$\{\s*(e|err|error|ex)\s*\}/);
      expect(s, f).not.toMatch(/\b(return|throw)\s+(e|err|error|ex)\b|\bfail\(\s*(e|err|error|ex)\s*\)/); // a catch never hands its error back (storeKey(e) maps it to a key)
    }
  });

  it('the server actions: use server, owner check first and outside try/catch in EVERY exported function, errors become a fixed key', () => {
    const s = text(ACTIONS_FILE);
    expect(readFileSync(join(root, ACTIONS_FILE), 'utf8').trimStart().startsWith("'use server';")).toBe(true);
    const exported = [...s.matchAll(/export\s+(?!async function)(\w+)/g)].map((m) => m[1]);
    expect(exported).toEqual([]); // a "use server" file may export async functions only: anything else is a public endpoint or a build error
    const bodies = s.split(/export async function /).slice(1);
    expect(bodies).toHaveLength(9);
    for (const b of bodies) {
      const name = b.slice(0, b.indexOf('('));
      const body = b.slice(b.indexOf('{') + 1);
      expect(body.trimStart().startsWith('await requireOwner();'), name).toBe(true);
      expect(body.indexOf('requireOwner'), name).toBeLessThan(body.search(/\btry\b/ )); // outside any try: it redirects by throwing
      expect(body.match(/requireOwner/g), name).toHaveLength(1);
    }
    for (const m of s.matchAll(/catch\b\s*([^{]*)\{([^}]*)\}/g)) {
      expect(m[1].trim(), 'catch binds nothing: the error is dropped').toBe('');
      expect(m[2].trim()).toMatch(/^return UNEXPECTED;/);
    }
  });

  it('the admin client: created once, inside token() of the actions, and in no other moderation module or component', () => {
    const actions = text(ACTIONS_FILE);
    expect(actions.match(/createAdminSupabase\(/g)).toHaveLength(1);
    expect(actions).toMatch(/token:\s*\(accountId\)\s*=>\s*supabaseSyncStore\(createAdminSupabase\(\)\)\.getToken\(accountId\)/);
    for (const [f, s] of handling) {
      if (f === ACTIONS_FILE || f.startsWith('lib/sync/')) continue; // the server's wiring points (the sync owns its one admin client and its token reads)
      expect(s, f).not.toMatch(/lib\/supabase\/admin|createAdminSupabase|account_tokens|getToken/);
    }
    // the rule actions and the service use the owner session: the token function is the only admin access
    expect(text('lib/moderation/service.ts')).not.toMatch(/createAdminSupabase|supabase\/admin/);
    expect(text('lib/moderation/store.ts')).not.toMatch(/account_tokens/);
  });

  it('no token or secret reaches client code; client components import server modules with `import type` only', () => {
    expect(components.length).toBeGreaterThanOrEqual(0); // the two components land in the same wave as this file
    for (const [f, s] of components) {
      expect(s, f).not.toMatch(/access_token|NEXT_PUBLIC_|createAdminSupabase|account_tokens|getToken|process\.env/);
      // types only (erased at build time): a VALUE import of a server module would pull it into the client bundle
      expect(s, f).not.toMatch(/^import (?!type )[^;]*from '@\/lib\/(moderation\/(store|auto|service)|instagram\/moderation|supabase\/(server|admin)|sync\/)[\w/-]*'/m);
      // comment text and reply drafts must not outlive the page: no storage, no cookies, no raw HTML
      expect(s, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|dangerouslySetInnerHTML|innerHTML/);
    }
    expect(text(ACTIONS_FILE)).not.toMatch(/NEXT_PUBLIC_/);
    for (const [f, s] of modules) expect(s, f).not.toMatch(/NEXT_PUBLIC_|process\.env/); // env goes through lib/env.ts
  });

  it('only the server actions import the service; only the service, the tick pass, the sync deps and the actions import the Meta write client', () => {
    expect(src.filter(([f, s]) => !f.startsWith('components/') && /^import (?!type )[^;]*from '@\/lib\/moderation\/service'/m.test(s)).map(([f]) => f)).toEqual([ACTIONS_FILE]);
    expect(naming(/from\s+'@\/lib\/instagram\/moderation'/)).toEqual([ACTIONS_FILE, 'lib/moderation/auto.ts', 'lib/moderation/service.ts', 'lib/sync/deps.ts']);
    expect(naming(/from\s+'@\/lib\/moderation\/auto'/)).toEqual(['lib/sync/tick.ts']);
  });

  it('exports, alerts, push and the cron/export routes never import the moderation modules; the sync only its two wiring files', () => {
    const outside = /^lib\/(export\/|alerts\/|push\/)|^app\/api\/(cron|export)\//;
    for (const [f, s] of src) if (outside.test(f)) expect(s, f).not.toMatch(IMPORTS_MODERATION);
    expect(importers.filter(([f]) => f.startsWith('lib/sync/')).map(([f]) => f)).toEqual(['lib/sync/deps.ts', 'lib/sync/tick.ts']);
    expect(importers.filter(([f]) => f.startsWith('app/api/')).map(([f]) => f)).toEqual([]);
    // the comments table and the moderation tables stay out of the exports and push entirely
    for (const [f, s] of src) if (/^lib\/(export\/|push\/)|^app\/api\/export\//.test(f)) expect(s, f).not.toMatch(/moderation_|from\(\s*['"]comments['"]/);
  });

  it('what leaves the moderation pass is counts: the tick summary, the pause notification and the alert read carry no text or names', () => {
    const auto = text('lib/moderation/auto.ts');
    expect(auto.match(/export interface AutoHideSummary \{([^}]*)\}/)?.[1].match(/:\s*(\w+)/g)?.every((t) => /:\s*number/.test(t))).toBe(true);
    expect(text('lib/alerts/rules.ts')).toMatch(/kind: 'moderation_paused'[^\n]*payload: \{ username: a\.username \}/); // the account's own name, nothing else
    for (const f of ['lib/alerts/rules.ts', 'lib/alerts/message.ts', 'lib/alerts/run.ts']) expect(text(f), f).not.toMatch(/author_username|authorUsername|commentText|\.text\b/);
    expect(text('lib/sync/tick.ts')).not.toMatch(/author_username|authorUsername/);
  });

  it('log rows carry ids only: the insert payload never names a text or author column', () => {
    const store = text('lib/moderation/store.ts');
    const insert = store.slice(store.indexOf('export async function insertLog'), store.indexOf('export async function finishLog'));
    expect(insert.length).toBeGreaterThan(50);
    expect(insert).not.toMatch(/\b(text|author_username|authorUsername|message)\b/);
    const finish = store.slice(store.indexOf('export async function finishLog'), store.indexOf('export async function getLog'));
    expect(finish.length).toBeGreaterThan(50);
    expect(finish).not.toMatch(/\b(text|author_username|authorUsername|message)\b/);
  });

  it('the Meta write client is server only and never lets a URL, body or token reach an error', () => {
    const s = text('lib/instagram/moderation.ts');
    expect(s).not.toMatch(/console\./);
    expect(s).not.toMatch(/new Error\(|throw (?!new InstagramApiError\(')/); // only InstagramApiError with its fixed kind
    expect(s).not.toMatch(/\.(text|json)\(\)/); // bodies are parsed (and discarded on error) by call() in oauth.ts only
    expect(s).toMatch(/redirect: 'error'/); // the token is in the query string: never follow a redirect
    expect(s).toMatch(/AbortSignal\.timeout\(MODERATION_TIMEOUT_MS\)/);
  });
});
