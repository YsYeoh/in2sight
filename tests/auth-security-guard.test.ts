// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Plan 16b: the auth files never log, never read a redirect parameter, never touch the service role,
// only redirect to literal paths, and the owner-only actions authorize first.
const root = process.cwd();
const src = (f: string) => readFileSync(join(root, f), 'utf8');

// Files the plan names: each must exist (a rename or delete fails here instead of silently shrinking the guard).
const NAMED = [
  'lib/auth/password-rules.ts',
  'lib/auth/attempts.ts',
  'lib/auth/recovery.ts',
  'lib/auth/password.ts',
  'app/login/forgot/actions.ts',
  'app/login/forgot/page.tsx',
  'app/login/reset/actions.ts',
  'app/login/reset/page.tsx',
  'app/login/verify/actions.ts',
  'app/login/page.tsx',
  'app/auth/confirm/actions.ts',
  'app/auth/confirm/page.tsx',
  'app/(app)/settings/security-actions.ts',
  'components/settings/sections/SecuritySection.tsx',
  'components/auth/PasswordInput.tsx',
  'components/auth/PasswordForm.tsx',
  'components/auth/SignOutOthersButton.tsx',
  'components/auth/ForgotForm.tsx',
  'components/auth/RecoveryConfirmForm.tsx',
];

function walk(dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .map((p) => `${dir}/${p.replace(/\\/g, '/')}`)
    .filter((f) => /\.tsx?$/.test(f));
}

// Everything under these folders is scanned, so a NEW auth file is covered without editing this test.
const FILES = [...new Set([...NAMED, ...['lib/auth', 'app/login', 'app/auth', 'components/auth'].flatMap(walk)])];

/** The text between `redirect(` and its closing parenthesis, for every bare `redirect(` call (not `NextResponse.redirect`). */
function redirectArgs(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/(?<![.\w])(?:permanentRedirect|redirect)\(/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    for (; i < s.length && depth > 0; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
    }
    out.push(s.slice(start, i - 1));
  }
  return out;
}

describe('auth security guard (Plan 16b)', () => {
  it('the guard really scans the auth files', () => {
    for (const f of NAMED) expect(existsSync(join(root, f)), f).toBe(true);
    expect(FILES.length).toBeGreaterThanOrEqual(NAMED.length);
  });

  it.each(FILES)('%s: no logging', (f) => {
    expect(src(f)).not.toMatch(/\bconsole\b|\blogger\b|process\.std(out|err)/); // any mention, so an alias (`const c = console`) cannot hide a call
  });

  it.each(FILES)('%s: no redirect parameter is read and no redirectTo is passed', (f) => {
    const s = src(f);
    expect(s).not.toMatch(/(get\(|\[)['"](next|redirectTo|redirect_to|returnTo|return_to)['"]/);
    expect(s).not.toMatch(/searchParams\.get\(|\b(sp|params|searchParams)\.(next|redirectTo|returnTo)\b/);
    expect(s).not.toMatch(/redirectTo|redirect_to|emailRedirectTo|returnTo|return_to/);
  });

  it.each(FILES)('%s: no service-role client', (f) => {
    expect(src(f)).not.toMatch(/createAdminSupabase|supabase\/admin|SECRET_KEY|service_role|serviceRole/);
  });

  it.each(FILES)('%s: imports no module that uses the service role (no admin client through a helper)', (f) => {
    for (const m of src(f).matchAll(/from '@\/([^']+)'/g)) {
      const target = ['.ts', '.tsx', '/index.ts'].map((e) => `${m[1]}${e}`).find((p) => existsSync(join(root, p)));
      if (target) expect(src(target), `${f} -> ${target}`).not.toMatch(/createAdminSupabase|supabase\/admin|service_role/); // lib/env.ts only NAMES the key
    }
  });

  it.each(FILES)('%s: every redirect() target is a literal path', (f) => {
    for (const arg of redirectArgs(src(f))) {
      const literals = [...arg.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      expect(literals.length, arg).toBeGreaterThan(0);
      for (const l of literals) expect(l, arg).toMatch(/^\/(?!\/)[a-z0-9/?=_-]*$/);
      // only literals, the ternary operators and the one proof check may remain
      const rest = arg.replace(/'[^']*'/g, '').replace(/await hasRecoveryProof\(supabase\)/, '');
      expect(rest, arg).toMatch(/^[\s()?:]*$/);
    }
  });

  it('the guard sees the redirects of the flow', () => {
    const all = FILES.flatMap((f) => redirectArgs(src(f)));
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it('createClient (the memory-only check client) appears in the security actions only', () => {
    for (const f of FILES.filter((x) => x !== 'app/(app)/settings/security-actions.ts')) {
      expect(src(f), f).not.toMatch(/\bcreateClient\b/);
    }
  });

  it.each(['app/(app)/settings/security-actions.ts', 'app/login/reset/actions.ts'])('%s: every exported action calls requireOwner() first', (f) => {
    const lines = src(f).split(/\r?\n/);
    const heads = lines.flatMap((l, i) => (/^export async function \w+\(/.test(l) ? [i] : []));
    expect(heads.length).toBeGreaterThan(0);
    expect(src(f), 'an exported arrow function would escape the check above').not.toMatch(/^export (async )?const /m);
    for (const i of heads) {
      expect(lines[i], lines[i]).toMatch(/\{$/);
      const first = lines.slice(i + 1).find((l) => l.trim() && !l.trim().startsWith('//'));
      expect(first, lines[i]).toMatch(/^\s*(const [^=]+ = )?await requireOwner\(\);/);
    }
  });

  it('the reset page authorizes (requireOwner) before it reads the recovery proof', () => {
    const s = src('app/login/reset/page.tsx');
    expect(s.indexOf('await requireOwner()')).toBeGreaterThan(-1);
    expect(s.indexOf('await requireOwner()')).toBeLessThan(s.indexOf('hasRecoveryProof('));
  });

  it('the public actions validate their input before any Supabase call', () => {
    const forgot = src('app/login/forgot/actions.ts');
    expect(forgot.indexOf('isValidEmail(')).toBeGreaterThan(-1);
    expect(forgot.indexOf('isValidEmail(')).toBeLessThan(forgot.indexOf('requestPasswordReset('));
    const confirm = src('app/auth/confirm/actions.ts');
    expect(confirm.indexOf('isTokenHash(')).toBeGreaterThan(-1);
    expect(confirm.indexOf('isTokenHash(')).toBeLessThan(confirm.indexOf('confirmRecovery('));
  });

  it('resetPasswordForEmail is called without options, verifyOtp only as a recovery', () => {
    const s = src('lib/auth/recovery.ts');
    expect(s).toMatch(/resetPasswordForEmail\(email\.trim\(\)\)/);
    expect(s).toMatch(/verifyOtp\(\{ type: 'recovery', token_hash: tokenHash \}\)/);
    expect(s.match(/verifyOtp\(/g)).toHaveLength(1);
  });

  it('the check client keeps nothing (memory only, no refresh, no URL session)', () => {
    expect(src('app/(app)/settings/security-actions.ts')).toMatch(/persistSession: false, autoRefreshToken: false, detectSessionInUrl: false/);
  });
});
