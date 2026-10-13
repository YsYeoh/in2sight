import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'styles/density.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].flatMap((m) =>
  m[1].split(',').map((s) => s.trim()),
);
const attrCount = (s: string) => s.split('[').length - 1;
const BASE = '[data-slot="button"]';
const SIZES = ['sm', 'xs', 'lg', 'icon', 'icon-sm', 'icon-lg', 'icon-xs'];

describe('density.css button rules', () => {
  it('has a bare base rule', () => {
    expect(selectors).toContain(BASE);
  });

  it.each(SIZES)('size "%s" outranks the base rule', (size) => {
    const sel = `${BASE}[data-size="${size}"]`;
    expect(selectors).toContain(sel);
    expect(attrCount(sel)).toBeGreaterThan(attrCount(BASE));
  });

  it('no button size rule is out-specified by a :not() chain', () => {
    for (const s of selectors.filter((s) => s.startsWith(BASE))) {
      if (s !== BASE) expect(s).not.toContain(':not(');
    }
  });
});
