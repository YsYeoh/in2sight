'use client';

import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Button } from '@/components/ui/button';
import { useUnsavedGuard } from '@/components/settings/unsaved';

export interface SaveBarProps {
  dirty: boolean;
  pending: boolean;
  /** what the last save did; 'saved' shows until the next edit, 'error' until the next save */
  result: 'saved' | 'error' | null;
  /** translated text for result 'error' */
  error: string;
  /** translated text for result 'saved' */
  saved: string;
  onDiscard: () => void;
}

/**
 * The explicit-save model (Plan 16a, UI standard 18): the last child of a <form>, sticky at the bottom of the tab frame
 * (the phone bottom bar sits outside the frame), Save = the form's submit button (disabled while clean). Registers the
 * unsaved-changes guard while dirty.
 */
export function SaveBar({ dirty, pending, result, error, saved, onDiscard }: SaveBarProps) {
  const t = useTranslations('settings.unsaved');
  const tc = useTranslations('common');
  useUnsavedGuard(dirty);
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mr-auto min-w-0 text-sm">
        {result === 'error' ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : result === 'saved' && !dirty ? (
          <p role="status" className="text-muted-foreground">
            {saved}
          </p>
        ) : dirty ? (
          <p className="text-muted-foreground">{t('bar')}</p>
        ) : null}
      </div>
      {dirty ? (
        <Button type="button" variant="outline" onClick={onDiscard} disabled={pending}>
          {t('discard')}
        </Button>
      ) : null}
      <LoadingButton type="submit" pending={pending} disabled={!dirty}>
        {tc('save')}
      </LoadingButton>
    </div>
  );
}
