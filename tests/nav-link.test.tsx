import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { LayoutDashboard } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { AppShell } from '@/components/shared/AppShell';
import { NavLink } from '@/components/shared/NavLink';
import { DEFAULT_PREFS } from '@/lib/prefs';

const status = vi.hoisted(() => ({ pending: false }));
vi.mock('next/link', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/link')>()), useLinkStatus: () => ({ pending: status.pending }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/overview', useSearchParams: () => new URLSearchParams() }));

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  status.pending = false;
});

describe('NavLink', () => {
  it('idle: just the link with its icon, no orb', () => {
    wrap(
      <NavLink href="/overview" icon={LayoutDashboard} iconClassName="size-4">
        Overview
      </NavLink>,
    );
    const a = screen.getByRole('link', { name: 'Overview' });
    expect(a).toHaveAttribute('href', '/overview');
    expect(a.querySelector('svg.insight-orb')).toBeNull();
    expect(a.querySelector('svg.lucide')).not.toHaveClass('link-pending-hide');
  });

  it('pending with an icon: the decorative orb overlays the icon box, which keeps its size (no layout shift)', () => {
    status.pending = true;
    wrap(
      <NavLink href="/overview" icon={LayoutDashboard} iconClassName="size-4">
        Overview
      </NavLink>,
    );
    const a = screen.getByRole('link', { name: 'Overview' });
    const orb = a.querySelector('svg.insight-orb')!;
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(orb).toHaveClass('link-pending', 'absolute');
    expect(orb.parentElement).toHaveClass('size-4', 'relative');
    expect(a.querySelector('svg.lucide')).toHaveClass('link-pending-hide');
    expect(within(a).queryByRole('status')).toBeNull(); // the route skeleton announces loading, not every link
  });

  it('pending without an icon: the orb sits absolutely after the text', () => {
    status.pending = true;
    wrap(<NavLink href="/accounts/1">@cafe</NavLink>);
    const orb = screen.getByRole('link', { name: '@cafe' }).querySelector('svg.insight-orb')!;
    expect(orb.parentElement).toHaveClass('absolute', 'left-full');
  });

  it('AppShell uses it for the sidebar/rail and the bottom tabs', () => {
    status.pending = true;
    wrap(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );
    for (const name of ['Main navigation', 'Main tabs']) {
      const nav = screen.getByRole('navigation', { name });
      expect(within(nav).getByRole('link', { name: 'Overview' }).querySelector('svg.insight-orb')).not.toBeNull();
    }
  });
});
