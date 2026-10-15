import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AlertSettingsForm, type AlertSettingsFormProps } from '@/components/settings/AlertSettingsForm';
import { NotificationsCard, type NotificationsCardProps } from '@/components/settings/NotificationsCard';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const NAV_PROPS = ['serviceWorker', 'userAgent', 'platform', 'maxTouchPoints'];
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of NAV_PROPS) delete (navigator as unknown as Record<string, unknown>)[k]; // own props shadowing jsdom's getters
});
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const setNav = (k: string, value: unknown) => Object.defineProperty(navigator, k, { value, configurable: true });
const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const JSON_SUB = { endpoint: 'https://push.example/1', expirationTime: null, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };

/** A browser with service workers, PushManager and Notification, all faked. */
function browser(o: { permission?: NotificationPermission; prompt?: NotificationPermission; subscribed?: boolean } = {}) {
  const sub = { endpoint: JSON_SUB.endpoint, toJSON: () => JSON_SUB, unsubscribe: vi.fn(async () => true) };
  let current = o.subscribed ? sub : null;
  const pushManager = { getSubscription: vi.fn(async () => current), subscribe: vi.fn(async () => ((current = sub), sub)) };
  const reg = { pushManager };
  const sw = { getRegistration: vi.fn(async () => reg), register: vi.fn(async () => reg), ready: Promise.resolve(reg) };
  const N = { permission: o.permission ?? 'default', requestPermission: vi.fn(async () => o.prompt ?? 'granted') };
  setNav('serviceWorker', sw);
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', N);
  return { sub, sw, pushManager, N };
}

function card(o: Partial<NotificationsCardProps> = {}) {
  const props: NotificationsCardProps = { vapidPublicKey: KEY, swEnabled: true, save: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NotificationsCard {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}
const M = en.settings.notifications;

describe('NotificationsCard', () => {
  it('never asks for permission on its own; enabling subscribes with the VAPID key and stores the subscription', async () => {
    const b = browser();
    const p = card();
    const button = await screen.findByRole('button', { name: M.enable });
    expect(b.N.requestPermission).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(b.N.requestPermission).toHaveBeenCalledOnce();
    expect(b.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect((b.pushManager.subscribe.mock.calls[0] as unknown as [{ applicationServerKey: Uint8Array }])[0].applicationServerKey).toHaveLength(65);
    expect(p.save).toHaveBeenCalledWith(JSON_SUB, navigator.userAgent);
    expect(await screen.findByText(M.on)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: M.disable })).toBeInTheDocument();
  });

  it('the user denies the prompt: blocked message, nothing subscribed or stored', async () => {
    const b = browser({ prompt: 'denied' });
    const p = card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByText(M.denied)).toBeInTheDocument();
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(p.save).not.toHaveBeenCalled();
  });

  it('the user dismisses the prompt: stays off, the button is still there', async () => {
    browser({ prompt: 'default' });
    card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByRole('button', { name: M.enable })).toBeEnabled();
  });

  it('permission already blocked: explains how to unblock, no button', async () => {
    browser({ permission: 'denied' });
    card();
    expect(await screen.findByText(M.denied)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.enable })).toBeNull();
  });

  it('saving fails: the fresh browser subscription is removed again and an error shows', async () => {
    const b = browser();
    card({ save: vi.fn(async () => ({ ok: false })) });
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.error);
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('already subscribed: turning off deletes the stored endpoint and unsubscribes', async () => {
    const b = browser({ subscribed: true });
    const p = card();
    await userEvent.click(await screen.findByRole('button', { name: M.disable }));
    expect(p.remove).toHaveBeenCalledWith(JSON_SUB.endpoint);
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: M.enable })).toBeInTheDocument();
  });

  it('turning off when the server refuses keeps the device subscribed and shows an error', async () => {
    const b = browser({ subscribed: true });
    card({ remove: vi.fn(async () => ({ ok: false })) });
    await userEvent.click(await screen.findByRole('button', { name: M.disable }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.error);
    expect(b.sub.unsubscribe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: M.disable })).toBeInTheDocument();
  });

  it('a service worker is registered on demand when none exists yet', async () => {
    const b = browser();
    b.sw.getRegistration.mockResolvedValueOnce(undefined as never).mockResolvedValueOnce(undefined as never);
    card();
    await userEvent.click(await screen.findByRole('button', { name: M.enable }));
    await waitFor(() => expect(b.sw.register).toHaveBeenCalledWith('/sw.js'));
  });

  it('development build (service worker off): explains it, no button, nothing registered', async () => {
    const b = browser();
    card({ swEnabled: false });
    expect(await screen.findByText(M.devOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.enable })).toBeNull();
    expect(b.sw.register).not.toHaveBeenCalled();
    expect(b.N.requestPermission).not.toHaveBeenCalled();
  });

  it('unsupported browser: says so, no button', async () => {
    card();
    expect(await screen.findByText(M.unsupported)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('iPhone Safari without the installed app: Home Screen hint instead', async () => {
    setNav('userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    card();
    expect(await screen.findByText(M.iosInstall)).toBeInTheDocument();
  });

  it('no VAPID key on the server: not-configured note', async () => {
    browser();
    card({ vapidPublicKey: null });
    expect(await screen.findByText(M.notConfigured)).toBeInTheDocument();
  });
});

describe('AlertSettingsForm', () => {
  function form(o: Partial<AlertSettingsFormProps> = {}) {
    const props: AlertSettingsFormProps = { initial: DEFAULT_ALERT_SETTINGS, save: vi.fn(async (raw: unknown) => ({ ok: true as const, settings: { ...DEFAULT_ALERT_SETTINGS, ...(raw as object), syncFailures: 3 } })), ...o };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AlertSettingsForm {...props} />
      </NextIntlClientProvider>,
    );
    return props;
  }

  it('one labelled switch per alert type with the SPEC defaults (taking off off)', () => {
    form();
    expect(screen.getByRole('switch', { name: en.notifications.kinds.needs_reconnect.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title })).not.toBeChecked();
    expect(screen.getByLabelText(M.reachDropPct)).toHaveValue(20);
  });

  it('saves toggles and thresholds, then shows what the server stored', async () => {
    const p = form();
    await userEvent.click(screen.getByRole('switch', { name: en.notifications.kinds.taking_off.title }));
    const pct = screen.getByLabelText(M.reachDropPct);
    await userEvent.clear(pct);
    await userEvent.type(pct, '35');
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(p.save).toHaveBeenCalledWith(expect.objectContaining({ push: expect.objectContaining({ taking_off: true }), reachDropPct: 35, takingOffRatio: 2, syncFailures: 2 }));
    expect(await screen.findByRole('status')).toHaveTextContent(M.saved);
    expect(screen.getByLabelText(M.syncFailures)).toHaveValue(3); // the server's normalised value wins
  });

  it('out-of-range numbers are stopped by the browser (min/max) before reaching the server', async () => {
    const p = form();
    const pct = screen.getByLabelText(M.reachDropPct);
    expect(pct).toHaveAttribute('min', '5');
    expect(pct).toHaveAttribute('max', '90');
    await userEvent.clear(pct);
    await userEvent.type(pct, '500');
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(p.save).not.toHaveBeenCalled();
  });

  it('a failed save shows an error', async () => {
    form({ save: vi.fn(async () => ({ ok: false as const, error: 'unexpected' })) });
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.saveError);
  });
});
