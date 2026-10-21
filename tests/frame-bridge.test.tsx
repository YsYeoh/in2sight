import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/accounts/a1', search: 'tab=posts', push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}));

import { FrameBridge, TITLE_DEBOUNCE_MS, pageTitle } from '@/components/shared/tabs/FrameBridge';

// jsdom: this window is its own parent, so the bridge's posts to the shell land on window.postMessage (spied).
let posted: MockInstance<(message: unknown, targetOrigin: string) => void>;
const sent = () => posted.mock.calls.map((c) => c[0]);
const O = window.location.origin;

/* eslint-disable @next/next/no-html-link-for-pages */
const page = (h1 = '@a1') => (
  <main>
    <h1>{h1}</h1>
    <div role="tablist">
      <button role="tab" aria-selected="false">Overview</button>
      <button role="tab" aria-selected="true">Posts</button>
    </div>
    <a href="/accounts/a1/media/m1?from=2026-09-01">post</a>
    <a href="/accounts/a2" target="_blank">other account</a>
    <a href="https://www.instagram.com/x/" target="_blank">instagram</a>
    <a href="/report?scope=all" target="_blank">report</a>
    <a href="/tags" download>download</a>
  </main>
);
const link = (text: string) => [...document.querySelectorAll('a')].find((a) => a.textContent === text)!;
const tree = (h1?: string) => (
  <>
    <FrameBridge />
    {page(h1)}
  </>
);

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = '/accounts/a1';
  nav.search = 'tab=posts';
  nav.push.mockClear();
  nav.refresh.mockClear();
  posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {}) as unknown as typeof posted;
});
afterEach(() => {
  posted.mockRestore();
  vi.useRealTimers();
});

describe('pageTitle', () => {
  it('is the page heading; on an account page plus the selected section tab', () => {
    render(page('@yseny_'));
    expect(pageTitle(document, '/accounts/a1')).toBe('@yseny_ · Posts');
    expect(pageTitle(document, '/accounts/a1/media/m1')).toBe('@yseny_');
    expect(pageTitle(document, '/explorer')).toBe('@yseny_');
  });

  it('is empty while there is no heading', () => {
    render(<main />);
    expect(pageTitle(document, '/explorer')).toBe('');
  });
});

describe('FrameBridge', () => {
  it('reports its URL and title to the parent with the own origin as target', () => {
    render(tree());
    expect(posted).toHaveBeenCalledWith({ type: 'in2sight:nav', url: '/accounts/a1?tab=posts', title: '@a1 · Posts' }, O);
  });

  it('reports again after a navigation, and when the heading streams in (debounced, only on change)', async () => {
    const view = render(tree('@a1'));
    posted.mockClear();
    nav.search = 'tab=stories';
    view.rerender(tree('@a1'));
    expect(sent()).toEqual([{ type: 'in2sight:nav', url: '/accounts/a1?tab=stories', title: '@a1 · Posts' }]);
    posted.mockClear();
    view.rerender(tree('@a1 renamed'));
    await act(async () => {}); // the MutationObserver callback is a microtask
    await act(async () => void vi.advanceTimersByTime(TITLE_DEBOUNCE_MS));
    expect(sent()).toEqual([{ type: 'in2sight:nav', url: '/accounts/a1?tab=stories', title: '@a1 renamed · Posts' }]);
    posted.mockClear();
    document.body.append(document.createElement('div')); // an unrelated change: same title, nothing sent
    await act(async () => {});
    await act(async () => void vi.advanceTimersByTime(TITLE_DEBOUNCE_MS));
    expect(sent()).toEqual([]);
  });

  it('ctrl/⌘-click, middle-click and target=_blank on a tab page ask the shell for a tab (and do not navigate)', () => {
    render(tree());
    posted.mockClear();
    const ctrl = fireEvent.click(link('post'), { ctrlKey: true });
    fireEvent.click(link('post'), { metaKey: true });
    fireEvent(link('post'), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    fireEvent.click(link('other account'));
    expect(ctrl).toBe(false); // default prevented
    expect(sent()).toEqual([
      { type: 'in2sight:open', url: '/accounts/a1/media/m1?from=2026-09-01' },
      { type: 'in2sight:open', url: '/accounts/a1/media/m1?from=2026-09-01' },
      { type: 'in2sight:open', url: '/accounts/a1/media/m1?from=2026-09-01' },
      { type: 'in2sight:open', url: '/accounts/a2' },
    ]);
  });

  it('plain clicks, shift-clicks, other sites, the report preview and downloads are left alone', () => {
    render(tree());
    posted.mockClear();
    fireEvent.click(link('post'), { shiftKey: true });
    for (const t of ['instagram', 'report', 'download']) fireEvent.click(link(t), { ctrlKey: true });
    const plain = fireEvent.click(link('post'));
    expect(plain).toBe(true);
    expect(sent()).toEqual([]);
  });

  it('Alt+Left / Alt+Right ask the shell to step this tab; other keys do nothing', () => {
    render(tree());
    posted.mockClear();
    const back = fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true, shiftKey: true });
    expect(back).toBe(false);
    expect(sent()).toEqual([
      { type: 'in2sight:history', dir: -1 },
      { type: 'in2sight:history', dir: 1 },
    ]);
  });

  it('Alt+arrows typed in a text field are the field’s own (word jump on a Mac), not a Back/Forward request', () => {
    render(
      <>
        <FrameBridge />
        <input aria-label="search" />
        <textarea aria-label="note" />
        <select aria-label="pick" />
        <div contentEditable suppressContentEditableWarning aria-label="rich" />
        <button>plain</button>
      </>,
    );
    posted.mockClear();
    for (const el of ['search', 'note', 'pick', 'rich']) {
      const ok = fireEvent.keyDown(document.querySelector(`[aria-label="${el}"]`)!, { key: 'ArrowLeft', altKey: true });
      expect(ok, el).toBe(true); // not prevented
    }
    expect(sent()).toEqual([]);
    fireEvent.keyDown(document.querySelector('button')!, { key: 'ArrowLeft', altKey: true });
    expect(sent()).toEqual([{ type: 'in2sight:history', dir: -1 }]);
  });

  it('obeys go and refresh from its parent only, same origin only, valid URLs only', () => {
    render(tree());
    const from = (data: unknown, origin = O, source: MessageEventSource | null = window) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, origin, source })));
    from({ type: 'in2sight:go', url: '/explorer?m=reach' });
    from({ type: 'in2sight:refresh' });
    expect(nav.push).toHaveBeenCalledWith('/explorer?m=reach');
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    from({ type: 'in2sight:go', url: '/tags' }, 'https://evil.test');
    from({ type: 'in2sight:go', url: '/tags' }, O, null);
    from({ type: 'in2sight:go', url: '/login' });
    from({ type: 'in2sight:go', url: 'https://evil.test/tags' });
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = render(tree());
    unmount();
    posted.mockClear();
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'in2sight:refresh' }, origin: O, source: window }));
    expect(sent()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
