import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const frame = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/tabs/protocol', async (orig) => ({ ...(await orig<typeof import('@/lib/tabs/protocol')>()), isFramed: () => frame.on }));

import { TabFrames, TabsProvider, useTabs } from '@/components/shared/tabs/TabHost';
import { LIVE_CAP, STORAGE_KEY } from '@/lib/tabs/model';

const O = window.location.origin;

/** A bare consumer: the real strip is tested in tab-strip.test.tsx. */
function Controls() {
  const { state, activate, close, step, refresh } = useTabs();
  return (
    <div>
      <output data-testid="tabs">{state.tabs.map((t) => `${t.id === state.active ? '*' : ''}${t.url}`).join(' ')}</output>
      <button onClick={() => step(-1)}>back</button>
      <button onClick={() => refresh()}>refresh</button>
      {state.tabs.map((t) => (
        <span key={t.id}>
          <button onClick={() => activate(t.id)}>go {t.url}</button>
          <button onClick={() => close(t.id)}>close {t.url}</button>
        </span>
      ))}
    </div>
  );
}

/* eslint-disable @next/next/no-html-link-for-pages */
function setup(url = '/overview') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TabsProvider initialUrl={url}>
        <nav data-tab-open="nav">
          <a href="/overview">side overview</a>
          <a href="/accounts">side accounts</a>
        </nav>
        <nav data-tab-open="current">
          <a href="/tags">bottom tags</a>
        </nav>
        <a href="/accounts/a1?tab=posts">bell item</a>
        <a href="/report?scope=all">report</a>
        <Controls />
        <div data-testid="frames">
          <TabFrames />
        </div>
      </TabsProvider>
    </NextIntlClientProvider>,
  );
}
const tabs = () => screen.getByTestId('tabs').textContent;
const iframes = () => [...document.querySelectorAll('iframe')];
const frameOf = (src: string) => iframes().find((f) => f.getAttribute('src') === src)!;
const fromFrame = (f: HTMLIFrameElement | Window | null, data: unknown, origin = O) =>
  act(() => void window.dispatchEvent(new MessageEvent('message', { data, origin, source: f instanceof HTMLIFrameElement ? f.contentWindow : f })));
const link = (text: string) => screen.getByText(text);

beforeEach(() => {
  frame.on = false;
  localStorage.clear();
  window.history.replaceState(null, '', '/overview');
});
afterEach(() => vi.restoreAllMocks());

describe('TabsProvider + TabFrames', () => {
  it('mounts one visible frame for the current URL, titled with the section name until the page reports its heading', () => {
    setup('/explorer?m=reach');
    expect(iframes()).toHaveLength(1);
    const f = frameOf('/explorer?m=reach');
    expect(f).toHaveAttribute('title', 'Explorer');
    expect(f).not.toHaveAttribute('inert');
    expect(f.className).not.toContain('invisible');
    fromFrame(f, { type: 'in2sight:nav', url: '/explorer?m=reach', title: 'Explorer · Reach' });
    expect(f).toHaveAttribute('title', 'Explorer · Reach');
  });

  it('restores the saved tabs (no frames until selected) and saves every change', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, tabs: [{ url: '/tags', title: 'Tags' }, { url: '/overview', title: 'Overview' }] }));
    setup('/overview');
    expect(tabs()).toBe('/tags */overview');
    expect(iframes()).toHaveLength(1);
    fireEvent.click(screen.getByText('go /tags'));
    expect(iframes()).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tabs.map((t: { url: string }) => t.url)).toEqual(['/tags', '/overview']);
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    setup('/tags');
    expect(tabs()).toBe('*/tags');
  });

  it('the address bar follows the active tab', () => {
    setup('/overview');
    fireEvent.click(link('bell item'));
    expect(window.location.pathname + window.location.search).toBe('/accounts/a1?tab=posts');
    fireEvent.click(screen.getByText('go /overview'));
    expect(window.location.pathname + window.location.search).toBe('/overview');
  });

  it('inactive frames stay mounted but invisible and inert; the active one is visible', () => {
    setup('/overview');
    fireEvent.click(link('bell item'));
    const [a, b] = [frameOf('/overview'), frameOf('/accounts/a1?tab=posts')];
    expect(a).toHaveAttribute('inert');
    expect(a).toHaveAttribute('aria-hidden', 'true');
    expect(a.className).toContain('invisible');
    expect(b).not.toHaveAttribute('inert');
  });

  it('chrome links: sidebar = jump to the section’s tab or open one; bottom bar = navigate the current tab; others = exact URL', () => {
    setup('/overview?from=2026-09-01');
    const side = fireEvent.click(link('side overview'));
    expect(side).toBe(false); // prevented: next/link does not navigate the top window
    expect(tabs()).toBe('*/overview?from=2026-09-01');
    fireEvent.click(link('side accounts'));
    fireEvent.click(link('bell item'));
    expect(tabs()).toBe('/overview?from=2026-09-01 /accounts */accounts/a1?tab=posts');
    fireEvent.click(link('bell item'));
    expect(tabs()).toBe('/overview?from=2026-09-01 /accounts */accounts/a1?tab=posts');
    fromFrame(frameOf('/accounts/a1?tab=posts'), { type: 'in2sight:nav', url: '/accounts/a1?tab=posts', title: '' }); // navigating a tab needs its frame to have reported
    fireEvent.click(link('bottom tags'));
    expect(tabs()).toBe('/overview?from=2026-09-01 /accounts */tags');
  });

  it('ctrl-click and middle-click in the chrome open the exact URL; non-tab links are left alone', () => {
    setup('/overview?x=1');
    fireEvent.click(link('side overview'), { ctrlKey: true });
    fireEvent(link('side accounts'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(tabs()).toBe('/overview?x=1 /overview */accounts');
    expect(fireEvent.click(link('report'))).toBe(true);
    expect(fireEvent.click(link('side overview'), { shiftKey: true })).toBe(true);
    expect(tabs()).toBe('/overview?x=1 /overview */accounts');
  });

  it('frames: open-in-tab opens or jumps; messages from other origins or from non-frames are ignored', () => {
    setup('/overview');
    const f = frameOf('/overview');
    fromFrame(f, { type: 'in2sight:open', url: '/calendar' });
    expect(tabs()).toBe('/overview */calendar');
    fromFrame(f, { type: 'in2sight:open', url: '/overview' });
    expect(tabs()).toBe('*/overview /calendar');
    fromFrame(f, { type: 'in2sight:open', url: '/tags' }, 'https://evil.test');
    fromFrame(window, { type: 'in2sight:open', url: '/tags' });
    fromFrame(f, { type: 'in2sight:open', url: '/login' });
    expect(tabs()).toBe('*/overview /calendar');
  });

  it('Back (button, Alt+Left, or Alt+Left inside the active frame) tells only the active frame to go back', () => {
    setup('/overview');
    const f = frameOf('/overview');
    const post = vi.spyOn(f.contentWindow!, 'postMessage');
    fromFrame(f, { type: 'in2sight:nav', url: '/overview', title: '' });
    fromFrame(f, { type: 'in2sight:nav', url: '/tags', title: '' });
    fireEvent.click(screen.getByText('back'));
    expect(post).toHaveBeenLastCalledWith({ type: 'in2sight:go', url: '/overview' }, O);
    fromFrame(f, { type: 'in2sight:nav', url: '/overview', title: '' });
    fromFrame(f, { type: 'in2sight:nav', url: '/calendar', title: '' });
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(post).toHaveBeenLastCalledWith({ type: 'in2sight:go', url: '/overview' }, O);
    fromFrame(f, { type: 'in2sight:nav', url: '/overview', title: '' });
    fromFrame(f, { type: 'in2sight:nav', url: '/explorer', title: '' });
    fromFrame(f, { type: 'in2sight:history', dir: -1 });
    expect(post).toHaveBeenLastCalledWith({ type: 'in2sight:go', url: '/overview' }, O);
    expect(post).toHaveBeenCalledTimes(3); // once per step, not once per render
  });

  it('Alt+arrows already handled by a focused widget (default prevented) do not step the tab a second time', () => {
    setup('/overview');
    const f = frameOf('/overview');
    fromFrame(f, { type: 'in2sight:nav', url: '/overview', title: '' });
    fromFrame(f, { type: 'in2sight:nav', url: '/tags', title: '' });
    const post = vi.spyOn(f.contentWindow!, 'postMessage');
    const swallow = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', swallow);
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    document.removeEventListener('keydown', swallow);
    expect(post).not.toHaveBeenCalled();
  });

  it('a history request from an inactive frame is ignored', () => {
    setup('/overview');
    const f = frameOf('/overview');
    fromFrame(f, { type: 'in2sight:nav', url: '/overview', title: '' });
    fromFrame(f, { type: 'in2sight:nav', url: '/tags', title: '' });
    fireEvent.click(link('bell item'));
    const post = vi.spyOn(f.contentWindow!, 'postMessage');
    fromFrame(f, { type: 'in2sight:history', dir: -1 });
    expect(post).not.toHaveBeenCalled();
  });

  it('Refresh asks the active frame to re-fetch its data', () => {
    setup('/overview');
    const post = vi.spyOn(frameOf('/overview').contentWindow!, 'postMessage');
    fireEvent.click(screen.getByText('refresh'));
    expect(post).toHaveBeenCalledWith({ type: 'in2sight:refresh' }, O);
  });

  it(`keeps at most ${LIVE_CAP} live frames: the least recently viewed inactive one is discarded, its tab stays`, () => {
    setup('/overview');
    for (let i = 1; i <= LIVE_CAP; i++) fromFrame(frameOf('/overview'), { type: 'in2sight:open', url: `/explorer?i=${i}` });
    expect(tabs()?.split(' ')).toHaveLength(LIVE_CAP + 1);
    expect(iframes()).toHaveLength(LIVE_CAP);
    expect(iframes().some((f) => f.getAttribute('src') === '/overview')).toBe(false);
    fireEvent.click(screen.getByText('go /overview'));
    expect(frameOf('/overview')).toBeDefined(); // reloaded from its URL
    expect(iframes()).toHaveLength(LIVE_CAP);
  });

  it('a Web Push click forwarded by the service worker opens or jumps to that page', () => {
    const sw = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
    setup('/overview');
    act(() => void sw.dispatchEvent(new MessageEvent('message', { data: { type: 'in2sight:open', url: '/accounts/a1?tab=posts' }, origin: O })));
    expect(tabs()).toBe('/overview */accounts/a1?tab=posts');
    act(() => void sw.dispatchEvent(new MessageEvent('message', { data: { type: 'in2sight:open', url: '/tags' }, origin: 'https://evil.test' })));
    expect(tabs()).toBe('/overview */accounts/a1?tab=posts');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('inside a frame it does nothing: no frames, no storage, no listeners', () => {
    frame.on = true;
    setup('/overview');
    expect(iframes()).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(fireEvent.click(link('bell item'))).toBe(true);
  });
});
