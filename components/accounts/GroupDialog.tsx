'use client';

import { useId, useState } from 'react';
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
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StoredAccount } from '@/lib/accounts/types';

interface Props {
  account: StoredAccount | null; // null = closed
  groups: string[];
  busy: boolean;
  error: string | null;
  onSave: (group: string) => void; // raw text; the server action normalises (trim, collapse, 40 max)
  onClose: () => void;
}

function GroupForm({ account, groups, busy, error, onSave }: Omit<Props, 'account' | 'onClose'> & { account: StoredAccount }) {
  const t = useTranslations('accounts');
  const [group, setGroup] = useState(account.groupName ?? '');
  const listId = useId();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(group);
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('group.title')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>@{account.username}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      <FormField id="edit-group" label={t('connect.group')} hint={t('connect.groupHint')} error={error ?? undefined}>
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
          <Button type="button" variant="outline">
            {t('connect.cancel')}
          </Button>
        </ResponsiveDialogClose>
        <Button type="submit" disabled={busy}>
          {t('group.save')}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

export function GroupDialog({ account, onClose, ...rest }: Props) {
  return (
    <ResponsiveDialog open={account !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>{account ? <GroupForm key={account.id} account={account} {...rest} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
