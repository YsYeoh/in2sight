import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { ServiceWorker } from '@/components/pwa/ServiceWorker';

const NAV_PROPS = ['serviceWorker', 'userAgent'];
const setNav = (k: string, value: unknown) => Object.defineProperty(navigator, k, { value, configurable: true });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const M = en.pwa.install;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of NAV_PROPS) delete (navigator as unknown as Record<string, unknown>)[k];
  delete (window as unknown as Record<string, unknown>).isSecureContext;
});

const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InstallPrompt />
    </NextIntlClientProvider>,
  );

/** What Chrome fires when the app is installable. */
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome }) });
  act(() => void window.dispatchEvent(e));
  return e;
}

describe('InstallPrompt', () => {
  it('shows nothing until the browser says the app is installable', () => {
    show();
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
  });

  it('install opens the browser prompt (only from the button) and then hides', async () => {
    show();
    const e = installEvent();
    expect(e.defaultPrevented).toBe(true);
    expect(e.prompt).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: M.label })).toHaveTextContent(M.body);
    await userEvent.click(screen.getByRole('button', { name: M.install }));
    expect(e.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
  });

  it('"Not now" hides it and it stays hidden on the next visit', async () => {
    const { unmount } = show();
    installEvent();
    await userEvent.click(screen.getByRole('button', { name: M.dismiss }));
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
    unmount();
    show();
    installEvent();
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
  });

  it('already running as the installed app: nothing', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    show();
    installEvent();
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
  });

  it('iPhone: the Add to Home Screen steps, no install button', async () => {
    setNav('userAgent', IPHONE);
    show();
    expect(await screen.findByText(M.ios)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.install })).toBeNull();
  });

  it('blocked storage never breaks it', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    show();
    installEvent();
    await userEvent.click(screen.getByRole('button', { name: M.dismiss }));
    expect(screen.queryByRole('region', { name: M.label })).toBeNull();
  });
});

describe('ServiceWorker registration', () => {
  it('registers /sw.js for the whole site in production on a secure origin', () => {
    const register = vi.fn(async () => ({}));
    setNav('serviceWorker', { register });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    render(<ServiceWorker enabled />);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does nothing in development, on insecure origins, or without service worker support', () => {
    const register = vi.fn(async () => ({}));
    setNav('serviceWorker', { register });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    render(<ServiceWorker enabled={false} />);
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    render(<ServiceWorker enabled />);
    expect(register).not.toHaveBeenCalled();
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
    expect(() => render(<ServiceWorker enabled />)).not.toThrow();
  });

  it('a failed registration is swallowed', async () => {
    setNav('serviceWorker', { register: vi.fn(async () => Promise.reject(new Error('SecurityError'))) });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    expect(() => render(<ServiceWorker enabled />)).not.toThrow();
  });
});
