'use client';

// The shared motion gate (SPEC §8b.5). Heavy effects (particles, canvas, globe, GSAP timelines; part 2) render only when
// heavyMotionAllowed() is true. Light motion (CSS transitions, Recharts' own entry animation) needs no gate: CSS uses
// `motion-safe:` and Recharts' isAnimationActive="auto" already honours prefers-reduced-motion.
// matchMedia here is about motion, never layout (layout uses CSS breakpoints only).
import { useSyncExternalStore } from 'react';

export interface MotionEnv {
  reducedMotion: boolean;
  coarsePointer: boolean; // phones/tablets: the "off on phones" rule
  saveData: boolean;
}

export const heavyMotionAllowed = (e: MotionEnv) => !e.reducedMotion && !e.coarsePointer && !e.saveData;

const QUERIES = ['(prefers-reduced-motion: reduce)', '(pointer: coarse)'] as const;
type NetInfo = EventTarget & { saveData?: boolean };
const connection = (w: Window) => (w.navigator as Navigator & { connection?: NetInfo }).connection;

export function readMotionEnv(w: Window): MotionEnv {
  const mq = (q: string) => (typeof w.matchMedia === 'function' ? w.matchMedia(q).matches : false);
  return { reducedMotion: mq(QUERIES[0]), coarsePointer: mq(QUERIES[1]), saveData: connection(w)?.saveData === true };
}

function subscribe(onChange: () => void): () => void {
  const lists = typeof window.matchMedia === 'function' ? QUERIES.map((q) => window.matchMedia(q)) : [];
  lists.forEach((l) => l.addEventListener('change', onChange));
  connection(window)?.addEventListener('change', onChange);
  return () => {
    lists.forEach((l) => l.removeEventListener('change', onChange));
    connection(window)?.removeEventListener('change', onChange);
  };
}

/** False on the server and during hydration (no flash of a heavy effect), then the live answer. */
export function useHeavyMotion(): boolean {
  return useSyncExternalStore(subscribe, () => heavyMotionAllowed(readMotionEnv(window)), () => false);
}
