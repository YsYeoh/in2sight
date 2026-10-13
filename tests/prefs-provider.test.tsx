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
