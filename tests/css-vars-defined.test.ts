import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Set(
  ['styles/tokens.css', 'app/globals.css', 'styles/density.css'].flatMap((f) =>
    [...read(f).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  ),
);
// Variables set by a framework at runtime, not by our CSS.
const FRAMEWORK = /^--(tw-|radix-|color-|radius-|font-|text-|container-|shadow-|spacing$)/;

const files = ['components/ui', 'components/shared'].flatMap((d) =>
  readdirSync(join(root, d))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `${d}/${f}`),
);

describe('every var(--x) without a fallback in components resolves to a defined token', () => {
  it.each(files)('%s', (f) => {
    const names = [...read(f).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    for (const n of new Set(names)) {
      expect(defined.has(n) || FRAMEWORK.test(n), `${f} uses undefined ${n}`).toBe(true);
    }
  });
});
