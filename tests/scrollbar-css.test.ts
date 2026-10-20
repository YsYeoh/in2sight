import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const css = read('styles/scrollbar.css').replace(/\/\*[\s\S]*?\*\//g, '');
const globals = read('app/globals.css');

describe('standard scrollbar (UI standard)', () => {
  it('is imported un-layered, after the density layer', () => {
    expect(globals).toMatch(/@import\s+["'][^"']*scrollbar\.css["']\s*;/);
    expect(globals.indexOf('scrollbar.css')).toBeGreaterThan(globals.indexOf('density.css'));
    expect(css).not.toMatch(/@layer/);
  });

  it('thin, 8px, rounded thumb, transparent track, no arrow buttons', () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*8px[^}]*height:\s*8px/);
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*9999px/);
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
    expect(css).toMatch(/::-webkit-scrollbar-button\s*\{[^}]*display:\s*none/);
  });

  it('colours come only from the theme (every theme and mode), with a hover step', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).toMatch(/var\(--foreground\)/);
    expect(css).toMatch(/:hover/);
  });

  it('one opt-out class for scrollers whose bar must stay hidden', () => {
    expect(css).toMatch(/\.scrollbar-none\s*\{[^}]*scrollbar-width:\s*none/);
    expect(css).toMatch(/\.scrollbar-none::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });
});
