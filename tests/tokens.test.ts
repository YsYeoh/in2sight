import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/contrast';

const css = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');

/** Parse the custom properties inside `selector{ ... }`. The selector must appear verbatim, followed by `{`. */
function vars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector}{`);
  if (start < 0) throw new Error(`Missing CSS block: ${selector}`);
  const body = css.slice(start + selector.length + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const THEMES = ['ink', 'sunset', 'forest', 'mono'] as const;
const MODES = ['light', 'dark'] as const;
const PALETTE = ['background', 'surface', 'border', 'foreground', 'muted-foreground', 'primary', 'primary-foreground'];
const CHARTS = [1, 2, 3, 4, 5, 6].map((n) => `chart-${n}`);

describe('theme palettes', () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      const selector = `:root[data-theme="${theme}"][data-mode="${mode}"]`;

      it(`${theme}/${mode} defines every palette token and 6 distinct chart colours`, () => {
        const v = vars(selector);
        for (const name of [...PALETTE, ...CHARTS]) expect(v[name], `${name} in ${selector}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(new Set(CHARTS.map((c) => v[c].toUpperCase())).size).toBe(6);
      });

      it(`${theme}/${mode} text pairs meet WCAG AA (4.5:1)`, () => {
        const v = vars(selector);
        const m = vars(`:root[data-mode="${mode}"]`);
        const pairs: [string, string, string][] = [
          ['foreground', v.foreground, v.background],
          ['foreground on surface', v.foreground, v.surface],
          ['muted-foreground on surface', v['muted-foreground'], v.surface],
          ['primary-foreground on primary', v['primary-foreground'], v.primary],
          ['success on surface', m.success, v.surface],
          ['warning on surface', m.warning, v.surface],
          ['danger on surface', m.danger, v.surface],
        ];
        for (const [label, fg, bg] of pairs) {
          expect(contrastRatio(fg, bg), `${theme}/${mode}: ${label} (${fg} on ${bg})`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('density and radius', () => {
  it('density presets define every sizing token', () => {
    for (const d of ['dense', 'comfortable']) {
      const v = vars(`:root[data-density="${d}"]`);
      for (const n of ['pg', 'pc', 'gp', 'ctl', 'ctl-sm', 'row', 'fb', 'lb', 'fh', 'fv']) expect(v[n], `${n} in ${d}`).toBeTruthy();
    }
  });

  it('radius presets are sharp 4/8/12, soft 8/12/16, round 12/16/24', () => {
    expect(vars(':root[data-radius="sharp"]')).toMatchObject({ rs: '4px', rm: '8px', rl: '12px' });
    expect(vars(':root[data-radius="soft"]')).toMatchObject({ rs: '8px', rm: '12px', rl: '16px' });
    expect(vars(':root[data-radius="round"]')).toMatchObject({ rs: '12px', rm: '16px', rl: '24px' });
  });

  it('the bare :root block provides dense + soft defaults so a missing attribute never breaks layout', () => {
    const v = vars(':root');
    expect(v).toMatchObject({ ctl: '30px', rs: '8px', rm: '12px', rl: '16px' });
  });
});
