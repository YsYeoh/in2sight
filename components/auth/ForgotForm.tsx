'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Input } from '@/components/ui/input';
import type { ForgotState } from '@/lib/auth/recovery';

/** Asks for the reset email. The answer is the same whatever the account (no enumeration). */
export function ForgotForm({ action }: { action: (prev: ForgotState, formData: FormData) => Promise<ForgotState> }) {
  const t = useTranslations('auth.forgot');
  const [state, formAction, pending] = useActionState(action, {} as ForgotState);
  return (
    <form action={formAction} className="flex flex-col gap-[var(--gp)]" noValidate>
      <FormField id="email" label={t('email')} error={state.error ? t(state.error) : undefined}>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" />}
      </FormField>
      {state.status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(state.status)}
        </p>
      ) : null}
      <LoadingButton type="submit" pending={pending} className="w-full">
        {t('submit')}
      </LoadingButton>
    </form>
  );
}
