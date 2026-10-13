import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AppShell } from '@/components/shared/AppShell';
import { DEFAULT_PREFS } from '@/lib/prefs';

let pathname = '/accounts';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

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

describe('AppShell', () => {
  it('renders the page content', () => {
    setup();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('has two labelled navigation landmarks (sidebar/rail and bottom tabs) with all four links each', () => {
    setup();
    for (const name of ['Main navigation', 'Main tabs']) {
      const nav = screen.getByRole('navigation', { name });
      for (const label of ['Overview', 'Accounts', 'Tags', 'Settings']) {
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

  it('reserves space at the bottom on phones so the tab bar never covers content', () => {
    setup();
    expect(screen.getByRole('main').className).toMatch(/pb-(2[0-9]|24|28|32)/);
    expect(screen.getByRole('main').className).toMatch(/md:pb-/);
  });

  it('shows the sidebar from lg, the icon rail from md and the tab bar only below md (CSS classes)', () => {
    setup();
    const side = screen.getByRole('navigation', { name: 'Main navigation' }).closest('aside')!;
    expect(side.className).toContain('hidden');
    expect(side.className).toContain('md:flex');
    expect(side.className).toContain('lg:w-56');
    expect(screen.getByRole('navigation', { name: 'Main tabs' }).className).toContain('md:hidden');
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
