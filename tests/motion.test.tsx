import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heavyMotionAllowed, readMotionEnv, useHeavyMotion } from '@/lib/motion';

const fakeWindow = (matches: Record<string, boolean>, saveData?: boolean) =>
  ({ matchMedia: (q: string) => ({ matches: !!matches[q] }), navigator: { connection: saveData === undefined ? undefined : { saveData } } }) as unknown as Window;

describe('motion gate', () => {
  it('allows heavy motion only with no reduced-motion, a fine pointer and no Save-Data', () => {
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: false, saveData: false })).toBe(true);
    expect(heavyMotionAllowed({ reducedMotion: true, coarsePointer: false, saveData: false })).toBe(false);
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: true, saveData: false })).toBe(false);
    expect(heavyMotionAllowed({ reducedMotion: false, coarsePointer: false, saveData: true })).toBe(false);
  });

  it('reads the environment from media queries and the Network Information API', () => {
    expect(readMotionEnv(fakeWindow({ '(prefers-reduced-motion: reduce)': true }))).toEqual({ reducedMotion: true, coarsePointer: false, saveData: false });
    expect(readMotionEnv(fakeWindow({ '(pointer: coarse)': true }, true))).toEqual({ reducedMotion: false, coarsePointer: true, saveData: true });
    expect(readMotionEnv({ navigator: {} } as unknown as Window)).toEqual({ reducedMotion: false, coarsePointer: false, saveData: false });
  });
});

describe('useHeavyMotion', () => {
  afterEach(() => vi.unstubAllGlobals());
  function Probe() {
    return <p>{useHeavyMotion() ? 'heavy' : 'light'}</p>;
  }
  it('follows the live environment in the browser', () => {
    const mm = (reduce: boolean) => (q: string) => ({ matches: q.includes('reduce') && reduce, addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal('matchMedia', mm(true));
    const { unmount } = render(<Probe />);
    expect(screen.getByText('light')).toBeInTheDocument();
    unmount();
    vi.stubGlobal('matchMedia', mm(false));
    render(<Probe />);
    expect(screen.getByText('heavy')).toBeInTheDocument();
  });
});
