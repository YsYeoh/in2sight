import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const density = readFileSync(join(process.cwd(), 'styles/density.css'), 'utf8');
const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('density wiring', () => {
  it('globals imports the density layer after the tokens', () => {
    expect(globals.indexOf('tokens.css')).toBeGreaterThan(-1);
    expect(globals.indexOf('density.css')).toBeGreaterThan(globals.indexOf('tokens.css'));
  });

  it('text sizes follow the density tokens', () => {
    expect(globals).toMatch(/--text-sm:\s*var\(--fb\)/);
    expect(globals).toMatch(/--text-xs:\s*var\(--lb\)/);
  });

  it('controls take their height from the density tokens, not fixed sizes', () => {
    expect(density).toMatch(/\[data-slot="button"\][^{]*\{[^}]*height:\s*var\(--ctl\)/);
    expect(density).toMatch(/\[data-slot="input"\]\s*\{[^}]*height:\s*var\(--ctl\)/);
    expect(density).toMatch(/\[data-slot="select-trigger"\]\s*\{[^}]*height:\s*var\(--ctl\)/);
  });

  it('every data-slot named in density.css is actually rendered by a component in components/ui', () => {
    const slots = [...density.matchAll(/data-slot="([\w-]+)"/g)].map((m) => m[1]);
    const ui = ['button', 'input', 'select', 'textarea', 'table', 'card', 'tabs', 'dropdown-menu']
      .map((n) => readFileSync(join(process.cwd(), `components/ui/${n}.tsx`), 'utf8'))
      .join('\n');
    for (const slot of new Set(slots)) expect(ui, `no component renders data-slot="${slot}"`).toContain(`data-slot="${slot}"`);
  });

  it('density.css is un-layered and globals imports it without layer()', () => {
    expect(density.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@layer/);
    expect(globals).toMatch(/@import\s+["'][^"']*density\.css["']\s*;/);
    expect(globals).not.toMatch(/density\.css["']\s*layer\(/);
  });
});

describe('iOS no-zoom text fields', () => {
  it('coarse-pointer inputs are at least 16px', () => {
    const css = density.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(
      /@media\s*\(pointer:\s*coarse\)\s*\{[^{}]*\[data-slot="input"\][^{}]*\[data-slot="textarea"\][^{}]*\[data-slot="select-trigger"\][^{}]*\{[^}]*font-size:\s*max\(16px,\s*var\(--fb\)\)/,
    );
  });
});
