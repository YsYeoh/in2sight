import { readFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { ForceLight } from '@/components/report/ForceLight';
import { AUTO_MODE_SCRIPT, DEFAULT_PREFS, MODES, htmlAttrs, parsePrefs, resolveMode } from '@/lib/prefs';
import { THEME_COLORS, themeColor } from '@/lib/pwa';

/** A fake device colour scheme whose change listeners we can fire. */
function scheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = { get matches() { return dark; }, addEventListener: vi.fn((_: string, f: () => void) => listeners.add(f)), removeEventListener: vi.fn((_: string, f: () => void) => listeners.delete(f)) };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  return { mq, listeners, set: (d: boolean) => ((dark = d), listeners.forEach((f) => f())) };
}

const html = () => document.documentElement;

afterEach(() => {
  vi.unstubAllGlobals();
  html().removeAttribute('data-mode');
  html().removeAttribute('data-mode-auto');
  html().removeAttribute('data-force-light');
});

describe('auto mode: the pure parts', () => {
  it('auto is a valid mode, and resolves to light or dark by the device', () => {
    expect(MODES).toEqual(['light', 'dark', 'auto']);
    expect(parsePrefs({ mode: 'auto' }).mode).toBe('auto');
    expect(resolveMode('auto', true)).toBe('dark');
    expect(resolveMode('auto', false)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });

  it('htmlAttrs never emits data-mode="auto" (the token CSS knows light and dark only)', () => {
    expect(htmlAttrs({ ...DEFAULT_PREFS, mode: 'auto' })).toMatchObject({ 'data-mode': 'light', 'data-mode-auto': 'true' });
    expect(htmlAttrs({ ...DEFAULT_PREFS, mode: 'auto' }, true)).toMatchObject({ 'data-mode': 'dark', 'data-mode-auto': 'true' });
    expect(htmlAttrs({ ...DEFAULT_PREFS, mode: 'dark' }, false)).toMatchObject({ 'data-mode': 'dark', 'data-mode-auto': 'false' });
  });

  it('theme colour of auto = the resolved palette', () => {
    expect(themeColor({ theme: 'forest', mode: 'auto' }, true)).toBe(THEME_COLORS.forest.dark);
    expect(themeColor({ theme: 'forest', mode: 'auto' })).toBe(THEME_COLORS.forest.light);
  });

  it('the inline script switches to dark before paint only for auto on a dark device', () => {
    const run = () => new Function(AUTO_MODE_SCRIPT)();
    scheme(true);
    html().setAttribute('data-mode', 'light');
    html().setAttribute('data-mode-auto', 'true');
    run();
    expect(html().getAttribute('data-mode')).toBe('dark');
    html().setAttribute('data-mode', 'light');
    html().setAttribute('data-mode-auto', 'false');
    run();
    expect(html().getAttribute('data-mode')).toBe('light');
    vi.stubGlobal('matchMedia', undefined);
    html().setAttribute('data-mode-auto', 'true');
    expect(run).not.toThrow(); // old browsers: stays light
  });

  it('the migration only widens the profiles.mode CHECK list', () => {
    const sql = readFileSync('supabase/migrations/20261030000001_prefs_auto_mode.sql', 'utf8').replace(/--[^\n]*/g, '');
    expect(sql).toMatch(/alter table public\.profiles drop constraint profiles_mode_check;/);
    expect(sql).toMatch(/alter table public\.profiles add constraint profiles_mode_check check \(mode in \('light', 'dark', 'auto'\)\);/);
    expect(sql.match(/;/g)).toHaveLength(2);
  });
});

function Probe() {
  const { update } = usePrefs();
  return (
    <>
      <button onClick={() => update({ mode: 'auto' })}>auto</button>
      <button onClick={() => update({ mode: 'light' })}>light</button>
    </>
  );
}

describe('auto mode in PrefsProvider', () => {
  it('follows the device while auto is chosen, and stops when another mode is picked', async () => {
    const s = scheme(true);
    render(
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <Probe />
      </PrefsProvider>,
    );
    await userEvent.click(screen.getByText('auto'));
    expect(html().getAttribute('data-mode')).toBe('dark');
    expect(html().getAttribute('data-mode-auto')).toBe('true');
    act(() => s.set(false));
    expect(html().getAttribute('data-mode')).toBe('light');
    act(() => s.set(true));
    expect(html().getAttribute('data-mode')).toBe('dark');
    await userEvent.click(screen.getByText('light'));
    expect(s.mq.removeEventListener).toHaveBeenCalled();
    expect(s.listeners.size).toBe(0);
    expect(html().getAttribute('data-mode')).toBe('light');
  });

  it('a page rendered in auto on a dark device shows dark after mount', () => {
    scheme(true);
    render(
      <PrefsProvider initial={{ ...DEFAULT_PREFS, mode: 'auto' }} persist={vi.fn()}>
        <Probe />
      </PrefsProvider>,
    );
    expect(html().getAttribute('data-mode')).toBe('dark');
  });

  // A server refresh (revalidatePath) re-renders <html> from the server's data-mode (auto = light) and hands the provider a NEW
  // `initial` object; the refreshed attribute must not leave a dark device on a light page.
  const withInitial = (initial: typeof DEFAULT_PREFS) => (
    <PrefsProvider initial={initial} persist={vi.fn()}>
      <Probe />
    </PrefsProvider>
  );

  it('a server refresh that resets <html> to light does not leave auto on a dark device light', () => {
    scheme(true);
    const { rerender } = render(withInitial({ ...DEFAULT_PREFS, mode: 'auto' }));
    expect(html().getAttribute('data-mode')).toBe('dark');
    html().setAttribute('data-mode', 'light'); // what React writes when the layout re-renders
    rerender(withInitial({ ...DEFAULT_PREFS, mode: 'auto' })); // a new object, as after every RSC refresh
    expect(html().getAttribute('data-mode')).toBe('dark');
  });

  it('a server refresh leaves an explicit light or dark mode alone, even against the device', () => {
    scheme(true);
    const { rerender, unmount } = render(withInitial({ ...DEFAULT_PREFS, mode: 'light' }));
    rerender(withInitial({ ...DEFAULT_PREFS, mode: 'light' }));
    expect(html().getAttribute('data-mode')).toBe('light');
    unmount();
    scheme(false);
    const again = render(withInitial({ ...DEFAULT_PREFS, mode: 'dark' }));
    again.rerender(withInitial({ ...DEFAULT_PREFS, mode: 'dark' }));
    expect(html().getAttribute('data-mode')).toBe('dark');
  });

  it('the refresh applies what the user chose here, not the older server value', async () => {
    scheme(true);
    const { rerender } = render(withInitial({ ...DEFAULT_PREFS, mode: 'light' }));
    await userEvent.click(screen.getByText('auto'));
    html().setAttribute('data-mode', 'light');
    rerender(withInitial({ ...DEFAULT_PREFS, mode: 'light' }));
    expect(html().getAttribute('data-mode')).toBe('dark');
  });
});

describe('auto mode and the always-light report', () => {
  it('a device scheme change (or the provider mounting) does not turn a report dark while ForceLight is mounted', () => {
    const s = scheme(false);
    const page = (
      <PrefsProvider initial={{ ...DEFAULT_PREFS, mode: 'auto' }} persist={vi.fn()}>
        <ForceLight />
      </PrefsProvider>
    );
    const { unmount } = render(page);
    expect(html().getAttribute('data-mode')).toBe('light');
    act(() => s.set(true));
    expect(html().getAttribute('data-mode')).toBe('light');
    unmount();
    expect(html().hasAttribute('data-force-light')).toBe(false);
  });

  it('on a dark device the report is light from the first render of the provider', () => {
    scheme(true);
    render(
      <PrefsProvider initial={{ ...DEFAULT_PREFS, mode: 'auto' }} persist={vi.fn()}>
        <ForceLight />
      </PrefsProvider>,
    );
    expect(html().getAttribute('data-mode')).toBe('light');
  });
});
