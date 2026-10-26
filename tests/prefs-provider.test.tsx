import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

function Probe() {
  const { prefs, update, status, retry } = usePrefs();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button onClick={retry}>retry</button>
      <button onClick={() => update({ density: 'comfortable' })}>comfortable</button>
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

  it('reports saving, then saved; a void persist result counts as saved', async () => {
    let finish!: () => void;
    const persist = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    expect(screen.getByTestId('status')).toHaveTextContent('idle');
    await userEvent.click(screen.getByText('dark'));
    expect(screen.getByTestId('status')).toHaveTextContent('saving');
    finish();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('network'))],
    ['answers ok: false', () => Promise.resolve({ ok: false })],
  ])('a save that %s is an error, never swallowed', async (_name, outcome) => {
    const persist = vi.fn(outcome);
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    expect(html().getAttribute('data-mode')).toBe('dark'); // still applied here
  });

  it('retry re-sends every unsaved key with its current value, then reports saved', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await userEvent.click(screen.getByText('comfortable'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await userEvent.click(screen.getByText('retry'));
    expect(persist).toHaveBeenLastCalledWith({ mode: 'dark', density: 'comfortable' });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it('a later successful save of the same key clears its error', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('dark'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('saved'));
  });

  it('retry with nothing unsaved does not call persist', async () => {
    const persist = vi.fn();
    render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
    await userEvent.click(screen.getByText('retry'));
    expect(persist).not.toHaveBeenCalled();
  });

  it('usePrefs outside the provider throws a helpful error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('usePrefs must be used inside <PrefsProvider>');
    spy.mockRestore();
  });

  describe('two saves of the same key in flight', () => {
    const deferred = () => {
      let done!: (r: { ok: boolean }) => void;
      return { promise: new Promise<{ ok: boolean }>((r) => (done = r)), done: (ok: boolean) => done({ ok }) };
    };
    function setup() {
      const calls = [deferred(), deferred()];
      const persist = vi.fn().mockImplementationOnce(() => calls[0].promise).mockImplementationOnce(() => calls[1].promise).mockResolvedValue({ ok: true });
      render(<PrefsProvider initial={DEFAULT_PREFS} persist={persist}><Probe /></PrefsProvider>);
      return { calls, persist };
    }
    const status = () => screen.getByTestId('status');

    it('first fails, second succeeds: saved at the end, nothing left to retry', async () => {
      const { calls, persist } = setup();
      await userEvent.click(screen.getByRole('button', { name: 'dark' }));
      await userEvent.click(screen.getByRole('button', { name: 'dark' })); // same key twice
      await act(async () => calls[0].done(false));
      await waitFor(() => expect(status()).toHaveTextContent('error')); // known so far; the other save is still running
      await act(async () => calls[1].done(true));
      await waitFor(() => expect(status()).toHaveTextContent('saved'));
      await userEvent.click(screen.getByText('retry'));
      expect(persist).toHaveBeenCalledTimes(2); // retry had nothing to send
      expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    });

    it('first succeeds, second fails: error at the end, retry re-sends the current value', async () => {
      const { calls, persist } = setup();
      await userEvent.click(screen.getByRole('button', { name: 'dark' }));
      await userEvent.click(screen.getByRole('button', { name: 'dark' }));
      await act(async () => calls[0].done(true));
      await waitFor(() => expect(status()).toHaveTextContent('saving'));
      await act(async () => calls[1].done(false));
      await waitFor(() => expect(status()).toHaveTextContent('error'));
      await userEvent.click(screen.getByText('retry'));
      expect(persist).toHaveBeenLastCalledWith({ mode: 'dark' });
      await waitFor(() => expect(status()).toHaveTextContent('saved'));
    });
  });
});
