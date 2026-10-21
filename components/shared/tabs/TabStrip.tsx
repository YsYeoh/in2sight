'use client';

// The tab strip in the header row (md+, Plan 14c): Back / Forward / Refresh for the active tab, the tabs (title +
// close; they shrink, then the row scrolls sideways) and "+" (a new Overview tab). A WAI-ARIA tablist: one tab in the
// Tab order (roving tabIndex), Left/Right/Home/End move and activate, Delete closes. Switching is instant, so arrow
// keys activate as they move. The frames are the tab panels; they carry their own titles.
import type { KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useTabTitle, useTabs } from '@/components/shared/tabs/TabHost';
import { HOME } from '@/lib/tabs/model';
import { cn } from '@/lib/utils';

/** Back, Forward and Refresh for the active tab (also used in the phone sheet). */
export function TabNavButtons() {
  const t = useTranslations('tabs');
  const { state, step, refresh } = useTabs();
  const tab = state.tabs.find((x) => x.id === state.active);
  return (
    <div className="flex shrink-0 items-center">
      <Button variant="ghost" size="icon" aria-label={t('back')} disabled={!tab?.back.length} onClick={() => step(-1)}>
        <ArrowLeft aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('forward')} disabled={!tab?.fwd.length} onClick={() => step(1)}>
        <ArrowRight aria-hidden />
      </Button>
      <Button variant="ghost" size="icon" aria-label={tab?.stale ? t('refreshStale') : t('refresh')} data-stale={tab?.stale || undefined} className="relative" onClick={refresh}>
        <RotateCw aria-hidden />
        {tab?.stale ? <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" /> : null}
      </Button>
    </div>
  );
}

export function TabStrip({ className }: { className?: string }) {
  const t = useTranslations('tabs');
  const { state, open, activate, close } = useTabs();
  const title = useTabTitle();
  const focusTab = (id: string) => document.getElementById(`tab-${id}`)?.focus();

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = state.tabs.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to !== null) {
      e.preventDefault();
      activate(state.tabs[to].id);
      focusTab(state.tabs[to].id);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const next = state.tabs[i + 1] ?? state.tabs[i - 1];
      close(state.tabs[i].id);
      if (next) focusTab(next.id);
    }
  };

  return (
    <div className={cn('min-w-0 items-center gap-1', className)}>
      <TabNavButtons />
      <div role="tablist" aria-label={t('strip')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {state.tabs.map((tab, i) => {
          const active = tab.id === state.active;
          const name = title(tab);
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex h-[var(--ctl)] max-w-56 min-w-16 flex-1 basis-56 items-center rounded-md border border-transparent text-sm transition-colors',
                active ? 'border-border bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-hover hover:text-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={name}
                onClick={() => activate(tab.id)}
                onKeyDown={(e) => onKey(e, i)}
                className="h-full min-w-0 flex-1 truncate rounded-md px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {name}
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('close', { title: name })}
                onClick={() => close(tab.id)}
                className="mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <Button variant="ghost" size="icon" aria-label={t('newTab')} onClick={() => open(HOME, 'new')}>
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
