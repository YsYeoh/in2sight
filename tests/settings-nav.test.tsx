import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const nav = vi.hoisted(() => ({ pathname: '/settings/language', push: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push, refresh: vi.fn() }) }));

import { SettingsNav } from '@/components/settings/SettingsNav';
import { useUnsavedGuard } from '@/components/settings/unsaved';

const S = en.settings.sections;

function Dirty() {
  useUnsavedGuard(true);
  return null;
}

function setup(dirty = false) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SettingsNav />
      {dirty ? <Dirty /> : null}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  nav.pathname = '/settings/language';
  nav.push.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('SettingsNav', () => {
  it('one labelled nav: a link per section in registry order, the open one marked aria-current', () => {
    setup();
    const n = screen.getByRole('navigation', { name: S.nav });
    const links = within(n).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/settings/appearance', '/settings/language', '/settings/notifications', '/settings/accounts', '/settings/security', '/settings/data']);
    expect(within(n).getByRole('link', { name: S.language.title })).toHaveAttribute('aria-current', 'page');
    expect(within(n).getByRole('link', { name: S.appearance.title })).not.toHaveAttribute('aria-current');
  });

  it('list from md up, the select below md (CSS only)', () => {
    setup();
    const select = screen.getByLabelText(S.pick);
    expect(select.parentElement!.classList.contains('md:hidden')).toBe(true);
    expect(screen.getAllByRole('list')[0].classList.contains('hidden')).toBe(true);
    expect(screen.getAllByRole('list')[0].classList.contains('md:flex')).toBe(true);
  });

  it('phone: the select shows the open section and navigates on change', async () => {
    setup();
    const select = screen.getByLabelText(S.pick);
    expect(select).toHaveValue('language');
    expect(select.classList.contains('h-[var(--ctl)]')).toBe(true);
    await userEvent.selectOptions(select, 'notifications');
    expect(nav.push).toHaveBeenCalledWith('/settings/notifications');
  });

  it('with unsaved changes, both ask first; cancelling stays put', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup(true);
    await userEvent.selectOptions(screen.getByLabelText(S.pick), 'data');
    expect(confirm).toHaveBeenCalledWith(en.settings.unsaved.confirm);
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText(S.pick)).toHaveValue('language');
    const link = screen.getByRole('link', { name: S.data.title });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('confirming leaves: the select navigates', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup(true);
    await userEvent.selectOptions(screen.getByLabelText(S.pick), 'data');
    expect(nav.push).toHaveBeenCalledWith('/settings/data');
  });
});
