# in2Sight brand kit

The logo is the letters **i**, **2** and **S** (Instagram **to** Insight). The icon holds `i2S` in one container; the same container grows into the full `in2Sight` wordmark. Letterforms are Outfit ExtraBold, converted to outlines, with tracking of -0.04 em so the letters touch like one word.

> **Status:** designed, exported and wired into the app: `components/shared/Logo.tsx` (sidebar, phone header, login page), `public/icons/*`, `app/favicon.ico`, the manifest and the page title ("in2Sight"). The brand colours are the `--brand-1/2/3/tile` tokens in `styles/tokens.css` (a test keeps them equal to the exported SVG colours). The older conic-gradient icon script was removed. Prose strings elsewhere in the app still say "in2sight"; the display name in titles and the manifest is "in2Sight".

## Files

| File | Use |
|---|---|
| `wordmark-on-dark.svg` / `.png` | full logo on dark backgrounds (colour) |
| `wordmark-on-light.svg` / `.png` | full logo on light backgrounds (colour, deeper hues for contrast) |
| `wordmark-white.svg`, `wordmark-black.svg` | one-colour versions (print, watermarks, embroidery) |
| `icon.svg`, `icon-1024.png`, `icon-512.png`, `icon-192.png` | app icon: dark rounded tile with a thin blue ring and `i2S` |
| `icon-maskable.svg`, `maskable-512.png` | PWA maskable icon (full-bleed, letters inside the safe zone) |
| `apple-touch-icon.png` | 180 px full-bleed icon for iOS |
| `favicon.svg`, `favicon.ico` (16, 32, 48), `favicon-16/32/48.png` | browser tab icon: the **S** alone (three letters turn to mush below 32 px) |
| `social-preview.svg` / `.png` | 1280 x 640 GitHub social preview and grant-application header |

## Colours

| Role | Dark background | Light background |
|---|---|---|
| `i` (teal) | `#2fd6c1` | `#14b8a6` |
| `2` (blue) | `#4a8df0` | `#2f7de0` |
| `S` (indigo) | `#6a5cf5` | `#5b4be0` |
| Other letters (`n`, `ight`) | `#cfd6ee` | `#1b2340` |
| Icon tile | `#131a31` | n/a |
| Icon ring | `#4a8df0` at 50% | n/a |
| Page background used in mock-ups | `#0b1020` | `#f4f6fb` |

Deliberately nothing like Instagram's pink, purple and orange, and no camera or square-with-circle shape.

## The transition (icon to full logo)

Four stages, same letters at the same size, only the container changes:

1. **Icon:** tile holding `i2S` (radius about 24% of the height).
2. **Grows:** `n` slides in between `i` and `2`; `ight` follows; the container stretches and its radius rises towards a pill (50% of the height).
3. **Full:** a pill holding `in2Sight`.
4. **Open:** the container fades out; the open wordmark remains. Letters keep their colours throughout.

Reference timing for a live version: one leg 3.4 s, ease-in-out, `n` appears at 10-38%, `ight` at 20-52%, container fade at 60-88%, with a pause at each end; reverse to collapse. Respect `prefers-reduced-motion` (show the full state, no animation). A live prototype was built on the design canvas during the brand session.

## Usage rules

- Keep clear space around the wordmark equal to the height of the `i` dot.
- Minimum sizes: wordmark 80 px wide; icon 32 px; below that use the favicon (S only).
- Use the colour wordmark on dark or the light-background version on light; never place the dark-background colours on white.
- Do not change the letter colours, tracking or proportions, add effects, or rotate the mark.
- Do not combine it with Instagram or Meta marks. in2Sight is independent and not affiliated with Meta or Instagram.

## Font licence

The letterforms come from **Outfit** by the Outfit Project Authors, licensed under the SIL Open Font License 1.1 (https://openfontlicense.org). The logo files contain outlines of the glyphs, which the licence permits; the font file itself is not shipped here.

## Regenerating

The files were generated from Outfit ExtraBold and Medium outlines with a small throwaway script (opentype.js for the outlines, the repo's `sharp` for PNG and ICO). The SVGs here are the source of truth; edit those directly if you need a tweak.
