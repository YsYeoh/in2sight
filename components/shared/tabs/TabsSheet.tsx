'use client';

// Phones (below md, Plan 14c): a "Tabs (N)" button in the header opens a sheet with Back/Forward/Refresh for the
// active tab, the open tabs (switch, close) and "New tab". The bottom bar keeps navigating inside the current tab.
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogTrigger } from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { TabNavButtons } from '@/components/shared/tabs/TabStrip';
import { useTabTitle, useTabs } from '@/components/shared/tabs/TabHost';
import { HOME } from '@/lib/tabs/model';
import { cn } from '@/lib/utils';

export function TabsSheet({ className }: { className?: string }) {
  const t = useTranslations('tabs');
  const { state, open, activate, close } = useTabs();
  const title = useTabTitle();
  const [show, setShow] = useState(false);
  const pick = (id: string) => {
    activate(id);
    setShow(false);
  };
  return (
    <ResponsiveDialog open={show} onOpenChange={setShow}>
      <ResponsiveDialogTrigger asChild>
        <Button variant="ghost" className={className}>
          {t('button', { count: state.tabs.length })}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('sheetTitle')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('sheetHint')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <TabNavButtons />
        <ul className="flex flex-col gap-1">
          {state.tabs.map((tab) => {
            const active = tab.id === state.active;
            const name = title(tab);
            return (
              <li key={tab.id} className={cn('flex min-h-[var(--ctl)] items-center gap-1 rounded-md', active ? 'bg-accent text-accent-foreground' : 'hover:bg-hover')}>
                <button type="button" aria-current={active ? 'page' : undefined} onClick={() => pick(tab.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm">
                  {name}
                </button>
                <Button variant="ghost" size="icon" aria-label={t('close', { title: name })} onClick={() => close(tab.id)}>
                  <X aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="outline"
          onClick={() => {
            open(HOME, 'new');
            setShow(false);
          }}
        >
          <Plus aria-hidden />
          {t('newTab')}
        </Button>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
