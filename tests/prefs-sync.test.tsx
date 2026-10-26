import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const frame = vi.hoisted(() => ({ on: true })); // receivers act as frames: a locale change never reloads the test window
vi.mock('@/lib/tabs/protocol', async (orig) => ({ ...(await orig<typeof import('@/lib/tabs/protocol')>()), isFramed: () => frame.on }));

import { PREFS_CHANNEL, PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';

// Two providers in one jsdom window stand in for two documents of the app (the shell and a tab's frame).
function Probe({ name }: { name: string }) {
  const { prefs, update } = usePrefs();
  return (
    <div>
      <output data-testid={name}>{`${prefs.mode} ${prefs.dateFormat} ${prefs.locale}`}</output>
      <button onClick={() => update({ mode: 'dark' })}>{`${name} dark`}</button>
      <button onClick={() => update({ dateFormat: 'DD/MM/YYYY' })}>{`${name} date`}</button>
      <button onClick={() => update({ locale: 'zh-CN' })}>{`${name} zh`}</button>
    </div>
  );
}
const persistA = vi.fn<(p: Partial<Prefs>) => Promise<void>>(async () => {});
const persistB = vi.fn<(p: Partial<Prefs>) => Promise<void>>(async () => {});
const setup = () =>
  render(
    <>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persistA}>
        <Probe name="a" />
      </PrefsProvider>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persistB}>
        <Probe name="b" />
      </PrefsProvider>
    </>,
  );
const shown = (name: string) => screen.getByTestId(name).textContent;

afterEach(() => {
  persistA.mockReset().mockImplementation(async () => {});
  persistB.mockClear();
});

describe('preferences follow across the app’s documents (tabs)', () => {
  it('a theme/mode change in one document is applied in the others, which do not save it again', async () => {
    setup();
    act(() => screen.getByText('a dark').click());
    expect(shown('a')).toContain('dark');
    await waitFor(() => expect(shown('b')).toContain('dark'));
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(persistA).toHaveBeenCalledWith({ mode: 'dark' });
    expect(persistB).not.toHaveBeenCalled();
  });

  it('format changes travel too (client-rendered values update at once)', async () => {
    setup();
    act(() => screen.getByText('b date').click());
    await waitFor(() => expect(shown('a')).toContain('DD/MM/YYYY'));
  });

  it('a language change is shared only after it is saved', async () => {
    let save!: () => void;
    persistA.mockImplementation(() => new Promise<void>((r) => (save = r)));
    setup();
    act(() => screen.getByText('a zh').click());
    await new Promise((r) => setTimeout(r, 50));
    expect(shown('b')).not.toContain('zh-CN'); // not yet: the cookie is not saved
    await act(async () => save());
    await waitFor(() => expect(shown('b')).toContain('zh-CN'));
  });

  it.each([
    ['answers ok: false (the cookie WAS written)', () => Promise.resolve({ ok: false }), true],
    ['rejects (nothing known to be saved)', () => Promise.reject(new Error('network')), false],
  ])('a language change whose save %s: shared %s', async (_n, outcome, shared) => {
    persistA.mockImplementation(outcome as never);
    setup();
    act(() => screen.getByText('a zh').click());
    await new Promise((r) => setTimeout(r, 100));
    expect(shown('b').includes('zh-CN')).toBe(shared);
  });

  it('ignores junk on the channel (validated like any input)', async () => {
    setup();
    const ch = new BroadcastChannel(PREFS_CHANNEL);
    ch.postMessage({ mode: 'neon', theme: 42 });
    ch.postMessage('nonsense');
    await new Promise((r) => setTimeout(r, 50));
    ch.close();
    expect(shown('a')).toBe(`${DEFAULT_PREFS.mode} ${DEFAULT_PREFS.dateFormat} ${DEFAULT_PREFS.locale}`);
  });
});
