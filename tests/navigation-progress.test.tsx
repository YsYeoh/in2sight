import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/', search: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useSearchParams: () => new URLSearchParams(nav.search) }));

import { FADE_MS, FAILSAFE_MS, NavigationProgress, formHref, isNavigation, startProgress } from '@/components/shared/NavigationProgress';

// jsdom's location is http://localhost:3000/ — links are prevented like next/link does, so jsdom never navigates.
// Plain <a>: the bar must work for any anchor, not only next/link.
/* eslint-disable @next/next/no-html-link-for-pages */
const tree = () => (
  <>
    <NavigationProgress />
    <div onClick={(e) => e.preventDefault()}>
      <a href="/accounts">internal</a>
      <a href="/">same page</a>
      <a href="#top">hash</a>
      <a href="https://example.com/x">external</a>
      <a href="/calendar" target="_blank">
        new tab
      </a>
      <a href="/api/export/xlsx">api</a>
      <a href="/tags" download>
        download
      </a>
      <a href="/tags">
        <span>nested child</span>
      </a>
    </div>
  </>
);

function setup() {
  const view = render(tree());
  const bar = () => document.querySelector('.nav-progress');
  /** The router committed a new URL (or the user went back/forward). */
  const go = (pathname: string, search = '') => {
    nav.pathname = pathname;
    nav.search = search;
    view.rerender(tree());
  };
  return { ...view, bar, go };
}
const link = (text: string) => [...document.querySelectorAll('a')].find((a) => a.textContent === text)!;

beforeEach(() => {
  vi.useFakeTimers();
  nav.pathname = '/';
  nav.search = '';
});
afterEach(() => vi.useRealTimers());

describe('isNavigation / formHref', () => {
  const here = { href: 'http://x.test/accounts?tab=a', origin: 'http://x.test', pathname: '/accounts', search: '?tab=a' };
  it.each([
    ['/overview', true],
    ['?tab=b', true],
    ['/accounts?tab=a', false],
    ['#top', false],
    ['/accounts?tab=a#top', false],
    ['https://evil.test/overview', false],
    ['/api/export/pdf', false],
    ['http://[bad', false],
  ])('%s → %s', (href, expected) => expect(isNavigation(href, here)).toBe(expected));

  it('formHref serialises the fields as the query of the same path', () => {
    const form = document.createElement('form');
    form.innerHTML = '<input name="tab" value="posts"><select name="format"><option value="REELS" selected>R</option></select><input name="from" value="">';
    expect(formHref(form)).toBe('?tab=posts&format=REELS&from=');
  });
});

describe('NavigationProgress', () => {
  it('is not rendered while idle', () => {
    const { bar } = setup();
    expect(bar()).toBeNull();
  });

  it('starts on an internal link click (also from a child element) and completes + fades when the URL changes', () => {
    const { bar, go } = setup();
    fireEvent.click(link('nested child').querySelector('span')!);
    expect(bar()).toHaveAttribute('data-state', 'loading');
    expect(bar()).toHaveAttribute('aria-hidden', 'true');
    go('/tags');
    expect(bar()).toHaveAttribute('data-state', 'done');
    act(() => void vi.advanceTimersByTime(FADE_MS));
    expect(bar()).toBeNull();
  });

  it.each(['same page', 'hash', 'external', 'new tab', 'api', 'download'])('ignores a %s link', (text) => {
    const { bar } = setup();
    fireEvent.click(link(text));
    expect(bar()).toBeNull();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('ignores a modified click %o (opens elsewhere)', (init) => {
    const { bar } = setup();
    fireEvent.click(link('internal'), init);
    expect(bar()).toBeNull();
  });

  it('never stays stuck: an aborted or failed navigation (no URL change) ends at the failsafe', () => {
    const { bar } = setup();
    fireEvent.click(link('internal'));
    act(() => void vi.advanceTimersByTime(FAILSAFE_MS - 1));
    expect(bar()).toHaveAttribute('data-state', 'loading');
    act(() => void vi.advanceTimersByTime(1));
    expect(bar()).toHaveAttribute('data-state', 'done');
    act(() => void vi.advanceTimersByTime(FADE_MS));
    expect(bar()).toBeNull();
  });

  it('rapid clicks: one bar, the failsafe restarts on each click, one completion', () => {
    const { bar, go } = setup();
    fireEvent.click(link('internal'));
    act(() => void vi.advanceTimersByTime(FAILSAFE_MS - 1000));
    fireEvent.click(link('nested child'));
    act(() => void vi.advanceTimersByTime(2000));
    expect(document.querySelectorAll('.nav-progress')).toHaveLength(1);
    expect(bar()).toHaveAttribute('data-state', 'loading');
    go('/tags');
    expect(bar()).toHaveAttribute('data-state', 'done');
  });

  it('startProgress (router.push / GET forms) starts it; a query-only change completes it', () => {
    const { bar, go } = setup();
    act(() => startProgress('?tab=posts'));
    expect(bar()).toHaveAttribute('data-state', 'loading');
    go('/', 'tab=posts');
    expect(bar()).toHaveAttribute('data-state', 'done');
  });

  it('startProgress to the current URL does nothing (would otherwise crawl until the failsafe)', () => {
    const { bar } = setup();
    act(() => startProgress('/'));
    expect(bar()).toBeNull();
  });

  it('back/forward while idle changes the URL without showing a bar', () => {
    const { bar, go } = setup();
    go('/overview');
    expect(bar()).toBeNull();
  });

  it('a click during the fade-out starts a new bar that the old fade timer does not remove', () => {
    const { bar, go } = setup();
    fireEvent.click(link('internal'));
    go('/accounts');
    expect(bar()).toHaveAttribute('data-state', 'done');
    fireEvent.click(link('nested child'));
    expect(bar()).toHaveAttribute('data-state', 'loading');
    act(() => void vi.advanceTimersByTime(FADE_MS));
    expect(bar()).toHaveAttribute('data-state', 'loading');
  });

  it('ignores a click that was already taken over in the capture phase (the tab shell opened it as a tab)', () => {
    const { bar } = setup();
    const takeOver = (e: Event) => e.preventDefault();
    window.addEventListener('click', takeOver, true); // window capture runs before the bar's document listener
    fireEvent.click(link('internal'));
    window.removeEventListener('click', takeOver, true);
    expect(bar()).toBeNull();
    fireEvent.click(link('internal'));
    expect(bar()).not.toBeNull(); // a normal click still starts it
  });

  it('removes its listeners on unmount', () => {
    const { bar, unmount } = setup();
    unmount();
    fireEvent.click(document.body);
    act(() => startProgress('/x'));
    expect(bar()).toBeNull();
  });
});
