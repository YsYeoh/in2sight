'use client';

// Decorative audience globe (SPEC §8): a slowly rotating orthographic sphere with a graticule and one dot per country,
// sized by audience share. Plain canvas 2D, no dependency. Loaded with next/dynamic({ ssr: false }) and rendered ONLY
// when useHeavyMotion() allows; the ranked country list next to it carries the same data for everyone (aria-hidden here).
// Colours are theme tokens read from CSS at draw time, so theme/mode switches apply on the next frame.
// The animation loop stops on unmount and while the tab is hidden.
import { useEffect, useRef } from 'react';
import type { GlobePoint } from '@/lib/dashboard/audience';

const RAD = Math.PI / 180;
const SPEED = 0.12; // degrees of longitude per frame (~7°/s at 60 fps)

export default function Globe({ points }: { points: GlobePoint[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const max = Math.max(...points.map((p) => p.share), 1e-6);
    const top = [...points].sort((a, b) => b.share - a.share)[0];
    let rot = top ? -top.lon : 0; // start with the biggest audience facing the viewer
    let raf = 0;

    const draw = () => {
      const size = canvas.clientWidth || 240;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
      const css = getComputedStyle(canvas);
      const token = (name: string) => css.getPropertyValue(name).trim();
      const c = size / 2;
      const r = c - 4;
      const tilt = 15 * RAD; // look slightly down on the northern hemisphere, where most audiences are
      const project = (lat: number, lon: number) => {
        const phi = lat * RAD;
        const lam = (lon + rot) * RAD;
        const x = Math.cos(phi) * Math.sin(lam);
        const y0 = Math.sin(phi);
        const z0 = Math.cos(phi) * Math.cos(lam);
        const y = y0 * Math.cos(tilt) - z0 * Math.sin(tilt);
        const z = y0 * Math.sin(tilt) + z0 * Math.cos(tilt);
        return { x: c + r * x, y: c - r * y, visible: z > 0 };
      };
      const path = (pts: { x: number; y: number; visible: boolean }[]) => {
        ctx.beginPath();
        let pen = false;
        for (const p of pts) {
          if (!p.visible) pen = false;
          else if (pen) ctx.lineTo(p.x, p.y);
          else {
            ctx.moveTo(p.x, p.y);
            pen = true;
          }
        }
        ctx.stroke();
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(c, c, r, 0, 2 * Math.PI);
      ctx.fillStyle = token('--surface');
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = token('--border');
      ctx.stroke();
      ctx.lineWidth = 0.5;
      for (let lon = -180; lon < 180; lon += 30) path(Array.from({ length: 37 }, (_, i) => project(-90 + i * 5, lon)));
      for (let lat = -60; lat <= 60; lat += 30) path(Array.from({ length: 73 }, (_, i) => project(lat, -180 + i * 5)));
      ctx.fillStyle = token('--chart-1');
      ctx.globalAlpha = 0.8;
      for (const p of points) {
        const q = project(p.lat, p.lon);
        if (!q.visible) continue;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2 + 10 * Math.sqrt(p.share / max), 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rot = (rot + SPEED) % 360;
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(draw);
    };
    draw();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [points]);

  return <canvas ref={ref} aria-hidden="true" data-slot="globe" className="mx-auto aspect-square w-full max-w-64" />;
}
