// Generates the PWA icons in public/icons/ from the brand mark (the conic-gradient tile in components/shared/AppShell.tsx
// with a white lens), using only Node's zlib: no image library. Run once and commit the PNGs:
//   node scripts/make-icons.mjs
// Colours = Ink light --chart-1 / --chart-5 / --chart-4 from styles/tokens.css (tests/pwa.test.ts keeps them in sync).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const STOPS = ['#4F46E5', '#EC4899', '#F59E0B', '#4F46E5'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const SS = 4; // 4×4 supersampling for smooth edges

/** Conic gradient from 210° (clockwise from 12 o'clock), like the CSS in AppShell. */
function gradient(dx, dy) {
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI - 210 + 720) % 360;
  const t = (deg / 360) * (STOPS.length - 1);
  const i = Math.min(Math.floor(t), STOPS.length - 2);
  const f = t - i;
  return STOPS[i].map((c, k) => c + (STOPS[i + 1][k] - c) * f);
}

/** RGBA at a point in unit space (0..1). rounded: transparent corners (radius 22%); else full bleed (maskable / Apple). */
function sample(x, y, rounded) {
  const r = 0.22;
  if (rounded) {
    const cx = Math.min(Math.max(x, r), 1 - r);
    const cy = Math.min(Math.max(y, r), 1 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return [0, 0, 0, 0];
  }
  const dx = x - 0.5;
  const dy = y - 0.5;
  const d = Math.hypot(dx, dy);
  // the mark sits inside the 80% maskable safe zone: a ring and a dot
  if ((d > 0.17 && d < 0.25) || d < 0.075) return [255, 255, 255, 255];
  return [...gradient(dx, dy), 255];
}

function png(size, rounded) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const p = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, rounded);
          for (let k = 0; k < 3; k++) acc[k] += p[k] * p[3]; // premultiply so transparent samples don't darken edges
          acc[3] += p[3];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = acc[3] ? Math.round(acc[k] / acc[3]) : 0;
      raw[o + 3] = Math.round(acc[3] / (SS * SS));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = join(process.cwd(), 'public/icons');
mkdirSync(out, { recursive: true });
for (const [name, size, rounded] of [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, false], // iOS paints transparency black: full bleed
]) {
  writeFileSync(join(out, name), png(size, rounded));
  console.log(`public/icons/${name}`);
}
