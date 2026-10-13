# Foundation Core Implementation Plan (Plan 1 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Next.js 16 app with test infrastructure, the approved design tokens (4 themes × light/dark × density × radius), cookie-backed user preferences, locale-aware formatting, English + Simplified Chinese i18n, and a `/styleguide` skeleton page whose live switchers prove all of it works.

**Architecture:** Repo root is the Next.js app (App Router, TypeScript strict, Tailwind v4 CSS-first). Pure logic lives in `lib/` and is unit-tested with Vitest. Design tokens are plain CSS custom properties in `styles/tokens.css`, selected by attributes on `<html>` (`data-theme`, `data-mode`, `data-density`, `data-radius`); the server reads a single preferences cookie and writes those attributes so there is no flash. Tailwind utilities map to the tokens through `@theme inline`. next-intl runs without locale URL prefixes: the locale comes from the preferences cookie.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript (strict), Tailwind CSS 4.3, next-intl 4.14, Vitest 5 + Testing Library + jsdom. (No `next-themes`: the cookie + `<html>` attributes replace it.)

**Spec:** `docs/SPEC.md` — especially §8b (frontend architecture), §7b (formats/rules). Roadmap: `docs/superpowers/plans/2026-10-13-00-roadmap.md`. Visual reference: `docs/mockups/kit.css` (token values are copied from it).

## Global Constraints

- Next.js App Router, TypeScript `strict: true`, hosted on Vercel later; repo root is the app (no `src/` dir, import alias `@/*`).
- Dependencies allowed in this plan: `next`, `react`, `react-dom`, `tailwindcss`, `next-intl`, and dev-only `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/*`. **No others** without a stated reason.
- Every UI string goes through next-intl; every key exists in both `messages/en.json` and `messages/zh-CN.json` (Simplified Chinese).
- Dates, times and numbers are formatted **only** through `lib/format.ts` — never inline `toLocaleDateString` / `toLocaleString` / `Intl.*` in components or pages.
- Components use semantic tokens (`bg-background`, `text-muted-foreground`, `var(--chart-1)`), never raw hex values.
- Preferences enums (verbatim from spec): date format `YYYY-MM-DD` / `DD/MM/YYYY` / `MM/DD/YYYY` / `D MMM YYYY`; time format 12h/24h; week start Mon/Sun; themes Ink, Sunset, Forest, Mono; radius Sharp/Soft/Round (default **Soft** 8/12/16); density Dense (default) / Comfortable.
- Responsive: layouts must work at 360px, 768px and 1280px+ (no fixed pixel widths on layout containers).
- Never commit `.env*`. Never log secrets.
- Commits are conventional (`feat:`, `fix:`, `test:`, `docs:`, `chore:`) and carry the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- Shell is Git Bash on Windows 11: use forward slashes and POSIX syntax. Node 24, npm 11.

## Review Focus

Failure modes the spec implies but a happy-path test would miss (each has a test in the named task):

1. **Tampered, truncated or oversized preferences cookie** (bad percent-encoding, invalid JSON, wrong types, unknown enum values, > 2 KB) → must fall back to defaults field-by-field and never throw. *(Task 3)*
2. **Timezone edge cases:** an instant just after UTC midnight must show the *user's* local date; DST boundaries; an invalid timezone string must fall back to UTC instead of throwing `RangeError`. *(Task 4)*
3. **Missing data shown as garbage:** `null`, `undefined`, `NaN`, `Infinity`, unparsable date strings must render `—`, never `NaN`, `Invalid Date` or `undefined`; compact numbers must not print `1000K` (roll over to `1M`); tiny negative deltas must not print `-0.0%`. *(Task 4)*
4. **Untranslated or mismatched UI text:** a key missing in zh-CN, or a different `{placeholder}` set between locales, fails the test suite; at runtime a missing zh-CN key falls back to English instead of showing a raw key. *(Task 5)*
5. **First-paint flash / hydration mismatch:** `<html>` attributes come from one pure function used by both the server layout and the client provider; invalid values can never reach state or the DOM. *(Tasks 3 and 6)*

---

## File Structure

```
in2sight/
  app/
    layout.tsx                 # reads prefs cookie -> <html> attrs, intl provider, PrefsProvider
    globals.css                # tailwind import, tokens import, @theme inline mapping, base styles
    page.tsx                   # redirects to /styleguide (temporary home)
    actions.ts                 # 'use server' setPrefs(partial)
    styleguide/page.tsx        # token swatches, format samples, PrefsBar
  components/
    providers/PrefsProvider.tsx   # client context: prefs, update(), applyPrefsToDocument()
    shared/PrefsBar.tsx           # theme/mode/density/radius/language/date-format switchers
  i18n/request.ts              # next-intl request config (locale from prefs cookie, en fallback merge)
  lib/
    contrast.ts                # WCAG contrast helpers (used by tests)
    prefs.ts                   # types, defaults, parse/serialize, htmlAttrs, isValidTimeZone
    prefs.server.ts            # getPrefs() from next/headers cookies
    format.ts                  # formatDate/Time/DateTime/Number/Compact/Percent/Delta
    merge.ts                   # deepMerge for message fallback
  messages/en.json, zh-CN.json
  styles/tokens.css            # all design tokens (themes, mode colours, density, radius)
  tests/                       # one test file per lib module + components
  vitest.config.ts, vitest.setup.ts, next.config.ts
```

---

### Task 1: Scaffold the app and test tooling

**Files:**
- Create (via scaffold): `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `app/*`, `public/*`
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Modify: `.gitignore` (merge), `package.json` (name, scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `dev`, `build`, `lint`, `typecheck`, `test`, `test:watch`, `check`; Vitest picks up `tests/**/*.test.{ts,tsx}` with the `@` alias and jsdom + jest-dom matchers.

- [ ] **Step 1: Create the feature branch**

```bash
cd /c/Users/yeohy/Documents/playground/in2sight
git switch -c feat/foundation-core
```

- [ ] **Step 2: Scaffold Next.js in a sibling directory** (the repo already has `README.md`, `CLAUDE.md`, `.gitignore`, which `create-next-app` would clash with)

```bash
cd /c/Users/yeohy/Documents/playground
npx --yes create-next-app@latest in2sight-scaffold --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
```

If a flag is rejected, run `npx create-next-app@latest --help` and choose the equivalent: TypeScript, Tailwind, ESLint, App Router, no `src/`, alias `@/*`, npm.

- [ ] **Step 3: Move the scaffold into the repo** (never overwrite `README.md`, `CLAUDE.md`; merge `.gitignore`)

```bash
SC=/c/Users/yeohy/Documents/playground/in2sight-scaffold
REPO=/c/Users/yeohy/Documents/playground/in2sight
rm -rf "$SC/node_modules" "$SC/.git"
cd "$SC"
for f in $(ls -A | grep -v -e '^README.md$' -e '^.gitignore$' -e '^CLAUDE.md$'); do cp -r "$f" "$REPO/"; done
cat "$SC/.gitignore" >> "$REPO/.gitignore"
awk '!seen[$0]++' "$REPO/.gitignore" > "$REPO/.gitignore.tmp" && mv "$REPO/.gitignore.tmp" "$REPO/.gitignore"
cd "$REPO" && rm -rf "$SC"
git status --short
```

Expected: new files (`package.json`, `app/`, `public/`, `tsconfig.json`, …) and a modified `.gitignore`; `CLAUDE.md` and `README.md` unchanged. If the scaffold produced an `AGENTS.md`, keep it.

- [ ] **Step 4: Name the package and install dependencies**

Edit `package.json`: set `"name": "in2sight"`. Then:

```bash
npm install
npm install next-intl
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

If npm reports a peer-dependency conflict between `vitest` and `vite`, re-run the failing command with `--legacy-peer-deps` and note it in the commit message.

- [ ] **Step 5: Add npm scripts**

In `package.json` → `scripts`, keep the scaffold's `dev`, `build`, `start`, `lint` and add:

```json
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:watch": "vitest",
"check": "npm run lint && npm run typecheck && npm test && npm run build"
```

- [ ] **Step 6: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
```

- [ ] **Step 6b: Keep ESLint away from docs and mockups**

`docs/mockups/*.js` and `serve.cjs` are reference files, not app code. Open `eslint.config.mjs` and add `"docs/**"` and `".superpowers/**"` to the existing `globalIgnores([...])` list (next to `.next/**`). If the scaffold's config has a different shape, add an equivalent `ignores` entry.

- [ ] **Step 7: Verify the toolchain**

Run: `npx vitest run --passWithNoTests`
Expected: exits 0 ("No test files found").

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all three succeed (the default scaffold page builds).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with Vitest and Testing Library" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens (CSS) with contrast and completeness tests

**Files:**
- Create: `lib/contrast.ts`, `styles/tokens.css`, `tests/contrast.test.ts`, `tests/tokens.test.ts`
- Modify: `app/globals.css` (replace entirely)

**Interfaces:**
- Consumes: nothing.
- Produces: `contrastRatio(a: string, b: string): number` (6-digit hex strings; throws on invalid hex). CSS custom properties on `:root`: `--background --surface --surface-2 --border --foreground --muted-foreground --primary --primary-foreground --accent --accent-fg --hover --ring --success --warning --danger --shadow --chart-1…--chart-6`, density vars `--pg --pc --gp --ctl --ctl-sm --row --fb --lb --fh --fv`, radius vars `--rs --rm --rl`. Tailwind utilities: `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-accent`, `border-border`, `text-success|warning|destructive`, `bg-hover`, `bg-chart-1…6`, `rounded-sm|md|lg|xl` (mapped to radius tokens), `shadow-pop`.

- [ ] **Step 1: Write the failing contrast test**

Create `tests/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb } from '@/lib/contrast';

describe('contrast', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#4F46E5')).toEqual([79, 70, 229]);
  });

  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('identical colours are 1:1 and the order of arguments does not matter', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('#777777 on white is about 4.48:1 (just under AA)', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('rejects anything that is not a 6-digit hex colour', () => {
    expect(() => hexToRgb('#fff')).toThrow();
    expect(() => hexToRgb('rgb(0,0,0)')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/contrast.test.ts`
Expected: FAIL — cannot resolve `@/lib/contrast`.

- [ ] **Step 3: Implement `lib/contrast.ts`**

```ts
export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/contrast.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing tokens test**

Create `tests/tokens.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/tokens.test.ts`
Expected: FAIL — ENOENT `styles/tokens.css`.

- [ ] **Step 7: Create `styles/tokens.css`**

```css
/*
 * in2sight design tokens.
 * Source of truth for values: docs/mockups/kit.css. Verified by tests/tokens.test.ts.
 * Selected by attributes on <html>: data-theme, data-mode, data-density, data-radius.
 * NOTE: tests locate blocks by their exact selector text followed by "{" — keep this formatting.
 */

/* ---- Palettes: theme × mode ---- */
:root[data-theme="ink"][data-mode="light"]{--background:#F8FAFC;--surface:#FFFFFF;--border:#E2E8F0;--foreground:#0F172A;--muted-foreground:#64748B;--primary:#4F46E5;--primary-foreground:#FFFFFF;--chart-1:#4F46E5;--chart-2:#0EA5E9;--chart-3:#10B981;--chart-4:#F59E0B;--chart-5:#EC4899;--chart-6:#8B5CF6;}
:root[data-theme="ink"][data-mode="dark"]{--background:#0B1020;--surface:#131A2E;--border:#243049;--foreground:#E6EAF5;--muted-foreground:#94A3B8;--primary:#818CF8;--primary-foreground:#0B1020;--chart-1:#818CF8;--chart-2:#38BDF8;--chart-3:#34D399;--chart-4:#FBBF24;--chart-5:#F472B6;--chart-6:#A78BFA;}
:root[data-theme="sunset"][data-mode="light"]{--background:#FFF8F5;--surface:#FFFFFF;--border:#F1DDD4;--foreground:#2A1810;--muted-foreground:#8A6F63;--primary:#D6245F;--primary-foreground:#FFFFFF;--chart-1:#D6245F;--chart-2:#F97316;--chart-3:#EAB308;--chart-4:#14B8A6;--chart-5:#6366F1;--chart-6:#A855F7;}
:root[data-theme="sunset"][data-mode="dark"]{--background:#1A1011;--surface:#241619;--border:#3C2428;--foreground:#F6E9E4;--muted-foreground:#C4A59A;--primary:#FF6B9A;--primary-foreground:#1A1011;--chart-1:#FF6B9A;--chart-2:#FB923C;--chart-3:#FACC15;--chart-4:#2DD4BF;--chart-5:#818CF8;--chart-6:#C084FC;}
:root[data-theme="forest"][data-mode="light"]{--background:#F6F8F5;--surface:#FFFFFF;--border:#DCE4DA;--foreground:#112016;--muted-foreground:#5F6F63;--primary:#15803D;--primary-foreground:#FFFFFF;--chart-1:#15803D;--chart-2:#0891B2;--chart-3:#CA8A04;--chart-4:#DC2626;--chart-5:#7C3AED;--chart-6:#DB2777;}
:root[data-theme="forest"][data-mode="dark"]{--background:#0C1510;--surface:#131F18;--border:#223428;--foreground:#E4EFE7;--muted-foreground:#9BB1A1;--primary:#4ADE80;--primary-foreground:#0C1510;--chart-1:#4ADE80;--chart-2:#22D3EE;--chart-3:#FACC15;--chart-4:#F87171;--chart-5:#A78BFA;--chart-6:#F472B6;}
:root[data-theme="mono"][data-mode="light"]{--background:#FAFAFA;--surface:#FFFFFF;--border:#E4E4E7;--foreground:#09090B;--muted-foreground:#71717A;--primary:#18181B;--primary-foreground:#FFFFFF;--chart-1:#2563EB;--chart-2:#F97316;--chart-3:#16A34A;--chart-4:#DC2626;--chart-5:#9333EA;--chart-6:#0891B2;}
:root[data-theme="mono"][data-mode="dark"]{--background:#09090B;--surface:#111113;--border:#27272A;--foreground:#FAFAFA;--muted-foreground:#A1A1AA;--primary:#FAFAFA;--primary-foreground:#09090B;--chart-1:#60A5FA;--chart-2:#FB923C;--chart-3:#4ADE80;--chart-4:#F87171;--chart-5:#C084FC;--chart-6:#22D3EE;}

/* ---- Mode-level semantic colours (shared by all themes) ---- */
:root[data-mode="light"]{--success:#15803D;--warning:#B45309;--danger:#B91C1C;--shadow:0 8px 24px rgb(15 23 42 / 0.12);}
:root[data-mode="dark"]{--success:#4ADE80;--warning:#FBBF24;--danger:#F87171;--shadow:0 8px 24px rgb(0 0 0 / 0.5);}

/* ---- Derived tokens + defaults (dense, soft) ---- */
:root{
  --ring:var(--primary);
  --surface-2:color-mix(in srgb,var(--foreground) 4%,var(--surface));
  --hover:color-mix(in srgb,var(--foreground) 6%,var(--surface));
  --accent:color-mix(in srgb,var(--primary) 12%,var(--surface));
  --accent-fg:var(--primary);
  --pg:16px;--pc:12px;--gp:12px;--ctl:30px;--ctl-sm:24px;--row:30px;--fb:13px;--lb:11px;--fh:13px;--fv:22px;
  --rs:8px;--rm:12px;--rl:16px;
}

/* ---- Density: page pad, card pad, gap, control h, small control h, table row, body/label/heading/KPI font ---- */
:root[data-density="dense"]{--pg:16px;--pc:12px;--gp:12px;--ctl:30px;--ctl-sm:24px;--row:30px;--fb:13px;--lb:11px;--fh:13px;--fv:22px;}
:root[data-density="comfortable"]{--pg:24px;--pc:16px;--gp:16px;--ctl:36px;--ctl-sm:28px;--row:40px;--fb:14px;--lb:12px;--fh:15px;--fv:28px;}

/* ---- Radius: rs = controls, rm = cards/tables, rl = dialogs ---- */
:root[data-radius="sharp"]{--rs:4px;--rm:8px;--rl:12px;}
:root[data-radius="soft"]{--rs:8px;--rm:12px;--rl:16px;}
:root[data-radius="round"]{--rs:12px;--rm:16px;--rl:24px;}

/* ---- Touch devices: never smaller than 40px controls ---- */
@media (pointer:coarse){
  :root,:root[data-density="dense"]{--ctl:40px;--ctl-sm:32px;--row:44px;}
  :root[data-density="comfortable"]{--ctl:44px;--ctl-sm:36px;--row:48px;}
}
```

- [ ] **Step 8: Run the tokens test**

Run: `npx vitest run tests/tokens.test.ts`
Expected: PASS. If a contrast assertion fails (the message names theme, mode, pair and colours), adjust **only that one token** minimally (darken/lighten), re-run, and mention the change in the commit message. Do not loosen the 4.5 threshold.

- [ ] **Step 9: Replace `app/globals.css`**

```css
@import "tailwindcss";
@import "../styles/tokens.css";

/* dark: variant follows our attribute, not the OS setting */
@custom-variant dark (&:where([data-mode="dark"], [data-mode="dark"] *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--surface);
  --color-card-foreground: var(--foreground);
  --color-popover: var(--surface);
  --color-popover-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--surface-2);
  --color-secondary-foreground: var(--foreground);
  --color-muted: var(--surface-2);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-fg);
  --color-destructive: var(--danger);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-input: var(--border);
  --color-ring: var(--ring);
  --color-hover: var(--hover);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-6: var(--chart-6);

  --radius-sm: calc(var(--rs) * 0.6);
  --radius-md: var(--rs);
  --radius-lg: var(--rm);
  --radius-xl: var(--rl);

  --shadow-pop: var(--shadow);

  --font-sans: var(--font-inter), "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
}

@layer base {
  * {
    border-color: var(--border);
  }
  html {
    color-scheme: light;
  }
  html[data-mode="dark"] {
    color-scheme: dark;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
    font-size: var(--fb);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
}
```

- [ ] **Step 10: Verify the build still passes**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: design tokens (4 themes x light/dark, density, radius) with contrast tests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Preferences module

**Files:**
- Create: `lib/prefs.ts`, `tests/prefs.test.ts`

**Interfaces:**
- Consumes: `styles/tokens.css` (read by one test to keep `THEMES` in sync).
- Produces (all exported from `@/lib/prefs`):
  - constants: `THEMES`, `MODES`, `DENSITIES`, `RADII`, `LOCALES`, `DATE_FORMATS`, `TIME_FORMATS`, `NUMBER_FORMATS`, `WEEK_STARTS` (readonly tuples), `PREFS_COOKIE = 'in2sight_prefs'`
  - types: `Theme`, `Mode`, `Density`, `Radius`, `Locale`, `DateFormat`, `TimeFormat`, `NumberFormat`, `WeekStart`, `Prefs`
  - `DEFAULT_PREFS: Prefs`
  - `isValidTimeZone(tz: unknown): tz is string`
  - `parsePrefs(raw: unknown): Prefs` — always returns a fully valid object
  - `serializePrefs(p: Prefs): string` — URL-encoded JSON for the cookie value
  - `parsePrefsCookie(value: string | undefined | null): Prefs`
  - `htmlAttrs(p: Prefs): { lang; 'data-theme'; 'data-mode'; 'data-density'; 'data-radius' }`

```ts
export interface Prefs {
  theme: Theme; mode: Mode; density: Density; radius: Radius;
  locale: Locale; dateFormat: DateFormat; timeFormat: TimeFormat;
  numberFormat: NumberFormat; weekStart: WeekStart; timezone: string;
}
```

- [ ] **Step 1: Write the failing tests**

Create `tests/prefs.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS, THEMES, MODES, DENSITIES, RADII, LOCALES, DATE_FORMATS, TIME_FORMATS, NUMBER_FORMATS, WEEK_STARTS,
  htmlAttrs, isValidTimeZone, parsePrefs, parsePrefsCookie, serializePrefs, type Prefs,
} from '@/lib/prefs';

describe('defaults', () => {
  it('are the owner-approved values', () => {
    expect(DEFAULT_PREFS).toEqual({
      theme: 'ink', mode: 'light', density: 'dense', radius: 'soft', locale: 'en',
      dateFormat: 'D MMM YYYY', timeFormat: '24h', numberFormat: '1,234.5', weekStart: 'mon', timezone: 'Asia/Kuala_Lumpur',
    });
  });

  it('every default is a member of its enum and the timezone is valid', () => {
    expect(THEMES).toContain(DEFAULT_PREFS.theme);
    expect(MODES).toContain(DEFAULT_PREFS.mode);
    expect(DENSITIES).toContain(DEFAULT_PREFS.density);
    expect(RADII).toContain(DEFAULT_PREFS.radius);
    expect(LOCALES).toContain(DEFAULT_PREFS.locale);
    expect(DATE_FORMATS).toContain(DEFAULT_PREFS.dateFormat);
    expect(TIME_FORMATS).toContain(DEFAULT_PREFS.timeFormat);
    expect(NUMBER_FORMATS).toContain(DEFAULT_PREFS.numberFormat);
    expect(WEEK_STARTS).toContain(DEFAULT_PREFS.weekStart);
    expect(isValidTimeZone(DEFAULT_PREFS.timezone)).toBe(true);
  });

  it('every theme has a palette in styles/tokens.css', () => {
    const css = readFileSync(join(process.cwd(), 'styles/tokens.css'), 'utf8');
    for (const t of THEMES) {
      expect(css).toContain(`:root[data-theme="${t}"][data-mode="light"]{`);
      expect(css).toContain(`:root[data-theme="${t}"][data-mode="dark"]{`);
    }
  });
});

describe('parsePrefs', () => {
  it('keeps valid fields and falls back per field for invalid ones', () => {
    const p = parsePrefs({ theme: 'forest', mode: 'purple', density: 'comfortable', radius: 42, timezone: 'Not/AZone', dateFormat: 'DD/MM/YYYY' });
    expect(p.theme).toBe('forest');
    expect(p.mode).toBe(DEFAULT_PREFS.mode);
    expect(p.density).toBe('comfortable');
    expect(p.radius).toBe(DEFAULT_PREFS.radius);
    expect(p.timezone).toBe(DEFAULT_PREFS.timezone);
    expect(p.dateFormat).toBe('DD/MM/YYYY');
  });

  // each case is wrapped in its own row so vitest does not spread the array cases into separate arguments
  it.each([[null], [undefined], ['a string'], [42], [[]], [[1, 2]]])('returns full defaults for non-object input %j', (raw) => {
    expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
  });

  it('ignores unknown keys and returns a fresh object each time', () => {
    const p = parsePrefs({ theme: 'mono', evil: '<script>', __proto__: { theme: 'sunset' } });
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(p).not.toBe(DEFAULT_PREFS);
    expect(parsePrefs({})).not.toBe(parsePrefs({}));
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(123)).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('cookie round trip', () => {
  it('serialize -> parse returns the same prefs', () => {
    const p: Prefs = { ...DEFAULT_PREFS, theme: 'sunset', mode: 'dark', locale: 'zh-CN', dateFormat: 'MM/DD/YYYY', timezone: 'America/New_York' };
    expect(parsePrefsCookie(serializePrefs(p))).toEqual(p);
  });

  it('serialized value is cookie-safe (no ; , or whitespace)', () => {
    expect(serializePrefs(DEFAULT_PREFS)).not.toMatch(/[;,\s]/);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['bad percent-encoding', '%E0%A4%A'],
    ['not JSON', encodeURIComponent('hello')],
    ['JSON but not an object', encodeURIComponent('42')],
    ['truncated JSON', encodeURIComponent('{"theme":"for')],
    ['oversized (3 KB)', 'a'.repeat(3000)],
  ])('falls back to defaults for a %s cookie without throwing', (_label, value) => {
    expect(parsePrefsCookie(value as string | null | undefined)).toEqual(DEFAULT_PREFS);
  });

  it('a tampered cookie keeps only the valid fields', () => {
    const value = encodeURIComponent(JSON.stringify({ theme: 'mono', radius: 'triangle', locale: 'zh-CN' }));
    expect(parsePrefsCookie(value)).toEqual({ ...DEFAULT_PREFS, theme: 'mono', locale: 'zh-CN' });
  });
});

describe('htmlAttrs', () => {
  it('maps prefs to the attributes the token CSS and next-intl rely on', () => {
    expect(htmlAttrs({ ...DEFAULT_PREFS, theme: 'forest', mode: 'dark', density: 'comfortable', radius: 'round', locale: 'zh-CN' })).toEqual({
      lang: 'zh-CN', 'data-theme': 'forest', 'data-mode': 'dark', 'data-density': 'comfortable', 'data-radius': 'round',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/prefs.test.ts`
Expected: FAIL — cannot resolve `@/lib/prefs`.

- [ ] **Step 3: Implement `lib/prefs.ts`**

```ts
export const THEMES = ['ink', 'sunset', 'forest', 'mono'] as const;
export const MODES = ['light', 'dark'] as const;
export const DENSITIES = ['dense', 'comfortable'] as const;
export const RADII = ['sharp', 'soft', 'round'] as const;
export const LOCALES = ['en', 'zh-CN'] as const;
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'D MMM YYYY'] as const;
export const TIME_FORMATS = ['24h', '12h'] as const;
export const NUMBER_FORMATS = ['1,234.5', '1.234,5', '1 234,5'] as const;
export const WEEK_STARTS = ['mon', 'sun'] as const;

export type Theme = (typeof THEMES)[number];
export type Mode = (typeof MODES)[number];
export type Density = (typeof DENSITIES)[number];
export type Radius = (typeof RADII)[number];
export type Locale = (typeof LOCALES)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type TimeFormat = (typeof TIME_FORMATS)[number];
export type NumberFormat = (typeof NUMBER_FORMATS)[number];
export type WeekStart = (typeof WEEK_STARTS)[number];

export interface Prefs {
  theme: Theme;
  mode: Mode;
  density: Density;
  radius: Radius;
  locale: Locale;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  numberFormat: NumberFormat;
  weekStart: WeekStart;
  timezone: string;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'ink',
  mode: 'light',
  density: 'dense',
  radius: 'soft',
  locale: 'en',
  dateFormat: 'D MMM YYYY',
  timeFormat: '24h',
  numberFormat: '1,234.5',
  weekStart: 'mon',
  timezone: 'Asia/Kuala_Lumpur',
};

export const PREFS_COOKIE = 'in2sight_prefs';
const MAX_COOKIE_LENGTH = 2048;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pick<T extends readonly string[]>(list: T, value: unknown, fallback: T[number]): T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** Always returns a complete, valid Prefs. Unknown keys are dropped; invalid values fall back per field. */
export function parsePrefs(raw: unknown): Prefs {
  const r = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFS;
  return {
    theme: pick(THEMES, r.theme, d.theme),
    mode: pick(MODES, r.mode, d.mode),
    density: pick(DENSITIES, r.density, d.density),
    radius: pick(RADII, r.radius, d.radius),
    locale: pick(LOCALES, r.locale, d.locale),
    dateFormat: pick(DATE_FORMATS, r.dateFormat, d.dateFormat),
    timeFormat: pick(TIME_FORMATS, r.timeFormat, d.timeFormat),
    numberFormat: pick(NUMBER_FORMATS, r.numberFormat, d.numberFormat),
    weekStart: pick(WEEK_STARTS, r.weekStart, d.weekStart),
    timezone: isValidTimeZone(r.timezone) ? r.timezone : d.timezone,
  };
}

export function serializePrefs(p: Prefs): string {
  return encodeURIComponent(JSON.stringify(p));
}

export function parsePrefsCookie(value: string | undefined | null): Prefs {
  if (!value || value.length > MAX_COOKIE_LENGTH) return parsePrefs(null);
  try {
    return parsePrefs(JSON.parse(decodeURIComponent(value)));
  } catch {
    return parsePrefs(null);
  }
}

/** The single source for the attributes on <html>; used by the server layout and the client provider. */
export function htmlAttrs(p: Prefs) {
  return {
    lang: p.locale,
    'data-theme': p.theme,
    'data-mode': p.mode,
    'data-density': p.density,
    'data-radius': p.radius,
  } as const;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/prefs.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: preferences module with defensive cookie parsing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Formatting library

**Files:**
- Create: `lib/format.ts`, `tests/format.test.ts`

**Interfaces:**
- Consumes: `Prefs` type from `@/lib/prefs`.
- Produces (all from `@/lib/format`):
  - `type FormatPrefs = Pick<Prefs, 'locale' | 'dateFormat' | 'timeFormat' | 'numberFormat' | 'timezone'>`
  - `type DateInput = Date | string | number | null | undefined`
  - `formatDate(v: DateInput, p: FormatPrefs): string`
  - `formatTime(v: DateInput, p: FormatPrefs): string`
  - `formatDateTime(v: DateInput, p: FormatPrefs): string`
  - `formatNumber(n: number | null | undefined, p: FormatPrefs, opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number }): string`
  - `formatCompact(n: number | null | undefined, p: FormatPrefs): string` (K / M / B)
  - `formatPercent(ratio: number | null | undefined, p: FormatPrefs, digits?: number): string` (`0.048` → `4.8%`)
  - `formatDelta(ratio: number | null | undefined, p: FormatPrefs, digits?: number): string` (`+3.2%`, `-3.2%`, `0.0%`)
  - Missing/invalid input always yields `'—'` (U+2014).

- [ ] **Step 1: Write the failing tests**

Create `tests/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatCompact, formatDate, formatDateTime, formatDelta, formatNumber, formatPercent, formatTime, type FormatPrefs } from '@/lib/format';

const P: FormatPrefs = { locale: 'en', dateFormat: 'DD/MM/YYYY', timeFormat: '24h', numberFormat: '1,234.5', timezone: 'Asia/Kuala_Lumpur' };
const with_ = (o: Partial<FormatPrefs>): FormatPrefs => ({ ...P, ...o });
// 16:02 UTC on 13 Oct is 00:02 on 14 Oct in Kuala Lumpur (UTC+8)
const T = '2026-10-13T16:02:00Z';
const NBSP = ' ';

describe('formatDate', () => {
  it('renders every date format in the user timezone (not UTC)', () => {
    expect(formatDate(T, with_({ dateFormat: 'YYYY-MM-DD' }))).toBe('2026-10-14');
    expect(formatDate(T, with_({ dateFormat: 'DD/MM/YYYY' }))).toBe('14/10/2026');
    expect(formatDate(T, with_({ dateFormat: 'MM/DD/YYYY' }))).toBe('10/14/2026');
    expect(formatDate(T, with_({ dateFormat: 'D MMM YYYY' }))).toBe('14 Oct 2026');
  });

  it('uses the Chinese pattern for D MMM YYYY when the locale is zh-CN', () => {
    expect(formatDate(T, with_({ dateFormat: 'D MMM YYYY', locale: 'zh-CN' }))).toBe('2026年10月14日');
  });

  it('the same instant shows a different calendar day in UTC', () => {
    expect(formatDate(T, with_({ timezone: 'UTC' }))).toBe('13/10/2026');
  });

  it('accepts Date, ISO string and epoch milliseconds', () => {
    const ms = Date.parse(T);
    expect(formatDate(new Date(ms), P)).toBe('14/10/2026');
    expect(formatDate(ms, P)).toBe('14/10/2026');
  });

  it('falls back to UTC for an invalid timezone instead of throwing', () => {
    expect(formatDate(T, with_({ timezone: 'Not/AZone' }))).toBe('13/10/2026');
  });

  it.each([null, undefined, 'garbage', NaN, new Date('nope')])('shows an em dash for invalid input %j', (v) => {
    expect(formatDate(v as never, P)).toBe('—');
  });
});

describe('formatTime', () => {
  it('24h is zero padded and handles midnight as 00', () => {
    expect(formatTime(T, P)).toBe('00:02');
    expect(formatTime('2026-10-13T08:05:00Z', P)).toBe('16:05');
  });

  it('12h english uses AM/PM with no leading zero', () => {
    expect(formatTime(T, with_({ timeFormat: '12h' }))).toBe('12:02 AM');
    expect(formatTime('2026-10-13T08:05:00Z', with_({ timeFormat: '12h' }))).toBe('4:05 PM');
    expect(formatTime('2026-10-13T04:00:00Z', with_({ timeFormat: '12h' }))).toBe('12:00 PM');
  });

  it('12h chinese uses 上午/下午', () => {
    expect(formatTime(T, with_({ timeFormat: '12h', locale: 'zh-CN' }))).toBe('上午12:02');
    expect(formatTime('2026-10-13T08:05:00Z', with_({ timeFormat: '12h', locale: 'zh-CN' }))).toBe('下午4:05');
  });

  it('follows daylight saving time (America/New_York, 8 March 2026)', () => {
    const ny = with_({ timezone: 'America/New_York' });
    expect(formatTime('2026-03-08T06:30:00Z', ny)).toBe('01:30'); // still EST
    expect(formatTime('2026-03-08T07:30:00Z', ny)).toBe('03:30'); // EDT began at 07:00Z
  });

  it('shows an em dash for invalid input', () => {
    expect(formatTime(null, P)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('joins date and time with a space', () => {
    expect(formatDateTime(T, P)).toBe('14/10/2026 00:02');
    expect(formatDateTime('nope', P)).toBe('—');
  });
});

describe('formatNumber', () => {
  it('supports the three separator styles', () => {
    expect(formatNumber(1234567.891, P)).toBe('1,234,567.89');
    expect(formatNumber(1234567.891, with_({ numberFormat: '1.234,5' }))).toBe('1.234.567,89');
    expect(formatNumber(1234567.891, with_({ numberFormat: '1 234,5' }))).toBe(`1${NBSP}234${NBSP}567,89`);
  });

  it('honours fraction digit options, zero and negatives', () => {
    expect(formatNumber(1234.5, P, { maximumFractionDigits: 0 })).toBe('1,235');
    expect(formatNumber(0, P)).toBe('0');
    expect(formatNumber(-1234.5, P)).toBe('-1,234.5');
    expect(formatNumber(2, P, { minimumFractionDigits: 1 })).toBe('2.0');
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])('shows an em dash for %j', (v) => {
    expect(formatNumber(v as never, P)).toBe('—');
  });
});

describe('formatCompact', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [12480, '12.5K'],
    [184200, '184K'],
    [999_999, '1M'], // must roll over, never "1,000K"
    [1_500_000, '1.5M'],
    [2_000_000_000, '2B'],
    [-2500, '-2.5K'],
  ])('%j -> %s', (n, expected) => {
    expect(formatCompact(n, P)).toBe(expected);
  });

  it('uses the decimal separator of the chosen number format', () => {
    expect(formatCompact(12480, with_({ numberFormat: '1.234,5' }))).toBe('12,5K');
  });

  it('shows an em dash for missing data', () => {
    expect(formatCompact(null, P)).toBe('—');
    expect(formatCompact(NaN, P)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats a ratio with one decimal by default', () => {
    expect(formatPercent(0.048, P)).toBe('4.8%');
    expect(formatPercent(0.5, P, 0)).toBe('50%');
    expect(formatPercent(0.048, with_({ numberFormat: '1.234,5' }))).toBe('4,8%');
  });

  it('shows an em dash for missing data', () => {
    expect(formatPercent(undefined, P)).toBe('—');
    expect(formatPercent(Infinity, P)).toBe('—');
  });
});

describe('formatDelta', () => {
  it('signs positive and negative changes', () => {
    expect(formatDelta(0.032, P)).toBe('+3.2%');
    expect(formatDelta(-0.032, P)).toBe('-3.2%');
  });

  it('never prints a signed zero ("-0.0%" or "+0.0%")', () => {
    expect(formatDelta(0, P)).toBe('0.0%');
    expect(formatDelta(-0.0004, P)).toBe('0.0%');
    expect(formatDelta(0.0004, P)).toBe('0.0%');
  });

  it('shows an em dash for missing data', () => {
    expect(formatDelta(null, P)).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 3: Implement `lib/format.ts`**

```ts
import type { Prefs } from '@/lib/prefs';

export type FormatPrefs = Pick<Prefs, 'locale' | 'dateFormat' | 'timeFormat' | 'numberFormat' | 'timezone'>;
export type DateInput = Date | string | number | null | undefined;

const DASH = '—';
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Calendar/clock parts of an instant in a given timezone (24h clock, zero padded). */
function parts(d: Date, tz: string): { year: string; month: string; day: string; hour: string; minute: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: o.minute };
}

export function formatDate(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  if (!d) return DASH;
  const { year, month, day } = parts(d, p.timezone);
  switch (p.dateFormat) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'D MMM YYYY':
      return p.locale === 'zh-CN' ? `${year}年${Number(month)}月${Number(day)}日` : `${Number(day)} ${MONTHS_EN[Number(month) - 1]} ${year}`;
  }
}

export function formatTime(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  if (!d) return DASH;
  const { hour, minute } = parts(d, p.timezone);
  if (p.timeFormat === '24h') return `${hour}:${minute}`;
  const h = Number(hour);
  const h12 = h % 12 || 12;
  return p.locale === 'zh-CN' ? `${h < 12 ? '上午' : '下午'}${h12}:${minute}` : `${h12}:${minute} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDateTime(v: DateInput, p: FormatPrefs): string {
  const d = toDate(v);
  return d ? `${formatDate(d, p)} ${formatTime(d, p)}` : DASH;
}

const NUMBER_LOCALE = { '1,234.5': 'en-US', '1.234,5': 'de-DE', '1 234,5': 'fr-FR' } as const;

function isNum(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function formatNumber(
  n: number | null | undefined,
  p: FormatPrefs,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  if (!isNum(n)) return DASH;
  const out = new Intl.NumberFormat(NUMBER_LOCALE[p.numberFormat], {
    maximumFractionDigits: opts.maximumFractionDigits ?? Math.max(2, opts.minimumFractionDigits ?? 0),
    minimumFractionDigits: opts.minimumFractionDigits,
  }).format(n);
  // ICU uses U+202F or U+00A0 depending on version; normalise to a non-breaking space.
  return out.replace(/[  ]/g, ' ');
}

const UNITS = [
  [1, ''],
  [1e3, 'K'],
  [1e6, 'M'],
  [1e9, 'B'],
] as const;

export function formatCompact(n: number | null | undefined, p: FormatPrefs): string {
  if (!isNum(n)) return DASH;
  let i = 0;
  while (i < UNITS.length - 1 && Math.abs(n) >= UNITS[i + 1][0]) i++;
  let v = n / UNITS[i][0];
  let digits = i > 0 && Math.abs(v) < 100 ? 1 : 0;
  // 999,999 -> "1000K" must roll over to "1M"
  if (i < UNITS.length - 1 && Math.abs(Number(v.toFixed(digits))) >= 1000) {
    i++;
    v = n / UNITS[i][0];
    digits = Math.abs(v) < 100 ? 1 : 0;
  }
  return formatNumber(v, p, { maximumFractionDigits: digits }) + UNITS[i][1];
}

export function formatPercent(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
  if (!isNum(ratio)) return DASH;
  return `${formatNumber(ratio * 100, p, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function formatDelta(ratio: number | null | undefined, p: FormatPrefs, digits = 1): string {
  if (!isNum(ratio)) return DASH;
  const pct = ratio * 100;
  if (Number(pct.toFixed(digits)) === 0) return `${formatNumber(0, p, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  const body = formatNumber(Math.abs(pct), p, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${pct > 0 ? '+' : '-'}${body}%`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS. If a test fails only because the installed ICU renders something different (for example the zh-CN or `fr-FR` separators), fix the implementation, not the expectation, unless the expectation contradicts the plan's stated behaviour — then stop and report.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: locale-aware formatting library (dates, times, numbers) with edge-case tests" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: i18n (next-intl, en + zh-CN)

**Files:**
- Create: `lib/merge.ts`, `lib/prefs.server.ts`, `i18n/request.ts`, `messages/en.json`, `messages/zh-CN.json`, `tests/merge.test.ts`, `tests/messages.test.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `parsePrefsCookie`, `PREFS_COOKIE`, `Prefs` from `@/lib/prefs`.
- Produces:
  - `deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T` from `@/lib/merge` — override wins; missing keys fall back to base; arrays/primitives replaced wholesale.
  - `getPrefs(): Promise<Prefs>` from `@/lib/prefs.server` (reads the cookie via `next/headers`).
  - next-intl request config (default export of `i18n/request.ts`): locale from prefs, messages = English merged with the selected locale.
  - Message namespaces: `common`, `nav`, `prefs`, `styleguide` (exact keys below).

- [ ] **Step 1: Write the failing merge test**

Create `tests/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deepMerge } from '@/lib/merge';

describe('deepMerge', () => {
  it('override wins, missing keys fall back to base, nesting is merged', () => {
    const base = { a: 'A', n: { x: 'X', y: 'Y' }, only: 'base' };
    const merged = deepMerge(base, { a: '甲', n: { y: '乙' } });
    expect(merged).toEqual({ a: '甲', n: { x: 'X', y: '乙' }, only: 'base' });
  });

  it('does not mutate its inputs', () => {
    const base = { n: { x: 'X' } };
    const override = { n: { x: 'Z' } };
    deepMerge(base, override);
    expect(base).toEqual({ n: { x: 'X' } });
    expect(override).toEqual({ n: { x: 'Z' } });
  });

  it('ignores prototype-pollution keys', () => {
    const merged = deepMerge({ a: 'A' }, JSON.parse('{"__proto__":{"polluted":"yes"},"a":"B"}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(merged.a).toBe('B');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/merge.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `lib/merge.ts`**

```ts
type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Returns a new object: `override` wins, anything missing falls back to `base`. Never mutates inputs. */
export function deepMerge<T extends Dict>(base: T, override: Dict): T {
  const out: Dict = { ...base };
  for (const key of Object.keys(override)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const o = override[key];
    const b = out[key];
    out[key] = isDict(b) && isDict(o) ? deepMerge(b, o) : o;
  }
  return out as T;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/merge.test.ts` → PASS.

- [ ] **Step 5: Write the failing messages test**

Create `tests/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

function flatten(o: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const fe = flatten(en);
const fz = flatten(zh);

describe('message catalogs', () => {
  it('zh-CN has exactly the same keys as en (nothing missing, nothing stale)', () => {
    expect(Object.keys(fz).sort()).toEqual(Object.keys(fe).sort());
  });

  it('no message is empty', () => {
    for (const [k, v] of Object.entries(fe)) expect(v.trim(), `en ${k}`).not.toBe('');
    for (const [k, v] of Object.entries(fz)) expect(v.trim(), `zh-CN ${k}`).not.toBe('');
  });

  it('{placeholders} match between locales for every key', () => {
    for (const k of Object.keys(fe)) expect(placeholders(fz[k] ?? ''), `placeholders of ${k}`).toBe(placeholders(fe[k]));
  });

  it('zh-CN actually differs from en for translatable text (guards against copy-pasted English)', () => {
    const same = Object.keys(fe).filter((k) => fe[k] === fz[k] && /[A-Za-z]{4,}/.test(fe[k]));
    expect(same, `untranslated keys: ${same.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 6: Run to verify failure** — `npx vitest run tests/messages.test.ts` → FAIL (JSON files missing).

- [ ] **Step 7: Create the message catalogs**

`messages/en.json`:

```json
{
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "loading": "Loading…",
    "empty": "No data yet"
  },
  "nav": {
    "overview": "Overview",
    "accounts": "Accounts",
    "tags": "Tags",
    "settings": "Settings"
  },
  "prefs": {
    "theme": "Theme",
    "mode": "Mode",
    "light": "Light",
    "dark": "Dark",
    "density": "Density",
    "dense": "Dense",
    "comfortable": "Comfortable",
    "radius": "Corners",
    "sharp": "Sharp",
    "soft": "Soft",
    "round": "Round",
    "language": "Language",
    "dateFormat": "Date format"
  },
  "styleguide": {
    "title": "Style guide",
    "intro": "Live preview of the design tokens and formats. Changes are saved to your preferences.",
    "tokens": "Colour tokens",
    "chart": "Chart series",
    "formats": "Formats",
    "sampleDate": "Date",
    "sampleTime": "Time",
    "sampleNumber": "Number",
    "sampleCompact": "Compact",
    "samplePercent": "Percent",
    "sampleDelta": "Change",
    "greeting": "Welcome back, {name}"
  }
}
```

`messages/zh-CN.json`:

```json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "loading": "加载中…",
    "empty": "暂无数据"
  },
  "nav": {
    "overview": "总览",
    "accounts": "账号",
    "tags": "标签",
    "settings": "设置"
  },
  "prefs": {
    "theme": "主题",
    "mode": "模式",
    "light": "浅色",
    "dark": "深色",
    "density": "密度",
    "dense": "紧凑",
    "comfortable": "舒适",
    "radius": "圆角",
    "sharp": "直角",
    "soft": "柔和",
    "round": "圆润",
    "language": "语言",
    "dateFormat": "日期格式"
  },
  "styleguide": {
    "title": "样式指南",
    "intro": "设计令牌与格式的实时预览。更改会保存到你的偏好设置。",
    "tokens": "颜色令牌",
    "chart": "图表系列",
    "formats": "格式",
    "sampleDate": "日期",
    "sampleTime": "时间",
    "sampleNumber": "数字",
    "sampleCompact": "紧凑数字",
    "samplePercent": "百分比",
    "sampleDelta": "变化",
    "greeting": "欢迎回来,{name}"
  }
}
```

- [ ] **Step 8: Run to verify pass** — `npx vitest run tests/messages.test.ts` → PASS.

- [ ] **Step 9: Server-side prefs reader**

Create `lib/prefs.server.ts`:

```ts
import { cookies } from 'next/headers';
import { PREFS_COOKIE, parsePrefsCookie, type Prefs } from '@/lib/prefs';

/** Reads the preferences cookie for the current request. Always returns valid prefs. */
export async function getPrefs(): Promise<Prefs> {
  const jar = await cookies();
  return parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
}
```

- [ ] **Step 10: next-intl request config**

Create `i18n/request.ts`:

```ts
import { getRequestConfig } from 'next-intl/server';
import { getPrefs } from '@/lib/prefs.server';
import { deepMerge } from '@/lib/merge';
import en from '../messages/en.json';

export default getRequestConfig(async () => {
  const { locale, timezone } = await getPrefs();
  // English is always the base, so a key missing in another locale shows English instead of a raw key.
  const messages = locale === 'en' ? en : deepMerge(en, (await import(`../messages/${locale}.json`)).default);
  return { locale, messages, timeZone: timezone };
});
```

Replace `next.config.ts` with:

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {};

export default withNextIntl(nextConfig);
```

- [ ] **Step 11: Verify**

Run: `npm run lint && npm run typecheck && npm test`
Expected: pass. (Do not run `npm run build` yet; the layout is wired in Task 6.)

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: next-intl setup with en + zh-CN catalogs, parity tests and English fallback" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Preferences provider, server action and root layout

**Files:**
- Create: `components/providers/PrefsProvider.tsx`, `app/actions.ts`, `tests/prefs-provider.test.tsx`
- Modify: `app/layout.tsx` (replace entirely)

**Interfaces:**
- Consumes: `Prefs`, `htmlAttrs`, `parsePrefs`, `parsePrefsCookie`, `serializePrefs`, `PREFS_COOKIE` from `@/lib/prefs`; `getPrefs` from `@/lib/prefs.server`.
- Produces:
  - `PrefsProvider({ initial: Prefs; persist: (partial: Partial<Prefs>) => Promise<void> | void; children })` — client component.
  - `usePrefs(): { prefs: Prefs; update: (partial: Partial<Prefs>) => void }` — throws `usePrefs must be used inside <PrefsProvider>` outside the provider.
  - `applyPrefsToDocument(p: Prefs, el?: HTMLElement): void`.
  - Server action `setPrefs(partial: unknown): Promise<void>` from `@/app/actions` — validates, merges onto the current cookie, writes the cookie (1 year, `lax`), calls `revalidatePath('/', 'layout')`.
  - Root layout writes `<html {...htmlAttrs(prefs)}>`.

- [ ] **Step 1: Write the failing provider tests**

Create `tests/prefs-provider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

function Probe() {
  const { prefs, update } = usePrefs();
  return (
    <div>
      <span data-testid="mode">{prefs.mode}</span>
      <span data-testid="theme">{prefs.theme}</span>
      <button onClick={() => update({ mode: 'dark' })}>dark</button>
      <button onClick={() => update({ theme: 'bogus' as never })}>bad theme</button>
    </div>
  );
}

const html = () => document.documentElement;

describe('PrefsProvider', () => {
  it('applies attributes to <html> immediately and persists only the changed fields', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(html().getAttribute('data-mode')).toBe('dark');
    expect(persist).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('an invalid value never reaches state or the DOM', async () => {
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('bad theme'));
    expect(screen.getByTestId('theme')).toHaveTextContent(DEFAULT_PREFS.theme);
    expect(html().getAttribute('data-theme')).toBe(DEFAULT_PREFS.theme);
  });

  it('keeps the new preference locally even if persisting fails', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('network'));
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('usePrefs outside the provider throws a helpful error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('usePrefs must be used inside <PrefsProvider>');
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/prefs-provider.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement the provider**

Create `components/providers/PrefsProvider.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { htmlAttrs, parsePrefs, type Prefs } from '@/lib/prefs';

type Persist = (partial: Partial<Prefs>) => Promise<void> | void;

interface PrefsContextValue {
  prefs: Prefs;
  update: (partial: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

export function applyPrefsToDocument(p: Prefs, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(htmlAttrs(p))) el.setAttribute(name, value);
}

export function PrefsProvider({ initial, persist, children }: { initial: Prefs; persist: Persist; children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);

  const update = useCallback(
    (partial: Partial<Prefs>) => {
      const next = parsePrefs({ ...prefs, ...partial }); // validates: bad values fall back
      setPrefs(next);
      applyPrefsToDocument(next); // instant, no waiting for the server
      // ponytail: failures are swallowed — the choice stays local until the next successful save
      void Promise.resolve(persist(partial)).catch(() => {});
    },
    [prefs, persist],
  );

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/prefs-provider.test.tsx` → PASS.

- [ ] **Step 5: Server action**

Create `app/actions.ts`:

```ts
'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { PREFS_COOKIE, parsePrefs, parsePrefsCookie, serializePrefs } from '@/lib/prefs';

/** Merge a partial update onto the current preferences cookie. Input is untrusted: parsePrefs validates every field. */
export async function setPrefs(partial: unknown): Promise<void> {
  const jar = await cookies();
  const current = parsePrefsCookie(jar.get(PREFS_COOKIE)?.value);
  const patch = partial !== null && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
  const next = parsePrefs({ ...current, ...patch });
  jar.set(PREFS_COOKIE, serializePrefs(next), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}
```

- [ ] **Step 6: Root layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { htmlAttrs } from '@/lib/prefs';
import { getPrefs } from '@/lib/prefs.server';
import { setPrefs } from '@/app/actions';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'in2sight',
  description: 'Instagram insights across all your accounts',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const prefs = await getPrefs();
  const messages = await getMessages();
  return (
    <html {...htmlAttrs(prefs)} className={inter.variable}>
      <body>
        <NextIntlClientProvider locale={prefs.locale} messages={messages}>
          <PrefsProvider initial={prefs} persist={setPrefs}>
            {children}
          </PrefsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass. (The scaffold's `app/page.tsx` still renders; it is replaced in Task 7.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: cookie-backed preferences provider, server action and root layout" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: PrefsBar, `/styleguide` skeleton, docs and final verification

**Files:**
- Create: `components/shared/PrefsBar.tsx`, `app/styleguide/page.tsx`, `tests/prefs-bar.test.tsx`
- Modify: `app/page.tsx` (replace), `CLAUDE.md`, `docs/SPEC.md`, `docs/TODO.md`

**Interfaces:**
- Consumes: `usePrefs`/`PrefsProvider` (Task 6), `THEMES MODES DENSITIES RADII LOCALES DATE_FORMATS` and `Prefs` (Task 3), `format*` (Task 4), message keys from Task 5.
- Produces: `PrefsBar()` client component; route `/styleguide`; `/` redirects to `/styleguide`.

- [ ] **Step 1: Write the failing PrefsBar tests**

Create `tests/prefs-bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { DATE_FORMATS, DEFAULT_PREFS } from '@/lib/prefs';

function setup(persist = vi.fn(), locale: 'en' | 'zh-CN' = 'en') {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={persist}>
        <PrefsBar />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return persist;
}

describe('PrefsBar', () => {
  it('marks the current theme as pressed and switches theme on click', async () => {
    const persist = setup();
    expect(screen.getByRole('button', { name: 'Ink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sunset' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Sunset' }));
    expect(screen.getByRole('button', { name: 'Sunset' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(persist).toHaveBeenCalledWith({ theme: 'sunset' });
  });

  it('switches mode and writes data-mode on <html>', async () => {
    const persist = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(persist).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('offers every date format and persists the chosen one', async () => {
    const persist = setup();
    for (const f of DATE_FORMATS) expect(screen.getByRole('button', { name: f })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'DD/MM/YYYY' }));
    expect(persist).toHaveBeenCalledWith({ dateFormat: 'DD/MM/YYYY' });
  });

  it('renders translated labels in Chinese', () => {
    setup(vi.fn(), 'zh-CN');
    expect(screen.getByRole('button', { name: '深色' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '紧凑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '简体中文' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/prefs-bar.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement `components/shared/PrefsBar.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DATE_FORMATS, DENSITIES, LOCALES, MODES, RADII, THEMES, type Prefs } from '@/lib/prefs';

// proper nouns / literal formats are not translated
const LITERAL: Record<string, string> = { ink: 'Ink', sunset: 'Sunset', forest: 'Forest', mono: 'Mono', en: 'English', 'zh-CN': '简体中文' };

function Choice({ field, label, options }: { field: keyof Prefs; label: string; options: readonly string[] }) {
  const t = useTranslations('prefs');
  const { prefs, update } = usePrefs();
  const text = (o: string) => LITERAL[o] ?? (t.has(o) ? t(o) : o);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[length:var(--lb)] text-muted-foreground">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={prefs[field] === o}
          onClick={() => update({ [field]: o } as Partial<Prefs>)}
          className="h-[var(--ctl-sm)] rounded-md border border-border bg-card px-2.5 text-[length:var(--lb)] font-medium transition-colors hover:bg-hover aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
        >
          {text(o)}
        </button>
      ))}
    </div>
  );
}

export function PrefsBar() {
  const t = useTranslations('prefs');
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border bg-card p-[var(--pc)]">
      <Choice field="theme" label={t('theme')} options={THEMES} />
      <Choice field="mode" label={t('mode')} options={MODES} />
      <Choice field="density" label={t('density')} options={DENSITIES} />
      <Choice field="radius" label={t('radius')} options={RADII} />
      <Choice field="locale" label={t('language')} options={LOCALES} />
      <Choice field="dateFormat" label={t('dateFormat')} options={DATE_FORMATS} />
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/prefs-bar.test.tsx` → PASS (4 tests).

- [ ] **Step 5: The `/styleguide` skeleton page**

Create `app/styleguide/page.tsx`:

```tsx
import { getTranslations } from 'next-intl/server';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { formatCompact, formatDate, formatDelta, formatNumber, formatPercent, formatTime } from '@/lib/format';
import { getPrefs } from '@/lib/prefs.server';

const SWATCHES = ['background', 'surface', 'surface-2', 'border', 'foreground', 'muted-foreground', 'primary', 'primary-foreground', 'accent', 'success', 'warning', 'danger'];
const SAMPLE_INSTANT = new Date('2026-10-13T16:02:00Z');

export default async function StyleguidePage() {
  const t = await getTranslations('styleguide');
  const prefs = await getPrefs();
  const rows: [string, string][] = [
    [t('sampleDate'), formatDate(SAMPLE_INSTANT, prefs)],
    [t('sampleTime'), formatTime(SAMPLE_INSTANT, prefs)],
    [t('sampleNumber'), formatNumber(1234567.891, prefs)],
    [t('sampleCompact'), formatCompact(184200, prefs)],
    [t('samplePercent'), formatPercent(0.048, prefs)],
    [t('sampleDelta'), formatDelta(0.032, prefs)],
  ];

  return (
    <main className="mx-auto flex max-w-[1600px] flex-col gap-[var(--gp)] p-[var(--pg)]">
      <header>
        <h1 className="text-[length:var(--fv)] font-semibold leading-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro')}</p>
      </header>

      <PrefsBar />

      <section className="rounded-lg border border-border bg-card p-[var(--pc)]">
        <h2 className="mb-3 text-[length:var(--fh)] font-medium">{t('tokens')}</h2>
        <div className="grid grid-cols-2 gap-[var(--gp)] sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map((n) => (
            <div key={n} className="overflow-hidden rounded-md border border-border">
              <div className="h-10 border-b border-border" style={{ background: `var(--${n})` }} />
              <div className="p-2 text-[length:var(--lb)]">
                <div className="font-medium">{n}</div>
                <div className="text-muted-foreground">--{n}</div>
              </div>
            </div>
          ))}
        </div>
        <h3 className="mb-2 mt-4 text-[length:var(--fh)] font-medium">{t('chart')}</h3>
        <div className="grid grid-cols-3 gap-[var(--gp)] sm:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="h-10 rounded-md border border-border" style={{ background: `var(--chart-${n})` }} title={`--chart-${n}`} />
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-[var(--pc)]">
        <h2 className="mb-3 text-[length:var(--fh)] font-medium">{t('formats')}</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-muted-foreground">{t('greeting', { name: 'Yong Sen' })}</p>
      </section>
    </main>
  );
}
```

Replace `app/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/styleguide');
}
```

- [ ] **Step 6: Full verification**

Run: `npm run check`
Expected: lint, typecheck, all tests, and build pass.

Then verify visually:

```bash
npm run dev
```

Open `http://localhost:3000/` (redirects to `/styleguide`) and check:
1. Clicking each theme / Light-Dark / Dense-Comfortable / radius button changes colours, spacing and corners immediately.
2. Clicking 简体中文 changes the headings to Chinese; reloading the page keeps the choice (cookie).
3. Each date-format button changes the Date row; Time/Number rows show the formats from defaults.
4. No horizontal scroll at a 360px wide window.

Optional automated screenshot (Edge is installed on this machine):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=360,900 --virtual-time-budget=6000 --screenshot=styleguide-360.png http://localhost:3000/styleguide
```

Do not commit screenshots. Stop the dev server afterwards.

If changing the language does not update the page text without a manual reload, add `useRouter().refresh()` after `persist` for the `locale` key in a small client wrapper and re-run the checks — and report it.

- [ ] **Step 7: Update the docs**

In `docs/SPEC.md` make two replacements:
- `TanStack Table, next-intl, next-themes, Recharts, GSAP (motion)` → `TanStack Table, next-intl, Recharts, GSAP (motion)`
- `` `next-themes` persists choice without flash. `` → `The choice lives in a cookie and is applied to `<html>` attributes on the server (no flash, no extra dependency).`

In `docs/TODO.md`:
- `- [ ] Next.js (TS, App Router) scaffold, deploy empty app to Vercel` → `- [x] Next.js (TS, App Router) scaffold` and add a new line below it: `- [ ] Deploy to Vercel (Plan 3)`
- `- [ ] Theme tokens + 4 themes (Ink, Sunset, Forest, Mono) × light/dark (next-themes); radius presets; chart-color contrast check` → `- [x] Theme tokens + 4 themes (Ink, Sunset, Forest, Mono) × light/dark; radius presets; text-contrast test (chart colours are checked visually in the styleguide)`
- `- [ ] next-intl with en + zh-CN, missing-key test, language switcher` → `- [x] next-intl with en + zh-CN, key/placeholder parity test, language switcher (PrefsBar)`
- `- [ ] \`lib/format.ts\` (date/time/number per user settings) + \`lib/metrics.ts\` registry` → `- [x] \`lib/format.ts\` (date/time/number per user settings)` and a new line below: `- [ ] \`lib/metrics.ts\` registry (Plan 2/6)`

In `CLAUDE.md`, insert this section immediately before `## Workflow rules`:

```markdown
## Commands
- `npm run dev` — dev server (http://localhost:3000, redirects to `/styleguide` until real pages exist)
- `npm test` — Vitest (unit + component tests in `tests/`); `npm run test:watch` while developing
- `npm run check` — lint + typecheck + tests + build; must pass before any task is called done
- Mockups (visual reference): `node docs/mockups/serve.cjs` → http://localhost:5173/
```

- [ ] **Step 8: Final check and commit**

Run: `npm run check` (expected: pass).

```bash
git add -A
git commit -m "feat: PrefsBar switchers and /styleguide skeleton; update docs for foundation core" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Do **not** merge or push: the whole-branch review comes next, then the owner decides on merge/push.

---

## Self-Review (done while writing)

**Spec coverage (Plan 1 scope only):** tokens/themes/radius/density/mode (Task 2) ✔; preferences incl. date/time/number format, week start, timezone, locale (Task 3) ✔; `lib/format.ts` as the single formatting path (Task 4) ✔; next-intl en + zh-CN with parity test (Task 5) ✔; cookie-driven `<html>` attributes without next-themes, spec updated (Tasks 6–7) ✔; responsive 360px sanity check (Task 7) ✔; formats are user settings, cookie cached (spec §8b.7 — Supabase `profiles` sync is deliberately deferred to Plan 3). Out of scope here and covered by later plans: shadcn components, AppShell, charts, auth, PWA, Supabase.

**Placeholder scan:** none; every step has code or an exact command.

**Type consistency:** `Prefs`/`FormatPrefs`/`htmlAttrs`/`PrefsProvider`/`usePrefs`/`setPrefs`/`getPrefs`/`parsePrefsCookie` names match across Tasks 3–7; `FormatPrefs` is a `Pick` of `Prefs`, so the `Prefs` object from `getPrefs()` is directly passable to every `format*` function.

**Review Focus coverage:** items 1 → Task 3 tests; 2 and 3 → Task 4 tests; 4 → Task 5 tests (parity, placeholders) plus the English-base merge in `i18n/request.ts`; 5 → Task 3 `htmlAttrs` test and Task 6 provider tests.
