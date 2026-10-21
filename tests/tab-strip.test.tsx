import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { TabFrames, TabsProvider } from '@/components/shared/tabs/TabHost';
import { TabStrip } from '@/components/shared/tabs/TabStrip';
import { TabsSheet } from '@/components/shared/tabs/TabsSheet';
import { STALE_MS, STORAGE_KEY } from '@/lib/tabs/model';

const O = window.location.origin;

function setup(saved?: { url: string; title: string }[], url = '/overview') {
  if (saved) localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, tabs: saved }));
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TabsProvider initialUrl={url}>
        <TabStrip className="hidden md:flex" />
        <TabsSheet className="md:hidden" />
        <TabFrames />
      </TabsProvider>
    </NextIntlClientProvider>,
  );
}
const tablist = () => screen.getByRole('tablist', { name: 'Open tabs' });
const tabNames = () => within(tablist()).getAllByRole('tab').map((t) => `${t.getAttribute('aria-selected') === 'true' ? '*' : ''}${t.textContent}`);
const report = (url: string, title: string) => {
  const f = document.querySelector('iframe:not([inert])') as HTMLIFrameElement;
  act(() => void window.dispatchEvent(new MessageEvent('message', { data: { type: 'in2sight:nav', url, title }, origin: O, source: f.contentWindow })));
};

beforeEach(() => {
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  localStorage.clear();
  window.history.replaceState(null, '', '/overview');
});

describe('TabStrip', () => {
  it('is md+ only and lists the tabs with titles (section name until the page reports its heading)', () => {
    setup([{ url: '/accounts/a1?tab=posts', title: '@yseny_ · Posts' }, { url: '/overview', title: '' }]);
    expect(tablist().parentElement!.className).toContain('hidden md:flex');
    expect(tabNames()).toEqual(['@yseny_ · Posts', '*Overview']);
  });

  it('click selects; arrows, Home and End move the selection and the focus; one tab is in the Tab order', async () => {
    setup([{ url: '/overview', title: 'Overview' }, { url: '/tags', title: 'Tags' }, { url: '/calendar', title: 'Calendar' }]);
    const tabs = () => within(tablist()).getAllByRole('tab');
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    await userEvent.click(tabs()[1]);
    expect(tabNames()).toEqual(['Overview', '*Tags', 'Calendar']);
    fireEvent.keyDown(tabs()[1], { key: 'ArrowRight' });
    expect(tabNames()).toEqual(['Overview', 'Tags', '*Calendar']);
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tabs()[2], { key: 'ArrowRight' }); // wraps
    expect(tabNames()[0]).toBe('*Overview');
    fireEvent.keyDown(tabs()[0], { key: 'End' });
    expect(tabNames()[2]).toBe('*Calendar');
    fireEvent.keyDown(tabs()[2], { key: 'Home' });
    expect(tabNames()[0]).toBe('*Overview');
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it('close buttons are named after their tab; Delete closes the focused tab; "+" opens a new Overview tab', async () => {
    setup([{ url: '/overview', title: 'Overview' }, { url: '/tags', title: 'Tags' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Close Tags' }));
    expect(tabNames()).toEqual(['*Overview']);
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(tabNames()).toEqual(['Overview', '*Overview']);
    fireEvent.keyDown(within(tablist()).getAllByRole('tab')[1], { key: 'Delete' });
    expect(tabNames()).toEqual(['*Overview']);
  });

  it('after a close, the focus lands on the newly active tab (Delete key and close button alike)', async () => {
    setup([{ url: '/overview', title: 'Overview' }, { url: '/tags', title: 'Tags' }, { url: '/calendar', title: 'Calendar' }]);
    const tabs = () => within(tablist()).getAllByRole('tab');
    await userEvent.click(tabs()[1]);
    fireEvent.keyDown(tabs()[1], { key: 'Delete' });
    expect(tabNames()).toEqual(['Overview', '*Calendar']);
    expect(document.activeElement).toBe(tabs()[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Close Calendar' }));
    expect(tabNames()).toEqual(['*Overview']);
    expect(document.activeElement).toBe(tabs()[0]);
    expect(tabs()[0].tabIndex).toBe(0);
  });

  it('Alt+Left / Alt+Right with the focus in the strip are not strip keys: the selection stays and the active tab steps once', () => {
    setup([{ url: '/tags', title: 'Tags' }, { url: '/overview', title: 'Overview' }]);
    report('/overview', 'Overview');
    report('/tags?a=1', 'A');
    report('/tags?a=2', 'B');
    const active = within(tablist()).getAllByRole('tab')[1];
    active.focus();
    fireEvent.keyDown(active, { key: 'ArrowLeft', altKey: true });
    expect(tabNames()).toEqual(['Tags', '*B']); // not moved to the previous tab, and stepped once (not to /overview)
    expect(window.location.pathname + window.location.search).toBe('/tags?a=1');
    fireEvent.keyDown(within(tablist()).getAllByRole('tab')[1], { key: 'ArrowLeft' }); // a plain arrow still moves
    expect(tabNames()).toEqual(['*Tags', 'B']);
  });

  it('Back/Forward are disabled until the active tab has history, and step it', async () => {
    setup();
    const back = () => within(tablist().parentElement!).getByRole('button', { name: 'Back' });
    const fwd = () => within(tablist().parentElement!).getByRole('button', { name: 'Forward' });
    expect(back()).toBeDisabled();
    report('/overview', 'Overview');
    report('/tags', 'Tags');
    expect(back()).toBeEnabled();
    await userEvent.click(back());
    expect(fwd()).toBeEnabled();
    expect(window.location.pathname).toBe('/overview');
  });

  it('Back is disabled while the active tab’s frame has not reported yet (a discarded tab coming back), enabled after its first report', async () => {
    setup();
    report('/overview', 'Overview');
    report('/tags', 'Tags'); // t0 now has history
    for (let i = 0; i < 8; i++) await userEvent.click(screen.getByRole('button', { name: 'New tab' })); // 9 tabs: t0's frame is discarded
    await userEvent.click(within(tablist()).getAllByRole('tab')[0]);
    const back = within(tablist().parentElement!).getByRole('button', { name: 'Back' });
    expect(back).toBeDisabled();
    report('/tags', 'Tags');
    expect(back).toBeEnabled();
  });

  it('a stale tab gets a dot and a longer label on Refresh; refreshing clears it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    setup([{ url: '/overview', title: 'Overview' }, { url: '/tags', title: 'Tags' }]);
    await userEvent.click(within(tablist()).getAllByRole('tab')[1]); // mount Tags
    await userEvent.click(within(tablist()).getAllByRole('tab')[0]); // leave it
    vi.setSystemTime(1_000_000 + STALE_MS + 1);
    await userEvent.click(within(tablist()).getAllByRole('tab')[1]);
    const stale = within(tablist().parentElement!).getByRole('button', { name: /not viewed for over 30 minutes/ });
    expect(stale).toHaveAttribute('data-stale');
    await userEvent.click(stale);
    expect(within(tablist().parentElement!).getByRole('button', { name: 'Refresh this tab' })).not.toHaveAttribute('data-stale');
    vi.useRealTimers();
  });
});

describe('TabsSheet (phones)', () => {
  it('"Tabs (N)" is below md only and opens a sheet to switch, close and add tabs', async () => {
    setup([{ url: '/overview', title: 'Overview' }, { url: '/tags', title: 'Tags' }]);
    const button = screen.getByRole('button', { name: 'Tabs (2)' });
    expect(button.className).toContain('md:hidden');
    await userEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Open tabs' });
    expect(within(sheet).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(within(sheet).getByRole('button', { name: 'Back' })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close Overview' }));
    expect(within(sheet).queryByRole('button', { name: 'Overview' })).toBeNull();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Tags' }));
    expect(screen.queryByRole('dialog')).toBeNull(); // picking a tab closes the sheet
    await userEvent.click(screen.getByRole('button', { name: 'Tabs (1)' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'New tab' }));
    expect(screen.getByRole('button', { name: 'Tabs (2)' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Tags', '*Overview']);
  });
});
