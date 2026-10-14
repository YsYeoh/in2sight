'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeGroup } from '@/lib/accounts/group';

/** Plain link target (a GET with a cookie side effect: never wrap it in next/link, which would prefetch it). */
export function connectHref(group: string | null | undefined): string {
  const g = normalizeGroup(group);
  return `/api/instagram/connect${g.ok && g.value ? `?group=${encodeURIComponent(g.value)}` : ''}`;
}

export function ConnectDialog({ groups, trigger, defaultGroup = '' }: { groups: string[]; trigger: ReactNode; defaultGroup?: string }) {
  const t = useTranslations('accounts.connect');
  const [group, setGroup] = useState(defaultGroup);
  const listId = useId();
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>{trigger}</ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('notes')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <FormField id="connect-group" label={t('group')} hint={t('groupHint')}>
          {(p) => (
            <>
              <Input {...p} list={listId} maxLength={40} value={group} onChange={(e) => setGroup(e.target.value)} autoComplete="off" />
              <datalist id={listId}>
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </>
          )}
        </FormField>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button variant="outline">{t('cancel')}</Button>
          </ResponsiveDialogClose>
          <Button asChild>
            <a href={connectHref(group)}>{t('continue')}</a>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
