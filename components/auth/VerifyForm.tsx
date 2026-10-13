'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FormState } from '@/lib/auth/sign-in';

export function VerifyForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="flex flex-col gap-[var(--gp)]" noValidate>
      <FormField id="code" label={t('verify.code')}>
        {(p) => <Input {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus className="text-center tracking-[0.3em]" />}
      </FormField>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {t('verify.submit')}
      </Button>
    </form>
  );
}
