'use client';

// The frame side of the app-shell tabs (Plan 14c), mounted by AppShell when the page runs inside a tab's frame:
// - reports where the frame is (after every navigation, and again when the page heading streams in or changes);
// - ctrl/⌘-click, middle-click and target="_blank" on a link to a tab page ask the shell for a tab instead;
// - Alt+Left / Alt+Right ask the shell to step THIS tab's history (the browser's history is shared by all frames);
// - obeys the shell: `go` = a client navigation, `refresh` = re-fetch the page's server data (keeps scroll and drawers).
// Plain clicks are left to Next: in-page links stay in the tab.
import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { startProgress } from '@/components/shared/NavigationProgress';
import { readShellMessage, tabUrl, type FrameMessage } from '@/lib/tabs/protocol';

export const TITLE_DEBOUNCE_MS = 250;

/** The tab title: the page heading; on an account page plus its selected section tab ("@name · Posts"). '' while none. */
export function pageTitle(root: ParentNode, pathname: string): string {
  const h1 = root.querySelector('main h1')?.textContent?.trim() ?? '';
  if (!h1 || !/^\/accounts\/[^/]+$/.test(pathname)) return h1;
  const section = root.querySelector('main [role="tab"][aria-selected="true"]')?.textContent?.trim();
  return section ? `${h1} · ${section}` : h1;
}

const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const post = (m: FrameMessage) => window.parent.postMessage(m, window.location.origin);

export function FrameBridge() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const router = useRouter();
  const url = search ? `${pathname}?${search}` : pathname;

  // where am I + my title, now and whenever the heading changes (it streams in after the loading skeleton)
  useEffect(() => {
    let last = pageTitle(document, pathname);
    post({ type: 'in2sight:nav', url, title: last });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const title = pageTitle(document, pathname);
        if (title === last) return;
        last = title;
        post({ type: 'in2sight:nav', url, title });
      }, TITLE_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [url, pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute('download')) return;
      const wantsTab = (e.type === 'click' && e.button === 0 && (e.ctrlKey || e.metaKey || a.target === '_blank')) || (e.type === 'auxclick' && e.button === 1);
      if (!wantsTab) return;
      const target = tabUrl(a.href, window.location.origin);
      if (!target) return; // Instagram, the report preview, downloads: the browser's normal behaviour
      e.preventDefault();
      post({ type: 'in2sight:open', url: target });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      if (e.target instanceof Element && e.target.closest(TEXT_FIELD)) return; // Option+arrows is word-jump (Mac)
      e.preventDefault();
      post({ type: 'in2sight:history', dir: e.key === 'ArrowLeft' ? -1 : 1 });
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const m = readShellMessage(e.data, window.location.origin);
      if (m?.type === 'in2sight:go') {
        startProgress(m.url);
        router.push(m.url);
      } else if (m?.type === 'in2sight:refresh') router.refresh();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('auxclick', onClick, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('auxclick', onClick, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, [router]);

  return null;
}
