import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'components/ui');
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

describe('generated components do not pull bogus packages', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.tsx')))('%s imports neither "cn" nor next-themes', (f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    expect(src).not.toMatch(/from\s+["']cn["']/);
    expect(src).not.toMatch(/next-themes/);
  });

  it('package.json has neither dependency', () => {
    expect(deps).not.toHaveProperty('cn');
    expect(deps).not.toHaveProperty('next-themes');
  });
});
