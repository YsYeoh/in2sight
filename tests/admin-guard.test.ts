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
        // multiline: the directive may follow leading comments
        return /^\s*['"]use client['"]/m.test(src) && /(supabase\/admin|createAdminSupabase|getServerEnv|getSupabaseSecretKey|SUPABASE_SECRET_KEY|IG_APP_SECRET|getInstagramEnv)/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('proxy.ts exists at the repo root', () => {
    expect(existsSync(join(process.cwd(), 'proxy.ts'))).toBe(true);
  });

  it('the secret key variable is referenced only by lib/env.ts and the env checker', () => {
    const users = ['app', 'components', 'lib', 'proxy.ts']
      .flatMap((d) => {
        const p = join(process.cwd(), d);
        return statSync(p).isDirectory() ? files(p) : [p];
      })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('SUPABASE_SECRET_KEY'))
      .map((f) => f.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '').replaceAll('\\', '/'));
    expect(users).toEqual(['lib/env.ts']);
  });

  it('the Instagram app secret variable is referenced only by lib/env.ts', () => {
    const users = ['app', 'components', 'lib', 'proxy.ts']
      .flatMap((d) => {
        const p = join(process.cwd(), d);
        return statSync(p).isDirectory() ? files(p) : [p];
      })
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('IG_APP_SECRET'))
      .map((f) => f.replace(process.cwd() + '\\', '').replace(process.cwd() + '/', '').replaceAll('\\', '/'));
    expect(users).toEqual(['lib/env.ts']);
  });
});
