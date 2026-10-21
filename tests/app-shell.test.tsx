import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AppShell } from '@/components/shared/AppShell';
import { DEFAULT_PREFS } from '@/lib/prefs';

let pathname = '/accounts';
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useSearchParams: () => search, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const frame = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/tabs/protocol', async (orig) => ({ ...(await orig<typeof import('@/lib/tabs/protocol')>()), isFramed: () => frame.on }));

function setup(props: Partial<React.ComponentProps<typeof AppShell>> = {}, persist = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persist}>
        <AppShell {...props}>
          <p>page content</p>
        </AppShell>
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => localStorage.clear()); // the shell saves its tab list

describe('AppShell inside a tab frame', () => {
  afterEach(() => {
    frame.on = false;
  });

  it('renders the page only: no sidebar, no header, no bottom bar, no frames', () => {
    frame.on = true;
    setup();
    expect(screen.getByRole('main')).toHaveTextContent('page content');
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('the server hint gives the frame its chromeless first paint; the client answer wins afterwards', () => {
    frame.on = true;
    setup({ framed: false }); // a refresh re-rendered the layout without Sec-Fetch-Dest: still no chrome
    expect(screen.queryByRole('banner')).toBeNull();
  });
});

describe('AppShell (top window: the shell and its tabs)', () => {
  it('does not render the page itself: the current URL opens as the first tab frame', () => {
    pathname = '/explorer';
    search = new URLSearchParams('m=reach');
    setup();
    expect(screen.queryByText('page content')).toBeNull();
    const frames = document.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveAttribute('src', '/explorer?m=reach');
    expect(frames[0]).toHaveAttribute('title', 'Explorer');
    pathname = '/accounts';
    search = new URLSearchParams();
  });

  it('puts the tab strip (md+) and the "Tabs (N)" button (phones) in the header row, left of the bell', () => {
    setup({ bell: <button>bell</button> });
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Tabs (1)' }).className).toContain('md:hidden');
    const order = [...header.querySelectorAll('[role="tablist"], button')].map((e) => e.getAttribute('role') ?? e.textContent);
    expect(order.indexOf('tablist')).toBeLessThan(order.indexOf('bell'));
  });

  it('marks the sidebar as "jump to the section tab" and the bottom bar as "navigate this tab"', () => {
    setup();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveAttribute('data-tab-open', 'nav');
    expect(screen.getByRole('navigation', { name: 'Main tabs' })).toHaveAttribute('data-tab-open', 'current');
  });

  it('shows the install hint above the frames', () => {
    setup({ install: <p>install hint</p> });
    expect(within(screen.getByRole('main')).getByText('install hint')).toBeInTheDocument();
  });

  it('has two labelled navigation landmarks (sidebar/rail and bottom tabs) with all four links each', () => {
    setup();
    for (const name of ['Main navigation', 'Main tabs']) {
      const nav = screen.getByRole('navigation', { name });
      for (const label of ['Overview', 'Accounts', 'Tags', 'Explorer', 'Settings']) {
        expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
      }
    }
  });

  it('marks exactly one link per landmark as the current page', () => {
    pathname = '/accounts/12';
    setup();
    for (const name of ['Main navigation', 'Main tabs']) {
      const nav = screen.getByRole('navigation', { name });
      const current = within(nav).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page');
      expect(current).toHaveLength(1);
      expect(current[0]).toHaveAccessibleName('Accounts');
    }
    pathname = '/accounts';
  });

  it('no link is current on an unknown route', () => {
    pathname = '/somewhere-else';
    setup();
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    pathname = '/accounts';
  });

  it('links point at the real routes', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Main tabs' });
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('Overview and Calendar links carry the Time Scope of the current URL (both landmarks)', () => {
    pathname = '/accounts/12';
    search = new URLSearchParams('tab=posts&from=2026-09-01&to=2026-09-30&format=REELS');
    setup();
    for (const name of ['Main navigation', 'Main tabs']) {
      const nav = screen.getByRole('navigation', { name });
      expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/overview?from=2026-09-01&to=2026-09-30');
      expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar?from=2026-09-01&to=2026-09-30');
      expect(within(nav).getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts');
    }
    pathname = '/accounts';
    search = new URLSearchParams();
  });

  it('reserves the height of the bottom bar on phones so it never covers the frame', () => {
    setup();
    expect(screen.getByRole('main').className).toContain('pb-[calc(3.5rem+env(safe-area-inset-bottom))]'); // the bar is min-h-14 + safe area
    expect(screen.getByRole('main').className).toContain('md:pb-0');
  });

  it('shows the sidebar from lg, the icon rail from md and the tab bar only below md (CSS classes)', () => {
    setup();
    const side = screen.getByRole('navigation', { name: 'Main navigation' }).closest('aside')!;
    expect(side.className).toContain('hidden');
    expect(side.className).toContain('md:flex');
    expect(side.className).toContain('lg:w-56');
    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('md:hidden');
    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('grid-cols-6'); // one column per item
  });

  it('the mode toggle flips light/dark through the preferences provider', async () => {
    const persist = vi.fn();
    setup({}, persist);
    await userEvent.click(screen.getByRole('button', { name: 'Toggle dark mode' }));
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
    expect(persist).toHaveBeenCalledWith({ mode: 'dark' });
  });

  it('the user menu offers settings, and sign out only when an action is provided', async () => {
    const { unmount } = setup({ userEmail: 'owner@example.com' });
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
    unmount();

    setup({ userEmail: 'owner@example.com', signOutAction: async () => {} });
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('collapses the brand to the dot in the tablet icon rail but keeps the word in the phone header', () => {
    setup();
    const railWord = within(document.querySelector('aside')!).getByText('in2sight');
    expect(railWord.className).toContain('max-lg:sr-only');
    expect(railWord.previousElementSibling!.className).toContain('shrink-0');
    const headerWord = within(screen.getByRole('banner')).getByText('in2sight');
    expect(headerWord.className).not.toContain('sr-only');
  });

  it('sign out invokes the provided action exactly once', async () => {
    const signOutAction = vi.fn(async () => {});
    setup({ userEmail: 'owner@example.com', signOutAction });
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(signOutAction).toHaveBeenCalledTimes(1));
    // onSelect preventDefault keeps the menu open so the form can submit
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });
});
