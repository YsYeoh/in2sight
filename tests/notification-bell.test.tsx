import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AppShell } from '@/components/shared/AppShell';
import { NotificationBell, type NotificationBellProps } from '@/components/shared/NotificationBell';
import type { NotificationItem } from '@/lib/alerts/read';
import { deepMerge } from '@/lib/merge';
import { DEFAULT_PREFS } from '@/lib/prefs';

vi.mock('next/navigation', () => ({ usePathname: () => '/overview' }));
// a plain anchor: these tests are about the bell, not Next's client router
vi.mock('next/link', () => ({ default: ({ href, children, onClick, ...p }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} onClick={(e) => (e.preventDefault(), onClick?.(e))} {...p}>{children}</a>, useLinkStatus: () => ({ pending: false }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const LONG = 'the_longest_instagram_username_you_have_ever_seen_ok';
const item = (id: number, o: Partial<NotificationItem> = {}): NotificationItem => ({ id, kind: 'reach_drop', accountId: A, severity: 'warning', payload: { username: 'cafe', pct: 25 }, createdAt: '2026-10-14T02:00:00Z', readAt: null, ...o });
const ok = async () => ({ ok: true });

function view(o: Partial<NotificationBellProps> = {}, messages: typeof en = en) {
  const props: NotificationBellProps = { items: [item(1), item(2, { kind: 'taking_off', payload: { username: LONG, ratio: 2.6 }, readAt: '2026-10-14T03:00:00Z' })], unread: 1, markRead: vi.fn(ok), markAllRead: vi.fn(ok), ...o };
  render(
    <NextIntlClientProvider locale={messages === en ? 'en' : 'zh-CN'} messages={messages}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'UTC' }} persist={vi.fn()}>
        <NotificationBell {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

describe('NotificationBell', () => {
  it('the button names the unread count; the badge shows it; a live region announces it', () => {
    view({ unread: 3 });
    const button = screen.getByRole('button', { name: 'Notifications, 3 unread' });
    expect(button).toHaveTextContent('3');
    expect(screen.getByText('3 unread notifications')).toHaveAttribute('aria-live', 'polite');
  });

  it('more than 99 unread shows 99+', () => {
    view({ unread: 120 });
    expect(screen.getByRole('button', { name: 'Notifications, 120 unread' })).toHaveTextContent('99+');
  });

  it('zero unread: no badge, accessible name says none', () => {
    view({ unread: 0 });
    expect(screen.getByRole('button', { name: 'Notifications, none unread' }).querySelector('span')).toBeNull();
  });

  it('opens a keyboard-reachable list with localized text, dates and deep links', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    const links = await screen.findAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([`/accounts/${A}`, `/accounts/${A}?tab=posts`]);
    expect(links[0]).toHaveTextContent('Unread: Reach dropped');
    expect(links[0]).toHaveTextContent('@cafe: reach over the last 7 days is down 25% vs the 7 days before.');
    expect(links[0]).toHaveTextContent('14 Oct 2026');
    expect(links[1]).not.toHaveTextContent('Unread');
  });

  it('very long usernames are clipped and wrap instead of overflowing', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    const link = (await screen.findAllByRole('link'))[1];
    expect(link).toHaveTextContent(`@${LONG.slice(0, 39)}…`);
    expect(link.querySelector('.break-words')).not.toBeNull();
  });

  it('choosing an unread item marks it read; a read item does not call the action', async () => {
    const p = view();
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await userEvent.click((await screen.findAllByRole('link'))[0]);
    expect(p.markRead).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await userEvent.click((await screen.findAllByRole('link'))[1]);
    expect(p.markRead).toHaveBeenCalledTimes(1);
  });

  it('mark all read calls the action; disabled when nothing is unread', async () => {
    const p = view();
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(p.markAllRead).toHaveBeenCalledOnce();
  });

  it('nothing unread: mark all read is disabled', async () => {
    view({ unread: 0, items: [item(1, { readAt: '2026-10-14T03:00:00Z' })] });
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByRole('button', { name: 'Mark all read' })).toBeDisabled();
  });

  it('empty state', async () => {
    view({ items: [], unread: 0 });
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('renders in Chinese', async () => {
    view({ unread: 1 }, deepMerge(en, zh));
    await userEvent.click(screen.getByRole('button', { name: '通知，1 条未读' }));
    expect(await screen.findByText('触达下降')).toBeInTheDocument();
  });

  it('the AppShell header renders the bell slot', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
          <AppShell bell={<button type="button">bell-slot</button>}>
            <p>page</p>
          </AppShell>
        </PrefsProvider>
      </NextIntlClientProvider>,
    );
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'bell-slot' })).toBeInTheDocument();
  });
});
