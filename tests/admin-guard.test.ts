import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (['node_modules', '.next', '.git', '.superpowers'].includes(f)) return [];
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('secret-key client isolation', () => {
  it('no file marked "use client" imports the admin client or the server env helpers', () => {
    const offenders = ['app', 'components', 'lib']
      .flatMap((d) => files(join(process.cwd(), d)))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return /^\s*['"]use client['"]/.test(src) && /(supabase\/admin|getServerEnv|SUPABASE_SECRET_KEY)/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('the secret key variable is referenced only by lib/env.ts and the env checker', () => {
    const users = ['app', 'components', 'lib', 'proxy.ts']
      .filter((d) => existsSync(join(process.cwd(), d))) // proxy.ts arrives in a later task
      .flatMap((d) => {
        const p = join(process.cwd(), d);
        return statSync(p).isDirectory() ? files(p) : [p];
      })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('SUPABASE_SECRET_KEY'))
      .map((f) => f.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '').replaceAll('\\', '/'));
    expect(users).toEqual(['lib/env.ts']);
  });
});
