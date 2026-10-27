'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
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
import type { DeleteState } from '@/lib/data/delete';

type Action = (prev: DeleteState, formData: FormData) => Promise<DeleteState>;
type Done = Extract<DeleteState, { ok: true }>;

// Lives inside the dialog content, which unmounts on close: the password, the typed word and an old error never linger.
function DeleteForm({ action, email, phrase, onDone }: { action: Action; email: string | null; phrase: string; onDone: (d: Done) => void }) {
  const t = useTranslations('settings.data.deleteAll');
  // success is reported from inside the action (no effect: it would fire again on every re-render while closing)
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(async (prev, fd) => {
    const r = await action(prev, fd);
    if (r && 'ok' in r) onDone(r);
    return r;
  }, null);
  const [typed, setTyped] = useState('');
  const error = state && 'error' in state ? state.error : null;
  return (
    <form action={formAction} className="grid gap-[var(--gp)]">
      {/* lets a password manager offer the right entry; the server never reads it */}
      <input type="text" name="username" autoComplete="username" value={email ?? ''} readOnly hidden />
      <FormField id="delete-password" label={t('password')} error={error === 'wrong_password' || error === 'missing_password' ? t(`errors.${error}`) : undefined}>
        {(p) => <PasswordInput {...p} name="password" autoComplete="current-password" required />}
      </FormField>
      <FormField id="delete-phrase" label={t('phrase', { phrase })} error={error === 'phrase' ? t('errors.phrase') : undefined}>
        {(p) => <Input {...p} name="phrase" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} required />}
      </FormField>
      {error && !['wrong_password', 'missing_password', 'phrase'].includes(error) ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            {t('cancel')}
          </Button>
        </ResponsiveDialogClose>
        <LoadingButton type="submit" variant="destructive" pending={pending} disabled={typed !== phrase}>
          {t('confirm')}
        </LoadingButton>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** "Delete all data" (Plan 16c): a destructive button, then a dialog asking for the password and a typed word. */
export function DeleteAllData({ action, email, phrase }: { action: Action; email: string | null; phrase: string }) {
  const t = useTranslations('settings.data.deleteAll');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  return (
    <div className="grid gap-[var(--gp)]">
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogTrigger asChild>
          <Button type="button" variant="destructive" className="justify-self-start">
            {t('open')}
          </Button>
        </ResponsiveDialogTrigger>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{t('dialogTitle')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('dialogBody')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <DeleteForm
            action={action}
            email={email}
            phrase={phrase}
            onDone={(d) => {
              setDone(d);
              setOpen(false);
              router.refresh();
            }}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <div role="status" className="grid gap-1 text-sm">
        {done ? <p>{t('done', { count: done.accounts })}</p> : null}
        {done && !done.coversDone ? <p className="text-destructive">{t('coversLeft')}</p> : null}
      </div>
    </div>
  );
}
